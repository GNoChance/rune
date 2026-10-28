### Task 6: Chargeur, bloc servi et version du catalogue

**Files:**
- Create: `apps/server/src/catalog/bundle.ts`, `apps/server/src/catalog/repo.ts`, `apps/server/test/catalog/bundle.test.ts`
- Modify: `apps/server/src/catalog/loader.ts`, `apps/server/src/catalog/routes.ts`, `packages/contracts/src/catalog.ts` (`CatalogBundle.exercises: ServedSheet[]`), `apps/server/test/catalog/{loader,routes}.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5.
- Produces : `loadCatalogFiles(deps)` (lit `data/exercises/*.json`, le manifeste, les modèles ; valide avec `validateCatalog`) ; `seedOrMergeCatalog(trx, files)` (règles de 04 §10 et spec §3.6 : `id` absent → insertion seulement si `draft`, sauf base vide où tout est inséré avec son statut ; `id` présent → ignoré ; manifeste → insertion ou mise à jour ; une ligne `exercise_revision` avec `saved_by` NULL par fiche insérée) ; `rebuildCatalog(trx, deps): CatalogBundle` (lit la base : fiches `published` et `retired` avec `published_at`, sans colonne éditoriale ni `batch` ; calcule `catalog_version` = sha256 de la forme canonique ; met à jour `server_meta` si elle change ; remplace le bloc en mémoire) ; `type ServedSheet` dans contracts.

- [ ] **Step 1: Write the failing tests** — deux chargements de suite ne changent rien ; une fiche déjà en base n'est jamais écrasée ; un fichier invalide n'écrit rien et l'appli démarre avec le catalogue en base ; base vide entièrement amorcée, statuts gardés ; nouvelle fiche `published` dans les fichiers sur base non vide → refusée et journalisée ; `GET /api/catalog` ne contient ni `draft`, ni `reviewed`, ni brouillon retiré, ni `review_notes`, `drafting`, `reviewed_by`, `reviewed_at`, `published_at`, `retired_at`, `exported_revision`, `batch` (critère 9 modifié) ; ETag = version et 304.
- [ ] **Step 2: Run** `pnpm --filter @rune/server test catalog` — FAIL.
- [ ] **Step 3: Implement** ; `CATALOG_STARTUP_TASK` appelle `loadCatalogFiles` → `seedOrMergeCatalog` → `rebuildCatalog` dans une transaction.
- [ ] **Step 4: Run** — PASS ; `apps/web/test/sync/catalog.test.ts` reste vert (forme du bloc inchangée).
- [ ] **Step 5: Commit** `feat(server): chargement des fiches en base et catalogue servi depuis la base`.
