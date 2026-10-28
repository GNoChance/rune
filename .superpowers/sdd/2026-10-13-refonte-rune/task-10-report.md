# Task 10 report — Espace Profil, réglages, coach, santé, confidentialité, déconnexion (#58)

This file did not exist when round 1 was integrated (the implementer's report was never written here), so it starts with the round-1 fix report.

## Fix report — round 1, integration (groups 1 to 3)

Integrated into `socle-profil` (C:\Users\eliott.colin\rune-profil) from base 1f8eca9, with `git cherry-pick 1f8eca9..<branch>` for each branch in order. History is linear, with no merge commit. Every cherry-pick applied cleanly (git auto-merged the three shared test files), and the full checks were green, so no integration commit was needed.

| Group | Branch (head) | Commits on socle-profil | Findings |
|---|---|---|---|
| 1 | fix/T10-r1-g1 (5686e1e) | 4c2943e, 190fe2c | T10-F24, T10-F20, T10-F9, T10-F8, T10-F22, T10-F21, T10-F25 |
| 2 | fix/T10-r1-g2 (4e3574c) | caefc5f, f093ab5, 5cdcdba, f40b4cc | T10-F3, T10-F1, T10-F4, T10-F2 |
| 3 | fix/T10-r1-g3 (07fde51) | b00f9b4, 08593d7, 5a3afe1, 69e6274 | T10-F6, T10-F5, T10-F19, T10-F15 |

Every message ends with « Refs #58 » and the Co-Authored-By trailer.

### Group 1 (from its notes)
- **4c2943e — Mon coach waits for a known profile and follows the reread coach (F8, F9, F22).** Files: `features/coach/MyCoachPage.tsx`, `test/profile/my-coach.test.tsx`.
  - **F8.** The page reads `known` from `useTrainingProfile` and still returns null until `loaded`. When `known` is false (empty mirror, no successful pull yet), it shows only the title, Back and the « later » note: no hero, no « Changer de coach », no sheet. The group chose this over returning null, so a phone that stays offline does not see a blank page.
  - **F9.**
    - The notice is stored as a coach id (`announced`). The banner shows only when `announced === coach`, so it cannot contradict the hero, even for one frame.
    - The `[saved]` effect still clears `chosen`, and clears `announced` only when the reread disagrees: `setAnnounced(c => c === saved ? c : null)`. This replaces the old biome-ignore.
    - Deviation from the literal fix: clearing the notice on every `saved` change would erase a correct « Le Scribe est ton nouveau coach. » when the pull after the PATCH confirms it, and would race with `changed()`.
    - Sheet: `picked ?? p.current`. The checked coach follows the current coach until the user picks one, without an effect.
    - A first version kept the banner as plain state cleared in the effect. The new test failed about 1 run in 2 (a commit where the hero already showed L'Ombre before the old banner was removed). Deriving the banner from the coach on screen fixed it.
  - **Tests.** 2 tests in the main describe, plus a new describe « coach relu après un pull » with 4 tests:
    - L'Ombre seeded: h2, both avatars, temper, sheet with L'Ombre checked;
    - confirm while the PATCH returns 200 without writing the mirror: hero shows Le Scribe and the notice appears;
    - notice kept on a confirming reread, removed when another device picks L'Ombre, not brought back when the coach returns to Scribe;
    - sheet open while another device switches the coach: L'Ombre checked, « Choisis un autre coach » disabled;
    - sheet open with a pick already made: the pick survives the reread;
    - new device (empty mirror, `lastPullOkAt` null): no « Changer de coach », no « Choisis un coach », no h2; after `seedProfile` and `sync.set({ lastPullOkAt })`, the hero and the button appear.
  - **RED** on the original MyCoachPage: 3 failed, 11 passed (« expected <div class="_bannerBody_…"> to be null », « until: condition jamais remplie », « expected <button …> to be null »). **GREEN**: 14/14, 6 repeat runs.
- **190fe2c — Profil assertions that match their titles (F20, F21, F24, F25).** Test only.
  - `health-section`: F24(1) checks with `compareDocumentPosition` that the consent row comes before the h2 « Questionnaire d'alerte ». F20 adds `await settle()` after `findByText(LIMITATION)`.
  - `hub`: F24(2) checks the group titles, `['Entraînement','Compte et appli']` for a member and `[..., 'Cercle']` for an admin. F21 adds a `rowValue()` helper that waits for each row's own value, then compares with `toBe`. New cases:
    - empty profile (coach null): « Mon profil » and « Mon coach » have no aria-describedby;
    - goal only gives exactly « Prendre du muscle »;
    - consent without limitation gives exactly « Accord donné ».
    `renderHub` gained `profile` and `limitation` options.
  - `profile-page`: F24(3) checks there is no textbox, button or link inside the birth-date `li`.
  - `withdraw`: F25 checks that after « Annuler » and `settle()`, focus is on « Retirer mon accord santé ». The dialog is opened with `fireEvent.click`, which does not focus the button (the Safari case).
  - **RED by mutation** (code already correct, each source restored with git checkout):
    - consent row moved below ScreeningSection;
    - a late « Mode prudent » h2 (F20);
    - « Compte et appli » moved above « Entraînement »;
    - `profileSummary` returning « Non renseigné », a dangling « · », `activeLimitations >= 0`, « Aucun coach »;
    - birth row turned into a button;
    - the `?? document.getElementById(withdrawId)` fallback removed.
    Each mutation was caught by its new test, while the HEAD tests passed.
- **Group checks.** Web `pnpm test`: 80 files, 1374 passed, no stderr. Touched files: 128/128 on 4 repeat runs. Lint and typecheck clean.

### Group 2 (from its notes)
- **caefc5f — T10-F4 (P8 procedure).**
  - `docs/exploitation/P8-incident.md` line 365 now reads: Profil → « Se déconnecter » → « Tous mes appareils » → « Déconnecter tous les appareils ».
  - `apps/server/test/infra/docs.test.ts` expects that exact path and checks that the old label « Déconnecter tous mes appareils » is gone.
  - RED: `-t P-AUT-8` failed at line 947 (`expect(close).toContain(needle)`). GREEN: docs.test.ts 123 passed.
- **f093ab5 — T10-F2 (unsent-data warning describes the logout sheet).**
  - `ui/BottomSheet.tsx` takes an optional `describedBy` and sets aria-describedby on the role=dialog element. Without it, nothing changes.
  - `LogoutDialog.tsx` gives the warning title and sentence ids (useId). Only when items are pending, it passes both ids to the sheet and also sets them as aria-describedby on the confirm button. The confirm button is described rather than each ChoiceCard, so the radios do not repeat the warning.
  - Tests in `test/auth/logout-reset.test.tsx`:
    - 2 pending: dialog « Se déconnecter » with description « Données non envoyées 2 éléments … appareil. »; the confirm button has the same description, and keeps it after choosing « Tous mes appareils »;
    - `currentOnly` with 1 pending: same description;
    - nothing pending: no aria-describedby on the sheet or on the button.
  - RED: the first two failed (« Unable to find role=dialog and name Se déconnecter »). GREEN: 30 passed.
- **5cdcdba — T10-F1 and T10-F3 (Santé limitations open from a row, mockup C04; Mode prudent link).**
  - New `features/privacy/HealthLimitations.tsx`:
    - h2 « Limitations » (.sectionTitle) with the « Facultatif » note under it;
    - a ListGroup card, one row per limitation (label in bold, note in small text);
    - « Modifier » and « Supprimer » are 44 × 44 icon buttons, named exactly that and described by the limitation label;
    - the last row is the accent ListRow « Ajouter une limitation ». No field shows before it is clicked. The row then gives its place to a form named « Ajouter une limitation »: Zone gets focus, « Ajouter » and « Annuler » are full width. After a cancel or a successful add, focus goes back to the row;
    - edit in place carried over unchanged: one form at a time, released when the limitation disappears, focus back to « Modifier ».
  - `HealthSection` renders `<HealthLimitations />`. New pencil, trash and plus icons in `profile/icons.tsx`. `ListRow` gains `tone="accent"` (accent label, no chevron): 1 rule in `ui.module.css`, 1 test in `components.test.tsx`.
  - F3: without consent, under the self-check in the « Questionnaire d'alerte » section, a ListRow link « Mode prudent » (GaugeIcon, value « Dans Mon profil », href /profile/edit). The toggle stays in Mon profil only.
  - Tests in `test/privacy/health-section.test.tsx`:
    - no Zone field before the click;
    - Modifier and Supprimer named and described, with .iconButton and a 44 px rule;
    - the h2 has .sectionTitle;
    - open, then POST `{bodyArea:'shoulder', side:'right', severity:'mild', note:'port de charges'}`, close, focus back on the row;
    - Annuler sends nothing, returns focus and starts empty next time;
    - a 403 keeps the form open with the error and the input;
    - the Mode prudent link (name, description, href, after the self-check, no switch on the page, opens Mon profil), and it is gone once consent is given.
  - RED: 4 health-section tests (Zone select present; form not found), the ListRow accent test (chevron present) and the F3 link test (not found). GREEN: 22 passed; components 44 passed.
- **f40b4cc — refactor.** Removes the now-unused `editable` mode and its logic from `LimitationsEditor` in `HealthStep.tsx`. Onboarding renders exactly as before. `headingLevel` stays (unused) so that the merge with socle's fce32cc stays clean.
- **Group checks.** Lint (542 files), typecheck, `pnpm test` (186 files, 2582 passed, 2 skipped) green. E2E sheet.spec passed on Chromium and WebKit. A throwaway visual spec of Santé at 390 × 844, light and dark, was deleted and never committed.

### Group 3 (from its notes)
- **b00f9b4 — T10-F6.** This touches `apps/web/src/ui/AppShell.tsx`, which is outside T10's file list.
  - The home header avatar's aria-label is now « Profil » (was « Mon profil »). It has the same name and destination (/profile) as the Profil tab (WCAG 3.2.4).
  - `shell.test.tsx`: `homeHeader()` finds the header through the connection pill. New test: on home, no « Mon profil » link and exactly two « Profil » links, both to /profile. Internal pages: no « Profil » link outside the tab bar.
  - `UpdateBanner.test.tsx` finds the header through connection-status. `e2e/shell.spec.ts` uses `header a[aria-label="Profil"]` and the banner's « Profil » link (exact).
  - RED: 4 shell tests failed (« Unable to find … link and name Profil », « expected <a aria-label=Mon profil> to be null »).
- **08593d7 — T10-F5.**
  - The PrivacySettingsPage policy row is named « Lire la page Confidentialité et règles ». Its visible label is unchanged.
  - The SettingsPage refusals row is named « Voir les éléments refusés : Refus du serveur » (C03, WCAG 2.5.3). The count still describes it.
  - `withdraw.test.tsx` and `rejections-settings.test.tsx` query the new names. The « no refusals » check uses `/Refus du serveur/` so it cannot pass trivially.
  - RED: 4 tests failed on the new names.
- **5a3afe1 — T10-F19 (test only).** `renderHarness` gains `{pending}` (default 2) and a logout-all route. New test: choose « Tous mes appareils », Annuler, reopen. « Cet appareil » is checked again and the « Déconnecter tous les appareils » button is gone. « Se déconnecter » then sends one POST /api/auth/logout and no logout-all. RED by a temporary mutation (scope lifted to a module variable): « expected false to be true ». LogoutDialog was restored and is in no commit.
- **69e6274 — T10-F15 (CSS only, `profile.module.css`, scoped under `.cautious`).**
  - The toggle keeps its markup, so onboarding is untouched. The geometry copies the toolkit Switch:
    - a 52 × 44 transparent input target, absolutely placed on the right;
    - `::before` draws the 50 × 30 track and `::after` the 24 px thumb, which slides 20 px;
    - under `prefers-reduced-motion: reduce`, the thumb's transition-property is background-color;
    - forced-colors rules are moved onto the pseudo-elements.
  - C02 layout: the card is centred, and the note sits in the label column (padding-inline-end calc(52px + 14px), min-height 44px).
  - New node test `test/profile/profile-styles.test.ts`: reduced motion on every transform transition, card centring, switch out of the text flow, 52 × 44 target, track inset and 20 px travel. RED on base CSS (« expected 50px to be 52px », « expected flex-start to be center »).
  - Visual check (not committed): C02 in light, dark and forced colors on Chromium, light on WebKit; elementFromPoint on the switch edges returns the input in both browsers.
- **Group checks.** 10 covering files, 258 passed. Web suite: 81 files, 1370 passed, no stderr. Lint and typecheck clean. E2E shell.spec passed on Chromium and WebKit.

### Conflicts resolved
No textual conflict. Three test files were changed by two groups each and git merged them on its own:
1. **`test/privacy/health-section.test.tsx` (G1 against G2).** G1's F24(1) order check (consent row before « Questionnaire d'alerte », line 409) and F20 `settle()` sit next to G2's limitations describe (line 151) and its Mode prudent link tests (lines 129 to 140). G2's link sits inside the « Questionnaire d'alerte » section, below the consent row, so G1's order check still holds. All pass.
2. **`test/privacy/withdraw.test.tsx` (G1 against G3).** G1's F25 focus test after « Annuler » (line 274) and G3's new policy name « Lire la page Confidentialité et règles » (lines 122 and 143) are in separate tests. Both pass.
3. **`test/auth/logout-reset.test.tsx` (G2 against G3).** G2's description tests use `renderDialog(pending, …)` (lines 71 to 83). G3's tests use `renderHarness(…, { pending })` (lines 189 to 242). These are separate helpers, and both declare the logout-all route. Both pass.

Product code: no file is changed by two groups. `LogoutDialog.tsx` is changed by G2 only (G3's mutation was reverted), `HealthSection.tsx` by G2 only, `MyCoachPage.tsx` by G1 only, and `profile.module.css` by G3 only.

Trial merge for merge 2: `git merge-tree --write-tree socle HEAD` gives a tree and no conflict (socle at 8fbfe04, which includes fce32cc).

### Final command outputs (integrated HEAD 69e6274)
- `pnpm lint`: « Checked 543 files in 480ms. No fixes applied. », exit 0.
- `pnpm typecheck`: exit 0 for contracts, domain, server and web, with no tsc output.
- `pnpm test`, three runs:
  - Run 1, exit 1: 2 timeouts at 5000 ms in `apps/server/test/infra/release.test.ts` (« garde du tag », « garde CI »).
  - Run 2, exit 1: the same 2 timeouts, plus `apps/server/test/build/bundle.test.ts` (« node build.mjs produit un seul server.mjs ESM ») at 5014 ms.
  - Those two files spawn bash or esbuild under a 5 s limit. They are the known load flake seen in Tasks 0 to 14, and this round does not touch them (on the server side, only `docs.test.ts` changed). Run alone: `pnpm vitest run --project server apps/server/test/infra/release.test.ts apps/server/test/build/bundle.test.ts` gave 2 files, 12 passed, in 1.47 s.
  - Run 3, exit 0: « Test Files 187 passed (187) », « Tests 2596 passed | 2 skipped (2598) », in 58.89 s. No stderr and no warning (grep count 0).
- E2E: `pnpm --filter @rune/web test:e2e shell.spec.ts sheet.spec.ts` gave 4 passed (Chromium and WebKit). These are the two specs the groups touched or ran: G3 changed shell.spec, and G2 changed BottomSheet, which sheet.spec covers.
- `git diff --check 1f8eca9 HEAD` is clean. The diff contains no « appsport ».
- `git diff --stat 1f8eca9 HEAD`: 28 files changed, 912 insertions, 182 deletions.
- `git status`: clean. `git show --stat HEAD`: 69e6274, `profile.module.css` (76 lines changed) and `profile-styles.test.ts` (new, 54 lines): 106 insertions, 24 deletions.

### Points for the controller
- **Outside T10's file list.** G3 changed `apps/web/src/ui/AppShell.tsx` (F6), and G2 changed `docs/exploitation/P8-incident.md` (F4, as the finding required), `ui/BottomSheet.tsx`, `ui/ListRow.tsx`, `ui/ui.module.css` and onboarding's `HealthStep.tsx` (removing the unused mode).
- **For merge 2 with socle (from G2).**
  1. `LimitationEditForm` (in `LimitationFields.tsx`, shared with onboarding) still has content-width « Annuler » and « Enregistrer » here. fce32cc changes that line to `panelActions`, so the buttons fill the row once merged.
  2. The « Facultatif » note text is now written in `HealthLimitations.tsx` and in socle's `LIMITATIONS_NOTE` (HealthStep.tsx, not exported, absent from socle-profil). Sharing one constant is best done after merge 2. Doing it now would touch the lines fce32cc changed.
  3. `headingLevel` on `LimitationsEditor` is left unused for the same reason.
- **F15.** CautiousModeToggle keeps its own CSS rather than the toolkit Switch. Moving it to the Switch would need a disabled prop and onboarding markup and test changes.

### Not addressed
None. All 15 findings of the round survive integration.

### Cleanup
- `git worktree remove --force` ran for the three fix worktrees (`rune-profil-fix-T10-r1-g1`, `-g2`, `-g3`); each had a clean status first.
- Git left the ignored `node_modules` folders on disk. I checked that every link in them (232 per folder) pointed inside its own folder, deleted the three folders with `rmdir /s /q`, then ran `git worktree prune`.
- `git branch -D` deleted fix/T10-r1-g1 (was 5686e1e), fix/T10-r1-g2 (was 4e3574c) and fix/T10-r1-g3 (was 07fde51). `git worktree list` now shows no T10 entry. `rune-profil`'s own `node_modules` is intact.
- Review package: `review-1f8eca9..69e6274.diff` (10 commits, 120584 bytes), written to `C:\Users\eliott.colin\rune-profil\.superpowers\sdd\2026-10-13-refonte-rune\`. That path is git-ignored.
