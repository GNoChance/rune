# Task 30 — Écrans d'accès (invitation, création du compte, connexion, réinitialisation, déconnexion)

Issue : #31. Branche `socle`.

## Implémenté

Dans `apps/web/src/features/auth/` :

- `messages.ts` : `PASSWORD_MESSAGES`, `passwordMessage(reason, role)` (14 pour un admin), `checkNewPassword` (règles du mot de passe avant la confirmation, comparaison après NFC, liste des mots courants laissée au serveur → `common` revient en `password_rejected`), `USERNAME_MESSAGES`, `invitationErrorMessage`, `pendingWarning`, `INCOMPLETE_CODE_MESSAGE`, `RESET_INVALID_MESSAGE`, `FORMER_ACCOUNT_NAME`, et deux fonctions qui lisent le corps de l'erreur : `accessErrorMessage(e, role)` (`body.reason` de `password_rejected` et `username_invalid`, `reset_invalid`, `rate_limited` « Trop d'essais depuis cet appareil. ») et `loginErrorMessage(e)` (`retryAfterS` arrondi au supérieur, au moins 1 min).
- `install-help.ts` : `isStandalone(win?)`, `InstallPlatform`, `detectPlatform`, `installHelp` (iOS, Android, les deux sinon).
- `PasswordFields.tsx` (`label ?? 'Mot de passe'` puis « Confirmation », aide « Astuce : … »), `CreateAccountForm.tsx` (prop `role`, contrôles locaux `validateUsername` puis `checkNewPassword` avant tout envoi, case « J'ai lu la page Confidentialité et règles » qui active « Créer mon compte », `termsVersion` = `PRIVACY_POLICY_VERSION`).
- `InvitePage.tsx` : accueil (porteur, « pas un service médical », lien Confidentialité). Fragment lu puis effacé par `history.replaceState`. Mode installé : vérification seule avec un fragment, sinon champ « Lien ou code d'invitation » + « Suivant ». Navigateur : aide iOS/Android, code en clair + « Copier », aucune requête ni formulaire, « Continuer dans ce navigateur » (avertissement conservé sur le formulaire).
- `LoginPage.tsx` : « Pseudo », « Mot de passe », « Se connecter » ; `?reason=account_deleted` et connexion `account_deleted` → « Ce compte a été supprimé » ; connexion `unauthenticated` → « Ta session a expiré. Reconnecte-toi. » ; P-AUT-6 : au submit, `deviceOwner()` ; si `pending > 0` et `usernameKey(saisi) !== usernameKey(owner.username)`, dialogue avec `pendingWarning`, « Annuler » (aucune requête) / « Continuer » (le dépôt efface).
- `ResetPage.tsx` : même saisie de code (libellé « Lien ou code de réinitialisation »), puis « Nouveau mot de passe pour <pseudo> », minimum selon `role`.
- `LogoutDialog.tsx` : avertissement + « Exporter mes données » (/profile/privacy), « Annuler », « Se déconnecter quand même » ; sans élément en attente « Se déconnecter de cet appareil ? » / « Se déconnecter » ; mode `all` → `/api/auth/logout-all` (titre « Déconnecter tous les appareils ? », bouton distinct du « Déconnecter tous mes appareils » du Profil) ; erreur (hors ligne) en alerte dans le dialogue, file intacte.
- `CodeStep.tsx` (hors liste du plan, voir concerns) : lecture/effacement du fragment (`useFragmentCode`) et saisie + vérification d'un code, partagées par l'invitation et la réinitialisation.
- `auth.module.css`.
- `App.tsx` : routes `/login`, `/invite`, `/reset` dans `PublicRoutes`.

Tests : `test/auth/{messages.test.ts, invite.test.tsx, login.test.tsx, logout-reset.test.tsx}` et `test/support/auth.ts` (aides : mode d'affichage, user agent, adresse avec fragment, saisie).

## Étapes TDD

RED (tests écrits d'abord, aucune source) :

```
pnpm --filter @appsport/web test auth/
 FAIL |web| test/auth/invite.test.tsx       Failed to resolve import "../../src/features/auth/messages"
 FAIL |web| test/auth/login.test.tsx        Failed to resolve import "../../src/features/auth/LoginPage"
 FAIL |web| test/auth/logout-reset.test.tsx Failed to resolve import "../../src/features/auth/ResetPage"
 FAIL |web| test/auth/messages.test.ts      Failed to resolve import "../../src/features/auth/messages"
 Test Files  4 failed (4)   Tests  no tests
```
Attendu : modules inexistants. (Les routes `/login`, `/invite`, `/reset` rendaient `NotFound`.)

GREEN : après implémentation, un test en échec (l'avertissement « données pas dans l'appli installée » devait rester visible sur le formulaire après « Continuer dans ce navigateur ») ; corrigé en affichant le bandeau aussi à l'étape formulaire hors appli installée. Puis :

```
pnpm --filter @appsport/web test auth/
 Test Files  4 passed (4)   Tests  89 passed (89)
```

Contrôles de mutation (échec attendu constaté, fichiers restaurés ensuite, `cmp` identique aux sauvegardes) :
- comparaison de pseudo sans `usernameKey` → « même pseudo en casse différente » échoue ;
- fragment non effacé + contrôle local du mot de passe retiré → 8 tests échouent.

Suite complète avant commit :

```
pnpm lint        → Checked 325 files. No fixes applied. (exit 0)
pnpm typecheck   → 4 paquets, aucune erreur (exit 0)
pnpm test        → Test Files 120 passed (120) ; Tests 1243 passed | 2 skipped (1245)
```
Sortie sans avertissement ni erreur (recherche de warn/stderr/act/error vide).

## Décisions

- Messages : erreurs de formulaire en `Banner tone="error"` (role alert), une seule à la fois ; `PasswordFields` n'affiche aucune erreur (pas de doublon avec l'alerte du formulaire, donc un seul `getByText` / strict-mode Playwright possible).
- Code d'invitation : toujours dans le corps d'un POST, jamais dans l'URL (testé : `query` vide) ; le lien « Confidentialité et règles » de la page et celui de la case s'ouvrent dans un nouvel onglet (`target="_blank"`), car l'adresse n'a plus le code et un retour arrière le perdrait.
- Ordre des contrôles locaux : pseudo, puis règles du mot de passe, puis confirmation.
- Pas de `trim` sur le pseudo (le domaine l'interdit explicitement).
- `StrictMode` (utilisé par `main.tsx`) : lecture du fragment pure, effacement idempotent, vérification automatique gardée par une ref ; test dédié (une seule requête).
- Liens ajoutés sur la page de connexion : « J'ai un code d'invitation » (/invite) et « J'ai un lien de réinitialisation » (/reset). Sans eux, la saisie d'un code dans l'appli installée (iOS : « Ouvre ensuite appsport depuis l'écran d'accueil et colle le code ») n'est atteignable par aucune interface.

## Fichiers modifiés

- `apps/web/src/App.tsx`
- `apps/web/src/features/auth/{CodeStep.tsx, CreateAccountForm.tsx, InvitePage.tsx, LoginPage.tsx, LogoutDialog.tsx, PasswordFields.tsx, ResetPage.tsx, auth.module.css, install-help.ts, messages.ts}`
- `apps/web/test/auth/{invite.test.tsx, login.test.tsx, logout-reset.test.tsx, messages.test.ts}`
- `apps/web/test/support/auth.ts`

## Auto-relecture

- Apostrophe droite partout (grep `’` vide) ; aucun `onLine`, aucun import `dexie`/`local-db` dans les écrans (test d'architecture vert) ; aucun script, URL ou `@import` ajouté.
- Libellés E2E vérifiés par les tests : « Lien ou code d'invitation », « Suivant », « Pseudo », « Mot de passe », « Confirmation », « Créer mon compte », « Se connecter », « Continuer dans ce navigateur », « J'ai lu la page Confidentialité et règles ».
- Tests vérifient des comportements (requêtes émises ou non, corps, navigation, état de la base locale), pas des détails d'implémentation.

## Concerns

1. Fichier en plus du plan : `CodeStep.tsx` (≈115 lignes), pour ne pas dupliquer la saisie/vérification du code et le traitement du fragment entre `InvitePage` et `ResetPage`.
2. `PasswordFields` reçoit `username` et `role` (signature partagée avec T32) mais ne s'en sert pas : les règles se contrôlent à l'envoi par le formulaire via `checkNewPassword`. Choix délibéré pour éviter deux messages identiques à l'écran.
3. Après une connexion réussie, `navigate('/')` ; si `connection` vaut encore `unauthenticated`/`account_deleted` (tant que le premier cycle de synchro n'a pas répondu `online`), la garde de T28 renvoie un instant vers `/login` (bandeau « session expirée » visible quelques centaines de ms) puis revient seule à `/`. Ajustement possible côté garde (T28) ; hors périmètre ici.
4. Les liens du pied de page public (T28, même onglet) font perdre le code d'une invitation en cours de saisie ; les liens de la page d'invitation, eux, s'ouvrent dans un nouvel onglet.
5. T37 doit encore ajouter l'appel `requestPersistentStorage` dans `CreateAccountForm` (R-CPT-2), comme prévu par le plan.

---

## Correctifs, tour 1 (revue T30)

Reprise : HEAD 82e0cc5, arbre avec deux fichiers non commités d'une tentative interrompue (`test/support/fake-api.ts` : `sessionOpened()` du faux moteur ; `test/support/render.tsx` : option `realSync` (moteur réel branché sur le faux serveur, déclencheurs compris, 410 → `/login?reason=account_deleted` comme `main.tsx`) et `visits()` qui note chaque navigation, remplacements compris). Relus : corrects, gardés tels quels et commités avec le premier correctif.

Commits (tous « Refs #31 ») :
- `0f36733` fix(auth): session rouverte sans détour par /login, synchro en pause après un 401 — T30-F1, T30-F3, T30-F16 (et T30-F21, voir plus bas)
- `07d4dcf` fix(auth): avertissement P-AUT-6 avant la création du compte et la réinitialisation — T30-F2
- `e957b9a` fix(auth): rappel 03 §13.1, fragments tardifs et tronqués, dialogue de déconnexion — T30-F4, F6, F8, F9, F10, F12, F17, F18, F19, F20

### Changements

**T30-F1 / T30-F3 / T30-F16 (session perdue puis rouverte)**
- `sync/engine.ts` : `SyncEngine.sessionOpened()` (connexion → `unknown` de façon synchrone, reprises à zéro, `lastUserId` oublié). Pause de la session perdue (R-SYN-12 « un 401 met la synchro en pause ») : tant que `connection` vaut `unauthenticated` ou `account_deleted`, `enqueue`, le différé `set_logged` et le cycle programmé en fin de cycle ne lancent rien, quel que soit le déclencheur (lancement, premier plan, `online`, intervalle, manuel, pull, coach, relance de `withEngineStopped`). Seul `sessionOpened()` lève la pause ; il n'est appelé ni par `start()` ni dans le `finally` (un échec de connexion garde la pause, pas de boucle /login ↔ /).
- `repos/me-repo.ts` : `adoptSession` appelle `sync.sessionOpened()` après `rememberMe`, donc avant la relance du moteur et avant que `login`, `acceptInvitation`, `resetPassword` (et `refresh` qui adopte la session d'un autre compte) ne rendent la main.
- Navigation : `LoginPage` ne navigue plus ; la garde (`/login` + session valide → `/`) mène à l'accueil dès qu'elle voit la session. `InvitePage` et `ResetPage` naviguent par `useSessionRedirect` (nouveau, `features/auth/use-session-redirect.ts`) une fois que `meta.me` porte l'id rendu par le dépôt.
- `app-services.tsx` : `useMeState` lit un magasin unique par base (une seule `liveQuery` sur `meta.me`, `useSyncExternalStore`) au lieu d'une `liveQuery` par composant. Sans cela, l'écran (abonné avant l'`App`, effets enfant d'abord) voyait le nouvel utilisateur avant la garde et naviguait vers une route protégée que la garde, encore sur `me = null`, renvoyait vers /login. Garde et écrans voient désormais le même `me` au même rendu.
- Tests à travers la garde réelle et le moteur réel (`renderApp({ realSync: true })`, `lostSessionApi` dans `test/support/auth.ts`) : 401 puis connexion du même compte → `visits` après l'envoi = `['/']`, ni bandeau ni formulaire ; compte supprimé (410) puis connexion d'un autre compte → `['/']`, sans « Ce compte a été supprimé » ; session perdue avec 2 éléments en attente : avertissement P-AUT-6 ouvert puis `visibilitychange` et `online` → même dialogue (pas de remontage), puis échec de connexion → alerte, pseudo et bandeau gardés, aucune navigation, aucun `/api/health` de plus ; réinitialisation depuis une session perdue → `['/']` ; création du compte dans l'appli → `['/onboarding']`. Les tests de `login.test.tsx` passent tous par `renderApp` (garde comprise) ; l'ancien test du compte supprimé sur `LoginPage` seule avec le faux moteur figé est remplacé.
- Moteur : 4 tests (pause sur tous les déclencheurs et jamais `online` ensuite ; cycle programmé pendant le 401 non lancé ; `sessionOpened()` → `unknown` puis cycle ; reprises remises à zéro). `engine.test.ts` « 410 … puis reprise avec un autre compte » et `scenarios.test.ts` « 401 puis reconnexion » appellent désormais `sessionOpened()` comme le fait MeRepo (contrat changé : sans session rouverte, rien ne repart). `triggers.test.ts` : faux moteur complété.
- MeRepo : `sessionOpened` avant `start` et avant la fin pour login/accept/reset ; jamais sur un échec (pause gardée) ; refresh qui adopte un autre compte ; moteur réel : reconnexion après 401 → health, push, pull, `online`.

**T30-F2** — `features/auth/WipeWarning.tsx` : `useWipeWarning(onContinue)` (lecture de `deviceOwner()`, dialogue « Données non envoyées » avec `pendingWarning`, « Annuler » / « Continuer »), partagé par `LoginPage`, `CreateAccountForm` (un nouveau compte n'est jamais le propriétaire : averti dès que `pending > 0`) et le formulaire de réinitialisation (averti si `usernameKey(pseudo du lien) !== usernameKey(propriétaire)`). Un propriétaire sans nom connu est toujours averti. `DeviceOwner` exporté par `repos`. Tests : création avec 2 éléments de lea → dialogue avant toute requête ; Annuler → aucun `accept`, file et saisie gardées ; Continuer (1 élément, forme du singulier) → compte créé, file vide, `/onboarding` ; rien en attente → pas de dialogue. Réinitialisation pour `max` → dialogue, Annuler → aucun `reset`, Continuer → file vide, `userId` u-2 ; pour `LEA` (propriétaire, casse différente) → pas de dialogue, file gardée.

**T30-F4** — `Welcome` (texte 03 §13.1) affiché aussi sur « Crée ton compte ». Le lien vers Confidentialité de cette étape est celui de la case « J'ai lu la page Confidentialité et règles » (même cible, nouvel onglet) : pas de second lien au même nom juste au-dessus. Test : ouverte d'emblée par un lien dans l'appli installée, le texte complet est présent une fois « Date de naissance » affichée, et chaque lien « Confidentialité et règles » mène à `/privacy`.

**T30-F6** — `<input type="text" autoComplete="username" value={pseudo} readOnly hidden />` dans le formulaire de réinitialisation. Tests : valeur `lea`, lecture seule, même formulaire que le nouveau mot de passe ; `autocomplete="new-password"` de « Confirmation » vérifié pour l'invitation et la réinitialisation.

**T30-F8** — `InstallGuide` reçoit le fragment : présent mais illisible → `Banner` erreur (role alert) « Code incomplet : il faut 16 caractères. Demande à l'administrateur le lien complet ou le code. », pas de « Copier ». Test navigateur `/invite#abc` (alerte, pas de Copier, « Continuer dans ce navigateur » présent, aucune requête, fragment effacé).

**T30-F9** — `useFragmentCode` écoute `hashchange` : lit le fragment, l'efface par `replaceState`, l'expose avec un numéro `seq` ; `CodeStep` lance une vérification par nouveau `seq` (ou « Code incomplet »). Tests : `window.location.hash = '#abcd-…'` page ouverte → une seule vérification, formulaire, fragment effacé ; `#abc` → « Code incomplet », aucune requête. (happy-dom émet aussi `hashchange` après `replaceState`, contrairement aux navigateurs : l'écouteur ignore une adresse sans fragment.)

**T30-F10** — `LogoutDialog` ne monte son contenu (`OpenLogoutDialog` : état et requête Dexie) que s'il est ouvert : chaque ouverture repart sans erreur ni `busy`. Pendant la requête, le `onClose` passé au `Dialog` est sans effet (Échap ignoré). Tests avec un petit harnais : erreur hors ligne, Annuler, réouverture → aucune alerte ; Échap pendant une déconnexion en attente → même dialogue, puis `/login`.

**T30-F12** — `MeRepo.logout` : `ApiError` `unauthenticated` → données locales effacées, déconnexion réussie (l'écran va à /login) ; `account_deleted` → effacées aussi, l'erreur est rendue (le client API mène déjà à `/login?reason=account_deleted` ; naviguer vers `/login` par-dessus ferait perdre « Ce compte a été supprimé », P-DRT-4) ; toute autre erreur laisse tout en place. Tests dépôt (401, 410, 500) et écran (401 → `/login`, file et `meta.me` vides ; 410 → `/login?reason=account_deleted`, données effacées).

**T30-F17** — `openUrl` rend `history.length` ; `fragmentCleared(n)` vérifie hash vide, aucun `#` dans `href` et longueur d'historique inchangée (invitation installée, StrictMode, iPhone, fragment illisible, lien tronqué en navigateur, réinitialisation). Méthode `POST` et chaîne de requête vide vérifiées pour `accept`, `reset/check` et `reset`.

**T30-F18** — « fermé » : un `LogoutDialog` fermé rendu à côté d'un ouvert ; une fois l'ouvert affiché (base lue) et la boucle laissée tourner, un seul dialogue, celui du mode `all`. Test « ouvert puis fermé » ajouté.

**T30-F19** — `invite.test.tsx` construit le texte attendu depuis `OWNER_FIRST_NAME`. `public-pages.test.tsx:16` n'est pas concerné : il appelle `buildPrivacySections(owner)` avec `undefined`, `''` et `'   '` passés explicitement, sans lire l'environnement ; laissé tel quel.

**T30-F20** — `messages.test.ts` : « cheval agrafé batterie » saisi contre `e` + U+0301 collé, dans les deux sens → `null`.

**T30-F21** — (dans `0f36733`, avec la réécriture de `login.test.tsx`) propriétaire `Léa`, saisie `LÉA` → pas d'avertissement, file gardée, `userId` u-1.

### TDD

RED moteur (avant `engine.ts`) :
```
pnpm --filter @appsport/web test sync/engine.test sync/scenarios
 × 410 account_deleted → … puis reprise avec un autre compte   TypeError: engine.sessionOpened is not a function
 × après un 401, aucun déclencheur ne relance de cycle ; jamais « online » entre-temps   AssertionError: expected 9 to be 1
 × le cycle programmé pendant celui qui reçoit le 401 ne part pas   AssertionError: expected 2 to be 1
 × sessionOpened() : « unknown » tout de suite, puis …   TypeError: engine.sessionOpened is not a function
 × sessionOpened() remet les reprises à zéro   TypeError: engine.sessionOpened is not a function
 × 401 puis reconnexion du même utilisateur (scenarios)   TypeError: a.engine.sessionOpened is not a function
 Tests  6 failed | 46 passed (52)
```
GREEN : `pnpm --filter @appsport/web test sync/` → `Test Files 10 passed (10) ; Tests 113 passed (113)`.

RED MeRepo (moteur corrigé, dépôt non) :
```
pnpm --filter @appsport/web test repos/me-repo
 × login / acceptInvitation / resetPassword réussi : connexion « unknown » …   expected 'unauthenticated' to be 'unknown'
 × session d'un autre compte adoptée par refresh   expected +0 to be 1
 × après un 401, la reconnexion du même utilisateur relance un cycle complet   expected 'unauthenticated' to be 'unknown'
 × après un 410 account_deleted, la connexion de u-B relance un cycle complet   until: condition jamais remplie
 Tests  6 failed | 21 passed (27)
```
GREEN : `pnpm --filter @appsport/web test repos/` → `Tests 70 passed (70)`.

RED écrans (sources des correctifs retirées le temps du passage : `git diff -- apps/web/src > patch ; git checkout -- apps/web/src ; tests ; git apply patch`) :
```
pnpm --filter @appsport/web test auth/login auth/invite auth/logout-reset
 × session perdue puis réinitialisation : accueil sans passer par /login   expected [ '/', '/login', '/' ] to deeply equal [ '/' ]
 × création dans l'appli : l'onboarding sans passer par /login   until: condition jamais remplie
 × Pseudo, Mot de passe, Se connecter → … puis accueil   expected [ '/', '/login', '/' ] to deeply equal [ '/' ]
 × Continuer : connexion, accueil, file effacée   Unable to find … Bonjour max
 × même pseudo, casse et forme Unicode différentes …   Unable to find … Bonjour Léa
 × autre pseudo sans rien en attente   Unable to find … Bonjour max
 × 401 puis connexion réussie : accueil, sans retour à /login ni bandeau   expected [ '/', '/login', '/' ] …
 × compte supprimé puis connexion d'un autre compte   expected [ '/', '/login', '/' ] …
 × pendant la session perdue, /login reste stable   Unable to find an accessible element with the role "dialog"
 Tests  9 failed | 66 passed (75)
```
Avec moteur et dépôt corrigés mais écrans inchangés, il restait `['/', '/login', '/']` (connexion d'un appareil vierge, compte supprimé) et `['/', '/']` (double navigation) : d'où le magasin `meta.me` unique et la navigation pilotée par la garde. GREEN : `pnpm --filter @appsport/web test auth/` → `Tests 93 passed (93)` ; 5 passages de suite de `auth/ repos/me-repo sync/engine` → `180 passed` à chaque fois.

RED T30-F2 :
```
pnpm --filter @appsport/web test auth/invite auth/logout-reset
 × lien pour un autre compte : avertissement ; Annuler …   Unable to find role="dialog"
 × lien pour un autre compte : Continuer …                 Unable to find role="dialog"
 × avertit avant toute requête ; Annuler …                 Unable to find role="dialog"
 × Continuer : compte créé, file de lea effacée …          Unable to find role="dialog"
 Tests  4 failed | 57 passed (61)
```
GREEN : `pnpm --filter @appsport/web test auth/` → `Tests 99 passed (99)`.

RED mineurs :
```
pnpm --filter @appsport/web test auth/invite
 × « Crée ton compte » ouvert d'emblée par un lien : le rappel reste affiché …   expected 'Crée ton compteDate de naissance…' to contain 'appsport est un outil…'
 × lien tronqué (#abc) : « Code incomplet » annoncé …   Unable to find role="alert"
 × lien reçu page déjà ouverte (hashchange) …          Unable to find a label with the text of: Date de naissance
 × lien tronqué reçu page déjà ouverte …               Unable to find an element with the text: Code incomplet …
 Tests  4 failed | 41 passed (45)
pnpm --filter @appsport/web test auth/logout-reset
 × erreur hors ligne, fermeture, réouverture : aucune alerte d'avant   expected <div role="alert" …> to be null
 × Échap pendant la déconnexion : le dialogue reste ouvert …          Unable to find … role "dialog"
 × session déjà fermée (401) : déconnexion faite, données effacées    expected '/profile' to be '/login'
 × lien : vérification du fragment … (champ pseudo)                    expected undefined to be 'lea'
 Tests  4 failed | 21 passed (25)
```
GREEN : `pnpm --filter @appsport/web test auth/ repos/` → tout vert.

Contrôles de mutation (tests déjà verts sur le code actuel ; mutation appliquée, échec constaté, fichier restauré, `cmp` identique à la sauvegarde) :
- F17 : `pushState` au lieu de `replaceState` dans `clearFragment` → 6 tests échouent (invitation installée, StrictMode, iPhone, lien tronqué, fragment illisible, réinitialisation).
- F18 : garde `p.open` retirée de `LogoutDialog` → « fermé : rien à l'écran, même une fois la base lue » échoue (`expected [ …(2) ]`), ainsi que « ouvert puis fermé ». Une première version (simple attente de 50 tours) ne l'attrapait pas ; remplacée par le rendu côte à côte.
- F20 : comparaison sans NFC → le test NFC échoue.
- F21 : `usernameKey(saisi) === owner.username` → échoue ; `toLowerCase()` des deux côtés → échoue.
- F12 (dépôt) : `logout` d'origine → « 401 : déconnexion faite » (dépôt) et « session déjà fermée (401) » (écran) échouent.

### Vérification finale

```
pnpm lint        → Checked 327 files in 154ms. No fixes applied. (exit 0)
pnpm typecheck   → exit 0 (4 paquets)
pnpm test        → Test Files 120 passed (120) ; Tests 1278 passed | 2 skipped (1280) (exit 0)
```
Sortie sans `warn`, `stderr` ni « not wrapped in act » (recherche vide). Apostrophe droite : aucun `’` dans `features/auth`. `git status` propre après chaque commit ; `git show --stat` de chaque commit conforme à la liste ci-dessus.

### Fichiers

- Créés : `apps/web/src/features/auth/{WipeWarning.tsx, use-session-redirect.ts}`.
- Modifiés : `apps/web/src/{app-services.tsx, sync/engine.ts, repos/me-repo.ts, repos/index.ts}`, `apps/web/src/features/auth/{CodeStep.tsx, CreateAccountForm.tsx, InvitePage.tsx, LoginPage.tsx, LogoutDialog.tsx, ResetPage.tsx}`, `apps/web/test/auth/{invite,login,logout-reset}.test.tsx`, `apps/web/test/auth/messages.test.ts`, `apps/web/test/repos/me-repo.test.ts`, `apps/web/test/sync/{engine,scenarios,triggers}.test.ts`, `apps/web/test/support/{auth.ts, fake-api.ts, render.tsx}`.

### Points d'attention

1. Interface partagée modifiée : `SyncEngine.sessionOpened()` (T29) ; la section « Interfaces partagées » du plan (docs/, non touché) ne la mentionne pas.
2. Code de T28/T29 touché pour tenir T30-F1 : `useMeState` (magasin unique par base), `MeRepo.adoptSession` et `MeRepo.logout`. `LoginPage` seule (hors `App`) ne navigue plus après la connexion : c'est la garde qui le fait.
3. Pause après un 401 (R-SYN-12) : un onglet resté sur la session perdue ne voit pas une reconnexion faite dans un autre onglet tant qu'il ne se reconnecte pas lui-même ou n'est pas rechargé.
4. Connexion d'un autre compte : selon l'ordre des lectures Dexie, l'accueil peut s'afficher un instant avec l'ancien `meta.me` avant le nouveau (scintillement de la famille de T30-F11, reporté) ; jamais de retour à /login ni de faux bandeau.
5. Constaté, non modifié (hors périmètre) : `isCurrent` du moteur compare la génération avant son `await getMeta` ; un `stop()` pendant cette lecture laisserait passer la réponse d'un cycle périmé. Sans effet sur ces correctifs (la requête de connexion dure bien plus que cette lecture).
