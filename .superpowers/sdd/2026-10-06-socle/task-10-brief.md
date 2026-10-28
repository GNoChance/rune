### Task 10: Connexion, limitation, déconnexion, mot de passe et /api/me

**Files:**
- Create: `apps/server/src/auth/{limiter.ts, routes.ts, me.ts, me-routes.ts}`, `apps/server/src/privacy/consent-state.ts`, `apps/server/test/support/users.ts`
- Modify: `packages/contracts/src/api/auth.ts` (`ONBOARDING_STEPS` … `UpdateMeRequest`), `apps/server/src/routes.ts` (`/api/auth`, `/api/me`), `apps/server/test/support/index.ts`
- Test: `apps/server/test/auth/{limiter,login,password-change,me}.test.ts`, `apps/server/test/privacy/consent-state.test.ts`

**Interfaces:**
- Consumes : T8 (règles, `hashPassword`, `verifyPassword`, `needsRehash`, `COMMON_PASSWORDS`, constantes) ; T9 (`createSession`, `setSessionCookie`, `clearSessionCookie`, `revokeSession`, `revokeSessions`, `requireUser`, `logSecurityEvent`) ; T2 (`ageBandOn`, `parisDate`, `computeCautious`, `PRIVACY_POLICY_VERSION`) ; T4a (`writeStamp`) ; T6 (`parseJson`, `httpError`, `clientIp`).
- Produces : Interfaces partagées §3 (`api/auth.ts` : `ONBOARDING_STEPS`, `OnboardingStep`, `ConsentStatus`, `ConsentState`, `MeResponse`, `LoginRequest`, `ChangePasswordRequest`, `UpdateMeRequest` ; `limiter.ts` ; `consent-state.ts` ; `me.ts` dont `verifyUserPassword(db, deps, user, password, ip)` ; `authRoutes`, `meRoutes` ; support `users.ts`). Point d'extension R-AGE-3, propre à `me.ts` : `export async function userTraits(db: DbExecutor, deps: AppDeps, userId: string): Promise<{ ageBand: AgeBand; cautious: boolean }>`, utilisé par `buildMe` et par les briques 3 et 4 (jamais `birthDate`).

**Spec:** 02 R-AUTH-1 à R-AUTH-7, R-MDP-1, R-MDP-4 à R-MDP-6, R-CPT-3, R-AGE-2, R-AGE-3, R-CST-1, R-CST-7, §14, §15 n°7 ; 03 P-AUT-1, P-AUT-5, P-MIN-2, P-MIN-3.

- [ ] **Step 1: Write the failing test**

```ts
// limiter.test.ts (R-AUTH-2, R-AUTH-3)
// 4 échecs → allowed ; 5e → { allowed: false, retryAfterS: 60 } ; après attente, échecs suivants → 120, 240, 480, 900 (plafond)
// 10e échec dans l'heure → 3600 ; à +3 599 s → 1 ; à +3 600 s → allowed
// un succès remet le compteur consécutif à zéro mais pas la fenêtre d'une heure (4 + 4 + 2 échecs entre deux succès → 3600)
// des échecs de plus d'une heure sortent de la fenêtre
// 30 échecs d'une IP (pseudos différents) → check('lea', IP) = 3600 ; autre IP ou null → allowed ; unlock → allowed
// createIpLimiter(clock, { limit: 20, windowMs: 3_600_000 }) : 20 hits acceptés, 21e { allowed: false, retryAfterS: 3600 }, autre IP acceptée, +1 h → accepté
// login.test.ts
// succès (pseudo 'LÉA' pour 'Léa') : 200 MeResponse { username: 'Léa', role: 'member', mustChangePassword: false }, cookie __Host-session,
//   last_login_at '2026-10-06T10:00:01.000Z', rev augmenté, login_succeeded { outcome: 'success', tailnetIp: '100.64.0.1' }
// mauvais mot de passe ou pseudo inexistant → 401 { error: 'invalid_credentials' } et un login_failed { outcome: 'failure', targetId: <id> ou null }
// 5 échecs (pseudo existant ou non) → 429 { error: 'rate_limited', retryAfterS: 60 } ; deux login_blocked ; +60 s → 200 (02 §15 n°7)
// 10e échec dans l'heure → 429 { retryAfterS: 3600 } ; +1 h → 200 ; succès intercalé → compteur remis à zéro
// 30 échecs depuis 100.64.0.9 → 429 depuis cette IP, 200 depuis 100.64.0.10 (R-AUTH-3)
// compte disabled : mauvais mot de passe → invalid_credentials ; bon → 403 { error: 'account_disabled' } sans Set-Cookie (R-AUTH-5)
// admin avec 'abcdefghijklm' (13) → mustChangePassword true ; /api/me 200 ; logout-all → { error: 'password_change_required' } (R-MDP-1)
// config argon2 { ...TEST_ARGON2, memoryKiB: 2048 } et haché TEST_ARGON2 → après connexion /^\$argon2id\$v=19\$m=2048,t=1,p=1\$/, password_changed_at inchangé (R-MDP-4)
// password-change.test.ts
// POST /api/auth/password { currentPassword, newPassword: 'tortue verte du jardin' } → 204 ; session courante 200, autre 401 ;
//   ancien mot de passe 401, nouveau 200 ; password_changed_at '2026-10-06T10:00:01.000Z' ; un password_changed (R-MDP-6)
// actuel faux → 401 invalid_credentials ; 5 actuels faux puis le bon → 429 { error: 'rate_limited', retryAfterS: 60 }, et POST /login de ce pseudo → 429 (P-AUT-5, R-AUTH-2)
// nouveau 'court' → 400 { error: 'password_rejected', reason: 'too_short' }
// admin mustChangePassword → après changement ('quatorze carac'), me.mustChangePassword false et PATCH /api/me → 200
// logout → 204, Set-Cookie Max-Age=0, session courante 401, autre 200, un logout ; logout-all → 204, toutes 401, revoked_reason ['logout_all','logout_all'], un logout_all (R-AUTH-7)
// me.test.ts
// birthDate '2008-10-07' : { ageBand: 'minor', cautious: true } ; à '2026-10-06T22:30:00.000Z' (7 oct. à Paris) : { ageBand: 'adult', cautious: false } (R-AGE-2) ;
//   userTraits(db, deps, id) rend ces deux mêmes valeurs (R-AGE-3)
// cautiousMode 1 → cautious true ; caution 1 sans consentement → false, puis avec consent_event health/grant → true (R-CST-7)
// passwordReminderDue : admin dont password_changed_at = '2025-10-06T09:00:00.000Z' → true ; membre → false ; '2025-10-06T11:00:00.000Z' → false (R-MDP-5)
// PATCH /api/me { username: 'Léa.B' } → 200, username_key 'léa.b', rev augmenté, un username_changed (R-CPT-3)
// pseudo pris ('ÉLOÏSE' contre 'Éloïse') → 409 { error: 'username_taken' } ; 'ab' → 400 { error: 'username_invalid', reason: 'length' } ;
//   'Le\u0301a' → username stocké 'Léa' (NFC) ; deux comptes, PATCH simultanés vers 'Zoé' → statuts triés [200, 409 username_taken]
// { username: 'lea2', birthDate: '2000-01-01' } → 400 { error: 'validation' }, birth_date et username inchangés (P-MIN-2)
// consent-state.test.ts (R-CST-1) : sans événement { active: false, textVersion: null, at: null } pour health et aiCoach ;
//   grant → { active: true, textVersion: '1.0', at: '2026-10-06T10:00:00.000Z' } ; puis withdraw au même instant (horloge non avancée) → isHealthConsentActive false
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test limiter login password-change me consent-state` → `Failed to resolve import "../../src/auth/limiter"`, `createUser is not exported`.

- [ ] **Step 3: Implement**

Limiteur en mémoire (`LOGIN_LIMITS`) :
```ts
// check : waits = [] ; lockedUntil > now → lockedUntil − now ; consecutive ≥ 5 → lastFailureAt + min(60_000 * 2 ** (consecutive − 5), 900_000) − now ;
//         échecs de l'IP sur 1 h ≥ 30 → plus ancien + 3_600_000 − now ; w = max(waits) > 0 ? { allowed: false, retryAfterS: ceil(w / 1000) } : { allowed: true }
// recordFailure : consecutive++, lastFailureAt = now, failures = échecs < 1 h + now ; failures ≥ 10 → lockedUntil = now + 3_600_000 ; IP : ajoute now
// recordSuccess : consecutive = 0 (failures et lockedUntil gardés) ; unlock : efface l'état du pseudo ; IpLimiter.hit ne compte que les essais acceptés
```
- `POST /login` : limiteur vérifié avant tout (`login_blocked`, `outcome 'blocked'`) ; pseudo inconnu → `verifyPassword` sur une empreinte factice (calculée une fois par `deps`) pour égaliser le temps ; échec → `recordFailure`, `login_failed` ; compte `disabled` → `login_failed` `{ reason: 'disabled' }`, `account_disabled` ; succès → si `needsRehash`, haché hors transaction puis `UPDATE user SET password_hash` seul (ni `storeNewPassword` ni `password_changed_at` : les liens en attente restent valides) ; dans une transaction `last_login_at` + `writeStamp`, `createSession(…, { mustChangePassword: role === 'admin' && passwordLength(password) < PASSWORD_MIN_ADMIN })`, `login_succeeded`.
- `verifyUserPassword(db, deps, user: SessionUser, password, ip): Promise<void>` (toute ressaisie, P-AUT-5) : `authLimiters(deps).login.check(usernameKey(user.username), ip)` bloqué → 429 `rate_limited { retryAfterS }` ; faux → `recordFailure` puis 401 `invalid_credentials` ; juste → `recordSuccess`.
- `POST /password` : `verifyUserPassword` ; haché hors transaction ; `storeNewPassword` (annule aussi les `password_reset` en attente), `revokeSessions(…, 'password_change', sessionId)`, `must_change_password = 0` sur la session courante, `password_changed`.
- `PATCH /api/me` : `UpdateMeRequest` = `z.strictObject` (tout champ inconnu → `validation`) ; pseudo stocké en NFC ; contrôle `username_key` et écriture dans la même transaction, et une violation UNIQUE sur `username_key` traduite en 409 `username_taken`.
- `getConsentState` : dernier événement par type, `ORDER BY created_at DESC, rev DESC`.
- `buildMe` : `ageBand` et `cautious` par `userTraits` ; `cautious` via `computeCautious` (caution = `health_screening.caution` non supprimé, sinon `null`) ; `passwordReminderDue` = admin et `(passwordChangedAt ?? createdAt) + 12 mois calendaires ≤ now` ; `GET /api/me` passe `user.mustChangePassword`.
- `createUser` (support) : insertion directe, `hashPassword(password, config.argon2)`, `termsVersion = PRIVACY_POLICY_VERSION` ; `onboarded` → `onboardingStep 'ready'`, `onboardingCompletedAt = now`. `login` renvoie `nom=valeur` du `Set-Cookie` et lève si le statut n'est pas 200.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  5 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(auth): connexion limitée, déconnexion, changement de mot de passe et /api/me"`

---

