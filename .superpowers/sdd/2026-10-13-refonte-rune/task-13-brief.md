### Task 13: Accès, pages publiques, 404, hors ligne et mise à jour

**Files:**
- Modify: `apps/web/src/features/auth/*.tsx` et `auth.module.css`, `apps/web/src/features/public/*.tsx` et `public.module.css`, `apps/web/src/sw/UpdateBanner.tsx`, tests `apps/web/test/auth/*`, `app/public-pages.test.tsx`

- [ ] **Step 1: Tests qui échouent** — Connexion : logo, « RUNE », « Grave ta progression. », champs Pseudo et Mot de passe, lien « J'ai un code d'invitation » ; Aide : l'encadré d'urgence (15, 112) est avant « Installer Rune », la section Crédits est présente ; 404 : « Page introuvable » et « Zone inconnue. » avec un lien vers l'accueil ; bannière de mise à jour : « Plus tard » absent dans la variante 426 ; erreur de mot de passe rattachée au champ.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon `A01` à `A06` et `E06`.
- [ ] **Step 4: Lancer** `pnpm test` et `pnpm --filter @rune/web test:e2e` — PASS.
- [ ] **Step 5: Commit** `feat(web): connexion, invitation, aide, 404 et bannière de mise à jour aux couleurs de Rune`.


