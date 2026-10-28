# Task 32 — Profil, lieux et fiche de salle (issue #33)

Status: DONE_WITH_CONCERNS
Commit: 1e92df0 `feat(salles): profil, lieux et fiche de salle` (Closes #33), on `socle`, not pushed. Base 731b945.

## What I implemented

### `features/profile/ProfilePage.tsx` + `profile.module.css` (route `/profile`)
- `Page` « Profil », sections h2 nommées (`region`) : « Compte », « Mot de passe », « Entraînement », puis `nav` des liens.
- Compte : champ « Pseudo » (brouillon, sinon `me.username`), `validateUsername` local → `USERNAME_MESSAGES` ; « Enregistrer le pseudo » (désactivé tant que rien ne change) → `repos.me.updateUsername` (PATCH /api/me { username }) → « Pseudo enregistré. ». Erreurs : `accessErrorMessage` (username_invalid avec motif, `username_taken` → « Ce pseudo est déjà pris. », hors ligne → « Nécessite le réseau »). « Date de naissance » `readOnly` `JJ/MM/AAAA`, aide « Seul l'administrateur peut la corriger. » (R-CPT-3, P-DRT-2). « Se déconnecter » → `LogoutDialog current`, « Déconnecter tous mes appareils » → `LogoutDialog all` (R-AUTH-7, R-AUTH-9).
- Mot de passe : « Mot de passe actuel », `PasswordFields` label « Nouveau mot de passe » + « Confirmation », « Changer le mot de passe ». Contrôle local (`checkNewPassword`, 14 caractères pour un admin ; actuel vide → « Saisis ton mot de passe actuel. »), puis `repos.me.changePassword` (POST /api/auth/password). Réussite : champs vidés, « Mot de passe changé. Tes autres appareils ont été déconnectés. ». 401 `invalid_credentials` → « Mot de passe actuel incorrect. » ; `rate_limited` → `loginErrorMessage` ; `password_rejected` → motif via `accessErrorMessage`.
- `mustChangePassword` (R-MDP-1) : `Banner` warning « Ton mot de passe doit être changé avant de continuer (14 caractères au moins pour un administrateur). » et seule la section Mot de passe. Le bandeau suit `useMe()` ; `MeRepo.changePassword` fait `refresh()` (GET /api/me) puis `syncNow('manual')` → bandeau absent, sections visibles. Les sections gardent leur place dans l'arbre (enfants `null`), donc le formulaire du mot de passe reste monté et garde son message de réussite.
- Entraînement : résumé `dl` (Objectif, Sport (« Aucun » sans sport, libellé libre pour « Autre »), Niveau, Disponibilité « 3 séances de 45 min » ; « Non renseigné » sinon), un bouton « Modifier l'objectif » / « Modifier le sport » / « Modifier le niveau » / « Modifier la disponibilité » par ligne. Chaque bouton remplace le résumé par l'écran T31 en `mode="edit"` (`onNext` et `onBack` ferment). L'éditeur est dans `StepTitleContext` avec `progressId` = id du titre « Entraînement » : le titre de l'écran prend le focus à l'ouverture (nommé « Entraînement <titre> ») ; à la fermeture, le focus revient au bouton « Modifier … » (`data-editor`). Objectif sportif sans sport : `GoalStep` enchaîne `SportStep pendingGoal` → un seul PATCH { goal, sportCode, sportOtherLabel } (comportement T31, testé ici dans le Profil).
- Mode prudent : `CautiousModeToggle` (imposé pour un mineur), PATCH { cautiousMode } au changement ; le choix reste affiché jusqu'à la relecture du miroir, un échec (hors ligne) le remet et affiche « Nécessite le réseau ».
- Liens : « Lieux » /profile/places, « Santé » /profile/health, « Confidentialité » /profile/privacy, « Réglages » /settings (les trois derniers arrivent avec T34 ; d'ici là, NotFound).

### `features/places/PlacesPage.tsx` (route `/profile/places`)
- Liste `repos.places.list()` (principal d'abord), chaque lieu : nom en lien vers `/profile/places/:id`, badge « Principal », « Salle · Lyon » ou « Maison ». Boutons décrits par le nom du lieu (`aria-describedby`).
- « Définir comme principal » (absent sur le principal) → PATCH { isPrimary: true }.
- « Renommer » (maison seulement : le serveur refuse `name` sur une salle) → champ « Nom du lieu » `maxLength` 30 (`PLACE_NAME_MAX`), « Enregistrer » / « Annuler » ; nom vide → « Donne un nom à ce lieu. » ; inchangé → fermeture sans requête.
- Salle : case « Visible à la salle » (aide « Ton pseudo apparaît dans « Qui va à cette salle ». ») → PATCH { visibleAtGym } ; mineur : la case reste au choix, avec « Désactivé par défaut pour les moins de 18 ans. » (`MINOR_VISIBILITY_HINT` de T31). Le choix reste affiché jusqu'à la relecture du miroir ; un échec le remet.
- « Supprimer » → `Dialog` « Supprimer <nom> ? » (« Le lieu sera retiré de ta liste. Les séances passées y restent rattachées. », R-LIEU-5) ; principal : `ChoiceList` « Nouveau lieu principal » obligatoire → DELETE { newPrimaryId } ; sinon DELETE {}. Un seul lieu : « Supprimer » désactivé, raison « Tu dois garder au moins un lieu. » liée au bouton. Surcharges `last_place` « Tu dois garder au moins un lieu. », `primary_required` « Choisis d'abord un nouveau lieu principal. ».
- « Ajouter une salle » → `GymPicker isPrimary={false} defaultVisible={adulte}` + « Annuler ». « Ajouter une maison » → nom (« Maison » par défaut), préréglage « Ton matériel », `EquipmentChecklist`, « Ajouter la maison » → POST { kind: 'home', name, equipment, isPrimary: false }.

### `features/places/PlaceDetail.tsx` (route `/profile/places/:id`)
- Maison : titre = nom, `EquipmentChecklist kind="home"` ; chaque case → `repos.places.setEquipment` (PUT ou DELETE `/api/places/:id/equipment/:code`, corps `{}` du client) ; liste désactivée pendant l'envoi ; brouillon gardé jusqu'à la relecture du lieu, remis sur échec (« Nécessite le réseau »).
- Salle : ville, matériel de la salle en lecture (`EquipmentList`, aucune case), « Le matériel d'une salle se modifie sur sa fiche, partagée par ses membres. », lien « Voir la salle » → `/gyms/<gymId>`.
- Lieu inconnu : « Lieu introuvable. ».

### `features/places/GymPage.tsx` (route `/gyms/:id`)
- `GYM_HISTORY_LIMIT = 10`, `historyLine(h)` : `formatDateTime(at)` — libellé d'action (`create` « Création de la salle », `update_info` « Nom ou ville modifiés », `add_equipment` « Matériel ajouté : <libellé> », `remove_equipment` « Matériel retiré : <libellé> », `update_load_settings` « Réglages de charge modifiés » ; code illisible → libellé seul) — « modifié par <pseudo> », ou « modifié par un membre » quand `authorUsername` est null (règle du contrôleur, voir écarts).
- Chargement `repos.gyms.detail(id)` (relu après chaque écriture) ; échec sans fiche → « Salle introuvable. » / « Nécessite le réseau » + « Réessayer ».
- Titre = nom, ville. Avec `canEdit` (en ligne) : « Modifier » → « Nom de la salle », « Ville » (2 à 60, « 2 à 60 caractères. »), « Enregistrer » → PATCH avec les seuls champs changés ; matériel en `EquipmentChecklist kind="gym"` → PUT/DELETE `/api/gyms/:id/equipment/:code`. Sans droit : ni « Modifier » ni case, « Seuls les membres qui ont cette salle parmi leurs lieux peuvent la modifier. ».
- « Qui va à cette salle » (section nommée) : liste des pseudos pour tout membre (R-VIS-2), « Personne n'est visible pour l'instant. » si vide ; hors ligne « Liste disponible en ligne ».
- « Dernières modifications » : `ol` d'au plus 10 lignes ; hors ligne « Historique disponible en ligne » ; vide « Aucune modification. ».
- Hors ligne (`offline: true`) : `Banner` « Hors ligne : dernière version connue. », nom et matériel des miroirs en lecture, ni bouton ni case, pas de texte de droits.
- Aucune édition des réglages de charge (brique 3, R-CHG-3).

### Autres
- `App.tsx` : routes `/profile`, `/profile/places`, `/profile/places/:id`, `/gyms/:id` dans `ConnectedRoutes` (donc dans `AppShell`).
- `EquipmentChecklist.tsx` : ajout de `EquipmentList` (matériel en lecture seule, ordre de la taxonomie), partagé par `PlaceDetail` et `GymPage`.
- `places.module.css` : styles des pages de lieux et de salle.

## Tests and results

New: `test/profile/profile-page.test.tsx` (24 tests), `test/places/places-page.test.tsx` (21), `test/places/gym-page.test.tsx` (14).
- Profil : pseudo et date en lecture seule avec aide ; PATCH /api/me { username: 'leo' } + pull ; pseudo invalide local ; hors ligne « Nécessite le réseau » ; 409 → « Ce pseudo est déjà pris. » ; LogoutDialog all (POST logout-all) et current (POST logout) ; mot de passe → POST /api/auth/password { currentPassword, newPassword }, message, champs vidés ; 401 → « Mot de passe actuel incorrect. » ; confirmation différente locale ; mustChangePassword admin : bandeau, seule la section, puis après GET /api/me (false) bandeau absent, Compte, Entraînement et liens visibles, `triggers` contient 'manual' ; admin 13 caractères refusé ; résumé (« Prendre du muscle », « Jamais », « 3 séances de 45 min », « Aucun ») ; objectif → PATCH { goal: 'strength' } ; objectif sportif sans sport → un seul PATCH { goal, sportCode: 'running', sportOtherLabel: null } ; sport → PATCH { sportCode: 'running', sportOtherLabel: null } ; niveau → { experience: 'lt_6_months' } ; disponibilité → { daysPerWeek: 4, sessionMinutes: 60 } ; « Retour » sans PATCH, focus au titre puis au bouton ; mode prudent → { cautiousMode: true }, hors ligne remis ; mineur imposé ; liens ; route /profile dans la coquille.
- Lieux : ordre et badge ; principal → PATCH { isPrimary: true } ; renommer → { name: 'Cave' }, maxLength 30, pas pour une salle ; nom vide local ; visibilité → { visibleAtGym: false } et la case garde le choix ; visibilité hors ligne remise ; mineur avec raison ; hors ligne « Nécessite le réseau » ; suppression maison → DELETE {} ; principal → « Nouveau lieu principal » 'Garage' → DELETE { newPrimaryId: 'p-2' } ; un seul lieu désactivé + raison liée ; 409 last_place et primary_required ; « Ajouter une salle » → POST { kind: 'gym', gymId: 'g-2', isPrimary: false, visibleAtGym: true } ; mineur décoché ; « Ajouter une maison » → POST { kind: 'home', name: 'Garage 2', equipment: [...], isPrimary: false } ; PlaceDetail maison PUT …/dumbbells {} puis DELETE …/chair ; hors ligne remis ; salle : lien /gyms/g-1, aucune case ; lieu inconnu ; routes.
- Salle : `historyLine` (date à Paris, libellés, « un membre », code inconnu), limite 10 ; fiche : titre, 'Lyon', matériel, ['lea','max'], 10 lignes, 1re « un membre », 2e « modifié par lea » + « Matériel ajouté : Barre droite et disques » ; « Modifier » → PATCH { name: 'Basic Fit Part-Dieu' } puis fiche relue ; ville trop courte locale ; Kettlebell PUT, Banc plat DELETE ; sans droit : ni « Modifier » ni case, raison, liste ['lea','max'] ; liste vide → « Personne n'est visible pour l'instant. » ; hors ligne : bandeau, miroir, aucune case, « Liste disponible en ligne », pas « Personne… » ; hors ligne sans miroir → alerte + « Réessayer » ; route /gyms/g-1.

Final runs (after commit content):
- `pnpm --filter @appsport/web test profile/ places/` → `Test Files 4 passed (4)`, `Tests 81 passed (81)`, output pristine.
- `pnpm lint` → `Checked 359 files … No fixes applied.`
- `pnpm typecheck` → all 4 packages clean.
- `pnpm test` → `Test Files 129 passed (129)`, `Tests 1419 passed | 2 skipped (1421)`, no warning or stderr.

## TDD evidence

RED (tests written first, implementation absent):
```
pnpm --filter @appsport/web test profile/ places/places-page places/gym-page
 FAIL  |web| test/profile/profile-page.test.tsx
Error: Failed to resolve import "../../src/features/profile/ProfilePage" from "test/profile/profile-page.test.tsx". Does the file exist?
 FAIL  |web| test/places/gym-page.test.tsx
Error: Failed to resolve import "../../src/features/places/GymPage" from "test/places/gym-page.test.tsx". Does the file exist?
 FAIL  |web| test/places/places-page.test.tsx
Error: Failed to resolve import "../../src/features/places/PlacesPage" ...
 Test Files  3 failed (3)
```
Expected: the three modules did not exist (the brief's Step 2).

First GREEN attempt: 56/57; the mustChangePassword test read « Entraînement » synchronously while the section waits for its live query → test changed to `findByRole` (behavior unchanged). Then GREEN:
```
pnpm --filter @appsport/web test profile/ places/
 Test Files  4 passed (4)
      Tests  80 passed (80)
```

Refinement found in self-review (draft of « Visible à la salle » and of the cautious mode cleared right after success: if the pull after the write failed, the control flipped back although the server had applied it). New assertion first, run against the old line (temporary revert):
```
pnpm --filter @appsport/web test places/places-page
     × « Visible à la salle » décoché → PATCH { visibleAtGym: false } (R-VIS-3) ; pas de case pour une maison
AssertionError: expected true to be false // Object.is equality
      Tests  1 failed | 20 passed (21)
```
Then with the fix (draft kept until the mirror is re-read, cleared on failure): `Test Files 4 passed (4)`, `Tests 81 passed (81)`.

## Files changed (all in 1e92df0, checked with `git show --stat HEAD`)
- A `apps/web/src/features/profile/ProfilePage.tsx`, `apps/web/src/features/profile/profile.module.css`
- A `apps/web/src/features/places/PlacesPage.tsx`, `PlaceDetail.tsx`, `GymPage.tsx`
- M `apps/web/src/features/places/EquipmentChecklist.tsx` (`EquipmentList`), `apps/web/src/features/places/places.module.css`
- M `apps/web/src/App.tsx`
- A `apps/web/test/profile/profile-page.test.tsx`, `apps/web/test/places/places-page.test.tsx`, `apps/web/test/places/gym-page.test.tsx`

## Deviations and rulings applied
1. History author null → « modifié par un membre » (controller ruling and ledger T17: the server returns null both for a deleted author and for an author not visible at the gym, R-VIS-4/P-MIN-6). The brief said « ancien membre » for null; spec R-SAL-6 / §15 n°18 say a deleted account shows « ancien membre ». The client cannot tell the two cases apart with the current `GymDetail`, so §15 n°18's literal text is not met — see concerns.
2. « Supprimer » goes through a confirmation `Dialog` for every place (needed anyway for the primary's successor choice); the brief's « Supprimer » p-2 → DELETE {} is the dialog's confirm.
3. `EquipmentList` added to `EquipmentChecklist.tsx` (file not in the task's Files block) so the read-only list is shared by PlaceDetail and GymPage.
4. Unspecified copy added where the screen needed it: « Pseudo enregistré. », « Saisis ton mot de passe actuel. », « Non renseigné », « Aucun » (sport), « Ton pseudo apparaît dans « Qui va à cette salle ». », delete-dialog text, « Ajouter la maison », « Lieu introuvable. », « Salle introuvable. », « Historique disponible en ligne » (offline history, by analogy with the members list ruling), « Aucune modification. », « Aucun matériel renseigné. », « Le matériel d'une salle se modifie sur sa fiche, partagée par ses membres. ».
5. Health questionnaire « Répondre de nouveau » is not owned by this screen: the brief only links to /profile/health (T34).

## Self-review findings
- Completeness against the brief's Step 1 list and the controller rulings: all covered (see tests). Straight apostrophes only; no Dexie import and no `onLine` in screens (architecture test green).
- Fixed in self-review: drafts of visibility and cautious mode (above).
- `HomeCreate` in PlacesPage repeats the home form of `PlaceStep` (T31) — about 40 lines; not factored to stay out of T31 files.
- When `GoalStep` chains to `SportStep` inside the Profile, focus does not move to the Sport title (T31 internal chaining does not re-arm `focusNext`). Minor a11y.
- No focus return after closing the delete dialog or the add forms (same as LogoutDialog in T30).
- GymPage does not mention a deleted gym (`deletedAt`); the server gives `canEdit: false`, so the rights text shows. Rare (only reachable by URL).

## Concerns
- Spec §15 n°18 « ancien membre » vs the « un membre » ruling: needs the server to distinguish a deleted author (e.g. a flag in history entries) if the spec wording must hold; left as ruled.
- In mustChangePassword mode, only the password section is shown (brief), so the user has no logout button until the change succeeds.
- `/profile/health`, `/profile/privacy`, `/settings` links point to T34 routes (NotFound until then).

---

# Fix round 1 (findings T32-F2 … T32-F20)

Status: DONE. Base 1e92df0. Two commits on `socle` (not pushed), each ending with `Refs #33` and the Co-Authored-By trailer:
- d3fccca `fix(salles): focus des formulaires de lieux et de salle, salle supprimée, champs changés depuis l'ouverture`
- 02d3551 `fix(profil): erreurs locales liées aux champs, mode prudent sans envoi croisé, obligation levée hors ligne`

## Changes per finding

- **T32-F2 (focus lost when an opener or closer unmounts)**
  - PlacesPage, add forms: « Ajouter une salle » and « Ajouter une maison » focus the form's h2 (`tabIndex=-1`, callback ref). « Annuler », GymPicker `onDone` and HomeCreate `onDone` return focus to the opener button (ref + effect, the same pattern as TrainingSection).
  - PlacesPage, rename: « Renommer » focuses « Nom du lieu ». « Annuler » and a successful save return focus to « Renommer ».
  - PlacesPage, delete dialog: « Annuler » or Escape returns focus to « Supprimer ». A successful delete focuses the next place link, or the previous one when the deleted place was last (`data-place` on the links).
  - GymPage: « Modifier » focuses « Nom de la salle ». Cancel, a submit with nothing changed, and a successful save all return focus to « Modifier ».
- **T32-F3 (no GymPage test for a failed write)**
  - Offline equipment toggle: alert in « Matériel », and the box comes back unchecked.
  - Offline « Enregistrer »: alert, form still open with the typed name, no second GET.
  - 409 `gym_duplicate`: « Cette salle existe déjà. », form still open.
- **T32-F4 (draft must give way to server truth after a re-read)**
  - Visibility: after the PATCH, re-seeding p-1 makes the box follow the mirror.
  - Gym equipment: the re-read detail has no kettlebell, so its box ends up unchecked.
  - PlaceDetail: dumbbells stay checked after the PUT, then follow the re-seeded mirror.
  - Cautious mode: re-seeding `cautiousMode: false` turns the switch off.
- **T32-F5 (deleted gym, « Réessayer » on a 404)**
  - When `deletedAt` is set, the page shows « Cette salle a été supprimée. » (warning Banner), with no rights text and no « Qui va à cette salle » section.
  - The load error carries `retry`, so an ApiError `not_found` shows no « Réessayer ».
  - `gyms-repo.offlineDetail` treats a tombstoned mirror row as absent and rethrows the network error.
  - Tests: 404, deleted gym, deleted mirror row (screen and repo).
- **T32-F7 (stale diff can revert another member's rename)**
  - GymInfoForm snapshots name and city when it opens and diffs against that snapshot.
  - Test: with the form open, a kettlebell toggle re-reads the detail with a new name; only the city is edited, and the PATCH is `{ city }`.
- **T32-F8 (cautious switch has no in-flight guard)**
  - `CautiousModeToggle` takes `disabled?: boolean` (`minor || disabled`); TrainingSection passes `cautious.pending`.
  - Test: with a hanging request the switch is disabled and a second click sends nothing.
- **T32-F9 (forced mode stays on when GET /api/me fails)**
  - `MeRepo.changePassword` writes the cached me with `mustChangePassword: false` right after the 204, then calls `refresh()`.
  - Tests, repo and screen: the network drops after the POST; the banner goes away, « Compte » appears, and so does the success message.
- **T32-F11 (hint reads as fact; no place context)**
  - The hint reads « Coché : ton pseudo apparaît dans « Qui va à cette salle ». » (`VISIBLE_HINT`).
  - The checkbox's `aria-describedby` now includes the place name. The rename « Enregistrer » and « Annuler » are described by the place name.
- **T32-F13 (focus lost going from goal to sport)**
  - GoalStep reads `StepTitleContext` and sets `focusNext` before `setAskSport(true/false)`.
  - Test: focus lands on the « Autre sport » title, and « Retour » brings it back to « Objectif ».
- **T32-F14 (Dialog refocuses each time onClose changes identity)**
  - PlaceItem passes a stable `closeDelete` (`useCallback`).
  - DeletePlaceDialog passes a stable `close` that reads `remove.pending` from a ref, instead of swapping between `ignore` and `p.onClose`.
  - Test: a focused radio keeps focus through a background re-read of the list, and through a send that ends in 409.
- **T32-F16 (local errors not linked to their fields)**
  - Local pseudo and password errors go to `Field error=` (`aria-invalid` plus description), and the invalid field takes focus. The pseudo is focused directly; the password form looks up `[aria-invalid]` in an effect.
  - The Banner stays for server and network errors.
  - `PasswordFields` gains an optional `errors` prop (`password`, `confirm`). A mismatch is reported on « Confirmation »; the other rules on « Nouveau mot de passe ».
- **T32-F17 (offline test proves too little)**
  - The offline test now also asserts « Historique disponible en ligne » and that « Aucune modification. » is absent.
  - New test: a wrapper overrides `repos.gyms.detail` to return `{ detail: canEdit true, offline: true }`, and the page shows no checkbox and no « Modifier ».
- **T32-F18 (order fixture cannot discriminate)**
  - New `garagePrimary` fixture: p-2 « Garage » is primary, p-1 « Basic Fit » is not.
  - The page test now expects the order ['Garage','Basic Fit'] with the badge on Garage; a new repo test uses the same fixture.
- **T32-F19 (failed rename, home add and pseudo save untested)**
  - Offline rename keeps « Cave ».
  - Offline home add keeps « Ajouter la maison » and « Garage 2 ».
  - After the offline alert, the pseudo field still holds 'leo'.
- **T32-F20 (constant-only test)**
  - The `GYM_HISTORY_LIMIT` test is removed; the rendering test still covers the 10-entry limit.

**Test-harness hardening:** `renderPlaces` now calls `settle()` after the first render. A late live-query re-read caused by the mirror seeding could clear the visibility draft just after the click. This happened once, during a parallel run, on the pre-existing assertion « la case garde le choix ».

## TDD evidence

**RED for the behaviour findings** (tests written first, run against HEAD 1e92df0):
```
pnpm --filter @appsport/web test places/gym-page
     × « Modifier » : seuls les champs changés depuis l'ouverture partent, même après une relecture de la fiche (R-SAL-5)
     × « Modifier » : le focus va au nom, puis revient à « Modifier » après « Annuler » ou « Enregistrer »
     × hors ligne, salle supprimée dans le miroir : traitée comme absente (R-SAL-7)
     × salle inconnue (404) : « Salle introuvable. », sans « Réessayer » ni bandeau hors ligne
     × salle supprimée : « Cette salle a été supprimée. », sans la raison des droits ni « Qui va à cette salle » (R-SAL-7)
AssertionError: expected [ { name: 'Basic Fit', …(1) } ] to deeply equal [ { city: 'Villeurbanne' } ]
AssertionError: expected <body><div>…(1)</div></body> to be <input maxlength="60" …(3)></input>
      Tests  5 failed | 17 passed (22)

pnpm --filter @appsport/web test places/places-page
     × « Renommer » : le focus va au champ, puis revient à « Renommer » après « Annuler » ou « Enregistrer »
     × renommage : « Enregistrer » et « Annuler » décrits par le nom du lieu
     × « Visible à la salle » : décrite par le nom du lieu et par l'aide « Coché : … »
     × suppression : le focus va au lieu restant ; « Annuler » le rend à « Supprimer »
     × boîte de suppression : une relecture de la liste ou un envoi ne reprend pas le focus
       (expected <div role="dialog" …> to be <input type="radio" …>)
     × « Ajouter une salle » → GymPicker … (focus back on the button after the add)
     × « Ajouter une salle » : le focus va au titre du formulaire, puis revient au bouton après « Annuler »
     × « Ajouter une maison » : le focus va au titre du formulaire, puis revient au bouton après « Annuler »
     × « Ajouter une maison » → POST … (focus back on the button after the add)
      Tests  9 failed | 21 passed (30)

pnpm --filter @appsport/web test profile/ repos/me-repo
     × changePassword : GET /api/me hors ligne après le 204 → meta.me sans mustChangePassword (R-MDP-1)   (expected true to be false)
     × pseudo invalide : message local lié au champ, aucune requête
     × confirmation différente : message local lié à « Confirmation », aucune requête
     × mot de passe actuel vide : message local lié au champ, aucune requête
     × mustChangePassword : GET /api/me en échec après le changement réussi, le bandeau disparaît quand même
     × administrateur : 13 caractères refusés localement (R-MDP-1)
     × objectif sportif sans sport : le focus va au titre du sport, puis revient à l'objectif avec « Retour »
       (expected 'ProfilComptePseudo…' to be 'Autre sport')
     × mode prudent : l'interrupteur est désactivé pendant l'envoi, pas de deuxième PATCH   (expected true to be false)
```

**Coverage-only findings (F3, F4, F17, F18, F19).** These tests pass on correct code. To show that each one catches its regression, I mutated the source temporarily and restored the file after every run:

| Mutation | Test that fails |
|---|---|
| Remove `else setDraft(null)` from GymEquipment | « matériel hors ligne … la case revient » |
| Call `p.onSaved()` in a `finally` in GymInfoForm | « « Enregistrer » hors ligne … » and « 409 gym_duplicate … » |
| Remove the GymEquipment draft-clearing effect | « matériel relu : la fiche du serveur remplace le choix affiché » |
| Set `editable = detail.canEdit` (no `!offline`) and remove the offline history branch | the offline test and « hors ligne avec un droit de modifier » |
| Remove the PlacesPage visibility-draft effect | « « Visible à la salle » décoché … » |
| Remove the PlaceDetail draft effect | « maison : cocher → PUT … » |
| Remove the primary-first comparator from places-repo | repo « list : le principal d'abord, même quand son id et son nom viennent après » and page « le principal d'abord … » |
| Make rename always close, and call HomeCreate `onDone` in a `finally` | « renommer hors ligne … » and « « Ajouter une maison » hors ligne … » |
| Remove the TrainingSection cautious-draft effect | « mode prudent → PATCH … ; le miroir relu fait foi » |
| Call `setDraft(null)` in the UsernameForm catch | « hors ligne : alerte « Nécessite le réseau » » (pseudo kept) |

**GREEN:**
```
pnpm --filter @appsport/web test profile/ places/ repos/ onboarding/
 Test Files  14 passed (14)
      Tests  238 passed (238)
```

## Final commands
- `pnpm lint` → `Checked 359 files … No fixes applied.`
- `pnpm typecheck` → all 4 packages clean (exit 0).
- `pnpm test` → `Test Files 129 passed (129)`, `Tests 1444 passed | 2 skipped (1446)`, no stderr or warnings. The vitest « happy-dom was created 46 times » performance hint also appears at HEAD.
- `git show --stat` d3fccca: GymPage.tsx, PlacesPage.tsx, gyms-repo.ts, gym-page.test.tsx, places-page.test.tsx, profile-places-gyms.test.ts (6 files, +528 −99).
- `git show --stat` 02d3551: PasswordFields.tsx, GoalStep.tsx, HealthStep.tsx, ProfilePage.tsx, me-repo.ts, profile-page.test.tsx, me-repo.test.ts (7 files, +168 −42).
- `git status`: clean.

## Notes
- Some findings required touching files outside Task 32's list:
  - `GoalStep.tsx` (F13).
  - `HealthStep.tsx`, for `CautiousModeToggle` `disabled` (F8).
  - `PasswordFields.tsx`, for the optional `errors` prop (F16).
  - `me-repo.ts` (F9) and `gyms-repo.ts` (F5).
  - Repo tests (F9, F18, F5).

  Every new prop is optional, so existing callers are unchanged.
- The shared `Dialog` still does not restore focus on its own, and it still refocuses whenever `onClose` changes identity. As the finding prescribed, the fix is at the caller. Other dialogs, such as LogoutDialog, are unchanged.
- In forced mode, the banner now disappears as soon as meta.me is updated after the 204. The success message appears a moment later, when `changePassword` resolves. The tests wait for it with `findByText`.

---

# Fix round 2 (owner ruling 2026-10-08: T32-F1, logout during forced password change)

Status: DONE. Base ad5c572. One commit on `socle` (not pushed), message ending with `Refs #33` and the Co-Authored-By trailer:
- 89833a2 `fix(profil): « Se déconnecter » pendant le changement de mot de passe imposé`

## Changes

- **T32-F1, ProfilePage (`ForcedLogout`)**
  - When `me.mustChangePassword` is true, a « Se déconnecter » button (secondary) sits right under the password section. It opens the existing `LogoutDialog` with `mode="current"`: POST /api/auth/logout, then `wipeUserData`. If unsent data exists, the dialog shows the same « Données non envoyées » warning. « Déconnecter tous mes appareils » stays hidden in this state; the server refuses logout-all there anyway (not in `MUST_CHANGE_ALLOWED`).
  - `onClose` is a stable `useCallback`. `Dialog` refocuses itself whenever `onClose` changes identity, so an inline arrow would steal focus on every re-read of `meta.me` (the T32-F14 lesson).
  - On close (« Annuler » or Escape), focus returns to « Se déconnecter » via its `useId` id, the same pattern as PlacesPage.
  - Once the password has been changed, the forced button unmounts and « Compte » shows its own « Se déconnecter » and « Déconnecter tous mes appareils ».
- **Guard race found while testing the real app (`me-repo.ts`)**
  - In the full app, the forced-state logout landed on a blank page at `/`. The cause: `MeRepo.logout` resolved as soon as the wipe committed, before the guard's `meta.me` live query saw it.
  - `LogoutDialog` then navigated to `/login` while the guard still saw the forced user. The guard redirected `/login` → `/`. At `/`, the next redirect (`/profile`, then `/login` once `me` was null) reused the same `<Redirect>` instance, whose effect runs only on mount, so navigation stopped.
  - Fix: `MeRepo.logout` now ends with `await whenSignedOut(db)`, on the 204 path and on the 401 path. This is what `deleteAccount` already does. The 410 path already waits in `handleAccountDeleted`.
  - Side effect: an ordinary logout no longer bounces `/login` → `/` → `/login`.

## Tests

`apps/web/test/profile/profile-page.test.tsx`:
- Extended « mustChangePassword (R-MDP-1) … » test:
  - Before the change, « Se déconnecter » is present and logout-all is absent.
  - After the change, exactly one « Se déconnecter » remains (the one in « Compte ») and « Déconnecter tous mes appareils » is back.
- New describe « mot de passe à changer : se déconnecter (R-MDP-1, R-AUTH-9) », 5 tests:
  1. The button comes after « Changer le mot de passe » in the document and logout-all is absent. In the dialog « Se déconnecter de cet appareil ? », « Se déconnecter » sends POST /api/auth/logout once, with body `{}`, and nothing to logout-all. The location becomes `/login`. `meta.me` and `meta.userId` are gone, and the `training_profile` mirror is empty.
  2. With 2 unsent ops: the dialog is « Données non envoyées » with `pendingWarning(2, 'lea')`. « Se déconnecter quand même » sends POST /api/auth/logout and the outbox ends at 0.
  3. « Annuler »: no logout request, location stays `/profile`, and focus is back on « Se déconnecter ».
  4. With the dialog open and focus on « Annuler », a re-write of `meta.me` (account re-read) leaves focus on « Annuler ».
  5. Full app (`renderApp`, real guard): after the logout, the « Connexion » h1 is shown and only POST /api/auth/logout was sent.

`apps/web/test/app/when-signed-out.test.tsx`: new `it.each` for 204 and 401. Once `MeRepo.logout` resolves, the `useMe` observer already shows no user.

## TDD evidence

RED 1, feature (tests written first, against ad5c572):
```
pnpm --filter @appsport/web test profile/profile-page
     × mustChangePassword (R-MDP-1) : bandeau et seule la section mot de passe ; après le changement, tout réapparaît
     × « Se déconnecter » sous le formulaire → POST /api/auth/logout, données locales effacées, connexion
     × données non envoyées : même avertissement, « Se déconnecter quand même » → file effacée
     × « Annuler » : rien envoyé, le focus revient à « Se déconnecter »
     × dialogue ouvert : une relecture du compte ne reprend pas le focus
     × dans l'appli : la garde laisse l'écran de connexion s'afficher après la déconnexion
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Se déconnecter"
      Tests  6 failed | 27 passed (33)
```
This failure was expected: the forced branch had no logout button.

After adding `ForcedLogout`, 32 of 33 passed. The full-app test still failed (`Unable to find role="heading" and name "Connexion"`, body `<div></div>`).

A temporary debug test traced the visits. Forced state: `/profile → /login → /` and the app stuck at `/`. Normal state: `/profile → /login → / → /login`. That debug test was deleted.

RED 2, guard race (new repo-level test, before the `me-repo.ts` fix):
```
pnpm --filter @appsport/web test app/when-signed-out profile/profile-page
     × MeRepo.logout (204) : résolu une fois que la garde ne voit plus l'utilisateur
     × MeRepo.logout (401) : résolu une fois que la garde ne voit plus l'utilisateur
     × dans l'appli : la garde laisse l'écran de connexion s'afficher après la déconnexion
TestingLibraryElementError: Unable to find an element with the text: personne.
TestingLibraryElementError: Unable to find role="heading" and name "Connexion"
      Tests  3 failed | 35 passed (38)
```

GREEN:
```
pnpm --filter @appsport/web test app/when-signed-out profile/profile-page auth/logout-reset repos/me-repo
 Test Files  4 passed (4)
      Tests  94 passed (94)
```

Mutation checks. Each mutation was temporary and the file was restored from a backup:

| Mutation in `ForcedLogout` | Test that fails |
|---|---|
| Drop the focus return in `close` | « « Annuler » : rien envoyé, le focus revient à « Se déconnecter » » |
| `onClose={() => close()}` (new identity each render) | « dialogue ouvert : une relecture du compte ne reprend pas le focus » |

## Final commands
- `pnpm lint`: `Checked 391 files in 289ms. No fixes applied.`
- `pnpm typecheck`: all 4 packages clean (exit 0).
- `pnpm test`: exit 0, `Test Files 138 passed (138)`, `Tests 1618 passed | 2 skipped (1620)`. No error or warning lines; only the vitest transform-cache performance hint.
- `git show --stat HEAD` (89833a2): ProfilePage.tsx, me-repo.ts, when-signed-out.test.tsx, profile-page.test.tsx (4 files, +140 −4).
- `git status`: clean.

## Notes
- `me-repo.ts` (Task 30) is touched because the ruling cannot work in the real app without it. The change is the existing `deleteAccount` pattern, applied to `logout`.
- Latent issue, not fixed (out of scope): App's guard renders `<Redirect>` without a `key`. Two redirects in a row at the same tree position therefore reuse one wouter `Redirect`, which only navigates on mount. Waiting in `logout` removes the trigger here. A `key={guard.to}` on the Redirect would harden the guard in general.
- The « Se déconnecter » in « Compte » still has no focus return and an inline `onClose`. It was left unchanged because this ruling only covers the forced state.
