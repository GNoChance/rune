// @vitest-environment node
import type { NutritionMode } from '@rune/contracts';
import { createMonotonicUuidV7 } from '@rune/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { getMeta, setMeta } from '../../src/local-db/meta';
import { localNutritionMode } from '../../src/local-db/nutrition';
import { createSyncEngine, type SyncEngine } from '../../src/sync/engine';
import { writeLocal } from '../../src/sync/outbox';
import { createFakeSyncServer, type FakeSyncServer } from '../support/fake-sync-server';
import { createTestLocalDb } from '../support/local-db';
import { until } from '../support/wait';

const NOW_MS = Date.parse('2026-10-06T12:00:00.000Z');
const NOW_ISO = new Date(NOW_MS).toISOString();
const newId = createMonotonicUuidV7(
  () => NOW_MS,
  (n) => crypto.getRandomValues(new Uint8Array(n)),
);

let db: AppDb;
let server: FakeSyncServer;
let engine: SyncEngine;
/** Mode que le faux serveur annonce dans ses pulls. */
let pulledMode: NutritionMode;

const base = { ownerId: 'u1', serverRevSeen: 1, deletedAt: null, updatedAt: NOW_ISO };

async function seedCopies(): Promise<void> {
  await db.mirror('weigh_in').put({ id: 'w1', ...base, date: '2026-10-01', weightG: 70000 });
  await db.mirror('nutrition_target').put({ id: 't1', ...base, validFrom: '2026-10-01', kcalTarget: 2200 });
  await db
    .mirror('nutrition_checkin')
    .put({ id: 'c1', ...base, weekStart: '2026-09-28', decision: 'in_band' });
  await db.mirror('nutrition_profile').put({
    id: 'u1',
    ...base,
    mode: 'full',
    modeReason: 'safety',
    safetyScreenVersion: 1,
    safetyScreenAt: NOW_ISO,
    safetyPause: false,
    sexForCalc: 'male',
    heightCm: 180,
    activityLevel: 2,
    goal: 'lose',
    cumulativeAdjustmentKcal: 100,
  });
  await db.table('nutritionSheets').put({ id: 'sleep' });
}

function makeEngine(): SyncEngine {
  engine = createSyncEngine({
    db,
    transport: server,
    now: () => NOW_MS,
    newOpId: newId,
    triggers: () => () => {},
  });
  return engine;
}

const idle = () => until(() => !engine.getState().syncing);
async function cycle(): Promise<void> {
  await makeEngine().syncNow('manual');
  await idle();
}
const count = (path: string) => server.paths().filter((p) => p === path).length;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  db = createTestLocalDb();
  server = createFakeSyncServer('E1');
  pulledMode = 'full';
  await setMeta(db, 'userId', 'u1');
  await setMeta(db, 'serverEpoch', 'E1');
  await setMeta(db, 'watermark', 'E1:1');
  server.on('GET /api/sync/pull', () =>
    server.json(200, {
      rows: [],
      nextWatermark: 'E1:2',
      hasMore: false,
      catalogVersion: null,
      nutrition: { effective_mode: pulledMode, cause: 'stored' },
    }),
  );
  server.on('GET /api/nutrition/rows', () =>
    server.json(200, {
      weigh_in: [
        {
          entity: 'weigh_in',
          rev: 9,
          row: { id: 'w9', ownerId: 'u1', date: '2026-10-02', weightG: 71000, deletedAt: null },
        },
      ],
      nutrition_target: [],
      nutrition_checkin: [],
    }),
  );
});
afterEach(async () => {
  engine?.stop();
  vi.useRealTimers();
  await db.delete();
});

describe('purge sur un pull dont le mode effectif n’est pas full (spec §6.4)', () => {
  it('qualitative : trois magasins, colonnes C2 du profil et fiches vidés', async () => {
    await seedCopies();
    pulledMode = 'qualitative';
    await cycle();
    expect(await db.mirror('weigh_in').count()).toBe(0);
    expect(await db.mirror('nutrition_target').count()).toBe(0);
    expect(await db.mirror('nutrition_checkin').count()).toBe(0);
    expect(await db.table('nutritionSheets').count()).toBe(0);
    expect(await db.mirror('nutrition_profile').get('u1')).toMatchObject({
      mode: 'full',
      modeReason: null,
      safetyScreenVersion: null,
      safetyScreenAt: null,
      safetyPause: null,
      sexForCalc: null,
      heightCm: null,
      activityLevel: null,
      goal: null,
      cumulativeAdjustmentKcal: null,
    });
    expect(count('GET /api/nutrition/rows')).toBe(0);
  });

  it('un pull full qui suit un autre mode charge l’instantané une fois et remplace les copies', async () => {
    await seedCopies();
    pulledMode = 'qualitative';
    await cycle();
    pulledMode = 'full';
    await cycle();
    expect(count('GET /api/nutrition/rows')).toBe(1);
    expect((await db.mirror('weigh_in').toArray()).map((r) => r.id)).toEqual(['w9']);
    expect(await getMeta(db, 'nutritionEffectiveMode')).toBe('full');
    await cycle();
    expect(count('GET /api/nutrition/rows')).toBe(1);
  });

  it('instantané en échec : le mode lu reste celui d’avant, le cycle suivant le recharge', async () => {
    pulledMode = 'qualitative';
    await cycle();
    pulledMode = 'full';
    server.on('GET /api/nutrition/rows', () => server.json(503, { error: 'internal' }));
    await cycle();
    expect(await getMeta(db, 'nutritionEffectiveMode')).toBe('qualitative');
    server.on('GET /api/nutrition/rows', undefined);
    server.on('GET /api/nutrition/rows', () =>
      server.json(200, { weigh_in: [], nutrition_target: [], nutrition_checkin: [] }),
    );
    await cycle();
    expect(await getMeta(db, 'nutritionEffectiveMode')).toBe('full');
  });
});

describe('intention de descente (spec §6.4 bis)', () => {
  const bodies = (): unknown[] =>
    server.log.filter((r) => r.path === '/api/nutrition/mode').map((r) => r.body);

  it('PUT /mode part avant le pull ; l’intention s’efface sur 200', async () => {
    await setMeta(db, 'nutritionPendingMode', { mode: 'qualitative', at: NOW_ISO });
    server.on('PUT /api/nutrition/mode', () => server.json(200, {}));
    pulledMode = 'qualitative';
    await cycle();
    const paths = server.paths();
    expect(paths.indexOf('PUT /api/nutrition/mode')).toBeGreaterThan(-1);
    expect(paths.indexOf('PUT /api/nutrition/mode')).toBeLessThan(paths.indexOf('GET /api/sync/pull'));
    expect(bodies()).toEqual([{ mode: 'qualitative' }]);
    expect(await getMeta(db, 'nutritionPendingMode')).toBeUndefined();
  });

  it('s’efface sur une réponse 4xx', async () => {
    await setMeta(db, 'nutritionPendingMode', { mode: 'qualitative', at: NOW_ISO });
    server.on('PUT /api/nutrition/mode', () => server.json(422, { error: 'validation' }));
    await cycle();
    expect(await getMeta(db, 'nutritionPendingMode')).toBeUndefined();
  });

  it('reste sur 503 et sur une erreur réseau', async () => {
    await setMeta(db, 'nutritionPendingMode', { mode: 'qualitative', at: NOW_ISO });
    server.on('PUT /api/nutrition/mode', () => server.json(503, { error: 'internal' }));
    await cycle();
    expect(await getMeta(db, 'nutritionPendingMode')).toMatchObject({ mode: 'qualitative' });
    server.on('PUT /api/nutrition/mode', () => {
      throw new TypeError('Failed to fetch');
    });
    await cycle();
    expect(await getMeta(db, 'nutritionPendingMode')).toMatchObject({ mode: 'qualitative' });
  });

  it('une session perdue (401 unauthenticated) ne l’efface pas', async () => {
    await setMeta(db, 'nutritionPendingMode', { mode: 'disabled', at: NOW_ISO });
    server.on('PUT /api/nutrition/mode', () => server.json(401, { error: 'unauthenticated' }));
    await cycle();
    expect(await getMeta(db, 'nutritionPendingMode')).toMatchObject({ mode: 'disabled' });
  });

  it('s’efface quand le pull montre un mode au moins aussi restrictif', async () => {
    await setMeta(db, 'nutritionPendingMode', { mode: 'qualitative', at: NOW_ISO });
    pulledMode = 'disabled';
    makeEngine();
    await engine.pullNow();
    await idle();
    expect(await getMeta(db, 'nutritionPendingMode')).toBeUndefined();
  });

  it('localNutritionMode : le plus strict entre l’intention et le dernier mode lu', async () => {
    expect(await localNutritionMode(db)).toBe('disabled');
    await setMeta(db, 'nutritionEffectiveMode', 'full');
    expect(await localNutritionMode(db)).toBe('full');
    await setMeta(db, 'nutritionPendingMode', { mode: 'qualitative', at: NOW_ISO });
    expect(await localNutritionMode(db)).toBe('qualitative');
    await setMeta(db, 'nutritionEffectiveMode', 'disabled');
    expect(await localNutritionMode(db)).toBe('disabled');
  });

  it('une descente demandée pendant un pull full : copies purgées, pas d’instantané', async () => {
    await seedCopies();
    await setMeta(db, 'nutritionEffectiveMode', 'full');
    // La personne descend pendant que le pull est en vol : le serveur répond encore full.
    server.on('GET /api/sync/pull', async () => {
      await setMeta(db, 'nutritionPendingMode', { mode: 'qualitative', at: NOW_ISO });
      return server.json(200, {
        rows: [],
        nextWatermark: 'E1:2',
        hasMore: false,
        catalogVersion: null,
        nutrition: { effective_mode: 'full', cause: 'stored' },
      });
    });
    makeEngine();
    await engine.pullNow();
    await idle();
    expect(await db.mirror('weigh_in').count()).toBe(0);
    expect(count('GET /api/nutrition/rows')).toBe(0);
    expect(await localNutritionMode(db)).toBe('qualitative');
  });
});

describe('pesée rejetée', () => {
  it('forbidden : la pesée rejetée ne laisse aucun poids sur l’appareil', async () => {
    pulledMode = 'qualitative';
    await writeLocal(
      db,
      { entity: 'weigh_in', id: 'w1', kind: 'create', fields: { date: '2026-10-05', weightG: 70000 } },
      { userId: 'u1', now: () => NOW_ISO, newOpId: newId, healthConsentActive: true },
    );
    server.on('POST /api/sync/push', (req) =>
      server.json(200, {
        results: (req.body.ops as { opId: string }[]).map((o) => ({
          opId: o.opId,
          status: 'rejected',
          code: 'forbidden',
        })),
      }),
    );
    await cycle();
    // Le pull qualitative a purgé : ni le poids dans la deadletter, ni rejet à montrer.
    expect(await db.deadletter.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.mirror('weigh_in').count()).toBe(0);
  });
});
