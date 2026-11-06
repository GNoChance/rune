import { afterEach, describe, expect, it } from 'vitest';
import { seedOrMergeAdviceSheets } from '../../src/nutrition/advice-loader';
import { createTestContext, createUserAndLogin, insertFixtureRow, type TestContext } from '../support';
import { adviceFile } from './advice-fixtures';

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-11-09T09:00:00.000Z';
const FILES = [
  adviceFile('tous', { audience: 'all' }),
  adviceFile('adulte', { audience: 'adults', visible_modes: ['full', 'qualitative'] }),
  adviceFile('mineur', { audience: 'minors', visible_modes: ['qualitative'] }),
  adviceFile('fluctuations', { audience: 'adults', visible_modes: ['full'] }),
];

async function boot() {
  ctx = await createTestContext({ now: NOW });
  await ctx.deps.db.transaction().execute((trx) => seedOrMergeAdviceSheets(trx, FILES, NOW));
  await ctx.deps.db.updateTable('adviceSheet').set({ status: 'published', publishedAt: NOW }).execute();
}

async function member(mode: 'qualitative' | 'full' | 'disabled', birthDate = '1990-01-01') {
  const u = await createUserAndLogin(ctx, { birthDate });
  if (mode === 'full') {
    await insertFixtureRow(ctx.deps.db, 'consent_event', { ownerId: u.id, type: 'health', action: 'grant' });
    await ctx.deps.db.updateTable('nutritionState').set({ fullOpen: 1 }).execute();
  }
  if (mode !== 'disabled') {
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', {
      ownerId: u.id,
      mode,
      modeReason: 'choice',
      ...(mode === 'full' ? { safetyScreenVersion: 1, safetyScreenAt: NOW } : {}),
    });
  }
  return u;
}
const sheets = (cookie: string, headers?: Record<string, string>) =>
  ctx.request('/api/nutrition/sheets', { cookie, ...(headers ? { headers } : {}) });
const idsOf = async (res: Response) => ((await res.json()) as { id: string }[]).map((s) => s.id);

describe('GET /api/nutrition/sheets', () => {
  it('un adulte en qualitatif ne reçoit pas les fiches du mode complet', async () => {
    await boot();
    const m = await member('qualitative');
    expect(await idsOf(await sheets(m.cookie))).toEqual(['adulte', 'tous']);
  });

  it('un adulte en full reçoit adultes et all', async () => {
    await boot();
    const m = await member('full');
    expect(await idsOf(await sheets(m.cookie))).toEqual(['adulte', 'fluctuations', 'tous']);
  });

  it('un mineur ne reçoit que minors et all, visibles en qualitatif', async () => {
    await boot();
    const m = await member('qualitative', '2012-03-01');
    expect(await idsOf(await sheets(m.cookie))).toEqual(['mineur', 'tous']);
  });

  it('mode disabled : liste vide', async () => {
    await boot();
    const m = await member('disabled');
    const res = await sheets(m.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('ne sert que les fiches publiées, au format servi', async () => {
    await boot();
    await ctx.deps.db
      .updateTable('adviceSheet')
      .set({ status: 'retired' })
      .where('id', '=', 'tous')
      .execute();
    const m = await member('qualitative');
    const body = (await (await sheets(m.cookie)).json()) as Record<string, unknown>[];
    expect(body.map((s) => s.id)).toEqual(['adulte']);
    expect(Object.keys(body[0] ?? {}).sort()).toEqual(
      [
        'audience',
        'body_md',
        'id',
        'reviewed_at',
        'sources',
        'tags',
        'title',
        'version',
        'visible_modes',
      ].sort(),
    );
  });

  it('sans session : 401', async () => {
    await boot();
    expect((await ctx.request('/api/nutrition/sheets')).status).toBe(401);
  });

  it('ETag : 304 sur If-None-Match, change avec le mode, un retrait et une publication', async () => {
    await boot();
    const m = await member('qualitative');
    const first = await sheets(m.cookie);
    const etag = first.headers.get('ETag') ?? '';
    expect(etag).toMatch(/^"[0-9a-f]+-adults-qualitative"$/);
    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    expect((await sheets(m.cookie, { 'If-None-Match': etag })).status).toBe(304);

    const setMode = (mode: 'disabled' | 'qualitative') =>
      ctx.deps.db.updateTable('nutritionProfile').set({ mode }).where('ownerId', '=', m.id).execute();
    await setMode('disabled');
    expect((await sheets(m.cookie)).headers.get('ETag')).not.toBe(etag);
    expect((await sheets(m.cookie, { 'If-None-Match': etag })).status).toBe(200);
    await setMode('qualitative');

    await ctx.deps.db
      .updateTable('adviceSheet')
      .set({ status: 'retired' })
      .where('id', '=', 'tous')
      .execute();
    const afterRetire = (await sheets(m.cookie)).headers.get('ETag');
    expect(afterRetire).not.toBe(etag);
    await ctx.deps.db
      .updateTable('adviceSheet')
      .set({ status: 'published', publishedAt: '2026-11-10T09:00:00.000Z' })
      .where('id', '=', 'tous')
      .execute();
    expect((await sheets(m.cookie)).headers.get('ETag')).not.toBe(afterRetire);
  });

  it('GET /api/catalog garde adviceSheets vide', async () => {
    await boot();
    const m = await member('qualitative');
    const catalog = (await (await ctx.request('/api/catalog', { cookie: m.cookie })).json()) as {
      adviceSheets: unknown[];
    };
    expect(catalog.adviceSheets).toEqual([]);
  });
});
