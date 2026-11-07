import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  makeOp,
  seqIds,
  syncPush,
  type TestContext,
} from '../support';
import { fullMember } from './fixtures';

/* Push des pesées (spec brique 5 §6.3), dans l'ordre de la spec. */

let ctx: TestContext;
afterEach(() => ctx?.close());

const ids = seqIds(9100);
const rows = () => ctx.deps.db.selectFrom('weighIn').selectAll().orderBy('rev').execute();
const rejections = () => ctx.deps.db.selectFrom('syncRejection').selectAll().execute();

async function setup(o: { full?: boolean } = {}) {
  ctx = await createTestContext({ now: '2026-11-09T09:00:00.000Z' });
  const u = await createUserAndLogin(ctx);
  if (o.full !== false) await fullMember(ctx, u.id);
  return u;
}

const create = (userId: string, fields: Record<string, unknown>, id = ids.uuidv7()) =>
  makeOp({ userId, entity: 'weigh_in', id, kind: 'create', fields });

describe('push de weigh_in', () => {
  it('1. sans accord santé : applied_partial, aucune ligne, aucun sync_rejection', async () => {
    const u = await setup({ full: false });
    const res = await syncPush(ctx, u.cookie, [create(u.id, { date: '2026-11-09', weightG: 80_000 })]);
    expect(res.body.results[0]).toMatchObject({ status: 'applied_partial', dropped: true });
    expect(await rows()).toHaveLength(0);
    expect(await rejections()).toHaveLength(0);
  });

  it('2. mode qualitatif : rejet forbidden, motif nutrition_mode_qualitative, rien écrit', async () => {
    const u = await setup();
    await ctx.deps.db.updateTable('nutritionProfile').set({ mode: 'qualitative' }).execute();
    const res = await syncPush(ctx, u.cookie, [create(u.id, { date: '2026-11-09', weightG: 80_000 })]);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await rows()).toHaveLength(0);
    const [rejection] = await rejections();
    expect(rejection?.code).toBe('forbidden');
    expect(JSON.parse(rejection?.detailJson ?? '{}').reason).toBe('nutrition_mode_qualitative');
  });

  it.each([
    ['250 100 g', { date: '2026-11-09', weightG: 250_100 }],
    ['72 550 g', { date: '2026-11-09', weightG: 72_550 }],
    ['29 900 g', { date: '2026-11-09', weightG: 29_900 }],
    ['date de demain (Paris)', { date: '2026-11-10', weightG: 80_000 }],
    ['date impossible', { date: '2026-02-31', weightG: 80_000 }],
    ['mois et jour hors calendrier', { date: '2026-13-45', weightG: 80_000 }],
    ['date absente', { weightG: 80_000 }],
  ])('3. %s : validation', async (_name, fields) => {
    const u = await setup();
    const res = await syncPush(ctx, u.cookie, [create(u.id, fields)]);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', code: 'validation' });
    expect(await rows()).toHaveLength(0);
  });

  it('3. la date du jour à Paris passe même quand UTC est encore la veille', async () => {
    ctx = await createTestContext({ now: '2026-11-09T23:30:00.000Z' });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    const res = await syncPush(ctx, u.cookie, [create(u.id, { date: '2026-11-10', weightG: 80_000 })]);
    expect(res.body.results[0]).toMatchObject({ status: 'applied' });
  });

  it('4. deux créations le même jour : la première en tombstone (rev neuf), la seconde vivante', async () => {
    const u = await setup();
    const first = create(u.id, { date: '2026-11-08', weightG: 80_000 });
    const second = create(u.id, { date: '2026-11-08', weightG: 79_500 });
    const r1 = await syncPush(ctx, u.cookie, [first]);
    const firstRev = r1.body.results[0].rev as number;
    const r2 = await syncPush(ctx, u.cookie, [second]);
    expect(r2.body.results[0].status).toBe('applied');
    const all = await rows();
    const old = all.find((r) => r.id === first.id);
    const kept = all.find((r) => r.id === second.id);
    expect(old?.deletedAt).not.toBeNull();
    // Tombstone sans contenu : ni date ni poids ne restent 90 jours.
    expect(old).toMatchObject({ date: null, weightG: null });
    expect(old?.rev).toBeGreaterThan(firstRev);
    expect(kept).toMatchObject({ deletedAt: null, weightG: 79_500, date: '2026-11-08' });
  });

  it('4. rejouer une création déjà connue ne tue pas la pesée du jour', async () => {
    const u = await setup();
    const first = create(u.id, { date: '2026-11-08', weightG: 80_000 });
    await syncPush(ctx, u.cookie, [first]);
    await syncPush(ctx, u.cookie, [{ ...first, opId: ids.uuidv7() }]);
    expect((await rows()).filter((r) => r.deletedAt === null)).toHaveLength(1);
  });

  it('5. patch : weight_g se corrige ; un patch de date est refusé (validation)', async () => {
    const u = await setup();
    const c = create(u.id, { date: '2026-11-08', weightG: 80_000 });
    await syncPush(ctx, u.cookie, [c]);
    const fix = makeOp({
      userId: u.id,
      entity: 'weigh_in',
      id: c.id,
      kind: 'patch',
      fields: { weightG: 79_000 },
    });
    expect((await syncPush(ctx, u.cookie, [fix])).body.results[0].status).toBe('applied');
    const move = makeOp({
      userId: u.id,
      entity: 'weigh_in',
      id: c.id,
      kind: 'patch',
      fields: { date: '2026-11-07', weightG: 78_000 },
    });
    expect((await syncPush(ctx, u.cookie, [move])).body.results[0]).toMatchObject({
      status: 'rejected',
      code: 'validation',
    });
    expect((await rows())[0]).toMatchObject({ date: '2026-11-08', weightG: 79_000 });
    const bad = makeOp({
      userId: u.id,
      entity: 'weigh_in',
      id: c.id,
      kind: 'patch',
      fields: { weightG: 79_050 },
    });
    expect((await syncPush(ctx, u.cookie, [bad])).body.results[0].code).toBe('validation');
  });

  it('suppression : tombstone, et sans accord elle s’applique sans rejet', async () => {
    const u = await setup();
    const c = create(u.id, { date: '2026-11-08', weightG: 80_000 });
    await syncPush(ctx, u.cookie, [c]);
    const del = makeOp({ userId: u.id, entity: 'weigh_in', id: c.id, kind: 'delete' });
    expect((await syncPush(ctx, u.cookie, [del])).body.results[0].status).toBe('applied');
    expect((await rows())[0]?.deletedAt).not.toBeNull();
    expect((await rows())[0]).toMatchObject({ date: null, weightG: null });
    await insertFixtureRow(ctx.deps.db, 'consent_event', {
      ownerId: u.id,
      type: 'health',
      action: 'withdraw',
    });
    const again = makeOp({ userId: u.id, entity: 'weigh_in', id: ids.uuidv7(), kind: 'delete' });
    expect((await syncPush(ctx, u.cookie, [again])).body.results[0].status).not.toBe('rejected');
    expect(await rejections()).toHaveLength(0);
  });
});

describe('restore_upsert de weigh_in (renvoi après une restauration du serveur)', () => {
  const restore = (userId: string, fields: Record<string, unknown>, id = ids.uuidv7()) =>
    makeOp({ userId, entity: 'weigh_in', id, kind: 'restore_upsert', fields });

  it('une pesée que le serveur n’a plus est réinsérée', async () => {
    const u = await setup();
    const op = restore(u.id, { date: '2026-11-08', weightG: 80_000 });
    expect((await syncPush(ctx, u.cookie, [op])).body.results[0]).toMatchObject({ status: 'applied' });
    expect(await rows()).toMatchObject([{ id: op.id, date: '2026-11-08', weightG: 80_000, deletedAt: null }]);
  });

  it.each([
    ['poids hors domaine', { date: '2026-11-08', weightG: 250_100 }],
    ['date de demain (Paris)', { date: '2026-11-10', weightG: 80_000 }],
    ['date hors calendrier', { date: '2026-13-45', weightG: 80_000 }],
  ])('mêmes contrôles que create : %s → validation', async (_name, fields) => {
    const u = await setup();
    const res = await syncPush(ctx, u.cookie, [restore(u.id, fields)]);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', code: 'validation' });
    expect(await rows()).toHaveLength(0);
  });

  it('hors mode complet : forbidden', async () => {
    const u = await setup();
    await ctx.deps.db.updateTable('nutritionProfile').set({ mode: 'qualitative' }).execute();
    const res = await syncPush(ctx, u.cookie, [restore(u.id, { date: '2026-11-08', weightG: 80_000 })]);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('même jour qu’une pesée vivante : l’ancienne passe en tombstone sans contenu', async () => {
    const u = await setup();
    const first = create(u.id, { date: '2026-11-08', weightG: 80_000 });
    await syncPush(ctx, u.cookie, [first]);
    const op = restore(u.id, { date: '2026-11-08', weightG: 79_500 });
    expect((await syncPush(ctx, u.cookie, [op])).body.results[0].status).toBe('applied');
    const all = await rows();
    expect(all.find((r) => r.id === first.id)).toMatchObject({ date: null, weightG: null });
    expect(all.find((r) => r.id === first.id)?.deletedAt).not.toBeNull();
    expect(all.find((r) => r.id === op.id)).toMatchObject({
      date: '2026-11-08',
      weightG: 79_500,
      deletedAt: null,
    });
  });

  it('une suppression renvoyée : tombstone sans contenu', async () => {
    const u = await setup();
    const op = restore(u.id, { date: '2026-11-08', weightG: 80_000, deletedAt: '2026-11-09T08:00:00.000Z' });
    expect((await syncPush(ctx, u.cookie, [op])).body.results[0].status).toBe('applied');
    const [row] = await rows();
    expect(row).toMatchObject({ id: op.id, date: null, weightG: null });
    expect(row?.deletedAt).not.toBeNull();
  });
});
