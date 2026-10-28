# Task 25 report — Base locale Dexie et outbox

Status: DONE — commit `95b04f0` feat(synchro): base locale Dexie, outbox transactionnelle et jeu figé v1 (Closes #26).

## Implemented
- `apps/web/package.json`: `dexie ^4.4.6`, `zod ^4.6.5`; dev `fake-indexeddb ^6.2.5` (`@appsport/server` was already there).
- `src/local-db/db.ts`: `LOCAL_DB_NAME`, `LOCAL_DB_VERSION = 1`, `OutboxOp`, `DeadletterEntry`, `MirrorRow`, `STORE_SCHEMAS` (exact v1 values), `NON_MIRROR_STORES`, `AppDb` (`declare` table fields; `version(1).stores({...STORE_SCHEMAS, ...extraMirrors})`; `mirror()` throws `unknown_mirror:<entity>`), `createAppDb`, `mirrorStoreNames`.
- `src/local-db/meta.ts`: `MetaValues` (without `lastAgeBand`, which T29 adds), `USER_META_KEYS`, `getMeta`/`setMeta`/`deleteMeta`.
- `src/local-db/consent.ts`: `localHealthConsentActive`: the last `health` event by `[type+createdAt]`, then checks `action === 'grant'`.
- `src/local-db/wipe.ts`: `wipeUserData`, `clearMirrors`, `purgeHealthData(db, rules = entityRules)`. It runs in a single transaction and returns `{ rowsCleared, opsRemoved, opsStripped }`. C2 mirrors are emptied. C2 values are set to null elsewhere (`c2Columns`, plus matching `c2Values`). Ops on a C2 table are removed and C2 keys are stripped from the others; a `patch` left empty is removed. Deadletter entries for C2 tables are removed. The file also exports the helpers `isC2Value` and `stripC2Fields`, which outbox reuses.
- `src/sync/outbox.ts`: `LocalChange`, `HealthConsentRequiredError`, `writeLocal`, `pendingCount`.
  - Error checks run in this order: `entity_not_journal`, `field_not_writable:<key>`, then `HealthConsentRequiredError` for a C2 table.
  - Without consent, C2 keys are removed.
  - `SyncOp.parse` runs before the transaction.
  - A single `rw` transaction covers the mirror and the outbox. The mirror is written first, then `outbox.add`, so a duplicate opId rolls back both.
  - On the mirror: create → `put` with ownerId, `serverRevSeen: null`, `deletedAt: null` and updatedAt. Patch merges the fields and sets updatedAt (`row_missing` if the row is absent). Delete sets deletedAt and updatedAt.
- `src/sync/protocol-converters.ts`: `OUTBOX_CONVERTERS = {}`. `convertOutboxOp(op, target = SYNC_PROTOCOL)` converts one link at a time and forces `protocol = p+1`. A missing link throws `outbox converter missing: v<p> → v<p+1>`.
- `test/support/local-db.ts`:
  - Imports `fake-indexeddb/auto` at the top and also sets `Dexie.dependencies` (Dexie reads `indexedDB` when its module loads, so importing the test before support would otherwise leave it empty).
  - Provides `FIXTURE_MIRRORS`, `createTestLocalDb`, `createFixtureLocalDb` (unique names), `loadFrozenLocalDb`, `dumpLocalDb`, plus `readFrozenDump` and `FrozenLocalDbDump`.
  - The dump is loaded by a static JSON import: `import.meta.url` under happy-dom does not point at the file.
- `test/fixtures/local-db/v1/dump.json`: values from the brief.
  - `stores` is a copy of v1.
  - `meta` holds deviceId, userId `…aa`, watermark `…e1:42`, serverEpoch and protocol.
  - Two `patch sync_rejection { dismissedAt }` ops: `…000001` with attempts 2 and `…000002` with attempts 0.
  - One `sync_rejection` row (rev 41, `detailJson` as an object) and one `training_profile` row (rev 40, `cautiousMode: false`), each with `serverRevSeen` set to its rev.

## TDD evidence
RED: `pnpm --filter @appsport/web test local-db sync/outbox sync/protocol-converters`
```
 FAIL  |web| test/local-db/db.test.ts — Failed to resolve import "../../src/local-db/meta"
 FAIL  |web| test/local-db/frozen-v1.test.ts — Failed to resolve import "../../src/local-db/meta"
 FAIL  |web| test/local-db/wipe.test.ts — Failed to resolve import "../../src/local-db/consent"
 FAIL  |web| test/sync/outbox.test.ts — Failed to resolve import "../../src/sync/outbox"
 FAIL  |web| test/sync/protocol-converters.test.ts — Failed to resolve import "../../src/sync/protocol-converters"
 Test Files  5 failed (5)
```
This was the expected failure (modules not found). The first GREEN attempt left two test-side problems. The fixture was read through `import.meta.url`, which resolves to `C:\test\...` under happy-dom; I switched to a static JSON import. `Dexie.Table` is not a runtime constructor; I now assert on `db.meta.name`.

GREEN: same command
```
 Test Files  5 passed (5)
      Tests  26 passed (26)
```
Full checks: `pnpm lint` clean (219 files), `pnpm typecheck` clean (all 4 packages), `pnpm test` → `Test Files 88 passed (88)`, `Tests 907 passed | 2 skipped` (the skips existed before this task).

## Self-review
- `git show --stat HEAD` lists all 15 files; the working tree is clean.
- The tests cover every point in the brief: duplicate opId and invalid opId write nothing; non-writable field and non-J entity are refused; C2 stripping without consent (`fatigue` kept, C2 table → error); patch and delete set updatedAt; pendingCount per user; wipe with keepOutbox true and false; clearMirrors; consent grant then withdraw. purgeHealthData returns exactly `{4,2,1}`, the dump no longer contains the witness value, and the remaining outbox fields are `[{label:'x'}]`. The frozen v1 db opens at the current version, and the protocol converters are tested.
- No screen code. Dexie is only used in `local-db/` and through `AppDb` in `sync/outbox.ts`.

## Concerns (minor)
- `writeLocal` refuses any kind (delete included) on a C2 table without consent, as the brief says. The server, in contrast, accepts a C2 delete without consent. No J table is C2 in the socle.
- Ops do not carry `serverRevSeen`: the field is optional, the server does not use it, and the brief does not ask for it.
- `AppDb` exposes a public `mirrorNames` property (readonly), used by `mirror()` and `mirrorStoreNames`.
- `isC2Value` and `stripC2Fields` live in `local-db/wipe.ts` and are imported by `sync/outbox.ts`, so the C2 rule is defined in one place.

## Fix report (controller ruling after review)
Commit: see `git log` — fix(synchro): suppression C2 admise sans accord, patch vidé non mis en file (Refs #26).

Changes:
1. `src/sync/outbox.ts`: a `delete` on a C2 table is allowed without consent (P-CST-2). New test: create, then delete without consent → op enqueued, mirror has deletedAt and updatedAt.
2. `src/sync/outbox.ts`: a patch left empty after stripping its C2 values returns the validated op without writing anything. The mirror and its updatedAt are untouched and nothing is enqueued. New test: `{ painNote }` patch without consent → `op.fields = {}`, not in outbox, mirror row unchanged (updatedAt still NOW).
3. `vitest.config.ts`: web project `setupFiles: ['fake-indexeddb/auto']`. The `fake-indexeddb/auto` import and the `Dexie.dependencies` override are removed from `test/support/local-db.ts`.
4. `test/local-db/frozen-v1.test.ts`: `it.runIf(LOCAL_DB_VERSION === 1)` asserts `dump.stores` equals `STORE_SCHEMAS`.
5. `isC2Value`/`stripC2Fields` moved to `src/local-db/c2.ts`; `wipe.ts` and `outbox.ts` import them from there.

TDD:
- RED: `pnpm --filter @appsport/web test local-db sync/outbox` → 2 failed. The C2 delete test threw `HealthConsentRequiredError: health_consent_required`. The empty-patch test failed with `expected { …(9) } to be undefined` because the op was enqueued.
- The guard test passed right away, as expected: it pins the current state.
- GREEN: `pnpm --filter @appsport/web test local-db sync/outbox sync/protocol-converters` → `Test Files 5 passed (5)`, `Tests 29 passed (29)`.

Full checks: `pnpm lint` clean (220 files), `pnpm typecheck` clean, `pnpm test` → `Test Files 88 passed (88)`, `Tests 910 passed | 2 skipped`. `git show --stat HEAD` lists the 7 files; the tree is clean.

Concern: the `writeLocal` signature is unchanged (`Promise<OutboxOp>`). For an emptied patch it returns an op that was never persisted, and the only way for a caller to tell is that the op is absent from `db.outbox`. Changing this to `OutboxOp | null` would change the shared interface, so I left that decision to the controller.

## Fix report 2 (ruling: writeLocal returns null)
Commit: fix(synchro): writeLocal rend null quand rien n'est mis en file (Refs #26).
- `src/sync/outbox.ts`: `writeLocal(...): Promise<OutboxOp | null>`. It returns `null` for a patch left empty by C2 stripping (nothing written, nothing queued). The doc comment is updated.
- `test/sync/outbox.test.ts`: the emptied-patch test now asserts `expect(op).toBeNull()` and that the outbox and mirror are unchanged. A local helper `queued()` (writeLocal + non-null assertion) is used wherever a test reads the returned op; this is the type-only consequence of the new signature.
- RED: `pnpm --filter @appsport/web test sync/outbox` → 1 failed, `expected { …(9) } to be null`.
- GREEN: `pnpm --filter @appsport/web test local-db sync/outbox sync/protocol-converters` → `Test Files 5 passed (5)`, `Tests 29 passed (29)`.
- Full checks: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` → `Test Files 88 passed (88)`, `Tests 910 passed | 2 skipped`. `git show --stat HEAD` lists the 2 files; the tree is clean.
