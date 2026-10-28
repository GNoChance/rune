# Task 11 report: invitations, création de compte, amorçage admin

Status: DONE_WITH_CONCERNS (one deviation from the brief, see below). Commit on `socle`: "feat(auth): invitations à usage unique, création de compte et amorçage admin" (Closes #12), not pushed.

## Implemented
- contracts: `api/admin.ts` (InvitationState, InvitationSummary, CreateInvitationRequest/Response), `api/auth.ts` (CodeRequest, InvitationCheckResponse with `role`, AcceptInvitationRequest), exported in `index.ts`.
- server: `auth/invitations.ts` (invitationState, invitationLink, createInvitation, listInvitations, revokeInvitation, checkInvitation, acceptInvitation), `auth/invitation-routes.ts` (`/api/invitations/{check,accept}` behind `authLimiters(deps).invitationCheck.hit(ip)`, `/api/admin/invitations` GET/POST and `/:id/revoke` behind requireAdmin), `auth/bootstrap.ts`, `admin:bootstrap` in `cli.ts`, mounting in `routes.ts`.
- acceptInvitation order: Zod, termsVersion, state read outside the transaction, validateUsername, validatePassword (role admin if bootstrap), early username check, hashPassword outside the transaction, then in the transaction: re-read state, username check, user insert, conditional UPDATE (`used_at IS NULL AND revoked_at IS NULL`, `numUpdatedRows !== 1n` gives `invitation_used`), session, `invitation_used` event.
- bootstrap: admin existing gives `conflict { reason: 'admin_exists' }`; otherwise revokes pending bootstrap invitations (birth_date NULL) and creates a new one (24 h, createdBy null), all in one transaction. The age check lives in createInvitation (`under_min_age`), so the CLI also refuses under 16.

## Deviation (concern)
The brief says UPDATE invitation (used_by = uid) before inserting the user. `foreign_keys = ON` with immediate FKs makes `invitation.used_by -> user(id)` fail if the user row does not exist yet. I insert the user first and run the conditional UPDATE second; if it touches 0 rows the exception rolls back the whole transaction (no user left). Because the transaction is `BEGIN IMMEDIATE` and the state is re-read first, the loser of a race gets `invitation_used` before inserting anything. Concurrency tests confirm exactly one account.

Other minor notes: the revoke endpoint needs a JSON body (`{}`) like every POST (415 otherwise, existing global rule). Security events for invitations carry `targetId: null` and `details { invitationId }` (plus `bootstrap` on creation).

## TDD evidence
RED (before any implementation): `pnpm --filter @appsport/server test invitation bootstrap` gave `Test Files 3 failed (3), Tests 14 failed (14)`: 404 on `/api/admin/invitations` and unresolved `../../src/auth/bootstrap`. Expected, nothing existed.
GREEN: same command, `Test Files 3 passed (3), Tests 22 passed (22)`. Two first-run failures were test bugs (bodiless POST gave 415), fixed in the tests.
Full run: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test`: `Test Files 46 passed (46), Tests 298 passed | 2 skipped`.

## Tests
`test/auth/invitation.test.ts` (creation, age at Paris date, note bounds, forbidden for member, revoke/409/404, states used/expired, check variants and errors, accept 201 with row and events, validation failures not consuming, limiter 19+1+21st, no secrets in logs/events), `invitation-concurrency.test.ts` (2 and 5 simultaneous accepts), `bootstrap.test.ts` (24 h, 14-char minimum, second bootstrap revokes first, admin_exists, minor refused, CLI three lines, stored hash only, invalid inputs exit 1 with empty stdout).

## Self-review
`git show --stat HEAD` lists all 11 files; working tree clean. No docs touched. `InvitationState` is imported from `@appsport/contracts` only.
