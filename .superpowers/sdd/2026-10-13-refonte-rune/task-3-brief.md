### Task 3: Composants de base

**Files:**
- Create: `apps/web/src/ui/ChoiceCard.tsx`, `Chips.tsx`, `Switch.tsx`, `SegmentedProgress.tsx`, `Badge.tsx`, `ListRow.tsx`, `EmptyState.tsx`, `PageHeader.tsx`, `apps/web/test/ui/components.test.tsx`
- Modify: `apps/web/src/ui/Button.tsx`, `Field.tsx`, `Banner.tsx`, `ChoiceList.tsx` (devient un adaptateur vers `ChoiceCard`), `ui.module.css`, `index.ts`

**Interfaces:**
- Produces:
  - `Button` : `variant?: 'primary' | 'secondary' | 'ghost' | 'danger'`, `block?: boolean` (pleine largeur).
  - `Field` : props existantes + `help?: string`, `error?: string` (rendue sous le champ avec `aria-describedby`, icône).
  - `ChoiceCard` : `{ type: 'radio' | 'checkbox'; name: string; value: string; checked: boolean; onChange(): void; title: string; description?: string; icon?: ReactNode }` — un vrai `<input>` + `<label>`, sélection = bord accent + teinte + coche.
  - `ChoiceGroup` : `{ legend: string; children }` (`<fieldset>`).
  - `Chips` : `{ name; options: { value: string; label: string }[]; value: string | null; onChange(v: string): void; legend: string }` (radios stylées, 44 px).
  - `Switch` : `{ id; label: string; checked; onChange(v: boolean): void; help?: string }` (`role="switch"`).
  - `SegmentedProgress` : `{ step: number; total: number }` rend « Étape {step} sur {total} » et `total` segments.
  - `Badge` : `{ tone: 'accent' | 'success' | 'muted' | 'warning' | 'danger'; children }`.
  - `ListGroup` + `ListRow` : `{ icon?; label; value?; href?; onClick?; badge?: ReactNode; tone?: 'danger' }` (lien ou bouton, chevron, 56 px).
  - `EmptyState` : `{ icon; title; text; action?: ReactNode }`.
  - `PageHeader` : `{ title: string; back?: string | (() => void) }` (bouton « Retour » 44×44 avec `aria-label="Retour"`).
  - `ChoiceList` garde sa signature actuelle (pas de casse pour les écrans existants).

- [ ] **Step 1: Tests qui échouent** — `components.test.tsx` : `ChoiceCard` cochée expose `getByRole('radio', { name: 'Prendre du muscle', checked: true })` ; `Chips` change la valeur au clic et a des cibles `min-height` 44 (classe) ; `Switch` a `role="switch"` et `aria-checked` ; `SegmentedProgress step=3 total=9` affiche « Étape 3 sur 9 » et 9 segments dont 3 `data-done` ; `Field error="12 caractères au moins."` relie l'erreur par `aria-describedby` ; `PageHeader back="/profile"` rend `getByRole('link', { name: 'Retour' })`.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon les maquettes (`GUIDE.md` › Components).
- [ ] **Step 4: Lancer** `pnpm --filter @rune/web test` — tous verts (les écrans existants gardent leurs rôles).
- [ ] **Step 5: Commit** `feat(web): boîte à outils de base (cartes de choix, pastilles, interrupteur, progression, listes, états vides)`.

