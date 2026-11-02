import { defaultLoadSettings } from '@rune/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AppServices, ServicesProvider } from '../../src/app-services';
import { type AppDb, createAppDb, type MirrorRow } from '../../src/local-db/db';
import { getMeta, setMeta } from '../../src/local-db/meta';
import { createRepos, type Repos, reposFor } from '../../src/repos';
import {
  closeStaleAfterPull,
  type SetInput,
  useActiveSession,
  useHistory,
  useOtherDeviceSession,
  useSession,
  type WorkoutSessionView,
  type WorkoutSetView,
} from '../../src/repos/workout-repo';
import { createSyncEngine, type SyncEngine } from '../../src/sync/engine';
import { seedCatalog } from '../support/catalog';
import type { FakeSyncEngine } from '../support/fake-api';
import { createFakeSyncServer } from '../support/fake-sync-server';
import { dumpLocalDb } from '../support/local-db';
import { createTestServices, DEFAULT_NOW, makeMe } from '../support/render';
import { seedMirror } from '../support/seed';
import { until } from '../support/wait';
import { LUNGE, PLAN, PLAN_ROWS, seedHealthConsent, WORKOUT_SHEETS } from '../support/workout';
import { TEMPLATE } from '../workout/seed';

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const STORES = ['workout_session', 'performed_exercise', 'performed_set'] as const;

interface Setup {
  services: AppServices;
  sync: FakeSyncEngine;
  db: AppDb;
  repos: Repos;
  /** Horloge des services, réglable par le test. */
  clock: { now: number };
}

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function setup(opts: Parameters<typeof createTestServices>[0] = {}): Promise<Setup> {
  const t = await createTestServices(opts);
  opened.push(t.db);
  const clock = { now: DEFAULT_NOW };
  t.services.now = () => clock.now;
  await setMeta(t.db, 'deviceId', 'dev-A');
  await seedCatalog(t.db, WORKOUT_SHEETS);
  return { services: t.services, sync: t.sync, db: t.db, repos: reposFor(t.services), clock };
}

const START = {
  plan: PLAN,
  placeId: 'p-1',
  instanceId: 'i-1',
  workoutId: 'A',
  profile: 'adult',
  templateVersion: 3,
} as const;

async function view(r: Repos, id: string): Promise<WorkoutSessionView> {
  const v = await r.workouts.session(id);
  if (!v) throw new Error(`séance ${id} absente`);
  return v;
}

const exerciseAt = (v: WorkoutSessionView, i: number) => {
  const e = v.exercises[i];
  if (!e) throw new Error(`exercice ${i} absent`);
  return e;
};
const workSets = (v: WorkoutSessionView, i: number): WorkoutSetView[] =>
  exerciseAt(v, i).sets.filter((s) => s.kind === 'work');
const workSet = (v: WorkoutSessionView, i: number, n: number): WorkoutSetView => {
  const s = workSets(v, i)[n];
  if (!s) throw new Error(`série ${n} absente`);
  return s;
};

const rows = async (db: AppDb, store: string): Promise<MirrorRow[]> => db.mirror(store).toArray();
const ops = (db: AppDb) => db.outbox.orderBy('opId').toArray();

describe('workouts.start (D2)', () => {
  it('crée la séance, ses exercices et toutes les séries prévues : une op create par ligne, séance notée en cours', async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);

    const all = await ops(db);
    expect(all).toHaveLength(PLAN_ROWS);
    expect(all.every((o) => o.kind === 'create' && o.userId === 'u-1')).toBe(true);
    const mirrored = (
      await Promise.all(STORES.map(async (s) => (await rows(db, s)).map((r) => `${s}:${r.id}`)))
    )
      .flat()
      .sort();
    expect(all.map((o) => `${o.entity}:${o.id}`).sort()).toEqual(mirrored);
    expect(all.map((o) => o.entity)).toEqual([
      'workout_session',
      'performed_exercise',
      ...Array(4).fill('performed_set'),
      'performed_exercise',
      ...Array(4).fill('performed_set'),
    ]);
    expect(await getMeta(db, 'activeSessionId')).toBe(id);

    expect(await db.mirror('workout_session').get(id)).toMatchObject({
      ownerId: 'u-1',
      instanceId: 'i-1',
      workoutId: 'A',
      placeId: 'p-1',
      deviceId: 'dev-A',
      startedAt: iso(DEFAULT_NOW),
      endedAt: null,
      status: 'in_progress',
      weekType: 'normal',
      templateVersion: 3,
      rulesVersion: '1',
      appVersion: expect.any(String),
      profile: 'adult',
      note: null,
      serverRevSeen: null,
      deletedAt: null,
    });

    const v = await view(repos, id);
    expect(v).toMatchObject({
      id,
      status: 'in_progress',
      startedAt: DEFAULT_NOW,
      endedAt: null,
      heldHere: true,
    });
    expect(v.exercises.map((e) => [e.position, e.slotId, e.plannedExerciseId, e.exerciseId])).toEqual([
      [1, 'A1', 'back-squat', 'back-squat'],
      [2, 'A2', 'dumbbell-lunge', 'dumbbell-lunge'],
    ]);
    expect(exerciseAt(v, 0).sets.map((s) => [s.kind, s.position, s.side, s.targetLoadG, s.loggedAt])).toEqual(
      [
        ['warmup', 1, null, 30_000, null],
        ['work', 1, null, 60_000, null],
        ['work', 2, null, 60_000, null],
        ['work', 3, null, 60_000, null],
      ],
    );
    expect(workSet(v, 0, 0)).toMatchObject({
      loadMode: 'barbell',
      loadG: null,
      reps: null,
      targetRepsMin: 6,
      targetRepsMax: 6,
      targetRir: 2,
      effort: null,
    });
    expect(exerciseAt(v, 1).sets.map((s) => [s.position, s.side])).toEqual([
      [1, 'left'],
      [1, 'right'],
      [2, 'left'],
      [2, 'right'],
    ]);
  });

  it('une seule transaction : une écriture qui échoue en route ne laisse ni ligne, ni op, ni séance en cours', async () => {
    const { services, db, repos } = await setup();
    const real = services.newOpId;
    let calls = 0;
    // 11 lignes : 11 identifiants et 11 op ; la panne tombe après des écritures, quel que soit leur ordre.
    services.newOpId = () => {
      calls += 1;
      if (calls === 18) throw new Error('panne');
      return real();
    };
    await expect(repos.workouts.start(START)).rejects.toThrow('panne');
    for (const store of STORES) expect(await db.mirror(store).count(), store).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta(db, 'activeSessionId')).toBeUndefined();
  });

  it("identifiant d'appareil : celui du socle (meta.deviceId), créé une fois s'il manque", async () => {
    const { db, repos } = await setup();
    await db.meta.delete('deviceId');
    const first = await repos.workouts.start(START);
    const deviceId = await getMeta(db, 'deviceId');
    expect(deviceId).toEqual(expect.any(String));
    expect((await view(repos, first)).deviceId).toBe(deviceId);
    await repos.workouts.finish(first);
    const second = await repos.workouts.start(START);
    expect((await view(repos, second)).deviceId).toBe(deviceId);
  });

  it('séance libre : semaine normale, profil du cache, sans instance, séance ni version du modèle', async () => {
    const { db, repos } = await setup({ me: makeMe({ cautious: true }) });
    const id = await repos.workouts.start({
      plan: null,
      placeId: 'p-1',
      instanceId: null,
      workoutId: null,
      templateVersion: null,
    });
    expect(await db.mirror('workout_session').get(id)).toMatchObject({
      instanceId: null,
      workoutId: null,
      templateVersion: null,
      weekType: 'normal',
      rulesVersion: '1',
      profile: 'cautious',
      status: 'in_progress',
    });
    expect((await view(repos, id)).exercises).toEqual([]);
  });

  it('refuse une deuxième séance sur cet appareil tant que la première y est en cours', async () => {
    const { repos } = await setup();
    await repos.workouts.start(START);
    await expect(repos.workouts.start(START)).rejects.toMatchObject({ code: 'in_progress' });
  });
});

describe('saisie des séries', () => {
  it('logSet pose loggedAt et les valeurs, puis demande la synchro regroupée (set_logged)', async () => {
    const { db, repos, sync, clock } = await setup();
    const id = await repos.workouts.start(START);
    const set = workSet(await view(repos, id), 0, 0);
    clock.now = DEFAULT_NOW + 60_000;
    await repos.workouts.logSet(set.id, { loadG: 62_500, reps: 6, effort: 'ok' });

    expect(workSet(await view(repos, id), 0, 0)).toMatchObject({
      id: set.id,
      loadG: 62_500,
      reps: 6,
      effort: 'ok',
      loggedAt: DEFAULT_NOW + 60_000,
    });
    expect((await ops(db)).at(-1)).toMatchObject({
      entity: 'performed_set',
      id: set.id,
      kind: 'patch',
      fields: { loadG: 62_500, reps: 6, effort: 'ok', loggedAt: iso(DEFAULT_NOW + 60_000) },
    });
    expect(sync.triggers).toContain('set_logged');
  });

  it("correction d'une série faite : l'heure reste ; reopenSet la rouvre ; setEffort note l'effort", async () => {
    const { repos, clock } = await setup();
    const id = await repos.workouts.start(START);
    const set = workSet(await view(repos, id), 0, 0);
    clock.now = DEFAULT_NOW + 60_000;
    await repos.workouts.logSet(set.id, { loadG: 60_000, reps: 6 });
    clock.now = DEFAULT_NOW + 120_000;
    await repos.workouts.logSet(set.id, { loadG: 62_500 });
    expect(workSet(await view(repos, id), 0, 0)).toMatchObject({
      loadG: 62_500,
      reps: 6,
      loggedAt: DEFAULT_NOW + 60_000,
    });

    await repos.workouts.reopenSet(set.id);
    expect(workSet(await view(repos, id), 0, 0)).toMatchObject({ loadG: 62_500, reps: 6, loggedAt: null });

    await repos.workouts.setEffort(set.id, 'hard');
    expect(workSet(await view(repos, id), 0, 0).effort).toBe('hard');
  });

  it("valeur hors bornes, non entière ou NaN : refusée, rien d'écrit (Review Focus 4)", async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const set = workSet(await view(repos, id), 0, 0);
    const before = await db.outbox.count();
    for (const values of [
      { loadG: 500_001 },
      { loadG: Number.NaN },
      { loadG: -1 },
      { reps: 201 },
      { reps: 6.5 },
      { durationS: 7_201 },
      { reps: 6, durationS: 30 },
    ]) {
      await expect(repos.workouts.logSet(set.id, values), JSON.stringify(values)).rejects.toMatchObject({
        code: 'out_of_range',
      });
    }
    expect(await db.outbox.count()).toBe(before);
    expect(workSet(await view(repos, id), 0, 0)).toMatchObject({ loadG: null, reps: null, loggedAt: null });
  });

  it('addSet ajoute une série de travail après la dernière (deux lignes en unilatéral) ; removeSet, série non faite seulement', async () => {
    const { repos } = await setup();
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    const squat = exerciseAt(v, 0);
    const lunge = exerciseAt(v, 1);

    const [added] = await repos.workouts.addSet(squat.id);
    expect((await repos.workouts.addSet(lunge.id)).length).toBe(2);
    const after = await view(repos, id);
    expect(workSets(after, 0).at(-1)).toMatchObject({
      id: added,
      position: 4,
      side: null,
      loadMode: 'barbell',
      targetRepsMin: 6,
      targetRepsMax: 6,
      targetLoadG: 60_000,
      targetRir: 2,
      loggedAt: null,
    });
    expect(workSets(after, 1).map((s) => [s.position, s.side])).toEqual([
      [1, 'left'],
      [1, 'right'],
      [2, 'left'],
      [2, 'right'],
      [3, 'left'],
      [3, 'right'],
    ]);

    await repos.workouts.removeSet(added ?? '');
    expect(workSets(await view(repos, id), 0)).toHaveLength(3);
    const first = workSet(after, 0, 0);
    await repos.workouts.logSet(first.id, { loadG: 60_000, reps: 6 });
    await expect(repos.workouts.removeSet(first.id)).rejects.toMatchObject({ code: 'set_done' });
  });

  it('swapExercise sans série faite : même exercice réalisé, séries non faites réécrites pour la nouvelle fiche', async () => {
    const { repos } = await setup();
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);

    const squatId = exerciseAt(v, 0).id;
    expect(await repos.workouts.swapExercise(squatId, 'goblet-squat', 'equipment')).toBe(squatId);
    const lungeId = exerciseAt(v, 1).id;
    expect(await repos.workouts.swapExercise(lungeId, 'goblet-squat', 'preference')).toBe(lungeId);

    const after = await view(repos, id);
    expect(exerciseAt(after, 0)).toMatchObject({
      id: squatId,
      exerciseId: 'goblet-squat',
      plannedExerciseId: 'back-squat',
      swapReason: 'equipment',
    });
    // Haltères : l'échauffement reste ; la charge visée de la barre ne vaut plus.
    expect(exerciseAt(after, 0).sets.map((s) => [s.kind, s.position, s.loadMode, s.targetLoadG])).toEqual([
      ['warmup', 1, 'dumbbell', null],
      ['work', 1, 'dumbbell', null],
      ['work', 2, 'dumbbell', null],
      ['work', 3, 'dumbbell', null],
    ]);
    expect(workSet(after, 0, 0)).toMatchObject({ targetRepsMin: 6, targetRepsMax: 6, targetRir: 2 });
    // Unilatéral → bilatéral : une ligne par série.
    expect(exerciseAt(after, 1).sets.map((s) => [s.position, s.side, s.targetRepsMax])).toEqual([
      [1, null, 12],
      [2, null, 12],
    ]);

    // Sans charge : pas d'échauffement (R29).
    await repos.workouts.swapExercise(squatId, 'bodyweight-squat', 'busy');
    expect(exerciseAt(await view(repos, id), 0).sets.map((s) => [s.kind, s.loadMode])).toEqual([
      ['work', 'bodyweight'],
      ['work', 'bodyweight'],
      ['work', 'bodyweight'],
    ]);
    await expect(repos.workouts.swapExercise(squatId, 'inconnu', 'busy')).rejects.toMatchObject({
      code: 'unknown_exercise',
    });
  });

  it("swapExercise après une série faite : les séries faites restent à l'ancienne fiche, la suite passe à un nouvel exercice du slot", async () => {
    const { repos } = await setup();
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    const squat = exerciseAt(v, 0);
    await repos.workouts.logSet(workSet(v, 0, 0).id, { loadG: 60_000, reps: 6 });

    const next = await repos.workouts.swapExercise(squat.id, 'goblet-squat', 'busy');
    expect(next).not.toBe(squat.id);
    const after = await view(repos, id);
    expect(after.exercises.map((e) => [e.id, e.slotId, e.exerciseId, e.swapReason])).toEqual([
      [squat.id, 'A1', 'back-squat', null],
      [next, 'A1', 'goblet-squat', 'busy'],
      [exerciseAt(v, 1).id, 'A2', 'dumbbell-lunge', null],
    ]);
    expect(exerciseAt(after, 0).sets.map((s) => [s.kind, s.position, s.loggedAt])).toEqual([
      ['work', 1, DEFAULT_NOW],
    ]);
    expect(exerciseAt(after, 1)).toMatchObject({ plannedExerciseId: 'back-squat', position: 1 });
    expect(exerciseAt(after, 1).sets.map((s) => [s.kind, s.position, s.loadMode, s.loggedAt])).toEqual([
      ['warmup', 1, 'dumbbell', null],
      ['work', 1, 'dumbbell', null],
      ['work', 2, 'dumbbell', null],
    ]);
  });

  it("markPain sans accord santé : seulement nextAdjustment, aucune trace de douleur dans Dexie ni dans l'outbox (R-SYN-10)", async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    await repos.workouts.markPain(exerciseAt(v, 0).id, 'discomfort');
    await repos.workouts.markPain(exerciseAt(v, 1).id, 'pain');
    await repos.workouts.swapExercise(exerciseAt(v, 1).id, 'bulgarian-split-squat', 'pain');

    const after = await view(repos, id);
    expect(after.exercises.map((e) => [e.nextAdjustment, e.painLevel, e.swapReason])).toEqual([
      ['hold', null, null],
      ['lighten', null, null],
    ]);
    const dump = await dumpLocalDb(db);
    expect(dump).not.toMatch(/"painLevel":"/);
    expect(dump).not.toMatch(/"swapReason":"pain"/);
    for (const op of await ops(db)) {
      expect(op.fields, op.opId).not.toHaveProperty('painLevel');
      expect(op.fields.swapReason, op.opId).not.toBe('pain');
    }
  });

  it('swapExercise « pain » sans accord santé : raison vide (05 §13.8), même après un premier changement', async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const squatId = exerciseAt(await view(repos, id), 0).id;
    await repos.workouts.swapExercise(squatId, 'goblet-squat', 'equipment');
    await repos.workouts.swapExercise(squatId, 'bodyweight-squat', 'pain');
    expect(exerciseAt(await view(repos, id), 0)).toMatchObject({
      exerciseId: 'bodyweight-squat',
      swapReason: null,
    });
    const patches = (await ops(db)).filter((o) => o.entity === 'performed_exercise' && o.kind === 'patch');
    expect(patches.at(-1)?.fields).toEqual({ exerciseId: 'bodyweight-squat', swapReason: null });
    expect(await dumpLocalDb(db)).not.toMatch(/"swapReason":"pain"/);
  });

  it('markPain avec accord santé : painLevel et nextAdjustment ; un retrait dans le miroir suffit à ne plus rien stocker', async () => {
    const health = { active: true, textVersion: 'v1', at: '2026-10-01T10:00:00.000Z' };
    const me = makeMe({ consents: { health, aiCoach: { active: false, textVersion: null, at: null } } });
    const { db, repos } = await setup({ me });
    await seedHealthConsent(db);
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    await repos.workouts.markPain(exerciseAt(v, 0).id, 'pain');
    await repos.workouts.swapExercise(exerciseAt(v, 0).id, 'goblet-squat', 'pain');
    expect(exerciseAt(await view(repos, id), 0)).toMatchObject({
      painLevel: 'pain',
      nextAdjustment: 'lighten',
      swapReason: 'pain',
    });

    await seedHealthConsent(db, 'revoke');
    await repos.workouts.markPain(exerciseAt(v, 1).id, 'discomfort');
    expect(exerciseAt(await view(repos, id), 1)).toMatchObject({ painLevel: null, nextAdjustment: 'hold' });
  });

  it('setAdjustment, et setNote : texte nettoyé, vide → null, plus de 500 caractères refusé', async () => {
    const { repos } = await setup();
    const id = await repos.workouts.start(START);
    const pe = exerciseAt(await view(repos, id), 0).id;
    await repos.workouts.setAdjustment(pe, 'hold');
    expect(exerciseAt(await view(repos, id), 0).nextAdjustment).toBe('hold');
    await repos.workouts.setAdjustment(pe, null);
    expect(exerciseAt(await view(repos, id), 0).nextAdjustment).toBeNull();

    await repos.workouts.setNote({ kind: 'session', id }, '  Bonne séance  ');
    await repos.workouts.setNote({ kind: 'exercise', id: pe }, 'Genou droit à surveiller');
    let after = await view(repos, id);
    expect(after.note).toBe('Bonne séance');
    expect(exerciseAt(after, 0).note).toBe('Genou droit à surveiller');
    await repos.workouts.setNote({ kind: 'exercise', id: pe }, '   ');
    after = await view(repos, id);
    expect(exerciseAt(after, 0).note).toBeNull();
    await expect(repos.workouts.setNote({ kind: 'session', id }, 'x'.repeat(501))).rejects.toMatchObject({
      code: 'note_too_long',
    });
  });

  it("changePlace : le plan est refait tant qu'aucune série n'est faite, refusé ensuite", async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const old = await view(repos, id);
    await repos.workouts.changePlace(id, { ...PLAN, exercises: [LUNGE] }, 'p-2');

    const after = await view(repos, id);
    expect(after.placeId).toBe('p-2');
    expect(after.exercises.map((e) => [e.position, e.exerciseId])).toEqual([[1, 'dumbbell-lunge']]);
    for (const e of old.exercises) {
      expect((await db.mirror('performed_exercise').get(e.id))?.deletedAt, e.id).not.toBeNull();
      for (const s of e.sets) expect((await db.mirror('performed_set').get(s.id))?.deletedAt).not.toBeNull();
    }

    await repos.workouts.logSet(workSet(after, 0, 0).id, { loadG: 14_000, reps: 10 });
    await expect(repos.workouts.changePlace(id, PLAN, 'p-1')).rejects.toMatchObject({ code: 'sets_done' });
  });

  it('addFreeExercise : un exercice sans slot ni cible, avec une première série vide', async () => {
    const { repos } = await setup();
    const id = await repos.workouts.start({
      plan: null,
      placeId: 'p-1',
      instanceId: null,
      workoutId: null,
      templateVersion: null,
    });
    const goblet = await repos.workouts.addFreeExercise(id, 'goblet-squat');
    await repos.workouts.addFreeExercise(id, 'bulgarian-split-squat');
    const v = await view(repos, id);
    expect(
      v.exercises.map((e) => [e.id === goblet, e.position, e.slotId, e.plannedExerciseId, e.exerciseId]),
    ).toEqual([
      [true, 1, null, null, 'goblet-squat'],
      [false, 2, null, null, 'bulgarian-split-squat'],
    ]);
    expect(exerciseAt(v, 0).sets).toMatchObject([
      { kind: 'work', position: 1, side: null, loadMode: 'dumbbell', targetLoadG: null, targetRepsMin: null },
    ]);
    expect(exerciseAt(v, 1).sets.map((s) => s.side)).toEqual(['left', 'right']);
    await expect(repos.workouts.addFreeExercise(id, 'inconnu')).rejects.toMatchObject({
      code: 'unknown_exercise',
    });
  });
});

describe('saisie : listes blanches, paires, douleur après une série faite', () => {
  it('logSet ne garde que charge, répétitions, durée et effort', async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const set = workSet(await view(repos, id), 0, 0);
    const other = exerciseAt(await view(repos, id), 1).id;
    const sneaky = { loadG: 60_000, loggedAt: '2020-01-01T00:00:00.000Z', performedExerciseId: other };
    await repos.workouts.logSet(set.id, sneaky as SetInput);
    expect((await ops(db)).at(-1)?.fields).toEqual({ loadG: 60_000, loggedAt: iso(DEFAULT_NOW) });
    expect(workSet(await view(repos, id), 0, 0)).toMatchObject({ loadG: 60_000, loggedAt: DEFAULT_NOW });
  });

  it('removeSet en unilatéral retire les deux côtés de la série ; refusé si un côté est fait', async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const lines = workSets(await view(repos, id), 1);
    const [, , left2, right2] = lines;
    await repos.workouts.removeSet(right2?.id ?? '');
    expect(workSets(await view(repos, id), 1).map((s) => [s.position, s.side])).toEqual([
      [1, 'left'],
      [1, 'right'],
    ]);
    for (const s of [left2, right2]) {
      expect((await db.mirror('performed_set').get(s?.id ?? ''))?.deletedAt).not.toBeNull();
    }
    const [left1, right1] = lines;
    await repos.workouts.logSet(left1?.id ?? '', { loadG: 14_000, reps: 10 });
    await expect(repos.workouts.removeSet(right1?.id ?? '')).rejects.toMatchObject({ code: 'set_done' });
    expect(workSets(await view(repos, id), 1)).toHaveLength(2);
  });

  it("douleur sans accord santé après une série faite (nouvel exercice du slot) : aucune trace dans Dexie ni dans l'outbox", async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    await repos.workouts.logSet(workSet(v, 1, 0).id, { loadG: 14_000, reps: 10 });
    await repos.workouts.markPain(exerciseAt(v, 1).id, 'pain');
    const next = await repos.workouts.swapExercise(exerciseAt(v, 1).id, 'bulgarian-split-squat', 'pain');
    expect(next).not.toBe(exerciseAt(v, 1).id);

    const after = await view(repos, id);
    expect(after.exercises.map((e) => [e.exerciseId, e.painLevel, e.swapReason, e.nextAdjustment])).toEqual([
      ['back-squat', null, null, null],
      ['dumbbell-lunge', null, null, 'lighten'],
      ['bulgarian-split-squat', null, null, null],
    ]);
    const dump = await dumpLocalDb(db);
    expect(dump).not.toMatch(/"painLevel":"/);
    expect(dump).not.toMatch(/"swapReason":"pain"/);
    for (const op of await ops(db)) {
      expect(op.fields, op.opId).not.toHaveProperty('painLevel');
      expect(op.fields.swapReason, op.opId).not.toBe('pain');
    }
  });
});

describe('fin de séance (D2, D4)', () => {
  it('finish après un pull de cette exécution : completed, séries jamais faites supprimées logiquement, séance en cours effacée', async () => {
    const { db, repos, sync, clock } = await setup();
    sync.set({ pulledThisRun: true });
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    clock.now = DEFAULT_NOW + 10 * 60_000;
    await repos.workouts.logSet(workSet(v, 0, 0).id, { loadG: 60_000, reps: 6, effort: 'ok' });
    await repos.workouts.logSet(workSet(v, 1, 0).id, { loadG: 14_000, reps: 10 });
    clock.now = DEFAULT_NOW + 45 * 60_000;

    expect(await repos.workouts.finish(id)).toBe('completed');
    expect(await db.mirror('workout_session').get(id)).toMatchObject({
      status: 'completed',
      endedAt: iso(DEFAULT_NOW + 45 * 60_000),
    });
    const after = await view(repos, id);
    expect(after.exercises.flatMap((e) => e.sets).map((s) => s.id)).toEqual([
      workSet(v, 0, 0).id,
      workSet(v, 1, 0).id,
    ]);
    const deleted = (await rows(db, 'performed_set')).filter((r) => r.deletedAt != null);
    expect(deleted).toHaveLength(6);
    expect(
      (await ops(db))
        .filter((o) => o.kind === 'delete')
        .map((o) => o.id)
        .sort(),
    ).toEqual(deleted.map((r) => r.id).sort());
    expect(await getMeta(db, 'activeSessionId')).toBeNull();
    expect(sync.triggers).toContain('mutation');
    expect(await repos.workouts.activeSession()).toBeNull();
    expect((await repos.workouts.history()).map((s) => s.id)).toEqual([id]);
  });

  it('finish sans pull réussi dans cette exécution (ruling R38) : clôture sans supprimer aucune série', async () => {
    const { db, repos, sync, clock } = await setup();
    const id = await repos.workouts.start(START);
    const done = workSet(await view(repos, id), 0, 0);
    await repos.workouts.logSet(done.id, { loadG: 60_000, reps: 6 });
    clock.now = DEFAULT_NOW + 45 * 60_000;
    const before = await db.outbox.count();

    expect(sync.getState().pulledThisRun).toBe(false);
    expect(await repos.workouts.finish(id)).toBe('completed');
    const written = (await ops(db)).slice(before);
    expect(written.map((o) => [o.entity, o.kind, Object.keys(o.fields).sort()])).toEqual([
      ['workout_session', 'patch', ['endedAt', 'status']],
    ]);
    expect((await rows(db, 'performed_set')).filter((r) => r.deletedAt != null)).toEqual([]);
    expect(await getMeta(db, 'activeSessionId')).toBeNull();
    // Les lectures d'une séance close ignorent ses séries jamais faites.
    const [closed] = await repos.workouts.history();
    expect(closed?.exercises.flatMap((e) => e.sets).map((s) => s.id)).toEqual([done.id]);
  });

  it('finish sans série de travail faite → abandoned', async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const warmup = exerciseAt(await view(repos, id), 0).sets[0];
    await repos.workouts.logSet(warmup?.id ?? '', { loadG: 30_000, reps: 8 });
    expect(await repos.workouts.finish(id)).toBe('abandoned');
    expect((await db.mirror('workout_session').get(id))?.status).toBe('abandoned');
  });

  it('remove : séance, exercices et séries supprimés logiquement ensemble (R-SYN-6)', async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    await repos.workouts.remove(id);
    for (const store of STORES) {
      for (const r of await rows(db, store)) expect(r.deletedAt, `${store}:${r.id}`).not.toBeNull();
    }
    expect((await ops(db)).filter((o) => o.kind === 'delete')).toHaveLength(PLAN_ROWS);
    expect(await getMeta(db, 'activeSessionId')).toBeNull();
    expect(await repos.workouts.session(id)).toBeNull();
    expect(await repos.workouts.history()).toEqual([]);
  });
});

describe('séance close : corrections des séries faites seulement (§7.6)', () => {
  it('logSet et setEffort corrigent une série faite ; rouvrir, ajouter, retirer, changer d’exercice : refusés', async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    const set = workSet(v, 0, 0);
    await repos.workouts.logSet(set.id, { loadG: 60_000, reps: 6 });
    await repos.workouts.finish(id);

    await repos.workouts.logSet(set.id, { loadG: 62_500, reps: 5 });
    await repos.workouts.setEffort(set.id, 'hard');
    expect(workSet(await view(repos, id), 0, 0)).toMatchObject({
      loadG: 62_500,
      reps: 5,
      effort: 'hard',
      loggedAt: DEFAULT_NOW,
    });

    const before = await db.outbox.count();
    const pe = exerciseAt(v, 0).id;
    for (const attempt of [
      () => repos.workouts.reopenSet(set.id),
      () => repos.workouts.addSet(pe),
      () => repos.workouts.removeSet(set.id),
      () => repos.workouts.swapExercise(pe, 'goblet-squat', 'busy'),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'not_in_progress' });
    }
    expect(await db.outbox.count()).toBe(before);
  });

  it("une série jamais faite d'une séance close (clôture d'une séance oubliée) ne se saisit plus", async () => {
    const { repos, sync } = await setup();
    sync.set({ pulledThisRun: true });
    const id = await repos.workouts.start(START);
    const open = workSet(await view(repos, id), 0, 1);
    await repos.workouts.closeStale(DEFAULT_NOW + 7 * HOUR);
    await expect(repos.workouts.logSet(open.id, { loadG: 60_000, reps: 6 })).rejects.toMatchObject({
      code: 'not_in_progress',
    });
    await expect(repos.workouts.setEffort(open.id, 'ok')).rejects.toMatchObject({ code: 'not_in_progress' });
  });
});

describe('séance oubliée (D12, ruling R33)', () => {
  /** Services dont le moteur a réussi un pull dans cette exécution de l'appli. */
  async function pulled(opts: Parameters<typeof setup>[0] = {}): Promise<Setup> {
    const t = await setup(opts);
    t.sync.set({ pulledThisRun: true });
    return t;
  }

  it('sur cet appareil : clôturée après 6 h sans activité, ended_at = dernière série faite', async () => {
    const { db, repos, clock } = await pulled();
    const id = await repos.workouts.start(START);
    clock.now = DEFAULT_NOW + HOUR;
    await repos.workouts.logSet(workSet(await view(repos, id), 0, 0).id, { loadG: 60_000, reps: 6 });

    expect(await repos.workouts.closeStale(DEFAULT_NOW + 7 * HOUR - 1)).toEqual([]);
    expect(await repos.workouts.closeStale(DEFAULT_NOW + 7 * HOUR)).toEqual([id]);
    expect(await db.mirror('workout_session').get(id)).toMatchObject({
      status: 'completed',
      endedAt: iso(DEFAULT_NOW + HOUR),
    });
    expect(await getMeta(db, 'activeSessionId')).toBeNull();
  });

  it('clôture : statut et fin seulement, aucune série supprimée ; les lectures ignorent les séries jamais faites', async () => {
    const { db, repos, clock } = await pulled();
    const id = await repos.workouts.start(START);
    clock.now = DEFAULT_NOW + HOUR;
    const done = workSet(await view(repos, id), 0, 0);
    await repos.workouts.logSet(done.id, { loadG: 60_000, reps: 6 });
    const before = await db.outbox.count();

    expect(await repos.workouts.closeStale(DEFAULT_NOW + 7 * HOUR)).toEqual([id]);
    const written = (await ops(db)).slice(before);
    expect(written.map((o) => [o.entity, o.kind, Object.keys(o.fields).sort()])).toEqual([
      ['workout_session', 'patch', ['endedAt', 'status']],
    ]);
    expect((await rows(db, 'performed_set')).filter((r) => r.deletedAt != null)).toEqual([]);
    const [closed] = await repos.workouts.history();
    expect(closed?.exercises.flatMap((e) => e.sets).map((s) => s.id)).toEqual([done.id]);
  });

  it("rien avant un pull réussi dans cette exécution : un miroir d'avant ne clôt rien, n'écrit rien", async () => {
    const { db, repos, sync, clock } = await setup();
    const id = await repos.workouts.start(START);
    clock.now = DEFAULT_NOW + HOUR;
    await repos.workouts.logSet(workSet(await view(repos, id), 0, 0).id, { loadG: 60_000, reps: 6 });
    const before = await db.outbox.count();

    expect(await repos.workouts.closeStale(DEFAULT_NOW + 48 * HOUR)).toEqual([]);
    expect(await db.outbox.count()).toBe(before);
    expect(await getMeta(db, 'activeSessionId')).toBe(id);
    expect((await db.mirror('workout_session').get(id))?.status).toBe('in_progress');

    sync.set({ pulledThisRun: true });
    expect(await repos.workouts.closeStale(DEFAULT_NOW + 48 * HOUR)).toEqual([id]);
  });

  it('closeStaleAfterPull : la clôture part dès que le moteur a réussi un pull', async () => {
    const { services, db, repos, sync } = await setup();
    const id = await repos.workouts.start(START);
    services.now = () => DEFAULT_NOW + 7 * HOUR;
    const stop = closeStaleAfterPull(services);
    try {
      sync.set({ connection: 'offline' });
      await new Promise((r) => setTimeout(r, 20));
      expect((await db.mirror('workout_session').get(id))?.status).toBe('in_progress');
      sync.set({ pulledThisRun: true });
      await vi.waitFor(async () =>
        expect((await db.mirror('workout_session').get(id))?.status).toBe('abandoned'),
      );
    } finally {
      stop();
    }
  });

  it('tenue par un autre appareil : clôturée après 24 h seulement, ended_at = début sans série faite', async () => {
    const { db, repos } = await pulled();
    const id = await repos.workouts.start(START);
    // Comme après un pull : l'autre appareil a repris la séance.
    await db.mirror('workout_session').update(id, { deviceId: 'dev-B' });

    expect(await repos.workouts.closeStale(DEFAULT_NOW + 7 * HOUR)).toEqual([]);
    expect(await repos.workouts.closeStale(DEFAULT_NOW + 24 * HOUR - 1)).toEqual([]);
    expect(await repos.workouts.closeStale(DEFAULT_NOW + 24 * HOUR)).toEqual([id]);
    expect(await db.mirror('workout_session').get(id)).toMatchObject({
      status: 'abandoned',
      endedAt: iso(DEFAULT_NOW),
    });
  });

  it("sans utilisateur connecté (ouverture de l'appli) : rien à clore", async () => {
    const { repos } = await pulled({ me: null });
    expect(await repos.workouts.closeStale(DEFAULT_NOW + 48 * HOUR)).toEqual([]);
  });

  it('une séance notée en cours ici mais reprise ailleurs ne bloque plus les mises à jour', async () => {
    const { db, repos } = await pulled();
    const id = await repos.workouts.start(START);
    await db.mirror('workout_session').update(id, { deviceId: 'dev-B' });
    expect(await repos.workouts.closeStale(DEFAULT_NOW + 60_000)).toEqual([]);
    expect(await getMeta(db, 'activeSessionId')).toBeNull();
    expect((await db.mirror('workout_session').get(id))?.status).toBe('in_progress');
  });
});

describe("contexte de l'écran de séance (spec §7.3)", () => {
  const SETTINGS = { barG: 15_000, smallestPlateG: 500, dumbbellsG: [8000, 10_000], machineStepG: 2500 };

  async function seedProgram(db: AppDb): Promise<void> {
    await seedMirror(db, 'place', [
      {
        id: 'p-1',
        ownerId: 'u-1',
        kind: 'home',
        gymId: null,
        name: 'Garage',
        isPrimary: true,
        visibleAtGym: null,
        loadSettings: SETTINGS,
      },
    ]);
    await seedMirror(db, 'program_instance', [
      {
        id: 'i-1',
        ownerId: 'u-1',
        templateId: TEMPLATE.id,
        templateVersion: TEMPLATE.version,
        snapshot: TEMPLATE,
        daysPerWeek: 3,
        status: 'active',
        revision: 1,
        startedAt: '2026-09-01T08:00:00.000Z',
        endedAt: null,
        createdAt: '2026-09-01T08:00:00.000Z',
      },
    ]);
  }

  it('« Préc. » : séries faites de la dernière séance close sur chaque exercice, libre ou de programme', async () => {
    const { db, repos, clock } = await setup();
    await seedProgram(db);
    // Plus ancienne : séance libre, squat barre 55 kg × 8.
    clock.now = DEFAULT_NOW - 3 * 24 * HOUR;
    const free = await repos.workouts.start({ ...START, plan: null, instanceId: null, workoutId: null });
    const pe = await repos.workouts.addFreeExercise(free, 'back-squat');
    const [first] = exerciseAt(await view(repos, free), 0).sets;
    expect(exerciseAt(await view(repos, free), 0).id).toBe(pe);
    await repos.workouts.logSet(first?.id ?? '', { loadG: 55_000, reps: 8 });
    await repos.workouts.finish(free);
    // Plus récente : séance de programme, squat barre 57,5 kg × 7 en série 1 seulement.
    clock.now = DEFAULT_NOW - 24 * HOUR;
    const last = await repos.workouts.start(START);
    await repos.workouts.logSet(workSet(await view(repos, last), 0, 0).id, { loadG: 57_500, reps: 7 });
    await repos.workouts.finish(last);

    clock.now = DEFAULT_NOW;
    const id = await repos.workouts.start(START);
    const context = await repos.workouts.liveContext(id);
    expect(context?.previous['back-squat']?.map((s) => [s.kind, s.position, s.loadG, s.reps])).toEqual([
      ['work', 1, 57_500, 7],
    ]);
    // Rien la dernière fois sur la fente : pas de série précédente.
    expect(context?.previous['dumbbell-lunge']).toBeUndefined();
  });

  it('réglages de charge du lieu, pas de machine fixé, nom de la séance du modèle ; séance libre sans nom', async () => {
    const { db, repos } = await setup();
    await seedProgram(db);
    const id = await repos.workouts.start(START);
    const squat = exerciseAt(await view(repos, id), 0);
    await seedMirror(db, 'slot_state', [
      {
        id: `i-1:A1:back-squat`,
        ownerId: 'u-1',
        instanceId: 'i-1',
        slotId: 'A1',
        exerciseId: 'back-squat',
        mode: 'linear',
        loadG: 60_000,
        machineStepGOverride: 1000,
        calibrationLeft: 0,
        noProgressCount: 0,
        stallRank: 0,
        suspended: false,
        lastSessionId: null,
        rulesVersion: '1',
      },
    ]);
    const lunge = exerciseAt(await view(repos, id), 1);
    expect(await repos.workouts.liveContext(id)).toMatchObject({
      workoutName: 'Séance A',
      loadSettings: SETTINGS,
      machineStepG: { [squat.id]: 1000 },
      previous: {},
      // Repos du slot A1 dans le modèle ; le slot A2 n'y est pas.
      restS: { [squat.id]: 120 },
      slotStateIds: { [squat.id]: 'i-1:A1:back-squat', [lunge.id]: 'i-1:A2:dumbbell-lunge' },
    });
    await repos.workouts.finish(id);

    const free = await repos.workouts.start({
      ...START,
      plan: null,
      instanceId: null,
      workoutId: null,
      placeId: null,
    });
    expect(await repos.workouts.liveContext(free)).toMatchObject({
      workoutName: null,
      loadSettings: defaultLoadSettings('gym'),
      machineStepG: {},
      restS: {},
      slotStateIds: {},
    });
    expect(await repos.workouts.liveContext('inconnue')).toBeNull();
  });
});

describe('deux appareils (R-SYN-7, spec §7.1)', () => {
  it("continueHere réécrit device_id ; tant qu'elle est ailleurs, la séance est en lecture seule ici", async () => {
    const { db, repos } = await setup();
    const id = await repos.workouts.start(START);
    await db.mirror('workout_session').update(id, { deviceId: 'dev-B' });

    expect((await repos.workouts.otherDeviceSession())?.id).toBe(id);
    expect(await repos.workouts.activeSession()).toBeNull();
    expect((await view(repos, id)).heldHere).toBe(false);
    await expect(
      repos.workouts.logSet(workSet(await view(repos, id), 0, 0).id, { reps: 6 }),
    ).rejects.toMatchObject({ code: 'held_elsewhere' });

    await repos.workouts.continueHere(id);
    expect((await ops(db)).at(-1)).toMatchObject({
      entity: 'workout_session',
      id,
      kind: 'patch',
      fields: { deviceId: 'dev-A' },
    });
    expect(await getMeta(db, 'activeSessionId')).toBe(id);
    expect(await repos.workouts.otherDeviceSession()).toBeNull();
    expect((await repos.workouts.activeSession())?.id).toBe(id);
  });
});

describe('réouverture (Review Focus 1)', () => {
  it('appli tuée en pleine séance : une base rouverte rend la même séance et les mêmes séries faites', async () => {
    const { services, db, repos, clock } = await setup();
    const id = await repos.workouts.start(START);
    const v = await view(repos, id);
    clock.now = DEFAULT_NOW + 5 * 60_000;
    await repos.workouts.logSet(workSet(v, 0, 0).id, { loadG: 60_000, reps: 6, effort: 'ok' });
    await repos.workouts.logSet(workSet(v, 1, 1).id, { loadG: 14_000, reps: 9 });
    const before = await repos.workouts.activeSession();

    db.close();
    const reopened = createAppDb(db.name);
    const again = createRepos({ ...services, db: reopened });
    const after = await again.workouts.activeSession();
    expect(after).toEqual(before);
    expect(after?.exercises.flatMap((e) => e.sets).filter((s) => s.loggedAt !== null)).toMatchObject([
      { loadG: 60_000, reps: 6, effort: 'ok', loggedAt: DEFAULT_NOW + 5 * 60_000 },
      { loadG: 14_000, reps: 9, side: 'right', loggedAt: DEFAULT_NOW + 5 * 60_000 },
    ]);
    reopened.close();
  });
});

describe('lectures observées', () => {
  const wrapper =
    (services: AppServices) =>
    ({ children }: { children: ReactNode }) =>
      createElement(ServicesProvider, { services, children });

  it('useActiveSession, useSession et useHistory suivent la séance du début à la fin', async () => {
    const { services, repos } = await setup();
    const active = renderHook(() => useActiveSession(), { wrapper: wrapper(services) });
    const history = renderHook(() => useHistory(), { wrapper: wrapper(services) });
    await waitFor(() => expect(active.result.current).toBeNull());
    await waitFor(() => expect(history.result.current).toEqual([]));

    const id = await repos.workouts.start(START);
    await waitFor(() => expect(active.result.current?.id).toBe(id));
    const one = renderHook(() => useSession(id), { wrapper: wrapper(services) });
    const set = workSet(await view(repos, id), 0, 0);
    await repos.workouts.logSet(set.id, { loadG: 60_000, reps: 6 });
    await waitFor(() =>
      expect(one.result.current && workSet(one.result.current, 0, 0).loggedAt).toBe(DEFAULT_NOW),
    );

    await repos.workouts.finish(id);
    await waitFor(() => expect(active.result.current).toBeNull());
    await waitFor(() => expect(history.result.current?.map((s) => s.id)).toEqual([id]));
    expect(one.result.current?.status).toBe('completed');
  });

  it('useOtherDeviceSession voit une séance en cours sur un autre appareil', async () => {
    const { services, db, repos } = await setup();
    const other = renderHook(() => useOtherDeviceSession(), { wrapper: wrapper(services) });
    await waitFor(() => expect(other.result.current).toBeNull());
    const id = await repos.workouts.start(START);
    await db.mirror('workout_session').update(id, { deviceId: 'dev-B' });
    await waitFor(() => expect(other.result.current?.id).toBe(id));
    expect(other.result.current?.heldHere).toBe(false);
  });
});

describe('synchro après une série (R-SYN-29)', () => {
  let engine: SyncEngine | undefined;
  afterEach(() => {
    engine?.stop();
    vi.useRealTimers();
  });

  it('la série validée part au serveur 2 s plus tard, pas avant', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { services, db, repos } = await setup();
    // Pull incrémental : un pull complet retirerait les lignes que ce faux serveur ne renvoie pas.
    await setMeta(db, 'watermark', 'E1:100');
    const server = createFakeSyncServer();
    engine = createSyncEngine({
      db,
      transport: server,
      now: () => DEFAULT_NOW,
      newOpId: services.newOpId,
      triggers: () => () => {},
    });
    services.sync = engine;
    const sync = engine;

    const id = await repos.workouts.start(START);
    await until(() => !sync.getState().syncing);
    expect(server.sent.flat()).toHaveLength(PLAN_ROWS);
    server.sent.length = 0;
    server.log.length = 0;

    const set = workSet(await view(repos, id), 0, 0);
    await repos.workouts.logSet(set.id, { loadG: 60_000, reps: 6 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(server.log).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => server.sent.length > 0 && !sync.getState().syncing);
    expect(server.sent.flat()).toMatchObject([{ entity: 'performed_set', id: set.id, kind: 'patch' }]);
  });
});
