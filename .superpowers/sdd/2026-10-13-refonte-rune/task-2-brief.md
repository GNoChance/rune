### Task 2: Marque Rune, icônes et logo

**Files:**
- Create: `apps/web/src/ui/Logo.tsx`, `apps/web/scripts/render-icons.mjs`, `apps/web/test/app/brand.test.ts`
- Modify: `apps/web/public/manifest.webmanifest` (`name` `Rune`, `short_name` `Rune`, `theme_color` `#070A12`, `background_color` `#070A12`), `apps/web/public/icons/*.png` (régénérés), `apps/web/index.html` (icônes, `theme-color`), `apps/web/test/pwa/manifest.test.ts`

**Interfaces:**
- Consumes: le renommage de la tâche 0 (textes « Rune » déjà en place).
- Produces: `<RuneMark size?: number; glow?: boolean; title?: string />` (SVG en ligne de `rune-mark-mono.svg`, `currentColor` ; `glow` ajoute le dégradé et la lueur de `rune-mark.svg`) ; `<RuneWordmark />` (texte « RUNE » en `--font-display`, `letter-spacing: .22em`).

- [ ] **Step 1: Test qui échoue** — `brand.test.ts` : (a) le manifeste a `name === 'Rune'`, `short_name === 'Rune'` et les icônes 192, 512 et maskable 512 ; (b) `RuneMark` rend un `svg` avec `role="img"` et le titre donné, sans `id` en double quand deux marques sont affichées.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** : `render-icons.mjs` (Playwright, `docs/brand/rune-icon.svg` → 192, 512, maskable 512 avec 10 % de marge, apple-touch 180, favicon 32) puis le lancer et committer les PNG ; `Logo.tsx`.
- [ ] **Step 4: Lancer** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): logo Rang brisé et icônes de l'appli installée`.

