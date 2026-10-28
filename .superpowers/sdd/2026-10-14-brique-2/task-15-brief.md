### Task 15: Dépôt de relecture et arrivée des relectrices

**Files:**
- Create: `apps/web/src/repos/review-repo.ts`, `apps/web/src/features/review/{ReviewHomeCard,HowToReview}.tsx`, `apps/web/test/review/{repo,arrival}.test.tsx`
- Modify: `apps/web/src/App.tsx` (garde `/review…` : page introuvable pour un non-relecteur, comme `/admin`), `apps/web/src/features/home/HomePage.tsx` (carte), `apps/web/src/features/profile/ProfileHub.tsx` (ligne « Relecture des exercices » dans le groupe Cercle), `apps/web/src/features/public/` (Aide : rappel « Comment relire »)

**Interfaces:**
- Consumes: Tasks 7, 8 (contrats `api/review.ts`).
- Produces : `reviewRepo.list(queue)`, `.get(id)`, `.comment(id, req)`, `.resolve(cid)`, `.validate(id, req)`, `.save(id, req)`, `.transition(id, req)`, `.exportCatalog()`, `.setReviewerFlags(memberId, req)` (classe H : hors ligne → l'erreur « Nécessite le réseau » existante ; 403 → `lostAccess`) ; brouillon de commentaire `commentDraft.get/set/clear(accountId, exerciseId)` en `localStorage` (clé `rune.review.draft.<compte>.<fiche>`), effacé à l'envoi, à la déconnexion (branché sur le nettoyage de déconnexion existant) et à la suppression du compte.

- [ ] **Step 1: Write the failing tests** — carte « Relecture : N fiches t'attendent » affichée seulement en ligne après une réponse réussie, jamais depuis un cache, absente à N = 0 ; N inclut `health_pending` et `revalidate` pour une relectrice santé ; ligne Profil visible seulement pour un relecteur ; `/review` pour un membre → page introuvable ; 403 en pleine session → « Tu n'as plus accès à la relecture. » et retour au Profil sans boucle ; « Comment relire » s'ouvre au premier passage (une fois par compte) et depuis Aide, avec les 5 mots ; brouillon de commentaire effacé à la déconnexion.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test review` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(web): accès à la relecture, carte d'accueil et explication pour les relectrices`.
