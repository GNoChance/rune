# Task 13 report — 40fdc96

Implemented: export (buildExport + GET /api/me/export), deleteAccount (+ POST /api/me/delete, POST /api/admin/members/:id/delete), authPurgeJob (registered in DAILY_JOBS), contracts (ExportV1/EXPORT_FORMAT, DeleteAccountRequest, AdminDeleteMemberRequest).

TDD: RED run (tests written first, no implementation):
  pnpm --filter @appsport/server test export delete admin-isolation purge
  -> purge.test.ts / delete.test.ts: "Cannot find module '../../src/auth/purge'" / '../../src/privacy/delete-account'; export.test.ts: 3 failed (route 404, no data_exported event); Test Files 3 failed | 1 passed (admin-isolation passes: no route yet to exclude, vacuous by design, MIN_ID_ROUTES = 0).
GREEN: same command -> Test Files 4 passed, Tests 25 passed. Full: pnpm lint, pnpm typecheck, pnpm test (53 files, 349 passed, 2 skipped pre-existing) all clean.

Notes: admin-isolation has an explicit empty-case test (it.runIf(MIN_ID_ROUTES === 0)). Purge uses pure SQL cutoffs (min(a,b,c)+R <= now equivalent to each term <= now-R, ISO ms strings compare chronologically). Gyms in export = union (place of user incl. deleted, created_by, history author). scheduler.test.ts untouched.
Concerns: none blocking. deleteAccount does not bump rev on gym rows detached by FK SET NULL (sync of gym.created_by not in client-visible columns considered out of scope).

## Fix round 1 — b969e92
1. delete-account.ts: detachMirroredReferences (FKs SET NULL vers user via pragma_foreign_key_list, intersectées avec le registre syncClass J/D/E): col = NULL, rev = nextRev, updated_at = now, updated_by inchangé. Test R-SUP-3 (gym created_by/updated_by, gym_equipment.added_by, user.updated_by). RED: sans le correctif, "expected 1 to be greater than 1"; GREEN après.
2. admin-isolation: lignes de B construites depuis entityRules (consent_event inclus).
3. purge: bornes exactes idle 2026-06-08T10:00:00.000Z et invitation révoquée à LIM purgées.
4. delete: lignes du journal conservées gardent actorId/targetId = lea.id.
Résultat: lint, typecheck propres; pnpm test 53 fichiers, 350 passed, 2 skipped.
