import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from './classify.ts';
import { mergeExtensions } from './extensions.ts';
import { catalog } from './features.ts';
import type { HeldFeature } from './features.ts';
import { readFacts } from './facts.ts';
import { projectSources, fixture, openModel } from './test/models.ts';
import { DEFAULT_VOCABULARY } from './vocabulary.ts';

const facts = readFacts(await fixture(`
package P {
  #blackbox part def Sub_bb;
  #graybox part def Sub_gb :> Sub_bb;
  #whitebox part def Sub_wb :> Sub_gb;
  part def Plain { part p; }

  #blackbox part def A_bb :> Plain {
    part prop : Sub_bb;
    part plain;
    #graybox part wrong;
    part pb :>> p : Sub_bb;          // redefines what no block holds: a new feature
  }
  #graybox part def A_gb :> A_bb {
    part s : Sub_bb;
    part t : Sub_bb;
    part u : Sub_bb;
    part g : Sub_gb;
    part prop2 :>> prop : Sub_gb;
    part plain2 :>> plain;
  }
  #whitebox part def A_wb :> A_gb {
    part sc :>> s : Sub_wb;
    part tc :>> t : Sub_bb;
    part n : Sub_bb;
  }
  #whitebox part def B_wb :> A_gb {
    part both :>> s, t : Sub_wb;
    part one :>> p, u : Sub_gb;
  }

  #graybox part def C1_gb :> C2_gb, A_bb { part c1 : Sub_bb; }
  part def C2_gb :> C1_gb { part c2 : Sub_bb; }
}`));
const c = classify(facts, DEFAULT_VOCABULARY);
const on = catalog(facts, c, mergeExtensions({ properties: true }));
const off = catalog(facts, c, mergeExtensions());

const id = (name: string) => {
  const found = facts.resolve(`P::${name}`);
  assert.ok(found, `no element P::${name}`);
  return found;
};
const nameOf = (i: string | null) => (i === null ? null : facts.elements.get(i)?.name ?? null);
const held = (from: typeof on, block: string) => from.features.get(id(block)) ?? [];
const roles = (from: typeof on, block: string) => Object.fromEntries(held(from, block).map((f) => [nameOf(f.id), f.role]));
const feature = (from: typeof on, block: string, name: string): HeldFeature => {
  const found = held(from, block).find((f) => nameOf(f.id) === name);
  assert.ok(found, `${block} holds no ${name}`);
  return found;
};

test('a blackbox: a blackbox-phase feature is a property with the extension, a subsystem without', () => {
  assert.deepEqual(roles(on, 'A_bb'), { prop: 'property', plain: 'untracked', wrong: 'misplaced', pb: 'property' });
  assert.deepEqual(roles(off, 'A_bb'), { prop: 'subsystem', plain: 'untracked', wrong: 'misplaced', pb: 'subsystem' });
  assert.equal(feature(on, 'A_bb', 'pb').redefines, null);
});

test('a graybox inherits its parents\' features, and its redefinitions keep their roles', () => {
  assert.deepEqual(roles(on, 'A_gb'), {
    prop2: 'property', plain2: 'untracked', wrong: 'misplaced', pb: 'property',
    s: 'subsystem', t: 'subsystem', u: 'subsystem', g: 'misplaced',
  });
  assert.equal(roles(off, 'A_gb')['prop2'], 'subsystem');     // R7 then: a graybox-phase subsystem
  const wrong = feature(on, 'A_gb', 'wrong');
  assert.equal(wrong.inheritedFrom, id('A_bb'));
  assert.equal(wrong.id, id('A_bb::wrong'));                   // the original declaration
  const prop2 = feature(on, 'A_gb', 'prop2');
  assert.deepEqual([prop2.inheritedFrom, nameOf(prop2.redefines), prop2.phase], [null, 'prop', 'graybox']);
  assert.deepEqual(held(on, 'A_gb').map((f) => nameOf(f.id)), ['prop2', 'plain2', 'wrong', 'pb', 's', 't', 'u', 'g']);
});

test('a whitebox: choices, subsystems redefined with a blackbox, and unredefined subsystems', () => {
  const sc = feature(on, 'A_wb', 'sc');
  assert.deepEqual([sc.role, nameOf(sc.redefines), sc.phase], ['choice', 's', 'whitebox']);
  const tc = feature(on, 'A_wb', 'tc');
  assert.deepEqual([tc.role, tc.phase], ['subsystem', 'blackbox']);   // R9 then
  const u = feature(on, 'A_wb', 'u');
  assert.deepEqual([u.role, u.inheritedFrom], ['subsystem', id('A_gb')]);   // R10 then
  assert.equal(feature(on, 'A_wb', 'n').role, 'misplaced');           // R11 then
  assert.equal(feature(on, 'A_wb', 'pb').inheritedFrom, id('A_gb'));   // the direct parent
});

test('several redefinitions: the first held one is tracked', () => {
  const both = feature(on, 'B_wb', 'both');
  assert.deepEqual([both.role, nameOf(both.redefines), both.alsoRedefines.map(nameOf)], ['choice', 's', ['t']]);
  assert.equal(feature(on, 'B_wb', 't').role, 'subsystem');            // still held
  const one = feature(on, 'B_wb', 'one');                              // p is held by no block
  assert.deepEqual([one.role, nameOf(one.redefines), one.alsoRedefines], ['choice', 'u', []]);
});

test('a specialization cycle is reported, and its members do not inherit from one another', () => {
  assert.deepEqual(on.cycles.map((cy) => [cy.members.map(nameOf), cy.path.map(nameOf)]), [[['C1_gb', 'C2_gb'], ['C1_gb', 'C2_gb']]]);
  assert.deepEqual(held(on, 'C1_gb').map((f) => nameOf(f.id)), ['prop', 'plain', 'wrong', 'pb', 'c1']);
  assert.deepEqual(held(on, 'C2_gb').map((f) => nameOf(f.id)), ['c2']);
});

test('blocks are processed by phase, parents first', () => {
  const order = on.order.map(nameOf);
  assert.deepEqual(order.slice(0, 3), ['Sub_bb', 'A_bb', 'Sub_gb']);
  assert.ok(order.indexOf('A_gb') < order.indexOf('A_wb'));
  assert.ok(order.indexOf('C1_gb') < order.indexOf('A_wb'));
  assert.equal(order.length, c.blocks.length);
  assert.deepEqual(on.parents.get(id('C1_gb'))?.map(nameOf), ['C2_gb', 'A_bb']);
});

test('a block that specializes itself is a cycle of one', async () => {
  const model = await fixture('package Q { #graybox part def S :> S { part x; } }');
  const self = readFacts(model);
  const result = catalog(self, classify(self, DEFAULT_VOCABULARY), mergeExtensions());
  assert.deepEqual(result.cycles.map((cy) => cy.path.map((i) => self.elements.get(i)?.name)), [['S']]);
  assert.equal(result.features.get(self.resolve('Q::S') ?? '')?.length, 1);
});

test('the variants project\'s properties, with the extension and without', async () => {
  const variants = readFacts(await openModel(projectSources('variants')));
  const vc = classify(variants, DEFAULT_VOCABULARY);
  const of = (extensions: { properties: boolean }, block: string) =>
    catalog(variants, vc, mergeExtensions(extensions)).features.get(variants.resolve(`VariantTest::${block}`) ?? '')
      ?.map((f) => [variants.elements.get(f.id)?.name, f.role, f.inheritedFrom === null]);
  assert.deepEqual(of({ properties: true }, 'Mk1_bb'), [['gear', 'property', true]]);
  assert.deepEqual(of({ properties: true }, 'Mk2_wb'), [['gearTrain', 'property', false]]);
  assert.deepEqual(of({ properties: false }, 'Mk1_bb'), [['gear', 'subsystem', true]]);
  assert.deepEqual(of({ properties: false }, 'Mk1_gb'), [['gearSet', 'subsystem', true]]);
  assert.deepEqual(of({ properties: false }, 'Mk1_wb'), [['gearTrain', 'choice', true]]);
});
