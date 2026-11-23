// The English UI texts of findings, the dashboard and generation, in one place. Phase words come
// from the vocabulary's labels; texts that mention properties depend on that extension.

import type { Extensions, Phase, Vocabulary } from './types.ts';

export interface Messages {
  orphan(phase: 'graybox' | 'whitebox'): string;                              // R1, R2
  inPhase(block: string, parent: string, phase: Phase): string;              // R3
  cycle(path: string[]): string;                                              // R4
  blackboxSubsystem(): string;                                                // R5
  misplaced(phase: Phase): string;                                            // R6, R8, R11
  grayboxSubsystem(): string;                                                 // R7
  realizedWithBlackbox(): string;                                             // R9
  unintegrated(names: string[]): string;                                      // R10, on the block
  unintegratedOne(): string;                                                  // R10, on each feature
  featuresWith(severity: 'error' | 'warning'): string;                        // R12
  severalRedefined(tracked: string): string;                                  // R13
  column(phase: Phase): string;                                               // 'Blackbox'
  group(phase: 'graybox' | 'whitebox', parent: string): string;              // 'Grayboxes of Quadcopter_bb'
  orphans(phase: 'graybox' | 'whitebox'): string;                            // 'Orphan grayboxes'
  notice(count: number): string;                                              // the usage-style boxes
  generation: {                                                               // a request's problems
    noBlock(name: string): string;
    wrongSubject(name: string, phase: Phase): string;
    doesNotPass(name: string, first: string): string;
    emptyName(): string;
    badName(name: string): string;
    nameTaken(name: string): string;
    nameTwice(name: string): string;
    unitExists(unit: string): string;
    noQualifiedName(name: string): string;
    ambiguous(name: string, qualifiedNames: string[]): string;
    subsystemsForGraybox(): string;
    unknownUsage(usage: string, graybox: string): string;
    missingUsage(usage: string): string;
    doubledUsage(usage: string): string;
    untypedUsage(usage: string): string;
    notCandidate(block: string, usage: string, type: string): string;
  };
}

export function messages(vocabulary: Vocabulary, extensions: Extensions): Messages {
  // 'blackbox' from the label 'Blackbox'; articles and plurals follow a renamed label
  const label = (phase: Phase) => vocabulary[phase].label.charAt(0).toLowerCase() + vocabulary[phase].label.slice(1);
  const a = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
  const A = (word: string) => a(word).replace(/^a/, 'A');
  const plural = (word: string) => (/(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);
  const [bb, gb, wb] = [label('blackbox'), label('graybox'), label('whitebox')];
  const properties = (phase: Phase) => (extensions.properties ? `${label(phase)} properties, ` : '');

  return {
    orphan: (phase) => `Orphan ${label(phase)}: it specializes no ${phase === 'graybox' ? bb : gb}.`,
    inPhase: (block, parent, phase) => extensions.inPhaseSpecialization
      ? `In-phase specialization is not supported yet: ${block} specializes ${parent}, another ${label(phase)}.`
      : `In-phase specialization is not part of OOSEM: ${block} specializes ${parent}, another ${label(phase)}.`,
    cycle: (path) => `Specialization cycle: ${[...path, path[0]].join(' → ')}.`,
    blackboxSubsystem: () => `${A(bb)} can't have subsystems.`,
    misplaced: (phase) => {
      switch (phase) {
        case 'blackbox': return `${A(bb)} can only contain ${extensions.properties ? `${bb} properties and ` : ''}untracked features.`;
        case 'graybox': return `${A(gb)} can only contain ${properties('graybox')}${bb} subsystems and untracked features.`;
        case 'whitebox': return `${A(wb)} can only contain ${properties('whitebox')}${gb} or ${wb} subsystems and untracked features.`;
      }
    },
    grayboxSubsystem: () => `${A(gb)}'s subsystems must be ${plural(bb)}.`,
    realizedWithBlackbox: () => `${A(wb)} must realize a subsystem with ${a(gb)} or ${a(wb)}, not ${a(bb)}.`,
    unintegrated: (names) => `Unintegrated subsystems: ${names.join(', ')}.`,
    unintegratedOne: () => 'Unintegrated subsystem.',
    featuresWith: (severity) => (severity === 'error' ? 'Has features with errors.' : 'Has features with warnings.'),
    severalRedefined: (tracked) => `Redefines several tracked features; only ${tracked} is tracked.`,
    column: (phase) => vocabulary[phase].label,
    group: (phase, parent) => `${plural(vocabulary[phase].label)} of ${parent}`,
    orphans: (phase) => `Orphan ${plural(label(phase))}`,
    notice: (count) => (count === 1
      ? '1 usage is marked as a box outside any definition. Usage-based boxes come in a later phase.'
      : `${count} usages are marked as boxes outside any definition. Usage-based boxes come in a later phase.`),
    generation: {
      noBlock: (name) => `No block ${name} in the model.`,
      wrongSubject: (name, phase) => `${name} is not ${a(label(phase))}.`,
      doesNotPass: (name, first) => `${name} has problems to fix first: ${first}`,
      emptyName: () => 'A name is empty.',
      badName: (name) => `${name} can't be a file name: it contains / or \\.`,
      nameTaken: (name) => `${name} is taken: a block or a file of that name exists.`,
      nameTwice: (name) => `The name ${name} is given twice.`,
      unitExists: (unit) => `${unit} already exists.`,
      noQualifiedName: (name) => `${name} has no qualified name: an owner is unnamed, or a name is not unique.`,
      ambiguous: (name, qualifiedNames) => `Two blocks named ${name} would be imported: ${qualifiedNames.join(', ')}.`,
      subsystemsForGraybox: () => `Only a new ${wb} chooses for subsystems.`,
      unknownUsage: (usage, graybox) => `${usage} is not a subsystem of ${graybox}.`,
      missingUsage: (usage) => `No choice for the subsystem ${usage}.`,
      doubledUsage: (usage) => `More than one choice for the subsystem ${usage}.`,
      untypedUsage: (usage) => `The subsystem ${usage} has no ${bb} type to realize or stub.`,
      notCandidate: (block, usage, type) => `${block} can't realize ${usage}: it is no ${gb} or ${wb} of ${type}.`,
    },
  };
}
