# Task 21 — Pull serveur, garde de protocole et test de fuite

Status: DONE_WITH_CONCERNS (concerns mineures, voir fin)
Commit: 5e0a63a feat(synchro): pull paginé, garde de protocole 426 et test de fuite (Closes #22)

## Implémenté
- `packages/contracts/src/sync.ts` : `ColumnCodec` ('boolean' | 'json') et `COLUMN_CODECS` (valeur exacte du brief).
- `apps/server/src/sync/protocol-guard.ts` : `protocolGuard` ; en-tête `X-Appsport-Protocol` doit matcher `/^\d+$/` et être dans [MIN_PROTOCOL, SYNC_PROTOCOL], sinon `httpError('protocol_unsupported', { serverProtocol, minProtocol })` → 426.
- `apps/server/src/sync/pull.ts` : `buildPull(deps, user, since, limit)` dans une seule transaction :
  - since illisible → 400 `validation` ; époque ≠ serverEpoch ou rev < tombstonePurgeRev → 410 `watermark_expired` ;
  - périmètre : tables J/D/E de `deps.entityRules` avec `ownerColumn = user.id` (owner_id, ou id pour `user`) ; ownerColumn nul et C0 → toutes les lignes (gym, gym_equipment, tombstones comprises) ; sinon exclue ;
  - par table `rev > sinceRev ORDER BY rev LIMIT limit+1`, fusion triée (rev, entity, id), `limit` premières ; si une ligne écartée a le rev de la dernière gardée, le groupe de ce rev est relu en entier dans chaque table ; `hasMore` exact (existe-t-il une ligne de rev > dernier rev gardé) ;
  - `nextWatermark = encodeWatermark(epoch, hasMore ? lastRev : max(sinceRev, syncCounter))` ; `catalogVersion` de server_meta ;
  - ligne : colonnes du registre sans `secretColumns`, camelCase, codecs (null reste null ; boolean → v === 1 ; json → JSON.parse), `deletedAt: null` si la colonne manque.
- `apps/server/src/sync/routes.ts` : `use('*', protocolGuard)` avant `requireUser`, `GET /pull` (`parseQuery(PullQuery)`).
- Support : `syncPull(ctx, cookie, { since?, limit? })` → `{ status, body, headers }`, exporté par `test/support/index.ts`.

## Tests
- `protocol-guard.test.ts` : absent, '0', '2', 'abc', '1.5' sur GET pull et POST push sans cookie → 426 corps exact ; protocole 1 sans session → 401 unauthenticated.
- `pull.test.ts` (13 cas) : tri par rev, watermark au compteur sans since, pagination limit=2 sur 5 notes avec reprise, 600 notes → 500 + hasMore, limit=501 → validation, groupe de même rev non coupé, watermark conservé sans nouveauté, tombstone + health_screening tombstone caution null, cautiousMode true, deletedAt sur chaque ligne, ligne user propre sans passwordHash, salle de b (gym + gym_equipment, loadSettings objet, aucun place de b), place booléens/JSON décodés, 410 autre époque, purge rev 10 (5 → 410, 10 → 200), since 'abc' → 400, catalogVersion 'abc'.
- `pull-leak.test.ts` (membre et admin, registre du socle via `createTestContext`) : A et B ont une ligne dans chaque table J/D/E liée (consentement santé accordé aux deux), valeurs témoins dans limitation.note, place.name, training_profile.sportOtherLabel, sync_rejection.entity ; le pull de A couvre exactement `mirroredTables()`, contient ses propres témoins, jamais l'id ni les témoins de B, aucune clé secrète ; cas compte effacé : B crée une salle (createdBy/updatedBy/addedBy = B), suppression via `deleteAccount`, pull complet et pull incrémental de A sans l'id de B (createdBy/updatedBy/addedBy null).
- `codecs.test.ts` : COLUMN_CODECS = codecs déduits du DDL (`x IN (0,1)`, `json_valid(x)`) des tables miroirs ; valeur exacte.
- Mutation manuelle (non commitée) : filtre propriétaire remplacé par `1 = 1` → 2 tests de fuite échouent ; secretColumns non filtrées → 2 échouent.

## TDD
RED : `pnpm --filter @appsport/server test sync/pull sync/protocol-guard sync/codecs` →
`Test Files 4 failed (4) / Tests 29 failed | 3 passed (32)` ; `TypeError: syncPull is not a function` (14), `expected 401 to be 426` (garde absente ; 401 et non 404 car `requireUser` est déjà sur `*` du routeur), `expected undefined to deeply equal {...}` (COLUMN_CODECS absent), plus une erreur de fixture (place de salle avec un nom, CHECK) corrigée dans le test. Les 3 réussites : les cas « protocole 1 sans session → 401 » (déjà vrais).
GREEN : `pnpm --filter @appsport/server test sync` → `Test Files 6 passed (6) / Tests 67 passed (67)`.
Final : `pnpm lint` propre ; `pnpm typecheck` OK ; `pnpm test` → `Test Files 75 passed (75) / Tests 821 passed | 2 skipped (823)` (skips préexistants).

## Fichiers
apps/server/src/sync/{pull.ts, protocol-guard.ts} (créés), apps/server/src/sync/routes.ts, packages/contracts/src/sync.ts, apps/server/test/support/{sync-fixtures.ts, index.ts}, apps/server/test/sync/{pull, pull-leak, protocol-guard, codecs}.test.ts.

## Revue personnelle / concerns
- `gym.created_by`, `gym.updated_by` et `gym_equipment.added_by` (C0) sortent vers tous les membres tant que l'auteur existe : conforme à R-SYN-21 (salles C0 partagées), et effacés avec nouvelle révision à la suppression du compte (T13), ce que le test vérifie. Le test de fuite principal utilise donc une salle sans auteur ; à trancher si l'on veut masquer ces ids.
- Le groupe de même rev est relu par une requête `rev = lastRev` par table (et `hasMore` par une requête `rev > lastRev LIMIT 1` par table) seulement quand la page est pleine ; coût négligeable au socle.
- Ordre secondaire dans un même rev : entity puis id (déterministe, pas d'ordre parent d'abord ; le client applique la page entière).

---

# Fix round 1 (commit 8948bef, Refs #22)

## Changements
1. **Masquage des auteurs** : `EntityRule.pullRedact?: readonly string[]` (contracts) ; `gym: ['created_by','updated_by']`, `gym_equipment: ['added_by']` (seules tables miroirs sans propriétaire). `buildPull` met ces colonnes à null sauf si elles valent l'id de l'utilisateur de la session. Test générique : toute colonne à clé étrangère vers `user` d'une table miroir sans propriétaire figure dans `pullRedact`. Test de fuite : salle de B vivant (createdBy/updatedBy/addedBy = B) → aucun id de B dans le pull de A ; salle créée par A → `createdBy: a.id` gardé, `updatedBy` (B) masqué ; cas effacé : id de B absent avant et après la suppression. Le test « salle créée par b » pose vraiment `createdBy/updatedBy/addedBy = b.id` et vérifie null.
   **Historique** : `gymDetail` renvoie `history[].at` tronqué à la minute (`setUTCSeconds(0, 0)`), pour tous les lecteurs (membres et admin) ; la base garde l'instant exact. C'est la seule route qui renvoie `gym_history.at`.
2. Test de pagination sur deux tables (fixture_note, fixture_c2_log), revs entrelacés, groupe de même rev sur les deux tables à la coupe, limit=2 → 3 lignes, hasMore true, watermark au rev du groupe ; page suivante → 2 lignes, hasMore false.
3. `since` de rev > syncCounter dans l'époque courante → 410 `watermark_expired` (testé ; rev = compteur → 200). Conséquence : `nextWatermark` final = `syncCounter` (le max avec sinceRev devient inutile). Le test de purge pose `sync_counter ≥ 12` pour rester cohérent.
4. Tri : `localeCompare` remplacé par une comparaison `<`/`>`.
5. Commentaire sur `nextRev` (db/rev.ts) : une écriture de ligne = un rev neuf, strictement croissant, jamais réutilisé ; le pull tolère les groupes de même rev mais ce n'est pas l'usage normal.

## TDD
RED (tests écrits d'abord) : `pnpm --filter @appsport/server test sync/pull places/gyms` → `Tests 8 failed | 37 passed (45)` : gyms `expected [ '2026-10-06T10:17:42.123Z' ] to deeply equal [ '2026-10-06T10:17:00.000Z' ]` ; pull-leak `gym: expected [] to include 'updated_by'` et 4 × `not to contain '<id de B>'` ; pull « salle créée par b » (createdBy non null) ; « since au-delà du compteur » `expected 200 to be 410`. `pnpm --filter @appsport/contracts test entity-rules` → 1 failed (`expected [] to deeply equal [ …(2) ]`). Le test de pagination à deux tables passait déjà (couverture de l'existant, attendu).
GREEN : `pnpm --filter @appsport/server test sync places` puis complet : `pnpm lint` propre, `pnpm typecheck` OK, `pnpm test` → `Test Files 75 passed (75) / Tests 826 passed | 2 skipped (828)`.
