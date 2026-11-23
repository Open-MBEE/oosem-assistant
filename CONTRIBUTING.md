# Contributing

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat(core): …`,
  `fix(cli): …`), one per green increment: `npm run typecheck`, `npm run build` and `npm test` pass.
- **TypeScript must be erasable** (`erasableSyntaxOnly`): no enums, namespaces or constructor
  parameter properties. The tests run on the sources with Node's type stripping.
- **The core stays pure:** no I/O, no Node APIs, no DOM. Everything it returns is plain JSON, and
  `schema/oosem.schema.json` describes it; a change to an output changes the schema too.
- **Library names** are spelled only in `packages/core/src/vocabulary.ts`; user-facing texts only
  in `packages/core/src/messages.ts`.
- **Tests** run on small inline models and on the projects in `test/fixtures/`, which use a
  stand-in for the method library. A new rule or behavior gets a test on such a model.
- **People** are named by their role in docs, comments, commit messages and pull requests.
