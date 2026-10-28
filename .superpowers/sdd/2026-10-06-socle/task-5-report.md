# Task 5 report

Implemented: contracts `case.ts`, `entity-rules.ts` (18 tables, SYNC_COLUMNS, mirroredTables), exports in index.ts; `tableKey` delegates to `snakeToCamel`; server test support `factories.ts` (`insertFixtureRow`, one factory per table, parents by recursion, seqIds(999) per db) exported from support/index.ts. `session`: anonymize, exported false (invariant test accepts it explicitly). No table sets `parent` / `c2Values`.

RED (separate run, before implementation):
- `pnpm --filter @appsport/contracts test`: `Cannot find module '../src/case'` and `'../src/entity-rules'` (2 files failed).
- `pnpm --filter @appsport/server test entity-rules`: file failed (`TypeError: Cannot convert undefined or null to object`, Object.keys(entityRules) undefined at collection; module missing).
GREEN: contracts 3 files / 14 tests passed; server entity-rules 1 file / 22 tests passed; `pnpm lint`, `pnpm typecheck`, `pnpm test` all green (17 files, 119 passed, 2 skipped), lint with no warnings.

Files: packages/contracts/src/{case,entity-rules,index}.ts, packages/contracts/test/{case,entity-rules}.test.ts, apps/server/src/db/schema.ts, apps/server/test/support/{factories,index}.ts, apps/server/test/db/entity-rules.test.ts.
Concerns: none.
