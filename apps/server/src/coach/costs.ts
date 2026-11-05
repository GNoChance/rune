import type { DbExecutor } from '../db/schema';

/*
 * Coûts du coach (spec brique 4 §17.3) : sommes de `coach_call.cost_usd_micros` par mois de Paris. Agrégats seuls,
 * jamais un nombre de messages.
 */

/** Dollars à 2 décimales d'une somme en micros de dollar. */
export const microsToUsd = (micros: number): number => Math.round(micros / 10_000) / 100;

/** Coût du mois de Paris `month` ('YYYY-MM') par personne (ou de `onlyUserId` seul), en micros de dollar ; `coach_call.day` est un jour de Paris. */
export async function monthCostMicros(
  db: DbExecutor,
  month: string,
  onlyUserId?: string,
): Promise<Map<string, number>> {
  let query = db
    .selectFrom('coachCall')
    .select(['userId', (eb) => eb.fn.sum<number>('costUsdMicros').as('micros')])
    .where('day', '>=', `${month}-01`)
    .where('day', '<=', `${month}-31`)
    .groupBy('userId');
  if (onlyUserId !== undefined) query = query.where('userId', '=', onlyUserId);
  const rows = await query.execute();
  return new Map(rows.map((r) => [r.userId, Number(r.micros)]));
}
