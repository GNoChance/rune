import { afterEach, describe, expect, it } from 'vitest';
import { expireProposals } from '../../src/program/expire';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  syncPull,
  syncPush,
  type TestContext,
} from '../support';
import { sheetFixture, templateFixture } from '../support/catalog';
import { enroll, sessionOps } from '../support/program';
import { seedSheet } from '../support/review';

/*
 * Expiration des propositions (05 §15.4, spec brique 3 §4.4.6) : plus de 7 jours, ou `base_revision` qui n'est plus
 * la révision de l'instance → `expired`, avant chaque pull de l'utilisateur et avant chaque rejeu.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-10-06T10:00:00.000Z';
const TEMPLATE = templateFixture('test-full-body');

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(): Promise<Member> {
  ctx = await createTestContext({ now: NOW });
  await seedSheet(ctx, sheetFixture('goblet-squat'));
  return createUserAndLogin(ctx);
}

const rowOf = (id: string) =>
  ctx.deps.sqlite.prepare('SELECT * FROM instance_change WHERE id = ?').get(id) as Row | undefined;

/** Proposition du moteur sur `instanceId`, valable jusqu'à `expiresAt`, faite à la révision `baseRevision`. */
async function proposal(
  ownerId: string,
  instanceId: string,
  o: { expiresAt?: string | null; baseRevision?: number; status?: string } = {},
): Promise<string> {
  const row = await insertFixtureRow(ctx.deps.db, 'instance_change', {
    ownerId,
    instanceId,
    author: 'engine',
    operations: '[{"op":"start_deload"}]',
    reasonCode: 'ENGINE_REACTIVE_DELOAD',
    status: o.status ?? 'proposed',
    expiresAt: o.expiresAt === undefined ? '2026-10-10T10:00:00.000Z' : o.expiresAt,
    baseRevision: o.baseRevision ?? 0,
  });
  return row.id as string;
}

describe('expiration des propositions', () => {
  it('plus de 7 jours ou base_revision périmée → expired au pull suivant, avec un rev neuf', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE, { revision: 2 });
    const old = await proposal(a.id, instanceId, { expiresAt: '2026-10-06T09:59:59.999Z', baseRevision: 2 });
    const stale = await proposal(a.id, instanceId, { baseRevision: 1 });
    const fresh = await proposal(a.id, instanceId, { baseRevision: 2 });
    const atLimit = await proposal(a.id, instanceId, { expiresAt: NOW, baseRevision: 2 });
    const noLimit = await proposal(a.id, instanceId, { expiresAt: null, baseRevision: 2 });
    const decided = await proposal(a.id, instanceId, { baseRevision: 0, status: 'rejected' });

    const pull = await syncPull(ctx, a.cookie);
    expect(pull.status).toBe(200);
    const pulled = (id: string) =>
      pull.body.rows.find(
        (r: { entity: string; row: Row }) => r.entity === 'instance_change' && r.row.id === id,
      );
    expect(pulled(old)?.row.status).toBe('expired');
    expect(pulled(stale)?.row.status).toBe('expired');
    expect(rowOf(old)).toMatchObject({ status: 'expired', decided_at: null });
    expect(Number(rowOf(old)?.rev)).toBeGreaterThan(1);
    expect(rowOf(stale)?.status).toBe('expired');
    for (const id of [fresh, atLimit, noLimit])
      expect(rowOf(id)).toMatchObject({ status: 'proposed', rev: 1 });
    expect(rowOf(decided)).toMatchObject({ status: 'rejected', rev: 1 });
  });

  it("le pull d'un membre n'expire que ses propositions", async () => {
    const a = await setup();
    const b = await createUserAndLogin(ctx);
    const theirs = await proposal(b.id, await enroll(ctx, b.id, TEMPLATE), {
      expiresAt: '2026-10-01T10:00:00.000Z',
    });
    await syncPull(ctx, a.cookie);
    expect(rowOf(theirs)?.status).toBe('proposed');
  });

  it('expirée avant chaque rejeu : un push de séance expire la proposition périmée', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE, { revision: 1 });
    const stale = await proposal(a.id, instanceId, { baseRevision: 0 });
    await syncPush(ctx, a.cookie, sessionOps(a.id, { instanceId, exercises: [{}] }).ops);
    expect(rowOf(stale)?.status).toBe('expired');
  });

  it('expireProposals est idempotent et ne touche pas une proposition valable', async () => {
    const a = await setup();
    const instanceId = await enroll(ctx, a.id, TEMPLATE);
    const old = await proposal(a.id, instanceId, { expiresAt: '2026-10-01T10:00:00.000Z' });
    const fresh = await proposal(a.id, instanceId);
    const run = () => ctx.deps.db.transaction().execute((trx) => expireProposals(trx, a.id, ctx.clock.now()));
    await run();
    const rev = rowOf(old)?.rev;
    await run();
    expect(rowOf(old)).toMatchObject({ status: 'expired', rev });
    expect(rowOf(fresh)).toMatchObject({ status: 'proposed', rev: 1 });
  });
});
