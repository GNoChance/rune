# Task 37 report: prompt-mode updates, page-side kill switch, persistent storage and 426

- Status: DONE_WITH_CONCERNS (the concerns are pre-existing flaky tests and small documented choices; nothing blocking)
- Commit: `4b6da04` feat(pwa): mises à jour en mode prompt, interrupteur d'urgence et stockage persistant (Closes #38), on `socle`, not pushed
- Review package: `.superpowers/sdd/2026-10-06-socle/review-6101b64..4b6da04.diff`

## Resume context (2026-10-09)

The previous implementer was cut off on 2026-10-08. The working tree matched `origin/wip/T37` exactly (checked with `git diff --stat HEAD origin/wip/T37`). It contained:
- the five test files and `test/support/fake-sw-container.ts`;
- `src/sw/kill-switch.ts` (probe and page-side kill switch);
- `sw-client.ts` refactored (`requestSwStatus(target)`, so the page can ask the waiting worker, not only the controller);
- `ILLUSTRATIONS_CACHE_PREFIX` moved from `sw.ts` to `precache-manifest.ts`, so the SW and the page share one prefix.

There was no `register.ts`, `persist.ts`, `UpdateBanner.*`, and no wiring in `main.tsx`, `AppShell.tsx` or `CreateAccountForm.tsx`.

**Kept as is:** the `sw-client` refactor, the prefix move, the fake container, and almost all of the tests.

**Changed in the WIP:**
- `kill-switch.ts`: a synchronous throw from `getRegistrations`, `unregister`, `keys` or `delete` no longer escapes (`orElse` wraps each call). The logic is unchanged.
- The test `PublicShell (onboarding)` asserted too early. The onboarding guard waits for the first Dexie read, which takes longer than `settle()`'s 50 turns, so the page was still empty. It now waits for the shell header (`findAllByRole('banner')`) before checking that there is no banner.
- In `persist.test.tsx`, `role="member"` became `role={MEMBER}`. Biome's `useValidAriaRole` treated the component prop as an ARIA role.

**Added to the tests (beyond the brief):**
- A silent waiting SW is asked again at the next check.
- A waiting SW activated by another window is withdrawn: no SKIP_WAITING and no reload.
- A concurrent double click (`Promise.all` of two `applyUpdate`) sends one SKIP_WAITING.
- `meta.persistGranted` is a boolean after an installed-mode account creation, and untouched in a browser tab.
- The fake gained a mutable `silent` flag and `activateWaiting()`.

## What I implemented

### `src/sw/register.ts`
- **Types.** `SwWorkerLike`, `SwRegistrationLike`, `SwContainerLike`, `UpdateState`, `SwController`, as in the brief and Interfaces §7. The real `ServiceWorkerContainer` typechecks as `SwContainerLike` without a cast.
- **`shouldShowUpdateBanner`.** `show = available && activeSessionId === null && !onboardingInProgress` and `dismissible = !forced`, the brief's 8-row table.
- **`swControllerStore`.** `get`, `set` and `subscribe`, notifying only on change.
- **`registerServiceWorker`.**
  - Without a service worker: an inert controller, always `{ available: false, forced: false }`. Its `markForced` does nothing.
  - **Registration and checks (R-PWA-2).** It calls `register('/sw.js', { scope: '/', updateViaCache: 'none' })`. If `register` rejects (sw.js missing or refused), the controller stays at `available: false` and the app runs. `registration.update()` runs at launch and on every `visibilitychange` to visible. Each check also re-arms a timer of `intervalMs` (3 600 000 ms by default), only while the page is visible. The timer stops when the page is hidden.
  - **Which waiting SW is offered (R-PWA-9, R-DEP-4).** It needs a waiting worker, a controller, and that worker's own `GET_STATUS` answer (`requestSwStatus`, MessageChannel, 1 s) with `localDbVersion >= LOCAL_DB_VERSION`. A missing `localDbVersion` or a lower one is a definitive no, and that worker never gets SKIP_WAITING. A silent worker (timeout) gets no verdict and is asked again at the next evaluation. Answers are cached per worker, so one evaluation sends one `GET_STATUS`. An evaluation runs after each check, on `updatefound`, on the `statechange` of any worker seen, and on a `controllerchange` that did not follow a click. A run counter makes the newest evaluation win. Subscribers are notified only on a state change.
  - **`applyUpdate` (R-PWA-4).** It does nothing when no worker is offered or when a click is already being handled. Otherwise it reads `meta.activeSessionId`; if a session is set, or the base cannot be read, it sends nothing (R-PWA-3). It checks again after that `await`, so two concurrent clicks send one message. Then it sets `reloading` and posts exactly one `{ type: 'SKIP_WAITING' }` to the offered waiting worker, never to the controller. A `controllerchange` reloads only when `reloading` is set, and only once even if the event repeats. A `controllerchange` without a click (first-install `clients.claim`, or a click in another window) never reloads; it re-evaluates, so the banner disappears when the waiting worker was activated elsewhere.
  - **426 (R-VER-2, R-PWA-5).** The page subscribes to the sync engine. On each transition of `connection` into `protocol_unsupported`, it calls `markForced()` synchronously and runs a new check. The outbox is not touched.
- **`raiseLocalDbMarker(storage?)` (carry, ADR 0001 decision 5).** It writes `max(marker, LOCAL_DB_VERSION)` to `appsport-meta` at `/__sw/local-db-version`, using the constants from `precache-manifest.ts`. The marker is never lowered, and an unreadable marker is replaced, as the SW's `readMarker` does. Any failure is swallowed.
- **`bootServiceWorker`.** Two tasks run in parallel:
  1. `db.open()`, then the marker. If Dexie fails to open, no marker is written; nothing blocks.
  2. The health probe. A rejection counts as null. With `swKill`, it runs `applyKillSwitchIfNeeded` and returns without registering (`swControllerStore` stays null). Otherwise it registers and publishes the controller. It then posts `SYNC_ILLUSTRATIONS` with `status.illustrationFiles()` when a controller exists, and again on every `controllerchange` (R-SYN-32).

  `killEnv` doubles as the test browser: its `caches` is used for the marker and its `reload` for the registration.

### `src/sw/kill-switch.ts` (R-PWA-6)
- `probeHealth(transport)` uses `fetchJsonWithTimeout` (T26) with `cache: 'no-store'`. The JSON is read whatever the status, so a degraded 503 keeps `swKill`. Zod parses the body; anything outside the contract gives null.
- `applyKillSwitchIfNeeded` unregisters every registration and deletes the caches whose names start with `shell-` or `illustrations-`. It keeps `appsport-meta` and unknown caches, and never touches IndexedDB. It reloads once, and only if something was unregistered or deleted; otherwise it returns false. A refused deletion does not stop the others.

### `src/sw/persist.ts` (R-SYN-31)
`installPersistOnOnboarding(status, { win?, standalone? })` listens for `ONBOARDING_COMPLETED_EVENT`. It evaluates `standalone()` at event time (default: `isStandalone(win)`) and calls `requestPersistentStorage()` (with `.catch`). The returned function removes the listener. `ReadyStep` is unchanged: it already dispatches the event, and there is no direct call.

### `src/sw/UpdateBanner.tsx` and `UpdateBanner.module.css`
- **`UpdateBannerView`.** It renders nothing when `show` is false. Otherwise the root has `role="status"`, `data-testid="update-banner"` and `data-dismissible="true|false"`. It shows « Nouvelle version disponible » and the button « Mettre à jour ». « Plus tard » appears only when dismissible. When forced, it adds « Mets à jour l'appli pour reprendre la synchronisation. » and a warning background.
- **`UpdateBanner`.** It reads the published controller with `useSyncExternalStore`. The local `dismissed` state (« Plus tard ») is ignored once forced. The session and onboarding checks live in an inner component, mounted only while `available` is true. It reads `useLive(() => repos.status.activeSessionId(), [repos])` and shows nothing while that value is unread, and computes `onboardingInProgress = me !== null && me.onboardingCompletedAt === null`. The inner component exists so that the shell runs no extra Dexie query when no update is waiting (see Concerns 1).
- `AppShell` renders `<UpdateBanner />` first, before the header. `PublicShell` (onboarding and public pages) has none.

### Wiring
- **`main.tsx`.** `const repos = reposFor(services)`, then `installPersistOnOnboarding(repos.status)` after `bootApp`. After `render`: `if (import.meta.env.PROD) void bootServiceWorker({ db, status: repos.status, sync, fetchHealth: () => probeHealth(transport) })`.
- **`repos/index.ts`.** New `reposFor(services)`, the single cached repo set per services. `useRepos` now uses it, so `main.tsx` and the screens share the same repos.
- **`CreateAccountForm`.** After a successful `acceptInvitation`, if `isStandalone()`, it calls `void repos.status.requestPersistentStorage().catch(() => {})` before `onCreated` (R-CPT-2).

## Tests

| File | What it covers |
|---|---|
| `update-banner-rules.test.ts` | the 8 rows of the brief |
| `register.test.ts` (31 tests) | launch, foreground and hourly checks (visible only); available with and without a controller; installUpdate; higher, lower and silent versions; silent worker asked again; activation by another window; replaced waiting worker; one SKIP_WAITING (concurrent clicks too), reload once; no reload without a click; session → nothing; no waiting SW; 426 forced plus one check per transition; 426 then a new version; inert controller; marker absent, lower, unreadable, equal, higher; boot with swKill, null probe, rejected probe, SYNC_ILLUSTRATIONS at boot and on each controllerchange, nothing without a controller, marker after Dexie opens, refused marker write |
| `kill-switch.test.ts` | swKill false; swKill true (caches left: `appsport-meta` and `autre`, marker kept, `deleteDatabase` never called, `meta.userId` 'u1' intact, one reload); nothing to clean → false; second pass → no loop; only registrations to remove; refused deletion; no SW and no Cache Storage; probe 200, degraded 503, unreachable, out-of-contract 502, 4 s timeout |
| `persist.test.tsx` | event in installed mode → 1 call; browser → 0; after the returned function → 0; default `isStandalone`; supplied window; CreateAccountForm installed → 1 call and `persistGranted` is a boolean; browser → 0 calls and `persistGranted` absent |
| `UpdateBanner.test.tsx` | view hidden, dismissible, forced; no controller; click → applyUpdate; controller published after render; session `'s1'` then null; onboarding (forced too); « Plus tard » then 426; AppShell banner first; PublicShell (onboarding, `/privacy`) none |

Results:
- Five T37 files: `Test Files 5 passed (5)`, `Tests 70 passed (70)`. The output is pristine: no stderr, warnings or act messages.
- Whole web suite (`pnpm --filter @appsport/web test`, `architecture.test` included): `Test Files 65 passed (65)`, `Tests 895 passed (895)`.
- `pnpm test` (all projects): `Test Files 149 passed (149)`, `Tests 1794 passed | 2 skipped (1796)`. No stderr or warning lines in the output.
- `pnpm lint`: `Checked 415 files … No fixes applied.`
- `pnpm typecheck`: exit 0 in all 4 projects.
- `pnpm --filter @appsport/web build`: ok, with the existing Vite warning about chunks over 500 kB (T35-F18).

In the page bundle, `/sw.js`, `updateViaCache`, `SKIP_WAITING`, `appsport-meta`, `/__sw/local-db-version` and « Nouvelle version disponible » are present. Strings that exist only in `sw.ts` (`illustrations-referenced.json`, `__APPSPORT_PRECACHE__`) are absent, so the page does not bundle the SW code.

## TDD evidence

**RED (separate run).** The test files were final (WIP tests plus my additions). I stashed every implementation file:

```
git stash push -u -m "T37 impl (RED run)" -- apps/web/src/sw/kill-switch.ts apps/web/src/sw/precache-manifest.ts apps/web/src/sw/sw-client.ts apps/web/src/sw/sw.ts
```

`register.ts`, `persist.ts` and `UpdateBanner.tsx` did not exist yet. Command: `pnpm --filter @appsport/web test update-banner-rules register kill-switch persist UpdateBanner`

```
 FAIL  |web| test/sw/kill-switch.test.ts
Error: Failed to resolve import "../../src/sw/kill-switch" from "test/sw/kill-switch.test.ts". Does the file exist?
 FAIL  |web| test/sw/persist.test.tsx
Error: Failed to resolve import "../../src/sw/persist" from "test/sw/persist.test.tsx". Does the file exist?
 FAIL  |web| test/sw/register.test.ts
Error: Failed to resolve import "../../src/sw/register" from "test/sw/register.test.ts". Does the file exist?
 FAIL  |web| test/sw/update-banner-rules.test.ts
Error: Failed to resolve import "../../src/sw/register" from "test/sw/update-banner-rules.test.ts". Does the file exist?
 FAIL  |web| test/sw/UpdateBanner.test.tsx
Error: Failed to resolve import "../../src/sw/UpdateBanner" from "test/sw/UpdateBanner.test.tsx". Does the file exist?
 Test Files  5 failed (5)
      Tests  no tests
```

This is the expected failure: the brief's « Failed to resolve import "../../src/sw/register" », plus the sibling modules. I then ran `git stash pop` and checked with `cmp` against a scratch backup that the four files were restored byte for byte.

**First GREEN attempt.** Same command: 69 of 70 passed. `PublicShell (onboarding) : aucun bandeau` failed with `expected 0 to be greater than 0` (no header yet: the onboarding guard was still waiting for Dexie). The fix is in the test, as described above.

**GREEN.** Same command: `Test Files 5 passed (5)`, `Tests 70 passed (70)`.

**Mutation checks** on `register.ts`, one at a time, restored with `cmp` afterwards (`pnpm --filter @appsport/web test register`). Every mutation fails at least one test:

| Mutation | Result |
|---|---|
| reload on any `controllerchange` | 6 failed |
| older schema accepted (`>= 0`) | 1 failed |
| controller check removed | 1 failed |
| session check removed in `applyUpdate` | 1 failed |
| 426 check on every sync state | 1 failed |
| silent worker never asked again | 1 failed |

## Files changed (`git show --stat HEAD`, checked)

```
 apps/web/src/features/auth/CreateAccountForm.tsx |   3 +
 apps/web/src/main.tsx                            |  13 +
 apps/web/src/repos/index.ts                      |  21 +-
 apps/web/src/sw/UpdateBanner.module.css          |  27 ++
 apps/web/src/sw/UpdateBanner.tsx                 | 105 ++++++
 apps/web/src/sw/kill-switch.ts                   |  85 +++++
 apps/web/src/sw/persist.ts                       |  21 ++
 apps/web/src/sw/precache-manifest.ts             |   2 +
 apps/web/src/sw/register.ts                      | 382 +++++++++++++++++++
 apps/web/src/sw/sw-client.ts                     |  24 +-
 apps/web/src/sw/sw.ts                            |   2 +-
 apps/web/src/ui/AppShell.tsx                     |   8 +-
 apps/web/test/support/fake-sw-container.ts       | 149 ++++++++
 apps/web/test/sw/UpdateBanner.test.tsx           | 154 ++++++++
 apps/web/test/sw/kill-switch.test.ts             | 154 ++++++++
 apps/web/test/sw/persist.test.tsx                | 116 ++++++
 apps/web/test/sw/register.test.ts                | 446 +++++++++++++++++++++++
 apps/web/test/sw/update-banner-rules.test.ts     |  26 ++
 18 files changed, 1719 insertions(+), 19 deletions(-)
```

`git status` is clean after the commit.

## Self-review

- **Rulings.**
  - UI contract: testid, `data-dismissible`, exact texts with straight apostrophes, no « Plus tard » when forced.
  - The banner is first in AppShell and absent from PublicShell.
  - Screens never touch Dexie: `architecture.test` is green. `UpdateBanner.tsx` imports neither Dexie nor `local-db/`; its only base read goes through `repos.status`.
  - No `navigator.onLine` anywhere.
  - The marker constants come from `precache-manifest.ts`, never from `sw.ts`.
  - The kill switch keeps `appsport-meta`.
  - Persistence is requested only when `isStandalone()`.
- **Deliberate small deviations (each kept minimal).**
  1. `probeHealth` uses T26's `fetchJsonWithTimeout` rather than bare `fetchWithTimeout`. Same module and same 4 s, but the deadline also covers reading the body, so a stalled body cannot hang the boot. The JSON is still read on a 503.
  2. `useLive(..., [repos])` instead of `[]`. `repos` is stable per services, so the behaviour is identical, and it matches `ReadyStep` and the other screens.
  3. `reposFor(services)` was added to `repos/index.ts`, which is not in the brief's file list. `main.tsx` needs `repos.status`, and this avoids a second repo set. The WIP tests already expected it.
  4. The hourly check runs 60 min after the last check, and the timer stops while the page is hidden. A foreground check re-arms it. This is how the WIP test was written, and it meets « toutes les 60 min quand l'appli est visible ».
  5. Two robustness additions beyond the brief, both tested: a silent waiting SW is asked again at the next evaluation (a slow wake-up on an old phone would otherwise hide the update until the next launch), and the banner is withdrawn when another window activated the waiting SW.
  6. The marker runs in parallel with the probe and registration, so a blocked Dexie upgrade can never delay registration or the kill switch. `bootServiceWorker` still resolves only once both are done, which the tests rely on.
  7. The `void ...requestPersistentStorage()` calls carry `.catch(() => {})`, so a failed `setMeta` cannot become an unhandled rejection.
- **YAGNI.** No dispose API on the controller, and no special handling if SKIP_WAITING is lost.

## Concerns

1. **Pre-existing flaky tests, made worse by the first version of the banner.** In the first full run, two tests outside T37 failed:
   - `privacy/withdraw.test.tsx` « Je refuse » sur Santé (the witness note was not rendered yet when the gate dialog appeared);
   - `profile/profile-page.test.tsx` « dialogue ouvert : une relecture du compte ne reprend pas le focus ».

   Both are timing-sensitive. With `AppShell.tsx` stashed (baseline, no banner), 1 run in 3 still failed. With a banner that always ran a `liveQuery`, they failed 3 times in 3. The banner now queries `activeSessionId` only while an update is available, and 5 runs in 5 passed; the full suite passed twice. The underlying flakiness of those two tests predates T37 and is worth a ticket.
2. **Touches `src/sw/sw.ts`.** Import only: `ILLUSTRATIONS_CACHE_PREFIX` now comes from `precache-manifest.ts`, behaviour unchanged, T36 tests green. The phone check on iPhone and Android before the tag (R-TST-4) applies anyway, since T37 touches `src/sw`. This is a possible small merge point if the parallel team edits the top of `sw.ts`.
3. **Marker race (negligible).** The page reads, then writes, the marker. If a SW of a higher version activates exactly between the page's read and write, the page could write a lower value. That needs an old page booting at the very moment a newer SW activates. The next boot of the newer build raises it again. Not handled.
4. **Two windows.** When the update is clicked in one window, the other window is claimed by the new SW and keeps running the old build without a reload. This follows the ruling « controllerchange sans applyUpdate ne recharge jamais »; its banner is withdrawn.
5. **Deferred minors from the 2026-10-08 ledger were not addressed, as instructed:** kill-switch reload versus the older-schema guarantee, the illustration list after a failed write, and the same-size catalog update window.

---

# Fix round 1 (HEAD 4b6da04 → cfda9c6), integration of 4 parallel fix branches

Branches were cherry-picked in order with `git cherry-pick 4b6da04..<branch>`. History stays linear, with no merge commits.

| Group | Findings | Branch head | Commits on socle |
|---|---|---|---|
| 1 | T37-F17, T37-F7 | 888d3f0 | e4fd1a6 test(pwa): SW en attente sans localDbVersion jamais proposé (R-DEP-4); f952e08 fix(pwa): « Plus tard » gardé par le contrôleur, lié au SW proposé |
| 2 | T37-F8, T37-F21 | 45f1f46 | 9da8224 fix(pwa): SKIP_WAITING au seul SW encore en attente et traces console du démarrage |
| 3 | T37-F19, T37-F4, T37-F3 | b85bb55 | f3036ed test(pwa): bandeau de mise à jour, séance et onboarding vérifiés sans dépendre du délai |
| 4 | T37-F16, T37-F14, T37-F13, T37-F6, T37-F5 | f90df44 | 3e56df5 test(pwa): couvrir séance terminée, 426 avant abonnement, minuterie horaire, swKill sans nettoyage et liste fraîche |
| integration | (none) | (none) | cfda9c6 test(pwa): état du contrôleur avec dismissed dans les tests fusionnés |

## Group 1: T37-F17, T37-F7

T37-F17 changes tests only:
- `test/support/fake-sw-container.ts`: `installUpdate`/`createWorker` now take `FakeWorkerOptions { localDbVersion?: number | null; silent? }`. With `null`, the STATUS answer leaves out `localDbVersion`, like a SW built before that field existed.
- New register test, « R-DEP-4 : réponse sans localDbVersion (SW antérieur au champ) → jamais proposé, pas de SKIP_WAITING ». The worker gets only GET_STATUS, `available` stays false, and `applyUpdate` sends nothing.
- RED by mutation: register.ts was changed to `(status.localDbVersion ?? LOCAL_DB_VERSION) >= LOCAL_DB_VERSION`. The new test failed with « expected true to be false ». With register.ts restored, 32/32 passed. register.ts itself is unchanged.

T37-F7:
- The « Plus tard » dismissal now lives in the controller, which `swControllerStore` publishes and which outlives AppShell.
- `UpdateState` gains `dismissed`. `SwController` gains `dismiss()`, which records the offered worker in `dismissedWorker`. `setState` derives `dismissed = available && !forced && offered !== null && offered === dismissedWorker`. So the dismissal holds through a re-check that finds the same SW. It clears when a different SW is offered, and it is ignored once a 426 has arrived (R-PWA-5).
- `UpdateBanner.tsx` drops its local `useState` and reads `update.dismissed`.
- Tests: the existing `toEqual` lines now include `dismissed: false`. A new « Plus tard (dismiss) » describe holds 4 tests. UpdateBanner gains two tests:
  - the dismissal survives an unmount and remount;
  - it also survives navigating `/` → « Aide » (PublicShell) → `/`. `markForced()` brings the banner back as non-dismissible.
- RED: 12 failed / 38 passed, including the reported bug (the banner came back after `/help`). GREEN: 5 files / 77 tests on the branch.

## Group 2: T37-F8, T37-F21

T37-F8 (`register.ts`):
- `applyUpdate` awaits the registration. It sends SKIP_WAITING only if `target.state === 'installed' && reg.waiting === target`.
- A new `skipTarget` tracks the worker that got SKIP_WAITING. If that worker turns `redundant` before any reload, `skipTarget` and `reloading` reset and the waiting worker is evaluated again.
- Two tests:
  - (a) A click before C's verdict sends nothing to B or C. The next click sends one SKIP_WAITING to C.
  - (b) C replaces B after the click. The next click targets C, and there is one reload.
- RED:
  - (a) « expected [ { type: 'SKIP_WAITING' } ] to deeply equal [] »;
  - (b) « expected [] to deeply equal [ { type: 'SKIP_WAITING' } ] ».
- Mutation checks: each of the two guards is killed by exactly one of the tests.

T37-F21 (`register.ts`, `kill-switch.ts`):
- When `register()` rejects, the page logs one `console.warn('[appsport] enregistrement du service worker refusé :', name)`. The new `errorName()` helper gives the error name only, never the message, which can carry the URL.
- When the kill switch removes something, it logs one `console.info` just before `reload()`. When there is nothing to clean, it logs nothing.
- Tests: a SecurityError whose message carries a URL with a query must produce one warn without the host or the query. The kill-switch tests mock `console.info`, assert the call count, and assert the call comes before `reload`.
- RED: « expected "info" to be called 1 times, but got 0 times » and « until: condition jamais remplie ».

## Group 3: T37-F19, T37-F4, T37-F3

These are test changes only, in `test/sw/UpdateBanner.test.tsx`.
- New helpers:
  - `watchBanner()` is a MutationObserver attached before render. It counts every time the banner is inserted or removed, so a banner shown for a single render still counts.
  - `liveReadsDone(db)` waits for the same liveQuery reads the banner makes.
- T37-F4:
  - session transition: the banner hides, then comes back, with `forced: true`;
  - session present at mount: `seen() === 0`, then a positive control.
- T37-F3:
  - onboarding transition: the banner hides;
  - onboarding at mount: `seen() === 0`, then a positive control.
- T37-F19: the `/onboarding` row is replaced by `/privacy` for an onboarded member (PublicShell). It expects no banner, then a click on the brand link reaches AppShell, and the banner appears there.
- Mutants A to D each go from surviving (or caught only intermittently) to killed in 12/12 runs. Unchanged src passes 16/16 stress runs.
- Observation, not changed: `AvailableUpdateBanner` does not wait for `useMeState().loaded`. In production, `App` already waits for `loaded` on AppShell routes. See Concerns.

## Group 4: T37-F16, T37-F14, T37-F13, T37-F6, T37-F5

These are test changes only, in `register.test.ts` and `fake-sw-container.ts`. The fake gains `controllerHistory`, a message log for each controller object.
- T37-F16: an `activeSessionId` that goes `'s1'` → `null` gives exactly one SKIP_WAITING and one reload.
- T37-F14: the illustration list is read again for a new controller object (R-SYN-32).
- T37-F13: hourly ticks at +1h, +2h and +3h while the page stays visible, plus a second tick after a hide/show.
- T37-F6: with `swKill` and nothing to clean, `register` is never called, the store stays null, and nothing is reloaded or posted.
- T37-F5:
  - a 426 that arrives before subscription, both direct and through `bootServiceWorker`;
  - re-entering `protocol_unsupported` triggers a new check;
  - the outbox is unchanged (a documentary assertion).
- RED: 7 of the 8 mutants survived the old file (31/31). The new tests kill all 8. Unchanged src passes 39/39.

## Conflicts and integration breakage

- No textual conflict. Git auto-merged `register.ts` and `register.test.ts` (groups 1, 2 and 4) and `UpdateBanner.test.tsx` and `fake-sw-container.ts` (groups 1, 3 and 4).
- Semantic breakage: groups 2 and 4 added state assertions written against `UpdateState = { available, forced }`. Group 1 added `dismissed`. After all four picks, 3 register tests failed with a `+ "dismissed": false` diff:
  - line 166, the F21 register-rejected test;
  - line 480, the F5 426-before-subscription test;
  - line 620, the F5 test through `bootServiceWorker`.
- Fix in cfda9c6: `dismissed: false` was added to those three `toEqual` lines. That is the correct value, since nothing is offered there or a 426 is in force. No other SwController fake or implementation exists: `grep markForced` finds only `UpdateBanner.test.tsx`, which already has `dismiss()`.
- The merged `register.ts` keeps both mechanisms. A dismissed B that a newer C replaces: C is offered again (`offered !== dismissedWorker`), and the next click targets C (group 2's `skipTarget` reset). The two changes do not interfere.

## Final verification (HEAD cfda9c6)

- Covering files: `pnpm --filter @appsport/web test update-banner-rules register kill-switch UpdateBanner persist` gave `Test Files  5 passed (5)` and `Tests  90 passed (90)`. That is 70 at 4b6da04, +7 from g1, +3 from g2, +2 from g3 and +8 from g4.
- `pnpm lint`: `Checked 415 files in 232ms. No fixes applied.`, exit 0.
- `pnpm typecheck`: exit 0 for all packages.
- `pnpm test`:
  - First run: `Test Files  1 failed | 148 passed (149)`, `Tests  1 failed | 1813 passed | 2 skipped`. The failure was `test/profile/profile-page.test.tsx > … dialogue ouvert : une relecture du compte ne reprend pas le focus` (focus assertion). That file is outside T37 and no commit in this round touches it. Run alone it passes 33/33, so it is timing-sensitive under full-suite load.
  - Rerun: `Test Files  149 passed (149)`, `Tests  1814 passed | 2 skipped (1816)`, exit 0, with no stderr and no `[appsport]` lines.

## Concerns

- `test/profile/profile-page.test.tsx` (« une relecture du compte ne reprend pas le focus ») is flaky under load, in the same way as the `withdraw.test.tsx` case the T37 report already lists.
- Group 3's observation is not hardened: `AvailableUpdateBanner` could in theory flash for one render for a member still onboarding, if the session read answers before the `me` read. In production this cannot happen, because `App` waits for `loaded`. A possible hardening is `const { loaded, me } = useMeState(); if (!loaded || activeSessionId === undefined) return null;`.
- The optional `aria-busy` on « Mettre à jour » (group 2) was not done.
