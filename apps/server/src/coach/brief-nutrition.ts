import { type BriefNutritionInput, daysBetween, mondayOf } from '@rune/domain';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { publishedSheets, servedFor } from '../nutrition/advice-review';
import { loadNutritionContext } from '../nutrition/context';
import { loadNutritionRows } from '../nutrition/state';

/** Semaines comptées gardées par le dossier (brique 5 §11.1). */
const WEEKS_SHOWN = 4;

const weeksAgo = (weekStart: string, today: string): number =>
  Math.max(0, Math.round(daysBetween(weekStart, mondayOf(today)) / 7));

/**
 * Entrée nutrition du dossier du coach (brique 5 §11.1) : mode effectif, âge, pause de sécurité, fiches servies (le
 * filtre de `GET /api/nutrition/sheets`) ; la cible en vigueur, les 4 dernières semaines comptées et le dernier bilan
 * seulement en mode effectif `full` (`loadNutritionRows` ne rend rien ailleurs : C2 jamais lu). Ni pesée, ni
 * moyenne, ni taille, ni sexe, ni cause du mode n'en sortent.
 */
export async function loadBriefNutrition(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  today: string,
): Promise<BriefNutritionInput> {
  const ctx = await loadNutritionContext(db, deps, userId);
  const mode = ctx.effective.mode;
  const sheets = servedFor(await publishedSheets(db), ctx.age, mode).map((s) => ({
    id: s.id,
    title: s.title,
  }));
  const rows = await loadNutritionRows(db, ctx);
  // `week_start` croissant ; une semaine sans pesée n'est pas comptée.
  const counted = rows.checkins.filter((c) => (c.weighInCount ?? 0) > 0 && c.weekStart !== null);
  const last = rows.checkins.at(-1);
  return {
    mode,
    minor: ctx.age < 18,
    safetyPause: ctx.profile?.safetyPause === 1,
    sheets,
    target: rows.target,
    weeklyChange: counted
      .slice(-WEEKS_SHOWN)
      .reverse()
      .map((c) => ({ weeksAgo: weeksAgo(c.weekStart as string, today), changePct: c.changePct })),
    lastCheckin:
      last === undefined || last.weekStart === null || last.decision === null
        ? null
        : {
            weeksAgo: weeksAgo(last.weekStart, today),
            decision: last.decision,
            proposedDeltaKcal: last.proposedDeltaKcal,
            response: last.response,
          },
  };
}
