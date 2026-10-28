# Task 39 report — E2E: update A to B, kill switch and 426

Commit: `b4360ac` « test(pwa): E2E mise à jour A vers B, interrupteur d'urgence et 426 » (Closes #40), on `socle`, not pushed.

## Status

DONE_WITH_CONCERNS. The one concern is Review Focus 5 under WebKit: `context.setOffline(true)` + reload cannot pass there (see Concerns 1).

## What I implemented

- `apps/web/e2e/support/builds.ts` (new):
  - `E2EBuild` and `BUILD_DIRS` (`<REPO_ROOT>/.e2e-data/builds/{A,B}`).
  - `buildWeb(extra)`: the Vite JS API build used by T38's global-setup (`root: WEB_DIR`, `configLoader: 'runner'`, `VITE_OWNER_FIRST_NAME='Alex'` set and then restored). It now lives here so the dist build and A/B share one loader.
  - `buildTwice()`: builds A then B with `build: { outDir: BUILD_DIRS[L], emptyOutDir: true }` plus the test plugin `appsport-e2e-build-label`. Its `transformIndexHtml` injects `<meta name="e2e-build" content="<L>">` into the head. Then `readBuildHash`, then `builds.json` is written. It throws if the two buildHash are equal.
  - `readBuildHash(dir)`: parses the precache manifest on the first line of `sw.js` and checks it against `^[0-9a-f]{12}$`.
  - `loadBuilds()`: if `builds.json` is missing, it throws « lancer la suite via playwright test : global-setup construit A et B ».
  - `shellLabel(page)`: the meta's `content`, or `null`.
  - `acrossReload(page, read)`: retries a page read, up to 3 attempts, after `domcontentloaded` when a navigation destroyed the execution context. This is needed because `expect.poll` in Playwright 1.63 does **not** retry a callback that throws (observed: the update and protocol specs failed on « Execution context was destroyed » during the reload that follows « Mettre à jour »).
- `apps/web/e2e/support/global-setup.ts`: keeps T38's dist build (now `await buildWeb()`) and `mkdirSync(E2E_DATA_DIR)`, then `await buildTwice()`.
- `apps/web/e2e/update.spec.ts` (`serverOptions.publicDir = BUILD_DIRS.A`):
  - Admin is onboarded on A. The buildHash of A and B differ. `shellLabel` is 'A'.
  - Push fault 503 is set first, then the fake op goes into the outbox, then `meta.activeSessionId` is set.
  - `restart({ APPSPORT_PUBLIC_DIR: b.dir })` + reload + `waitForWaitingWorker`. The label stays 'A'. `update-banner` has count 0 at once and again after 3 s (R-PWA-3).
  - Review Focus 5:
    - online reload gives 'A';
    - proxy blackhole + reload gives 'A' (both browsers);
    - `context.setOffline(true)` + reload gives 'A' (Chromium only, see Concerns 1);
    - B is still waiting afterwards.
  - Session cleared + reload: label 'A', banner visible with `data-dismissible='true'`. « Mettre à jour » leads to label 'B' and `swStatus.buildHash = b` within 20 s.
  - Afterwards:
    - the outbox is exactly `[op.opId]` (R-VER-4);
    - `idbVersion = LOCAL_DB_VERSION * 10`;
    - `meta.userId` is unchanged;
    - the shell-* caches are exactly `['shell-<b.buildHash>']` (only shell-* is asserted);
    - there is no banner.
- `apps/web/e2e/protocol.spec.ts` (publicDir A):
  - 426 `{ error: 'protocol_unsupported', serverProtocol: 1, minProtocol: 1 }` is set on `/api/sync/` first, then the op is enqueued.
  - restart to B, then `triggerForeground`. Result: `connection-status` is 'protocol_unsupported' and the outbox is `[op.opId]` (R-VER-2).
  - The banner is visible within 30 s with `data-dismissible='false'` and no « Plus tard » (R-PWA-5). « Mettre à jour » leads to label 'B'.
  - `setFault(null)` + `triggerForeground` leads to 'online' and an empty outbox within 15 s. `pending-counter` is '0'. The deadletter is exactly `[op.opId]` (the server rejects the fake op), and `rejected-counter` `data-count` equals the deadletter length.
- `apps/web/e2e/kill-switch.spec.ts` (publicDir A, so the reload from the network can be checked by label):
  - Push 503 first, then the op. The caches contain `illustrations-v1` and exactly one `^shell-[0-9a-f]{12}$`.
  - `restart({ SW_KILL_SWITCH: '1' })` + reload. Main-frame navigations are counted from before the reload. The spec waits for at least 2 navigations: the reload plus the kill-switch reload, whether from the SW or the page.
  - Then, within 15 s: `registrationCount` is 0 and there is no shell-* or illustrations-* cache. `connection-status` is attached and the label is 'A' (page served from the network).
  - No-loop check: no main-frame navigation during 3 s, and a `window` marker survives the window.
  - IndexedDB untouched: the outbox is `[op.opId]` and `meta.userId` is unchanged.
  - `restart({ SW_KILL_SWITCH: '' })` + reload leads to `waitForController` and `registrationCount` 1.
- No `page.route` or `context.route` anywhere. Faults go through `setFault` only. The fault is always set before the op is enqueued.

## TDD evidence

RED: `pnpm --filter @appsport/web test:e2e update protocol kill-switch` (specs written, `builds.ts` absent)
```
Error: Cannot find module 'C:\Users\eliott.colin\appsport\apps\web\e2e\support\builds' imported from C:\Users\eliott.colin\appsport\apps\web\e2e\kill-switch.spec.ts
Error: Cannot find module '...\e2e\support\builds' imported from ...\e2e\protocol.spec.ts
Error: Cannot find module '...\e2e\support\builds' imported from ...\e2e\update.spec.ts
Error: No tests found.
Exit status 1
```
This failure is what the brief's Step 2 expects.

Intermediate runs (kept as evidence of the fixes):
- Chromium, first implementation: kill-switch passed. update and protocol failed with `page.evaluate: Execution context was destroyed` inside `expect.poll(shellLabel)` after « Mettre à jour ». Fix: `acrossReload`.
- WebKit, first run:
  - kill-switch failed: the SW's `client.navigate` landed during the `cacheNames` poll. Fix: reads go through `acrossReload`, and the spec waits for the kill-switch navigation before opening the no-loop window.
  - update failed at `page.reload: WebKit encountered an internal error` under `setOffline` (see Concerns 1).

GREEN: `pnpm --filter @appsport/web test:e2e` (Windows 11, full suite)
```
Running 10 tests using 1 worker
  ok  1 [chromium] › e2e\arrival.spec.ts:47:1 › arrivée : … (5.4s)
  ok  2 [chromium] › e2e\kill-switch.spec.ts:27:1 › interrupteur d'urgence : … (7.7s)
  ok  3 [chromium] › e2e\offline.spec.ts:12:1 › hors ligne : … (13.1s)
  ok  4 [chromium] › e2e\protocol.spec.ts:11:1 › 426 : … (5.2s)
  ok  5 [chromium] › e2e\update.spec.ts:34:1 › mise à jour : … (8.5s)
  ok  6 [webkit] › e2e\arrival.spec.ts:47:1 › arrivée : … (24.4s)
  ok  7 [webkit] › e2e\kill-switch.spec.ts:27:1 › interrupteur d'urgence : … (16.9s)
  ok  8 [webkit] › e2e\offline.spec.ts:12:1 › hors ligne : … (24.6s)
  ok  9 [webkit] › e2e\protocol.spec.ts:11:1 › 426 : … (13.9s)
  ok 10 [webkit] › e2e\update.spec.ts:34:1 › mise à jour : … (17.2s)
  10 passed (2.3m)
```
Stability: `pnpm --filter @appsport/web test:e2e update protocol kill-switch --repeat-each 2` gave `12 passed (2.4m)`.

The local counts are 10 passed and 0 skipped. As T38 found, Playwright's WebKit on Windows exposes a service worker, so `requireServiceWorker` skips nothing here. The expected count on CI Linux is `10 passed` (5 specs × 2 projects; T38's landscape check is a step inside arrival, not a separate test). The CI job `e2e` is authoritative, and WebKit/Linux has not been run locally.

Other checks:
- `pnpm lint`: « Checked 428 files … No fixes applied. » (after `biome check --write` reformatted two long lines in my new files).
- `pnpm typecheck`: all four packages clean.
- `pnpm test`: `Tests 1819 passed | 2 skipped (1821)`.
- The built A and B were checked with `diff -r .e2e-data/builds/A .e2e-data/builds/B`. Only `index.html` (the meta line) and the first line of `sw.js` (buildHash `1d99d1e10287` vs `5890f2648da4`) differ. The hashed assets are identical.

## Files changed

- `apps/web/e2e/support/builds.ts` (new)
- `apps/web/e2e/support/global-setup.ts`
- `apps/web/e2e/update.spec.ts` (new)
- `apps/web/e2e/protocol.spec.ts` (new)
- `apps/web/e2e/kill-switch.spec.ts` (new)

`git show --stat HEAD` lists exactly these five files (381 insertions, 13 deletions), and `git status` is clean.

## Self-review

- Every ruling value is used verbatim: the 503 `{ error: 'internal' }` push fault, the 426 body, the `/api/sync/` prefix, the 20 s, 30 s, 15 s and 3 s bounds, `data-dismissible` 'true' and 'false', and `LOCAL_DB_VERSION * 10`.
- In update.spec, the blackhole step restores the push fault with `setFault(null); setFault(PUSH_FAULT)` in the same synchronous turn. The `null` releases the held sockets, and no proxy request can be handled between the two calls, so the op never reaches the server.
- The « absent at 0 s and 3 s » check runs after `waitForWaitingWorker`. The 3 s window covers the controller's GET_STATUS evaluation, which takes 1 s at most. The same B is then proven to raise the banner once the session is cleared, so the absence is meaningful.
- The no-loop check only starts after the kill-switch navigation has been observed (at least 2 main-frame navigations). Otherwise it could count the expected kill-switch reload as a loop under WebKit, where the SW-driven navigate arrives later.
- `acrossReload` lives in `builds.ts` next to `shellLabel`, its main user. I left T38's `pwa.ts` untouched because it is not in this task's file list.
- YAGNI: no new helpers beyond the interface, except `buildWeb` (shared loader, removes duplication with global-setup) and `acrossReload` (required by the poll behavior above).

## Concerns

1. **Review Focus 5 with `context.setOffline` under WebKit.** The ruling asks for `setOffline(true)` + reload. Under WebKit, every navigation under emulated offline fails with « WebKit encountered an internal error », even one the SW would serve. I reproduced this here, and T38 had already documented it.
   - What I did: the offline cold reload is covered in **both** browsers through the proxy blackhole (requests never answered, like a cut VPN, as spec 01 §9.1 allows). This matches the « faults through the proxy, identical under Chromium and WebKit » ruling.
   - `setOffline(true)` + reload is asserted additionally under Chromium only (`browserName !== 'webkit'`).
   - If the controller wants `setOffline` + reload under WebKit as well, that is not achievable with this Playwright WebKit build. The alternative is to drop the Chromium-only branch and keep only the blackhole.
2. WebKit on Linux (CI) is unverified locally: there is no Docker or WSL here. The CI job `e2e` is the first run there.

## Fix report, round 1 (integration of 3 parallel fix branches)

Base: `b4360ac`. I cherry-picked each branch onto `socle` in order with `git cherry-pick b4360ac..<branch>`. History stays linear and has no merge commits.

| Group | Branch | Findings | Commit on socle |
|---|---|---|---|
| 1 | fix/T39-r1-g1 | T39-F6, T39-F3 | `8c9b641` test(pwa): rechargements à froid hors ligne qui vérifient l'affichage et repli WebKit annoté |
| 2 | fix/T39-r1-g2 | T39-F10, T39-F9 | `64c7c1f` test(pwa): E2E 426, file d'envoi relue sous la panne et termes du glossaire |
| 3 | fix/T39-r1-g3 | T39-F12, T39-F8, T39-F7, T39-F2, T39-F1 | `1f46c57` test(pwa): interrupteur d'urgence borné à un seul rechargement hors SW |

No product code changed. All changes are in `apps/web/e2e/{update,protocol,kill-switch}.spec.ts`.

### Group 1: T39-F6, T39-F3 (`update.spec.ts`, Review Focus 5 step)
- **F6.** Every cold reload now checks that the app rendered. A check on the label from the index.html meta is not enough on its own.
  - Online reload: label 'A', and `connection-status` is visible.
  - Blackhole reload: label 'A', `connection-status` is visible, and `data-state` matches `/^(offline|unknown)$/`. This runs before the push fault is restored.
  - setOffline reload (Chromium): label 'A', `connection-status` is visible, and `data-state` is 'offline' within 5 s.
- **F6 RED.** The group replaced the cached JS entries in shell-* with a script that throws, on Chromium.
  - The old label-only check still passed.
  - The new check failed with `getByTestId('connection-status') … element(s) not found` at update.spec.ts:106.
  - The group removed this temporary change before committing.
- **F3.** The silent `if (browserName !== 'webkit')` is now an explicit WebKit branch. That branch pushes a `webkit-setOffline` annotation saying why setOffline + reload does not run there: WebKit fails every navigation under emulated offline (seen in T38). The proxy blackhole covers that case (01 §9.1.6, Review Focus 5).
- **Controller action:** record the ruling that setOffline + reload is Chromium-only and that the blackhole covers WebKit.
- **Group tests.** E2E 10 passed, `update --repeat-each 3` 6/6 passed, lint and typecheck clean.

### Group 2: T39-F10, T39-F9 (`protocol.spec.ts`)
- **F10.** Added a `deadletterIds()` helper. At the end of step 2, after the reload to B and while the 426 fault is still on, the test asserts that outbox = `[op.opId]` and deadletter = `[]`. Step 3 uses the same helper.
- **F10 RED.** The group used a temporary mutant in `engine.ts`, never committed: a 300 ms deferred move from outbox to deadletter on `protocol_unsupported`.
  - The old spec passed with the mutant.
  - The new spec failed at protocol.spec.ts:46 (`received Array []`).
  - **Limit:** a 1500 ms deferral escapes the check, because the reload to B clears the timer. The check catches a deferred move only if it completes before the reload.
- **F9.** Titles and steps now use the glossary terms « file d'envoi » and « file des rejets ».
- **Group tests.** E2E 10 passed, lint and typecheck clean.

### Group 3: T39-F12, F8, F7, F2, F1 (`kill-switch.spec.ts`, plus one line each in `protocol.spec.ts` and `update.spec.ts`)
- **F12.** The kill reload uses `page.reload({ waitUntil: 'commit' })`.
- **F8.** The U+2019 apostrophes in error messages are now straight, in double-quoted strings. No U+2019 is left in `apps/web/e2e`. I checked this after integration.
- **F7.** `connection-status` uses `toBeVisible()`. The test does not check the text, because the push fault is still on during that step.
- **F1.** Navigations are now counted as main-frame navigation requests, by pathname. Before, the test counted `framenavigated` events, and a same-document replaceState was observed to inflate that count on WebKit.
  - The listener is attached after the restart and before the reload.
  - After the 3 s window, the test asserts `['/', '/']`: the requested reload plus exactly one kill reload.
  - The `e2eSameDocument` marker is kept.
- **F2.**
  - Removed the vacuous `shellLabel 'A'` check.
  - The proof of a network load is now `navigator.serviceWorker.controller == null`, asserted after the polls and again after the 3 s window.
  - The test also asserts that the pathname is `/`.
  - **Deviation:** the group did not serve build B at the kill restart. They tried it, and it made WebKit flaky (2 failures in 10 runs).
- **Product concern for the controller (T36/T37, not fixed).** Under WebKit, a deploy of a new build together with `SW_KILL_SWITCH=1` can cause two problems:
  - (a) The kill switch navigates the window to a stale `WindowClient.url`, such as an invite link whose fragment was already stripped.
  - (b) The page stays on the document served by the SW, with no reload from the network.
  - A possible product finding: `checkKillSwitch` would navigate to a safe URL instead of `client.url`.
- **Group tests.** E2E 10 passed, kill-switch `--repeat-each 6` 12/12 passed, lint and typecheck clean, web unit tests 920 passed.

### Conflicts resolved
None. Groups 1 and 3 both touch `update.spec.ts`, and groups 2 and 3 both touch `protocol.spec.ts`. Group 3's edits there are the F8 apostrophe line only, so git applied them cleanly.

I reviewed the combined diff of both files for semantic overlap and found none:
- In update.spec.ts, the F8 line is in the preamble and the F6/F3 changes are in the Review Focus 5 step.
- In protocol.spec.ts, the F8 line is the `userId` guard and the F10/F9 changes are in the title, steps and helper.

No integration fix commit was needed.

### Final verification on integrated HEAD (`1f46c57`)
- `pnpm lint`: `Checked 428 files in 272ms. No fixes applied.`
- `pnpm typecheck`: rc=0, `tsc --noEmit -p tsconfig.json` clean.
- `pnpm test`: `Test Files 150 passed (150)` / `Tests 1819 passed | 2 skipped (1821)`, the same as before this round (the 2 skips existed before). Output is clean apart from vitest's happy-dom performance hint.
- `pnpm --filter @appsport/web test:e2e`: `10 passed (2.4m)` on Windows 11, Chromium and WebKit. This is the first run of the three spec changes together. Local WebKit exposes a SW, so nothing was skipped. The CI e2e job on Linux remains the authoritative run.

## Fix report, round 2 (T39-R1-1)

Commit: `5ac16ed` test(pwa): interrupteur d'urgence lu sur le document rechargé, pas sur l'ancien (Refs #40). Only `apps/web/e2e/kill-switch.spec.ts` changed (+6/-1). No product code changed.

### T39-R1-1: single-shot reads could run on the old SW-controlled document
- **Change.** After the `navigations.length >= 2` gate (kept, it still feeds the exact `['/', '/']` assertion), the spec now waits for the final document before any read:
  `await expect.poll(() => acrossReload(page, controlled), { timeout: 15_000 }).toBe(false)` then `await page.waitForLoadState('load')`.
  The old document was served by SW A's respondWith, so it keeps its controller after unregister until it is replaced. Only the document loaded from the network has no controller. That makes the poll a commit gate for both kill paths (SW navigate and page reload), and `acrossReload` retries an evaluate cut by the commit.
  The registrationCount and doomed-cache polls, `toBeVisible`, and the `e2eSameDocument` marker now all run on the final document. The single-shot `controlled()` check that followed `toBeVisible` was removed, because the gate now proves it. The `controlled()` check after the 3 s window stays.
- I did not use a framenavigated commit counter. Same-document replaceState also emits framenavigated (T39-F1). A load/DOMContentLoaded counter is ambiguous because the old document's load can fire after the kill request has left.

### RED (temporary harness, never committed)
- I added a temporary proxy delay of 2000 ms on `sec-fetch-mode: navigate` requests in `server.ts`, behind an env var. I also added a temporary probe, a single-shot `controlled()` read placed right after the existing polls.
- Command: `E2E_TMP_NAV_DELAY=2000 npx playwright test kill-switch --project=webkit`.
- Timeline: kill request at +0 ms, polls satisfied at +308 ms (registrationCount 0, doomed []), kill commit at about +2000 ms. The probe failed:
  `Error: RED probe: single-shot read right after the gate / Expected: false / Received: true`.
  So the old SW-controlled document satisfied the polls, as the finding said.
- Without the probe, the old spec still passed under the delay. The reasons were incidental, not by design:
  - Under WebKit, `toBeVisible` happened to wait about 2 s, because the old document never rendered connection-status.
  - Under Chromium, the evaluate on the old document stayed blocked until the commit.

### GREEN
- With the same delay and the probe moved after the new gate: `npx playwright test kill-switch --repeat-each 2` gave probe `false` in every run that reached it.
- Same command with `--project=chromium --repeat-each 3` and `--repeat-each 5` under the delay: 8/8 passed, and the probe read `false` about 70 ms after the kill commit.
- **Observation, outside this finding.** In one Chromium run under the artificial delay (and in one at 6000 ms), the pre-existing `navigations >= 2` gate timed out with only one navigation request. I could not reproduce it in 8 more Chromium runs under the delay, and never saw it without the harness. Treat it as a harness artifact unless CI shows it.
- The harness and probe were removed. `git checkout apps/web/e2e/support/server.ts` was run, and the diff contains only the spec change.

### Commands and output (HEAD `5ac16ed`)
- `npx playwright test kill-switch --repeat-each 5`: `10 passed (2.3m)` (5 Chromium, 5 WebKit, Windows).
- `pnpm --filter @appsport/web test:e2e`: `10 passed (2.6m)`. Nothing was skipped locally because local WebKit exposes a SW. The CI e2e job on Linux is authoritative.
- `pnpm lint`: `Checked 428 files in 364ms. No fixes applied.`
- `pnpm typecheck`: rc=0.
- `pnpm test`: `Test Files 150 passed (150)` / `Tests 1819 passed | 2 skipped (1821)`, unchanged.
- `git show --stat HEAD`: `apps/web/e2e/kill-switch.spec.ts | 7 ++++++-`. `git status` is clean. The report is gitignored.
