import { afterEach, describe, expect, it } from 'vitest';
import { coachPurgeJob } from '../../src/coach/purge';
import { DAILY_JOBS } from '../../src/jobs/registry';
import { createTestContext, createUser, insertFixtureRow, type TestContext } from '../support';

/*
 * Purge quotidienne du coach (spec brique 4 §6.3, §14.3) : fils à 90 jours (détachés par `detachThreads`), journal
 * d'usage à 12 mois, signalements à 90 jours, fils des jours passés clos.
 */

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-11-05T10:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
const ids = (sql: string) => (ctx.deps.sqlite.prepare(sql).all() as { id: string }[]).map((r) => r.id).sort();
const threadState = (id: unknown) =>
  ctx.deps.sqlite.prepare('SELECT is_open, closed_reason FROM coach_thread WHERE id = ?').get(id as string);

describe('coachPurgeJob', () => {
  it('est dans DAILY_JOBS', () => {
    expect(DAILY_JOBS).toContain(coachPurgeJob);
  });

  it('fil à 91 jours supprimé et détaché (rev neuf, coach_call.thread_id NULL) ; à 89 jours gardé', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUser(ctx);
    const db = ctx.deps.db;
    const closed = { isOpen: 0, closedReason: 'day_over' } as const;
    const old = await insertFixtureRow(db, 'coach_thread', {
      userId: u.id,
      day: '2026-08-01',
      ...closed,
      createdAt: ago(95),
      lastMessageAt: ago(91),
    });
    const young = await insertFixtureRow(db, 'coach_thread', {
      userId: u.id,
      day: '2026-08-03',
      ...closed,
      createdAt: ago(95),
      lastMessageAt: ago(89),
    });
    // Sans message : c'est la création qui compte.
    await insertFixtureRow(db, 'coach_thread', {
      userId: u.id,
      day: '2026-08-04',
      ...closed,
      createdAt: ago(92),
      lastMessageAt: null,
    });
    await insertFixtureRow(db, 'coach_message', { threadId: old.id, userId: u.id, seq: 1 });
    const change = await insertFixtureRow(db, 'instance_change', {
      ownerId: u.id,
      author: 'coach',
      coachThreadId: old.id,
    });
    const revOf = () =>
      (
        ctx.deps.sqlite.prepare('SELECT rev FROM instance_change WHERE id = ?').get(change.id as string) as {
          rev: number;
        }
      ).rev;
    const before = revOf();
    const call = await insertFixtureRow(db, 'coach_call', {
      userId: u.id,
      threadId: old.id,
      createdAt: ago(91),
    });

    await coachPurgeJob.run(ctx.deps);

    expect(ids('SELECT id FROM coach_thread')).toEqual([young.id as string]);
    expect(ids('SELECT id FROM coach_message')).toEqual([]);
    const after = ctx.deps.sqlite
      .prepare('SELECT coach_thread_id FROM instance_change WHERE id = ?')
      .get(change.id as string) as { coach_thread_id: string | null };
    expect(after.coach_thread_id).toBeNull();
    expect(revOf()).toBeGreaterThan(before);
    const logged = ctx.deps.sqlite
      .prepare('SELECT thread_id FROM coach_call WHERE id = ?')
      .get(call.id as string) as { thread_id: string | null };
    expect(logged.thread_id).toBeNull();
  });

  it("journal d'usage : 13 mois supprimé, 11 mois gardé", async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUser(ctx);
    await insertFixtureRow(ctx.deps.db, 'coach_call', {
      userId: u.id,
      createdAt: '2025-10-01T10:00:00.000Z',
    });
    const recent = await insertFixtureRow(ctx.deps.db, 'coach_call', {
      userId: u.id,
      createdAt: '2025-12-01T10:00:00.000Z',
    });
    await coachPurgeJob.run(ctx.deps);
    expect(ids('SELECT id FROM coach_call')).toEqual([recent.id as string]);
  });

  it('signalement : 91 jours supprimé, 89 jours gardé', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUser(ctx);
    await insertFixtureRow(ctx.deps.db, 'coach_report', { userId: u.id, createdAt: ago(91) });
    const young = await insertFixtureRow(ctx.deps.db, 'coach_report', { userId: u.id, createdAt: ago(89) });
    await coachPurgeJob.run(ctx.deps);
    expect(ids('SELECT id FROM coach_report')).toEqual([young.id as string]);
  });

  it("fil d'hier encore ouvert : day_over ; fil du jour : inchangé", async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUser(ctx);
    const yesterday = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: u.id,
      day: '2026-11-04',
      createdAt: ago(1),
    });
    const today = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: u.id,
      day: '2026-11-05',
      createdAt: NOW,
    });
    await coachPurgeJob.run(ctx.deps);
    expect(threadState(yesterday.id)).toMatchObject({ is_open: 0, closed_reason: 'day_over' });
    expect(threadState(today.id)).toMatchObject({ is_open: 1, closed_reason: null });
  });

  it('le jour change à minuit de Paris : 22:59 UTC (23:59 à Paris) garde le fil du jour, 23:00 UTC le clôt', async () => {
    ctx = await createTestContext({ now: '2026-11-05T22:59:00.000Z' });
    const u = await createUser(ctx);
    const t = await insertFixtureRow(ctx.deps.db, 'coach_thread', { userId: u.id, day: '2026-11-05' });
    await coachPurgeJob.run(ctx.deps);
    expect(threadState(t.id)).toMatchObject({ is_open: 1, closed_reason: null });
    ctx.clock.set('2026-11-05T23:00:00.000Z');
    await coachPurgeJob.run(ctx.deps);
    expect(threadState(t.id)).toMatchObject({ is_open: 0, closed_reason: 'day_over' });
  });
});
