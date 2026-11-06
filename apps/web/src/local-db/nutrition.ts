import { type EntityRulesMap, entityRules, type NutritionMode } from '@rune/contracts';
import { isC2Value } from './c2';
import type { AppDb } from './db';
import { deleteMeta, getMeta, type MetaValues, setMeta } from './meta';

/*
 * Mode nutrition sur l'appareil (spec brique 5 D10, D11, §6.4, §6.4 bis) : le dernier mode effectif lu au pull
 * (`meta.nutritionEffectiveMode`) et, tant qu'elle n'est pas partie, l'intention de descente demandée hors ligne
 * (`meta.nutritionPendingMode`). L'appareil applique le plus strict des deux : jamais un chiffre de plus pendant
 * l'attente.
 */

/** Tables dont les copies disparaissent hors du mode complet. */
export const NUTRITION_DATA_TABLES = ['weigh_in', 'nutrition_target', 'nutrition_checkin'] as const;

export type NutritionIntent = MetaValues['nutritionPendingMode'];

/** Plus la valeur est haute, plus le mode est restrictif. */
const STRICTNESS: Readonly<Record<NutritionMode, number>> = { full: 0, qualitative: 1, disabled: 2 };

export function stricterMode<A extends NutritionMode, B extends NutritionMode>(a: A, b: B): A | B {
  return STRICTNESS[b] > STRICTNESS[a] ? b : a;
}

/** `mode` est au moins aussi restrictif que `than`. */
export function atLeastAsStrict(mode: NutritionMode, than: NutritionMode): boolean {
  return STRICTNESS[mode] >= STRICTNESS[than];
}

/**
 * Mode appliqué sur l'appareil : le plus strict entre l'intention en attente et le dernier mode lu. Jamais lu :
 * `disabled`, rien n'est montré avant le premier pull.
 */
export async function localNutritionMode(db: AppDb): Promise<NutritionMode> {
  const read = (await getMeta(db, 'nutritionEffectiveMode')) ?? 'disabled';
  const pending = await getMeta(db, 'nutritionPendingMode');
  return pending ? stricterMode(read, pending.mode) : read;
}

/**
 * Réponse du serveur à l'envoi de l'intention qui la règle : une 4xx (mode déjà plus restrictif, compte changé). Une
 * session perdue, une mise à jour exigée ou un débit limité ne règlent rien : l'intention reste pour le prochain
 * passage.
 */
export function intentSettledBy(status: number, code: string | null): boolean {
  if (status < 400 || status >= 500) return false;
  return (
    !['unauthenticated', 'password_change_required', 'account_deleted', 'protocol_unsupported'].includes(
      code ?? '',
    ) && status !== 429
  );
}

/** Efface l'intention si elle est toujours celle qui vient d'être envoyée (une descente plus récente reste). */
export async function clearIntent(db: AppDb, sent: NutritionIntent): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const current = await getMeta(db, 'nutritionPendingMode');
    if (current && current.mode === sent.mode && current.at === sent.at)
      await deleteMeta(db, 'nutritionPendingMode');
  });
}

/**
 * Purge des copies nutrition : les trois tables, les colonnes C2 du profil (mises à null, comme au retrait de
 * l'accord santé), les fiches du cache et leur ETag.
 */
export async function purgeNutrition(db: AppDb, rules: EntityRulesMap = entityRules): Promise<void> {
  const rule = rules.nutrition_profile;
  const tables = [
    ...NUTRITION_DATA_TABLES.map((t) => db.mirror(t)),
    db.mirror('nutrition_profile'),
    db.table('nutritionSheets'),
    db.meta,
  ];
  await db.transaction('rw', tables, async () => {
    for (const t of NUTRITION_DATA_TABLES) await db.mirror(t).clear();
    await db.table('nutritionSheets').clear();
    await deleteMeta(db, 'nutritionSheetsEtag');
    if (!rule) return;
    const profiles = db.mirror('nutrition_profile');
    for (const row of await profiles.toArray()) {
      const changes = Object.fromEntries(
        Object.entries(row)
          .filter(([k, v]) => isC2Value(rule, k, v))
          .map(([k]) => [k, null]),
      );
      if (Object.keys(changes).length > 0) await profiles.put({ ...row, ...changes });
    }
  });
}

/**
 * Descente demandée par la personne (D11) : l'intention est écrite (la plus restrictive des deux si une autre
 * attend) et les copies purgées, en une transaction.
 */
export async function recordDescent(
  db: AppDb,
  mode: NutritionIntent['mode'],
  at: string,
  rules: EntityRulesMap = entityRules,
): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const pending = await getMeta(db, 'nutritionPendingMode');
    if (!pending || stricterMode(pending.mode, mode) !== pending.mode) {
      await setMeta(db, 'nutritionPendingMode', { mode, at });
    }
    await purgeNutrition(db, rules);
  });
}

/**
 * Mode lu dans une réponse de pull. Le mode appliqué est le plus strict entre lui et l'intention en attente :
 * s'il n'est pas `full`, les copies sont purgées. L'intention s'efface dès que le pull montre un mode au moins
 * aussi restrictif. `needsSnapshot` : le mode appliqué est `full` alors que l'appareil n'a pas lu `full` avant, les
 * copies viennent de `GET /api/nutrition/rows` (le mode `full` n'est enregistré qu'avec elles).
 */
export async function applyPulledNutritionMode(
  db: AppDb,
  pulled: NutritionMode,
  rules: EntityRulesMap = entityRules,
): Promise<{ mode: NutritionMode; needsSnapshot: boolean }> {
  return db.transaction('rw', db.tables, async () => {
    const pending = await getMeta(db, 'nutritionPendingMode');
    const mode = pending ? stricterMode(pulled, pending.mode) : pulled;
    if (pending && atLeastAsStrict(pulled, pending.mode)) await deleteMeta(db, 'nutritionPendingMode');
    if (mode !== 'full') {
      await purgeNutrition(db, rules);
      await setMeta(db, 'nutritionEffectiveMode', mode);
      return { mode, needsSnapshot: false };
    }
    return { mode, needsSnapshot: (await getMeta(db, 'nutritionEffectiveMode')) !== 'full' };
  });
}
