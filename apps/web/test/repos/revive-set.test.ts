// @vitest-environment node
import { createUserAndLogin, enroll, login, type TestContext, templateFixture } from '@rune/server/testing';
import { describe, expect, it } from 'vitest';
import { createDevice, startServerWith, syncAll } from '../support/two-devices';
import { PLAN } from '../support/workout';

/*
 * Dette I2 de la brique 3 (spec brique 4 §18, choix C41) : une série faite hors ligne sur un appareil, que l'autre
 * retire avant qu'elle arrive au serveur, revit à son arrivée, sur le serveur et dans les deux miroirs.
 */

const IP = '100.64.0.2';

const START = {
  plan: PLAN,
  placeId: null,
  workoutId: 'A',
  profile: 'adult',
  templateVersion: null,
} as const;

const serverSet = (c: TestContext, id: string) =>
  c.deps.sqlite.prepare('SELECT deleted_at, load_g, reps, logged_at FROM performed_set WHERE id = ?').get(id);

const serverDecision = (c: TestContext, id: string) =>
  c.deps.sqlite.prepare('SELECT deleted_at, result, reason_code FROM engine_decision WHERE id = ?').get(id);

describe('série faite hors ligne, retirée sur l’autre appareil avant son arrivée (I2)', () => {
  it('série faite hors ligne sur A, retirée sur B avant', async () => {
    const c = await startServerWith(['back-squat', 'dumbbell-lunge']);
    const user = await createUserAndLogin(c);
    const instanceId = await enroll(
      c,
      user.id,
      templateFixture('revive', [{ exercises: ['back-squat'] }, { exercises: ['dumbbell-lunge'] }]),
    );
    const a = await createDevice(c, user.id, user.cookie, { deviceId: 'dev-A' });
    const b = await createDevice(c, user.id, await login(c, user.username, user.password, IP), {
      deviceId: 'dev-B',
    });
    const id = await a.repos.workouts.start({ ...START, instanceId });
    await syncAll(a, b);

    // A perd le réseau en salle et valide la première série de travail du squat.
    a.offline = true;
    const squat = (await a.repos.workouts.session(id))?.exercises[0];
    const set = squat?.sets.find((s) => s.kind === 'work');
    if (!squat || !set) throw new Error('série absente');
    c.clock.advance(5 * 60_000);
    await a.repos.workouts.logSet(set.id, { loadG: 62_500, reps: 6 });
    await a.engine.syncNow('manual');
    expect(a.engine.getState().connection).toBe('offline');
    const loggedAt = c.clock.now().toISOString();

    // B reprend la séance, n'y voit pas la série faite et la retire : le serveur la supprime.
    c.clock.advance(60_000);
    await b.repos.workouts.continueHere(id);
    await b.repos.workouts.removeSet(set.id);
    await b.engine.syncNow('manual');
    expect(serverSet(c, set.id)).toMatchObject({ deleted_at: expect.any(String), logged_at: null });

    // A retrouve le réseau et pousse sa série.
    a.offline = false;
    await syncAll(a, b);

    const done = { deleted_at: null, load_g: 62_500, reps: 6, logged_at: loggedAt };
    expect(serverSet(c, set.id)).toEqual(done);
    // B tenait la ligne en tombe : le pull la remplace par la ligne vivante du serveur.
    expect(await b.db.mirror('performed_set').get(set.id)).toMatchObject({
      deletedAt: null,
      loadG: 62_500,
      reps: 6,
      loggedAt,
    });
    for (const d of [a, b]) {
      const view = await d.repos.workouts.session(id);
      expect(view?.exercises[0]?.sets.find((s) => s.id === set.id)).toMatchObject({
        loadG: 62_500,
        reps: 6,
        loggedAt: Date.parse(loggedAt),
      });
      expect(await d.db.outbox.count()).toBe(0);
    }

    // B termine : la série ressuscitée compte, pour D4 comme pour le moteur.
    expect(await b.repos.workouts.finish(id)).toBe('completed');
    await syncAll(a, b);
    // Sans la série, le moteur rendrait IGNORED (NO_DATA) ; avec elle, la première séance du slot le calibre.
    const decision = serverDecision(c, squat.id);
    expect(decision).toMatchObject({ deleted_at: null, result: 'CALIBRATION' });
    for (const d of [a, b]) {
      const view = await d.repos.workouts.session(id);
      expect(view?.status).toBe('completed');
      expect(view?.exercises[0]?.sets.map((s) => [s.id, s.loadG, s.reps])).toEqual([[set.id, 62_500, 6]]);
      expect(
        (await d.repos.workouts.decisions(id)).find((x) => x.performedExerciseId === squat.id),
      ).toMatchObject({ reasonCode: decision?.reason_code, provisional: false });
    }
  });
});
