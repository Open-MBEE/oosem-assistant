// Packs a release asset: `core`, the core alone, or `cli`, the CLI with the core and the SDK inside.
// The core and the SDK are on no registry, and npm does not bundle a workspace dependency (it is a
// link at the workspace root), so this stages the package with real copies in its node_modules and
// packs the stage. Other dependencies (ajv) install from npm as usual. Build first (npm run build).
//
// The core's tarball takes the SDK as an exact peer dependency instead of a copy: a program that
// builds its own `Model` and passes it to the core needs both on one copy of the SDK. Such a program
// vendors the SDK's tarball next to the core's.
//
// usage: node tools/pack.mjs <core|cli> [<out dir>]     default: dist/ in this repository

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const which = process.argv[2];
if (which !== 'core' && which !== 'cli') {
  console.error('usage: node tools/pack.mjs <core|cli> [<out dir>]');
  process.exit(2);
}
const out = path.resolve(process.argv[3] ?? path.join(root, 'dist'));
const stage = path.join(out, `stage-${which}`);
const SDK = 'vendor/sysml/sysml-0.2.0.tgz';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** A package's manifest and its `files`, copied into `into`, with this repository's LICENSE; the
 * manifest without its development fields. */
function stagePackage(dir, into) {
  const { devDependencies: _, scripts: __, ...manifest } = readJson(path.join(dir, 'package.json'));
  mkdirSync(into, { recursive: true });
  for (const file of manifest.files ?? []) {
    const from = path.join(dir, file);
    if (!existsSync(from)) continue;
    cpSync(from, path.join(into, file), { recursive: true, filter: (p) => !/\.tsbuildinfo$|\.test\.(js|d\.ts)$/.test(p) });
  }
  cpSync(path.join(root, 'LICENSE'), path.join(into, 'LICENSE'));
  return manifest;
}

/** The core's manifest as it ships: no sources in its exports, and no SDK among its dependencies,
 * for the caller to add as a dependency or a peer. */
function coreManifest(core) {
  const { source: _, ...exports } = core.exports['.'];
  const { sysml: __, ...dependencies } = core.dependencies ?? {};
  return { ...core, exports: { '.': exports }, dependencies };
}

const npmPack = (dir) => execFileSync('npm', ['pack', '--pack-destination', out], { cwd: dir, encoding: 'utf8' }).trim().split('\n').at(-1);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const sysmlVersion = JSON.parse(execFileSync('tar', ['-xzOf', path.join(root, SDK), 'package/package.json'], { encoding: 'utf8' })).version;

let tarball;
if (which === 'core') {
  const core = stagePackage(path.join(root, 'packages/core'), stage);
  writeJson(path.join(stage, 'package.json'), { ...coreManifest(core), peerDependencies: { sysml: sysmlVersion } });
  tarball = npmPack(stage);
} else {
  mkdirSync(path.join(stage, 'node_modules/sysml'), { recursive: true });
  execFileSync('tar', ['-xzf', path.join(root, SDK), '-C', path.join(stage, 'node_modules/sysml'), '--strip-components=1']);
  const core = stagePackage(path.join(root, 'packages/core'), path.join(stage, 'node_modules/oosem'));
  const shipped = coreManifest(core);
  writeJson(path.join(stage, 'node_modules/oosem/package.json'), { ...shipped, dependencies: { ...shipped.dependencies, sysml: sysmlVersion } });

  const dir = path.join(root, 'packages/cli');
  cpSync(path.join(root, 'schema'), path.join(dir, 'schema'), { recursive: true });
  const manifest = stagePackage(dir, stage);
  rmSync(path.join(dir, 'schema'), { recursive: true, force: true });
  writeJson(path.join(stage, 'package.json'), {
    ...manifest,
    dependencies: { ...manifest.dependencies, oosem: core.version, sysml: sysmlVersion },
    bundleDependencies: ['oosem', 'sysml'],
  });
  tarball = npmPack(stage);
}
rmSync(stage, { recursive: true, force: true });
console.log(path.join(out, tarball));
