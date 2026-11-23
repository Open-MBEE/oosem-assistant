import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, defaultName } from './index.ts';
import { parseName } from './names.ts';
import { projectSources, fixture, openModel } from './test/models.ts';
import { DEFAULT_VOCABULARY, mergeVocabulary } from './vocabulary.ts';

test('a name is read as base, phase suffix and number', () => {
  assert.deepEqual(parseName('Quadcopter_bb', DEFAULT_VOCABULARY), { base: 'Quadcopter', phase: 'blackbox', n: null });
  assert.deepEqual(parseName('Airframe_gb2', DEFAULT_VOCABULARY), { base: 'Airframe', phase: 'graybox', n: 2 });
  assert.deepEqual(parseName('Quadcopter', DEFAULT_VOCABULARY), { base: 'Quadcopter', phase: null, n: null });
  assert.deepEqual(parseName('_wb', DEFAULT_VOCABULARY), { base: '_wb', phase: null, n: null });   // no base
  const dotted = mergeVocabulary({ graybox: { suffix: '.g' } });
  assert.deepEqual(parseName('A.g3', dotted), { base: 'A', phase: 'graybox', n: 3 });
  assert.deepEqual(parseName('Axg3', dotted), { base: 'Axg3', phase: null, n: null });
});

test('the rover\'s defaults: the suffix swapped, then the next free number', async () => {
  const analysis = analyze(await openModel(projectSources('rover')));
  const id = (name: string) => analysis.blocks.find((b) => b.name === name)!.ref.id;
  assert.equal(defaultName(analysis, 'graybox', id('Rover_bb')), 'Rover_gb2');
  assert.equal(defaultName(analysis, 'graybox', 'Rover_bb::Rover_bb'), 'Rover_gb2');   // by qualified name
  assert.equal(defaultName(analysis, 'whitebox', id('Chassis_gb')), 'Chassis_wb2');
  assert.equal(defaultName(analysis, 'whitebox', id('Drive_Tracks_gb')), 'Drive_Tracks_wb');
  assert.equal(defaultName(analysis, 'graybox', id('Rover_bb'), (n) => n === 'Rover_gb2'), 'Rover_gb3');
  assert.equal(defaultName(analysis, 'stub', 'Rover_gb::Rover_gb::chassis'), 'Chassis_gb2');
  assert.throws(() => defaultName(analysis, 'graybox', 'Nothing'), RangeError);
});

test('numbers are kept, and a name without a suffix gets one', async () => {
  const analysis = analyze(await fixture(`
package P {
  #blackbox part def Thing;
  #blackbox part def Air_bb;
  #graybox part def Air_gb2 :> Air_bb;
  #whitebox part def Air_wb2 :> Air_gb2;
  #graybox part def Air_gb5 :> Air_bb;
}`));
  assert.equal(defaultName(analysis, 'graybox', 'P::Thing'), 'Thing_gb');
  assert.equal(defaultName(analysis, 'whitebox', 'P::Air_gb2'), 'Air_wb3');
  assert.equal(defaultName(analysis, 'whitebox', 'P::Air_gb5'), 'Air_wb5');
  assert.equal(defaultName(analysis, 'graybox', 'P::Air_bb'), 'Air_gb');
});
