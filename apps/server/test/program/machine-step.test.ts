import { type ProgramInstanceView, SlotStateView } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUserAndLogin, syncPush, type TestContext } from '../support';
import { enroll, programTemplate, seedProgramCatalog, sessionOps } from '../support/program';

/*
 * Pas d'une machine (spec brique 3 §6 ; 05 §12) : `PUT /api/program/slot-states/:id/machine-step`, tenu par (slot,
 * exercice) dans `slot_state.machine_step_g_override`, gardé par le rejeu.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-10-06T10:00:00.000Z';
const TEMPLATE = programTemplate('test-program');

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(): Promise<Member> {
  ctx = await createTestContext({ now: NOW });
  await seedProgramCatalog(ctx, [TEMPLATE]);
  return createUserAndLogin(ctx);
}

async function enrollIn(u: Member): Promise<string> {
  const res = await ctx.request('/api/program/enroll', {
    method: 'POST',
    cookie: u.cookie,
    json: { templateId: 'test-program', daysPerWeek: 3 },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { instance: ProgramInstanceView }).instance.id;
}

const put = (u: Member, id: string, json: unknown) =>
  ctx.request(`/api/program/slot-states/${encodeURIComponent(id)}/machine-step`, {
    method: 'PUT',
    cookie: u.cookie,
    json,
  });
const rowOf = (id: string) =>
  ctx.deps.sqlite.prepare('SELECT * FROM slot_state WHERE id = ?').get(id) as Row | undefined;
const rowsOf = () => ctx.deps.sqlite.prepare('SELECT * FROM slot_state ORDER BY id').all() as Row[];

async function pushSession(u: Member, instanceId: string, slotId: string, exerciseId: string) {
  const s = sessionOps(u.id, { instanceId, exercises: [{ slotId, exerciseId }] });
  const res = await syncPush(ctx, u.cookie, s.ops);
  expect(res.status).toBe(200);
  expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
}

describe('PUT /api/program/slot-states/:id/machine-step', () => {
  it('crée la ligne pendant une calibration, avec l’état initial ; le rejeu la garde', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = `${instanceId}:A4:seated-cable-row`;
    const res = await put(a, id, { stepG: 2500 });
    expect(res.status).toBe(200);
    const { slotState } = (await res.json()) as { slotState: SlotStateView };
    expect(SlotStateView.parse(slotState)).toEqual({
      id,
      instanceId,
      slotId: 'A4',
      exerciseId: 'seated-cable-row',
      mode: 'linear',
      loadG: null,
      targetReps: null,
      variantRank: null,
      durationS: null,
      machineStepGOverride: 2500,
      calibrationLeft: 3,
      noProgressCount: 0,
      stallRank: 0,
      suspended: false,
    });
    expect(rowOf(id)).toMatchObject({
      owner_id: a.id,
      machine_step_g_override: 2500,
      calibration_left: 3,
      pain_streak: null,
      last_session_id: null,
      rules_version: '1',
      created_at: NOW,
      updated_by: a.id,
      deleted_at: null,
    });

    // Un rejeu qui ne produit pas cet état (séance sur A1 seulement) garde la ligne : elle porte une surcharge.
    await pushSession(a, instanceId, 'A1', 'goblet-squat');
    expect(rowOf(id)).toMatchObject({ machine_step_g_override: 2500, deleted_at: null });
  });

  it('`null` efface la surcharge ; la ligne que le rejeu ne produit pas disparaît alors', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = `${instanceId}:A4:seated-cable-row`;
    expect((await put(a, id, { stepG: 2500 })).status).toBe(200);
    const res = await put(a, id, { stepG: null });
    expect(res.status).toBe(200);
    const { slotState } = (await res.json()) as { slotState: SlotStateView };
    expect(slotState).toMatchObject({ id, machineStepGOverride: null });
    expect(rowOf(id)?.machine_step_g_override).toBeNull();
    expect(rowOf(id)?.deleted_at).not.toBeNull();
  });

  it('`null` sans surcharge à effacer : aucune écriture', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = `${instanceId}:A4:seated-cable-row`;
    const res = await put(a, id, { stepG: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { slotState: SlotStateView }).slotState).toMatchObject({
      id,
      machineStepGOverride: null,
      calibrationLeft: 3,
    });
    expect(rowsOf()).toEqual([]);
  });

  it('ligne existante : surcharge écrite, état gardé, rejeu dans la même transaction', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = `${instanceId}:A4:seated-cable-row`;
    await pushSession(a, instanceId, 'A4', 'seated-cable-row');
    const before = rowOf(id);
    expect(before).toMatchObject({ deleted_at: null, machine_step_g_override: null });
    // État altéré à la main : le rejeu le réécrit.
    ctx.deps.sqlite.prepare('UPDATE slot_state SET no_progress_count = 7 WHERE id = ?').run(id);

    const res = await put(a, id, { stepG: 7500 });
    expect(res.status).toBe(200);
    expect(rowOf(id)).toMatchObject({
      machine_step_g_override: 7500,
      last_session_id: before?.last_session_id,
      calibration_left: before?.calibration_left,
      no_progress_count: before?.no_progress_count,
      deleted_at: null,
    });
    expect(Number(rowOf(id)?.rev)).toBeGreaterThan(Number(before?.rev));
  });

  it('même valeur : aucune écriture', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = `${instanceId}:A4:seated-cable-row`;
    await put(a, id, { stepG: 2500 });
    const rev = rowOf(id)?.rev;
    expect((await put(a, id, { stepG: 2500 })).status).toBe(200);
    expect(rowOf(id)?.rev).toBe(rev);
  });

  it('slot ajouté par un changement accepté : admis ; slot retiré : 404', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const added = await ctx.request('/api/program/changes', {
      method: 'POST',
      cookie: a.cookie,
      json: {
        baseRevision: 0,
        operations: [
          { op: 'add_slot', workout: 'A', movementPattern: 'core_anti_extension', exercises: ['dead-bug'] },
        ],
      },
    });
    expect(added.status).toBe(201);
    const changeId = ((await added.json()) as { change: { id: string } }).change.id;
    const slotId = `A-${changeId}`;
    expect((await put(a, `${instanceId}:${slotId}:dead-bug`, { stepG: 2500 })).status).toBe(200);

    const removed = await ctx.request('/api/program/changes', {
      method: 'POST',
      cookie: a.cookie,
      json: { baseRevision: 1, operations: [{ op: 'remove_slot', slot: slotId }] },
    });
    expect(removed.status).toBe(201);
    expect((await put(a, `${instanceId}:${slotId}:dead-bug`, { stepG: 5000 })).status).toBe(404);
  });

  it('404 : slot d’un autre membre, slot ou exercice inconnu, instance terminée, identifiant mal formé', async () => {
    const a = await setup();
    const b = await createUserAndLogin(ctx);
    const instanceId = await enrollIn(a);
    const theirs = await enrollIn(b);
    const ended = await enroll(ctx, a.id, TEMPLATE, { status: 'ended' });
    for (const id of [
      `${theirs}:A4:seated-cable-row`,
      `${instanceId}:A9:seated-cable-row`,
      `${instanceId}:A4:no-such-exercise`,
      `${ended}:A4:seated-cable-row`,
      `${instanceId}:A4`,
      'garbage',
    ]) {
      const res = await put(a, id, { stepG: 2500 });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(rowsOf()).toEqual([]);
  });

  it('pas hors bornes (500 à 10 000 g, entier) → 400 validation', async () => {
    const a = await setup();
    const instanceId = await enrollIn(a);
    const id = `${instanceId}:A4:seated-cable-row`;
    for (const stepG of [100, 20_000, 2500.5]) {
      const res = await put(a, id, { stepG });
      expect(res.status, String(stepG)).toBe(400);
      expect(((await res.json()) as Row).error).toBe('validation');
    }
    expect(rowsOf()).toEqual([]);
  });
});
