import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from './classify.ts';
import { mergeExtensions } from './extensions.ts';
import { readFacts } from './facts.ts';
import type { Facts } from './facts.ts';
import { blockFamilies } from './families.ts';
import { catalog } from './features.ts';
import { graph } from './graph.ts';
import { messages } from './messages.ts';
import { projectSources, fixture, openModel } from './test/models.ts';
import type { Extensions } from './types.ts';
import { validate } from './validate.ts';
import { DEFAULT_VOCABULARY, mergeVocabulary } from './vocabulary.ts';

const run = (facts: Facts, extensions: Partial<Extensions> = {}, vocabulary = DEFAULT_VOCABULARY) => {
  const ext = mergeExtensions(extensions);
  const c = classify(facts, vocabulary);
  const k = catalog(facts, c, ext);
  return validate(facts, c, k, blockFamilies(c, k), graph(facts, c, k), messages(vocabulary, ext));
};
// findings as 'R5 error Block::feature', by block name
const brief = (facts: Facts, result: ReturnType<typeof run>) => Object.fromEntries([...result.byBlock]
  .filter(([, list]) => list.length)
  .map(([b, list]) => [facts.elements.get(b)?.name, list.map((f) => `${f.rule} ${f.severity} ${f.target.qualifiedName?.replace(/^\w+::/, '')}`)]));

const rules = readFacts(await fixture(`
package P {
  #blackbox part def S_bb;
  #graybox part def S_gb :> S_bb;
  #whitebox part def S_wb :> S_gb;

  #blackbox part def Ok_bb { part plain; }
  #blackbox part def Sub_bb { part s : S_bb; }
  #blackbox part def Mis_bb { #graybox part g; }
  #graybox part def Orphan_gb;
  #whitebox part def Orphan_wb :> Ok_bb;
  #graybox part def Ok_gb :> Ok_bb { part s : S_bb; part plain; }
  #graybox part def In_gb :> Ok_gb;
  #graybox part def Mis_gb :> Ok_bb { part s : S_gb; #graybox part m; }
  #graybox part def Sub_gb :> Sub_bb { part d :>> s : S_gb; }
  #whitebox part def Ok_wb :> Ok_gb { part c :>> s : S_wb; }
  #whitebox part def Uni_wb :> Ok_gb;
  #whitebox part def Bb_wb :> Ok_gb { part c :>> s : S_bb; }
  #whitebox part def Mis_wb :> Ok_gb { part c :>> s : S_gb; part n : S_bb; }
  #graybox part def Two_gb :> Ok_bb { part s : S_bb; part t : S_bb; }
  #whitebox part def Several_wb :> Two_gb { part c :>> s, t : S_wb; }
}`));

test('each rule, and the blocks that pass', () => {
  const result = run(rules);
  assert.deepEqual(brief(rules, result), {
    Sub_bb: ['R12 error Sub_bb', 'R5 error Sub_bb::s'],
    Mis_bb: ['R12 error Mis_bb', 'R6 error Mis_bb::g'],
    Orphan_gb: ['R1 error Orphan_gb'],
    Orphan_wb: ['R2 error Orphan_wb'],              // a blackbox is no graybox
    In_gb: ['R3 error In_gb'],                       // its inherited s is not reported again
    Mis_gb: ['R12 error Mis_gb', 'R8 error Mis_gb::s', 'R8 error Mis_gb::m'],   // new, so misplaced
    Sub_gb: ['R12 error Sub_gb', 'R7 error Sub_gb::d'],     // a held subsystem redefined with a graybox
    Uni_wb: ['R10 warning Uni_wb', 'R10 warning Ok_gb::s'],   // no R12: the feature is inherited
    Bb_wb: ['R12 error Bb_wb', 'R9 error Bb_wb::c'],
    Mis_wb: ['R12 error Mis_wb', 'R11 error Mis_wb::n'],
    Several_wb: ['R10 warning Several_wb', 'R12 warning Several_wb', 'R13 warning Several_wb::c', 'R10 warning Two_gb::t'],
  });
  assert.equal(result.findings.length, [...result.byBlock.values()].flat().length);
});

test('the texts, with the extensions off and on', () => {
  const text = (extensions: Partial<Extensions>) => {
    const all = run(rules, extensions).findings;
    return Object.fromEntries(['R1', 'R2', 'R3', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13']
      .map((rule) => [rule, all.find((f) => f.rule === rule)?.message]));
  };
  assert.deepEqual(text({}), {
    R1: 'Orphan graybox: it specializes no blackbox.',
    R2: 'Orphan whitebox: it specializes no graybox.',
    R3: 'In-phase specialization is not part of OOSEM: In_gb specializes Ok_gb, another graybox.',
    R5: "A blackbox can't have subsystems.",
    R6: 'A blackbox can only contain untracked features.',
    R7: "A graybox's subsystems must be blackboxes.",
    R8: 'A graybox can only contain blackbox subsystems and untracked features.',
    R9: 'A whitebox must realize a subsystem with a graybox or a whitebox, not a blackbox.',
    R10: 'Unintegrated subsystems: s.',
    R11: 'A whitebox can only contain graybox or whitebox subsystems and untracked features.',
    R12: 'Has features with errors.',
    R13: 'Redefines several tracked features; only s is tracked.',
  });
  const on = text({ properties: true, inPhaseSpecialization: true });
  assert.equal(on['R3'], 'In-phase specialization is not supported yet: In_gb specializes Ok_gb, another graybox.');
  assert.equal(on['R5'], undefined);                 // Sub_bb's s is a property
  assert.equal(on['R6'], 'A blackbox can only contain blackbox properties and untracked features.');
  assert.equal(on['R8'], 'A graybox can only contain graybox properties, blackbox subsystems and untracked features.');
  assert.equal(on['R11'], 'A whitebox can only contain whitebox properties, graybox or whitebox subsystems and untracked features.');
});

test('the texts follow renamed labels', () => {
  const vocabulary = mergeVocabulary({ blackbox: { label: 'Specification' }, graybox: { label: 'Design' }, whitebox: { label: 'Integration' } });
  const all = run(rules, {}, vocabulary).findings;
  assert.equal(all.find((f) => f.rule === 'R7')?.message, "A design's subsystems must be specifications.");
  assert.equal(all.find((f) => f.rule === 'R9')?.message, 'An integration must realize a subsystem with a design or an integration, not a specification.');
});

test('a specialization cycle', async () => {
  const facts = readFacts(await fixture(`
package P {
  #blackbox part def A_bb;
  #graybox part def C1_gb :> C2_gb, A_bb;
  #graybox part def C2_gb :> C1_gb;
}`));
  const result = run(facts);
  const r4 = result.findings.filter((f) => f.rule === 'R4');
  assert.deepEqual(r4.map((f) => f.target.qualifiedName), ['P::C1_gb', 'P::C2_gb']);
  assert.equal(r4[0]?.message, 'Specialization cycle: C1_gb → C2_gb → C1_gb.');
  assert.deepEqual(r4[0]?.related?.map((r) => r.qualifiedName), ['P::C1_gb', 'P::C2_gb']);
});

test('the faults project: one finding of each kind', async () => {
  const facts = readFacts(await openModel(projectSources('faults')));
  assert.deepEqual(brief(facts, run(facts)), {
    Valve_bb: ['R12 error Valve_bb', 'R6 error Valve_bb::seat'],
    Valve_gb: ['R12 error Valve_gb', 'R8 error Valve_gb::stem'],
    Loose_gb: ['R1 error Loose_gb'],
    Loose_wb: ['R2 error Loose_wb'],
    Rotor_wb: ['R10 warning Rotor_wb', 'R10 warning Rotor_gb::bearing'],
    Pump_wb: ['R12 error Pump_wb', 'R11 error Pump_wb::spare', 'R11 error Pump_wb::extra'],
  });
});

test('the variants project, with properties and without', async () => {
  const facts = readFacts(await openModel(projectSources('variants')));
  assert.deepEqual(brief(facts, run(facts, { properties: true })), {
    Mk2_bb: ['R3 error Mk2_bb'], Mk2_gb: ['R3 error Mk2_gb'], Mk2_wb: ['R3 error Mk2_wb'],
  });
  assert.deepEqual(brief(facts, run(facts)), {
    Mk1_bb: ['R12 error Mk1_bb', 'R5 error Mk1_bb::gear'],
    Mk2_bb: ['R3 error Mk2_bb'],
    Mk1_gb: ['R12 error Mk1_gb', 'R7 error Mk1_gb::gearSet'],
    Mk2_gb: ['R3 error Mk2_gb'],
    Mk2_wb: ['R3 error Mk2_wb'],
  });
});

test('the rover has no findings', async () => {
  const facts = readFacts(await openModel(projectSources('rover')));
  assert.deepEqual(run(facts).findings, []);
});
