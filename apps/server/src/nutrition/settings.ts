import type { NutritionState, NutritionTargets, SettingsChanges } from '@rune/contracts';
import { bmiBelow, computeNutritionTargets, referenceWeight, type TargetsInput } from '@rune/domain';
import { sql } from 'kysely';
import type { SessionUser } from '../app-env';
import { forgetThreadNutrition } from '../coach/threads';
import { writeStamp } from '../db/rev';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { clearTable } from '../privacy/consent';
import { loadNutritionContext, type NutritionProfileRow } from './context';
import { liveWeighIns, readNutritionState } from './state';
import { createTarget, targetsInputFor } from './targets-service';

interface SettingsPlan {
  input: TargetsInput;
  reason: 'profile_change' | 'low_bmi_safety';
  /** Valeurs à écrire dans le profil. */
  profile: Pick<
    NutritionProfileRow,
    'sexForCalc' | 'heightCm' | 'activityLevel' | 'goal' | 'cumulativeAdjustmentKcal'
  >;
}

/**
 * Cible qui résulte des changements demandés (spec brique 5 §7), sans rien écrire. Un changement d'objectif remet
 * l'ajustement à 0, les autres le gardent (07 §5.6.5). Un objectif « perte » avec un IMC < 18,5 est rangé en
 * « maintien » comme à la mise en place : cible `low_bmi_safety`.
 */
async function planSettings(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  changes: SettingsChanges,
): Promise<SettingsPlan> {
  const ctx = await loadNutritionContext(db, deps, userId);
  if (ctx.effective.mode !== 'full') throw httpError('mode_not_allowed');
  const p = ctx.profile;
  if (!p || p.sexForCalc === null || p.heightCm === null || p.activityLevel === null || p.goal === null) {
    throw httpError('setup_required');
  }
  const weight = referenceWeight(await liveWeighIns(db, userId), ctx.today);
  if (weight === null) throw httpError('weigh_in_required');

  const heightCm = changes.height_cm ?? p.heightCm;
  const lowBmi = bmiBelow(heightCm, weight, '18.5');
  if (changes.goal === 'lose' && (p.safetyPause === 1 || lowBmi)) throw httpError('goal_not_allowed');

  const requested = changes.goal ?? p.goal;
  const goalChanged = changes.goal !== undefined && changes.goal !== p.goal;
  const forcedMaintain = requested === 'lose' && lowBmi;
  const profile = {
    sexForCalc: changes.sex_for_calc ?? p.sexForCalc,
    heightCm,
    activityLevel: changes.activity_level ?? p.activityLevel,
    goal: forcedMaintain ? ('maintain' as const) : requested,
    cumulativeAdjustmentKcal: goalChanged || forcedMaintain ? 0 : p.cumulativeAdjustmentKcal,
  };
  const input = targetsInputFor({ ...ctx, profile: { ...p, ...profile } }, weight);
  if (!input) throw httpError('validation');
  return { input, reason: forcedMaintain ? 'low_bmi_safety' : 'profile_change', profile };
}

/** Aperçu : la cible qui en résulterait, sans écriture. */
export async function previewSettings(
  deps: AppDeps,
  user: Pick<SessionUser, 'id'>,
  changes: SettingsChanges,
): Promise<{ target: NutritionTargets }> {
  const plan = await planSettings(deps.db, deps, user.id, changes);
  const result = computeNutritionTargets(plan.input);
  if ('refusal' in result) throw httpError('validation');
  return { target: result.targets };
}

/** Enregistre les réglages et crée la cible (`profile_change` ou `low_bmi_safety`) dans une transaction. */
export async function saveSettings(
  deps: AppDeps,
  user: Pick<SessionUser, 'id'>,
  changes: SettingsChanges,
): Promise<NutritionState> {
  return deps.db.transaction().execute(async (trx) => {
    const plan = await planSettings(trx, deps, user.id, changes);
    const stamp = await writeStamp(trx, deps, user.id);
    await trx
      .updateTable('nutritionProfile')
      .set({ ...plan.profile, ...stamp })
      .where('ownerId', '=', user.id)
      .execute();
    await createTarget(trx, deps, user.id, plan.reason, plan.input);
    return readNutritionState(trx, deps, user.id);
  });
}

/**
 * « Supprimer mes données nutrition » (spec §6.5) : tombstones sans contenu des trois tables (bilans d'abord, ils
 * référencent les cibles), réglages C2 du profil effacés. L'accord, le mode, la version de l'écran de sécurité et la
 * pause de sécurité restent : la personne retrouve `needs = setup`, jamais un écran de sécurité à repasser. Côté
 * coach, dans la même transaction : le fil `full` du jour est fermé et les dossiers stockés perdent leurs repères
 * (R17), les messages déjà écrits restent.
 */
export async function deleteNutritionData(
  deps: AppDeps,
  user: Pick<SessionUser, 'id'>,
): Promise<NutritionState> {
  return deps.db.transaction().execute(async (trx) => {
    for (const table of ['nutrition_checkin', 'nutrition_target', 'weigh_in'] as const) {
      const rule = deps.entityRules[table];
      if (!rule) throw new Error(`règle d'entité absente : ${table}`);
      await clearTable(trx, deps, table, rule, user.id, user.id);
    }
    const profile = await trx
      .selectFrom('nutritionProfile')
      .select('id')
      .where('ownerId', '=', user.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (profile) {
      const stamp = await writeStamp(trx, deps, user.id);
      await trx
        .updateTable('nutritionProfile')
        .set({
          sexForCalc: null,
          heightCm: null,
          activityLevel: null,
          goal: null,
          cumulativeAdjustmentKcal: 0,
          modeReason: sql<'choice' | null>`case when mode_reason = 'safety' then null else mode_reason end`,
          ...stamp,
        })
        .where('ownerId', '=', user.id)
        .execute();
    }
    await forgetThreadNutrition(trx, deps, user.id);
    return readNutritionState(trx, deps, user.id);
  });
}
