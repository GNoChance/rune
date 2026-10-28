# Task 22 report — époque serveur, restore_upsert, purge des tombstones

Status: DONE_WITH_CONCERNS (minor, see Concerns)
Commit: see `git log -1` on socle — "feat(synchro): époque serveur, restore_upsert et purge des tombstones" (Closes #23)

## Implemented
- `apps/server/src/sync/epoch.ts` — `rotateServerEpoch(db, { ids, clock })`: one UPDATE on server_meta (new UUIDv7 epoch, `epoch_base_rev = sync_counter`, `epoch_started_at = clock.now()`), RETURNING → `{ epoch, baseRev }`.
- `apps/server/src/sync/restore-upsert.ts` — `applyRestoreUpsert(ctx, rule, fields)` + `RestoreUpsertOutcome`:
  absent → INSERT (`inserted`, `deleted_at` from fields or null); `rev ≤ epochBaseRev && serverRevSeen != null && serverRevSeen > rev` → UPDATE of all provided fields incl. deleted_at (`replaced`); else non-null `deleted_at` on a live row → tombstone with the client's deleted_at + stamp (`replaced`, deletion wins); else `kept` with existing rev, no write.
- `apps/server/src/sync/push.ts` — restore_upsert no longer rejected: steps 1-9 unchanged, `deletedAt` admitted on top of clientWritable (null or ISO datetime, else `validation`/`deleted_at`), `beforeApply`, then `applyRestoreUpsert`; `afterApply` and the afterBatch list only when a row was written; result `applied` (or `applied_partial`) with the outcome rev.
- `apps/server/src/sync/purge.ts` — `syncPurgeJob` ('sync-purge'), one transaction: J/D/E tables with `deleted_at`, excluding gym and place; incoming FKs read via `pragma_foreign_key_list` over all tables; topological order children-first; `DELETE … WHERE deleted_at < now−90 d AND NOT EXISTS (child row referencing it, per incoming FK) RETURNING rev`; `tombstone_purge_rev = max(current, max deleted rev)`; `applied_op` older than now − 12 calendar months; `logger.info('sync purge', { job: 'sync-purge', count })` (count = tombstones + applied_op rows).
- `apps/server/src/jobs/registry.ts` — `DAILY_JOBS = [authPurgeJob, syncPurgeJob]`.
- `apps/server/src/auth/purge.ts` — `subtractMonths` exported (reused for the 12-month cutoff).
- `apps/server/test/sync/push.test.ts` — removed the T20 assertion "restore_upsert → validation not_supported" (behaviour now intended to change); patch-on-missing-row assertion kept.

## Tests
- `epoch.test.ts` (2): rotation values (context created at 2026-10-05, clock set to 2026-10-06T10:00 before rotating so epoch_started_at visibly changes — preflight D2), X-Appsport-Epoch on /api/health via `createApp(ctx.deps)`, old-epoch watermark → 410 watermark_expired.
- `restore-upsert.test.ts` (10): absent → inserted (incl. tombstone 2026-09-01); replaced (new rev > baseRev); kept with serverRevSeen = rev and null (`{status:'applied', rev: r1}`); modified after restore kept even with serverRevSeen 1 000 000 (`rev: rp`); deletedAt on that live row → tombstone, rev > rp; tombstone not resurrected without deletedAt; invalid deletedAt → validation; sync_rejection → forbidden; C2 without consent → applied_partial dropped; other user's row → forbidden; beforeApply always, afterApply only on write.
- `purge.test.ts` (6): 91 d deleted / 89 d kept / gym+place (2026-01-01) kept / tombstonePurgeRev = deleted rev / log count; parent+child both 91 d deleted without FK error (alphabetical order would put parent first, so this checks the topo sort), parent 91 d with live child kept while others purged; purge rev 1000 stays 1000; applied_op 2025-10-05 deleted, 2025-11-06 kept; watermark `${epoch}:${oldRev-1}` 200 before → 410 after; `expect(DAILY_JOBS).toContain(syncPurgeJob)`. scheduler.test.ts untouched.

## TDD evidence
RED 1: `pnpm --filter @appsport/server test sync/epoch sync/restore-upsert sync/purge`
→ 3 suites failed: `Cannot find module '../../src/sync/epoch'` / `'../../src/sync/purge'` (expected: modules not yet written).
RED 2 (after epoch.ts only): `pnpm --filter @appsport/server test sync/epoch sync/restore-upsert`
→ 6 failed | 6 passed; e.g. `expected [ 'rejected', 'rejected' ] to deeply equal [ 'applied', 'applied' ]` (expected: push still rejects restore_upsert as validation/not_supported).
Intermediate GREEN attempt: 1 failure "expected 4 to be greater than 4" — raw `sql` results are camelized by CamelCasePlugin, so `deleted_at` read as undefined; fixed by reading `deletedAt`.
GREEN: `pnpm --filter @appsport/server test sync` → `Test Files  9 passed (9)`, `Tests  88 passed (88)`.
Full: `pnpm lint` clean (196 files), `pnpm typecheck` clean, `pnpm test` → `Test Files 78 passed (78)`, `Tests 844 passed | 2 skipped (846)` (skips pre-existing, none in my files).

## Self-review
- All brief bullets covered; `git show --stat HEAD` lists the 10 files above.
- NOT EXISTS checks any child row (live or young tombstone), not only live ones: deleting a parent whose child tombstone is < 90 d would either break the FK or cascade-delete a tombstone still owed to clients. Children are purged first, so "both at 91 d" still deletes both.
- No ISO validation existed for deletedAt in T20 (not admitted there); I added a minimal check so an arbitrary string never lands in deleted_at.

## Concerns
- `applyRestoreUpsert` re-reads the row (push already read it in step 6) — one extra indexed SELECT per restore op, kept for the shared signature `(ctx, rule, fields)`.
- Sync purge imports `subtractMonths` from `auth/purge.ts` (now exported) rather than a shared date util; small cross-module coupling.
- Removed one T20 test assertion (restore_upsert → not_supported), superseded by this task.

---

# Fix round 1 (commit 69ee5d9 "fix(synchro): âge des tombstones lu sur updated_at, deletedAt borné", Refs #23)

## Changes
1. (Important) `purge.ts`: tombstone age now `deleted_at IS NOT NULL AND updated_at < now − 90 d` (server stamp). `push.ts` `restoredDeletedAt(value, now)`: ISO check, then clamp into [now − EPOCH_RESEND_DAYS, now], re-serialised with `toISOString()`.
2. `push.ts` step 8: a restore_upsert with a non-null `deletedAt` on a C2 table without consent is no longer dropped. Step 9 keeps only `deleted_at` (no content). Absent row → contentless tombstone inserted; live row → tombstoned, content untouched (same as a plain delete). Status is `applied`.
3. `applyRestoreUpsert(ctx, _rule, fields, existing)`: takes the row push read in step 6 (`RestoreTarget { rev, deletedAt }`) and no longer re-selects it. The signature now has a 4th parameter, unlike the §5 interface line. `rule` is kept for the shared signature and named `_rule` because it is now unused.
4. Insert writes `owner_id` directly.
5. Purge test: parent at 91 d with a child tombstone at 89 d → both kept, purge rev stays 0.
Purge test helpers now set `updated_at` = deletedAt by default. The gym/place case uses an old `updated_at` too, so the "never purged" exclusion is really exercised.

## Tests added
- purge: deleted_at 1970 with fresh updated_at → kept; deleted_at 2099 with updated_at 91 d → purged, purge rev = its rev; parent with young child tombstone → kept.
- restore-upsert: deletedAt 2099 → stored as now (2026-10-06T10:00:00.000Z); 1970 → now − 60 d (2026-08-07T10:00:00.000Z); C2 without consent with deletedAt → absent inserted as tombstone (value null), live row tombstoned, both `applied`.

## TDD evidence
The fix was written before the tests in this round. To get RED evidence, I stashed `apps/server/src` and ran the new tests against the pre-fix source:
`pnpm --filter @appsport/server test sync/purge sync/restore-upsert` → 3 failed | 17 passed:
- updated_at test: `expected undefined to be defined` (1970 tombstone purged)
- clamp test: `expected '2099-01-01T00:00:00.000Z' to be '2026-10-06T10:00:00.000Z'`
- C2 deletion test: `expected { …(3) } to deeply equal { opId: Any<String>, …(2) }` (applied_partial dropped)
The child-tombstone test (item 5) already passed before the fix: it guards the existing NOT EXISTS behaviour.
GREEN: `pnpm --filter @appsport/server test sync` → 9 files, 92 tests passed.
Full: `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test` → 78 files passed, 848 passed | 2 skipped (pre-existing).
`git show --stat HEAD`: purge.ts, push.ts, restore-upsert.ts, purge.test.ts, restore-upsert.test.ts (5 files); working tree clean.

## Remaining concern
`applyRestoreUpsert` now takes a 4th argument, `existing`, which differs from the plan's §5 signature (controller ruling 3).
