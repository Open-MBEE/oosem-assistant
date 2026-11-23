// The core's API. No I/O, no Node APIs, no DOM; every output is plain JSON.

import type { Model } from 'sysml';
import { classify } from './classify.ts';
import { mergeExtensions } from './extensions.ts';
import { displayName, keywordOf, readFacts, refOf } from './facts.ts';
import type { Facts } from './facts.ts';
import { blockFamilies } from './families.ts';
import { catalog } from './features.ts';
import { graph } from './graph.ts';
import { messages } from './messages.ts';
import { usageStyleBoxes } from './notice.ts';
import type { Analysis, BlockInfo, Extensions, PartialVocabulary } from './types.ts';
import { validate } from './validate.ts';
import { mergeVocabulary } from './vocabulary.ts';

export type * from './types.ts';
export { dashboard } from './dashboard.ts';
export { DEFAULT_EXTENSIONS, mergeExtensions } from './extensions.ts';
export { generate } from './generate.ts';
export { defaultName } from './names.ts';
export { DEFAULT_VOCABULARY, LIBRARY_RESOURCE, escapeName, mergeVocabulary } from './vocabulary.ts';

export interface AnalysisOptions {
  vocabulary?: PartialVocabulary;
  extensions?: Partial<Extensions>;  // both off by default
}

/** The analysis of a model: blocks and their features, the graph, findings, and the usage-style boxes. */
export function analyze(model: Model, options: AnalysisOptions = {}): Analysis {
  return analyzeFacts(readFacts(model), options);
}

/** The analysis of facts already read. */
export function analyzeFacts(facts: Facts, options: AnalysisOptions = {}): Analysis {
  const vocabulary = mergeVocabulary(options.vocabulary);
  const extensions = mergeExtensions(options.extensions);
  const c = classify(facts, vocabulary);
  const k = catalog(facts, c, extensions);
  const edges = graph(facts, c, k);
  const validation = validate(facts, c, k, blockFamilies(c, k), edges, messages(vocabulary, extensions));

  const ref = (id: string) => refOf(facts.elements.get(id)!);
  const blocks = c.blocks.map((id): BlockInfo => {
    const fact = facts.types.get(id)!;
    return {
      ref: refOf(fact),
      name: fact.name ?? '',
      keyword: keywordOf(fact.metaclass),
      phase: c.typePhase(id)!,
      library: fact.library,
      passes: (validation.byBlock.get(id) ?? []).length === 0,
      features: (k.features.get(id) ?? []).map((held) => {
        const feature = facts.features.get(held.id)!;
        return {
          ref: refOf(feature),
          name: displayName(facts, held.id),
          keyword: keywordOf(feature.metaclass),
          role: held.role,
          phase: held.phase,
          types: feature.types.map(ref),
          redefines: held.redefines === null ? null : ref(held.redefines),
          inheritedFrom: held.inheritedFrom,
          multiplicity: feature.multiplicity,
        };
      }),
    };
  });

  return {
    schemaVersion: 1,
    vocabulary,
    extensions,
    libraryFound: c.libraryFound,
    blocks,
    edges,
    findings: validation.findings,
    usageStyleBoxes: usageStyleBoxes(facts, c),
  };
}
