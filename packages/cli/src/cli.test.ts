import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { problems } from './schema.ts';
import { copyOf, folder, kotarWorkspace, LIBRARY, oosem, project, withLibrary } from './test/helpers.ts';

const lines = (text: string): string[] => text.split('\n').filter(Boolean);

test('validate: the faults project, exit 1', async () => {
  const { code, stdout, stderr } = await oosem(['validate', project('faults'), ...withLibrary]);
  assert.equal(stderr, '');
  assert.equal(code, 1);
  assert.deepEqual(lines(stdout), [
    'FaultTest::Valve_bb: error: Has features with errors. [R12]',
    'FaultTest::Valve_bb::seat: error: A blackbox can only contain untracked features. [R6]',
    'FaultTest::Valve_gb: error: Has features with errors. [R12]',
    'FaultTest::Valve_gb::stem: error: A graybox can only contain blackbox subsystems and untracked features. [R8]',
    'FaultTest::Loose_gb: error: Orphan graybox: it specializes no blackbox. [R1]',
    'FaultTest::Loose_wb: error: Orphan whitebox: it specializes no graybox. [R2]',
    'FaultTest::Rotor_wb: warning: Unintegrated subsystems: bearing. [R10]',
    'FaultTest::Rotor_gb::bearing: warning: Unintegrated subsystem. [R10]',
    'FaultTest::Pump_wb: error: Has features with errors. [R12]',
    'FaultTest::Pump_wb::spare: error: A whitebox can only contain graybox or whitebox subsystems and untracked features. [R11]',
    'FaultTest::Pump_wb::extra: error: A whitebox can only contain graybox or whitebox subsystems and untracked features. [R11]',
  ]);
});

test('validate: the rover (exit 0) and the variants project (exit 1)', async () => {
  assert.deepEqual(await oosem(['validate', project('rover'), ...withLibrary]), { code: 0, stdout: '', stderr: '' });
  const brief = (text: string) => lines(text).map((l) => l.replace(/^VariantTest::/, '').replace(/: error: .*\[/, ' ['));
  // with properties: R3 only
  const properties = await oosem(['validate', project('variants'), ...withLibrary, '--properties']);
  assert.equal(properties.code, 1);
  assert.deepEqual(brief(properties.stdout), ['Mk2_bb [R3]', 'Mk2_gb [R3]', 'Mk2_wb [R3]']);
  // without the extension, gear and gearSet are misplaced subsystems
  const plain = await oosem(['validate', project('variants'), ...withLibrary]);
  assert.equal(plain.code, 1);
  assert.deepEqual(brief(plain.stdout), ['Mk1_bb [R12]', 'Mk1_bb::gear [R5]', 'Mk2_bb [R3]', 'Mk1_gb [R12]', 'Mk1_gb::gearSet [R7]', 'Mk2_gb [R3]', 'Mk2_wb [R3]']);
  // with in-phase specialization on, R3 is still an error, with another text
  const extended = await oosem(['validate', project('variants'), ...withLibrary, '--properties', '--in-phase-specialization']);
  assert.equal(extended.code, 1);
  assert.match(lines(extended.stdout)[0] ?? '', /Mk2_bb: error: In-phase specialization is not supported yet: .* \[R3\]$/);
});

test('validate: from a kotar workspace checkout, and without its libraries/', async () => {
  const run = await oosem(['validate', '--no-stdlib'], { cwd: kotarWorkspace('faults') });
  assert.equal(run.code, 1);
  assert.equal(lines(run.stdout).length, 11);
  assert.deepEqual(await oosem(['validate', '--no-stdlib'], { cwd: kotarWorkspace('faults', false) }), {
    code: 2, stdout: '', stderr: 'oosem: the dependencies are not installed: open the workspace in kotar, or pass --library <dir>\n',
  });
});

test('validate: another library\'s errors are printed, but only the project\'s own set exit 1', async () => {
  const theirs = 'private import RecursiveDecompositionPattern::Metadata::*;\n'
    + 'library package Supplier { #blackbox part def S_bb; #graybox part def S_gb :> S_bb { #whitebox part w; } }';
  const ours = 'private import RecursiveDecompositionPattern::Metadata::*;\npackage Ours { #blackbox part def O_bb; }';
  const libraryOnly = await oosem(['validate', folder({ 'theirs.sysml': theirs, 'ours.sysml': ours }), ...withLibrary]);
  assert.equal(libraryOnly.code, 0);
  assert.match(libraryOnly.stdout, /^Supplier::S_gb: error: /m);
  const both = await oosem(['validate', folder({ 'theirs.sysml': theirs, 'ours.sysml': ours.replace('O_bb; }', 'O_bb; #graybox part def O_gb :> O_bb { #whitebox part w; } }') }), ...withLibrary]);
  assert.equal(both.code, 1);
});

test('validate --json, analyze and dashboard --json conform to the schema', async () => {
  const validate = await oosem(['validate', project('faults'), ...withLibrary, '--json']);
  assert.equal(validate.code, 1);
  assert.deepEqual(problems('ValidationReport', JSON.parse(validate.stdout)), []);
  const analyze = await oosem(['analyze', project('faults'), ...withLibrary]);
  assert.equal(analyze.code, 0);
  assert.deepEqual(problems('Analysis', JSON.parse(analyze.stdout)), []);
  const dashboard = await oosem(['dashboard', project('faults'), ...withLibrary, '--json']);
  assert.equal(dashboard.code, 0);
  assert.deepEqual(problems('DashboardModel', JSON.parse(dashboard.stdout)), []);
});

test('dashboard: the tree', async () => {
  const { code, stdout } = await oosem(['dashboard', project('rover'), ...withLibrary]);
  assert.equal(code, 0);
  const tree = lines(stdout);
  assert.deepEqual(tree.filter((l) => !l.startsWith(' ')), ['Blackbox', 'Graybox', 'Whitebox']);
  const at = tree.indexOf('    Rover_gb');
  assert.deepEqual(tree.slice(at - 1, at + 6), [
    '  Grayboxes of Rover_bb',
    '    Rover_gb',
    '      chassis : Chassis_bb',
    '      drive : Drive_bb',
    '      power : Power_bb',
    '      nav : Navigation_bb',
    '      3 untracked features',
  ]);
});

test('the method library missing, and a file that does not parse: exit 2', async () => {
  const bare = folder({ 'a.sysml': 'package A { part def A; }' });
  const missing = await oosem(['validate', bare, '--no-stdlib']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^oosem: the OOSEM method library is not in the model \(no package RecursiveDecompositionPattern\): add it/);
  const broken = folder({ 'a.sysml': 'package A { part def A; }', 'b.sysml': 'package B { part def B :> ' });
  assert.deepEqual(await oosem(['validate', broken, ...withLibrary]), { code: 2, stdout: '', stderr: 'oosem: the model does not load: b.sysml does not parse\n' });
});

test('arguments: help, no command, unknown options, a bad vocabulary', async () => {
  const help = await oosem(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^usage: oosem <command>/);
  assert.deepEqual(await oosem([]), { code: 2, stdout: '', stderr: 'oosem: no command\n' });
  assert.deepEqual(await oosem(['check']), { code: 2, stdout: '', stderr: 'oosem: no command check\n' });
  assert.equal((await oosem(['validate', '--frobnicate'])).code, 2);
  assert.deepEqual(await oosem(['validate', 'a', 'b']), { code: 2, stdout: '', stderr: 'oosem: unexpected arguments: b\n' });
  assert.deepEqual(await oosem(['serve']), { code: 2, stdout: '', stderr: 'oosem: serve needs --stdio\n' });
  const vocabulary = path.join(folder({ 'v.json': JSON.stringify({ blackbox: { suffix: 7 } }) }), 'v.json');
  const bad = await oosem(['validate', project('rover'), ...withLibrary, '--vocabulary', vocabulary]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /is not a PartialVocabulary: \/blackbox\/suffix must be string/);
});

const usage = (name: string) => `Rover_gb::Rover_gb::${name}`;
const WHITEBOX = {
  kind: 'whitebox', subject: 'Rover_gb::Rover_gb', name: 'Rover_wb2', folder: 'new',
  subsystems: [
    { usage: usage('power'), choice: { realizeWith: 'Power_wb::Power_wb' } },
    { usage: usage('chassis'), choice: { realizeWith: 'Chassis_wb::Chassis_wb' } },
    { usage: usage('drive'), choice: { stub: 'Drive_gb2' }, newName: 'wheels' },
    { usage: usage('nav'), choice: { unintegrated: true } },
  ],
};

test('generate: the text; with --write the file, which a second run refuses to overwrite', async () => {
  const dir = copyOf('rover');
  const request = path.join(folder({ 'r.json': JSON.stringify(WHITEBOX) }), 'r.json');
  const args = ['generate', dir, ...withLibrary, '--request', request];
  const text = await oosem(args);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /^package Rover_wb2 \{\n/);
  assert.equal(existsSync(path.join(dir, 'new/Rover_wb2.sysml')), false);

  const written = await oosem([...args, '--write']);
  assert.deepEqual(written, { code: 0, stdout: `${path.join(dir, 'new/Rover_wb2.sysml')}\n`, stderr: '' });
  assert.equal(readFileSync(path.join(dir, 'new/Rover_wb2.sysml'), 'utf8'), text.stdout);

  // the new whitebox is in the model now, so its name is taken
  const again = await oosem([...args, '--write']);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /^oosem: .*Rover_wb2/);
  assert.equal(readFileSync(path.join(dir, 'new/Rover_wb2.sysml'), 'utf8'), text.stdout);
});

test('generate --write never overwrites a file, whatever is in it', async () => {
  const dir = copyOf('rover');
  writeFileSync(path.join(dir, 'notes.sysml'), '');   // not a model element: only the file check sees it
  const request = path.join(folder({ 'r.json': JSON.stringify({ ...WHITEBOX, name: 'notes', folder: '' }) }), 'r.json');
  const run = await oosem(['generate', dir, ...withLibrary, '--request', request, '--write']);
  assert.equal(run.code, 1);
  assert.equal(readFileSync(path.join(dir, 'notes.sysml'), 'utf8'), '');
  const json = await oosem(['generate', dir, ...withLibrary, '--request', request, '--json']);
  assert.equal(json.code, 1);
  assert.deepEqual(problems('GenerationResult', JSON.parse(json.stdout)), []);
});

test('generate: a request that is not one, or outside the folder: exit 2', async () => {
  const dir = copyOf('rover');
  assert.deepEqual(await oosem(['generate', dir, ...withLibrary]), { code: 2, stdout: '', stderr: 'oosem: generate needs --request <file>\n' });
  const bad = path.join(folder({ 'r.json': JSON.stringify({ kind: 'blackbox' }) }), 'r.json');
  assert.equal((await oosem(['generate', dir, ...withLibrary, '--request', bad])).code, 2);
  const outside = path.join(folder({ 'r.json': JSON.stringify({ ...WHITEBOX, folder: '../elsewhere' }) }), 'r.json');
  const run = await oosem(['generate', dir, ...withLibrary, '--request', outside, '--write']);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /the folder \.\.\/elsewhere is outside/);
});

test('the command itself, with the standard library', async () => {
  const main = fileURLToPath(new URL('main.ts', import.meta.url));
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--conditions=source', main, 'validate', project('rover'), '--library', LIBRARY]);
  assert.equal(stdout + stderr, '');
  const failed = await promisify(execFile)(process.execPath, ['--conditions=source', main, 'validate', project('faults'), '--library', LIBRARY])
    .then(() => null, (e: { code: number; stdout: string }) => e);
  assert.equal(failed?.code, 1);
  assert.equal(lines(failed?.stdout ?? '').length, 11);
});
