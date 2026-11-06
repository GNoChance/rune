import { writeStamp } from '../db/rev';
import type { HealthWithdrawHook } from '../privacy/consent';

/**
 * Entrée `nutrition_profile` de `HEALTH_WITHDRAW_HOOKS` (spec brique 5 §6.5, 09 §8) : le profil n'est pas
 * tombstoné (le mode est C1), il est neutralisé. Colonnes C2 à NULL, pause de sécurité et ajustement cumulé à 0,
 * motif `safety` effacé, mode `disabled`, rev neuf. Les trois autres tables passent par la règle générique.
 */
export const nutritionHealthWithdrawHook: HealthWithdrawHook = async (trx, deps, userId) => {
  const profile = await trx
    .selectFrom('nutritionProfile')
    .select(['id', 'modeReason'])
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!profile) return;
  const stamp = await writeStamp(trx, deps, userId);
  await trx
    .updateTable('nutritionProfile')
    .set({
      mode: 'disabled',
      modeReason: profile.modeReason === 'safety' ? null : profile.modeReason,
      safetyScreenVersion: null,
      safetyScreenAt: null,
      safetyPause: 0,
      sexForCalc: null,
      heightCm: null,
      activityLevel: null,
      goal: null,
      cumulativeAdjustmentKcal: 0,
      ...stamp,
    })
    .where('id', '=', profile.id)
    .execute();
};
