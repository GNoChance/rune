// @vitest-environment node
import { createMonotonicUuidV7 } from '@rune/domain';
import { createTestContext, createUserAndLogin, login, type TestContext } from '@rune/server/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../../src/api/client';
import type { AppServices } from '../../src/app-services';
import { type AppDb, createAppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { createRepos, type Repos } from '../../src/repos';
import type { WorkoutSessionView } from '../../src/repos/workout-repo';
import { createSyncEngine, type SyncEngine } from '../../src/sync/engine';
import type { SyncTransport } from '../../src/sync/transport';
import { createFakeSyncEngine } from '../support/fake-api';
import { inProcessTransport } from '../support/in-process-transport';
import { PLAN } from '../support/workout';

const IP = '100.64.0.2';
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

interface Device {
  db: AppDb;
  engine: SyncEngine;
  repos: Repos;
  cookie: string;
  /** Réseau coupé : chaque requête échoue comme un `fetch` hors ligne. */
  offline: boolean;
}

let ctx: TestContext | undefined;
const devices: Device[] = [];

afterEach(async () => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    await d.db.delete();
  }
  ctx?.close();
  ctx = undefined;
});

/**
 * Vrai serveur en mémoire avec les règles génériques des tables J (création idempotente, dernière écriture
 * gagnante champ par champ, R-SYN-16) : les contrôles propres aux séances (`SYNC_HOOKS`, Task 12) lisent un
 * catalogue serveur, hors de ce scénario de synchro.
 */
async function server(): Promise<TestContext> {
  ctx = await createTestContext({ deps: { syncHooks: { sync_rejection: { allowedKinds: ['patch'] } } } });
  return ctx;
}

async function device(c: TestContext, userId: string, cookie: string, deviceId: string): Promise<Device> {
  const now = () => c.clock.now().getTime();
  const db = createAppDb(`two-devices-${deviceId}-${crypto.randomUUID()}`);
  await setMeta(db, 'userId', userId);
  await setMeta(db, 'deviceId', deviceId);
  const newOpId = createMonotonicUuidV7(now, randomBytes);
  const d = { db, cookie, offline: false } as Device;
  const inner = inProcessTransport(c, () => d.cookie);
  const transport: SyncTransport = {
    fetch: (path, init) =>
      d.offline ? Promise.reject(new TypeError('Failed to fetch')) : inner.fetch(path, init),
  };
  d.engine = createSyncEngine({ db, transport, now, newOpId, triggers: () => () => {} });
  // Les dépôts demandent la synchro au faux moteur : le test la lance lui-même, appareil par appareil.
  const services: AppServices = {
    db,
    api: createApiClient(transport, { onUnauthenticated: () => {}, onAccountDeleted: () => {} }),
    sync: createFakeSyncEngine(),
    transport,
    now,
    newOpId,
    swStatus: async () => null,
  };
  d.repos = createRepos(services);
  devices.push(d);
  return d;
}

/** Séance telle que la montrent les deux appareils, sans ce qui dépend de l'appareil qui la lit. */
const shared = ({ heldHere: _heldHere, ...rest }: WorkoutSessionView) => rest;

describe('même séance sur deux appareils (Review Focus 3)', () => {
  it('« Continuer ici » puis le premier continue hors ligne : aucune série en double, dernière écriture gagnante, lecture seule après le pull', async () => {
    const c = await server();
    const user = await createUserAndLogin(c);
    const a = await device(c, user.id, user.cookie, 'dev-A');
    const b = await device(c, user.id, await login(c, user.username, user.password, IP), 'dev-B');

    const id = await a.repos.workouts.start({
      plan: PLAN,
      placeId: null,
      instanceId: null,
      workoutId: 'A',
      profile: 'adult',
      templateVersion: null,
    });
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    // B voit la séance de A et la reprend.
    expect((await b.repos.workouts.otherDeviceSession())?.id).toBe(id);
    expect(await b.repos.workouts.activeSession()).toBeNull();
    a.offline = true;
    await b.repos.workouts.continueHere(id);
    const onB = await b.repos.workouts.session(id);
    const [squatSet1, squatSet2] = onB?.exercises[0]?.sets.filter((s) => s.kind === 'work') ?? [];
    if (!squatSet1 || !squatSet2) throw new Error('séries absentes');
    c.clock.advance(60_000);
    await b.repos.workouts.logSet(squatSet1.id, { loadG: 62_500, reps: 6 });
    await b.engine.syncNow('manual');

    // A, hors ligne, ne sait rien : il saisit la même série, puis la suivante.
    c.clock.advance(60_000);
    await a.repos.workouts.logSet(squatSet1.id, { loadG: 60_000, reps: 6 });
    await a.repos.workouts.logSet(squatSet2.id, { loadG: 60_000, reps: 5 });
    await a.engine.syncNow('manual');
    expect(a.engine.getState().connection).toBe('offline');

    a.offline = false;
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    // Une seule série par ligne prévue, sur le serveur comme sur chaque appareil.
    const serverSets = c.deps.sqlite.prepare('SELECT id FROM performed_set WHERE deleted_at IS NULL').all();
    expect(serverSets).toHaveLength(8);
    const onA = await a.repos.workouts.session(id);
    const onB2 = await b.repos.workouts.session(id);
    if (!onA || !onB2) throw new Error('séance absente');
    expect(onA.exercises.flatMap((e) => e.sets)).toHaveLength(8);
    expect(shared(onA)).toEqual(shared(onB2));
    // Arrivées au serveur : B (62,5 kg) puis A (60 kg) ; la dernière gagne, champ par champ.
    expect(
      onA.exercises[0]?.sets.filter((s) => s.loggedAt !== null).map((s) => [s.id, s.loadG, s.reps]),
    ).toEqual([
      [squatSet1.id, 60_000, 6],
      [squatSet2.id, 60_000, 5],
    ]);

    // A a perdu la séance : lecture seule, plus de séance en cours ici ; B la tient.
    expect(onA.deviceId).toBe('dev-B');
    expect(onA.heldHere).toBe(false);
    expect(await a.repos.workouts.activeSession()).toBeNull();
    expect((await a.repos.workouts.otherDeviceSession())?.id).toBe(id);
    expect(onB2.heldHere).toBe(true);
    expect((await b.repos.workouts.activeSession())?.id).toBe(id);

    // B la termine ; A la voit terminée au pull suivant.
    expect(await b.repos.workouts.finish(id)).toBe('completed');
    await b.engine.syncNow('manual');
    await a.engine.syncNow('manual');
    expect((await a.repos.workouts.session(id))?.status).toBe('completed');
    expect(await a.repos.workouts.otherDeviceSession()).toBeNull();
    expect(c.deps.sqlite.prepare('SELECT id FROM performed_set WHERE deleted_at IS NULL').all()).toHaveLength(
      2,
    );
  });
});
