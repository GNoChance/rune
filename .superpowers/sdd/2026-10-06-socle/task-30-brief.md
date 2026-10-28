### Task 30: Écrans d'accès (invitation, création du compte, connexion, réinitialisation, déconnexion)

**Files:**
- Create: `apps/web/src/features/auth/{InvitePage.tsx, CreateAccountForm.tsx, LoginPage.tsx, ResetPage.tsx, LogoutDialog.tsx, PasswordFields.tsx, install-help.ts, messages.ts, auth.module.css}`
- Modify: `apps/web/src/App.tsx` (`/login`, `/invite`, `/reset`)
- Test: `apps/web/test/auth/{invite,login,logout-reset}.test.tsx`, `apps/web/test/auth/messages.test.ts`

**Interfaces:**
- Consumes : T28 ; T29 (`useRepos().me`, `seedOutbox`) ; T11, T12 (`InvitationCheckResponse.role`, `ResetCheckResponse.role`, 429 `rate_limited` des vérifications) ; domain (`parseSecretCode`, `formatSecretCode`, `validateUsername`, `validatePassword`, `usernameKey`, `PasswordRejection`) ; contracts (`PRIVACY_POLICY_VERSION`, `ApiErrorCode`, `Role`).
- Produces : Interfaces partagées §6 (`PasswordFields`, `checkNewPassword`, `USERNAME_MESSAGES`, `LogoutDialog`, `CreateAccountForm` avec la prop `role: Role`) et, localement :
```ts
export function isStandalone(win?: Window): boolean;   // matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
export type InstallPlatform = 'ios' | 'android' | 'other'; export function detectPlatform(userAgent: string): InstallPlatform;
export const PASSWORD_MESSAGES: Record<PasswordRejection, string>; export function passwordMessage(reason: PasswordRejection, role: Role): string;
export function invitationErrorMessage(code: ApiErrorCode): string; export function pendingWarning(n: number, username: string): string;
export function InvitePage(): JSX.Element; export function LoginPage(): JSX.Element; export function ResetPage(): JSX.Element;
```

**Spec:** 02 R-ARR-1, R-ARR-2, R-INV-4, R-INV-5, R-INV-8, §3.4, R-CPT-1, R-CPT-2, R-MDP-1, R-MDP-2, R-AUTH-1, R-AUTH-2, R-AUTH-5, R-AUTH-8, R-AUTH-9, R-RST-1, §15 n°3 et n°5 ; 01 R-SYN-14 ; 03 §13.1, P-AUT-2, P-AUT-6, P-DRT-4.

- [ ] **Step 1: Write the failing test**

```ts
// invite.test.tsx
// accueil : 'appsport est un outil de suivi entre proches', "Ce n'est pas un service médical.", lien 'Confidentialité et règles' → '/privacy'
// installé, lien #abcd-efgh-jkmn-pqrO → check { code: 'ABCDEFGHJKMNPQR0' } (réponse { birthDate: '2008-03-01', role: 'member' }), location.hash vidé ; « Date de naissance » readOnly '01/03/2008' ;
//   "Renseignée par l'administrateur. Une erreur ? Préviens-le." ; '4 mots' ; « Créer mon compte » désactivé avant la case « J'ai lu la page Confidentialité et règles » ;
//   champs « Pseudo », « Mot de passe », « Confirmation » (getByLabelText exact) ;
//   accept { code: 'ABCDEFGHJKMNPQR0', username: 'lea', password: 'cheval agrafe batterie correcte', termsVersion: '1.0' } → location '/onboarding'
// invitation d'amorçage (role 'admin'), 13 caractères → « 14 caractères au moins. » sans requête ; 429 rate_limited au check → « Trop d'essais depuis cet appareil. »
// navigateur iPhone → "Sur l'écran d'accueil" ; Android → "Installer l'application" ; code 'ABCD-EFGH-JKMN-PQRS' + « Copier », aucun formulaire ni requête ;
//   « Continuer dans ce navigateur » → "sur téléphone, tes données ne seront pas dans l'appli installée" puis le formulaire
// codes : invitation_expired « Cette invitation a expiré. », invitation_used « Cette invitation a déjà été utilisée. », invitation_revoked « Cette invitation a été révoquée. »,
//   invitation_unknown « Ce code est inconnu. », chacun suivi de « Demande un nouveau code à l'administrateur. » (role alert)
// installé sans fragment : champ « Lien ou code d'invitation » et bouton « Suivant » ; 'ABC' → « Code incomplet » sans requête ;
//   'abcd efgh jkmn pqrs' ou lien complet collé → check { code: 'ABCDEFGHJKMNPQRS' }
// 11 caractères → « 12 caractères au moins. » sans requête ; confirmation différente → « Les deux mots de passe ne correspondent pas. » ;
//   mot de passe avec le pseudo → PASSWORD_MESSAGES.contains_username ; 409 username_taken → « Ce pseudo est déjà pris. », formulaire gardé
// login.test.tsx : « Pseudo », « Mot de passe », « Se connecter » ; 401 invalid_credentials → « Pseudo ou mot de passe incorrect » ; 403 account_disabled → « Compte désactivé, contacte l'administrateur » ;
//   429 { error: 'rate_limited', retryAfterS: 61 } → « Trop de tentatives. Réessaie dans 2 min. » ;
//   autre pseudo avec 2 ops en attente → dialog '2 éléments non envoyés de lea seront effacés de cet appareil' ; Annuler → aucune requête ; Continuer → '/' et outbox vide ;
//   même pseudo en casse différente → pas de dialog, outbox gardée ; ?reason=account_deleted → 'Ce compte a été supprimé' ;
//   connexion unauthenticated → « Ta session a expiré. Reconnecte-toi. »
// logout-reset.test.tsx : LogoutDialog current avec 3 ops → pendingWarning(3, 'lea'), « Exporter mes données » (/profile/privacy), « Annuler », « Se déconnecter quand même » ;
//   confirmation → POST /api/auth/logout {}, outbox vide, meta.me absente, location '/login' ; sans op → « Se déconnecter de cet appareil ? » et « Se déconnecter » ;
//   mode all → /api/auth/logout-all ; hors ligne → alerte 'Nécessite le réseau', outbox intacte
// ResetPage #abcd-efgh-jkmn-pqrs → check { code: 'ABCDEFGHJKMNPQRS' } (réponse { username: 'lea', role: 'member' }), « Nouveau mot de passe pour lea » ; reset { code, newPassword } → '/' ;
//   role 'admin' et 13 caractères → « 14 caractères au moins. » sans requête ; reset_invalid → « Ce lien n'est plus valable. Demande un nouveau lien à l'administrateur. »
// messages.test.ts
expect(pendingWarning(1, 'lea')).toBe('1 élément non envoyé de lea sera effacé de cet appareil');
expect(pendingWarning(2, 'lea')).toBe('2 éléments non envoyés de lea seront effacés de cet appareil');
// detectPlatform : iPhone → 'ios', Android → 'android', Windows → 'other' ; passwordMessage('too_short','admin') = '14 caractères au moins.' ;
// checkNewPassword({ password: 'a'.repeat(12), confirm: 'a'.repeat(12), username: 'lea', role: 'member' }) = PASSWORD_MESSAGES.single_char
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test auth/` → modules introuvables, routes en `NotFound`.

- [ ] **Step 3: Implement**

Textes exacts : accueil « appsport est un outil de suivi entre proches, hébergé chez ${OWNER_FIRST_NAME}. Ce n'est pas un service médical. » ; iOS « Sur iPhone : touche Partager, puis « Sur l'écran d'accueil ». Ouvre ensuite appsport depuis l'écran d'accueil et colle le code. » ; Android « Sur Android : ouvre le menu ⋮ puis « Installer l'application ». » (autre plateforme : les deux) ; `Banner` warning « Attention : sur téléphone, tes données ne seront pas dans l'appli installée. » ; `rate_limited` (invitation) « Trop d'essais depuis cet appareil. » ; code illisible « Code incomplet : il faut 16 caractères. » ; aide de `PasswordFields` « Astuce : une phrase de 4 mots ou plus, par exemple « cheval agrafe batterie correcte », est facile à retenir et solide. Les espaces sont acceptés. » ; connexion `rate_limited` « Trop de tentatives. Réessaie dans N min. » (N arrondi au supérieur). Saisie du code en mode installé sans fragment ou après le bouton « Continuer dans ce navigateur » ; `PasswordFields` : `label ?? 'Mot de passe'` puis « Confirmation ». Le fragment `#code` est lu puis effacé par `history.replaceState` ; avec un fragment, la vérification part seule (mode installé ou après « Continuer dans ce navigateur »). Le `role` de `InvitationCheckResponse` et `ResetCheckResponse` (T11, T12) fixe le minimum (12 ou 14). `CreateAccountForm` contrôle localement (`validateUsername`, `checkNewPassword`) avant tout envoi ; `password_rejected` et `username_invalid` lisent `body.reason`. `LoginPage` avertit si `pending > 0` et `usernameKey(saisi) !== usernameKey(owner.username)`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/web test auth/` → vert.

- [ ] **Step 5: Commit**

`git commit -m "feat(auth): écrans d'invitation, de connexion, de réinitialisation et de déconnexion"`

---

