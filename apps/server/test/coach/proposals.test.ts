import { afterEach, describe, expect, it } from 'vitest';
import { insertCoachProposal } from '../../src/coach/proposals';
import type { PendingProposal } from '../../src/coach/tools/types';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  syncPush,
  type TestContext,
} from '../support';
import { pressThenGoblet } from '../support/coach';
import {
  enroll,
  programTemplate,
  type SessionSpec,
  seedProgramCatalog,
  sessionOps,
} from '../support/program';

/*
 * Propositions du coach (spec brique 4 §12.3, choix C4, C6, C7) : écriture en fin d'échange (propositions périmées
 * expirées, celles du coach encore en attente expirées, insertion `proposed` ou `expired`) et garde de hausse
 * recalculée à l'acceptation, sur tous les lieux vivants, pour les seules propositions du coach.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-11-05T10:00:00.000Z';
const DAY = 86_400_000;
const IN_7_DAYS = new Date(Date.parse(NOW) + 7 * DAY).toISOString();
const TEMPLATE = programTemplate();
const THREAD_ID = '019a4a00-0000-7000-8000-000000000c0a';
const TO_PRESS = { op: 'replace_exercise', slot: 'A1', exercise: 'leg-press' } as const;
const REASON = 'La presse soulage ton dos.';

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(): Promise<Member> {
  ctx = await createTestContext({ now: NOW });
  await seedProgramCatalog(ctx, [TEMPLATE]);
  return createUserAndLogin(ctx);
}

const rowOf = (id: string) =>
  ctx.deps.sqlite.prepare('SELECT * FROM instance_change WHERE id = ?').get(id) as Row | undefined;
const instanceRow = (id: string) =>
  ctx.deps.sqlite.prepare('SELECT * FROM program_instance WHERE id = ?').get(id) as Row;

const pending = (instanceId: string, o: Partial<PendingProposal> = {}): PendingProposal => ({
  id: '019a4a00-0000-7000-8000-0000000000aa',
  instanceId,
  baseRevision: 0,
  operations: [{ op: 'set_rest', slot: 'A1', seconds: 90 }],
  reason: REASON,
  model: 'claude-opus-5-5',
  ...o,
});

function write(userId: string, p: PendingProposal, o: { healthConsent?: boolean; now?: string } = {}) {
  return ctx.deps.db.transaction().execute((trx) =>
    insertCoachProposal(trx, ctx.deps, p, {
      userId,
      threadId: THREAD_ID,
      promptVersion: 'coach-1/adult',
      now: new Date(o.now ?? NOW),
      healthConsent: o.healthConsent ?? true,
    }),
  );
}

/** Proposition en attente en base, du moteur ou du coach, valable jusqu'à `expiresAt`. */
async function proposal(
  u: Member,
  instanceId: string,
  o: { author?: 'engine' | 'coach'; operations?: unknown[]; expiresAt?: string } = {},
): Promise<string> {
  const coach = o.author === 'coach';
  const row = await insertFixtureRow(ctx.deps.db, 'instance_change', {
    ownerId: u.id,
    instanceId,
    author: o.author ?? 'engine',
    operations: JSON.stringify(o.operations ?? [{ op: 'start_deload' }]),
    reasonCode: coach ? 'COACH_PROPOSAL' : 'ENGINE_REACTIVE_DELOAD',
    ...(coach ? { aiGenerated: 1, aiModel: 'claude-opus-5-5', coachThreadId: THREAD_ID } : {}),
    status: 'proposed',
    createdAt: NOW,
    expiresAt: o.expiresAt ?? IN_7_DAYS,
    baseRevision: 0,
  });
  return row.id as string;
}

async function push(u: Member, specs: SessionSpec[]): Promise<void> {
  const res = await syncPush(
    ctx,
    u.cookie,
    specs.flatMap((spec) => sessionOps(u.id, spec).ops),
  );
  expect(res.status).toBe(200);
  expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
}

const accept = (u: Member, id: string, baseRevision = 0) =>
  ctx.request(`/api/program/changes/${id}/accept`, {
    method: 'POST',
    cookie: u.cookie,
    json: { baseRevision },
  });

describe('insertCoachProposal (§12.3)', () => {
  it("insertion : author coach, COACH_PROPOSAL, proposed, +7 jours, colonnes IA du fil et de l'itération", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const p = pending(instanceId, { model: 'claude-opus-5' });
    await write(u.id, p);
    const row = rowOf(p.id);
    expect(row).toMatchObject({
      owner_id: u.id,
      instance_id: instanceId,
      base_revision: 0,
      author: 'coach',
      operations: JSON.stringify(p.operations),
      reason_code: 'COACH_PROPOSAL',
      reason: REASON,
      status: 'proposed',
      created_at: NOW,
      expires_at: IN_7_DAYS,
      decided_at: null,
      ai_generated: 1,
      ai_model: 'claude-opus-5',
      prompt_version: 'coach-1/adult',
      coach_thread_id: THREAD_ID,
      deleted_at: null,
    });
    expect(Date.parse(row?.expires_at as string) - Date.parse(row?.created_at as string)).toBe(7 * DAY);
  });

  it('proposition du coach encore en attente → expired, rev neuf ; celle du moteur intacte', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const coach = await proposal(u, instanceId, { author: 'coach' });
    const engine = await proposal(u, instanceId);
    const before = { coach: rowOf(coach), engine: rowOf(engine) };

    await write(u.id, pending(instanceId));
    expect(rowOf(coach)).toMatchObject({ status: 'expired', decided_at: null });
    expect(rowOf(coach)?.rev as number).toBeGreaterThan(before.coach?.rev as number);
    expect(rowOf(engine)).toEqual(before.engine);
  });

  it("expireProposals d'abord : une proposition du moteur échue passe à expired", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const stale = await proposal(u, instanceId, { expiresAt: '2026-11-04T10:00:00.000Z' });
    await write(u.id, pending(instanceId));
    expect(rowOf(stale)?.status).toBe('expired');
  });

  it('sans accord santé : reason NULL (C7)', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const p = pending(instanceId);
    await write(u.id, p, { healthConsent: false });
    expect(rowOf(p.id)).toMatchObject({ status: 'proposed', reason: null });
  });

  it("révision changée entre la validation et l'écriture → expired", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE, { revision: 1 });
    const p = pending(instanceId, { baseRevision: 0 });
    await write(u.id, p);
    expect(rowOf(p.id)).toMatchObject({ status: 'expired', base_revision: 0, expires_at: IN_7_DAYS });
  });

  it("instance qui n'est plus active → expired, sur son instance", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE, { status: 'ended' });
    const p = pending(instanceId);
    await write(u.id, p);
    expect(rowOf(p.id)).toMatchObject({ status: 'expired', instance_id: instanceId });
  });
});

describe("acceptation d'une proposition du coach : garde de hausse recalculée", () => {
  it('hausse apparue depuis la proposition : 422 coach_load_increase, la proposition passe expired', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    // Proposée quand la presse n'avait jamais été faite dans A1 (calibration), acceptée après une séance à 60 kg.
    const id = await proposal(u, instanceId, { author: 'coach', operations: [TO_PRESS] });
    await push(u, pressThenGoblet(instanceId));
    const before = rowOf(id);

    const res = await accept(u, id);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'coach_load_increase' });
    expect(rowOf(id)).toMatchObject({ status: 'expired', decided_at: null });
    expect(rowOf(id)?.rev as number).toBeGreaterThan(before?.rev as number);
    expect(instanceRow(instanceId).revision).toBe(0);
    // Plus en attente : une nouvelle tentative est refusée comme telle.
    expect((await accept(u, id)).status).toBe(409);
  });

  it('sans hausse : acceptée', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const id = await proposal(u, instanceId, { author: 'coach', operations: [TO_PRESS] });
    await push(u, pressThenGoblet(instanceId).slice(1));
    const res = await accept(u, id);
    expect(res.status).toBe(200);
    expect(rowOf(id)?.status).toBe('accepted');
    expect(instanceRow(instanceId).revision).toBe(1);
  });

  it("proposition du moteur, même hausse : la garde ne s'applique pas", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const id = await proposal(u, instanceId, { operations: [TO_PRESS] });
    await push(u, pressThenGoblet(instanceId));
    expect((await accept(u, id)).status).toBe(200);
    expect(rowOf(id)?.status).toBe('accepted');
  });
});
