### Task 16: Vérification complète et captures de relecture

**Files:**
- Create: `apps/web/scripts/screenshots.mjs` (lance un serveur de démo jetable comme `appsport-local/video/record-app.cjs`, parcourt les écrans en clair et en sombre à 390 × 844, enregistre `screenshots/<écran>-<thème>.png` hors dépôt)

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test` — tout vert.
- [ ] **Step 2:** `pnpm test:infra` (Git Bash) et `pnpm --filter @rune/web test:e2e` — tout vert.
- [ ] **Step 3:** `node apps/web/scripts/screenshots.mjs` — une capture par écran et par thème clair/sombre ; les joindre au rapport pour la relecture du propriétaire.
- [ ] **Step 4:** Mesurer le bundle initial (`dist/assets/index-*.js` gzip) avant/après : hausse ≤ 25 % hors polices.
- [ ] **Step 5: Commit** `chore(web): script de captures de relecture`.
