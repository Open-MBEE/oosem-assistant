import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Model } from 'sysml';
import type { ToolkitBackend } from 'sysml';
import { keywordOf, readFacts } from './facts.ts';
import type { Facts } from './facts.ts';
import { fixture, openModel } from './test/models.ts';

const named = (facts: Facts, ids: string[]) => ids.map((id) => facts.elements.get(id)?.name);
const typeNamed = (facts: Facts, qualifiedName: string) => {
  const fact = facts.types.get(facts.resolve(qualifiedName) ?? '');
  assert.ok(fact, `no type ${qualifiedName}`);
  return fact;
};
const featureNamed = (facts: Facts, qualifiedName: string) => {
  const fact = facts.features.get(facts.resolve(qualifiedName) ?? '');
  assert.ok(fact, `no feature ${qualifiedName}`);
  return fact;
};

const facts = readFacts(await fixture(`
package P {
  #blackbox part def A {
    #blackbox part s : B[0..1];
    attribute n[4];
    port q[*];
  }
  part def B;
  #graybox part def G :> A {
    part t : B :> s;
    doc /* not a feature */
  }
  #graybox part def K :> A {
    part :>> s : B;
  }
  part def H { @graybox; }
  item def I { metadata whitebox; }
  part def J :> Missing;
  attribute def N;
  part x : Missing;
}`));

test('owned metadata usages give their definitions, in each spelling', () => {
  assert.deepEqual(named(facts, typeNamed(facts, 'P::A').metadata), ['BlackboxMetadata']);
  assert.deepEqual(named(facts, typeNamed(facts, 'P::H').metadata), ['GrayboxMetadata']);
  assert.deepEqual(named(facts, typeNamed(facts, 'P::I').metadata), ['WhiteboxMetadata']);
  assert.deepEqual(typeNamed(facts, 'P::B').metadata, []);
  assert.deepEqual(named(facts, featureNamed(facts, 'P::A::s').metadata), ['BlackboxMetadata']);
});

test('written supertypes only; the implied ones are left out', () => {
  assert.deepEqual(named(facts, typeNamed(facts, 'P::G').supertypes), ['A']);
  assert.deepEqual(typeNamed(facts, 'P::B').supertypes, []);   // Parts::Part is implied
});

test('owned features, without metadata usages and comments', () => {
  assert.deepEqual(named(facts, typeNamed(facts, 'P::A').features), ['s', 'n', 'q']);
  assert.equal(typeNamed(facts, 'P::G').features.length, 1);
  assert.deepEqual(typeNamed(facts, 'P::H').features, []);
});

test('typings, subsettings and redefinitions, kept apart', () => {
  const t = featureNamed(facts, 'P::G::t');
  const r = facts.features.get(typeNamed(facts, 'P::K').features[0] ?? '');
  assert.ok(r);
  assert.deepEqual(named(facts, t.types), ['B']);
  assert.deepEqual(named(facts, t.subsets), ['s']);
  assert.deepEqual(t.redefines, []);
  assert.equal(r.name, null);                   // `:>> s` declares no name
  assert.deepEqual(named(facts, r.redefines), ['s']);
  assert.deepEqual(r.subsets, []);
  assert.equal(r.usage, true);
});

test('multiplicities with literal bounds', () => {
  assert.deepEqual(featureNamed(facts, 'P::A::s').multiplicity, { lower: 0, upper: 1 });
  assert.deepEqual(featureNamed(facts, 'P::A::n').multiplicity, { lower: 4, upper: 4 });
  assert.deepEqual(featureNamed(facts, 'P::A::q').multiplicity, { lower: 0, upper: null });
  assert.equal(featureNamed(facts, 'P::G::t').multiplicity, null);
});

test('occurrence definitions are told apart', () => {
  assert.equal(typeNamed(facts, 'P::A').occurrenceDefinition, true);
  assert.equal(typeNamed(facts, 'P::I').occurrenceDefinition, true);   // an item definition
  assert.equal(facts.types.has(facts.resolve('P') ?? ''), false);       // a package is no type
  assert.equal(typeNamed(facts, 'P::N').occurrenceDefinition, false);    // an attribute definition
});

test('unresolved references contribute nothing', () => {
  assert.deepEqual(typeNamed(facts, 'P::J').supertypes, []);
  assert.deepEqual(featureNamed(facts, 'P::x').types, []);
});

test('owners, library flags and lookups', () => {
  const a = typeNamed(facts, 'P::A');
  assert.equal(facts.elements.get(a.owner ?? '')?.name, 'P');
  assert.equal(a.library, false);
  assert.equal(typeNamed(facts, 'RecursiveDecompositionPattern::Concepts::Blackbox').library, true);
  assert.equal(facts.resolve('P::Nothing'), null);
});

test('definition and usage keywords from their metaclasses', () => {
  assert.equal(keywordOf('PartDefinition'), 'part');
  assert.equal(keywordOf('ItemUsage'), 'item');
  assert.equal(keywordOf('PortUsage'), 'port');
  assert.equal(keywordOf('ReferenceUsage'), 'ref');
  assert.equal(keywordOf('BindingConnectorAsUsage'), 'binding');
  assert.equal(keywordOf('Usage'), '');
  assert.equal(keywordOf('OccurrenceDefinition'), 'occurrence');
  assert.equal(keywordOf('CalculationDefinition'), 'calc');
  assert.equal(keywordOf('UseCaseDefinition'), 'use case');
  assert.equal(keywordOf('AnalysisCaseDefinition'), 'analysis');
});

test('a reference to the wrong kind of element contributes nothing, through either backend', async () => {
  const model = await openModel({ 'a.sysml': 'package P { part def A :> P; part x : P; part def B { part z :>> A; } }' }, { library: false });
  const payload = Model.fromFullJson(JSON.parse((model.backend as ToolkitBackend).fullJson()));
  for (const read of [readFacts(model), readFacts(payload)]) {
    assert.deepEqual(typeNamed(read, 'P::A').supertypes, []);     // the SysML Toolkit refuses the read
    assert.deepEqual(featureNamed(read, 'P::x').types, []);       // a payload returns the package
    assert.deepEqual(featureNamed(read, 'P::B::z').redefines, []);
  }
});
