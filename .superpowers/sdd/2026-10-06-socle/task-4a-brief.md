### Task 4a: Migrations, compteur de révisions et support de test

**Files:**
- Create: `apps/server/src/db/{migrate.ts, server-meta.ts, rev.ts, migrations/index.ts}`, `apps/server/src/deps.ts` (`Clock`, `IdGen`, `systemClock`, `cryptoIds` ; complété en Task 6)
- Modify: `apps/server/src/db/schema.ts` (`tableKey`)
- Create: `apps/server/test/support/{clock.ts, ids.ts, index.ts}`
- Test: `apps/server/test/db/{migrate,rev}.test.ts`, `apps/server/test/support/support.test.ts`

**Interfaces:**
- Consumes : Task 3 (`openDatabase`, `DbExecutor`) ; Task 2 (`createMonotonicUuidV7`, `isUuidV7`).
- Produces : Interfaces partagées §2 (`deps.ts` : `Clock`, `IdGen`, `systemClock`, `cryptoIds` ; `db/migrations/index.ts` (avec `MIGRATIONS = []` jusqu'à la Task 4b), `db/migrate.ts`, `db/server-meta.ts`, `db/rev.ts`, `tableKey` ; support `clock.ts`, `ids.ts`).

**Spec:** R-VER-6, R-VER-7, R-SYN-1, R-SYN-3, R-SYN-25.

- [ ] **Step 1: Write the failing test**

```ts
// support.test.ts
const c = new FakeClock(); expect(c.now().toISOString()).toBe('2026-10-06T10:00:00.000Z');
c.advance(1500); expect(c.now().toISOString()).toBe('2026-10-06T10:00:01.500Z');
// seqIds(1) deux fois → mêmes 50 ids, tous isUuidV7, triés ; seqIds(2) ≠ seqIds(1) ; randomBytes(16) de longueur 16
// migrate.test.ts (migration de test m1 = '0001_t', qui crée server_meta selon le DDL de la Task 4b ; remplacée par MIGRATIONS en Task 4b)
expect(await migrate(db, [m1], clock)).toEqual({ applied: ['0001_t'], unknownNonBreaking: [] });
expect(await migrate(db, [m1], clock)).toEqual({ applied: [], unknownNonBreaking: [] });
expect(await db.selectFrom('schemaMigrations').selectAll().execute()).toEqual([{ id: '0001_t', breaking: 0, appliedAt: '2026-10-06T10:00:00.000Z' }]);
it('un échec annule toute la série', /* [m1, 0002_fail qui crée la table x puis lève] → rejects { name: 'MigrationError', code: 'migration_failed' } ; ni la table de m1 ni x ; schema_migrations vide */);
it('migration inconnue cassante → unknown_breaking_migration (R-VER-7)', /* ligne ('0099_future', 1) */);
it('migrations inconnues non cassantes permises', /* ligne ('0002_future', 0) → { applied: [], unknownNonBreaking: ['0002_future'] } */);
// rev.test.ts
const meta = await initServerMeta(db, { ids: seqIds(1), clock: new FakeClock() }); expect(isUuidV7(meta.serverEpoch)).toBe(true);
expect(meta).toMatchObject({ epochStartedAt: '2026-10-06T10:00:00.000Z', epochBaseRev: 0, syncCounter: 0, tombstonePurgeRev: 0, catalogVersion: null, catalogUpdatedAt: null });
expect(await getServerMeta(db)).toEqual(meta);
await expect(getServerMeta(emptyDb)).rejects.toThrow('server_meta absent');
expect([await nextRev(db), await nextRev(db), await nextRev(db)]).toEqual([1, 2, 3]); /* puis un nextRev dans une transaction annulée */ expect(await nextRev(db)).toBe(4);
expect(await writeStamp(db, { clock: new FakeClock() }, 'u1')).toEqual({ rev: 1, updatedAt: '2026-10-06T10:00:00.000Z', updatedBy: 'u1' });
expect(tableKey('training_profile')).toBe('trainingProfile');
```
(`rev.test.ts` utilise aussi m1 ; la Task 4b bascule les deux fichiers sur `MIGRATIONS`, où `applied` vaut `['0001_socle']`.)

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test db/ support` → « Failed to resolve import "../../src/db/migrate" » et `../support`.

- [ ] **Step 3: Implement**

`migrate` : crée hors transaction `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, breaking INTEGER NOT NULL CHECK (breaking IN (0,1)), applied_at TEXT NOT NULL) STRICT` ; une ligne inconnue avec `breaking = 1` → `MigrationError('unknown_breaking_migration')` sans rien appliquer ; applique les migrations manquantes dans **une seule** transaction ; toute erreur → `MigrationError('migration_failed')` (message français avec l'`id`, `cause`).

`seqIds(seed = 1)` : horloge partant de `2026-10-06T10:00:00.000Z` (+1 ms par appel), aléa mulberry32(`seed`), ids par `createMonotonicUuidV7`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test db/ support` → `Test Files  4 passed` (adapter, migrate, rev, support) ; `pnpm typecheck` passe.

- [ ] **Step 5: Commit**

`git commit -m "feat(db): migrations transactionnelles, compteur de révisions et horloge de test"`

---

