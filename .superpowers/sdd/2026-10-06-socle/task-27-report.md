# Task 27 — Convergence sur deux appareils et scénarios ciblés — rapport

**Status:** DONE_WITH_CONCERNS (one concern below, about code outside this task's scope; no bug found in T20-T26)
**Commit:** `c899333 test(synchro): convergence deux appareils et scénarios d'époque et de consentement` (Closes #28)

## What was implemented

- `apps/web/test/support/in-process-transport.ts` — `inProcessTransport(ctx, getCookie)`: sends requests to `ctx.app.request`. It adds `Cookie` (the current value of `getCookie()`) and `Origin = config.appOrigin`, and logs `{ method, path, body }` for each request that reaches the server (the body is decoded from JSON).
- `apps/web/test/support/lossy-transport.ts` — `LossyOptions`, `lossyTransport(inner, opts)` driven by mulberry32(`seed`). On each call:
  - a real delay of `rand()*maxDelayMs`;
  - if `reorder` is set and a duplicate is waiting, it is replayed late on `inner`, with its response ignored (`replayedLate++`);
  - a drop (`dropRate`): half the time `TypeError('lossy: request dropped')` without calling `inner`, otherwise the call goes through and then `TypeError('lossy: response dropped')` (`dropped++`);
  - a duplicate (`dupRate`): queued if `reorder`, otherwise two sequential calls returning the first response (`duplicated++`);
  - otherwise `inner.fetch`.
  - Replayed copies drop the original `AbortSignal`, which the deadline has already aborted by then. `heal()` sets the rates and the delay to 0 and empties the queue.
- `apps/server/test/support/index.ts` re-exports `createLogger` and `grantConsent` (per the ruling).
- `apps/web/package.json`: dev dependency `fast-check ^4.10.2`, the same version as `packages/domain`.
- `apps/web/test/sync/convergence.test.ts` (`// @vitest-environment node`):
  - fast-check `fc.commands` model run on two devices of the same user. Each device has its own session, its own Dexie fixture DB and its own engine, over lossy(inProcess).
  - Commands: `createNote` (title `''` with weight 1, or 1..20 chars with weight 5), `patchNote` (title and/or body), `deleteNote`, `createItem`, `sync`, each on device 0 or 1.
  - Row ids and opIds come from `createMonotonicUuidV7`, with one opId generator per device shared by `writeLocal` and the engine.
  - `numRuns: 25`, `seed` fixed to the case seed, timeout 120 s, `maxCommands: 60, size: 'large'`. Both brief cases are covered.
  - After `heal()`: up to 10 rounds of `syncNow` on both devices until the outboxes are empty, then `pullNow` on both. Then:
    - each device's `fixture_note` (id, title, body, deletedAt) and `fixture_note_item` (id, noteId, label, deletedAt) mirrors equal the server's, strictly (no `?? null` normalisation);
    - `pendingCount` is 0;
    - the `sync_rejection` mirror (id, opId, entity, rowId, code) equals the server's;
    - every deadletter opId has its `sync_rejection` row;
    - the server items equal exactly the created items minus the rejected ones (no loss, no duplicate).
  - It also asserts that the transport really dropped and duplicated requests, and replayed some late in the `reorder` case.
- `apps/web/test/sync/scenarios.test.ts` (node), real server, server logs captured:
  1. **401, then the same user logs in again.** A real logout makes the cookie invalid. 3 notes are written, then `connection = 'unauthenticated'`, `pendingCount` 3 and 0 rows on the server. After a new login and `syncNow('manual')`: `pendingCount` 0 and 3 notes on the server.
  2. **A's outbox is never sent under B's session (03 §17 n°11).** A has 2 ops. B logs in on the device (`meta.userId` and the cookie both change). After `syncNow`: no op from A in any push, 0 `fixture_note` on the server, `pendingCount(A)` still 2.
  3. **Epoch change with a late device (Review Focus 2, R-SYN-26/27).** Scripted exactly as the brief says (E1, n1 `'avant'`, `snapshotDb`, `'apres-S'` + n2, B pulls, `restoreInPlace` to E2, B patches offline `'B-hors-ligne'`, A replays and then sets `'final-A'`).
     - B's request sequence is exactly `['GET /api/health','POST /api/sync/push:restore_upsert','POST /api/sync/push:patch','GET /api/sync/pull']`, with the pull sent without `since`.
     - Results: n1 = `{title:'final-A', body:'B-hors-ligne'}`, n2 present, A's and B's mirrors identical to the server, empty deadletters.
  4. **Consent withdrawn while B has pending C2 ops (Review Focus 3).**
     - Setup: `grantConsent`, then both devices pull the grant. Offline, B creates a note, an item with `{painNote:'TEMOIN-C2-7f3a'}` and a `fixture_c2_log {value: 987654}`. A withdraws through `POST /api/me/consents/withdraw` and pulls (A's local consent becomes inactive).
     - Main variant, after `B.syncNow`:
       - `pendingCount` is 0, 0 rejected, and 0 `sync_rejection` rows on the server;
       - the server item has `pain_note` set to null, and B's mirror has `painNote` set to null;
       - no `fixture_c2_log` row on the server or on B;
       - B's deadletter is empty;
       - neither witness appears in `dumpDatabase`, in the server log, or in `dumpLocalDb` of A or B.
     - Variant: B pulls the withdrawal before pushing. Same checks, plus no witness anywhere in B's request log.

## TDD evidence

**RED (support code missing).** Tests written first, then run with `pnpm --filter @appsport/web test sync/convergence sync/scenarios`:
```
 FAIL  |web| test/sync/convergence.test.ts
Error: Cannot find module '../support/in-process-transport' imported from .../test/sync/convergence.test.ts
 FAIL  |web| test/sync/scenarios.test.ts
Error: Cannot find module '../support/in-process-transport' imported from .../test/sync/scenarios.test.ts
 Test Files  2 failed (2)
```
This is the failure the brief expects at Step 2.

**RED (deliberately broken production variants, each reverted right after).**
- `push-results.ts` `effectiveStatus` made to treat every `duplicate` as `applied`, so a lost response to a rejection is never deadlettered. Both convergence cases fail:
  ```
  × ... ({ seed: 20261006, ... })  Property failed after 25 tests
  Counterexample: [createNote(0, ""),createItem(0, #811717528, ">"),sync(0),patchNote(0, #122964831, {"body":"."})]
  × ... ({ seed: 7, ... })  Property failed after 1 tests
  Counterexample: [createNote(0, ""),createItem(0, #30898713, " 1"),sync(0),sync(1)]
  ```
- `epoch.ts` with `resendJournal` commented out: the epoch scenario fails (`expected [ { …(4) } ] to match object [ { …(2) }, { …(3) } ]`, because n2 is not re-inserted).
- `engine.ts` with the `purgeHealthData` call on a pulled consent removed: the variant "B tire le retrait avant de pousser" fails (`expected '[{"method":"GET","path":"/api/health"…' not to contain 'TEMOIN-C2-7f3a'`).

**GREEN.** `pnpm --filter @appsport/web test sync/convergence sync/scenarios`:
```
 Test Files  2 passed (2)
      Tests  7 passed (7)
   Duration  14.62s
```
Temporary instrumentation (not committed) confirmed that the runs exercise real content: up to about 60 commands per run, up to 15 notes and 14 items, `validation` and `parent_rejected` rejections, and deadletters on both devices. Totals were `{dropped:90, duplicated:50, replayedLate:0}` for seed 20261006 and `{dropped:78, duplicated:120, replayedLate:110}` for seed 7 with reorder.

**Full suite.**
- `pnpm lint`: clean (biome).
- `pnpm typecheck`: all 4 packages clean.
- `pnpm test`: `Test Files 96 passed (96)`, `Tests 1004 passed | 2 skipped`, no stderr or warnings.

## Files changed
- `apps/server/test/support/index.ts`
- `apps/web/package.json`, `pnpm-lock.yaml`
- `apps/web/test/support/in-process-transport.ts` (new)
- `apps/web/test/support/lossy-transport.ts` (new)
- `apps/web/test/sync/convergence.test.ts` (new)
- `apps/web/test/sync/scenarios.test.ts` (new)

## Self-review
- No production code changed, and no scenario exposed a bug in T20-T26.
- The device helper is duplicated in the two test files; the brief lists only two support files, so no third helper was added.
- In the main Review Focus 3 variant, the `dropped` handling in `applyPushResults` and the consent purge mask each other: removing either one alone still leaves B without the witness. The broken-variant runs show that the purge is guarded by the pull-first variant. The `dropped` path is covered by the T26 unit tests.
- When the property fails, shrinking can take over 90 s on the first case, which is close to the 120 s timeout. Green runs take about 15 s for both cases.

## Concerns
- **The engine knows the user only through `meta.userId`; it never checks it against the session.** The 03 §17 n°11 test passes because the login flow is expected to switch `meta.userId` at the same time as the cookie.
  - If the cookie ever becomes user B's while `meta.userId` is still A, A's ops would be pushed under B's session.
  - The server would answer with an unrecorded `forbidden` (`push.ts`, `UnrecordedRejection`), and the client would move A's ops to the deadletter, so A's queue would be lost.
  - This is not a T20-T26 defect under the brief's interfaces, but the login, account-switch and logout tasks (T29/T30) must update `meta.userId`, and warn and clear per P-AUT-6, before any sync with the new cookie.

---

## Fix report — controller hardening ruling (commit `a0d70b3`, Refs #28)

**Changes**
1. **Network seed in the counterexample.** The property is now `fc.asyncProperty(fc.commands(...), fc.integer({min:0,max:0x7fffffff}), (cmds, netSeed) => ...)`. Each trial's seeds come from `base = (opts.seed + netSeed) >>> 0`: lossy device i uses `base+i`. A counterexample therefore ends with the seed, e.g. `[..., 516641950]`.
2. **Deterministic UUIDv7.** `crypto.getRandomValues` is gone. The three UUIDv7 generators (op ids for device 0, op ids for device 1, row ids) take `seededBytes(base+10/11/12)`, a new export of `lossy-transport.ts` built on mulberry32, which is now exported as well. The engine and writes use the server's FakeClock, so a trial depends only on (cmds, netSeed). Dexie database names stay random, but they do not affect behaviour.
3. **Non-vacuity.** `LossyStats` gains `droppedRequests`, `droppedResponses` and `droppedResponsesByPath`; `dropped` stays as their sum. The test sums the following over all trials and asserts each total is > 0 (`replayedLate` only when `reorder` is on):
   - serverNotes, sync_rejection rows and deadletters;
   - droppedRequests, droppedResponses and pushResponsesDroppedAfterApply (`droppedResponsesByPath['/api/sync/push']`);
   - duplicated and replayedLate.
4. **Scenario 03 §17 n°11.** B now writes one note after taking over the device. The pushed ops must be exactly `[B's op]`, the server holds only B's note (owner B), none of A's note ids reach the server, `pendingCount(B)` is 0 and `pendingCount(A)` is still 2.
6. **Counterexample before the 120 s timeout.** fc options now include `interruptAfterTimeLimit: 90_000, markInterruptAsFailure: true`, so a long run or shrink is cut off and reported as a failure with the best counterexample found so far.

**Verification**
- `pnpm --filter @appsport/web test sync/convergence sync/scenarios`, run 3 times: `Test Files 2 passed (2)`, `Tests 7 passed (7)` each time (14.26 s, 13.79 s, 13.55 s).
- Broken variant (`duplicate` treated as `applied` in push-results, reverted afterwards): the reorder case fails in 17 s with `Property failed after 7 tests`, `Counterexample: [createNote(1, " "),sync(1),createNote(1, ""),sync(1),createNote(0, "") /*replayPath="//6:H"*/,516641950]`. The network seed is part of it.
  - With the new seeds, the seed-20261006 case (no reorder) did not catch that variant this time. Before this commit it did, with different random seeds.
  - Detection of that bug path therefore depends on the seed sample; the reorder case still catches it.
- `pnpm lint`: clean. `pnpm typecheck`: clean. `pnpm test`: 96 files, 1004 passed, 2 skipped, no stderr.
- `git show --stat HEAD`: `lossy-transport.ts`, `convergence.test.ts` and `scenarios.test.ts` (3 files, +89 -34). Working tree clean apart from this report.
