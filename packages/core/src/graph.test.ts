import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from './classify.ts';
import { mergeExtensions } from './extensions.ts';
import { readFacts } from './facts.ts';
import type { Facts } from './facts.ts';
import { catalog } from './features.ts';
import { graph } from './graph.ts';
import type { Edge } from './types.ts';
import { projectSources, fixture, openModel } from './test/models.ts';
import { DEFAULT_VOCABULARY } from './vocabulary.ts';

const edgesOf = (facts: Facts) => {
  const c = classify(facts, DEFAULT_VOCABULARY);
  return graph(facts, c, catalog(facts, c, mergeExtensions()));
};
const show = (facts: Facts, edges: Edge[]) => edges.map((e) => {
  const name = (id: string) => facts.elements.get(id)?.name;
  const usage = e.usage ? ` (${e.usage.qualifiedName})` : '';
  return `${name(e.from)} ${e.kind} ${name(e.to)}${usage}`;
});

test('specializations, decompositions and realizations', async () => {
  const facts = readFacts(await fixture(`
package P {
  #blackbox part def S_bb;
  #graybox part def S_gb :> S_bb;
  #whitebox part def S_wb :> S_gb;
  #blackbox part def T_bb;
  part def Plain;
  #blackbox part def Top_bb;
  #graybox part def Top_gb :> Top_bb { part s : S_bb; part t : T_bb, S_bb; part x : Plain; }
  #graybox part def Top2_gb :> Top_gb;
  #whitebox part def Top_wb :> Top_gb { part sc :>> s : S_wb; part tc :>> t : S_gb; part plain :>> x; }
  #whitebox part def Skip_wb :> Top_bb;
}`));
  assert.deepEqual(show(facts, edgesOf(facts)), [
    'S_gb phase S_bb',
    'S_wb phase S_gb',
    'Top_gb phase Top_bb',
    'Top_gb decomposes S_bb (P::Top_gb::s)',
    'Top_gb decomposes T_bb (P::Top_gb::t)',
    'Top_gb decomposes S_bb (P::Top_gb::t)',
    'Top2_gb inPhase Top_gb',
    'Top2_gb decomposes S_bb (P::Top_gb::s)',     // inherited: the original usage
    'Top2_gb decomposes T_bb (P::Top_gb::t)',
    'Top2_gb decomposes S_bb (P::Top_gb::t)',
    'Top_wb phase Top_gb',
    'Top_wb realizes S_wb (P::Top_wb::sc)',
    'Top_wb realizes S_gb (P::Top_wb::tc)',
  ]);
});

test('the rover\'s decompositions and realizations', async () => {
  const facts = readFacts(await openModel(projectSources('rover')));
  const lines = show(facts, edgesOf(facts));
  const of = (from: string, kind: string) => lines.filter((l) => l.startsWith(`${from} ${kind} `)).map((l) => l.split(' ')[2]);
  assert.deepEqual(of('Rover_gb', 'decomposes').sort(), ['Chassis_bb', 'Drive_bb', 'Navigation_bb', 'Power_bb']);
  assert.equal(of('Rover_wb', 'realizes').length, 4);
  assert.deepEqual(of('Drive_gb', 'decomposes'), ['Motor_bb']);
  assert.deepEqual(of('Drive_wb', 'realizes'), ['Motor_gb']);
  assert.deepEqual(of('Drive_Tracks_gb', 'phase'), ['Drive_bb']);
  assert.equal(lines.filter((l) => l.includes(' inPhase ')).length, 0);
});
