# Task 36 report: custom service worker (shell, illustrations, messages, SW-side kill switch)

- **Status:** DONE_WITH_CONCERNS
- **Worktree / branch:** `C:\Users\eliott.colin\appsport-pwa`, `socle-pwa` (not pushed)
- **Commit:** `81e1001` feat(pwa): service worker maison (coquille, illustrations, messages, interrupteur d'urgence), `Closes #37`
- **Review package:** `/c/Users/eliott.colin/appsport-pwa/.superpowers/sdd/2026-10-06-socle/review-3f0cbaf..81e1001.diff`

## What I implemented

`apps/web/src/sw/sw.ts` replaces the T35 stub. It exports the brief's interfaces verbatim: `REFERENCED_ILLUSTRATIONS_KEY`, `SwRequest`, `SwWindowClient`, `SwScope`, `SwHandlers`, `cachesToDelete`, `planIllustrationSync`, `createSwHandlers`, `SwEvent`, `SwFetchEvent`, `SwMessageEvent`, `SwGlobalLike` (typed members, no `any`) and `installServiceWorker`. It uses the DOM lib only and never references `indexedDB`.

- **install:** reads the local DB marker first (see concern 1). It then runs `fetch(file, { cache: 'reload' })` for every manifest file. Any response that is not `ok` rejects the install. All files are downloaded before any write, so a failed install leaves no partial shell. Writing into a cache only on success matters for a SW-only change: the buildHash stays the same, so deleting on failure would delete the active SW's own shell. No `skipWaiting`.
- **activate:** deletes the `cachesToDelete` caches (old `shell-*` only), opens `illustrations-v1`, writes the marker without ever lowering it, then calls `claimClients()`.
- **handleFetch,** in the brief's order:
  - non-GET, another origin, or `/api` / `/api/*` returns `null`. Navigations count too, including `/api/me/export`.
  - A navigation gets `index.html` from `shell-<buildHash>`, using `caches.match` with `cacheName` so nothing is created. The network is used only when that file is missing. `NAVIGATION_TIMEOUT_MS` is not used.
  - `/illustrations/*` is served cache first and cached only on status 200.
  - A manifest file is served from the shell first.
  - Anything else returns `null`.
- **messages:**
  - `SKIP_WAITING` calls `skipWaiting()`.
  - `GET_STATUS` replies with `SwStatus`, `localDbVersion` included, on the MessageChannel port. If illustrations are missing and no sync is running, it then retries them in the background. The handler's promise, which the SW wraps in `waitUntil`, resolves after that retry.
  - `SYNC_ILLUSTRATIONS` runs one sync at a time, in arrival order. The file list (valid single-segment names only, so nothing can escape `/illustrations/`) is saved as JSON under `REFERENCED_ILLUSTRATIONS_KEY` in `illustrations-v1`. `planIllustrationSync` only sees `/illustrations/*` keys, so the saved list is never deleted. At most 4 downloads run in parallel, and failures are ignored.
- **checkKillSwitch:** fetches `/api/health` with `no-store` and a 4 s limit that covers the body too. It uses AbortController plus a timer race; see concern 3. The JSON is read whatever the status, and only `swKill === true` counts. When it is true: unregister, delete the `shell-*` and `illustrations-*` caches (IndexedDB and the marker stay), then `navigate(client.url)` for every window client.
- **installServiceWorker:**
  - install and activate go through `waitUntil`.
  - For fetch, a non-null `handleFetch` result goes to `respondWith`, once. A navigation also gets `waitUntil(checkKillSwitch())`, which does not block the response.
  - A message is validated by hand (no Zod), then handled through `waitUntil`; unknown or malformed messages are ignored.
- **Bootstrap with no side effect on import:** `if (typeof g.skipWaiting === 'function' && 'registration' in g && precache) installServiceWorker(...)`.

`apps/web/test/support/fake-sw-scope.ts` provides:
- `createFakeCacheStorage()`: in memory. A relative key resolves against the origin, a fresh Response comes back on each read, and `match` with `cacheName` creates nothing. Its optional `origin` argument is a superset of the brief's signature.
- `createFakeSwScope()`: network cut by default. It also has `fetchLog`, counters and `navigations`.
- `staticNetwork()`.

## Tests

- `test/sw/sw-pure.test.ts` (8 tests) covers `cachesToDelete`, the 4 `planIllustrationSync` cases from the brief, and a source scan that finds no `indexedDB`, `dexie` or `local-db` in sw.ts.
- `test/sw/sw-handlers.test.ts` (38 tests) covers every case in the brief:
  - install, including the 404 case;
  - activate, with the 'appsport' Dexie DB still holding `meta.userId` 'u1';
  - navigation cache-first and the network fallback;
  - **Review Focus 5**;
  - manifest files;
  - 8 non-intercepted requests;
  - illustrations cached only on 200 (500 and 404 are not cached);
  - SKIP_WAITING;
  - GET_STATUS over a real MessageChannel, plus `shellCached` false;
  - SYNC_ILLUSTRATIONS;
  - a 500, then the background retry (b requested twice);
  - the saved list read back after a restart and never deleted, even by `[]`;
  - serialization and at most 4 in parallel;
  - invalid names;
  - kill switch true, 503 with true, five false cases, and the 4 s timeout with fake timers;
  - `installServiceWorker`: navigation `respondWith` once plus a non-blocking `waitUntil`, kill switch through navigation, non-intercepted requests, and messages.
- `test/sw/sw-bootstrap.test.ts` (3 tests, node env) bundles the real `src/sw/sw.ts` with `bundleServiceWorker` and runs it in `node:vm`. A SW global listens to install, activate, fetch and message. A page global, or a SW global with no manifest, gets nothing.

Results:
- `pnpm --filter @appsport/web test sw-pure sw-handlers sw-bootstrap`: `Test Files 3 passed (3)`, `Tests 49 passed (49)`.
- `pnpm lint`: `Checked 338 files … No fixes applied.`
- `pnpm typecheck`: clean.
- `pnpm test`: `Test Files 126 passed (126)`, `Tests 1326 passed | 2 skipped (1328)`. No stderr from the SW tests.
- `pnpm build`, then the brief's `node -e "…/\bexport\b|^import /m…"` check: exit 0. `dist/sw.js` is 5.5 kB. Running it in `node:vm` with a SW-like global registers `install,activate,fetch,message`; a page-like global registers nothing.

## TDD evidence

**RED 1** (separate run, tests written before any implementation): `pnpm --filter @appsport/web test sw-pure sw-handlers`

```
 ❯ |web| test/sw/sw-handlers.test.ts (0 test)
 ❯ |web| test/sw/sw-pure.test.ts (8 tests | 7 failed) 6ms
     × purge les shell-* des autres builds ; garde le build courant, les illustrations et le reste
     × ([ 'a', 'b', 'b' ], [ 'b', 'c' ]) → { toFetch: [ 'a' ], toDelete: [ 'c' ] } …
 FAIL  |web| test/sw/sw-handlers.test.ts
Error: Failed to resolve import "../support/fake-sw-scope" from "test/sw/sw-handlers.test.ts". Does the file exist?
TypeError: cachesToDelete is not a function
TypeError: planIllustrationSync is not a function
 Test Files  2 failed (2)
      Tests  7 failed | 1 passed (8)
```

These are the brief's expected failures. The one passing test is the IndexedDB source scan, which passes on the empty stub.

**GREEN 1:** same command, `Test Files 2 passed (2)`, `Tests 45 passed (45)`.

**RED 2** (kill-switch timeout, found in self-review): the test `/api/health sans réponse : false au bout de 4 s` was added while the code still used `AbortSignal.timeout`. Run with `pnpm --filter @appsport/web test sw-handlers -t "sans réponse"`:

```
AssertionError: expected null to be false // Object.is equality
 ❯ test/sw/sw-handlers.test.ts:444:23   expect(verdict).toBe(false);
 Tests  1 failed | 37 skipped (38)
```

A hung health request never settled the check.

**GREEN 2:** switched to AbortController plus a `setTimeout` race. `sw-pure sw-handlers sw-bootstrap` gives `Tests 49 passed (49)`.

`sw-bootstrap.test.ts` was written after GREEN 1 to verify the bootstrap, not test-first. Its teeth are shown by the "bootstrap always" mutation below.

**Mutation checks**: 13 mutations of sw.ts, one at a time; every one makes at least one test fail. sw.ts was then restored byte for byte.

| Mutation | Tests failed |
|---|---|
| no serialization | 1 |
| 10 parallel downloads | 1 |
| network-first navigation | 5 |
| skipWaiting on install | 6 |
| kill switch deletes every cache | 1 |
| no retry on GET_STATUS | 2 |
| cache non-200 responses | 1 |
| `/api` intercepted | 3 |
| marker ignored | 1 |
| marker lowered | 1 |
| swKill truthy instead of `=== true` | 1 |
| no claim | 2 |
| bootstrap without the SW-global guard | 1 |

## Files changed (`git show --stat HEAD`, checked)

```
 apps/web/src/sw/precache-manifest.ts   |   8 +
 apps/web/src/sw/sw.ts                  | 398 ++++++++++++++++++++++-
 apps/web/test/support/fake-sw-scope.ts | 168 ++++++++++
 apps/web/test/sw/sw-bootstrap.test.ts  |  43 +++
 apps/web/test/sw/sw-handlers.test.ts   | 578 +++++++++++++++++++++++++++++++++
 apps/web/test/sw/sw-pure.test.ts       |  44 +++
 6 files changed, 1236 insertions(+), 3 deletions(-)
```

`git status` is clean.

## Self-review

- Controller rulings:
  - Navigation is served from the shell first, with the network only when `index.html` is missing and no timeout.
  - `/api/*` is never intercepted.
  - skipWaiting only on the message; claim and the `shell-*` purge on activate; `illustrations-v1` is kept.
  - The saved illustration list lives in the illustrations cache and is excluded from the plan.
  - `SwGlobalLike` is typed.
  - `SwStatus` includes `localDbVersion`.
  - The kill switch never touches IndexedDB.
  - All tests are deterministic. The sw-bootstrap test uses `node:vm` rather than fake-sw-scope, because it exercises the real compiled bundle.
- `caches.open` is called only where creating the cache is intended (install, activate, sync). Every lookup uses `caches.match(…, { cacheName })`.
- `Response.json()` is not used inside the SW (`new Response(JSON.stringify…)`), for older Safari.

## Concerns

1. **ADR 0001 decision 5 is implemented on the SW side, beyond the brief.** The ADR on this branch (3f0cbaf, accepted, "Refs #36") specifies three things for sw.ts:
   - a marker in Cache Storage (`appsport-meta`, key `/__sw/local-db-version`);
   - an `install` that refuses a manifest whose `localDbVersion` is below the marker, before any download;
   - an `activate` that writes the marker without ever lowering it.

   No plan task carried this, and T36 is the only task that owns sw.ts, so I implemented it. The constants `LOCAL_DB_MARKER_CACHE` and `LOCAL_DB_MARKER_KEY` went into `precache-manifest.ts` (ADR decision 3; the page will need them), which is outside the brief's file list.

   As a result, the brief's exact cache lists now include `'appsport-meta'`:
   - activate: `['appsport-meta','illustrations-v1','shell-aaaaaaaaaaaa']`;
   - Review Focus 5: `[…, 'shell-bbbbbbbbbbbb']` with the marker first;
   - kill switch: `['appsport-meta','autre']`, which proves the marker survives.

   The page side (writing the marker after Dexie opens) is left to T37. If the controller wants this out of T36, it is self-contained: `readMarker` plus 2 call sites, 3 tests, and 2 constants.
2. **Extra test file** `test/sw/sw-bootstrap.test.ts`, outside the brief's list: it checks the real bundled bootstrap, see above.
3. **`AbortSignal.timeout` replaced by AbortController plus a timer race.** `AbortSignal.timeout` is missing before Safari 16, and the throw would be swallowed, so the kill switch would never fire. Also, a request that ignores the abort would hold the `waitUntil` forever. Fixed with its own RED and GREEN.
4. sw.ts is about 400 lines with types and doc comments, against the ADR's "environ 150 lignes" estimate.
5. Minor points for T37 and later:
   - A *waiting* SW that answers `GET_STATUS` (T37 reads its `localDbVersion`) can also start the illustration retry into the shared `illustrations-v1`. That is harmless, at worst duplicate downloads.
   - If the page posts `SYNC_ILLUSTRATIONS` while it has no controller yet (`postToSw` returns false), the SW never learns the list and reports `illustrationsMissing: 0`. The page should post it again once a controller exists (`StatusRepo.illustrationFiles()` is there for that).
   - During a deploy, the install's per-file fetches could get an `index.html` from a newer build than the manifest. There is no per-file integrity check; that could be a follow-up.

---

# Fix round 1 (T36-F1 to F18)

- **Status:** DONE_WITH_CONCERNS (T36-F1 required edits to page-side files from T29, see Concerns)
- **Worktree / branch:** `C:\Users\eliott.colin\appsport-pwa`, `socle-pwa`, base `81e1001`, not pushed
- **Commits** (each ends with `Refs #37` and the Co-Authored-By trailer):
  - `7b413be` fix(pwa): illustrations comptées sur la dernière liste reçue, liste inconnue distinguée de la liste vide (F1, F2, F7)
  - `e0a3623` fix(pwa): reprise des illustrations espacée de 2 s à 5 min, téléchargement borné à 30 s (F3, F10, F15)
  - `92ecc25` fix(pwa): install lit chaque corps avant d'écrire et ne touche jamais la coquille du SW actif (F5, F11)
  - `c4a8541` fix(pwa): activate isole marqueur, purge et illustrations, clients.claim toujours appelé (F8)
  - `f9bad20` fix(pwa): interrupteur d'urgence, rechargement des fenêtres même si un navigate ou une suppression échoue (F9, F16)
  - `ef57e68` test(pwa): Review Focus 5 jusqu'à l'activation de B, messages par l'écouteur réel, dédoublonnage et localDbVersion (F4, F6, F17, F18)

## Changes per finding

**T36-F1 (unknown list read as "0 missing"), Important.** Two parts.
- *SW (`sw.ts`):* `latestReferenced` keeps in memory the last list received by `SYNC_ILLUSTRATIONS`, made of valid and distinct names (`referencedList`, which replaces `safeFiles` and now deduplicates). It is set when the message arrives, before the sync is queued. Status and retries count against it (`currentReferenced()` = memory, else the stored list). A `GET_STATUS` handled while the sync is still queued now counts against the new list.
- *Unknown versus empty:* `SwStatus` gains `illustrationsReferenced?: number | null`. It is the number of distinct illustrations in the list the SW counts against, or `null` when the SW has no list. `illustrationsMissing` stays 0 when there is no list, so the brief's example holds except for the added field.
- *Page:* `computeReadiness` takes `illustrationCount`, the number of distinct files in the local catalog. `use-readiness.ts` gets it from `StatusRepo.illustrationFiles()`. The illustrations check now also requires `illustrationsReferenced === illustrationCount`. A `null` list, or the list of an earlier catalog with a different count, therefore stays red. When the field is absent (the dev stub in `main.tsx`, which has no SW), only `illustrationsMissing` is used. `sw-client.ts` `isSwStatus` accepts `undefined`, `null` or a number and refuses anything else.
- *Brief and T37:* the brief's GET_STATUS example now reads `illustrationsReferenced: null`, which is a plan amendment for the controller. Re-sending `SYNC_ILLUSTRATIONS` at boot and on every `controllerchange` is already in the T37 brief (`bootServiceWorker`, "renvoyé à chaque controllerchange"), so no extra pointer is needed.

**T36-F2 (list written before deletions, uncaught), Important.** `runSync` now runs in this order:
1. Compute the plan from the new list.
2. Delete stale files (`Promise.allSettled`).
3. Write the list in a try/catch (`saveReferenced`).
4. Download.

A quota error on the list no longer aborts the sync, and space is freed first. Because of the in-memory list from F1, the status never counts against the old catalog. A retry that works from the in-memory list also writes it again.

**T36-F3 (retry on every GET_STATUS), Important.**
- The first retry is still immediate, so the brief's "b demandé deux fois" holds. After it, `retryDelay` doubles from 2 s up to 5 min (`RETRY_MIN_MS`, `RETRY_MAX_MS`, R-SYN-30), and GET_STATUS only retries once `Date.now() >= retryNotBefore`.
- The delay resets when a retry leaves 0 missing, and when a new `SYNC_ILLUSTRATIONS` arrives. A `listGeneration` counter stops a retry that started before the new list from touching the delay.
- `runSync` now returns how many illustrations it failed to cache.
- Not done: the optional "skip 404 until the next list". With the backoff, a lasting 404 costs one request every 5 min.

**T36-F10 (no download timeout), Minor.** New helper `withDeadline(ms, fallback, run)`: an AbortController plus a timer race, so it works without `AbortSignal.timeout` and also when a request ignores the abort. `killRequested` now uses it too.
- Each illustration download, body included, is bounded to `DOWNLOAD_TIMEOUT_MS` = 30 s.
- A timeout counts as an ignored failure.
- A late response is dropped and never written.

**T36-F15 (retry inside waitUntil), Minor.** Test only. B's second response waits on a deferred. The test checks that the `handleMessage(GET_STATUS)` promise is still pending after the reply arrives, then resolves after the release with 0 missing.

**T36-F5 and T36-F11 (install), Important and Minor.**
- `install` reads every body (`new Response(await res.arrayBuffer(), res)`) before it opens the cache. A body that fails mid-stream no longer leaves a partial `shell-<hash>`. Side effect: the copy no longer carries `redirected`.
- Writes go through `Promise.allSettled`. On a failure, the cache is deleted only if this install created it (`created = !caches.has(shellCache)` before `open`). A SW-only update shares the active SW's cache and never deletes it.
- Tests:
  - the 404 now lands on the last file, `/index.html`;
  - a body stream that errors;
  - a quota error on `/index.html` with fresh storage;
  - a reinstall with the same buildHash over an active A, once with a 503 on `/index.html` and `A2-app` served, once with a quota error. Both reject, and A still serves `A-index` and `A-app`.

**T36-F8 (activate), Minor.**
- `activate` runs `raiseMarker`, `purgeStaleShells` (allSettled) and opening `illustrations-v1` in that order, marker first, each in its own try/catch.
- `claimClients()` always runs. The first error is rethrown afterwards so it shows in the console; the activation still completes.
- Tests: a marker write that throws (purge done, illustrations opened, claim 1), and a stale-shell delete that rejects (marker '1', claim 1).

**T36-F9 (kill switch reload), Minor.**
- Cache deletions go through `Promise.allSettled`, and navigations through `windows.map(async (client) => client.navigate(client.url))`, so a synchronous throw becomes a rejection.
- A rejected `unregister` still aborts before any reload. Reloading while still registered could loop through the kill switch.
- Test: one window whose `navigate` throws synchronously, next to a normal one, plus `illustrations-v1` refusing deletion. The normal window is reloaded and the shell is gone.

**T36-F16 (kill switch order and prefixes), Minor.**
- The fake scope now has `events`:
  - 'unregister' is logged once it completes;
  - 'cache-delete:<name>' is logged at the call and 'cache-deleted:<name>' once done;
  - 'navigate:<url>' is logged at the call.
- In the fake, `unregister` and `caches.delete` complete on the next task, so an effect that is not awaited shows up out of order.
- The test seeds `shell-bbbbbbbbbbbb` and `illustrations-v0`, expects both deleted, and asserts `unregister` < each `cache-delete` and each `cache-deleted` < `navigate`.

**T36-F4 (Review Focus 5), Important.** The test continues past the existing checks:
- **A loses `/index.html` while B waits.**
  - `hA` navigation with the network cut rejects; it never serves `B-index`.
  - `hA.status().shellCached` is false.
  - With the network on, the body is `net-index` and `fetchLog` is exactly `[ORIGIN + '/']`.
- **B activated.**
  - `hB` serves `B-index` and `B-app` with an empty `fetchLog`.
  - The caches are `[appsport-meta, illustrations-v1, shell-bbbbbbbbbbbb]`.

**T36-F6 (listener), Important.** In the `installServiceWorker` message test:
- a valid `SYNC_ILLUSTRATIONS` goes through `sw.message`, with exactly one wait, and leaves IA and IB cached;
- SKIP_WAITING and GET_STATUS each have exactly one wait;
- `{ type: 'SYNC_ILLUSTRATIONS' }` with no `files` and `files: ['a', 1]` are ignored.

**T36-F7 (partial failures), Important.** `createFakeCacheStorage({ origin?, failPut?, failDelete? })`, plus `quotaExceeded()` and `deferred()`. The options object replaces the earlier `origin` positional argument; `createFakeSwScope` was its only caller. Tests:
- a fetch rejected for IB: the sync resolves, IA is cached, 1 missing;
- a rejected fetch while IA is still downloading: the next sync waits for IA (no IC request before release);
- a quota error on one illustration;
- a quota error on the list only;
- full storage, so every put fails (F2);
- `illustration()` serving the network response while put throws.

**T36-F17, Minor.** `planIllustrationSync(['a','a'], [])` gives `{ toFetch: ['a'], toDelete: [] }`.

**T36-F18, Minor.** A waiting SW whose manifest has `localDbVersion` 2, with the marker at 1, reports 2 in GET_STATUS. The optional variant inside the Review Focus 5 fixture was not added; this dedicated test covers it.

## TDD evidence

RED runs were made before each fix, with the outputs kept.

- **RED 1** (F1, F2, F7), `pnpm --filter @appsport/web test sw-handlers readiness sw-client offline-ready`: `Tests 10 failed | 53 passed (63)`.
  ```
  × GET_STATUS : SwStatus par le MessageChannel … → expected { type: 'STATUS', …(4) } to deeply equal { …(5) }
  × SYNC_ILLUSTRATIONS puis GET_STATUS sans attendre la synchro → expected {…} to match object { illustrationsMissing: 2, …(1) }
  × liste non enregistrée, stockage plein … → promise rejected "QuotaExceededError: Quota exceeded" instead of resolving
  × écriture de la liste en échec seule … → promise rejected "QuotaExceededError: Quota exceeded" instead of resolving
  × illustration refusée par le stockage plein … → expected {…} to match object { illustrationsMissing: 1, …(1) }
  × illustrations : le SW compte sur la liste du catalogue local … → expected true to be false
  × illustrationsReferenced : nombre ou null accepté, autre valeur refusée → expected {…} to be null
  × SW sans liste ou avec la liste d'un autre catalogue → until: condition jamais remplie
  (+ 2 status tests now expecting illustrationsReferenced)
  ```
  The other F7 tests pass at HEAD because the code already handles those cases. Their teeth are shown by the mutations below.
  **GREEN 1:** `Test Files 6 passed (6)`, `Tests 74 passed (74)`.
- **RED 2** (F3, F10), `pnpm --filter @appsport/web test sw-handlers -t "reprise et délais"`:
  ```
  × reprise au GET_STATUS : immédiate une fois, puis espacée … → AssertionError: avant 2000 ms: expected 4 to be 2
  × téléchargement bloqué : annulé au bout de 30 s … → Error: Test timed out in 5000ms.
  Tests 2 failed | 2 passed | 45 skipped (49)
  ```
  **GREEN 2:** `sw-handlers sw-pure sw-bootstrap`, `Tests 60 passed (60)`.
- **RED 3** (F11), `-t install`: the body-stream and quota tests fail with `expected true to be false` (a partial `shell-aaaaaaaaaaaa` is left), `Tests 2 failed | 11 passed`. **GREEN 3:** `Tests 56 passed (56)`.
- **RED 4** (F8), `-t activate`: marker-throws and purge-rejects fail with `expected +0 to be 1` (claimCalls), `Tests 2 failed | 3 passed`. **GREEN 4:** `Tests 58 passed (58)`.
- **RED 5** (F9), `-t checkKillSwitch`: `Error: suppression refusée` (checkKillSwitch rejected), `Tests 1 failed | 8 passed`. **GREEN 5:** `Tests 59 passed (59)`.
- **Test-only findings** (F4, F5, F6, F7 coverage, F15, F16, F17, F18): the code was already correct at HEAD, so a RED against it would be meaningless. RED is shown by mutating `sw.ts` one change at a time and restoring it byte for byte (`cmp` with a backup) after each run.

| Mutation | Killed by |
|---|---|
| no try/catch around a download | 4 tests (rejected fetch ×2, quota on an illustration, full storage) |
| no try/catch in `illustration()` | stockage plein, l'image s'affiche |
| `void retryMissing()` (not awaited) | 3 tests, including the F15 waitUntil test |
| no backoff gate | spacing test |
| no reset on a new list | spacing test |
| no reset of the delay after success | reset test (after strengthening it: it first survived, so the test now checks that the next failure waits 2 s, not 8 s) |
| install deletes `shell-<hash>` on any failure | 2 same-buildHash tests |
| lazy sequential open and put in install | 4 install tests |
| `navigate` sync throw not caught | navigate/suppression test |
| navigate first | ordered kill switch test |
| `void unregister()` | ordered kill switch test (it survived with the first, microtask-only fake, which is why the fake effects now complete on the next task) |
| `void Promise.allSettled(deletes)` | ordered kill switch test (same history) |
| all in one `Promise.allSettled` | ordered kill switch test |
| delete only the current shell and illustrations-v1 | ordered kill switch test |
| unscoped `caches.match` in `fromShell` | Review Focus 5 |
| parser drops `SYNC_ILLUSTRATIONS` | listener test |
| `void handleMessage` instead of `waitUntil` | listener test |
| mixed array accepted | listener test |
| `planIllustrationSync` without `Set` | sw-pure duplicate case |
| marker reported as `localDbVersion` | waiting-SW status test |

## Final verification (HEAD `ef57e68`)

- `pnpm --filter @appsport/web test sw-pure sw-handlers sw-bootstrap readiness sw-client offline-ready`: `Test Files 6 passed (6)`, `Tests 87 passed (87)`.
- `pnpm lint`: `Checked 338 files … No fixes applied.`
- `pnpm typecheck`: clean.
- `pnpm test`: `Test Files 126 passed (126)`, `Tests 1349 passed | 2 skipped (1351)`, exit 0. No stderr; only vitest's usual happy-dom footer.
- `pnpm build`, then the brief's `node -e "…/\bexport\b|^import /m…"` on `dist/sw.js`: exit 0, 6776 bytes.
- `git status`: clean.

`git diff --stat 81e1001 HEAD`:

```
 apps/web/src/features/status/readiness.ts     |  16 +-
 apps/web/src/features/status/use-readiness.ts |   9 +-
 apps/web/src/sw/protocol.ts                   |   7 +
 apps/web/src/sw/sw-client.ts                  |   3 +
 apps/web/src/sw/sw.ts                         | 259 ++++++++++++----
 apps/web/test/status/offline-ready.test.tsx   |  24 ++
 apps/web/test/status/readiness.test.ts        |  25 ++
 apps/web/test/status/sw-client.test.ts        |  16 +
 apps/web/test/support/fake-sw-scope.ts        |  80 ++++-
 apps/web/test/sw/sw-handlers.test.ts          | 417 +++++++++++++++++++++++++-
 apps/web/test/sw/sw-pure.test.ts              |   2 +
 11 files changed, 774 insertions(+), 84 deletions(-)
```

## Concerns

1. **Edits outside T36's file list, for T36-F1.** They touch:
   - the shared `SwStatus` interface (`protocol.ts`, new optional `illustrationsReferenced`);
   - `sw-client.ts` validation;
   - T29's `readiness.ts` (new `illustrationCount` input) and `use-readiness.ts` (reads `StatusRepo.illustrationFiles()`, about 300 rows, on every refresh, every 5 s);
   - their tests.

   I did not change the `StatusRepo` interface. A field that is absent keeps the old rule (the dev stub has no SW). The brief's GET_STATUS example needs amending to `illustrationsReferenced: null`.
2. **The count comparison is a proxy.** A list from an earlier catalog with the same number of files would still pass. Today that needs a dropped `postToSw` while a controller exists, and T37 re-sends the list at boot and on every `controllerchange`. Comparing the names exactly, or a fingerprint of them, would close that case if wanted.
3. **`activate` rejects after `clients.claim` when a step failed,** so the error reaches the console. Under the SW spec, activation still completes when the activate `waitUntil` promise rejects.
4. **Shell bodies are now buffered before writing.** A shell file served with a null-body status such as 204 would reject the install, which I consider correct for a broken deploy. Illustrations are buffered the same way within their 30 s deadline.
5. **`createFakeCacheStorage` now takes an options object.** It is a superset of the brief's `createFakeCacheStorage(): CacheStorage`; T37 will consume it.
