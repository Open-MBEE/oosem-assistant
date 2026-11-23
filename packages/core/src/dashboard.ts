// The dashboard model: columns, groups, rows and their lines,
// from the analysis alone. Selection, highlighting and the "Show" menu are the UI's.

import { families } from './families.ts';
import { messages } from './messages.ts';
import type {
  Analysis, BlockInfo, DashboardBlock, DashboardColumn, DashboardGroup, DashboardLine, DashboardModel, ElementRef, FeatureInfo,
} from './types.ts';
import { segments } from './vocabulary.ts';

export function dashboard(analysis: Analysis): DashboardModel {
  const text = messages(analysis.vocabulary, analysis.extensions);
  const blocks = new Map(analysis.blocks.map((b) => [b.ref.id, b]));
  const names = new Map<string, string>();     // every feature a block owns, by id
  for (const b of analysis.blocks) for (const f of b.features) if (f.inheritedFrom === null && f.name !== null) names.set(f.ref.id, f.name);
  const nameOf = (ref: ElementRef) => blocks.get(ref.id)?.name ?? names.get(ref.id) ?? lastSegment(ref.qualifiedName);
  const typeNames = (f: FeatureInfo) => f.types.map(nameOf).join(', ');
  const featureName = (f: FeatureInfo) => f.name ?? lastSegment(f.ref.qualifiedName);
  const target = (f: FeatureInfo) => f.types.find((t) => blocks.has(t.id))?.id ?? null;

  // the grouping, over the specialization edges, which keep the written order of supertypes
  const supertypes = new Map<string, string[]>();
  for (const e of analysis.edges) {
    if (e.kind === 'phase' || e.kind === 'inPhase') supertypes.set(e.from, [...(supertypes.get(e.from) ?? []), e.to]);
  }
  const fam = families(analysis.blocks.map((b) => ({ id: b.ref.id, phase: b.phase })), (b) => supertypes.get(b) ?? []);

  const ofPhase = (phase: BlockInfo['phase']) => analysis.blocks.filter((b) => b.phase === phase).map((b) => b.ref.id);
  const column = (phase: 'graybox' | 'whitebox'): DashboardColumn => {
    const before = phase === 'graybox' ? 'blackbox' : 'graybox';
    const groups: DashboardGroup[] = ofPhase(before)
      .filter((parent) => fam.children.get(parent)?.length)
      .map((parent) => ({ title: text.group(phase, blocks.get(parent)!.name), parent, orphans: false, rows: fam.children.get(parent)! }));
    const orphans = fam.orphans.filter((b) => blocks.get(b)?.phase === phase);
    groups.push({ title: text.orphans(phase), parent: null, orphans: true, rows: orphans });
    return { phase, label: text.column(phase), groups };
  };
  const columns: DashboardModel['columns'] = [
    { phase: 'blackbox', label: text.column('blackbox'), groups: [{ title: null, parent: null, orphans: false, rows: ofPhase('blackbox') }] },
    column('graybox'),
    column('whitebox'),
  ];

  // "Used in" lines: each graybox's subsystem typed by a blackbox, in model order
  const usedIn = new Map<string, DashboardLine[]>();
  for (const e of analysis.edges) {
    if (e.kind !== 'decomposes' || !e.usage) continue;
    const graybox = blocks.get(e.from)!;
    const feature = graybox.features.find((f) => f.ref.id === e.usage!.id);
    const line: DashboardLine = {
      kind: 'usedIn', text: `${graybox.name}.${feature ? featureName(feature) : nameOf(e.usage)}`, usage: e.usage,
      owner: e.from, target: e.from, redefines: null, inherited: feature?.inheritedFrom != null,
    };
    usedIn.set(e.to, [...(usedIn.get(e.to) ?? []), line]);
  }

  const findingsOf = new Map<string, Analysis['findings']>();
  for (const f of analysis.findings) findingsOf.set(f.block, [...(findingsOf.get(f.block) ?? []), f]);

  const rows: Record<string, DashboardBlock> = {};
  for (const b of analysis.blocks) {
    const line = (kind: DashboardLine['kind'], f: FeatureInfo, lineText: string): DashboardLine => ({
      kind, text: lineText, usage: f.ref, owner: b.ref.id, target: target(f), redefines: f.redefines, inherited: f.inheritedFrom !== null,
    });
    const lines: DashboardLine[] = [];
    if (b.phase === 'blackbox') lines.push(...(usedIn.get(b.ref.id) ?? []));
    if (b.phase === 'graybox') {
      for (const f of b.features) if (f.role === 'subsystem') lines.push(line('subsystem', f, `${featureName(f)} : ${typeNames(f)}`));
    }
    if (b.phase === 'whitebox') {
      for (const f of b.features) {
        if (f.role === 'choice') lines.push(line('choice', f, `${featureName(f)} :>> ${f.redefines ? nameOf(f.redefines) : '?'} : ${typeNames(f)}`));
      }
      for (const f of b.features) {
        if (f.role === 'subsystem' && f.inheritedFrom !== null) lines.push(line('unintegrated', f, `${featureName(f)} : ${typeNames(f)}`));
      }
    }

    // the tooltip's messages: R12 only repeats that the features' messages follow
    const messagesOf = (severity: 'error' | 'warning') => [...new Set((findingsOf.get(b.ref.id) ?? [])
      .filter((f) => f.severity === severity && f.rule !== 'R12').map((f) => f.message))];
    rows[b.ref.id] = {
      ref: b.ref, name: b.name, phase: b.phase, library: b.library,
      errors: messagesOf('error'), warnings: messagesOf('warning'), lines,
      untracked: b.features.filter((f) => f.role === 'untracked' || f.role === 'misplaced').length,
    };
  }

  const usages = analysis.usageStyleBoxes;
  return {
    schemaVersion: 1,
    libraryFound: analysis.libraryFound,
    columns,
    blocks: rows,
    notice: usages.length ? { message: text.notice(usages.length), usages } : null,
  };
}

// the last segment of a qualified name as written
function lastSegment(qualifiedName: string | null): string {
  return (qualifiedName === null ? undefined : segments(qualifiedName).at(-1)) ?? '?';
}
