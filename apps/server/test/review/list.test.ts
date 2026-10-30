import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUser, insertFixtureRow, login, type TestContext } from '../support';
import { sheetFixture, skeletonFixture } from '../support/catalog';
import { saveSheet, seedSheet } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

type Item = { id: string; queues: string[] } & Record<string, unknown>;
type ListBody = {
  items: Item[];
  counts: Record<string, number>;
  progress: unknown[];
  admin?: unknown;
};

async function users() {
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  const zoe = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
  const ines = await createUser(ctx, { username: 'ines', catalogReviewer: true });
  const hana = await createUser(ctx, { username: 'hana', catalogReviewer: true, healthProfessional: true });
  return {
    admin: { ...admin, cookie: await login(ctx, 'porteur', admin.password) },
    zoe: { ...zoe, cookie: await login(ctx, 'zoe', zoe.password) },
    ines: { ...ines, cookie: await login(ctx, 'ines', ines.password) },
    hana: { ...hana, cookie: await login(ctx, 'hana', hana.password) },
  };
}

const post = (cookie: string, path: string, json: unknown) =>
  ctx.request(path, { method: 'POST', cookie, json });

/**
 * Un brouillon, une relue non sensible, une relue sensible sans feu vert, une publiée sensible modifiée après son
 * feu vert, une publiée sensible au feu vert à jour. Noms choisis pour que l'ordre binaire diffère de la collation.
 */
async function setup() {
  ctx = await createTestContext();
  const u = await users();
  await seedSheet(ctx, skeletonFixture('brouillon', { name: 'Abdos roulette', batch: 'A' }));
  await seedSheet(
    ctx,
    sheetFixture('relue-simple', {
      status: 'reviewed',
      name: 'Élévation latérale',
      stressed_joints: ['hips'],
      published_at: undefined,
    }),
  );
  await seedSheet(
    ctx,
    sheetFixture('relue-sensible', {
      status: 'reviewed',
      name: 'escalier',
      level: 2,
      published_at: undefined,
    }),
  );
  const modified = await seedSheet(
    ctx,
    sheetFixture('publiee-modifiee', { name: 'Fente avant', batch: 'E1' }),
  );
  await seedSheet(ctx, sheetFixture('publiee-a-jour', { name: 'Gainage', reviewed_by: u.admin.id }));
  await insertFixtureRow(ctx.deps.db, 'illustration', { replaceBeforePublic: 1 });

  for (const id of ['publiee-modifiee', 'publiee-a-jour']) {
    expect(
      (await post(u.hana.cookie, `/api/review/exercises/${id}/validations`, { baseRevision: 4 })).status,
    ).toBe(201);
  }
  await saveSheet(ctx, { ...modified, breathing: 'Souffle en remontant.' }, u.admin.id);

  const comment = (cookie: string, id: string) =>
    post(cookie, `/api/review/exercises/${id}/comments`, { part: 'general', body: 'Avis', baseRevision: 1 });
  expect((await comment(u.zoe.cookie, 'brouillon')).status).toBe(201);
  expect((await comment(u.ines.cookie, 'relue-sensible')).status).toBe(201);
  // Commentaire traité : ni dans « Mes commentaires », ni bloquant.
  const done = (await (await comment(u.zoe.cookie, 'relue-simple')).json()) as { id: string };
  expect((await post(u.zoe.cookie, `/api/review/comments/${done.id}/resolve`, {})).status).toBe(200);
  return u;
}

const list = async (cookie: string, query = '') => {
  const res = await ctx.request(`/api/review/exercises${query}`, { cookie });
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, body: JSON.parse(text) as ListBody };
};
const ids = async (cookie: string, query = '') => (await list(cookie, query)).body.items.map((i) => i.id);

describe('GET /api/review/exercises : files (spec brique 2 §3.8)', () => {
  it("chaque file rend exactement les fiches de son prédicat, pour l'appelant", async () => {
    const { zoe, ines } = await setup();
    expect(await ids(zoe.cookie, '?queue=to_review')).toEqual(['relue-simple', 'relue-sensible']);
    expect(await ids(zoe.cookie, '?queue=drafts')).toEqual(['brouillon']);
    expect(await ids(zoe.cookie, '?queue=health_pending')).toEqual(['relue-sensible']);
    expect(await ids(zoe.cookie, '?queue=revalidate')).toEqual(['publiee-modifiee']);
    expect(await ids(zoe.cookie, '?queue=mine')).toEqual(['brouillon']);
    expect(await ids(zoe.cookie, '?queue=ready_to_publish')).toEqual(['relue-simple']);
    expect(await ids(ines.cookie, '?queue=mine')).toEqual(['relue-sensible']);

    // Valider le contenu courant sort la fiche de la file « À relire » de l'appelante seulement.
    const validated = await post(zoe.cookie, '/api/review/exercises/relue-simple/validations', {
      baseRevision: 4,
    });
    expect(validated.status).toBe(201);
    expect(await ids(zoe.cookie, '?queue=to_review')).toEqual(['relue-sensible']);
    expect(await ids(ines.cookie, '?queue=to_review')).toEqual(['relue-simple', 'relue-sensible']);
    const { body } = await list(zoe.cookie);
    expect(body.counts).toEqual({
      to_review: 1,
      drafts: 1,
      health_pending: 1,
      revalidate: 1,
      mine: 1,
      ready_to_publish: 1,
    });
  });

  it('sans filtre : toutes les fiches, triées par nom (collation française) ; lignes, compteurs et avancement', async () => {
    const { zoe } = await setup();
    const { body } = await list(zoe.cookie);
    expect(body.items.map((i) => i.id)).toEqual([
      'brouillon',
      'relue-simple',
      'relue-sensible',
      'publiee-modifiee',
      'publiee-a-jour',
    ]);
    expect(body.items.find((i) => i.id === 'publiee-modifiee')).toEqual({
      id: 'publiee-modifiee',
      name: 'Fente avant',
      status: 'published',
      batch: 'E1',
      revision: 5,
      movementPattern: 'squat',
      level: 1,
      notForMinors: false,
      stressedJoints: ['knees', 'hips'],
      sensitive: true,
      openComments: 0,
      greenLight: 'stale',
      validatedByMe: false,
      illustrationCount: 0,
      queues: ['revalidate'],
    });
    expect(body.items.find((i) => i.id === 'publiee-a-jour')).toMatchObject({ greenLight: 'ok', queues: [] });
    expect(body.items.find((i) => i.id === 'relue-sensible')).toMatchObject({
      sensitive: true,
      openComments: 1,
      greenLight: 'missing',
      queues: ['to_review', 'health_pending'],
    });
    expect(body.items.find((i) => i.id === 'brouillon')).toMatchObject({
      stressedJoints: [],
      sensitive: false,
      openComments: 1,
      queues: ['drafts', 'mine'],
    });
    expect(body.counts).toEqual({
      to_review: 2,
      drafts: 1,
      health_pending: 1,
      revalidate: 1,
      mine: 1,
      ready_to_publish: 1,
    });
    expect(body.progress).toEqual([
      { batch: 'A', published: 1, total: 4 },
      { batch: 'B', published: 0, total: 0 },
      { batch: 'E1', published: 1, total: 1 },
    ]);
  });

  it('filtres status et batch, cumulables avec la file ; valeur inconnue : 400', async () => {
    const { zoe } = await setup();
    expect(await ids(zoe.cookie, '?status=published')).toEqual(['publiee-modifiee', 'publiee-a-jour']);
    expect(await ids(zoe.cookie, '?batch=E1')).toEqual(['publiee-modifiee']);
    expect(await ids(zoe.cookie, '?queue=to_review&batch=E1')).toEqual([]);
    const scoped = await list(zoe.cookie, '?status=reviewed');
    expect(scoped.body.counts).toMatchObject({ to_review: 2, drafts: 0, revalidate: 0 });
    for (const query of ['?queue=all', '?batch=C', '?status=deleted']) {
      const res = await ctx.request(`/api/review/exercises${query}`, { cookie: zoe.cookie });
      expect(res.status, query).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
    }
  });

  it('égalité de nom à la collation près : départagée par id en ordre binaire', async () => {
    ctx = await createTestContext();
    const { zoe } = await users();
    await seedSheet(ctx, skeletonFixture('z-pompe', { name: 'Pompe' }));
    await seedSheet(ctx, skeletonFixture('b-rameur', { name: 'Rameur' }));
    await seedSheet(ctx, skeletonFixture('a-pompe', { name: 'pompé' }));
    expect(await ids(zoe.cookie)).toEqual(['a-pompe', 'z-pompe', 'b-rameur']);
  });
});

describe('visibilité dans la liste (spec brique 2 §3.1)', () => {
  it("une relectrice ne reçoit ni drafting, ni reviewed_by, ni l'auteur des feux verts ; l'admin a ses compteurs", async () => {
    const { zoe, hana, admin } = await setup();
    const { text, body } = await list(zoe.cookie);
    for (const leak of [
      'drafting',
      'reviewed_by',
      'reviewedBy',
      hana.id,
      admin.id,
      '"hana"',
      '"health"',
      'reviewerId',
      'healthProfessional',
      'catalogReviewer',
    ]) {
      expect(text, leak).not.toContain(leak);
    }
    expect(body).not.toHaveProperty('admin');
    const forAdmin = await list(admin.cookie);
    expect(forAdmin.body.admin).toEqual({ toExport: 1, replaceBeforePublic: 1 });
  });
});
