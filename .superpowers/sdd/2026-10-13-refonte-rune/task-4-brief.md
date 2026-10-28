### Task 4: Feuilles du bas, Système, coach, rangs, art et mouvement

**Files:**
- Create: `apps/web/scripts/svg-to-tsx.mjs`, `apps/web/src/ui/art/` (généré : `CoachOmbre.tsx`, `CoachSkald.tsx`, `CoachScribe.tsx` avec variantes `mode: 'training' | 'nutrition'` et `scheme: 'dark' | 'light'`, `RankStone.tsx`), `apps/web/src/ui/BottomSheet.tsx`, `SystemPanel.tsx`, `CoachBubble.tsx`, `RankBadge.tsx`, `motion.css`, `use-reduced-motion.ts`, `CountUp.tsx`, `apps/web/test/ui/sheet-motion.test.tsx`
- Modify: `apps/web/src/ui/Dialog.tsx` (rend une `BottomSheet` sur téléphone, garde son API), `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: jetons (Task 1), `Button` (Task 3), `inert-outside.ts` existant.
- Produces:
  - `type CoachId = 'ombre' | 'skald' | 'scribe'` (importé de `@rune/contracts`, Task 6 ; en attendant la fusion, cette tâche déclare le type localement dans `ui/art/coach-id.ts` et Task 6 le remplace par l'import).
  - `<CoachAvatar coach: CoachId; mode?: 'training' | 'nutrition'; size: number; animated?: boolean />` (choisit `scheme` selon le thème effectif ; ids préfixés par `useId()`).
  - `<CoachBubble coach: CoachId; label: 'Aujourd\'hui' | 'Aperçu' | 'Message d\'accueil'; mode?; children />` (avatar 40 px + bulle ; aucune animation de frappe).
  - `<SystemPanel title: string; children; tone?: 'default' | 'success' />` (étiquette « [ SYSTÈME ] », coin HUD en sombre et en Salle de nuit, barre dégradée en clair).
  - `<RankBadge rank: 'E'|'D'|'C'|'B'|'A'|'S'; size: number; mini?: boolean; locked?: boolean />` (pierres runiques, `role="img"`, `aria-label="Rang E"`).
  - `<BottomSheet open: boolean; onClose(): void; title: string; children />` (poignée, fond assombri, focus piégé, Échap, retour du focus, fond `inert`).
  - `useReducedMotion(): boolean` ; `<CountUp to: number; duration?: number />` (affiche directement `to` si mouvement réduit).
  - `motion.css` : variables `--ease`, `--dur-fast: 200ms`, `--dur-screen: 380ms`, `--dur-celebrate: 900ms` ; classes `.enter-up`, `.stagger > *` (délai par index), `.pop` ; toutes neutralisées sous `prefers-reduced-motion`.
- Sources, copiées d'abord dans le dépôt (`docs/brand/coachs/{ombre,skald,scribe}/` et `docs/brand/rangs/`, que `svg-to-tsx.mjs` lit ; aucun chemin hors dépôt dans un script) depuis `C:\Users\eliott.colin\appsport-local\brand\skald\{systeme,personnage,embleme}\*.svg` (Ombre = systeme, Skald = personnage, Scribe = embleme), `C:\Users\eliott.colin\appsport-local\brand\rangs\pierre\rank-*.svg` et `mini/`. `svg-to-tsx.mjs` : attributs en camelCase, `id` et `url(#…)` préfixés par une prop `idPrefix`, groupes animables gardés (`*-eyes`, `*-visor`, `*-glyph`, `*-glow`).

- [ ] **Step 1: Tests qui échouent** — `sheet-motion.test.tsx` : `BottomSheet` ouverte → `getByRole('dialog', { name: 'Se déconnecter' })`, Échap appelle `onClose`, le focus revient au bouton déclencheur après fermeture, le reste a `inert` ; `RankBadge rank="E"` → `getByRole('img', { name: 'Rang E' })` ; `CountUp to={3}` sous `matchMedia('(prefers-reduced-motion: reduce)')` affiche « 3 » au premier rendu ; deux `CoachAvatar` sur la même page n'ont aucun `id` en double.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** ; lancer `node apps/web/scripts/svg-to-tsx.mjs` et committer les fichiers générés (en-tête « fichier généré par svg-to-tsx.mjs »).
- [ ] **Step 4: Lancer** `pnpm --filter @rune/web test` — PASS.
- [ ] **Step 5: Commit** `feat(web): feuilles du bas, fenêtre du Système, bulles et avatars des coachs, rangs en pierre et mouvement`.

