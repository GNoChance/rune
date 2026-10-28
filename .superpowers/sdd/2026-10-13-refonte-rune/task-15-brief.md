### Task 15 (après les tâches 7 à 13): Points reportés, tests instables et journaux de CI

**Files:** selon les points ; d'abord `apps/web/e2e/support/*.ts` (masquage des liens et codes d'invitation dans les journaux et traces, T38-F3) et les tests instables (`apps/web/test/profile/profile-page.test.tsx`, `privacy/withdraw.test.tsx`, `places/places-page.test.tsx`).

- [ ] **Step 1:** Dresser la liste des points mineurs reportés de T30 à T45 (`.superpowers/sdd/2026-10-06-socle/progress.md`, sections « Deferred » et « new minors ») dans `.superpowers/sdd/2026-10-06-socle/deferred-sweep.md`, chacun marqué `corrigé`, `rendu caduc par la refonte` ou `fermé : <raison>`.
- [ ] **Step 2:** Pour chaque point corrigé : test qui échoue, correctif, test vert.
- [ ] **Step 3:** Tests instables : exécuter `pnpm --filter @rune/web test` 5 fois de suite sans échec (`for i in 1 2 3 4 5; do pnpm --filter @rune/web test || break; done`).
- [ ] **Step 4:** E2E : aucune ligne de journal ni trace ne contient `#` suivi d'un code d'invitation (test du harnais).
- [ ] **Step 5: Commit(s)** `fix(...)` par point, puis `chore: bilan des points reportés du socle`.


