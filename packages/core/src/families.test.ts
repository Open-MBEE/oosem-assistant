import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from './classify.ts';
import { mergeExtensions } from './extensions.ts';
import { readFacts } from './facts.ts';
import type { Facts } from './facts.ts';
import { blockFamilies } from './families.ts';
import { catalog } from './features.ts';
import { projectSources, fixture, openModel } from './test/models.ts';
import { DEFAULT_VOCABULARY } from './vocabulary.ts';

const familiesOf = (facts: Facts) => {
  const c = classify(facts, DEFAULT_VOCABULARY);
  const result = blockFamilies(c, catalog(facts, c, mergeExtensions()));
  const name = (id: string) => facts.elements.get(id)?.name;
  const named = (map: Map<string, string[]>) =>
    Object.fromEntries([...map].filter(([, list]) => list.length).map(([k, list]) => [name(k), list.map(name)]));
  return { parents: named(result.parents), children: named(result.children), orphans: result.orphans.map(name) };
};

test('nearest parents, several parents, walking through the own phase, orphans and cycles', async () => {
  const facts = readFacts(await fixture(`
package P {
  #blackbox part def A_bb;
  #blackbox part def B_bb;
  #blackbox part def A2_bb :> A_bb;
  #graybox part def Two_gb :> A_bb, B_bb;
  #graybox part def Near_gb :> A2_bb;
  #graybox part def Via_gb :> Two_gb;
  #graybox part def Orphan_gb;
  #graybox part def Cyc1_gb :> Cyc2_gb;
  #graybox part def Cyc2_gb :> Cyc1_gb, B_bb;
  #whitebox part def W_wb :> Via_gb;
  #whitebox part def Skip_wb :> A_bb;
  #whitebox part def ViaW_wb :> W_wb, Near_gb;
}`));
  assert.deepEqual(familiesOf(facts), {
    parents: {
      Two_gb: ['A_bb', 'B_bb'],
      Near_gb: ['A2_bb'],                 // the nearest blackbox only
      Via_gb: ['A_bb', 'B_bb'],           // through Two_gb
      Cyc1_gb: ['B_bb'],
      Cyc2_gb: ['B_bb'],
      W_wb: ['Via_gb'],
      ViaW_wb: ['Via_gb', 'Near_gb'],
    },
    children: {
      A_bb: ['Two_gb', 'Via_gb'],
      B_bb: ['Two_gb', 'Via_gb', 'Cyc1_gb', 'Cyc2_gb'],
      A2_bb: ['Near_gb'],
      Near_gb: ['ViaW_wb'],
      Via_gb: ['W_wb', 'ViaW_wb'],
    },
    orphans: ['Orphan_gb', 'Skip_wb'],     // a blackbox is no graybox
  });
});

test('the projects\' families', async () => {
  const faults = familiesOf(readFacts(await openModel(projectSources('faults'))));
  assert.deepEqual(faults.orphans, ['Loose_gb', 'Loose_wb']);
  assert.deepEqual(faults.children['Pump_bb'], ['Pump_gb', 'Pump_spare_gb']);

  const variants = familiesOf(readFacts(await openModel(projectSources('variants'))));
  assert.deepEqual(variants.orphans, []);
  assert.deepEqual(variants.children['Mk2_bb'], ['Mk1_gb', 'Mk2_gb']);
  assert.deepEqual(variants.children['Mk2_gb'], ['Mk1_wb', 'Mk2_wb']);
  assert.equal(variants.children['Mk1_bb'], undefined);

  const rover = familiesOf(readFacts(await openModel(projectSources('rover'))));
  assert.deepEqual(rover.orphans, []);
  assert.deepEqual(rover.children['Drive_bb']?.sort(), ['Drive_Tracks_gb', 'Drive_gb']);
  assert.deepEqual(rover.children['Drive_gb'], ['Drive_wb']);
});
