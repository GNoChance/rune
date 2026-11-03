import { createMonotonicUuidV7 } from '@rune/domain';
import { createTestContext, seedSheet, sheetFixture, type TestContext } from '@rune/server/testing';
import { afterEach } from 'vitest';
import { createApiClient } from '../../src/api/client';
import type { AppServices } from '../../src/app-services';
import { type AppDb, createAppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { createRepos, type Repos } from '../../src/repos';
import { createSyncEngine, type SyncEngine } from '../../src/sync/engine';
import type { SyncTransport } from '../../src/sync/transport';
import { createFakeSyncEngine } from './fake-api';
import { inProcessTransport } from './in-process-transport';

/*
 * Plusieurs appareils d'un même membre face au vrai serveur en mémoire. Le ménage (moteurs arrêtés, bases Dexie
 * supprimées, serveur fermé) est fait ici, après chaque test du fichier qui importe ce module.
 */

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export interface Device {
  db: AppDb;
  engine: SyncEngine;
  repos: Repos;
  services: AppServices;
  cookie: string;
  /** Réseau coupé : chaque requête échoue comme un `fetch` hors ligne. */
  offline: boolean;
}

let ctx: TestContext | undefined;
const devices: Device[] = [];
const databases = new Set<AppDb>();

afterEach(async () => {
  for (const d of devices.splice(0)) d.engine.stop();
  for (const db of databases) await db.delete();
  databases.clear();
  ctx?.close();
  ctx = undefined;
});

/** Vrai serveur en mémoire, contrôles des séances compris (`SYNC_HOOKS`), avec les fiches `sheetIds` publiées. */
export async function startServerWith(sheetIds: readonly string[]): Promise<TestContext> {
  ctx = await createTestContext();
  for (const id of sheetIds) await seedSheet(ctx, sheetFixture(id));
  return ctx;
}

/**
 * Un appareil : sa base, son moteur, ses dépôts. `db` donné : la même base rouverte (appli relancée), avec un moteur
 * neuf. Les dépôts demandent la synchro à un faux moteur (le test la lance lui-même, appareil par appareil) mais lisent
 * l'état du vrai (`pulledThisRun`).
 */
export async function createDevice(
  c: TestContext,
  userId: string,
  cookie: string,
  o: { deviceId?: string; db?: AppDb; offline?: boolean } = {},
): Promise<Device> {
  const now = () => c.clock.now().getTime();
  const db = o.db ?? createAppDb(`two-devices-${o.deviceId}-${crypto.randomUUID()}`);
  databases.add(db);
  if (!o.db) {
    await setMeta(db, 'userId', userId);
    await setMeta(db, 'deviceId', o.deviceId ?? 'dev');
  }
  const newOpId = createMonotonicUuidV7(now, randomBytes);
  const d = { db, cookie, offline: o.offline ?? false } as Device;
  const inner = inProcessTransport(c, () => d.cookie);
  const transport: SyncTransport = {
    fetch: (path, init) =>
      d.offline ? Promise.reject(new TypeError('Failed to fetch')) : inner.fetch(path, init),
  };
  d.engine = createSyncEngine({ db, transport, now, newOpId, triggers: () => () => {} });
  const fake = createFakeSyncEngine();
  const services: AppServices = {
    db,
    api: createApiClient(transport, { onUnauthenticated: () => {}, onAccountDeleted: () => {} }),
    sync: { ...fake, getState: () => d.engine.getState(), subscribe: (fn) => d.engine.subscribe(fn) },
    transport,
    now,
    newOpId,
    swStatus: async () => null,
  };
  d.services = services;
  d.repos = createRepos(services);
  devices.push(d);
  return d;
}

/** Push puis pull de chaque appareil, deux tours : ce que l'un a poussé au second tour, tous l'ont reçu. */
export async function syncAll(...all: Device[]): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (const d of all) await d.engine.syncNow('manual');
  }
}
