import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ajv, check } from './test/schema.ts';
import type { Analysis, DashboardModel, GenerationRequest, GenerationResult, PartialVocabulary } from './types.ts';

const names = (concept: string, collection: string, keyword: string, suffix: string) =>
  ({ concept, collection, metadata: `${concept}Metadata`, keyword, suffix, label: concept });

const vocabulary = {
  root: 'RecursiveDecompositionPattern', conceptsPackage: 'Concepts', metadataPackage: 'Metadata',
  blackbox: names('Blackbox', 'blackboxes', 'blackbox', '_bb'),
  graybox: names('Graybox', 'grayboxes', 'graybox', '_gb'),
  whitebox: names('Whitebox', 'whiteboxes', 'whitebox', '_wb'),
};

const bb = { id: 'b1', qualifiedName: 'Quadcopter_bb::Quadcopter_bb' };
const gb = { id: 'g1', qualifiedName: 'Quadcopter_gb::Quadcopter_gb' };
const usage = { id: 'u1', qualifiedName: 'Quadcopter_gb::Quadcopter_gb::airframe' };

const analysis: Analysis = {
  schemaVersion: 1,
  vocabulary,
  extensions: { properties: false, inPhaseSpecialization: false },
  libraryFound: true,
  blocks: [
    { ref: bb, name: 'Quadcopter_bb', keyword: 'part', phase: 'blackbox', library: false, passes: true, features: [] },
    {
      ref: gb, name: 'Quadcopter_gb', keyword: 'part', phase: 'graybox', library: false, passes: true,
      features: [{
        ref: usage, name: 'airframe', keyword: 'part', role: 'subsystem', phase: 'blackbox', types: [bb],
        redefines: null, inheritedFrom: null, multiplicity: { lower: 0, upper: 1 },
      }],
    },
  ],
  edges: [{ kind: 'phase', from: 'g1', to: 'b1' }, { kind: 'decomposes', from: 'g1', to: 'b1', usage }],
  findings: [{ rule: 'R1', severity: 'error', target: gb, block: 'g1', message: 'Orphan graybox: it specializes no blackbox.' }],
  usageStyleBoxes: [],
};

const dashboard: DashboardModel = {
  schemaVersion: 1,
  libraryFound: true,
  columns: [
    { phase: 'blackbox', label: 'Blackbox', groups: [{ title: null, parent: null, orphans: false, rows: ['b1'] }] },
    { phase: 'graybox', label: 'Graybox', groups: [{ title: 'Grayboxes of Quadcopter_bb', parent: 'b1', orphans: false, rows: ['g1'] }] },
    { phase: 'whitebox', label: 'Whitebox', groups: [{ title: 'Orphan whiteboxes', parent: null, orphans: true, rows: [] }] },
  ],
  blocks: {
    b1: { ref: bb, name: 'Quadcopter_bb', phase: 'blackbox', library: false, errors: [], warnings: [], untracked: 2, lines: [] },
    g1: {
      ref: gb, name: 'Quadcopter_gb', phase: 'graybox', library: false, errors: [], warnings: [], untracked: 9,
      lines: [{ kind: 'subsystem', text: 'airframe : Quadcopter_bb', usage, owner: 'g1', target: 'b1', redefines: null, inherited: false }],
    },
  },
  notice: null,
};

const request: GenerationRequest = {
  kind: 'whitebox', subject: 'Quadcopter_gb::Quadcopter_gb', name: 'Quadcopter_wb', folder: '',
  subsystems: [
    { usage: 'airframe', choice: { realizeWith: 'Airframe_wb::Airframe_wb' } },
    { usage: 'commModule', choice: { unintegrated: true } },
    { usage: 'propulsion', choice: { stub: 'Propulsion_gb' }, newName: 'propulsion2' },
  ],
};

const results: GenerationResult[] = [
  { ok: true, unit: 'Quadcopter_wb.sysml', text: 'package Quadcopter_wb { }', newBlocks: ['Quadcopter_wb'] },
  { ok: false, problems: ['The name is empty.'] },
];

test('the schema compiles in strict mode', () => {
  assert.ok(ajv.getSchema('oosem.schema.json'));
});

test('typical values validate', () => {
  assert.deepEqual(check('Analysis', analysis), []);
  assert.deepEqual(check('DashboardModel', dashboard), []);
  assert.deepEqual(check('GenerationRequest', request), []);
  for (const result of results) assert.deepEqual(check('GenerationResult', result), []);
  assert.deepEqual(check('Vocabulary', vocabulary), []);
  assert.deepEqual(check('PartialVocabulary', { root: "'Recursive Decomposition Pattern'", graybox: { suffix: '_g' } } satisfies PartialVocabulary), []);
});

test('invalid values are refused', () => {
  assert.notDeepEqual(check('Analysis', { ...analysis, schemaVersion: 2 }), []);
  assert.notDeepEqual(check('Analysis', { ...analysis, extra: true }), []);
  assert.notDeepEqual(check('Extensions', { properties: true }), []);
  assert.notDeepEqual(check('Finding', { rule: 'R14', severity: 'error', target: bb, block: 'b1', message: '' }), []);
  assert.notDeepEqual(check('Finding', { rule: 'R1', severity: 'error', target: bb, message: '' }), []);   // no block
  assert.notDeepEqual(check('DashboardModel', { ...dashboard, columns: dashboard.columns.slice(0, 2) }), []);
  assert.notDeepEqual(check('SubsystemChoice', { unintegrated: false }), []);
  assert.notDeepEqual(check('SubsystemChoice', { realizeWith: 'A', stub: 'B' }), []);
  assert.notDeepEqual(check('GenerationResult', { ok: true, problems: [] }), []);
  assert.notDeepEqual(check('PartialVocabulary', { blackbox: { color: 'black' } }), []);
});
