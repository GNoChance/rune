import { isEvaluated, nextParisMonthStart } from '@rune/domain';
import { MODEL_PRICES } from '../ai/client';
import { logSecurityEvent } from '../auth/security-log';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import type { StartupTask } from '../startup';
import type { ExchangeRegistry } from './registry';

/*
 * État du coach (spec §5.2, §7.3, §17) : la garde de configuration (modèle, clé, combinaison évaluée), son
 * interrupteur et sa suspension de budget, dans la ligne unique de `coach_state`.
 */

export type CoachConfigCheck =
  | { ok: true; devUnevaluated: boolean; catalogVersion: string }
  | { ok: false; cause: 'no_key' | 'model_not_allowed' | 'not_evaluated' };

export interface CoachRuntime {
  configured: CoachConfigCheck;
  exchanges: ExchangeRegistry;
}

/** Modèle autorisé et au prix connu ; sinon `chat()` ne saurait pas chiffrer un échange. */
function modelUsable(deps: AppDeps): boolean {
  const model = deps.config.coachModel;
  return deps.coachConfig.allowedModels.includes(model) && Object.hasOwn(MODEL_PRICES, model);
}

export function checkCoachConfig(deps: AppDeps, catalogVersion: string): CoachConfigCheck {
  if (!modelUsable(deps)) return { ok: false, cause: 'model_not_allowed' };
  if (deps.ai === null) return { ok: false, cause: 'no_key' };
  const config = deps.coachConfig;
  const evaluated = isEvaluated(config, {
    model: deps.config.coachModel,
    effort: config.effort,
    promptVersion: config.promptVersion,
    toolsVersion: config.toolsVersion,
    briefSchema: config.briefSchema,
    catalogVersion,
  });
  if (evaluated) return { ok: true, devUnevaluated: false, catalogVersion };
  if (deps.config.coachDevAllowUnevaluated) return { ok: true, devUnevaluated: true, catalogVersion };
  return { ok: false, cause: 'not_evaluated' };
}

async function currentCatalogVersion(exec: DbExecutor): Promise<string> {
  const row = await exec.selectFrom('serverMeta').select('catalogVersion').executeTakeFirst();
  return row?.catalogVersion ?? '';
}

/**
 * Relit la version du catalogue, met à jour `deps.coach.configured` et journalise l'inaptitude (le code seul).
 * `exec` : la transaction de l'appelant, la base n'ayant qu'une connexion.
 */
export async function refreshCoachConfig(
  deps: AppDeps,
  exec: DbExecutor = deps.db,
): Promise<CoachConfigCheck> {
  const check = checkCoachConfig(deps, await currentCatalogVersion(exec));
  deps.coach.configured = check;
  if (!check.ok) deps.logger.warn('coach_not_configured', { code: check.cause });
  return check;
}

export const COACH_STARTUP_TASK: StartupTask = {
  name: 'coach',
  async run(deps) {
    await refreshCoachConfig(deps);
  },
};

export async function readCoachState(
  db: DbExecutor,
): Promise<{ enabled: boolean; suspendedUntil: string | null; updatedAt: string }> {
  const row = await db
    .selectFrom('coachState')
    .select(['enabled', 'suspendedUntil', 'updatedAt'])
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  return { enabled: row.enabled === 1, suspendedUntil: row.suspendedUntil, updatedAt: row.updatedAt };
}

export async function setCoachEnabled(
  trx: DbExecutor,
  deps: AppDeps,
  enabled: boolean,
  actor: string,
): Promise<CoachConfigCheck> {
  await trx
    .updateTable('coachState')
    .set({ enabled: enabled ? 1 : 0, updatedAt: deps.clock.now().toISOString() })
    .where('id', '=', 1)
    .execute();
  await logSecurityEvent(trx, deps, {
    type: 'coach_state_changed',
    actorId: actor,
    targetId: null,
    ip: null,
    outcome: 'success',
    details: { enabled },
  });
  return enabled ? refreshCoachConfig(deps, trx) : deps.coach.configured;
}

/** Suspend le coach jusqu'au début du mois de Paris suivant (budget de l'atelier atteint). */
export async function suspendCoach(trx: DbExecutor, deps: AppDeps, now: Date): Promise<void> {
  const until = nextParisMonthStart(now);
  await trx
    .updateTable('coachState')
    .set({ suspendedUntil: until, updatedAt: deps.clock.now().toISOString() })
    .where('id', '=', 1)
    .execute();
  await logSecurityEvent(trx, deps, {
    type: 'coach_suspended',
    actorId: null,
    targetId: null,
    ip: null,
    outcome: 'success',
    details: { until },
  });
}

export async function resumeCoach(trx: DbExecutor, deps: AppDeps, actor: string): Promise<void> {
  await trx
    .updateTable('coachState')
    .set({ suspendedUntil: null, updatedAt: deps.clock.now().toISOString() })
    .where('id', '=', 1)
    .execute();
  await logSecurityEvent(trx, deps, {
    type: 'coach_state_changed',
    actorId: actor,
    targetId: null,
    ip: null,
    outcome: 'success',
    details: { resumed: true },
  });
}

/** Vrai si le catalogue publié n'est plus celui sur lequel la combinaison a été vérifiée. */
export async function catalogChangedSinceEvaluation(deps: AppDeps): Promise<boolean> {
  const { configured } = deps.coach;
  if (!configured.ok) return false;
  return (await currentCatalogVersion(deps.db)) !== configured.catalogVersion;
}
