// The `oosem` command: arguments, commands and exit codes. `run` does no
// process-wide I/O of its own, so the tests call it directly.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { GenerationRequest, PartialVocabulary } from 'oosem';
import { InputError } from './discover.ts';
import { libraryMissing } from './load.ts';
import { problems } from './schema.ts';
import { serve, settingsOf } from './serve.ts';
import type { ServeOpenParams } from './serve.ts';
import { Session } from './session.ts';
import { dashboardText, findingLine, noticeLines } from './text.ts';

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdin: () => AsyncIterable<string>;   // lines
}

export const USAGE = `usage: oosem <command> [folder] [options]

commands:
  validate                   the findings, one per line (exit 1 when the project's own blocks have errors)
  dashboard                  the dashboard as a tree; with --json, the dashboard model
  analyze                    the analysis, as JSON
  generate --request <file>  a new block's text; with --write, the new file (never overwrites)
  serve --stdio              JSON-RPC 2.0 over stdin and stdout, one message per line

options:
  --source <file|dir>        own files, instead of discovering them (repeatable)
  --library <file|dir>       dependencies, instead of discovering them (repeatable)
  --exclude <glob>           skip matching paths when discovering (repeatable)
  --stdlib <dir>             the standard library's folder; --no-stdlib for none
  --vocabulary <file>        a partial vocabulary, as JSON
  --properties               the properties extension
  --in-phase-specialization  the in-phase specialization extension
  --json                     JSON output (validate, dashboard)

exit codes: 0 done, 1 errors found or generation refused, 2 bad input`;

const OPTIONS = {
  source: { type: 'string', multiple: true },
  library: { type: 'string', multiple: true },
  exclude: { type: 'string', multiple: true },
  stdlib: { type: 'string' },
  'no-stdlib': { type: 'boolean' },
  vocabulary: { type: 'string' },
  properties: { type: 'boolean' },
  'in-phase-specialization': { type: 'boolean' },
  json: { type: 'boolean' },
  request: { type: 'string' },
  write: { type: 'boolean' },
  stdio: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

const COMMANDS = ['validate', 'dashboard', 'analyze', 'generate', 'serve'];

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const out = (lines: string | string[]): void => io.stdout(`${[lines].flat().join('\n')}\n`);
  try {
    const { values: flags, positionals } = parse(argv);
    if (flags.help) {
      out(USAGE);
      return 0;
    }
    const [command, folder, ...extra] = positionals;
    if (!command || !COMMANDS.includes(command)) throw new InputError(command ? `no command ${command}` : 'no command');
    if (extra.length) throw new InputError(`unexpected arguments: ${extra.join(' ')}`);
    if (command === 'serve') {
      if (!flags.stdio) throw new InputError('serve needs --stdio');
      await serve(io.stdin(), (line) => io.stdout(`${line}\n`), io.cwd, io.env);
      return 0;
    }
    if (flags.stdlib && flags['no-stdlib']) throw new InputError('--stdlib and --no-stdlib together');

    const params: ServeOpenParams = {
      ...(folder ? { folder } : {}),
      ...(flags.source ? { source: flags.source } : {}),
      ...(flags.library ? { library: flags.library } : {}),
      ...(flags.exclude ? { exclude: flags.exclude } : {}),
      ...(flags['no-stdlib'] ? { stdlib: false } : flags.stdlib ? { stdlib: flags.stdlib } : {}),
      ...(flags.vocabulary ? { vocabulary: readJson<PartialVocabulary>(io.cwd, flags.vocabulary, 'PartialVocabulary') } : {}),
      ...(flags.properties || flags['in-phase-specialization'] ? {
        extensions: { properties: flags.properties ?? false, inPhaseSpecialization: flags['in-phase-specialization'] ?? false },
      } : {}),
    };
    const request = command === 'generate'
      ? readJson<GenerationRequest>(io.cwd, flags.request ?? fail('generate needs --request <file>'), 'GenerationRequest')
      : null;
    const session = await Session.open(settingsOf(params, io.cwd, io.env));
    if (!session.analysis.libraryFound) throw new InputError(libraryMissing(session.analysis));

    switch (command) {
      case 'validate': {
        const report = session.validation();
        if (flags.json) out(JSON.stringify(report, null, 2));
        else {
          const lines = [...report.findings.map(findingLine), ...noticeLines(session.dashboard().notice)];
          if (lines.length) out(lines);
        }
        // other libraries' blocks are shown, but their errors are not the project's
        const library = new Set(session.analysis.blocks.filter((b) => b.library).map((b) => b.ref.id));
        return report.findings.some((f) => f.severity === 'error' && !library.has(f.block)) ? 1 : 0;
      }
      case 'dashboard':
        out(flags.json ? JSON.stringify(session.dashboard(), null, 2) : dashboardText(session.dashboard()));
        return 0;
      case 'analyze':
        out(JSON.stringify(session.analysis, null, 2));
        return 0;
      default: {
        const { generation, written } = session.generate(request!, flags.write ?? false);
        if (flags.json) out(JSON.stringify(generation, null, 2));
        else if (!generation.ok) io.stderr(`${generation.problems.map((p) => `oosem: ${p}`).join('\n')}\n`);
        else if (written) out(written);
        else io.stdout(generation.text);
        return generation.ok ? 0 : 1;
      }
    }
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    io.stderr(`oosem: ${e.message}\n`);
    return 2;
  }
}

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    throw new InputError(`${(e as Error).message}\n${USAGE}`);
  }
}

/** A JSON file that must conform to one of the schema's definitions. */
function readJson<T>(cwd: string, file: string, definition: string): T {
  const p = path.resolve(cwd, file);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new InputError(`cannot read ${file}: ${(e as Error).message}`);
  }
  const wrong = problems(definition, value);
  if (wrong.length) throw new InputError(`${file} is not a ${definition}: ${wrong.join('; ')}`);
  return value as T;
}

function fail(message: string): never {
  throw new InputError(message);
}
