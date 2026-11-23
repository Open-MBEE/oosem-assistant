// Grouping and orphans. A graybox belongs to each nearest blackbox, a whitebox
// to each nearest graybox: walk the written block supertypes, through blocks of the block's own
// phase, and stop at the first block of the phase before on each path.

import type { Classification } from './classify.ts';
import type { Catalog } from './features.ts';
import type { Phase } from './types.ts';

export interface Families {
  /** A graybox's or whitebox's nearest blocks of the phase before, in the order the walk meets them. */
  parents: Map<string, string[]>;
  /** Each blackbox's and graybox's blocks of the next phase, in model order. */
  children: Map<string, string[]>;
  /** The grayboxes that reach no blackbox and the whiteboxes that reach no graybox (R1, R2), in model order. */
  orphans: string[];
}

const BEFORE: Partial<Record<Phase, Phase>> = { graybox: 'blackbox', whitebox: 'graybox' };

/** The families of the blocks, given in model order with their phases, over their direct written
 * block supertypes. */
export function families(blocks: { id: string; phase: Phase }[], supertypes: (block: string) => readonly string[]): Families {
  const phaseOf = new Map(blocks.map((b) => [b.id, b.phase]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>(blocks.filter((b) => b.phase !== 'whitebox').map((b) => [b.id, []]));
  const orphans: string[] = [];

  for (const { id: block, phase } of blocks) {
    const before = BEFORE[phase];
    if (!before) continue;
    const found: string[] = [];
    const seen = new Set([block]);
    const walk = (at: string) => {
      for (const parent of supertypes(at)) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        const parentPhase = phaseOf.get(parent);
        if (parentPhase === before) found.push(parent);
        else if (parentPhase === phase) walk(parent);
      }
    };
    walk(block);
    parents.set(block, found);
    if (found.length === 0) orphans.push(block);
    for (const parent of found) children.get(parent)!.push(block);
  }
  return { parents, children, orphans };
}

/** The families of the classified blocks, over the catalog's supertypes. */
export function blockFamilies(c: Classification, catalog: Catalog): Families {
  return families(c.blocks.map((id) => ({ id, phase: c.typePhase(id)! })), (block) => catalog.parents.get(block) ?? []);
}
