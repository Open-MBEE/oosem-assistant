// `oosem serve --stdio`: JSON-RPC 2.0, one message per line. Requests
// are answered in order, one at a time. Params are checked against the schema's Serve… definitions.

import path from 'node:path';
import type { Extensions, GenerationRequest, PartialVocabulary } from 'oosem';
import { InputError } from './discover.ts';
import { problems } from './schema.ts';
import { Session } from './session.ts';
import type { Settings } from './session.ts';

type Id = string | number | null;

export interface ServeOpenParams {
  folder?: string;
  source?: string[];
  library?: string[];
  exclude?: string[];
  stdlib?: string | false;
  vocabulary?: PartialVocabulary;
  extensions?: Partial<Extensions>;
}

/** A failure with its JSON-RPC error code. */
class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const PARAMS: Record<string, string | null> = {
  open: 'ServeOpenParams', reload: null, analyze: null, validate: null, dashboard: null,
  defaultName: 'ServeDefaultNameParams', generate: 'ServeGenerateParams', shutdown: null,
};

/** The settings of open's params, or of the command line's flags; paths from `cwd`. */
export function settingsOf(params: ServeOpenParams, cwd: string, env?: NodeJS.ProcessEnv): Settings {
  const resolve = (paths?: string[]): string[] | undefined => paths?.map((p) => path.resolve(cwd, p));
  const source = resolve(params.source);
  const library = resolve(params.library);
  return {
    folder: path.resolve(cwd, params.folder ?? '.'),
    discovery: {
      ...(source ? { source } : {}),
      ...(library ? { library } : {}),
      ...(params.exclude ? { exclude: params.exclude } : {}),
      ...(env ? { env } : {}),
    },
    load: {
      ...(params.stdlib !== undefined ? { stdlib: typeof params.stdlib === 'string' ? path.resolve(cwd, params.stdlib) : false } : {}),
      ...(params.vocabulary ? { vocabulary: params.vocabulary } : {}),
      ...(params.extensions ? { extensions: params.extensions } : {}),
    },
  };
}

export async function serve(lines: AsyncIterable<string>, write: (line: string) => void, cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  let session: Session | null = null;
  const opened = (): Session => {
    if (!session) throw new RpcError(-32001, 'no model is open: call open first');
    return session;
  };
  const describe = (s: Session) => ({
    layout: s.inputs.layout,
    root: s.inputs.root,
    units: s.inputs.sources.map((f) => f.unit),
    libraries: s.inputs.libraries.map((f) => f.unit),
    libraryFound: s.analysis.libraryFound,
  });

  const methods: Record<string, (params: any) => unknown> = {
    open: async (params: ServeOpenParams) => {
      session = await Session.open(settingsOf(params, cwd, env));
      return describe(session);
    },
    reload: async () => {
      session = await opened().reload();
      return describe(session);
    },
    analyze: () => opened().analysis,
    validate: () => opened().validation(),
    dashboard: () => opened().dashboard(),
    defaultName: (params: { kind: 'graybox' | 'whitebox' | 'stub'; of: string; folder?: string }) =>
      ({ name: opened().defaultName(params.kind, params.of, params.folder) }),
    generate: (params: { request: GenerationRequest; write?: boolean }) => opened().generate(params.request, params.write ?? false),
    shutdown: () => null,
  };

  for await (const line of lines) {
    if (!line.trim()) continue;
    let id: Id = null;
    let notification = false;
    let method = '';
    try {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        throw new RpcError(-32700, 'not JSON');
      }
      const request = message as { id?: Id; method?: unknown; params?: unknown };
      if (request && typeof request === 'object' && !Array.isArray(request)) {
        notification = !('id' in request);
        if (typeof request.id === 'string' || typeof request.id === 'number') id = request.id;
      }
      const bad = problems('ServeRequest', message);
      if (bad.length) {
        throw typeof request?.method === 'string' && !(request.method in PARAMS)
          ? new RpcError(-32601, `no method ${request.method}`)
          : new RpcError(-32600, `not a request: ${bad.join('; ')}`);
      }
      method = request.method as string;
      const definition = PARAMS[method];
      const params = request.params ?? {};
      if (definition) {
        const wrong = problems(definition, params);
        if (wrong.length) throw new RpcError(-32602, wrong.join('; '));
      }
      const result = await methods[method]!(params);
      if (!notification) write(JSON.stringify({ jsonrpc: '2.0', id, result }));
    } catch (e) {
      const error = e instanceof RpcError ? e
        : e instanceof InputError ? new RpcError(-32000, e.message)
        : new RpcError(-32603, (e as Error).message ?? String(e));
      if (!notification || error.code === -32700) write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: error.code, message: error.message } }));
    }
    if (method === 'shutdown') return;
  }
}
