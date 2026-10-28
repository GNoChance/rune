### Task 9: Édition admin, transitions, révisions et export du catalogue

**Files:**
- Create: `apps/server/src/review/admin-routes.ts`, `apps/server/test/review/{edit,transitions,concurrency,catalog-version}.test.ts`, `scripts/data/pull.ts`, `scripts/data/pull.test.ts`
- Modify: `apps/server/src/admin/routes.ts` (monte `/exercises`), `apps/server/src/catalog/repo.ts`, `package.json` (script `data:pull`)

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 8.
- Produces : `PUT /api/admin/exercises/:id` `{sheet, baseRevision}` ; `POST /api/admin/exercises/:id/transition` `{to, baseRevision, reviewChecked?, minorsConfirmed?}` ; `GET /api/admin/exercises/export` (fichier `exercises-export.json`, toutes les fiches, forme canonique, met à jour `exported_revision`) ; `pnpm data:pull <fichier>` (découpe dans `data/exercises/`). Écriture = `BEGIN IMMEDIATE`, `UPDATE … WHERE id = ? AND revision = ?`, insertion de la ligne `exercise_revision` (`content` = `contentOf`), `rebuildCatalog`.

- [ ] **Step 1: Write the failing tests** —
  - `concurrency.test.ts` : deux `PUT` lancés par `Promise.all` depuis la même `baseRevision` → un 200 et un 409 `revision_conflict` avec `current`, dans n'importe quel ordre ; la fiche contient la première saisie seulement ; base périmée + blocages → 409 sans liste ;
  - `transitions.test.ts` : chaque transition permise ou interdite de 04 §8 complétée par le §3.6, réponse 422 `transition_blocked` avec `blockers` dans l'ordre ; refus de retirer une fiche citée par un modèle ; `retired → reviewed` à 300 → `catalog_full` ;
  - `edit.test.ts` : chaque écriture crée une ligne de révision dont `content` = `contentOf(fiche)` et ne contient aucun id de compte ; `PUT` d'une fiche publiée invalide → 422 `invalid_sheet` ;
  - `catalog-version.test.ts` : publier change `catalog_version` et `GET /api/catalog` sert la fiche ; modifier une fiche publiée sert le nouveau contenu et change la version ; écrire un brouillon ne la change pas ; commenter ne la change pas ;
  - `pull.test.ts` : aller-retour export → `data:pull` → chargement sur base vide → export identique octet pour octet (04 §13 critère 8).
- [ ] **Step 2: Run** `pnpm --filter @rune/server test review` et `pnpm vitest run --project scripts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): édition des fiches avec contrôle de révision, transitions et export du catalogue`.
