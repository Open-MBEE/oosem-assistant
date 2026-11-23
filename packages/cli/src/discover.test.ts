import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { discover, InputError } from './discover.ts';
import { copyOf, folder, kotarWorkspace, LIBRARY } from './test/helpers.ts';

const units = (files: { unit: string }[]): string[] => files.map((f) => f.unit);

test('any folder: every model file, without dot folders, node_modules and excluded paths', () => {
  const dir = folder({
    'b.sysml': '', 'a/c.kerml': '', 'a/notes.txt': '', '.git/x.sysml': '', 'node_modules/p/y.sysml': '',
    'build/z.sysml': '', 'a/old.sysml': '',
  });
  const inputs = discover(dir, { exclude: ['build', '**/old.sysml'] });
  assert.equal(inputs.layout, 'files');
  assert.equal(inputs.root, dir);
  assert.deepEqual(units(inputs.sources), ['a/c.kerml', 'b.sysml']);
  assert.deepEqual(inputs.libraries, []);
});

test('a kotar workspace: own files outside libraries/, dependencies inside, as kotar names them', () => {
  const inputs = discover(kotarWorkspace('faults'));
  assert.equal(inputs.layout, 'kotar');
  assert.deepEqual(units(inputs.sources), ['Faults.sysml']);
  assert.deepEqual(units(inputs.libraries), ['libraries/openmbee-oosem-library/oosem.sysml']);
});

test('a kotar checkout without libraries/: the dependencies are not installed', () => {
  assert.throws(() => discover(kotarWorkspace('faults', false)),
    new InputError('the dependencies are not installed: open the workspace in kotar, or pass --library <dir>'));
  // --library stands in for them
  const inputs = discover(kotarWorkspace('faults', false), { library: [LIBRARY] });
  assert.deepEqual(units(inputs.libraries), ['libraries/openmbee-oosem-library/oosem.sysml']);
});

test('a Sysand project before `sysand sync`', () => {
  assert.throws(() => discover(copyOf('faults')),
    new InputError('the dependencies are not installed: run `sysand sync`, or pass --library <dir>'));
});

/** A Sysand project with its environment, and a stub `sysand` on PATH that lists the files the way
 * `sysand sources` does: absolute paths, unsorted. */
function sysandProject(): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = copyOf('variants');
  mkdirSync(path.join(dir, '.sysand'));
  const library = folder();
  cpSync(LIBRARY, library, { recursive: true });
  const bin = folder();
  writeFileSync(path.join(bin, 'sysand'), [
    '#!/bin/sh',
    '[ "$1" = sources ] || exit 2',
    `[ "$2" = --no-deps ] && printf '%s\\n' "$PWD/Variants.sysml" && exit 0`,
    `[ "$2" = --only-deps ] && printf '%s\\n' "${library}/oosem.sysml" && exit 0`,
    'exit 2',
  ].join('\n'));
  chmodSync(path.join(bin, 'sysand'), 0o755);
  return { dir, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env['PATH']}` } };
}

test('a Sysand project: the files `sysand sources` lists, dependencies as kotar would install them', () => {
  const { dir, env } = sysandProject();
  const inputs = discover(dir, { env });
  assert.equal(inputs.layout, 'sysand');
  assert.deepEqual(units(inputs.sources), ['Variants.sysml']);
  assert.deepEqual(units(inputs.libraries), ['libraries/openmbee-oosem-library/oosem.sysml']);
});

test('a Sysand project without `sysand` on PATH', () => {
  const { dir } = sysandProject();
  assert.throws(() => discover(dir, { env: { ...process.env, PATH: folder() } }),
    new InputError('this is a Sysand project, but `sysand` is not on PATH: install Sysand, or pass --source and --library'));
});

test('--source and --library win over discovery', () => {
  const dir = kotarWorkspace('rover');
  const inputs = discover(dir, { source: [path.join(dir, 'Rover_bb.sysml'), path.join(dir, 'Chassis_gb.sysml')], library: [path.join(LIBRARY, 'oosem.sysml')] });
  assert.equal(inputs.layout, 'kotar');
  assert.deepEqual(units(inputs.sources), ['Chassis_gb.sysml', 'Rover_bb.sysml']);
  assert.deepEqual(units(inputs.libraries), ['libraries/openmbee-oosem-library/oosem.sysml']);
});

test('bad input', () => {
  assert.throws(() => discover('/no/such/folder'), new InputError('not a folder: /no/such/folder'));
  assert.throws(() => discover(folder({ 'a.txt': '' })), /no \.sysml or \.kerml files/);
  assert.throws(() => discover(folder({ '.project.json': '{' })), /\.project\.json is not JSON/);
});

test('two dependencies that would share a folder are numbered, as kotar does', () => {
  const dir = folder({ 'a.sysml': '', 'one/lib/x.sysml': '', 'two/lib/x.sysml': '' });
  const inputs = discover(dir, { source: [path.join(dir, 'a.sysml')], library: [path.join(dir, 'one/lib'), path.join(dir, 'two/lib')] });
  assert.deepEqual(units(inputs.libraries), ['libraries/lib-2/x.sysml', 'libraries/lib/x.sysml']);
});

test('a --library folder without a .project.json is its own project, even inside another', () => {
  const dir = folder({ '.project.json': '{"name": "mine", "publisher": "me"}', 'a.sysml': '', 'libs/foo/x.sysml': '' });
  const inputs = discover(dir, { library: [path.join(dir, 'libs/foo')], exclude: ['libs'] });
  assert.deepEqual(units(inputs.sources), ['a.sysml']);
  assert.deepEqual(units(inputs.libraries), ['libraries/foo/x.sysml']);
});
