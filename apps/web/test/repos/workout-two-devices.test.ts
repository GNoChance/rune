// @vitest-environment node
import { createMonotonicUuidV7 } from '@rune/domain';
import {
  createTestContext,
  createUserAndLogin,
  enroll,
  login,
  seedSheet,
  sheetFixture,
  type TestContext,
  templateFixture,
} from '@rune/server/testing';
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
import { LUNGE, PLAN } from '../support/workout';

const IP = '100.64.0.2';
const HOUR = 3_600_000;
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
const databases = new Set<AppDb>();

afterEach(async () => {
  for (const d of devices.splice(0)) d.engine.stop();
  for (const db of databases) await db.delete();
  databases.clear();
  ctx?.close();
  ctx = undefined;
});

/** Vrai serveur en mémoire, contrôles des séances compris (`SYNC_HOOKS`), avec les fiches du plan publiées. */
async function server(): Promise<TestContext> {
  ctx = await createTestContext();
  for (const id of ['back-squat', 'dumbbell-lunge']) await seedSheet(ctx, sheetFixture(id));
  return ctx;
}

/**
 * Un appareil : sa base, son moteur, ses dépôts. `db` donné : la même base rouverte (appli relancée), avec un moteur
 * neuf. Les dépôts demandent la synchro à un faux moteur (le test la lance lui-même, appareil par appareil) mais lisent
 * l'état du vrai (`pulledThisRun`).
 */
async function device(
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
  d.repos = createRepos(services);
  devices.push(d);
  return d;
}

/** Séance telle que la montrent les deux appareils, sans ce qui dépend de l'appareil qui la lit. */
const shared = ({ heldHere: _heldHere, ...rest }: WorkoutSessionView) => rest;

const START = {
  plan: PLAN,
  placeId: null,
  instanceId: null,
  workoutId: 'A',
  profile: 'adult',
  templateVersion: null,
} as const;

const liveSets = (c: TestContext) =>
  c.deps.sqlite
    .prepare('SELECT id, load_g, reps FROM performed_set WHERE deleted_at IS NULL ORDER BY id')
    .all();

/** Séries faites vivantes du serveur : [id, charge, répétitions]. */
const loggedSets = (c: TestContext) =>
  c.deps.sqlite
    .prepare(
      'SELECT id, load_g, reps FROM performed_set WHERE deleted_at IS NULL AND logged_at IS NOT NULL ORDER BY id',
    )
    .all()
    .map((r) => [r.id, r.load_g, r.reps]);

const sessionRow = (c: TestContext, id: string) =>
  c.deps.sqlite.prepare('SELECT status, ended_at FROM workout_session WHERE id = ?').get(id);

/** Exercices de la séance qui portent une décision vivante du moteur (rejeu du serveur). */
const decidedExercises = (c: TestContext, sessionId: string) =>
  c.deps.sqlite
    .prepare(
      `SELECT d.id FROM engine_decision d JOIN performed_exercise e ON e.id = d.id
       WHERE e.session_id = ? AND d.deleted_at IS NULL ORDER BY d.id`,
    )
    .all(sessionId)
    .map((r) => r.id);

/** Instance active dont le modèle porte les slots du plan (A1 squat, A2 fente). */
const enrolled = (c: TestContext, userId: string) =>
  enroll(
    c,
    userId,
    templateFixture('two-devices', [{ exercises: ['back-squat'] }, { exercises: ['dumbbell-lunge'] }]),
  );

/** Deux premières séries de travail du squat. */
const squatWorkSets = (view: WorkoutSessionView | null) => {
  const [first, second] = view?.exercises[0]?.sets.filter((s) => s.kind === 'work') ?? [];
  if (!first || !second) throw new Error('séries absentes');
  return [first, second] as const;
};

const nowIso = (c: TestContext) => c.clock.now().toISOString();

describe('même séance sur deux appareils (Review Focus 3)', () => {
  it('« Continuer ici » puis le premier continue hors ligne : aucune série en double, dernière écriture gagnante, lecture seule après le pull', async () => {
    const c = await server();
    const user = await createUserAndLogin(c);
    const a = await device(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await device(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });

    const id = await a.repos.workouts.start(START);
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
    expect(liveSets(c)).toHaveLength(8);
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
    expect(liveSets(c)).toHaveLength(2);
  });

  it('A rouvre l’appli hors ligne après que B a repris, saisi et terminé : aucune clôture avant un pull, rien de B supprimé (R33)', async () => {
    const c = await server();
    const user = await createUserAndLogin(c);
    const a = await device(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await device(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });

    const id = await a.repos.workouts.start(START);
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');
    await b.repos.workouts.continueHere(id);
    const sets =
      (await b.repos.workouts.session(id))?.exercises[0]?.sets.filter((s) => s.kind === 'work') ?? [];
    c.clock.advance(10 * 60_000);
    for (const set of sets.slice(0, 2)) await b.repos.workouts.logSet(set.id, { loadG: 60_000, reps: 6 });
    expect(await b.repos.workouts.finish(id)).toBe('completed');
    await b.engine.syncNow('manual');
    const fromB = liveSets(c);
    expect(fromB).toHaveLength(2);

    // 7 h plus tard, A relance l'appli sans réseau : son miroir date d'avant « Continuer ici ».
    a.engine.stop();
    c.clock.advance(7 * HOUR);
    const a2 = await device(c, user.id, user.cookie, { db: a.db, offline: true });
    await a2.engine.syncNow('manual');
    expect(await a2.repos.workouts.session(id)).toMatchObject({
      status: 'in_progress',
      deviceId: 'dev-A',
      heldHere: true,
    });
    expect(await a2.repos.workouts.closeStale(c.clock.now().getTime())).toEqual([]);
    expect(await a2.db.outbox.count()).toBe(0);
    expect((await a2.repos.workouts.session(id))?.status).toBe('in_progress');

    // Le réseau revient : le pull apporte la fin de B, il n'y a plus rien à clore.
    a2.offline = false;
    await a2.engine.syncNow('manual');
    expect(a2.engine.getState().pulledThisRun).toBe(true);
    expect((await a2.repos.workouts.session(id))?.status).toBe('completed');
    expect(await a2.repos.workouts.closeStale(c.clock.now().getTime())).toEqual([]);
    expect(await a2.db.outbox.count()).toBe(0);
    expect(c.deps.sqlite.prepare('SELECT status FROM workout_session WHERE id = ?').get(id)).toEqual({
      status: 'completed',
    });
    expect(liveSets(c)).toEqual(fromB);
  });
});

describe('clôture depuis un miroir en retard sur l’autre appareil (rulings R49, R51)', () => {
  it('« La terminer » sur l’appareil en ligne pendant que celui qui tient la séance saisit hors ligne : aucune série perdue, séance terminée, dans l’historique et rejouée', async () => {
    const c = await server();
    const user = await createUserAndLogin(c);
    const instanceId = await enrolled(c, user.id);
    const a = await device(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await device(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });

    const id = await a.repos.workouts.start({ ...START, instanceId });
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    // A perd le réseau en salle et saisit une série.
    a.offline = true;
    const [first, second] = squatWorkSets(await a.repos.workouts.session(id));
    c.clock.advance(5 * 60_000);
    await a.repos.workouts.logSet(first.id, { loadG: 60_000, reps: 6 });

    // B, en ligne (un pull dans cette exécution), voit la séance de A sans série faite et la termine.
    expect(b.engine.getState().pulledThisRun).toBe(true);
    expect((await b.repos.workouts.otherDeviceSession())?.id).toBe(id);
    c.clock.advance(60_000);
    const closedByB = nowIso(c);
    expect(await b.repos.workouts.finish(id)).toBe('abandoned');
    await b.engine.syncNow('manual');
    expect(liveSets(c)).toHaveLength(8);

    // A, toujours hors ligne, saisit la série suivante, puis retrouve le réseau.
    c.clock.advance(2 * 60_000);
    const lastLogged = nowIso(c);
    await a.repos.workouts.logSet(second.id, { loadG: 60_000, reps: 5 });
    a.offline = false;
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    expect(loggedSets(c)).toEqual([
      [first.id, 60_000, 6],
      [second.id, 60_000, 5],
    ]);
    // D4 appliquée par le serveur : terminée, fin à la dernière série faite (plus tardive que la clôture de B).
    expect(closedByB < lastLogged).toBe(true);
    expect(sessionRow(c, id)).toEqual({ status: 'completed', ended_at: lastLogged });
    const squat = (await a.repos.workouts.session(id))?.exercises[0]?.id;
    expect(decidedExercises(c, id)).toContain(squat);
    for (const d of [a, b]) {
      const onDevice = await d.repos.workouts.session(id);
      expect(onDevice?.status).toBe('completed');
      expect(onDevice?.exercises[0]?.sets.map((s) => s.id)).toEqual([first.id, second.id]);
      expect((await d.repos.workouts.history()).map((s) => [s.id, s.status])).toEqual([[id, 'completed']]);
    }
  });

  it('A hors ligne, « Continuer ici » et deux séries sur B, puis A, qui croit tenir la séance, touche « Terminer » : les séries de B restent, séance terminée', async () => {
    const c = await server();
    const user = await createUserAndLogin(c);
    const instanceId = await enrolled(c, user.id);
    const a = await device(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await device(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });

    const id = await a.repos.workouts.start({ ...START, instanceId });
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    a.offline = true;
    await b.repos.workouts.continueHere(id);
    const [first, second] = squatWorkSets(await b.repos.workouts.session(id));
    c.clock.advance(10 * 60_000);
    await b.repos.workouts.logSet(first.id, { loadG: 62_500, reps: 6 });
    c.clock.advance(2 * 60_000);
    await b.repos.workouts.logSet(second.id, { loadG: 62_500, reps: 5 });
    await b.engine.syncNow('manual');

    // A n'a rien vu : son miroir date d'avant « Continuer ici », mais un pull a réussi dans cette exécution.
    expect(a.engine.getState().pulledThisRun).toBe(true);
    expect(await a.repos.workouts.session(id)).toMatchObject({ deviceId: 'dev-A', heldHere: true });
    c.clock.advance(60_000);
    const closedByA = nowIso(c);
    expect(await a.repos.workouts.finish(id)).toBe('abandoned');
    a.offline = false;
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    expect(loggedSets(c)).toEqual([
      [first.id, 62_500, 6],
      [second.id, 62_500, 5],
    ]);
    // Seules les séries jamais faites sont parties.
    expect(liveSets(c)).toHaveLength(2);
    expect(sessionRow(c, id)).toEqual({ status: 'completed', ended_at: closedByA });
    const squat = (await b.repos.workouts.session(id))?.exercises[0]?.id;
    expect(decidedExercises(c, id)).toContain(squat);
    const onA = await a.repos.workouts.session(id);
    const onB = await b.repos.workouts.session(id);
    if (!onA || !onB) throw new Error('séance absente');
    expect(shared(onA)).toEqual(shared(onB));
    expect(onA.status).toBe('completed');
    expect(onA.exercises[0]?.sets.map((s) => s.id)).toEqual([first.id, second.id]);
    for (const d of [a, b]) {
      expect((await d.repos.workouts.history()).map((s) => [s.id, s.status])).toEqual([[id, 'completed']]);
    }
  });

  it('« Supprimer la séance » reste le seul chemin qui supprime des séries faites : tout part, sur le serveur et sur les deux appareils', async () => {
    const c = await server();
    const user = await createUserAndLogin(c);
    const a = await device(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await device(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });
    const id = await a.repos.workouts.start(START);
    const [first, second] = squatWorkSets(await a.repos.workouts.session(id));
    c.clock.advance(10 * 60_000);
    await a.repos.workouts.logSet(first.id, { loadG: 60_000, reps: 6 });
    await a.repos.workouts.logSet(second.id, { loadG: 60_000, reps: 5 });
    await a.engine.syncNow('manual');
    expect(await a.repos.workouts.finish(id)).toBe('completed');
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');
    expect(loggedSets(c)).toHaveLength(2);

    // Depuis l'historique de B : les delete des séries faites précèdent celui de la séance dans l'outbox.
    await b.repos.workouts.remove(id);
    await b.engine.syncNow('manual');
    await a.engine.syncNow('manual');

    expect(liveSets(c)).toEqual([]);
    expect(c.deps.sqlite.prepare('SELECT deleted_at FROM workout_session WHERE id = ?').get(id)).not.toEqual({
      deleted_at: null,
    });
    for (const d of [a, b]) {
      expect(await d.repos.workouts.session(id)).toBeNull();
      expect(await d.repos.workouts.history()).toEqual([]);
      expect(await d.db.outbox.count()).toBe(0);
    }
  });
});

describe('« Changer de lieu » depuis un miroir en retard sur l’autre appareil', () => {
  it('« Continuer ici » et deux séries sur B, puis A, qui croit tenir la séance sans série faite, change de lieu : l’exercice des séries de B reste, visible sur les deux appareils et rejoué', async () => {
    const c = await server();
    const user = await createUserAndLogin(c);
    const instanceId = await enrolled(c, user.id);
    const a = await device(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await device(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });

    const id = await a.repos.workouts.start({ ...START, instanceId });
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    await b.repos.workouts.continueHere(id);
    const onB = await b.repos.workouts.session(id);
    const squat = onB?.exercises[0]?.id ?? '';
    const [first, second] = squatWorkSets(onB);
    c.clock.advance(10 * 60_000);
    await b.repos.workouts.logSet(first.id, { loadG: 62_500, reps: 6 });
    c.clock.advance(2 * 60_000);
    await b.repos.workouts.logSet(second.id, { loadG: 62_500, reps: 5 });
    await b.engine.syncNow('manual');

    // A n'a rien tiré depuis « Continuer ici » : il tient la séance et n'y voit aucune série faite. Le lieu importe
    // peu ici (aucun lieu enregistré) : c'est le plan refait qui supprime les exercices.
    expect(await a.repos.workouts.session(id)).toMatchObject({ deviceId: 'dev-A', heldHere: true });
    c.clock.advance(60_000);
    await a.repos.workouts.changePlace(id, { ...PLAN, exercises: [LUNGE] }, null);
    await a.engine.syncNow('manual');
    await b.engine.syncNow('manual');

    // Serveur : les séries de B restent sous un exercice vivant ; ses séries jamais faites sont parties.
    expect(loggedSets(c)).toEqual([
      [first.id, 62_500, 6],
      [second.id, 62_500, 5],
    ]);
    expect(
      c.deps.sqlite.prepare('SELECT deleted_at FROM performed_exercise WHERE id = ?').get(squat),
    ).toEqual({ deleted_at: null });
    const onA = await a.repos.workouts.session(id);
    const onB2 = await b.repos.workouts.session(id);
    if (!onA || !onB2) throw new Error('séance absente');
    expect(shared(onA)).toEqual(shared(onB2));
    expect(onA.heldHere).toBe(false);
    expect(onB2.exercises.find((e) => e.id === squat)?.sets.map((s) => [s.id, s.loggedAt !== null])).toEqual([
      [first.id, true],
      [second.id, true],
    ]);
    expect(onB2.exercises.some((e) => e.id !== squat && e.exerciseId === 'dumbbell-lunge')).toBe(true);

    // B termine : la séance compte, l'exercice des séries faites est rejoué et apparaît dans l'historique.
    expect(await b.repos.workouts.finish(id)).toBe('completed');
    await b.engine.syncNow('manual');
    await a.engine.syncNow('manual');
    expect(sessionRow(c, id)).toMatchObject({ status: 'completed' });
    expect(decidedExercises(c, id)).toContain(squat);
    for (const d of [a, b]) {
      expect((await d.repos.workouts.history()).map((s) => [s.id, s.status])).toEqual([[id, 'completed']]);
      const kept = (await d.repos.workouts.session(id))?.exercises.find((e) => e.id === squat);
      expect(kept?.sets.map((s) => s.id)).toEqual([first.id, second.id]);
      expect(await d.db.outbox.count()).toBe(0);
    }
  });
});
