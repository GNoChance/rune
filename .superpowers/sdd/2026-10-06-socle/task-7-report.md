# Task 7 report

Commit 8ba08d6 feat(ops): garde de démarrage, CLI init et db:check, arrêt propre et tâches quotidiennes (Closes #8)

## Implemented
- `startup-guard.ts` (StartupError no_sentinel/no_database, texts verbatim), `startup.ts` (StartupTask, STARTUP_TASKS, helper `openMigrated` shared by startServer and withAppDeps: open + migrate + warn unknown_migration, closes sqlite on failure), `jobs/scheduler.ts` (DailyJob, startDailyJobs: run at start then every 24 h, unref'd interval, failure logged as job_failed with job + event name only), `jobs/registry.ts` (DAILY_JOBS), `cli.ts` (init, db:check, parseFlags, withAppDeps, runCli), `main.ts` (startServer, main, SIGTERM/SIGINT with 9 s exit guard, entry-point check). devDependency `tsx` added.
- Base closed by RunningServer.close(), by startServer on failure after openDatabase, by init and withAppDeps.

## TDD
- RED (separate run, before any src file): `pnpm --filter @appsport/server test cli/ startup jobs/` -> `Test Files 3 failed (3)`, "Cannot find module '../../src/jobs/scheduler'" (same for cli, main): expected, sources did not exist.
- GREEN: same command -> `Test Files 3 passed (3) / Tests 16 passed (16)`.
- Tests: tmp dir per test, `rmSync(dir, {recursive:true})` without force in afterEach (covers close, failed startServer, init, db:check: no EBUSY). db:check "Base corrompue" case inserts applied_op with user_id 'ghost' under foreign_keys=OFF -> exit 1. No assertion that STARTUP_TASKS/DAILY_JOBS equal [].
- Full: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` -> 29 files passed, 173 passed | 2 skipped.

## Milestone (verified once, Windows PowerShell)
```powershell
$d = Join-Path $env:TEMP "appsport-milestone"
New-Item -ItemType Directory $d | Out-Null
New-Item -ItemType File (Join-Path $d ".appsport-volume") | Out-Null   # sentinelle
$env:APP_ORIGIN = "http://localhost:3000"
$env:APPSPORT_DATA_DIR = $d
cd C:\Users\eliott.colin\appsport\apps\server
node --import tsx src/main.ts init        # Base initialisée ... / Époque du serveur : <uuidv7>
node --import tsx src/main.ts             # serveur sur 0.0.0.0:3000 (HOST/PORT facultatifs) ; Ctrl+C pour arrêter
# autre terminal :
Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing | Select -Expand Content
node --import tsx src/main.ts db:check    # OK
```
Result observed: `{"status":"ok","db":"ok","epoch":"01a1157b-...","version":"dev","protocol":1,"minProtocol":1,"swKill":false}` and db:check `OK`. Other env vars are optional (PORT, HOST, APPSPORT_PUBLIC_DIR, APPSPORT_CONTENT_DIR have defaults not needed yet). Note: init refuses if appsport.db already exists, so delete the folder to redo.

## Self-review / concerns
- Scheduler does not await in-flight jobs on stop(); a job running during close would fail and be logged (acceptable now, no jobs registered).
- Added `openMigrated` helper in startup.ts (not in plan interfaces) to avoid duplicating open+migrate between startServer and withAppDeps.
- `closeIdleConnections` is guarded with `in` because ServerType is a union including Http2 servers.
- If init fails mid-migration, a partial appsport.db may remain (a retry would then say "existe déjà"); not handled.

## Fix round 1
- cli.ts: `runInit` (exported, optional `migrations` param) builds `appsport.db.init-tmp` (stale one removed first), migrate + initServerMeta, closes, then renameSync; on failure closes and removes tmp, -wal, -shm (force) and rethrows (runCli prints the message, code 1). Test: failing migration -> readdirSync(dir) is exactly ['.appsport-volume'], then a real init succeeds.
- scheduler.ts: `stopped` flag, serialized in-flight promise, remaining jobs skipped after stop, `stop()` returns the promise; `RunningServer.close()` awaits it before sqlite.close(). Test with a blocking job (stop pending until released, next job not run).
- main.ts: `running.close()` rejection -> process.exit(1).
- startup.test.ts: fixed free PORT; the startup task fetches that port and must fail to connect (records 'startup' vs 'startup:already-listening'); the 'job' call is asserted (calls equals ['startup','job'] via vi.waitFor).
- Command: `pnpm --filter @appsport/server test cli/ startup jobs/` -> 3 files, 18 tests passed; lint, typecheck, full test pass.
