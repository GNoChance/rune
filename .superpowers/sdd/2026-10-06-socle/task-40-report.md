# Task 40 report: snapshots, restore with a new epoch, and epoch E2E

Lane O, worktree `C:\Users\eliott.colin\appsport-ops`, branch `socle-ops` (base 1a20c96). Issue #41.

**Status:** DONE_WITH_CONCERNS (minor concerns, listed at the end)
**Commit:** `efe7d96` feat(ops): instantanés, restauration avec nouvelle époque et E2E d'époque
**Review package:** `/c/Users/eliott.colin/appsport-ops/.superpowers/sdd/2026-10-06-socle/review-1a20c96..efe7d96.diff`

## What I implemented

### `apps/server/src/ops/snapshot.ts`
- `SNAPSHOT_TAG_RE = /^(daily|pre-v\d+\.\d+\.\d+)$/`, `SnapshotError` (`code: 'invalid_tag'`, constructor(code, message)), plus `assertSnapshotTag(tag)`, which throws `SnapshotError` with the message « Étiquette invalide « <tag> » : attendu daily ou pre-vX.Y.Z. ». The CLI checks the tag before it opens the database. Small exports added: `assertSnapshotTag` and `snapshotsDir`.
- `takeSnapshot({ sqlite, dataDir, clock }, tag)`:
  1. checks the tag. An invalid tag throws before anything is created.
  2. runs `mkdir <dataDir>/snapshots`.
  3. removes a stale `<final>.partial` and its `-wal`, `-shm` and `-journal` files.
  4. runs `backup(sqlite, partial, { rate: 0x7fffffff })` from `node:sqlite` in one step.
  5. runs `PRAGMA journal_mode = DELETE` on the copy and closes it.
  6. runs `renameSync(partial, final)`. A file with the same name is replaced.

  On any error the partial files are removed and the error is rethrown. A `daily` snapshot is named `daily-<parisDate without dashes>.db`. Example: '2026-10-06T22:30:00.000Z' → `daily-20261007.db`.
- `pruneSnapshots(dataDir, now, { keep = 3, maxAgeDays = 30 })`:
  - It manages only these entries in `snapshots/`: files `daily-*.db` and `pre-*.db`, and directories `replaced-*`.
  - First it deletes every managed entry whose mtime is more than 30 days old (03 §7, R-OPS-10, R-OPS-16). This applies even to one of the 3 newest.
  - Then it keeps only the 3 newest per prefix, `daily-` and `pre-` (mtimeMs descending, then name descending).
  - `replaced-*` directories are pruned by age only. 08 §7 counts only daily and pre-deployment snapshots, and R-OPS-16 keeps replaced databases for 30 days.
  - Other files are untouched. It returns the deleted names. With no `snapshots/` directory it returns `[]`.

### `apps/server/src/ops/restore.ts`
- `RestoreError` (`'snapshot_missing' | 'integrity_failed'`).
- `restoreSnapshot({ dataDir, snapshotPath, ids, clock })` follows the order imposed by Review Focus 4:
  1. If `existsSync(snapshotPath)` is false: `RestoreError('snapshot_missing', 'Instantané introuvable : <chemin>.')`.
  2. It runs `PRAGMA integrity_check` on the snapshot opened read-only. An exception, or any result other than `[{ integrity_check: 'ok' }]`, gives `RestoreError('integrity_failed', 'Instantané corrompu (PRAGMA integrity_check) : base actuelle laissée intacte.')`.
  3. It copies the snapshot to `appsport.db.restoring`, after removing any stale `.restoring` files.
  4. It opens the copy with `openDatabase(.restoring)`, runs `rotateServerEpoch(db, { ids, clock })`, then `PRAGMA journal_mode = DELETE`, then closes. Any error removes `.restoring` and its sidecars and rethrows.
  5. `appsport.db`, `-wal` and `-shm`, when present, move to `snapshots/replaced-<AAAAMMJJTHHMMSSZ from clock, UTC>/`. `replacedDir` is that path, or `null` when nothing was present.
     - If a move fails (for example the database is still open under Windows), the files already moved are put back, the directory is removed, `.restoring` is removed and the error is rethrown.
     - If the `replaced-<ts>` directory already exists (two restores in the same second), the restore is refused before anything moves. Otherwise it would overwrite the database replaced by the first restore. This guard is an addition beyond the brief and is tested.
  6. It renames `.restoring` to `appsport.db`.
- On every failure path the live database stays byte-identical (sha256 checked in tests). No `.restoring` and no `replaced-*` is left behind.

### `apps/server/src/cli.ts`
- **`snapshot --tag <tag>`**
  - It checks the tag first: an invalid tag throws `SnapshotError`, `runCli` prints the message and exits with 1.
  - Then the sentinel. If it is missing: « Volume de données absent : sentinelle <chemin> introuvable. », exit 1.
  - Then `assertStartupPreconditions` for the database. A missing database gives the existing T7 message « Base introuvable : … », exit 1.
  - It opens the database with `openDatabase` (no migration: a `pre-vX.Y.Z` snapshot is taken by the old version), runs `takeSnapshot(…, systemClock)` and closes the database.
  - Then it runs `pruneSnapshots(dataDir, now)` and prints `Instantané écrit : <chemin absolu>`. The data directory goes through `path.resolve`.
- **`restore <fichier.db>`**
  - It checks only the sentinel (P4 (b) on a new machine).
  - It runs `restoreSnapshot` with `resolve(dataDir)`, `resolve(file)`, `cryptoIds()` and `systemClock`.
  - It prints « Base remplacée conservée 30 jours dans <dossier>. » only when a database was replaced, then « Restauration terminée. Nouvelle époque : <uuid> (epoch_base_rev <n>). » and « Lancez maintenant privacy:reapply, avant de redémarrer le service. ».
  - A `RestoreError` message goes to stderr through `runCli`, exit 1.
  - With no argument: « Instantané manquant : utilise restore <fichier.db>. », exit 1. The brief does not give a text for this case.
- Both commands are added to `COMMANDS` with their usage lines.

### Tests (`apps/server/test/ops/`)
- **`helpers.ts`:** `createOpsDataDir()` creates the temp directory, the sentinel, a migrated file database and `initServerMeta(seqIds(1), new FakeClock())`. It returns `{ dir, dbPath, sqlite, db, close }`. Also `sha256`, `readOnly` and `integrity`.
- **`snapshot.test.ts` (14 tests):**
  - `daily` at 22:30Z gives `daily-20261007.db`. A stale `.partial` is removed. No `-wal` or `.partial` remains. `journal_mode` is `delete` and the copy passes the integrity check.
  - A `pre-v1.2.3` tag gives `pre-v1.2.3.db`.
  - 7 invalid tags: each gives `SnapshotError` with `invalid_tag`, and no `snapshots/` directory is created.
  - Concurrent writes from a second `DatabaseSync` (20,000 pairs, then inserts in a loop during the copy, timeout 60 s): at least one write during the copy, `count(pair_a) = count(pair_b) ≥ 20,000`, integrity ok.
  - A second snapshot with the same name replaces the first.
  - Prune by count: the brief's example, with `notes.txt` (older than 30 days) left untouched.
  - Prune by age: `pre-v1.0.0.db` alone in its group and `replaced-20260906T000000Z` (31 days old) are deleted. `replaced-20261001T000000Z` is kept.
  - With no `snapshots/` directory, prune returns `[]`.
- **`restore.test.ts` (6 tests):**
  - Rotation: 3 `nextRev`, snapshot, 5 `nextRev`, database closed, then restore. The epoch is a UUIDv7 different from the old one, `baseRev` is 3, and server_meta matches `{ epochBaseRev: 3, syncCounter: 3, epochStartedAt: '2026-10-07T20:00:00.000Z' }`. `replacedDir` is `replaced-20261007T200000Z` and its `appsport.db` has the old sha256. No `.restoring` remains.
  - Pages 2 and 3 overwritten gives `integrity_failed`.
  - `uuidv7` throwing: the error is rethrown.
  - A missing snapshot gives `snapshot_missing`.
  - Two restores in the same second: the second is refused.
  - Foreign WAL: the live database, its `-wal` holding a row `apres-instantane` written after the snapshot, and its `-shm` are copied before closing and copied back after. After the restore, `count(marker)` is 0, integrity is ok, and `-wal` and `-shm` are in `replacedDir`, not in the data directory.
  - All failure cases check that the sha256 is unchanged and that no `.restoring` or `replaced-*` is left.
- **`restore-privacy.test.ts` (Review Focus 4, 03 §17 n°10):**
  - Setup on a file database:
    - Users: alice; bob, with consent, questionnaire and limitation `TEMOIN-C2-genou`; carol, equipped the same way.
    - `since` is taken, then the snapshot.
    - 60 s later: alice deletes her account, bob withdraws his consent, carol withdraws and then grants it again.
  - `collectPrivacyEvents` returns `['account_deleted', 'consent_revoked', 'consent_revoked']`.
  - `ctx.close()`, then `restoreSnapshot`, then `reapplyPrivacyEvents` on a new context of the same file, with `deps.ids: seqIds(71)` to avoid ID collisions with the first context's generator.
  - Results:
    - alice's old cookie gets `410 { error: 'account_deleted' }`, and alice is absent from `user`.
    - `isHealthConsentActive` is false for bob, and false for carol (T24 ruling, fail-closed).
    - bob's limitation is deleted (`deletedAt` set) with every C2 field null.
    - `dumpDatabase` no longer contains `TEMOIN-C2-genou`.
- **`cli-ops.test.ts` (11 tests):**
  - snapshot:
    - The `daily` line matches the brief's regex, and the path is absolute and passes the integrity check.
    - `pre-v1.2.3` creates its file.
    - No `--tag`, or `weekly`: exit 1 with the exact message, and no file.
    - No sentinel: exit 1 with the exact message.
    - No database: exit 1.
    - 4 old dailies, then a snapshot: 3 dailies remain.
  - restore:
    - The 3 lines match the brief's regexes, and the epoch and base rev on the line match server_meta.
    - A missing file gives exit 1 with « Instantané introuvable : <resolve>. » and an unchanged database.
    - A corrupt file gives exit 1 with the exact message and an unchanged database.
    - No current database but a sentinel: exit 0, 2 lines and no `replaced-*`.
    - No sentinel: exit 1 and an unchanged database.

### `apps/web/e2e/epoch.spec.ts` (Chromium and WebKit, `test.setTimeout(180_000)`)
It goes only through T38's harness (`server.cli`, `stop`, `restart`, `bootstrapAdmin`, `page.request`), with no `page.route`.
1. The admin is created through the API: `bootstrapAdmin`, then `POST /api/invitations/accept`, `PATCH /api/me/training-profile`, `POST /api/places` (home, primary) and `POST /api/me/onboarding/complete`. No health consent.
   - The app adopts a session (`meta.userId`) only when it signs in from its own screen, so a cookie from `page.request` is not enough. The page therefore signs in through `/login` (`loginViaUi`).
   - Checks: `/` is online, `meta.serverEpoch` equals epoch1 (read from `/api/health`), and the mirror shows `daysPerWeek` 3.
2. It records `since`, runs `snapshot --tag daily` (path read from stdout), sends `PATCH daysPerWeek 4` and waits for the mirror to show 4.
3. It runs `privacy:collect --since … --out <dataDir>/privacy-events.json`, `stop`, the full-pull counter reset, `restore <snapshot>` (epoch2 read from stdout), `privacy:reapply`, `restart`. It checks that `/api/health` returns epoch2.
4. After `epoch2 ≠ epoch1`, the page reloads. Checks:
   - the page is online and `meta.serverEpoch` equals epoch2;
   - the watermark matches `^<epoch2>:`;
   - the mirror shows `daysPerWeek` 3 again (R-SYN-28: the server wins);
   - `pending-counter` has `data-count` '0' and the `outbox` store is empty;
   - no request to `…/consents/health/replay-withdraw` (T26) and no 401 or 410 response anywhere in the test;
   - exactly one `/api/sync/pull` without `since` since the stop. It is counted from the stop, not from the reload, because the open page may adopt the new epoch through a retry before the reload.

## TDD evidence

**RED (server):** `pnpm --filter @appsport/server test ops/`, run before any `src/ops` file or CLI change existed:
```
 FAIL  |server| test/ops/restore-privacy.test.ts [ apps/server/test/ops/restore-privacy.test.ts ]
Error: Cannot find module '../../src/ops/restore' imported from …/test/ops/restore-privacy.test.ts
 FAIL  |server| test/ops/restore.test.ts …  Cannot find module '../../src/ops/restore'
 FAIL  |server| test/ops/snapshot.test.ts …  Cannot find module '../../src/ops/snapshot'
 FAIL  |server| test/ops/cli-ops.test.ts > snapshot > --tag daily … AssertionError: expected 1 to be +0
 FAIL  |server| test/ops/cli-ops.test.ts > snapshot > sans --tag ou étiquette inconnue → 1, aucun fichier
AssertionError: expected '  db:check : vérifie l'intégrité de …' to be 'Étiquette invalide «  » : attendu dai…'
 Test Files  4 failed (4)
      Tests  11 failed (11)
```
This is expected: the modules did not exist yet. In cli-ops, `runCli` answered `Commande inconnue : snapshot` (its last stderr line is the usage list, so the assertion shows `db:check`).

**RED (E2E):** `pnpm --filter @appsport/web test:e2e epoch`, run with the `cli.ts` change stashed (the `ops` modules were present but not wired):
```
    Error: Commande inconnue : snapshot
    Expected: 0
    Received: 1
    > 88 |     expect(snap.code, snap.stderr).toBe(0);
  2 failed
```
This is expected (`snap.code` is 1). An earlier run, before the `/login` step was added, failed sooner: `connection-status` was not found because the page was on `/login`. That is how I found that the app needs a sign-in from its screen to adopt the session.

**RED (guard on a second restore in the same second):** I added the test after implementing the guard, then disabled the guard (`if (false && …)`) and ran `pnpm --filter @appsport/server test ops/restore.test`:
```
 FAIL  |server| test/ops/restore.test.ts > restoreSnapshot > seconde restauration dans la même seconde → refusée, la première base remplacée reste intacte
AssertionError: promise resolved "{ …(3) }" instead of rejecting
      Tests  1 failed | 5 passed (6)
```
Then I re-enabled the guard: GREEN.

**GREEN:**
```
pnpm --filter @appsport/server test ops/
 Test Files  4 passed (4)
      Tests  32 passed (32)

pnpm --filter @appsport/web test:e2e epoch
  ok 1 [chromium] › e2e\epoch.spec.ts:53:1 › époque : restauration, nouvelle époque et pull complet sans perte de session (6.8s)
  ok 2 [webkit] › e2e\epoch.spec.ts:53:1 › époque : restauration, nouvelle époque et pull complet sans perte de session (9.1s)
  2 passed (21.8s)

pnpm lint       → Checked 437 files … No fixes applied.
pnpm typecheck  → contracts, domain, server, web: no errors
pnpm test       → Test Files  158 passed (158) ; Tests  1883 passed | 2 skipped (1885)
```

## Files changed (commit efe7d96, checked with `git show --stat HEAD`)
- `apps/server/src/cli.ts` (+61)
- `apps/server/src/ops/restore.ts` (new)
- `apps/server/src/ops/snapshot.ts` (new)
- `apps/server/test/ops/{helpers.ts, snapshot.test.ts, restore.test.ts, restore-privacy.test.ts, cli-ops.test.ts}` (new)
- `apps/web/e2e/epoch.spec.ts` (new)

`git status` is clean after the commit.

## Self-review
- **Windows:** every `DatabaseSync` and Kysely handle (including the test context) is closed before `restoreSnapshot`. Tests use `rmSync` without `force`, so a handle left open fails with EBUSY.
- The snapshot is a single backup step, so a write from another connection does not restart it. The copy is in DELETE mode, so a snapshot is a single file with no `-wal`.
- `restore` moves the old database's `-wal` and `-shm` with it, so a foreign WAL is never replayed onto the restored database (Review Focus 4, tested).
- `snapshot` does not migrate: a `pre-vX.Y.Z` snapshot must be taken with the old schema.
- All CLI messages match the brief verbatim.
- No codes, links with a fragment, passwords or tokens appear in the report or the commit. The E2E reads the bootstrap code from the CLI and never logs it.

## Concerns (minor)
1. **Flaky test in the first full run.** My first full `pnpm test` run had one failure, which I did not capture (the summary showed only the web project's happy-dom notice). The next 8 full runs all passed (158/158). This matches the known pre-existing flaky web tests listed in progress.md (profile-page, withdraw « Je refuse », places-page). Each `ops/` file passes alone and in every full run.
2. **No "start of copy" signal for the concurrent-writes test.** "At least one write during the copy" is measured as writes made while the `takeSnapshot` promise is pending. The backup runs on the libuv thread pool, so those writes overlap the copy, but `node:sqlite` gives no signal for when the copy starts.
3. **Read-only check of a WAL-mode snapshot.** `restore` of a WAL-mode file (for example a raw copy of `appsport.db`) still works. However, the read-only integrity check leaves `-wal` and `-shm` files next to that source file. Snapshots made by `snapshot` are in DELETE mode and are not affected.
4. **Edge cases left untested and beyond the brief.**
   - Two restores in the same second are refused with a plain `Error` (exit 1, message on stderr). I added this to protect the first replaced database.
   - The message for `restore` without an argument is mine; the brief does not give one.
5. **E2E sign-in through `/login`.** The E2E signs in through `/login` after creating the account through the API, because a cookie alone is not adopted by the app. The account creation itself is still by API, as the brief requires.

---

## Fix report — round 1 (integration of 4 parallel fix branches into socle-ops)

Integrated in `C:\Users\eliott.colin\appsport-ops`, branch `socle-ops`, on top of `efe7d96`, with `git cherry-pick efe7d96..<branch>` per group, in order (linear history, no merge commits).

| Group | Findings | Source commits | Commits on socle-ops |
|---|---|---|---|
| 1 | T40-F2, T40-F9, T40-F16, T40-F4 | 74ec340, f3fb3e0, 99d28ea | d96fe33, 4dccb67, 8cb3d40 |
| 2 | T40-F10, T40-F3 | 8730071 | cf84462 |
| 3 | T40-F13, T40-F5 | 3cddbf4 | c1938df |
| 4 | T40-F15, T40-F1 | d5dfddd, 9b173ca | 716a822, 68c6464 |

### Group 1 — restore via backup API, prune on failure, exact CLI outputs, E2E ordering
- **T40-F2 (`src/ops/restore.ts`):** `copyFileSync` is replaced by `copyIntactSnapshot()`. It opens the snapshot read-only, runs `integrity_check` (any exception or non-`ok` result throws RestoreError `integrity_failed`), then calls `node:sqlite` `backup(source, .restoring, { rate: 0x7fffffff })` from that same connection. The bytes checked are the bytes copied, and a `-wal` next to the source is included. The `.restoring` copy is checked again before `rotateServerEpoch`. The order is unchanged and the source file is not modified. New test « réparation R-OPS-16 : restaurer replaced-*/appsport.db reprend les transactions de son -wal ». RED on the old code: `no such table: marker` (1 failed | 6 passed). GREEN 7/7.
- **T40-F9 (`src/cli.ts`):** `runSnapshot` calls `pruneSnapshots` in a `finally` once the sentinel check has passed. Invalid-tag and missing-sentinel paths still return before pruning. `restore` does not prune (optional in the finding; the daily cron covers it). Limit: if both the snapshot and the prune throw, the prune error is reported (exit code still 1). New cli-ops test with aged files and the DB removed: exit 1 « Base introuvable… » and only `daily-20000102.db` left. RED: `expected [ 'daily-20000101.db', …(3) ] to deeply equal [ 'daily-20000102.db' ]`. GREEN.
- **T40-F16 (`test/ops/cli-ops.test.ts`):** the daily test expects the exact « Instantané écrit : <dir>/snapshots/daily-<Paris date>.db » (name computed before or after the command). The restore test checks the exact « Base remplacée conservée 30 jours dans <dir>/snapshots/replaced- » prefix and that the parsed UTC stamp lies between start−1 s and the end of the command. RED by mutation (`now: () => new Date(0)`): both tests failed; reverted, GREEN.
- **T40-F4 (`apps/web/e2e/epoch.spec.ts`):** before `page.reload()`, the spec polls `localEpochs(page)` (triggerForeground, then meta serverEpoch and the watermark's epoch prefix) until both equal epoch2, and asserts `fullPulls === 1`; it asserts `fullPulls === 1` again after the reload. Timing race, so no meaningful RED; 2/2 then 6/6 with `--repeat-each 3` (chromium, webkit). No `page.route`.

### Group 2 — prune of orphaned partials and age of replaced-* from their name (`src/ops/snapshot.ts`)
- Only `pruneSnapshots` changed. New `COUNTED_RE`, `PARTIAL_RE`, `REPLACED_RE` and `replacedStampMs(name)` (parses the UTC stamp written by `compactUtc`, round-trip checked; undefined if unreadable). Each entry has `agedFromMs`: `min(mtime, stamp)` for `replaced-*` (mtime fallback), mtime for files. The 30-day removal uses `agedFromMs`. Partials (`.partial`, `-wal`, `-shm`, `-journal`) are removed by age only (30 days, so a concurrent snapshot's partial is never deleted) and never count toward keep-3. Other files (notes.txt) are untouched.
- **T40-F10** test « base remplacée : l'âge vient de l'horodatage du nom… ». RED: removed was `['replaced-20261005T000000Z']`, lacking `replaced-20260906T000000Z`. GREEN.
- **T40-F3** test « instantané interrompu (.partial et annexes) : supprimé passé 30 jours, jamais compté ». RED: removed was `[]`. GREEN (snapshot.test.ts 16 passed).

### Group 3 — test gaps in restore.test.ts (no production change)
- **T40-F13:** after the restore and before reopening, the test asserts `PRAGMA journal_mode` is `delete` and that `appsport.db-wal` / `-shm` are absent. RED by removing `PRAGMA journal_mode = DELETE` from restore.ts: `expected { journal_mode: 'wal' } to deeply equal { journal_mode: 'delete' }`. Reverted, GREEN 6/6.
- **T40-F5:** new helper `countMarkersInCopy(dir, sources)` (copies to a throwaway folder, never opens the originals). Before restoring, the test asserts the crash `-wal` is non-empty, that db+wal+shm gives count(marker) = 1, and that the main file alone gives 0. RED by adding `wal_checkpoint(TRUNCATE)` after the INSERT: `expected 0 to be greater than 0`. Reverted, GREEN 6/6.

### Group 4 — time zone pin and truly concurrent writes (no production change)
- **T40-F15 (`vitest.config.ts`, `snapshot.test.ts`):** the server vitest project sets `env: { TZ: 'America/New_York' }`. New guard test « fuseau du processus épinglé, ni UTC ni Paris ». RED with two mutants (local-date `snapshotName`, local-hour `compactUtc`): without the pin, each mutant survived on one of Europe/Paris or UTC; with the pin, both fail under empty TZ and TZ=UTC. The guard fails without the pin (`expected 'Europe/Paris' to be 'America/New_York'`). GREEN after revert.
- **T40-F1 (`snapshot.test.ts`):** after starting `takeSnapshot`, `await new Promise(setImmediate)` before the write loop, plus the new assertion `counts.a < 20_000 + during`. RED with synchronous `VACUUM INTO` and with `copyFileSync` mutants: old test passed, new test fails `expected 0 to be greater than 0`. GREEN 15/15 on real `backup()`.

### Conflicts
None. Groups 1 and 3 both touched `restore.test.ts`, and groups 2 and 4 both touched `snapshot.test.ts`; git auto-merged both (different hunks). I checked the semantic interactions: the group 4 TZ pin (America/New_York) applies to the new group 1 cli-ops assertions (Paris date computed with an explicit zone, UTC stamp parsed as UTC) and to group 2's `replacedStampMs` (UTC parse); all pass under the pin. No integration fix commit was needed.

### Final verification (on socle-ops at 68c6464)
```
pnpm --filter @appsport/server test ops/  → Test Files  4 passed (4) ; Tests  37 passed (37)
pnpm lint                                 → Checked 437 files in 323ms. No fixes applied.
pnpm typecheck                            → exit 0, no errors
pnpm test                                 → Test Files  158 passed (158) ; Tests  1888 passed | 2 skipped (1890)
pnpm --filter @appsport/web test:e2e epoch → 2 passed (chromium, webkit)
```
37 ops tests = 32 before + 2 (group 1) + 2 (group 2) + 1 (group 4 pin guard); group 3 adds assertions only. The full run was clean: no failures, no stray stderr. The release.test.ts timeout and profile-page flake reported by groups 2–4 under load did not occur in this run.

### Cleanup
The four fix worktrees `C:/Users/eliott.colin/appsport-ops-fix-T40-r1-g{1..4}` were removed with `git worktree remove --force`, and branches `fix/T40-r1-g{1..4}` were deleted. No codes, links with a fragment, passwords or tokens appear in this report.
