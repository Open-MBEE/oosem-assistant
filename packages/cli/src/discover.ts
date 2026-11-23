// Which files make up the model: the flags, else a Sysand
// project, a kotar workspace, or every model file under the folder. Own files are named relative to
// the folder, dependencies `libraries/<dir>/…` as kotar installs them, so element ids match kotar's.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** A file of the model: `unit` is the name the model knows it by. */
export interface SourceFile { unit: string; path: string }

export interface Inputs {
  layout: 'sysand' | 'kotar' | 'files';
  root: string;              // absolute; the folder own units are named from
  sources: SourceFile[];     // own files, by unit
  libraries: SourceFile[];   // dependencies, by unit
}

export interface DiscoveryOptions {
  source?: readonly string[];
  library?: readonly string[];
  exclude?: readonly string[];
  env?: NodeJS.ProcessEnv;   // for finding `sysand`; the process's by default
}

/** Input the CLI cannot use: exit code 2. */
export class InputError extends Error {}

const MODEL_FILE = /\.(sysml|kerml)$/;
const LIBRARIES = 'libraries';

export function discover(folder: string, options: DiscoveryOptions = {}): Inputs {
  const root = path.resolve(folder);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new InputError(`not a folder: ${folder}`);
  const has = (name: string): boolean => existsSync(path.join(root, name));
  const project = has('.project.json') ? readProject(path.join(root, '.project.json')) : null;
  const layout = project && has('.sysand') ? 'sysand'
    : project && (has('.project-lock.json') || has(LIBRARIES)) ? 'kotar'
    : 'files';
  const exclude = options.exclude ?? [];

  const own = (): SourceFile[] => {
    switch (layout) {
      case 'sysand': return sysand(root, '--no-deps', options.env).map((p) => ({ unit: relative(root, p), path: p }));
      case 'kotar': return walk(root, root, exclude, (rel) => rel === LIBRARIES);
      case 'files': return walk(root, root, exclude);
    }
  };
  const dependencies = (): SourceFile[] => {
    if (layout === 'sysand') return libraryUnits(sysand(root, '--only-deps', options.env));
    if (layout === 'kotar' && has(LIBRARIES)) {
      return walk(path.join(root, LIBRARIES), root, []);
    }
    if (project?.usages && !has(LIBRARIES)) {
      // a Sysand project before `sysand sync`, or a kotar workspace's checkout
      throw new InputError(has('.meta.json')
        ? 'the dependencies are not installed: run `sysand sync`, or pass --library <dir>'
        : 'the dependencies are not installed: open the workspace in kotar, or pass --library <dir>');
    }
    return [];
  };

  const sources = options.source?.length ? explicit(options.source, root, exclude) : own();
  const libraries = options.library?.length
    ? libraryUnits(options.library.flatMap((p) => expand(path.resolve(p), [])).map((f) => f.path), options.library)
    : dependencies();
  if (!sources.length) throw new InputError(`no .sysml or .kerml files in ${root}`);
  const all = [...sources, ...libraries];
  const twice = all.find((f, i) => all.findIndex((g) => g.unit === f.unit) !== i);
  if (twice) throw new InputError(`two files would be the unit ${twice.unit}`);
  return { layout, root, sources: byUnit(sources), libraries: byUnit(libraries) };
}

/** The usages `.project.json` declares; a project file that does not parse is bad input. */
function readProject(file: string): { usages: boolean; publisher?: string; name?: string } {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new InputError(`${file} is not JSON: ${(e as Error).message}`);
  }
  const p = (json ?? {}) as { usage?: unknown; publisher?: unknown; name?: unknown };
  return {
    usages: Array.isArray(p.usage) && p.usage.length > 0,
    ...(typeof p.publisher === 'string' ? { publisher: p.publisher } : {}),
    ...(typeof p.name === 'string' ? { name: p.name } : {}),
  };
}

/** `sysand sources`: absolute paths, one per line. */
function sysand(root: string, which: '--no-deps' | '--only-deps', env?: NodeJS.ProcessEnv): string[] {
  let out: string;
  try {
    out = execFileSync('sysand', ['sources', which], { cwd: root, env: env ?? process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const error = e as NodeJS.ErrnoException & { stderr?: string };
    if (error.code === 'ENOENT') {
      throw new InputError('this is a Sysand project, but `sysand` is not on PATH: install Sysand, or pass --source and --library');
    }
    const said = error.stderr?.trim().split('\n').at(-1) ?? error.message;
    throw new InputError(`\`sysand sources ${which}\` failed (${said}): run \`sysand sync\`, or pass --source and --library`);
  }
  return out.split('\n').map((l) => l.trim()).filter((l) => MODEL_FILE.test(l));
}

/** The files of `--source` arguments, named from the folder. */
function explicit(paths: readonly string[], root: string, exclude: readonly string[]): SourceFile[] {
  return paths.flatMap((p) => expand(path.resolve(p), exclude)).map((f) => ({ unit: relative(root, f.path), path: f.path }));
}

/** A model file, or the model files under a folder. */
function expand(p: string, exclude: readonly string[]): SourceFile[] {
  if (!existsSync(p)) throw new InputError(`no such file or folder: ${p}`);
  if (statSync(p).isDirectory()) return walk(p, p, exclude);
  if (!MODEL_FILE.test(p)) throw new InputError(`not a .sysml or .kerml file: ${p}`);
  return [{ unit: path.basename(p), path: p }];
}

/** Dependency units: `libraries/<dir>/<path in its project>`. A file's project is the nearest folder
 * above it with a `.project.json`, but no higher than the `--library` folder it was found in, which
 * is the project otherwise; `<dir>` is what kotar would install it into, `<publisher>-<name>`, else
 * the project folder's name, numbered when two projects would share it. */
function libraryUnits(files: readonly string[], roots: readonly string[] = []): SourceFile[] {
  const explicitRoots = roots.map((r) => path.resolve(r)).filter((r) => existsSync(r) && statSync(r).isDirectory());
  const dirs = new Map<string, string>();     // project root → dir
  const taken = new Set<string>();
  return files.map((file) => {
    const given = explicitRoots.find((r) => file.startsWith(r + path.sep));
    const projectRoot = projectOf(file, given) ?? given ?? path.dirname(file);
    let dir = dirs.get(projectRoot);
    if (!dir) {
      const project = existsSync(path.join(projectRoot, '.project.json')) ? readProject(path.join(projectRoot, '.project.json')) : null;
      const base = slug(project?.publisher && project.name ? `${project.publisher}-${project.name}` : path.basename(projectRoot));
      dir = base;
      for (let n = 2; taken.has(dir); n++) dir = `${base}-${n}`;
      dirs.set(projectRoot, dir);
      taken.add(dir);
    }
    return { unit: `${LIBRARIES}/${dir}/${relative(projectRoot, file)}`, path: file };
  });
}

/** The nearest folder above the file with a `.project.json`, looking no higher than `top`. */
function projectOf(file: string, top?: string): string | null {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.project.json'))) return dir;
    if (dir === top || path.dirname(dir) === dir) return null;
  }
}

/** The folder kotar installs a resource into. */
const slug = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 64) || 'dependency';

/** The model files under `dir`, named from `root`; folders starting with a dot and `node_modules`
 * are skipped, and so are paths (from `dir`) matching an exclude glob or `skip`. */
function walk(dir: string, root: string, exclude: readonly string[], skip?: (rel: string) => boolean, from = dir): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    const rel = relative(from, p);
    if (skip?.(rel) || exclude.some((glob) => path.matchesGlob(rel, glob))) return [];
    if (entry.isDirectory()) {
      return entry.name.startsWith('.') || entry.name === 'node_modules' ? [] : walk(p, root, exclude, skip, from);
    }
    return entry.isFile() && MODEL_FILE.test(entry.name) ? [{ unit: relative(root, p), path: p }] : [];
  });
}

const relative = (from: string, to: string): string => path.relative(from, to).split(path.sep).join('/');
const byUnit = (files: SourceFile[]): SourceFile[] => files.sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
