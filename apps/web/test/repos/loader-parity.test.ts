// @vitest-environment node
import { rowToCamel } from '@rune/contracts';
import {
  createUserAndLogin,
  enroll,
  insertFixtureRow,
  login,
  seedSheet,
  sheetFixture,
  type TestContext,
  templateFixture,
} from '@rune/server/testing';
import { describe, expect, it } from 'vitest';
import { programViewFor } from '../../src/repos/program-view';
import type { WorkoutSessionView } from '../../src/repos/workout-repo';
import { seedCatalog } from '../support/catalog';
import { createDevice, type Device, startServerWith, syncAll } from '../support/two-devices';
import { PLAN, WORKOUT_SHEETS } from '../support/workout';

/*
 * Parité des chargeurs (dette M1) : le téléphone (`program-view`, `session-records`) et le serveur (`records`,
 * `replay-service`) chargent les mêmes séances et appellent le même moteur. Si l'un des deux lui donne autre chose,
 * les cibles de l'écran divergent de ce que le serveur écrit : ce test les compare ligne à ligne.
 */

const IP = '100.64.0.2';
const DAY = 24 * 3_600_000;
const MINUTE = 60_000;

/** Colonnes de synchro, absentes du résultat du moteur. */
const SYNC_COLUMNS = ['ownerId', 'rev', 'createdAt', 'updatedAt', 'updatedBy', 'deletedAt'];

const withoutSync = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !SYNC_COLUMNS.includes(k)));

/** Lignes vivantes de la table du serveur, en camelCase, sans les colonnes de synchro, triées par id. */
const serverRows = (c: TestContext, table: string) =>
  c.deps.sqlite
    .prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY id`)
    .all()
    .map((r) => withoutSync(rowToCamel(r)));

const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Colonnes du serveur converties au format du moteur (`suspended` 0/1 → booléen, `nextTarget` JSON → objet).
 * `pain_streak` est C2 : sans accord santé (ici), le serveur l'écrit vide là où le moteur compte 0, comme le fait
 * `slotStateOf` pour les lignes reçues.
 */
function inEngineFormat(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if ('suspended' in out) out.suspended = out.suspended === 1;
  if ('painStreak' in out && out.painStreak === null) out.painStreak = 0;
  if (typeof out.nextTarget === 'string') out.nextTarget = JSON.parse(out.nextTarget);
  return out;
}

const workSets = (view: WorkoutSessionView | null, exercise: number) => {
  const sets = view?.exercises[exercise]?.sets.filter((s) => s.kind === 'work') ?? [];
  if (sets.length === 0) throw new Error('séries absentes');
  return sets;
};

describe('parité des chargeurs du rejeu', () => {
  it('le rejeu du téléphone égale slot_state et engine_decision du serveur', async () => {
    const c = await startServerWith([]);
    // Même catalogue des deux côtés : la charge arrondie dépend du mode de charge de la fiche.
    for (const sheet of WORKOUT_SHEETS) await seedSheet(c, sheetFixture(sheet.id, sheet));
    const user = await createUserAndLogin(c);
    const loadSettings = JSON.stringify({
      barG: 20_000,
      smallestPlateG: 1250,
      dumbbellsG: [10_000, 12_000, 14_000, 16_000],
      machineStepG: 5000,
    });
    const placeOf = async (name: string, settings: string) => {
      return (await insertFixtureRow(c.deps.db, 'place', { ownerId: user.id, name, loadSettings: settings }))
        .id as string;
    };
    const home = await placeOf('Maison', loadSettings);
    const garage = await placeOf('Garage', JSON.stringify({ barG: 15_000, smallestPlateG: 2500 }));
    const instanceId = await enroll(
      c,
      user.id,
      templateFixture('parity', [{ exercises: ['back-squat'] }, { exercises: ['dumbbell-lunge'] }]),
    );
    const a = await createDevice(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await createDevice(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });
    for (const d of [a, b]) await seedCatalog(d.db, WORKOUT_SHEETS);
    await syncAll(a, b);

    /** Séance terminée sur `d` : chaque série de travail faite à `loadG` × `reps`, puis `act` avant la fin. */
    async function train(
      d: Device,
      placeId: string,
      o: {
        loadG: number;
        reps: number;
        effort?: 'easy' | 'ok' | 'hard' | 'failed';
        act?: (s: string) => Promise<void>;
      },
    ): Promise<string> {
      c.clock.advance(DAY);
      const id = await d.repos.workouts.start({
        plan: PLAN,
        placeId,
        instanceId,
        workoutId: 'A',
        profile: 'adult',
        templateVersion: 1,
      });
      const session = await d.repos.workouts.session(id);
      for (const exercise of [0, 1]) {
        for (const set of workSets(session, exercise)) {
          c.clock.advance(MINUTE);
          await d.repos.workouts.logSet(set.id, { loadG: o.loadG, reps: o.reps, effort: o.effort ?? 'ok' });
        }
      }
      await o.act?.(id);
      c.clock.advance(MINUTE);
      expect(await d.repos.workouts.finish(id)).toBe('completed');
      return id;
    }
    const exerciseOf = async (d: Device, sessionId: string, n: number) => {
      const e = (await d.repos.workouts.session(sessionId))?.exercises[n];
      if (!e) throw new Error('exercice absent');
      return e.id;
    };

    // 1. A, à la maison, sans histoire.
    await train(a, home, { loadG: 60_000, reps: 12 });
    await syncAll(a, b);
    // 2. B, dans un second lieu (autre barre).
    await train(b, garage, { loadG: 62_500, reps: 12, effort: 'easy' });
    // 3. A hors ligne : « ne pas augmenter » ; sera poussée en retard, après la séance 4 de B.
    a.offline = true;
    await train(a, home, {
      loadG: 62_500,
      reps: 10,
      act: async (s) => a.repos.workouts.setAdjustment(await exerciseOf(a, s, 0), 'hold'),
    });
    // 4. B : « alléger » la fente.
    await train(b, home, {
      loadG: 60_000,
      reps: 9,
      effort: 'hard',
      act: async (s) => b.repos.workouts.setAdjustment(await exerciseOf(b, s, 1), 'lighten'),
    });
    await syncAll(b);
    a.offline = false;
    await syncAll(a, b);
    // 5. A : une douleur, sans accord santé (seul l'ajustement neutre est gardé).
    await train(a, garage, {
      loadG: 60_000,
      reps: 8,
      act: async (s) => a.repos.workouts.markPain(await exerciseOf(a, s, 1), 'pain'),
    });
    // 6. B : un changement d'exercice avant la fin.
    await train(b, home, {
      loadG: 57_500,
      reps: 12,
      act: async (s) => {
        await b.repos.workouts.swapExercise(await exerciseOf(b, s, 0), 'goblet-squat', 'preference');
      },
    });
    await syncAll(a, b);

    const states = serverRows(c, 'slot_state');
    const decisions = serverRows(c, 'engine_decision');
    expect(states.length).toBeGreaterThan(0);
    expect(decisions.length).toBeGreaterThan(0);

    for (const d of [a, b]) {
      const view = await programViewFor(d.services).view();
      expect(view?.source).toBe('local');
      expect(byId(view?.replay.slotStates ?? [])).toEqual(byId(states.map(inEngineFormat) as never[]));
      expect(byId(view?.replay.decisions ?? [])).toEqual(byId(decisions.map(inEngineFormat) as never[]));
    }
  });
});
