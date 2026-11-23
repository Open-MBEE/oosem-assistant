// The method library's names. Nothing else in the core spells a library name.

import type { PartialVocabulary, Phase, PhaseNames, Vocabulary } from './types.ts';

export const PHASES: readonly Phase[] = ['blackbox', 'graybox', 'whitebox'];

/** The method library's Sysand id, which a project declares as a dependency. A placeholder until
 * the library is published; also the default of kotar's `oosem.libraryResource`. */
export const LIBRARY_RESOURCE = 'pkg:sysand/openmbee/oosem-library';

export const DEFAULT_VOCABULARY: Vocabulary = {
  root: 'RecursiveDecompositionPattern',
  conceptsPackage: 'Concepts',
  metadataPackage: 'Metadata',
  blackbox: {
    concept: 'Blackbox', collection: 'blackboxes', metadata: 'BlackboxMetadata',
    keyword: 'blackbox', suffix: '_bb', label: 'Blackbox',
  },
  graybox: {
    concept: 'Graybox', collection: 'grayboxes', metadata: 'GrayboxMetadata',
    keyword: 'graybox', suffix: '_gb', label: 'Graybox',
  },
  whitebox: {
    concept: 'Whitebox', collection: 'whiteboxes', metadata: 'WhiteboxMetadata',
    keyword: 'whitebox', suffix: '_wb', label: 'Whitebox',
  },
};

/** The vocabulary with the given keys over the defaults. */
export function mergeVocabulary(partial: PartialVocabulary = {}): Vocabulary {
  const phase = (p: Phase): PhaseNames => ({ ...DEFAULT_VOCABULARY[p], ...partial[p] });
  return {
    root: partial.root ?? DEFAULT_VOCABULARY.root,
    conceptsPackage: partial.conceptsPackage ?? DEFAULT_VOCABULARY.conceptsPackage,
    metadataPackage: partial.metadataPackage ?? DEFAULT_VOCABULARY.metadataPackage,
    blackbox: phase('blackbox'),
    graybox: phase('graybox'),
    whitebox: phase('whitebox'),
  };
}

// SysML v2's reserved words: a name spelled like one must be quoted
const RESERVED = new Set(`about abstract accept action actor after alias all allocate allocation
  analysis and as assert assign assume at attribute bind binding by calc case comment concern
  connect connection constant constraint crosses decide def default defined dependency derived do
  doc else end entry enum event exhibit exit expose false filter first flow for fork frame from
  hastype if implies import in include individual inout interface istype item join language
  library locale loop merge message meta metadata new nonunique not null objective occurrence of
  or ordered out package parallel part perform port private protected public redefines ref
  references render rendering rep require requirement return satisfy send snapshot specializes
  stakeholder standard state subject subsets succession terminate then timeslice to transition
  true until use variant variation verification verify via view viewpoint when while xor`.split(/\s+/));

const BASIC_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ESCAPES: Record<string, string> = { '\\': '\\\\', "'": "\\'", '\b': '\\b', '\f': '\\f', '\t': '\\t', '\n': '\\n', '\r': '\\r' };

/** A name as KerML's `escapedName` spells it: a basic name as it is, any other in single quotes,
 * with its special characters escaped. */
export function escapeName(name: string): string {
  if (BASIC_NAME.test(name) && !RESERVED.has(name)) return name;
  return `'${name.replace(/[\\'\b\f\t\n\r]/g, (c) => ESCAPES[c] ?? c)}'`;
}

/** A qualified name from unescaped segments. */
export function qualify(...segments: string[]): string {
  return segments.map(escapeName).join('::');
}

/** A qualified name's segments as written, quotes kept: `A::'b::c'::d` → ['A', "'b::c'", 'd']. */
export function segments(qualifiedName: string): string[] {
  const found: string[] = [];
  let start = 0;
  for (let i = 0; i < qualifiedName.length; i++) {
    const c = qualifiedName[i];
    if (c === "'") {
      for (i++; i < qualifiedName.length && qualifiedName[i] !== "'"; i++) if (qualifiedName[i] === '\\') i++;
    } else if (c === ':' && qualifiedName[i + 1] === ':') {
      found.push(qualifiedName.slice(start, i));
      start = ++i + 1;
    }
  }
  found.push(qualifiedName.slice(start));
  return found;
}

/** A qualified name with every segment escaped. The SysML Toolkit leaves a reserved word bare
 * (`P::part`), which text we generate must quote. */
export function escapeQualifiedName(qualifiedName: string): string {
  return segments(qualifiedName).map((s) => (s.startsWith("'") ? s : escapeName(s))).join('::');
}

/** The qualified names of the library's elements for one phase. */
export function phaseQualifiedNames(vocabulary: Vocabulary, phase: Phase) {
  const names = vocabulary[phase];
  return {
    concept: qualify(vocabulary.root, vocabulary.conceptsPackage, names.concept),
    collection: qualify(vocabulary.root, vocabulary.conceptsPackage, names.collection),
    metadata: qualify(vocabulary.root, vocabulary.metadataPackage, names.metadata),
  };
}

/** Phases are ordered blackbox < graybox < whitebox; the index of each. */
export function phaseRank(phase: Phase): number {
  return PHASES.indexOf(phase);
}
