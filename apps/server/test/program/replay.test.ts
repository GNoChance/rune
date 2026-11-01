import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger';
import { replayInstanceInDb, uuidFromKey } from '../../src/program/replay-service';
import { syncPurgeJob } from '../../src/sync/purge';
import { createTestContext, createUserAndLogin, makeOp, syncPush, type TestContext } from '../support';
import { sheetFixture, templateFixture } from '../support/catalog';
import {
  dayAt,
  type ExerciseSpec,
  enroll,
  grantHealth,
  type SessionSpec,
  sessionOps,
} from '../support/program';
import { seedSheet } from '../support/review';

/*
 * Rejeu de l'instance par le serveur dans la transaction du push (spec brique 3 §4.4, §5.3, R-SYN-19) : écriture
 * minimale, suppressions logiques, surcharge du pas de machine, événements du moteur (rulings R27), purge.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-10-06T10:00:00.000Z';
const DAY = 86_400_000;
const TEMPLATE = templateFixture('test-full-body');
const TWO_SLOTS = templateFixture('test-two-slots', [
  { exercises: ['goblet-squat'] },
  { exercises: ['split-squat'] },
]);

let ctx: TestContext;
let lines: string[];
afterEach(() => ctx?.close());

async function setup(): Promise<Member> {
  lines = [];
  ctx = await createTestContext({ now: NOW, deps: { logger: createLogger((l) => lines.push(l)) } });
  await seedSheet(ctx, sheetFixture('goblet-squat'));
  await seedSheet(ctx, sheetFixture('split-squat'));
  return createUserAndLogin(ctx);
}

const rowOf = (table: string, id: string) =>
  ctx.deps.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
const rowsOf = (table: string, where = '1 = 1') =>
  ctx.deps.sqlite.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`).all() as Row[];
const revsOf = (table: string) => rowsOf(table).map((r) => [r.id, r.rev, r.deleted_at]);

async function push(u: Member, spec: SessionSpec) {
  const s = sessionOps(u.id, spec);
  const res = await syncPush(ctx, u.cookie, s.ops);
  expect(res.status).toBe(200);
  expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
  return s;
}

/** Les deux slots de `TWO_SLOTS` : squat goblet en A1, squat fendu en A2. */
const both = (a: ExerciseSpec = {}, b: ExerciseSpec = {}): ExerciseSpec[] => [
  a,
  { exerciseId: 'split-squat', ...b },
];

const deleteSession = (u: Member, id: string) =>
  syncPush(ctx, u.cookie, [makeOp({ userId: u.id, entity: 'workout_session', id, kind: 'delete' })]);
const noteOn = (u: Member, id: string, note: string) =>
  syncPush(ctx, u.cookie, [
    makeOp({ userId: u.id, entity: 'workout_session', id, kind: 'patch', fields: { note } }),
  ]);

describe('rejeu au push', () => {
  it('une séance terminée → slot_state et engine_decision écrits', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const s = await push(a, { instanceId, exercises: [{}] });

    expect(rowsOf('slot_state')).toEqual([
      expect.objectContaining({
        id: `${instanceId}:A1:goblet-squat`,
        owner_id: a.id,
        instance_id: instanceId,
        slot_id: 'A1',
        exercise_id: 'goblet-squat',
        mode: 'double',
        last_session_id: s.sessionId,
        rules_version: '1',
        pain_streak: null,
        suspended: 0,
        deleted_at: null,
      }),
    ]);
    const decision = rowOf('engine_decision', s.exerciseIds[0] ?? '');
    expect(decision).toMatchObject({
      owner_id: a.id,
      instance_id: instanceId,
      slot_id: 'A1',
      exercise_id: 'goblet-squat',
      result: 'CALIBRATION',
      profile: 'adult',
      rules_version: '1',
      deleted_at: null,
    });
    expect(JSON.parse(decision?.next_target as string)).toMatchObject({ mode: 'double', workSets: 3 });
  });

  it('séance en cours ou séance libre : rien de rejoué', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    await push(a, { instanceId, status: 'in_progress', endedAt: null, exercises: [{}] });
    await push(a, { instanceId: null, exercises: [{}] });
    expect(rowsOf('slot_state')).toEqual([]);
    expect(rowsOf('engine_decision')).toEqual([]);
  });

  it('lot qui ne touche que des séances en cours vivantes : rejeu évité ; il reprend dès qu’une séance terminée est touchée', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const stateId = `${instanceId}:A1:goblet-squat`;
    const done = await push(a, { instanceId, startedAt: dayAt(0), exercises: [{}] });
    const expected = rowOf('slot_state', stateId)?.load_g;
    // État altéré à la main : un rejeu le réécrirait aussitôt.
    ctx.deps.sqlite.prepare('UPDATE slot_state SET load_g = 1234 WHERE id = ?').run(stateId);
    ctx.deps.sqlite.prepare("UPDATE engine_decision SET reason_code = 'NO_DATA'").run();
    const before = [revsOf('slot_state'), revsOf('engine_decision')];

    const running = await push(a, {
      instanceId,
      startedAt: dayAt(2),
      status: 'in_progress',
      endedAt: null,
      exercises: [{ sets: [{ logged: false }, { logged: false }] }],
    });
    const set = running.setIds[0]?.[0] ?? '';
    await syncPush(ctx, a.cookie, [
      makeOp({
        userId: a.id,
        entity: 'performed_set',
        id: set,
        kind: 'patch',
        fields: { loggedAt: dayAt(2) },
      }),
    ]);
    expect([revsOf('slot_state'), revsOf('engine_decision')]).toEqual(before);
    expect(rowOf('slot_state', stateId)?.load_g).toBe(1234);

    await noteOn(a, done.sessionId, 'touchée');
    expect(rowOf('slot_state', stateId)?.load_g).toBe(expected);
    expect(rowOf('engine_decision', done.exerciseIds[0] ?? '')?.reason_code).not.toBe('NO_DATA');
  });

  it('séance en cours supprimée : rejeu fait', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const stateId = `${instanceId}:A1:goblet-squat`;
    await push(a, { instanceId, startedAt: dayAt(0), exercises: [{}] });
    const running = await push(a, { instanceId, startedAt: dayAt(2), status: 'in_progress', endedAt: null });
    ctx.deps.sqlite.prepare('UPDATE slot_state SET load_g = 1234 WHERE id = ?').run(stateId);
    await deleteSession(a, running.sessionId);
    expect(rowOf('slot_state', stateId)?.load_g).not.toBe(1234);
  });

  it('rattachement à l’instance immuable : un patch vers une autre instance ou vers null laisse les décisions intactes', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const other = await enroll(ctx, a.id, TEMPLATE, { status: 'ended' });
    const s = await push(a, { instanceId, exercises: [{}] });
    const before = [revsOf('slot_state'), revsOf('engine_decision')];
    for (const target of [other, null]) {
      const res = await syncPush(ctx, a.cookie, [
        makeOp({
          userId: a.id,
          entity: 'workout_session',
          id: s.sessionId,
          kind: 'patch',
          fields: { instanceId: target },
        }),
      ]);
      expect(res.body.results[0].status).toBe('applied');
      expect(rowOf('workout_session', s.sessionId)?.instance_id).toBe(instanceId);
    }
    expect([revsOf('slot_state'), revsOf('engine_decision')]).toEqual(before);
    expect(rowOf('engine_decision', s.exerciseIds[0] ?? '')).toMatchObject({
      instance_id: instanceId,
      deleted_at: null,
    });
  });

  it('un second push sans changement d’état → aucun nouveau rev', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const s = await push(a, { instanceId, exercises: [{}] });
    const before = [revsOf('slot_state'), revsOf('engine_decision'), revsOf('program_instance')];
    const res = await noteOn(a, s.sessionId, 'bonne séance');
    expect(res.body.results[0].status).toBe('applied');
    expect([revsOf('slot_state'), revsOf('engine_decision'), revsOf('program_instance')]).toEqual(before);
  });

  it('séance supprimée → ses décisions et ses états supprimés logiquement, avec un rev neuf', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const s1 = await push(a, { instanceId, startedAt: dayAt(0), exercises: [{}] });
    const s2 = await push(a, { instanceId, startedAt: dayAt(2), exercises: [{}] });
    const decision2 = rowOf('engine_decision', s2.exerciseIds[0] ?? '');
    const state = rowOf('slot_state', `${instanceId}:A1:goblet-squat`);
    expect(state?.last_session_id).toBe(s2.sessionId);

    await deleteSession(a, s2.sessionId);
    expect(rowOf('engine_decision', s2.exerciseIds[0] ?? '')).toMatchObject({ deleted_at: NOW });
    expect(Number(rowOf('engine_decision', s2.exerciseIds[0] ?? '')?.rev)).toBeGreaterThan(
      Number(decision2?.rev),
    );
    expect(rowOf('engine_decision', s1.exerciseIds[0] ?? '')?.deleted_at).toBeNull();
    expect(rowOf('slot_state', `${instanceId}:A1:goblet-squat`)).toMatchObject({
      last_session_id: s1.sessionId,
      deleted_at: null,
    });

    await deleteSession(a, s1.sessionId);
    expect(rowOf('engine_decision', s1.exerciseIds[0] ?? '')?.deleted_at).toBe(NOW);
    expect(rowOf('slot_state', `${instanceId}:A1:goblet-squat`)?.deleted_at).toBe(NOW);
  });

  it('surcharge du pas de machine : reprise par le rejeu, état gardé quand plus aucune séance ne le produit', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const stateId = `${instanceId}:A1:goblet-squat`;
    const s1 = await push(a, { instanceId, startedAt: dayAt(0), exercises: [{}] });
    ctx.deps.sqlite.prepare('UPDATE slot_state SET machine_step_g_override = 2500 WHERE id = ?').run(stateId);
    await push(a, { instanceId, startedAt: dayAt(2), exercises: [{}] });
    expect(rowOf('slot_state', stateId)?.machine_step_g_override).toBe(2500);

    const other = await push(a, { instanceId, startedAt: dayAt(4), exercises: [{}] });
    await deleteSession(a, other.sessionId);
    const rows = rowsOf('workout_session', 'deleted_at IS NULL').map((r) => r.id as string);
    for (const id of rows) await deleteSession(a, id);
    expect(rowOf('engine_decision', s1.exerciseIds[0] ?? '')?.deleted_at).toBe(NOW);
    expect(rowOf('slot_state', stateId)).toMatchObject({ machine_step_g_override: 2500, deleted_at: null });
  });

  it('douleur 2 fois de suite → un instance_change PAIN_SUSPEND accepté, revision + 1, une seule ligne après 3 rejeux', async () => {
    const a = await setup();
    await grantHealth(ctx, a.id);
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const pain = { painLevel: 'pain', nextAdjustment: 'lighten' } as const;
    await push(a, { instanceId, startedAt: dayAt(0), exercises: [pain] });
    const second = await push(a, {
      instanceId,
      startedAt: dayAt(2),
      endedAt: dayAt(2, 1.5),
      exercises: [pain],
    });

    const key = `engine|${instanceId}|PAIN_SUSPEND|A1|goblet-squat|${second.sessionId}`;
    const changes = rowsOf('instance_change');
    expect(changes).toEqual([
      expect.objectContaining({
        id: uuidFromKey(key),
        owner_id: a.id,
        instance_id: instanceId,
        base_revision: 0,
        author: 'engine',
        reason_code: 'PAIN_SUSPEND',
        reason: null,
        status: 'accepted',
        decided_at: dayAt(2, 1.5),
        expires_at: null,
        ai_generated: 0,
      }),
    ]);
    expect(JSON.parse(changes[0]?.operations as string)).toEqual([{ op: 'suspend_slot', slot: 'A1' }]);
    expect(rowOf('program_instance', instanceId)?.revision).toBe(1);
    expect(rowOf('slot_state', `${instanceId}:A1:goblet-squat`)).toMatchObject({
      suspended: 1,
      pain_streak: 0,
    });

    const third = await push(a, { instanceId, startedAt: dayAt(4), exercises: [{}] });
    await noteOn(a, third.sessionId, 'rejeu');
    await noteOn(a, second.sessionId, 'rejeu');
    expect(rowsOf('instance_change')).toHaveLength(1);
    expect(rowOf('program_instance', instanceId)?.revision).toBe(1);
    expect(rowOf('engine_decision', third.exerciseIds[0] ?? '')).toMatchObject({
      result: 'IGNORED',
      reason_code: 'SLOT_SUSPENDED',
    });
  });

  it('sans consentement santé : pain_streak reste NULL et aucune suspension', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const pain = { painLevel: 'pain', nextAdjustment: 'lighten' } as const;
    for (const day of [0, 2, 4]) {
      await syncPush(
        ctx,
        a.cookie,
        sessionOps(a.id, { instanceId, startedAt: dayAt(day), exercises: [pain] }).ops,
      );
    }
    expect(rowsOf('instance_change')).toEqual([]);
    expect(rowOf('slot_state', `${instanceId}:A1:goblet-squat`)).toMatchObject({
      pain_streak: null,
      suspended: 0,
    });
  });

  it('mêmes séances en un ou deux pushs → mêmes lignes', async () => {
    const a = await setup();
    const b = await createUserAndLogin(ctx);
    const easy = { sets: [{ reps: 12 }, { reps: 12 }, { reps: 12, effort: 'easy' as const }] };
    const hard = { sets: [{ reps: 8 }, { reps: 8 }, { reps: 7, effort: 'hard' as const }] };
    const specs = (instanceId: string): SessionSpec[] => [
      { instanceId, startedAt: dayAt(0), exercises: both() },
      { instanceId, startedAt: dayAt(2), exercises: both(easy) },
      { instanceId, startedAt: dayAt(4), exercises: both({}, hard) },
    ];
    const ia = await enroll(ctx, a.id, TWO_SLOTS);
    const ib = await enroll(ctx, b.id, TWO_SLOTS);
    const all = specs(ia).flatMap((spec) => sessionOps(a.id, spec).ops);
    await syncPush(ctx, a.cookie, all);
    const [late, ...early] = specs(ib).reverse();
    await syncPush(
      ctx,
      b.cookie,
      early.flatMap((spec) => sessionOps(b.id, spec).ops),
    );
    await syncPush(ctx, b.cookie, sessionOps(b.id, late ?? {}).ops);

    const strip = (instanceId: string, owner: string) => (rows: Row[]) =>
      rows.map(({ id, rev, created_at, updated_at, owner_id, instance_id, last_session_id, ...rest }) => ({
        ...rest,
        id: String(id).replace(instanceId, 'I'),
        owned: owner_id === owner && instance_id === instanceId,
        hasLast: last_session_id !== null,
      }));
    const statesA = strip(ia, a.id)(rowsOf('slot_state', `instance_id = '${ia}'`));
    const statesB = strip(ib, b.id)(rowsOf('slot_state', `instance_id = '${ib}'`));
    expect(statesA).toHaveLength(2);
    expect(statesB).toEqual(statesA);
    const decisions = (instanceId: string) =>
      ctx.deps.sqlite
        .prepare(
          `SELECT d.result, d.reason_code, d.next_target, d.slot_id FROM engine_decision d
           JOIN performed_exercise e ON e.id = d.id JOIN workout_session s ON s.id = e.session_id
           WHERE d.instance_id = ? ORDER BY s.started_at, e.position`,
        )
        .all(instanceId);
    expect(decisions(ib)).toEqual(decisions(ia));
    expect(decisions(ia)).toHaveLength(6);
  });

  it('séance aux règles inconnues du serveur : push appliqué, rejeu sauté et journalisé', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    await push(a, { instanceId, rulesVersion: '99', exercises: [{}] });
    expect(rowsOf('slot_state')).toEqual([]);
    const log = lines.map((l) => JSON.parse(l)).find((l) => l.event === 'program_replay_skipped');
    expect(log).toMatchObject({ level: 'warn', code: 'unknown_rules_version' });
  });
});

describe('événements du moteur', () => {
  /** 4 séances identiques sur 2 slots : stagnation des deux à la 4e, proposition d'allègement réactif. */
  async function stalled(a: Member, status: 'active' | 'ended' = 'active') {
    const instanceId = await enroll(ctx, a.id, TWO_SLOTS, { status });
    const sessions = [0, 2, 4, 6].map((day) =>
      sessionOps(a.id, { instanceId, startedAt: dayAt(day), exercises: both() }),
    );
    return { instanceId, sessions, key: (s: string) => `engine|${instanceId}|ENGINE_REACTIVE_DELOAD|||${s}` };
  }

  it('proposition écrite seulement si la séance déclenchante est dans le lot (R27)', async () => {
    const a = await setup();
    const { instanceId, sessions, key } = await stalled(a);
    const trigger = sessions[3]?.sessionId ?? '';
    // Séances insérées par un premier lot sans la 4e, puis la 4e : la proposition naît au second lot.
    await syncPush(
      ctx,
      a.cookie,
      sessions.slice(0, 3).flatMap((s) => s.ops),
    );
    expect(rowsOf('instance_change')).toEqual([]);
    await syncPush(ctx, a.cookie, sessions[3]?.ops ?? []);
    expect(rowsOf('instance_change')).toEqual([
      expect.objectContaining({
        id: uuidFromKey(key(trigger)),
        instance_id: instanceId,
        author: 'engine',
        status: 'proposed',
        reason_code: 'ENGINE_REACTIVE_DELOAD',
        base_revision: 0,
        decided_at: null,
        expires_at: new Date(Date.parse(NOW) + 7 * DAY).toISOString(),
      }),
    ]);
    expect(JSON.parse(rowsOf('instance_change')[0]?.operations as string)).toEqual([{ op: 'start_deload' }]);
  });

  it('instance terminée : états et décisions écrits, aucun événement du moteur (ruling R31)', async () => {
    const a = await setup();
    await grantHealth(ctx, a.id);
    const { instanceId, sessions } = await stalled(a, 'ended');
    await syncPush(
      ctx,
      a.cookie,
      sessions.flatMap((s) => s.ops),
    );
    const pain = { painLevel: 'pain', nextAdjustment: 'lighten' } as const;
    for (const day of [8, 10]) {
      await push(a, { instanceId, startedAt: dayAt(day), exercises: both(pain) });
    }
    expect(rowsOf('instance_change')).toEqual([]);
    expect(rowOf('program_instance', instanceId)?.revision).toBe(0);
    expect(rowsOf('slot_state')).toHaveLength(2);
    expect(rowsOf('engine_decision')).toHaveLength(12);
  });

  it('rejeu hors push (API du programme) : aucune proposition, une décidée jamais recréée', async () => {
    const a = await setup();
    const { instanceId, sessions, key } = await stalled(a);
    // Proposition née au push, puis refusée : le rejeu ne la recrée ni ne la modifie ; effacée, le rejeu de l'API
    // (sans séance du lot) ne l'écrit pas non plus.
    await syncPush(
      ctx,
      a.cookie,
      sessions.flatMap((s) => s.ops),
    );
    const id = uuidFromKey(key(sessions[3]?.sessionId ?? ''));
    ctx.deps.sqlite.prepare("UPDATE instance_change SET status = 'rejected' WHERE id = ?").run(id);
    const replay = () =>
      ctx.deps.db
        .transaction()
        .execute((trx) => replayInstanceInDb(trx, { ownerId: a.id, instanceId }, ctx.deps));
    await replay();
    expect(rowsOf('instance_change').map((r) => [r.id, r.status])).toEqual([[id, 'rejected']]);
    ctx.deps.sqlite.prepare('DELETE FROM instance_change').run();
    await replay();
    expect(rowsOf('instance_change')).toEqual([]);
  });
});

describe('uuidFromKey', () => {
  it('UUID de version 8 et de variante RFC 9562, dérivé du SHA-256 de la clé', () => {
    const id = uuidFromKey('engine|i|PAIN_SUSPEND|A1|goblet-squat|s');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromKey('engine|i|PAIN_SUSPEND|A1|goblet-squat|s')).toBe(id);
    expect(uuidFromKey('engine|i|PAIN_SUSPEND|A1|goblet-squat|t')).not.toBe(id);
    // SHA-256("abc") = ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 96177a9c b410ff61 f20015ad.
    expect(uuidFromKey('abc')).toBe('ba7816bf-8f01-8fea-8141-40de5dae2223');
  });
});

describe('purge des tombstones et décisions (FK engine_decision → performed_exercise)', () => {
  it('un exercice supprimé dont la décision vit n’est jamais purgé ; décision et exercice purgés ensemble sinon', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const kept = await push(a, { instanceId, startedAt: dayAt(0), exercises: [{}] });
    const gone = await push(a, { instanceId, startedAt: dayAt(2), exercises: [{}] });
    await deleteSession(a, gone.sessionId);
    // Exercice supprimé hors rejeu : sa décision reste vivante (séance d'une instance disparue, par exemple).
    ctx.deps.sqlite
      .prepare('UPDATE performed_exercise SET deleted_at = ? WHERE id = ?')
      .run(NOW, kept.exerciseIds[0] ?? '');
    ctx.clock.set(new Date(Date.parse(NOW) + 91 * DAY).toISOString());

    await syncPurgeJob.run(ctx.deps);

    expect(rowOf('performed_exercise', gone.exerciseIds[0] ?? '')).toBeUndefined();
    expect(rowOf('engine_decision', gone.exerciseIds[0] ?? '')).toBeUndefined();
    expect(rowOf('performed_exercise', kept.exerciseIds[0] ?? '')).toBeDefined();
    expect(rowOf('engine_decision', kept.exerciseIds[0] ?? '')).toMatchObject({ deleted_at: null });
  });
});
