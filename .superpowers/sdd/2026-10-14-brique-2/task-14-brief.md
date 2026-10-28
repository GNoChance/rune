### Task 14: Onglet Exercices, liste d'un groupe et lien depuis Progression

**Files:**
- Create: `apps/web/src/features/exercises/{ExercisesHome,GroupList}.tsx`, `apps/web/test/exercises/{home,group}.test.tsx`, `apps/web/e2e/exercises.spec.ts`
- Modify: `apps/web/src/App.tsx` (routes `/exercises`, `/exercises/group/:code`), `apps/web/src/ui/nav.ts` (ou le fichier qui porte `TAB_ITEMS` après la refonte : Accueil `/` · Exercices `/exercises` · Progression `/progression` · Profil `/profile` ; `/places…` et `/gyms…` → onglet Profil actif), `apps/web/src/features/progression/ProgressionPage.tsx` (import de `MUSCLE_GROUPS`, rang cliquable vers `/exercises/group/:code`), tests de la barre d'onglets et de Progression

**Interfaces:**
- Consumes: Tasks 12, 13.

- [ ] **Step 1: Write the failing tests** — 9 tuiles avec « Rang E » et le nombre ; nom accessible « Quadriceps, rang E, 18 exercices » ; interrupteur « Faisable : <lieu> » activé par défaut, état gardé en entrant dans un groupe ; sans lieu : ligne « Choisis ton lieu principal pour ne voir que ce que tu peux faire » vers Profil › Mes lieux ; tuile à 0 touchable → « Rien de faisable à <lieu> dans ce groupe » + « Tout voir » ; recherche : la saisie remplace les tuiles, état vide « Aucun exercice ne correspond. » + « N exercices masqués par le filtre Faisable · Les voir », phrase du mode prudent ; catalogue absent : « Le catalogue arrive… » en ligne, « Connecte-toi une fois pour récupérer les exercices. » hors ligne ; liste d'un groupe triée par niveau puis nom (collation française) avec « Niveau 1 sur 3, débutant » ; code de groupe inconnu → `/exercises` ; Retour depuis une fiche restaure la recherche et le défilement ; barre d'onglets : `aria-current` sur Exercices pour `/exercises…`, sur Profil pour `/places…` ; Progression : 9 rangs depuis `MUSCLE_GROUPS`, toucher « Ischios » ouvre `/exercises/group/hamstrings`. E2E : après une synchro, hors ligne, une fiche publiée s'ouvre avec ses illustrations (04 §13 critère 13), Chromium et WebKit.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test exercises progression` — FAIL.
- [ ] **Step 3: Implement** selon la maquette `exercices-liste.html` (B puis liste de A).
- [ ] **Step 4: Run** `pnpm --filter @rune/web test` puis `pnpm --filter @rune/web test:e2e` — PASS.
- [ ] **Step 5: Commit** `feat(web): onglet Exercices, tuiles par muscle et lien depuis Progression`.
