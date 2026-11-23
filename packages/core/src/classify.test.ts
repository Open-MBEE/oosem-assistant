import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from './classify.ts';
import { readFacts } from './facts.ts';
import type { Facts } from './facts.ts';
import { fixture, openModel } from './test/models.ts';
import { DEFAULT_VOCABULARY, mergeVocabulary } from './vocabulary.ts';

const id = (facts: Facts, qualifiedName: string) => {
  const found = facts.resolve(qualifiedName);
  assert.ok(found, `no element ${qualifiedName}`);
  return found;
};

const facts = readFacts(await fixture(`
package P {
  private import RecursiveDecompositionPattern::Concepts::*;
  #blackbox part def Prefix;
  part def Body { @graybox; }
  part def Keyword { metadata whitebox; }
  part def Concept :> Whitebox;
  part def Plain;
  part def ViaPlain :> Middle;
  part def Middle :> Prefix;
  #blackbox part def Both :> Keyword;      // the most specific source wins
  #graybox part def Pair :> Prefix, Body;

  part def CycleA :> CycleB { @graybox; }
  part def CycleB :> CycleA;

  #blackbox part s1;
  part s2 : Body;
  part s3 :> blackboxes;
  part s4 :> s3;
  part s5 : Plain;
  part s6 : Plain :>> s2;
  #blackbox attribute def NotOccurrence;
  library package Supplier { #whitebox part def Shared :> Body; }
}`));
const c = classify(facts, DEFAULT_VOCABULARY);
const phaseOf = (name: string) => c.typePhase(id(facts, `P::${name}`));
const featureOf = (name: string) => c.featurePhase(id(facts, `P::${name}`));

test('a type takes its phase from its owned metadata, in each spelling', () => {
  assert.equal(phaseOf('Prefix'), 'blackbox');
  assert.equal(phaseOf('Body'), 'graybox');
  assert.equal(phaseOf('Keyword'), 'whitebox');
  assert.equal(phaseOf('Plain'), null);
});

test('a type takes its phase from its written supertypes, recursively', () => {
  assert.equal(phaseOf('Concept'), 'whitebox');
  assert.equal(phaseOf('Middle'), 'blackbox');
  assert.equal(phaseOf('ViaPlain'), 'blackbox');
  assert.equal(phaseOf('Both'), 'whitebox');
  assert.equal(phaseOf('Pair'), 'graybox');
});

test('a specialization cycle terminates, and gives the same phase whichever is asked first', () => {
  assert.equal(phaseOf('CycleB'), 'graybox');
  assert.equal(phaseOf('CycleA'), 'graybox');
  const other = classify(facts, DEFAULT_VOCABULARY);
  assert.equal(other.typePhase(id(facts, 'P::CycleA')), 'graybox');
  assert.equal(other.typePhase(id(facts, 'P::CycleB')), 'graybox');
});

test('a feature takes its phase from metadata, typings, subsettings and redefinitions', () => {
  assert.equal(featureOf('s1'), 'blackbox');
  assert.equal(featureOf('s2'), 'graybox');
  assert.equal(featureOf('s3'), 'blackbox');      // a vocabulary collection
  assert.equal(featureOf('s4'), 'blackbox');      // through s3
  assert.equal(featureOf('s5'), null);
  assert.equal(featureOf('s6'), 'graybox');       // through the redefined s2
  assert.equal(c.collectionPhase(id(facts, 'P::s3')), 'blackbox');
  assert.equal(c.collectionPhase(id(facts, 'P::s4')), null);
});

test('blocks are occurrence definitions with a phase, outside the root package', () => {
  const blocks = new Set(c.blocks.map((b) => facts.elements.get(b)?.qualifiedName));
  for (const name of ['Prefix', 'Body', 'Keyword', 'Concept', 'Middle', 'ViaPlain', 'Both', 'Pair', 'CycleA', 'CycleB', 'Supplier::Shared']) {
    assert.ok(blocks.has(`P::${name}`), name);
  }
  assert.ok(!blocks.has('P::Plain'));
  assert.ok(!blocks.has('P::NotOccurrence'));
  assert.ok(![...blocks].some((b) => b?.startsWith('RecursiveDecompositionPattern::')));
  assert.equal(c.inRoot(id(facts, 'RecursiveDecompositionPattern::Concepts::Graybox')), true);
  assert.equal(c.libraryFound, true);
});

test('without the library nothing has a phase', async () => {
  const bare = readFacts(await openModel({ 'a.sysml': 'package P { part def A; }' }, { library: false }));
  const none = classify(bare, DEFAULT_VOCABULARY);
  assert.equal(none.libraryFound, false);
  assert.deepEqual(none.blocks, []);
});

test('an unrestricted root name', async () => {
  const library = `library package 'Recursive Decomposition Pattern' {
    library package Concepts { abstract occurrence def Blackbox; abstract occurrence blackboxes : Blackbox[*] nonunique; }
  }`;
  const model = await openModel({
    'lib.sysml': library,
    'a.sysml': "package P { part def A :> 'Recursive Decomposition Pattern'::Concepts::Blackbox; }",
  }, { library: false });
  const quoted = readFacts(model);
  const result = classify(quoted, mergeVocabulary({ root: 'Recursive Decomposition Pattern' }));
  assert.equal(result.libraryFound, true);
  assert.equal(result.typePhase(id(quoted, 'P::A')), 'blackbox');
});
