// @vitest-environment node
import { createUserAndLogin, enroll, login, type TestContext, templateFixture } from '@rune/server/testing';
import { describe, expect, it } from 'vitest';
import { createDevice, startServerWith, syncAll } from '../support/two-devices';
import { PLAN, WORKOUT_SHEETS } from '../support/workout';

/*
 * Dette I3 de la brique 3 (spec brique 4 §18, choix C42) : « Changer d'exercice » sur un miroir en retard ne renomme
 * plus les séries faites hors ligne par l'autre appareil. Le changement crée un nouvel exercice ; l'ancien, qui porte
 * ces séries sur le serveur, est gardé (`keepOnDelete`) et ses séries faites revivent sous lui.
 */

const IP = '100.64.0.3';

const START = {
  plan: PLAN,
  placeId: null,
  workoutId: 'A',
  profile: 'adult',
  templateVersion: null,
} as const;

interface ServerSet {
  id: string;
  performed_exercise_id: string;
  kind: string;
  deleted_at: string | null;
  logged_at: string | null;
  reps: number | null;
}

const serverSets = (c: TestContext, sessionId: string) =>
  c.deps.sqlite
    .prepare(
      `SELECT s.id, s.performed_exercise_id, s.kind, s.deleted_at, s.logged_at, s.reps
       FROM performed_set s JOIN performed_exercise e ON e.id = s.performed_exercise_id
       WHERE e.session_id = ? ORDER BY s.id`,
    )
    .all(sessionId) as unknown as ServerSet[];

const serverExercise = (c: TestContext, id: string) =>
  c.deps.sqlite
    .prepare('SELECT exercise_id, deleted_at, slot_id, position FROM performed_exercise WHERE id = ?')
    .get(id) as { exercise_id: string; deleted_at: string | null; slot_id: string; position: number };

describe('changement d’exercice sur un miroir en retard (I3)', () => {
  it('les séries faites hors ligne restent à l’ancien exercice, la suite passe au nouveau', async () => {
    const c = await startServerWith(['back-squat', 'dumbbell-lunge']);
    const user = await createUserAndLogin(c);
    const instanceId = await enroll(
      c,
      user.id,
      templateFixture('late-swap', [{ exercises: ['back-squat'] }, { exercises: ['dumbbell-lunge'] }]),
    );
    const a = await createDevice(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await createDevice(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });
    // Le catalogue (fiches) vient du bundle, pas de la synchro des séances.
    await b.db.table('exercises').bulkPut(WORKOUT_SHEETS);
    const id = await a.repos.workouts.start({ ...START, instanceId });
    await syncAll(a, b);

    // A perd le réseau en salle et valide deux séries de travail du squat.
    a.offline = true;
    const squat = (await a.repos.workouts.session(id))?.exercises[0];
    const work = squat?.sets.filter((s) => s.kind === 'work').slice(0, 2) ?? [];
    if (!squat || work.length < 2) throw new Error('séries absentes');
    c.clock.advance(5 * 60_000);
    for (const [i, set] of work.entries()) {
      await a.repos.workouts.logSet(set.id, { loadG: 62_500, reps: 6 + i });
    }
    await a.engine.syncNow('manual');
    expect(a.engine.getState().connection).toBe('offline');

    // B, qui ne les a pas reçues, reprend la séance et change l'exercice.
    c.clock.advance(60_000);
    await b.repos.workouts.continueHere(id);
    const next = await b.repos.workouts.swapExercise(squat.id, 'dumbbell-lunge', 'preference');
    expect(next).not.toBe(squat.id);
    await b.engine.syncNow('manual');

    // A retrouve le réseau et pousse ses séries.
    a.offline = false;
    await syncAll(a, b);

    // Serveur : les séries faites sont vivantes sous un exercice back-squat, aucune ne porte la fente.
    const done = serverSets(c, id).filter((s) => s.logged_at !== null);
    expect(done.map((s) => s.id).sort()).toEqual(work.map((s) => s.id).sort());
    for (const s of done) {
      expect(s.deleted_at, s.id).toBeNull();
      expect(serverExercise(c, s.performed_exercise_id), s.id).toMatchObject({
        exercise_id: 'back-squat',
        deleted_at: null,
        slot_id: 'A1',
      });
    }
    // Le nouvel exercice porte la suite : fente, même slot, séries non faites seulement.
    expect(serverExercise(c, next)).toMatchObject({
      exercise_id: 'dumbbell-lunge',
      deleted_at: null,
      slot_id: 'A1',
    });
    const carried = serverSets(c, id).filter(
      (s) => s.performed_exercise_id === next && s.deleted_at === null,
    );
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.filter((s) => s.logged_at !== null)).toEqual([]);

    // Les deux miroirs voient la même séance : séries faites sous le squat, suite sous la fente.
    for (const d of [a, b]) {
      const view = await d.repos.workouts.session(id);
      const slot = view?.exercises.filter((e) => e.slotId === 'A1') ?? [];
      expect(slot.map((e) => e.exerciseId)).toEqual(['back-squat', 'dumbbell-lunge']);
      expect(
        slot[0]?.sets
          .filter((s) => s.loggedAt !== null)
          .map((s) => s.id)
          .sort(),
      ).toEqual(work.map((s) => s.id).sort());
      expect(slot[1]?.sets.filter((s) => s.loggedAt !== null)).toEqual([]);
      expect(await d.db.outbox.count()).toBe(0);
    }
  });
});
