#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { run } from './cli.ts';

try {
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    stdin: () => createInterface({ input: process.stdin, crlfDelay: Infinity }),
  });
} catch (e) {
  // a bug, not bad input
  process.stderr.write(`oosem: internal error: ${(e as Error).stack ?? String(e)}\n`);
  process.exitCode = 3;
}
