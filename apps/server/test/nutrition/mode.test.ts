import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUserAndLogin, type TestContext } from '../support';
import { fullMember, open, putMode, seedTarget, seedWeighIns } from './fixtures';

/* Changement de mode sans écran (spec brique 5 §7, D11) : descente et retour au qualitatif seulement. */

let ctx: TestContext;
afterEach(() => ctx?.close());

const profileOf = (id: string) =>
  ctx.deps.db.selectFrom('nutritionProfile').selectAll().where('ownerId', '=', id).executeTakeFirst();

describe('PUT /api/nutrition/mode', () => {
  it('qualitative depuis disabled, sans écran ni profil préalable : 200', async () => {
    ctx = await createTestContext({ now: '2026-11-09T09:00:00.000Z' });
    const u = await createUserAndLogin(ctx);
    const res = await putMode(ctx, u.cookie, { mode: 'qualitative' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ effective_mode: 'qualitative', stored_mode: 'qualitative' });
    expect(await profileOf(u.id)).toMatchObject({ mode: 'qualitative', modeReason: 'choice' });
  });

  it('full : 422 screen_required', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx);
    const res = await putMode(ctx, u.cookie, { mode: 'full' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'screen_required' });
    expect(await profileOf(u.id)).toBeUndefined();
  });

  it('un mode inconnu : 400 validation', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx);
    expect((await putMode(ctx, u.cookie, { mode: 'turbo' })).status).toBe(400);
  });

  it('descente depuis full : données gardées en base, plus servies, pause intacte', async () => {
    ctx = await createTestContext({ now: '2026-11-09T09:00:00.000Z' });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await ctx.deps.db.updateTable('nutritionProfile').set({ safetyPause: 1 }).execute();
    await seedTarget(ctx, u.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, u.id, [['2026-11-08', 80_000]]);

    const res = await putMode(ctx, u.cookie, { mode: 'disabled' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ effective_mode: 'disabled', stored_mode: 'disabled' });
    expect(text).not.toContain('kcal');

    expect(await ctx.deps.db.selectFrom('nutritionTarget').selectAll().execute()).toHaveLength(1);
    expect(
      await ctx.deps.db.selectFrom('weighIn').selectAll().where('deletedAt', 'is', null).execute(),
    ).toHaveLength(1);
    expect(await profileOf(u.id)).toMatchObject({
      mode: 'disabled',
      safetyPause: 1,
      heightCm: 180,
      safetyScreenVersion: 1,
    });

    const opened = await (await open(ctx, u.cookie)).text();
    expect(opened).not.toContain('kcal');
    expect(opened).not.toContain('weight');
    const rows = await (await ctx.request('/api/nutrition/rows', { cookie: u.cookie })).json();
    expect(rows).toEqual({
      weigh_in: [],
      nutrition_target: [],
      nutrition_checkin: [],
      nutrition_profile: [],
    });
  });

  it('donne un rev neuf au profil', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    const before = (await profileOf(u.id))?.rev ?? 0;
    await putMode(ctx, u.cookie, { mode: 'qualitative' });
    expect((await profileOf(u.id))?.rev).toBeGreaterThan(before);
  });
});
