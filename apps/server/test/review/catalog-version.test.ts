import type { CatalogBundle, DraftSheet, ReviewListResponse } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { getServerMeta } from '../../src/db/server-meta';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { sheetFixture, skeletonFixture } from '../support/catalog';
import { postTransition, putSheet, rebuild, seedSheet } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-10-30T09:00:00.000Z';

async function setup() {
  ctx = await createTestContext();
  const published = await seedSheet(ctx, sheetFixture('goblet-squat')); // publiée, sensible (genoux)
  const plain = await seedSheet(ctx, sheetFixture('hip-thrust', { stressed_joints: ['hips'] })); // publiée
  const relue = await seedSheet(
    ctx,
    sheetFixture('relue', { status: 'reviewed', published_at: undefined, stressed_joints: ['hips'] }),
  );
  const draft = await seedSheet(ctx, skeletonFixture('brouillon'));
  await rebuild(ctx);
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  const hana = await createUser(ctx, { username: 'hana', catalogReviewer: true, healthProfessional: true });
  const lea = await createUser(ctx, { username: 'lea' });
  const cookies = {
    admin: await login(ctx, 'porteur', admin.password),
    hana: await login(ctx, 'hana', hana.password),
    lea: await login(ctx, 'lea', lea.password),
  };
  ctx.clock.set(NOW);
  return { cookies, published, plain, relue, draft };
}

const version = async () => (await getServerMeta(ctx.deps.db)).catalogVersion;

/** `GET /api/catalog` d'un membre, avec l'ETag déjà reçu par le téléphone. */
async function phone(cookie: string, etag?: string) {
  const res = await ctx.request('/api/catalog', {
    cookie,
    ...(etag === undefined ? {} : { headers: { 'If-None-Match': etag } }),
  });
  return {
    status: res.status,
    etag: res.headers.get('ETag'),
    body: res.status === 200 ? ((await res.json()) as CatalogBundle) : null,
  };
}

const ids = (bundle: CatalogBundle | null) => bundle?.exercises.map((e) => e.id);

async function expect200(res: Promise<Response>) {
  const response = await res;
  expect(response.status, await response.clone().text()).toBe(200);
}

describe('version du catalogue (spec brique 2 §3.7)', () => {
  it('publier change catalog_version et GET /api/catalog sert la fiche', async () => {
    const { cookies } = await setup();
    const first = await phone(cookies.lea);
    expect(ids(first.body)).toEqual(['goblet-squat', 'hip-thrust']);
    const before = await version();
    expect(first.etag).toBe(`"${before}"`);

    await expect200(postTransition(ctx, cookies.admin, 'relue', { to: 'published', baseRevision: 4 }));
    const after = await version();
    expect(after).not.toBe(before);
    const next = await phone(cookies.lea, first.etag ?? '');
    expect(next.status).toBe(200);
    expect(next.etag).toBe(`"${after}"`);
    expect(ids(next.body)).toEqual(['goblet-squat', 'hip-thrust', 'relue']);
    expect((await phone(cookies.lea, next.etag ?? '')).status).toBe(304);
  });

  it('fiche publiée corrigée : nouveau contenu servi, nouvelle version, et « À revalider » si sensible (Review Focus 1)', async () => {
    const { cookies, published, plain } = await setup();
    const validate = (id: string) =>
      ctx.request(`/api/review/exercises/${id}/validations`, {
        method: 'POST',
        cookie: cookies.hana,
        json: { baseRevision: 4 },
      });
    expect((await validate('goblet-squat')).status).toBe(201);
    expect((await validate('hip-thrust')).status).toBe(201);
    const first = await phone(cookies.lea);
    const queue = async () => {
      const res = await ctx.request('/api/review/exercises?queue=revalidate', { cookie: cookies.hana });
      return ((await res.json()) as ReviewListResponse).items.map((i) => i.id);
    };
    expect(await queue()).toEqual([]);

    const fix = { ...published, breathing: 'Inspire en bas, souffle en remontant.' };
    await expect200(putSheet(ctx, cookies.admin, 'goblet-squat', fix, 4));
    const next = await phone(cookies.lea, first.etag ?? '');
    expect(next.status).toBe(200);
    expect(next.etag).not.toBe(first.etag);
    expect(next.body?.exercises.find((e) => e.id === 'goblet-squat')).toMatchObject({
      status: 'published',
      revision: 5,
      breathing: fix.breathing,
    });
    expect(await queue()).toEqual(['goblet-squat']);

    // Fiche publiée qui devient sensible après une modification (niveau 1 → 2) : elle y entre aussi.
    await expect200(putSheet(ctx, cookies.admin, 'hip-thrust', { ...plain, level: 2 } as DraftSheet, 4));
    expect(await queue()).toEqual(['goblet-squat', 'hip-thrust']);
    const detail = await ctx.request('/api/review/exercises/hip-thrust', { cookie: cookies.admin });
    expect(await detail.json()).toMatchObject({
      sensitive: true,
      greenLight: 'stale',
      queues: ['revalidate'],
    });
  });

  it('écrire un brouillon, le relire puis le renvoyer en rédaction ne change pas la version', async () => {
    const { cookies, draft, relue } = await setup();
    const before = await version();
    await expect200(putSheet(ctx, cookies.admin, 'brouillon', { ...draft, name: 'Squat sumo' }, 1));
    await expect200(putSheet(ctx, cookies.admin, 'relue', { ...relue, breathing: 'Souffle.' }, 4));
    await expect200(postTransition(ctx, cookies.admin, 'relue', { to: 'draft', baseRevision: 5 }));
    await expect200(postTransition(ctx, cookies.admin, 'brouillon', { to: 'retired', baseRevision: 2 }));
    expect(await version()).toBe(before);
  });

  it('commenter, valider ou un refus (409, 422) ne change pas la version', async () => {
    const { cookies, published } = await setup();
    const before = await version();
    const comment = await ctx.request('/api/review/exercises/goblet-squat/comments', {
      method: 'POST',
      cookie: cookies.hana,
      json: { part: 'general', body: 'Avis.', baseRevision: 4 },
    });
    expect(comment.status).toBe(201);
    const validation = await ctx.request('/api/review/exercises/goblet-squat/validations', {
      method: 'POST',
      cookie: cookies.hana,
      json: { baseRevision: 4 },
    });
    expect(validation.status).toBe(201);
    expect((await putSheet(ctx, cookies.admin, 'goblet-squat', { ...published, safety: [] }, 4)).status).toBe(
      422,
    );
    expect((await putSheet(ctx, cookies.admin, 'goblet-squat', published, 3)).status).toBe(409);
    expect(await version()).toBe(before);
    const served = await phone(cookies.lea);
    expect(served.etag).toBe(`"${before}"`);
  });
});
