// Usage-style boxes: a notice, not findings. This version does not analyze them.

import type { Classification } from './classify.ts';
import { refOf } from './facts.ts';
import type { Facts } from './facts.ts';
import type { ElementRef } from './types.ts';

/** The usages, in model order, that carry a phase themselves (owned phase metadata) or explicitly
 * subset a vocabulary collection, and that no block owns. Marked usages inside blocks are their
 * subsystems and choices; the method library's own are left out. */
export function usageStyleBoxes(facts: Facts, c: Classification): ElementRef[] {
  const blocks = new Set(c.blocks);
  return [...facts.features.values()]
    .filter((f) => f.usage && !(f.owner !== null && blocks.has(f.owner)) && !c.inRoot(f.id))
    .filter((f) => c.metadataPhase(f.id) !== null || c.collectionPhase(f.id) !== null)
    .map(refOf);
}
