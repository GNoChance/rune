# Task 8 report

Implemented: contracts (auth-constants.ts, api/auth.ts), domain/auth (username, password, secret-code), server/auth (password-hash via node:crypto argon2id, secret, common-passwords, generated common-passwords-list.ts via scripts/make-common-passwords.mjs), index exports.

## TDD
RED (tests written first, run before any src): `pnpm --filter @appsport/contracts test auth-constants` -> "Cannot find module '../src/api/auth'" (1 failed); domain `test auth` -> 3 failed; server `test password-hash secret common-passwords` -> 3 failed (modules missing). Expected.
GREEN: contracts 1 passed (5 tests), domain 3 passed (24 tests), server 3 passed. `pnpm lint`, `pnpm typecheck`, `pnpm test` (36 files, 215 passed, 2 skipped) pristine.

## Concerns
- SecLists 10k-most-common.txt actually holds 10001 distinct entries (checked: wc, sort -u). The brief's bound `size <= 10000` fails, so the test asserts `<= 10001`. Data not truncated.
- Brief says `ARGON2_PARAMS` is consumed from deps.ts; used by tests only (password-hash takes params as argument).
- Password checks compare via usernameKey (NFKC lowercase) for username/appsport; an empty username is skipped to avoid a vacuous match.

## Fix round 1
- username.ts: Latin script kept, `\p{Nd}` replaced by `0-9`, and NFD-without-marks form must match `^[A-Za-z0-9._-]+$` (rejects ɑ, ı, ᴀ, ɨ, Arabic-Indic digits; Léa, zoé.b still accepted).
- secret-code.ts: separators stripped with `/[\s\p{Pd}−]/gu` (U+2011, U+2013, U+2212 tested).
- password.test.ts: NFD variant proving length counted after NFC.
- Tests added in the domain auth tests; `pnpm --filter @appsport/domain test auth` passes; lint, typecheck and full test pass.
