# Task 9 report: Accueil et Progression (issue #57)

Branch `socle`, main checkout `C:\Users\eliott.colin\appsport`, from `fb5016a`.
Commit: `b7f161f` feat(web): accueil avec le coach et onglet Progression en avant-goût (12 files, +1310 −32; `git status` clean afterwards).
Review package: `.superpowers/sdd/2026-10-13-refonte-rune/review-fb5016a..b7f161f.diff`.

## What I implemented

### Accueil (`apps/web/src/features/home/HomePage.tsx`, `home.module.css`)
Layout from MixSombre / MixClair and the prototype's « Accueil » screen; behaviour and texts from spec §10.2 and the controller rulings.
- **Greeting by Europe/Paris hour**: « Bonjour, {pseudo} » from 05:00 to 17:59, « Bonsoir, {pseudo} » otherwise. The hour comes from `Intl.DateTimeFormat` (`timeZone: 'Europe/Paris'`, `hourCycle: 'h23'`) applied to `services.now()`, the injected clock (tests pass `now`). The 5 s readiness refresh re-renders the page, so an open home switches to « Bonsoir » within 5 s of 18:00.
- **Coach bubble**: the toolkit's `CoachBubble`, label « Aujourd'hui », text `coachLine(coach, 'daily', new Date(now), pseudo, profile.daysPerWeek)` (Task 7). No bubble while the profile (and so the coach) is unknown, e.g. on a new device before the first pull.
- **« Quêtes d'éveil » card**: the toolkit's `SystemPanel` « Éveil terminé. » (h2), the existing home text « Tes programmes et tes séances arriveront ici. », then the existing `AwakeningQuests` + `awakeningQuests()` from Task 8 (reused, not recreated), fed with the real states: complete profile, primary place, offline readiness. The panel title stays « Éveil terminé. » whatever the count, as in the mockup and in T8's ReadyStep (the user reaching the home has finished onboarding). The quests always show their real state.
- **Tiles**: « Lieu principal » shows the primary place's name and links to its card `/places/{id}`. « Rythme » shows `daysPerWeek` through `CountUp`, with « séances / sem. » on screen and « séances par semaine » for screen readers; it links to `/profile`. Each tile appears only when its value is known.
- **« Objectif · niveau » row**: `GOAL_LABELS[goal] · EXPERIENCE_LABELS[experience]` with a chevron, linking to `/profile`. It appears only when both values are known.
- **Banners kept**, same conditions and same texts: the yearly password reminder (`passwordReminderDue`) and the 18-year-old notice with « J'ai compris ».
- **« Prêt hors ligne » indicator kept** (R-SYN-33, test « l'accueil affiche le voyant »), below the cards. One `useReadiness()` feeds both the indicator and the quest, so they never disagree. When it is not ready, a full-width « Réessayer » sits below the indicator (the same pattern as T8's ReadyStep) and starts a manual sync as before.
- **Motion**: the cards enter in cascade (the global `.stagger` class from motion.css); a tile or the row gives a press feedback at `scale(.98)` over `--dur-fast` with `--ease`; under reduced motion there is no movement (motion.css fades only). `CountUp` shows its final value at once under reduced motion.
- Colours come only from tokens. Cards use `--surface` / `--border` like the toolkit's list groups, plus the mockup's soft shadow (near-black, visible only in light themes). Grids hold 2 tiles per row on a phone and drop to 1 per row when text is enlarged (rem-based minimum, never more than half the width).

### Progression (`apps/web/src/features/progression/ProgressionPage.tsx`, `progression.module.css`)
This replaces T5's placeholder. Layout from ProgressionSombre / ProgressionClair and the prototype; values from spec §9 and the rulings.
- `export const MUSCLE_GROUPS_LABELS = ['Pectoraux','Dos','Épaules','Bras','Abdos','Fessiers','Quadriceps','Ischios','Mollets']` (display constant, as the brief asks).
- **Global rank card** (section named by its h2 « Rang global », shown uppercase via CSS): a 92 px `RankBadge` E with a soft accent halo that grows in; « Rang E »; an empty XP bar (`aria-hidden`, `data-xp="0"`, no fill) crossed once by a decorative sheen (« juste un reflet »). At rest the sheen waits outside the clipped track, so no rule sets opacity 0. Then « 0 / 100 XP » on screen (read « 0 sur 100 XP ») and « Prochain : D ». The card uses the same « carte forte » treatment as `SystemPanel` in each theme: white with a 3 px gradient bar in light, gradient with an icy border in dark and Salle de nuit, ink frame with a hard shadow in Carnet.
- **Counters at 0**: `CountUp` for « séances », « kg » « soulevés », « sem. » « d'assiduité ». « sem. » is read « semaine » by screen readers.
- **« Rangs par muscle »** (h2, « 9 groupes »): a list of 9 `RankBadge rank="E" size={32} mini` (each read « Rang E ») with their labels. The groups pop in one by one (`--i` through a React style prop, 250 ms, `--ease`). I did not use `locked`: spec §9 says the 9 groups are *at* rank E, and the faded `locked` look would put the letter under the 3:1 contrast of a UI element.
- **Système note**: `role="note"`, the label « [ SYSTÈME ] » (brackets hidden from screen readers, as in `SystemPanel`) and the verbatim text « Aucune séance gravée. Ta première séance débloque tes rangs. ». It is the mockup's compact dashed note, not `SystemPanel`, which requires a title and would split the verbatim sentence in two.
- Reduced motion: halo and groups become a short fade with no delay; the sheen is off (`animation: none`).

### Tests changed because a text changed
- « Bonjour lea » → « Bonjour, lea » (and `max`, `Léa`) in `test/app/guard.test.tsx`, `test/app/shell.test.tsx`, `test/auth/login.test.tsx`, `test/auth/logout-reset.test.tsx`, `test/onboarding/ready-step.test.tsx`. All of them run at `DEFAULT_NOW` (14:00 in Paris), so the greeting is deterministic.
- `shell.test.tsx`: the test title « page provisoire » becomes « l'avant-goût » (assertions unchanged).
- `e2e/coach-onboarding.spec.ts` (T8's handoff in its report, ruling P9 « lands on the home with the chosen coach's bubble »): after « Commencer », it checks the heading `^Bon(jour|soir), noa$` and the Scribe's bubble on the home: name, « Aujourd'hui », and one of its three daily lines, with `{jours}` = 2 as chosen in the flow.

## Tests and results

New tests:
- `apps/web/test/home/home.test.tsx` (30 tests): the greeting at 9 Paris times (summer and winter, 04:59/05:00, 17:59/18:00, 00:30), run in the suite's New York time zone so that a local or UTC hour fails; the pseudo as is. The coach bubble for each coach, with its label, name and line (pseudo and rhythm replaced); the line follows the injected clock's day, over 3 days, including the literal « … rythme de 3 séances par semaine … »; no bubble without a coach (checked after the reads finish). The quests window: SYSTÈME label, h2, home text, 3 read-only checkboxes at 3/3; not offline-ready gives 2/3; no place and no profile gives 1/3; the indicator agrees with the quest; « Réessayer » starts a manual sync. The tiles and row: spoken names « Lieu principal Basic Fit » (href `/places/p-1`), « Rythme 3 séances par semaine » (href `/profile`), « Objectif · niveau Prendre du muscle · Jamais » (chevron, href `/profile`); no tile, row or bubble without data; under reduced motion with `requestAnimationFrame` frozen, the rhythm shows 3, not 0; the mockup order (title, bubble, window, tiles, row). The banners: reminder and 18-year notice shown when they apply, absent otherwise. The CSS: token colours only (shadows excepted) and touch targets of at least 44 px.
- `apps/web/test/progression/progression.test.tsx` (12 tests): the « Rang global » region with img « Rang E », « Rang E », « 0 / 100 XP » (read « 0 sur 100 XP »), « Prochain : D »; the empty XP bar is decorative; the counters read « 0 séances », « 0 kg soulevés », « 0 semaine d'assiduité » and each shows 0; `MUSCLE_GROUPS_LABELS` verbatim, a « Rangs par muscle » region with h2 and « 9 groupes », 9 list items in order each with img « Rang E »; the Système note verbatim; no fake data (the only numbers spoken are 0, 9 and 100, and every image is « Rang E »); reduced motion shows the final values at once; `/progression` in the app with the « Progression » tab current. The CSS: token colours only; no `opacity: 0` or `visibility: hidden` outside keyframes; sheen and groups on `--ease`; under reduced motion no sheen and the groups fade with no delay.

### TDD evidence
**RED**, run separately before any implementation (only the tests and the « Bonjour, » updates were written):
```
pnpm --filter @rune/web exec vitest run --root ../.. --project web test/home test/progression test/app/guard.test.tsx test/onboarding/ready-step.test.tsx

 FAIL  |web| test/home/home.test.tsx > salutation selon l'heure de Paris (bascule à 18 h) > 18:00 (heure d'été) à Paris …
AssertionError: expected 'Bonjour lea' to be 'Bonsoir, lea' // Object.is equality
 FAIL  |web| test/progression/progression.test.tsx > Progression en avant-goût (spec refonte §9) > titre « Progression », rang global E, « 0 / 100 XP », prochain rang D
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Rang global"
 FAIL  |web| test/progression/progression.test.tsx > feuille de la Progression (progression.module.css) > …
Error: ENOENT: no such file or directory, open '…\src\features\progression\progression.module.css'
 FAIL  |web| test/app/guard.test.tsx > App > plus d'onglet 'Administration' …   (findByText 'Bonjour, lea')
 FAIL  |web| test/onboarding/ready-step.test.tsx > ReadyStep (E8, R-SYN-33) > récapitulatif, voyant vert, « Commencer » → … accueil
 Test Files  4 failed | 1 passed (5)
      Tests  40 failed | 53 passed (93)
```
The tests that passed at RED are regression guards on existing behaviour: banners, « Réessayer », the CSS token check on the old sheet.

**GREEN** (after implementation):
```
pnpm --filter @rune/web exec vitest run --root ../.. --project web test/home test/progression test/app test/onboarding test/auth test/status
 Test Files  30 passed (30)
      Tests  478 passed (478)
```

### Full checks
- `pnpm lint`: `Checked 540 files … No fixes applied.` (clean, after `biome format --write` on my files).
- `pnpm typecheck`: contracts, domain, server, web all clean (web includes `e2e/`).
- `pnpm test`: `Test Files 187 passed (187)`, `Tests 2603 passed | 2 skipped (2605)`; no warning or stderr.
- E2E, Chromium + WebKit: `coach-onboarding.spec.ts`, `shell.spec.ts` (including 320 px at 200 % text on the home), `offline.spec.ts`: `6 passed (3.3m)`.
- E2E full suite (`pnpm --filter @rune/web test:e2e`, Chromium + WebKit, all 14 specs): `28 passed (7.4m)`.

### Visual check
These are Playwright screenshots of a temporary spec, never committed and since removed from the repo: home and Progression at 390 × 844 in light, dark, Carnet and Salle de nuit, plus 320 px at 200 % text. Saved in the session scratchpad, `…\scratchpad\t9\shots\`. Results:
- Both screens match the mockups' structure, spacing and colours in light and dark.
- Carnet: ink frame, Newsreader section title at 600, no faux bold. Salle de nuit: dark card treatment.
- At 320 px / 200 %, the grids drop to fewer columns and there is no horizontal page scroll (`scrollWidth - innerWidth = 0` on both pages).

## Files changed
- `apps/web/src/features/home/HomePage.tsx`, `apps/web/src/features/home/home.module.css`
- `apps/web/src/features/progression/ProgressionPage.tsx`, `apps/web/src/features/progression/progression.module.css` (new)
- `apps/web/test/home/home.test.tsx` (new), `apps/web/test/progression/progression.test.tsx` (new)
- Text updates: `apps/web/test/app/guard.test.tsx`, `apps/web/test/app/shell.test.tsx`, `apps/web/test/auth/login.test.tsx`, `apps/web/test/auth/logout-reset.test.tsx`, `apps/web/test/onboarding/ready-step.test.tsx`
- `apps/web/e2e/coach-onboarding.spec.ts` (T8's handoff, P9)

## Self-review
- Completeness against the brief: greeting with the 18:00 switch, the « Aujourd'hui » bubble with the daily line, the « Quêtes d'éveil » card with real states, the « Lieu principal » and « Rythme » tiles, the banners kept; on Progression, « Rang E », « 0 / 100 XP », the 0 counters, 9 `RankBadge` « Rang E » with the brief's labels, the verbatim Système text, `CountUp`, the cascade.
- Reuse: `Page`, `CoachBubble`, `SystemPanel`, `RankBadge`, `CountUp`, `Banner`, `Button`, `plural`, `coachLine`, `AwakeningQuests` / `awakeningQuests`, `OfflineReadyIndicator`, `useReadiness`, the global `.stagger`. No toolkit component recreated. `ListRow` was not used for « Objectif · niveau »: the mockup reverses its hierarchy (small muted key above a bold value).
- No fake data: every value comes from the mirror, and unknown values are hidden, never invented.
- Accessibility: roles and names kept (h1, banners `status`, indicator, read-only checkboxes); tiles and row are whole links of 44 px or more with explicit names; « / » and « sem. » get spoken alternatives; decorative SVGs are `aria-hidden`.
- No `appsport` in any change; no inline `<style>`, no `dangerouslySetInnerHTML`; React `style` props only for `--i`.

## Concerns
1. **Links to « Mon profil » after merge 2.** On `socle` today, `/profile` is Mon profil, so the « Rythme » tile and the « Objectif · niveau » row link to `/profile`. T10 (lane `socle-profil`) makes `/profile` the hub and moves Mon profil to `/profile/edit`. The merge 2 integrator should point these two links, and the two `href` assertions in `test/home/home.test.tsx`, to `/profile/edit`. If they don't, the links land on the hub, one tap away.
2. **Toolkit, outside my file list.** At 320 px with text at 200 %, the top-level `h1` « Progression » (a single 11-letter word at 56 px) overflows its column and is clipped by the shell's `overflow-x: clip`. `ui.module.css` `.pageTitle` has no `overflow-wrap: anywhere` or `hyphens: auto`, which the tab labels have. Shorter titles and « Bonjour, … » wrap normally. A one-line fix in `ui.module.css` (T5's toolkit), which I did not touch.
3. The « Prêt hors ligne » indicator stays on the home under the cards (existing behaviour pinned by `test/status/offline-ready.test.tsx`, ruling « keep conditions »). When ready, it repeats the third quest. Hiding it when ready would change that pinned behaviour, so I left it.
