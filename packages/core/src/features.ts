// Each block's features: what it holds, owned or inherited, and in which role.
// Roles only; the validate module turns them into findings.

import type { Classification } from './classify.ts';
import type { Facts } from './facts.ts';
import type { Extensions, FeatureRole, Phase } from './types.ts';
import { phaseRank } from './vocabulary.ts';

/** A feature a block holds. */
export interface HeldFeature {
  id: string;                    // the declaration; for an inherited feature, the original one
  role: FeatureRole;
  phase: Phase | null;
  inheritedFrom: string | null;  // the direct parent block it was copied from; null if owned
  redefines: string | null;      // the held feature it replaced
  alsoRedefines: string[];       // other held features it redefines, which stay as they were (R13)
}

/** A specialization cycle among blocks (R4). */
export interface Cycle {
  members: string[];             // the blocks in it, in model order
  path: string[];                // one cycle through the first member: [a, b, …] for a → b → … → a
}

export interface Catalog {
  /** The blocks in processing order: by phase, then parents first, then model order. */
  order: string[];
  /** Each block's direct written supertypes that are blocks. */
  parents: Map<string, string[]>;
  /** What each block holds: inherited features first, each owned one in place of what it redefines. */
  features: Map<string, HeldFeature[]>;
  cycles: Cycle[];
}

export function catalog(facts: Facts, c: Classification, extensions: Extensions): Catalog {
  const blocks = c.blocks;
  const index = new Map(blocks.map((b, i) => [b, i]));
  const phase = (block: string): Phase => c.typePhase(block)!;
  const parents = new Map(blocks.map((b) => [b, (facts.types.get(b)?.supertypes ?? []).filter((s) => index.has(s))]));

  const components = stronglyConnected(blocks, parents);
  const component = new Map<string, number>();
  components.forEach((members, i) => { for (const m of members) component.set(m, i); });
  const cycles = components
    .filter((members) => members.length > 1 || parents.get(members[0]!)!.includes(members[0]!))
    .map((members) => ({ members, path: cycleThrough(members[0]!, new Set(members), parents) }));

  // a block's phase is never below a parent's, so ordering by phase first keeps
  // parents first; within a phase, a component is ready once its outside parents are done
  const order: string[] = [];
  const done = new Set<number>();
  const waiting = new Set(components.keys());
  const ready = (i: number) => components[i]!.every((m) => parents.get(m)!.every((p) => component.get(p) === i || done.has(component.get(p)!)));
  const rank = (i: number) => phaseRank(phase(components[i]![0]!)) * blocks.length + index.get(components[i]![0]!)!;
  while (waiting.size) {
    let next = -1;
    for (const i of waiting) if (ready(i) && (next < 0 || rank(i) < rank(next))) next = i;
    if (next < 0) throw new Error('features: no component is ready');   // the condensation is acyclic
    waiting.delete(next);
    done.add(next);
    order.push(...components[next]!);
  }

  const features = new Map<string, HeldFeature[]>();
  for (const block of order) {
    const blockPhase = phase(block);
    const holding: HeldFeature[] = [];
    const heldAt = (id: string) => holding.findIndex((h) => h.id === id);

    // 1. inherit from each parent block, except from another member of the same cycle
    for (const parent of parents.get(block)!) {
      if (component.get(parent) === component.get(block)) continue;
      for (const f of features.get(parent) ?? []) {
        if (heldAt(f.id) < 0) holding.push({ ...f, inheritedFrom: parent });
      }
    }

    // 2. owned features, in order
    for (const id of facts.types.get(block)?.features ?? []) {
      const fact = facts.features.get(id);
      if (!fact) continue;
      const featurePhase = c.featurePhase(id);
      const targets = [...new Set(fact.redefines)].filter((r) => heldAt(r) >= 0);
      const [first, ...rest] = targets;
      if (first === undefined) {
        // a new feature, or a redefinition of one the block does not hold (fix 1.2)
        holding.push({ id, role: newRole(featurePhase, blockPhase, extensions), phase: featurePhase, inheritedFrom: null, redefines: null, alsoRedefines: [] });
      } else {
        const at = heldAt(first);
        const role = replacedRole(holding[at]!.role, featurePhase, blockPhase);
        holding[at] = { id, role, phase: featurePhase, inheritedFrom: null, redefines: first, alsoRedefines: rest };
      }
    }
    features.set(block, holding);
  }

  return { order, parents, features, cycles };
}

// a new feature's role: a blackbox-phase feature is a subsystem, or in a blackbox a property when
// the extension is on; a feature without a phase is ordinary content; any other is misplaced
function newRole(feature: Phase | null, block: Phase, extensions: Extensions): FeatureRole {
  if (feature === null) return 'untracked';
  if (feature === 'blackbox' && block === 'blackbox') return extensions.properties ? 'property' : 'subsystem';
  if (feature === 'blackbox' && block === 'graybox') return 'subsystem';
  return 'misplaced';
}

// a redefinition keeps the role of what it replaces, except that a whitebox realizes a subsystem
// with a graybox or whitebox (a choice), and untracked content is misplaced once it has a phase
function replacedRole(held: FeatureRole, feature: Phase | null, block: Phase): FeatureRole {
  if (held === 'untracked' || held === 'misplaced') return feature === null ? 'untracked' : 'misplaced';
  if (held === 'subsystem' && block === 'whitebox' && (feature === 'graybox' || feature === 'whitebox')) return 'choice';
  return held;
}

// Tarjan's strongly connected components over block → parent edges, each in model order, listed
// in the order of their first members
function stronglyConnected(nodes: string[], edges: Map<string, string[]>): string[][] {
  const position = new Map(nodes.map((n, i) => [n, i]));
  const low = new Map<string, number>();
  const visit = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  let counter = 0;
  const connect = (n: string) => {
    visit.set(n, counter);
    low.set(n, counter++);
    stack.push(n);
    onStack.add(n);
    for (const m of edges.get(n) ?? []) {
      if (!visit.has(m)) { connect(m); low.set(n, Math.min(low.get(n)!, low.get(m)!)); }
      else if (onStack.has(m)) low.set(n, Math.min(low.get(n)!, visit.get(m)!));
    }
    if (low.get(n) === visit.get(n)) {
      const members: string[] = [];
      let m: string;
      do { m = stack.pop()!; onStack.delete(m); members.push(m); } while (m !== n);
      found.push(members.sort((a, b) => position.get(a)! - position.get(b)!));
    }
  };
  for (const n of nodes) if (!visit.has(n)) connect(n);
  return found.sort((a, b) => position.get(a[0]!)! - position.get(b[0]!)!);
}

// the shortest cycle from start back to itself within members, as the path before returning
function cycleThrough(start: string, members: Set<string>, edges: Map<string, string[]>): string[] {
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of edges.get(at) ?? []) {
      if (!members.has(next)) continue;
      if (next === start) {
        const path = [at];
        while (path[0] !== start) path.unshift(previous.get(path[0]!)!);
        return path;
      }
      if (!previous.has(next)) { previous.set(next, at); queue.push(next); }
    }
  }
  return [start];
}
