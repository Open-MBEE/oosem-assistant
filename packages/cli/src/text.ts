// The CLI's text output: findings one per line, and the dashboard as an indented tree.
// Elements are named by qualified name; the SDK gives no source positions.

import type { DashboardBlock, DashboardLine, DashboardModel, ElementRef, Finding } from 'oosem';

const name = (ref: ElementRef): string => ref.qualifiedName ?? ref.id;

/** `{element}: {severity}: {message} [{rule}]`. */
export const findingLine = (f: Finding): string => `${name(f.target)}: ${f.severity}: ${f.message} [${f.rule}]`;

/** The usage-style notice, with the usages it is about. */
export const noticeLines = (notice: DashboardModel['notice']): string[] =>
  notice ? [`note: ${notice.message}`, ...notice.usages.map((u) => `  ${name(u)}`)] : [];

const LINE: Record<DashboardLine['kind'], (text: string) => string> = {
  usedIn: (text) => `used in ${text}`,
  subsystem: (text) => text,
  choice: (text) => text,
  unintegrated: (text) => `unintegrated: ${text}`,
};

export function dashboardText(model: DashboardModel): string[] {
  const out: string[] = [];
  const block = (b: DashboardBlock, indent: string): void => {
    out.push(`${indent}${b.name}${b.library ? ' (library)' : ''}`);
    const inner = `${indent}  `;
    for (const message of b.errors) out.push(`${inner}error: ${message}`);
    for (const message of b.warnings) out.push(`${inner}warning: ${message}`);
    for (const line of b.lines) out.push(`${inner}${LINE[line.kind](line.text)}${line.inherited && line.kind !== 'unintegrated' ? ' (inherited)' : ''}`);
    if (b.untracked) out.push(`${inner}${b.untracked} untracked feature${b.untracked === 1 ? '' : 's'}`);
  };
  for (const column of model.columns) {
    out.push(column.label);
    for (const group of column.groups) {
      if (!group.rows.length && group.orphans) continue;
      const indent = group.title === null ? '  ' : '    ';
      if (group.title !== null) out.push(`  ${group.title}`);
      for (const id of group.rows) {
        const b = model.blocks[id];
        if (b) block(b, indent);
      }
    }
  }
  out.push(...noticeLines(model.notice));
  return out;
}
