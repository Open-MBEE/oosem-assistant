import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_VOCABULARY, escapeName, escapeQualifiedName, mergeVocabulary, phaseQualifiedNames, phaseRank, qualify, segments } from './vocabulary.ts';

test('the defaults are the renamed library', () => {
  assert.equal(DEFAULT_VOCABULARY.root, 'RecursiveDecompositionPattern');
  assert.deepEqual(phaseQualifiedNames(DEFAULT_VOCABULARY, 'graybox'), {
    concept: 'RecursiveDecompositionPattern::Concepts::Graybox',
    collection: 'RecursiveDecompositionPattern::Concepts::grayboxes',
    metadata: 'RecursiveDecompositionPattern::Metadata::GrayboxMetadata',
  });
  assert.equal(DEFAULT_VOCABULARY.whitebox.suffix, '_wb');
});

test('a partial vocabulary falls back to the defaults, key by key', () => {
  const vocabulary = mergeVocabulary({ root: 'Recursive Decomposition Pattern', graybox: { suffix: '_g' } });
  assert.equal(vocabulary.root, 'Recursive Decomposition Pattern');
  assert.equal(vocabulary.conceptsPackage, 'Concepts');
  assert.deepEqual(vocabulary.graybox, { ...DEFAULT_VOCABULARY.graybox, suffix: '_g' });
  assert.deepEqual(vocabulary.blackbox, DEFAULT_VOCABULARY.blackbox);
  assert.deepEqual(mergeVocabulary(), DEFAULT_VOCABULARY);
  assert.notEqual(mergeVocabulary().blackbox, DEFAULT_VOCABULARY.blackbox);  // a copy, not the defaults
});

test('names are escaped as KerML escapedName spells them', () => {
  assert.equal(escapeName('Quadcopter_bb'), 'Quadcopter_bb');
  assert.equal(escapeName('_x1'), '_x1');
  assert.equal(escapeName('Recursive Decomposition Pattern'), "'Recursive Decomposition Pattern'");
  assert.equal(escapeName('1st'), "'1st'");
  assert.equal(escapeName('part'), "'part'");                 // a reserved word
  assert.equal(escapeName("it's"), "'it\\'s'");
  assert.equal(escapeName('a\\b'), "'a\\\\b'");
  assert.equal(escapeName('tab\there'), "'tab\\there'");
  assert.equal(escapeName('Größe'), "'Größe'");               // not a basic name
});

test('an unrestricted root gives quoted qualified names', () => {
  const vocabulary = mergeVocabulary({ root: 'Recursive Decomposition Pattern' });
  assert.equal(phaseQualifiedNames(vocabulary, 'blackbox').concept, "'Recursive Decomposition Pattern'::Concepts::Blackbox");
  assert.equal(qualify('A', 'b c'), "A::'b c'");
});

test('phases are ordered', () => {
  assert.ok(phaseRank('blackbox') < phaseRank('graybox') && phaseRank('graybox') < phaseRank('whitebox'));
});

test('qualified names split into segments, quotes respected', () => {
  assert.deepEqual(segments('A::B'), ['A', 'B']);
  assert.deepEqual(segments("A::'b::c'::d"), ['A', "'b::c'", 'd']);
  assert.deepEqual(segments("'it\\'s'::x"), ["'it\\'s'", 'x']);
  assert.deepEqual(segments('Solo'), ['Solo']);
});

test('a qualified name from the SysML Toolkit is escaped segment by segment', () => {
  assert.equal(escapeQualifiedName('P::part'), "P::'part'");
  assert.equal(escapeQualifiedName("'Big Pack'::Q"), "'Big Pack'::Q");
});
