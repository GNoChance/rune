import { parisDate } from '@rune/domain';
import { subtractMonths } from '../auth/purge';
import type { DailyJob } from '../jobs/scheduler';
import { deleteThread } from './threads';

const DAY_MS = 86_400_000;

/**
 * Purge quotidienne du coach (spec brique 4 §6.3, §14.3) : fils sans message depuis `threadDays` jours
 * (`coalesce(last_message_at, created_at)`), supprimés par `deleteThread`, qui détache d'abord
 * `instance_change.coach_thread_id` (rev neuf) et `coach_call.thread_id` ; journal d'usage de plus de
 * `usageLogMonths` mois ; signalements de plus de `reportDays` jours ; fils des jours passés encore ouverts clos
 * (`day_over`). Le journal technique ne porte que des nombres.
 */
export const coachPurgeJob: DailyJob = {
  name: 'coach-purge',
  async run(deps) {
    const now = deps.clock.now();
    const { retention } = deps.coachConfig;
    const threadsBefore = new Date(now.getTime() - retention.threadDays * DAY_MS).toISOString();
    const reportsBefore = new Date(now.getTime() - retention.reportDays * DAY_MS).toISOString();
    const callsBefore = subtractMonths(now, retention.usageLogMonths).toISOString();
    const today = parisDate(now);

    const counts = await deps.db.transaction().execute(async (trx) => {
      const old = await trx
        .selectFrom('coachThread')
        .select(['id', 'userId'])
        .where((eb) => eb(eb.fn.coalesce('lastMessageAt', 'createdAt'), '<', threadsBefore))
        .orderBy('id')
        .execute();
      for (const thread of old) await deleteThread(trx, deps, thread.userId, thread.id);
      const calls = await trx.deleteFrom('coachCall').where('createdAt', '<', callsBefore).executeTakeFirst();
      const reports = await trx
        .deleteFrom('coachReport')
        .where('createdAt', '<', reportsBefore)
        .executeTakeFirst();
      const closed = await trx
        .updateTable('coachThread')
        .set({ isOpen: 0, closedReason: 'day_over' })
        .where('isOpen', '=', 1)
        .where('day', '<', today)
        .executeTakeFirst();
      return {
        threads: old.length,
        calls: Number(calls.numDeletedRows),
        reports: Number(reports.numDeletedRows),
        closed: Number(closed.numUpdatedRows),
      };
    });
    deps.logger.info('coach purge', { job: 'coach-purge', ...counts });
  },
};
