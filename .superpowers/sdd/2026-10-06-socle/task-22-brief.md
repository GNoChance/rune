### Task 22: Époque du serveur, restore_upsert et purge des tombstones

**Files:**
- Create: `apps/server/src/sync/{epoch.ts, restore-upsert.ts, purge.ts}`
- Modify: `apps/server/src/sync/push.ts` (`restore_upsert` → `applyRestoreUpsert`, `deletedAt` admis en plus de `clientWritable`), `apps/server/src/jobs/registry.ts` (`syncPurgeJob`)
- Test: `apps/server/test/sync/{epoch,restore-upsert,purge}.test.ts`

**Interfaces:**
- Consumes : T20, T21 ; T4a (`getServerMeta`, `writeStamp`) ; T4b (`server_meta.epoch_started_at`) ; T6 (`IdGen`, `Clock`, `createApp`) ; T7 (`DailyJob`, `DAILY_JOBS`).
- Produces : Interfaces partagées §5 (`epoch.ts`, `restore-upsert.ts`, `purge.ts`).

**Spec:** 01 R-SYN-23, R-SYN-25 à R-SYN-28, §5.2 (J) ; 09 §0.6 ; 03 §7 ; Review Focus 2 (serveur, trois branches).

- [ ] **Step 1: Write the failing test**

```ts
// epoch.test.ts — r = await rotateServerEpoch(ctx.deps.db, ctx.deps)
expect(r.epoch).not.toBe(before.serverEpoch); expect(isUuidV7(r.epoch)).toBe(true);
expect(after).toMatchObject({ serverEpoch: r.epoch, epochBaseRev: before.syncCounter, syncCounter: before.syncCounter, epochStartedAt: '2026-10-06T10:00:00.000Z' }); expect(r.baseRev).toBe(before.syncCounter);
expect((await createApp(ctx.deps).request('/api/health')).headers.get('X-Appsport-Epoch')).toBe(epoch);
// watermark de l'ancienne époque → 410 watermark_expired
// restore-upsert.test.ts (Review Focus 2, R-SYN-27) — ru(u, id, fields, serverRevSeen) = makeOp restore_upsert fixture_note
// absente → insérée (tombstone comprise : deleted_at '2026-09-01T00:00:00.000Z')
// présente, rev ≤ epoch_base_rev, serverRevSeen > rev → remplacée ('client'), nouveau rev > baseRev
// présente, rev ≤ epoch_base_rev, serverRevSeen ≤ rev ou null → laissée ('sauvegarde'), { status: 'applied', rev: r1 }
// présente et modifiée après la restauration (rev > epoch_base_rev) → laissée même avec serverRevSeen 1 000 000 :
expect(r.body.results[0]).toEqual({ opId: expect.any(String), status: 'applied', rev: rp }); // title 'apres-restauration'
// ligne vivante laissée ci-dessus, restore_upsert avec deletedAt → deleted_at posé, nouveau rev > rp
// sur sync_rejection → forbidden ; table C2 sans consentement → applied_partial dropped ; ligne d'un autre → forbidden
// purge.test.ts (horloge '2026-10-06T10:00:00.000Z')
// tombstone du 2026-07-07T10:00 → supprimée, du 2026-07-09T10:00 → gardée ; gym et place supprimées le 2026-01-01 → gardées ; tombstonePurgeRev = rev supprimé
// enfant et parent tous deux à 91 j → supprimés sans erreur de FK ; parent à 91 j avec un enfant vivant → parent gardé, les autres purgées ;
//   tombstone_purge_rev ne diminue jamais (1000 reste 1000)
// applied_op du 2025-10-05T10:00 → supprimée, du 2025-11-06T10:00 → gardée ; après purge, watermark `${epoch}:${oldRev - 1}` → 410
expect(DAILY_JOBS).toContain(syncPurgeJob);
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test sync/epoch sync/restore-upsert sync/purge` → modules introuvables ; `restore_upsert` → rejected validation.

- [ ] **Step 3: Implement**

- `rotateServerEpoch(db, { ids, clock })` : `UPDATE server_meta SET server_epoch = ?, epoch_base_rev = sync_counter, epoch_started_at = <clock.now() ISO> WHERE id = 1 RETURNING …`.
- `restore_upsert` suit les étapes 1 à 9 de la Task 20 et `beforeApply`, puis `applyRestoreUpsert` : absente → INSERT (`inserted`) ; `existing.rev <= epochBaseRev && serverRevSeen != null && serverRevSeen > existing.rev` → UPDATE de tous les champs fournis, `deletedAt` compris (`replaced`) ; sinon, `fields.deletedAt` non nul sur une ligne vivante → `deleted_at` du client + stamp (`replaced`, la suppression l'emporte) ; sinon `{ outcome: 'kept', rev: existing.rev }` sans écriture.
- `syncPurgeJob` (une transaction) : tables J/D/E avec `deleted_at`, hors `gym` et `place`, enfants avant parents (tri topologique par `PRAGMA foreign_key_list`) ; `DELETE … WHERE deleted_at < now − 90 j AND NOT EXISTS (ligne enfant qui la référence, pour chaque FK entrante) RETURNING rev` ; `tombstone_purge_rev = max(actuel, max des rev supprimés)` ; `applied_op` antérieures à `now − 12 mois calendaires` ; `logger.info('sync purge', { job: 'sync-purge', count })`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test sync` → `Test Files  9 passed`.

- [ ] **Step 5: Commit**

`git commit -m "feat(synchro): époque serveur, restore_upsert et purge des tombstones"`

---

