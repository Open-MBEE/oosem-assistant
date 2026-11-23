// The method's extensions beyond plain OOSEM. Off, the analysis follows plain OOSEM.

import type { Extensions } from './types.ts';

export const DEFAULT_EXTENSIONS: Extensions = { properties: false, inPhaseSpecialization: false };

/** The extensions with the given keys over the defaults. */
export function mergeExtensions(partial: Partial<Extensions> = {}): Extensions {
  return {
    properties: partial.properties ?? DEFAULT_EXTENSIONS.properties,
    inPhaseSpecialization: partial.inPhaseSpecialization ?? DEFAULT_EXTENSIONS.inPhaseSpecialization,
  };
}
