// Test helpers: the test projects, temporary project folders, and the CLI run in-process. Not part of
// the build.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../cli.ts';

export const FIXTURES = fileURLToPath(new URL('../../../../test/fixtures/', import.meta.url));
export const LIBRARY = path.join(FIXTURES, 'library');
export type Project = 'rover' | 'faults' | 'variants';
export const project = (name: Project): string => path.join(FIXTURES, 'projects', name);

/** A fresh folder, removed after the tests, with the given files (path → text). */
export function folder(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oosem-cli-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/** A copy of a test project in a fresh folder. */
export function copyOf(name: Project): string {
  const dir = folder();
  cpSync(project(name), dir, { recursive: true });
  return dir;
}

/** A checkout of a kotar workspace holding the project: `.project-lock.json`, and the library under
 * `libraries/` unless `installed` is false. */
export function kotarWorkspace(name: Project, installed = true): string {
  const dir = copyOf(name);
  for (const file of ['.meta.json', 'sysand.toml', 'sysand-lock.toml', '.project']) rmSync(path.join(dir, file), { force: true });
  writeFileSync(path.join(dir, '.project-lock.json'), JSON.stringify({ 'pkg:sysand/openmbee/oosem-library': { dir: 'openmbee-oosem-library', version: '0.1.0', files: 1 } }));
  if (installed) cpSync(path.join(LIBRARY, 'oosem.sysml'), path.join(dir, 'libraries/openmbee-oosem-library/oosem.sysml'));
  return dir;
}

export interface Ran { code: number; stdout: string; stderr: string }

/** The CLI on these arguments, in-process; `lines` is its stdin. */
export async function oosem(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; lines?: string[] } = {}): Promise<Ran> {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    stdin: async function* () { yield* options.lines ?? []; },
  });
  return { code, stdout, stderr };
}

/** The library's stand-in, and no standard library: the analysis does not need it, and it opens in
 * milliseconds. */
export const withLibrary = ['--library', LIBRARY, '--no-stdlib'];
