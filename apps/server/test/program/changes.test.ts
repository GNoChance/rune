import { ChangeErrorsBody, InstanceChangeView, ProgramInstanceView } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  syncPush,
  type TestContext,
} from '../support';
import { grantHealth, programTemplate, seedProgramCatalog, sessionOps } from '../support/program';
import { rebuild } from '../support/review';

/*
 * Changements de programme (spec brique 3 §6, D5, D18 ; 05 §6.2 et §15) : changement de l'utilisateur accepté
 * d'emblée, changement de modèle, acceptation et refus d'une proposition.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;
type Body = { change: InstanceChangeView; instance: ProgramInstanceView };

const NOW = '2026-10-06T10:00:00.000Z';
const DAY = 86_400_000;
const IN_7_DAYS = new Date(Date.parse(NOW) + 7 * DAY).toISOString();
const BASE = programTemplate('test-program');
const FOUR = programTemplate('test-four', { days: { min: 3, max: 4, default: 4 } });
const WIDE = programTemplate('test-wide', { days: { min: 2, max: 4, default: 3 } });
const UNAVAILABLE = programTemplate('test-unavailable', { exercises: ['missing-exercise'] });
const TEMPLATES = [BASE, FOUR, WIDE, UNAVAILABLE];

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(): Promise<Member> {
  ctx = await createTestContext({ now: NOW });
  await seedProgramCatalog(ctx, TEMPLATES);
  return createUserAndLogin(ctx);
}

const rowOf = (table: string, id: string) =>
  ctx.deps.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
const rowsOf = (table: string) =>
  ctx.deps.sqlite.prepare(`SELECT * FROM ${table} ORDER BY created_at, id`).all() as Row[];

async function enrollIn(u: Member, templateId = 'test-program', daysPerWeek = 3): Promise<string> {
  const res = await ctx.request('/api/program/enroll', {
    method: 'POST',
    cookie: u.cookie,
    json: { templateId, daysPerWeek },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { instance: ProgramInstanceView }).instance.id;
}

const postChange = (u: Member, json: unknown) =>
  ctx.request('/api/program/changes', { method: 'POST', cookie: u.cookie, json });
const accept = (u: Member, id: string, json: unknown) =>
  ctx.request(`/api/program/changes/${id}/accept`, { method: 'POST', cookie: u.cookie, json });
const reject = (u: Member, id: string) =>
  ctx.request(`/api/program/changes/${id}/reject`, { method: 'POST', cookie: u.cookie, json: {} });

/** Fil du coach d'où viennent ses propositions (spec brique 4 §12.3). */
const COACH_THREAD_ID = '019a4a00-0000-7000-8000-000000000c0a';
const COACH_COLUMNS = {
  reasonCode: 'COACH_PROPOSAL',
  aiGenerated: 1,
  aiModel: 'claude-opus-5-5',
  promptVersion: 'coach-1/adult',
  coachThreadId: COACH_THREAD_ID,
};

/** Proposition du moteur (ou du coach) sur `instanceId`, valable 7 jours, faite à la révision `baseRevision`. */
async function proposal(
  u: Member,
  instanceId: string,
  o: {
    operations?: unknown[];
    baseRevision?: number;
    status?: string;
    author?: 'engine' | 'coach';
    reason?: string | null;
  } = {},
): Promise<string> {
  const row = await insertFixtureRow(ctx.deps.db, 'instance_change', {
    ownerId: u.id,
    instanceId,
    author: o.author ?? 'engine',
    operations: JSON.stringify(o.operations ?? [{ op: 'start_deload' }]),
    reasonCode: 'ENGINE_REACTIVE_DELOAD',
    ...(o.author === 'coach' ? COACH_COLUMNS : {}),
    reason: o.reason ?? null,
    status: o.status ?? 'proposed',
    createdAt: NOW,
    expiresAt: IN_7_DAYS,
    baseRevision: o.baseRevision ?? 0,
  });
  return row.id as string;
}

/** Séance terminée de l'instance (A1, squat goblet) : un `slot_state` à rejouer. */
async function pushSession(u: Member, instanceId: string): Promise<string> {
  const s = sessionOps(u.id, { instanceId, exercises: [{}] });
  const res = await syncPush(ctx, u.cookie, s.ops);
  expect(res.status).toBe(200);
  return `${instanceId}:A1:goblet-squat`;
}

describe('POST /api/program/changes', () => {
  it('changement de l’utilisateur accepté d’emblée : revision + 1, rejeu dans la même transaction', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const stateId = await pushSession(a, instanceId);
    expect(rowOf('slot_state', stateId)?.suspended).toBe(0);

    const operations = [
      { op: 'set_rest', slot: 'A2', seconds: 180 },
      { op: 'suspend_slot', slot: 'A1' },
    ];
    const res = await postChange(a, { baseRevision: 0, operations });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Body;
    expect(InstanceChangeView.parse(body.change)).toEqual({
      id: expect.any(String),
      instanceId,
      baseRevision: 0,
      author: 'user',
      operations,
      reasonCode: 'USER_CHANGE',
      reason: null,
      status: 'accepted',
      createdAt: NOW,
      expiresAt: null,
      decidedAt: NOW,
      aiGenerated: false,
      aiModel: null,
      coachThreadId: null,
    });
    expect(ProgramInstanceView.parse(body.instance)).toMatchObject({ id: instanceId, revision: 1 });
    expect(rowOf('instance_change', body.change.id)).toMatchObject({
      owner_id: a.id,
      ai_generated: 0,
      ai_model: null,
      updated_by: a.id,
      deleted_at: null,
    });
    expect(rowOf('program_instance', instanceId)).toMatchObject({ revision: 1, status: 'active' });
    // Le rejeu a lu le changement : le slot suspendu l'est dans son état.
    expect(rowOf('slot_state', stateId)?.suspended).toBe(1);
  });

  it('set_days_per_week : accepté ; days_per_week de l’instance reste celui de l’inscription (entrée du rejeu)', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a, 'test-program', 3);
    const res = await postChange(a, { baseRevision: 0, operations: [{ op: 'set_days_per_week', days: 2 }] });
    expect(res.status).toBe(201);
    expect(rowOf('program_instance', instanceId)).toMatchObject({ revision: 1, days_per_week: 3 });
  });

  it('base périmée → 409 stale_revision, rien d’écrit', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const res = await postChange(a, { baseRevision: 1, operations: [{ op: 'start_deload' }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stale_revision' });
    expect(rowsOf('instance_change')).toEqual([]);
    expect(rowOf('program_instance', instanceId)?.revision).toBe(0);
  });

  it('opérations refusées → 422 {error: invalid_change, errors}, rien d’écrit', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const res = await postChange(a, {
      baseRevision: 0,
      operations: [
        { op: 'set_rest', slot: 'A1', seconds: 10 },
        { op: 'suspend_slot', slot: 'Z9' },
      ],
    });
    expect(res.status).toBe(422);
    expect(ChangeErrorsBody.parse(await res.json())).toEqual({
      error: 'invalid_change',
      errors: [
        { op: 0, code: 'rest_out_of_bounds' },
        { op: 1, code: 'slot_unknown' },
      ],
    });
    expect(rowsOf('instance_change')).toEqual([]);
    expect(rowOf('program_instance', instanceId)?.revision).toBe(0);
  });

  it('sans instance active → 404 ; plus de 5 opérations → 400', async () => {
    const a = await setup();
    const none = await postChange(a, { baseRevision: 0, operations: [{ op: 'start_deload' }] });
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: 'not_found' });
    await enrollIn(a);
    const six = await postChange(a, {
      baseRevision: 0,
      operations: Array.from({ length: 6 }, () => ({ op: 'start_deload' })),
    });
    expect(six.status).toBe(400);
  });

  it('une proposition en attente devient périmée après un changement de l’utilisateur', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const pending = await proposal(a, instanceId);
    expect((await postChange(a, { baseRevision: 0, operations: [{ op: 'start_deload' }] })).status).toBe(201);
    expect(rowOf('instance_change', pending)).toMatchObject({ status: 'expired', decided_at: null });
  });
});

describe('switch_template', () => {
  it('ancienne instance ended et nouvelle active dans la même transaction, jours ramenés dans les bornes', async () => {
    const a = await setup();
    const old = await enrollIn(a, 'test-program', 2);
    const res = await postChange(a, {
      baseRevision: 0,
      operations: [{ op: 'switch_template', templateId: 'test-four' }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Body;
    expect(body.change).toMatchObject({ instanceId: old, status: 'accepted', author: 'user' });
    expect(rowOf('program_instance', old)).toMatchObject({ status: 'ended', ended_at: NOW, revision: 1 });

    const created = rowsOf('program_instance').filter((r) => r.id !== old);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      id: body.instance.id,
      owner_id: a.id,
      template_id: 'test-four',
      template_version: 1,
      days_per_week: 3,
      status: 'active',
      revision: 0,
      started_at: NOW,
      ended_at: null,
    });
    expect(JSON.parse(created[0]?.snapshot as string)).toEqual(FOUR);
    expect(ProgramInstanceView.parse(body.instance)).toMatchObject({
      templateId: 'test-four',
      daysPerWeek: 3,
      status: 'active',
    });
  });

  it('daysPerWeek donné : gardé ; hors des bornes du nouveau modèle → 422 days_out_of_range', async () => {
    const a = await setup();
    await enrollIn(a, 'test-program', 2);
    const out = await postChange(a, {
      baseRevision: 0,
      operations: [{ op: 'switch_template', templateId: 'test-four', daysPerWeek: 2 }],
    });
    expect(out.status).toBe(422);
    expect(await out.json()).toEqual({
      error: 'invalid_change',
      errors: [{ op: 0, code: 'days_out_of_range' }],
    });
    const res = await postChange(a, {
      baseRevision: 0,
      operations: [{ op: 'switch_template', templateId: 'test-four', daysPerWeek: 4 }],
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Body).instance.daysPerWeek).toBe(4);
  });

  it('jours courants = ceux en vigueur, set_days_per_week accepté compris', async () => {
    const a = await setup();
    await enrollIn(a, 'test-program', 3);
    await postChange(a, { baseRevision: 0, operations: [{ op: 'set_days_per_week', days: 2 }] });
    const res = await postChange(a, {
      baseRevision: 1,
      operations: [{ op: 'switch_template', templateId: 'test-wide' }],
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Body).instance.daysPerWeek).toBe(2);
  });

  it('même modèle en version plus haute admis ; même version → 422 template_unchanged', async () => {
    const a = await setup();
    const old = await enrollIn(a, 'test-program', 3);
    const same = await postChange(a, {
      baseRevision: 0,
      operations: [{ op: 'switch_template', templateId: 'test-program' }],
    });
    expect(same.status).toBe(422);
    expect(await same.json()).toEqual({
      error: 'invalid_change',
      errors: [{ op: 0, code: 'template_unchanged' }],
    });

    const v2 = programTemplate('test-program', { version: 2 });
    await rebuild(ctx, [v2, FOUR]);
    const res = await postChange(a, {
      baseRevision: 0,
      operations: [{ op: 'switch_template', templateId: 'test-program' }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Body;
    expect(body.instance).toMatchObject({ templateId: 'test-program', templateVersion: 2, daysPerWeek: 3 });
    expect(body.instance.id).not.toBe(old);
    expect(JSON.parse(rowOf('program_instance', body.instance.id)?.snapshot as string)).toEqual(v2);
    expect(rowOf('program_instance', old)?.status).toBe('ended');
  });

  it('modèle indisponible → 422 template_unavailable', async () => {
    const a = await setup();
    await enrollIn(a);
    const res = await postChange(a, {
      baseRevision: 0,
      operations: [{ op: 'switch_template', templateId: 'test-unavailable' }],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'invalid_change',
      errors: [{ op: 0, code: 'template_unavailable' }],
    });
  });

  it('séance in_progress de l’ancienne instance → 409 session_in_progress, rien d’écrit', async () => {
    const a = await setup();
    const old = await enrollIn(a);
    await insertFixtureRow(ctx.deps.db, 'workout_session', {
      ownerId: a.id,
      instanceId: old,
      status: 'in_progress',
    });
    const res = await postChange(a, {
      baseRevision: 0,
      operations: [{ op: 'switch_template', templateId: 'test-four' }],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'session_in_progress' });
    expect(rowsOf('program_instance')).toHaveLength(1);
    expect(rowOf('program_instance', old)).toMatchObject({ status: 'active', revision: 0 });
    expect(rowsOf('instance_change')).toEqual([]);
  });
});

describe('POST /api/program/changes/:id/accept', () => {
  it('proposition acceptée : accepted, decided_at, revision + 1, rejeu', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const stateId = await pushSession(a, instanceId);
    const id = await proposal(a, instanceId, { operations: [{ op: 'suspend_slot', slot: 'A1' }] });

    const res = await accept(a, id, { baseRevision: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(InstanceChangeView.parse(body.change)).toMatchObject({
      id,
      author: 'engine',
      status: 'accepted',
      decidedAt: NOW,
      expiresAt: IN_7_DAYS,
    });
    expect(ProgramInstanceView.parse(body.instance)).toMatchObject({ id: instanceId, revision: 1 });
    expect(rowOf('instance_change', id)).toMatchObject({
      status: 'accepted',
      decided_at: NOW,
      updated_by: a.id,
    });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(1);
    expect(rowOf('slot_state', stateId)?.suspended).toBe(1);
  });

  it('base de la proposition périmée → 409 stale_revision et la proposition passe expired', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    ctx.deps.sqlite.prepare('UPDATE program_instance SET revision = 1 WHERE id = ?').run(instanceId);
    const stale = await proposal(a, instanceId, { baseRevision: 0 });
    const res = await accept(a, stale, { baseRevision: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stale_revision' });
    expect(rowOf('instance_change', stale)).toMatchObject({ status: 'expired', decided_at: null });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(1);
  });

  it('base du client seule périmée → 409 stale_revision, la proposition reste proposed (R37)', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const fresh = await proposal(a, instanceId);
    for (const baseRevision of [3, 1]) {
      const res = await accept(a, fresh, { baseRevision });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'stale_revision' });
    }
    expect(rowOf('instance_change', fresh)).toMatchObject({ status: 'proposed', decided_at: null, rev: 1 });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(0);
    // Le client relit la révision et recommence : acceptée.
    expect((await accept(a, fresh, { baseRevision: 0 })).status).toBe(200);
  });

  it('plus de 7 jours → 409 expired, la proposition passe expired', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = await proposal(a, instanceId);
    ctx.clock.advance(7 * DAY + 1);
    const res = await accept(a, id, { baseRevision: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'expired' });
    expect(rowOf('instance_change', id)).toMatchObject({ status: 'expired', decided_at: null });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(0);
  });

  it('à la date limite : encore acceptée', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = await proposal(a, instanceId);
    ctx.clock.advance(7 * DAY);
    expect((await accept(a, id, { baseRevision: 0 })).status).toBe(200);
  });

  it('programme résultant refusé par le validateur → 422 {errors}, la proposition reste proposed', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = await proposal(a, instanceId, {
      operations: [{ op: 'replace_exercise', slot: 'A1', exercise: 'missing-exercise' }],
    });
    const res = await accept(a, id, { baseRevision: 0 });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'invalid_change',
      errors: [{ op: 0, code: 'exercise_unusable' }],
    });
    expect(rowOf('instance_change', id)).toMatchObject({ status: 'proposed', rev: 1 });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(0);
  });

  it('switch_template proposé : même règle qu’un changement de l’utilisateur', async () => {
    const a = await setup();
    const old = await enrollIn(a, 'test-program', 3);
    const id = await proposal(a, old, {
      author: 'coach',
      operations: [{ op: 'switch_template', templateId: 'test-four' }],
    });
    const res = await accept(a, id, { baseRevision: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.change).toMatchObject({ instanceId: old, status: 'accepted' });
    expect(body.instance).toMatchObject({ templateId: 'test-four', daysPerWeek: 3, status: 'active' });
    expect(rowOf('program_instance', old)).toMatchObject({ status: 'ended', revision: 1 });
  });

  it('décision sur un changement non proposed → 409 not_proposed', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const user = await postChange(a, { baseRevision: 0, operations: [{ op: 'start_deload' }] });
    const accepted = ((await user.json()) as Body).change.id;
    const rejected = await proposal(a, instanceId, { status: 'rejected', baseRevision: 1 });
    for (const id of [accepted, rejected]) {
      for (const res of [await accept(a, id, { baseRevision: 1 }), await reject(a, id)]) {
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'not_proposed' });
      }
    }
    expect(rowOf('instance_change', accepted)?.status).toBe('accepted');
    expect(rowOf('instance_change', rejected)?.status).toBe('rejected');
  });

  it('changement inconnu → 404 ; corps invalide → 400', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const unknown = await accept(a, '01900000-0000-7000-8000-000000000000', { baseRevision: 0 });
    expect(unknown.status).toBe(404);
    const id = await proposal(a, instanceId);
    expect((await accept(a, id, {})).status).toBe(400);
    expect(rowOf('instance_change', id)?.status).toBe('proposed');
  });
});

describe('POST /api/program/changes/:id/reject', () => {
  it('reject → rejected, decided_at ; révision inchangée', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = await proposal(a, instanceId);
    const res = await reject(a, id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { change: InstanceChangeView };
    expect(InstanceChangeView.parse(body.change)).toMatchObject({ id, status: 'rejected', decidedAt: NOW });
    expect(rowOf('instance_change', id)).toMatchObject({ status: 'rejected', decided_at: NOW });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(0);
  });

  it('reason (C2) rendu seulement avec le consentement santé', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const without = await proposal(a, instanceId, { author: 'coach', reason: 'TEMOIN_RAISON' });
    const res = await reject(a, without);
    expect(((await res.json()) as { change: InstanceChangeView }).change.reason).toBeNull();

    await grantHealth(ctx, a.id);
    const withConsent = await proposal(a, instanceId, { author: 'coach', reason: 'TEMOIN_RAISON' });
    const granted = await reject(a, withConsent);
    expect(((await granted.json()) as { change: InstanceChangeView }).change.reason).toBe('TEMOIN_RAISON');
  });

  it('proposition du coach (spec brique 4 §12.3) : aiGenerated, aiModel et coachThreadId rendus', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const coach = await reject(a, await proposal(a, instanceId, { author: 'coach' }));
    expect(InstanceChangeView.parse(((await coach.json()) as Body).change)).toMatchObject({
      author: 'coach',
      reasonCode: 'COACH_PROPOSAL',
      aiGenerated: true,
      aiModel: 'claude-opus-5-5',
      coachThreadId: COACH_THREAD_ID,
    });
    const engine = await reject(a, await proposal(a, instanceId));
    expect(InstanceChangeView.parse(((await engine.json()) as Body).change)).toMatchObject({
      author: 'engine',
      aiGenerated: false,
      aiModel: null,
      coachThreadId: null,
    });
  });

  it('proposition périmée → expirée d’abord, puis 409 not_proposed', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = await proposal(a, instanceId);
    ctx.clock.advance(8 * DAY);
    const res = await reject(a, id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_proposed' });
    expect(rowOf('instance_change', id)?.status).toBe('expired');
  });
});

describe('concurrence', () => {
  it('deux acceptations simultanées d’une proposition, même base : une 200, une 409 ; revision + 1 une seule fois', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = await proposal(a, instanceId);
    const responses = await Promise.all([
      accept(a, id, { baseRevision: 0 }),
      accept(a, id, { baseRevision: 0 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await responses.find((r) => r.status === 409)?.json()).toEqual({ error: 'not_proposed' });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(1);
    expect(rowsOf('instance_change').filter((r) => r.status === 'accepted')).toHaveLength(1);
    expect(rowOf('instance_change', id)).toMatchObject({ status: 'accepted', decided_at: NOW });
  });

  it('deux changements simultanés de la même base : un 201, un 409 stale_revision', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const responses = await Promise.all([
      postChange(a, { baseRevision: 0, operations: [{ op: 'set_rest', slot: 'A1', seconds: 150 }] }),
      postChange(a, { baseRevision: 0, operations: [{ op: 'set_rest', slot: 'A1', seconds: 180 }] }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await responses.find((r) => r.status === 409)?.json()).toEqual({ error: 'stale_revision' });
    expect(rowOf('program_instance', instanceId)?.revision).toBe(1);
    expect(rowsOf('instance_change')).toHaveLength(1);
  });
});

describe('atomicité du switch_template', () => {
  /**
   * Échecs injectés par un déclencheur SQLite : à l'insertion de la nouvelle instance (l'ancienne est déjà terminée et
   * le changement écrit), ou dans le rejeu de l'ancienne instance qui suit (une proposition en attente y expire).
   */
  const FAILURES = {
    insertion: `CREATE TRIGGER injected_failure AFTER INSERT ON program_instance
      WHEN NEW.template_id = 'test-four' BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    replay: `CREATE TRIGGER injected_failure BEFORE UPDATE OF status ON instance_change
      WHEN NEW.status = 'expired' BEGIN SELECT RAISE(ABORT, 'injected'); END`,
  };
  const dump = () =>
    ['program_instance', 'instance_change', 'slot_state'].map((t) =>
      ctx.deps.sqlite.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
    );

  it.each([
    ['changement de l’utilisateur', 'insertion'],
    ['changement de l’utilisateur', 'replay'],
    ['proposition acceptée', 'insertion'],
    ['proposition acceptée', 'replay'],
  ] as const)('%s, échec à l’étape « %s » → rien ne reste', async (path, step) => {
    const a = await setup();
    const old = await enrollIn(a, 'test-program', 3);
    const pending = await proposal(a, old);
    const switching =
      path === 'proposition acceptée'
        ? await proposal(a, old, {
            author: 'coach',
            operations: [{ op: 'switch_template', templateId: 'test-four' }],
          })
        : null;
    ctx.deps.sqlite.exec(FAILURES[step]);
    const before = dump();

    const res =
      switching === null
        ? await postChange(a, {
            baseRevision: 0,
            operations: [{ op: 'switch_template', templateId: 'test-four' }],
          })
        : await accept(a, switching, { baseRevision: 0 });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal' });
    expect(dump()).toEqual(before);
    expect(rowsOf('program_instance')).toEqual([
      expect.objectContaining({ id: old, status: 'active', revision: 0, ended_at: null }),
    ]);
    expect(rowOf('instance_change', pending)?.status).toBe('proposed');

    // Sans l'échec injecté, le même changement passe.
    ctx.deps.sqlite.exec('DROP TRIGGER injected_failure');
    const retry =
      switching === null
        ? await postChange(a, {
            baseRevision: 0,
            operations: [{ op: 'switch_template', templateId: 'test-four' }],
          })
        : await accept(a, switching, { baseRevision: 0 });
    expect(retry.status).toBe(path === 'proposition acceptée' ? 200 : 201);
    expect(rowOf('program_instance', old)?.status).toBe('ended');
    expect(rowOf('instance_change', pending)?.status).toBe('expired');
  });
});
