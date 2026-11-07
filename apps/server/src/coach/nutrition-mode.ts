import { type AgeBand, CoachBriefStoredSchema, type NutritionMode } from '@rune/contracts';
import type { DbExecutor } from '../db/schema';

/*
 * Mode nutrition d'un fil (spec brique 5 §11.4) : lu dans le bloc `nutrition` du dossier figé à son ouverture, jamais
 * codé en dur. Un dossier `coach-brief/1` (`nutrition: null`), absent, effacé ou illisible vaut `disabled`.
 */

/** Mode du dossier (déjà analysé ou non) ; `disabled` si le dossier n'est pas un `coach-brief` valide. */
export function nutritionModeOfBrief(brief: unknown): NutritionMode {
  const parsed = CoachBriefStoredSchema.safeParse(brief);
  return parsed.success && parsed.data.nutrition !== null ? parsed.data.nutrition.mode : 'disabled';
}

/** Mode nutrition figé avec le fil (`thread.brief` : le JSON stocké, nul après le retrait de l'accord santé). */
export function nutritionModeOf(thread: { brief: string | null }): NutritionMode {
  if (thread.brief === null) return 'disabled';
  try {
    return nutritionModeOfBrief(JSON.parse(thread.brief));
  } catch {
    return 'disabled';
  }
}

type FilterNutritionMode = 'none' | 'qualitative' | 'full';

/** Entrées nutrition du filtre de sortie pour un fil : chiffres permis seulement à un adulte dont le dossier est `full`. */
export function nutritionFilterOf(
  audience: AgeBand,
  mode: NutritionMode,
): { nutritionMode: FilterNutritionMode; nutritionFull: boolean } {
  const nutritionMode = mode === 'disabled' ? 'none' : mode;
  return { nutritionMode, nutritionFull: audience === 'adult' && mode === 'full' };
}

/**
 * Pause de sécurité nutrition de `userId`, relue en base à chaque message (brique 5 R15) : tant qu'elle est active, le
 * filtre applique la liste « hors mode complet » même dans un fil `full`. Fausse sans profil vivant.
 */
export async function safetyPauseOf(db: DbExecutor, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('nutritionProfile')
    .select('safetyPause')
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  return row?.safetyPause === 1;
}

/** Mode nutrition du fil `threadId` de `userId`, relu en base ; `disabled` si le fil n'existe pas (plus). */
export async function storedThreadNutritionMode(
  db: DbExecutor,
  userId: string,
  threadId: string,
): Promise<NutritionMode> {
  const row = await db
    .selectFrom('coachThread')
    .select('brief')
    .where('id', '=', threadId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  return row === undefined ? 'disabled' : nutritionModeOf(row);
}
