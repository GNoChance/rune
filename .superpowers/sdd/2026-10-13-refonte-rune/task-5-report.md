# Task 5 report: coquille, navigation et état de connexion (#53)

Branch `socle`, main checkout. Commits on top of `2e30e34`:

- `10404f9` fix(pwa): interrupteur d'urgence, la page encore contrôlée se recharge quand le SW a fait le ménage sans la joindre
- `f70eba5` feat(web): coquille Rune, barre d'onglets flottante, navigation latérale et état de connexion unique (Closes #53)

Status: DONE_WITH_CONCERNS (see Concerns: one fix sits outside the brief's file list, in `src/sw/kill-switch.ts`).

## What was implemented

- **TAB_ITEMS** (`ui/TabBar.tsx`), exactly as the brief. `activeTab(path)` matches by path prefix, ignoring case and a trailing slash: `/` exact → Accueil; `/progression…` → Progression; `/places…` and `/gyms/…` → Salles; `/profile…`, `/settings`, `/rejections` and `/admin…` → Profil (GUIDE: « Profil for profile, settings, health, privacy and admin screens »). Anything else (a 404) → no active tab.
- **TabBar**: a floating pill on phone, as in MixSombre and MixClair (68 px high, radius 24, 4 columns, 12 px labels, mockup icons). It is a `nav` labelled « Navigation principale », the active tab has `aria-current="page"`, and the pill slides (`--tab-index`, `--dur-screen`, single easing curve). The pill is hidden when no tab is active, and moves without sliding under reduced motion. The bar sits at z-index 50, below the bottom sheets (100). In forced-colours mode the active tab gets an outline.
- **SideNav** (≥ 900 px, `useMediaQuery`): the brand, then the same 4 entries, active one with `aria-current`. Only one of the two navs is ever rendered, so there is never a duplicate landmark. On PC the content is centred and capped at 960 px.
- **Home header**, shown on Accueil only (spec §5 « En-tête de l'accueil », GUIDE « Accueil only », mockups: inner pages have no brand header): logo (with glow in dark) and RUNE linking to `/`, then `ConnectionPill`, then the initial in a 36 px circle linking to `/profile` (« Mon profil », 44 × 44 touch target). The counters are gone; `PendingCounter` and `RejectedCounter` are kept for Réglages (Task 10).
- **ConnectionPill** (`ui/ConnectionPill.tsx`) reads `useSyncState().connection`: offline → « Hors ligne », never « En ligne ». It shows a 7 px decorative dot (green when online, grey, or warning colour when you need to act). It keeps `data-testid="connection-status"`, `data-state` and `role="status"`. `features/status/ConnectionStatus.tsx` now only holds `CONNECTION_LABELS` and `CONNECTION_TONES`.
- **UpdateBanner**: placed under the header (on inner pages, at the top of the content), restyled after E06 (accent-tinted card, icon in a circle, title, the two buttons side by side). Its rules are unchanged: never during onboarding or a session, and no « Plus tard » after a 426.
- **Page** now goes through `PageHeader` (44 × 44 Retour, `h1` title). `back` also accepts a function.
- **Screen transitions** (`ui/screen-transition.ts`): `screenTransition(from, to, stack)` decides the direction:
  - another tab → `tab`, a fade of 300 ms;
  - the parent screen, or the screen just before in the stack (browser back) → `back`, entering from the left;
  - otherwise → `forward`, entering from the right (48 px, 380 ms).

  `useScreenTransition` keeps the stack in derived state; `useScreenEntrance` plays it with Web Animations on `<main>` (no inline style, nothing frozen at the end). The result is exposed as `data-screen-transition`. Under reduced motion it is a plain 200 ms fade.
- **BootSplash** (`ui/BootSplash.tsx`, mounted in `main.tsx` next to `<App/>`): once per tab session (sessionStorage `rune.boot-splash`, with a fallback when storage is refused), the logo frame draws itself in 900 ms (drawing done by 1.05 s), then the overlay fades out (done at 1.45 s). It is `aria-hidden`, has no text, uses `pointer-events: none` and z-index 90 (below the sheets). It is removed at the end of its own animation, with a 2 s safety timer, and renders nothing under reduced motion.
- **Routes** (rulings P5, P6): `/progression` → `ProgressionPage`, a minimal page with heading « Progression ». `/places` and `/places/:id` replace the `/profile/places` routes. `resolveGuard` redirects `/profile/places…` to the same path under `/places`, keeping the rest of the path and ignoring case; there is no loop, and it runs after the session, password and onboarding checks. Internal links were updated:
  - PlacesPage: link to a place; no Retour any more, since it is a top-level tab;
  - PlaceDetail and GymPage: Retour now goes to `/places`;
  - ProfilePage: the « Lieux » link.

  `/gyms/:id` is unchanged. The `/admin/*` routes keep working (with no entry point until T10 adds the Profil row).
- **Kill switch** (separate commit, see Concerns): page side, if `swKill` is set and nothing is left to remove but the page is still **controlled** by a SW, it reloads once (guard: sessionStorage `rune.kill-switch-reload`, with a fallback).
- **E2E adapted**:
  - `offline`: the pill is read on Accueil, and the spec goes through the « Accueil » and « Profil » tabs; the empty outbox is read from IndexedDB;
  - `epoch` and `protocol`: the counter assertions are removed, because the outbox and deadletter queue are already read directly;
  - `sheet`: `/places`.

## Tests and results

- `pnpm lint`: clean (500 files).
- `pnpm typecheck`: clean (4 packages).
- `pnpm test`: 171 files, 2322 passed, 2 skipped (pre-existing), no noisy output. Web project: 74 files, 1206 tests.
- `pnpm --filter @rune/web test:e2e` (whole suite, Chromium Pixel 7 and WebKit iPhone 14): **18 passed (3.0 min)**. Baseline before the change: 18/18.
- `kill-switch` E2E repeated after the fix: 12/12 (6 Chromium + 6 WebKit).

New and updated tests:

- `test/app/shell.test.tsx` (60 tests): TAB_ITEMS; `activeTab` (16 paths); TabBar (aria-current on `/places/…` → Salles and `/profile/health` → Profil, Accueil on `/` only, pill index and hidden pill, real links in keyboard order, decorative icons); SideNav; ConnectionPill (6 states, offline never « En ligne », live updates, `role=status`); shell:
  - home header and its links;
  - no « en attente » and no counters;
  - offline pill;
  - inner pages without the home header;
  - no Administration tab for an admin;
  - `/admin` still served;
  - one nav (TabBar on phone, SideNav at ≥ 900 px);
  - onboarding without nav or pill;
  - `/progression` and `/places`;
  - `/profile/places` → `/places`, `/profile/places/p-2` → `/places/p-2` visited exactly once each;
  - update banner between header and main;
  - tab / forward / back transitions through real navigation.

  Also: `screenTransition` (9 cases) and BootSplash (renders nothing under reduced motion; decorative overlay removed at `animationend`; once per session).
- `guard.test.tsx`: 10 rows for the redirect (trailing slash, case, no session, password to change, not onboarded, `/profile/placesx` not affected). The Administration link test is replaced by « no tab, `/admin/members` still served », plus an app-level redirect test.
- `counters.test.tsx`: the pill tests moved to shell.test; CONNECTION_LABELS is checked in full; the counters are tested as components (their data source stays for Réglages).
- `rejections-settings.test.tsx`: the refusal count is read from the engine (the counter's source) instead of the header.
- `UpdateBanner.test.tsx`: « bandeau sous l'en-tête de l'accueil, avant le contenu ».
- `places-page.test.tsx` and `profile-page.test.tsx`: `/places` URLs.
- `kill-switch.test.ts`: two new cases (page still controlled → reload once, never twice in the same tab; same with storage refused).

## TDD evidence

RED for the shell, first run (modules not created yet):
```
pnpm --filter @rune/web test shell
Error: Failed to resolve import "../../src/ui/BootSplash" ...
 Test Files  1 failed (1)   Tests  no tests
```
Second RED run, behavioural, against empty stubs (`TabBar` returning null, `TAB_ITEMS=[]`, and so on):
```
pnpm --filter @rune/web test shell
 ❯ |web| test/app/shell.test.tsx (59 tests | 51 failed)
TestingLibraryElementError: Unable to find an accessible element with the role "navigation" and name "Navigation principale"
TestingLibraryElementError: Unable to find an element by: [data-testid="connection-status"]
TestingLibraryElementError: Unable to find role="heading" and name "Progression"
Error: until: condition jamais remplie            (redirections /profile/places)
AssertionError: expected '<div></div>' to be ''    (BootSplash sous mouvement réduit)
AssertionError: expected null to be '/places'      (activeTab)
      Tests  51 failed | 8 passed (59)
```
GREEN:
```
pnpm --filter @rune/web test shell      →  Tests  60 passed (60)
pnpm --filter @rune/web test            →  Test Files 74 passed (74), Tests 1206 passed
```
RED for the kill switch:
```
pnpm --filter @rune/web test kill-switch
 × le SW a fait le ménage sans joindre cette page, encore contrôlée → rechargée une fois, sans boucle
 × page contrôlée, stockage de session refusé → rechargée une fois quand même
AssertionError: expected false to be true
      Tests  2 failed | 12 passed (14)
```
GREEN: `pnpm --filter @rune/web test kill-switch register` → 61 passed. E2E `kill-switch --repeat-each=6` → 12 passed.

## Kill-switch investigation (why `src/sw/kill-switch.ts` changed)

After the shell change, the `kill-switch` E2E failed on Chromium most of the time. It always failed at the same step, « interrupteur actif », with 1 navigation counted where 2 are expected.

| Build | Chromium failures |
|---|---|
| Baseline 2e30e34 | 1/4, then 0/8 |
| With the change | 7/8, 3/3, 3/4 |
| Without BootSplash | 2/6 |

I instrumented it temporarily (logs in the SW and the page, never committed). Every failing run shows the same thing:

```
DBG sw windows 0          ← clients.matchAll({type:'window'}) is empty: the old document is gone, the reloaded one is not ready yet
DBG sw navigate []
DBG page kill false false true   ← nothing left to remove (the SW cleaned first), but the page is still controlled
```

So neither side reloads, and the page stays on the killed build: the worst case according to R-PWA-6. The race existed before (the baseline fails it too). The splash's first render only changes the timing.

The fix is page side and minimal. Loop safety:
- the reloaded document is no longer controlled (an uninstalling registration does not match new navigations);
- on top of that, a guard allows one such reload per tab.

The existing test « rien à nettoyer, pas de rechargement » still holds: it covers an uncontrolled page.

## Files changed

New:
- `apps/web/src/ui/TabBar.tsx`
- `apps/web/src/ui/SideNav.tsx`
- `apps/web/src/ui/ConnectionPill.tsx`
- `apps/web/src/ui/BootSplash.tsx`
- `apps/web/src/ui/screen-transition.ts`
- `apps/web/src/ui/shell.module.css`
- `apps/web/src/features/progression/ProgressionPage.tsx`
- `apps/web/test/app/shell.test.tsx`

Modified:
- Shell and routes: `apps/web/src/ui/AppShell.tsx`, `apps/web/src/ui/Page.tsx`, `apps/web/src/ui/ui.module.css` (removed the unused `.nav`, `.status` and `.back`), `apps/web/src/App.tsx`, `apps/web/src/main.tsx` (mounts BootSplash).
- Connection status: `apps/web/src/features/status/ConnectionStatus.tsx`, `apps/web/src/features/status/status.module.css` (removed the unused `.connection`).
- Update banner: `apps/web/src/sw/UpdateBanner.tsx`, `apps/web/src/sw/UpdateBanner.module.css`.
- Kill switch: `apps/web/src/sw/kill-switch.ts`.
- Places and profile links: `apps/web/src/features/places/{PlacesPage,PlaceDetail,GymPage}.tsx`, `apps/web/src/features/profile/ProfilePage.tsx`.
- Tests: `apps/web/test/app/guard.test.tsx`, `apps/web/test/status/{counters,rejections-settings}.test.tsx`, `apps/web/test/sw/{UpdateBanner,kill-switch}.test.ts(x)`, `apps/web/test/places/places-page.test.tsx`, `apps/web/test/profile/profile-page.test.tsx`.
- E2E: `apps/web/e2e/{offline,epoch,protocol,sheet}.spec.ts`.

## Self-review

- Every brief item is covered: tests for the 6 Step 1 assertions, the mockup layout, the 3 transitions, TAB_ITEMS verbatim, and the BootSplash test under reduced motion. Rulings P5 and P6 and every controller ruling are applied.
- Visual check (temporary Playwright screenshots at 390 × 844 in light and dark, plus PC at 1280 × 800, not committed):
  - home matches MixSombre and MixClair (header, pill, initial, tab bar);
  - inner pages show Retour and title with no brand header, and the right tab is active;
  - the PC side nav works;
  - the splash draws its frame.
- CSP: no inline `<style>` and no `dangerouslySetInnerHTML`; only React `style` props and Web Animations are used.
- Colours: tokens only, so they follow all 5 themes. Touch targets: tabs ≥ 44 px, initial 44 × 44.
- `git show --stat HEAD` and `HEAD~1` match the list above, and `git status` is clean.

## Concerns

1. **`src/sw/kill-switch.ts` is outside the brief's file list**, and it touches R-PWA-6. The fix is required for the green E2E, with the evidence above. It is isolated in `10404f9` so it can be reviewed or reverted on its own. Global constraint: phone checks before tagging any version that touches `src/sw`.
2. **Home-only header** (spec §5, GUIDE, mockups). The brief does not say « on every page », but the old header put the connection state on every connected screen. The E2E specs now read the pill on Accueil.
3. **Counters not shown anywhere until Task 10** (ruling: they move to Réglages; their data source and components are kept). The E2E assertions on `pending-counter` and `rejected-counter` were removed; T10 can add them back on Réglages.
4. **No Administration entry point until T10** (ruling).
5. **The places page heading is still « Lieux »** while its tab says « Salles » (mockup D01: « Salles »). I left it to the places-screen task, since many tests target « Lieux ». `/gyms/:id` stays outside `/places` and maps to the Salles tab.
6. The `--color-info-bg` bridge in `tokens.css` is no longer read by any module (the old banner used it). Its line and its 2 test entries can go; `tokens.css` is not in my list.

## Fix report, round 1 (integration of fix/T5-r1-g1, g2, g3, 2026-10-14)

Base ec386f9 on `socle`. Each branch was cherry-picked in order (`git cherry-pick ec386f9..<branch>`), so history stays linear with no merge commit. No integration commit was needed: lint, typecheck, the whole unit suite and the whole E2E suite were green right after the last cherry-pick.

| Group | Branch head | Commit(s) on socle | Findings |
|---|---|---|---|
| 1 | 64eab51 | 23af981 | T5-F24, F23, F5, F7, F6, F4 |
| 2 | 801cfc7 | 45444de | T5-F22, F14, F3, F2 |
| 3 | 7a5bc8f, 6ad9a87, f07e2dd | 837fadd (F10), d41cef1 (F1), 39beba8 (F16, F11, F19) | T5-F16, F11, F19, F10, F1 |

### Group 1 (23af981): back through the stack, scroll reset, boot splash and screen entrances checked
Files: `apps/web/src/ui/screen-transition.ts`, `apps/web/src/ui/BootSplash.tsx`, `apps/web/test/app/shell.test.tsx`, new `apps/web/e2e/boot-splash.spec.ts`.
- **T5-F7:** new `visitedIndex(stack, to)`. `screenTransition` returns 'back' when the target is the URL parent, the root of the current tab, or already in the stack. `nextStack` cuts the stack back to that screen, or replaces the screen being left. Forward still pushes and a tab change still resets. Tests: 5 new table cases, including `/gyms/g-1 → /places` with stack [/places, /places/p-1, /gyms/g-1] and `/settings → /profile` with [/settings]. Plus an integration test on the real app (`renderAppWithHistory`, browser back via `go()`): /places → p-1 → « Voir la salle » → back → g-1 → GymPage Retour → place.
- **T5-F4:** a layout effect in `useScreenEntrance` runs before the animation. 'tab' and 'forward' scroll to the top, 'back' restores the position saved for that path (or the top), 'none' does not scroll. A passive scroll listener keeps the position of the screen on display. The arrival position is saved at once, so a later back never restores a stale value. Test: tab → 0, forward → 0, back → 420, then Accueil, Profil, Santé, back → 0.
- **T5-F5:** `BOOT_SPLASH_MAX_MS = 2000` is exported, and the overlay gets `data-testid="boot-splash"`. Tests:
  - fake timers: still there at MAX−1 ms, gone at MAX;
  - an animationend from the frame path keeps it, one from the overlay removes it;
  - CSS: `.splash` has `pointer-events: none` and a `splash-out … forwards` animation that ends before MAX; the draw ends within 1.2 s and before the fade.
  - E2E `boot-splash.spec.ts`: while the overlay is mounted, `elementFromPoint` at the login button's centre returns the button, and the overlay is gone within 2.5 s.
- **T5-F6:** `spyEntrances()` checks the exact keyframes and options on `<main>`: tab `{opacity:[0,1]}` 300 ms, forward `translateX(48px)` 380 ms, back `translateX(-48px)`. Reduced motion gives a plain 200 ms fade. A CSS test checks `.tabPill { transition: none }` under reduced motion.
- **T5-F23:** the 6-state table also checks the dot's `data-tone`: online → online; offline and unknown → muted; the other three → warning. A CSS test covers the `.pillDot` tones.
- **T5-F24:** for an admin, on phone (tab bar) and on desktop (side nav), the nav link hrefs equal `TAB_ITEMS.map(t => t.href)` exactly, and no link to /admin exists anywhere in the shell.
- Group tests: shell.test 73 passed (60 before). `pnpm test`: 171 files, 2345 passed, 2 skipped. Lint and typecheck clean. Whole E2E: 20 passed; boot-splash with `--repeat-each=3`: 6/6. RED before the source change: 9 failed / 64 passed. The mutation REDs for the test-only findings are listed in the group's notes.

### Group 2 (45444de): tab bar never over the focus or the end of the page, wrapping header and labels, active tints at 4.5:1
Files: `apps/web/src/ui/shell.module.css`, `apps/web/src/ui/TabBar.tsx`, `apps/web/test/ui/base-styles.test.ts`, `apps/web/test/ui/contrast.test.ts`, `apps/web/test/app/shell.test.tsx`, new `apps/web/e2e/shell.spec.ts`.
- **T5-F3:** the active tab pill, the active side entry and the avatar circle use `color-mix(in srgb, var(--accent) 10%, var(--surface))`. Contrast: 4.60:1 in Clair (was 4.48 and 4.35), Sombre 9.11, Carnet 5.59, Nuit 9.36. `contrast.test.ts` gets SHELL_PAIRS, checked in all 6 renderings.
- **T5-F2:** `html:has(.tabBar) { scroll-padding-bottom }` uses the same value as the `.shell` bottom padding. WebKit ignores it for programmatic `focus()`, so `TabBar.tsx` gets `useFocusAboveBar`. On focusin, if `elementFromPoint` at the control's centre lands in the bar, it calls `scrollIntoView({block:'nearest'})`. A bottom sheet on top takes the point, and the bar's own links are skipped. 3 unit tests in shell.test.
- **T5-F14:**
  - `.header` wraps (row-gap 6px), `.headerEnd` gets `margin-inline-start: auto`, and `.pill` loses `nowrap`;
  - `.tab` is centred, with `overflow-wrap: anywhere` and `hyphens: auto`;
  - `.tabBar` has `min-height: 68px`;
  - `.shell` padding-bottom is `calc(73px + 2.7rem + env(safe-area-inset-bottom, 0px))`, enough for 3 label lines at 0.9rem.
- **T5-F22:**
  - base-styles gets a shell block: 44 px targets; the bottom reservation against the computed bar footprint for 1 to 3 label lines at 100 % and 200 % text; `[data-wide]` padding 0; the scroll-padding rule; the wrap rules;
  - « Retour de 44 × 44 » now checks the `backButton` class and its rule;
  - E2E `shell.spec.ts`: the last control at the bottom of /profile, Tab and `focus()` into a field under the bar, and 320 px at 200 % text.
- Group tests: lint and typecheck clean. `pnpm test`: 171 files, 2347 passed, 2 skipped. Whole E2E: 20 passed; shell.spec with `--repeat-each=4`: 8/8. RED: 10 unit failures and 1 focus-hook failure; the E2E failed on both engines (field bottom 815 vs bar top 755 on Chromium, 640 vs 580 on WebKit).

### Group 3 (837fadd, d41cef1, 39beba8): kill-switch guard lifted, one source for the pill, brand once on PC, splash decided at mount, 28 px screen title
Files:
- source: `apps/web/src/sw/{kill-switch,register}.ts`, `apps/web/src/api/client.ts`, `apps/web/src/sync/engine.ts`, `apps/web/src/app-services.tsx`, `apps/web/src/main.tsx`, `apps/web/src/ui/{AppShell,BootSplash,PageHeader}.tsx`, `shell.module.css`, `ui.module.css`;
- tests: `kill-switch`, `register`, `api-client`, `engine`, `triggers`, `components`, `shell`, new `connection-source.test.tsx`;
- test support: `test/support/{fake-api.ts,render.tsx}`;
- E2E: `e2e/offline.spec.ts`, `e2e/support/flows.ts`.

Changes:
- **T5-F10 (837fadd):** `clearControlledReload()` lifts the reload guard in two cases: when `swKill` is false, and when nothing is left to remove and the page is no longer controlled. `register.ts` now passes every health answer to `applyKillSwitchIfNeeded`. The old « stockage de session refusé » test refused nothing, because happy-dom caches the storage methods. It now stubs `sessionStorage` and loads a fresh module. New tests include kill → healthy → kill, which gives 2 reloads.
- **T5-F1 (d41cef1):** `ApiHooks.onOffline()` is called before `NetworkRequiredError`, and `onReachable()` on any HTTP response. The engine gets `reportOffline()` and `reportReachable()`. `apiHooksFor(sync, db, navigate)` is used by both `main.tsx` and `test/support/render.tsx`. Tests: new `connection-source.test.tsx` with the real engine, 8 engine tests and 3 api-client tests. offline.spec gets a first step without `triggerForeground`.
- **T5-F16 (39beba8):** AppShell passes `brand={!wide}` to HomeHeader, and `.headerEnd` gets `margin-inline-start: auto`. Test at ≥ 900 px: exactly one « Rune » link, and it is in the side nav.
- **T5-F11 (39beba8):** BootSplash decides once, at mount (`useState(() => !reduced && !alreadyShown())`), and marks the session on every mount. Reduced motion turned on during the draw removes the splash for good. 3 tests use the new `liveMedia()` helper.
- **T5-F19 (39beba8):** PageHeader without Retour adds `screenTitle` (`.pageTitle.screenTitle { margin-top: 6px; font-size: 1.75rem }`). The test is in components.test.
- Group tests: lint and typecheck clean. `pnpm test`: 172 files, 2352 passed, 2 skipped. Whole E2E: 18/18; kill-switch with `--repeat-each=4`: 8/8. RED: 13 failed for F1, 4 for F10, 3 for F11, and 1 each for F16 and F19.

### Conflicts resolved
1. **`apps/web/test/app/shell.test.tsx`, imports (group 2 cherry-pick).**
   - Group 1 had added `@rune/contracts`, `createFakeApi`, `createTestLocalDb`, `seedPrimaryGym` and `createTestServices`, for `renderAppWithHistory` and `GYM_DETAIL`. Group 2 added `ui from '../../src/ui/ui.module.css'`.
   - Resolution: the union of both import lists, in Biome order. Both groups had added `readFileSync`, `resolve`, `declarationsOf` and `parseCssBlocks`; each is imported once.
2. **`apps/web/src/ui/BootSplash.tsx`, the timer effect (group 3, 39beba8).**
   - Group 1 renamed `MAX_MS` to the exported `BOOT_SPLASH_MAX_MS` inside the old `playing` effect.
   - Group 3 rewrote that effect: `show` is decided at mount, `markShown` moves to its own mount effect, and reduced motion during the draw calls `setShow(false)`.
   - Resolution: group 3's effect, with `setTimeout(() => setShow(false), BOOT_SPLASH_MAX_MS)`. Group 1's export and `data-testid` were outside the conflict and stay.
   - Both fixes hold. Group 1's fake-timer test (present at MAX−1, gone at MAX), its CSS timing test and the boot-splash E2E pass. Group 3's three reduced-motion tests pass too.
3. **`apps/web/test/app/shell.test.tsx`, imports and helpers (group 3, 39beba8).**
   - Imports: kept the combined list from conflict 1. Group 3 only added `node:fs`, `node:path` and css-blocks, which were already there.
   - Helpers: group 1 defines `shellCss` as a function (`shellCss()`, used 3 times), plus `EASE` and `animationTimes`. Group 3 defined `shellCss` as a constant.
   - Resolution: kept group 1's function and helpers. Group 3's single use, in the test « ≥ 900 px, accueil : la marque une seule fois », now reads `declarationsOf(shellCss(), '.headerEnd')`. Group 3's `liveMedia()` helper was outside the conflict and stays.
- **Auto-merged, checked by hand:**
  - `shell.module.css`: groups 2 (F14) and 3 (F16) both add `margin-inline-start: auto` to `.headerEnd`. Git merged it once, with no duplicate declaration, and kept group 3's comment.
  - `afterEach`: group 1 added `vi.restoreAllMocks()` and `window.scrollTo(0, 0)` to the file-level hook. Group 2's focus describe keeps its own `afterEach(() => vi.restoreAllMocks())`. It is redundant but harmless, so I left it.
- **Semantic checks (no textual conflict):**
  - Group 1's `renderAppWithHistory` builds its services with `createTestServices`, which now wires `apiHooksFor` (group 3, F1). So the F7 integration test runs with the real hooks.
  - Group 2's focus hook only scrolls on a focusin over the bar, so it does not fight group 1's scroll reset on navigation. The E2E shell.spec and the F4 unit test are both green.

### Final checks (HEAD 39beba8, no integration commit needed)
- `pnpm lint`: `Checked 503 files in 361ms. No fixes applied.`
- `pnpm typecheck`: exit 0 (contracts, domain, server, web).
- `pnpm test`: `Test Files  172 passed (172)`, `Tests  2380 passed | 2 skipped (2382)`, 47.7 s, no stderr. 2380 = 2332 at base + 13 (group 1) + 15 (group 2) + 20 (group 3).
- Covering files (`npx vitest run --project web` on shell, base-styles, contrast, components, connection-source, test/sw, engine and api-client): 15 files, 411 passed. shell.test.tsx alone: 80 passed (60 at base + 13 + 3 + 4).
- `pnpm --filter @rune/web test:e2e` (Chromium Pixel 7 and WebKit iPhone 14): **22 passed (3.6 m)**, including boot-splash.spec, shell.spec, offline.spec and kill-switch.spec on both engines.

### Not addressed
None. All 15 findings of the three groups survive integration: T5-F1 to F7, F10, F11, F14, F16, F19 and F22 to F24.

### Carried over from the groups (outside scope, not changed)
- **ReadyStep race:** `navigate('/')` runs only after `completeOnboarding()` resolves, and that call awaits a pull. By then the guard has already sent the user home, so a tab tapped during the pull is overridden (seen on WebKit). Groups 2 and 3 both hit it; `e2e/support/flows.ts` now waits for `ONBOARDING_COMPLETED_EVENT`. Fix idea: skip `navigate('/')` when the location has already changed. It is worth its own finding.
- **F19 side effect:** every page without Retour gets the 28 px title. That includes login (mockup A01 uses 22 px), and Aide, Crédits and the admin pages until their own tasks add Retour.
- When one tab label wraps, that tab's icon sits slightly higher than its neighbours. The avatar circle stays 36 px at 200 % text.
- Flakes group 3 saw under load: server `test/infra/release.test.ts` (5 s timeout) and the profile-page « Annuler » focus test. Both are green in this run.

### Cleanup
- `git worktree remove --force` on `appsport-fix-T5-r1-g{1,2,3}`. Each left an empty folder skeleton behind: no files, only directories and 232 node_modules links, all pointing inside that same folder. I checked that, then deleted the three folders.
- Branches `fix/T5-r1-g{1,2,3}` deleted (were 64eab51, 801cfc7, f07e2dd).
