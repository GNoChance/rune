import { afterEach, describe, expect, it } from 'vitest';
import { setSafetyPause } from '../../src/nutrition/screen';
import {
  createLogger,
  createTestContext,
  createUser,
  createUserAndLogin,
  login,
  type TestContext,
} from '../support';
import { fullMember, open } from './fixtures';

/* Interrupteur d'administration du mode complet (spec brique 5 §7, D4) et pause de sécurité. */

let ctx: TestContext;
let lines: string[];
afterEach(() => ctx?.close());

const put = (cookie: string, json: unknown) =>
  ctx.request('/api/admin/nutrition', { method: 'PUT', cookie, json });

async function boot() {
  lines = [];
  ctx = await createTestContext({
    now: '2026-11-09T09:00:00.000Z',
    deps: { logger: createLogger((l) => lines.push(l)) },
  });
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  return { adminCookie: await login(ctx, 'porteur', admin.password), admin };
}

describe('GET /api/admin/nutrition', () => {
  it('rend l’état de l’interrupteur à l’admin, refuse un non-admin (403)', async () => {
    const { adminCookie } = await boot();
    const get = (cookie: string) => ctx.request('/api/admin/nutrition', { cookie });
    const res = await get(adminCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ full_open: false });
    await put(adminCookie, { full_open: true });
    expect(await (await get(adminCookie)).json()).toEqual({ full_open: true });
    const m = await createUserAndLogin(ctx);
    expect((await get(m.cookie)).status).toBe(403);
  });
});

describe('PUT /api/admin/nutrition', () => {
  it('refuse un non-admin (403) sans toucher à l’état', async () => {
    await boot();
    const m = await createUserAndLogin(ctx);
    expect((await put(m.cookie, { full_open: true })).status).toBe(403);
    const state = await ctx.deps.db.selectFrom('nutritionState').selectAll().executeTakeFirstOrThrow();
    expect(state.fullOpen).toBe(0);
  });

  it('refuse un corps invalide (400)', async () => {
    const { adminCookie } = await boot();
    expect((await put(adminCookie, { full_open: 'oui' })).status).toBe(400);
    expect((await put(adminCookie, {})).status).toBe(400);
  });

  it('ouvre puis ferme : un membre en full passe en qualitative/full_closed', async () => {
    const { adminCookie, admin } = await boot();
    const m = await createUserAndLogin(ctx);
    await fullMember(ctx, m.id);
    await ctx.deps.db.updateTable('nutritionState').set({ fullOpen: 0 }).execute();
    expect(await (await open(ctx, m.cookie)).json()).toMatchObject({
      effective_mode: 'qualitative',
      cause: 'full_closed',
    });

    expect((await put(adminCookie, { full_open: true })).status).toBe(200);
    expect(await (await open(ctx, m.cookie)).json()).toMatchObject({
      effective_mode: 'full',
      full_open: true,
    });

    expect((await put(adminCookie, { full_open: false })).status).toBe(200);
    expect(await (await open(ctx, m.cookie)).json()).toMatchObject({
      effective_mode: 'qualitative',
      cause: 'full_closed',
      stored_mode: 'full',
      full_open: false,
    });
    const state = await ctx.deps.db.selectFrom('nutritionState').selectAll().executeTakeFirstOrThrow();
    expect(state).toMatchObject({ fullOpen: 0, updatedBy: admin.id });
  });

  it('journalise le changement sans donnée personnelle', async () => {
    const { adminCookie, admin } = await boot();
    const m = await createUserAndLogin(ctx);
    await fullMember(ctx, m.id);
    await put(adminCookie, { full_open: false });
    const events = await ctx.deps.db
      .selectFrom('securityEvent')
      .selectAll()
      .where('type', '=', 'nutrition_state_changed')
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: admin.id, targetId: null, outcome: 'success' });
    expect(JSON.parse(events[0]?.details ?? '{}')).toEqual({ fullOpen: false });
    expect(lines.join('\n')).not.toContain(m.id);
  });
});

describe('setSafetyPause', () => {
  it('pose et lève la pause avec un rev neuf ; sans profil, ne fait rien', async () => {
    await boot();
    const m = await createUserAndLogin(ctx);
    await setSafetyPause(ctx.deps.db, ctx.deps, m.id, true);
    expect(await ctx.deps.db.selectFrom('nutritionProfile').selectAll().execute()).toHaveLength(0);

    await fullMember(ctx, m.id);
    const rev = async () =>
      ctx.deps.db.selectFrom('nutritionProfile').select(['rev', 'safetyPause']).executeTakeFirstOrThrow();
    const before = await rev();
    await setSafetyPause(ctx.deps.db, ctx.deps, m.id, true);
    const on = await rev();
    expect(on.safetyPause).toBe(1);
    expect(on.rev).toBeGreaterThan(before.rev);
    await setSafetyPause(ctx.deps.db, ctx.deps, m.id, false);
    expect((await rev()).safetyPause).toBe(0);
  });
});
