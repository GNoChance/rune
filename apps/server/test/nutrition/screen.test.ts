import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  type TestContext,
} from '../support';
import { fullMember, NO_ANSWERS, openFullFor, SETUP, screen } from './fixtures';

/* Écran de sécurité (spec brique 5 §7, D6) : l'issue est recalculée, les réponses ne sont enregistrées nulle part. */

let ctx: TestContext;
let lines: string[];
afterEach(() => ctx?.close());

const NOW = '2026-11-09T09:00:00.000Z';

async function boot(birthDate?: string) {
  lines = [];
  ctx = await createTestContext({ now: NOW, deps: { logger: createLogger((l) => lines.push(l)) } });
  return createUserAndLogin(ctx, birthDate ? { birthDate } : {});
}

const profileOf = (id: string) =>
  ctx.deps.db.selectFrom('nutritionProfile').selectAll().where('ownerId', '=', id).executeTakeFirst();

describe('POST /api/nutrition/screen', () => {
  it('trois non + full + setup : profil, pesée au client, cible initial, version 1, aucune réponse stockée', async () => {
    const u = await boot();
    await openFullFor(ctx, u.id);
    const res = await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: SETUP });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ effective_mode: 'full', mode_reason: 'choice', needs: null });

    expect(await profileOf(u.id)).toMatchObject({
      mode: 'full',
      modeReason: 'choice',
      safetyScreenVersion: 1,
      safetyScreenAt: NOW,
      safetyPause: 0,
      sexForCalc: 'male',
      heightCm: 180,
      activityLevel: 2,
      goal: 'maintain',
    });
    const w = await ctx.deps.db.selectFrom('weighIn').selectAll().execute();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: SETUP.weigh_in.id, ownerId: u.id, date: '2026-11-09', weightG: 80_000 });
    const t = await ctx.deps.db.selectFrom('nutritionTarget').selectAll().execute();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ reason: 'initial', validFrom: '2026-11-09' });
    expect(JSON.parse(t[0]?.inputs ?? '{}')).toMatchObject({ ref_weight_g: 80_000 });

    // Aucune réponse nulle part : ni dans une table, ni dans le journal.
    const tables = await sql<{ name: string }>`select name from sqlite_master where type = 'table'`.execute(
      ctx.deps.db,
    );
    const dump: string[] = [];
    for (const { name } of tables.rows) {
      const rows = await sql<Record<string, unknown>>`select * from ${sql.table(name)}`.execute(ctx.deps.db);
      dump.push(JSON.stringify(rows.rows));
    }
    const everything = [...dump, ...lines].join('\n');
    for (const word of ['yes', 'prefer_not', 'pregnancy']) expect(everything).not.toContain(word);
  });

  it('Q2 yes + full : 422 mode_not_allowed ; Q2 yes + disabled : mode_reason safety', async () => {
    const u = await boot();
    await openFullFor(ctx, u.id);
    const answers = { ...NO_ANSWERS, eating_disorder: 'yes' };
    const refused = await screen(ctx, u.cookie, { answers, mode: 'full', setup: SETUP });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: 'mode_not_allowed' });
    expect(await profileOf(u.id)).toBeUndefined();

    const ok = await screen(ctx, u.cookie, { answers, mode: 'disabled' });
    expect(ok.status).toBe(200);
    expect(await profileOf(u.id)).toMatchObject({
      mode: 'disabled',
      modeReason: 'safety',
      safetyScreenVersion: 1,
    });
  });

  it('un « je préfère ne pas répondre » impose le qualitatif (safety)', async () => {
    const u = await boot();
    await openFullFor(ctx, u.id);
    const answers = { ...NO_ANSWERS, medical: 'prefer_not' };
    expect((await screen(ctx, u.cookie, { answers, mode: 'full', setup: SETUP })).status).toBe(422);
    expect((await screen(ctx, u.cookie, { answers, mode: 'qualitative' })).status).toBe(200);
    expect(await profileOf(u.id)).toMatchObject({ mode: 'qualitative', modeReason: 'safety' });
  });

  it('full sans setup ni réglages : 422 setup_required', async () => {
    const u = await boot();
    await openFullFor(ctx, u.id);
    const res = await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'setup_required' });
    expect(await profileOf(u.id)).toBeUndefined();
  });

  it("un mineur : 422 mode_not_allowed même avec trois non, et rien n'est écrit", async () => {
    const u = await boot('2010-01-01');
    await openFullFor(ctx, u.id);
    for (const mode of ['full', 'qualitative']) {
      const res = await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode, setup: SETUP });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: 'mode_not_allowed' });
    }
    expect(await profileOf(u.id)).toBeUndefined();
    expect(await ctx.deps.db.selectFrom('weighIn').selectAll().execute()).toHaveLength(0);
  });

  it('au-delà de 78 ans, full est refusé mais le qualitatif passe', async () => {
    const u = await boot('1940-01-01');
    await openFullFor(ctx, u.id);
    expect((await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: SETUP })).status).toBe(
      422,
    );
    expect((await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'qualitative' })).status).toBe(200);
  });

  it('sans accord santé : 403 health_consent_required', async () => {
    const u = await boot();
    await ctx.deps.db.updateTable('nutritionState').set({ fullOpen: 1 }).execute();
    const res = await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: SETUP });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'health_consent_required' });
  });

  it('full_open fermé : 422 mode_not_allowed', async () => {
    const u = await boot();
    await insertFixtureRow(ctx.deps.db, 'consent_event', { ownerId: u.id, type: 'health', action: 'grant' });
    const res = await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: SETUP });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'mode_not_allowed' });
  });

  it('une pesée dans le futur ou hors pas de 100 g : 400, rien écrit', async () => {
    const u = await boot();
    await openFullFor(ctx, u.id);
    const future = { ...SETUP, weigh_in: { ...SETUP.weigh_in, date: '2026-11-10' } };
    const res = await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: future });
    expect(res.status).toBe(400);
    expect(await profileOf(u.id)).toBeUndefined();
    const step = { ...SETUP, weigh_in: { ...SETUP.weigh_in, weight_g: 80_050 } };
    expect((await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: step })).status).toBe(
      400,
    );
  });

  it('un objectif lose avec un IMC < 18,5 est rangé en maintain', async () => {
    const u = await boot();
    await openFullFor(ctx, u.id);
    const lean = { ...SETUP, goal: 'lose', weigh_in: { ...SETUP.weigh_in, weight_g: 55_000 } };
    expect((await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: lean })).status).toBe(
      200,
    );
    expect(await profileOf(u.id)).toMatchObject({ goal: 'maintain' });
  });

  it('repasser l’écran lève safety_pause et garde les réglages sans nouvelle cible', async () => {
    const u = await boot();
    await fullMember(ctx, u.id);
    await ctx.deps.db
      .updateTable('nutritionProfile')
      .set({ safetyPause: 1, safetyScreenVersion: 0 })
      .execute();
    const res = await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full' });
    expect(res.status).toBe(200);
    expect(await profileOf(u.id)).toMatchObject({ safetyPause: 0, safetyScreenVersion: 1, heightCm: 180 });
    expect(await ctx.deps.db.selectFrom('nutritionTarget').selectAll().execute()).toHaveLength(0);
  });

  it('une pesée déjà prise ce jour-là est mise à jour, pas dupliquée', async () => {
    const u = await boot();
    await openFullFor(ctx, u.id);
    await insertFixtureRow(ctx.deps.db, 'weigh_in', { ownerId: u.id, date: '2026-11-09', weightG: 79_000 });
    expect((await screen(ctx, u.cookie, { answers: NO_ANSWERS, mode: 'full', setup: SETUP })).status).toBe(
      200,
    );
    const w = await ctx.deps.db.selectFrom('weighIn').selectAll().execute();
    expect(w).toHaveLength(1);
    expect(w[0]?.weightG).toBe(80_000);
  });
});
