### Task 1: Jetons, thèmes et polices

**Files:**
- Create: `apps/web/src/ui/theme/tokens.css`, `apps/web/src/ui/theme/theme.ts`, `apps/web/src/ui/theme/fonts.ts`, `apps/web/test/ui/theme.test.ts`, `apps/web/test/ui/contrast.test.ts`
- Modify: `apps/web/src/main.tsx` (appliquer le thème avant `createRoot`), `apps/web/src/ui/ui.module.css` (remplacer les anciennes variables `--color-*` par les nouveaux jetons), `apps/web/package.json` (dépendances `@fontsource/chakra-petch`, `@fontsource/barlow`, `@fontsource/newsreader`, versions exactes publiées depuis plus de deux semaines)

**Interfaces:**
- Produces: `type ThemeChoice = 'auto' | 'clair' | 'sombre' | 'carnet' | 'nuit'`; `THEME_CHOICES: readonly ThemeChoice[]`; `readThemeChoice(): ThemeChoice` (localStorage clé `rune.theme`, `try/catch`, défaut `'auto'`); `writeThemeChoice(c: ThemeChoice): void`; `applyTheme(c: ThemeChoice, root?: HTMLElement): void` (pose `data-theme` sauf pour `auto`, met à jour `<meta name="theme-color">`); `useThemeChoice(): [ThemeChoice, (c: ThemeChoice) => void]`.
- Jetons CSS (noms imposés, utilisés par toutes les tâches) : `--bg`, `--surface`, `--surface-strong`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-text` (texte sur accent), `--accent-2`, `--danger`, `--success`, `--warning-text`, `--warning-bg`, `--field-bg`, `--field-border`, `--focus`, `--radius-card: 18px`, `--radius-control: 14px`, `--font-display`, `--font-body`, `--font-title` (Newsreader en Carnet, sinon `--font-display`). Valeurs « clair »/« sombre » = tableau Tokens de `GUIDE.md` ; « carnet » = maquette `Carnet.dc.html` ; « nuit » = maquette `Main.dc.html`.
- Structure CSS : `:root` = clair ; `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { …sombre } }` ; `:root[data-theme="clair"]`, `[data-theme="sombre"]`, `[data-theme="carnet"]`, `[data-theme="nuit"]`.

- [ ] **Step 1: Écrire les tests qui échouent** — `theme.test.ts` : `readThemeChoice()` renvoie `'auto'` sans stockage et quand `localStorage.getItem` lève ; `applyTheme('clair')` pose `data-theme="clair"` ; `applyTheme('auto')` retire l'attribut ; `theme-color` vaut `#F1F3F7` pour clair et `#070A12` pour sombre ; `tokens.css` ne redéfinit les jetons sombres sous `prefers-color-scheme: dark` que pour `:root:not([data-theme])` (un thème forcé l'emporte toujours sur le réglage du téléphone). `contrast.test.ts` : lit `tokens.css` (fs), extrait chaque bloc de thème et vérifie `ratio(--text, --bg) >= 4.5`, `ratio(--text-muted, --surface) >= 4.5`, `ratio(--accent-text, --accent) >= 4.5`, `ratio(--accent, --bg) >= 3` pour les 5 thèmes (fonction `contrastRatio(hexA, hexB)` WCAG 2.x dans le test).
- [ ] **Step 2: Lancer** `pnpm --filter @rune/web test theme contrast` — attendu : FAIL (modules absents).
- [ ] **Step 3: Implémenter** `tokens.css`, `theme.ts`, `fonts.ts` (imports des sous-ensembles latins woff2 : Chakra Petch 600/700, Barlow 400/500/600, Newsreader 600), appel `applyTheme(readThemeChoice())` dans `main.tsx` avant le rendu ; brancher `ui.module.css` sur les jetons.
- [ ] **Step 4: Lancer** les deux tests, puis `pnpm --filter @rune/web build` et vérifier dans `dist/` que les woff2 sont émis et figurent dans le manifeste de précache (test existant `precache-plugin.test.ts` vert).
- [ ] **Step 5: Commit** `feat(web): jetons des 5 thèmes, choix d'apparence par appareil et polices embarquées`.

