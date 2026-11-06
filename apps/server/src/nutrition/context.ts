import type { ModeCause, NutritionMode } from '@rune/contracts';
import { SAFETY_SCREEN } from '@rune/contracts';
import { ageOn, effectiveNutritionMode, parisDate } from '@rune/domain';
import type { Selectable } from 'kysely';
import type { DbExecutor, NutritionProfileTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { isHealthConsentActive } from '../privacy/consent-state';

/** Ligne vivante du profil nutrition, telle que Kysely la rend (colonnes en camelCase). */
export type NutritionProfileRow = Selectable<NutritionProfileTable>;

export interface NutritionContext {
  userId: string;
  /** Profil vivant ; `null` si le compte n'a jamais ouvert le module, ou si la ligne est une tombstone. */
  profile: NutritionProfileRow | null;
  age: number;
  healthConsentActive: boolean;
  fullOpen: boolean;
  effective: { mode: NutritionMode; cause: ModeCause };
  /** Date civile de Paris du jour. */
  today: string;
}

/** Mode effectif du compte (07 §5.3) et tout ce qui l'a décidé ; lecture seule. */
export async function loadNutritionContext(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
): Promise<NutritionContext> {
  const user = await db.selectFrom('user').select('birthDate').where('id', '=', userId).executeTakeFirst();
  if (!user) throw httpError('not_found');
  const stored = await db
    .selectFrom('nutritionProfile')
    .selectAll()
    .where('ownerId', '=', userId)
    .executeTakeFirst();
  const profile = stored && stored.deletedAt === null ? stored : null;
  const state = await db
    .selectFrom('nutritionState')
    .select('fullOpen')
    .where('id', '=', 1)
    .executeTakeFirst();
  const today = parisDate(deps.clock.now());
  const age = ageOn(user.birthDate, today);
  const healthConsentActive = await isHealthConsentActive(db, userId);
  const fullOpen = state?.fullOpen === 1;
  const effective = effectiveNutritionMode({
    stored: profile?.mode ?? 'disabled',
    age,
    healthConsentActive,
    screenVersion: profile?.safetyScreenVersion ?? null,
    currentScreenVersion: SAFETY_SCREEN.version,
    fullOpen,
  });
  return { userId, profile, age, healthConsentActive, fullOpen, effective, today };
}
