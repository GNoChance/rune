import { CheckinResponseSchema, type NutritionState } from '@rune/contracts';
import { referenceWeight } from '@rune/domain';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { writeStamp } from '../db/rev';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { loadNutritionContext } from './context';
import {
  checkinSuperseded,
  decreaseDuringPause,
  liveWeighIns,
  type NutritionCheckinRow,
  readNutritionState,
} from './state';
import { createTarget, listTargets, targetsInputFor } from './targets-service';

/**
 * Bilan à traiter pour la semaine demandée : celui de la session seulement (un autre compte, admin compris, n'y
 * accède pas : 404), le plus récent, sans réponse. Le mode effectif doit être `full`.
 */
async function actionableCheckin(
  trx: DbExecutor,
  deps: AppDeps,
  userId: string,
  weekStart: string,
  decisions: readonly string[] | null,
): Promise<{ row: NutritionCheckinRow; ctx: Awaited<ReturnType<typeof loadNutritionContext>> }> {
  const ctx = await loadNutritionContext(trx, deps, userId);
  if (ctx.effective.mode !== 'full') throw httpError('mode_not_allowed');
  const row = await trx
    .selectFrom('nutritionCheckin')
    .selectAll()
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .where('weekStart', '=', weekStart)
    .executeTakeFirst();
  if (!row) throw httpError('not_found');
  const latest = await trx
    .selectFrom('nutritionCheckin')
    .select('id')
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .orderBy('weekStart', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  if (
    latest.id !== row.id ||
    row.response !== null ||
    (decisions !== null && !decisions.includes(row.decision ?? ''))
  ) {
    throw httpError('checkin_not_actionable');
  }
  return { row, ctx };
}

/**
 * Réponse à une proposition (spec brique 5 §9). Accepter : l'ajustement cumulé bouge de la proposition, une cible
 * `checkin` est calculée au poids de référence du jour et liée au bilan. Refuser : seule la réponse est écrite ;
 * dans les deux cas le point de départ du bilan repart (cible créée, ou date du refus). Une proposition aux repères
 * remplacés par une cible plus récente (réglages, sécurité IMC) ne se traite plus, et une baisse ne s'accepte pas
 * pendant la pause de sécurité : `checkin_not_actionable`.
 */
async function respond(
  deps: AppDeps,
  userId: string,
  weekStart: string,
  response: 'accepted' | 'declined',
): Promise<NutritionState> {
  return deps.db.transaction().execute(async (trx) => {
    const { row, ctx } = await actionableCheckin(trx, deps, userId, weekStart, ['proposal', 'rapid_loss']);
    if (checkinSuperseded(row, await listTargets(trx, userId))) throw httpError('checkin_not_actionable');
    let createdTargetId = row.createdTargetId;
    if (response === 'accepted') {
      const profile = ctx.profile;
      if (!profile || row.proposedDeltaKcal === null || decreaseDuringPause(row, profile.safetyPause === 1)) {
        throw httpError('checkin_not_actionable');
      }
      const weight = referenceWeight(await liveWeighIns(trx, userId), ctx.today);
      if (weight === null) throw httpError('weigh_in_required');
      const cumulative = profile.cumulativeAdjustmentKcal + row.proposedDeltaKcal;
      const input = targetsInputFor(
        { ...ctx, profile: { ...profile, cumulativeAdjustmentKcal: cumulative } },
        weight,
      );
      if (!input) throw httpError('setup_required');
      const stamp = await writeStamp(trx, deps, userId);
      await trx
        .updateTable('nutritionProfile')
        .set({ cumulativeAdjustmentKcal: cumulative, ...stamp })
        .where('ownerId', '=', userId)
        .execute();
      createdTargetId = (await createTarget(trx, deps, userId, 'checkin', input)).id;
    }
    const stamp = await writeStamp(trx, deps, userId);
    await trx
      .updateTable('nutritionCheckin')
      .set({ response, respondedAt: deps.clock.now().toISOString(), createdTargetId, ...stamp })
      .where('id', '=', row.id)
      .execute();
    return readNutritionState(trx, deps, userId);
  });
}

/**
 * Semaine marquée non représentative (spec §8) : la décision est recalculée avec les valeurs figées du bilan, sans
 * relire les pesées. Quand la variation est définie, la règle 4 s'applique (`non_representative_week`, proposition
 * annulée, position gardée) ; sinon la décision (données insuffisantes, pause IMC) ne change pas. Un recalibrage
 * déjà créé reste acquis.
 */
async function markNonRepresentative(
  deps: AppDeps,
  userId: string,
  weekStart: string,
): Promise<NutritionState> {
  return deps.db.transaction().execute(async (trx) => {
    const { row } = await actionableCheckin(trx, deps, userId, weekStart, null);
    const stamp = await writeStamp(trx, deps, userId);
    const defined = row.changePct !== null;
    await trx
      .updateTable('nutritionCheckin')
      .set({
        representative: 0,
        ...(defined ? { decision: 'non_representative_week' as const, proposedDeltaKcal: null } : {}),
        ...stamp,
      })
      .where('id', '=', row.id)
      .execute();
    return readNutritionState(trx, deps, userId);
  });
}

/** Monté sous /api/nutrition/checkins ; la session est exigée par le routeur parent. */
export function checkinRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const userId = (c: { get(key: 'user'): AppEnv['Variables']['user'] }) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user.id;
  };

  routes.post('/:weekStart/respond', async (c) => {
    const { response } = await parseJson(c, CheckinResponseSchema);
    return c.json(await respond(deps, userId(c), c.req.param('weekStart'), response));
  });

  routes.post('/:weekStart/non-representative', async (c) =>
    c.json(await markNonRepresentative(deps, userId(c), c.req.param('weekStart'))),
  );

  return routes;
}
