# OOSEM Assistant

Tools for the recursive decomposition pattern of OOSEM in SysML v2 models: blackboxes are
specialized into grayboxes, which decompose into subsystems, and whiteboxes realize those
subsystems with chosen blocks. The tools find the blocks of each phase, check the pattern's
rules, show how the blocks relate, and generate the text of new grayboxes and whiteboxes.

| Package | Name | What it is |
|---|---|---|
| `packages/core` | `oosem` | analysis, validation, the dashboard model and generation; no I/O, runs in Node and in browsers |
| `packages/cli` | `oosem-cli` | the `oosem` command |

Both read models through the [SysML SDK](https://github.com/Open-MBEE/sysml-sdk). A model marks
its blocks with the OOSEM method library's `#blackbox`, `#graybox` and `#whitebox` metadata, so
the library must be among the model's dependencies.

## Install

The packages are not on npm. Each [release](https://github.com/Open-MBEE/oosem-assistant/releases)
has two assets:

- `oosem-cli-<version>.tgz`: the command, with the core and the SDK inside.

  ```sh
  npm install -g ./oosem-cli-<version>.tgz
  ```

- `oosem-<version>.tgz`: the core alone, for programs that use it as a library. It takes the
  SDK as a peer dependency, `sysml` at the version its `package.json` names; install the SDK's
  tarball from its release next to it.

Node 24.5 or later.

## The `oosem` command

```sh
oosem validate [folder]          # findings, one per line; exit 1 when the project's own blocks have errors
oosem dashboard [folder]         # the blocks by phase, as a tree; --json for the dashboard model
oosem analyze [folder]           # the analysis, as JSON
oosem generate [folder] --request request.json [--write]
oosem serve --stdio              # JSON-RPC 2.0, one message per line
```

The folder (the current one by default) is one of:

- a [Sysand](https://docs.sysand.com) project with its `.sysand/` (after `sysand sync`);
- a kotar workspace checkout with its `libraries/`;
- any folder of `.sysml` and `.kerml` files.

`--source` and `--library` name the files instead. `--vocabulary` maps the library's names to
another spelling; `--properties` and `--in-phase-specialization` turn on two extensions beyond
plain OOSEM. `oosem --help` lists every option. Exit codes: 0 done, 1 errors found or generation
refused, 2 bad input.

Every JSON the command reads or writes is described by `schema/oosem.schema.json`.

## Development

```sh
nvm use                        # Node 24, from .nvmrc
npm ci
npm run build                  # tsc -b
npm test                       # node --test on the TypeScript sources
npm run typecheck              # the sources and the tests
node packages/core/smoke.mjs   # SDK check: prints "roots: 1"
node tools/pack.mjs core       # dist/oosem-<version>.tgz
node tools/pack.mjs cli        # dist/oosem-cli-<version>.tgz, the core and the SDK inside
```

- `vendor/sysml/`: the SysML SDK's release tarball (Apache-2.0 and EPL-2.0; its notices ship
  inside it).
- `test/fixtures/`: small test projects, and a stand-in for the method library that declares
  only what the core reads.
- `schema/oosem.schema.json`: the JSON Schema of the core's outputs and the CLI's inputs.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).
