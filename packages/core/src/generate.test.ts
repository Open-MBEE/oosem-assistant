import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, dashboard, generate } from './index.ts';
import type { Analysis, GenerationRequest, GenerationResult } from './index.ts';
import { openModel, projectSources } from './test/models.ts';
import { check } from './test/schema.ts';

const rover = projectSources('rover');
const analysis = analyze(await openModel(rover));

// the generated unit added to the model, analyzed again
const reanalyze = async (sources: Record<string, string>, result: GenerationResult) => {
  assert.ok(result.ok, result.ok ? '' : result.problems.join('\n'));
  return analyze(await openModel({ ...sources, [result.unit]: result.text }));
};
const problems = (a: Analysis, request: GenerationRequest, checks?: Parameters<typeof generate>[2]) => {
  const result = generate(a, request, checks);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.problems;
};
const block = (a: Analysis, name: string) => {
  const found = a.blocks.find((b) => b.name === name);
  assert.ok(found, `no block ${name}`);
  return found;
};

test('a graybox', async () => {
  const request: GenerationRequest = { kind: 'graybox', subject: 'Rover_gb::Chassis_bb', name: 'Chassis_gb2', folder: 'new/' };
  const result = generate(analysis, request);
  assert.deepEqual(check('GenerationResult', result), []);
  assert.deepEqual(result, {
    ok: true,
    unit: 'new/Chassis_gb2.sysml',
    text: [
      'package Chassis_gb2 {',
      '    private import RecursiveDecompositionPattern::Metadata::*;',
      '    private import Rover_gb::*;',
      '',
      '    #graybox part def Chassis_gb2 :> Chassis_bb {',
      '        //TODO: Auto-generated block skeleton',
      '    }',
      '}',
      '',
    ].join('\n'),
    newBlocks: ['Chassis_gb2::Chassis_gb2'],
  });
  const after = await reanalyze(rover, result);
  assert.deepEqual(after.findings, []);
  const column = dashboard(after).columns[1].groups.find((g) => g.title === 'Grayboxes of Chassis_bb');
  assert.deepEqual(column?.rows.map((r) => dashboard(after).blocks[r]?.name), ['Chassis_gb', 'Chassis_gb2']);
});

test('a whitebox: realizations, a stub with a new name, an unintegrated subsystem', async () => {
  const usage = (name: string) => `Rover_gb::Rover_gb::${name}`;
  const result = generate(analysis, {
    kind: 'whitebox', subject: 'Rover_gb::Rover_gb', name: 'Rover_wb2', folder: '',
    subsystems: [
      { usage: usage('nav'), choice: { realizeWith: 'Navigation_gb::Navigation_gb' } },
      { usage: usage('chassis'), choice: { realizeWith: 'Chassis_wb::Chassis_wb' } },
      { usage: usage('power'), choice: { stub: 'Power_gb2' }, newName: 'battery' },
      { usage: usage('drive'), choice: { unintegrated: true } },
    ],
  });
  assert.ok(result.ok);
  assert.equal(result.unit, 'Rover_wb2.sysml');
  assert.deepEqual(result.newBlocks, ['Rover_wb2::Rover_wb2', 'Rover_wb2::Power_gb2']);
  assert.equal(result.text, [
    'package Rover_wb2 {',
    '    private import RecursiveDecompositionPattern::Metadata::*;',
    '    private import Rover_gb::*;',
    '    private import Chassis_wb::*;',
    '    private import Navigation_gb::*;',
    '',
    '    #whitebox part def Rover_wb2 :> Rover_gb {',
    '        #whitebox part :>> chassis : Chassis_wb;',          // in the graybox's order
    '        #graybox part battery :>> power : Power_gb2;',
    '        #graybox part :>> nav : Navigation_gb;',
    '        //TODO: Auto-generated block skeleton',
    '    }',
    '',
    '    #graybox part def Power_gb2 :> Power_bb {',
    '        //TODO: Auto-generated block skeleton',
    '    }',
    '}',
    '',
  ].join('\n'));

  const after = await reanalyze(rover, result);
  assert.deepEqual(after.findings.map((f) => f.rule), ['R10', 'R10']);     // drive, left unintegrated
  const roles = block(after, 'Rover_wb2').features.filter((f) => f.role !== 'untracked').map((f) => `${f.name} ${f.role}`);
  assert.deepEqual(roles, ['chassis choice', 'drive subsystem', 'battery choice', 'nav choice']);
  assert.equal(block(after, 'Power_gb2').phase, 'graybox');
  assert.ok(after.edges.some((e) => e.kind === 'phase' && e.from === block(after, 'Power_gb2').ref.id
    && e.to === block(after, 'Power_bb').ref.id));
});

test('[1] for a 0..1 subsystem, and escaped names', async () => {
  const sources = {
    'a.sysml': `private import RecursiveDecompositionPattern::Metadata::*;
package 'Big Pack' {
  #blackbox part def 'Sub bb';
  #graybox part def Sub_gb :> 'Sub bb';
  #blackbox part def Top_bb;
  #graybox part def 'Top gb' :> Top_bb { part 'the sub' : 'Sub bb'[0..1]; part other : 'Sub bb'; }
}`,
  };
  const before = analyze(await openModel(sources));
  const result = generate(before, {
    kind: 'whitebox', subject: "'Big Pack'::'Top gb'", name: 'part', folder: 'x',
    subsystems: [
      { usage: "'Big Pack'::'Top gb'::'the sub'", choice: { realizeWith: "'Big Pack'::Sub_gb" } },
      { usage: "'Big Pack'::'Top gb'::other", choice: { stub: 'new stub' }, newName: "it's" },
    ],
  });
  assert.ok(result.ok);
  assert.deepEqual(result.text.split('\n').filter((l) => /import|def|:>>/.test(l)), [
    "package 'part' {",
    "    private import 'Big Pack'::*;",
    "    #whitebox part def 'part' :> 'Top gb' {",
    "        #graybox part :>> 'the sub'[1] : Sub_gb;",
    "        #graybox part 'it\\'s' :>> other : 'new stub';",
    "    #graybox part def 'new stub' :> 'Sub bb' {",
  ].filter((l) => !l.startsWith('package')).toSpliced(0, 0, '    private import RecursiveDecompositionPattern::Metadata::*;'));
  assert.equal(result.unit, 'x/part.sysml');
  const after = await reanalyze(sources, result);
  assert.deepEqual(after.findings, []);
  assert.deepEqual(block(after, 'part').features.map((f) => `${f.name} ${f.role}`), ['the sub choice', "it's choice"]);
});

test('choice lines and stubs take the subsystem usage\'s kind, not the subject\'s; a ref takes its type\'s', async () => {
  const sources = {
    'a.sysml': `private import RecursiveDecompositionPattern::Metadata::*;
package P {
  #blackbox item def Cargo_bb;
  #graybox item def Cargo_gb :> Cargo_bb;
  #blackbox port def Plug_bb;
  #blackbox part def Box_bb;
  #blackbox part def Top_bb;
  #graybox part def Top_gb :> Top_bb { item cargo : Cargo_bb; port plug : Plug_bb; box : Box_bb; }
}`,
  };
  const before = analyze(await openModel(sources));
  assert.deepEqual(block(before, 'Top_gb').features.map((f) => `${f.name} ${f.keyword}`), ['cargo item', 'plug port', 'box ref']);
  const result = generate(before, {
    kind: 'whitebox', subject: 'P::Top_gb', name: 'Top_wb', folder: '',
    subsystems: [
      { usage: 'P::Top_gb::cargo', choice: { realizeWith: 'P::Cargo_gb' } },
      { usage: 'P::Top_gb::plug', choice: { stub: 'Plug_gb' } },
      { usage: 'P::Top_gb::box', choice: { stub: 'Box_gb' } },
    ],
  });
  assert.ok(result.ok);
  assert.deepEqual(result.text.split('\n').filter((l) => /def|:>>/.test(l)), [
    '    #whitebox part def Top_wb :> Top_gb {',
    '        #graybox item :>> cargo : Cargo_gb;',
    '        #graybox port :>> plug : Plug_gb;',
    '        #graybox part :>> box : Box_gb;',
    '    #graybox port def Plug_gb :> Plug_bb {',
    '    #graybox part def Box_gb :> Box_bb {',
  ]);
  const after = await reanalyze(sources, result);
  assert.deepEqual(after.findings, []);
  assert.deepEqual(block(after, 'Top_wb').features.map((f) => `${f.name} ${f.keyword} ${f.role}`),
    ['cargo item choice', 'plug port choice', 'box part choice']);
});

test('problems: the subject, the names, the unit', () => {
  const graybox = (subject: string, name = 'X_gb') => ({ kind: 'graybox' as const, subject, name, folder: 'f' });
  assert.deepEqual(problems(analysis, graybox('Nothing::Here')), ['No block Nothing::Here in the model.']);
  assert.deepEqual(problems(analysis, graybox('Chassis_gb::Chassis_gb')), ['Chassis_gb is not a blackbox.']);
  assert.deepEqual(problems(analysis, graybox('Rover_gb::Chassis_bb', ' ')), ['A name is empty.']);
  assert.deepEqual(problems(analysis, graybox('Rover_gb::Chassis_bb', 'a/b')), ["a/b can't be a file name: it contains / or \\."]);
  assert.deepEqual(problems(analysis, graybox('Rover_gb::Chassis_bb', 'Drive_gb')),
    ['Drive_gb is taken: a block or a file of that name exists.']);
  assert.deepEqual(problems(analysis, graybox('Rover_gb::Chassis_bb'), { unitExists: (u) => u === 'f/X_gb.sysml', fileTaken: () => true }),
    ['X_gb is taken: a block or a file of that name exists.', 'f/X_gb.sysml already exists.']);
  const graybox_ = { ...graybox('Rover_gb::Chassis_bb'), subsystems: [] };
  assert.equal(generate(analysis, graybox_).ok, true);      // an empty list is no choice
  const withChoices = { ...graybox_, subsystems: [{ usage: 'x', choice: { unintegrated: true as const } }] };
  assert.deepEqual(problems(analysis, withChoices), ['Only a new whitebox chooses for subsystems.']);
});

test('problems: a subject that does not pass', async () => {
  const faults = analyze(await openModel(projectSources('faults')));
  assert.deepEqual(problems(faults, { kind: 'graybox', subject: 'FaultTest::Valve_bb', name: 'N_gb', folder: '' }),
    ['Valve_bb has problems to fix first: Has features with errors.']);
});

test('problems: the choices', () => {
  const usage = (name: string) => `Rover_gb::Rover_gb::${name}`;
  const whitebox = (subsystems: NonNullable<GenerationRequest['subsystems']>): GenerationRequest =>
    ({ kind: 'whitebox', subject: 'Rover_gb::Rover_gb', name: 'R_wb', folder: '', subsystems });
  const rest = ['drive', 'power', 'nav'].map((u) => ({ usage: usage(u), choice: { unintegrated: true as const } }));
  assert.deepEqual(problems(analysis, whitebox(rest)), ['No choice for the subsystem chassis.']);
  assert.deepEqual(problems(analysis, whitebox([...rest, { usage: usage('chassis'), choice: { unintegrated: true } }, { usage: usage('chassis'), choice: { unintegrated: true } }])),
    ['More than one choice for the subsystem chassis.']);
  assert.deepEqual(problems(analysis, whitebox([...rest, { usage: usage('chassis'), choice: { unintegrated: true } }, { usage: 'Drive_gb::Drive_gb::x', choice: { unintegrated: true } }])),
    ['Drive_gb::Drive_gb::x is not a subsystem of Rover_gb.']);
  assert.deepEqual(problems(analysis, whitebox([...rest, { usage: usage('chassis'), choice: { realizeWith: 'Power_wb::Power_wb' } }])),
    ["Power_wb can't realize chassis: it is no graybox or whitebox of Chassis_bb."]);
  assert.deepEqual(problems(analysis, whitebox([...rest, { usage: usage('chassis'), choice: { realizeWith: 'Rover_gb::Chassis_bb' } }])),
    ["Chassis_bb can't realize chassis: it is no graybox or whitebox of Chassis_bb."]);
  const twoStubs = whitebox([
    ...rest.slice(1),
    { usage: usage('chassis'), choice: { stub: 'S_gb' }, newName: 'n' },
    { usage: usage('drive'), choice: { stub: 'S_gb' }, newName: 'n' },
  ]);
  assert.deepEqual(problems(analysis, twoStubs), ['The name n is given twice.', 'The name S_gb is given twice.']);
});

test('problems: no qualified name, and a simple name two imports share', () => {
  const unnamed = structuredClone(analysis);
  block(unnamed, 'Chassis_bb').ref.qualifiedName = null;
  assert.deepEqual(problems(unnamed, { kind: 'graybox', subject: block(unnamed, 'Chassis_bb').ref.id, name: 'C_gb', folder: '' }),
    ['Chassis_bb has no qualified name: an owner is unnamed, or a name is not unique.']);

  const clash = structuredClone(analysis);
  const other = structuredClone(block(clash, 'Chassis_bb'));
  other.ref = { id: 'other', qualifiedName: 'Chassis_wb::Rover_gb' };
  other.name = 'Rover_gb';
  clash.blocks.push(other);           // Chassis_wb::* would bring a second Rover_gb
  const result = generate(clash, {
    kind: 'whitebox', subject: 'Rover_gb::Rover_gb', name: 'R_wb', folder: '',
    subsystems: ['chassis', 'drive', 'power', 'nav'].map((u) => ({
      usage: `Rover_gb::Rover_gb::${u}`,
      choice: u === 'chassis' ? { realizeWith: 'Chassis_wb::Chassis_wb' } : { unintegrated: true as const },
    })),
  });
  assert.deepEqual(result, { ok: false, problems: ['Two blocks named Rover_gb would be imported: Rover_gb::Rover_gb, Chassis_wb::Rover_gb.'] });
});

test('generation reproduces the rover\'s whiteboxes from their grayboxes', async () => {
  const normal = (text: string) => text.split('\n').filter((l) => !l.includes('//TODO')).join('').replace(/\s+/g, '');
  const files = Object.keys(rover).filter((f) => f.endsWith('_wb.sysml'));
  assert.equal(files.length, 4);
  for (const file of files) {
    const name = file.replace(/\.sysml$/, '');
    const original = block(analysis, name);
    const subject = analysis.edges.find((e) => e.kind === 'phase' && e.from === original.ref.id)!.to;
    const subsystems = original.features.flatMap((f): NonNullable<GenerationRequest['subsystems']> => {
      if (f.role === 'choice') {
        const chosen = f.types.find((t) => analysis.blocks.some((b) => b.ref.id === t.id))!;
        const usage = f.redefines!;
        const redefinedName = analysis.blocks.flatMap((b) => b.features).find((g) => g.ref.id === usage.id)?.name;
        return [{ usage: usage.id, choice: { realizeWith: chosen.qualifiedName! }, ...(f.name !== redefinedName ? { newName: f.name! } : {}) }];
      }
      return f.role === 'subsystem' && f.inheritedFrom !== null ? [{ usage: f.ref.id, choice: { unintegrated: true as const } }] : [];
    });
    const { [file]: _, ...without } = rover;
    const result = generate(analyze(await openModel(without)), { kind: 'whitebox', subject, name, folder: '', subsystems });
    assert.ok(result.ok, `${name}: ${result.ok ? '' : result.problems.join('; ')}`);
    assert.equal(normal(result.text), normal(rover[file]!), name);
  }
});
