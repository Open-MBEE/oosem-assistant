import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Model } from 'sysml';
import type { ToolkitBackend } from 'sysml';
import { analyze } from './index.ts';
import type { Analysis } from './index.ts';
import { fixture, openModel, projectSources } from './test/models.ts';
import { check } from './test/schema.ts';

const PROJECTS = ['rover', 'faults', 'variants'] as const;
const block = (analysis: Analysis, name: string) => {
  const found = analysis.blocks.find((b) => b.name === name);
  assert.ok(found, `no block ${name}`);
  return found;
};

test('the projects\' analyses are plain data that the schema accepts', async () => {
  for (const name of PROJECTS) {
    for (const extensions of [{}, { properties: true, inPhaseSpecialization: true }]) {
      const analysis = analyze(await openModel(projectSources(name)), { extensions });
      assert.deepEqual(check('Analysis', analysis), [], name);
      assert.deepEqual(JSON.parse(JSON.stringify(analysis)), analysis);
    }
  }
});

test('blocks: keywords, passing, and their features', async () => {
  const faults = analyze(await openModel(projectSources('faults')));
  assert.deepEqual(faults.extensions, { properties: false, inPhaseSpecialization: false });
  assert.equal(faults.libraryFound, true);
  assert.deepEqual(faults.blocks.map((b) => b.name).sort(), [
    'Housing_bb', 'Housing_gb', 'Loose_gb', 'Loose_wb', 'Pump_bb', 'Pump_gb', 'Pump_spare_gb', 'Pump_wb', 'Rotor_bb', 'Rotor_gb', 'Rotor_wb',
    'Valve_bb', 'Valve_gb',
  ]);   // nothing from the method library
  assert.equal(block(faults, 'Pump_bb').passes, true);
  assert.equal(block(faults, 'Valve_bb').passes, false);
  assert.equal(block(faults, 'Rotor_wb').passes, false);        // R10 is a warning
  assert.equal(block(faults, 'Pump_bb').keyword, 'part');

  const [unintegrated] = block(faults, 'Rotor_wb').features;
  assert.ok(unintegrated);
  assert.deepEqual(
    [unintegrated.name, unintegrated.role, unintegrated.phase, unintegrated.ref.qualifiedName, unintegrated.types.map((t) => t.qualifiedName)],
    ['bearing', 'subsystem', 'blackbox', 'FaultTest::Rotor_gb::bearing', ['FaultTest::Pump_bb']]);
  assert.equal(unintegrated.inheritedFrom, block(faults, 'Rotor_gb').ref.id);

  const choice = block(faults, 'Pump_wb').features.find((f) => f.role === 'choice');
  assert.equal(choice?.redefines?.qualifiedName, 'FaultTest::Pump_gb::housing');
});

test('a feature that only redefines shows the redefined name; multiplicities come through', async () => {
  const analysis = analyze(await fixture(`
package P {
  #blackbox part def S_bb;
  #graybox part def S_gb :> S_bb;
  #blackbox part def A_bb;
  #graybox part def A_gb :> A_bb { part s : S_bb[2]; }
  #whitebox part def A_wb :> A_gb { part :>> s : S_gb; }
}`));
  const [s] = block(analysis, 'A_wb').features;
  assert.deepEqual([s?.name, s?.role, s?.ref.qualifiedName, s?.multiplicity], ['s', 'choice', 'P::A_wb::s', null]);
  assert.deepEqual(block(analysis, 'A_gb').features[0]?.multiplicity, { lower: 2, upper: 2 });
});

test('usage-style boxes: marked usages that no block owns', async () => {
  const analysis = analyze(await fixture(`
package P {
  private import RecursiveDecompositionPattern::Concepts::*;
  #blackbox part def S_bb;
  #graybox part def S_gb :> S_bb { part inside : S_bb; }
  #blackbox part q;
  part r :> blackboxes;
  part typed : S_bb;
  part def Plain { #graybox part nested; }
}`));
  assert.deepEqual(analysis.usageStyleBoxes.map((u) => u.qualifiedName), ['P::q', 'P::r', 'P::Plain::nested']);
  assert.deepEqual(analysis.findings, []);
});

test('without the method library: no blocks, and the analysis says so', async () => {
  const analysis = analyze(await openModel({ 'a.sysml': 'package P { part def A_bb; }' }, { library: false }));
  assert.deepEqual([analysis.libraryFound, analysis.blocks, analysis.findings], [false, [], []]);
});

test('conformance: the same analysis through the SysML Toolkit and its export', async () => {
  for (const name of PROJECTS) {
    const model = await openModel(projectSources(name));
    const direct = analyze(model, { extensions: { properties: true } });
    for (const closures of [true, false]) {
      const elements = JSON.parse((model.backend as ToolkitBackend).fullJson({ closures }));
      assert.deepEqual(analyze(Model.fromFullJson(elements), { extensions: { properties: true } }), direct, `${name}, closures ${closures}`);
    }
  }
});

test('the standard library changes nothing', async () => {
  const sources = projectSources('rover');
  assert.deepEqual(analyze(await openModel(sources, { stdlib: true })), analyze(await openModel(sources)));
});
