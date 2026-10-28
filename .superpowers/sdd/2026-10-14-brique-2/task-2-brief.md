### Task 2: Fonctions partagées du catalogue

**Files:**
- Create: `packages/domain/src/catalog/{equipment,usable,chains,substitutes,canonical,index}.ts`, `packages/domain/test/catalog/{equipment,usable,chains,substitutes,canonical}.test.ts`, `packages/domain/test/fixtures/catalog.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/test/purity.test.ts` (lecture récursive de `src/`)

**Interfaces:**
- Consumes: Task 1.
- Produces : `expandEquipment(codes): Set<EquipmentCode>`, `feasible(ex, equipment: Set<EquipmentCode>): boolean`, `type CatalogContext = {catalog: ExerciseSheet[]; equipment: Set<EquipmentCode> | 'all'; maxLevel: 1|2|3; cautious: boolean}`, `isUsable(ex, ctx)`, `visibleWithoutPlace(ex, cautious)` (spec §4.1 « interrupteur coupé »), `buildChains(catalog): Map<string, ExerciseSheet[]>`, `chainRank(ex, chains): number | null`, `usableChainSteps(chainId, ctx)`, `substitutes(ex, ctx): ExerciseSheet[]`, `canonicalJson(sheet): string` (clés dans l'ordre de 04 §4, 2 espaces, LF final). `equipment: 'all'` vaut faisable partout (sans lieu principal).

- [ ] **Step 1: Write the failing tests** — tableaux de cas de 04 §13 critères 2 à 4 : `[[]]` toujours faisable ; plusieurs options ; `adjustable_bench` vaut `flat_bench` ; lieu vide ; `buildChains` donne les rangs 1 à n ; `usableChainSteps` s'arrête avant la première `not_for_minors` en profil prudent ; propriétés fast-check de `substitutes` (jamais l'exercice lui-même, jamais une fiche non publiée, non faisable, au-dessus de `maxLevel`, ou `not_for_minors` si `cautious` ; au plus 5 ; ordre stable quel que soit l'ordre d'entrée ; égalités départagées par `id` en ordre binaire) ; `canonicalJson` stable et identique après aller-retour `JSON.parse`. Le test de pureté échoue si un fichier de `src/catalog/` contient `Date.now(`.
- [ ] **Step 2: Run** `pnpm --filter @rune/domain test` — FAIL.
- [ ] **Step 3: Implement** selon 04 §6 (score de `substitutes` : 3 × principaux communs + 1 × secondaires communs − 2 × |écart de niveau| + 1 même `unilateral` + 1 même `load_mode`).
- [ ] **Step 4: Run** — PASS, sous Node ; ajouter `packages/domain/test/catalog/substitutes.test.ts` au projet web (happy-dom) par un import dans `apps/web/test/domain-parity.test.ts` qui rejoue les mêmes propriétés (04 §13 critère 3).
- [ ] **Step 5: Commit** `feat(domain): faisabilité, chaînes, remplaçants et forme canonique des fiches`.
