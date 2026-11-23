// The validation rules R1–R13. A rule on a feature checks the features a block
// owns, so an inherited copy is not reported again; R10 alone is about inherited subsystems. R12
// rolls up the findings on a block's owned features.

import type { Classification } from './classify.ts';
import { displayName, refOf } from './facts.ts';
import type { Facts } from './facts.ts';
import type { Families } from './families.ts';
import type { Catalog } from './features.ts';
import type { Messages } from './messages.ts';
import type { Edge, ElementRef, Finding, Phase, Rule } from './types.ts';

export interface Validation {
  /** Every finding, block by block in model order. */
  findings: Finding[];
  /** The findings that concern each block: its own, its owned features', and R10 on what it inherits. */
  byBlock: Map<string, Finding[]>;
}

const MISPLACED: Record<Phase, Rule> = { blackbox: 'R6', graybox: 'R8', whitebox: 'R11' };

export function validate(
  facts: Facts, c: Classification, catalog: Catalog, families: Families, edges: Edge[], text: Messages,
): Validation {
  const ref = (id: string): ElementRef => refOf(facts.elements.get(id)!);
  const name = (id: string) => displayName(facts, id) ?? facts.elements.get(id)?.qualifiedName ?? id;
  const orphans = new Set(families.orphans);
  const byBlock = new Map<string, Finding[]>();

  for (const block of c.blocks) {
    const phase = c.typePhase(block)!;
    const target = ref(block);
    const own: Finding[] = [];
    const onFeatures: Finding[] = [];
    const error = (rule: Rule, on: ElementRef, message: string, related?: ElementRef[]): Finding =>
      ({ rule, severity: 'error', target: on, block, message, ...(related ? { related } : {}) });
    const warning = (rule: Rule, on: ElementRef, message: string, related?: ElementRef[]): Finding =>
      ({ ...error(rule, on, message, related), severity: 'warning' });

    if (orphans.has(block) && phase !== 'blackbox') own.push(error(phase === 'graybox' ? 'R1' : 'R2', target, text.orphan(phase)));
    for (const edge of edges) {
      if (edge.kind === 'inPhase' && edge.from === block) {
        own.push(error('R3', target, text.inPhase(name(block), name(edge.to), phase), [ref(edge.to)]));
      }
    }
    for (const cycle of catalog.cycles) {
      if (cycle.members.includes(block)) own.push(error('R4', target, text.cycle(cycle.path.map(name)), cycle.path.map(ref)));
    }

    const unintegrated: string[] = [];
    for (const held of catalog.features.get(block) ?? []) {
      const feature = ref(held.id);
      if (held.inheritedFrom !== null) {
        if (phase === 'whitebox' && held.role === 'subsystem') {
          unintegrated.push(held.id);
          onFeatures.push(warning('R10', feature, text.unintegratedOne(), [target]));
        }
        continue;
      }
      if (held.role === 'misplaced') onFeatures.push(error(MISPLACED[phase], feature, text.misplaced(phase)));
      if (held.role === 'subsystem') {
        if (phase === 'blackbox') onFeatures.push(error('R5', feature, text.blackboxSubsystem()));
        if (phase === 'graybox' && held.phase !== 'blackbox') onFeatures.push(error('R7', feature, text.grayboxSubsystem()));
        if (phase === 'whitebox') onFeatures.push(error('R9', feature, text.realizedWithBlackbox()));   // an owned one redefines
      }
      if (held.alsoRedefines.length && held.redefines !== null) {
        onFeatures.push(warning('R13', feature, text.severalRedefined(name(held.redefines)), [held.redefines, ...held.alsoRedefines].map(ref)));
      }
    }

    if (unintegrated.length) own.push(warning('R10', target, text.unintegrated(unintegrated.map(name)), unintegrated.map(ref)));
    const owned = onFeatures.filter((f) => f.rule !== 'R10');
    if (owned.some((f) => f.severity === 'error')) own.push(error('R12', target, text.featuresWith('error')));
    if (owned.some((f) => f.severity === 'warning')) own.push(warning('R12', target, text.featuresWith('warning')));
    byBlock.set(block, [...own, ...onFeatures]);
  }

  return { findings: [...byBlock.values()].flat(), byBlock };
}
