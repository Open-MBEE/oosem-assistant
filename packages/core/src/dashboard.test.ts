import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, dashboard } from './index.ts';
import type { DashboardModel } from './index.ts';
import { projectSources, fixture, openModel } from './test/models.ts';
import { check } from './test/schema.ts';

const byName = (d: DashboardModel, name: string) => {
  const found = Object.values(d.blocks).find((b) => b.name === name);
  assert.ok(found, `no block ${name}`);
  return found;
};
const groups = (d: DashboardModel, column: number) =>
  (d.columns[column]?.groups ?? []).map((g) => [g.title, g.rows.map((r) => d.blocks[r]?.name)]);
const lines = (d: DashboardModel, name: string) =>
  byName(d, name).lines.map((l) => `${l.kind}${l.inherited ? '*' : ''} ${l.text} → ${l.target ? d.blocks[l.target]?.name : null}`);

test('the rover: columns, groups, and the decomposition lines', async () => {
  const d = dashboard(analyze(await openModel(projectSources('rover'))));
  assert.deepEqual(check('DashboardModel', d), []);
  assert.deepEqual(d.columns.map((c) => c.label), ['Blackbox', 'Graybox', 'Whitebox']);
  assert.equal(d.columns[0].groups.length, 1);
  assert.equal(d.columns[0].groups[0]?.rows.length, 6);
  assert.deepEqual(groups(d, 1).find(([title]) => title === 'Grayboxes of Drive_bb'), ['Grayboxes of Drive_bb', ['Drive_Tracks_gb', 'Drive_gb']]);
  assert.deepEqual(groups(d, 1).at(-1), ['Orphan grayboxes', []]);
  assert.deepEqual(groups(d, 2).at(-1), ['Orphan whiteboxes', []]);
  assert.equal(d.columns[2].groups.length, 5);

  assert.deepEqual(lines(d, 'Chassis_bb'), ['usedIn Rover_gb.chassis → Rover_gb']);
  assert.deepEqual(lines(d, 'Rover_gb')[0], 'subsystem chassis : Chassis_bb → Chassis_bb');
  assert.equal(lines(d, 'Rover_gb').length, 4);
  assert.deepEqual(lines(d, 'Drive_wb'), ['choice motor :>> motor : Motor_gb → Motor_gb']);
  const choice = byName(d, 'Drive_wb').lines[0];
  assert.equal(choice?.redefines?.qualifiedName?.endsWith('Drive_gb::motor'), true);
  assert.equal(choice?.owner, byName(d, 'Drive_wb').ref.id);
  assert.equal(byName(d, 'Rover_gb').untracked, 3);   // the bind, the interface and the inherited port
  assert.equal(d.notice, null);
});

test('the faults project: orphans, messages, unintegrated subsystems', async () => {
  const d = dashboard(analyze(await openModel(projectSources('faults'))));
  assert.deepEqual(check('DashboardModel', d), []);
  assert.deepEqual(groups(d, 1).at(-1), ['Orphan grayboxes', ['Loose_gb']]);
  assert.deepEqual(groups(d, 2).at(-1), ['Orphan whiteboxes', ['Loose_wb']]);
  assert.equal(d.columns[2].groups.at(-1)?.orphans, true);

  assert.deepEqual(byName(d, 'Valve_bb').errors, ['A blackbox can only contain untracked features.']);   // no R12
  assert.deepEqual(byName(d, 'Pump_wb').errors, ['A whitebox can only contain graybox or whitebox subsystems and untracked features.']);
  assert.deepEqual(byName(d, 'Rotor_wb').warnings, ['Unintegrated subsystems: bearing.', 'Unintegrated subsystem.']);
  assert.deepEqual(byName(d, 'Rotor_gb').warnings, []);     // R10 concerns the whitebox
  assert.deepEqual(lines(d, 'Rotor_wb'), ['unintegrated* bearing : Pump_bb → Pump_bb']);
  assert.deepEqual(lines(d, 'Pump_wb'), ['choice housing :>> housing : Housing_gb → Housing_gb', 'choice rotor :>> rotor : Rotor_wb → Rotor_wb']);
  assert.equal(byName(d, 'Pump_wb').untracked, 2);            // the two misplaced features
});

test('inherited subsystems, and a block in several groups', async () => {
  const d = dashboard(analyze(await fixture(`
package P {
  #blackbox part def S_bb;
  #blackbox part def A_bb;
  #blackbox part def B_bb;
  #graybox part def G_gb :> A_bb, B_bb { part s : S_bb; }
  #graybox part def H_gb :> G_gb;
}`)));
  assert.deepEqual(groups(d, 1), [
    ['Grayboxes of A_bb', ['G_gb', 'H_gb']],
    ['Grayboxes of B_bb', ['G_gb', 'H_gb']],
    ['Orphan grayboxes', []],
  ]);
  assert.deepEqual(lines(d, 'H_gb'), ['subsystem* s : S_bb → S_bb']);
  assert.deepEqual(lines(d, 'S_bb'), ['usedIn G_gb.s → G_gb', 'usedIn* H_gb.s → H_gb']);
});

test('the usage-style notice', async () => {
  const one = dashboard(analyze(await fixture('package P { #blackbox part q; }')));
  assert.deepEqual(one.notice?.message, '1 usage is marked as a box outside any definition. Usage-based boxes come in a later phase.');
  assert.deepEqual(one.notice?.usages.map((u) => u.qualifiedName), ['P::q']);
  const two = dashboard(analyze(await fixture('package P { #blackbox part q; #graybox part r; }')));
  assert.match(two.notice?.message ?? '', /^2 usages are marked as boxes/);
});

test('without the method library', async () => {
  const d = dashboard(analyze(await openModel({ 'a.sysml': 'package P;' }, { library: false })));
  assert.equal(d.libraryFound, false);
  assert.deepEqual(d.blocks, {});
  assert.deepEqual(check('DashboardModel', d), []);
});
