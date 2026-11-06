import { type NutritionMode, type NutritionState, SAFETY_SCREEN, type ScreenRequest } from '@rune/contracts';
import { bmiBelow, NUTRITION_MAX_AGE, referenceWeight, screenOutcome } from '@rune/domain';
import type { Insertable, Updateable } from 'kysely';
import type { SessionUser } from '../app-env';
import { writeStamp } from '../db/rev';
import type { DbExecutor, NutritionProfileTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { assertHealthConsent } from '../privacy/consent';
import { loadNutritionContext, type NutritionContext } from './context';
import { buildNutritionState, liveWeighIns, loadNutritionRows } from './state';
import { createTarget, targetsInputFor } from './targets-service';

type ProfileValues = Omit<
  Updateable<NutritionProfileTable>,
  'id' | 'ownerId' | 'rev' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'deletedAt'
>;

/** Écrit (ou ressuscite après un retrait de l'accord) la ligne du profil avec un rev neuf ; les autres colonnes restent. */
async function upsertProfile(
  trx: DbExecutor,
  deps: AppDeps,
  userId: string,
  values: ProfileValues,
): Promise<void> {
  const stamp = await writeStamp(trx, deps, userId);
  const row: Insertable<NutritionProfileTable> = {
    id: userId,
    ownerId: userId,
    createdAt: stamp.updatedAt,
    deletedAt: null,
    ...stamp,
    ...values,
  };
  await trx
    .insertInto('nutritionProfile')
    .values(row)
    .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, deletedAt: null, ...stamp }))
    .execute();
}

/**
 * Pause de sécurité (spec brique 5 §D14), posée par le coach (`refer_to_help("eating_disorder")`) : rev neuf, et
 * seulement si le profil vivant existe, sans quoi rien n'est écrit. `deps` fournit l'horloge du rev.
 */
export async function setSafetyPause(
  db: DbExecutor,
  deps: Pick<AppDeps, 'clock'>,
  userId: string,
  on: boolean,
): Promise<void> {
  const row = await db
    .selectFrom('nutritionProfile')
    .select('id')
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!row) return;
  const stamp = await writeStamp(db, deps, userId);
  await db
    .updateTable('nutritionProfile')
    .set({ safetyPause: on ? 1 : 0, ...stamp })
    .where('ownerId', '=', userId)
    .execute();
}

const isCalendarDate = (date: string): boolean => {
  const d = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
};

/** Première pesée de la mise en place : une pesée ordinaire (identifiant du client), une seule par jour. */
async function recordSetupWeighIn(
  trx: DbExecutor,
  deps: AppDeps,
  ctx: NutritionContext,
  w: NonNullable<ScreenRequest['setup']>['weigh_in'],
): Promise<void> {
  if (!isCalendarDate(w.date) || w.date > ctx.today) throw httpError('validation');
  const userId = ctx.userId;
  const sameId = await trx
    .selectFrom('weighIn')
    .select(['id', 'ownerId'])
    .where('id', '=', w.id)
    .executeTakeFirst();
  if (sameId && sameId.ownerId !== userId) throw httpError('validation');
  const sameDay = await trx
    .selectFrom('weighIn')
    .select('id')
    .where('ownerId', '=', userId)
    .where('date', '=', w.date)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  const stamp = await writeStamp(trx, deps, userId);
  const existing = sameDay?.id ?? sameId?.id;
  if (existing) {
    await trx
      .updateTable('weighIn')
      .set({ date: w.date, weightG: w.weight_g, deletedAt: null, ...stamp })
      .where('id', '=', existing)
      .execute();
    return;
  }
  await trx
    .insertInto('weighIn')
    .values({
      id: w.id,
      ownerId: userId,
      createdAt: stamp.updatedAt,
      deletedAt: null,
      date: w.date,
      weightG: w.weight_g,
      ...stamp,
    })
    .execute();
}

async function stateOf(trx: DbExecutor, deps: AppDeps, userId: string): Promise<NutritionState> {
  const ctx = await loadNutritionContext(trx, deps, userId);
  return buildNutritionState(ctx, await loadNutritionRows(trx, ctx));
}

/**
 * Écran de sécurité (spec brique 5 §7, D6) : le serveur recalcule l'issue des trois réponses, refuse un mode non
 * permis, enregistre le mode, son motif et la version passée, jamais les réponses. Pour `full`, la mise en place
 * (profil, première pesée, cible `initial`) se fait dans la même transaction. Repasser l'écran lève la pause.
 */
export async function submitScreen(
  deps: AppDeps,
  user: Pick<SessionUser, 'id'>,
  req: ScreenRequest,
): Promise<NutritionState> {
  return deps.db.transaction().execute(async (trx) => {
    await assertHealthConsent(trx, user.id);
    const ctx = await loadNutritionContext(trx, deps, user.id);
    // Un mineur ne passe pas l'écran (07 §5.5) ; au-delà de 78 ans, seul le mode complet est fermé.
    if (ctx.age < 18) throw httpError('mode_not_allowed');
    const outcome = screenOutcome(req.answers);
    const mode: NutritionMode = req.mode;
    if (!outcome.allowedModes.includes(mode)) throw httpError('mode_not_allowed');
    if (mode === 'full' && (ctx.age > NUTRITION_MAX_AGE || !ctx.fullOpen))
      throw httpError('mode_not_allowed');

    const p = ctx.profile;
    const hasSettings =
      p !== null &&
      p.sexForCalc !== null &&
      p.heightCm !== null &&
      p.activityLevel !== null &&
      p.goal !== null;
    const setup = mode === 'full' ? req.setup : undefined;
    if (mode === 'full' && !setup && !hasSettings) throw httpError('setup_required');

    const values: ProfileValues = {
      mode,
      modeReason: outcome.reason,
      safetyScreenVersion: SAFETY_SCREEN.version,
      safetyScreenAt: deps.clock.now().toISOString(),
      safetyPause: 0,
    };
    if (setup) {
      // Un objectif « perte » avec un IMC < 18,5 est rangé en « maintien » (la cible applique la règle de toute façon).
      const lowBmi = bmiBelow(setup.height_cm, setup.weigh_in.weight_g, '18.5');
      values.sexForCalc = setup.sex_for_calc;
      values.heightCm = setup.height_cm;
      values.activityLevel = setup.activity_level;
      values.goal = setup.goal === 'lose' && lowBmi ? 'maintain' : setup.goal;
      values.cumulativeAdjustmentKcal = 0;
    }
    await upsertProfile(trx, deps, user.id, values);

    if (setup) {
      await recordSetupWeighIn(trx, deps, ctx, setup.weigh_in);
      const fresh = await loadNutritionContext(trx, deps, user.id);
      const weight = referenceWeight(await liveWeighIns(trx, user.id), fresh.today);
      const input = weight === null ? null : targetsInputFor(fresh, weight);
      if (!input) throw httpError('validation');
      await createTarget(trx, deps, user.id, 'initial', input);
    }
    return stateOf(trx, deps, user.id);
  });
}

/**
 * Descente (ou passage de `disabled` à `qualitative`) sans écran : seul le mode change ; pesées, cibles, bilans et
 * `safety_pause` restent en base (spec §D11). Le motif déjà enregistré est gardé, `choice` à défaut.
 */
export async function changeMode(
  deps: AppDeps,
  user: Pick<SessionUser, 'id'>,
  mode: 'qualitative' | 'disabled',
): Promise<NutritionState> {
  return deps.db.transaction().execute(async (trx) => {
    const ctx = await loadNutritionContext(trx, deps, user.id);
    await upsertProfile(trx, deps, user.id, { mode, modeReason: ctx.profile?.modeReason ?? 'choice' });
    return stateOf(trx, deps, user.id);
  });
}
