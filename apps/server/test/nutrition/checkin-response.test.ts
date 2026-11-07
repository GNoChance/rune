import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUser,
  createUserAndLogin,
  insertFixtureRow,
  login,
  type TestContext,
} from '../support';
import { fullMember, open, seedTarget, seedWeighIns } from './fixtures';

/* Réponses au bilan (spec brique 5 §7, §8, §9) : acceptation, refus, semaine non représentative, isolement. */

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-11-09T09:00:00.000Z';
const WEEK = '2026-11-02';

const respond = (cookie: string, week: string, response: unknown) =>
  ctx.request(`/api/nutrition/checkins/${week}/respond`, { method: 'POST', cookie, json: { response } });
const nonRep = (cookie: string, week: string) =>
  ctx.request(`/api/nutrition/checkins/${week}/non-representative`, { method: 'POST', cookie, json: {} });

const targets = () => ctx.deps.db.selectFrom('nutritionTarget').selectAll().orderBy('id').execute();
const checkinOf = (week: string) =>
  ctx.deps.db
    .selectFrom('nutritionCheckin')
    .selectAll()
    .where('weekStart', '=', week)
    .executeTakeFirstOrThrow();
const profileOf = (id: string) =>
  ctx.deps.db.selectFrom('nutritionProfile').selectAll().where('ownerId', '=', id).executeTakeFirstOrThrow();

async function member(checkin: Record<string, unknown> = {}) {
  ctx = await createTestContext({ now: NOW });
  const u = await createUserAndLogin(ctx);
  await fullMember(ctx, u.id, { goal: 'lose' });
  await seedTarget(ctx, u.id, { validFrom: '2026-10-12', refWeightG: 80_000 });
  await seedWeighIns(ctx, u.id, [
    ['2026-11-06', 79_800],
    ['2026-11-07', 79_800],
    ['2026-11-08', 79_800],
  ]);
  await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
    ownerId: u.id,
    weekStart: WEEK,
    weighInCount: 4,
    meanWeightG: 79_800,
    changePct: -0.2,
    representative: 1,
    decision: 'proposal',
    position: 'above',
    proposedDeltaKcal: -100,
    ...checkin,
  });
  return u;
}

describe('POST /checkins/:weekStart/respond', () => {
  it('accepter -100 : ajustement, cible checkin au poids du jour, lien et point de départ', async () => {
    const u = await member();
    const res = await respond(u.cookie, WEEK, 'accepted');
    expect(res.status).toBe(200);
    expect(await profileOf(u.id)).toMatchObject({ cumulativeAdjustmentKcal: -100 });
    const all = await targets();
    const created = all.at(-1);
    expect(all).toHaveLength(2);
    expect(created).toMatchObject({ reason: 'checkin', validFrom: '2026-11-09' });
    expect(JSON.parse(created?.inputs ?? '{}')).toMatchObject({
      ref_weight_g: 79_800,
      cumulative_adjustment_kcal: -100,
    });
    expect(await checkinOf(WEEK)).toMatchObject({
      response: 'accepted',
      createdTargetId: created?.id,
      decision: 'proposal',
      meanWeightG: 79_800,
      proposedDeltaKcal: -100,
    });
    const state = (await res.json()) as { target: { reason: string }; checkin: unknown };
    expect(state.target.reason).toBe('checkin');
    expect(state.checkin).toBeNull();
  });

  it('refuser : seul le point de départ bouge', async () => {
    const u = await member();
    const res = await respond(u.cookie, WEEK, 'declined');
    expect(res.status).toBe(200);
    expect(await targets()).toHaveLength(1);
    expect(await profileOf(u.id)).toMatchObject({ cumulativeAdjustmentKcal: 0 });
    const row = await checkinOf(WEEK);
    expect(row).toMatchObject({ response: 'declined', createdTargetId: null });
    expect(row.respondedAt).toBe(NOW);
  });

  it('répondre deux fois : 409 checkin_not_actionable', async () => {
    const u = await member();
    expect((await respond(u.cookie, WEEK, 'declined')).status).toBe(200);
    const again = await respond(u.cookie, WEEK, 'accepted');
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'checkin_not_actionable' });
  });

  it("un bilan qui n'est pas le plus récent : 409", async () => {
    const u = await member();
    await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
      ownerId: u.id,
      weekStart: '2026-11-09',
      decision: 'in_band',
    });
    expect((await respond(u.cookie, WEEK, 'accepted')).status).toBe(409);
    expect(await targets()).toHaveLength(1);
  });

  it('une décision sans proposition : 409', async () => {
    const u = await member({ decision: 'in_band', proposedDeltaKcal: null });
    expect((await respond(u.cookie, WEEK, 'accepted')).status).toBe(409);
  });

  it('semaine inconnue : 404 ; réponse invalide : 400', async () => {
    const u = await member();
    expect((await respond(u.cookie, '2026-10-26', 'accepted')).status).toBe(404);
    expect((await respond(u.cookie, WEEK, 'maybe')).status).toBe(400);
  });

  it('pause de sécurité posée après une baisse proposée : accepter → 409, plus de bilan à traiter', async () => {
    const u = await member();
    await ctx.deps.db.updateTable('nutritionProfile').set({ safetyPause: 1 }).execute();
    const res = await respond(u.cookie, WEEK, 'accepted');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'checkin_not_actionable' });
    expect(await targets()).toHaveLength(1);
    expect(await profileOf(u.id)).toMatchObject({ cumulativeAdjustmentKcal: 0 });
    const state = (await (await open(ctx, u.cookie)).json()) as { checkin: unknown; last_checkin: unknown };
    expect(state.checkin).toBeNull();
    expect(state.last_checkin).toMatchObject({ decision: 'proposal', proposed_delta_kcal: -100 });
    // Garder ses repères reste possible.
    expect((await respond(u.cookie, WEEK, 'declined')).status).toBe(200);
  });

  it('pause de sécurité : une hausse proposée reste à traiter', async () => {
    const u = await member({ proposedDeltaKcal: 100, position: 'below', changePct: -1.2 });
    await ctx.deps.db.updateTable('nutritionProfile').set({ safetyPause: 1 }).execute();
    const state = (await (await open(ctx, u.cookie)).json()) as { checkin: unknown };
    expect(state.checkin).toMatchObject({ proposed_delta_kcal: 100 });
    expect((await respond(u.cookie, WEEK, 'accepted')).status).toBe(200);
  });

  it('objectif changé après le bilan : la proposition décidée avant ne se traite plus (409)', async () => {
    const u = await member();
    // Les fixtures ont leur propre suite d'UUIDv7 : la cible et le bilan reçoivent des id plus anciens que ceux du
    // serveur, comme s'ils étaient nés avant le réglage (en production, une seule suite).
    await ctx.deps.db
      .updateTable('nutritionTarget')
      .set({ id: '0190aaaa-0000-7000-8000-000000000001' })
      .execute();
    await ctx.deps.db
      .updateTable('nutritionCheckin')
      .set({ id: '0190aaaa-0000-7000-8000-000000000002' })
      .execute();
    const saved = await ctx.request('/api/nutrition/settings', {
      method: 'PUT',
      cookie: u.cookie,
      json: { goal: 'maintain' },
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { checkin: unknown }).checkin).toBeNull();
    for (const response of ['accepted', 'declined']) {
      const res = await respond(u.cookie, WEEK, response);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'checkin_not_actionable' });
    }
    expect(await checkinOf(WEEK)).toMatchObject({ response: null });
  });

  it('un recalibrage plus récent que le bilan ne le périme pas', async () => {
    const u = await member();
    await seedTarget(ctx, u.id, { validFrom: '2026-11-09', reason: 'weight_recalibration' });
    const state = (await (await open(ctx, u.cookie)).json()) as { checkin: unknown };
    expect(state.checkin).toMatchObject({ proposed_delta_kcal: -100 });
    expect((await respond(u.cookie, WEEK, 'accepted')).status).toBe(200);
  });
});

describe('POST /checkins/:weekStart/non-representative', () => {
  it('décision non_representative_week, proposition annulée, valeurs figées gardées', async () => {
    const u = await member();
    const res = await nonRep(u.cookie, WEEK);
    expect(res.status).toBe(200);
    expect(await checkinOf(WEEK)).toMatchObject({
      representative: 0,
      decision: 'non_representative_week',
      proposedDeltaKcal: null,
      response: null,
      weighInCount: 4,
      meanWeightG: 79_800,
      changePct: -0.2,
      position: 'above',
    });
    const state = (await res.json()) as { checkin: unknown; last_checkin: { decision: string } };
    expect(state.checkin).toBeNull();
    expect(state.last_checkin.decision).toBe('non_representative_week');
    expect(await targets()).toHaveLength(1);
    expect(u.id).toBeTruthy();
  });

  it('déjà répondu : 409', async () => {
    const u = await member();
    await respond(u.cookie, WEEK, 'declined');
    expect((await nonRep(u.cookie, WEEK)).status).toBe(409);
  });
});

describe('isolement (P-ADM-2)', () => {
  it("404 sur le bilan d'un autre membre et d'un admin", async () => {
    await member();
    const other = await createUserAndLogin(ctx);
    await fullMember(ctx, other.id);
    const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
    const adminCookie = await login(ctx, 'porteur', admin.password);
    await insertFixtureRow(ctx.deps.db, 'consent_event', {
      ownerId: admin.id,
      type: 'health',
      action: 'grant',
    });
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', {
      ownerId: admin.id,
      mode: 'full',
      safetyScreenVersion: 1,
      sexForCalc: 'male',
      heightCm: 180,
      activityLevel: 2,
      goal: 'maintain',
    });
    for (const cookie of [other.cookie, adminCookie]) {
      expect((await respond(cookie, WEEK, 'accepted')).status).toBe(404);
      expect((await nonRep(cookie, WEEK)).status).toBe(404);
    }
    expect(await checkinOf(WEEK)).toMatchObject({ response: null, decision: 'proposal' });
  });
});
