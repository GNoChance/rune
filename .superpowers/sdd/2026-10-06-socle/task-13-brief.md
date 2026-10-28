### Task 13: Export, suppression du compte, isolation admin et purge

**Files:**
- Create: `apps/server/src/privacy/{export.ts, delete-account.ts}`, `apps/server/src/auth/purge.ts`, `packages/contracts/src/api/export.ts`
- Modify: `packages/contracts/src/{index.ts, api/auth.ts, api/admin.ts}`, `apps/server/src/auth/me-routes.ts` (`GET /export`, `POST /delete`), `apps/server/src/admin/routes.ts` (`POST /members/:id/delete`), `apps/server/src/jobs/registry.ts` (`authPurgeJob`)
- Test: `apps/server/test/privacy/{export,delete,admin-isolation}.test.ts`, `apps/server/test/auth/purge.test.ts`

**Interfaces:**
- Consumes : T5 (`entityRules`, `rowToCamel`, `insertFixtureRow`) ; T4a (`tableKey`, `Migration`) ; T7 (`DAILY_JOBS`, `DailyJob`) ; T9 à T12 (`logSecurityEvent`, `clearSessionCookie`, `requireUser`, `requireAdmin`, `verifyUserPassword`, `assertNotLastAdmin`, support) ; T8 (constantes de conservation).
- Produces : Interfaces partagées §3 (`EXPORT_FORMAT`, `ExportV1`, `DeleteAccountRequest`, `AdminDeleteMemberRequest`, `buildExport`, `deleteAccount`, `authPurgeJob`). **[décision plan]** `tables` est indexé par le nom SQL ; lignes en camelCase, valeurs telles que stockées (0/1, JSON en texte).

**Spec:** 02 R-EXP-1, R-EXP-2, R-SUP-1 à R-SUP-6, R-REG-1, §15 n°14, n°18, n°19 ; 03 P-AUT-5, P-CAT-2, P-DRT-1, P-DRT-3 à P-DRT-5, P-ADM-1, P-ADM-2, §7, §17 n°1, n°9, n°12 ; 01 R-SYN-24.

- [ ] **Step 1: Write the failing test**

```ts
// export.test.ts (R-EXP-1, R-EXP-2, P-DRT-1)
expect(exp.format).toBe('appsport-export/1'); expect(exp.exportedAt).toBe('2026-10-06T10:00:00.000Z');
expect(exp.account).toMatchObject({ id: u.id, username: 'lea' }); expect(exp.account).not.toHaveProperty('passwordHash');
expect(Object.keys(exp.tables).sort()).toEqual(Object.entries(entityRules).filter(([t, r]) => r.exported && t !== 'user').map(([t]) => t).sort());
// pas de 'session' ; place → [id du lieu de u] ; gyms → [salle fréquentée par u] (pas celle d'un autre) ; gymHistory → [ligne écrite par u] ; pas de '$argon2id'
// data_exported { actorId: u.id, targetId: u.id, details: null } ; Content-Disposition attachment; filename="appsport-export-2026-10-06.json"
// table fixture_export ajoutée par migration + registre (exported, secret 'secret_hash') → exportée sans changer le code : [{ id: 'f1', ownerId, label: 'témoin' }]
// delete.test.ts (R-SUP-1 à R-SUP-6, P-DRT-3) : une ligne plantée dans chaque table liée (registre) + gym, gym_equipment, gym_history, invitation.used_by
// mot de passe faux → invalid_credentials ; 5 faux puis le bon → 429 { error: 'rate_limited' }, compte intact (P-AUT-5) ; bon → 204, Set-Cookie Max-Age=0
// aucune colonne de sqlite_schema (hors security_event) ne contient l'id ; aucune FK vers user ne le référence (02 §15 n°18)
// 2 sessions { revokedReason: 'account_deleted', userId: null } ; gym conservée ; gym_history.author_id NULL ; account_deleted { targetId: u.id, details: null }
// l'autre session de u → 410 { error: 'account_deleted' }
expect(Object.entries(entityRules).filter(([, r]) => r.onUserDelete === 'anonymize').map(([t]) => t)).toEqual(['session']);
// admin, { confirmUsername, password } (mot de passe de l'admin, P-AUT-5) : mot de passe faux → 401 invalid_credentials, compte intact ; confirmUsername 'leo' → { error: 'validation' } ;
//   'LÉA' pour 'Léa' → 204 (R-SUP-2) ; dernier admin : /api/me/delete et /api/admin/members/:id/delete → 409 last_admin (R-SUP-4)
// deleteAccount(trx, deps, dernierAdmin, { actorId: null, ip: null }, { enforceLastAdmin: false }) → compte supprimé, aucun admin restant (réapplication T24)
// admin-isolation.test.ts (P-ADM-1, P-ADM-2, 02 §15 n°14, 03 §17 n°1) : l'admin a un consent_event health/grant actif (la garde C2 ne masque pas le contrôle du
//   propriétaire) ; B a une ligne C1–C3 par table liée, témoins TEMOIN_TP, TEMOIN_HS, TEMOIN_LIM et ids ; routes lues dans ctx.app.routes (méthode ≠ 'ALL'), corps {} :
//   chaque route /api/admin/* (sauf /members/:id/delete), :id = id de B → aucun témoin ; expect(admin.length).toBeGreaterThanOrEqual(MIN_ADMIN_ROUTES) ;
//   chaque route ^/api/(me|places)/ contenant :id, :id = chaque id de ligne de B, autre paramètre 'x' → 404 { error: 'not_found' } ;
//   expect(owned.length).toBeGreaterThanOrEqual(MIN_ID_ROUTES). Constantes en tête du fichier : MIN_ADMIN_ROUTES = 10, MIN_ID_ROUTES = 0 (T18 → 4, T19 → 6).
// purge.test.ts (03 §7) : expect(DAILY_JOBS).toContain(authPurgeJob) ('auth-purge') ; now = '2026-10-06T10:00:00.000Z', LIM = '2026-09-06T10:00:00.000Z', LIM1 = '2026-09-06T10:00:00.001Z'
// sessions : révoquée à LIM → purgée, à LIM1 → gardée ; last_seen_at '2026-06-07T10:00:00.000Z' → purgée ; active → gardée ; account_deleted expirant à now + 1 ms → gardée, à now → purgée
// invitations : expirée → birth_date NULL ; en attente → gardée ; utilisée à LIM ou révoquée à '2026-09-01T10:00:00.000Z' → purgées ; utilisée à LIM1 → gardée
// password_reset : utilisé à LIM → purgé ; annulé à LIM1 → gardé ; expiré à '2026-09-05T10:00:00.000Z' → purgé
// security_event at '2025-10-06T09:59:59.999Z' → purgé ; '2025-10-06T10:00:00.000Z' → gardé
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test export delete admin-isolation purge` → `Failed to resolve import "../../src/privacy/export"`.

- [ ] **Step 3: Implement**

- `buildExport` lit `deps.entityRules` : tables `exported` hors `user` dont `ownerColumn` ∈ {`owner_id`, `user_id`}, sans `secretColumns` ; `gyms` = salles d'un `place` de l'utilisateur (supprimé compris), créées par lui ou dont il a écrit l'historique.
- `POST /api/me/delete` : `verifyUserPassword`, puis transaction. `POST /api/admin/members/:id/delete` : `verifyUserPassword` de l'admin, puis `usernameKey(confirmUsername)` ≠ clé de la cible → `validation`, puis transaction.
- `deleteAccount(trx, deps, userId, actor, opts?: { enforceLastAdmin?: boolean /* true */ })` dans la transaction reçue : `not_found`, `assertNotLastAdmin` (sauf `enforceLastAdmin: false`, réapplication T24), sessions → `user_id = NULL`, `revoked_reason = 'account_deleted'`, `revoked_at = COALESCE(revoked_at, now)` ; `gym_history.author_id = NULL` ; `DELETE FROM user` (les FK font le reste) ; `account_deleted` sans détail ; `security_event` jamais modifié.
- `authPurgeJob` (R = 30 j) : session `account_deleted` supprimée si `expires_at <= now` ; autres sessions si `min(revoked_at, last_seen_at + 90 j, expires_at) + R <= now` ; invitations : `birth_date = NULL` si expirée sans usage ni révocation, suppression si `COALESCE(used_at, revoked_at, expires_at) + R <= now` ; `password_reset` si `COALESCE(used_at, cancelled_at, expires_at) + R <= now` ; `security_event` si `at < now − 12 mois calendaires` ; `logger.info('auth purge', { job: 'auth-purge', count })`.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  4 passed` ; `pnpm test` (dont le registre T5) et `pnpm typecheck` verts.

- [ ] **Step 5: Commit**

`git commit -m "feat(privacy): export appsport-export/1, suppression de compte, isolation admin et purge"`

---

## Partie 3 — Profil, lieux, salles et consentement

