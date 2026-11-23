// Opening the model and analyzing it: the SysML Toolkit through the SDK, with the
// standard library unless told otherwise. The toolkit reports no diagnostics, so when a model
// does not load, each file is opened alone to name the ones that do not parse.

import { readFileSync } from 'node:fs';
import { LIBRARY_RESOURCE, analyze } from 'oosem';
import type { Analysis, Extensions, PartialVocabulary } from 'oosem';
import { Model, ToolkitBackend, ToolkitError, standardLibrary } from 'sysml';
import { InputError } from './discover.ts';
import type { Inputs, SourceFile } from './discover.ts';

export interface LoadOptions {
  stdlib?: string | false;   // the standard library's folder; false for none; the SDK's by default
  vocabulary?: PartialVocabulary;
  extensions?: Partial<Extensions>;
}

export async function open(inputs: Inputs, options: LoadOptions = {}): Promise<Model> {
  const files = [...inputs.sources, ...inputs.libraries];
  const sources = Object.fromEntries(files.map((f) => [f.unit, read(f)]));
  const libraryDir = options.stdlib === false ? undefined : (options.stdlib ?? (await standardLibrary()));
  try {
    return new Model(await ToolkitBackend.open({ sources, ...(libraryDir ? { libraryDir } : {}) }));
  } catch (e) {
    if (!(e instanceof ToolkitError)) throw e;
    const broken: string[] = [];
    for (const [unit, text] of Object.entries(sources)) {
      try {
        (await ToolkitBackend.open({ sources: { [unit]: text } })).close();
      } catch {
        broken.push(unit);
      }
    }
    throw new InputError(broken.length
      ? `the model does not load: ${broken.join(', ')} ${broken.length === 1 ? 'does' : 'do'} not parse`
      : `the model does not load (${e.message})`);
  }
}

/** The analysis; without the method library in the model, bad input that says how to add it. */
export async function load(inputs: Inputs, options: LoadOptions = {}): Promise<Analysis> {
  const model = await open(inputs, options);
  return analyze(model, {
    ...(options.vocabulary ? { vocabulary: options.vocabulary } : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
  });
}

export function libraryMissing(analysis: Analysis): string {
  return `the OOSEM method library is not in the model (no package ${analysis.vocabulary.root}): add it as a `
    + `dependency (\`sysand add ${LIBRARY_RESOURCE}\`, or Dependencies › Add… in kotar), or pass --library <dir>`;
}

function read(file: SourceFile): string {
  try {
    return readFileSync(file.path, 'utf8');
  } catch (e) {
    throw new InputError(`cannot read ${file.path}: ${(e as Error).message}`);
  }
}
