# Task 33 report: Écrans d'administration (issue #34)

Status: DONE_WITH_CONCERNS (one helper file beyond the plan's file list, see Concerns)
Commit: 7260f0f feat(admin): écrans membres, invitations, salles et état du serveur (on `socle`, not pushed)

## What I implemented

Routes `/admin/members`, `/admin/invitations`, `/admin/gyms`, `/admin/health` added to `ConnectedRoutes` in `App.tsx`; the existing guard (`resolveGuard`) already answers « Page introuvable » to a non-admin, with no `/api/admin` request (tested).

- `AdminNav.tsx`: `<nav aria-label="Administration">` with Membres · Invitations · Salles · État du serveur, `aria-current="page"` on the current screen. Rendered under the h1 of each admin page.
- `MembersPage.tsx` (02 §6, P-ADM-1): real `<table>` in a keyboard-scrollable labelled `<section>` (caption « Membres du cercle », visually hidden). One `tr` per member named by its pseudo (`aria-labelledby` on the pseudo span, so the « mineur » badge is not part of the row name). Columns: Pseudo (+ badge « mineur »), Rôle (« admin »/« membre »), Statut (« actif »/« désactivé »), Dernière connexion (`formatDateTime` or « Jamais connecté »), Onboarding (« Onboarding terminé »/« Onboarding en cours »), Accord santé, Accord coach (`consents.health`, `consents.aiCoach` as « oui »/« non »), Actions. Nothing else from the member is shown; only `/api/admin/members` is read.
  Row actions, each through a confirmation dialog, online only (offline → « Nécessite le réseau »), list reloaded after every success, focus returned to the trigger (or to the table when the row disappeared):
  - « Lien de réinitialisation » → dialog « Générer un lien de réinitialisation » (spec 02 §5 label) → « Générer » → POST reset-link (200). Link, code, expiry and « Copier » (copies the link) shown once, with « Ce code ne sera plus affiché. »; « J'ai transmis le lien », Échap or closing discard them (they live only in the dialog's state). 403 `reset_self_forbidden` → « Pour toi-même, utilise la commande admin:reset sur le serveur. »
  - « Fermer les sessions » → POST revoke-sessions `{}` (text gives the open-session count from `activeSessions`).
  - « Désactiver » / « Réactiver » → POST status `{ status: 'disabled' | 'active' }` (R-ADM-1 text, Tailscale reminder).
  - « Promouvoir administrateur » / « Rétrograder » → « Ton mot de passe » required → POST role `{ role, password }`; 401 `invalid_credentials` → « Mot de passe incorrect. »; 409 `last_admin` → « Il doit rester au moins un administrateur actif. »; 429 `rate_limited` → « Trop de tentatives. Réessaie dans N min. » (reuses `loginErrorMessage`).
  - « Corriger la date de naissance » → POST birth-date `{ birthDate }`; 400 `under_min_age` → « appsport est réservé aux 16 ans et plus ».
  - « Supprimer » → « Supprimer définitivement » disabled until « Tape le pseudo pour confirmer » matches (compared with `usernameKey`, like the server) and « Ton mot de passe » is filled → `AdminRepo.deleteMember(id, typedPseudo, password)`; wrong password → « Mot de passe incorrect. », dialog kept.
- `InvitationsPage.tsx` (R-INV-1 to R-INV-9): form « Date de naissance » (required, local message « Saisis la date de naissance. » linked to the field, focus) and « Note (facultative) » (`maxLength` = `INVITATION_NOTE_MAX`, trimmed, omitted when empty) → « Créer l'invitation » → POST `{ birthDate, note? }`. The created panel (focused on mount) shows code, link, expiry, the R-INV-9 share message (`data-testid="share-message"`, selectable as a manual fallback), « Partager » (`navigator.share({ text })`, only when available; an AbortError is silent) and « Copier le message » (always, `CopyButton`), « Ce code ne sera plus affiché. », « J'ai noté le code » (panel removed, focus back to the form heading). List « Invitations envoyées »: note (or « Sans note »), « Créée le JJ/MM/AAAA », state « En attente (expire le …) » / « Utilisée par <pseudo> » (« un ancien membre » when null) / « Révoquée » / « Expirée »; « Révoquer » on pending only, confirmed, then reload.
- `share-message.ts`: `buildInvitationShareMessage(origin, link, code)` exactly as the brief (3 steps, link on the last line; `INVITATION_TTL_DAYS` for the 7). The page passes `window.location.origin` (no origin literal in `src/`).
- `AdminGymsPage.tsx` (02 §6, R-SAL-4, R-SAL-7): « Rechercher une salle » → `useRepos().gyms.search(q)` (GET `/api/gyms?q=`), latest search wins. Each gym: name (link to `/gyms/:id`, where equipment is edited), « Ville · N membres visibles », « Modifier » (dialog « Nom de la salle »/« Ville », 2 to 60 characters checked locally, only changed fields sent via `useRepos().gyms.update` → PATCH `/api/gyms/:id`), « Supprimer » (confirmed → `AdminRepo.deleteGym` → DELETE `/api/admin/gyms/:id` `{}`; 409 `gym_in_use` → « Des membres ont encore cette salle parmi leurs lieux : elle ne peut pas être supprimée. »).
- `ServerHealthPage.tsx` (08 §9): exports `BACKUP_LATE_MS = 26 * 3_600_000`, `DISK_WARN_PCT = 80`. Shows « Version en service : vX », « Dernier déploiement : vX le JJ/MM/AAAA (réussi|échoué) », « Dernière sauvegarde : il y a N h (réussie|échouée) », « Dernier test de restauration : JJ/MM/AAAA (réussi|échoué) », « Dernier contrôle de l'hôte : il y a N h », each with « aucun(e) » when absent; section « Hôte »: list « Espace disque » (`/ : 42 %`, `… (au-delà de 80 %)` when `usedPct > 80`), « SMART : OK »/« SMART : problème détecté », « Redémarrage nécessaire ». Banner warning « Sauvegarde en retard (plus de 26 h) » when `now − backup.at > BACKUP_LATE_MS` (strict), Banner error « La dernière sauvegarde a échoué. Détail : … » when `backup.ok` is false. `opsStatus: null` → « Aucun état d'exploitation disponible : les scripts de l'hôte n'ont encore rien écrit. » `now` from `useServices().now`.
- `admin-ui.tsx` (shared by the four pages): `ActionDialog` (confirmation dialog; confirm button submits the dialog's form so Enter works; Annuler/Échap blocked while sending; error kept in the dialog; on success the caller's `onConfirm` has reloaded the list, then the dialog closes; stable close callback so the shared `Dialog` does not re-grab focus on each keystroke), `useServerData` (online read with « Réessayer », latest request wins, stale responses ignored), `LoadFailure`, `useRestoreFocus`, `adminErrorMessage` (screen overrides, `rate_limited` in minutes), `WRONG_PASSWORD_MESSAGE`, `SECRET_SHOWN_ONCE`.
- `admin.module.css`: nav, table (horizontal scroll inside its own region on phones), badge, cards, one-time secret panel, share message, health facts. Theme tokens from `ui.module.css`, so dark mode follows.

Rulings honoured: straight apostrophe in all UI copy; screens use only `useRepos()` (architecture test green); no `navigator.onLine`; admin actions online only; delete = pseudo + admin password; role change = admin password, `last_admin` explicit; reset link POST 200, link/code shown once and never stored; invitations with birth date + note ≤ 60, R-INV-9 message with link last, copy fallback, revoke; health page with version, backup age and « Sauvegarde en retard » after 26 h, disks, reboot; `aiCoach` key; only `/api/admin` (and the members-visible `/api/gyms`) data shown; 429 → « Réessaie dans N min ».

## Tests

New: `apps/web/test/admin/members.test.tsx` (20), `invitations.test.tsx` (13), `gyms-health.test.tsx` (14), 47 tests. Highlights: exact cell contents of a row (no other C1 to C3 data), column headers, reset link shown once then gone (and after Échap, and on reopen), clipboard receives the link, every POST path and body, reload after each success (dialog closes only after the reload), `last_admin`, `invalid_credentials`, `rate_limited` with `retryAfterS: 90` → « 2 min », `under_min_age`, delete button gating (pseudo and password), tolerant pseudo (`'LEA '` → sends `'LEA'`), focus returned to the trigger and to the table after a deletion, member on `/admin/members` → « Page introuvable » and no `/api/admin` call, nav links and `aria-current`, navigation to the four routes, invitation states, share message equality, `navigator.share` call and silent abort, copy fallback without `share`, empty note omitted, required birth date, offline « Nécessite le réseau » + « Réessayer » on each page, gym search query, PATCH only changed fields, local length check, `gym_in_use`, health thresholds (26 h exactly not late, 28 h late, 80 % not over, 81 % over), failed backup banner with detail, failed deploy/test/SMART, absent checks, `opsStatus: null`.

Mutation check: disabling the focus return in `useRestoreFocus` makes « Annuler ferme sans requête et rend le focus au bouton d'origine » fail (restored afterwards).

## TDD evidence

RED (tests written first, no admin source yet):

```
$ pnpm --filter @appsport/web test admin/
 FAIL  |web| test/admin/gyms-health.test.tsx [ apps/web/test/admin/gyms-health.test.tsx ]
Error: Failed to resolve import "../../src/features/admin/AdminGymsPage" from "test/admin/gyms-health.test.tsx". Does the file exist?
 FAIL  |web| test/admin/invitations.test.tsx [ apps/web/test/admin/invitations.test.tsx ]
Error: Failed to resolve import "../../src/features/admin/InvitationsPage" from "test/admin/invitations.test.tsx". Does the file exist?
 FAIL  |web| test/admin/members.test.tsx [ apps/web/test/admin/members.test.tsx ]
Error: Failed to resolve import "../../src/features/admin/MembersPage" from "test/admin/members.test.tsx". Does the file exist?
 Test Files  3 failed (3)
      Tests  no tests
```

Expected: the brief's Step 2 says « modules introuvables ».

First GREEN attempt: 41 passed, 5 failed, all the same test race (asserting the dialog closed right after the reload request was sent, while the dialog closes only once the reload has answered). I fixed the tests to wait for the dialog to close and then assert the reload count, which is the stronger check (reload before close). No product change was needed for these.

GREEN:

```
$ pnpm --filter @appsport/web test admin/
 Test Files  3 passed (3)
      Tests  47 passed (47)
```

Before committing (output pristine, no stderr or act warnings):

```
$ pnpm lint        → Checked 370 files in 201ms. No fixes applied.
$ pnpm typecheck   → contracts, domain, server, web: tsc --noEmit, no errors
$ pnpm test        → Test Files  132 passed (132) ; Tests  1491 passed | 2 skipped (1493)
```

## Files changed

- Modified: `apps/web/src/App.tsx` (4 imports, 4 routes)
- Created: `apps/web/src/features/admin/{MembersPage.tsx, InvitationsPage.tsx, AdminGymsPage.tsx, ServerHealthPage.tsx, AdminNav.tsx, share-message.ts, admin.module.css, admin-ui.tsx}`
- Created: `apps/web/test/admin/{members,invitations,gyms-health}.test.tsx`

`git show --stat HEAD`: 12 files, 2177 insertions; `git status` clean after the commit.

## Self-review

- Completeness against the brief, the spec (02 §5, §6, R-ROLE-2/4, R-INV-1 to 3, 7, 9, R-RST-3/4, R-ADM-1, R-AGE-4, R-SUP-2, R-SAL-7; 08 §9; 03 P-ADM-1, P-AUT-5, P-DRT-3) and the controller rulings: covered as listed above.
- Focus: dialogs keep a stable close callback (the shared `Dialog` re-runs its focus effect when `onClose` changes, which would otherwise steal focus from the password field on each keystroke); focus returns to the trigger, or to the table / list heading / search field when the trigger disappeared; the reset and invitation secret panels take focus when they appear.
- Secrets: reset link/code live only in the reset dialog's state; invitation code/link only in `InvitationsPage` state until « J'ai noté le code ». Nothing written to Dexie, meta or storage.
- YAGNI: no special handling of self-demotion or self-disabling (server rules apply, see Concerns).

## Concerns

1. Extra file `apps/web/src/features/admin/admin-ui.tsx`, not in the plan's file list: the confirmation dialog, data loader, failure block, focus return and error-message helper are shared by the four pages, so one cohesive file rather than four copies.
2. The password dialogs (role, delete) and the other confirmations go through `ActionDialog`, which keeps its own pending/error state instead of `useAction`: the 429 message needs `body.retryAfterS` and `useAction` only accepts static override strings. The reset-link dialog and the invitation form do use `useAction`.
3. Labels: the row button is « Lien de réinitialisation » and the confirm button is « Générer » (brief), and the dialog title is « Générer un lien de réinitialisation » (spec 02 §5).
4. The reset button is also shown on the admin's own row; the server's 403 `reset_self_forbidden` gives the admin:reset message (R-ROLE-4: the UI only hides). If an admin demotes or disables themselves while another admin exists, the page stays open and the next reload shows « Cette action n'est pas autorisée. » until `/api/me` refreshes. I added no special case.
5. AdminGymsPage uses `GymsRepo.search` (GET `/api/gyms?q=`, as the brief says). `AdminRepo.gyms()` (GET `/api/gyms`) stays unused by the screens.
6. Small additions beyond the brief's texts on the health page: « Dernier contrôle de l'hôte : il y a N h » (so disk figures are dated), the backup `detail` in the failure banner, and disk percentages shown rounded up (`Math.ceil`) so a value just over 80 % never displays as « 80 % (au-delà de 80 %) ».
7. Observation outside this task: `LogoutDialog` passes an inline `onClose` to `Dialog`, so any re-render of its parent while it is open re-focuses the dialog container. It is harmless there (no input fields), but it is worth knowing for T34's dialogs that contain password fields.

---

## Fix round 1 (review findings, 2026-10-08)

Status: DONE. Base 7260f0f, 11 commits on `socle` (not pushed), each ending with `Refs #34` and the Co-Authored-By trailer:

```
c6c1674 fix(admin): garde des routes admin insensible à la casse                                        (T33-F1)
7a7428e fix(admin): se rétrograder soi-même ou perdre ses droits ferme l'administration                 (T33-F2)
0c9fa26 test(admin): une action confirmée ne part qu'une fois et le dialogue reste ouvert pendant l'envoi (T33-F3)
e60f1ac test(admin): partage annulé vérifié après le refus, partage refusé testé                         (T33-F4)
86da22c fix(admin): copie refusée ou presse-papiers absent, consigne et sélection d'un geste              (T33-F5, T33-F18)
9d69391 fix(admin): état du serveur, sauvegarde absente signalée et âge en heures sous 72 h              (T33-F6, T33-F14, T33-F21)
39b1f1b fix(admin): pas de nouvelle invitation tant que le code affiché n'est pas noté                   (T33-F8)
f1c559b fix(admin): élément changé entre-temps, la liste est relue                                       (T33-F9)
5ee26ec fix(admin): dialogue neuf pour chaque membre et focus gardé dans les dialogues                   (T33-F10)
dd68822 fix(admin): « Chargement… » pendant la première lecture des écrans admin                         (T33-F17)
30484af test(admin): code d'invitation et lien de réinitialisation ni gardés ni journalisés              (T33-F19)
```

### Changes per finding

- **T33-F1** `App.tsx`: `isAdminPath` lowercases the path, because wouter (regexparam) matches routes with the `i` flag. Tests: guard rows `/Admin/members`, `/ADMIN/health` and `/ADMIN` give `not_found`. `members.test.tsx` renders the app as a member on `/Admin/members`, `/ADMIN/health` and `/admin/Invitations` and expects « Page introuvable » with no `/api/admin` call (paths compared in lowercase).
- **T33-F2** `MembersPage.tsx` `RoleDialog`: when the target is the current user (`useMe()`), a successful role change calls `repos.me.refresh()` instead of reloading the list. The guard then answers « Page introuvable » and the « Administration » link disappears. Backstop in `useServerData`: a 403 `forbidden` drops the displayed data and refreshes `me`, for an admin whose rights were removed by another admin. StatusDialog is unchanged: disabling yourself revokes your sessions, so the next call gets 401 and the existing `onUnauthenticated` path takes over (the three verifier votes reached the same conclusion). Tests: self-demotion via `renderApp` (POST 204 → « Page introuvable », no table, no forbidden banner, no admin link, list not re-read); a 403 on reload removes the table and requests `/api/me`.
- **T33-F3** tests only, since the guards were already there: delete dialog with a held reply and `fireEvent.submit` twice → one POST, both buttons disabled, Échap leaves the dialog open, and the reply closes it. Double click on « Générer » → one reset-link POST, Échap ignored while pending. Double submit of the invitation form → one POST.
- **T33-F4** the « partage annulé » test now awaits `settle()` before asserting that there is no alert and that the code is still shown. New test: a `NotAllowedError` gives the alert « Partage impossible : copie le message. », and the share message and « Copier le message » stay.
- **T33-F5 / T33-F18** `CopyButton` gets an optional `onResult(copied)`; existing callers are unchanged. Invitation panel: a refused or missing clipboard shows « Copie impossible : sélectionne le message et copie-le. » in the same banner slot as the share failure. Reset dialog: « Copie impossible : sélectionne le lien et copie-le. ». CSS: `-webkit-user-select: all` added to `.message`; `.secret` (code and link spans on both screens) gets `-webkit-user-select: all; user-select: all`. Tests on both screens use `it.each(['refusé', 'absent'])` (writeText rejecting with `NotAllowedError`, or `navigator.clipboard` undefined and restored in `afterEach`) and check the « Copie impossible » button, the instruction alert, and that code, link and message are still displayed.
- **T33-F6** `ServerHealthPage`: when `ops` is present without `backup`, a warning Banner shows « Aucune sauvegarde enregistrée » (`NO_BACKUP`). Test with `{ deploy, host }`; the full-status test checks the banner is absent.
- **T33-F8** `InvitationForm` gets `blocked` (a created code is still displayed). « Créer l'invitation » is then disabled, with `aria-describedby` pointing to « Note d'abord le code affiché, puis appuie sur « J'ai noté le code ». », and submit is guarded too. Test: button disabled with the hint, submitting the form sends nothing and the code stays, and « J'ai noté le code » re-enables the button.
- **T33-F9** `admin-ui.tsx`: `isStaleError` covers `conflict`, `not_found` and `validation`. `ActionDialog` takes a required `reload`, calls it on such an error and keeps the message. For `conflict` the message is « L'élément a changé entre-temps : la liste est relue. ». Every ActionDialog passes its page's reload, and `ResetLinkDialog` also reloads on a stale error. Tests: revoke-sessions 404 and delete 400 keep the message, re-read the list (the renamed member is shown) and leave the dialog open; reset-link 404 re-reads the list; 409 `last_admin` does not reload; invitation revoke 409 shows the new state; gym delete 404 re-reads the list.
- **T33-F10** `MemberDialog` is keyed by `${kind}:${member.id}`. Shared `Dialog`: Tab and Maj+Tab wrap inside the modal, focus that has left it comes back, and elements in the middle are left to the browser (disabled buttons and `tabindex=-1` are skipped). Tests: opening « Rétrograder » on bastien while lea's role dialog holds a typed password gives a fresh dialog with an empty password and a disabled confirm button; focus-trap test in `ui.test.tsx`.
- **T33-F14** the backup age is shown in hours below 72 h (`il y a 28 h` under the late banner) and in days beyond (`il y a 3 j`). The host-check age is unchanged because it has no late banner. Tests updated and added.
- **T33-F17** `useServerData` exposes `loading` (no data and no error yet). The four pages render `<p role="status">Chargement…</p>`. One held-reply test per page; the offline test checks that « Chargement… » is not shown.
- **T33-F19** tests: after a remount the invitation code is gone, `localStorage` and `sessionStorage` are empty, no Dexie table contains the code, and no `console.log/info/warn/error/debug` call contains it. The same checks run for the reset link and code after « J'ai transmis le lien ».
- **T33-F21** test: disk at 80.2 gives « / : 81 % (au-delà de 80 %) » and disk at 79.6 gives « /srv/appsport : 80 % ».

### TDD evidence

RED runs (each test written and run before its fix):

```
$ pnpm --filter @appsport/web test admin/members app/guard            (F1)
     × /Admin/members, chargé true, …   × /ADMIN/health, …   × /ADMIN, …
     × un membre sur /Admin/members (casse différente, que wouter accepte) …  Unable to find role="heading" and name "Page introuvable"
     × un membre sur /ADMIN/health …
AssertionError: expected { kind: 'render' } to deeply equal { kind: 'not_found' }
      Tests  5 failed | 48 passed (53)       (/admin/Invitations already passed: the prefix check matched it)

$ pnpm --filter @appsport/web test admin/members                      (F2)
     × se rétrograder soi-même … Unable to find role="heading" and name "Page introuvable"
     × droits retirés ailleurs … AssertionError: expected <table …> to be null
      Tests  2 failed | 23 passed (25)

$ pnpm --filter @appsport/web test admin/                             (F5/F18)
     × presse-papiers refusé|absent … (×2 per screen)  Unable to find role="alert"
      Tests  4 failed | 56 passed (60)

$ pnpm --filter @appsport/web test admin/gyms-health                  (F6, F14)
     × sauvegarde de plus de 26 h … Unable to find … « Dernière sauvegarde : il y a 28 h (réussie) »
     × aucune sauvegarde enregistrée … Unable to find … « Aucune sauvegarde enregistrée »

$ pnpm --filter @appsport/web test admin/invitations                  (F8)
     × code affiché : « Créer l'invitation » bloqué … AssertionError: expected false to be true
      Tests  1 failed | 17 passed (18)

$ pnpm --filter @appsport/web test admin/                             (F9)
     × salle déjà supprimée (404) … until: condition jamais remplie
     × invitation utilisée entre-temps (409 conflict) … Unable to find « L'élément a changé entre-temps : la liste est relue. »
     × « Fermer les sessions » / « Supprimer » refusé … Unable to find role="row" and name "lea2"
     × lien de réinitialisation, membre supprimé entre-temps (404) … until: condition jamais remplie
      Tests  5 failed | 65 passed (70)

$ pnpm --filter @appsport/web test admin/members app/ui               (F10)
     × même action ouverte sur un autre membre … expected 'mon mot de passe admin' to be ''
     × Dialog : Tab et Maj+Tab restent dans le dialogue … expected true to be false
      Tests  2 failed | 43 passed (45)

$ pnpm --filter @appsport/web test admin/                             (F17)
     × lecture en cours : « Chargement… » … (members, invitations, gyms, health)   Test Files  3 failed (3)
```

For the test-only findings the behaviour was already correct, so a plain RED would not show anything. The new tests passed against the existing code. Each one was then shown to fail against a mutation of the code it guards; the source was restored afterwards and the diff checked clean:

```
F3  M1 ActionDialog submit without busy.current      → × envoi en cours … expected [ …(2) ] to have a length of 1 but got 2
    M2 ActionDialog close ignoring busy              → × envoi en cours … Unable to find role "dialog"
    M3 « Générer » without disabled={pending}        → × double clic sur « Générer » … expected [ {}, {} ] to have a length of 1 but got 2
    M4 invitation form without create.pending guard  → × double envoi du formulaire … got 2
F4  AbortError filter removed, test as of HEAD       → 1 passed (vacuous, as reported)
    same mutation, test with settle()                → × partage annulé … expected <div role="alert" …> to be null
    non-abort error swallowed                        → × partage refusé … Unable to find role="alert"
F5  CopyButton without its catch                     → × presse-papiers … (4 tests) + 4 Unhandled Rejections
F19 code kept in sessionStorage                      → × code ni gardé … expected 1 to be +0
    code passed to console.info                      → × … expected 'invitation créée ABCD-…' not to contain 'ABCD-EFGH-JKMN-PQRS'
    reset link passed to console.debug               → × lien et code ni gardés … not to contain 'ABCD-EFGH-JKMN-PQRS'
F21 Math.ceil → Math.round                           → × pourcentages arrondis … expected [ '/ : 80 % (au-delà de 80 %)', …] to deeply equal [ '/ : 81 % …' ]
```

GREEN (covering tests after each fix): `pnpm --filter @appsport/web test admin/` passes 3 files and 77 tests at the end. `app/guard`, `app/ui`, `auth/` and `places/` (the other Dialog and CopyButton consumers) are green.

### Final checks

```
$ pnpm lint        → Checked 370 files in 211ms. No fixes applied.
$ pnpm typecheck   → contracts, domain, server, web: tsc --noEmit, no errors
$ pnpm test        → Test Files  132 passed (132) ; Tests  1525 passed | 2 skipped (1527)   (was 1491: +34)
                     no stderr, no act or React warnings in the output
$ git status       → clean
$ git diff --stat 7260f0f HEAD → 14 files changed, 685 insertions(+), 41 deletions(-)
```

### Notes

- Two shared UI files changed, both backward compatible: `ui/CopyButton.tsx` (optional `onResult`) and `ui/Dialog.tsx` (Tab trap). The Tab trap applies to every dialog in the app, as F10 asked; the auth and places suites stay green.
- `ActionDialog.reload` is now required, so a future admin dialog cannot leave out the stale-row reload.
- During one mutation check, restoring `CopyButton.tsx` with `git checkout` briefly undid my uncommitted change. I put the change back, re-ran the tests and checked the diff before committing. The later mutation checks restored from file backups.
