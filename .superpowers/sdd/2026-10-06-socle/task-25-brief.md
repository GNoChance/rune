### Task 25: Base locale Dexie et outbox

**Files:**
- Modify: `apps/web/package.json` (`dexie` 4.x, `zod` 4.x ; dev `fake-indexeddb` 6.x, `@appsport/server: workspace:*`)
- Create: `apps/web/src/local-db/{db.ts, meta.ts, wipe.ts, consent.ts}`, `apps/web/src/sync/{outbox.ts, protocol-converters.ts}`, `apps/web/test/support/local-db.ts` (importe `fake-indexeddb/auto` en tête), `apps/web/test/fixtures/local-db/v1/dump.json`
- Test: `apps/web/test/local-db/{db,wipe,frozen-v1}.test.ts`, `apps/web/test/sync/{outbox,protocol-converters}.test.ts`

**Interfaces:**
- Consumes : T5 (`entityRules`, `mirroredTables`, `camelToSnake`, `snakeToCamel`) ; T20 (`SyncOp`) ; T2 (`SYNC_PROTOCOL`) ; T10 (`MeResponse`) ; `SYNC_FIXTURE_RULES` (`@appsport/server/testing`).
- Produces : Interfaces partagées §5 (`local-db/*`, `sync/outbox.ts`, `sync/protocol-converters.ts`, support `FIXTURE_MIRRORS`, `createTestLocalDb`, `createFixtureLocalDb`, `loadFrozenLocalDb`, `dumpLocalDb`).

**Spec:** 01 R-SYN-9, R-SYN-11 à R-SYN-14, R-VER-4, R-VER-5 ; 03 P-CST-2, P-CST-3 étape 4, P-AUT-6 ; 09 §7 ; 01 §9.1.4 ; Review Focus 3 (client).

- [ ] **Step 1: Write the failing test**

`dump.json` (figé, jamais modifié une fois commité) : `localDbVersion: 1`, `protocol: 1`, `stores` = copie de `STORE_SCHEMAS` v1 ; `meta` (`deviceId`, `userId` `0199b9a0-0000-7000-8000-0000000000aa`, `watermark` `0199b9a0-0000-7000-8000-0000000000e1:42`, `serverEpoch`, `protocol`) ; deux ops `patch` `sync_rejection` `{ dismissedAt }` (opId `…000001` attempts 2, `…000002` attempts 0) ; une ligne `sync_rejection` (rev 41, `detailJson` objet) et une ligne `training_profile` (rev 40, `cautiousMode: false`), chacune avec `serverRevSeen`.
```ts
// db.test.ts
expect(Object.keys(STORE_SCHEMAS).filter((s) => !NON_MIRROR_STORES.includes(s)).sort()).toEqual(mirroredTables(entityRules));
// chaque champ indexé d'un miroir est une colonne du registre (camelCase) ; createAppDb() → name 'appsport', verno LOCAL_DB_VERSION ;
// mirror('nope') lève ; setMeta/getMeta aller-retour, clé absente → undefined
// outbox.test.ts — createFixtureLocalDb(), ctx = { userId: 'u1', now: () => '2026-10-06T10:00:00.000Z', newOpId, healthConsentActive: true, rules: SYNC_FIXTURE_RULES }
expect(await db.mirror('fixture_note').get('n1')).toEqual({ id: 'n1', ownerId: 'u1', title: 't', serverRevSeen: null, deletedAt: null, updatedAt: '2026-10-06T10:00:00.000Z' });
expect(await db.outbox.get(op.opId)).toEqual({ ...op, userId: 'u1', protocol: 1, attempts: 0, clientTs: '2026-10-06T10:00:00.000Z' });
// opId en double → ni ligne ni op (transaction) ; opId 'pas-un-uuid' → exception, rien d'écrit ; champ hors clientWritable ou entité non J → exception
// sans consentement : item { painNote: 'TEMOIN', reason: 'pain' } → op.fields { noteId: 'n1', label: 'x' }, ligne sans ces clés ; 'fatigue' gardé ; fixture_c2_log → HealthConsentRequiredError, rien d'écrit
// patch fusionne, delete pose deletedAt ; les deux posent updatedAt = now ; pendingCount par userId (2 ops u1, 1 op u2 → 2 et 1)
// wipe.test.ts
// wipeUserData({ keepOutbox: true }) : miroirs et USER_META_KEYS vidés ; outbox, deadletter, deviceId et catalogue gardés ; keepOutbox false → outbox et deadletter vidés aussi
// clearMirrors : miroirs seuls ; localHealthConsentActive : aucun → false, grant → true, grant puis withdraw → false
// purgeHealthData (Review Focus 3) : miroirs health_screening, limitation (note W), fixture_c2_log (W), fixture_note_item (painNote W, reason 'pain' → null aussi) ;
//   outbox : create fixture_c2_log { value: W }, patch item { painNote: W, label: 'x' }, patch item { painNote: W } ; deadletter fixture_c2_log (detail W)
expect(await purgeHealthData(db, SYNC_FIXTURE_RULES)).toEqual({ rowsCleared: 4, opsRemoved: 2, opsStripped: 1 });
expect(await dumpLocalDb(db)).not.toContain(W); expect((await db.outbox.toArray()).map((o) => o.fields)).toEqual([{ label: 'x' }]);
// frozen-v1.test.ts (R-VER-5) : loadFrozenLocalDb(1) puis createAppDb → verno LOCAL_DB_VERSION ; outbox = dump.outbox.map(convertOutboxOp) ;
//   miroirs identiques au dump ; getMeta watermark '0199b9a0-0000-7000-8000-0000000000e1:42'
// protocol-converters.test.ts : OUTBOX_CONVERTERS[p] défini pour 1 ≤ p < SYNC_PROTOCOL ; convertOutboxOp(op v1).protocol === SYNC_PROTOCOL ;
//   cible 3 sans maillon → throw /v2/
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test local-db sync/outbox sync/protocol-converters` → modules introuvables.

- [ ] **Step 3: Implement**

- `AppDb` : `version(LOCAL_DB_VERSION).stores({ ...STORE_SCHEMAS, ...extraMirrors })` ; les versions suivantes convertiront l'outbox par `.upgrade()` et `convertOutboxOp`.
- `writeLocal` : erreurs `entity_not_journal`, `field_not_writable:<clé>`, `HealthConsentRequiredError` (table C2 sans consentement), champs C2 (Task 20, camelCase) retirés sans consentement ; `SyncOp.parse` ; une transaction `rw` sur l'outbox et le miroir (create → `put` avec `ownerId`, `serverRevSeen: null`, `deletedAt: null`, `updatedAt` ; patch → fusion et `updatedAt`, ligne absente → `row_missing` ; delete → `deletedAt` et `updatedAt`).
- `purgeHealthData` (une transaction) : miroirs C2 vidés, champs C2 à null ailleurs ; ops sur une table C2 supprimées, clés C2 retirées des autres (un `patch` vidé est supprimé) ; deadletter des tables C2 supprimée ; `rowsCleared` = lignes supprimées + lignes mises à null.
- `localHealthConsentActive` : dernier `consent_event` `health` par l'index `[type+createdAt]`, `action === 'grant'`.
- `convertOutboxOp` : maillon absent → `outbox converter missing: v<p> → v<p+1>`.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  5 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(synchro): base locale Dexie, outbox transactionnelle et jeu figé v1"`

---

