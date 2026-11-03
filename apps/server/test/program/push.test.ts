import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  makeOp,
  syncPush,
  type TestContext,
} from '../support';
import { retiredDraft, sheetFixture, templateFixture } from '../support/catalog';
import { dayAt, enroll, grantHealth, newId, sessionOps } from '../support/program';
import { seedSheet } from '../support/review';

/*
 * Contrôles du serveur au push des séances (spec brique 3 §5.3, D3, D17, rulings R15 et R24) et suppression en
 * cascade des enfants d'une séance (R-SYN-6).
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-10-06T10:00:00.000Z';
const MINUTE = 60_000;

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(o: { birthDate?: string } = {}): Promise<Member> {
  ctx = await createTestContext({ now: NOW });
  await seedSheet(ctx, sheetFixture('goblet-squat'));
  return createUserAndLogin(ctx, o.birthDate ? { birthDate: o.birthDate } : {});
}

const rowOf = (table: string, id: string) =>
  ctx.deps.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
const rowsOf = (table: string) => ctx.deps.sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];
const codes = (body: { results: Row[] }) => body.results.map((r) => r.code ?? r.status);

const patch = (u: { id: string }, entity: string, id: string, fields: Record<string, unknown>) =>
  makeOp({ userId: u.id, entity, id, kind: 'patch', fields });

describe('workout_session au push', () => {
  it('création idempotente : un opId rejoué est duplicate, un second create du même id est sans effet', async () => {
    const a = await setup();
    const { ops, sessionId } = sessionOps(a.id, { status: 'in_progress', endedAt: null });
    const first = await syncPush(ctx, a.cookie, ops);
    expect(first.body.results[0]).toMatchObject({ status: 'applied' });
    const again = await syncPush(ctx, a.cookie, ops);
    expect(again.body.results[0]).toMatchObject({ status: 'duplicate', rev: first.body.results[0].rev });
    const recreate = sessionOps(a.id, { id: sessionId, status: 'completed' }).ops;
    const third = await syncPush(ctx, a.cookie, recreate);
    expect(third.body.results[0]).toMatchObject({ status: 'applied', rev: first.body.results[0].rev });
    expect(rowsOf('workout_session')).toHaveLength(1);
    expect(rowOf('workout_session', sessionId)?.status).toBe('in_progress');
  });

  it("instance ou lieu d'un autre membre → forbidden_reference ; au patch, lieu contrôlé et instance ignorée", async () => {
    const a = await setup();
    const b = await createUserAndLogin(ctx);
    const theirInstance = await enroll(ctx, b.id, templateFixture('t'));
    const theirPlace = (await insertFixtureRow(ctx.deps.db, 'place', { ownerId: b.id })).id as string;
    const own = sessionOps(a.id);
    const res = await syncPush(ctx, a.cookie, [
      sessionOps(a.id, { instanceId: theirInstance }).ops[0],
      sessionOps(a.id, { placeId: theirPlace }).ops[0],
      own.ops[0],
      patch(a, 'workout_session', own.sessionId, { instanceId: theirInstance }),
      patch(a, 'workout_session', own.sessionId, { placeId: theirPlace }),
    ]);
    expect(codes(res.body)).toEqual([
      'forbidden_reference',
      'forbidden_reference',
      'applied',
      'applied',
      'forbidden_reference',
    ]);
    expect(rowsOf('sync_rejection').map((r) => r.code)).toEqual(Array(3).fill('forbidden_reference'));
    expect(rowOf('workout_session', own.sessionId)).toMatchObject({ instance_id: null, place_id: null });
  });

  it('instance et lieu inconnus, ou lieu supprimé : séance acceptée, non rejouée', async () => {
    const a = await setup();
    const deletedPlace = await insertFixtureRow(ctx.deps.db, 'place', {
      ownerId: a.id,
      deletedAt: '2026-10-01T10:00:00.000Z',
    });
    const unknown = sessionOps(a.id, { instanceId: newId(), placeId: newId(), exercises: [{}] });
    const deleted = sessionOps(a.id, { placeId: deletedPlace.id as string });
    const res = await syncPush(ctx, a.cookie, [...unknown.ops, ...deleted.ops]);
    expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
    expect(rowsOf('workout_session')).toHaveLength(2);
    expect(rowsOf('slot_state')).toEqual([]);
    expect(rowsOf('engine_decision')).toEqual([]);
  });

  it("profile 'adult' d'un mineur → stocké 'cautious' ; un patch de profile est ignoré", async () => {
    const minor = await setup({ birthDate: '2010-03-01' });
    const adult = await createUserAndLogin(ctx);
    const m = sessionOps(minor.id, { profile: 'adult' });
    const x = sessionOps(adult.id, { profile: 'adult' });
    await syncPush(ctx, minor.cookie, m.ops);
    await syncPush(ctx, adult.cookie, x.ops);
    expect(rowOf('workout_session', m.sessionId)?.profile).toBe('cautious');
    expect(rowOf('workout_session', x.sessionId)?.profile).toBe('adult');

    const res = await syncPush(ctx, minor.cookie, [
      patch(minor, 'workout_session', m.sessionId, { profile: 'adult', note: 'ok' }),
    ]);
    expect(res.body.results[0].status).toBe('applied');
    expect(rowOf('workout_session', m.sessionId)).toMatchObject({ profile: 'cautious', note: 'ok' });
    await syncPush(ctx, adult.cookie, [
      patch(adult, 'workout_session', x.sessionId, { profile: 'cautious' }),
    ]);
    expect(rowOf('workout_session', x.sessionId)?.profile).toBe('adult');
  });

  it('completed ou abandoned → in_progress, completed → abandoned : invalid_transition (R33)', async () => {
    const a = await setup();
    const running = sessionOps(a.id, { status: 'in_progress', endedAt: null });
    const done = sessionOps(a.id, { status: 'completed' });
    const dropped = sessionOps(a.id, { status: 'abandoned' });
    await syncPush(ctx, a.cookie, [...running.ops, ...done.ops, ...dropped.ops]);
    const res = await syncPush(ctx, a.cookie, [
      patch(a, 'workout_session', done.sessionId, { status: 'in_progress' }),
      patch(a, 'workout_session', dropped.sessionId, { status: 'in_progress', note: 'retour' }),
      patch(a, 'workout_session', running.sessionId, { status: 'completed', endedAt: dayAt(0, 1) }),
      patch(a, 'workout_session', done.sessionId, { status: 'abandoned', note: 'fermée' }),
    ]);
    expect(codes(res.body)).toEqual([
      'invalid_transition',
      'invalid_transition',
      'applied',
      'invalid_transition',
    ]);
    expect(rowOf('workout_session', dropped.sessionId)).toMatchObject({ status: 'abandoned', note: null });
    expect(rowOf('workout_session', running.sessionId)?.status).toBe('completed');
    expect(rowOf('workout_session', done.sessionId)).toMatchObject({ status: 'completed', note: null });
  });

  it('abandoned → completed admis : un appareil termine une séance qu’un autre a close comme oubliée (R33)', async () => {
    const a = await setup();
    const stale = sessionOps(a.id, { status: 'abandoned' });
    await syncPush(ctx, a.cookie, stale.ops);
    const res = await syncPush(ctx, a.cookie, [
      patch(a, 'workout_session', stale.sessionId, { status: 'completed', endedAt: dayAt(0, 1) }),
    ]);
    expect(codes(res.body)).toEqual(['applied']);
    expect(rowOf('workout_session', stale.sessionId)?.status).toBe('completed');
  });

  it('started_at à plus de 10 min dans le futur → ramené à maintenant, ended_at décalé d’autant (R24)', async () => {
    const a = await setup();
    const future = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
    const late = sessionOps(a.id, { startedAt: future(60 * MINUTE), endedAt: future(65 * MINUTE) });
    // Décalée, la fin resterait à 30 min dans le futur : elle est ramenée à maintenant elle aussi.
    const long = sessionOps(a.id, { startedAt: future(60 * MINUTE), endedAt: future(90 * MINUTE) });
    const near = sessionOps(a.id, { startedAt: future(9 * MINUTE), endedAt: null, status: 'in_progress' });
    await syncPush(ctx, a.cookie, [...late.ops, ...long.ops, ...near.ops]);
    expect(rowOf('workout_session', late.sessionId)).toMatchObject({
      started_at: NOW,
      ended_at: future(5 * MINUTE),
    });
    expect(rowOf('workout_session', long.sessionId)).toMatchObject({ started_at: NOW, ended_at: NOW });
    expect(rowOf('workout_session', near.sessionId)).toMatchObject({
      started_at: future(9 * MINUTE),
      ended_at: null,
    });
  });

  it('started_at non modifiable après création ; ended_at jamais à plus de 10 min dans le futur', async () => {
    const a = await setup();
    const s = sessionOps(a.id, { status: 'in_progress', endedAt: null });
    await syncPush(ctx, a.cookie, s.ops);
    const res = await syncPush(ctx, a.cookie, [
      patch(a, 'workout_session', s.sessionId, {
        startedAt: dayAt(3),
        endedAt: '2026-10-08T10:00:00.000Z',
        status: 'completed',
      }),
    ]);
    expect(res.body.results[0].status).toBe('applied');
    expect(rowOf('workout_session', s.sessionId)).toMatchObject({
      started_at: dayAt(0),
      ended_at: NOW,
      status: 'completed',
    });
  });

  it('ended_at ramené à maintenant, jamais avant started_at (R24 bis)', async () => {
    const a = await setup();
    const future = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
    const created = sessionOps(a.id, { startedAt: future(9 * MINUTE), endedAt: future(60 * MINUTE) });
    const running = sessionOps(a.id, { startedAt: future(5 * MINUTE), endedAt: null, status: 'in_progress' });
    await syncPush(ctx, a.cookie, [...created.ops, ...running.ops]);
    expect(rowOf('workout_session', created.sessionId)).toMatchObject({
      started_at: future(9 * MINUTE),
      ended_at: future(9 * MINUTE),
    });
    await syncPush(ctx, a.cookie, [
      patch(a, 'workout_session', running.sessionId, {
        endedAt: '2026-10-08T10:00:00.000Z',
        status: 'completed',
      }),
    ]);
    expect(rowOf('workout_session', running.sessionId)).toMatchObject({
      started_at: future(5 * MINUTE),
      ended_at: future(5 * MINUTE),
    });
  });

  it('started_at ou ended_at qui ne sont pas des instants ISO → validation', async () => {
    const a = await setup();
    const bad = sessionOps(a.id, { startedAt: 'hier soir', endedAt: null, status: 'in_progress' });
    const s = sessionOps(a.id);
    await syncPush(ctx, a.cookie, s.ops);
    const res = await syncPush(ctx, a.cookie, [
      bad.ops[0],
      patch(a, 'workout_session', s.sessionId, { endedAt: 42 }),
    ]);
    expect(codes(res.body)).toEqual(['validation', 'validation']);
  });

  it('séance supprimée : ses exercices et ses séries supprimés logiquement, chacun avec un rev neuf (R-SYN-6)', async () => {
    const a = await setup();
    const s = sessionOps(a.id, { exercises: [{}, {}] });
    await syncPush(ctx, a.cookie, s.ops);
    const before = Math.max(...rowsOf('performed_set').map((r) => r.rev as number));
    const res = await syncPush(ctx, a.cookie, [
      makeOp({ userId: a.id, entity: 'workout_session', id: s.sessionId, kind: 'delete' }),
    ]);
    expect(res.body.results[0].status).toBe('applied');
    const children = [...rowsOf('performed_exercise'), ...rowsOf('performed_set')];
    expect(children).toHaveLength(8);
    expect(children.every((r) => r.deleted_at !== null && (r.rev as number) > before)).toBe(true);
    expect(new Set(children.map((r) => r.rev)).size).toBe(children.length);
  });
});

describe('rattachements immuables après la création (ruling R30)', () => {
  it("session_id d'un exercice et performed_exercise_id d'une série ignorés d'un patch, sans rejet ; le reste s'applique", async () => {
    const a = await setup();
    const b = await createUserAndLogin(ctx);
    const s1 = sessionOps(a.id, { exercises: [{}] });
    const s2 = sessionOps(a.id, { exercises: [{}] });
    const theirs = sessionOps(b.id, { exercises: [{}] });
    await syncPush(ctx, a.cookie, [...s1.ops, ...s2.ops]);
    await syncPush(ctx, b.cookie, theirs.ops);
    const exercise = s1.exerciseIds[0] ?? '';
    const set = s1.setIds[0]?.[0] ?? '';
    const res = await syncPush(ctx, a.cookie, [
      patch(a, 'performed_exercise', exercise, { sessionId: s2.sessionId, note: 'déplacé ?' }),
      patch(a, 'performed_exercise', exercise, { sessionId: theirs.sessionId }),
      patch(a, 'performed_exercise', exercise, { sessionId: newId() }),
      patch(a, 'performed_set', set, { performedExerciseId: s2.exerciseIds[0], reps: 9 }),
      patch(a, 'performed_set', set, { performedExerciseId: theirs.exerciseIds[0] }),
    ]);
    expect(codes(res.body)).toEqual(Array(5).fill('applied'));
    expect(rowOf('performed_exercise', exercise)).toMatchObject({
      session_id: s1.sessionId,
      note: 'déplacé ?',
    });
    expect(rowOf('performed_set', set)).toMatchObject({ performed_exercise_id: exercise, reps: 9 });
    expect(rowsOf('sync_rejection')).toEqual([]);
  });

  it('instance_id ignoré d’un patch, lieu modifiable', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, templateFixture('t'));
    const place = (await insertFixtureRow(ctx.deps.db, 'place', { ownerId: a.id })).id as string;
    const s = sessionOps(a.id, { instanceId });
    await syncPush(ctx, a.cookie, s.ops);
    const res = await syncPush(ctx, a.cookie, [
      patch(a, 'workout_session', s.sessionId, { instanceId: null, placeId: place }),
    ]);
    expect(res.body.results[0].status).toBe('applied');
    expect(rowOf('workout_session', s.sessionId)).toMatchObject({ instance_id: instanceId, place_id: place });
  });
});

describe('performed_exercise au push', () => {
  it('exercise_id inconnu, en brouillon ou retiré sans avoir été publié → unknown_exercise ; publié ou retiré admis', async () => {
    const a = await setup();
    await insertFixtureRow(ctx.deps.db, 'exercise', { id: 'draft-squat' });
    await seedSheet(ctx, retiredDraft('ghost-squat'));
    await seedSheet(
      ctx,
      sheetFixture('old-squat', { status: 'retired', retired_at: '2026-10-01T08:00:00.000Z' }),
    );
    const s = sessionOps(a.id, {
      exercises: [
        { exerciseId: 'no-such-sheet', sets: [] },
        { exerciseId: 'draft-squat', sets: [] },
        { exerciseId: 'old-squat', sets: [] },
        { exerciseId: 'goblet-squat', sets: [] },
        { exerciseId: 'ghost-squat', sets: [] },
      ],
    });
    const res = await syncPush(ctx, a.cookie, s.ops);
    expect(codes(res.body)).toEqual([
      'applied',
      'unknown_exercise',
      'unknown_exercise',
      'applied',
      'applied',
      'unknown_exercise',
    ]);
    const swap = await syncPush(ctx, a.cookie, [
      patch(a, 'performed_exercise', s.exerciseIds[3] ?? '', { exerciseId: 'draft-squat' }),
    ]);
    expect(codes(swap.body)).toEqual(['unknown_exercise']);
  });

  it('pain_level sans consentement santé → applied_partial, NULL en base, ajustement gardé', async () => {
    const a = await setup();
    const s = sessionOps(a.id, {
      exercises: [
        { painLevel: 'pain', nextAdjustment: 'lighten', sets: [] },
        { painLevel: 'pain', sets: [] },
      ],
    });
    const res = await syncPush(ctx, a.cookie, s.ops);
    expect(res.body.results[1]).toMatchObject({ status: 'applied_partial', droppedFields: ['painLevel'] });
    expect(rowOf('performed_exercise', s.exerciseIds[0] ?? '')).toMatchObject({
      pain_level: null,
      next_adjustment: 'lighten',
    });
    // Aucune trace de la douleur, pas même un ajustement déduit (ruling R15 après le filtre C2).
    expect(rowOf('performed_exercise', s.exerciseIds[1] ?? '')).toMatchObject({
      pain_level: null,
      next_adjustment: null,
    });
    expect(rowsOf('sync_rejection')).toEqual([]);
  });

  it('douleur sans ajustement → hold (gêne) ou lighten (douleur), à la création comme au patch (R15)', async () => {
    const a = await setup();
    await grantHealth(ctx, a.id);
    const s = sessionOps(a.id, {
      exercises: [
        { painLevel: 'discomfort', sets: [] },
        { painLevel: 'pain', nextAdjustment: null, sets: [] },
        { painLevel: 'pain', nextAdjustment: 'hold', sets: [] },
        { painLevel: 'none', sets: [] },
        { sets: [] },
      ],
    });
    await syncPush(ctx, a.cookie, s.ops);
    const adjustment = (i: number) => rowOf('performed_exercise', s.exerciseIds[i] ?? '')?.next_adjustment;
    expect([0, 1, 2, 3].map(adjustment)).toEqual(['hold', 'lighten', 'hold', null]);

    await syncPush(ctx, a.cookie, [
      patch(a, 'performed_exercise', s.exerciseIds[4] ?? '', { painLevel: 'pain' }),
      patch(a, 'performed_exercise', s.exerciseIds[0] ?? '', { nextAdjustment: null }),
    ]);
    expect(adjustment(4)).toBe('lighten');
    expect(adjustment(0)).toBe('hold');
  });
});

describe('performed_set au push', () => {
  it('bornes de la série : hors bornes → out_of_range, bornes admises', async () => {
    const a = await setup();
    const s = sessionOps(a.id, { exercises: [{ sets: [] }] });
    await syncPush(ctx, a.cookie, s.ops);
    const set = (fields: Record<string, unknown>) =>
      makeOp({
        userId: a.id,
        entity: 'performed_set',
        id: newId(),
        kind: 'create',
        fields: {
          performedExerciseId: s.exerciseIds[0],
          position: 1,
          kind: 'work',
          loadMode: 'dumbbell',
          loadG: 20_000,
          reps: 10,
          ...fields,
        },
      });
    const ok = set({ reps: 200, loadG: 500_000, position: 99 });
    const res = await syncPush(ctx, a.cookie, [
      set({ reps: 201 }),
      set({ loadG: 500_001 }),
      set({ loadG: -1 }),
      set({ reps: null, durationS: 7201 }),
      set({ position: 0 }),
      set({ position: 100 }),
      ok,
      set({ reps: 0, loadG: 0, position: 1 }),
      set({ reps: null, durationS: 7200 }),
      patch(a, 'performed_set', ok.id, { reps: 250 }),
    ]);
    expect(codes(res.body)).toEqual([
      ...Array(6).fill('out_of_range'),
      'applied',
      'applied',
      'applied',
      'out_of_range',
    ]);
    expect(rowOf('performed_set', ok.id)?.reps).toBe(200);
  });

  it('répétitions visées copiées au démarrage (ruling R57) : écrites avec la fourchette', async () => {
    const a = await setup();
    const s = sessionOps(a.id, { exercises: [{ sets: [] }] });
    await syncPush(ctx, a.cookie, s.ops);
    const op = makeOp({
      userId: a.id,
      entity: 'performed_set',
      id: newId(),
      kind: 'create',
      fields: {
        performedExerciseId: s.exerciseIds[0],
        position: 1,
        kind: 'work',
        loadMode: 'bodyweight',
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetReps: 10,
      },
    });
    expect(codes((await syncPush(ctx, a.cookie, [op])).body)).toEqual(['applied']);
    expect(rowOf('performed_set', op.id)).toMatchObject({
      target_reps_min: 8,
      target_reps_max: 12,
      target_reps: 10,
    });
  });
});

const del = (u: { id: string }, entity: string, id: string) =>
  makeOp({ userId: u.id, entity, id, kind: 'delete' });

describe('logged_at au push (M4)', () => {
  it('logged_at qui n’est pas un instant ISO → validation, à la création comme au patch ; null ou instant admis', async () => {
    const a = await setup();
    const s = sessionOps(a.id, { exercises: [{ sets: [{ logged: false }] }] });
    await syncPush(ctx, a.cookie, s.ops);
    const setId = s.setIds[0]?.[0] ?? '';
    const create = (loggedAt: unknown) =>
      makeOp({
        userId: a.id,
        entity: 'performed_set',
        id: newId(),
        kind: 'create',
        fields: {
          performedExerciseId: s.exerciseIds[0],
          position: 2,
          kind: 'work',
          loadMode: 'dumbbell',
          loadG: 20_000,
          reps: 10,
          loggedAt,
        },
      });
    const res = await syncPush(ctx, a.cookie, [
      create('hier soir'),
      create(42),
      patch(a, 'performed_set', setId, { loggedAt: '2026-10-06 09:00' }),
      patch(a, 'performed_set', setId, { loggedAt: '2026-10-06T09:00:00.000Z' }),
      patch(a, 'performed_set', setId, { loggedAt: null }),
    ]);
    expect(codes(res.body)).toEqual(['validation', 'validation', 'validation', 'applied', 'applied']);
    expect(rowsOf('performed_set')).toHaveLength(1);
    expect(rowOf('performed_set', setId)?.logged_at).toBeNull();
  });
});

describe('série faite jamais supprimée par un appareil en retard (ruling R49)', () => {
  it('delete d’une série faite d’une séance vivante : ignoré, ligne gardée avec un rev neuf ; série jamais faite supprimée', async () => {
    const a = await setup();
    const running = sessionOps(a.id, {
      status: 'in_progress',
      endedAt: null,
      exercises: [{ sets: [{}, { logged: false }] }],
    });
    const closed = sessionOps(a.id, { exercises: [{ sets: [{}] }] });
    await syncPush(ctx, a.cookie, [...running.ops, ...closed.ops]);
    const [done, open] = running.setIds[0] ?? [];
    const [closedDone] = closed.setIds[0] ?? [];
    if (!done || !open || !closedDone) throw new Error('séries absentes');
    const before = Math.max(...rowsOf('performed_set').map((r) => r.rev as number));

    const res = await syncPush(ctx, a.cookie, [
      del(a, 'performed_set', done),
      del(a, 'performed_set', open),
      del(a, 'performed_set', closedDone),
    ]);
    expect(codes(res.body)).toEqual(['applied', 'applied', 'applied']);
    for (const [i, id] of [done, closedDone].entries()) {
      const row = rowOf('performed_set', id);
      expect(row).toMatchObject({ deleted_at: null, logged_at: dayAt(0), load_g: 20_000 });
      expect(row?.rev as number).toBeGreaterThan(before);
      expect(res.body.results[i === 0 ? 0 : 2].rev).toBe(row?.rev);
    }
    expect(rowOf('performed_set', open)?.deleted_at).not.toBeNull();
    expect(rowsOf('sync_rejection')).toEqual([]);
  });

  it('delete d’un exercice qui porte une série faite vivante d’une séance vivante (« Changer de lieu » en retard) : ignoré, rev neuf, quel que soit l’ordre du lot ; exercice sans série faite vivante supprimé', async () => {
    const a = await setup();
    const running = sessionOps(a.id, {
      status: 'in_progress',
      endedAt: null,
      exercises: [
        { sets: [{}, { logged: false }] },
        { sets: [{ logged: false }] },
        // Échauffement fait : compte comme une série faite (même règle que `sets_done` sur le téléphone).
        { sets: [{ kind: 'warmup' }, { logged: false }] },
        // Seule série faite déjà supprimée (cascade d'une restauration, par exemple) : ne garde rien.
        { sets: [{}] },
      ],
    });
    const closed = sessionOps(a.id, { exercises: [{ sets: [{}] }] });
    await syncPush(ctx, a.cookie, [...running.ops, ...closed.ops]);
    const [done, open, warmup, gone] = running.exerciseIds;
    const [closedDone] = closed.exerciseIds;
    if (!done || !open || !warmup || !gone || !closedDone) throw new Error('exercices absents');
    ctx.deps.sqlite
      .prepare('UPDATE performed_set SET deleted_at = ? WHERE id = ?')
      .run(dayAt(0), running.setIds[3]?.[0] ?? '');
    const before = Math.max(...rowsOf('performed_exercise').map((r) => r.rev as number));

    // Exercices d'abord, séries ensuite : la garde lit l'état des séries, l'ordre du lot ne change rien (`changePlace`
    // envoie l'ordre inverse, couvert par workout-two-devices.test.ts).
    const exercises = [done, open, warmup, gone, closedDone];
    const res = await syncPush(ctx, a.cookie, [
      ...exercises.map((id) => del(a, 'performed_exercise', id)),
      ...running.setIds
        .slice(0, 3)
        .flat()
        .map((id) => del(a, 'performed_set', id)),
    ]);
    expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
    for (const [i, id] of exercises.entries()) {
      const row = rowOf('performed_exercise', id);
      expect(res.body.results[i].rev, id).toBe(row?.rev);
      if (id === open || id === gone) {
        expect(row?.deleted_at, id).not.toBeNull();
        continue;
      }
      expect(row).toMatchObject({ deleted_at: null, exercise_id: 'goblet-squat' });
      expect(row?.rev as number).toBeGreaterThan(before);
    }
    // Les séries faites restent sous leur exercice ; les séries jamais faites partent.
    const live = (exerciseId: string) =>
      rowsOf('performed_set')
        .filter((r) => r.performed_exercise_id === exerciseId && r.deleted_at === null)
        .map((r) => r.id);
    expect(live(done)).toEqual([running.setIds[0]?.[0]]);
    expect(live(warmup)).toEqual([running.setIds[2]?.[0]]);
    expect(live(open)).toEqual([]);
    expect(rowsOf('sync_rejection')).toEqual([]);
  });

  it('« Supprimer la séance » : ses séries faites partent avec elle, même quand leurs delete arrivent avant celui de la séance', async () => {
    const a = await setup();
    const s = sessionOps(a.id, { exercises: [{}, { sets: [{}, { logged: false }] }] });
    await syncPush(ctx, a.cookie, s.ops);
    const res = await syncPush(ctx, a.cookie, [
      ...s.setIds.flat().map((id) => del(a, 'performed_set', id)),
      ...s.exerciseIds.map((id) => del(a, 'performed_exercise', id)),
      del(a, 'workout_session', s.sessionId),
    ]);
    expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
    const rows = [...rowsOf('workout_session'), ...rowsOf('performed_exercise'), ...rowsOf('performed_set')];
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.deleted_at !== null)).toBe(true);
  });
});

describe('D4 appliquée par le serveur (ruling R51)', () => {
  it('séance abandoned qui reçoit une série de travail faite → completed (rev neuf, fin à la dernière série faite), puis rejouée', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, templateFixture('t'));
    const s = sessionOps(a.id, {
      instanceId,
      status: 'abandoned',
      endedAt: dayAt(0, 0.5),
      exercises: [{ sets: [{ logged: false }, { logged: false }] }],
    });
    await syncPush(ctx, a.cookie, s.ops);
    expect(rowOf('workout_session', s.sessionId)?.status).toBe('abandoned');
    expect(rowsOf('engine_decision')).toEqual([]);
    const before = rowOf('workout_session', s.sessionId)?.rev as number;

    const [first, second] = s.setIds[0] ?? [];
    const res = await syncPush(ctx, a.cookie, [
      patch(a, 'performed_set', first ?? '', { loggedAt: dayAt(0, 1) }),
      patch(a, 'performed_set', second ?? '', { loggedAt: dayAt(0, 0.75) }),
    ]);
    expect(codes(res.body)).toEqual(['applied', 'applied']);
    const session = rowOf('workout_session', s.sessionId);
    expect(session).toMatchObject({ status: 'completed', ended_at: dayAt(0, 1) });
    expect(session?.rev as number).toBeGreaterThan(before);
    expect(rowsOf('engine_decision').map((r) => [r.id, r.deleted_at])).toEqual([[s.exerciseIds[0], null]]);
  });

  it('la fin gardée si elle est plus tardive ; promue dans le lot qui la clôt abandoned', async () => {
    const a = await setup();
    const s = sessionOps(a.id, { status: 'in_progress', endedAt: null, exercises: [{}] });
    await syncPush(ctx, a.cookie, s.ops);
    await syncPush(ctx, a.cookie, [
      patch(a, 'workout_session', s.sessionId, { status: 'abandoned', endedAt: dayAt(0, 2) }),
    ]);
    expect(rowOf('workout_session', s.sessionId)).toMatchObject({
      status: 'completed',
      ended_at: dayAt(0, 2),
    });
  });

  it('reste abandoned : échauffement seul fait, série faite d’un exercice supprimé, séance supprimée ; une séance en cours reste en cours', async () => {
    const a = await setup();
    const warmup = sessionOps(a.id, {
      status: 'abandoned',
      exercises: [{ sets: [{ kind: 'warmup' }, { logged: false }] }],
    });
    const orphan = sessionOps(a.id, { status: 'abandoned', exercises: [{}] });
    const running = sessionOps(a.id, { status: 'in_progress', endedAt: null, exercises: [{}] });
    const removed = sessionOps(a.id, { status: 'abandoned', exercises: [{}] });
    const sets = (ops: typeof orphan.ops) => ops.filter((o) => o.entity === 'performed_set');
    await syncPush(ctx, a.cookie, [
      ...warmup.ops,
      ...running.ops,
      // Exercice supprimé avant que ses séries faites arrivent.
      ...orphan.ops.filter((o) => o.entity !== 'performed_set'),
      del(a, 'performed_exercise', orphan.exerciseIds[0] ?? ''),
      // Séance supprimée dans le lot qui l'apporte.
      ...removed.ops,
      del(a, 'workout_session', removed.sessionId),
    ]);
    await syncPush(ctx, a.cookie, [
      ...sets(orphan.ops),
      patch(a, 'workout_session', warmup.sessionId, { note: 'touchée' }),
      patch(a, 'workout_session', running.sessionId, { note: 'touchée' }),
    ]);
    expect(rowOf('workout_session', warmup.sessionId)).toMatchObject({
      status: 'abandoned',
      note: 'touchée',
    });
    expect(rowOf('workout_session', orphan.sessionId)?.status).toBe('abandoned');
    expect(rowOf('performed_set', orphan.setIds[0]?.[0] ?? '')?.deleted_at).toBeNull();
    expect(rowOf('workout_session', running.sessionId)).toMatchObject({
      status: 'in_progress',
      note: 'touchée',
    });
    expect(rowOf('workout_session', removed.sessionId)).toMatchObject({ status: 'abandoned' });
    expect(rowOf('workout_session', removed.sessionId)?.deleted_at).not.toBeNull();
  });
});
