import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { HEALTH_WITHDRAW_HOOKS } from '../../src/privacy/consent';
import {
  createTestContext,
  createUserAndLogin,
  grantConsent,
  insertFixtureRow,
  type TestContext,
} from '../support';

let ctx: TestContext;
afterEach(() => ctx?.close());

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const rowOf = async (table: string, id: string): Promise<Row> =>
  (await sql<Row>`select * from ${sql.table(table)} where id = ${id}`.execute(ctx.deps.db)).rows[0] as Row;
const withdraw = (u: Member) =>
  ctx.request('/api/me/consents/withdraw', {
    method: 'POST',
    cookie: u.cookie,
    json: { type: 'health', password: u.password },
  });

async function seed(u: Member) {
  const { db } = ctx.deps;
  await grantConsent(db, ctx.deps, u.id, 'health', '1.0', null);
  const instance = (await insertFixtureRow(db, 'program_instance', { ownerId: u.id })).id as string;
  const session = (await insertFixtureRow(db, 'workout_session', { ownerId: u.id, profile: 'cautious' }))
    .id as string;
  const pe = (
    await insertFixtureRow(db, 'performed_exercise', {
      ownerId: u.id,
      sessionId: session,
      painLevel: 'pain',
      swapReason: 'pain',
      note: 'garde-moi',
    })
  ).id as string;
  const pe2 = (
    await insertFixtureRow(db, 'performed_exercise', {
      ownerId: u.id,
      sessionId: session,
      position: 2,
      painLevel: 'none',
      swapReason: 'equipment',
    })
  ).id as string;
  const decision = (
    await insertFixtureRow(db, 'engine_decision', {
      id: pe,
      ownerId: u.id,
      reasonCode: 'PAIN_SUSPEND',
      result: 'ADJUSTED_HOLD',
      profile: 'cautious',
    })
  ).id as string;
  const decision2 = (
    await insertFixtureRow(db, 'engine_decision', { id: pe2, ownerId: u.id, reasonCode: 'HOLD_DEFAULT' })
  ).id as string;
  const slot = (
    await insertFixtureRow(db, 'slot_state', {
      ownerId: u.id,
      instanceId: instance,
      painStreak: 2,
      suspended: 1,
      loadG: 40_000,
      noProgressCount: 3,
    })
  ).id as string;
  const changeHold = (
    await insertFixtureRow(db, 'instance_change', {
      ownerId: u.id,
      instanceId: instance,
      reasonCode: 'PAIN_HOLD',
      reason: 'genou',
    })
  ).id as string;
  const changeSuspend = (
    await insertFixtureRow(db, 'instance_change', {
      ownerId: u.id,
      instanceId: instance,
      reasonCode: 'PAIN_SUSPEND',
      reason: 'dos',
    })
  ).id as string;
  const changeOther = (
    await insertFixtureRow(db, 'instance_change', {
      ownerId: u.id,
      instanceId: instance,
      reasonCode: 'USER_CHANGE',
    })
  ).id as string;
  return { pe, pe2, decision, decision2, slot, changeHold, changeSuspend, changeOther, session };
}

describe('retrait santé : séances et programmes (spec brique 3 §5.5)', () => {
  it('HEALTH_WITHDRAW_HOOKS porte instance_change et engine_decision', () => {
    expect(Object.keys(HEALTH_WITHDRAW_HOOKS).sort()).toEqual(['engine_decision', 'instance_change']);
  });

  it('efface les champs C2, réécrit les codes PAIN_*, nouveaux rev, rien d autre ne bouge', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    const other = await createUserAndLogin(ctx, { username: 'tom' });
    const o = await seed(u);
    const theirs = await seed(other);
    const before = {
      pe: await rowOf('performed_exercise', o.pe),
      pe2: await rowOf('performed_exercise', o.pe2),
      slot: await rowOf('slot_state', o.slot),
      decision: await rowOf('engine_decision', o.decision),
      decision2: await rowOf('engine_decision', o.decision2),
      hold: await rowOf('instance_change', o.changeHold),
      suspend: await rowOf('instance_change', o.changeSuspend),
      other: await rowOf('instance_change', o.changeOther),
      session: await rowOf('workout_session', o.session),
    };
    const theirsBefore = await rowOf('performed_exercise', theirs.pe);
    ctx.clock.advance(1000);

    expect((await withdraw(u)).status).toBe(200);

    const pe = await rowOf('performed_exercise', o.pe);
    expect(pe).toMatchObject({ painLevel: null, swapReason: null, note: 'garde-moi', deletedAt: null });
    expect(pe.rev).toBeGreaterThan(before.pe.rev as number);
    const pe2 = await rowOf('performed_exercise', o.pe2);
    expect(pe2).toMatchObject({ painLevel: null, swapReason: 'equipment' });
    expect(pe2.rev).toBeGreaterThan(before.pe2.rev as number);

    const slot = await rowOf('slot_state', o.slot);
    expect({ ...slot, painStreak: 2, rev: 0, updatedAt: '', updatedBy: null }).toEqual({
      ...before.slot,
      rev: 0,
      updatedAt: '',
      updatedBy: null,
    });
    expect(slot.painStreak).toBeNull();
    expect(slot.suspended).toBe(1);
    expect(slot.rev).toBeGreaterThan(before.slot.rev as number);

    const decision = await rowOf('engine_decision', o.decision);
    expect(decision).toMatchObject({
      reasonCode: 'USER_SUSPEND',
      result: 'ADJUSTED_HOLD',
      profile: 'cautious',
    });
    expect(decision.rev).toBeGreaterThan(before.decision.rev as number);
    const decision2 = await rowOf('engine_decision', o.decision2);
    expect(decision2).toEqual(before.decision2);

    const hold = await rowOf('instance_change', o.changeHold);
    expect(hold).toMatchObject({ reasonCode: 'USER_HOLD', reason: null });
    expect(hold.rev).toBeGreaterThan(before.hold.rev as number);
    expect(await rowOf('instance_change', o.changeSuspend)).toMatchObject({
      reasonCode: 'USER_SUSPEND',
      reason: null,
    });
    expect(await rowOf('instance_change', o.changeOther)).toMatchObject({
      reasonCode: 'USER_CHANGE',
      reason: null,
    });

    // le profil reste C1 ; les séances ne bougent pas
    expect(await rowOf('workout_session', o.session)).toEqual(before.session);
    // un autre membre n'est pas touché
    expect(await rowOf('performed_exercise', theirs.pe)).toEqual(theirsBefore);
    expect(await rowOf('instance_change', theirs.changeHold)).toMatchObject({
      reasonCode: 'PAIN_HOLD',
      reason: 'genou',
    });
  });

  it('la suspension reste (pas de rejeu) et un second retrait ne change rien', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    const o = await seed(u);
    await withdraw(u);
    expect((await rowOf('slot_state', o.slot)).suspended).toBe(1);
    expect((await rowOf('slot_state', o.slot)).loadG).toBe(40_000);
    const rev = (await rowOf('instance_change', o.changeHold)).rev;
    await withdraw(u);
    expect((await rowOf('instance_change', o.changeHold)).rev).toBe(rev);
  });
});
