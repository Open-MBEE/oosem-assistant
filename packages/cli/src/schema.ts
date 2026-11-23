// The JSON Schema, shipped with the CLI: every JSON the CLI reads is checked
// against it. The package carries a copy in schema/; a checkout uses the repository's.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';

const CANDIDATES = ['../schema/oosem.schema.json', '../../../schema/oosem.schema.json'];

/** The schema file: the package's copy, else the repository's. */
export const schemaPath = (): string => {
  const found = CANDIDATES.map((c) => fileURLToPath(new URL(c, import.meta.url))).find((p) => existsSync(p));
  if (!found) throw new Error('the JSON Schema is missing from the package');
  return found;
};

let ajv: Ajv2020 | undefined;

/** The schema's complaints about a value as one of its definitions; none when it conforms. */
export function problems(definition: string, value: unknown): string[] {
  if (!ajv) {
    ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(JSON.parse(readFileSync(schemaPath(), 'utf8')));
  }
  const validate = ajv.getSchema(`oosem.schema.json#/$defs/${definition}`);
  if (!validate) throw new Error(`the schema has no definition ${definition}`);
  return validate(value) ? [] : (validate.errors ?? []).map((e: ErrorObject) => `${e.instancePath || '(top)'} ${e.message ?? ''}`.trim());
}
