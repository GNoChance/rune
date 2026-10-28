# Task 12 report

Status: DONE (issue #13). Commit on `socle`, not pushed.

## Implemented
- contracts: `ops.ts` (OpsCheck, OpsStatus), `ResetCheckResponse` (with `role`), `ResetPasswordRequest`, `MemberSummary` (strict, `aiCoach` camelCase), `ResetLinkResponse`, `SetStatusRequest`, `SetRoleRequest`, `SetBirthDateRequest`, `OpsStatusResponse`.
- `auth/password-reset.ts`: `createPasswordReset` (cancels pending links, self -> `reset_self_forbidden`, unknown -> `not_found`), `checkPasswordReset`, `consumePasswordReset` (validate and hash outside the transaction, conditional UPDATE, `storeNewPassword`, `revokeSessions('password_reset')`, session, `password_reset_used`, `login.unlock` after commit).
- `auth/routes.ts`: `POST /reset/check` and `/reset`, both through `authLimiters(deps).resetCheck.hit(ip)` first (shared 20/h/IP).
- `admin/members.ts`: `listMembers` (reads only `user`, `consent_event` via `getConsentState`, `session` count), `assertNotLastAdmin`, `setRole`, `setStatus`, `setBirthDate`, `revokeMemberSessions`; check and write in the same transaction.
- `admin/routes.ts`: `/api/admin` with `requireAdmin`; members list, `reset-link` (200), `revoke-sessions`, `status`, `role` (admin password via `verifyUserPassword` before the transaction), `birth-date` (204), `ops-status`. Mounted in `routes.ts`.
- `admin/ops-status.ts`: `readOpsStatus`.
- CLI `admin:reset <pseudo>` (lookup by `usernameKey`; unknown -> stderr `Pseudo inconnu : <pseudo>`, code 1).
- limiter fix (T10): null IP now maps to a shared `'unknown'` bucket in `createLoginLimiter` and `createIpLimiter`. Removed one old assertion (`check('lea', null)` allowed after 30 IP failures), which encoded the bypass; replaced by two new tests.

## TDD evidence
- RED limiter: `pnpm --filter @appsport/server test limiter` -> `Tests 2 failed | 7 passed` (null IP not blocked: expected `allowed:false`, got `allowed:true`).
- RED main (separate run, before any implementation): `pnpm --filter @appsport/server test password-reset members ops-status` -> 3 suites failed, `Cannot find module '../../src/admin/members'`, `.../admin/ops-status`, `.../auth/password-reset`.
- GREEN: same command after implementation -> all pass except one CLI assertion (my shell had mangled backticks in `cli.ts`; stderr message undefined), fixed, then full run.
- Final: `pnpm lint` clean, `pnpm typecheck` clean (4 packages), `pnpm test` -> 49 files passed, 324 passed | 2 skipped. Concurrency test (two admins demoting each other) run 3 extra times: stable `[204, 409 last_admin]`.

## Files
See `git show --stat HEAD`: 16 files (src: admin/{members,ops-status,routes}.ts, auth/{password-reset,routes,limiter}.ts, cli.ts, routes.ts; tests: admin/{members,ops-status}, auth/{password-reset,limiter}; contracts: ops.ts, api/{admin,auth}.ts, index.ts).

## Self-review / notes
- `reset-link` returns 200 (plan table does not give the code); invitations return 201.
- `setRole`/`setStatus` skip the last-admin check when the change does not reduce admin-ness (role -> admin, status -> active).
- The password check for role changes precedes the transaction (Argon2 outside it); a concurrent loser of the race still fails inside with `last_admin`.
- No concerns beyond the above.
