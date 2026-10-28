### Task 5: Registre `entityRules` et fabriques de test

**Files:**
- Create: `packages/contracts/src/{case.ts, entity-rules.ts}`, `apps/server/test/support/factories.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/server/src/db/schema.ts` (`tableKey` délègue à `snakeToCamel`), `apps/server/test/support/index.ts`
- Test: `packages/contracts/test/{case,entity-rules}.test.ts`, `apps/server/test/db/entity-rules.test.ts`

**Interfaces:**
- Consumes : Tasks 4a et 4b (`openDatabase`, `migrate`, `MIGRATIONS`, `Database`, `tableKey`, `seqIds`) ; Task 2.
- Produces : Interfaces partagées §1 (`case.ts`, `entity-rules.ts` avec les valeurs des 18 tables) et §2 (support `factories.ts`).

**Spec:** R-SYN-4, R-REG-1, P-CAT-1, P-CAT-2, 02 R-EXP-2, 03 §17 n°2, 09 §0.4, §0.5 et §8 (retrait du consentement).

- [ ] **Step 1: Write the failing test**

```ts
// case.test.ts
expect(snakeToCamel('training_profile')).toBe('trainingProfile'); expect(camelToSnake('usernameKey')).toBe('username_key');
expect(rowToCamel({ owner_id: 'u', deleted_at: null })).toEqual({ ownerId: 'u', deletedAt: null });
for (const [t, r] of Object.entries(entityRules)) for (const c of [t, ...r.columns]) expect(camelToSnake(snakeToCamel(c))).toBe(c);
// entity-rules.test.ts (contracts)
// 18 clés triées ; pick(t) = [category, syncClass, ownerColumn, exported, onUserDelete].join('/') égal aux valeurs des Interfaces partagées §1 pour les 18 tables
expect(entityRules.sync_rejection!.clientWritable).toEqual(['dismissed_at']); expect(entityRules.user!.secretColumns).toEqual(['password_hash']);
expect(mirroredTables()).toEqual(['consent_event','gym','gym_equipment','health_screening','home_equipment','limitation','place','sync_rejection','training_profile','user']);
// invariants : clientWritable vide hors J ; clientWritable, c2Columns, secretColumns, ownerColumn ⊂ columns ; tables à owner_id ⊃ SYNC_COLUMNS (consent_event sans deleted_at) ; J/D/E ⊃ 'rev' ;
//   points d'extension (09 §8) : si présents, parent.entity ∈ clés et parent.column ∈ columns, clés de c2Values ⊂ columns \ c2Columns ; aucune des 18 tables n'a parent ni c2Values
// entity-rules.test.ts (serveur, base :memory: migrée) — P-CAT-2, R-REG-1
it('chaque table et chaque colonne de sqlite_schema est déclarée, et inversement', /* pragma_table_info */);
it('toute table C1–C3 liée à un utilisateur est exportée et supprimée', () => { /* onUserDelete ∈ {cascade, anonymize} ; exported, sauf session (anonymize, non exportée : 02 R-EXP-2) */ });
it('secretColumns = toutes les colonnes *_hash', () => expect(declared).toEqual(['invitation.code_hash','password_reset.code_hash','session.token_hash','user.password_hash']));
it.each(Object.keys(entityRules))('insertFixtureRow(%s) insère une ligne valide', async (table) => {
  const row = await insertFixtureRow(db, table);
  expect(Object.keys(row).sort()).toEqual(entityRules[table]!.columns.map(snakeToCamel).sort());
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('insertFixtureRow applique les valeurs fournies', /* place { ownerId: user.id, kind: 'home', name: 'Maison' } */);
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/contracts test` et `pnpm --filter @appsport/server test entity-rules` → « Failed to resolve import "../src/case" ».

- [ ] **Step 3: Implement**

`columns` = colonnes exactes du DDL de la Task 4b (plus `schema_migrations` : `id`, `breaking`, `applied_at`) ; `c2Columns` vaut `[]` partout au socle (tables C2 entièrement C2) ; `parent` (relation parent pour la synchro J, renvoi trié parents d'abord) et `c2Values` (valeurs C2 d'une colonne C1, ex. `swap_reason: ['pain']`) ne sont posés sur aucune table du socle : la Task 20 les exerce sur ses tables de test. `insertFixtureRow` : une fabrique par table ; parents créés par récursion (`ownerId` → `user`, `gymId` → `gym`, `placeId` → `place` maison) ; ids de `seqIds(999)` ; clés déterministes (`training_profile.id = ownerId`, `health_screening.id = ownerId`, `gym_equipment.id = gymId + ':dumbbells'`, `home_equipment.id = placeId + ':chair'`) ; défauts `rev: 1`, horodatages `'2026-10-06T10:00:00.000Z'`, `user` (`user<n>`, `passwordHash: '$argon2id$fixture'`, `member`, `birthDate: '1990-01-01'`), `gym` (`Salle <n>`, `Lyon`, `loadSettings: '{}'`), `place` (`home`, `Maison`, `'{}'`) ; renvoie la ligne relue.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/contracts test` vert ; `pnpm --filter @appsport/server test entity-rules` → `Test Files  1 passed` (dont les 18 cas `insertFixtureRow`) ; `pnpm test` vert.

- [ ] **Step 5: Commit**

`git commit -m "feat(db): registre entityRules des 18 tables, conversion de casse et fabriques de lignes de test"`

---

