### Task 12: Réinitialisation, gestion des membres et état du serveur

**Files:**
- Create: `apps/server/src/auth/password-reset.ts`, `apps/server/src/admin/{members.ts, routes.ts, ops-status.ts}`, `packages/contracts/src/ops.ts`
- Modify: `apps/server/src/auth/routes.ts` (`/reset/check`, `/reset`), `packages/contracts/src/{index.ts, api/admin.ts, api/auth.ts}`, `apps/server/src/routes.ts` (`/api/admin`), `apps/server/src/cli.ts` (`admin:reset`)
- Test: `apps/server/test/auth/password-reset.test.ts`, `apps/server/test/admin/{members,ops-status}.test.ts`

**Interfaces:**
- Consumes : T8 à T11 (`createSecretCode`, `hashSecret`, `parseSecretCode`, `validatePassword`, `hashPassword`, `RESET_TTL_HOURS`, sessions, `logSecurityEvent`, `authLimiters`, `buildMe`, `verifyUserPassword`, `storeNewPassword`, `getConsentState`, `acceptInvitation`, support) ; T2 ; T4a ; T7.
- Produces : Interfaces partagées §3 (`ResetCheckResponse`, `ResetPasswordRequest`, `OpsCheck`, `OpsStatus`, `MemberSummary`, `ResetLinkResponse`, `SetStatusRequest`, `SetRoleRequest`, `SetBirthDateRequest`, `OpsStatusResponse`, `password-reset.ts`, `admin/members.ts` (avec `type AdminActor = { actorId: string; ip: string | null }`, non exporté), `ops-status.ts`, `adminRoutes`, commande `admin:reset`).

**Spec:** 02 R-RST-1 à R-RST-4, R-ADM-1, R-ROLE-2, R-ROLE-4, R-ROLE-5, R-AGE-4, R-AUTH-2, R-AUTH-7, §6, §15 n°8 et n°9 ; 03 P-AUT-2, P-AUT-5, P-AUT-8, P-MIN-1, P-MIN-2, §5 ; 08 §9.

- [ ] **Step 1: Write the failing test**

```ts
// password-reset.test.ts (02 §15 n°8)
expect(r.link).toBe(`https://appsport.test.ts.net/reset#${r.code}`); expect(r.expiresAt).toBe('2026-10-07T10:00:00.000Z');
// check (code en minuscules) → { username: 'lea', role: 'member' } ; reset → 200 MeResponse de la cible + cookie ; ancienne session → 401 ; réutilisation → { error: 'reset_invalid' } ;
//   password_reset_created et password_reset_used journalisés
// +24 h → reset_invalid ; un nouveau lien annule le précédent ; un changement de mot de passe aussi (R-RST-2)
// 10 échecs de connexion puis reset → la connexion avec le nouveau mot de passe → 200 (déblocage)
// 'lea lea lea lea' → { error: 'password_rejected', reason: 'contains_username' }, lien intact
// lien pour soi-même → 403 { error: 'reset_self_forbidden' } (R-RST-4)
// 19 reset/check + 1 reset (code faux) depuis 100.64.0.7 → la 21e → 429 { error: 'rate_limited' } ; autre IP → 400 reset_invalid ; +1 h → 400 (P-AUT-2)
// CLI : dossier temporaire dir avec .appsport-volume, env { APP_ORIGIN: 'https://appsport.test.ts.net', APPSPORT_DATA_DIR: dir }, runCli(['init']) ;
//   admin:reset inconnu → 1 sans sortie ; admin:bootstrap (code = 3e ligne) ; ctx = createTestContext({ dbPath: join(dir, 'appsport.db') }) ;
//   acceptInvitation(ctx.deps, { code, username: 'porteur', password: 'quatorze carac', termsVersion: '1.0' }, null) :
expect(await runCli(['admin:reset', 'PORTEUR'], env, (l) => out.push(l))).toBe(0);
expect(out[0]).toBe('Lien de réinitialisation pour porteur (valable 24 h)');
expect(out[1]).toMatch(/^Lien : https:\/\/appsport\.test\.ts\.net\/reset#[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/); expect(out[2]).toBe(`Code : ${out[1]!.split('#')[1]}`);
// checkPasswordReset de ce code → { username: 'porteur', role: 'admin' } ; ctx.close() avant rmSync(dir) (Windows verrouille le fichier)
// members.test.ts (02 §6)
expect(list[0]).toEqual({ id: m.id, username: 'lea', role: 'member', status: 'active', isMinor: true, lastLoginAt: '2026-10-06T10:00:00.000Z',
  onboardingCompleted: true, consents: { health: true, aiCoach: false }, activeSessions: 2 });   // liste triée ['lea', 'porteur']
// membre → { error: 'forbidden' } sur /api/admin/* (R-ROLE-4)
// dernier admin actif : role member ou status disabled → { error: 'last_admin' } ; un autre admin disabled ne compte pas (409) ; un autre admin actif → 204 (R-ROLE-2, 02 §15 n°9) ;
//   deux admins se rétrogradent l'un l'autre en Promise.all → statuts triés [204, 409 last_admin], un admin actif reste
// rôle : mot de passe admin faux → invalid_credentials ; bon → 204, { role: 'admin', updatedBy: admin.id }, un role_changed (P-AUT-5)
// disabled → sessions 401, connexion { error: 'account_disabled' } ; active → connexion 200 (R-ADM-1)
// birth-date '2010-10-07' → under_min_age ; '2009-01-01' → 204 et un birth_date_corrected (R-AGE-4)
// revoke-sessions → 204, session 401, un sessions_revoked (R-AUTH-7) ; membre inconnu → { error: 'not_found' }
// ops-status.test.ts (08 §9) : readOpsStatus → null si absent, JSON invalide ou { backup: { at: 'x', ok: 'oui' } } ; sinon le contenu validé
// GET /api/admin/ops-status avec config { dataDir, version: 'v1.2.3' } → { version: 'v1.2.3', opsStatus: null }
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test password-reset members ops-status` → `Failed to resolve import "../../src/admin/ops-status"`.

- [ ] **Step 3: Implement**

`consumePasswordReset` : `checkPasswordReset`, compte `disabled` → `account_disabled`, `validatePassword` et `hashPassword` hors transaction, puis dans la transaction
```sql
UPDATE password_reset SET used_at = :now WHERE id = :id AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > :now
```
(≠ 1 ligne → `reset_invalid`), `storeNewPassword`, `revokeSessions(…, 'password_reset')`, `createSession`, `password_reset_used` ; après commit `authLimiters(deps).login.unlock(usernameKey)`. `POST /reset/check` et `/reset` passent d'abord par `authLimiters(deps).resetCheck.hit(ip)` ; `checkPasswordReset` renvoie le `role` de la cible. `listMembers` ne lit aucune table C1 à C3 hors `consent_event` (état) et `session` (comptage seul : non révoquées, `expiresAt > now`, `lastSeenAt + 90 j > now`). `setRole`, `setStatus` : `assertNotLastAdmin` et écriture dans la même transaction ; le changement de rôle commence par `verifyUserPassword(db, deps, adminUser, password, ip)`. Journaux : `role_changed { role }`, `status_changed { status }` (et `revokeSessions(…, 'admin')` si `disabled`), `birth_date_corrected` sans détail, `sessions_revoked { count }`. CLI `admin:reset` : pseudo cherché par `usernameKey` ; absent → « Pseudo inconnu : <pseudo> » sur stderr, code 1.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  3 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(admin): liens de réinitialisation, gestion des membres et état du serveur"`

---

