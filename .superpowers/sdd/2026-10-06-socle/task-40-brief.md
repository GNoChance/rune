### Task 40: Instantanés, restauration et E2E d'époque

**Files:**
- Create: `apps/server/src/ops/{snapshot.ts, restore.ts}`, `apps/server/test/ops/helpers.ts`, `apps/web/e2e/epoch.spec.ts`
- Modify: `apps/server/src/cli.ts` (`snapshot --tag <tag>`, `restore <fichier.db>`)
- Test: `apps/server/test/ops/{snapshot,restore,restore-privacy,cli-ops}.test.ts`, `apps/web/e2e/epoch.spec.ts`

**Interfaces:**
- Consumes : T3 (`openDatabase`) ; T4a (`migrate`, `MIGRATIONS`, `initServerMeta`, `getServerMeta`, `nextRev`) ; T2 (`parisDate`, `isUuidV7`) ; T6 (`Clock`, `IdGen`, `systemClock`, `cryptoIds`, `loadConfig`, `createTestContext` avec `dbPath`) ; T7 (`assertStartupPreconditions`, `runCli`) ; T10 (`createUserAndLogin`, `isHealthConsentActive`) ; T20 (`dumpDatabase`) ; T22 (`rotateServerEpoch`) ; T24 (`collectPrivacyEvents`, `reapplyPrivacyEvents`) ; T14 ; T38 (`startE2EServer`, `bootstrapAdmin`, `E2EServer.stop`, `restart`, `close`, `cli`) ; T26 (renvoi `replay-withdraw`, attendu absent) ; routes de T11, T13, T16, T18, T19.
- Produces : Interfaces partagées §8 (`SNAPSHOT_TAG_RE`, `takeSnapshot`, `pruneSnapshots`, `restoreSnapshot`, commandes `snapshot` et `restore`) et :
```ts
export class SnapshotError extends Error { readonly code: 'invalid_tag' }               // constructor(code, message)
export class RestoreError extends Error { readonly code: 'snapshot_missing' | 'integrity_failed' }
// apps/server/test/ops/helpers.ts
export interface OpsDataDir { dir: string; dbPath: string; sqlite: DatabaseSync; db: Kysely<Database>; close(): void }
export async function createOpsDataDir(): Promise<OpsDataDir>;   // dossier temporaire + sentinelle + base fichier migrée + initServerMeta(db, { ids: seqIds(1), clock: new FakeClock() })
```
Sorties CLI (stdout, code 0) : `snapshot` → `Instantané écrit : <chemin absolu>` (après `pruneSnapshots(dataDir, now)`) ; `restore` → `Base remplacée conservée 30 jours dans <dossier>.`, `Restauration terminée. Nouvelle époque : <uuid> (epoch_base_rev <n>).` puis `Lancez maintenant privacy:reapply, avant de redémarrer le service.` Erreurs (stderr, code 1) : `Étiquette invalide « <tag> » : attendu daily ou pre-vX.Y.Z.` ; `Instantané introuvable : <chemin>.` ; `Instantané corrompu (PRAGMA integrity_check) : base actuelle laissée intacte.` ; `Volume de données absent : sentinelle <chemin> introuvable.` `snapshot` exige sentinelle et base ; `restore` n'exige que la sentinelle (P4 (b) sur une machine neuve).

**Spec:** R-DEP-7, R-SYN-25, R-SYN-26, R-SYN-28, R-OPS-10, 08 §7, §12 P4 (a), 03 §7, §8, §17 n°10, 01 §9.1.6 (7) ; Review Focus 4 (Vitest).

- [ ] **Step 1: Write the failing test**

```ts
// snapshot.test.ts
// 'daily' à '2026-10-06T22:30:00.000Z' (7 oct. à Paris) → join(dir, 'snapshots', 'daily-20261007.db') ; ni '-wal' ni '.partial' ;
//   journal_mode 'delete' ; integrity_check [{ integrity_check: 'ok' }]
// 'pre-v1.2.3' → snapshots/pre-v1.2.3.db
it.each(['', 'weekly', 'pre-1.2.3', 'pre-v1.2', 'daily-20261006', '../x', 'pre-v1.2.3/../../x'])('« %s » → { code: \'invalid_tag\' }, aucun fichier', () => {});
// écritures concurrentes par une SECONDE DatabaseSync sur le même fichier (pair_a et pair_b, 20 000 lignes puis insertions en boucle pendant la copie) :
//   au moins une écriture pendant la copie, count(pair_a) = count(pair_b) ≥ 20 000, intégrité ok, fini en 60 s
// second instantané du même nom → remplace le premier
// pruneSnapshots(dir, new Date('2026-10-07T12:00:00Z')) (mtime 1 à 5 octobre ; notes.txt ignoré) → supprimés ['daily-20261001.db','daily-20261002.db','pre-v1.9.0.db'] ;
//   restent daily-20261003 à 05, notes.txt, pre-v1.10.0, pre-v1.11.0, pre-v1.12.0
// pre-v1.0.0.db seul de son groupe et dossier replaced-20260906T000000Z, mtime 2026-09-06 (31 j) → supprimés ; replaced-20261001T000000Z gardé
// restore.test.ts (clock FakeClock '2026-10-07T20:00:00.000Z')
// 3 nextRev, instantané, 5 nextRev, base fermée → restoreSnapshot → epoch UUIDv7 ≠ ancienne, baseRev 3 ;
//   server_meta { serverEpoch: epoch, epochBaseRev: 3, syncCounter: 3, epochStartedAt: '2026-10-07T20:00:00.000Z' } ; aucun fichier '.restoring' ;
//   replacedDir = snapshots/replaced-20261007T200000Z, son appsport.db a le sha256 de l'ancienne base
// pages 2 et 3 de l'instantané écrasées → { code: 'integrity_failed' }, base courante identique (sha256), ni '.restoring' ni 'replaced-*'
// ids.uuidv7() qui lève → erreur relancée, base courante identique (sha256), ni '.restoring' ni 'replaced-*'
// instantané absent → { code: 'snapshot_missing' }
// Review Focus 4 : WAL étranger (ligne 'apres-instantane' écrite après l'instantané, -wal et -shm recopiés) → après restauration, count(marker) 0,
//   intégrité ok, -wal et -shm présents dans replacedDir et absents de dataDir
// restore-privacy.test.ts (Review Focus 4) — base fichier : alice, bob (consentement, questionnaire, limitation 'TEMOIN-C2-genou') ; since ; instantané ;
//   +60 s : alice supprime son compte, bob retire son accord ; collectPrivacyEvents → ['account_deleted','consent_revoked'] ;
//   ctx.close(), restoreSnapshot puis reapplyPrivacyEvents sur un nouveau contexte du même fichier :
expect(me.status).toBe(410); expect(await me.json()).toEqual({ error: 'account_deleted' });   // ancien cookie d'alice
// alice absente de user ; isHealthConsentActive(bob) false ; limitations de bob supprimées et vides ; dumpDatabase sans 'TEMOIN-C2-genou'
// cli-ops.test.ts (après init)
expect(lines.at(-1)).toMatch(/^Instantané écrit : .*[\\/]snapshots[\\/]daily-\d{8}\.db$/);
// --tag pre-v1.2.3 → fichier créé ; sans --tag ou 'weekly' → code 1, aucun fichier ; sans sentinelle → 1 ; 4 daily anciens + snapshot → 3 daily restent
expect(lines.at(-3)).toMatch(/^Base remplacée conservée 30 jours dans .*[\\/]snapshots[\\/]replaced-\d{8}T\d{6}Z\.$/);
expect(lines.at(-2)).toMatch(/^Restauration terminée\. Nouvelle époque : [0-9a-f-]{36} \(epoch_base_rev \d+\)\.$/);
expect(lines.at(-1)).toBe('Lancez maintenant privacy:reapply, avant de redémarrer le service.');
// restore d'un fichier absent → 1, base inchangée ; sans base courante mais avec sentinelle → 0, aucun replaced-*
// epoch.spec.ts (Chromium et WebKit, 180 s) : admin créé par l'API (bootstrapAdmin + accept + profil + lieu maison + complete, sans accord santé) ; page '/' online,
//   meta.serverEpoch = epoch1 ; since ; `snapshot --tag daily` ; PATCH daysPerWeek 4 → miroir 4 ; privacy:collect, stop, restore, privacy:reapply, restart ;
//   epoch2 ≠ epoch1 ; reload → online, meta.serverEpoch epoch2, watermark `${epoch2}:…`, miroir daysPerWeek 3 (R-SYN-28 : le serveur fait foi),
//   aucune requête `…/consents/health/replay-withdraw` (T26), pending-counter '0', outbox vide, aucune réponse 401 ni 410,
//   un pull sans since (pull complet)
// (renvoi J couvert par T27 : sync_rejection, seule table J, est exclue)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test ops/` → `Failed to resolve import "../../src/ops/snapshot"`, puis `Commande inconnue : snapshot` ; `pnpm --filter @appsport/web test:e2e epoch` → `snap.code` vaut 1.

- [ ] **Step 3: Implement**

`takeSnapshot` : `<dataDir>/snapshots` créé, `<final>.partial` supprimé, `backup(sqlite, partial, { rate: 0x7fffffff })` de `node:sqlite` (une seule étape), `PRAGMA journal_mode=DELETE` sur la copie, `renameSync(partial, final)`. `pruneSnapshots(dataDir, now, { keep = 3, maxAgeDays = 30 })` : supprime d'abord tout `daily-*.db`, `pre-*.db` et dossier `replaced-*` dont le `mtime` a plus de `maxAgeDays` jours (03 §7), puis garde les `keep` plus récents de chaque préfixe (tri `mtimeMs` puis nom décroissants). Ordre imposé de `restoreSnapshot` (Review Focus 4) :
```ts
// 1. existsSync(snapshotPath) sinon RestoreError('snapshot_missing')
// 2. PRAGMA integrity_check sur l'instantané ouvert en lecture seule ; exception ou résultat ≠ [{ integrity_check: 'ok' }] → RestoreError('integrity_failed')
// 3. copie vers <dataDir>/appsport.db.restoring
// 4. openDatabase(.restoring), rotateServerEpoch(db, { ids, clock }), PRAGMA journal_mode=DELETE, fermeture ; erreur → .restoring supprimé, erreur relancée
// 5. appsport.db, -wal et -shm présents → déplacés dans <dataDir>/snapshots/replaced-<AAAAMMJJTHHMMSSZ de clock>/ (replacedDir, sinon null)
// 6. renommage .restoring → appsport.db
```
`restore` : `cryptoIds()`, `systemClock`, `path.resolve` ; `snapshot` : `systemClock`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test ops/` → `Test Files  4 passed` ; `pnpm --filter @appsport/web test:e2e epoch` → `2 passed`.

- [ ] **Step 5: Commit**

`git commit -m "feat(ops): instantanés, restauration avec nouvelle époque et E2E d'époque"`

---

