### Task 7: Démarrage, CLI de base et tâches planifiées

**Files:**
- Create: `apps/server/src/{main.ts, cli.ts, startup-guard.ts, startup.ts}`, `apps/server/src/jobs/{scheduler.ts, registry.ts}`
- Modify: `apps/server/package.json` (devDependency `tsx`)
- Test: `apps/server/test/cli/init.test.ts`, `apps/server/test/startup.test.ts`, `apps/server/test/jobs/scheduler.test.ts`

**Interfaces:**
- Consumes : Task 6 (`loadConfig`, `AppConfig`, `createApp`, `createAppDeps`, `AppDeps`, `createLogger`, `HealthResponse`) ; Tasks 4a et 4b ; Task 3 ; Task 2 (`isUuidV7`).
- Produces : Interfaces partagées §2 (`startup-guard.ts`, `startup.ts`, `jobs/*`, `main.ts`, `cli.ts` avec `init` et `db:check`).

**Spec:** R-DEP-5, R-OPS-3, R-VER-7, R-SYN-25, 08 §4 points 5 et 7, Global Constraints « Garde de démarrage ».

- [ ] **Step 1: Write the failing test**

Dossier temporaire neuf par test, supprimé en `afterEach` par `rmSync(dir, { recursive: true })` sans `force` (sous Windows, EBUSY si une base reste ouverte après `init`, `close()` ou un échec de `startServer`) ; `env = { APP_ORIGIN: 'http://localhost:3999', APPSPORT_DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0' }`.
```ts
// cli/init.test.ts
it('init exige la sentinelle', /* runCli(['init']) → 1 ; err /sentinelle/i ; readdirSync(dir) → [] */);
it('init crée la base, migre, initialise l\'époque ; un second init est refusé', async () => {
  writeFileSync(join(dir, '.appsport-volume'), '');
  expect(await runCli(['init'], env, o, e)).toBe(0);
  expect(out).toContain(`Époque du serveur : ${meta.serverEpoch}`);   // isUuidV7(meta.serverEpoch)
  expect(await runCli(['init'], env, o, e)).toBe(1); expect(err.join('\n')).toMatch(/existe déjà/);
});
it('db:check sur une base saine', /* → 0, out.at(-1) === 'OK' */);
it('db:check sur une base corrompue → 1', /* après init, ligne applied_op de user_id 'ghost' insérée sous foreign_keys=OFF → err /Base corrompue/ */);
it('db:check sans base → 1, aucun fichier créé', /* readdirSync(dir) → ['.appsport-volume'] */);
it('commande inconnue → 1', /* err /Commande inconnue : nope/ et liste les usages (/init/) */);
expect(parseFlags(['alice', '--birth-date', '2000-01-01'])).toEqual({ positional: ['alice'], flags: { 'birth-date': '2000-01-01' } });
// startup.test.ts
it('sans sentinelle → StartupError no_sentinel', () => {});
it('sentinelle sans base → no_database ; startServer rejette et ne crée aucun fichier', () => {});
it('tâches de démarrage avant l\'écoute, /api/health 200, arrêt en moins de 9 s', async () => {
  const s = await startServer(env, { startupTasks: [{ name: 't', run: async () => { calls.push('startup'); } }], dailyJobs: [{ name: 'j', run: async () => { calls.push('job'); } }] });
  expect(calls[0]).toBe('startup'); expect((await fetch(`http://127.0.0.1:${s.port}/api/health`)).status).toBe(200);
  const t0 = performance.now(); await s.close(); expect(performance.now() - t0).toBeLessThan(9000);
});
it('migration inconnue cassante → { name: \'MigrationError\', code: \'unknown_breaking_migration\' }', () => {});
it('migrations inconnues non cassantes → démarre et journalise unknown_migration', /* opts.logger = createLogger((l) => lines.push(l)) → ligne { level: 'warn', msg: 'unknown_migration', migration: '0002_future' } */);
it('main([\'nope\']) → 1', () => {});
// jobs/scheduler.test.ts (vi.useFakeTimers sur setInterval/clearInterval)
it('chaque job au démarrage puis toutes les 24 h ; stop() arrête', /* a appelé 1 fois, 2 fois après 24 h, toujours 2 après stop */);
it('isole l\'échec d\'un job et le journalise sans son message', /* ligne { level: 'error', job: 'boom' } ; journal sans 'TEMOIN' ; job suivant exécuté */);
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test cli/ startup jobs/` → « Failed to resolve import "../../src/cli" ».

- [ ] **Step 3: Implement**

Textes exacts :
- `StartupError('no_sentinel')` : « Volume de données absent : fichier sentinelle <chemin> introuvable. Le volume chiffré est-il déverrouillé ? » ; `StartupError('no_database')` : « Base introuvable : <chemin>. Lancez « server.mjs init » sur un volume neuf, ou restaurez une sauvegarde. »
- `init` : « Fichier sentinelle absent : <chemin> ; init refusé. » ; « La base existe déjà : <chemin> ; init refusé. » ; succès (`migrate`, `initServerMeta(db, { ids: cryptoIds(), clock: systemClock })`, base fermée) : `Base initialisée : <dbPath>` puis `Époque du serveur : <epoch>`.
- `db:check` : garde, `PRAGMA integrity_check` = `[{ integrity_check: 'ok' }]` et `foreign_key_check` vide → `OK` ; sinon `Base corrompue : …`, code 1.
- `runCli` : commande inconnue ou absente → `Commande inconnue : <cmd>` puis `  <usage>` par commande, code 1 ; exception d'une commande → message sur `err`, code 1.

`startServer` : `loadConfig` → garde → `openDatabase` → `migrate` (`logger.warn('unknown_migration', { migration })`, `logger` = `opts.logger ?? createLogger()`) → `createAppDeps` → tâches de démarrage → `serve` → `startDailyJobs` ; une erreur après `openDatabase` ferme `sqlite` avant d'être relancée. `close()` : arrêt des jobs, `server.close()`, puis `sqlite.close()`. `main` : `SIGTERM`/`SIGINT` → `setTimeout(() => process.exit(1), 9000).unref()` puis `close()` ; point d'entrée `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)` (valable sous `tsx` et dans le bundle). Échec d'un job → `logger.error('job_failed', { job, event: err.name })`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test cli/ startup jobs/` → `Test Files  3 passed` ; `pnpm test`, `pnpm typecheck`, `pnpm lint` passent.

- [ ] **Step 5: Commit**

`git commit -m "feat(ops): garde de démarrage, CLI init et db:check, arrêt propre et tâches quotidiennes"`

---

## Partie 2 — Comptes

