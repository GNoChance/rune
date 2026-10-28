### Task 17: Outils de l'admin et parcours de bout en bout

**Files:**
- Create: `apps/web/src/features/review/EditSheetForm.tsx`, `apps/web/test/review/{edit,publish}.test.tsx`, `apps/web/e2e/review.spec.ts`
- Modify: `apps/web/src/features/review/{ReviewList,ReviewSheet}.tsx`, `apps/web/src/features/admin/MembersPage.tsx` (feuille « Relecture » : deux interrupteurs et mot de passe ; l'interrupteur santé absent sur son propre compte), `apps/web/src/repos/admin-repo.ts`

**Interfaces:**
- Consumes: Tasks 9, 15, 16.

- [ ] **Step 1: Write the failing tests** — formulaire d'édition (champs de 04 §8, choix des illustrations limité à une source) ; « Publier » désactivé avec les messages du tableau §3.6 écrits dessous ; 409 : « La fiche a changé depuis que tu l'as ouverte. », version courante affichée et saisie gardée à côté ; bandeau « Publiée, feu vert santé à refaire » ; filtres admin (type de mouvement, sans illustration), compteurs « N fiches à exporter » et « à remplacer avant publication », bouton « Exporter le catalogue » ; feuille des drapeaux d'un membre. E2E (Chromium et WebKit) : une relectrice commente, l'admin corrige et marque traité, la relectrice santé valide, l'admin publie, puis un membre ouvre la fiche hors ligne.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test review admin` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` puis `pnpm --filter @rune/web test:e2e` — PASS.
- [ ] **Step 5: Commit** `feat(web): édition et publication des fiches, drapeaux des relecteurs, parcours complet`.
