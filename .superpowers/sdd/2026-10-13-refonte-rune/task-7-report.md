# Task 7 report: choix du coach, présentation et textes des coachs (#55)

Branch `socle`, main checkout. Commit `3d69225` (`feat(web): choix du coach dès l'onboarding et présentation animée`, `Closes #55`), on top of `35d89f5`. Not pushed.

## What I implemented

### `apps/web/src/features/coach/coach-lines.ts`
- `COACHES: Readonly<Record<CoachId, CoachTexts>>` with `name, temper, sample, intro, nutri, ready, daily` copied word for word from the brief's table (straight apostrophes). `name` reuses `COACH_NAMES` from the toolkit, so the names have one source.
- `coachText(coach, 'sample' | 'intro' | 'nutri' | 'ready', pseudo)` replaces `{pseudo}`. T8 can use it for `ready`.
- `coachLine(coach, 'daily', date, pseudo, daysPerWeek: number | null)` returns `daily[parisDay % daily.length]`. `parisDay` is the Paris civil day number (days since 1970-01-01), computed from `parisDate()` in `@rune/domain`, never the UTC day. The modulo stays positive for any date. It replaces `{pseudo}` and `{jours}`.
  - Deviation from the brief's 4-argument signature: a 5th argument `daysPerWeek` is required. The Scribe's first line needs `{jours}` and the brief's signature has no way to pass it.
  - When `daysPerWeek` is null, a line that contains `{jours}` gives way to the next line. Nothing is invented and no `{jours}` reaches the screen.

### `apps/web/src/features/coach/CoachStep.tsx`
- Step 1 of 9, « Choisis ton coach ». The heading is the onboarding `StepTitle`, named « Étape 1 sur 9 Choisis ton coach ».
- The lead sentence from the prototype serves as the group's legend: « Il t'accompagnera à l'entraînement comme en nutrition. Choisis la voix qui te correspond. ».
- Three coach cards (`CoachChoices`, exported so T10 can reuse them in its sheet):
  - each card has an 84 px avatar (`animated="brief"`, decorative), the name, the temper, and the `sample` line between « » with `{pseudo}` replaced;
  - each card is a `<label>` around a real transparent radio covering the whole card;
  - the radio is named by the coach name and described by the temper and the sample.
- Note « Tu pourras changer de coach plus tard dans ton profil. »
- « Continuer » is disabled until a coach is chosen. It goes through `StepActions` (error banner, pending state).
- « Continuer » calls `repos.profile.setCoach(coach)` through `useAction`, then opens the presentation.
  - On failure the user stays on the choice. The message appears (« Nécessite le réseau » offline, the API message otherwise) and the flow never advances.
  - Choosing a card again clears the error.
- Coming back from the objective (Retour) shows the stored coach checked. « Continuer » without a change does not resend it.
- Choosing a card tells the flow (`onChange`) that the user acted, so a later pull no longer moves the screen. This works like the place type does.

### `apps/web/src/features/coach/CoachIntro.tsx`
Presentation, following the prototype's « intro » screen:
- **Stage:** halo, and two 184 px avatar layers (training and nutrition) that cross-fade, turn and grow when the mode changes. The stage is decorative (`aria-hidden`). Only the visible layer loops its idle animation, as the toolkit designates for the presentation avatar.
- **Title and switch:** the coach name as `StepTitle`, which takes focus on arrival, named « Étape 1 sur 9 Le Skald ». Under it, the « Entraînement / Nutrition » switch: a `<fieldset aria-label="Mode du coach">` with two `aria-pressed` buttons, 44 px high, and a sliding pill.
- **Bubble:** the toolkit `CoachBubble`. In training it is labelled « Message d'accueil » and shows the `intro`. In nutrition it is labelled « Aperçu », shows `nutri`, and the name reads « Le Skald · Nutrition ».
  - The two texts are stacked in one grid cell, so the bubble keeps its height. The other mode's text is `aria-hidden` and faded out.
- **Progressive reveal (`TypedText`):**
  - the full text stays in place: it reserves the height and is the copy screen readers read, accessible from the first render;
  - an `aria-hidden` overlay copy types character by character with the prototype's timing (650 ms start, 19 ms per character, pauses after punctuation);
  - there is no caret, no « en train d'écrire » and no `aria-busy`;
  - only `TypedText` re-renders per character, not the avatars;
  - under reduced motion the full text shows at once.
- **Nutrition demo:** 750 ms after the text is complete, the intro switches once to nutrition, then back after 3.3 s.
  - A touch on the switch cancels the automatic demo. The switch then replays nutrition on demand, with no automatic return.
  - Each mode change is announced in a visually hidden `role="status"`: « Mode nutrition. <nutri> » or « Mode entraînement. ».
- **Hint and actions:** the hint « Touche « Nutrition » pour voir ton coach à table. », then Retour (back to the choice, focus on its title) and « C'est parti ». The button is there from the start, so nothing waits for an animation.
- **Robustness:** effects survive StrictMode double runs. The demo's « played » flag is set in the timer callback, not in the effect body.

### `apps/web/src/features/coach/coach.module.css`
Styles for the cards, the stage, the switch, the reveal and the stacked texts.
- Tokens only, the single curve and the common durations (`--dur-fast`, `--dur-screen`).
- Selected card: accent border, tint, filled check, a small spring.
- The other cards' avatars dim to 0.55 when a coach is chosen. They are decorative and the text keeps its contrast; the prototype dims the whole card to 0.5, which would break 4.5:1.
- Reduced motion: no spring, no growth, no rotation, no slide; only fades remain.

### `apps/web/src/features/onboarding/OnboardingFlow.tsx`
- `FlowStep = 'coach' | OnboardingStep` and 9 screens (`['coach', ...ONBOARDING_STEPS]`). `ONBOARDING_STEPS` on the server is unchanged.
- The progress uses the toolkit `SegmentedProgress` (segments plus « Étape n sur 9 ») for every step, inside the element whose id names each step title.
- Resume:
  - `profile.coach == null`: the coach step first, then the saved screen (`afterCoach = firstIncompleteStep(...)`);
  - coach set: the resume is unchanged;
  - an empty mirror on a new device starts at coach, and the first pull recomputes the screen, as before for the other steps.
- Retour from the objective goes to the coach step, after which « C'est parti » leads to the objective again.
- An unreadable local database starts at coach.
- Small related edits: `StepTitle.tsx` comments now say « Étape n sur 9 », and the `.progress` rule, unused now, was removed from `onboarding.module.css`.
- The other steps keep « Suivant »: renaming to « Continuer » belongs to T8.

### E2E (ruling P7, ruling P15)
- `e2e/support/flows.ts`: `completeOnboardingViaUi` starts at `coach`, chooses Le Skald, clicks Continuer, then « C'est parti », then continues from `goal`.
- `e2e/arrival.spec.ts`: after account creation it now expects `data-step="coach"`.
- `e2e/epoch.spec.ts` (P15) and `e2e/sheet.spec.ts` (the same issue, found by grep): the raw `PATCH /api/me/training-profile` now sends `coach: 'skald'` before `POST /api/me/onboarding/complete`. No other direct call to `/api/me/onboarding/complete` without a coach remains in `apps/web/e2e`; the only other training-profile PATCH (`daysPerWeek: 4`, epoch) runs after onboarding.

### Test helpers
- `test/support/onboarding.ts`: `EMPTY_PROFILE` gains `coach: null` (a new account). `seedProfile` now seeds a profile that has passed step 1 (coach Le Skald) unless `coach: null` is given, so existing resume tests keep their meaning.

## Tests

### New: `apps/web/test/coach/coach-step.test.tsx` (21 tests)
- The step shows « Choisis ton coach », « Étape 1 sur 9 » and 3 radios in order (L'Ombre, Le Skald, Le Scribe). Each card's description has `{pseudo}` replaced. The note is present, « Continuer » is disabled, and there is no Retour.
- Le Skald then « Continuer »:
  - sends exactly `PATCH {coach:'skald'}`;
  - shows the presentation: the heading « Étape 1 sur 9 Le Skald » has focus, the label « Message d'accueil » and the Skald's `intro` text are accessible, there is no typing text, and the « Mode du coach » group is present;
  - « C'est parti » leads to the objective, « Étape 2 sur 9 », with focus.
- Retour from the presentation goes back to the choice, which stays checked.
- Retour from the objective: the stored coach is checked, and Continuer without a change sends nothing.
- A failure (offline, server 500) keeps the user on the choice with the message, without the presentation and without storing.
- Resume with `coach: null` and `onboardingStep: 'availability'`: coach first, then availability (« Étape 7 sur 9 »). With a coach, the resume goes straight to availability.
- A coach card touched before a pull that brings another coach: the screen does not move.
- `CoachIntro`, with fake timers:
  - the full text is accessible from the start;
  - the `aria-hidden` animated copy grows as a prefix;
  - there is no typing indicator;
  - the demo plays only after the full text, shows nutri and « Aperçu », announces the mode, then returns after 2 s or more, with the other text left out of the accessibility tree; it plays only once;
  - the switch replays nutrition with no automatic return;
  - under reduced motion, the full text and « C'est parti » show from the first render and the buttons call their callbacks.
- Texts:
  - the full table is checked word for word;
  - `coachText` replaces `{pseudo}`;
  - the daily line follows the Paris day modulo 3: 2026-10-16 is index 0, then the cycle continues; `{jours}` and `{pseudo}` are replaced;
  - never the UTC day: 2026-10-15T22:30Z reads Oct 16 in Paris; 21:59Z and 22:00Z fall on either side of Paris midnight; winter time is checked on 2026-12-31T23:30Z;
  - the Scribe without a known rhythm gets the next line;
  - no line contains a number followed by kcal, g, kg or %, no curly brace remains, and no curly apostrophe is used.

### Updated: `apps/web/test/onboarding/flow.test.tsx`
« Étape n sur 9 » numbering everywhere; start at `coach`; resume tests seed a profile with a coach; the new-device test starts at coach; the focus test also goes back from the objective to the coach.

### Note on the test helper `readable()`
happy-dom caches `matches()` results and does not invalidate them when an ancestor's `aria-hidden` changes. I reproduced this with a throwaway test, since deleted. So the accessible-text assertions walk the ancestors with `closest('[aria-hidden="true"]')` instead of using Testing Library's `ignore` option with a descendant selector.

## TDD evidence

RED, a separate run before any implementation code (`apps/web/src/features/coach/` did not exist):

```
$ pnpm vitest run --project web test/coach/coach-step.test.tsx test/onboarding/flow.test.tsx
     × départ 'coach', « Étape 1 sur 9 », hors de la coquille de l'appli
     × changement d'écran : le titre, nommé avec « Étape n sur 9 », reçoit le focus ; pas au premier affichage
     × reprise au premier écran incomplet (firstIncompleteStep)
     × santé validée : reprise à 'ready'
     × nouvel appareil : la reprise est recalculée quand la première synchro arrive
     × « Prendre du muscle » + « Suivant » → PATCH, puis « Autre sport » en 3 sur 9 ; « Retour » garde la réponse
     × reprise sans lieu principal : 'place_kind', aucun type coché (le choix n'est pas gardé)
 FAIL  |web| test/coach/coach-step.test.tsx
Error: Failed to resolve import "../../src/features/coach/coach-lines" from "apps/web/test/coach/coach-step.test.tsx". Does the file exist?
 FAIL  ... départ 'coach' ... Error: until: condition jamais remplie
 FAIL  ... TestingLibraryElementError: Unable to find role="heading" and name "Étape 2 sur 9 Objectif"
 FAIL  ... TestingLibraryElementError: Unable to find an element with the text: /^Étape \d sur 9$/
 Test Files  2 failed (2)
      Tests  7 failed | 6 passed (13)
```

GREEN after the implementation:

```
$ pnpm vitest run --project web test/coach/coach-step.test.tsx test/onboarding/flow.test.tsx
 Test Files  2 passed (2)
      Tests  32 passed (32)
```

Later refinements (stacked texts, isolated `TypedText`, `<fieldset>` for the switch), with their extra assertions:

```
$ pnpm vitest run --project web test/coach test/onboarding
 Test Files  5 passed (5)
      Tests  78 passed (78)
```

## Final verification (on the committed code)
- `pnpm lint`: `Checked 529 files … No fixes applied.`
- `pnpm typecheck`: contracts, domain, server and web all clean.
- `pnpm test`: `Test Files 183 passed (183) · Tests 2501 passed | 2 skipped (2503)`. The output is clean: no warning, act message or stderr.
- `pnpm --filter @rune/web test:e2e`, the **whole suite**, Chromium and WebKit: `22 passed (4.4m)`, exit 0. This includes arrival (onboarding through the UI with the coach), epoch, sheet, offline, protocol, shell, theme, update, kill-switch and boot-splash.
- Visual check: Playwright screenshots at 390 × 844, light and dark, of the choice, a selected card, the presentation while typing, the nutrition demo, the end of the presentation, and the objective at step 2 of 9. They are in the session scratchpad and not committed.

## Files changed
- Created:
  - `apps/web/src/features/coach/coach-lines.ts`, `CoachStep.tsx`, `CoachIntro.tsx`, `coach.module.css`
  - `apps/web/test/coach/coach-step.test.tsx`
- Modified:
  - `apps/web/src/features/onboarding/OnboardingFlow.tsx`, `StepTitle.tsx` (comments only), `onboarding.module.css` (unused `.progress` removed)
  - `apps/web/test/onboarding/flow.test.tsx`, `apps/web/test/support/onboarding.ts`
  - `apps/web/e2e/support/flows.ts`, `arrival.spec.ts`, `epoch.spec.ts`, `sheet.spec.ts`

## Self-review
- Completeness against the brief and the rulings:
  - step 1 of 9;
  - the presentation (full text accessible, animated copy `aria-hidden`, no typing indicator, reduced motion shows everything at once, label « Message d'accueil », the demo once then back, the switch replays it);
  - `setCoach` failure keeps the user on the step;
  - resume through coach first;
  - numbering on 9 for every step;
  - P7 flows and specs;
  - P15 epoch, plus sheet, then the whole E2E suite green.
- No secrets in this report or the commit message (no invitation code, link with `#`, password or token).
- No « appsport » in any tracked file I touched.
- CSP: no inline style strings, no `dangerouslySetInnerHTML`. The React `style` prop is not used.
- Touch targets: cards cover their whole area, and the switch buttons are 44 px high.
- No Dexie access from screens: the screens use repos and `useLive` only.
- The state rules in `coach.module.css` set opacity 0 on the hidden mode text, the nutrition halo and layer, and the full text while it types. These are states with a visible counterpart (the overlay or the other text), not entrance animations; entrance animations keep `backwards` fill only.

## Concerns
1. **Coach cards do not use the toolkit `ChoiceCard`.** Its icon slot is a fixed 40 px tile that forces SVGs to 22 px, and its description is a single string. The prototype's coach card needs an 84 px avatar, a temper and a quote. Changing `ui/ChoiceCard.tsx` is outside this task's file list, so `CoachCard` reuses the same pattern (transparent radio, `CheckGlyph`, same border, tint and states) in `features/coach`. If the controller prefers, `ChoiceCard` could gain a `media` slot and a second description line, and `CoachCard` would become a call to it.
2. **The presentation bubble keeps the toolkit `CoachBubble`'s 40 px avatar** next to the big 184 px avatar. The prototype's intro bubble has no avatar. Hiding it needs a `CoachBubble` change, which is outside the file list.
3. **`coachLine` takes a 5th argument `daysPerWeek: number | null`**, which the brief's signature lacks. The Scribe's `{jours}` needs it, and null gives way to the next line. T9 should pass `profile.daysPerWeek`.
4. **The onboarding frame is still the socle's frame:** `PublicShell`, `Page` « Prise en main », h2 step titles, and actions aligned right. Only the progress moved to `SegmentedProgress`. The B01 header (logo, segments and « Étape n sur 9 » on one line, 28 px h1, bottom action bar) and « Suivant » → « Continuer » on the other steps are T8's restyle (`onboarding/*.tsx`).
5. **Small edits outside the strict file list, all caused by this change:**
   - comments in `StepTitle.tsx`;
   - removal of the now-unused `.progress` rule in `onboarding.module.css`;
   - the test helper `seedProfile` defaulting to a coach;
   - `sheet.spec.ts`, which had the same raw-API problem as `epoch.spec.ts` (P15 asked to grep and fix them the same way).

## Fix report: round 1 (integration of fix/T7-r1-g1, g2, g3)

- Integrated on `socle` in `C:\Users\eliott.colin\appsport`, base `3d69225`, with `git cherry-pick 3d69225..<branch>` in order g1, g2, g3. History is linear, with no merge commit.
- HEAD after integration: `e18a259`. No separate integration commit: the only integration breakage was inside the conflicting hunk of g2, and it was fixed in that conflict resolution (see « Conflict resolved »). Lint, typecheck, the full suite and the whole E2E suite are green on the result.
- Commits on `socle` (new hash ← fix-branch hash):
  - `9120163` ← `b155c9d` fix(web): choix du coach figé pendant l'envoi, cascade sur une enveloppe
  - `3a55000` ← `79e14ea` fix(web): présentation du coach sous mouvement réduit, halo, contraste et gras du Carnet (includes the conflict resolution)
  - `e18a259` ← `2c91a3a` test(web): tests de l'étape coach qui attrapent les régressions manquées
- Cumulative diff `3d69225..HEAD`: 8 files, +453/-56.
  - `apps/web/src/features/coach/CoachIntro.tsx` (12)
  - `apps/web/src/features/coach/CoachStep.tsx` (63)
  - `apps/web/src/features/coach/coach-lines.ts` (6)
  - `apps/web/src/features/coach/coach.module.css` (19)
  - `apps/web/test/coach/coach-step.test.tsx` (253)
  - `apps/web/test/coach/coach-styles.test.ts` (86, new)
  - `apps/web/test/ui/contrast.test.ts` (68)
  - `vitest.config.ts` (2)

### Group 1 (T7-F11, T7-F4, T7-F1, T7-F17, T7-F9, T7-F21 fixed)

Files: `CoachStep.tsx`, `coach-lines.ts`, `coach-step.test.tsx`. CSS, `CoachIntro.tsx`, `OnboardingFlow.tsx` and the E2E files are unchanged.

- **T7-F1 (radios usable during the PATCH).**
  - `presenting: boolean` became `presented: CoachId | null`. It is set to the coach passed to `setCoach` once the call resolves, and `CoachIntro` renders from it, no longer from `choice ?? saved`.
  - `CoachChoices` has a new optional `disabled` prop, forwarded to each radio (`<input disabled>`). `CoachStep` passes `save.pending`, so no card can change while the PATCH is in flight.
  - Radios rather than `<fieldset disabled>`: happy-dom ignores a disabled fieldset on click, so a test could not check it. Browsers behave the same either way.
  - New test « pendant l'envoi, les cartes sont figées »: the PATCH is held by a gate, Scribe is clicked mid-flight, then the PATCH is released. Expected: the Scribe radio is disabled, Skald stays checked, focus is on « Étape 1 sur 9 Le Skald », and sent = `[{coach:'skald'}]`.
  - New test « pendant l'envoi qui échoue »: the same, released with a 500. Expected: the alert next to Skald, still checked, radios enabled again, no presentation, one PATCH.
  - RED: both failed at `3d69225` with `AssertionError: expected false to be true` (the radio was not disabled, then Scribe became checked).
- **T7-F11 (PATCH skipped after a silent pull failure).**
  - `save.run(value, choice !== null)`: `setCoach` is sent whenever a card was touched on this mount, whatever the mirror says (the PATCH is idempotent).
  - Unchanged: an untouched return from the objective (remount, `choice` null) still sends nothing.
  - Accepted cost: Retour from the presentation, then Continuer, resends the same coach once.
  - New test « un pull manqué après l'envoi »: a custom PATCH handler updates the mirror only for the first call. The test picks Skald, Scribe, then Skald, each followed by Continuer and Retour.
  - RED: `expected [ { coach: 'skald' }, …(1) ] to deeply equal [ { coach: 'skald' }, …(2) ]`. GREEN: the third PATCH `{coach:'skald'}` is sent.
- **T7-F4 (entrance animation restarts on the card you leave).**
  - Each `CoachCard` is wrapped in a plain `<div key>`, now the direct child of `.stagger`. The cascade animates the wrapper and the spring stays on the label, as in the prototype's `.rise` wrapper.
  - Structural test « cascade d'entrée sur une enveloppe »: no `.stagger > *` element is a radio's label, and each one contains a radio. RED: `expected true to be false`.
  - Browser check with a throwaway Playwright spec (deleted, never committed), Chromium and WebKit: on the old code the left card restarted `rune-enter-up` at opacity 0 (and `rune-fade` at 0.33 to 0.47 under reduced motion), 4 runs failed. On the fixed code: no animation on the card or its wrapper, opacity 1, `card-spring` only on the new card, 4 runs passed.
- **T7-F9 (`coachLine` needs a 5th argument).**
  - `daysPerWeek: number | null = null`; the JSDoc says an omitted value behaves like null.
  - New test with 4-argument calls: Scribe on 2026-10-16 gives « Point du jour : ton profil est à jour. », Skald gives its line 0 with the pseudo.
  - RED: runtime « undefined » in the Scribe line, and typecheck `error TS2554: Expected 5 arguments, but got 4`.
  - **For the controller:** record the ruling « T9 must pass `profile.daysPerWeek` to `coachLine` ». The group could not write it (`.superpowers` is off limits to it), and this integration only appends this report.
- **T7-F17 (afterCoach reset untested).**
  - The « reprise sans coach » test is extended: from availability it presses Retour until the coach step, sees Le Scribe checked, then Continuer and C'est parti. Expected: `goal`, « Étape 2 sur 9 », patches still `[{coach:'scribe'}]`.
  - The code was already correct. RED by mutation: with `afterCoach: prev.afterCoach` (reset removed), the test failed with `until: condition jamais remplie`. Reverted.
- **T7-F21 (StrictMode untested, demo-once guard cannot fail).**
  - `renderIntro` renders under `{ wrapper: StrictMode }`, so every `CoachIntro` test runs in StrictMode.
  - Wrapping alone does not catch the reported mutant (flag set in the effect body), because with motion `revealed` turns true after mount, and StrictMode double-runs effects only on mount. So two tests were added:
    - « mouvement réduit : la démonstration nutrition se joue quand même, une seule fois » (revealed at mount, so the double run matters). Fails on the mutant with `condition jamais remplie`.
    - « démonstration déjà jouée : un réglage du mouvement changé ensuite ne la rejoue pas ». `phoneSettings` gained a `change()` that notifies the matchMedia listeners. Fails when `demoPlayed` is deleted: `expected [Function] to throw an error`.
- Group tests (in its worktree, on `b155c9d`):
  - `coach-step.test.tsx`: 26 passed (19 before, 7 added, 1 extended). `test/coach` + `test/onboarding`: 85 passed, no warning or stderr.
  - Web project: 77 files, 1300 passed. `pnpm test`: 183 files, 2508 passed, 2 skipped.
  - `pnpm lint` clean (529 files), `pnpm typecheck` clean.
  - `pnpm --filter @rune/web test:e2e`, whole suite, Chromium and WebKit: 22 passed (4.0m).

### Group 2 (T7-F14, T7-F7, T7-F3, T7-F2 fixed)

Files: `CoachIntro.tsx`, `coach.module.css`, `coach-step.test.tsx`, new `coach-styles.test.ts`, `contrast.test.ts`.

- **T7-F14 (Carnet synthesized bold):** `:global(:root[data-theme="carnet"]) .cardName { font-weight: 600; }`, the same pattern as `voice.module.css` `.panelTitle`. The other themes keep Chakra Petch 700, as in the prototype.
- **T7-F7 (gold halo flash):** the `intro-fade` entrance moved from `.halo` to `.halo[data-tone="training"]`, as in the prototype (src.html:309). The nutrition halo only follows `data-mode` through its opacity transition.
- **T7-F3 (pressed Entraînement contrast):** the `.modePill` tint went from 14 % to 10 % (`color-mix(in srgb, var(--accent) 10%, var(--surface))`). Training label ratios before → after: Clair / auto-light 4.35 → 4.60, Sombre / auto-dark 8.33 → 9.11, Carnet 5.26 → 5.59, Nuit 8.47 → 9.36. The pressed Nutrition label stays at 14 %: 4.86 Clair, 8.49 Sombre, 5.49 Carnet, 8.72 Nuit.
- **T7-F2 (reduced motion):**
  - CSS: the reduced-motion block sets `.halo[data-tone="training"], .grow, .introFade { animation-delay: 0ms; animation-duration: var(--dur-fast); }` (motion.css convention: a short fade, no cascade).
  - JS: a helper `revealMs(text)` computes how long `TypedText` would take. When the reveal is skipped (reduced motion, `typed` false), the demo waits `revealMs(intro) + DEMO_DELAY_MS`, the same moment as with motion (about 5.7 s for the Skald). The demo still plays once, returns to training, and a touch on the switch still cancels it.
- Tests:
  - New `apps/web/test/coach/coach-styles.test.ts` (node, `parseCssBlocks`), three guards: (a) every `var(--font-title)` rule at a weight other than 600 has a Carnet override at 600; (b) only `.halo[data-tone="training"]` carries the entrance animation, the nutrition halo keeps opacity 0; (c) every animated rule has `animation: none` under reduced motion, or delay 0ms and duration `var(--dur-fast)`.
  - `contrast.test.ts`: `COACH_PAIRS` (pressed training label on `.modePill`, pressed nutrition label on the nutrition pill), checked in all 6 renderings; shell and coach pairs share one helper, `expectTintPairs`.
  - `coach-step.test.tsx`: a new `CoachIntro` test: under reduced motion the delay before the demo is at least the delay with motion; the demo announces the mode, returns after 2 s or more, and plays once.
- RED (before any source change): `pnpm vitest run --project web test/coach/coach-styles.test.ts test/ui/contrast.test.ts test/coach/coach-step.test.tsx` gave 6 failed, 62 passed: `.cardName en 700 : gras synthétisé en Carnet: expected undefined to be '600'`; the training halo had no animation; the training halo was absent from the reduced selectors; `mode entraînement pressé #1c6fb5 sur #dfebf5 (Auto, téléphone clair) : 4.35:1` (and Clair forcé); `expected 750 to be greater than or equal to 5700`.
- Group tests (in its worktree, on `79e14ea`):
  - `test/coach` + `test/ui/contrast.test.ts` + `test/onboarding`: 7 files, 127 passed.
  - `pnpm lint` clean (530 files), `pnpm typecheck` exit 0. `pnpm test`: 184 files, 2511 passed, 2 skipped, no stderr, warning or act message.
  - Whole E2E suite, Chromium and WebKit: 22 passed (4.6m).
  - Throwaway real-browser check (built CSS, computed styles, script deleted): under `reducedMotion=reduce`, halo-training, grow and introFade show delay 0s, duration 0.2s, opacity 1.00 at 260 ms; the nutrition halo has `animation: none` and opacity 0; the Carnet `.cardName` computes weight 600. With no-preference the motion is unchanged.

### Group 3 (T7-F20, T7-F18, T7-F16, T7-F6, T7-F5 fixed; tests only)

Files: `coach-step.test.tsx`, `vitest.config.ts`. Implementation code was already correct; RED was shown with temporary implementation mutants, each reverted. In every case the HEAD tests stayed green (19/19) and the new tests failed.

- **T7-F20:** the offline test continues after « Nécessite le réseau »: choosing Le Scribe clears the alert; `api.setOffline(false)`; Continuer is enabled and saves; expected « C'est parti », patches `[{coach:'scribe'}]`, focus on « Étape 1 sur 9 Le Scribe », no alert. RED (`save.reset()` removed): `expected <div role="alert" ...> to be null`.
- **T7-F6:** new test « Retour depuis l'objectif puis un autre coach »: L'Ombre, Continuer, C'est parti, goal, Retour, coach (L'Ombre checked), Le Scribe, Continuer. Expected patches `[{coach:'ombre'},{coach:'scribe'}]` and focus on Le Scribe; after C'est parti, goal with patches unchanged. RED (`if (saved === null) await repos.profile.setCoach`): `expected [ { coach: 'ombre' } ] to deeply equal [ { coach: 'ombre' }, ...(1) ]`.
- **T7-F5:** the first `CoachIntro` test asserts the animated copy is an `HTMLElement` and its `closest('[aria-hidden="true"]')` is an `HTMLElement`, at t=0 and again after 1500 ms; the partial text is non-empty and `readable(partial.trim())` is `[]`. RED: mutant 1 (overlay mounted only once `shown > 0`, without aria-hidden) fails at t=0 with `expected null to be an instance of HTMLElement`; mutant 2 (aria-hidden only while `shown === 0`) fails the 1500 ms check.
- **T7-F18:** new helper `revealing(root)` (`[data-revealing]`, the attribute the CSS uses to hide the full text); asserted null under reduced motion and after the normal reveal. RED: `data-revealing={shown >= text.length ? undefined : ''}` fails the reduced-motion test; `data-revealing={done && shown === 0 ? undefined : ''}` fails the end-of-reveal assertion.
- **T7-F16:** new case 2026-12-31T22:30Z (23:30 Paris, day 20818, 20818 % 3 = 1) expecting `daily[1]`, and the web Vitest project pinned to `env: { TZ: 'America/New_York' }`, as the server project already is. RED: a fixed +2 h offset fails the new case; a local-time day passes all tests on this Europe/Paris machine without the pin and fails « jamais le jour UTC » with it (the pin takes effect in the web worker).
- Group tests (in its worktree, on `2c91a3a`): `test/coach/coach-step.test.tsx` + `test/onboarding`: 79 passed, 5 runs in a row. Web project under the pin: 77 files, 1294 passed. `pnpm test`: 183 files, 2502 passed, 2 skipped. Lint clean (529 files), typecheck exit 0. No E2E run (no app code touched).

### Conflict resolved

- One textual conflict, in `apps/web/test/coach/coach-step.test.tsx`, when g2 (`79e14ea`) was applied after g1. Both groups had added new `it(...)` blocks at the end of `describe('présentation du coach (CoachIntro)')`, right after « mouvement réduit : texte entier et « C'est parti » d'emblée »:
  - g1: « mouvement réduit : la démonstration nutrition se joue quand même, une seule fois, puis revient » and « démonstration déjà jouée : un réglage du mouvement changé ensuite ne la rejoue pas »
  - g2: « mouvement réduit : le texte entier reste à l'écran aussi longtemps qu'avec le dévoilement avant la démonstration »
- Step 1, plain union: all three tests kept, g1's first test, then g2's, then g1's second, each with its own closing lines. No conflict marker left.
- Step 2, semantic break found by running the union: `pnpm vitest run --project web apps/web/test/coach` gave **2 failed | 28 passed**, both g1 tests with `Error: condition jamais remplie en 5000 ms`. Cause: g1's tests waited at most 5,000 ms for the reduced-motion demo, but g2 (T7-F2, intended behaviour) now delays it to `revealMs(intro) + 750` ms, about 5.7 s for the Skald.
- Fix, inside the same resolution: in both g1 tests, `advanceUntil(nutritionShown, 5_000)` became `advanceUntil(nutritionShown, 20_000)`, the bound the existing demo test already uses. A comment explains it in the first test. No assertion changed. So `3a55000` differs from `79e14ea` by exactly that: +3/-2 lines in the test file.
- Check after the fix: `pnpm vitest run --project web apps/web/test/coach apps/web/test/ui/contrast.test.ts` gives **3 files, 75 passed**.
- T7-F21 still bites after integration: I re-applied the reported mutant (`demoPlayed.current = true` set in the effect body, the timer no longer checking it) to the integrated `CoachIntro.tsx`. g1's « mouvement réduit : la démonstration nutrition se joue quand même… » failed with `condition jamais remplie en 20000 ms` (and g2's reduced-motion test too). The file was restored from the index (`git checkout --`) before continuing.
- g3 (`2c91a3a`) applied cleanly on top. Its tests run under g1's StrictMode wrapper and g2's reduced-motion delay, and all pass.

### Final verification (on `e18a259`, in `C:\Users\eliott.colin\appsport`)

- `pnpm lint`: `Checked 530 files in 410ms. No fixes applied.` (exit 0)
- `pnpm typecheck`: exit 0. contracts, domain, server and web each ran `tsc --noEmit` with no error.
- `pnpm test`: exit 0, `Test Files  184 passed (184)` and `Tests  2519 passed | 2 skipped (2521)`, in 74.8 s. That is the 2501 at `3d69225` plus 7 (g1) plus 10 (g2) plus 1 (g3). A grep for stderr, warning and `act(` in the output finds nothing.
- `pnpm --filter @rune/web test:e2e`, the **whole suite**, Chromium and WebKit, run because g1 and g2 both changed app code (`CoachStep.tsx`, `CoachIntro.tsx`, `coach.module.css`). The final run gave **`22 passed (4.3m)`, exit 0**. Two earlier attempts on the same code did not count:
  - Attempt 1 was interrupted by the machine, not the code. A Node MSI reinstall (several `msiexec.exe` processes) removed `C:\Program Files\nodejs\node.exe` mid-run. Tests 1 to 18 passed, then WebKit `shell.spec.ts:120` failed with `Error: spawn C:\Program Files\nodejs\node.exe ENOENT` and Playwright stopped with no summary. Node came back as `v24.22.0` about a minute later. I did not touch the install.
  - Attempt 2 gave `1 failed, 21 passed (7.2m)` while the machine was still busy with installers. WebKit `kill-switch.spec.ts:27`, step « interrupteur actif », counted 3 document loads `['/', '/', '/']` where 2 are expected, so it is a reload race in the service-worker kill switch. The coach changes do not touch that code, and `shell.spec` passed in this run.
  - Flake check: `pnpm --filter @rune/web test:e2e kill-switch --repeat-each=4` gave **`8 passed (2.4m)`** (4 Chromium, 4 WebKit). The whole-suite rerun above is green.
  - For the controller: the WebKit kill-switch reload count can still flake under heavy machine load (3 loads instead of 2). This is spec §11.4 / T15 scope, not T7.
- No integration commit: `git show --stat HEAD` is g3's cherry-pick `e18a259` (see Cleanup).

### Cleanup

- Before removal, `git status` was clean in each fix worktree, and each one's single commit was on `socle` as a cherry-pick (table above).
- `git worktree remove --force` was run on `C:/Users/eliott.colin/appsport-fix-T7-r1-g1`, `-g2` and `-g3`, followed by `git worktree prune`. `git worktree list` no longer shows them.
- Git left the three folders behind. Each held only 141 empty folders and 232 pnpm junctions, every junction pointing inside its own folder, and no regular file. They were removed with `rmdir /s /q`, which does not follow junctions. All three paths are gone.
- The branches `fix/T7-r1-g1` (`b155c9d`), `fix/T7-r1-g2` (`79e14ea`) and `fix/T7-r1-g3` (`2c91a3a`) were deleted with `git branch -D`. Their commits are on `socle` as `9120163`, `3a55000` and `e18a259`.
- The other worktrees (rune-*, rune-local) were not touched.
- `git status`: `On branch socle`, `nothing to commit, working tree clean` (ahead of `origin/socle` by 4 commits: `3d69225` plus this round's 3).
- `git show --stat HEAD`: `e18a259` test(web): tests de l'étape coach qui attrapent les régressions manquées. 2 files changed, `apps/web/test/coach/coach-step.test.tsx` and `vitest.config.ts`, 60 insertions(+), 4 deletions(-).
- Nothing was pushed. No secret (code, `#` link, password, token) and no « appsport » in the touched files or the commit messages.

### Findings

- Addressed and surviving integration (15): T7-F1, T7-F2, T7-F3, T7-F4, T7-F5, T7-F6, T7-F7, T7-F9, T7-F11, T7-F14, T7-F16, T7-F17, T7-F18, T7-F20, T7-F21.
- Not addressed: none.
- Open for the controller: the ruling « T9 must pass `profile.daysPerWeek` to `coachLine` » (T7-F9), and the WebKit kill-switch flake under load noted above.
