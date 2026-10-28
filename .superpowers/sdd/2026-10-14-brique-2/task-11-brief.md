### Task 11: Illustrations, nettoyage des SVG et Crédits

**Files:**
- Create: `scripts/svg/{sanitize,check}.ts`, `scripts/svg/sanitize.test.ts`, `scripts/exercises/import-illustrations.ts`, `scripts/exercises/import-illustrations.test.ts`
- Modify: `package.json` (scripts `svg:check`, `illustrations:import`), `.github/workflows/ci.yml` (`pnpm svg:check`), `apps/web/src/features/public/` (page Crédits générée depuis le manifeste : fichier exact selon l'emplacement de la page Crédits après la refonte Task 13), son test

**Interfaces:**
- Produces : `sanitizeSvg(input: string): string` (liste blanche d'éléments ; retire `script`, `foreignObject`, attributs `on*`, liens externes ; ajoute le commentaire de crédit et de licence) ; `pnpm illustrations:import --source <dossier figé> --ids …` (copie seulement les fichiers utilisés, nom `<id>.<hash8>.<ext>`, empreinte sha256, entrée de manifeste avec `replace_before_public` selon 04 §12 règle 3) ; `pnpm svg:check` (40 Ko au plus par fichier, type des fichiers matriciels vérifié par leurs octets).

- [ ] **Step 1: Write the failing tests** — un SVG piégé (`<script>`, `onload`, `href` externe) ressort propre (04 §13 critère 11) ; 41 Ko → refus ; un PNG renommé en `.svg` → refus ; la page Crédits liste chaque illustration de chaque fiche publiée et la mention des textes de la spec §5.7, et reste lisible hors ligne.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` et `pnpm svg:check` — PASS.
- [ ] **Step 5: Commit** `feat(scripts): import et nettoyage des illustrations, page Crédits générée`.
