// Phases and blocks, from what the model states: owned phase metadata, and
// written specializations, typings, subsettings and redefinitions. Never from derived supertypes.

import type { Facts } from './facts.ts';
import type { Phase, Vocabulary } from './types.ts';
import { PHASES, phaseQualifiedNames, phaseRank, qualify } from './vocabulary.ts';

export interface Classification {
  libraryFound: boolean;       // the vocabulary's root package resolves
  /** A type's phase, or null for none. */
  typePhase(id: string): Phase | null;
  /** A feature's phase, or null for none. */
  featurePhase(id: string): Phase | null;
  /** The phase an element's owned metadata gives, or null. */
  metadataPhase(id: string): Phase | null;
  /** The phase of the vocabulary collection a feature explicitly subsets, if any. */
  collectionPhase(id: string): Phase | null;
  /** Whether the element is inside the vocabulary's root package. */
  inRoot(id: string): boolean;
  /** The blocks, in model order: occurrence definitions with a phase, outside the root package. */
  blocks: string[];
}

const most = (phases: (Phase | null)[]): Phase | null =>
  phases.reduce<Phase | null>((best, p) => (p !== null && (best === null || phaseRank(p) > phaseRank(best)) ? p : best), null);

export function classify(facts: Facts, vocabulary: Vocabulary): Classification {
  const root = facts.resolve(qualify(vocabulary.root));

  // the vocabulary's elements, by id
  const concepts = new Map<string, Phase>();
  const collections = new Map<string, Phase>();
  const metadata = new Map<string, Phase>();
  for (const phase of PHASES) {
    const names = phaseQualifiedNames(vocabulary, phase);
    for (const [map, name] of [[concepts, names.concept], [collections, names.collection], [metadata, names.metadata]] as const) {
      const id = facts.resolve(name);
      if (id !== null) map.set(id, phase);
    }
  }

  const insideRoot = new Map<string, boolean>();
  const inRoot = (id: string): boolean => {
    if (root === null) return false;
    const known = insideRoot.get(id);
    if (known !== undefined) return known;
    const seen = new Set<string>();
    let at: string | null = id;
    let inside = false;
    while (at !== null && !seen.has(at)) {
      if (at === root) { inside = true; break; }
      seen.add(at);
      at = facts.elements.get(at)?.owner ?? null;
    }
    insideRoot.set(id, inside);
    return inside;
  };

  const metadataPhase = (id: string): Phase | null =>
    most((facts.elements.get(id)?.metadata ?? []).map((m) => metadata.get(m) ?? null));

  // A phase is the most specific one among the sources, recursively: the highest
  // phase met anywhere along written specializations, typings, subsettings and redefinitions.
  // A search with a visited set gives it whatever the order, cycles included. A vocabulary
  // concept or collection gives its phase, and the search does not go past it.
  type Node = { id: string; feature: boolean };
  const search = (start: Node): Phase | null => {
    const seen = new Set<string>();
    const todo: Node[] = [start];
    const found: (Phase | null)[] = [];
    while (todo.length) {
      const { id, feature } = todo.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (feature) {
        const fact = facts.features.get(id);
        if (!fact) continue;
        found.push(metadataPhase(id));
        for (const t of fact.types) todo.push({ id: t, feature: false });
        for (const g of [...fact.subsets, ...fact.redefines]) {
          const collection = collections.get(g);
          if (collection) found.push(collection);
          else todo.push({ id: g, feature: true });
        }
      } else {
        const concept = concepts.get(id);
        if (concept) { found.push(concept); continue; }
        const fact = facts.types.get(id);
        if (!fact) continue;
        found.push(metadataPhase(id));
        for (const s of fact.supertypes) todo.push({ id: s, feature: false });
      }
    }
    return most(found);
  };

  const cache = new Map<string, Phase | null>();
  const cached = (node: Node): Phase | null => {
    if (!cache.has(node.id)) cache.set(node.id, search(node));
    return cache.get(node.id) ?? null;
  };
  const typePhase = (id: string): Phase | null => cached({ id, feature: false });
  const featurePhase = (id: string): Phase | null => cached({ id, feature: true });

  const collectionPhase = (id: string): Phase | null =>
    most((facts.features.get(id)?.subsets ?? []).map((g) => collections.get(g) ?? null));

  const blocks = [...facts.types.values()]
    .filter((t) => t.occurrenceDefinition && !inRoot(t.id) && typePhase(t.id) !== null)
    .map((t) => t.id);

  return { libraryFound: root !== null, typePhase, featurePhase, metadataPhase, collectionPhase, inRoot, blocks };
}
