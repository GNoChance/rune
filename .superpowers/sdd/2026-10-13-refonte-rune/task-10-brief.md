### Task 10: Espace Profil, réglages, coach, santé, confidentialité, déconnexion

**Files:**
- Create: `apps/web/src/features/profile/ProfileHub.tsx`, `apps/web/src/features/coach/MyCoachPage.tsx`, `apps/web/test/profile/hub.test.tsx`
- Modify: `apps/web/src/App.tsx` (routes `/profile` → hub, `/profile/edit` → `ProfilePage`, `/profile/coach`), `apps/web/src/features/profile/ProfilePage.tsx` (Mon profil : lignes qui ouvrent les formulaires ; mot de passe derrière « Changer le mot de passe » ; mode prudent ici seulement), `apps/web/src/features/status/SettingsPage.tsx` (Apparence 5 choix avec aperçu + Synchronisation : connexion, en attente, refusés, stockage), `apps/web/src/features/privacy/HealthSection.tsx` (retrait de l'accord ici), `PrivacySettingsPage.tsx` (état de l'accord + lien vers Santé ; export ; suppression isolée en bas), `apps/web/src/features/auth/LogoutDialog.tsx` (une seule entrée, choix dans la feuille), tests `apps/web/test/profile/*`, `privacy/*`, `auth/logout-reset.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–7 (`useThemeChoice`, `BottomSheet`, `CoachAvatar`, `COACHES`, `setCoach`).

- [ ] **Step 1: Tests qui échouent** — hub : lignes « Mon profil », « Mon coach », « Mes lieux », « Santé », « Confidentialité et données », « Réglages », « Aide », « Administration » (admin seulement), « Se déconnecter » ; badge sur « Réglages » quand il y a des refus ; Mon coach affiche les deux avatars (entraînement et nutrition) et « Changer de coach » ouvre une feuille avec les 3 choix, confirmer appelle `setCoach` ; Réglages : `getByRole('radio', { name: 'Auto' })` coché par défaut, choisir « Carnet » appelle `writeThemeChoice('carnet')` et pose `data-theme="carnet"` ; Mon profil n'affiche pas les champs de mot de passe avant le clic ; Santé contient « Retirer l'accord santé » et Confidentialité ne le contient plus ; déconnexion : une ligne, la feuille propose « Cet appareil » et « Tous mes appareils », l'avertissement de données non envoyées reste.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon `C01` à `C06`.
- [ ] **Step 4: Lancer** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): espace Profil, Mon coach, apparence, santé, confidentialité et déconnexion`.

