# Task 13 report: Accès, pages publiques, 404, hors ligne et mise à jour

Worktree `C:\Users\eliott.colin\rune-ecrans`, branch `socle-ecrans`, base `24e8357`. Issue #61.

## What I implemented

Layout from mockups A01 to A06 and E06 (Clair and Sombre); behaviour, routes and limits of the auth flows unchanged.

- **Connexion (A01)**, `LoginPage.tsx`:
  - logo « Rang brisé » 92 px (mono with accent frame in light, glow in dark, like the home header), the word RUNE (0.3 em tracking) and « Grave ta progression. », with the blue → violet halo;
  - the logo is the accessible name (`img` « Rune »); the drawn word is `aria-hidden`, so a screen reader hears « Rune » once;
  - the form lives in the Système window (`SystemPanel`, title « Connexion » as the screen's only h1, « Identification requise. »);
  - « Autres accès » nav with the ticket and key pictograms (invitation in accent 600, reset muted);
  - session-expired and account-deleted banners kept;
  - blocks enter in cascade (`stagger`); the wipe-warning sheet sits outside the cascade.
- **Invitation (A02)**, `InvitePage.tsx` and `CodeStep.tsx`:
  - Retour (44 × 44) to `/login`;
  - « À propos de Rune » card with the 40 px logo, the reminder and the link « Confidentialité et règles » (new tab, external icon, hidden « (nouvel onglet) » as in the mockup);
  - code field in Chakra Petch with letter spacing, help « Colle le lien reçu, ou tape les 16 caractères du code. Les tirets sont facultatifs. » (`CODE_HELP`, built from `SECRET_CODE_LENGTH`), shared with the reset code step;
  - « Pas de code ? Demande à l'administrateur le lien complet ou le code. »;
  - the browser install guide uses the same numbered steps as Aide.
- **Création du compte (A03)**, `CreateAccountForm.tsx`:
  - Retour to `/login`; reminder as a muted lead;
  - local refusals attached to their field (pseudo, mot de passe, confirmation): `aria-invalid`, error then hint in `aria-describedby`, error icon, the field takes the focus, no alert. This follows the pattern ProfilePage already uses (`checkNewPassword`, then `newPasswordErrors` places the message under the password or the confirmation);
  - server refusals (`username_taken`, `password_rejected`, network) stay in the error alert, form kept.
- **Réinitialisation (A04)**, `ResetPage.tsx`: Retour to `/login` on both steps, the same attached password errors, the same code help.
- **Aide (A05)**, `HelpPage.tsx`, in this order:
  1. the emergency box: « En cas d'urgence, appelle le 15 ou le 112. » plus two call buttons, « 15 SAMU » and « 112 Numéro européen » (`aria-label` « Appeler le 15, SAMU » and « Appeler le 112, numéro européen »);
  2. « Installer Rune » with both systems as numbered steps (`InstallSteps.tsx`, content from `install-help.ts`);
  3. « Numéros utiles » with the date « Numéros vérifiés le … », a call link per number (`aria-label` « Appeler le … »), « Source » in a new tab (announced) and the hours;
  4. « Crédits » (P10), the same `CreditsContent` that `/credits` renders. `/credits` stays served.
- **Confidentialité, Crédits**: Retour, sections as cards with h2 titles styled like Aide.
- **Retour target of the public pages** (`use-public-back.ts`): `/profile` when the device has a session (Aide and Confidentialité live in Profil › Compte et appli, spec §5), otherwise `/login`.
- **404 (A06)**, `NotFound.tsx`:
  - emblem: the logo frame with the accent → accent-2 gradient, tinted fill, « 404 » in the middle; glow in dark and Salle de nuit; instance-prefixed ids; `aria-hidden`;
  - the Système window « Page introuvable » (h1, 28 px) with « Zone inconnue. Cette page n'existe pas ou n'est pas encore disponible. » and a 52 px primary-styled link « Retour à l'accueil » to `/`;
  - **hors ligne**: when the sync state says `offline` (the single source, never `navigator.onLine`), the « Hors ligne » status card of A06 appears: « Les pages Aide, Confidentialité et Crédits restent lisibles. La connexion nécessite le réseau. » It leaves when the network comes back.
- **Update banner (E06)**, `UpdateBanner.module.css`:
  - icon circle in surface white in light themes, accent at 14 % in dark and Salle de nuit, as in E06;
  - the forced variant (426) already had no « Plus tard »: unchanged, still covered by `UpdateBanner.test.tsx`;
  - banner rules unchanged (never during onboarding or a session).
- **Readable offline**: Aide, Confidentialité and Crédits are static and make no request. A new test renders all three with the API offline and no session. The service worker serves every navigation from the shell cache.

### Outside the file list (small, needed by the mockups)

1. `ui/SystemPanel.tsx`: `headingLevel` also accepts `1`. It is a type change plus one comment line. The login and the 404 carry their screen title inside the Système window (A01, A06). Re-creating the window in the feature CSS would duplicate a toolkit component. On socle-ecrans, T12 already added `titleRef` to this file. The change is one line, so a merge conflict is unlikely.
2. `ui/AppShell.tsx` › `PublicShell`: the old header (white bar with the word « Rune ») is no longer rendered for the public pages. A01 has no header, and A02 to A05 start with Retour and the title. The onboarding (`homeLink={false}`) keeps its header unchanged: T8's `flow.test.tsx` expects that unlinked « Rune », and T8 left the onboarding header to the integrator. The diff is in the `PublicShell` function only. socle-profil changed only `HomeHeader` in this file, so merge 2 should merge cleanly.
3. `test/sw/UpdateBanner.test.tsx`: three frame tests used the old « Rune » link of the public header to get back to the connected frame, or waited for its `banner` role. They now use « Retour » (to `/profile`) and wait for the page h1. The assertions themselves are unchanged.
4. `test/auth/messages.test.ts`: `installHelp` now returns the structured steps of A05 instead of one sentence per system.

## Tests (TDD)

New and updated tests:
- `test/auth/login.test.tsx`:
  - A01: logo « Rune », « RUNE » (hidden from screen readers), slogan, group « Connexion » with « SYSTÈME », the screen's only h1, « Identification requise. », Pseudo, Mot de passe, Se connecter, nav « Autres accès » with « J'ai un code d'invitation » to `/invite`, in that order;
  - no old header and no « Rune » link; the public footer is still there.
- `test/auth/invite.test.tsx`:
  - « À propos de Rune » region with the link « Confidentialité et règles (nouvel onglet) » (target `_blank`);
  - Retour to `/login` on both steps; code field described by the help; « Pas de code ? » line;
  - every local refusal now checks the field error (aria-invalid, description with the error before the hint, focus, no alert): 11 characters, admin 13 characters, mismatch on Confirmation, password containing the pseudo, the five pseudo refusals; plus « erreur corrigée : le compte est créé ».
- `test/auth/logout-reset.test.tsx` (ResetPage section only; T10 changes the LogoutDialog section of this file):
  - admin 13 characters and the local checks are attached to their field;
  - A04: Retour to `/login` on both steps; the code field has the help.
- `test/app/public-pages.test.tsx`:
  - Aide: the emergency box (15, 112 with their names) comes before « Installer Rune »; the h2 order is Installer Rune, Numéros utiles, Crédits;
  - the iPhone and Android steps as a screen reader reads them;
  - useful numbers without the 15 / 112, with their call names, sources in a new tab and the hours;
  - the Crédits section in Aide;
  - Retour to `/login` without a session and to `/profile` with one, for `/help`, `/privacy` and `/credits`; no old header;
  - offline without a session: the three pages render with no request;
  - 404: group « Page introuvable » (the only h1), « SYSTÈME », « Zone inconnue. … », link « Retour à l'accueil » to `/`; the same 404 on an admin path for a member; the « Hors ligne » card when the sync state is offline, gone when it is back online.
- `test/sw/UpdateBanner.test.tsx`: see above. « Plus tard » absent in the forced variant is the existing test « forcé → … pas de « Plus tard » » plus « un 426 ensuite le rend non fermable ». Both already passed before this task, since the behaviour came from T5.

### RED (separate run, before any implementation)

Command, from `C:\Users\eliott.colin\rune-ecrans`:
`pnpm exec vitest run --project web apps/web/test/auth apps/web/test/app/public-pages.test.tsx apps/web/test/sw/UpdateBanner.test.tsx`

Output (summary):
```
 Test Files  6 failed (6)
      Tests  34 failed | 121 passed (155)
```
Failure reasons (counted):
```
      8 Error: until: condition jamais remplie            (field errors: no aria-invalid on the field)
      6 Unable to find role="link" and name "Retour"
      5 Unable to find an accessible element with the role "link" and name "Retour"
      2 Unable to find role="group" and name "Page introuvable"
      2 Unable to find role="group" and name "Connexion"
      1 Unable to find role="region" and name "Numéros utiles"
      1 Unable to find role="region" and name "Installer Rune"
      1 Unable to find role="region" and name "Crédits"
      1 Unable to find an element with the text: Les pages Aide, Confidentialité et Crédits restent lisibles. La connexion nécessite le réseau.
      1 Unable to find an accessible element with the role "region" and name "À propos de Rune"
      1 Unable to find an accessible element with the role "region" and name "En cas d'urgence, appelle le 15 ou le 112."
      1 AssertionError: expected [ Array(1) ] to deeply equal [ { title: 'Sur iPhone', …(1) } ]
```
The « hors ligne, sans session » test passed at RED: the three pages were already static. It now guards that.

### GREEN

Same command after the implementation:
```
 Test Files  6 passed (6)
      Tests  155 passed (155)
```
The first full run caught a race in my new « en session : Retour vers le Profil » test. A public page renders before the local session is read, so Retour briefly points to `/login`, then follows the session. That is harmless: the guard sends `/login` with a valid session to `/`. The test now waits for `/profile` and passed 3 times in a row.

### Full checks

- `pnpm lint`: `Checked 546 files … No fixes applied.`
- `pnpm typecheck`: contracts, domain, server and web all clean.
- `pnpm test`, final run after the last change: `Test Files 187 passed (187)`, `Tests 2584 passed | 2 skipped (2586)`. The output is clean: no stderr, no warning.
  - The first full run had one more failure: `test/privacy/withdraw.test.tsx` › « « Je refuse » sur Santé : la note témoin… ». It passed alone 3 times and in the final full run.
  - This test is on the spec §11.4 flaky list (« retrait du consentement », for T15) and touches none of my files.
- **E2E** (`pnpm --filter @rune/web test:e2e`, Chromium and WebKit): `14 failed, 12 passed (9.6m)`.
  - The 14 failures are 7 specs × 2 browsers: arrival, epoch, kill-switch, offline, protocol, shell « barre d'onglets … 320 px », update.
  - All of them stop at onboarding completion: `completeOnboardingViaUi` (`e2e/support/flows.ts:81`, a timeout waiting for the home), or `POST /api/me/onboarding/complete` refused in `epoch.spec.ts`. This is the P7/P15 state of socle-ecrans: the server needs a coach (T6), but the coach step and the E2E helpers are T7's, on socle, merged at merge 2. T12's report notes the same.
  - **Baseline proof**: I restored HEAD's files in place (no stash; my files copied to the scratchpad, then put back and checked with an identical `git diff`). The same 7 specs on Chromium fail the same way: `7 failed`, six at `support\flows.ts:81` and one at `POST /api/me/onboarding/complete`.
  - In `arrival` (both browsers), the steps through my screens passed before onboarding: the bootstrap link opens the invitation, then « Crée ton compte », then the account is created and `/onboarding` reached.
  - Passing: boot-splash, sheet ×3, theme ×2, on both browsers.

## Visual check

I ran a throwaway Playwright spec (Chromium, production build behind the E2E server). It was never committed, then deleted with its `test-results/`. It captured, in light and dark at 390 × 844 and again at 320 px wide: login (empty and with an error), invitation code step, account creation with a field error, reset code step, Aide (full page), Confidentialité, Crédits, 404, and 404 offline (server blackholed, sync state offline).
- The screenshots are in the session scratchpad `t13/shots` and `t13/shots320`, not committed. None shows a code.
- On this lane the UI onboarding cannot finish: the coach step is T7's, merged at merge 2. The spec finished onboarding through the API, with `coach` set, to reach the 404.
- After a first look I fixed two spacings: 16 px between « Identification requise. » and the form, and 18 px above « Retour à l'accueil ».
- At 320 px there is no sideways scroll. The halo is bounded to the content width, and the two emergency buttons stack.

## Files changed

- `apps/web/src/features/auth/`:
  - `LoginPage.tsx`, `InvitePage.tsx`, `CreateAccountForm.tsx`, `ResetPage.tsx`, `CodeStep.tsx`;
  - `install-help.ts`, `messages.ts` (`CODE_HELP`, `newPasswordErrors`);
  - `auth.module.css`;
  - new `InstallSteps.tsx`.
- `apps/web/src/features/public/`:
  - `HelpPage.tsx`, `CreditsPage.tsx` (`CreditsContent`), `PrivacyPage.tsx`, `NotFound.tsx`, `public.module.css`;
  - new `use-public-back.ts`.
- `apps/web/src/sw/UpdateBanner.module.css`
- Outside the list: `apps/web/src/ui/SystemPanel.tsx`, `apps/web/src/ui/AppShell.tsx` (`PublicShell` only).
- Tests:
  - `apps/web/test/auth/login.test.tsx`, `invite.test.tsx`, `logout-reset.test.tsx`, `messages.test.ts`;
  - `apps/web/test/app/public-pages.test.tsx`;
  - `apps/web/test/sw/UpdateBanner.test.tsx`.

## Self-review

- Behaviour, routes and limits are kept:
  - tolerant code entry, fragment read then cleared (R-INV-4), wipe warning (P-AUT-6);
  - `rate_limited` minutes, « Nécessite le réseau » on the login and the creation;
  - `/credits` reachable, `PUBLIC_PATHS` unchanged, `App.tsx` untouched.
- Texts verbatim from the brief and the rulings: « Grave ta progression. », « Page introuvable », « Zone inconnue. », Aide order. Straight apostrophes, tutoiement.
- Accessibility:
  - one h1 per screen;
  - logos named once or hidden;
  - pictograms `aria-hidden`; the ⋮ chip reads « ⋮ » as in A05;
  - every link and button is at least 44 px;
  - field errors linked by `aria-describedby`, with focus;
  - the offline card is `role="status"`;
  - `prefers-reduced-motion` handled by `motion.css` (`stagger`).
- Colours are tokens only, with `color-mix` tints.
  - Cards follow the admin and places pattern: soft shadow in light, flat in dark, Salle de nuit and Carnet.
  - The emergency danger text on its 7 % tint is about 5:1 in light.
- CSP: no inline style, no external resource, no `dangerouslySetInnerHTML`.
- No « appsport » in the diff. No code, `#` link or password in this report or the commit.

## Concerns

1. **Two small changes outside the file list**, both needed by the mockups: `ui/SystemPanel.tsx` (heading level 1) and `ui/AppShell.tsx` › `PublicShell` (no frame header on the public pages; onboarding unchanged). Details above. At merge 2:
   - T12 also touched `SystemPanel.tsx` (`titleRef`, same lane, already in this base);
   - socle-profil changed only `HomeHeader` in `AppShell.tsx`.

   Whoever restyles the onboarding header (T8 left it to the integrator) can now drop the `homeLink={false}` header too.
2. **E2E red on this lane, not caused by this task**: 7 specs × 2 browsers fail at onboarding completion, and the same specs fail at the base (proof above). After merge 2 brings T7, rerun the whole E2E suite. arrival, offline, protocol and update go through the login, invitation, account creation and update-banner screens restyled here.
3. **Not changed, shared toolkit**: the public footer (`PublicLinks`, also used by `AppShell`) keeps its underlined links with a gap. The mockups show « · » separators without underline. The wipe-warning sheet (A04) has no warning icon beside its title, because `BottomSheet` has no icon slot.
4. **Server refusals stay in the alert**: `password_rejected` from the server, `username_taken` and network errors stay in the alert, as in ProfilePage. Only local refusals attach to their field. Attaching the server's password reason to the field would be easy if wanted.
5. **Retour of the public pages** goes to `/profile` with a session and to `/login` without. A public page renders before the local session is read, so during that first instant Retour points to `/login`. That is harmless: the guard sends `/login` with a valid session to `/`.
6. **Offline card**: it shows on the 404 only, when the sync state is `offline`. A signed-out device has no sync state (and `navigator.onLine` is forbidden). The login therefore keeps its « Nécessite le réseau » alert after a failed attempt.
7. The last edit, scoping `p + .form` to `.login`, came after the E2E build started. It is a selector change only, and lint, typecheck and the final full unit run came after it.

Review package: `C:\Users\eliott.colin\rune-ecrans\.superpowers\sdd\2026-10-13-refonte-rune\review-24e8357..ce5f34e.diff` (1 commit, `ce5f34e`).

## Fix report, round 1 (15 findings, 3 parallel groups, integrated on socle-ecrans)

Status: DONE. `socle-ecrans` went from `ce5f34e` to `ec5ce8a`: 5 commits, cherry-picked in group order, linear history, no merge commit, not pushed. Each commit ends with « Refs #61 » and the Co-Authored-By trailer. No integration breakage was found, so there is no integration commit. The fix worktrees are removed and the fix branches deleted.

### Integration

| Group | Fix branch commit | On socle-ecrans | Patch |
|---|---|---|---|
| 1 | `c56c8cb` (tests: Aide, Crédits, 404) | `4442b45` | identical (`git patch-id --stable`) |
| 1 | `74ee17d` (F1, F8, F12) | `bfd39db` | identical |
| 2 | `b8d8f01` (F2, F13, F14, F15) | `7b29482` | identical |
| 3 | `c461a77` (F3, F6, F10, F11, F18) | `be3b326` | conflicts resolved by hand, see below |
| 3 | `d339093` (F18 test rework, 404 tests moved) | `ec5ce8a` | conflicts resolved by hand, see below |

Groups 1 and 2 applied cleanly. `public.module.css` merged on its own: g2's `.card, .offline` card rules and g3's `.offlineSlot`, `.brand` and `.notFoundHeader` blocks sit side by side. The offline card content keeps the `.offline` class (now `enter-up` + `.offline`, inside the `role="status"` `.offlineSlot`), so g2's card look applies to g3's always-present region.

**Conflicts (tests only, no source file conflicted):**
1. `c461a77` › `apps/web/test/app/public-pages.test.tsx`: g1 had added the `it.each(['unknown', 'protocol_unsupported'])` 404 test (F17), and g3 had added the two « région Hors ligne » tests plus the « 404 : marque en tête » describe, all at the end of the 404 describe. I kept both sides: g1's `it.each`, then g3's tests and its new describe.
2. `c461a77` › `apps/web/test/auth/invite.test.tsx`: g1 had added the two F8 tests and renamed the 409 test to « 409 username_taken : erreur sous le pseudo (maquette A03), formulaire gardé ». g3's first commit added a test « erreur corrigée puis refus du serveur » built on a 409 `username_taken` read from the alert, and kept the old 409 title. I kept g1's side and dropped g3's 409-based test. After g1 (F1) that test could not pass, since `username_taken` now goes under Pseudo. g3's own second commit `d339093` replaces it with the network-refusal `it.each`, for that same reason (see g3's notes). g3's rename of « erreur corrigée : le compte est créé » applied without conflict.
3. `d339093` › `public-pages.test.tsx`: g3 moved the whole 404 describe below the brand describe. The moved copy did not contain g1's `it.each`. I took the move (the old block deleted) and put g1's `it.each` back at the end of the moved 404 describe, after the « hors ligne » test, its place in g1's version.
4. `d339093` › `invite.test.tsx`: the deletion of g3's 409-based test had nothing left to delete. I kept g1's F8 tests and 409 title. g3's F18 `it.each` (two cases, refusal by network) applied cleanly after the « invitation utilisée entre-temps » tests.

**Check that nothing was lost:** I built a 3-way merge of the three fix branch heads with `git merge-tree --write-tree` (g1 + g2, then + g3). It had no conflict, and its tree `236c087` is **identical** to the tree of `ec5ce8a` (`git diff --stat 236c087 HEAD` is empty). So HEAD holds every line of all three groups.

### Group 1 (F19, F17, F4, F12, F8, F1): server refusals under their field, errors cleared on typing, new-tab notice, public pages pinned on visible text

- **F1, server refusals under their field.**
  - `messages.ts`: new `AccountFieldErrors` type and `accessFieldError(e, role)`.
    - `password_rejected` goes to the password field. `username_taken` and `username_invalid` go to Pseudo. The text comes from `accessErrorMessage`, so an unknown reason falls back to the shared message.
    - Network, invitation, `reset_invalid` and `rate_limited` errors return null and stay in the alert.
  - `CreateAccountForm.tsx`: the catch block sends field errors to the field; everything else goes to the alert.
  - `ResetPage.tsx` (NewPasswordForm): a server `password_rejected` goes to the password field, everything else to the alert. This form has no Pseudo field.
  - This settles concern 4 of the T13 report.
- **F8, errors cleared on typing.**
  - New `features/auth/use-field-errors.ts`, shared by both forms. It replaces their copies of the focus effect.
    - `show(errors)` sets the errors and adds a focus request: the first `aria-invalid` field takes the focus.
    - `clear(...keys)` removes errors without moving focus.
    - The focus request is a counter kept in the same state as the errors. A first version with a ref flag was racy.
  - `editedPasswordFields`: editing the password clears the password and confirmation errors. Editing the confirmation clears only its own.
- **F12, new-tab notice.** The consent link gets an `srOnly` « (nouvel onglet) », with no icon (A03 shows none). The checkbox gets `aria-label="J'ai lu la page Confidentialité et règles"`, so its name does not carry the link's notice. T7's `e2e/support/flows.ts` and `test/sw/persist.test.tsx` stay untouched.
- **F4, F19, F17: `public-pages.test.tsx` pinned on what is shown.**
  - Two new helpers. `shownText` skips `aria-hidden` and aria-labels. `shownAfter(heading)` returns the text after a heading.
  - F4: the visible text of the two emergency calls is pinned, then the 5 « Numéros utiles » lines in order.
  - F19: the full Crédits text after the h2 of /help, then the same text after the h1 of /credits.
  - F17: `it.each(['unknown', 'protocol_unsupported'])`, no offline text on the 404. 'unauthenticated' is left out on purpose: the guard (`LOST_SESSION`) sends it to /login, so the 404 can never show in that state. A test comment says so.
- **Tests:**
  - `invite.test.tsx`: server refusals asserted under their field. Two F8 tests: Pseudo, then password and confirmation, with focus kept on the field being typed in. The consent-link name, `target=_blank` and the checkbox name.
  - `logout-reset.test.tsx`: server `common` under the field, plus one F8 test.
  - Both `expectFieldError` helpers wait for focus with `waitFor`.
- **RED (group's evidence):**
  - Auth, before the source change: `Tests 7 failed | 70 passed (77)`. Reasons: `Unable to find … link … "Confidentialité et règles (nouvel onglet)"`, `expected 'true' to be null` ×3, `until: condition jamais remplie` ×3.
  - Public pages, RED by mutation, one change at a time (M1 NotFound `connection !== 'online'`, M2 emergency names swapped, M3 label span deleted, M4 filter on phone, M5 useful number removed, M6 CreditsPage without CreditsContent). Each mutation failed its matching test. The old test file passed `24 passed (24)` with M1, M2, M3, M5 and M6 applied together.
  - Focus guard: making `clear` also add a focus request failed « saisie après un refus … sans déplacer le focus ».
- **GREEN (group, on its branch):**
  - covering tests `Tests 103 passed (103)`;
  - web project `Test Files 80 passed (80)`, `Tests 1378 passed (1378)`;
  - lint and typecheck clean.
  - E2E `arrival` (Chromium, WebKit): 2 failed, both at `support/flows.ts:81` (`completeOnboardingViaUi`), the known P7/P15 baseline of this lane. Both browsers passed `createAccountViaUi`, which ticks the checkbox by its label.

### Group 2 (F2, F13, F14, F15): emergency box readable in Clair, 404 press feedback, offline card, Carnet headings

Only `features/public/public.module.css` and the new `test/app/public-styles.test.ts` (11 tests, node environment, `test/support/css-blocks`).
- **F2, emergency box.**
  - `.emergency` tint mixed with `var(--surface)` instead of transparent.
  - `.emergencyCall:hover` now thickens the border (`box-shadow: inset 0 0 0 1px var(--danger)`) instead of adding an 8 % tint.
  - Clair and Auto light measure 4.93:1 at rest and on hover.
  - The test layers page `--bg`, the box tint and the button or hover background. It checks the danger text at rest and on hover, and `--text` on the box, in the 6 renders (Auto light, Auto dark, Clair, Sombre, Carnet, Nuit).
- **F15, press feedback.** `.homeLink` transitions transform and background-color, and `:active` scales to 0.98. Under reduced motion only the background changes, and `:active` has `transform: none`.
- **F14, offline card.** `.offline` shares the `.card` rules: base rule `.card, .offline`, theme rules `:is(.card, .offline)` to satisfy biome's noDescendingSpecificity. Its hard-coded 16 px radius, border and background are removed.
- **F13, Carnet headings.** `:root[data-theme="carnet"] .section h2 { font-weight: 600 }`, as in admin.
- **RED (group):**
  - `Tests 7 failed | 4 passed (11)`: `homeLink:active` undefined, reduced motion undefined, `.offline : 16px` radius, Carnet h2 undefined, emergency `4.47:1` in Auto clair and Clair.
  - A second RED step, after fixing only the tint: hover still failed at `4.41:1`.
- **GREEN (group):**
  - 11/11;
  - web project 81 files and 1384 tests in runs 1 and 3. Run 2 had one failure in `profile-page.test.tsx`, which passed alone 3/3 and in run 3. It is unrelated: the change is CSS only;
  - lint and typecheck clean;
  - the build's compiled CSS contains the new rules.

### Group 3 (F3, F6, F10, F11, F18): 404 brand, announced offline region, VoiceOver lists, step chips at 4.5:1

- **F3, step chips.** `auth.module.css`: 10 % tint on `.stepNumber` and `.stepIcon` (it was 12 %). Contrast: Clair 4.60, Carnet 5.59, Sombre 9.11, Nuit 9.36. New `test/auth/auth-styles.test.ts` (node environment): same tint and ink on both chips, color-mix computed for the 6 renders, 4.5:1 for the number and 3:1 for the icon.
- **F11, VoiceOver lists.** `role="list"` on the steps `<ol>` (`InstallSteps.tsx`, so the invitation gets it too) and on the « Numéros utiles » `<ul>` (`HelpPage.tsx`), each with a `biome-ignore lint/a11y/noRedundantRoles` comment.
- **F10, « Hors ligne » announced.**
  - The `role="status"` `.offlineSlot` is always rendered, empty while online. The card (`enter-up` + `.offline`) enters inside it when offline.
  - `:global(.stagger) > .offlineSlot { animation: none }` takes the region out of the cascade.
  - `.offlineSlot:empty { margin-top: -20px }` cancels the flex gap, so the online 404 stays centred.
- **F6, 404 brand.**
  - NotFound shows a brand link to `/`, named « Rune », with `RuneMark` (glow in dark) and `RuneWordmark`.
  - It is hidden at `WIDE_QUERY` (900 px and wider), where the side nav already carries the brand.
  - `.brand` copies shell `.brand`.
- **F18, stale field error.**
  - The existing test is renamed « erreur corrigée : le compte est créé ».
  - New `it.each`, two cases where a network refusal follows a corrected local error: « 12 caractères au moins. » corrected in its own field, and « ne doit pas contenir ton pseudo » corrected from Pseudo. Each checks the alert « Nécessite le réseau », no `aria-invalid` on Mot de passe, and the message gone from the description and from the page.
  - A network refusal was chosen because after g1 a 409 lands under Pseudo. The second case exists because g1's clear-on-typing would hide the first.
  - No source change was needed: the code already replaced the error state. This was a test gap.
- **Tests:**
  - `public-pages.test.tsx`: the 3 lists carry `role="list"`; the region exists empty, is the same node once offline and is empty again online; the empty margin equals minus the `.notFound` gap; the brand on a phone and in dark; a single brand link at ≥ 900 px; `.brand` equals shell `.brand`.
  - `invite.test.tsx`: the F18 `it.each`.
- **RED (group):**
  - F3: `.stepNumber #1c6fb5 sur #e4eef6 : 4.48:1` (Auto clair, Clair).
  - F11: `expected [Array(3)] to deeply equal [['OL','list'],…]`.
  - F10: « Unable to find an accessible element with the role "status" », and `expected undefined to be '-20px'` with HEAD's CSS.
  - F6: « Unable to find … link and name "Rune" » and `expected null to deeply equal Map{…}`.
  - F18, by mutation in `CreateAccountForm.tsx`: merging instead of replacing the errors made both cases fail with `expected 'true' to be null`, while the old success test still passed. The group also checked it against g1's sources.
- **GREEN (group):**
  - covering tests 87 passed;
  - web package 81 files and 1389 tests;
  - lint and typecheck clean;
  - g1 + g2 + g3 merged on a detached HEAD: auth tests, public-pages and public-styles gave 7 files, 171 tests.

### Final runs on `ec5ce8a` (C:\Users\eliott.colin\rune-ecrans)

- After resolving the conflicts, `pnpm exec vitest run --project web apps/web/test/app apps/web/test/auth` gave `Tests 345 passed (345)`.
- `pnpm lint`: `Checked 549 files in 364ms. No fixes applied.` (exit 0)
- `pnpm typecheck`: exit 0 (contracts, domain, server, web).
- `pnpm test`: `Test Files 189 passed (189)`, `Tests 2616 passed | 2 skipped (2618)`, exit 0. Nothing on stderr, no warning. The 2 skipped are environmental and older than this round: `apps/server/test/dev/ports.test.ts` `skipIf(!hasIpv6Loopback)`, and the service-worker skip.
- E2E: not run on the integrated branch. No spec covers the 404, Aide or Crédits. The account-creation path (F12 checkbox name) was checked by g1 in `arrival` on both browsers, up to the known onboarding baseline at `support/flows.ts:81` (P7/P15, until merge 2 brings T7).
- `git status`: clean. `git show --stat HEAD` (`ec5ce8a`): `public-pages.test.tsx` 138 lines changed and `invite.test.tsx` +28, i.e. 97 insertions and 69 deletions.
- Cleanup: worktrees `rune-ecrans-fix-T13-r1-g1/g2/g3` removed with `git worktree remove --force`. The folders left behind held only `node_modules`, and I deleted them. Branches `fix/T13-r1-g1/g2/g3` deleted (they were at `74ee17d`, `b8d8f01`, `d339093`).

### Findings

- Addressed and surviving integration (15): T13-F1, F2, F3, F4, F6, F8, F10, F11, F12, F13, F14, F15, F17, F18, F19.
- Not addressed: none.

### Concerns (from the groups, not changed in this round)

1. F17: the 404 offline check covers `unknown` and `protocol_unsupported`. `unauthenticated` and `account_deleted` never reach the 404, because the guard sends them to /login.
2. F6: a 404 rendered inside PublicShell on a wide screen (no side nav) would show no brand. That path is practically unreachable, because unknown paths go through AppShell or are redirected by the guard.
3. F14: in Clair the offline card keeps the shared `.card` border, as the finding asked. The A06 Clair mockup shows none there.
4. g2 left out a toolkit helper that would let a Link carry `.button .primary`, because it would touch the shared `ui/`.
5. g2 saw one flaky failure in `test/profile/profile-page.test.tsx` under load (an extra warning banner). It passed in every other run, and in my full run.
6. E2E on this lane still stops at onboarding until merge 2 (T13 concern 2).

Review package: `C:\Users\eliott.colin\rune-ecrans\.superpowers\sdd\2026-10-13-refonte-rune\review-ce5f34e..ec5ce8a.diff` (5 commits).
