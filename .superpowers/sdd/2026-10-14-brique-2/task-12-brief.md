### Task 12: Dépôt du catalogue côté web et composant d'onglets

**Files:**
- Create: `apps/web/src/repos/catalog-repo.ts`, `apps/web/test/repos/catalog-repo.test.ts`, `apps/web/src/ui/Tabs.tsx`, `apps/web/test/ui/tabs.test.tsx`
- Modify: `apps/web/src/ui/index.ts`, `apps/web/src/ui/ui.module.css`

**Interfaces:**
- Consumes: Tasks 1, 2.
- Produces : `useCatalog(): {state: 'missing'|'loading'|'ready'; sheets: ServedSheet[]}` ; `useExerciseView(opts: {feasibleOnly: boolean}): {groups: {code; label; count}[]; place: {id; name; equipment: Set<EquipmentCode>} | null; cautious: boolean; maxLevel: 1|2|3}` ; `searchExercises(query, opts): {results: ServedSheet[]; hiddenByFeasible: number; hiddenByCautious: boolean}` ; `getSheetView(id): {sheet; usable: boolean; feasibleHere: boolean; chain: {easier?: ServedSheet; harder?: ServedSheet}; substitutes: ServedSheet[]}`. `Tabs` : props `{label: string; tabs: {id: string; label: string}[]; value: string; onChange(id): void; children(panelId): ReactNode}`, motif ARIA APG (flèches, Début, Fin, un seul onglet focalisable, `aria-controls`, panneau focalisable), cibles ≥ 44 px.

- [ ] **Step 1: Write the failing tests** — `catalog-repo.test.ts` (Dexie de test) : catalogue absent → `missing` ; compte des tuiles avec et sans filtre (fixture où une tuile change de nombre et une autre passe à 0) ; profil prudent : aucune fiche `not_for_minors` dans les groupes, la recherche ou les variantes, et `hiddenByCautious` vrai ; sans lieu principal : `place` null et tout le matériel ; `getSheetView` d'une fiche `not_for_minors` en profil prudent → `usable: false` ; `tabs.test.tsx` : flèches, Début, Fin, `aria-selected`, `aria-controls`, `tabIndex` à -1 sur les onglets inactifs.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test repos/catalog-repo ui/tabs` — FAIL.
- [ ] **Step 3: Implement** ; le dépôt appelle `isUsable`, `visibleWithoutPlace`, `usableChainSteps` et `substitutes` de `@rune/domain`.
- [ ] **Step 4: Run** — PASS ; `architecture.test.ts` vert.
- [ ] **Step 5: Commit** `feat(web): dépôt du catalogue et composant d'onglets accessible`.
