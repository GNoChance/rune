### Task 11: Invitations, création de compte et amorçage

**Files:**
- Create: `apps/server/src/auth/{invitations.ts, invitation-routes.ts, bootstrap.ts}`, `packages/contracts/src/api/admin.ts` (invitations)
- Modify: `packages/contracts/src/{index.ts, api/auth.ts}`, `apps/server/src/routes.ts` (`/api/invitations`, `/api/admin/invitations`), `apps/server/src/cli.ts` (`admin:bootstrap`)
- Test: `apps/server/test/auth/{invitation,invitation-concurrency,bootstrap}.test.ts`

**Interfaces:**
- Consumes : T8 (`createSecretCode`, `hashSecret`, `parseSecretCode`, règles, `hashPassword`, constantes, `CivilDate`) ; T9 ; T10 (`authLimiters`, `buildMe`, `createUser`, `createUserAndLogin`) ; T2 (`ageOn`, `parisDate`, `MIN_AGE`, `PRIVACY_POLICY_VERSION`) ; T4a (`writeStamp`) ; T7 (`COMMANDS`, `parseFlags`, `withAppDeps`, `runCli`).
- Produces : Interfaces partagées §3 (`CodeRequest`, `InvitationCheckResponse`, `AcceptInvitationRequest`, `InvitationState`, `InvitationSummary`, `CreateInvitationRequest`, `CreateInvitationResponse`, `invitations.ts`, `invitation-routes.ts`, `bootstrap.ts`, commande `admin:bootstrap`).

**Spec:** 02 R-INV-1 à R-INV-9, R-CPT-1, R-CPT-2, R-ROLE-5, R-ARR-1, R-ARR-2, §15 n°1 à n°4 ; 03 P-MIN-1, P-MIN-2, P-AUT-2, §17 n°5 et n°7 ; Review Focus 1.

- [ ] **Step 1: Write the failing test**

```ts
// invitation.test.ts (admin 'porteur' connecté ; CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
// birthDate '2010-10-07' → 400 { error: 'under_min_age' } ; '2010-10-06' → 201 ; à '2026-10-05T22:30:00.000Z' (6 oct. à Paris) '2010-10-06' → 201 (02 §15 n°1)
// note de 61 caractères → 400, 60 → 201 ; membre → { error: 'forbidden' }
expect(r.code).toMatch(CODE_RE); expect(r.link).toBe(`https://appsport.test.ts.net/invite#${r.code}`);
expect(r.invitation).toMatchObject({ note: 'pour Léa', state: 'pending', usedByUsername: null, expiresAt: '2026-10-13T10:00:00.000Z' });
// row.codeHash = hashSecret(canonique) ; ni la ligne ni la liste ne contiennent le code canonique ; un invitation_created (R-INV-3)
// révocation → 204 et un invitation_revoked, seconde révocation → 409 ; accept → 'used' { usedByUsername: 'lea' } ; birth_date gardée seulement pour 'pending' ; +7 j → 'expired' (R-INV-7)
// check (R-INV-8) : code en minuscules ou lien complet → { birthDate: '2001-05-04', role: 'member' } (rôle visé : minimum de mot de passe côté client) ; 'AAAA-AAAA-AAAA-AAAA' et 'pas un code' → invitation_unknown ;
//   révoquée → invitation_revoked ; utilisée → invitation_used ; +7 j → 400 { error: 'invitation_expired' }
// accept (R-CPT-2) : 201 MeResponse { username: 'Éloïse_2', role: 'member', birthDate: '2001-05-04', termsVersion: '1.0', onboardingCompletedAt: null } + cookie ;
//   user { invitationId, termsAcceptedAt: '2026-10-06T10:00:00.000Z', status: 'active' } ; invitation_used { actorId: uid, targetId: uid }
// échec de validation sans consommer (R-CPT-1, 02 §15 n°2) : 'court' → { error: 'password_rejected', reason: 'too_short' } ;
//   'Admin' → { error: 'username_invalid', reason: 'reserved' } ; 'porteur' → { error: 'username_taken' } ; termsVersion '0.9' → { error: 'validation' } ;
//   l'invitation reste 'pending', puis accept valide → 201
// 19 check + 1 accept depuis 100.64.0.7 → la 21e vérification → 429 { error: 'rate_limited' } ; autre IP → 400 ; +1 h → 400
// ni le code, ni le canonique, ni l'empreinte dans les journaux et security_event (02 §15 n°4)
// invitation-concurrency.test.ts (R-INV-6, Review Focus 1)
const [a, b] = await Promise.all([accept('lea'), accept('leo')]);
expect([a.status, b.status].sort()).toEqual([201, 400]); expect(await (a.status === 400 ? a : b).json()).toEqual({ error: 'invitation_used' });
// un seul membre ; 5 accept simultanés dont un mot de passe 'court' → exactement un 201 et un membre
// bootstrap.test.ts (R-ROLE-5)
const r = await bootstrapAdminInvitation(ctx.deps, '1985-03-02'); expect(r.expiresAt).toBe('2026-10-07T10:00:00.000Z');
// check → { birthDate: '1985-03-02', role: 'admin' } ; accept 'treize carac' → { error: 'password_rejected', reason: 'too_short' } ; 'quatorze carac' → role 'admin'
// une seconde invitation d'amorçage révoque la première (check → invitation_revoked, sa birth_date NULL) ; un admin existe → rejects { code: 'conflict' }
// CLI après init : runCli(['admin:bootstrap', '--birth-date', '1985-03-02']) → 0 et exactement 3 lignes :
expect(out[0]).toBe('Invitation administrateur (valable 24 h)');
expect(out[1]).toMatch(/^Lien : https:\/\/appsport\.test\.ts\.net\/invite#[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
expect(out[2]).toBe(`Code : ${out[1]!.split('#')[1]}`);
// ligne { isAdminBootstrap: 1, createdBy: null, birthDate: '1985-03-02' }, expires_at − created_at = 24 h, seule l'empreinte stockée
// date absente, '1985-02-30' ou '2015-01-01' → code 1, rien sur stdout
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test invitation bootstrap` → `Failed to resolve import "../../src/auth/bootstrap"`, puis 404 sur `/api/admin/invitations`.

- [ ] **Step 3: Implement**

`acceptInvitation`, dans cet ordre (Review Focus 1) : (1) Zod ; (2) `termsVersion !== PRIVACY_POLICY_VERSION` → `validation { field: 'termsVersion' }` ; (3) état lu hors transaction ; (4) `validateUsername`, `validatePassword` avec le rôle visé (`admin` si `is_admin_bootstrap`) ; (5) `hashPassword` **hors transaction** ; (6) dans `deps.db.transaction()` : relire l'état, refuser un `usernameKey` pris, puis
```sql
UPDATE invitation SET used_at = :now, used_by = :uid, birth_date = NULL WHERE id = :id AND used_at IS NULL AND revoked_at IS NULL
```
`numUpdatedRows !== 1n` → `invitation_used` ; insérer le `user` (pseudo en NFC, violation UNIQUE → `username_taken` ; `birthDate` de l'invitation, `termsAcceptedAt`, `lastLoginAt`, `passwordChangedAt` = now, `writeStamp`), `createSession`, `invitation_used` (`details { invitationId }`). `POST /check` et `/accept` passent d'abord par `authLimiters(deps).invitationCheck.hit(ip)`. `checkInvitation` renvoie `role` = `admin` si `is_admin_bootstrap`, sinon `member`. Révocation : inconnue → `not_found`, non `pending` → `conflict`, `birth_date = NULL`, `invitation_revoked`. `bootstrapAdminInvitation` : admin existant → `conflict { reason: 'admin_exists' }`, sinon révoque les amorçages `pending` (`revoked_at = now`, `birth_date = NULL`) puis `createInvitation(… { isAdminBootstrap: true, ttlMs: 24 h, createdBy: null })`.

Messages CLI (stderr, code 1) : « Date de naissance invalide : utilise --birth-date AAAA-MM-JJ. » ; « appsport est réservé aux 16 ans et plus. » ; « Un administrateur existe déjà : utilise admin:reset <pseudo>. »

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  3 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(auth): invitations à usage unique, création de compte et amorçage admin"`

---

