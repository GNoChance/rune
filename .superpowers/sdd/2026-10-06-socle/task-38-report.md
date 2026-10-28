# Task 38 report — Playwright E2E harness: arrival and offline (Chromium and WebKit)

Commit: see `git log` on `socle` (« test(pwa): harnais E2E, arrivée et hors ligne sous Chromium et WebKit », Closes #39).

## Status

DONE_WITH_CONCERNS. The concerns are two WebKit adaptations, described below, and Windows counts that differ from the brief: WebKit 26.6 on Windows now has a service worker.

## What I implemented

- `apps/web/playwright.config.ts`: the brief's settings verbatim: testDir `./e2e`, globalSetup, workers 1, fullyParallel false, timeout 120 s, expect 10 s, retries `CI ? 1 : 0`, use `{ serviceWorkers: 'allow', locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure' }`, and the projects chromium (Pixel 7) and webkit (iPhone 14). I added one thing: `reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list'`, because the CI job uploads `playwright-report`, which only exists with the html reporter.
- `e2e/support/global-setup.ts`: Vite JS API `build({ root: apps/web, configLoader: 'runner', logLevel: 'error' })` with `VITE_OWNER_FIRST_NAME='Alex'`, restored afterwards. It then creates `.e2e-data/`, which is already gitignored, as are `test-results/` and `playwright-report/`.
- `e2e/support/server.ts`: exports `REPO_ROOT`, `WEB_DIR`, `DEFAULT_PUBLIC_DIR` (apps/web/dist), `E2E_DATA_DIR`, `E2EFault`, `E2EServer`, `startE2EServer` and `bootstrapAdmin`.
  - Ports: the backend gets a free port. The proxy listens on 127.0.0.1 (opts.port or 0), and also on ::1 when the machine has it.
  - Data: `dataDir = .e2e-data/<ISO stamp>-<8 hex>` with `.appsport-volume`.
  - Environment: `APP_ORIGIN=http://localhost:<proxyPort>`, `PORT`, `HOST=127.0.0.1`, `APPSPORT_DATA_DIR`, `APPSPORT_PUBLIC_DIR`, `APPSPORT_CONTENT_DIR=<REPO_ROOT>/data`, `APP_VERSION=e2e`. `opts.env` is merged on top, and `''` deletes a key.
  - Startup: `cli(['init'])`, then `node --import tsx src/main.ts` (cwd apps/server). `/api/health` must answer 200 within 30 s. If the child exits or the deadline passes, the error carries the last 40 log lines.
  - The proxy is plain `node:http`:
    - It relays method, path and every end-to-end header (Host, Origin and Cookie included). Hop-by-hop headers are stripped in both directions.
    - `blackhole` holds the socket open with no reply. `status` answers the given JSON for a path prefix. A stopped or unreachable backend gives 502.
    - `setFault(null)` destroys the held sockets.
  - Lifecycle: `stop()` stops the backend only and keeps the proxy and the dataDir. `restart(env)` merges env (`''` deletes a key) and relaunches on the same port and URL. `close()` stops both.
  - `bootstrapAdmin`: `admin:bootstrap --birth-date <1990-01-01>`, then parses the `Lien : ` and `Code : ` lines. A non-zero exit throws an error that carries stderr. The error never includes stdout, which holds the code.
- `e2e/support/fixtures.ts`: `test` with the fixtures below, plus re-exports of `expect`, `REPO_ROOT` and `DEFAULT_PUBLIC_DIR`.
  - `serverOptions` (option fixture).
  - `server`: `close()` in a `finally` after each test.
  - `cspViolations`: every context's `console` messages containing « Content Security Policy ». The fixture's teardown `expect`s it to be empty (P-LOG-4).
  - `context`, overridden to install the CSP watcher.
  - `newContext()` (addition, see Deviations).
- `e2e/support/pwa.ts`:
  - `emulateStandalone`: an init script. `matchMedia('(display-mode: standalone)')` returns `matches: true`, and `navigator.standalone` is true.
  - `requireServiceWorker`: in CI it throws (R-TST-1). Elsewhere it calls `test.skip` with « WebKit sous Windows : la CI Linux fait foi ».
  - `waitForController`, `swStatus` (GET_STATUS over a MessageChannel, 1 s), `waitForWaitingWorker`, `registrationCount`, `cacheNames`.
  - `idbGetAll`, `idbPut`, `idbVersion` (native `db.version`, which is LOCAL_DB_VERSION × 10), `metaValue`: native IndexedDB on DB `appsport`, opened without a version so there is no upgrade.
  - `triggerForeground`: dispatches `visibilitychange`.
  - `fakeOutboxOp(userId, n = 1)`: a `SyncOp.parse`d patch of `sync_rejection` with `fields { dismissedAt: '2026-10-06T10:00:00.000Z' }`. `opId` and `id` are fixed UUIDv7 values derived from that timestamp and `n`.
- `e2e/support/flows.ts`:
  - `E2E_PASSWORD` (31 code points).
  - `createAccountViaUi`: waits for `/onboarding`.
  - `completeOnboardingViaUi`: every step is awaited on its `data-step`. The goal label comes from `GOAL_LABELS.muscle`, the experience label from `EXPERIENCE_LABELS.none` and the gym type from `PRESETS.gym_small.label`. After « Créer la salle » there is no « Suivant ». On the ready step, `offline-ready` must reach `data-state="ready"` within 30 s before « Commencer », then the flow waits for `/`.
  - `setupOnboardedAdmin`: standalone, bootstrap link, SW required, home place, waits for the controller.
  - `loginViaUi`: fills the login form on a page already at /login.
  - All labels are queried with `exact: true` and a straight apostrophe.
- `e2e/arrival.spec.ts` (one test, three steps):
  1. Admin in standalone mode. Opens the link, then `requireServiceWorker`. Checks that the URL equals `${url}/invite`, so the fragment is gone (R-INV-4). Creates the account 'camille', checks that `data-step` is `goal`, then runs the gym onboarding (Fitness Park Nation, Paris). Then: URL `/`, `waitForController`, `shellCached` true, and `typeof metaValue('persistGranted') === 'boolean'` (polled).
  2. Session (Review Focus 5):
     - The `dev-session` cookie is `{ httpOnly: true, secure: false, sameSite: 'Lax', path: '/' }`, and there is no `__Host-session`.
     - A same-origin `fetch` PATCH /api/me gives 200.
     - `page.request.patch` with `Origin: http://evil.example` gives 403 `{ error: 'origin_mismatch' }`.
  3. Member:
     - `page.request.post('/api/admin/invitations', { headers: { Origin: server.url }, data: { birthDate } })` gives 201.
     - A second context (standalone, SW) opens `/invite` and shows 'hébergé chez Alex'.
     - **Landscape check** (owner ruling, WCAG 2.1 SC 1.3.4): the viewport is swapped (Pixel 7: 839×412, iPhone 14: 664×390). The code is typed in lowercase with spaces (R-INV-5). Then:
       - no horizontal overflow (`scrollWidth ≤ device width`);
       - « Suivant » is visible and enabled, entirely within the width;
       - it gets clicked.
     - Back to portrait, the flow creates 'lea' and runs the home onboarding, ending on URL `/`.
- `e2e/offline.spec.ts` (one test, three steps):
  1. `setOffline(true)`, then `triggerForeground`. `connection-status` reaches `offline` within 5 s. The « Profil » link (client-side navigation) shows Pseudo 'camille'. Saving a new pseudo shows « Nécessite le réseau ». After `setOffline(false)`, the status is `online` within 15 s.
  2. Blackhole and reload: the shell comes from the SW cache. The status is `offline` within 5 s of `connection-status` being attached, while `navigator.onLine === true`. `goto /profile` is readable. After `setFault(null)` and `triggerForeground`, the status is `online` within 15 s.
  3. A second context (`newContext`) logs in as 'camille' and lands on `/`. The first context renames to 'camille2' and the PATCH gives 200. In the second context, `idbGetAll('user')` contains 'camille2' within 15 s. Each poll iteration calls `triggerForeground` again, so a sync that was already running and got merged with the new trigger cannot leave the old name in place.
- `.github/workflows/ci.yml`: a blocking job `e2e`:
  - `ubuntu-latest`, `timeout-minutes: 30`;
  - `pnpm install --frozen-lockfile`;
  - `pnpm --filter @appsport/web exec playwright install --with-deps chromium webkit`;
  - `pnpm --filter @appsport/web test:e2e`;
  - on failure, `playwright-report` and `test-results` are uploaded (7 days).
- `apps/web/package.json`: `"test:e2e": "playwright test"`, dev `@playwright/test ~1.63.0` (1.63.0, released 2026-09-04; 1.64.0 is only 2 days old).

## Deviations and why

1. **WebKit and `context.setOffline`.** No navigation happens under `setOffline` (offline step 1).
   - WebKit (Playwright build 2359, WebKit 26.6) fails every navigation under emulated offline with « WebKit encountered an internal error », even one the SW would serve. I checked this in a scratch spec on Windows: with the blackhole, a reload was served by the SW in 148 ms. With `setOffline(true)`, both `page.goto('/profile')` and `page.reload()` failed with that error.
   - The offline check sits in WebKit's shared network process, so Linux very likely behaves the same. I could not check, since there is no Docker or WSL here.
   - Step 1 therefore detects offline through the engine (`triggerForeground` leads to a fetch failure, which gives `offline`) and reaches /profile through the « Profil » link. The cold reload from the cache (reload, then `goto /profile`) is covered by step 2, where `navigator.onLine` stays true. That is identical for both browsers, per the « identical under Chromium and WebKit » ruling.
   - The « Profil » link label is not in the Interfaces §6 list. It is the app's nav link (`exact: true`).
2. **SameSite under WebKit/Windows.** WinCairo keeps no SameSite attribute in its cookie store, and reports `sameSite: 'None'`. Chromium reports `Lax` for the same `Set-Cookie`, so the server is fine. The `sameSite: 'Lax'` assertion is therefore skipped only when `browserName === 'webkit' && process.platform === 'win32'`. In CI (Linux) it is always asserted.
3. **`newContext` fixture (an addition to the `test` type).** In Playwright 1.63, `browser.newContext()` does not inherit the project's options; only the `context` fixture gets them (`_contextFactory`). The second-device contexts need the device (Pixel 7 or iPhone 14), locale, timezone and `serviceWorkers: 'allow'`, and they need the CSP watcher.
   - So `test` also exposes `newContext(): Promise<BrowserContext>`, built from the public option fixtures (viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, serviceWorkers). It watches the CSP and closes its contexts at teardown.
   - It also exposes `cspViolations: string[]`. The brief's `serverOptions` and `server` are unchanged, so T39 and T40 can use `newContext()` for their second contexts.
4. **Windows counts.** The brief expected 2 passed and 2 skipped on Windows, assuming WebKit/Windows has no SW. Playwright's WebKit 26.6 for Windows does expose `serviceWorker`, and the whole flow runs, including the precached shell and « Prêt hors ligne ». So locally all four tests pass (see below). `requireServiceWorker` keeps the R-TST-1 contract: it throws in CI and skips elsewhere when there is no SW.
5. `helpers`: the landscape check is a local function in `arrival.spec.ts`, used once. It compares against the device width, not `innerWidth`, because in mobile emulation Chromium widens the layout viewport to overflowing content. In a scratch check, a 3000 px div gave `innerWidth` 3001.

Counts for later tasks: the landscape check is a step inside `arrival.spec.ts`, so the counts are unchanged: 4 tests (2 specs × 2 projects).

## TDD evidence

RED 1, specs written with no script: `pnpm --filter @appsport/web test:e2e arrival offline`
```
 ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT  None of the selected packages has a "test:e2e" script
```
This failure was expected, because the script did not exist yet.

The next run came after adding the script, Playwright, the config and global-setup. global-setup imports `./server`, which did not exist yet. It failed on the harness:
```
Error: Cannot find module 'C:\Users\eliott.colin\appsport\apps\web\e2e\support\server' imported from C:\Users\eliott.colin\appsport\apps\web\e2e\support\global-setup.ts
```
RED 2 came after `server.ts`, with no fixtures, pwa or flows: `pnpm --filter @appsport/web test:e2e arrival offline`
```
Error: Cannot find module 'C:\Users\eliott.colin\appsport\apps\web\e2e\support\fixtures' imported from C:\Users\eliott.colin\appsport\apps\web\e2e\arrival.spec.ts
Error: Cannot find module 'C:\Users\eliott.colin\appsport\apps\web\e2e\support\fixtures' imported from C:\Users\eliott.colin\appsport\apps\web\e2e\offline.spec.ts
Error: No tests found.
```
This was the expected RED 2 from the brief.

First full run, before the two WebKit adaptations: chromium 2 ok; webkit 2 failed:
- `sameSite` Expected "Lax", Received "None";
- `page.reload: WebKit encountered an internal error` under `setOffline`.

GREEN: `pnpm --filter @appsport/web exec playwright install chromium webkit`, then `pnpm --filter @appsport/web test:e2e arrival offline` (Windows 11)
```
Running 4 tests using 1 worker
  ok 1 [chromium] › e2e\arrival.spec.ts:32:1 › arrivée : admin installé, session protégée, puis un membre invité par code (6.1s)
  ok 2 [chromium] › e2e\offline.spec.ts:7:1 › hors ligne : coquille du cache, état de connexion, profil et second appareil (9.1s)
  ok 3 [webkit] › e2e\arrival.spec.ts:32:1 › arrivée : admin installé, session protégée, puis un membre invité par code (30.8s)
  ok 4 [webkit] › e2e\offline.spec.ts:7:1 › hors ligne : coquille du cache, état de connexion, profil et second appareil (21.9s)
  4 passed (1.2m)
```
Stability: `--repeat-each 2` gave 8 passed (2.4 min).

The CI job (Linux) is expected to give `4 passed`. I could not verify it from here because nothing was pushed. On Windows without a WebKit SW (older WebKit), the result would be `2 passed, 2 skipped`, through `requireServiceWorker`.

Harness checks (scratch specs, deleted afterwards):
- An injected inline script makes the test fail through the `cspViolations` teardown, with the message « Executing inline script violates the following Content Security Policy directive… ».
- A `status` fault gives 503 with the given JSON. After `stop()` the proxy answers 502. `restart({ APP_VERSION: 'e2e-2' })` gives 200 again on the same URL.

Repository checks:
- `pnpm lint`: Checked 423 files, no fixes.
- `pnpm typecheck`: OK for all packages. The web tsconfig already includes `e2e`.
- `pnpm test`: 1814 passed, 2 skipped (pre-existing), with clean output.

## Files changed

- `.github/workflows/ci.yml` (job `e2e`)
- `apps/web/package.json`, `pnpm-lock.yaml`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/arrival.spec.ts`, `apps/web/e2e/offline.spec.ts`
- `apps/web/e2e/support/{server,fixtures,pwa,flows,global-setup}.ts`

## Self-review

- Every brief item is present. State is read from attributes (`data-state`, `data-step`) and from HTTP responses. French text is matched only for the brief's « Nécessite le réseau » and 'hébergé chez Alex'.
- There is no `page.route` or `context.route`. Every fault goes through the proxy. The browser only uses `server.url` (localhost).
- `navigator.onLine` is never used as truth. It is asserted to be `true` while the state is `offline`.
- Legitimate `page.request` writes send `Origin: server.url` and a JSON body.
- No secret appears in logs or errors. `bootstrapAdmin` errors carry stderr only. Server logs (tail) carry no codes, per the global constraints.
- Several helpers (`waitForWaitingWorker`, `registrationCount`, `cacheNames`, `idbPut`, `idbVersion`, `fakeOutboxOp`) are not exercised by T38's specs. They are part of the produced interface that T39 consumes.

## Concerns

- WebKit on Linux is unverified locally. The two adaptations above are designed so they do not depend on the platform, but the CI run is the first real WebKit/Linux execution.
- Traces uploaded on CI failure may contain the test-only invitation links and codes in navigation URLs. They come from a short-lived test server and are kept 7 days.
- global-setup rebuilds `apps/web/dist` with `VITE_OWNER_FIRST_NAME=Alex` on each E2E run, as the brief asks. A developer's earlier `pnpm build` output is overwritten.

---

# Fix report: review round 1 (integration of 4 parallel fix branches)

Integrator: cherry-picked `89d4a9a..fix/T38-r1-gN` for N = 1..4 onto `socle`, in order. History is linear, with no merge commits. Resulting commits:

- `5bf76fe` test(pwa): témoin persistGranted, statut du SW attendu et étape paysage mesurée sur place (g1)
- `7731982` fix(pwa): outils E2E idb qui rejettent au lieu de pendre et déclencheur premier plan vérifié (g2)
- `9f196bf` test(pwa): hors ligne, refus de classe E sous requêtes muettes, alerte annoncée et attentes bornées (g3, conflict resolved)
- `857e972` fix(pwa): harnais E2E sans orphelins, relais coupé propagé et données supprimées après succès (g4)

No integration-fix commit was needed: lint, typecheck, unit tests and E2E all passed after the four picks.

## Group 1: T38-F2, T38-F6, T38-F11 (`apps/web/e2e/arrival.spec.ts`)

- **F2 (persistGranted sentinel).** Once `data-step` is `goal`, the test polls until `typeof metaValue('persistGranted') === 'boolean'`, which is the R-CPT-2 write from account creation. It then overwrites the key with the sentinel 'témoin e2e' and checks it was stored. After the onboarding completes, it polls until the value is a boolean again (R-SYN-31). Only the onboarding listener can replace the sentinel.
  - RED: with `installPersistOnOnboarding(repos.status)` commented out in `src/main.tsx`, the old spec still passed. The new spec failed at arrival.spec.ts:77 with « Expected: "boolean", Received: "string" ».
  - GREEN: 4/4.
- **F6.** `shellCached` is now read through `expect.poll`, not read once with the 1 s reply window.
  - RED could not be shown deterministically. GREEN: 4/4, and `--repeat-each 2` is green.
- **F11 (landscape check).**
  - The check is its own nested `test.step` (WCAG 1.3.4).
  - The box is measured where it sits, with no `scrollIntoViewIfNeeded`, and a null box throws an explicit error.
  - The left and right edges are separate asserts with messages.
  - New check: `window.scrollX` is 0 and no ancestor of the action is scrolled horizontally.
  - RED, on a scratch spec copying the old and new helpers: three overflow cases (nested overflow-x, the same after fill, an ancestor scrolled by typing) passed with the old helper and failed with the new one. GREEN: 4/4.

## Group 2: T38-F4, T38-F12 (`apps/web/e2e/support/pwa.ts`, `apps/web/e2e/offline.spec.ts`)

- **F4.** `idb()` no longer hangs, and it no longer creates an empty v1 database:
  - `onupgradeneeded` aborts and rejects with « base appsport absente ».
  - `onblocked` rejects.
  - A missing store closes the db and rejects.
  - Synchronous DataError and DataCloneError are caught. `request.onerror` and `tx.onabort` close the db and reject.
  - `idbVersion` on an absent DB rejects.
- **F12.**
  - `triggerForeground` dispatches `visibilitychange` only when the page is visible. Otherwise it throws, naming R-SYN-29.
  - Offline step 1 checks two preconditions: connection 'online' and pending-counter '0'. With both in place, only the triggered cycle can turn the state to 'offline' within 5 s.
  - A comment in step 2 says the trigger there only speeds up the recovery.
- RED: a temporary helper spec (not committed) had 6 failures: an absent DB resolved, a missing store hung until the 30 s timeout, and a hidden page resolved. GREEN: 6/6 helper checks plus arrival and offline 4/4.

## Group 3: T38-F5, T38-F9, T38-F10, T38-F13, T38-F14 (`apps/web/e2e/offline.spec.ts`, `apps/web/e2e/support/pwa.ts`)

- **F5.** The connection must be 'online' before `setOffline(true)` and before the blackhole fault.
- **F9.** « Nécessite le réseau » is asserted on the `role="alert"` of the username form (`usernameAlert`), not with a loose `getByText`.
- **F10.** In the blackhole step, a username save must be refused with that alert within `SYNC_TIMEOUT_MS + 6_000`, before `setFault(null)`.
- **F13.**
  - `SHELL_TIMEOUT_MS = 10_000` bounds the reload, the goto and the `waitFor`.
  - `waitForController` is bounded at 30 s.
- **F14.** The second-device poll asserts `.toEqual(['camille2'])`.
- RED came from temporary app-source breaks, restored afterwards:
  - F10: with an unbounded API timeout, the new spec failed at the alert and the old spec passed.
  - F9: with the Banner error rendered as `role="status"`, the new spec failed and the old one would pass.
- GREEN: 4/4.

## Group 4: T38-F8, T38-F16, T38-F17 (`apps/web/e2e/support/server.ts`, `apps/web/e2e/support/fixtures.ts`, new `apps/web/test/e2e-harness/server.test.ts`)

- **F16.**
  - The relay is extracted as `relay(req, res, port)`. An upstream cut mid-body destroys the client response, and a client leaving destroys the upstream request.
  - The `stop()` JSDoc documents that SIGTERM is abrupt on Windows.
  - RED: after the extract-only refactor, both relay tests failed with « rien après 3000 ms ». GREEN after the fix.
- **F17.**
  - A module-level `live` set and a `process.once('exit')` hook SIGKILL the remaining children.
  - Each child also preloads a parent-watch `data:` module that exits when the parent dies (ppid change on Linux, ESRCH on Windows).
  - RED: the parent-watch test went RED with a no-op stub, then GREEN.
  - The worker-death tests already passed before the fix on Windows, because libuv puts children in a KILL_ON_JOB_CLOSE job object. They guard Linux, which was not verified locally.
- **F8.** After `close()`, the `server` fixture removes the data dir when the test got its expected status, and keeps it otherwise.
  - RED/GREEN on a scratch pass/fail pair. After the real run, `.e2e-data/` is empty.
  - Not done: the optional pruning in global-setup.
- The new vitest file has 5 tests, all passing.

## Conflicts resolved

- `apps/web/e2e/offline.spec.ts`, step « réseau coupé », at g3's pick. g2 added a comment block, the precondition `connection data-state 'online'` and the precondition `pending-counter data-count '0'`. g3 added the same `data-state 'online'` line on its own. Resolution: keep g2's block, a superset that contains g3's line verbatim, so the precondition appears once. Every other g3 change applied cleanly on top of g2:
  - the `usernameAlert` locator;
  - the blackhole class E refusal;
  - `SHELL_TIMEOUT_MS`;
  - `toEqual`;
  - `waitForController` bounded.
- In the blackhole step, g2's "speeds up the recovery only" comment now follows g3's class E refusal and `setFault(null)`. That order is still correct: the blackhole sync failures have already scheduled a retry by then.
- `apps/web/e2e/support/pwa.ts` merged automatically. g2 touched `idb()` and `triggerForeground`, and g3 touched `waitForController`, so the hunks do not overlap.

## Final command outputs (integrated `socle`, HEAD `857e972`)

- `pnpm lint`: `Checked 424 files in 274ms. No fixes applied.` (exit 0)
- `pnpm typecheck`: exit 0.
- `pnpm test`: `Test Files 150 passed (150)` / `Tests 1819 passed | 2 skipped (1821)`, with clean output. Before this round it was 1814 passed; the +5 are g4's harness tests.
- `pnpm --filter @appsport/web test:e2e arrival offline`: `4 passed (1.2m)`:
  - chromium arrival 5.0s, chromium offline 12.9s;
  - webkit arrival 24.8s, webkit offline 24.2s.
  - `apps/web/.e2e-data/` is empty afterwards.

## Count note

On this Windows 11 machine, WebKit exposes a service worker, so arrival and offline run 4 passed and 0 skipped, not the earlier "2 passed + 2 skipped on Windows". The expected count on CI Linux is 4 passed (2 specs × 2 projects). The new landscape and blackhole checks are steps inside existing tests, so the test count did not change.

## Concerns

- On Linux, F17's orphan handling and the WebKit runs are guarded by tests but were not run locally. CI is the first run there.

No codes, links, passwords or tokens appear in this report.
