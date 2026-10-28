### Task 8: Onboarding rhabillé et « Éveil terminé »

**Files:**
- Modify: `apps/web/src/features/onboarding/*.tsx` et `onboarding.module.css`, `apps/web/src/ui/HealthWarning.tsx` (style seulement), tous les tests et E2E qui cliquent « Suivant » (`apps/web/test/onboarding/*.tsx`, `apps/web/e2e/support/flows.ts`, `apps/web/e2e/*.spec.ts`) → « Continuer »
- Create: `apps/web/test/onboarding/celebration.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 4, 7 (`COACHES[c].ready`).
- Produces: bouton d'avancée nommé « Continuer » partout dans l'onboarding ; écran « C'est prêt » = célébration.

- [ ] **Step 1: Tests qui échouent** — `celebration.test.tsx` : l'écran prêt montre `getByRole('heading', { name: 'Éveil terminé.' })`, la carte « Quêtes d'éveil 3/3 » avec « Profil complété », « Lieu principal choisi », « Prêt hors ligne » cochés seulement quand l'état réel l'est (prêt hors ligne non atteint → 2/3 et la case non cochée), `RankBadge` « Rang E », la bulle du coach choisi avec sa ligne `ready` ; sous mouvement réduit, « Commencer » est présent dès le premier rendu.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** chaque étape selon `B0n-*.dc.html` (cartes de choix, pastilles pour jours et durée, sélecteur de salle avec recherche et « Créer une salle ») ; l'écran Santé garde ses textes mot pour mot, sans voix du Système ; renommer « Suivant » → « Continuer » et mettre à jour tests et E2E.
- [ ] **Step 4: Lancer** `pnpm test` et `pnpm --filter @rune/web test:e2e` — PASS (Chromium et WebKit).
- [ ] **Step 5: Commit** `feat(web): onboarding Rune en 9 étapes et célébration « Éveil terminé »`.

