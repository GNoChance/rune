### Task 14: Décisions de confidentialité et déploiements ratés

**Files:**
- Modify: `docs/fiche-de-traitement.md`, `apps/web/src/features/public/privacy-content.ts` (phrase de l'enveloppe de secours, spec principale 03 et décision du 2026-10-12), `docs/exploitation/P9-admin-indisponible.md` (supprimer les sauvegardes B2 et locales après un dernier export pour chaque membre), `apps/server/test/infra/docs.test.ts`, `apps/server/src/auth/` (`admin:reset` réactive un admin désactivé) + son test CLI, `infra/host/rune-update` et `infra/host/test/update.bats` (T43-F14 : `pull-failed` et `backup-failed` écrivent aussi `.deploy` dans `status.json` avec `ok: false` et la version en place)

- [ ] **Step 1: Tests qui échouent** — docs.test : P9 contient la suppression des sauvegardes ; la fiche de traitement contient « copie scellée » ; CLI : `admin:reset leo` sur un admin désactivé → statut actif + lien ; bats : un `pull-failed` laisse `.deploy.ok == false`.
- [ ] **Step 2: Lancer** `pnpm --filter @rune/server test infra/docs`, le test CLI, et `pnpm test:infra` (Git Bash) — FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer** — PASS ; shellcheck propre.
- [ ] **Step 5: Commit** `fix(ops): enveloppe de secours dite, sauvegardes effacées à l'arrêt, admin réactivé et déploiements ratés visibles`.

