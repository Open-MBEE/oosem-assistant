// Generation: a request becomes the text of one new unit, or the problems that
// stop it. Writing the text is the caller's job.

import { messages } from './messages.ts';
import { findBlock, findFeature, nameTaken } from './names.ts';
import type { FileCheck } from './names.ts';
import type { Analysis, BlockInfo, FeatureInfo, GenerationRequest, GenerationResult, Phase } from './types.ts';
import { escapeName, escapeQualifiedName, qualify, segments } from './vocabulary.ts';

const INDENT = '    ';
const TODO = '//TODO: Auto-generated block skeleton';

/** Whether a unit exists: the caller's check (the core does no I/O). */
export type UnitCheck = (unit: string) => boolean;

export function generate(
  analysis: Analysis, request: GenerationRequest, checks: { unitExists?: UnitCheck; fileTaken?: FileCheck } = {},
): GenerationResult {
  const text = messages(analysis.vocabulary, analysis.extensions).generation;
  const vocabulary = analysis.vocabulary;
  const problems: string[] = [];
  const folder = request.folder.replace(/\/+$/, '');
  const unit = folder ? `${folder}/${request.name}.sysml` : `${request.name}.sysml`;

  // the subject: a passing blackbox for a graybox, a passing graybox for a whitebox
  const subject = findBlock(analysis, request.subject);
  const wanted: Phase = request.kind === 'graybox' ? 'blackbox' : 'graybox';
  if (!subject) return { ok: false, problems: [text.noBlock(request.subject)] };
  if (subject.phase !== wanted) problems.push(text.wrongSubject(subject.name, wanted));
  const first = analysis.findings.find((f) => f.block === subject.ref.id);
  if (first) problems.push(text.doesNotPass(subject.name, first.message));

  // names: the new block's, and the stubs'
  const blockNames = [request.name];
  const checkName = (name: string) => {
    if (!name.trim()) problems.push(text.emptyName());
    else if (/[/\\]/.test(name)) problems.push(text.badName(name));
    else if (nameTaken(analysis, name, checks.fileTaken)) problems.push(text.nameTaken(name));
  };
  checkName(request.name);
  if (checks.unitExists?.(unit)) problems.push(text.unitExists(unit));

  // the blocks the text names by simple name; each is imported through its owning namespace
  const referenced = new Map<string, BlockInfo>();
  const refer = (block: BlockInfo) => {
    if (block.ref.qualifiedName === null) problems.push(text.noQualifiedName(block.name));
    else referenced.set(block.ref.id, block);
  };
  refer(subject);

  // a whitebox's choices, in the graybox's order of subsystems
  const lines: string[] = [];
  const stubs: { name: string; type: BlockInfo; keyword: string }[] = [];
  if (request.kind === 'graybox' && request.subsystems?.length) problems.push(text.subsystemsForGraybox());
  if (request.kind === 'whitebox') {
    const subsystems = subject.features.filter((f) => f.role === 'subsystem');
    const chosen = new Map<FeatureInfo, NonNullable<GenerationRequest['subsystems']>[number]>();
    for (const entry of request.subsystems ?? []) {
      const usage = findFeature(analysis, entry.usage, subject);
      if (!usage || usage.role !== 'subsystem') problems.push(text.unknownUsage(entry.usage, subject.name));
      else if (chosen.has(usage)) problems.push(text.doubledUsage(nameOf(usage)));
      else chosen.set(usage, entry);
    }
    const newNames = new Set<string>();
    for (const usage of subsystems) {
      const entry = chosen.get(usage);
      if (!entry) { problems.push(text.missingUsage(nameOf(usage))); continue; }
      if ('unintegrated' in entry.choice) continue;
      if (entry.newName !== undefined) {
        if (!entry.newName.trim()) problems.push(text.emptyName());
        else if (newNames.has(entry.newName)) problems.push(text.nameTwice(entry.newName));
        newNames.add(entry.newName);
      }
      const type = usage.types.map((t) => findBlock(analysis, t.id)).find((b) => b?.phase === 'blackbox');
      if (!type) { problems.push(text.untypedUsage(nameOf(usage))); continue; }

      let block: { phase: Phase; name: string };
      if ('realizeWith' in entry.choice) {
        const with_ = findBlock(analysis, entry.choice.realizeWith);
        if (!with_) { problems.push(text.noBlock(entry.choice.realizeWith)); continue; }
        if (with_.phase === 'blackbox' || !specializes(analysis, with_.ref.id, type.ref.id)) {
          problems.push(text.notCandidate(with_.name, nameOf(usage), type.name));
          continue;
        }
        refer(with_);
        block = with_;
      } else {
        const stub = entry.choice.stub;
        checkName(stub);
        if (blockNames.includes(stub)) problems.push(text.nameTwice(stub));
        blockNames.push(stub);
        refer(type);
        stubs.push({ name: stub, type, keyword: kindOf(usage, type) });
        block = { phase: 'graybox', name: stub };
      }
      const name = entry.newName === undefined ? '' : `${escapeName(entry.newName)} `;
      const one = usage.multiplicity?.lower === 0 && usage.multiplicity.upper === 1 ? '[1]' : '';
      lines.push(`#${escapeName(vocabulary[block.phase].keyword)} ${kindOf(usage, type)} ${name}:>> ${spelled(usage)}${one} : ${escapeName(block.name)};`);
    }
  }

  // `{owner}::*`, not `{owner}::{block}`: two single imports from a package that owns a
  // same-named member are unresolved. A top-level block needs no import.
  const owners = new Set<string>();
  for (const b of referenced.values()) {
    const owner = ownerOf(b);
    if (owner !== null) owners.add(owner);
  }
  // each simple name the text uses must name one block among what it sees; new names are
  // checked against every block already (nameTaken)
  const visible = analysis.blocks.filter((b) => b.ref.qualifiedName !== null && (ownerOf(b) === null || owners.has(ownerOf(b)!)));
  for (const name of new Set([...referenced.values()].map((b) => b.name))) {
    const all = visible.filter((b) => b.name === name).map((b) => escapeQualifiedName(b.ref.qualifiedName!));
    if (all.length > 1) problems.push(text.ambiguous(escapeName(name), all));
  }

  if (problems.length) return { ok: false, problems: [...new Set(problems)] };

  const phase = request.kind;
  const body = (lines_: string[]) => [...lines_, TODO].map((l) => `${INDENT}${INDENT}${l}`);
  const out = [
    `package ${escapeName(request.name)} {`,
    `${INDENT}private import ${qualify(vocabulary.root, vocabulary.metadataPackage)}::*;`,
    ...[...owners].map((q) => `${INDENT}private import ${q}::*;`),
    '',
    `${INDENT}#${escapeName(vocabulary[phase].keyword)} ${subject.keyword} def ${escapeName(request.name)} :> ${escapeName(subject.name)} {`,
    ...body(lines),
    `${INDENT}}`,
    ...stubs.flatMap((s) => [
      '',
      `${INDENT}#${escapeName(vocabulary.graybox.keyword)} ${s.keyword} def ${escapeName(s.name)} :> ${escapeName(s.type.name)} {`,
      ...body([]),
      `${INDENT}}`,
    ]),
    '}',
    '',
  ];
  return { ok: true, unit, text: out.join('\n'), newBlocks: blockNames.map((n) => qualify(request.name, n)) };
}

// a block's owning namespace, escaped; null for a top-level block
function ownerOf(block: BlockInfo): string | null {
  const all = segments(escapeQualifiedName(block.ref.qualifiedName ?? ''));
  return all.length > 1 ? all.slice(0, -1).join('::') : null;
}

// the kind a choice line and a stub take: the subsystem usage's; a usage with no kind
// of its own (`x : T;` is a `ref`) takes its type's, as the Eclipse plugin does
function kindOf(usage: FeatureInfo, type: BlockInfo): string {
  return usage.keyword === 'ref' || usage.keyword === '' ? type.keyword : usage.keyword;
}

// a subsystem's name in texts, and as `:>> {usage}` spells it
function nameOf(usage: FeatureInfo): string {
  return usage.name ?? (usage.ref.qualifiedName === null ? '?' : segments(usage.ref.qualifiedName).at(-1)!);
}
function spelled(usage: FeatureInfo): string {
  return usage.name === null ? nameOf(usage) : escapeName(usage.name);
}

// whether a block reaches another through written specializations (the phase and in-phase edges)
function specializes(analysis: Analysis, block: string, ancestor: string): boolean {
  const seen = new Set<string>();
  const todo = [block];
  while (todo.length) {
    const at = todo.pop()!;
    if (at === ancestor) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const e of analysis.edges) if ((e.kind === 'phase' || e.kind === 'inPhase') && e.from === at) todo.push(e.to);
  }
  return false;
}
