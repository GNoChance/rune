# Task 4 report: bottom sheets, Système window, coaches, ranks, art and motion

Branch `socle`, commit `7854d7d` (on top of `553beb0`). Closes #52.

## What I built

- **Sources copied into the repo (ruling P13).** `docs/brand/coachs/{ombre,skald,scribe}/` holds `{coach}.svg`, `-light`, `-nutrition` and `-nutrition-light`. The files are byte-for-byte copies: Ombre comes from skald/systeme, Skald from skald/personnage, Scribe from skald/embleme. `docs/brand/rangs/rank-{E..S}.svg` and `mini/` come from rangs/pierre. No script holds a path outside the repo, and the word « appsport » appears nowhere.
- **`apps/web/scripts/svg-to-tsx.mjs`** turns those SVGs into components:
  - It uses a strict whitelist parser: only known SVG elements are accepted, and any text content fails the run.
  - Attributes become camelCase. `aria-*` and `data-*` stay as they are.
  - Every `id` and every `url(#…)` gets the `idPrefix` prop as a prefix.
  - Top-level coach groups (`sys-visor`, `per-eyes`, `emb-glyph`, `emb-glow`, …) keep their name in `data-g`, which the idle animations target.
  - It refuses outright (the run fails) on `style`, `on*`, `*href`, namespaced attributes, and values containing `` ` $ { } \ < > `` (ruling P4). It never emits style or `dangerouslySetInnerHTML`.
  - It writes `art/CoachOmbre.tsx`, `CoachSkald.tsx`, `CoachScribe.tsx` and `RankStone.tsx`, each with the header « fichier généré par svg-to-tsx.mjs », then formats them with the repo's biome. A second run gives identical files (md5 checked).
- **`ui/art/coach-id.ts`**: `CoachId` declared locally (ruling P3). **`ui/art/art-types.ts`**: shared types for the art (`ArtSvgProps`, `CoachMode`, `ColorScheme`, `Rank`, …).
- **`BottomSheet`** (`open`, `onClose`, `title`, `children`, plus optional `actions` and `inertOutside`, default true):
  - It has a handle (decorative, `aria-hidden`), a 55 % backdrop and 24 px top corners. Actions stack full width.
  - Focus is trapped inside. Escape calls `onClose`. The latest `onClose` is kept in a ref, so a new function on every render no longer re-runs the open effect.
  - On close, focus goes back to the element that had it at opening, unless the screen has already put it somewhere else.
  - The background is made inert through `inert-outside.ts`, and the inert state is removed on close and on unmount (layout effect, so it happens before focus returns).
  - From 600 px up, it shows as a centred window with no handle. The sheet slides up in `--dur-screen`; under reduced motion it only fades.
- **`Dialog`** keeps its API and renders a `BottomSheet`, passing `inertOutside` through (default false, as before; see concerns).
- **`SystemPanel`**:
  - Section named by its `h2`, label « [ SYSTÈME ] », `data-tone`.
  - Sombre (forced or Auto at night) and Salle de nuit: strong gradient card, light-blue border and HUD corner.
  - Clair and Carnet: card with a soft shadow and a 3 px gradient bar clipped by the card.
  - `success` tone uses the success colour.
- **`CoachBubble`**: animated 40 px avatar (hidden from screen readers, because the name is written in the bubble), name (« L'Ombre · Nutrition » in nutrition mode), label and text. No typing effect.
- **`CoachAvatar`**: picks the light or dark drawing from the effective theme (`useColorScheme`: Clair and Carnet are light, Sombre and Nuit are dark, Auto follows `prefers-color-scheme`). Ids come from `useArtId`, which strips `useId()` down to `[A-Za-z0-9_-]`. The avatar is labelled with the coach's name, plus « , mode nutrition » in nutrition mode. `animated` turns on the idle animations.
- **`RankBadge`**: `role="img"`, `aria-label="Rang X"`, `mini` variant, `locked` shown at opacity .45 in greyscale (visible and named).
- **`motion.css`** (global, imported by `ui/index.ts`):
  - Variables: `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)`, `--dur-fast: 200ms`, `--dur-screen: 380ms`, `--dur-celebrate: 900ms`.
  - `.enter-up`, and `.stagger > *` with a 60 ms delay per child up to the 8th.
  - `.pop`, a small spring.
  - Under reduced motion: fade only, no stagger, no spring.
  - Entrance animations use fill-mode `backwards`, so no rule sets opacity 0 outside keyframes.
- **`art.module.css`**: idle animations taken from the prototype:
  - Ombre: the helmet floats, and the visor floats and pulses.
  - Skald: it breathes, blinks and sways, and the prop floats.
  - Scribe: the glow breathes and the quill floats.
  - They run only with `animated`, and `animation: none` under reduced motion. Nothing starts from opacity 0.
- **`useReducedMotion`** and **`useMediaQuery`** are built on `useSyncExternalStore`, so they are correct from the first render, server snapshot included. **`CountUp`** shows `to` from the first render under reduced motion; otherwise it counts up from 0 with requestAnimationFrame.
- `ui.module.css`: the old `.dialog`, `.dialogBody` and `.actions` rules are replaced by the sheet rules (`.sheet`, `.sheetHandle`, `.sheetBody`, `.sheetActions`, keyframes, reduced motion). `.backdrop` keeps `var(--backdrop)`, which the existing test checks.

## Tests

`apps/web/test/ui/sheet-motion.test.tsx`, 34 tests:

- **BottomSheet**: dialog named « Se déconnecter », `aria-modal`, inert background, focus inside; decorative handle; Escape → `onClose`, focus back on the trigger, `inert` and `aria-hidden` removed; unmount while open removes `inert`; Tab and Shift+Tab wrap around; focus placed elsewhere by the screen is kept.
- **Dialog**: rendered as a sheet with a handle; `inertOutside` passed through.
- **RankBadge**: named « Rang E », `mini`, `locked` muted.
- **CountUp**: under `(prefers-reduced-motion: reduce)`, « 3 » on the first render (`renderToString`); otherwise it starts at 0 and reaches 3.
- **useReducedMotion**: true, false, and no `matchMedia`.
- **CoachAvatar**: no duplicate id across 4 avatars; ids without colons and every `url(#…)` pointing at an id of the same avatar; accessible names; light or dark variant by theme (`clair`, `nuit`, Auto with a dark phone); animatable groups present.
- **CoachBubble and SystemPanel**: content checks.
- **Generated art**: header present; no `<style`, no `style=` string or object, no `dangerouslySetInnerHTML`, no `on*=`; rendered DOM has no `style` element.
- **Motion**: variable values; reduced-motion neutralisation of `.enter-up`, `.stagger > *` and `.pop`; increasing stagger delays; no opacity 0 or hidden visibility outside keyframes (motion.css, art.module.css); idle animations off under reduced motion; token colours only in art, voice and motion.

Mutation checks I ran by hand:
- With unconditional focus restore, the « focus placed elsewhere » test fails.
- With `inertOutside` disabled, 3 tests fail.

### TDD evidence

RED, run before any implementation: `pnpm --filter @rune/web test test/ui/sheet-motion.test.tsx`

```
 FAIL  |web| test/ui/sheet-motion.test.tsx > BottomSheet (...) > ouverte : un dialogue modal nommé par son titre, le reste de la page inerte
Error: Element type is invalid: expected a string (...) but got: undefined. You likely forgot to export your component (...)
 FAIL  |web| test/ui/sheet-motion.test.tsx > Dialog : même API, rendu en feuille du bas > titre, contenu et actions dans une feuille avec poignée, fond inerte
AssertionError: expected null not to be null
 FAIL  ... > mouvement (...) > feuilles des composants : couleurs prises dans les jetons
Error: ENOENT: no such file or directory, open '...\apps\web\src\ui\art.module.css'
      Tests  33 failed (33)
```

GREEN, same command: `Tests  34 passed (34)` (two test mistakes fixed along the way: the heading was looked up while inert, and the Scribe glow only exists in the dark drawing).

### Full checks

- `pnpm --filter @rune/web test`: 72 files, 1078 tests passed.
- `pnpm lint`: clean (489 files).
- `pnpm typecheck`: clean.
- `pnpm test` (all projects): web, contracts and domain green.
  - Server: 1 to 3 timeouts in `test/infra/release.test.ts` and `build.test`, which spawn bash under a 5 s limit while the machine is loaded. They differ from run to run, pass alone (`npx vitest run --project server test/infra/release.test.ts` → 10 passed), and this task does not touch the server.
  - One run also had `withdraw.test.tsx` « Je refuse » fail once. That flaky test is already listed in spec §11.4; 5 isolated runs then passed 22/22.
- E2E `pnpm --filter @rune/web test:e2e` (all specs, Chromium and WebKit): **16 passed (3.8 min)**.
- `pnpm --filter @rune/web build`: OK. The art is tree-shaken because no screen uses it yet; motion.css is bundled.
- Visual check: throwaway esbuild bundle plus Playwright at 390 × 844, light and dark, with and without the sheet; nothing committed. Bubbles, panels (HUD corner in dark, bar in light), avatars and ranks (locked ones muted) match B08, C06 and F02. The sheet focus outline around the whole sheet was removed (`.sheet:focus-visible`).

## Files

- New: `apps/web/scripts/svg-to-tsx.mjs`.
- New under `apps/web/src/ui/`: `BottomSheet.tsx`, `CoachAvatar.tsx`, `CoachBubble.tsx`, `CountUp.tsx`, `RankBadge.tsx`, `SystemPanel.tsx`, `motion.css`, `art.module.css`, `voice.module.css`, `use-reduced-motion.ts`, `use-media-query.ts`, `use-color-scheme.ts`, `use-art-id.ts`.
- New under `apps/web/src/ui/art/`: `coach-id.ts`, `art-types.ts`, and the generated `CoachOmbre.tsx`, `CoachSkald.tsx`, `CoachScribe.tsx`, `RankStone.tsx`.
- New test: `apps/web/test/ui/sheet-motion.test.tsx`.
- New sources: 24 SVGs under `docs/brand/coachs/` and `docs/brand/rangs/`.
- Modified: `apps/web/src/ui/Dialog.tsx`, `apps/web/src/ui/index.ts`, `apps/web/src/ui/ui.module.css`.

## Self-review and concerns

1. **Files outside the brief's list.** I created helpers and style files that the brief does not list:
   - `CoachAvatar.tsx`: the brief names the component but no file for it.
   - `use-media-query.ts`, `use-color-scheme.ts`, `use-art-id.ts`, `art/art-types.ts`.
   - `art.module.css` and `voice.module.css`.

   I also modified `ui.module.css`, whose dialog rules became the sheet rules. Each file has one responsibility.
2. **Dialog is inert only on request.** `Dialog` passes its existing `inertOutside` (default false) to the sheet. `BottomSheet` used directly is inert by default. Making every Dialog inert broke 10 existing feature tests (admin members, places, profile, `ui.test`): some query elements outside an open non-strict dialog, and some restore focus themselves in `onClose`. That would have meant changing tests outside this task, so I kept the old behaviour. A later screen task can switch those dialogs to `inertOutside` or to `BottomSheet`.
3. **Focus restore and onClose.** Focus now returns to the trigger on close when focus was lost (body or inside the sheet), and the open effect no longer re-runs when `onClose` changes. Both are behaviour changes for existing Dialog callers. All existing unit and E2E tests stay green.
4. **Bundle size.** `RankStone.tsx` is about 184 KB of source (rank-B alone is 73 KB of SVG). It is tree-shaken today. Once the Progression or Home screen imports `RankBadge` statically, it will weigh on the initial bundle (spec §12 sets a +25 % cap). Lazy-loading the Progression page, or an asset-based variant, may be needed (T9 or T16).
5. **Locked rank name.** A locked rank is still read as « Rang X », as the ruling says. Locked is conveyed visually only (opacity and greyscale). The page using it should say it in its text.
6. **No backdrop tap.** Tapping the backdrop does not close the sheet; it was not required. The prototype's « scan » band on L'Ombre's visor is not reproduced, because it is not part of the source SVGs.
7. **Untracked files.** `holder.txt` and `.superpowers/` were already in the checkout before this task. I did not commit them.

## Re-dispatch on 2026-10-14 (base 76122a3): no new commit

The workflow dispatched Task 4 again, with base 76122a3. Task 4 was already implemented and committed in **7854d7d**, on top of 553beb0. The two commits after it, fa1f186 and 76122a3, are Task 3 fix carry-overs. They only touch `ui.module.css` (one forced-colors line), `base-styles.test.ts` and `components.test.tsx`, and none of Task 4's files. Re-implementing would duplicate the work, so I checked it against the brief and the controller rulings of this dispatch instead.

Ruling by ruling:
- **P13 (sources in the repo):** sources are under `docs/brand/coachs/` and `docs/brand/rangs/`. The script has no path outside the repo.
- **P4 (no style, no events, no `dangerouslySetInnerHTML`):** the generated files contain no style element, style string, event attribute or `dangerouslySetInnerHTML`. A test covers this.
- **idPrefix:** `useArtId` turns `useId()` into `[A-Za-z0-9_-]`, and a test checks that 4 avatars share no id.
- **Idle animations:** they live in `art.module.css` and use `var(--ease)`. They are turned off under reduced motion, and nothing starts from opacity 0.
- **Dialog:** it keeps its API and renders a `BottomSheet`, centred from 600 px up.
- **BottomSheet:** handle, backdrop, focus trap, Escape, focus returned to the trigger, and inert background through `inert-outside.ts`, removed on close and on unmount.
- **RankBadge:** `role="img"` and « Rang X ». The locked variant is visible and muted.

Re-verification at HEAD 76122a3:
- `node apps/web/scripts/svg-to-tsx.mjs`: the 4 generated files come out identical (`git status` clean afterwards).
- `pnpm --filter @rune/web test test/ui/sheet-motion.test.tsx`: 34 passed (34).
- `pnpm lint`: clean (489 files). `pnpm typecheck`: clean.
- `pnpm test`: 169 files passed, 2192 tests passed, 2 skipped.

The concerns 1 to 7 above still stand. The real Task 4 range for review is 553beb0..7854d7d, and its diff is already in `review-553beb0..7854d7d.diff`. The range 76122a3..HEAD is empty.

## Fix report, round 1 (integration of 3 parallel fix branches, 2026-10-14)

Base 76122a3 on `socle`. Each branch was cherry-picked in order (`git cherry-pick 76122a3..<branch>`), so history stays linear with no merge commit:

| Group | Branch head | Commit on socle | Findings |
|---|---|---|---|
| 1 | 65daff2 | b6de0f2 | T4-F18, F11, F13, F4, F15 (partly), F14, F16 |
| 2 | 701cb97 | 13d1f11 | T4-F3, F2, F5 (F1: shared part only) |
| 3 | 3ec3ec2 | 42f45d7 | T4-F26, F25, F24, F17, F8, F7, F6 |
| integration | — | 2e30e34 | test fixed where groups 1 and 3 met (Refs #52) |

### Group 1 (b6de0f2): sheet closable by touch, opener read before autoFocus, readable counter, Système voice, decorative avatars
Files: `apps/web/src/ui/{BottomSheet,CountUp,SystemPanel,CoachAvatar,CoachBubble}.tsx`, `art.module.css`, `ui.module.css`, `test/ui/sheet-motion.test.tsx`.
- **T4-F18:** when `actions` is undefined, the sheet adds its own « Fermer » button (Button secondary, block). `actions={null}` opts out. A backdrop tap was ruled out: it would close forms and destructive confirmations, fire at the end of a drag-select, and is hard to reach with VoiceOver. The JSDoc says the handle is decorative. Tests: Fermer closes the sheet and focus returns to the trigger; no Fermer with actions; no Fermer with `null`; the Tab wrap ends on Fermer.
- **T4-F11:** the opener is read during the render that opens the sheet (`open && !shown.current`, with `shown` updated in a layout effect). This happens before children commit, so before autoFocus runs. `sheet.focus()` is skipped when focus is already inside the sheet. RED: with an autoFocus input, focus went to the dialog. The mutant that captures the opener at effect time again fails only that test.
- **T4-F13:** CountUp shows the final value at once when the duration is 0, negative or NaN, and requestAnimationFrame is never called. Tests cover 0, -100 and NaN.
- **T4-F4:** the counting number is in an `aria-hidden` span, and the final value is in a `.visuallyHidden` span (new class in ui.module.css). Tests check the visible text and the spoken text separately.
- **T4-F15 (partly):** CoachAvatar `animated` now takes `boolean | 'brief'`. For `'brief'`, `.animated.brief [data-g]` sets `animation-iteration-count: 2` and `fill-mode: forwards`. CoachBubble uses `'brief'`.
- **T4-F14:** SystemPanel is now `role="group"` named by its title, not a region landmark. The brackets are aria-hidden, so a screen reader says « SYSTÈME ». New `headingLevel?: 2|3|4` prop, default 2.
- **T4-F16:** CoachAvatar `decorative` renders an aria-hidden svg with no role and no label. CoachBubble uses it.
- Group tests: sheet-motion 44/44; web 72 files / 1088 tests; lint and typecheck clean.

### Group 2 (13d1f11): sheet above the page, Système window readable in success tone and Carnet-styled
Files: `apps/web/src/ui/{ui.module.css, voice.module.css, SystemPanel.tsx}`, `test/ui/{sheet-motion.test.tsx, contrast.test.ts}`, new `e2e/sheet.spec.ts`.
- **T4-F3:** `.backdrop` gets `z-index: 100`. A unit test checks the backdrop sits above every other z-index under `apps/web/src`. The E2E test `sheet.spec.ts` checks that the centre of « Annuler » belongs to the sheet even when HomeCreate's radios are behind it, then clicks with a real pointer. RED on chromium and webkit, then GREEN.
- **T4-F2:** the label uses `--panel-tone-text`. In the success tone that is `color-mix(in srgb, var(--success) 70%, var(--text))`. A contrast test runs per palette against `--surface` and `--surface-strong`. RED was 3.43:1; it is now about 5.7:1 in Clair.
- **T4-F5:** in Carnet, the panel gets an ink border, `--radius-card`, a 4px offset shadow and no `::before` bar. The title uses `var(--font-title)`, and in Carnet it is weight 600 at 1.5625rem. Two CSS tests cover this.
- **T4-F1:** only the part both options share is done (the Dialog test no longer asserts that `main` stays non-inert). The default is not flipped; see "Not addressed".
- Group tests: 70/70 covering tests; E2E sheet.spec passes on chromium and webkit; web 1087 tests.

### Group 3 (42f45d7): art, ranks and motion tested against their mutants, art generator tested
Files: `apps/web/src/ui/use-art-id.ts`, `scripts/svg-to-tsx.mjs`, new `scripts/svg-to-tsx.d.mts`, `test/ui/sheet-motion.test.tsx`, new `test/ui/svg-to-tsx.test.ts`.
- **T4-F26:** pure `artIdPrefix(name, reactId)`. Tested with React ids in every known format.
- **T4-F25:** tests for Auto with a light phone, Carnet with a dark phone, and a live theme change without remount.
- **T4-F24:** the `[style]` check is now a real one. The generator exports `svgToJsx` (with a main guard) and gains `--check`, which formats through biome and compares with the committed files. The refusal tests cover style, on*, href, xlink:href, xml:space, dangerous values, and script/image/foreignObject/use elements.
- **T4-F17:** bubble tests: the avatar is hidden from screen readers, and there is no « typing » indicator (no aria-busy, aria-live, status or log).
- **T4-F8:** tests check the CSS module classes (`.locked`, `.avatar`/`.animated`, `.panel`/`.success`) instead of `data-*` attributes.
- **T4-F7:** no duplicate ids for 12 coach × mode × scheme combinations and 12 rank × mini combinations, two copies per page, every `url(#…)` resolved inside the same svg.
- **T4-F6:** reduced motion sets the delay to 0ms for every `.stagger >` delay rule, with cascade checked by specificity and source order.
- Group tests: 79/79 covering tests; web 73 files / 1123 tests; `svg-to-tsx.mjs --check` reports « à jour ». Mutation run: each mutant is caught by its intended test.

### Conflicts resolved
1. **Text conflict, `test/ui/sheet-motion.test.tsx`, test « ton succès distinct du ton par défaut »** (group 3 cherry-pick). Group 1 had switched the query from `region` to `group` (T4-F14) and kept the `data-tone` assertions. Group 3 kept `region` and replaced `data-tone` with checks on the `.panel` and `.success` classes plus `.success { --panel-tone: var(--success) }` (T4-F8). Resolution: query by `group` (group 1), assertions on the classes (group 3). Both fixes hold: the panel is not a landmark, and the test checks the real style hook.
2. **Semantic conflict, found by the tests (no textual conflict): test « avatar tu aux lecteurs d'écran »** (group 3, T4-F17). It looked up the avatar with `getByRole('img', { name: 'Le Scribe', hidden: true })`. Group 1 (T4-F16) made the bubble's avatar decorative, with no role and no name, so that lookup failed (1 failed / 204). Fixed in **2e30e34** (Refs #52): the test now checks that no `img` « Le Scribe » exists even among hidden elements, and that the svg sits under `aria-hidden="true"`. Mutation check: removing `decorative` from CoachBubble makes this test fail.
- `ui.module.css` (groups 1 and 2) and `SystemPanel.tsx` (groups 1 and 2) merged automatically. Their changes sit in separate places: `.visuallyHidden` vs the `.backdrop` z-index; role group, aria-hidden brackets and headingLevel vs the JSDoc.

### Final checks (HEAD 2e30e34)
- `pnpm lint`: `Checked 492 files in 618ms. No fixes applied.`
- `pnpm typecheck`: exit 0 (contracts, domain, server, web).
- `npx vitest run --project web apps/web/test/ui/`: 6 files, 205 passed (205).
- `npx vitest run --project web`: **73 files, 1142 passed**, no stderr.
- `npx vitest run --project contracts --project domain`: 22 files, 418 passed.
- `npx vitest run --project server`: 74 files passed. `test/infra/release.test.ts` timed out at 5000 ms on one test (the bash guards, synchronous `spawnSync` calls). Run alone it passes: 10 passed (10), 1.8 s.
- `pnpm test` (whole repo): 170 files, 2255 passed, 2 skipped, **1 failed: the same release.test.ts timeout**. That test lives in `apps/server`, which none of these commits touch. **It already fails at base 76122a3:** I checked out 76122a3 in this checkout and ran `pnpm test`, which gave 1 failed (the same « garde CI » test, timeout) / 2191 passed. The machine was heavily loaded by other jobs (ffmpeg, headless chrome; CPU at 50 % on average). It is an environment flake, not an integration regression, so I left that test alone (it is outside Task 4).
- `pnpm --filter @rune/web test:e2e sheet.spec.ts`: 2 passed (chromium 5.6 s, webkit 7.5 s).

### Not addressed
- **T4-F1 (inert background for Dialog):** the default was not flipped. The finding leaves the choice between (a) and (b) to the controller. Group 2 tried `inertOutside ?? true`: 11 tests failed in 5 files, and real regressions appeared (focus moved synchronously in onClose or onDeleted while the background is still inert, in PlacesPage l.56/68-76/153 and ProfilePage l.112). Recommendation: option (b), where each screen task passes `inertOutside`, or (a) with an explicit exception for PlacesPage, ProfilePage and MembersPage. The F3 z-index already blocks taps through the backdrop.
- **T4-F15 (partly):** the bubble animations stop after 2 cycles (about 9 to 11 s), which is still above the 5 s of WCAG 2.2.2. The large avatar (`animated={true}`) loops while the OS has no reduced-motion setting. Fully meeting it needs an in-app Animations toggle (a product decision) or loops under 5 s.

Worktrees `appsport-fix-T4-r1-g{1,2,3}` were removed and branches `fix/T4-r1-g{1,2,3}` deleted after integration.
