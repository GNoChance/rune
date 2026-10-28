### Task 13: Fiche d'un exercice

**Files:**
- Create: `apps/web/src/features/exercises/ExerciseSheetPage.tsx`, `apps/web/src/features/exercises/exercises.module.css`, `apps/web/test/exercises/sheet.test.tsx`
- Modify: `apps/web/src/App.tsx` (route `/exercises/:id`), `apps/web/test/theme/contrast.test.ts` (paire avertissement / fond des 5 thèmes)

**Interfaces:**
- Consumes: Task 12 (`getSheetView`, `Tabs`).

- [ ] **Step 1: Write the failing tests** — en-tête (nom, pastilles, illustrations avec texte alternatif « <nom> : position de départ », crédit et lien Crédits) ; sans illustration : ni carte ni crédit ; illustration pas en cache : « Illustration disponible après synchronisation » ; encadré « Sécurité » (titre et icône) présent dans les trois onglets, placé sous la barre d'onglets ; `?tab=mistakes` ouvre Erreurs, valeur inconnue → Comment faire, changer d'onglet appelle `history.replaceState` (pas `pushState`) ; Erreurs : préfixes « Erreur : » et « Correction : » pour les lecteurs d'écran ; Variantes en profil prudent sans fiche `not_for_minors` ; fiche non utilisable ouverte par URL : bandeau « Cet exercice n'est pas proposé avec tes réglages actuels. » et contenu absent ; fiche retirée : bandeau « Cet exercice n'est plus proposé. » et « Voir des exercices proches » ou « Aucun exercice proche pour l'instant. » ; infaisable ici : mention « Pas faisable : <lieu> » ; contraste de l'encadré ≥ 4,5:1 dans les 5 thèmes.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test exercises/sheet theme/contrast` — FAIL.
- [ ] **Step 3: Implement** selon la maquette `exercices-fiche.html` (choix B) et les jetons de la refonte.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(web): fiche d'exercice à onglets, sécurité toujours visible`.
