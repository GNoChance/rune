# Task 8 report — Onboarding rhabillé et « Éveil terminé » (issue #56)

Branch `socle`, main checkout `C:\Users\eliott.colin\appsport`. Resumed from the uncommitted work of an earlier
implementer (snapshot `refs/wip/T8-2`; the working tree was byte-identical to it when I started).

## What I implemented (or kept from the WIP after review)

Review of the WIP against the brief, the redesign spec and the controller rulings: kept almost everything; fixed
the one duplicated, half-finished edit and finished what was missing.

- **Duplicated edit found and fixed**: `test/onboarding/flow.test.tsx` held two near-identical new tests for the
  Rune mark in the progress row (one looked up `[data-progress-row]`, the other the element that names the title),
  both RED because the mark was never implemented. Kept one coherent test, implemented the mark.
- **« Continuer » everywhere in the onboarding** (ruling): `StepActions.saveLabel` and `CONTINUE_LABEL` (also the
  label of the goal screen that opens the sport screen in Profil); unit tests, Profil tests and the E2E helper
  `e2e/support/flows.ts` updated. The only « Suivant » left in the app is the invitation code step (accès, not
  onboarding).
- **Header of B01–B08** (new): the Rune mark (22 px, glowing version in dark, frame at the accent in light) opens
  the « Étape n sur 9 » row; it is decorative (`aria-hidden`), the title keeps its name « Étape n sur 9 <titre> ».
- **Action bar of the mockups** (new): « Retour » 118 px + the primary button taking the rest; in the onboarding the
  bar is sticky at the bottom of the screen with the background fading in above it, the screen error inside it (so
  an error never lands off-screen), and `scroll-padding-bottom` on the page so a focused field never scrolls under
  the bar (WCAG 2.4.11). Without this « Commencer », the climax of « Éveil terminé », was below the fold at
  390 × 844.
- **Steps per mockup**: B01 goal, B03 place type, B05 level in choice cards with icons (`StepIcons.tsx`, traced from
  the mockups; B03 cards carry the mockup descriptions); B02 sport and B06 availability in chips (`Chips` gained
  `disabled`/`describedBy` per option, needed for « Non » locked by the sport goal — the toolkit already had the
  disabled chip style); B06 « Ton rythme » card shown only once both answers are given (never an invented value);
  B04 lead « Cherche ta salle ou crée-la. »; info notes with the small i; screen entrance from the right / left on
  back (fade under reduced motion), cards in cascade.
- **Health (B07)**: legal texts verbatim, no Système voice. Cards: « Accord santé » (shield, consent text and box
  unchanged), « Limitations » announced « Après ton accord » without any field, cautious mode as a switch-looking
  checkbox that keeps `role="switch"`, then the health warning. `HealthWarning` changed in style only (small i icon,
  13 px, text unchanged and still in « vous »).
- **« C'est prêt » = « Éveil terminé » celebration (B08 + prototype)**: Système window « Éveil terminé. », RankBadge
  « Rang E » that engraves with a few sparks, card « Quêtes d'éveil n/3 » with its bar and three read-only
  checkboxes (« Profil complété », « Lieu principal choisi », « Prêt hors ligne ») checked only from real states
  (`AwakeningQuests.tsx`: profile = coach, goal, level and availability given; primary place exists; offline-ready =
  the existing R-SYN-33 readiness), the chosen coach's bubble with its `ready` line (« Message d'accueil »), then
  « Commencer » (with glow); recap card below. Not offline-ready yet → 2/3, the box unchecked, the indicator with
  « Réessayer », « Commencer » disabled. Everything is in the DOM from the first render; the animation (CSS only,
  600 to 1 200 ms, single curve, fill-mode backwards) only replays the arrival; under reduced motion short fades, no
  delay, no sparks.
- **E2E (ruling P9)**: new `e2e/coach-onboarding.spec.ts`: choose Le Scribe → presentation (« Message d'accueil »,
  its intro) → « C'est parti » → the 8 other screens through « Continuer » (each awaited by `data-step` and its
  titled heading « Étape n sur 9 … ») → « Éveil terminé » (rank, 3 quests checked, 3/3, the Scribe's ready line) →
  « Commencer » → home (tab « Accueil » `aria-current="page"`, heading with the username). Waits on roles and states
  only, no fixed sleep.

Commit: `fce32cc` feat(web): onboarding Rune en 9 étapes et célébration « Éveil terminé » (Closes #56).
Review package: `.superpowers/sdd/2026-10-13-refonte-rune/review-e18a259..fce32cc.diff` (2 commits: the README
commit d90608c sits between e18a259 and mine).

Status: DONE_WITH_CONCERNS (files outside the list, and two things only other tasks can finish; see Concerns).

## Tests and results

New or changed tests:
- `test/onboarding/celebration.test.tsx` (new, 9 tests): heading « Éveil terminé. », quests 3/3 checked and
  read-only, « Rang E », the chosen coach's bubble with its `ready` line for each of the 3 coaches, not offline-ready
  → 2/3 with the box unchecked and « Commencer » disabled, real states (no primary place, no level → those boxes
  unchecked, 1/3), reduced motion → « Commencer », window, rank and quests present on the first render; and two CSS
  checks on `onboarding.module.css`: every celebration animation 600–1 200 ms on `var(--ease)` and finished by
  1 200 ms (delays included); under reduced motion, short fades without delay, no sparks.
- `test/onboarding/flow.test.tsx`: Rune mark opens the « Étape n sur 9 » row (decorative, title name unchanged);
  screen entrance from the right forward, from the left on back, none on resume; sticky bar holds the error and both
  buttons, `.flow .bar` sticky at bottom 0, and a scroll padding for focus; « Suivant » → « Continuer ».
- `test/onboarding/steps.test.tsx`: B03 card descriptions and the « Mes lieux » note, B04 lead, B06 « Ton rythme »
  only with both answers; « Continuer ».
- `test/onboarding/health-step.test.tsx`: « Accord santé » card with the consent text verbatim, « Limitations »
  « Après ton accord » without a field, warning verbatim, no « SYSTÈME »; « Continuer ».
- `test/onboarding/ready-step.test.tsx`: readiness read through the « Prêt hors ligne » quest; indicator with
  « Réessayer » when not ready.
- `test/profile/profile-page.test.tsx`: « Continuer » for goal → sport in Profil.
- `e2e/coach-onboarding.spec.ts` (new) and `e2e/support/flows.ts` (« Continuer », waits on the « Prêt hors ligne »
  checkbox).

### TDD evidence

RED for the WIP tests (separate run, sources at HEAD). Method from the rules, no git stash: the 15 changed source
files and the 2 new source files saved to my scratchpad (tar), HEAD versions put back with
`git show HEAD:<path> > <path>`, the 2 new files moved aside, tests run, files restored from the tar, then
checked byte-identical to `refs/wip/T8-2` (`git diff refs/wip/T8-2 -- <files>` empty, `cmp` on the new files).

```
npx vitest run --project web apps/web/test/onboarding apps/web/test/profile/profile-page.test.tsx
 ❯ |web| test/onboarding/ready-step.test.tsx (5 tests | 3 failed)
 ❯ |web| test/onboarding/flow.test.tsx (15 tests | 8 failed)
 ❯ |web| test/onboarding/steps.test.tsx (24 tests | 18 failed)
 ❯ |web| test/onboarding/health-step.test.tsx (19 tests | 11 failed)
 ❯ |web| test/profile/profile-page.test.tsx (33 tests | 2 failed)
 ❯ |web| test/onboarding/celebration.test.tsx (9 tests | 9 failed)
     × fenêtre du Système « Éveil terminé. », quêtes 3/3 cochées en lecture seule, rang E
     × bulle du coach choisi (ombre) : son mot de la fin, pseudo remplacé
     × prêt hors ligne non atteint (dernier pull il y a 25 h) : 2/3, sa case non cochée, « Commencer » désactivé
     × mouvement réduit : « Commencer », la fenêtre, le rang et les quêtes sont là dès le premier rendu
     × 600 à 1 200 ms sur la courbe unique, finie à 1 200 ms
 Test Files  6 failed (6)
      Tests  51 failed | 54 passed (105)
Failure kinds: 35 × Unable to find role "button" and name "Continuer"; Unable to find role="heading" and name
"Éveil terminé."; Unable to find role "checkbox" and name "Prêt hors ligne"; Unable to find role "region" and name
"Accord santé"; Unable to find text « Ton rythme »; AssertionError: expected 'div' to be 'svg' (Rune mark);
AssertionError: .celebration : animation: expected '' not to be ''.
```

RED for the Rune mark (my consolidated test, WIP sources in place, mark not yet written): the two duplicated
tests failed with `AssertionError: expected 'div' to be 'svg'` and `expected null not to be null`; after keeping
one, same `expected 'div' to be 'svg'` in the run above.

RED for the sticky bar (test written first):
```
npx vitest run --project web apps/web/test/onboarding/flow.test.tsx -t "collée en bas"
     × barre « Retour » / « Continuer » collée en bas (maquettes B01–B08) : l’erreur de l’écran y reste visible
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 15 skipped (16)
```
RED for the focus scroll padding (assertion added to that test first):
```
AssertionError: expected undefined to be truthy
      Tests  1 failed | 15 skipped (16)
```

GREEN:
```
npx vitest run --project web apps/web/test/onboarding apps/web/test/profile apps/web/test/coach apps/web/test/privacy
 Test Files  11 passed (11)
      Tests  188 passed (188)
```

### Full checks (final tree, before the commit)

- `pnpm lint`: `Checked 534 files … No fixes applied.`
- `pnpm typecheck`: exit 0 (contracts, domain, server, web).
- `pnpm test`: `Test Files 185 passed (185)`, `Tests 2533 passed | 2 skipped (2535)`, output pristine (no warning,
  no stderr). A first full run had one unrelated failure: `apps/server/test/infra/release.test.ts` timed out at 5 s
  and a worker crashed at startup while the machine was loaded by the other lanes; that file alone passed (10/10)
  and the next two full runs were green.
- `pnpm --filter @rune/web test:e2e`, whole suite, Chromium and WebKit: **`24 passed (6.6m)`**, exit 0
  (coach-onboarding passed on both: 9.2 s Chromium, 18.1 s WebKit). The previous whole-suite run (before the
  scroll-padding change) was 23 passed, 1 failed: WebKit `kill-switch.spec.ts:27`, step « interrupteur actif »,
  3 document loads `['/', '/', '/']` instead of 2. That is the service-worker kill-switch reload race under load
  already documented in the T7 report; it does not touch the onboarding, and it passed in the rerun.

### Visual check

Playwright screenshots 390 × 844, light and dark, of every onboarding screen (coach, presentation, goal, sport,
place type, gym, home, level, availability, health, ready), taken with a temporary spec (deleted, never committed;
images in my scratchpad only). Compared with B01–B08 Clair/Sombre and the prototype: layout, cards, chips,
« Ton rythme », health cards, celebration and recap match; the sticky bar now shows « Commencer » on the first
screen of « Éveil terminé », as in the mockups.

## Files changed

- Created: `apps/web/src/features/onboarding/AwakeningQuests.tsx`, `StepIcons.tsx`,
  `apps/web/test/onboarding/celebration.test.tsx`, `apps/web/e2e/coach-onboarding.spec.ts`.
- Modified (in the list): `apps/web/src/features/onboarding/{AvailabilityStep,ExperienceStep,GoalStep,HealthStep,
  LimitationFields,OnboardingFlow,PlaceKindStep,PlaceStep,ReadyStep,SportStep,StepActions}.tsx`,
  `onboarding.module.css`, `apps/web/src/ui/HealthWarning.tsx` (style only), `apps/web/e2e/support/flows.ts`,
  `apps/web/test/onboarding/{flow,health-step,ready-step,steps}.test.tsx`, `apps/web/test/profile/profile-page.test.tsx`
  (text changed « Suivant » → « Continuer »).
- Modified (outside the list, see Concerns): `apps/web/src/ui/Chips.tsx`, `apps/web/src/ui/ui.module.css`.

## Self-review

- Completeness against the brief: Step 1 assertions all present in `celebration.test.tsx` (heading, card 3/3 with
  the three quests, real states and 2/3 when not offline-ready, RankBadge « Rang E », coach bubble with its `ready`
  line, reduced motion « Commencer » on first render). Step 3: each step after B0n, health texts verbatim without
  the Système voice, « Suivant » → « Continuer » in code, tests and E2E. Rulings: quests from real states only;
  celebration 600–1 200 ms on the single curve, everything present on first render under reduced motion; P9 E2E
  added and the whole E2E suite green on both browsers.
- No fake data: quests unchecked until the real state is reached; « Ton rythme » only with both answers; the
  window says « Quêtes d'éveil remplies… » only when all three are done (otherwise « Quêtes d'éveil en cours. Ta
  progression commencera au rang E. », a necessary variant since the mockup text would be false).
- Accessibility: roles and names kept (radios, switch, checkboxes, headings); quests are read-only checkboxes with
  `aria-readonly`, count read « n sur 3 »; mark and sparks decorative; targets ≥ 44 px; error stays visible in the
  sticky bar; focus never scrolls under the bar; reduced motion respected (CSS tests).
- CSP: no inline `<style>`, no `dangerouslySetInnerHTML`; only React `style` props (spark angles, bar width), as
  SegmentedProgress already does.
- Straight apostrophes in every app text; no « appsport » in tracked files; no code, link or secret in this report
  or the commit.
- `git show --stat HEAD` lists all 25 files above; `git status` is clean.

## Concerns

1. **Files outside the list.** `ui/Chips.tsx`: options accept `disabled` and `describedBy` (same contract as
   `ChoiceList`), needed because B02 shows chips and « Non » must stay disabled and explained with the sport goal;
   the toolkit already styled disabled chips. `ui/ui.module.css`: the `.healthWarning` rule only (its look: small i,
   13 px), which is the « style seulement » change of HealthWarning. Neither touches the hunks T11 changed in
   `ui.module.css` on socle-ecrans (switch rules near line 716), so merge 2 should merge cleanly.
2. **Gym picker (B04)**: search with icon, gym cards and « Ma salle n'est pas dans la liste » come from
   `features/places/GymPicker.tsx`, owned by T11 (already restyled on socle-ecrans, merged at merge 2). I did not
   touch it to avoid a conflict; until merge 2 the onboarding gym screen shows the old picker under the new lead and
   header. Its own « Valider » stays (the mockup's « Continuer » there would need GymPicker changes).
3. **PublicShell header**: the onboarding still renders inside `PublicShell` (ui/AppShell.tsx), whose old header
   shows the word « Rune » above the new progress row with the mark; the mockups have no header there. Not in my
   files (and an existing test expects that unlinked « Rune »); for the controller or the integrator.
4. **P9 « with the chosen coach's bubble » on the home**: the home has no coach bubble yet (T9). My E2E checks that
   « Commencer » lands on the home (tab « Accueil » current, heading with the username, written to survive T9's
   « Bonjour, … » / « Bonsoir, … »). T9 should add the bubble assertion to `coach-onboarding.spec.ts`.
5. **WebKit kill-switch flake** under heavy load (see above), same as noted in T7; not in T8 scope.

---

# Fix report, round 1 (integration of groups 1, 2 and 4 on `socle`)

Integrator, main checkout `C:\Users\eliott.colin\appsport`, branch `socle`. Start: `8fbfe04` (`fce32cc` plus the
README status commit). Each branch was cherry-picked with `git cherry-pick fce32cc..<branch>` in the order
g1, g2, g4. History stays linear with no merge commits. One integration commit follows.

| Commit on socle | From | Content |
|---|---|---|
| `6c4249d` | g1 `ee7bbd7` | test: T8-F14, T8-F11, T8-F5, T8-F8 |
| `c547a71` | g1 `4b9f5ac` | fix: T8-F1 (B04 gym screen) |
| `fe1b301` | g1 `0b836bb` | test: T8-F16 |
| `1c08422` | g2 `e3db6f5` | test: T8-F13, T8-F12 |
| `c12091d` | g2 `1c26fbe` | fix: T8-F7, T8-F3 (conflict resolved, see below) |
| `c5ae1dd` | g4 `fa1c58f` | fix: T8-F2, T8-F6, T8-F17, T8-F18, T8-F19, T8-F23 (conflicts resolved, see below) |
| `fb5016a` | integration | test: g1's two bar tests adjusted to g4's bar (see below) |

Every commit ends with `Refs #56` and the Co-Authored-By trailer.

## Group 1 (T8-F14, T8-F11, T8-F5, T8-F8, T8-F1, T8-F16)

- **T8-F14** (`celebration.test.tsx`): the first test finds the System window as `group` « Éveil terminé. ».
  Inside that group it checks the « SYSTÈME » label, the heading, the img « Rang E », the three quests in mockup
  order, « Quêtes d'éveil », « 3/3 » and the « remplies » sentence. RED by mutation (a bare `<h3>` with no
  SystemPanel): the HEAD test passed and the new test failed.
- **T8-F11**: the test asserts what the first render shows (`0/3`, the « en cours » text, « Commencer »
  disabled). A comment explains that the matchMedia stub only sets the scene; the reduced-motion CSS checks
  stay in this file. RED came from harness drift: with a 500 ms wait inserted after render, the new test fails
  and the HEAD test passes.
- **T8-F5**: new table « awakeningQuests : vrais états seulement ». « Profil complété » stays false while the
  profile is undefined or null, and while any one required field is null. The other two quests follow their
  own input. A new helper `openReadyAlone` waits for the profile witness, readiness and `settle()`. Also added:
  a counter-case (2/3), and the 409 test now waits for « Profil complété » to uncheck. RED by mutating one field
  check at a time, and by a profile read that never resolves.
- **T8-F8** (`test/ui/components.test.tsx`): a Chips option with `disabled` + `describedBy` is a disabled radio
  with an accessible description and a dimming rule. RED by dropping `aria-describedby` or `disabled`.
- **T8-F1** (B04, Option A): GymPicker takes an optional `actions(s)` render prop. When it is given, « Créer une
  salle » is a dashed card (new `features/places/CreateGymCard.tsx`, tokens in `places.module.css`) and the
  screen's StepActions bar replaces « Valider » and the in-picker error. In create mode the bar shows only
  « Retour ». PlaceStep's « Continuer » stays disabled until a gym is chosen. CSS rule
  `.back:only-child { flex: 1 1 auto; }`. `flows.ts` now clicks « Créer une salle ». Without `actions` (Mes
  lieux) nothing changes. RED test-first gave 3 failures; GREEN was 163 passed (onboarding and places).
- **T8-F16**: flow.test checks the scroll-padding value, and the new `e2e/onboarding-focus.spec.ts` was added.
  Both were adjusted at integration, see « Conflicts and integration fixes ».

## Group 2 (T8-F13, T8-F12, T8-F7, T8-F3)

- **T8-F13** (`health-step.test.tsx`): the full CONSENT_EXPLANATION and LIMITATIONS_NOTE texts are pinned with
  `verbatim()` (exact text and exact `textContent`). They are checked in the « Accord santé » region, in the
  locked card and in the post-consent editor. RED by mutating the source texts: 3 of 19 new tests failed, while
  the HEAD tests passed 19/19.
- **T8-F12**: `expectNoHealthFields()` checks the whole screen before consent and after « Passer »: no
  combobox, textbox or radio, and no Zone, Côté or Note label. RED: adding a sibling LimitationsEditor fails
  the new test.
- **T8-F7** (`ReadyStep.tsx`): the coach's ready line renders only on `coach && me && allDone`. The test is
  `it.each(COACH_IDS)`: no line at 2/3, then a fresh pull plus « Réessayer » gives 3/3 and the line appears.
  RED before the fix: 3 of 3 coaches failed.
- **T8-F3**: a visually hidden `role="status"` is mounted from the first render and reads « Prêt hors ligne »
  once ready. When readiness goes from waiting to ready, a `useLayoutEffect` moves focus to « Commencer », but
  only if focus had fallen back to body or null. Supporting changes: `StepActions.primary.ref`, and Button
  props `ComponentProps<'button'>` (type only, so `ref` passes through in React 19). Two new tests in
  `ready-step.test.tsx`; mutation checks for « no focus » and « always focus ».
- The group's E2E run had not finished when it reported. The whole suite was rerun here (see final outputs).

## Group 4 (T8-F2, T8-F6, T8-F17, T8-F18, T8-F19, T8-F23)

- **T8-F2**: StepActions gets `useStickyBarHeight`: a ResizeObserver writes the bar's real height as
  `--onb-bar`, only inside `.flow`, through the CSSOM (allowed by the CSP), and removes it on unmount. The CSS
  is `scroll-padding-bottom: calc(var(--onb-bar, 6.5rem + env(safe-area-inset-bottom, 0px)) + var(--space-2))`.
  TabBar's `useFocusAboveBar` is now exported and reused on the onboarding bar, for WebKit focus(). New E2E:
  `e2e/onboarding-bar.spec.ts`.
- **T8-F6**: quest checks start at 250, 350 and 450 ms, the coach at 500 ms and « Commencer » at 600 ms. A test
  checks the start times strictly increase.
- **T8-F17**: under `@media (max-height: 30rem)`, `.flow .bar` is static with no background, the Carnet band is
  removed, and the page's scroll-padding is 0.
- **T8-F18**: the Carnet bar is a full-width paper band under an ink line (border-image outset, no horizontal
  scroll).
- **T8-F19**: the `window-open` clip insets now cover the panel shadow (Clair and Carnet). The test computes how
  far the shadows reach.
- **T8-F23**: « Réessayer » uses the toolkit `block` button, and the `.notReady > button` rule is removed.
- RED/GREEN as in the group's notes: 7 unit failures and 2 E2E failures before the fix. Measured `--onb-bar` was
  174–176 px with the two-line error.

## Conflicts and integration fixes

1. **g2 `1c26fbe` onto g1, `apps/web/test/onboarding/celebration.test.tsx`**
   - Imports: g1 added `within`, g2 added `fireEvent`. Resolved as `{ fireEvent, screen, within }`.
   - Body: g2 added the `it.each(COACH_IDS)` « mot de la fin du coach … seulement à 3/3 » test in the same spot
     where g1 replaced the « vrais états » test with the `openReadyAlone` helper. Both kept: g2's test first,
     then g1's helper and its two tests.
   - `ready-step.test.tsx` merged by itself (g1's 409 wait and g2's two focus tests).
2. **g4 `fa1c58f` onto g1 + g2**
   - `StepActions.tsx`, React import: g2 needed `type Ref` (for `primary.ref`) and g4 needed
     `type RefObject, useEffect, useRef` (for the bar measurement). Resolved as
     `{ type Ref, type RefObject, useEffect, useRef }`. The rest merged by itself: the bar keeps its `ref` for
     the measurement and focus hooks, and the primary Button keeps `ref={p.primary.ref}`.
   - `celebration.test.tsx`, imports: kept g1's `TrainingProfileView` and `settle`, and g4's
     `ui from '../../src/ui/ui.module.css'`.
   - `celebration.test.tsx`, body: kept g2's coach-at-3/3 test, then g4's « Réessayer » full-width test, then
     g1's `openReadyAlone` helper and tests.
   - `ReadyStep.tsx` (g2's focus, status and coach-at-3/3 plus g4's `block` on « Réessayer »),
     `onboarding.module.css` (g1's `.back:only-child` plus g4's bar, Carnet, short-screen, quest delays and
     clip rules) and `flow.test.tsx` merged by themselves.
3. **Integration breakage, fixed in `fb5016a`**
   - **flow.test (T8-F16 vs T8-F2)**
     - Problem: g1's regex expected a fixed `calc(<n>rem + env(...))`. After g4 it failed with « scroll-padding-bottom:
       calc(var(--onb-bar, 6.5rem + env(safe-area-inset-bottom, 0px)) + var(--space-2)): expected null not to
       be null ».
     - Fix: the assertion now matches g4's form, and the pre-measure fallback must still be ≥ 5.25rem. Both
       intents hold: F2 measures the real height, and F16 makes sure the fallback covers the bar.
     - Mutation check: a fallback of `2rem` fails with « expected 2 to be greater than or equal to 5.25 ».
   - **e2e/onboarding-focus (T8-F16 vs T8-F17)**
     - Problem: g1's spec put the city under the sticky bar at 320 px high. Since F17, the bar is static at
       30rem or less, so the spec failed on both browsers: « la ville peut passer sous la barre », Received
       false.
     - Measured with a temporary spec (deleted, never committed) at 390 px wide:
       - the bar is static at 320 and 480 px high, and sticky from 481 px up;
       - the city input sits at 350–402 px in the document;
       - so at any sticky height (> 480 px) the city cannot be scrolled under an 84 px bar.
     - Fix: the spec now checks the short-screen case F17 creates, in both engines. At 320 px no ancestor of
       « Retour » is sticky or fixed, and the city starts below the window. After Tab, the city is focused, its
       top and centre are in the window, `elementFromPoint` at its centre hits the city, and the bar is still
       not pinned.
     - WebKit only scrolls to the input's text line, which leaves the box at 284–336 in a 320 px window. That
       is UA scrolling, not author content covering the field, so the check is « top and centre visible,
       uncovered » rather than the full box.
     - The sticky-bar case (Tab and focus(), Chromium and WebKit) stays covered by g4's
       `e2e/onboarding-bar.spec.ts`. The flow.test comment points to both specs.
     - Mutation check: removing the short-screen `.flow .bar { position: static; … }` rule fails the spec on
       both browsers (« écran bas : la barre n'est plus collée », Expected false, Received true). The CSS was
       restored from a scratchpad copy and `git diff` was empty.

## Final command outputs (HEAD `fb5016a`)

- `pnpm lint`: `Checked 537 files in 344ms. No fixes applied.`
- `pnpm typecheck`: exit 0 (contracts, domain, server, web).
- `pnpm test`: exit 0, `Test Files 185 passed (185)`, `Tests 2561 passed | 2 skipped (2563)`. No stderr, warning
  or error line in the log.
- `pnpm --filter @rune/web test:e2e` (whole suite, Chromium and WebKit): exit 0, `28 passed (6.8m)`. That
  includes coach-onboarding, onboarding-bar and onboarding-focus on both browsers, and arrival (gym path through
  `flows.ts`, « Créer une salle »).
  - The first whole run, before `fb5016a`, gave `26 passed`, `2 failed` (onboarding-focus on Chromium and on
    WebKit, as described above).
- Covering run after the conflicts: `npx vitest run --project web apps/web/test/onboarding apps/web/test/places
  apps/web/test/ui apps/web/test/app/shell.test.tsx apps/web/test/profile`. Before the fix: 1 failed and
  522 passed (the flow.test regex above). After: `flow.test.tsx` 20/20.

## Clean-up

- Removed the worktrees `appsport-fix-T8-r1-g1`, `-g2` and `-g4` with `git worktree remove --force` and deleted
  the branches `fix/T8-r1-g1`, `fix/T8-r1-g2` and `fix/T8-r1-g4`. All three worktrees were clean beforehand.
  Each removal left behind its ignored `node_modules` and some empty folders. They were deleted with
  `rmdir /s /q`, which does not follow pnpm's junctions. The main checkout's dependencies still work.
- **Not removed: `appsport-fix-T8-r1-g3` / `fix/T8-r1-g3`.** That group is not in this round's list. Its branch is
  still at `fce32cc`, its worktree holds uncommitted changes plus an untracked `zz-visual-tmp.spec.ts`, and its
  WIP is snapshotted as `refs/wip/T8-r1-g3`. The controller should decide what happens to it.
- No git stash. No other worktree was read or modified.

## Concerns for the controller

1. **Merge 2**: socle-ecrans (T11) rewrote `features/places/GymPicker.tsx` and `places.module.css`. The `actions`
   prop, the CreateGymCard branch and the `.create*` CSS block from T8-F1 must be re-applied onto T11's version.
2. **Rulings to record** (g1): approve the Chips contract extension (`disabled` and `describedBy`), and allow T8
   to touch `features/places/` outside its file list (T8-F1).
3. **T8-F16 E2E scope changed** at integration, because T8-F17 unpins the bar on short screens.
   `onboarding-focus.spec.ts` now covers the short screen. `onboarding-bar.spec.ts` covers the sticky bar
   (with its error, so a taller bar than F16's case).
