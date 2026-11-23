// Test helpers: models of inline fixtures and of the test projects. Not part of the build.

import { readdirSync, readFileSync } from 'node:fs';
import { Model, ToolkitBackend, standardLibrary } from 'sysml';

const FIXTURES = new URL('../../../../test/fixtures/', import.meta.url);

/** The method library's stand-in, as kotar names a dependency unit. */
export const LIBRARY_UNIT = 'libraries/oosem/oosem.sysml';
export const librarySource = (): string => readFileSync(new URL('library/oosem.sysml', FIXTURES), 'utf8');

/** A model of the sources, with the method library as a unit. Without the standard library, which
 * the core never needs, a fixture opens in milliseconds; names a feature takes from the standard
 * library are then missing. */
export async function openModel(
  sources: Record<string, string>,
  options: { library?: boolean; stdlib?: boolean } = {},
): Promise<Model> {
  const all = options.library === false ? sources : { ...sources, [LIBRARY_UNIT]: librarySource() };
  const backend = await ToolkitBackend.open({
    sources: all,
    ...(options.stdlib ? { libraryDir: await standardLibrary() } : {}),
  });
  return new Model(backend);
}

/** One fixture unit, `a.sysml`, importing the library's metadata. */
export const fixture = (text: string, options?: { library?: boolean; stdlib?: boolean }): Promise<Model> =>
  openModel({ 'a.sysml': `private import RecursiveDecompositionPattern::Metadata::*;\n${text}` }, options);

/** A test project's units, by file name, sorted. */
export function projectSources(name: 'rover' | 'faults' | 'variants'): Record<string, string> {
  const dir = new URL(`projects/${name}/`, FIXTURES);
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.sysml')).sort()
    .map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]));
}
