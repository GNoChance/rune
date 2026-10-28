### Task 16: Écran de relecture (liste, fiche, commentaires, validation)

**Files:**
- Create: `apps/web/src/features/review/{ReviewList,ReviewSheet,CommentSheet,ValidateSheet}.tsx`, `apps/web/src/features/review/review.module.css`, `apps/web/test/review/{list,sheet,comment,validate}.test.tsx`
- Modify: `apps/web/src/App.tsx` (routes `/review/exercises`, `/review/exercises/:id`)

**Interfaces:**
- Consumes: Tasks 12 (`Tabs`, rendu de fiche de la tâche 13 réutilisé en aperçu), 15.

- [ ] **Step 1: Write the failing tests** — liste : avancement par lot (« Cœur · n / m publiées »), filtres « À relire », « Brouillons à commenter », « Feu vert santé », « À revalider », « Mes commentaires » avec compteurs, pastilles d'état ; fiche : valeurs de sensibilité écrites en clair ; bouton « Commenter » sur chaque partie ; libellé d'onglet « Erreurs · 1 commentaire » ; commentaires en texte brut (un `<b>` tapé s'affiche tel quel) ; feuille de commentaire avec « n / 1000 », phrase « Parle de la fiche, pas de ta santé ni de celle d'un membre. », brouillon restauré après une coupure ; relectrice non santé : bouton « J'ai relu, rien à redire » ; relectrice santé : « Sécurité vérifiée » ; feuille de confirmation qui rappelle la version ; « Fiche suivante » selon le filtre ; file vide : « Ta file est vide. Merci ! » ; une relectrice ne voit ni « Modifier » ni « Publier ».
- [ ] **Step 2: Run** `pnpm --filter @rune/web test review` — FAIL.
- [ ] **Step 3: Implement** selon la maquette `relecture.html`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(web): écran de relecture, commentaires et validations`.
