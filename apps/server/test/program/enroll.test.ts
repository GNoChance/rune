import { ProgramInstanceView } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { getServedCatalog } from '../../src/catalog/bundle';
import { createTestContext, createUserAndLogin, insertFixtureRow, type TestContext } from '../support';
import { enroll, programTemplate, seedProgramCatalog } from '../support/program';

/*
 * Inscription à un programme (spec brique 3 §6, D5 ; 05 §6.1) : `POST /api/program/enroll`.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-10-06T10:00:00.000Z';
const TEMPLATE = programTemplate('test-program', { version: 3 });
const UNAVAILABLE = programTemplate('test-unavailable', { exercises: ['missing-exercise'] });

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(): Promise<Member> {
  ctx = await createTestContext({ now: NOW });
  await seedProgramCatalog(ctx, [TEMPLATE, UNAVAILABLE]);
  return createUserAndLogin(ctx);
}

const post = (u: Member, json: unknown) =>
  ctx.request('/api/program/enroll', { method: 'POST', cookie: u.cookie, json });
const instancesOf = (ownerId: string) =>
  ctx.deps.sqlite
    .prepare('SELECT * FROM program_instance WHERE owner_id = ? ORDER BY created_at, id')
    .all(ownerId) as Row[];

describe('POST /api/program/enroll', () => {
  it('201 : instance active, snapshot = fichier complet servi, template_version, révision 0', async () => {
    const a = await setup();
    const res = await post(a, { templateId: 'test-program', daysPerWeek: 2 });
    expect(res.status).toBe(201);
    const { instance } = (await res.json()) as { instance: ProgramInstanceView };
    expect(ProgramInstanceView.parse(instance)).toEqual({
      id: expect.any(String),
      templateId: 'test-program',
      templateVersion: 3,
      daysPerWeek: 2,
      status: 'active',
      revision: 0,
      startedAt: NOW,
      endedAt: null,
    });
    const [row] = instancesOf(a.id);
    expect(row).toMatchObject({
      id: instance.id,
      template_id: 'test-program',
      template_version: 3,
      days_per_week: 2,
      status: 'active',
      revision: 0,
      started_at: NOW,
      ended_at: null,
      created_at: NOW,
      updated_by: a.id,
      deleted_at: null,
    });
    const served = getServedCatalog(ctx.deps)?.programTemplates.find((t) => t.template.id === 'test-program');
    expect(JSON.parse(row?.snapshot as string)).toEqual(served?.template);
    expect(JSON.parse(row?.snapshot as string)).toEqual(TEMPLATE);
  });

  it('seconde inscription → 409 already_enrolled, rien d’écrit', async () => {
    const a = await setup();
    expect((await post(a, { templateId: 'test-program', daysPerWeek: 3 })).status).toBe(201);
    const res = await post(a, { templateId: 'test-program', daysPerWeek: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_enrolled' });
    expect(instancesOf(a.id)).toHaveLength(1);
  });

  it('une instance terminée n’empêche pas l’inscription ; celle d’un autre membre non plus', async () => {
    const a = await setup();
    const b = await createUserAndLogin(ctx);
    await enroll(ctx, a.id, TEMPLATE, { status: 'ended' });
    await enroll(ctx, b.id, TEMPLATE);
    expect((await post(a, { templateId: 'test-program', daysPerWeek: 3 })).status).toBe(201);
    expect(instancesOf(a.id).map((r) => r.status)).toEqual(['ended', 'active']);
  });

  it('modèle indisponible ou inconnu → 422 template_unavailable', async () => {
    const a = await setup();
    for (const templateId of ['test-unavailable', 'no-such-template']) {
      const res = await post(a, { templateId, daysPerWeek: 3 });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'template_unavailable' });
    }
    expect(instancesOf(a.id)).toEqual([]);
  });

  it('5 jours, ou des jours hors des bornes du modèle → 422 days_out_of_range', async () => {
    const a = await setup();
    for (const daysPerWeek of [5, 4, 1]) {
      const res = await post(a, { templateId: 'test-program', daysPerWeek });
      expect(res.status, String(daysPerWeek)).toBe(422);
      expect(await res.json()).toEqual({ error: 'days_out_of_range' });
    }
    expect(instancesOf(a.id)).toEqual([]);
  });

  it('corps invalide → 400 validation', async () => {
    const a = await setup();
    for (const json of [
      { templateId: 'test-program' },
      { templateId: 'test-program', daysPerWeek: 2.5 },
      { templateId: 'test-program', daysPerWeek: 3, extra: true },
    ]) {
      const res = await post(a, json);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Row).error).toBe('validation');
    }
  });

  it('expire les propositions périmées du membre', async () => {
    const a = await setup();
    const old = await enroll(ctx, a.id, TEMPLATE, { status: 'ended', revision: 1 });
    const proposal = await insertFixtureRow(ctx.deps.db, 'instance_change', {
      ownerId: a.id,
      instanceId: old,
      author: 'engine',
      operations: '[{"op":"start_deload"}]',
      reasonCode: 'ENGINE_REACTIVE_DELOAD',
      status: 'proposed',
      expiresAt: '2026-10-10T10:00:00.000Z',
      baseRevision: 0,
    });
    expect((await post(a, { templateId: 'test-program', daysPerWeek: 3 })).status).toBe(201);
    const row = ctx.deps.sqlite
      .prepare('SELECT status FROM instance_change WHERE id = ?')
      .get(proposal.id as string);
    expect(row).toEqual({ status: 'expired' });
  });
});
