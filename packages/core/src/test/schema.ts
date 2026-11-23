// Test helper: validation against schema/oosem.schema.json. Not part of the build.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../../../../schema/oosem.schema.json', import.meta.url), 'utf8'));
export const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(schema);

/** The schema's complaints about a value as one of its definitions; none when it validates. */
export function check(name: string, value: unknown): string[] {
  const validate = ajv.getSchema(`oosem.schema.json#/$defs/${name}`);
  assert.ok(validate, `no definition ${name}`);
  return validate(value) ? [] : (validate.errors ?? []).map((e: ErrorObject) => `${e.instancePath} ${e.message}`);
}
