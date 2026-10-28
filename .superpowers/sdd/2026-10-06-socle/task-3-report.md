# Task 3 — Adaptateur Kysely pour `node:sqlite` : rapport

Status: DONE_WITH_CONCERNS (one change outside the planned file list: `pnpm-workspace.yaml`; see Concerns)
Commit: `dca0df1 feat(db): adaptateur Kysely pour node:sqlite, sérialisé et testé contre better-sqlite3` (on `socle`, not pushed; closes #3)

## What was implemented

- `apps/server/src/db/sqlite-dialect.ts` exports `NodeSqliteDialect` (`constructor({ database: DatabaseSync })`).
  - The driver uses **one connection** behind its own mutex (a promise queue). `#holder` is the current lease.
  - `beginTransaction` runs `BEGIN IMMEDIATE`. Before its first `await`, it marks the async context with `AsyncLocalStorage.enterWith(lease)`. The transaction callback inherits that mark. If `acquireConnection` is called from a context whose mark is the current holder, it throws `Error('Requête sur db pendant une transaction ouverte : utiliser trx')` instead of waiting on the mutex. A stale mark (left by a finished transaction) never equals a new holder, so code running after a transaction behaves normally.
  - **Key detail:** Kysely 0.29 moved the single-connection mutex into `RuntimeDriver`. It applies when `adapter.supportsMultipleConnections === false`, and it is taken *before* `driver.acquireConnection`. A reentrant query would deadlock there before ever reaching the check. So the dialect uses `NodeSqliteAdapter extends SqliteAdapter`, which returns `true` for that property, and the driver serializes the connection itself. This property is used only by `RuntimeDriver` (checked in the kysely 0.29.6 dist).
  - `executeQuery`: when `stmt.columns().length > 0` it returns `stmt.all`. Otherwise it calls `stmt.run` and returns `numAffectedRows` and `insertId` as `BigInt`. There is no boolean conversion, and driver errors propagate unchanged (`errcode`). `streamQuery` uses `stmt.iterate`.
  - Savepoints are raw `SAVEPOINT` / `ROLLBACK TO` / `RELEASE` with a quoted identifier.
  - `rollbackTransaction` sends `ROLLBACK` only if `sqlite.isTransaction`. SQLite already rolls back some failures on its own, and an unconditional ROLLBACK would then fail and hide the original error.
  - `destroy` does not close the database.
- `apps/server/src/db/open.ts` exports `openDatabase(path)`. It runs `new DatabaseSync(path)`, then the pragmas `journal_mode = WAL`, `synchronous = FULL`, `foreign_keys = ON` and `busy_timeout = 5000`. It closes the database if a pragma fails. It returns `Kysely<Database>` with `CamelCasePlugin`.
- `apps/server/src/db/schema.ts` is the skeleton: an empty `Database` interface (biome-ignore with a reason) and `DbExecutor`. `tableKey` is left for T4b.
- `apps/server/package.json` adds `kysely ~0.29.6`, plus dev dependencies `better-sqlite3 ^13.0.3` and `@types/better-sqlite3 ^9.6.0`.

## Tests

`apps/server/test/db/adapter.test.ts` runs `describe.each` over the two factories from the brief (node:sqlite through `openDatabase(...).db.withTables<TestDb>()`, and better-sqlite3 through Kysely's `SqliteDialect`). It uses the STRICT `item` table.

- Cases for both drivers:
  - CRUD
  - RETURNING
  - a failing transaction rolls back and releases the connection
  - savepoints
  - RF1: concurrent transactions where one fails and the other commits
  - RF1: a query outside the transaction waits and survives the rollback (gated by deferreds, not timing)
- Cases for node:sqlite only:
  - reentrance throws `/utiliser trx/` within a 1 s timeout, then `names()` returns `[]`
  - (extra, small) the driver error is propagated with `errcode: 1299`, which Task 20 relies on
- `openDatabase` cases:
  - on a temp file, the pragmas read back as `wal`, `2`, `1`, `5000`
  - `':memory:'` is accepted
  - in `afterEach`, `sqlite.close()` runs before `rmSync` (avoids EBUSY on Windows)
- In `TestDb`, `type` replaces `interface` because `withTables` requires an index-signature-compatible type.

### TDD evidence
- **RED:** `pnpm --filter @appsport/server test adapter` gave `Error: Cannot find module '../../src/db/open' imported from .../adapter.test.ts` with `Test Files 1 failed`. This is expected because the module did not exist yet. Vitest 5 words it "Cannot find module" where the brief says "Failed to resolve import".
- **GREEN:** the same command gave `Test Files 1 passed (1)`, `Tests 16 passed | 2 skipped (18)`. The 2 skipped are the node:sqlite-only cases in the better-sqlite3 run.
- **Mutation checks** confirm the tests catch the real failures:
  - With `enterWith` disabled, the reentrance test fails with "Test timed out in 1000ms". That is the deadlock.
  - With the mutex `await` removed, both RF1 tests fail on node:sqlite.
- **Full suite:**
  - `pnpm lint`: clean (30 files)
  - `pnpm typecheck`: exit 0
  - `pnpm test`: `Test Files 9 passed`, `64 passed | 2 skipped`, no warnings
  - `pnpm install --frozen-lockfile`: up to date

## Files changed
- `apps/server/src/db/sqlite-dialect.ts`, `open.ts`, `schema.ts` (new)
- `apps/server/test/db/adapter.test.ts` (new)
- `apps/server/package.json`, `pnpm-lock.yaml`
- `pnpm-workspace.yaml` (see Concerns)

## Self-review
- Every brief item is covered. The extras are the errcode test and the `isTransaction` guard on rollback; both are small and support behavior the spec states.
- Reentrance detection relies on `enterWith` running synchronously before the first `await` of `beginTransaction`. This holds because Kysely calls `driver.beginTransaction` synchronously from the transaction consumer. It is covered by the test and the mutation check on Node 24.21 (AsyncContextFrame).
- Reentrance is detected only for `db.transaction()` and `startTransaction()` callbacks after BEGIN. For example, `db.connection().execute()` is not marked; that was not required.
- Controlled transactions: using `db` (instead of `trx`) after `await db.startTransaction().execute()` still waits on the mutex, so it would deadlock if the code awaits it while holding the open trx. This is inherent to a single connection and was not requested.

## Concerns
1. **`pnpm-workspace.yaml`** was changed:
   - **What:** `better-sqlite3` moved from `onlyBuiltDependencies` to `ignoredBuiltDependencies`, with a comment.
   - **Why:** better-sqlite3 13.x ships N-API prebuilds (`prebuilds/win32-x64.node` and others) and no longer uses prebuild-install. pnpm still runs the implicit `node-gyp rebuild` because `binding.gyp` is present, and node-gyp needs Python, which is not available locally. So the install failed.
   - **Effect:** with the build ignored, the prebuilt binary loads (SQLite 3.53.4) and the install output stays clean.
2. `@types/better-sqlite3` resolves to `^9.6.0`, which lags the major version (13). Type-checking passes; it is used only in tests.
