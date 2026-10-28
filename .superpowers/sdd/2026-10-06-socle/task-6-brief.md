### Task 6: Serveur Hono, sécurité HTTP et `/api/health`

**Files:**
- Create: `packages/contracts/src/api/{errors.ts, health.ts}` ; Modify: `packages/contracts/src/index.ts`, `packages/contracts/package.json` (`zod@^4`)
- Create: `apps/server/src/{config.ts, app-env.ts, app.ts, routes.ts, logger.ts}`, `apps/server/src/http/{errors.ts, validate.ts, security-headers.ts, origin-guard.ts, request-log.ts, client-ip.ts, epoch-header.ts}`, `apps/server/src/health/routes.ts`
- Modify: `apps/server/src/deps.ts` (+ `Argon2Params`, `ARGON2_PARAMS`, `AppDeps`, `createAppDeps`), `apps/server/package.json` (`hono@~4.13`, `@hono/node-server@~2.1`, `zod@^4`)
- Create: `apps/server/test/support/context.ts` ; Modify: `apps/server/test/support/index.ts`
- Test: `packages/contracts/test/errors.test.ts`, `apps/server/test/{config,logger}.test.ts`, `apps/server/test/http/{security-headers,origin-guard,request-log,errors,client-ip}.test.ts`, `apps/server/test/health/health.test.ts`

**Interfaces:**
- Consumes : Tasks 4a et 4b (`Clock`, `IdGen`, `systemClock`, `cryptoIds`, `getServerMeta`, `migrate`, `MIGRATIONS`, `initServerMeta`, `FakeClock`, `seqIds`, `Migration`) ; Task 3 ; Task 5 (`entityRules`) ; Task 2.
- Produces : Interfaces partagées §1 (`api/errors.ts`, `api/health.ts`) et §2 (`deps.ts` sauf `syncHooks`, `config.ts`, `app-env.ts`, `app.ts`, `routes.ts`, `http/*`, `health/routes.ts`, `logger.ts`, support `context.ts` avec `dbPath`).

**Spec:** 01 §3 et 08 §4 (points 2, 3, 6), R-VER-3, R-SYN-25, P-AUT-4, P-AUT-7, P-AUT-9, P-LOG-2, P-LOG-4, Global Constraints « Format d'erreur API », « En-têtes HTTP », « CSRF », « Cookie de session », « Configuration serveur ».

- [ ] **Step 1: Write the failing test**

```ts
// errors.test.ts : chaque code de ApiErrorCode.options a le statut des groupes des Interfaces partagées §1 (33 codes)
expect(ApiErrorBody.parse({ error: 'protocol_unsupported', serverProtocol: 1, minProtocol: 1 })).toEqual({ error: 'protocol_unsupported', serverProtocol: 1, minProtocol: 1 });
// config.test.ts
expect(() => loadConfig({})).toThrow(ConfigError);
expect(() => loadConfig({ APP_ORIGIN: 'https://appsport.x.ts.net/chemin' })).toThrow(ConfigError);
expect(() => loadConfig({ APP_ORIGIN: 'http://appsport.x.ts.net' })).toThrow(ConfigError);   // http seulement pour localhost / 127.0.0.1
expect(loadConfig({ APP_ORIGIN: 'https://appsport.x.ts.net' })).toMatchObject({ appOrigin: 'https://appsport.x.ts.net', version: 'dev', port: 3000,
  host: '0.0.0.0', dataDir: '/data', publicDir: '/app/public', contentDir: '/app/data', swKillSwitch: false, coachModel: 'claude-opus-5-5',
  anthropicApiKey: null, argon2: { memoryKiB: 19456, passes: 2, parallelism: 1, tagLength: 32, saltLength: 16 }, sessionCookieName: '__Host-session', secureCookie: true });
// dbPath = join('/data', 'appsport.db') ; sentinelPath = join('/data', '.appsport-volume')
expect(loadConfig({ APP_ORIGIN: 'http://localhost:5173' })).toMatchObject({ sessionCookieName: 'dev-session', secureCookie: false });
expect(loadConfig({ APP_ORIGIN: 'https://a.ts.net', SW_KILL_SWITCH: '1', PORT: '8080', APP_VERSION: 'v1.2.3', ANTHROPIC_API_KEY: '' }))
  .toMatchObject({ swKillSwitch: true, port: 8080, version: 'v1.2.3', anthropicApiKey: null });
expect(loadConfig({ APP_ORIGIN: 'https://a.ts.net', PORT: '0' }).port).toBe(0);   // port libre, utilisé par la Task 7
// logger.test.ts : info('x', { requestId: 'r1', secret: 'TEMOIN' }) → JSON { level: 'info', msg: 'x', requestId: 'r1', time } ; ni 'secret' ni 'TEMOIN'
// security-headers.test.ts : sur GET /api/health, un 404 /api/inexistant et une route qui lève (500)
expect(pick(res.headers)).toEqual({ 'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' });
// X-Appsport-Epoch = serverEpoch sur /api/health et un 404 /api/… ; absent de GET /privacy
```
`origin-guard.test.ts` (routes de test `POST`/`DELETE /api/test/echo`, `GET /api/test/whoami`) :

| Requête | Attendu |
|---|---|
| POST, `Origin: https://evil.example` ; POST sans `Origin` | `403 {"error":"origin_mismatch"}` |
| POST, bonne origine, `Content-Type: text/plain` | `415 {"error":"unsupported_media_type"}` |
| POST `application/json; charset=utf-8` ; DELETE sans corps ; GET d'origine étrangère | 200 ; 204 ; 200 |
| `Tailscale-User-Login: admin@exemple` sur `/api/test/whoami` | `{ user: null }` (P-AUT-7) ; aucun fichier de `apps/server/src` ne contient `/tailscale-user/i` |

```ts
// request-log.test.ts : POST /api/test/items/123?q=TEMOIN_QS, cookie dev-session=TEMOIN_COOKIE, corps { pain: 'TEMOIN_C2' }
expect(line).toMatchObject({ msg: 'request', method: 'POST', route: '/api/test/items/:id', status: 200 }); // durationMs numérique, requestId non vide
// le journal ne contient ni TEMOIN_QS, ni TEMOIN_COOKIE, ni TEMOIN_C2, ni 123
// errors.test.ts
// httpError('gym_duplicate', { gymId: 'g1' }) → 409 {"error":"gym_duplicate","gymId":"g1"} ; new Error('boom TEMOIN') → 500 {"error":"internal"}, ni 'boom' ni pile, journal sans TEMOIN
// parseJson : JSON invalide → 400 {"error":"validation"} ; { n: 'x' } contre z.object({ n: z.number() }) → issues[0] = { path: 'n', message: expect.any(String) }
// client-ip.test.ts, sans socket : XFF '100.64.0.7' → '100.64.0.7' ; '100.64.0.7, 10.0.0.1' → '100.64.0.7' ; sans en-tête → null ;
//   pair TCP (app.request(url, init, { incoming: { socket: { remoteAddress } } })) + XFF '100.64.0.7' :
//   '172.18.0.1' (pont Docker), '::ffff:172.18.0.1', '127.0.0.1' → '100.64.0.7' ; '100.64.0.9' → '100.64.0.9' (XFF ignoré)
// health.test.ts
expect(body).toEqual({ status: 'ok', version: 'dev', db: 'ok', protocol: 1, minProtocol: 1, epoch: meta.serverEpoch, swKill: false });
// createTestContext({ config: { swKillSwitch: true, version: 'v1.0.0' } }) → { swKill: true, version: 'v1.0.0' }
// après ctx.deps.sqlite.close() : 503 { status: 'error', db: 'error', epoch: null }
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test http/ health config logger` et `pnpm --filter @appsport/contracts test errors` → « Failed to resolve import "../../src/app" », « ./context », « ../src/api/errors ».

- [ ] **Step 3: Implement**

- Ordre des middlewares de `createApp` : Interfaces partagées §2 ; `epochHeader` lit `getServerMeta` à chaque requête (sans cache, pour suivre un changement d'époque) et omet l'en-tête en cas d'erreur ; `securityHeaders` pose ses en-têtes après `next()` (donc aussi sur 404 et `onError`) ; `notFound` → `404 {"error":"not_found"}`.
- Journal : `logger.info('request', { requestId, method, route: routePath(c, -1), status, durationMs })` ; erreur non `HttpError` → `logger.error('unhandled_error', { requestId, code: 'internal', event: err.name })`.
- `clientIp` (P-LOG-1, R-AUTH-3) : pair TCP = `c.env.incoming.socket.remoteAddress` sans préfixe `::ffff:` ; premier élément de `X-Forwarded-For` si le pair est absent, loopback (`127.0.0.0/8`, `::1`) ou privé RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), car `tailscale serve` joint le conteneur par docker-proxy ; sinon le pair.
- `createTestContext` : `openDatabase(opts.dbPath ?? ':memory:')`, config `APP_ORIGIN: 'https://appsport.test.ts.net'` + `argon2: TEST_ARGON2`, logger muet, `initServerMeta(db, { ids, clock })` si `server_meta` est vide ; `request()` pose `Origin` par défaut sur POST/PUT/PATCH/DELETE (`origin: null` le retire), `json` → `Content-Type: application/json`, `ip` → `X-Forwarded-For` ; `close()` ferme `sqlite` (à appeler avant `rmSync` sous Windows).

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test http/ health config logger` → `Test Files  8 passed` ; `pnpm --filter @appsport/contracts test errors` → `Test Files  1 passed` ; `pnpm test`, `pnpm typecheck`, `pnpm lint` passent.

- [ ] **Step 5: Commit**

`git commit -m "feat(socle): serveur Hono, en-têtes de sécurité, CSRF, journaux sans données et /api/health"`

---

