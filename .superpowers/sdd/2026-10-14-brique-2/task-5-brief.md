### Task 5: Migration du catalogue et registre

**Files:**
- Create: `apps/server/src/db/migrations/0003_catalog.ts`, `apps/server/test/db/catalog-migration.test.ts`
- Modify: `apps/server/src/db/migrations/index.ts`, `packages/contracts/src/entity-rules.ts`, `packages/contracts/test/entity-rules.test.ts`, `apps/server/test/support/factories.ts`, `apps/server/test/__snapshots__/schema.sql`, `apps/server/test/db/{schema,upgrade,enum-consistency}.test.ts`, `apps/server/src/db/types.ts` (types Kysely)

**Interfaces:**
- Produces : tables `exercise` et `illustration` (colonnes de 04 « Modèle de données », plus `exercise.batch TEXT NOT NULL`), `exercise_comment`, `exercise_validation` (`UNIQUE (exercise_id, reviewer_id, revision)`), `exercise_revision` (clé `exercise_id, revision`), colonnes `user.catalog_reviewer` et `user.health_professional` (`INTEGER NOT NULL DEFAULT 0 CHECK (… IN (0,1))`). Les quatre clés vers `user` en `ON DELETE SET NULL`. Registre : `exercise` et `illustration` = C0, classe C (catalogue servi par `GET /api/catalog`, hors pull), `ownerColumn: null`, `exported: false`, `onUserDelete: 'set_null'` (`reviewed_by`) ; les trois tables de relecture = C0, classe H, `ownerColumn: null`, `exported: false`, `onUserDelete: 'set_null'`.

- [ ] **Step 1: Write the failing tests** — `catalog-migration.test.ts` : une base 0001+0002 avec des lignes migre sans perte et gagne les colonnes à 0 ; supprimer un compte qui a écrit un commentaire, une validation et une révision passe (aucune contrainte refusée) et ne laisse son id dans aucune cellule ; `upgrade.test.ts` : figer le schéma de la base après `0002_coach` (`fixtures/schema-v2.sql`, généré une fois depuis le `socle` de départ) et attendre `applied: ['0003_catalog']` depuis lui, le cas v1 restant couvert ; `entity-rules.test.ts` : lignes `EXPECTED` des 5 tables ; `mirroredTables()` inchangé (aucune des 5 tables).
- [ ] **Step 2: Run** `pnpm --filter @rune/server test db` et `pnpm --filter @rune/contracts test entity-rules` — FAIL.
- [ ] **Step 3: Implement** la migration (`breaking: false`), le registre, une fabrique par table, les constantes de `ENUMS`/`BOUNDS` dont le test de cohérence a besoin.
- [ ] **Step 4: Run** `pnpm test` — PASS (pull-leak, delete, export et admin-isolation restent verts sans changement de code).
- [ ] **Step 5: Commit** `feat(server): tables du catalogue et de la relecture, drapeaux de relecteur`.
