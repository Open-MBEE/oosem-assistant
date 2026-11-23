// The analysis graph: edges between blocks, never a tree. Reuse at different
// depths and decomposition cycles are valid; a view stops at a block it has already visited.

import type { Classification } from './classify.ts';
import { refOf } from './facts.ts';
import type { Facts } from './facts.ts';
import type { Catalog } from './features.ts';
import type { Edge } from './types.ts';
import { phaseRank } from './vocabulary.ts';

/** The edges, block by block in model order: specializations first, then decompositions and
 * realizations in the order the block holds its features. */
export function graph(facts: Facts, c: Classification, catalog: Catalog): Edge[] {
  const blocks = new Set(c.blocks);
  const rank = (block: string) => phaseRank(c.typePhase(block)!);
  const edges: Edge[] = [];

  for (const block of c.blocks) {
    for (const parent of catalog.parents.get(block) ?? []) {
      const step = rank(block) - rank(parent);
      if (step === 0) edges.push({ kind: 'inPhase', from: block, to: parent });
      else if (step === 1) edges.push({ kind: 'phase', from: block, to: parent });
    }

    const phase = c.typePhase(block);
    for (const held of catalog.features.get(block) ?? []) {
      // a graybox's subsystem decomposes it into its blackbox types; a whitebox's choice realizes
      // the subsystem with its graybox or whitebox types
      const kind = phase === 'graybox' && held.role === 'subsystem' ? 'decomposes'
        : phase === 'whitebox' && held.role === 'choice' ? 'realizes'
        : null;
      if (kind === null) continue;
      const usage = refOf(facts.features.get(held.id)!);
      for (const type of new Set(facts.features.get(held.id)?.types ?? [])) {
        if (!blocks.has(type)) continue;
        const typePhase = c.typePhase(type);
        if (kind === 'decomposes' ? typePhase === 'blackbox' : typePhase !== 'blackbox') {
          edges.push({ kind, from: block, to: type, usage });
        }
      }
    }
  }
  return edges;
}
