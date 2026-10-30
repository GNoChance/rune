import { afterEach, describe, expect, it } from 'vitest';
import { getServerMeta } from '../../src/db/server-meta';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { retiredDraft, sheetFixture, skeletonFixture } from '../support/catalog';
import { saveSheet, seedSheet } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

const T0 = '2026-10-06T10:00:00.000Z';
// Publiée, révision 4, sensible (genoux) ; relue par l'admin.
const goblet = (reviewedBy: string) => sheetFixture('goblet-squat', { reviewed_by: reviewedBy });

async function setup() {
  ctx = await createTestContext();
  // Drapeau santé coché sur un admin (avant une promotion, par exemple) : jamais un feu vert.
  const admin = await createUser(ctx, {
    username: 'porteur',
    role: 'admin',
    password: 'quatorze carac',
    healthProfessional: true,
  });
  const zoe = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
  const hana = await createUser(ctx, { username: 'hana', catalogReviewer: true, healthProfessional: true });
  const sheet = await seedSheet(ctx, goblet(admin.id));
  await seedSheet(ctx, skeletonFixture('brouillon'));
  await seedSheet(ctx, retiredDraft('retiree'));
  return {
    sheet,
    admin: { ...admin, cookie: await login(ctx, 'porteur', admin.password) },
    zoe: { ...zoe, cookie: await login(ctx, 'zoe', zoe.password) },
    hana: { ...hana, cookie: await login(ctx, 'hana', hana.password) },
  };
}

const validate = (cookie: string, id: string, baseRevision: unknown) =>
  ctx.request(`/api/review/exercises/${id}/validations`, { method: 'POST', cookie, json: { baseRevision } });
const rows = () => ctx.deps.db.selectFrom('exerciseValidation').selectAll().orderBy('createdAt').execute();
const detail = async (cookie: string, id = 'goblet-squat') => {
  const res = await ctx.request(`/api/review/exercises/${id}`, { cookie });
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, body: JSON.parse(text) as Record<string, unknown> };
};

describe('POST /api/review/exercises/:id/validations (spec brique 2 §3.4)', () => {
  it("fiche ni relue ni publiée : 409 not_reviewable ; fiche inconnue : 404 ; rien n'est écrit", async () => {
    const { zoe } = await setup();
    const draft = await validate(zoe.cookie, 'brouillon', 1);
    expect(draft.status).toBe(409);
    expect(await draft.json()).toEqual({ error: 'not_reviewable' });
    const retired = await validate(zoe.cookie, 'retiree', 4);
    expect(retired.status).toBe(409);
    expect(await retired.json()).toEqual({ error: 'not_reviewable' });
    const unknown = await validate(zoe.cookie, 'inconnue', 1);
    expect(unknown.status).toBe(404);
    expect((await validate(zoe.cookie, 'goblet-squat', 'quatre')).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("révision dépassée ou future : 409 revision_conflict avec la fiche courante, rien n'est écrit", async () => {
    const { zoe, admin, sheet } = await setup();
    await saveSheet(ctx, { ...sheet, breathing: 'Souffle en remontant.' }, admin.id);
    for (const base of [4, 6]) {
      const res = await validate(zoe.cookie, 'goblet-squat', base);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; current: Record<string, unknown> };
      expect(body.error).toBe('revision_conflict');
      expect(body.current).toMatchObject({
        id: 'goblet-squat',
        revision: 5,
        breathing: 'Souffle en remontant.',
      });
      // Vue d'une relectrice (spec brique 2 §3.1).
      expect(body.current).not.toHaveProperty('drafting');
      expect(body.current).not.toHaveProperty('reviewed_by');
    }
    expect(await rows()).toEqual([]);
  });

  it('doublon : 200 et la même validation ; une seule ligne', async () => {
    const { zoe } = await setup();
    const first = await validate(zoe.cookie, 'goblet-squat', 4);
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toEqual({ id: expect.any(String), revision: 4, createdAt: T0 });
    ctx.clock.advance(60_000);
    const again = await validate(zoe.cookie, 'goblet-squat', 4);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(created);
    expect(await rows()).toHaveLength(1);
  });

  it("health copié = drapeau santé effectif (un admin ne l'est jamais), sans toucher au catalogue", async () => {
    const { zoe, hana, admin } = await setup();
    const before = (await getServerMeta(ctx.deps.db)).catalogVersion;
    for (const who of [hana, zoe, admin])
      expect((await validate(who.cookie, 'goblet-squat', 4)).status).toBe(201);
    expect((await rows()).map((r) => [r.reviewerId, r.health, r.revision])).toEqual([
      [hana.id, 1, 4],
      [zoe.id, 0, 4],
      [admin.id, 0, 4],
    ]);
    expect((await getServerMeta(ctx.deps.db)).catalogVersion).toBe(before);
  });
});

describe('feu vert santé et différentiel (spec brique 2 §3.2)', () => {
  it('feu vert à jour, puis à refaire après une modification du contenu ; différentiel de chacun', async () => {
    const { zoe, hana, admin, sheet } = await setup();
    expect((await validate(hana.cookie, 'goblet-squat', 4)).status).toBe(201);

    const fresh = await detail(hana.cookie);
    expect(fresh.body).toMatchObject({ greenLight: 'ok', sensitive: true, validatedByMe: true, diff: [] });
    expect(fresh.body.queues).not.toContain('revalidate');
    const other = await detail(zoe.cookie);
    expect(other.body).toMatchObject({ greenLight: 'ok', validatedByMe: false, diff: null, diffBase: null });

    await saveSheet(
      ctx,
      { ...sheet, level: 2, safety: ['Arrête si ton genou fait mal.'], review_notes: 'Notes revues' },
      admin.id,
    );
    const stale = await detail(hana.cookie);
    expect(stale.body).toMatchObject({
      greenLight: 'stale',
      validatedByMe: false,
      diff: ['level', 'safety'],
      diffBase: { revision: 4, values: { level: 1, safety: [sheet.safety[0]] } },
    });
    expect(stale.body.queues).toContain('revalidate');

    // La relectrice voit l'état agrégé, jamais qui l'a donné, ni le drapeau santé.
    const seen = await detail(zoe.cookie);
    expect(seen.body).toMatchObject({ greenLight: 'stale', diff: null });
    expect(seen.body).not.toHaveProperty('validations');
    expect(seen.body).not.toHaveProperty('exportedRevision');
    expect(seen.body.sheet).not.toHaveProperty('drafting');
    expect(seen.body.sheet).not.toHaveProperty('reviewed_by');
    expect(seen.body.sheet).toMatchObject({ review_notes: 'Notes revues' });
    for (const leak of [hana.id, admin.id, '"hana"', '"health"', 'healthProfessional', 'catalogReviewer']) {
      expect(seen.text).not.toContain(leak);
    }

    // L'admin voit les validations nominatives et le différentiel depuis le dernier feu vert qui compte encore.
    const forAdmin = await detail(admin.cookie);
    expect(forAdmin.body).toMatchObject({
      greenLight: 'stale',
      diff: ['level', 'safety'],
      exportedRevision: 4,
      validations: [
        {
          reviewerId: hana.id,
          reviewerName: 'hana',
          revision: 4,
          health: true,
          standing: true,
          createdAt: T0,
        },
      ],
    });
    expect(forAdmin.body.sheet).toMatchObject({ reviewed_by: admin.id, drafting: sheet.drafting });
  });

  it('une transition sans changement de contenu ne périme pas le feu vert', async () => {
    const { hana, admin, sheet } = await setup();
    expect((await validate(hana.cookie, 'goblet-squat', 4)).status).toBe(201);
    const reviewed = await saveSheet(ctx, { ...sheet, status: 'reviewed' }, admin.id);
    await saveSheet(ctx, { ...reviewed, status: 'published' }, admin.id);
    const { body } = await detail(hana.cookie);
    expect(body).toMatchObject({ greenLight: 'ok', validatedByMe: true, diff: [] });
  });

  it("drapeau santé retiré après la validation : feu vert manquant ; validation de l'autrice du contenu : pas comptée", async () => {
    const { hana, admin, sheet } = await setup();
    expect((await validate(hana.cookie, 'goblet-squat', 4)).status).toBe(201);
    await ctx.deps.db.updateTable('user').set({ healthProfessional: 0 }).where('id', '=', hana.id).execute();
    expect((await detail(admin.cookie)).body).toMatchObject({
      greenLight: 'missing',
      diff: null,
      validations: [{ health: true, standing: false }],
    });
    await ctx.deps.db.updateTable('user').set({ healthProfessional: 1 }).where('id', '=', hana.id).execute();

    // Dernière modification du contenu écrite par hana : sa validation est enregistrée mais ne compte pas.
    await saveSheet(ctx, { ...sheet, breathing: 'Souffle en remontant.' }, hana.id);
    const res = await validate(hana.cookie, 'goblet-squat', 5);
    expect(res.status).toBe(201);
    expect((await rows()).map((r) => [r.revision, r.health])).toEqual([
      [4, 1],
      [5, 1],
    ]);
    const { body } = await detail(hana.cookie);
    expect(body).toMatchObject({ greenLight: 'missing', validatedByMe: true });
    expect(body.queues).toContain('revalidate');
  });
});
