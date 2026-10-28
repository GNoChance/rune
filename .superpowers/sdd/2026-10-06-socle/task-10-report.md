# Task 10 report

Commit: feat(auth): connexion limitée, déconnexion, changement de mot de passe et /api/me (Closes #11)

## Implemented
- contracts `api/auth.ts`: ONBOARDING_STEPS, OnboardingStep, ConsentStatus, ConsentState, MeResponse, LoginRequest, ChangePasswordRequest, UpdateMeRequest (strictObject).
- `auth/limiter.ts` (login limiter, IP limiter, `authLimiters` memoised per deps), `privacy/consent-state.ts` (created_at DESC, rev DESC), `auth/me.ts` (userTraits, buildMe, verifyUserPassword, storeNewPassword), `auth/routes.ts` (/api/auth login, logout, logout-all, password), `auth/me-routes.ts` (GET/PATCH /api/me), mounted in `routes.ts`.
- `http/client-ip.ts`: added `validClientIp(c)` (net.isIP, else null) used as limiter key and journal IP.
- Test support `users.ts` (`createUser`, `login`), exported from `support/index.ts`.

## TDD
- RED: `pnpm --filter @appsport/server test limiter login password-change me consent-state` before any implementation: 5 files failed, 16 tests failed (Cannot find module '../../src/auth/limiter', '../../src/auth/me', '../../src/privacy/consent-state'; routes answered 404: "Connexion refusée (404)", "expected { error: 'not_found' } ..."). Expected: nothing existed.
- GREEN (same command): `Test Files 5 passed (5)`, `Tests 35 passed (35)`. A first GREEN attempt failed only because test requests to bodiless POSTs lacked a JSON body (origin guard answers 415); fixed in the tests (`json: {}`).
- Full run: `pnpm lint` clean, `pnpm typecheck` clean (4 packages), `pnpm test` 43 files, 276 passed, 2 skipped.

## Notes
- Failed attempts: 5 failures then 6th attempt gets 429 (the 5th failure itself still answers 401), matching the brief.
- Unknown username: verified against a dummy hash computed once per deps.
- Unreadable/invalid X-Forwarded-For: IP null (no per-IP limiting, journal tailnetIp null); did not fall back to the TCP peer because `peerAddress` is private to client-ip.ts.
- login_blocked events carry null target (user not looked up before the limiter check).
- PATCH username: transaction contains the key check and the write; UNIQUE violation on username_key mapped to 409 as a safety net.
- Bodiless POSTs (logout, logout-all) require Content-Type JSON per the origin guard (Task 6 behaviour); the web client must send `{}`.

## Concerns
None blocking. Limiter state map is unbounded (keyed by attempted usernames); acceptable for a private tailnet app, can be pruned later.
