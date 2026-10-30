import { afterEach, describe, expect, it } from 'vitest';
import { getServerMeta } from '../../src/db/server-meta';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { retiredDraft, sheetFixture, skeletonFixture } from '../support/catalog';
import { seedSheet } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

const T0 = '2026-10-06T10:00:00.000Z';

async function setup() {
  ctx = await createTestContext();
  await seedSheet(ctx, sheetFixture('goblet-squat')); // publiée, révision 4
  await seedSheet(ctx, skeletonFixture('brouillon'));
  await seedSheet(ctx, retiredDraft('retiree'));
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  const zoe = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
  const ines = await createUser(ctx, { username: 'ines', catalogReviewer: true });
  return {
    admin: { ...admin, cookie: await login(ctx, 'porteur', admin.password) },
    zoe: { ...zoe, cookie: await login(ctx, 'zoe', zoe.password) },
    ines: { ...ines, cookie: await login(ctx, 'ines', ines.password) },
  };
}

const comment = (cookie: string, id: string, json: unknown) =>
  ctx.request(`/api/review/exercises/${id}/comments`, { method: 'POST', cookie, json });
const resolve = (cookie: string, cid: string) =>
  ctx.request(`/api/review/comments/${cid}/resolve`, { method: 'POST', cookie, json: {} });
const rows = () => ctx.deps.db.selectFrom('exerciseComment').selectAll().orderBy('createdAt').execute();
const detail = async (cookie: string, id: string) =>
  (await (await ctx.request(`/api/review/exercises/${id}`, { cookie })).json()) as {
    comments: { id: string; part: string; body: string; resolvedAt: string | null; mine: boolean }[];
  };

describe('POST /api/review/exercises/:id/comments (spec brique 2 §3.3)', () => {
  it('enregistre le commentaire avec son auteur et sa révision, sans toucher au catalogue', async () => {
    const { zoe } = await setup();
    const before = (await getServerMeta(ctx.deps.db)).catalogVersion;
    const res = await comment(zoe.cookie, 'goblet-squat', {
      part: 'mistakes',
      body: 'La deuxième erreur répète la première.',
      baseRevision: 4,
    });
    expect(res.status).toBe(201);
    const view = (await res.json()) as { id: string };
    expect(view).toEqual({
      id: expect.any(String),
      part: 'mistakes',
      body: 'La deuxième erreur répète la première.',
      revision: 4,
      createdAt: T0,
      resolvedAt: null,
      authorName: 'zoe',
      mine: true,
    });
    expect(await rows()).toEqual([
      {
        id: view.id,
        exerciseId: 'goblet-squat',
        authorId: zoe.id,
        part: 'mistakes',
        body: 'La deuxième erreur répète la première.',
        revision: 4,
        createdAt: T0,
        resolvedAt: null,
        resolvedBy: null,
      },
    ]);
    expect((await getServerMeta(ctx.deps.db)).catalogVersion).toBe(before);
  });

  it("part hors liste ou absente : 400, rien n'est écrit", async () => {
    const { zoe } = await setup();
    for (const part of ['secret', 'GENERAL', undefined]) {
      const res = await comment(zoe.cookie, 'goblet-squat', { part, body: 'Texte', baseRevision: 4 });
      expect(res.status, String(part)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
    }
    expect(await rows()).toEqual([]);
  });

  it("body nettoyé (\\r\\n, caractères de contrôle et d'inversion de sens), gardé en texte brut", async () => {
    const { zoe } = await setup();
    const raw = '  <b>Genou</b>\r\nqui rentre‮⁦ en *bas*\u0007\t\r\n';
    const res = await comment(zoe.cookie, 'goblet-squat', { part: 'general', body: raw, baseRevision: 4 });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { body: string }).body).toBe('<b>Genou</b>\nqui rentre en *bas*');
    expect((await rows())[0]?.body).toBe('<b>Genou</b>\nqui rentre en *bas*');
  });

  it('de 1 à 1000 caractères après nettoyage, comptés comme le CHECK de la base', async () => {
    const { zoe } = await setup();
    const send = (body: string) =>
      comment(zoe.cookie, 'goblet-squat', { part: 'general', body, baseRevision: 4 });
    expect((await send('x'.repeat(1001))).status).toBe(400);
    expect((await send('‮\r\n\u0000 ')).status).toBe(400);
    expect((await send('')).status).toBe(400);
    expect((await send('x'.repeat(1000))).status).toBe(201);
    // 1000 caractères hors du plan de base (2000 unités UTF-16) : acceptés.
    expect((await send('💪'.repeat(1000))).status).toBe(201);
    // 1001 caractères avant nettoyage, 1000 après.
    expect((await send(`${'x'.repeat(998)}\r\ny`)).status).toBe(201);
    expect(await rows()).toHaveLength(3);
  });

  it('révision dépassée : accepté, avec sa révision ; révision future : 400', async () => {
    const { zoe } = await setup();
    const old = await comment(zoe.cookie, 'goblet-squat', { part: 'safety', body: 'Avis', baseRevision: 2 });
    expect(old.status).toBe(201);
    expect(await old.json()).toMatchObject({ revision: 2 });
    const future = await comment(zoe.cookie, 'goblet-squat', {
      part: 'safety',
      body: 'Avis',
      baseRevision: 5,
    });
    expect(future.status).toBe(400);
    expect((await rows()).map((r) => r.revision)).toEqual([2]);
  });

  it('un brouillon se commente ; une fiche retirée : 409 not_reviewable ; fiche inconnue : 404', async () => {
    const { zoe } = await setup();
    const draft = await comment(zoe.cookie, 'brouillon', {
      part: 'name',
      body: 'Nom à revoir',
      baseRevision: 1,
    });
    expect(draft.status).toBe(201);
    const retired = await comment(zoe.cookie, 'retiree', { part: 'name', body: 'Nom', baseRevision: 4 });
    expect(retired.status).toBe(409);
    expect(await retired.json()).toEqual({ error: 'not_reviewable' });
    const unknown = await comment(zoe.cookie, 'inconnue', { part: 'name', body: 'Nom', baseRevision: 1 });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not_found' });
    expect(await rows()).toHaveLength(1);
  });
});

describe('POST /api/review/comments/:cid/resolve (spec brique 2 §3.3)', () => {
  it("« Traité » par l'autrice : idempotent, resolved_at jamais réécrit", async () => {
    const { zoe } = await setup();
    const created = (await (
      await comment(zoe.cookie, 'goblet-squat', { part: 'general', body: 'À voir', baseRevision: 4 })
    ).json()) as { id: string };
    ctx.clock.advance(60_000);
    const first = await resolve(zoe.cookie, created.id);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ id: created.id, resolvedAt: '2026-10-06T10:01:00.000Z' });
    ctx.clock.advance(60_000);
    const again = await resolve(zoe.cookie, created.id);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ resolvedAt: '2026-10-06T10:01:00.000Z' });
    expect(await rows()).toMatchObject([{ resolvedAt: '2026-10-06T10:01:00.000Z', resolvedBy: zoe.id }]);
  });

  it("une relectrice qui résout le commentaire d'une autre : 403, rien n'est écrit ; l'admin les résout tous", async () => {
    const { zoe, ines, admin } = await setup();
    const created = (await (
      await comment(zoe.cookie, 'goblet-squat', { part: 'general', body: 'À voir', baseRevision: 4 })
    ).json()) as { id: string };
    const denied = await resolve(ines.cookie, created.id);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
    expect(await rows()).toMatchObject([{ resolvedAt: null, resolvedBy: null }]);
    const byAdmin = await resolve(admin.cookie, created.id);
    expect(byAdmin.status).toBe(200);
    expect(await byAdmin.json()).toMatchObject({ authorName: 'zoe', mine: false, resolvedAt: T0 });
    expect(await rows()).toMatchObject([{ resolvedAt: T0, resolvedBy: admin.id }]);
    expect((await resolve(admin.cookie, 'inconnu')).status).toBe(404);
  });

  it("commentaire d'un compte supprimé : « Ancien relecteur » (auteur null), résolu par l'admin seulement", async () => {
    const { zoe, ines, admin } = await setup();
    const created = (await (
      await comment(ines.cookie, 'goblet-squat', { part: 'general', body: 'À voir', baseRevision: 4 })
    ).json()) as { id: string };
    await ctx.deps.db.deleteFrom('session').where('userId', '=', ines.id).execute();
    await ctx.deps.db.deleteFrom('user').where('id', '=', ines.id).execute();
    const seen = await ctx.request('/api/review/exercises/goblet-squat', { cookie: zoe.cookie });
    expect(((await seen.json()) as { comments: unknown[] }).comments).toMatchObject([
      { id: created.id, authorName: null, mine: false },
    ]);
    expect((await resolve(zoe.cookie, created.id)).status).toBe(403);
    expect((await resolve(admin.cookie, created.id)).status).toBe(200);
  });
});

describe('ordre des commentaires (spec brique 2 §3.3)', () => {
  it('ordre de la liste des parties, ouverts avant traités, puis date, puis id', async () => {
    const { zoe, ines } = await setup();
    const post = async (cookie: string, part: string, body: string) => {
      ctx.clock.advance(1000);
      return (
        (await (await comment(cookie, 'goblet-squat', { part, body, baseRevision: 4 })).json()) as {
          id: string;
        }
      ).id;
    };
    await post(zoe.cookie, 'safety', 'sécurité 1');
    const resolvedGeneral = await post(ines.cookie, 'general', 'général traité');
    await post(zoe.cookie, 'name', 'nom');
    await post(ines.cookie, 'general', 'général ouvert 2');
    await post(zoe.cookie, 'general', 'général ouvert 3');
    await post(zoe.cookie, 'mistakes', 'erreurs');
    await resolve(ines.cookie, resolvedGeneral);
    const { comments } = await detail(zoe.cookie, 'goblet-squat');
    expect(comments.map((c) => c.body)).toEqual([
      'général ouvert 2',
      'général ouvert 3',
      'général traité',
      'nom',
      'erreurs',
      'sécurité 1',
    ]);
    expect(comments.map((c) => c.mine)).toEqual([false, true, false, true, true, true]);
  });
});
