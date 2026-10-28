# Task 12 report: Administration (lane B, worktree rune-ecrans, branch socle-ecrans)

Status: DONE_WITH_CONCERNS. Commit `9de24a6` on `socle-ecrans` (from `b1bb6ef`), not pushed. Closes #60.

## Resume: what the earlier implementer left, and what I kept

- The working tree matched `refs/wip/T12-2` exactly (`git diff refs/wip/T12-2` was empty once the new files were added with intent-to-add). `refs/wip/T12` (morning) differed only in `admin.module.css` (disabled card background, avatar tint) and `admin-styles.test.ts` (the contrast block came later).
- Duplicate or half-finished edits from the two copies that ran at once: I found no duplicated tests, and no CSS classes that are used but undefined or defined but unused. The one visible trace was the contrast block in `admin-styles.test.ts`, which was not formatted (`pnpm lint` failed on it). I formatted it and kept it.
- I checked the WIP against the brief, the rulings, the redesign spec §10.5 and mockups E01 to E05 (light and dark), with screenshots. Its structure was right, so I kept it: `AdminPage` frame, `MemberCard`, `MemberSheet`, `MemberDialogs` (the existing confirmations, moved unchanged out of `MembersPage`), cards for invitations and gyms, and the server summary. Then I finished the parts listed below.

## What I changed on top of the WIP

1. **E05 icons as in the mockup**: each check row gets its icon (deploy, backup, restore test). SMART gets a pulse icon, Redémarrage a power icon, Espace disque a drive icon. The WIP used a chip, a restart arrow and a database cylinder, and had no row icons. The icon sits in a `.checkIcon` span: an `svg` selector here tripped biome `noDescendingSpecificity`.
2. **The code stays whole in the share message (E04)**: the message now renders the code as its own `<span class="messageCode">` (`white-space: nowrap`). The screenshot showed the code split at a hyphen across two lines, and the mockup keeps it on one line. The text content is unchanged: copy and share still use the exact message, which the tests check. Because the code now appears three times on the page, the invitation tests use `findAllByText`/`getAllByText` (`queryByText(...)` stays for absence checks).
3. **Test member renamed `lea` → `ines.m`** in `members.test.tsx`, so the tests match the brief word for word (« Actions pour ines.m »). This also covers a pseudo with a dot. The rename was mechanical; I reviewed the diff line by line, including the typed-pseudo cases (`'ines'` partial, `'INES.M '` with case and spaces).
4. **Ops docs and their guard test (outside the file list, see concerns)**: `apps/server/test/infra/docs.test.ts` pinned the old source line `act('delete', 'Supprimer', true)` in `MembersPage.tsx` and required P6 to say « Supprimer » and never « Supprimer le compte ». The ruling now requires « Supprimer le compte » in « Actions sensibles ». I updated:
   - the test, which now reads `MemberCard.tsx`, `MemberSheet.tsx` and `MemberDialogs.tsx` and checks the P6 wording;
   - P6 « Retirer un proche » step 2: carte → « Actions pour <pseudo> » → « Désactiver » (Actions sensibles) / « Supprimer le compte » → « Supprimer définitivement »;
   - P1 (end of the captures step), recette-telephones (Fin de la recette), P8 (« Actions pour <pseudo> » → « Fermer les sessions »), P7 (« Administration → Serveur »).

## Result, checked against the rulings

- **Members (E01)**: one `article` per member, named by the pseudo, with role (Admin), status (Actif/Désactivé) and Mineur badges. Last login is relative to the injected clock (`useServices().now`, `formatAge`). Below a rule: Accord santé, Accord coach, Onboarding as Oui/Non/En cours. A disabled member's card is hollow with a dashed border. The header count reads « N membres · M désactivé(s) ». Only `/api/admin` fields are shown; a test pins each card's full text content, so no C1 to C3 field can appear.
- **Sheet (E02)**: « Actions pour <pseudo> » (44 × 44, `aria-haspopup="dialog"`) opens a `BottomSheet` named by the pseudo. It holds the summary « Membre · Actif · 1 session ouverte » and « Fermer », then Lien de réinitialisation, Fermer les sessions (with its count), Promouvoir administrateur / Rétrograder, Corriger la date de naissance. Last comes the « Actions sensibles » region (danger): « Désactiver » (Plus de connexion, données conservées) and « Supprimer le compte » (Définitif, seulement à sa demande). Nothing follows that region, not even an actions bar. A disabled member gets « Réactiver » at the top, and « Désactiver » is gone. Picking an action closes the sheet and opens its existing confirmation. Focus goes back to « Actions pour <pseudo> », or to the « Membres du cercle » heading after a deletion.
- **Sub-navigation**: « Membres · Invitations · Salles · Serveur » (`nav` « Administration », `aria-current="page"`). The page title is « Administration », with Retour to `/profile`.
- **Invitations (E03, E04)**: cards with a state badge and « Révoquer » (described by the note). After creation, a System panel replaces the form: note and validity, the code box with « Ce code ne sera plus affiché. », the message to send, Partager / Copier le message, « J'ai noté le code ». The code lives only in component state. It disappears on « J'ai noté le code » and when you leave the page. A test goes Membres then back to Invitations and finds no code and no link. Nothing reaches storage, the local DB or the console.
- **Server (E05)**: the summary shows the version, the alert badge (« N alerte(s) » / « Aucune alerte ») and « Dernier contrôle de l'hôte ». Each check has a badge (Réussi/Réussie/Échoué(e)/Absente). A failed deploy written by the scripts (`ok: false`, same version) shows « Échoué » with « vX le JJ/MM/AAAA » and counts as an alert. Disks are bars that fill on arrival (no animation under reduced motion). SMART and Redémarrage are badges.
- **Salles**: cards; Modifier and Supprimer are described by the gym name.

## Tests and results

TDD evidence (scratchpad logs under `t12/`; no secrets: the only code in them is the fixed test fixture).

- **RED for the tests already present** (method from the dispatch: changed sources copied to the scratchpad, HEAD versions put back with `git show HEAD:<path> > <path>`, new source files moved aside, tests kept; no `git stash`):
  `npx vitest run --root . --project web apps/web/test/admin apps/web/test/app/guard.test.tsx apps/web/test/app/shell.test.tsx`
  → `Test Files 6 failed (6)`, `Tests 70 failed | 150 passed (220)`. Typical failures:
  - `Unable to find role="article" and name "lea"`
  - `Unable to find role="heading" and name "Administration"`
  - `Unable to find role="region" and name "Résumé"`
  - `Unable to find an accessible element with the role "group" and name "Invitation créée."`
  - `.moreButton: expected undefined to be '44px'`
  - `expected '…' not to match /var\(--color-/`

  Sources copied back afterwards; `git diff refs/wip/T12-2` was empty again.
- **RED for my new tests** (code kept whole in the message): same command on `apps/web/test/admin` → `2 failed | 98 passed`:
  - `expected undefined to be 'nowrap'` (`.messageCode`)
  - `expected [ <span class="_code_…"></span> ] to have a length of 3 but got 1`
- **RED for the docs test** (old P6 put back): `npx vitest run --root . --project server apps/server/test/infra/docs.test.ts -t "P6 : libellés"` → `1 failed`: `expected '\n1. **Révoquer le partage.** Console…' to contain '« Actions pour <pseudo> »'`.
- **GREEN**:
  - admin and app tests: `Test Files 6 passed (6)`, `Tests 221 passed (221)`;
  - docs and release tests: `133 passed`;
  - `pnpm lint`: `Checked 544 files … No fixes applied.`, no warning;
  - `pnpm typecheck`: exit 0;
  - `pnpm test`: `Test Files 187 passed (187)`, `Tests 2542 passed | 2 skipped (2544)`, no warning or stderr.
- **E2E**: the brief names none, and no E2E spec covers the admin screens. For the visual check I ran a throwaway Playwright spec (Chromium, real production build behind the E2E server, admin and three members created through the API, an ops `status.json` written into the data folder) at 390 × 844 in light and dark, plus 320 px wide. It passed, including the fixture that fails on any CSP violation. The spec, `test-results/` and the `.e2e-data` folder of my first failed attempt are deleted. Screenshots are in the session scratchpad `t12/shots` and `t12/shots320`, never committed. I deleted the ones that showed an invitation code.

## Files changed (commit 9de24a6)

- **web, admin**:
  - `apps/web/src/features/admin/`: `AdminPage.tsx` (new), `AdminNav.tsx`, `MembersPage.tsx`, `MemberCard.tsx` (new), `MemberSheet.tsx` (new), `MemberDialogs.tsx` (new; dialogs moved unchanged), `InvitationsPage.tsx`, `AdminGymsPage.tsx`, `ServerHealthPage.tsx`, `icons.tsx` (new), `admin.module.css`;
  - `apps/web/test/admin/`: `members.test.tsx`, `invitations.test.tsx`, `gyms-health.test.tsx`, `admin-styles.test.ts` (new: hard-coded colours, 44 px targets, the nowrap code, the disk bar under reduced motion, contrast of the admin tints in Auto light, Auto dark and the 4 forced themes);
  - `apps/web/test/app/guard.test.tsx`, `shell.test.tsx`: the admin page heading is now « Administration ».
- **Ops docs and their test**: `apps/server/test/infra/docs.test.ts`, `docs/exploitation/P1-installation.md`, `P6-proches.md`, `P7-maintenance.md`, `P8-incident.md`, `recette-telephones.md` (one line each).

## Self-review

- **Scope**: `git show --stat HEAD` lists the 23 files above; `git status` is clean. No « appsport » in the diff. Straight apostrophes in UI texts; test titles keep the curly ’ the existing tests use.
- **Colours**: tokens only, no `--color-*` bridge left in admin. Admin-specific tints are checked for contrast in every theme. The accent of the « Admin » badge on a disabled card was a real 4.48:1 case, fixed by the WIP (10 % tint, card mixed toward the surface).
- **Accessibility**: existing names and roles are kept (dialog titles, « Ton mot de passe », « Tape le pseudo pour confirmer », « Révoquer l'invitation »…). Targets are 44 px. Focus is restored after the sheet and after every dialog. The sheet is modal with trapped focus (`BottomSheet`).
- **Motion**: cascade (`stagger`), panel entrance (`enter-up`), bars on `--dur-screen`/`--ease`. Under reduced motion these become fades or nothing.
- **YAGNI**: no new API and no new data. `MemberDialogs` is a pure move.

## Concerns

1. **Files outside the list**: `docs/exploitation/*` (5 one-line edits) and `apps/server/test/infra/docs.test.ts`. Without them the full suite is red: the docs test pinned the old « Supprimer » source line and wording. Leaving P6 saying « Supprimer » would also send the owner to a button that no longer exists. If the controller prefers another route, these hunks can be reverted in isolation. The test change would then have to stay, re-pointed at the new files.
2. **E02 sheet header**: `BottomSheet` renders its own `h2` above the content. So the mockup's single row (avatar, pseudo, summary, Fermer) became the title, then a row with the summary and « Fermer », with no avatar. Matching it exactly needs a change in `ui/BottomSheet.tsx` (a header slot), which is outside the list.
3. **Sub-nav transitions**: `screen-transition.ts` treats the four admin sections as screens inside the Profil tab. A section never visited slides in from the right; one already visited slides back. The spec's fade is for tab changes. I left it, since it is outside the list.
4. **Contrast helpers**: `admin-styles.test.ts` has its own `hexToRgb`, `contrastRatio` and `resolveColor`, like `test/ui/contrast.test.ts`. No shared test helper exists, and extracting one would touch `test/ui` and `test/support`.
5. **Partager / Copier le message** have no icons (E04 shows them): `CopyButton` has no icon slot.
6. **Two server infra tests timed out once under load from the other lanes**: `release.test.ts` « garde CI » and `bundle.test.ts`, both at 5 s. They passed in isolation and in the final full run.

---

## Fix report, round 1 (17 findings, 3 parallel groups, integrated on socle-ecrans)

Status: DONE. `socle-ecrans` went from `9de24a6` to `24e8357` (7 commits, not pushed, each ending « Refs #60 » and the Co-Authored-By trailer). The first integrator was cut by a usage limit after the cherry-picks and the integration commit. I checked the integration and found nothing missing or broken, so I added no commit: HEAD is still `24e8357`.

### Integration check

Every group commit is on `socle-ecrans`. Subjects match `git log 9de24a6..<group head>`, and `git patch-id --stable` is identical for 6 of the 7:

| Group | Fix branch commit | On socle-ecrans | Patch |
|---|---|---|---|
| 1 | `26ec67c` (F1, F20) | `87f43d5` | identical |
| 1 | `1260c51` (F9, F12, F21) | `3a2b8d6` | identical |
| 1 | `adc37e8` (F19, F22) | `45e2e60` | identical |
| 1 | `618894a` (F24) | `62583ff` | identical |
| 2 | `9628392` (F2, F10, F15, F17) | `3efc3f2` | identical |
| 3 | `a3d009e` (F3, F7, F11, F13, F23) | `accc0a1` | same changes; only one context line differs |

For `accc0a1`, `git range-diff 9de24a6..a3d009e 3efc3f2..accc0a1` shows a single difference, a context line in `.cardTitle`: `white-space: nowrap` became `overflow-wrap: anywhere`, from group 2. No added or removed line differs.

### Group 1 (F1, F20, F9, F12, F21, F19, F22, F24): server alerts, member sheet focus, code-absence tests

- **F1 (host check failed with no other sign)**:
  - `ServerHealthPage.tsx`: `opsAlertCount` delegates to a new `hostAlertCount`. It counts one per disk over 80 %, plus `!smartOk`, plus `rebootRequired`. If that total is 0 and `host.ok` is false, it counts 1.
  - The Hôte card shows a `.hostWarn` line with the warning icon when `!host.ok`: « Contrôle échoué : <detail> », or « Contrôle échoué » when there is no detail.
  - `admin.module.css` gets `.hostWarn`, in `--warning-text`, wrapping long text.
  - Tests (`gyms-health.test.tsx`):
    - df missing and an unreadable disk each give « 1 alerte » and the detail line;
    - a full disk plus a reboot, with a detail, gives « 2 alertes »: a failure already explained by its signs adds nothing;
    - `ok: false` with no detail gives « 1 alerte » and « Contrôle échoué »;
    - a healthy host shows no failure line.
  - RED: `-t "contrôle de l’hôte"` gave 4 failed | 2 passed (« Unable to find an element with the text: 1 alerte »).
- **F20 (alert counting rules)**: two new tests.
  - Two disks over 80 % give two disk warnings and « 2 alertes ».
  - A backup that failed and is also late gives the alert « La dernière sauvegarde a échoué. », the late banner, the « Échouée » badge and « 1 alerte ».
  - RED by mutation: counting disks with `some()`, or counting the backup twice, each failed exactly the matching test (1 failed | 28 passed).
- **F9 (Safari focus)**: `MembersPage.tsx` gets an effect on `[sheet, action, returnFocus]`. When the sheet closes with no action pending and focus is on `body`/null, focus goes back to « Actions pour <pseudo> ». The effect runs after the BottomSheet unmounts.
  - The test blurs the button before opening, then expects focus back on that button after « Fermer » and after Échap.
  - RED: `-t "Safari"` gave « until: condition jamais remplie ».
- **F12 (session count unit)**: in `MemberSheet.tsx`, the badge shows the number and a `srOnly` span with « session(s) ouverte(s) ».
  - `it.each` over 1, 2 and 0 checks the aria-describedby text (« 1 session ouverte », « 2 sessions ouvertes », « 0 session ouverte »).
  - RED: 3 failed (« expected '2' to be '2 sessions ouvertes' »).
- **F21 (actions sensibles last)**: the tautological `parentElement` check is replaced. The test now checks that the sheet's `lastElementChild` contains the region, and that `nextElementSibling === null` at every level from the region up to the dialog.
  - RED: a mutant with an actions bar on the BottomSheet. The old test passed; the new one failed with « expected false to be true ».
- **F19 (code-absence checks)**: `document.body.textContent` must not contain the code:
  - in `invitations.test.tsx`: after « J'ai noté le code », after leaving and coming back, and after remount;
  - in `members.test.tsx`: after « J'ai transmis le lien », on reopening, in the storage test and after Échap.
  - The 4 `toBeTruthy` wrappers became `toHaveLength(3)`.
  - RED with a « Dernier code : … » mutant: the old tests passed (72), the new ones gave 4 failed. With a mutant showing the code a fourth time: old tests 1 failed, new tests 5 failed.
- **F22 (AdminNav case and trailing slash)**: a test on `/Admin/Members/` expects « Membres » to be the only `aria-current="page"` link.
  - RED: the mutant without `toLowerCase` and the mutant without the trailing-slash replace each gave 1 failed | 48 passed.
- **F24 (P6 doc check)**: `docs.test.ts` now looks for the visible labels « Actions pour », « Actions sensibles », « Désactiver », « Supprimer le compte » and « Supprimer définitivement », instead of JSX fragments.
  - RED: under a harmless refactor (variable rename, `h3` split over several lines, `label={'…'}`), the old test failed and the new one passed. A real label change (« Supprimer le compte » → « Supprimer ») still makes it fail.
- Group run: admin 112/112, web 1343, `pnpm test` 2554 passed | 2 skipped. A first server run had the known `release.test.ts` « garde CI » timeout; it passed alone and in a second full run.

### Group 2 (F2, F10, F15, F17): admin readable under large text, code on one line

CSS only (`admin.module.css`, `admin-styles.test.ts`); no markup changed.

- **F2 (sub-navigation overlap)**: `.nav ul` wraps again, `.nav li` loses `min-width: 0`, and `.nav a` loses `nowrap` and gains `text-align: center` and `overflow-wrap: anywhere`. Targets stay 44 px.
  - Before: links overlapped by up to 70 px (Carnet, 320 px, 200 % text), and already by 4.1 px in Carnet at 320 px with 100 % text.
  - After, in Chromium and WebKit: no overlap, spill or overflow in 4 widths × 4 text sizes × 3 themes; at most 3 rows.
- **F17 (segment radius)**: `border-radius: max(2px, calc(var(--radius-card) - var(--space-1)))`. Measured 14 px inside 18 (Clair), 2 inside 4 (Carnet), 8 inside 12 (Nuit).
- **F15 (code split at a hyphen)**: changes:
  - `.codeBox` becomes an inline-size container;
  - `.code` gets `nowrap` and `font-size: max(0.81rem, min(1.25rem, 7.2cqi))`;
  - `@container (width < 11.25rem)` restores wrapping for very large text.
  - 7.2 cqi rather than 8.4 comes from measured Chakra Petch 700 widths: a code is 12.06 em on average and 13.77 em for one in a million.
  - The rem floor keeps WCAG 1.4.4: the code grows with text size, then wraps.
- **F10 (ellipsis and grid overflow)**: `.memberName` and `.cardTitle` lose `nowrap`, ellipsis and `overflow: hidden`, and gain `overflow-wrap: anywhere`. The `.fact` and `.hostFacts` cells gain `overflow-wrap: anywhere`. `.fact dd` and `.hostFacts dt` gain `flex-wrap: wrap`, so the icon gives up its line before a word breaks.
  - After: no cut pseudo, no card or fact overflow, no cut invitation note.
- RED: `admin-styles.test.ts` gave 5 failed | 10 passed:
  - nav `flex-wrap`;
  - radius;
  - `.memberName` nowrap;
  - container type;
  - large-text container query.

  A second RED for the icon wrap: 1 failed | 14 passed.
- GREEN: 15/15; `pnpm test` 2547 passed | 2 skipped.

### Group 3 (F3, F7, F11, F13, F23): focus, descriptions, empty states, gym target

- **F13 (focus after creation)**: `ui/SystemPanel.tsx` gets an optional `titleRef`. When it is set, the `h2` gets `tabIndex={-1}`. `CreatedInvitation` passes its focus-on-mount callback, so focus lands on « Invitation créée. ». The code box loses its ref and tabindex.
  - Tests: the invitation test expects focus on the panel's `h2`. A SystemPanel unit test in `sheet-motion.test.tsx` checks the focus, tabindex -1 with the prop, and no tabindex without it.
- **F11 (« Révoquer » description)**: the note, « Créée le » and « Expire le » spans get ids from one `useId`. « Révoquer » is described by all three.
  - A test with two « Sans note » invitations resolves two distinct descriptions.
- **F7 (empty states)**: invitations and gyms use the toolkit `EmptyState`.
  - Invitations: new `MailIcon`, with « Chaque invitation créée apparaît ici, avec son état. ».
  - Salles: `GymIcon` from places. The text follows the search: « Une salle apparaît ici dès qu'un membre la crée depuis ses lieux. » with no search, « Essaie un autre nom ou une autre ville. » with one.
- **F23 (gym buttons described by the name)**: the test checks that the aria-describedby of « Modifier » and « Supprimer » equals the id of the name link.
  - RED by mutation (attribute removed): « Modifier: expected null to be '_r_2_' ».
- **F3 (gym name target)**: the `Link` uses `.gymLink` (flex, centered, `min-height: 44px`, negative margins) around a `<span class=cardTitle>`. The 44 px style test covers `.gymLink`.
- RED: 9 failed | 174 passed (183), all the new tests. GREEN: 183/183; web 1335.

### Integration fix commit `24e8357` (by the first integrator)

`fix(web): nom de salle passé à la ligne, à sa place dans la carte`: 3 files, +21 −4.

- The problem: F3's `.gymLink` takes its 44 px from the card padding through negative margins (−8 px / −6 px). It assumed a one-line name cut by an ellipsis. With F10 the name now wraps, and on two lines it rose 8 px into the card padding and touched the city below.
- The fix: the link gives its negative margins back as padding (`padding: 8px 0 6px`). With the global `box-sizing: border-box` (`ui.module.css`), a one-line name stays centered in the 44 px, and a two-line name starts and ends where it did. The comments that promised an ellipsis now say the name wraps.
- The test (`admin-styles.test.ts`) checks that the top margin is negative and that each padding equals its margin.
- RED, reproduced by me: `accc0a1`'s `admin.module.css` copied in place (HEAD copy saved to the scratchpad, no `git stash`).
  - `npx vitest run --root . --project web apps/web/test/admin/admin-styles.test.ts` → `Tests 1 failed | 15 passed (16)`, `AssertionError: rembourrage haut = marge haute: expected NaN to be 8`.
  - File restored: `cmp` identical, `git status` clean. Then 16 passed (16).

### Final runs at `24e8357` (C:\Users\eliott.colin\rune-ecrans)

- `pnpm lint`: `Checked 544 files in 405ms. No fixes applied.` (exit 0).
- `pnpm typecheck`: exit 0 (contracts, domain, server, web).
- `pnpm test`:
  - First run: `Test Files 1 failed | 186 passed (187)`, `Tests 1 failed | 2563 passed | 2 skipped (2566)`. The failure was `test/pwa/precache-plugin.test.ts` « un seul script iife minifié… », `Test timed out in 5000ms`, under load from the other lanes. No PWA file is touched in this round.
  - Alone: `Tests 14 passed (14)` in 536 ms.
  - Second full run: `Test Files 187 passed (187)`, `Tests 2564 passed | 2 skipped (2566)`, exit 0, no warning or stderr.
  - That is 22 more tests than at `9de24a6` (2542): group 1 +12, group 2 +5, group 3 +4, integration +1.
- Covering tests:
  - `npx vitest run --root . --project web apps/web/test/admin apps/web/test/ui/sheet-motion.test.tsx` → `Test Files 5 passed (5)`, `Tests 201 passed (201)`;
  - `npx vitest run --root . --project server apps/server/test/infra/docs.test.ts` → `Tests 123 passed (123)`.
- `git status`: `nothing to commit, working tree clean`.
- `git show --stat HEAD` (`24e8357`): `AdminGymsPage.tsx | 4 ++--`, `admin.module.css | 6 ++++--`, `admin-styles.test.ts | 15 +++++++++++++++`, `3 files changed, 21 insertions(+), 4 deletions(-)`.
- `git diff --stat 9de24a6 HEAD`: 14 files, +517 −64. No « appsport » and no code or secret in the commits or in this report.

### Findings

Addressed and kept after integration (17):

- Group 1: F1, F9, F12, F19, F20, F21, F22, F24.
- Group 2: F2, F10, F15, F17.
- Group 3: F3, F7, F11, F13, F23.

Not addressed: none.

### Concerns (from the groups, not fixed in this round)

1. **Seen by group 2, outside its findings**:
   - at 320 px with 200 % text, the title « Administration » is clipped;
   - `.messageCode` (`nowrap`) will probably overflow the message box at 200 %;
   - the tab bar labels are split with hyphens (« Pro- gres- sion »).
2. **Known limits**:
   - a pseudo with no spaces breaks anywhere (« camille.martin.l / ongueur »); breaking after the dots would need a `<wbr>` in the TSX;
   - a code made only of W and M overflows the box by 10 % at 100 % text (about 1e-20).
3. **E2E on socle-ecrans**: `setupOnboardedAdmin` (`e2e/support/flows.ts`) fails. The server answers 400 `{"error":"validation","field":"coach"}` on `/api/me/onboarding/complete`. Group 2's throwaway spec worked around it through the API.
4. **Shared toolkit**: `ui/SystemPanel.tsx` gains an optional `titleRef` prop. Watch for conflicts at the lane merge.
5. **Stale wording in a commit message**: `accc0a1` still says « ellipse gardée sur le nom ». F10 removed the ellipsis; `24e8357` fixed the code comments, not that commit message.
6. **Load timeouts** under the parallel lanes recur at the 5 s limit, now also in `precache-plugin.test.ts` (web) besides `release.test.ts` « garde CI ».
