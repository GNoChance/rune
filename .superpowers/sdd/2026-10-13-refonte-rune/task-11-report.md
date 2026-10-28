# Task 11 report: Salles et lieux (issue #59)

- Worktree: `C:\Users\eliott.colin\rune-ecrans`, branch `socle-ecrans`
- Commit: `795f02d` feat(web): salles et lieux Rune, équipement en brouillon et fiche directe (one commit on top of `35d89f5`, body ends with `Closes #59` and the Co-Authored-By trailer)
- Review package: `/c/Users/eliott.colin/rune-ecrans/.superpowers/sdd/2026-10-13-refonte-rune/review-35d89f5..795f02d.diff`
- Status: DONE_WITH_CONCERNS (three files outside the brief's list were touched, see Concerns)

## What I implemented

### Contracts
- `packages/contracts/src/equipment-short-labels.ts`: `EQUIPMENT_SHORT_LABELS: Record<EquipmentCode, string>`, written out by hand, so the compiler checks it covers every code. Each label stops at the parenthesis, except « Barre guidée (Smith) », which stays whole. It is exported from `index.ts`.

### Web, `apps/web/src/features/places/`
- **`PlacesPage.tsx` (D01).** The title is « Salles » (the tab's name and the mockup's h1).
  - « Mes lieux » shows a count (« 2 lieux ») and one card per place, main place first. Each card is a single link, named by the place and described by its line (« Salle · Lyon », « Principal » badge).
  - **Touching a gym goes straight to `/gyms/:gymId`** (ruling); a home goes to `/places/:id`.
  - A gym card also shows « N équipements ». When online, it adds the visible members (initials, « N membres visibles ») from `gyms.detail`. Offline it shows nothing extra: no made-up data.
  - Below the cards: the note « Ton lieu principal : … », then « Ajouter un lieu » with two tiles (salle, maison) that open on-page sub-screens. Focus goes to the sub-screen's h1 and returns to the tile afterwards.
  - Last section, « Dernières modifications »: the main gym's 3 latest entries as a timeline, with « Voir la salle ». It appears only when that history can be read online.
- **`GymPage.tsx` (D02).**
  - Header: Retour, the name, and a pencil button « Modifier le nom ou la ville » that opens a bottom sheet « Modifier la salle ». Focus goes to the name field; only the changed fields are sent (R-SAL-5); after saving, the gym is re-read and focus returns to the pencil.
  - Two tags: « Salle · Lyon » and « Partagée avec le cercle ».
  - **« Qui va à cette salle » card**: initials, then the sentence « max et toi » / « max, nora et sam », with the **user's own « Visible » switch** (same API and semantics as before: PATCH `visibleAtGym`). The switch shows the choice until the mirror is re-read; a failure resets it and shows the error; the member list is re-read after the change. Minors get the default-off hint as the switch's description.
  - « Matériel » card: a count badge, « Modifier le matériel » (only when editable and online), and chips by category.
  - « Dernières modifications » as a timeline, keeping « modifié par <pseudo> » (R-SAL-6) and showing « un membre » when there is no pseudo.
  - **The place's actions sit at the bottom** (`PlaceActions`) when the gym is one of the user's places.
  - Offline, deleted and rights cases are kept exactly as before.
- **`PlaceDetail.tsx` (D05).**
  - A home place shows a subtitle (« Maison · N équipements »), the Matériel card with chips, empty categories grouped under a dashed line, then `PlaceActions`.
  - A gym place's old address is now `<Redirect replace>` to `/gyms/:gymId`. The direct sheet makes the intermediate screen useless, and App.tsx stays untouched.
- **`PlaceActions.tsx`.**
  - The list card holds « Nom du lieu » (homes only; ListRow → bottom sheet « Renommer le lieu », 30 characters max, focus in the field) and the « Lieu principal » switch.
  - **The switch is `disabled` and checked on the current main place**, with the help text « Pour en changer, active-le sur un autre lieu. ». Elsewhere it reads « Actuel : <principal> » and sends PATCH `{ isPrimary: true }`.
  - Then the note, and the « Zone sensible » section with « Supprimer ce lieu ». The button is disabled on the last place, with the reason; the existing `DeletePlaceDialog` still asks for the new main place. After a delete the app returns to `/places`.
- **`EquipmentDraft.tsx`.**
  - `useEquipmentDraft(initial, send)` returns `{ selected, toggle, changes: { added, removed }, reset, save }`.
  - `changeSummary` builds the text, e.g. « 2 changements · 1 ajout, 1 retrait », and leaves out a part that is zero.
  - `DraftBar` is the region « Changements à enregistrer » with « Annuler » and « Enregistrer ». It is sticky above the floating tab bar (16 px on desktop), `z-index` 10, and only appears when there is at least one change.
- **`EquipmentEditor.tsx` (D03).** The « Matériel » sub-screen: subtitle with the place's name; for a gym, the note « Fiche partagée avec le cercle : chaque changement apparaît dans son historique. »
  - Collapsible categories: a button with `aria-expanded`/`aria-controls`, the « n/total » count read as « n sur total », and a violet dot with the hidden text « changement non enregistré » when a change is pending. The first category starts open.
  - Each chip is a real checkbox with a short label. A changed chip gets a violet ring and an `aria-describedby` pointing to « changement non enregistré ».
  - « Enregistrer » sends the draft, then **always re-reads the state** (gyms: `GymPage.load`; homes: each send already pulls into the mirror the screen watches). On success the screen closes on the updated sheet; on failure the draft stays, the error shows in the bar, and the count is recomputed against the re-read state.
- **`EquipmentChips.tsx`.** Read-only chips per category in a row that scrolls sideways under a fade (the row is reachable by keyboard), the count, and the empty categories. Also exports `Count` and `categoriesFor`.
- **`GymHistory.tsx`.** `actionText` (short labels) and the timeline: one coloured mark per action (green add, red remove, violet creation, accent edit), the action, then « modifié par … · <time datetime> ».
- **`GymMembers.tsx`.** `membersText`, `membersOrder`, and the initial avatars (one tint per pseudo, decorative).
- **`SubScreen.tsx`.** `SubScreen` (Page with a Retour callback, enters from the right, scrolls to the top, focuses its title) and `useSubScreen` (returns focus to the opening button; the page comes back from the left).
- **`HomeCreate.tsx`.** Moved out of PlacesPage. Same behaviour; the Retour button replaces « Annuler ».
- **`GymPicker.tsx` (D04).** The accessible names are unchanged, so the onboarding tests keep working.
  - Magnifier and « Effacer la recherche » in the field (44 px; it refocuses the field).
  - Results are choice cards with a gym icon. A gym already among the user's places is disabled, with the description « Déjà dans tes lieux » (R-LIEU-2).
  - The D04 warning « Ta salle existe peut-être déjà : … » appears only when the search finds a gym the user can pick.
  - The visibility control stays a real checkbox, drawn as a switch: it is a form choice applied on « Valider ». In forced colours it falls back to the native checkbox.
  - Full-width buttons.
- **`GymCreate.tsx`, `EquipmentChecklist.tsx`.** Full-width buttons; the similar-gyms intro is styled as a warning. `EquipmentList` and the now-unused `disabled` prop were removed; the onboarding never used either. Creation flows keep full labels.
- **`places.module.css`.**
  - Tokens only (5 themes), tints via `color-mix`, 44 px targets.
  - One curve with motion.css durations: screens 380 ms, gesture feedback 200 ms. The chip's check pops, cards cascade (`stagger`).
  - `prefers-reduced-motion` turns everything into fades.
  - `.editorPanel[hidden]` is restored to `display:none`.

### Outside `features/places` (see Concerns)
- `apps/web/src/ui/Switch.tsx` + `ui.module.css`: new optional `disabled` prop (the real `disabled` attribute, opacity .45, not-allowed cursor). It is needed for the locked « Lieu principal » switch and for the pending state of « Visible ».
- `apps/web/test/app/shell.test.tsx`: `/places` heading « Lieux » → « Salles » (text changed). The stack test that went /places → /places/p-1 → « Voir la salle » now goes /places → Garage → /gyms/g-1, because that intermediate screen no longer exists. Same assertions on 'forward'/'back' and the stack.
- `apps/web/e2e/sheet.spec.ts`: rewritten (see E2E).

## Brief requirements → tests (`apps/web/test/places/draft.test.tsx`)
| Brief | Test |
|---|---|
| check then uncheck the same item → 0 changes, no call | « cocher puis décocher le même équipement : 0 changement, aucun appel » |
| 1 add + 1 remove → bar text, « Enregistrer » sends exactly those two calls | « 1 ajout et 1 retrait : … » (writes = PUT kettlebell, DELETE flat_bench; gym re-read; sheet shows the server state) |
| « Annuler » resets (ruling) | « « Annuler » remet le brouillon à l'état du serveur, sans appel » |
| leaving the sheet without saving → no call, server state shown on return | « quitter la fiche sans enregistrer … » (Retour from Matériel, then leave through the Salles tab and come back through the card) |
| network failure keeps the draft and shows the error | « échec réseau à l'enregistrement : le brouillon reste, l'erreur s'affiche, la fiche est relue » |
| partial success (ruling) | « réussite partielle : … » (PUT passes, DELETE 500: error, then « 1 changement · 1 retrait » once re-read) |
| home too | « maison : le brouillon part d'un coup sur les routes du lieu » |
| touching a gym opens its sheet directly | « toucher une salle dans « Mes lieux » ouvre directement sa fiche » (+ redirect from the old address) |
| « Lieu principal » disabled and checked on the main place | « l'interrupteur « Lieu principal » est désactivé et coché … » (+ actions after history, danger zone last) and « … sur un autre lieu : actif, décoché ; PATCH » |
| « Qui va à cette salle » carries the visibility switch | « la case « Qui va à cette salle » porte l'interrupteur … » (PATCH visibleAtGym:false, then gym re-read) |

Plus `packages/contracts/test/equipment-short-labels.test.ts` (every code, rule up to the parenthesis, Smith kept whole, exported by the package). The updated `places-page`, `gym-page`, `gym-picker` and shell tests cover D01, D05, D02 (rename sheet, delete with new main place, last place, offline, minor, focus returns, accordion) and D04 (clear search, owned gym, warning).

## TDD evidence
RED was run separately, before any implementation:
```
$ pnpm --filter @rune/contracts test equipment-short-labels
 FAIL  |contracts| test/equipment-short-labels.test.ts
Error: Cannot find module '../src/equipment-short-labels' imported from …/packages/contracts/test/equipment-short-labels.test.ts
 Test Files  1 failed (1)
      Tests  no tests

$ pnpm --filter @rune/web test test/places test/app/shell
 FAIL  |web| test/places/gym-page.test.tsx
Error: Failed to resolve import "../../src/features/places/GymHistory" from "test/places/gym-page.test.tsx". Does the file exist?
 FAIL  |web| test/app/shell.test.tsx > coquille > /places : la liste des lieux, onglet « Salles »
 FAIL  |web| test/places/draft.test.tsx > matériel en brouillon (spec refonte §10.3) > cocher puis décocher le même équipement : 0 changement, aucun appel
 … (34 failures: all of draft.test.tsx, the D01/D05 tests, the two new GymPicker tests, 3 shell tests)
 Test Files  5 failed (5)
      Tests  34 failed | 105 passed (139)
```
GREEN:
```
$ pnpm --filter @rune/contracts test equipment-short-labels
 Test Files  1 passed (1)
      Tests  3 passed (3)
$ pnpm --filter @rune/web test test/places test/app/shell
 Test Files  5 passed (5)
      Tests  166 passed (166)
```
One test was corrected during GREEN: the rename test must wait (`until`) for the sheet's passive focus return after an async save, as the gym-sheet test already did. The « Ta salle existe peut-être déjà » test was added after a small tweak (the note is hidden when the only match is the user's own gym), so it was never red.

## Full checks (final state, commit 795f02d)
- `pnpm lint`: `Checked 536 files … No fixes applied.` (0 errors, 0 warnings)
- `pnpm typecheck`: exit 0
- `pnpm test`: `Test Files 184 passed (184)`, `Tests 2496 passed | 2 skipped (2498)`. Output is clean (only vitest's own transform-cache hints).
- E2E `pnpm --filter @rune/web test:e2e sheet` (Chromium Pixel 7 + WebKit iPhone 14): `4 passed (27.7s)`. The log holds no invitation code.

## E2E
`sheet.spec.ts` tested « bottom sheet over choice cards » on the old Lieux page, where an add form and the inline delete buttons shared the screen. The redesign removes that layout: delete lives on the place's sheet, add forms are sub-screens. Two tests replace it:
1. **Bottom sheet above the tab bar.** On the Garage sheet, « Supprimer ce lieu » opens the sheet. The test first checks that the floating tab bar (`z-index` 50) lies under the sheet's bottom action « Supprimer », then checks that `elementFromPoint` at its centre belongs to the dialog. A real click then deletes the place and returns to « Salles ».
2. **Change bar above the chips.** In the Matériel screen with every category open, the test checks a chip, scrolls until a chip input (`z-index` 1) is under the bar's « Annuler », runs the hit test, then a real click resets the draft.

Mutation check: removing the bar's `z-index` makes test 2 fail (« le centre de « Annuler » appartient à la barre »). It was restored at once.

The setup now sets `coach: 'ombre'`. Since T6, `POST /api/me/onboarding/complete` returns 400 without a coach, so this spec was already red at `35d89f5`.

## Self-review
- **Rulings applied.**
  - Draft: nothing is sent before Enregistrer; leaving drops the draft; Annuler resets.
  - Save sends exactly the adds, then the removes (taxonomy order, sequential, stops at the first failure).
  - Failures keep the draft, show the error and always re-read. Offline, the gym re-read falls back to the mirror. The editor stays open (its mount does not depend on the re-read `canEdit`/`offline`), so the draft is not lost.
  - EQUIPMENT_SHORT_LABELS is exhaustive by type.
  - Direct sheet; the « Visible » switch sits in « Qui va à cette salle »; actions at the bottom; « Lieu principal » disabled and checked.
- **Texts.** Straight apostrophes in every app text, tutoiement, no « appsport ». The spec text « modifié par <pseudo> » (R-SAL-6) and « Ma salle n'est pas dans la liste » (R-SAL-1) are kept over the mockup variants.
- **Accessibility.**
  - Existing accessible names kept where other lanes depend on them (GymPicker radios, the « Apparaître dans … » checkbox).
  - Cards are a single link with name and description; touch targets are 44 px or more; sub-screens and sheets return focus.
  - Counts are readable (« 2 sur 6 »); unsaved changes are announced; no information is carried by motion alone.
- **Visual check.** Throwaway Playwright captures at 390×844, light and dark, of D01–D05 and the name sheet, compared with the mockups. Removed afterwards and never committed: the temporary spec is deleted, the PNGs stay in the session scratchpad.
- **YAGNI.** Removed `EquipmentList`, `EquipmentChecklist.disabled`, `historyLine`, `VISIBLE_HINT`.

## Concerns
1. **Files outside the brief's list.**
   - `apps/web/src/ui/Switch.tsx` + `ui.module.css`: additive `disabled` prop. The required `disabled` « Lieu principal » switch cannot be built otherwise without re-creating the component. Possible small merge with other lanes if they touch Switch.
   - `apps/web/test/app/shell.test.tsx`: text change, plus the stack test re-routed off the removed screen.
   - `apps/web/e2e/sheet.spec.ts`: rewritten for the new screens; also needed `coach` in its setup.
   - `packages/contracts/test/equipment-short-labels.test.ts`: new test for the new contracts file.
2. **`useEquipmentDraft` signature.** It takes a second argument, `send(code, present)`. The brief's `useEquipmentDraft(initial)` has no way to know which endpoint (gym or home) `save()` targets.
3. **Sub-screens have no URL.** Matériel, Ajouter une salle and Ajouter une maison are on-page modes because App.tsx is not in the file list. The phone's back gesture leaves the whole sheet; per the ruling, that sends nothing and drops the draft. If the owner wants URLs, `/gyms/:id/materiel` and friends need App.tsx routes.
4. **`epoch.spec.ts` (not mine)** still completes onboarding without a coach. Under P7 it stays red until T7 fixes the E2E helpers.
5. **Extra requests on Salles.** The list page calls `GET /api/gyms/:id` once per gym place to show members and history. Offline or on error, nothing is shown.
6. **Brief flash after deleting a home.** Between the mirror re-read and the redirect to /places, the page may show « Lieu introuvable. » for one frame.

## Fix report — round 1, integration (groups 1 to 3)

Integrated into `socle-ecrans` (C:\Users\eliott.colin\rune-ecrans) from base 795f02d, with `git cherry-pick 795f02d..<branch>` for each branch in order. History is linear, with no merge commit. Two cherry-picks had conflicts, resolved inside the picked commits (details below). One small integration commit (b1bb6ef) brings the parallel tests in line with T11-F26.

| Group | Branch (head) | Commits on socle-ecrans | Findings |
|---|---|---|---|
| 1 | fix/T11-r1-g1 (2a83df9) | 45534e8 | T11-F23, F22, F21, F6, F4, F3, F2, F9, F8 |
| 2 | fix/T11-r1-g2 (d25960b) | 0136db8 (conflict resolved), 283d8ca, 7e88289 | T11-F27, F26, F7, F24, F10, F28 |
| 3 | fix/T11-r1-g3 (9cf8fcd) | 2770398 (conflicts resolved), 5d453f1 | T11-F15, F1, F14, F5, F29, F16, F18, F12 |
| integration | — | b1bb6ef | keeps T11-F26 true for the tests groups 1 and 3 added |

### Group 1 (from its notes)
- **`places.module.css`.**
  - F23: `.timelineItem:last-child { padding-bottom: 0 }`.
  - F22: the pop runs only on `.toggleChip[data-pop] .toggleChipGlyph`; `animation: none` under reduced motion.
  - F21: card shadows from `color-mix(in srgb, var(--text) 6%/5%, transparent)`; `box-shadow: none` in sombre, nuit, carnet and Auto-dark.
  - F6: `.draftBar` border `color-mix(in srgb, var(--accent) 22%, var(--border))`, lift `0 -8px 28px color-mix(in srgb, var(--bg) 90%, transparent)`; the drop shadow (tokens) only in the light themes.
  - F4: `:global(:root):has(.draftBar)` gets `scroll-padding-bottom: calc(94px + safe-area + var(--draft-bar-height, 120px) + var(--space-3))`, with a 900 px variant; it beats the shell's `html:has(.tabBar)`.
- **F22, `EquipmentEditor.tsx`.** A transient `data-pop` on the chip the user ticks, cleared on animationend or when the category collapses mid-animation. Untick, Annuler and re-reads never set it.
- **F4, `EquipmentDraft.tsx`.** While shown, the bar writes its measured height (ResizeObserver) into `--draft-bar-height` on the root. WebKit fallback on focusin: a control whose centre is under the bar is scrolled with `scrollIntoView({block:'nearest'})`.
- **F3.** `Switch.tsx` takes an optional screen-reader-only `labelSuffix`; GymPage's accessible name is « Visible dans « Qui va à cette salle » » (D02).
- **F2.** `SubScreen` ignores Retour while something is pending: EquipmentEditor passes `busy={save.pending}`; HomeCreate, GymPicker and GymCreate report through `useSubScreenBusy` (no-op outside a SubScreen, onboarding unchanged). Pending is recorded during render. `useSubScreen().close` is tied to its visit, so a late close does nothing.
- **F9.** `PlaceDetail` passes `reread={() => sync.pullNow()}`.
- **F8.** Test only (two gyms, p-3 on g-2: switch, PATCH, « Lieu principal », delete dialog and DELETE all target p-3).
- **Tests from the group.** New `places-styles.test.ts`; new cases in `draft.test.tsx`, `places-page.test.tsx`, `gym-page.test.tsx`; new E2E 2.4.11 test in `sheet.spec.ts`. RED: 6 CSS tests and 15 component tests failed for the intended reasons; F8, F9 and the E2E test proved by mutation. GREEN on its branch: places 104 tests, full suite 2514 passed and 2 skipped (3 runs), E2E sheet 6 passed.

### Group 2 (from its notes)
- **T11-F27.** `sent()` helper; the « Lieu principal » test asserts PATCH `/api/places/p-2` = `[{isPrimary:true}]` and nothing on p-1. RED by mutant (PATCH to p-1).
- **T11-F26.** `summary()` returns the exact text of the bar's paragraph; every summary check in draft.test.tsx is an exact match; a unit test of `changeSummary` (1/0, 0/1, 2/1, 0/2); the E2E uses `bar.locator('p')` + `toHaveText`. RED by mutant (« 0 retrait » always printed).
- **T11-F7.** The « quitter la fiche » test checks each click, reopens Matériel (unchecked, no bar), changes the server while away (`server.add('box')`) and checks the re-read on return. RED by two mutants (draft surviving unmount, per-gym cache).
- **T11-F28.** The offline places test waits for the gym read attempt, then checks the card came from the mirror. RED by mutant (delayed read).
- **T11-F24.** New `WarningIcon` (D04 path, 20 px, aria-hidden) before the text of GymPicker's `.warningNote` and inside GymCreate's `.similarIntro`; CSS colour `var(--warning-text)`. True RED (no svg), then GREEN 26/26.
- **T11-F10.** `sheet.spec.ts` setup is identical to 3d69225 (coach 'skald'), except the import line, which needs `Locator`.
- **Tests from the group.** Web 1286 passed on its branch, E2E sheet 4 passed.
- **Ledger item it raised for the controller:** record the Switch `disabled` prop (Switch.tsx and ui.module.css) and the shell.test.tsx re-route as accepted extras of T11.

### Group 3 (from its notes)
- **T11-F1.** The draft keeps only the user's toggles (code → add or remove). `selected` = initial with those toggles; `changes` = toggles not yet satisfied; on re-read, satisfied toggles are dropped and nothing is added. RED: a member's barbell removal came back as the user's add (« 2 changements · 1 ajout, 1 retrait »).
- **T11-F15.** A chip toggle goes through `toggleCode` (save.reset() then draft.toggle()), so a past error never shows for changes never tried.
- **T11-F16.** « Annuler » moves focus to the first category toggle; the summary line has `role="status"`.
- **T11-F29.** Test only: the chip's description and the « Petit matériel » button name carry « changement non enregistré », both gone after unchecking (mutation-checked).
- **T11-F14.** Delete navigates with `{ replace: true, state: PLACE_DELETED_STATE }`, so Back stays on Salles.
- **T11-F5.** PlacesPage reads `history.state` on mount; « Mes lieux » (tabIndex -1) takes focus once, then the state is cleared. New `place-delete.test.tsx` renders `<App/>` under jsdom browser history.
- **T11-F18.** Gym card link `aria-describedby="metaId footId"`.
- **T11-F12.** `PLACES_ACTIVITY_LIMIT` 3 → 2.
- **Tests from the group.** RED then GREEN per finding; web 1289 passed on its branch; draft, place-delete and places-page 38/38 on 4 more runs; E2E sheet 4 passed.

### Conflicts resolved
1. **`apps/web/test/places/draft.test.tsx`, imports (G1 against G2, in 0136db8).** G1 imported `act`, `renderHook`, `afterEach`, `vi` (and `useSubScreen`); G2 imported `changeSummary`. I kept the union of both import lists. The rest of the file merged by itself: G1's home-save rewrite (waits for the « Garage » heading) kept, G2's `summary()` and `sent()` helpers and exact checks kept.
2. **`apps/web/src/features/places/EquipmentEditor.tsx`, the chip's `onChange` (G1 F22 against G3 F15, in 2770398).** G1 called `p.draft.toggle(code)` then set the transient pop; G3 routed the toggle through `p.onChange(code)` (= `toggleCode`: `save.reset()` + `draft.toggle()`). Merged as:
   ```tsx
   onChange={() => {
     p.onChange(code);
     setPopping((current) => (checked ? (current === code ? null : current) : code));
   }}
   ```
   So a toggle both clears a past error (F15) and pops only on a user tick (F22).
3. **`draft.test.tsx`, « cocher puis décocher » (G2 F26 against G3 F29, in 2770398).** Kept G2's exact `expect(summary()).toBe('1 changement · 1 ajout')` and added G3's two F29 assertions (chip description, category button name) after it.
4. **`draft.test.tsx`, after « réussite partielle » (G1 against G3, in 2770398).** Kept G3's two new tests (« un autre membre change la salle … », « une erreur passée ne revient pas … »), then G1's version of the home test (title « … puis la fiche montre le matériel relu », plain `createFakeApi()` because `serveHome` now serves the routes), instead of G3's copy of the old title with inline `.on(...)` routes.
- **Integration commit b1bb6ef (keeps T11-F26 true after the merge).** G1 and G3 wrote new summary checks in parallel with G2, still as substrings. They now compare the full text: in draft.test.tsx the « Annuler » status (`toBe`), the two « autre membre » checks, the « erreur passée » check and the home failure `until(() => summary() === …)`; in `sheet.spec.ts` the 2.4.11 test waits on `bar.locator('p')` with `toHaveText('1 changement · 1 ajout')`. Mutation check (« 0 retrait » always printed): 6 draft tests failed, including the newly tightened lines 213 and 367; reverted, `git diff` clean.
- **T11-F10 still holds after integration.** `git merge-tree --write-tree 3d69225 HEAD` exit 0; lines 1–44 of `sheet.spec.ts` differ from 3d69225 only by the `Locator` import. `git merge-tree --write-tree e18a259 HEAD` (current socle) also exit 0.
- **Test count check.** `it(` in `apps/web/test/places`: 80 at base, +18 (G1), +1 (G2), +4 (G3) = 103 at HEAD; all present.

### Final command outputs (integrated HEAD b1bb6ef)
- `pnpm lint`: « Checked 538 files in 346ms. No fixes applied. », exit 0.
- `pnpm typecheck`: exit 0 (contracts, domain, server, web; no tsc output).
- `pnpm test`, run twice (after the cherry-picks, then with b1bb6ef's changes): exit 0 both times, « Test Files 186 passed (186) », « Tests 2519 passed | 2 skipped (2521) ». No warning or stderr, only vitest's own hints.
- `pnpm --filter @rune/web test test/places`: « Test Files 6 passed (6) », « Tests 109 passed (109) ».
- `pnpm --filter @rune/web test:e2e sheet` (Chromium Pixel 7 + WebKit iPhone 14): « 6 passed (38.4s) », the 2.4.11 test included on both engines. The log holds no invitation code.
- Fix worktrees `rune-ecrans-fix-T11-r1-g{1,2,3}` removed and branches `fix/T11-r1-g{1,2,3}` deleted after this report.
- Cleanup note: `git worktree remove --force` left each fix directory holding only pnpm `node_modules` junctions (232 links each, all pointing inside that directory). They were removed with `rmdir /s /q`, which does not follow junctions; `git worktree list` now shows only the main checkout, rune-ecrans, rune-local and rune-specs. Review package: `review-795f02d..b1bb6ef.diff` (7 commits).
