# Task 2 report

Implemented: contracts constants (full), domain ids.ts (createUuidV7, createMonotonicUuidV7, isUuidV7), age.ts (parisDate, ageOn, ageBandOn), cautious.ts (computeCautious), index exports, fast-check@^4 devDependency.
Tests: contracts/constants, domain ids/age/cautious/purity (incl. fast-check property, 24 cautious cases).

TDD: RED `pnpm --filter @appsport/domain test` -> 3 files failed (cannot resolve ../src/ids, age, cautious), purity passed (empty src). Contracts test written after constants.ts (constants written in the same step), so no separate RED for it (honest note).
GREEN: `pnpm lint`, `pnpm typecheck`, `pnpm test` -> 8 files, 48 tests passed; lint/typecheck clean (biome --write reformatted 3 files).

Files: packages/contracts/src/constants.ts, packages/contracts/test/constants.test.ts, packages/domain/{package.json,src/{index,ids,age,cautious}.ts,test/{ids,age,cautious,purity}.test.ts}, pnpm-lock.yaml.
Concerns: none. purity test uses __dirname (works in vitest node).
