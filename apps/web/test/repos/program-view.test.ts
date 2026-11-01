import type { MeResponse, ProgramTemplate } from '@rune/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppServices, ServicesProvider } from '../../src/app-services';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { type Repos, reposFor } from '../../src/repos';
import { usePlannedWorkout, useProgramView } from '../../src/repos/program-view';
import { applyPulledRows } from '../../src/sync/apply-pull';
import { seedCatalog, seedTrainingProfile } from '../support/catalog';
import { createTestServices, DEFAULT_NOW, makeMe } from '../support/render';
import { seedMirror } from '../support/seed';
import { seedHealthConsent, WORKOUT_SHEETS } from '../support/workout';

const LOAD_SETTINGS = {
  barG: 20_000,
  smallestPlateG: 1250,
  dumbbellsG: [10_000, 12_000, 14_000, 16_000],
  machineStepG: 5000,
};

const slot = (id: string, exercise: string, movementPattern: 'squat' | 'lunge') => ({
  id,
  movementPattern,
  role: 'main' as const,
  exercises: [exercise],
  sets: [{ kind: 'work' as const, count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 120 }],
  progression: { type: 'double' as const },
});

const TEMPLATE: ProgramTemplate = {
  schemaVersion: 1,
  id: 'test-full-body',
  version: 1,
  name: 'Corps entier',
  description: 'Modèle de test.',
  context: 'home',
  level: 'beginner',
  daysPerWeek: { min: 2, max: 3, default: 3 },
  estimatedMinutes: 45,
  block: { mode: 'reactive' },
  workouts: [
    { id: 'A', name: 'Séance A', slots: [slot('A1', 'goblet-squat', 'squat')] },
    { id: 'B', name: 'Séance B', slots: [slot('B1', 'dumbbell-lunge', 'lunge')] },
    { id: 'C', name: 'Séance C', slots: [slot('C1', 'leg-press', 'squat')] },
  ],
};

const SLOT_STATE_ID = 'i-1:A1:goblet-squat';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function setup(o: { me?: MeResponse; instance?: boolean } = {}): Promise<{
  services: AppServices;
  db: AppDb;
  repos: Repos;
}> {
  const t = await createTestServices(o.me ? { me: o.me } : {});
  opened.push(t.db);
  await setMeta(t.db, 'deviceId', 'dev-A');
  await seedCatalog(t.db, WORKOUT_SHEETS);
  await seedTrainingProfile(t.db);
  await seedMirror(t.db, 'place', [
    {
      id: 'p-1',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Garage',
      isPrimary: true,
      visibleAtGym: null,
      loadSettings: LOAD_SETTINGS,
    },
  ]);
  await seedMirror(t.db, 'home_equipment', [
    { id: 'p-1:dumbbells', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'dumbbells' },
  ]);
  await t.db.table('programTemplates').put({
    id: TEMPLATE.id,
    template: { ...TEMPLATE, version: 2 },
    available: true,
  });
  if (o.instance !== false) {
    await seedMirror(t.db, 'program_instance', [
      {
        id: 'i-1',
        ownerId: 'u-1',
        templateId: TEMPLATE.id,
        templateVersion: 1,
        snapshot: TEMPLATE,
        daysPerWeek: 3,
        status: 'active',
        revision: 1,
        startedAt: '2026-10-01T08:00:00.000Z',
        endedAt: null,
        createdAt: '2026-10-01T08:00:00.000Z',
      },
    ]);
  }
  return { services: t.services, db: t.db, repos: reposFor(t.services) };
}

/** Séance terminée reçue d'un autre appareil, avec une version de règles donnée. */
async function seedCompletedSession(db: AppDb, rulesVersion: string): Promise<void> {
  await seedMirror(db, 'workout_session', [
    {
      id: 's-old',
      ownerId: 'u-1',
      instanceId: 'i-1',
      workoutId: 'A',
      placeId: 'p-1',
      deviceId: 'dev-Z',
      startedAt: '2026-10-02T08:00:00.000Z',
      endedAt: '2026-10-02T09:00:00.000Z',
      status: 'completed',
      weekType: 'normal',
      templateVersion: 1,
      rulesVersion,
      appVersion: 'next',
      profile: 'adult',
      note: null,
    },
  ]);
  await seedMirror(db, 'performed_exercise', [
    {
      id: 'pe-old',
      ownerId: 'u-1',
      sessionId: 's-old',
      slotId: 'A1',
      plannedExerciseId: 'goblet-squat',
      exerciseId: 'goblet-squat',
      swapReason: null,
      position: 1,
      painLevel: null,
      nextAdjustment: null,
      note: null,
    },
  ]);
  await seedMirror(
    db,
    'performed_set',
    [1, 2, 3].map((position) => ({
      id: `set-old-${position}`,
      ownerId: 'u-1',
      performedExerciseId: 'pe-old',
      position,
      kind: 'work',
      loadMode: 'dumbbell',
      loadG: 12_000,
      reps: 12,
      durationS: null,
      side: null,
      effort: position === 3 ? 'ok' : null,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationS: null,
      targetLoadG: null,
      targetRir: 2,
      targetVariant: null,
      loggedAt: `2026-10-02T08:1${position}:00.000Z`,
    })),
  );
}

const SERVER_STATE = {
  id: SLOT_STATE_ID,
  ownerId: 'u-1',
  instanceId: 'i-1',
  slotId: 'A1',
  exerciseId: 'goblet-squat',
  mode: 'double',
  loadG: 14_000,
  targetReps: 8,
  variantRank: null,
  durationS: null,
  machineStepGOverride: null,
  calibrationLeft: 0,
  noProgressCount: 0,
  stallRank: 0,
  painStreak: null,
  suspended: false,
  lastSessionId: 's-old',
  rulesVersion: '99',
};

const change = (id: string, o: Record<string, unknown>) => ({
  id,
  ownerId: 'u-1',
  instanceId: 'i-1',
  baseRevision: 0,
  author: 'user',
  operations: [{ op: 'set_rest', slot: 'A1', seconds: 150 }],
  reasonCode: 'USER_CHANGE',
  reason: null,
  status: 'accepted',
  createdAt: '2026-10-01T09:00:00.000Z',
  expiresAt: null,
  decidedAt: '2026-10-01T09:00:00.000Z',
  aiGenerated: false,
  aiModel: null,
  promptVersion: null,
  coachThreadId: null,
  ...o,
});

describe('vue du programme', () => {
  it('sans instance active : null', async () => {
    const { repos } = await setup({ instance: false });
    expect(await repos.programView.view()).toBeNull();
    expect(await repos.programView.plannedWorkout(null, null)).toBeNull();
  });

  it('rejeu local sur le miroir : instance, modèle servi, programme effectif, séance suivante de la rotation', async () => {
    const { repos, db } = await setup();
    await seedCompletedSession(db, '1');
    const view = await repos.programView.view();
    expect(view).toMatchObject({
      source: 'local',
      instance: {
        id: 'i-1',
        templateId: TEMPLATE.id,
        templateVersion: 1,
        daysPerWeek: 3,
        status: 'active',
        revision: 1,
        startedAt: '2026-10-01T08:00:00.000Z',
        endedAt: null,
      },
      template: { template: { id: TEMPLATE.id, version: 2 }, available: true },
      proposals: [],
      changes: [],
    });
    expect(view?.program.template.workouts.map((w) => w.id)).toEqual(['A', 'B', 'C']);
    expect(view?.replay.state.nextWorkoutId).toBe('B');
    expect(view?.replay.decisions.map((d) => d.id)).toEqual(['pe-old']);
    expect(view?.slotStates.map((s) => [s.id, s.lastSessionId])).toEqual([[SLOT_STATE_ID, 's-old']]);
    expect(view?.slotStates).toBe(view?.replay.slotStates);
  });

  it('version de règles inconnue (appareil plus à jour) : slot_state du serveur, sans rejeu local des cibles (§4.4.8)', async () => {
    const { repos, db } = await setup();
    await seedCompletedSession(db, '99');
    await seedMirror(db, 'slot_state', [SERVER_STATE]);
    // Une copie provisoire a remplacé la ligne du serveur avant le pull : c'est ce que le miroir sait de mieux.
    await db.mirror('slot_state').put({
      ...SERVER_STATE,
      id: 'i-1:B1:dumbbell-lunge',
      slotId: 'B1',
      exerciseId: 'dumbbell-lunge',
      provisional: 1,
      serverRevSeen: null,
      deletedAt: null,
    });

    const view = await repos.programView.view();
    expect(view?.source).toBe('server');
    const state = {
      id: SLOT_STATE_ID,
      instanceId: 'i-1',
      slotId: 'A1',
      exerciseId: 'goblet-squat',
      mode: 'double',
      loadG: 14_000,
      targetReps: 8,
      variantRank: null,
      durationS: null,
      machineStepGOverride: null,
      calibrationLeft: 0,
      noProgressCount: 0,
      stallRank: 0,
      painStreak: 0,
      suspended: false,
      lastSessionId: 's-old',
      rulesVersion: '99',
    };
    expect(view?.slotStates).toEqual([
      state,
      { ...state, id: 'i-1:B1:dumbbell-lunge', slotId: 'B1', exerciseId: 'dumbbell-lunge' },
    ]);
    expect(view?.replay.slotStates).toEqual(view?.slotStates);
    expect(view?.replay.decisions).toEqual([]);
    expect(view?.replay.events).toEqual([]);
    // La rotation compte quand même la séance.
    expect(view?.replay.state.nextWorkoutId).toBe('B');

    const planned = await repos.programView.plannedWorkout('p-1', 'A');
    const work = planned?.plan.exercises[0]?.sets.find((s) => s.kind === 'work');
    expect(work?.targetLoadG).toBe(14_000);
  });

  it('propositions en attente (non expirées) et journal des changements, le plus récent en tête ; les acceptés font le programme', async () => {
    const { repos, db } = await setup();
    const later = new Date(DEFAULT_NOW + 86_400_000).toISOString();
    const before = new Date(DEFAULT_NOW - 1000).toISOString();
    await seedMirror(db, 'instance_change', [
      change('c-accepted', {}),
      change('c-rejected', {
        status: 'rejected',
        createdAt: '2026-10-02T09:00:00.000Z',
        decidedAt: '2026-10-02T09:05:00.000Z',
      }),
      change('c-proposed', {
        author: 'engine',
        status: 'proposed',
        reasonCode: 'ENGINE_REACTIVE_DELOAD',
        operations: [{ op: 'start_deload' }],
        createdAt: '2026-10-03T09:00:00.000Z',
        decidedAt: null,
        expiresAt: later,
      }),
      change('c-stale', {
        status: 'proposed',
        createdAt: '2026-10-03T08:00:00.000Z',
        decidedAt: null,
        expiresAt: before,
      }),
      change('c-other', { instanceId: 'i-0' }),
    ]);
    const view = await repos.programView.view();
    expect(view?.proposals.map((c) => c.id)).toEqual(['c-proposed']);
    expect(view?.proposals[0]).toMatchObject({ author: 'engine', operations: [{ op: 'start_deload' }] });
    expect(view?.changes.map((c) => c.id)).toEqual(['c-stale', 'c-rejected', 'c-accepted']);
    expect(view?.program.template.workouts[0]?.slots[0]?.sets[0]?.restS).toBe(150);
  });
});

describe('séance prévue', () => {
  it('lieu principal et séance de la rotation par défaut ; prête pour workouts.start', async () => {
    const { repos } = await setup();
    const planned = await repos.programView.plannedWorkout(null, null);
    expect(planned).toMatchObject({
      placeId: 'p-1',
      instanceId: 'i-1',
      workoutId: 'A',
      profile: 'adult',
      templateVersion: 1,
      plan: { workoutId: 'A', weekType: 'normal', rulesVersion: '1' },
    });
    expect(planned?.plan.exercises.map((e) => [e.slotId, e.exerciseId, e.calibration])).toEqual([
      ['A1', 'goblet-squat', true],
    ]);
    expect((await repos.programView.plannedWorkout('p-1', 'B'))?.plan.exercises[0]?.exerciseId).toBe(
      'dumbbell-lunge',
    );
    expect(await repos.programView.plannedWorkout('p-1', 'Z')).toBeNull();
    expect(await repos.programView.plannedWorkout('p-inconnu', null)).toBeNull();
  });

  it('profil prudent du cache', async () => {
    const { repos } = await setup({ me: makeMe({ cautious: true }) });
    expect((await repos.programView.plannedWorkout(null, null))?.profile).toBe('cautious');
  });

  it('Commencer, faire, Terminer : le rejeu local suit, et les décisions de fin sont gardées en copies provisoires', async () => {
    const { repos, db } = await setup();
    const planned = await repos.programView.plannedWorkout(null, null);
    if (!planned) throw new Error('séance prévue absente');
    const id = await repos.workouts.start(planned);
    const session = await repos.workouts.session(id);
    const pe = session?.exercises[0];
    for (const set of pe?.sets ?? [])
      await repos.workouts.logSet(set.id, { loadG: 12_000, reps: 12, effort: 'ok' });
    expect(await repos.workouts.finish(id)).toBe('completed');

    const view = await repos.programView.view();
    expect(view?.replay.state.nextWorkoutId).toBe('B');
    expect(await db.mirror('engine_decision').get(pe?.id ?? '')).toMatchObject({
      id: pe?.id,
      ownerId: 'u-1',
      instanceId: 'i-1',
      slotId: 'A1',
      exerciseId: 'goblet-squat',
      profile: 'adult',
      rulesVersion: '1',
      provisional: 1,
      serverRevSeen: null,
      deletedAt: null,
    });
    expect(await db.mirror('slot_state').get(SLOT_STATE_ID)).toMatchObject({
      instanceId: 'i-1',
      lastSessionId: id,
      provisional: 1,
      painStreak: null,
    });
  });
});

describe('copies provisoires (classe D, §4.4.8)', () => {
  it('remplacées par le pull ; une ligne du serveur identique reste celle du serveur', async () => {
    const { repos, db } = await setup();
    await seedCompletedSession(db, '1');
    const view = await repos.programView.view();
    if (!view) throw new Error('vue absente');
    await repos.programView.storeProvisional(view.replay);
    const copy = await db.mirror('slot_state').get(SLOT_STATE_ID);
    expect(copy).toMatchObject({ provisional: 1, serverRevSeen: null, deletedAt: null });
    expect(await db.mirror('engine_decision').get('pe-old')).toMatchObject({ provisional: 1 });

    // Le pull apporte la ligne du serveur : la copie disparaît.
    if (!copy) throw new Error('copie absente');
    const { provisional: _p, serverRevSeen: _s, ...content } = copy;
    await applyPulledRows(db, [{ entity: 'slot_state', rev: 40, row: { ...content, rev: 40 } }]);
    const pulled = await db.mirror('slot_state').get(SLOT_STATE_ID);
    expect(pulled).not.toHaveProperty('provisional');
    expect(pulled?.serverRevSeen).toBe(40);

    // Même contenu : rien n'est réécrit.
    await repos.programView.storeProvisional(view.replay);
    expect(await db.mirror('slot_state').get(SLOT_STATE_ID)).toEqual(pulled);
  });

  it('pas de machine du serveur gardé : après Terminer, dans les états et dans la grille de la séance suivante', async () => {
    const { repos, db } = await setup();
    const id = 'i-1:C1:leg-press';
    await seedMirror(db, 'home_equipment', [
      { id: 'p-1:leg_press', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'leg_press' },
    ]);
    // Séance d'avant (calibration finie à 50 kg) et pas de machine de 2,5 kg posé en ligne.
    await seedMirror(db, 'workout_session', [
      {
        id: 's-c1',
        ownerId: 'u-1',
        instanceId: 'i-1',
        workoutId: 'C',
        placeId: 'p-1',
        deviceId: 'dev-Z',
        startedAt: '2026-10-02T08:00:00.000Z',
        endedAt: '2026-10-02T09:00:00.000Z',
        status: 'completed',
        weekType: 'normal',
        templateVersion: 1,
        rulesVersion: '1',
        appVersion: 'dev',
        profile: 'adult',
        note: null,
      },
    ]);
    await seedMirror(db, 'performed_exercise', [
      {
        id: 'pe-c1',
        ownerId: 'u-1',
        sessionId: 's-c1',
        slotId: 'C1',
        plannedExerciseId: 'leg-press',
        exerciseId: 'leg-press',
        swapReason: null,
        position: 1,
        nextAdjustment: null,
        note: null,
      },
    ]);
    await seedMirror(
      db,
      'performed_set',
      [1, 2, 3].map((position) => ({
        id: `set-c1-${position}`,
        ownerId: 'u-1',
        performedExerciseId: 'pe-c1',
        position,
        kind: 'work',
        loadMode: 'machine',
        loadG: 50_000,
        reps: 10,
        durationS: null,
        side: null,
        effort: position === 3 ? 'ok' : null,
        loggedAt: `2026-10-02T08:1${position}:00.000Z`,
      })),
    );
    await seedMirror(db, 'slot_state', [
      {
        ...SERVER_STATE,
        id,
        slotId: 'C1',
        exerciseId: 'leg-press',
        loadG: 50_000,
        machineStepGOverride: 2500,
        rulesVersion: '1',
        lastSessionId: 's-c1',
      },
    ]);

    const planned = await repos.programView.plannedWorkout('p-1', 'C');
    if (!planned) throw new Error('séance prévue absente');
    expect(planned.plan.exercises[0]?.sets.find((s) => s.kind === 'work')?.targetLoadG).toBe(50_000);
    const sessionId = await repos.workouts.start(planned);
    for (const set of (await repos.workouts.session(sessionId))?.exercises[0]?.sets ?? []) {
      await repos.workouts.logSet(set.id, { loadG: 50_000, reps: 12, effort: 'ok' });
    }
    await repos.workouts.finish(sessionId);

    expect(await db.mirror('slot_state').get(id)).toMatchObject({
      provisional: 1,
      machineStepGOverride: 2500,
    });
    const after = await repos.programView.view();
    // + un pas de 2,5 kg (sans le pas de la machine : 55 kg).
    expect(after?.slotStates.find((s) => s.id === id)).toMatchObject({
      machineStepGOverride: 2500,
      loadG: 52_500,
    });
    const next = await repos.programView.plannedWorkout('p-1', 'C');
    expect(next?.plan.exercises[0]?.sets.find((s) => s.kind === 'work')?.targetLoadG).toBe(52_500);
  });

  it("une copie que le rejeu ne produit plus est retirée ; avec l'accord santé, painStreak est gardé", async () => {
    const health = { active: true, textVersion: 'v1', at: '2026-10-01T10:00:00.000Z' };
    const me = makeMe({ consents: { health, aiCoach: { active: false, textVersion: null, at: null } } });
    const { repos, db } = await setup({ me });
    await seedHealthConsent(db);
    await seedCompletedSession(db, '1');
    await db
      .mirror('slot_state')
      .put({ ...SERVER_STATE, id: 'i-1:B1:old', provisional: 1, serverRevSeen: null, deletedAt: null });
    const view = await repos.programView.view();
    if (!view) throw new Error('vue absente');
    await repos.programView.storeProvisional(view.replay);
    expect(await db.mirror('slot_state').get('i-1:B1:old')).toBeUndefined();
    expect((await db.mirror('slot_state').get(SLOT_STATE_ID))?.painStreak).toBe(0);
  });
});

describe('lectures observées', () => {
  const wrapper =
    (services: AppServices) =>
    ({ children }: { children: ReactNode }) =>
      createElement(ServicesProvider, { services, children });

  it('useProgramView et usePlannedWorkout suivent le miroir', async () => {
    const { services, db } = await setup({ instance: false });
    const view = renderHook(() => useProgramView(), { wrapper: wrapper(services) });
    const planned = renderHook(() => usePlannedWorkout(null, null), { wrapper: wrapper(services) });
    await waitFor(() => expect(view.result.current).toBeNull());
    await waitFor(() => expect(planned.result.current).toBeNull());

    await seedMirror(db, 'program_instance', [
      {
        id: 'i-1',
        ownerId: 'u-1',
        templateId: TEMPLATE.id,
        templateVersion: 1,
        snapshot: TEMPLATE,
        daysPerWeek: 3,
        status: 'active',
        revision: 0,
        startedAt: '2026-10-01T08:00:00.000Z',
        endedAt: null,
      },
    ]);
    await waitFor(() => expect(view.result.current?.instance.id).toBe('i-1'));
    await waitFor(() => expect(planned.result.current?.workoutId).toBe('A'));

    await seedCompletedSession(db, '99');
    await waitFor(() => expect(view.result.current?.source).toBe('server'));
  });
});
