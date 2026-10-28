# Task 29 report — dépôts, état hors ligne, voyant « Prêt hors ligne »

Status: DONE_WITH_CONCERNS (minor, see Concerns)
Commit: 49621b3 feat(web): dépôts d'accès aux données et voyant Prêt hors ligne (Closes #30)

## Implemented
- `src/repos/` : `rows.ts` (`parseJsonColumn` validates an object only, `isLive`, `oneOf`, `ownedRows`, `sendThenPull` = `api.send` → optional `apply` → `await sync.pullNow()`), one file per repo (`me`, `profile`, `places`, `gyms`, `consent`, `admin`, `rejections`, `status`), `index.ts` (`Repos`, `createRepos`, `useRepos` cached per services in a WeakMap).
- MeRepo: `refresh` (offline → cache, ApiError → null, cache kept; other user id → adopt), `deviceOwner`, `login`/`acceptInvitation`/`resetPassword` via `openSession`: **engine stopped before the request** (no cycle of A starts under the cookie the response sets), on failure restarted; `adoptSession`: different `meta.userId` → `wipeUserData({ keepOutbox: false })`, `setMeta userId` before any sync, `rememberMe` (meta.me + `lastAgeBand` rule), `sync.start()` (re-arms after 410, engine resets `connection` on user change), `syncNow('manual')`. `changePassword` → POST, `refresh()`, `syncNow('manual')`. `logout`/`deleteAccount` → wipe after the response (clears meta.userId). `adultNotice`/`dismissAdultNotice`.
- `MetaValues.lastAgeBand: AgeBand`, added to `USER_META_KEYS`.
- Profile/Places/Gyms/Consent/Admin repos per brief (paths checked against server routes; admin `gyms()` = `GET /api/gyms`, no admin list route exists). Gyms `detail` offline → mirrors, `canEdit false`, `history []`, `visibleMembers []`, `offline: true` (doc comment says the screen shows « Liste disponible en ligne »). `withdrawHealth` → meta.me, `purgeHealthData`, pull; 401 → nothing purged.
- RejectionsRepo: server rows (live, not dismissed, owner) then deadletter not covered by a server opId; `dismiss` → `writeLocal` patch `dismissedAt`, deadletter of same opId removed, `void syncNow('mutation')` (the real engine's `runSlot` refreshes `pending` in its `finally`, so the 60 s interval sees the op even offline — tested with the real engine).
- StatusRepo incl. `activeSessionId`, `illustrationFiles` (sorted), `requestPersistentStorage` (absent/refused/error → false, `persisted()` true → true without `persist()`, result in `meta.persistGranted`).
- `sw/protocol.ts`: `SwStatus` (+ `localDbVersion?`); `sw/sw-client.ts`: `getSwStatus(timeoutMs = 1000)` over MessageChannel, validated reply, null without controller/timeout.
- `features/status/`: `readiness.ts` (`RECENT_PULL_MS`, `computeReadiness`, failure labels verbatim), `use-readiness.ts` (mount, each SyncState, every 5 s; latest-call guard; `retry` swallows errors then recomputes), `OfflineReadyIndicator` (`data-testid="offline-ready"`, `data-state`, « Prêt hors ligne » / « Pas encore prêt hors ligne », failing labels, « Réessayer » when live), CSS module.
- `AppServices.swStatus`; `main.tsx` per plan decision (DEV stub, else `getSwStatus()`); `App.tsx` refreshes `me` once on mount when the device knows a session (no request otherwise — keeps T28's "/credits sans requête"); `HomePage`: 18-year Banner info + « J'ai compris », `<OfflineReadyIndicator/>`.
- Test support: `createTestServices` (extracted from `renderWithServices`), `RenderAppOptions.swStatus` (default `{ type: 'STATUS', buildHash: 'test', shellCached: true, illustrationsMissing: 0 }`, `null` allowed), `seed.ts` (`seedMirror` via `applyPulledRows` with pull-format rows, `seedOutbox`). `boot.test.ts` services gain `swStatus`.

## TDD evidence
RED — `pnpm --filter @appsport/web test repos/ status/ home/ architecture` (tests written first, before any src change except test support):
```
 FAIL  |web| test/repos/me-repo.test.ts  Error: Failed to resolve import "../../src/repos" ...
 (same for admin-rejections, consent-repo, offline-mutations, status-repo; profile-places-gyms: "../../src/repos/rows")
 FAIL  test/status/offline-ready.test.tsx  Failed to resolve import "../../src/features/status/OfflineReadyIndicator"
 FAIL  test/status/readiness.test.ts  Failed to resolve import "../../src/features/status/readiness"
 FAIL  test/status/sw-client.test.ts  TypeError: getSwStatus is not a function (×3)
 FAIL  test/home/adult-notice.test.tsx  until: condition jamais remplie (×2)
 FAIL  test/architecture.test.ts > aucun navigator.onLine  sync/triggers.ts contains 'navigator.onLine'
 Test Files  11 failed (11)
```
Expected: modules absent. The architecture failure was the test itself (a doc comment in triggers.ts mentions "jamais de `navigator.onLine`"): the check now strips comments, with self-tests that a real use is still caught.

GREEN — same command: `Test Files 11 passed (11), Tests 76 passed (76)`.
Then one regression in the full suite (`public-pages > /credits statique, sans requête`: App's mount refresh issued GET /api/me with no session) → refresh only when a session is known; added `adult-notice` test "au lancement, le profil rafraîchi révèle le passage à 18 ans" (exactly one GET /api/me).

Final: `pnpm lint` clean (310 files), `pnpm typecheck` clean, `pnpm test`: 116 files, 1146 passed, 2 skipped (pre-existing), no stderr.

## Tests added
me-repo (refresh/cache/ApiError, A→B switch with deviceOwner, same-user relogin keeps outbox, accept/reset adopt, refused login wipes nothing, logout/logout-all, changePassword, real engine 410 → login u-B → health then pull and `online`, real engine A→B with A's cycle blocked in flight: no op of u-A ever pushed, 18-year rules ×3); status-repo; profile-places-gyms (incl. parseJsonColumn/isLive); consent-repo; admin-rejections (incl. real-engine pending refresh); offline-mutations (5 writes); readiness (16 combos, 24 h boundary); sw-client; offline-ready (6 + HomePage); adult-notice (3); architecture.

## Self-review
- Every E write: API first, nothing local before the response; offline test checks a full dump is unchanged and pullCount 0.
- No Dexie/local-db import from features/, ui/, App.tsx, sw/*.tsx (architecture test).
- `useLive(() => repos.me.adultNotice())` in HomePage goes through repos (liveQuery observes the meta reads).

## Concerns
1. `login`/`acceptInvitation`/`resetPassword` stop the engine before sending the request (stricter than the ruling, which stops after the response): it closes the window where A's in-flight cycle could push under B's fresh cookie. On failure the engine is restarted (`start()` triggers a 'launch' sync).
2. P-AUT-6 warning text is T30's UI (`pendingWarning`, dialog); this task exposes `deviceOwner()` and always wipes on a user change (mirrors of A too, not only a non-empty outbox).
3. « Liste disponible en ligne » is a T32 screen concern; the repo returns `offline: true` and documents it.
4. `refresh()` adopts (wipes) when the server session belongs to another user than meta.userId (cookie switched in another tab, which already wiped the shared IndexedDB). App only refreshes when a session is known locally, once per mount.
5. `lastAgeBand` is in `USER_META_KEYS` (per brief), so it is wiped on logout/switch: a user who turns 18 while logged out on this device gets no message on next login.
6. `rejections.dismiss`: `writeLocal` and the deadletter delete are two transactions (writeLocal owns its transaction); a crash between them leaves the deadletter, which then shows as a `local:` rejection until dismissed. Minor.

---

## Fix report — controller ruling after review (commit 1884cdf, Refs #30)

Changes:
1. Tests now catch it if the rulings are removed. The A → B login test records `sync.started` inside the login handler and expects false. The refused-login test expects `sync.started === true` afterwards. Added tests: a local failure after the login response still restarts the engine; a refresh that switches to another account and fails still restarts the engine; logout and deleteAccount have the engine stopped during the request and restarted afterwards; an offline logout wipes nothing and restarts the engine.
2. me-repo: new `withEngineStopped(fn)` (stop, then `start()` in a finally) is used by `openSession` (login, accept, reset), by `refresh` when it switches to another user, and by `logout` and `deleteAccount`. `syncNow('manual')` runs only on success. `adoptSession` no longer starts the engine itself. On a user switch it deletes `meta.userId` before `wipeUserData`, so if the wipe fails, the restarted engine has no user and sends nothing (it never sends A's queue under B's cookie).
3. `rejections.dismiss`: `healthConsentActive` is read first. Then `writeLocal` and the deadletter delete run in one `db.transaction('rw', [outbox, mirror('sync_rejection'), deadletter])`. Test: if the deadletter step throws, there is no op, the copy is unchanged and the deadletter is kept.
4. Coverage: `covered` is built from ALL live owned `sync_rejection` rows, dismissed ones included. This applies in `rejections-repo.ts` and in the engine's `rejectedCount`. Tests: in the repo, deadletter op-2 is covered by the dismissed r-2 and is not listed. With the real engine, `rejected` is 1 (only op-7 counts). New `engine.test`: a rejection dismissed on another device means its local deadletter no longer counts (`rejected` 0).
5. architecture.test: after stripping comments, files are checked against `/\bonLine\b/`, with self-tests for `.onLine`, `?.onLine`, `['onLine']`, destructuring and comments. Imports now also catch side-effect `import 'x'` and `dexie/*`, with a self-test.
6. `useReadiness` now returns `loaded` as well; this field is an addition to the shared interface. `OfflineReadyIndicator` renders nothing (no aria-live) until the first result. Test: while `swStatus` has not answered, there is no indicator and no `[aria-live]`; it shows once the SW answers. The waits in the offline-ready tests now use `queryByTestId`.

RED: `pnpm --filter @appsport/web test repos/ status/ home/ architecture sync/engine.test`
```
 × list : rejets serveur actifs puis rejets locaux non couverts …
 × dismiss d'un rejet serveur … / × dismiss atomique … / × après l'écriture locale, le compteur du moteur …
 × rien avant le premier résultat (aucune annonce « pas prêt » au montage)
 × échec local après la réponse : moteur relancé quand même / × refresh vers un autre compte en échec : moteur relancé
 × logout : une requête, … / × deleteAccount : moteur arrêté pendant la requête, …
 × rejet écarté sur un autre appareil : sa deadletter locale ne compte plus
 Test Files  4 failed | 8 passed (12)   Tests  10 failed | 117 passed (127)
```
(The stronger architecture checks passed against the current code, as expected: src has no violations.)

GREEN: `pnpm --filter @appsport/web test repos/ status/ home/ architecture sync/` → 21 files, 193 passed.
Full run: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test`: 116 files, 1154 passed, 2 skipped, no stderr.
