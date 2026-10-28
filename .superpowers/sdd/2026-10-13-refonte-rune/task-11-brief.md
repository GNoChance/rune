### Task 11: Salles et lieux

**Files:**
- Create: `packages/contracts/src/equipment-short-labels.ts`, `apps/web/test/places/draft.test.tsx`
- Modify: `apps/web/src/features/places/*.tsx` et `places.module.css`, `packages/contracts/src/index.ts`, tests `apps/web/test/places/*`

**Interfaces:**
- Produces: `EQUIPMENT_SHORT_LABELS: Record<EquipmentCode, string>` (libellé jusqu'à la parenthèse ; exceptions écrites à la main : « Barre guidée (Smith) » gardé entier) ; `useEquipmentDraft(initial: Set<EquipmentCode>): { selected; toggle(code); changes: { added: EquipmentCode[]; removed: EquipmentCode[] }; reset(); save(): Promise<void> }`.

- [ ] **Step 1: Tests qui échouent** — `draft.test.tsx` : cocher puis décocher le même équipement → 0 changement, aucun appel ; 1 ajout + 1 retrait → barre « 2 changements · 1 ajout, 1 retrait », « Enregistrer » envoie exactement ces deux appels ; quitter la fiche sans enregistrer → aucun appel et l'état serveur est réaffiché au retour ; un échec réseau à l'enregistrement garde le brouillon et affiche l'erreur ; toucher une salle dans « Mes lieux » ouvre directement sa fiche ; l'interrupteur « Lieu principal » est `disabled` et coché sur le lieu principal ; la case « Qui va à cette salle » porte l'interrupteur de visibilité de l'utilisateur.
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon `D01` à `D05` (pastilles par catégorie, historique en frise).
- [ ] **Step 4: Lancer** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): salles et lieux Rune, équipement en brouillon et fiche directe`.

