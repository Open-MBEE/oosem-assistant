import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { problems } from './schema.ts';
import { copyOf, LIBRARY, oosem } from './test/helpers.ts';

/** The responses to these messages, each checked against ServeResponse. */
async function exchange(messages: unknown[], cwd?: string): Promise<{ id: unknown; result?: any; error?: { code: number; message: string } }[]> {
  const lines = messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
  const ran = await oosem(['serve', '--stdio'], { lines, ...(cwd ? { cwd } : {}) });
  assert.equal(ran.code, 0);
  assert.equal(ran.stderr, '');
  return ran.stdout.split('\n').filter(Boolean).map((line) => {
    const response = JSON.parse(line);
    assert.deepEqual(problems('ServeResponse', response), [], line);
    return response;
  });
}

const call = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

test('serve: a session, each result as the schema says', async () => {
  const dir = copyOf('rover');
  const request = {
    kind: 'graybox', subject: 'Rover_bb::Rover_bb', name: 'Rover_gb2', folder: 'new',
  };
  const responses = await exchange([
    call(1, 'open', { folder: '.', library: [LIBRARY], stdlib: false }),
    call(2, 'analyze'),
    call(3, 'validate'),
    call(4, 'dashboard'),
    call(5, 'defaultName', { kind: 'graybox', of: 'Rover_bb::Rover_bb' }),
    call(6, 'generate', { request, write: true }),
    call(7, 'reload'),
    call(8, 'defaultName', { kind: 'graybox', of: 'Rover_bb::Rover_bb' }),
    call(9, 'shutdown'),
    call(10, 'analyze'),   // after shutdown: not read
  ], dir);
  assert.deepEqual(responses.map((r) => r.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(responses.filter((r) => r.error), []);
  const [open, analyze, validate, dashboard, name, generate, reload, nameAfter, shutdown] = responses.map((r) => r.result);
  assert.deepEqual(problems('ServeOpenResult', open), []);
  assert.equal(open.layout, 'files');
  assert.equal(open.root, dir);
  assert.deepEqual(open.libraries, ['libraries/openmbee-oosem-library/oosem.sysml']);
  assert.deepEqual(problems('Analysis', analyze), []);
  assert.deepEqual(problems('ValidationReport', validate), []);
  assert.deepEqual(validate.findings, []);
  assert.deepEqual(problems('DashboardModel', dashboard), []);
  assert.deepEqual(name, { name: 'Rover_gb2' });
  assert.deepEqual(problems('ServeGenerateResult', generate), []);
  assert.equal(generate.written, path.join(dir, 'new/Rover_gb2.sysml'));
  assert.ok(existsSync(generate.written));
  // reloaded, the new graybox is in the model
  assert.ok(reload.units.includes('new/Rover_gb2.sysml'));
  assert.deepEqual(nameAfter, { name: 'Rover_gb3' });
  assert.equal(shutdown, null);
});

test('serve: errors', async () => {
  const responses = await exchange([
    'not json',
    call(1, 'analyze'),
    call(2, 'frobnicate'),
    { jsonrpc: '1.0', id: 3, method: 'analyze' },
    call(4, 'open', { folder: 7 }),
    call(5, 'open', { folder: '/no/such/folder' }),
    { jsonrpc: '2.0', method: 'analyze' },   // a notification: no response, even to an error
    call(6, 'open', { folder: copyOf('rover'), library: [LIBRARY], stdlib: false }),
    call(7, 'defaultName', { kind: 'graybox', of: 'Nothing::Here' }),
    call(8, 'generate', { request: { kind: 'whitebox' } }),
  ]);
  assert.deepEqual(responses.map((r) => [r.id, r.error?.code ?? 'ok']), [
    [null, -32700], [1, -32001], [2, -32601], [3, -32600], [4, -32602], [5, -32000], [6, 'ok'], [7, -32000], [8, -32602],
  ]);
  assert.equal(responses[5]?.error?.message, 'not a folder: /no/such/folder');
});
