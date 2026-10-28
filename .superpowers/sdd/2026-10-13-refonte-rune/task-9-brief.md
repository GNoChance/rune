### Task 9: Accueil et Progression

**Files:**
- Create: `apps/web/src/features/progression/ProgressionPage.tsx`, `progression.module.css`, `apps/web/test/progression/progression.test.tsx`
- Modify: `apps/web/src/features/home/HomePage.tsx`, `home.module.css`, `apps/web/test/home/*.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–7 ; `coachLine` (Task 7).
- Produces: `MUSCLE_GROUPS_LABELS = ['Pectoraux','Dos','Épaules','Bras','Abdos','Fessiers','Quadriceps','Ischios','Mollets']` (constante d'affichage dans `ProgressionPage.tsx`).

- [ ] **Step 1: Tests qui échouent** — accueil : titre « Bonsoir, {pseudo} » / « Bonjour, {pseudo} » selon l'heure de Paris (bascule à 18 h), bulle du coach étiquetée « Aujourd'hui » avec la ligne du jour, carte « Quêtes d'éveil » aux vrais états, tuile « Lieu principal » avec le nom du lieu principal, tuile « Rythme » avec `daysPerWeek` ; le bandeau « Tu as 18 ans… » et le rappel annuel de mot de passe restent affichés quand ils s'appliquent. Progression : « Rang E », « 0 / 100 XP », compteurs 0 (séances, kg soulevés, semaines d'assiduité), 9 `RankBadge` « Rang E » avec les libellés ci-dessus, fenêtre du Système « Aucune séance gravée. Ta première séance débloque tes rangs. »
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon `MixSombre/MixClair` et `ProgressionSombre/ProgressionClair` (cartes en cascade, compteurs `CountUp`).
- [ ] **Step 4: Lancer** — PASS.
- [ ] **Step 5: Commit** `feat(web): accueil avec le coach et onglet Progression en avant-goût`.

