import { type DraftSheet, EXERCISES_EXPORT_FILE, type ReviewListResponse } from '@rune/contracts';
import { canonicalJson } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { retiredDraft, sheetFixture, skeletonFixture } from '../support/catalog';
import { putSheet, rebuild, seedSheet } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(sheets: readonly DraftSheet[]) {
  ctx = await createTestContext();
  for (const sheet of sheets) await seedSheet(ctx, sheet);
  await rebuild(ctx);
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  return login(ctx, 'porteur', admin.password);
}

const exportCatalog = (cookie: string) => ctx.request('/api/admin/exercises/export', { cookie });
const toExport = async (cookie: string) =>
  ((await (await ctx.request('/api/review/exercises', { cookie })).json()) as ReviewListResponse).admin
    ?.toExport;

describe('GET /api/admin/exercises/export (04 §10)', () => {
  it('un fichier : toutes les fiches de tous statuts, triées par id, en forme canonique, sans exported_revision', async () => {
    const sheets = [
      sheetFixture('push-up'),
      skeletonFixture('brouillon'),
      sheetFixture('relue', { status: 'reviewed', published_at: undefined }),
      retiredDraft('ancienne'),
    ];
    const cookie = await setup(sheets);
    const res = await exportCatalog(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${EXERCISES_EXPORT_FILE}"`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const text = await res.text();
    const sorted = [...sheets].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(text).toBe(
      `${JSON.stringify(
        sorted.map((s) => JSON.parse(canonicalJson(s))),
        null,
        2,
      )}\n`,
    );
    expect(text).not.toContain('exported_revision');
    expect(text).toContain('REPERE-RETIRE');
  });

  it('met exported_revision à jour : le compteur « à exporter » revient à 0', async () => {
    const sheet = sheetFixture('push-up');
    const cookie = await setup([sheet, skeletonFixture('brouillon')]);
    expect(await toExport(cookie)).toBe(0);
    expect((await putSheet(ctx, cookie, 'push-up', { ...sheet, breathing: 'Souffle.' }, 4)).status).toBe(200);
    expect(await toExport(cookie)).toBe(1);
    expect((await exportCatalog(cookie)).status).toBe(200);
    expect(await toExport(cookie)).toBe(0);
    const rows = await ctx.deps.db.selectFrom('exercise').select(['revision', 'exportedRevision']).execute();
    expect(rows.every((r) => r.exportedRevision === r.revision)).toBe(true);
  });

  it('catalogue vide : un tableau vide', async () => {
    const cookie = await setup([]);
    expect(await (await exportCatalog(cookie)).text()).toBe('[]\n');
  });

  it('navigation venue d’un autre site (Sec-Fetch-Site) : 403 origin_mismatch, le compteur reste', async () => {
    const sheet = sheetFixture('push-up');
    const cookie = await setup([sheet]);
    expect((await putSheet(ctx, cookie, 'push-up', { ...sheet, breathing: 'Souffle.' }, 4)).status).toBe(200);
    const fetchFrom = (site: string) =>
      ctx.request('/api/admin/exercises/export', { cookie, headers: { 'Sec-Fetch-Site': site } });
    for (const site of ['cross-site', 'same-site']) {
      const res = await fetchFrom(site);
      expect(res.status, site).toBe(403);
      expect(await res.json(), site).toEqual({ error: 'origin_mismatch' });
    }
    expect(await toExport(cookie)).toBe(1);
    // la page elle-même, puis l'adresse tapée ou un favori
    for (const site of ['same-origin', 'none']) expect((await fetchFrom(site)).status, site).toBe(200);
    expect(await toExport(cookie)).toBe(0);
  });
});
