# Task 20 — Contrats du protocole de synchro et push serveur — rapport

Status: DONE_WITH_CONCERNS (small concerns, see below)
Commit: `529a1b0 feat(synchro): protocole v1 et push serveur avec points de sauvegarde` (Closes #21), on `socle`, not pushed.

## Implemented

- `packages/contracts/src/sync.ts`: every constant in §5 (`SYNC_PUSH_MAX` 200, `SYNC_PULL_LIMIT` 500, `SYNC_TIMEOUT_MS` 4000, `EPOCH_RESEND_DAYS` 60, `TOMBSTONE_TTL_DAYS` 90, `APPLIED_OP_TTL_MONTHS` 12, retry 2000/300000, interval 60000, debounce 2000, coach flush 4000), plus `UUID_V7_RE`/`UuidV7` (same pattern as `isUuidV7`), `OpKind`, `SyncOp`, `RejectionCode`, `PushRequest`, `PushEnvelope` (loose ops with `opId` only, max 200), `PushResult`, `PushResponse`, `PulledRow`, `PullResponse`, `PullQuery`, `encodeWatermark`, `decodeWatermark` (splits on the last `:`, rev must be `^\d+$` and a safe integer). `COLUMN_CODECS` is left for T21. Exported from `index.ts`.
- Missing DDL constants added to contracts and wired into the Zod schemas (preflight ruling C1):
  - `api/consent.ts`: `CONSENT_TYPES`/`ConsentTypeSchema`/`ConsentType` and `CONSENT_ACTIONS`/`ConsentActionSchema`/`ConsentAction`. `GrantConsentRequest.type` and `WithdrawConsentRequest.type` now use `ConsentTypeSchema.extract(['health'])`.
  - `api/auth.ts`: `SECURITY_OUTCOMES`/`SecurityOutcomeSchema` and `SESSION_REVOKED_REASONS`/`SessionRevokedReasonSchema`.
  - `api/places.ts`: `PLACE_KINDS`/`PlaceKindSchema` (used as the discriminators of `CreatePlaceRequest`), `GYM_NAME_MIN/MAX` (2/60), `GYM_CITY_MIN/MAX` (2/60) and `PLACE_NAME_MAX` (30), used in `CreateGymRequest`, `UpdateGymRequest`, `CreatePlaceRequest` and `UpdatePlaceRequest`.
  - The server's local `ConsentType` (`privacy/consent-state.ts`) was removed and is now imported from contracts, so each name is exported by only one module.
- `apps/server/src/sync/hooks.ts`: `HookCtx`, `BatchCtx`, `EntitySyncHooks` (`allowedKinds`, `beforeApply`, `afterApply`, `afterBatch`), `SyncHooksMap`, `SYNC_HOOKS = { sync_rejection: { allowedKinds: ['patch'] } }`.
- `apps/server/src/sync/push.ts`: `OpRejection(code, reason)` and `applyPush(deps, user, ops: readonly unknown[])`.
  - The whole batch runs in one transaction, with a raw `SAVEPOINT sync_op_<i>` per op. On a rejection the savepoint is rolled back and then released.
  - The R-SYN-16 order is followed verbatim, steps 0 to 12.
  - Consent is read once per batch. `rejectedRows` is a `Set<entity:id>`.
  - The parent relation comes from `EntityRule.parent`.
  - Rules and hooks are looked up with `Object.hasOwn`, so values like `__proto__` and `constructor` are safe.
  - Client fields are kept only when the key is the camelCase form of a `clientWritable` column; everything else is silently ignored.
  - Values written: a boolean becomes 0/1, an object or array becomes `JSON.stringify`.
  - Rejections:
    - An `OpRejection`, or an error with `(errcode & 0xff) === 19` (recorded as `validation`/`sql_constraint`), writes a `sync_rejection` row. That row has `entity`/`row_id` set to `''` when they are not text, and `detail_json` holds `{ kind, fieldNames (sorted), reason }`. An `applied_op` row with status `rejected` is also written when the `opId` is text. A `logger.warn('sync op rejected', { event: 'sync_rejected', code })` is emitted.
    - When `userId` differs from the session, or the `opId` belongs to another user: rejected `forbidden` with nothing written.
    - Any other error is re-thrown, which rolls back the whole batch and returns a 500.
  - At the end of the batch, `afterBatch` runs once per entity that had real writes. Then the commit happens, then `logger.info('sync push', { event: 'sync_push', count })`. No values are logged.
- `apps/server/src/sync/routes.ts`: `syncRoutes(deps)`, with `requireUser` on the whole router and `POST /push` that does `parseJson(PushEnvelope)` and returns `200 { results }`. It is mounted at `/api/sync` in `routes.ts`.
- `deps.ts`: `AppDeps.syncHooks`, which defaults to `SYNC_HOOKS` in `createAppDeps`.
- Test support `test/support/sync-fixtures.ts`, exported through `index.ts`:
  - `SYNC_FIXTURE_MIGRATION` (`9001_sync_fixtures`): the 3 STRICT tables with the +SYNC columns, the `(rev)` and `(owner_id, rev)` indexes, and the DDL given in the brief.
  - `SYNC_FIXTURE_RULES`, `createSyncTestContext`, `PROTOCOL_HEADERS`.
  - `makeOp`: opId from `seqIds(7000)`, `clientTs` `'2026-10-06T10:00:00.000Z'`, `attempts` 0, `serverRevSeen` null by default.
  - `syncPush`, `dumpDatabase`.

## Tests

- `packages/contracts/test/sync.test.ts` has 8 tests:
  - `SyncOp` rejects kind `upsert` and opId `not-a-uuid`.
  - `UuidV7` rejects upper case and non-v7 ids.
  - Push sizes: 200 ok, 201 refused, for both `PushRequest` and `PushEnvelope`.
  - Watermark round-trip; every bad form returns null.
  - Both constant arrays.
- `apps/server/test/sync/push.test.ts` has 27 tests. They cover every bullet in the brief:
  - Batch size: 401 without a session; 201 ops → 400; 200 ops → applied.
  - Duplicates, and an opId that belongs to another user.
  - `applied_op` columns.
  - Rejections:
    - kind `upsert`
    - `unknown_entity`, plus `forbidden` from `allowedKinds`
    - `user_mismatch`, with nothing written
    - `id_format`, for both a non-uuid id and an upper-case id
    - an op with no entity or id → `''`
    - `owner_mismatch`
    - `row_missing` and `not_supported`
    - an SQLite CHECK failure inside the savepoint
    - `parent_rejected`: parent rejected in the batch, absent, owned by someone else, or missing
    - the contents of `detail_json`; `VALEUR-SECRETE` appears in neither the dump nor the log
    - protocol 99
  - Applying ops:
    - patching `dismissedAt` on one's own `sync_rejection` (a non-writable `code` is ignored)
    - server fields sent by the client are ignored
    - repeated create
    - create + patch + patch
    - create + delete + patch, plus a repeated delete
    - delete of an absent row
  - Hooks on the fixture tables:
    - an `OpRejection` from `beforeApply`
    - `afterBatch` called once with exactly the rows written, and never for a batch with no writes
    - `afterApply` called per write
    - `errcode 13` → 500 with nothing written
- `apps/server/test/sync/push-c2.test.ts` has 4 tests (Review Focus 3, server side; `WITNESS` `TEMOIN-C2-7f3a`, `WITNESS_N` 987654, logger captured):
  - `painNote` → `applied_partial` with `droppedFields ['painNote']` and NULL stored.
  - `reason: 'pain'` is dropped; `'fatigue'` is applied.
  - `fixture_c2_log` → `{ dropped: true }`: no row, `applied_op` `applied_partial` with `assigned_rev` null.
  - No `sync_rejection` row is written.
  - Neither witness appears in `dumpDatabase` or in the log.
  - With `grantConsent`, the C2 data is written.
- `apps/server/test/db/enum-consistency.test.ts` has 2 tests. They parse every `col IN (...)` in `sqlite_schema` (except `(0,1)`) and every `length(col) BETWEEN`, `col BETWEEN` and `length(col) <= N`, and compare each one to its contracts constant. A column with no mapping fails the test, and so does a stale mapping (the key sets must be equal). There is no exemption list.

## TDD evidence

RED (run before any implementation, with the test files only):
```
pnpm --filter @appsport/contracts test sync
 FAIL  |contracts| test/sync.test.ts
Error: Cannot find module '../src/sync' imported from .../packages/contracts/test/sync.test.ts
 Test Files  1 failed (1)

pnpm --filter @appsport/server test sync/push db/enum-consistency
 FAIL  |server| test/db/enum-consistency.test.ts   TypeError: Cannot read properties of undefined (reading 'shape')   (PushResult absent)
 FAIL  |server| test/sync/push.test.ts             Error: Cannot find module '../../src/sync/hooks'
 FAIL  |server| test/sync/push-c2.test.ts (4)      TypeError: createSyncTestContext is not a function
 Test Files  3 failed (3)
```
These failures were the expected ones: the module did not exist yet and `createSyncTestContext` was missing from the test support.

GREEN:
```
pnpm --filter @appsport/contracts test sync                          → Test Files 1 passed (1), Tests 8 passed (8)
pnpm --filter @appsport/server test sync/push db/enum-consistency    → Test Files 3 passed (3), Tests 32 passed (32)
pnpm lint      → Checked 184 files, No fixes applied (clean)
pnpm typecheck → clean
pnpm test      → Test Files 71 passed (71), Tests 785 passed | 2 skipped (787)   (the 2 skips were already there before this task)
```
One test was added after GREEN and is not covered by the RED run: "un patch qui rattache l'enfant au parent d'un autre → parent_rejected". It covers the extension described under Concerns, and it passed on its first run.

## Files changed

The 18 files listed by `git show --stat HEAD` (1564+/14−): every file in the brief, plus `packages/contracts/src/api/{auth,consent,places}.ts` (ruling C1) and `apps/server/src/privacy/{consent-state,consent}.ts` (`ConsentType` now imported from contracts).

## Self-review / concerns

1. **Extension beyond the letter of step 7.** The parent check also runs on a `patch` whose fields contain the parent column. Without it, a patch could reattach a child to another user's parent, because the FK accepts it, which would break owner isolation. Create and `restore_upsert` behave exactly as specified. If the controller prefers the strict reading, it is a one-line revert in `push.ts` plus that one test.
2. **`afterApply` and the `afterBatch` list only cover real writes.** They exclude a create on an existing row, a patch or delete on a tombstone, and a delete of an absent row, even though the status of those ops is `applied`. This is how I read "ops écrites" / "jamais sans écriture".
3. **`detail_json.kind`** stores the client's `kind` string as received, for example `'upsert'`, and `null` when it is not text. `fieldNames` are the client's keys, as specified. No values are stored.
4. **Ops without a usable `opId`.** When the `opId` is not text (possible only through a direct `applyPush` call, since the route enforces it), the result has `opId: ''`. A `sync_rejection` row is still written, but no `applied_op` row, because the primary key cannot be filled.
5. **Unhandled non-`Error` throws.** If a hook throws a plain object instead of an `Error`, Hono's `onError` does not handle it. The test uses an `Error` that carries `code`/`errcode`, like the errors `node:sqlite` raises.
6. **Server table types not switched.** `db/schema.ts` still declares the enum literal types for `consent_event`, `session`, `security_event` and `place` inline; I left them alone to stay in scope. The enum-consistency test keeps the DDL and contracts aligned.

## Fix report (controller ruling after review)

Commit: `fix(synchro): issue d'origine renvoyée au rejeu d'un opId` (Refs #21). It touches 4 files: `push.ts`, `contracts/src/sync.ts`, `push.test.ts` and `push-c2.test.ts`.

1. **A `duplicate` result now echoes the outcome of the original op.**
   - `PushResult` gains `originalStatus?: 'applied' | 'applied_partial' | 'rejected'`.
   - When an opId is replayed, `duplicateOf()` returns `{ opId, status: 'duplicate', originalStatus, rev?, code?, dropped? }`.
   - No schema change was needed and `0001_socle` is untouched:
     - `originalStatus` comes from `applied_op.status`.
     - `rev` comes from `applied_op.assigned_rev`.
     - `code` is read from the existing `sync_rejection` row (`op_id`, `owner_id`), because `applied_op` has no column for it. If that row has since been purged, `code` is left out.
     - `dropped: true` is inferred from `status = 'applied_partial' AND assigned_rev IS NULL`. Only a dropped C2 op produces that combination: every non-dropped `applied_partial` is a create or patch, and those always get a rev.
2. **New tests.**
   - The same opId twice in one batch: the second result is `duplicate` with `originalStatus 'applied'` and the same rev, and only one row is written.
   - Replay of a rejected op returns `originalStatus 'rejected'` with `code 'validation'`, and adds no new `sync_rejection` row.
   - Replay of a dropped C2 op returns `originalStatus 'applied_partial'` with `dropped: true`, in `push-c2.test.ts`.
   - Replay of an applied op returns its `rev`; the existing duplicate test was updated for this.
   - A no-op create on an existing row calls neither `afterApply` nor `afterBatch`.
3. **Non-`Error` throws.** `applyPush` now wraps the batch transaction (`runBatch`). Anything thrown that is not an `Error` is replaced by a generic `Error` that does not carry the thrown value. Hono then answers `500 { error: 'internal' }`. The test throws the string `'VALEUR-SECRETE'` from `beforeApply` and checks three things: a clean 500, nothing written, and the value absent from the log.

RED (`pnpm --filter @appsport/server test sync/push`), before the fix: 5 failures were expected.
- The 4 duplicate assertions failed because results had no `originalStatus`, `code` or `dropped`.
- The non-`Error` test failed with "Unknown Error: VALEUR-SECRETE", because Hono's `onError` never caught the string.

The no-op create test passed from the start; it pins down behaviour the code already had.

GREEN:
- `pnpm --filter @appsport/server test sync/push`: 2 files, 35 tests passed.
- `pnpm lint` and `pnpm typecheck` are clean.
- `pnpm test`: 71 files, 789 passed, 2 skipped (those skips were already there).
