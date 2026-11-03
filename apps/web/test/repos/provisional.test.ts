// @vitest-environment node
import type { ProgramTemplate } from '@rune/contracts';
import { createUserAndLogin } from '@rune/server/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { reposFor } from '../../src/repos';
import { seedCatalog, seedTrainingProfile } from '../support/catalog';
import { createTestServices, DEFAULT_NOW } from '../support/render';
import { seedMirror, seedOutbox } from '../support/seed';
import { createDevice, startServerWith } from '../support/two-devices';
import { WORKOUT_SHEETS } from '../support/workout';

// Copies provisoires du téléphone (spec brique 3 §4.4.8) : seulement celles des séances qui viennent de finir, et
// plus aucune ne reste quand le serveur ne les réécrit jamais (dette M2).

const HOUR = 3_600_000;

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
    {
      id: 'A',
      name: 'Séance A',
      slots: [
        {
          id: 'A1',
          movementPattern: 'squat',
          role: 'main',
          exercises: ['goblet-squat'],
          sets: [{ kind: 'work', count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 120 }],
          progression: { type: 'double' },
        },
      ],
    },
  ],
};

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function setup() {
  const t = await createTestServices();
  opened.push(t.db);
  const { db } = t;
  await setMeta(db, 'deviceId', 'dev-A');
  await seedCatalog(db, WORKOUT_SHEETS);
  await seedTrainingProfile(db);
  await seedMirror(db, 'place', [
    {
      id: 'p-1',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Garage',
      isPrimary: true,
      visibleAtGym: null,
      loadSettings: {
        barG: 20_000,
        smallestPlateG: 1250,
        dumbbellsG: [10_000, 12_000, 14_000, 16_000],
        machineStepG: 5000,
      },
    },
  ]);
  await seedMirror(db, 'home_equipment', [
    { id: 'p-1:dumbbells', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'dumbbells' },
  ]);
  await seedMirror(db, 'program_instance', [
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
  return { ...t, repos: reposFor(t.services) };
}

/** Séance A de l'instance, ses trois séries de travail faites, tenue par `dev-A` ; `n` la distingue des autres. */
async function seedSession(db: AppDb, n: number, status: 'completed' | 'in_progress'): Promise<string> {
  const id = `s-${n}`;
  const day = `2026-10-0${n + 1}`;
  await seedMirror(db, 'workout_session', [
    {
      id,
      ownerId: 'u-1',
      instanceId: 'i-1',
      workoutId: 'A',
      placeId: 'p-1',
      deviceId: 'dev-A',
      startedAt: `${day}T08:00:00.000Z`,
      endedAt: status === 'completed' ? `${day}T09:00:00.000Z` : null,
      status,
      weekType: 'normal',
      templateVersion: 1,
      rulesVersion: '1',
      appVersion: 'next',
      profile: 'adult',
      note: null,
    },
  ]);
  await seedMirror(db, 'performed_exercise', [
    {
      id: `pe-${n}`,
      ownerId: 'u-1',
      sessionId: id,
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
      id: `set-${n}-${position}`,
      ownerId: 'u-1',
      performedExerciseId: `pe-${n}`,
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
      loggedAt: `${day}T08:1${position}:00.000Z`,
    })),
  );
  return id;
}

const ids = async (db: AppDb, store: 'slot_state' | 'engine_decision') =>
  (await db.mirror(store).toArray()).map((r) => r.id).sort();

describe('copies provisoires de la fin de séance (M2)', () => {
  it("fin d'une séance : ses seules décisions et les états qu'elles touchent", async () => {
    const { db, repos } = await setup();
    await seedSession(db, 1, 'completed');
    const second = await seedSession(db, 2, 'completed');
    const view = await repos.programView.view();
    if (!view) throw new Error('vue absente');
    expect(view.replay.decisions.map((d) => d.id).sort()).toEqual(['pe-1', 'pe-2']);

    await repos.programView.storeProvisional(view.replay, [second]);

    // La décision de la séance plus ancienne, absente du miroir, n'est pas écrite.
    expect(await ids(db, 'engine_decision')).toEqual(['pe-2']);
    expect(await db.mirror('engine_decision').get('pe-2')).toMatchObject({ provisional: 1 });
    expect(await db.mirror('slot_state').get('i-1:A1:goblet-squat')).toMatchObject({
      lastSessionId: second,
      provisional: 1,
    });
  });

  it("un état dont la dernière séance n'est pas du lot n'est pas écrit", async () => {
    const { db, repos } = await setup();
    const first = await seedSession(db, 1, 'completed');
    await seedSession(db, 2, 'completed');
    const view = await repos.programView.view();
    if (!view) throw new Error('vue absente');

    await repos.programView.storeProvisional(view.replay, [first]);

    expect(await ids(db, 'engine_decision')).toEqual(['pe-1']);
    expect(await ids(db, 'slot_state')).toEqual([]);
  });

  it('deux séances closes ensemble par closeStale : copies des décisions des deux', async () => {
    const { db, repos, sync } = await setup();
    await seedSession(db, 1, 'in_progress');
    await seedSession(db, 2, 'in_progress');
    sync.set({ pulledThisRun: true });

    expect((await repos.workouts.closeStale(DEFAULT_NOW + 48 * HOUR)).sort()).toEqual(['s-1', 's-2']);

    expect(await ids(db, 'engine_decision')).toEqual(['pe-1', 'pe-2']);
    expect(await db.mirror('engine_decision').get('pe-1')).toMatchObject({ provisional: 1 });
  });
});

describe('copie que le serveur ne réécrit jamais (M2)', () => {
  const ghost = (id = 'i-1:Z9:ghost') => ({
    id,
    ownerId: 'u-1',
    instanceId: 'i-1',
    slotId: 'Z9',
    provisional: 1,
    serverRevSeen: null,
    deletedAt: null,
  });

  /** Appareil d'un membre dont le premier pull est fait (filigrane posé : les pulls suivants sont partiels). */
  async function pulledDevice() {
    const c = await startServerWith([]);
    const user = await createUserAndLogin(c);
    const d = await createDevice(c, user.id, user.cookie, { deviceId: 'dev-A' });
    await d.engine.syncNow('manual');
    return { d, user };
  }

  it('pull réussi, outbox vide, copie non réécrite : un pull complet relancé, la copie disparaît', async () => {
    const { d } = await pulledDevice();
    await d.db.mirror('slot_state').put(ghost());

    await d.engine.syncNow('manual');

    expect(await d.db.mirror('slot_state').get('i-1:Z9:ghost')).toBeUndefined();
  });

  it('second pull réussi avec une copie encore là : aucune nouvelle relance', async () => {
    const { d } = await pulledDevice();
    await d.db.mirror('slot_state').put(ghost());
    await d.engine.syncNow('manual');
    expect(await d.db.mirror('slot_state').get('i-1:Z9:ghost')).toBeUndefined();

    // La copie revient (écrite par une fin de séance) : le pull suivant est partiel, la copie reste.
    await d.db.mirror('slot_state').put(ghost());
    await d.engine.syncNow('manual');

    expect(await d.db.mirror('slot_state').get('i-1:Z9:ghost')).toBeDefined();
  });

  it('une décision provisoire déclenche aussi la relance', async () => {
    const { d } = await pulledDevice();
    await d.db.mirror('engine_decision').put(ghost('pe-ghost'));

    await d.engine.syncNow('manual');

    expect(await d.db.mirror('engine_decision').get('pe-ghost')).toBeUndefined();
  });

  it('outbox non vide : aucune relance', async () => {
    const { d, user } = await pulledDevice();
    await d.db.mirror('slot_state').put(ghost());
    await seedOutbox(d.db, user.id, 1);

    await d.engine.pullNow();

    expect(await d.db.mirror('slot_state').get('i-1:Z9:ghost')).toBeDefined();
  });
});
