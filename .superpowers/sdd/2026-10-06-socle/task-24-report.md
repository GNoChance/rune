# Task 24 report — privacy:collect et privacy:reapply

Status: DONE. Commit: see `git log -1` on `socle` (feat(privacy): privacy:collect et privacy:reapply après restauration). Closes #25.

## Implemented
- `apps/server/src/privacy/reapply.ts`: `PrivacyEventList` (Zod, §5 verbatim), `collectPrivacyEvents(db, since)` (security_event type account_deleted|consent_revoked, outcome success, at > since, target non nul, ORDER BY at, id ; consentType lu dans details, posé seulement pour consent_revoked), `reapplyPrivacyEvents(deps, list)` (une transaction, dans l'ordre ; ignore at <= since ; compte absent ignoré ; account_deleted → `deleteAccount(..., { actorId: null, ip: null }, { enforceLastAdmin: false })` ; consent_revoked health actif → `withdrawHealthConsent` ; ai_coach ignoré ; idempotent), helper `hasActiveAdmin`.
- `apps/server/src/cli.ts`: `privacy:collect --since <ISO> [--source f.db] --out f.json` sans withAppDeps : `new DatabaseSync(source, { readOnly: true })` + Kysely (NodeSqliteDialect, CamelCasePlugin), aucun pragma, garde ni migration ; écrit `JSON.stringify(list, null, 2)` (source = chemin lu), affiche `<n> événement(s) écrit(s) dans <fichier>`. `privacy:reapply <f.json>` via withAppDeps ; affiche « Réapplication terminée : … » puis, sans admin actif, « Aucun administrateur actif : lancer admin:bootstrap » (stdout, code 0). Erreurs (code 1) : « Date --since invalide (format ISO 8601 attendu) », « Option --out obligatoire », « Fichier de réapplication invalide » (absent, JSON invalide, schéma invalide, argument manquant). Sorties : ids, types, dates seulement.
- `apps/server/test/support/sync-fixtures.ts` (+ index.ts): `snapshotDb` (`backup` de node:sqlite), `restoreInPlace` (foreign_keys OFF, ATTACH snap, recopie table par table dans une transaction, DETACH, foreign_keys ON, `rotateServerEpoch`).

## Tests
- `test/privacy/reapply.test.ts` (4): scénario x/y/z du brief (événements exacts, témoin présent après restauration puis absent, {1,1}, 410 account_deleted sur /api/me et sur push rejoué, health_screening caution null + deleted_at, second appel {0,0}) ; collecte ignore antérieurs/échecs/autres types ; réapplication ignore antérieurs à since et ai_coach ; dernier admin w supprimé sans last_admin.
- `test/cli/privacy-cli.test.ts` (7): collect base principale (targetIds ['u-x','u-y'], contenu fichier) ; migration '9999_future' cassante (db:check → 1, collect → 0 mêmes événements) ; --source copie.db en journal DELETE : sha256 et mtime inchangés, ni -wal ni -shm ; --since invalide / --out manquant ; reapply sans admin (message) ; reapply avec admin actif (supprime u-x, pas de message) ; fichiers invalides.

## TDD evidence
RED: `pnpm --filter @appsport/server test privacy/reapply cli/privacy-cli`
→ `Error: Cannot find module '../../src/privacy/reapply'` ; CLI : 7 failed, `Commande inconnue : privacy:reapply` / `privacy:collect`. `Test Files 2 failed (2)`. Expected: module and commands absent.
GREEN: same command → `Test Files 2 passed (2)`, `Tests 11 passed (11)`.
Full: `pnpm lint` clean (biome --write formatted 3 files), `pnpm typecheck` OK, `pnpm test` → `Test Files 83 passed (83)`, `Tests 879 passed | 2 skipped`, no stdout/stderr noise.

## Self-review / concerns
- `hasActiveAdmin` is an extra export in reapply.ts (used by CLI only) — small, kept beside the reapply logic.
- Reapply logs withdrawals without the `replay: true` detail (that flag belongs to the client replay-withdraw route); actor null, ip null.
- Deleting `data/ops/privacy-*.json` after reapply (global constraints) is left to the ops scripts (not in this brief).

## Fix round 1 (commit 665dd3d, fix(privacy): --since comparé sous forme canonique, Refs #25)
Changes:
1. `canonicalInstant(iso)` (= `new Date(iso).toISOString()`) in reapply.ts. `PrivacyEventList.since` is now `z.iso.datetime().transform(canonicalInstant)`. The CLI's `--since` parse uses the same transform, so both the collect query and the written `list.since` are canonical. As a defensive measure, `collectPrivacyEvents` and `reapplyPrivacyEvents` also canonicalize `since` internally, because direct callers bypass the schema.
2. Doc comment on reapplyPrivacyEvents: a health consent withdrawn and then re-granted after the snapshot is withdrawn again. This fails closed, as intended.
Tests added:
- privacy-cli: `--since 2026-10-07T03:30:00Z`, with an event at `…:00.500Z` (u-a) and one at exactly `…:00.000Z` (u-b). Collect returns ['u-a'] and since is `…:00.000Z`. A handmade list with since `…:00Z` holding both events gets reapplied: 1 deleted, u-a gone, u-b kept.
- reapply.test: `PrivacyEventList.parse` canonicalizes since.
RED: `pnpm --filter @appsport/server test privacy/reapply cli/privacy-cli` → 2 failed, both "expected '2026-10-07T03:30:00Z' to be '2026-10-07T03:30:00.000Z'".
GREEN: same command → Test Files 2 passed, Tests 13 passed. `pnpm lint` clean, `pnpm typecheck` OK, `pnpm test` → 83 files, 881 passed | 2 skipped, no output noise. Checked `git show --stat HEAD`: 4 files, all expected.
