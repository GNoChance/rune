### Task 9: Sessions, middleware et journal de sécurité

**Files:**
- Create: `apps/server/src/auth/{security-log.ts, session.ts}`
- Modify: `apps/server/src/app.ts` (`app.use('/api/*', sessionMiddleware(deps))` après `originGuard`)
- Test: `apps/server/test/auth/{session,security-log}.test.ts`

**Interfaces:**
- Consumes : T6 (`AppDeps`, `AppEnv`, `SessionUser`, `httpError`, `errorHandler`, `createLogger`, `createTestContext`) ; T4a/T5 (`DbExecutor`, `insertFixtureRow`, `FakeClock`) ; T8 (`hashSecret`, `SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS`, `SESSION_TOUCH_INTERVAL_MS`).
- Produces : Interfaces partagées §3 (`security-log.ts`, `session.ts`). Convention : sans session valide, `user` et `sessionId` valent `null` ; pour une session `revoked_reason = 'account_deleted'`, `sessionId = <id>` et `user = null`, ce que `requireUser` traduit en 410.

**Spec:** 02 R-AUTH-6, R-ROLE-4, R-MDP-1, §14, §15 n°4 ; 03 P-AUT-3, P-DRT-4, P-LOG-1, P-LOG-2, §17 n°7 et n°8.

- [ ] **Step 1: Write the failing test**

`session.test.ts` monte une app de sonde (`sessionMiddleware`, `POST /probe/login/:id[?mcp=1]` → `createSession` + `setSessionCookie`, `GET /probe/user` sous `requireUser`, `GET /probe/admin` sous `requireAdmin`, et `GET /api/me`, `POST /api/auth/{password,logout,logout-all}` sous `requireUser`) :
```ts
expect(setCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43};/);   // P-AUT-3
for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000']) expect(setCookie).toContain(a);
expect(setCookie).not.toMatch(/Domain=/i);
// origine http://localhost:5173 → /^dev-session=/ sans 'Secure' ; clearSessionCookie → /^__Host-session=;.*Max-Age=0/
expect(row.tokenHash).toBe(sha256(token)); expect(Object.values(row)).not.toContain(token);   // 02 §15 n°4
expect(row.expiresAt).toBe('2027-10-06T10:00:00.000Z'); expect(row.mustChangePassword).toBe(0);
// sans cookie → 401 { error: 'unauthenticated' } ; avec cookie → { id, role: 'member', birthDate: '1990-01-01', mustChangePassword: false }
// inactivité : a actif à J+89 → 200 ; b inactif à J+90 → 401 ; a encore actif à J+178 → 200
// durée absolue : actif tous les 80 j → 200 jusqu'à J+365 − 1 ms, 401 à J+365
// last_seen_at : inchangé à +30 min ('2026-10-06T10:00:00.000Z'), réécrit à +61 min ('2026-10-06T11:01:00.000Z')
expect(await revokeSessions(db, deps, userId, 'admin', a.sessionId)).toBe(1);   // a garde 200, b → 401 { error: 'unauthenticated' }
// session account_deleted (user_id NULL) → 410 { error: 'account_deleted' } ; /api/health reste 200 (P-DRT-4)
// compte disabled → 401 ; requireAdmin : membre → 403 { error: 'forbidden' }, admin → 200 (R-ROLE-4)
// mustChangePassword (R-MDP-1) : GET /api/me, POST /api/auth/password, POST /api/auth/logout → 200 ; POST /api/auth/logout-all et /probe/user → 403 { error: 'password_change_required' }
// logger : ni le jeton ni son empreinte (03 §17 n°7)
// security-log.test.ts (P-LOG-1)
expect(row).toMatchObject({ type: 'login_succeeded', actorId: 'u1', targetId: 'u1', tailnetIp: '100.64.0.1', outcome: 'success', at: '2026-10-06T10:00:00.000Z' });
expect(JSON.parse(row.details)).toEqual({ role: 'admin' });   // sans détails → details NULL
// details { role: 'member', inviteCode: 'ABCD', tokenHash: 'x', newPassword: 'y' } → stocké { role: 'member' } ; journal contient 'security details dropped', pas 'ABCD'
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test session security-log` → `Failed to resolve import "../../src/auth/session"`.

- [ ] **Step 3: Implement**

- Jeton = `base64url` de `ids.randomBytes(32)` ; ligne `session` avec `tokenHash`, `expiresAt = now + SESSION_MAX_DAYS`, `mustChangePassword` 0/1. Cookie par `hono/cookie` : nom `config.sessionCookieName`, `httpOnly`, `secure: config.secureCookie`, `sameSite: 'Lax'`, `path: '/'`, `maxAge: SESSION_MAX_DAYS * 86400`.
- `sessionMiddleware` : session révoquée (hors `account_deleted`), `expiresAt <= now` ou `lastSeenAt + 90 j <= now`, utilisateur absent ou `disabled` → `null`/`null` ; sinon `SessionUser` avec `mustChangePassword: row.mustChangePassword === 1`, et `last_seen_at` réécrit si `now − lastSeenAt ≥ SESSION_TOUCH_INTERVAL_MS`.
- `requireUser` : `MUST_CHANGE_ALLOWED` comparé à `` `${method} ${path}` ``.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test session security-log` → `Test Files  2 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(auth): sessions par cookie __Host-session et journal de sécurité"`

---

