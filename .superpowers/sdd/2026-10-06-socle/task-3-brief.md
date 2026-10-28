### Task 3: Adaptateur Kysely pour `node:sqlite`

**Files:**
- Create: `apps/server/src/db/sqlite-dialect.ts`, `apps/server/src/db/open.ts`, `apps/server/src/db/schema.ts` (squelette : `export interface Database {}` et `DbExecutor`)
- Modify: `apps/server/package.json` (`kysely@~0.29` ; dev `better-sqlite3`, `@types/better-sqlite3`)
- Test: `apps/server/test/db/adapter.test.ts`

**Interfaces:**
- Consumes : Task 1.
- Produces : `NodeSqliteDialect`, `openDatabase`, `Database` (squelette), `DbExecutor` — Interfaces partagées §2.

**Spec:** 01 §2 (WAL, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout`, adaptateur remplaçable par better-sqlite3), 01 §9.1.4, Review Focus 1.

- [ ] **Step 1: Write the failing test**

`describe.each` sur deux fabriques (`openDatabase(':memory:').db.withTables<TestDb>()` et `new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }), plugins: [new CamelCasePlugin()] })`), table `item (id INTEGER PRIMARY KEY, item_name TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0) STRICT` :
```ts
it('CRUD avec CamelCasePlugin', /* insertId 1n ; update de 2 lignes → numUpdatedRows 2n ; select → { id: 1, itemName: 'a', qty: 3 } ; delete → numDeletedRows 1n */);
it('RETURNING renvoie les lignes', /* → [{ id: 1, itemName: 'r' }] */);
it('une transaction qui lève est annulée et la connexion libérée', /* names() → [] puis ['après'] */);
it('un savepoint annulé ne perd pas le reste de la transaction', /* garde, jete (rollbackToSavepoint), garde2 (release) → ['garde','garde2'] */);
it('Review Focus 1 : deux transactions concurrentes sérialisées ; l\'échec de l\'une n\'annule pas l\'autre', async () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const res = await Promise.allSettled([
    db.transaction().execute(async (trx) => { await trx.insertInto('item').values({ itemName: 'a' }).execute(); await tick(); throw new Error('échec voulu'); }),
    db.transaction().execute(async (trx) => { await trx.insertInto('item').values({ itemName: 'b' }).execute(); await tick(); }) ]);
  expect(res.map((r) => r.status)).toEqual(['rejected', 'fulfilled']); expect(await names()).toEqual(['b']);
});
it('Review Focus 1 : une requête hors transaction attend la transaction ouverte et survit à son rollback', /* 'dedans' annulé, 'dehors' → ['dehors'] */);
// node:sqlite seulement (le SqliteDialect de Kysely se bloquerait)
it('une requête sur db dans un callback de transaction lève au lieu de bloquer', /* execute(async () => db.selectFrom('item').selectAll().execute()) → rejects /utiliser trx/ en < 1 s ; names() ensuite → [] */);
// describe('openDatabase') sur un fichier temporaire
expect(pragma('journal_mode')).toBe('wal'); expect(pragma('synchronous')).toBe(2); expect(pragma('foreign_keys')).toBe(1); expect(pragma('busy_timeout')).toBe(5000);
// ':memory:' accepté ; fermer sqlite avant rmSync (Windows)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test adapter` → « Failed to resolve import "../../src/db/open" ».

- [ ] **Step 3: Implement**

- Driver à **une seule connexion** protégée par un mutex (file de promesses). `beginTransaction` → `BEGIN IMMEDIATE` **[décision plan]** (évite `SQLITE_BUSY` quand la CLI écrit en parallèle) ; savepoints comme le `SqliteDriver` de Kysely ; `destroy` ne ferme pas la base.
- Réentrance : le bail de connexion d'une transaction est marqué dans un `AsyncLocalStorage` ; `acquireConnection` appelé depuis ce contexte lève `Error('Requête sur db pendant une transaction ouverte : utiliser trx')` au lieu d'attendre le mutex.
- `executeQuery` : `stmt.columns().length > 0` → `stmt.all`, sinon `stmt.run` (`numAffectedRows`, `insertId` en `BigInt`). Aucune conversion de booléens ; erreurs du pilote propagées telles quelles (`errcode`, lu par la Task 20).

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test adapter` → `Test Files  1 passed`, tous les cas verts pour `node:sqlite` et `better-sqlite3`.

- [ ] **Step 5: Commit**

`git commit -m "feat(db): adaptateur Kysely pour node:sqlite, sérialisé et testé contre better-sqlite3"`

---

