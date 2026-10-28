### Task 5: Coquille, navigation et état de connexion

**Files:**
- Create: `apps/web/src/ui/TabBar.tsx`, `apps/web/src/ui/SideNav.tsx`, `apps/web/src/ui/ConnectionPill.tsx`, `apps/web/test/app/shell.test.tsx`
- Modify: `apps/web/src/ui/AppShell.tsx` (en-tête logo + RUNE + `ConnectionPill` + rond initiale → `/profile` ; `UpdateBanner` sous l'en-tête ; `TabBar` en bas sur téléphone, `SideNav` ≥ 900 px ; transitions d'écran), `apps/web/src/ui/Page.tsx` (utilise `PageHeader`), `apps/web/src/App.tsx` (routes `/progression` → page vide provisoire `ProgressionPage` de Task 9, `/places` = liste des lieux, redirection `/profile/places` → `/places`), `apps/web/src/features/status/ConnectionStatus.tsx`, `apps/web/src/sw/UpdateBanner.tsx` (+ son CSS), `apps/web/test/app/guard.test.tsx` et tests qui ciblaient l'ancien en-tête

**Interfaces:**
- Consumes: Tasks 2 à 4.
- Produces (démarrage) : `<BootSplash />` dans `apps/web/src/ui/BootSplash.tsx` — au premier affichage d'une session, le logo se dessine (≤ 1,2 s) puis s'efface ; ignoré sous mouvement réduit ; ne retarde jamais un écran dont les données sont prêtes (il se superpose et disparaît). Test : sous mouvement réduit, `BootSplash` ne rend rien.
- Produces: `TAB_ITEMS = [{ href: '/', label: 'Accueil' }, { href: '/progression', label: 'Progression' }, { href: '/places', label: 'Salles' }, { href: '/profile', label: 'Profil' }]` ; `<TabBar />` (nav `aria-label="Navigation principale"`, onglet actif `aria-current="page"` selon le préfixe d'URL, pastille qui glisse) ; `ConnectionPill` lit la même source que les écrans qui affichent « Nécessite le réseau » (`useSyncState().connection`) ; plus de compteurs dans l'en-tête (ils passent dans Réglages, Task 10).

- [ ] **Step 1: Tests qui échouent** — `shell.test.tsx` : sur `/places/…` l'onglet « Salles » a `aria-current="page"` ; sur `/profile/health` c'est « Profil » ; l'en-tête n'affiche plus « 0 en attente » ; quand `connection === 'offline'`, la pastille dit « Hors ligne » (jamais « En ligne ») ; l'onglet « Administration » n'existe plus dans la barre (l'admin passe par Profil) ; `/profile/places` redirige vers `/places`.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon `MixSombre.dc.html` / `MixClair.dc.html` (barre flottante en pilule) ; transitions : avant = glisse depuis la droite, retour = depuis la gauche, onglet = fondu (classe posée selon l'historique wouter).
- [ ] **Step 4: Lancer** `pnpm test` puis `pnpm --filter @rune/web test:e2e arrival` — adapter les sélecteurs E2E qui visaient l'ancienne navigation.
- [ ] **Step 5: Commit** `feat(web): coquille Rune, barre d'onglets flottante, navigation latérale et état de connexion unique`.


