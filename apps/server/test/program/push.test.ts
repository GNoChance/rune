import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  makeOp,
  syncPush,
  type TestContext,
} from '../support';
import { sheetFixture, templateFixture } from '../support/catalog';
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

  it("instance ou lieu d'un autre membre → forbidden_reference, à la création comme au patch", async () => {
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
      'forbidden_reference',
      'forbidden_reference',
    ]);
    expect(rowsOf('sync_rejection').map((r) => r.code)).toEqual(Array(4).fill('forbidden_reference'));
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

  it('completed ou abandoned → in_progress : invalid_transition ; in_progress → completed admis', async () => {
    const a = await setup();
    const running = sessionOps(a.id, { status: 'in_progress', endedAt: null });
    const done = sessionOps(a.id, { status: 'completed' });
    const dropped = sessionOps(a.id, { status: 'abandoned' });
    await syncPush(ctx, a.cookie, [...running.ops, ...done.ops, ...dropped.ops]);
    const res = await syncPush(ctx, a.cookie, [
      patch(a, 'workout_session', done.sessionId, { status: 'in_progress' }),
      patch(a, 'workout_session', dropped.sessionId, { status: 'in_progress', note: 'retour' }),
      patch(a, 'workout_session', running.sessionId, { status: 'completed', endedAt: dayAt(0, 1) }),
      patch(a, 'workout_session', done.sessionId, { status: 'abandoned' }),
    ]);
    expect(codes(res.body)).toEqual(['invalid_transition', 'invalid_transition', 'applied', 'applied']);
    expect(rowOf('workout_session', dropped.sessionId)).toMatchObject({ status: 'abandoned', note: null });
    expect(rowOf('workout_session', running.sessionId)?.status).toBe('completed');
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

describe('performed_exercise au push', () => {
  it('exercise_id inconnu ou en brouillon → unknown_exercise ; publié ou retiré admis', async () => {
    const a = await setup();
    await insertFixtureRow(ctx.deps.db, 'exercise', { id: 'draft-squat' });
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
      ],
    });
    const res = await syncPush(ctx, a.cookie, s.ops);
    expect(codes(res.body)).toEqual([
      'applied',
      'unknown_exercise',
      'unknown_exercise',
      'applied',
      'applied',
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
});
