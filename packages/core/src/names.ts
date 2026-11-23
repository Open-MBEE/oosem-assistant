// Default names: `{base}{suffix}{n}`, the next phase's suffix
// swapped in, and the next free number when the default is taken. Defaults are prefills only.

import type { Analysis, BlockInfo, FeatureInfo, Phase, Vocabulary } from './types.ts';
import { PHASES, segments } from './vocabulary.ts';

/** Whether a name is taken outside the model: the caller's check for a file `{name}.sysml` in the
 * chosen folder (the core does no I/O). */
export type FileCheck = (name: string) => boolean;

/** A name read as `{base}{suffix}{n}`; phase and n are null when it has no suffix or number. */
export function parseName(name: string, vocabulary: Vocabulary): { base: string; phase: Phase | null; n: number | null } {
  for (const phase of PHASES) {
    const suffix = vocabulary[phase].suffix;
    if (!suffix) continue;
    const match = name.match(new RegExp(`^(.*)${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d*)$`));
    if (match && match[1]) return { base: match[1], phase, n: match[2] ? Number(match[2]) : null };
  }
  return { base: name, phase: null, n: null };
}

/** A block by id or qualified name. */
export function findBlock(analysis: Analysis, block: string): BlockInfo | undefined {
  return analysis.blocks.find((b) => b.ref.id === block) ?? analysis.blocks.find((b) => b.ref.qualifiedName === block);
}

/** A feature some block holds, by id or qualified name, with the block. */
export function findFeature(analysis: Analysis, feature: string, holder?: BlockInfo): FeatureInfo | undefined {
  const among = holder ? [holder] : analysis.blocks;
  for (const by of [(f: FeatureInfo) => f.ref.id === feature, (f: FeatureInfo) => f.ref.qualifiedName === feature]) {
    for (const b of among) {
      const found = b.features.find(by);
      if (found) return found;
    }
  }
  return undefined;
}

/** Whether a block with that simple name exists in the model, or the caller knows the name as taken. */
export function nameTaken(analysis: Analysis, name: string, fileTaken?: FileCheck): boolean {
  return analysis.blocks.some((b) => b.name === name) || (fileTaken?.(name) ?? false);
}

/**
 * The default name for a new graybox of a blackbox, a new whitebox of a graybox, or a new graybox
 * stub for a subsystem usage (derived from the usage's type). `of` is the block, or for a stub the
 * usage, by id or qualified name.
 */
export function defaultName(analysis: Analysis, kind: 'graybox' | 'whitebox' | 'stub', of: string, fileTaken?: FileCheck): string {
  let from: string | undefined;
  if (kind === 'stub') {
    const usage = findFeature(analysis, of);
    const type = usage?.types[0];
    from = type && (findBlock(analysis, type.id)?.name ?? (type.qualifiedName === null ? undefined : segments(type.qualifiedName).at(-1)));
  } else {
    from = findBlock(analysis, of)?.name;
  }
  if (from === undefined) throw new RangeError(`defaultName: nothing to name after: ${of}`);

  const { base, n } = parseName(from, analysis.vocabulary);
  const suffix = analysis.vocabulary[kind === 'whitebox' ? 'whitebox' : 'graybox'].suffix;
  const first = `${base}${suffix}${n ?? ''}`;
  if (!nameTaken(analysis, first, fileTaken)) return first;
  for (let i = n === null ? 2 : n + 1; ; i++) {
    const next = `${base}${suffix}${i}`;
    if (!nameTaken(analysis, next, fileTaken)) return next;
  }
}
