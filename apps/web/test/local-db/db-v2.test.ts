import { afterEach, describe, expect, it } from 'vitest';
import {
  type AppDb,
  createAppDb,
  LOCAL_DB_VERSION,
  STORE_SCHEMAS,
  STORE_SCHEMAS_BY_VERSION,
} from '../../src/local-db/db';
import { getMeta } from '../../src/local-db/meta';
import { createSyncEngine } from '../../src/sync/engine';
import { convertOutboxOp } from '../../src/sync/protocol-converters';
import { createFakeSyncServer } from '../support/fake-sync-server';
import { createTestLocalDb, loadFrozenLocalDb, readFrozenDump } from '../support/local-db';

/** Les 7 magasins de la brique 3 (spec §5.4), absents de la version 1. */
const PROGRAM_STORES = [
  'engine_decision',
  'instance_change',
  'performed_exercise',
  'performed_set',
  'program_instance',
  'slot_state',
  'workout_session',
];

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

describe('base locale v2 (spec brique 3 §5.4)', () => {
  it('version 2 : les magasins de la v1, plus les 7 de la brique 3', () => {
    expect(LOCAL_DB_VERSION).toBe(2);
    expect(STORE_SCHEMAS).toBe(STORE_SCHEMAS_BY_VERSION[2]);
    const v1 = STORE_SCHEMAS_BY_VERSION[1] ?? {};
    for (const [store, schema] of Object.entries(v1)) expect(STORE_SCHEMAS[store], store).toBe(schema);
    expect(
      Object.keys(STORE_SCHEMAS)
        .filter((s) => !(s in v1))
        .sort(),
    ).toEqual(PROGRAM_STORES);
  });

  it('le jeu figé v1 passe en v2 : outbox, deadletter, miroir et meta relus, nouveaux magasins vides', async () => {
    const name = `frozen-v1-to-v2-${crypto.randomUUID()}`;
    await loadFrozenLocalDb(1, name);
    const dump = await readFrozenDump(1);
    const db = createAppDb(name);
    opened.push(db);
    await db.open();

    expect(db.verno).toBe(2);
    expect(await db.outbox.toArray()).toEqual(dump.outbox.map((op) => convertOutboxOp(op)));
    expect(await db.deadletter.toArray()).toEqual(dump.deadletter);
    for (const [store, rows] of Object.entries(dump.mirrors)) {
      expect(await db.mirror(store).toArray(), store).toEqual(rows);
    }
    for (const [key, value] of Object.entries(dump.meta)) {
      if (key === 'watermark') continue;
      expect(await getMeta(db, key as 'deviceId'), key).toEqual(value);
    }
    for (const store of PROGRAM_STORES) {
      expect(db.mirrorNames, store).toContain(store);
      expect(await db.mirror(store).count(), store).toBe(0);
    }
  });

  it('montée v1 → v2 : watermark effacé, le premier pull après la mise à jour est complet (ruling R50)', async () => {
    // Un client brique 2 a tiré puis jeté les lignes des entités qu'il ne connaissait pas, en avançant son watermark.
    const name = `frozen-v1-pull-${crypto.randomUUID()}`;
    await loadFrozenLocalDb(1, name);
    const dump = await readFrozenDump(1);
    expect(dump.meta.watermark).toEqual(expect.any(String));
    const db = createAppDb(name);
    opened.push(db);
    await db.open();
    expect(await getMeta(db, 'watermark')).toBeUndefined();

    const server = createFakeSyncServer(String(dump.meta.serverEpoch));
    server.rows = [
      {
        entity: 'workout_session',
        rev: 7,
        row: { id: 'ws-1', ownerId: dump.meta.userId, rev: 7, status: 'completed', deletedAt: null },
      },
    ];
    const engine = createSyncEngine({ db, transport: server, triggers: () => () => {} });
    await engine.syncNow('manual');
    engine.stop();

    const pulls = server.log.filter((r) => r.path === '/api/sync/pull');
    expect(pulls.length).toBeGreaterThan(0);
    expect(pulls[0]?.query.has('since')).toBe(false);
    expect(await db.mirror('workout_session').get('ws-1')).toMatchObject({ status: 'completed' });
  });

  it("index `provisional` des copies D : une copie provisoire s'y trouve, une ligne du serveur non", async () => {
    const db = createTestLocalDb();
    opened.push(db);
    const base = { ownerId: 'u-1', instanceId: 'i-1', deletedAt: null };
    await db.mirror('slot_state').bulkPut([
      { ...base, id: 'i-1:A1:goblet-squat', serverRevSeen: null, provisional: 1 },
      { ...base, id: 'i-1:A2:push-up', serverRevSeen: 12 },
    ]);
    await db.mirror('engine_decision').put({ ...base, id: 'pe-1', serverRevSeen: null, provisional: 1 });

    expect(await db.mirror('slot_state').where('provisional').equals(1).primaryKeys()).toEqual([
      'i-1:A1:goblet-squat',
    ]);
    expect(await db.mirror('engine_decision').where('provisional').equals(1).primaryKeys()).toEqual(['pe-1']);
    expect(await db.mirror('slot_state').where('instanceId').equals('i-1').count()).toBe(2);
  });

  it('séries et exercices retrouvés par leur parent (index sessionId, performedExerciseId)', async () => {
    const db = createTestLocalDb();
    opened.push(db);
    await db.mirror('performed_exercise').bulkPut([
      { id: 'pe-1', sessionId: 's-1', serverRevSeen: null, deletedAt: null },
      { id: 'pe-2', sessionId: 's-2', serverRevSeen: null, deletedAt: null },
    ]);
    await db.mirror('performed_set').bulkPut([
      { id: 'set-1', performedExerciseId: 'pe-1', serverRevSeen: null, deletedAt: null },
      { id: 'set-2', performedExerciseId: 'pe-2', serverRevSeen: null, deletedAt: null },
    ]);
    expect(await db.mirror('performed_exercise').where('sessionId').equals('s-1').primaryKeys()).toEqual([
      'pe-1',
    ]);
    expect(
      await db.mirror('performed_set').where('performedExerciseId').anyOf(['pe-2']).primaryKeys(),
    ).toEqual(['set-2']);
  });
});
