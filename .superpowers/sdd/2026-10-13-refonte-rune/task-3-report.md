# Task 3 report — Composants de base (issue #51)

Branch `socle`, main checkout `C:\Users\eliott.colin\appsport`. Base f664ed2 (a README commit 163df86 from another session landed on `socle` during the task; it touches only `README.md`).

## What I implemented

All in `apps/web/src/ui/`, tokens only (no literal colour; `base-styles.test.ts` still passes), exported from `index.ts`.

| Component | Signature (as the brief) | Notes |
|---|---|---|
| `Button` | `variant?: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `block?: boolean` | 52 px high, radius 14, Barlow 600 17. Secondary = 1.5 px accent outline on transparent, ghost = accent text, danger = danger outline. Disabled = opacity .45. `block` = width 100 %. Press: scale .98 in 150 ms on the single curve; hover tints only on `(hover: hover)`. |
| `Field` | existing props + `help?: string`, `error?: string \| null` | Label 14/600 above, control 52 px in **16 px** text, then the error (danger, alert-circle icon `aria-hidden`) then the help (13 px, muted). Both linked by `aria-describedby` (error first, as the mockup A03); `aria-invalid` on error; invalid border 1.5 px danger. Read-only input (birth date) gets the dashed look of A03. `hint` stays as the old name of `help` (every existing screen keeps working). |
| `ChoiceCard` | `{ type; name; value; checked; onChange(); title; description?; icon? }` + optional `disabled`, `describedBy` | A `<label>` holding a real `<input type=radio\|checkbox>` (transparent, laid over the whole card). Name = title (`aria-labelledby`), description = description + `describedBy` (`aria-describedby`). Selected: 2 px accent border, accent tint, filled accent mark with a **check** (radio = circle, checkbox = rounded square). The check pops in (220 ms spring) and only fades under reduced motion. Radius = `--radius-card` − 2 (16 px in Clair/Sombre, follows Carnet/Nuit). |
| `ChoiceGroup` | `{ legend; children }` | `<fieldset>` + `<legend>` (14/600). |
| `ChoiceList` | unchanged signature | Now an adapter: `ChoiceGroup` + one `ChoiceCard type="radio"` per option, passing `disabled` and `describedBy`, and calling `onChange` with the original typed value (numbers included). |
| `Chips` | `{ name; options; value; onChange(v); legend }` | Fieldset of real radios, each in its label (pill 44 px min, radius 999). Selected = accent fill + accent-text, weight 600, and a small **check badge** on the top-right corner (no width taken, so the 5 durations still fit on one 390 px row). Equal widths while labels fit (`flex: 1 1 0; min-width: max-content`), wrap otherwise. |
| `Switch` | `{ id; label; checked; onChange(v); help? }` | A native `<button type="button" role="switch" aria-checked>` (Space and Enter activate it natively), `id` on the button, named by its `<label for>` (tapping the label toggles too), described by the help. Track 50 × 30 inside a 52 × 44 target. Off: muted knob on the field-border track (≥ 4.3:1 in every theme); on: accent track, accent-text knob slid 20 px. |
| `SegmentedProgress` | `{ step; total }` | `total` segments (`data-segment`), the first `step` with `data-done`, all inside an `aria-hidden` bar; the visible text « Étape {step} sur {total} » carries the information. Done segments each show their own slice of one accent → accent-2 gradient spanning the whole bar (as B06), via `--segment-index` / `--segment-last` React style custom properties (CSSOM, CSP-safe). |
| `Badge` | `{ tone; children }` | Accent = outline (role « Admin »); success / muted / warning / danger = tint + 6 px dot. Success text is `color-mix(success 70 %, text)`: plain success green on its tint is 2.99:1 in Clair (computed), the mix gives 4.95:1. |
| `ListGroup` + `ListRow` | row: `{ icon?; label; value?; href?; onClick?; badge?; tone?: 'danger' }`; group: `{ title?; children }` | Group = card (`<ul>`, radius card, 1 px border, separators) under an optional overline `<h2>` (Chakra Petch 12, .18em, uppercase) naming a `<section>`. Row 56 px: icon box 36 px tinted, label 16/600, value 13 muted (ellipsis), badge, chevron. `href` → wouter `Link`, `onClick` → `<button>`, neither → info row (no chevron). Link/button named by the label only, described by value + badge (stable names for later tests). `tone="danger"`: danger colours and **no chevron** (C01 « Se déconnecter »; C02 button rows keep theirs). |
| `EmptyState` | `{ icon; title; text; action? }` | 48 px icon in an 80 px accent-tinted circle (`aria-hidden`), title (title font 17/700, a `<p>` so it never breaks the heading outline of the host page), one sentence, action below. |
| `PageHeader` | `{ title; back?: string \| (() => void) }` | 44 × 44 « Retour » (`aria-label="Retour"`, chevron-left): a link when `back` is a path, a button calling it when a function, nothing for top-level tabs; then the `<h1>` (24/700). |
| `Banner` | unchanged (`tone: 'info' \| 'warning' \| 'error'`) | Same roles (`alert` for error, `status` otherwise). Radius 14, tone icon (`aria-hidden`) + body. Info: accent 8 % tint, warning: warning-bg, error: danger 8 % tint + danger border. Text content unchanged (icons carry no text). |

`CheckGlyph` (the shared check, `data-check`, `aria-hidden`) lives in `ChoiceCard.tsx` and is reused by `Chips`.

### Contrast (all 5 renders)
Computed with the WCAG formula from the token values (scratch script, not committed) for every new pair: badge texts on their tints (lowest: danger in Clair 4.58), banner text and icons on their tints, selected card text/description on the accent tint (≥ 5.96), check on accent (≥ 5.26), chip selected text (≥ 5.26), switch knob on track (≥ 4.32), row and empty-state icons on their tints (≥ 4.04). All ≥ 4.5 for text and ≥ 3 for UI parts.

### Motion
Feedback transitions 150–220 ms on `cubic-bezier(.2,.8,.2,1)` (button press, card/chip colours, switch knob, check spring). `prefers-reduced-motion: reduce`: no press scale, no knob slide, the check only fades. No information is carried by motion alone.

## Tests and results

New file `apps/web/test/ui/components.test.tsx` (23 tests) — roles, names, descriptions and states; the size checks read the CSS module rule and check that the element carries that class (`cls()` throws if a class is missing, so nothing passes on `undefined`).

### TDD evidence

RED (before any implementation; the two ChoiceList tests are regression guards on the unchanged adapter behaviour and passed on the old code by design):

```
pnpm vitest run --project web apps/web/test/ui/components.test.tsx
     × bouton de type button par défaut, désactivable, 52 px de haut
     × block : pleine largeur
     × erreur reliée au champ par aria-describedby, avec l’aide, et champ marqué invalide
     × l’icône d’erreur est décorative : le texte annoncé reste la phrase seule
     × sans erreur : ni aria-invalid ni description d’erreur ; texte des champs en 16 px
     × carte cochée : un vrai bouton radio nommé par son titre, sous la légende du groupe
     × la description décrit le choix sans allonger son nom
     × choix multiple : case à cocher ; onChange au clic, sur la case comme sur la carte
     × sélection jamais par la couleur seule : la carte cochée porte une coche, pas les autres
     × radios sous une légende ; un clic change la valeur
     × chaque pastille est une cible d’au moins 44 px ; la pastille choisie porte une coche
     × role switch, nommé par son libellé, décrit par son aide, aria-checked suit l’état
     × vrai bouton : Espace et Entrée l’actionnent nativement ; cible d’au moins 44 px
     × « Étape 3 sur 9 », 9 segments dont 3 faits
     × affiche son texte, quel que soit le ton
     × ligne lien : nommée par son libellé, décrite par sa valeur et son badge, chevron décoratif
     × ligne bouton (onClick), ligne danger, ligne d’information sans action
     × titre, phrase et action ; l’icône est décorative
     × back="/profile" : lien « Retour » vers /profile, puis le titre de niveau 1
     × back fonction : bouton « Retour » qui l’appelle ; sans back, pas de Retour
     × erreur annoncée tout de suite (alert), le reste poliment (status) ; icône décorative
AssertionError: expected 44 to be 52 // Object.is equality
AssertionError: expected false to be true // Object.is equality
AssertionError: expected [ '12 caractères au moins.' ] to deeply equal [ '12 caractères au moins.', …(1) ]
AssertionError: expected undefined to be truthy
AssertionError: expected undefined to be '16px' // Object.is equality
(the other failures: « Element type is invalid … got: undefined », the components did not exist)
 Test Files  1 failed (1)
      Tests  21 failed | 2 passed (23)
```

(A first RED run had 19 failed / 4 passed: two decorative-icon assertions passed vacuously when no icon existed; I tightened them before implementing, and the second RED run above is the reference.)

A later design fix was test-first too: the assertion « la ligne danger n'a pas de chevron » failed (`expected SVGSVGElement{…} to be null`, 1 failed / 22 passed) before the one-line change in `ListRow`.

GREEN:

```
pnpm vitest run --project web apps/web/test/ui/components.test.tsx
      Tests  23 passed (23)
```

### Whole web suite (existing screens keep their roles and names)

The first full run showed 8 failures in `test/onboarding/steps.test.tsx`, `test/places/gym-picker.test.tsx` and `test/places/places-page.test.tsx`: they read option texts with `radio.closest('label')`, so the input must stay inside its label. I nested the overlay input in the label (states via `:has()`), without touching those tests:

```
pnpm --filter @rune/web test
 Test Files  71 passed (71)
      Tests  1033 passed (1033)
```
(baseline before the task: 70 files, 1010 tests; output pristine, only Vitest's usual happy-dom timing notice.)

### Final checks (on the committed code)

```
pnpm lint        Checked 468 files … No fixes applied.            (no error, no warning)
pnpm typecheck   contracts, domain, server, web: no error
pnpm test        Test Files 168 passed (168) ; Tests 2147 passed | 2 skipped (2149)
                 (the 2 skips are the existing conditional ones in server db/adapter and web local-db/frozen-v1)
pnpm --filter @rune/web test:e2e            16 passed (3.2m): all 8 specs on Chromium and WebKit
pnpm --filter @rune/web test:e2e arrival.spec.ts offline.spec.ts   4 passed (1.2m), re-run on the final code
```

The brief names no E2E spec; I ran the whole E2E suite because `ChoiceList`, `Button`, `Field` and `Banner` are on every screen, and the onboarding helper checks radios with `getByRole('radio', { name }).check()` (works on the overlay input in both engines). The last three changes (chip padding, danger-row chevron, choice-card radius) came after the full run, hence the re-run of the two onboarding/profile specs.

Commit: 06aaa56 `feat(web): boîte à outils de base (cartes de choix, pastilles, interrupteur, progression, listes, états vides)` (Closes #51). `git show --stat HEAD`: the 15 files listed below; `git status`: clean.

## Visual check

Scratch gallery (outside the repo, Vite dev server on a scratch config importing `apps/web/src/ui`), Playwright Chromium 390 × 844 in Clair, Sombre, Carnet and Salle de nuit, three pages (choices/chips/progress/buttons; header/fields/switches/lists; badges/banners/empty state/buttons/ChoiceList). No console error. Compared to B01, B06, C01, C02, A03, E01 and MixSombre/MixClair. Fixes made from it: chip side padding 12 → 6 px (the five durations wrapped to two rows, the mockup keeps one), danger row without chevron, choice-card radius following the theme. Screenshots not committed.

## Files changed

- Created: `apps/web/src/ui/ChoiceCard.tsx` (ChoiceCard, ChoiceGroup, CheckGlyph), `Chips.tsx`, `Switch.tsx`, `SegmentedProgress.tsx`, `Badge.tsx`, `ListRow.tsx` (ListGroup, ListRow), `EmptyState.tsx`, `PageHeader.tsx`, `apps/web/test/ui/components.test.tsx`.
- Modified: `apps/web/src/ui/Button.tsx`, `Field.tsx`, `Banner.tsx`, `ChoiceList.tsx`, `ui.module.css`, `index.ts`.

## Self-review

- Signatures as the brief. Two additions, both optional: `ChoiceCard.disabled` and `ChoiceCard.describedBy` (needed for `ChoiceList` to keep its disabled option and its explanation, SportStep), and `ListGroup.title` (the brief names `ListGroup` without props). `Field.error` keeps its existing `string | null`; `hint` kept as the old name of `help`.
- Real inputs everywhere: native radio/checkbox in `ChoiceCard` and `Chips`, native `<button role="switch">` for `Switch`. Selection never by colour alone (check on cards and chips, knob position on the switch).
- Targets: button 52, chip 44, switch 52 × 44, row 56, back 44 × 44, card ≥ 64.
- No hard-coded colour (`base-styles.test.ts` green), no `style="…"` in static HTML (only React style custom properties on segments), no `dangerouslySetInnerHTML`, straight apostrophes, no « appsport ».
- `Page.tsx` still renders its old « Retour » text link: Task 5 switches `Page` to `PageHeader` (its brief).

## Concerns

- Clair cards use the 1 px `--border` token instead of the mockup's soft shadow (no shadow token exists in `tokens.css`, which is not in this task's files). Carnet and Salle de nuit mockups use a border too, so the border is right for 4 of 5 renders; a `--card-shadow` token could be added by a task that owns `tokens.css`.
- Switch off-state knob is the muted text colour in every theme (the Clair mockup draws a white knob on #CED6E0, about 1.4:1); chosen for a visible state in all themes.
- Space/Enter on the switch come from the native `<button>`; happy-dom does not simulate keyboard activation, so the unit test asserts a native `type="button"` element and the click toggle. No E2E covers a switch yet (no screen uses it before Task 10/11).
- `review-package` range f664ed2..HEAD includes the README commit 163df86 made by another session during this task.

## Fix report — round 1 (integration of 3 parallel fix branches)

Base: socle at 06aaa56. Each branch was cherry-picked onto socle in order (`git cherry-pick 06aaa56..<branch>`). History is linear, with no merge commits.

| Group | Branch (head) | Commit on socle | Findings |
|---|---|---|---|
| 1 | fix/T3-r1-g1 (53ca668) | 58ff3e6 | T3-F7, T3-F6 |
| 2 | fix/T3-r1-g2 (80da42e) | 6a42929 | T3-F10, T3-F9, T3-F8, T3-F5 |
| 3 | fix/T3-r1-g3 (9fa295a) | 553beb0 | T3-F17, T3-F16, T3-F15, T3-F4, T3-F3, T3-F2 |

### Group 1: SegmentedProgress and ListRow
- T3-F7: `done = Number.isFinite(step) ? clamp(Math.round(step), 0, total) : 0`. The text prints the same value (« Étape {done} sur {total} ») and is the only accessible copy. Tests: the order of filled segments is checked (data-done equals [true,true,true,false x6]). New test for step 0 and step = total. New test for out-of-range and non-integer steps: 11 gives 9, -1 gives 0, 2.6 gives 3, NaN gives 0. In each case the text and the filled count must match. RED: « Unable to find an element with the text: Étape 9 sur 9 ».
- T3-F6: the href branch renders `<Link href onClick {...named}>`. wouter 3.13 calls onClick before it navigates and skips both on a modifier click or a non-left click. Test: the row inside a Router with memoryLocation, clicked; markSeen is called once and history is ['/profil', '/settings']. RED: « expected "vi.fn()" to be called 1 times, but got 0 times ».

### Group 2: ui.module.css (+ base-styles.test.ts)
- T3-F5: `.block` stays width 100%. New rule: `@media (min-width: 600px) { .block { width: auto; min-width: 240px } }`. The breakpoint is 600 px, not 900 px, because content is capped at 40rem. No current caller uses `block`.
- T3-F8: `.field input:read-only` becomes `.field input[readonly]`, with the same declarations.
- T3-F10: `.rowValue` drops the ellipsis, nowrap and overflow hidden, and gains `overflow-wrap: anywhere`.
- T3-F9: new `@media (forced-colors: active)` block. Track: 1px ButtonText border. Thumb: `forced-color-adjust: none` with a ButtonText background. Switch on: Highlight track and HighlightText thumb.
- Tests: 4 new tests in base-styles.test.ts. RED: 4 failed, 9 passed.

### Group 3: stronger tests (components.test.tsx) + `data-chevron` hook in ListRow.tsx
Each new test was checked against the mutant its finding describes: RED with the mutant, file restored afterwards.
- T3-F16: `data-chevron=""` added on the Chevron. The link row and the button row each have exactly one chevron. The danger row and the info row have none.
- T3-F15: the icon fixture is now `<svg role="img" aria-label="haltère">`. The new helper `expectIconSilenced()` is used in the EmptyState, ListRow and ChoiceCard tests. Removing aria-hidden from each wrapper fails its test.
- T3-F17: a disabled ChoiceCard with both a description and describedBy. Its accessible description must be « Poids du corps et haltères Ton objectif demande une salle. ».
- T3-F3: Chips onChange is called exactly once with '45'. With the stateful Rhythm, the coche shows only on « 45 min ». After a rerender with null, nothing is checked. The mutant (defaultChecked) fails both tests.
- T3-F2: the Switch follows rerenders (checked true, then false) without a click. A parent that ignores onChange keeps aria-checked 'false'. The mutant (internal useState) fails both tests.
- T3-F4: the test is renamed to what it proves (native button, type=button, no tabindex, 44 px), plus an assertion that there is no tabindex attribute. The Playwright keyboard check (Tab, Space, Enter) is deferred until a screen renders a Switch.

### Conflicts
None. Groups 1 and 3 both touch `ListRow.tsx` (Link + onClick vs data-chevron on the Chevron) and `components.test.tsx` (different describe blocks), and git merged them automatically. Afterwards, ListRow carries both changes: `<Link href={p.href} onClick={p.onClick} {...named}>` and `data-chevron=""`. The tests of both groups pass together. No integration commit was needed.

### Final checks (socle at 553beb0)
- `pnpm lint`: « Checked 468 files in 998ms. No fixes applied. »
- `pnpm typecheck`: `tsc --noEmit -p tsconfig.json` exit 0.
- `pnpm test` (full workspace): « Test Files 168 passed (168) », « Tests 2158 passed | 2 skipped (2160) », exit 0.
- Flakiness note: two earlier full runs each had one failure. The first was a 5000 ms timeout in `test/infra/release.test.ts` (« garde CI … »), which passed 10/10 when run alone. The second was another transient failure. The next two full runs were green. These tests are server/infra tests, outside this round's files (only apps/web/src/ui and apps/web/test/ui changed). The timeouts came from load: other worktrees were running suites at the same time.
- Fix worktrees appsport-fix-T3-r1-g{1,2,3} were removed, and branches fix/T3-r1-g{1,2,3} were deleted.

## Fix report — round 1, second integration (re-run fix branches)

The workflow handed over three fix branches for round 1 again, all built on 06aaa56. Socle was no longer at 06aaa56. It was at 7854d7d: the first integration of round 1 (58ff3e6, 6a42929, 553beb0, above) plus Task 4 (7854d7d). Each branch was cherry-picked onto 7854d7d (`git cherry-pick 06aaa56..<branch>`), giving linear history with no merge commits. Every branch conflicted with the matching commit already on socle. I resolved each conflict so that both versions of each fix keep working: socle's code and tests are kept, and the branch's genuine additions are layered on top.

| Group | Branch (head) | Result on socle | Findings |
|---|---|---|---|
| 1 | fix/T3-r1-g1 (1a2f71f) | nothing new, cherry-pick skipped (empty) | T3-F7, T3-F6 (already fixed by 58ff3e6) |
| 2 | fix/T3-r1-g2 (9c7e56f) | fa1f186 | T3-F10, T3-F9, T3-F8, T3-F5 (6a42929 + forced-colors padding) |
| 3 | fix/T3-r1-g3 (81c56fb) | 76122a3 | T3-F17, T3-F16, T3-F15, T3-F4, T3-F3, T3-F2 (553beb0 + stricter assertions) |

### Group 1: SegmentedProgress and ListRow (from its notes)
- T3-F7: `done = Math.min(Math.max(Math.round(p.step), 0), p.total)`. The text prints « Étape {done} sur {total} ». Tests: order of done segments, step 0 and step = total, and out-of-range steps (11 gives 9, -1 gives 0, 2.6 gives 3). RED: « Unable to find an element with the text: Étape 9 sur 9 ».
- T3-F6: the href branch passes `onClick={p.onClick}` to the wouter Link. Test: clicking a row with href="/settings" calls onClick once, and window.location.pathname becomes /settings. RED: « expected "vi.fn()" to be called 1 times, but got 0 times ».
- Branch result: covering tests 27/27, lint clean, typecheck clean, web suite 71 files and 1037 tests.

### Group 2: ui.module.css + base-styles.test.ts (from its notes)
- T3-F5: `.block` keeps 100% width; at min-width 600px it gets width auto and min-width 240px. T3-F8: `.field input[readonly]` replaces `:read-only`. T3-F10: `.rowValue` drops ellipsis, nowrap and overflow hidden, and gains `overflow-wrap: anywhere`. T3-F9: a forced-colors block with a 1px ButtonText border, a ButtonText thumb, and a Highlight track with a HighlightText thumb when on. Beyond the finding: `padding: 2px` on the track in forced-colors mode.
- RED: 4 failed and 9 passed, then a separate RED run for padding (« expected undefined to be '2px' »). GREEN: 13/13. Web suite: 71 files and 1037 tests. Lint and typecheck clean.

### Group 3: components.test.tsx + data-chevron (from its notes)
- T3-F16: data-chevron hook; the link row and the button row have exactly 1 aria-hidden chevron, the danger and info rows have 0. T3-F15: icon fixture with role img, plus expectIconSilenced(). T3-F17: a disabled ChoiceCard with description + describedBy. T3-F3: the Chips coche follows the parent; in the controlled case onChange is called once with '45', and nothing is checked after a rerender with null. T3-F2: the Switch follows rerenders without calling onChange, and a parent that refuses keeps aria-checked false. T3-F4: the test is renamed, has a no-tabindex assertion, and a comment on happy-dom and the planned E2E.
- RED: 2 failed and 25 passed (F16), plus one mutant run per finding, each failing its own test. GREEN: 27/27. Web suite: 71 files and 1037 tests. Lint and typecheck clean.

### Conflicts and how they were resolved
- **Group 1** conflicted in `SegmentedProgress.tsx`, `ListRow.tsx` (doc comment) and `components.test.tsx`. Socle's 58ff3e6 is a strict superset. Its code also maps NaN to 0 (`Number.isFinite` guard), which the branch drops: taking the branch would have turned socle's NaN test red. Its tests cover the same cases plus NaN, and the ListRow onClick test uses a memoryLocation router instead of changing window.location. I kept socle's side for all three files, the commit became empty, and I ran `git cherry-pick --skip`. Both fixes keep working as they are on socle.
- **Group 2** conflicted in `ui.module.css` (three comments, plus the forced-colors `.switchTrack`) and in `base-styles.test.ts` (the whole describe block). CSS: I kept socle's comments and added the branch's `padding: 2px` to `.switchTrack` under forced-colors. Check: the track is 50 × 30 px border-box with 3px padding. With a 1px border, 3px padding leaves 22px for the 24px thumb; 2px padding leaves 24px and keeps the 44px inner width, so the 20px travel is unchanged. Tests: I took the branch's describe block. It is a superset of socle's: exact 240px, `:read-only` absent from the whole file, readonly colour, no overflow or white-space on `.rowValue`, `.row` still 56px, padding 2px, and the HighlightText thumb still checked. Mutant check on the merged result: removing the padding gives « expected undefined to be '2px' » (1 failed, 12 passed), and the CSS was restored. The commit message was rewritten to describe only what is new.
- **Group 3** conflicted in `components.test.tsx` (10 hunks); `ListRow.tsx` auto-merged with no change, since data-chevron was already there. I kept socle's side for the fixture comments, both Chips hunks and both chevron hunks. I took the branch's side for the disabled ChoiceCard (title + `disabled` assertion), the two Switch tests (`onChange` never called on rerender, called exactly once on a refused click) and the F4 comment and title. One auto-merged hunk was broken: Rhythm used `options={minutes}`, but `minutes` exists only on the branch side, where socle names it `options`. I restored socle's inline options. Mutant check on the merged tests: a Switch with its own useState fails both Switch tests (2 failed, 28 passed), and Switch.tsx was restored. The commit message was rewritten to describe only what is new.
- No extra integration commit was needed. All checks are green after 76122a3.

### Final checks (socle at 76122a3)
- `pnpm exec vitest run --project web test/ui/base-styles.test.ts`: 13 passed (13).
- `pnpm exec vitest run --project web test/ui/components.test.tsx`: 30 passed (30).
- `pnpm lint`: « Checked 489 files in 328ms. No fixes applied. »
- `pnpm typecheck`: `tsc --noEmit -p tsconfig.json`, exit 0.
- `pnpm test` (full workspace): « Test Files 169 passed (169) », « Tests 2192 passed | 2 skipped (2194) », exit 0.
- Worktrees appsport-fix-T3-r1-g{1,2,3} were removed, and branches fix/T3-r1-g{1,2,3} were deleted.

## Fix report — round 1, third integration (re-run fix branches)

The workflow handed over three round-1 fix branches once more, all built on 06aaa56. Socle was at f70eba5: the first two integrations of round 1 (58ff3e6, 6a42929, 553beb0, fa1f186, 76122a3), Task 4 and its fixes, and Task 5. Each branch was cherry-picked in order (`git cherry-pick 06aaa56..<branch>`). History stays linear, with no merge commits. Socle already carried every source change for these 11 findings. For each branch I kept socle's code and tests and added only the branch's genuine extras on top.

| Group | Branch (head) | Result on socle | Findings |
|---|---|---|---|
| 1 | fix/T3-r1-g1 (95d204d + 063b0c0) | c7fca9d, d9eb726 | T3-F7, T3-F6 |
| 2 | fix/T3-r1-g2 (eda55ab) | ec386f9 | T3-F10, T3-F9, T3-F8, T3-F5 |
| 3 | fix/T3-r1-g3 (fdfb454) | nothing new: the cherry-pick was empty and was skipped | T3-F17, T3-F16, T3-F15, T3-F4, T3-F2 (already on socle through 553beb0 + 76122a3) |

### Group 1: SegmentedProgress and ListRow (from its notes)
- T3-F7: `total = max(round(total) || 0, 0)` and `step = min(max(round(step) || 0, 0), total)`. The bar, `--segment-last` and « Étape {step} sur {total} » all use these values.
  - Tests: the filled segments of step 3 are compared in order, and an it.each covers steps 0, 1, 9, 11, -1 and 2.6, each with its text and its first segments filled.
  - RED: 4 failed, 6 passed: « Unable to find an element with the text: Étape 9 sur 9 », « … Étape 0 sur 9 », and « … Étape 3 sur 9 » while the DOM showed « Étape 2.6 sur 9 ».
  - Mutant `data-done={i >= total - step}`: 3 failed.
- T3-F6: `<Link href onClick {...named}>`.
  - Test « ligne lien avec onClick », inside a memoryLocation router: markSeen is called once, the history is still ['/profile'] when it runs, the final history is ['/profile', '/settings'], and no button is rendered.
  - RED: « expected "vi.fn()" to be called 1 times, but got 0 times ».
  - Known limit: wouter skips its own handler on a modifier click or a non-left click, so such a click opens the link without running onClick.
- On the branch: components 30/30, web suite 71 files and 1040 tests, lint and typecheck clean.

### Group 2: ui.module.css + base-styles.test.ts (from its notes)
- T3-F5: `.block` at min-width 600px gets width auto, min-width 240px and max-width 420px. Chromium at 1024 px: a block button in `.page` is 608 px wide without the cap and 420 px with it; on phone it is 358 px.
- T3-F8: `input[readonly]` replaces `:read-only`.
- T3-F10: `.rowValue` wraps (`overflow-wrap: anywhere`). At 390 px a long value takes 2 lines and the row grows to 71 px; at 200 % zoom, 4 lines and 105 px.
- T3-F9: forced-colors block. The track gets padding 2px and a ButtonText border, the thumb a ButtonText background; when on, a Highlight track and a HighlightText thumb.
- RED: 4 failed, 9 passed. GREEN: 13/13. Mutants: removing max-width gives « expected undefined to be '420px' »; padding back to 3px gives « expected '3px' to be '2px' ». Web suite: 71 files and 1037 tests.

### Group 3: components.test.tsx + data-chevron (from its notes)
- T3-F16: data-chevron hook and exact chevron counts per row.
- T3-F15: icon fixture with role img, plus expectIconSilenced().
- T3-F17: disabled ChoiceCard with both a description and describedBy.
- T3-F2: the Switch follows rerenders without calling onChange, and a parent that refuses the change keeps aria-checked false.
- T3-F4: renamed test with a no-tabindex assertion. The Playwright keyboard check is deferred: no screen renders the ui Switch yet, and user-event is not installed.
- RED: 2 failed, 24 passed (the chevron tests). GREEN: 26/26. Nine mutants, each failing only its own test.
- Web suite: 71 files and 1036 tests. One profile-page focus test failed on the first full run under load from other worktrees; it was green alone and on the re-run.

### Conflicts and how they were resolved

#### Group 1, commit 95d204d → c7fca9d
Conflicts in `SegmentedProgress.tsx`, in `ListRow.tsx` (doc comment only) and in `components.test.tsx` (4 hunks).
- `SegmentedProgress.tsx`: I merged both versions.
  - Socle's `Number.isFinite` guard on step stays. NaN and ±Infinity give 0, whereas the branch's `|| 0` would turn an infinite step into total.
  - The branch's normalised total stays, with the same `Number.isFinite` guard: on the branch, an infinite total still throws « RangeError: Invalid array length » in Array.from.
  - The bar, `--segment-last` and the text use `total` and `done`. The doc comment describes both rules.
- `ListRow.tsx`: socle's side. The code is identical (`<Link href onClick {...named}>`); only the comment wording differed.
- `components.test.tsx`:
  - From the branch: the ordered `filled()`/`firsts()` helpers and the it.each, to which I added socle's NaN case.
  - Dropped: socle's two older tests (step 0 / step = total, and the out-of-range loop), since the it.each now covers both.
  - ListRow test: the branch's version ('/profile', no button rendered).
  - Integration addition: the branch normalised total without a test, so I added an it.each over total 9.4, 2.6, -2, NaN and Infinity, all with step 3.
- TDD for the added total cases:
  - RED against socle's SegmentedProgress (`git checkout --ours`), command `pnpm exec vitest run --project web apps/web/test/ui/components.test.tsx -t "SegmentedProgress"`: « Tests 5 failed | 8 passed | 27 skipped (40) ». Failures: « Unable to find an element with the text: Étape 3 sur 9 » (9.4), « … Étape 3 sur 3 » (2.6), « … Étape 0 sur 0 » (-2 and NaN), « RangeError: Invalid array length » (Infinity).
  - GREEN with the merged component: 40/40.
  - Mutants on the merged result (file restored after each): printing `p.total` in the text gives 5 failed; the branch's total without `Number.isFinite` gives 1 failed (Infinity, « RangeError: Invalid array length »).
- The commit message was rewritten to describe only what is new on socle.

#### Group 1, commit 063b0c0 → d9eb726
The seenFrom assertion applied without conflict. Ordering mutant: onClick moved from the Link to the `<li>`, so it bubbles after the Link has navigated. Only this test fails: « expected [ [ '/profile', '/settings' ] ] to deeply equal [ [ '/profile' ] ] ». The file was restored.

#### Group 2, eda55ab → ec386f9
Conflicts in `ui.module.css` (the max-width line and its comment, and the forced-colors comment) and in `base-styles.test.ts` (the max-width assertion).
- CSS: I kept socle's file and added the branch's `max-width: 420px` with its comment. I also took its 3-line forced-colors comment, which explains the 2px padding that socle's one-line comment did not.
- Test: the branch's assertion is added, and the test title now says « de 240 à 420 px ».
- RED against socle's CSS: « expected undefined to be '420px' » (1 failed, 12 passed). GREEN: `apps/web/test/ui`, 6 files and 215 tests.
- The cap changes nothing visible on socle today. The only `block` user is BottomSheet's built-in « Fermer » button in `.sheetActions`. From 600 px up, the sheet is 28rem wide with 24px padding (about 400 px inside) and `.sheetActions > *` sets width auto, so the cap never applies; on phone the media query is off.
- The first commit picked up a stale message file left by an earlier run in the shared scratchpad. I amended the message only (ec386f9); the content is unchanged.

#### Group 3, fdfb454 (skipped)
`ListRow.tsx` and `components.test.tsx` auto-merged into a tree equal to HEAD, so I ran `git cherry-pick --skip`. Checked on HEAD: expectIconSilenced (its definition and 3 uses), the disabled ChoiceCard test, both Switch tests, the renamed F4 test with its tabindex assertion, the data-chevron counts, and the hook in `ListRow.tsx`.

No extra integration commit was needed. All checks are green after ec386f9.

### Final checks (socle at ec386f9)
- `pnpm lint`: « Checked 500 files in 572ms. No fixes applied. », exit 0.
- `pnpm typecheck`: `tsc --noEmit -p tsconfig.json` for contracts, domain, server and web, exit 0.
- `pnpm test` (full workspace): « Test Files 171 passed (171) », « Tests 2332 passed | 2 skipped (2334) », exit 0. The output holds only the summary and Vitest's transform-timing notices.
- Worktrees appsport-fix-T3-r1-g{1,2,3} were removed with `git worktree remove --force`. Their folders still held ignored node_modules, which I deleted with `rmdir /s /q` (it does not follow pnpm's junctions). Branches fix/T3-r1-g{1,2,3} were deleted (they were 063b0c0, eda55ab and fdfb454).
