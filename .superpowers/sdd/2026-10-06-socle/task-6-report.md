# Task 6 report

Commit 789a905 `feat(socle): serveur Hono, en-têtes de sécurité, CSRF, journaux sans données et /api/health` (Closes #7).

## Implemented
- contracts: `api/errors.ts` (33 codes, ERROR_STATUS, ApiErrorBody), `api/health.ts`, exports in index, `zod@^4`.
- server: config, app-env, app, routes, logger, http/{errors, validate, security-headers, origin-guard, request-log, client-ip, epoch-header}, health/routes; deps.ts (+Argon2Params, ARGON2_PARAMS, AppDeps, createAppDeps); deps hono ~4.13, @hono/node-server ~2.1, zod ^4.
- test support `context.ts` (TEST_ARGON2, createTestContext with `dbPath`, request helper, close guarded by `isOpen`), exported from support/index.ts.
- clientIp per ruling: first X-Forwarded-For element when peer is absent, loopback, RFC 1918 (incl. 172.16/12) ; `::ffff:` stripped; otherwise peer. `loadConfig` accepts `PORT=0`.
- Request id: `crypto.randomUUID()` in app.ts (not `deps.ids`, so request traffic does not consume the deterministic test id sequence).
- notFound returns `404 {"error":"not_found"}` directly.

## TDD
RED (separate run, before any implementation):
`pnpm --filter @appsport/contracts test errors` -> 5 failed (`Cannot read properties of undefined (reading 'options')`, ApiErrorCode etc. not exported yet);
`pnpm --filter @appsport/server test http/ health config logger` -> "Cannot find module '../src/config'", '../src/logger', '../../src/http/client-ip', '../../src/http/errors'; health/security/origin tests: `createTestContext is not a function`. Expected: nothing implemented.
GREEN: contracts `Test Files 1 passed, Tests 5 passed`; server `Test Files 8 passed, Tests 33 passed`.
Full: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` -> 26 files passed, 157 passed | 2 skipped (skips pre-existing).

## Self-review
- Tests added beyond brief: PORT invalid, epoch header omitted when DB unreadable, 172.32 not trusted, ::1 peer, PUT origin, parseQuery.
- Files created with the Write tool; biome --write reformatted tests (line width) before commit.

## Concerns
None. Note: `epochHeader` and `securityHeaders` set headers after `next()` by mutating `c.res.headers` (works for 404, onError and handler responses).
