### Task 12: Administration

**Files:**
- Modify: `apps/web/src/features/admin/*.tsx` et `admin.module.css`, tests `apps/web/test/admin/*`

- [ ] **Step 1: Tests qui échouent** — Membres : une carte par membre (`getAllByRole('article')`), badges rôle/statut/accord, dernière connexion relative ; le bouton « Actions pour ines.m » ouvre une feuille où « Désactiver » et « Supprimer le compte » sont dans un groupe « Actions sensibles » placé en dernier ; un membre désactivé garde « Réactiver » ; sous-navigation « Membres · Invitations · Salles · Serveur » ; Invitations : le code n'apparaît qu'à la création ; État du serveur : badges par section et « Dernier contrôle de l'hôte ».
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon `E01` à `E05`.
- [ ] **Step 4: Lancer** — PASS.
- [ ] **Step 5: Commit** `feat(web): administration en cartes, actions sensibles isolées`.

