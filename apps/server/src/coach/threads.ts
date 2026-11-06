import type { AgeBand, CoachEffort, CoachId } from '@rune/contracts';
import { buildCoachBrief, parisDate, promptVariant, sortedJson } from '@rune/domain';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import { writeStamp } from '../db/rev';
import type { CoachThreadTable, DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { isConsentActive } from '../privacy/consent-state';
import type { StartupTask } from '../startup';
import { loadBriefInput } from './brief-input';

/*
 * Fils du coach (spec brique 4 §6.4, brique 4.1 §4.4) : un fil ouvert au plus par personne et par jour de Paris,
 * ouvert au premier message du jour avec ses réglages, son public, sa voix, son dossier et sa table d'alias figés ;
 * fermé (`version_change`) dès qu'un réglage figé n'est plus le réglage courant, ou (`persona_change`) dès que la voix
 * du profil n'est plus la sienne. Ces deux fermetures laissent le message suivant ouvrir un autre fil le même jour ;
 * `health_withdrawn` et `day_over` ferment jusqu'au lendemain. Supprimer un fil le détache d'abord de ce qui le cite.
 */

export type ThreadRow = Selectable<CoachThreadTable>;

/** Réglages figés avec un fil. */
export interface CoachVersions {
  model: string;
  effort: CoachEffort;
  promptVersion: string;
  toolsVersion: string;
  briefSchema: string;
}

const FROZEN = ['model', 'effort', 'promptVersion', 'toolsVersion', 'briefSchema'] as const;

/** Réglages courants pour un fil de ce public ; `promptVersion` porte la variante (`coach-1/minor`…). */
export function currentVersions(deps: AppDeps, audience: AgeBand): CoachVersions {
  return {
    model: deps.config.coachModel,
    effort: deps.coachConfig.effort,
    promptVersion: promptVariant(audience),
    toolsVersion: deps.coachConfig.toolsVersion,
    briefSchema: deps.coachConfig.briefSchema,
  };
}

/** Fil du jour de Paris : le fil ouvert, sinon le dernier fil du jour (clos). */
export function todayThread(db: DbExecutor, userId: string, day: string): Promise<ThreadRow | undefined> {
  return db
    .selectFrom('coachThread')
    .selectAll()
    .where('userId', '=', userId)
    .where('day', '=', day)
    .orderBy('isOpen', 'desc')
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
}

/** Un fil clos que le message suivant remplace le même jour (changement de voix ou de réglage figé). */
export const isReplaceable = (thread: ThreadRow): boolean =>
  thread.isOpen === 0 &&
  (thread.closedReason === 'persona_change' || thread.closedReason === 'version_change');

/** Voix choisie dans le profil d'entraînement ; le Scribe tant qu'aucune ne l'est. */
export async function personaOf(db: DbExecutor, userId: string): Promise<CoachId> {
  const profile = await db
    .selectFrom('trainingProfile')
    .select('coach')
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  return profile?.coach ?? 'scribe';
}

/**
 * Changement de coach, fermeture paresseuse : un fil ouvert dont la voix n'est plus celle du profil est fermé
 * (`persona_change`). Pendant un échange de la personne (bail du registre), il reste ouvert : l'échange finit et
 * s'enregistre dans son fil, la fermeture vient au regard suivant. `holdsLease` : l'appelant tient lui-même le bail.
 */
async function closeIfPersonaStale(
  deps: AppDeps,
  thread: ThreadRow,
  holdsLease: boolean,
): Promise<ThreadRow | undefined> {
  if (thread.isOpen !== 1) return thread;
  if (!holdsLease && deps.coach.exchanges.inProgress(thread.userId)) return thread;
  if ((await personaOf(deps.db, thread.userId)) === thread.persona) return thread;
  return deps.db.transaction().execute(async (trx) => {
    const closed = await trx
      .updateTable('coachThread')
      .set({ isOpen: 0, closedReason: 'persona_change' })
      .where('id', '=', thread.id)
      .where('isOpen', '=', 1)
      .executeTakeFirst();
    if (closed.numUpdatedRows > 0n && (await deleteIfEmpty(trx, deps, thread))) return undefined;
    return { ...thread, isOpen: 0, closedReason: 'persona_change' };
  });
}

/** Un fil remplacé sans message de la personne n'a rien à relire : supprimé. Vrai s'il l'a été. */
async function deleteIfEmpty(trx: DbExecutor, deps: AppDeps, thread: ThreadRow): Promise<boolean> {
  const said = await trx
    .selectFrom('coachMessage')
    .select('id')
    .where('threadId', '=', thread.id)
    .where('role', '=', 'user')
    .executeTakeFirst();
  if (said !== undefined) return false;
  await deleteThread(trx, deps, thread.userId, thread.id);
  return true;
}

/** Fil du jour de Paris tel que la personne le voit : `todayThread`, périmé par un changement de coach fermé. */
export async function currentThread(
  deps: AppDeps,
  userId: string,
  day: string,
  opts: { holdsLease?: boolean } = {},
): Promise<ThreadRow | undefined> {
  const thread = await todayThread(deps.db, userId, day);
  return thread === undefined ? undefined : closeIfPersonaStale(deps, thread, opts.holdsLease === true);
}

/**
 * Fil du jour de Paris de `userId` : le fil ouvert (voir `currentThread`), le dernier fil du jour s'il est clos, sauf
 * clos par `persona_change` ou `version_change` : un fil neuf s'ouvre alors, comme sans fil. Il s'ouvre dans une
 * transaction, public calculé par le serveur à partir de la date de naissance (jamais du client), voix du profil,
 * réglages courants, dossier construit à `now` (`brief` = son JSON) et sa table d'alias (alias → identifiant réel, JSON
 * trié). Avec `requireConsent`, un fil neuf ne s'ouvre que si l'accord `ai_coach` est actif dans la transaction
 * (`consent_required` sinon ; un fil existant se rend sans contrôle). Deux appareils en course : l'index unique des fils
 * ouverts `(user_id, day)` garde le premier, l'autre relit le fil gagnant. `holdsLease` : l'appelant tient le bail
 * de son échange. Un dossier encore trop gros après la cascade est stocké tel quel, et journalisé par ses seuls
 * jetons estimés.
 */
export async function openTodayThread(
  deps: AppDeps,
  userId: string,
  now: Date,
  opts: { requireConsent?: boolean; holdsLease?: boolean } = {},
): Promise<ThreadRow> {
  const day = parisDate(now);
  const existing = await currentThread(deps, userId, day, opts);
  if (existing !== undefined && !isReplaceable(existing)) return existing;
  return deps.db.transaction().execute(async (trx) => {
    // Un retrait de l'accord entre la garde et ici ne doit pas ouvrir un fil neuf (§8.1, course avec le retrait).
    if (opts.requireConsent === true && !(await isConsentActive(trx, userId, 'ai_coach'))) {
      throw httpError('consent_required');
    }
    // Un autre appareil a pu ouvrir le fil du jour entre-temps.
    const latest = await todayThread(trx, userId, day);
    if (latest !== undefined && !isReplaceable(latest)) return latest;
    const input = await loadBriefInput(trx, deps, userId, now);
    const built = buildCoachBrief(input);
    const id = deps.ids.uuidv7();
    await trx
      .insertInto('coachThread')
      .values({
        id,
        userId,
        day,
        audience: input.audience,
        persona: await personaOf(trx, userId),
        ...currentVersions(deps, input.audience),
        brief: built.json,
        slotAliases: sortedJson(Object.fromEntries(built.slotAliases)),
        isOpen: 1,
        closedReason: null,
        userMessageCount: 0,
        createdAt: now.toISOString(),
        lastMessageAt: null,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    const thread = await todayThread(trx, userId, day);
    if (thread === undefined) throw new Error('coach_thread_missing');
    if (thread.id === id && built.oversize) {
      deps.logger.warn('coach_brief_oversize', { count: built.estimatedTokens });
    }
    return thread;
  });
}

const SlotAliases = z.record(z.string(), z.string());

/**
 * Table des alias figée avec le fil (alias d'un slot ajouté → son identifiant réel), pour retraduire les références
 * de slot du modèle (`resolveSlotAlias`) avec les alias de son dossier. Une table illisible est une erreur interne.
 */
export function threadSlotAliases(thread: ThreadRow): ReadonlyMap<string, string> {
  return new Map(Object.entries(SlotAliases.parse(JSON.parse(thread.slotAliases))));
}

/**
 * Table des alias figée avec le fil `threadId` de `userId` (`read_training`, `propose_program_change`) ; aucune si le
 * fil n'existe pas, plus, ou est celui d'un autre.
 */
export async function frozenSlotAliases(
  db: DbExecutor,
  userId: string,
  threadId: string,
): Promise<ReadonlyMap<string, string>> {
  const thread = await db
    .selectFrom('coachThread')
    .selectAll()
    .where('id', '=', threadId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  return thread === undefined ? new Map() : threadSlotAliases(thread);
}

/**
 * Gel (§6.4) : un fil ouvert dont un réglage figé (modèle, effort, `prompt_version`, `tools_version`,
 * `brief_schema`) n'est plus le réglage courant est fermé (`version_change`). Vrai s'il vient d'être fermé.
 */
export async function closeIfFrozenStale(
  trx: DbExecutor,
  deps: AppDeps,
  thread: ThreadRow,
): Promise<boolean> {
  if (thread.isOpen !== 1) return false;
  const current = currentVersions(deps, thread.audience);
  if (FROZEN.every((key) => thread[key] === current[key])) return false;
  await trx
    .updateTable('coachThread')
    .set({ isOpen: 0, closedReason: 'version_change' })
    .where('id', '=', thread.id)
    .execute();
  await deleteIfEmpty(trx, deps, thread);
  return true;
}

/** Au démarrage, gel de tous les fils ouverts dont un réglage figé a changé (nouveau modèle, nouveau prompt…). */
export const COACH_THREADS_STARTUP_TASK: StartupTask = {
  name: 'coach_threads',
  async run(deps) {
    await deps.db.transaction().execute(async (trx) => {
      const open = await trx
        .selectFrom('coachThread')
        .selectAll()
        .where('isOpen', '=', 1)
        .orderBy('id')
        .execute();
      for (const thread of open) await closeIfFrozenStale(trx, deps, thread);
    });
  },
};

/**
 * Seule aide qui détache des fils (P24) : `instance_change.coach_thread_id` à NULL, une ligne un rev neuf (la
 * proposition reste dans le programme), puis `coach_call.thread_id` à NULL (le journal d'usage reste 12 mois). Pour
 * la suppression d'un fil, le retrait de l'accord coach et la purge.
 */
export async function detachThreads(
  trx: DbExecutor,
  deps: AppDeps,
  threadIds: readonly string[],
): Promise<void> {
  if (threadIds.length === 0) return;
  const changes = await trx
    .selectFrom('instanceChange')
    .select('id')
    .where('coachThreadId', 'in', threadIds)
    .orderBy('id')
    .execute();
  for (const { id } of changes) {
    const stamp = await writeStamp(trx, deps, null);
    await trx
      .updateTable('instanceChange')
      .set({ coachThreadId: null, ...stamp })
      .where('id', '=', id)
      .execute();
  }
  await trx.updateTable('coachCall').set({ threadId: null }).where('threadId', 'in', threadIds).execute();
}

/** Supprime le fil `id` de `userId` (messages en cascade), détaché d'abord ; 404 s'il n'est pas à lui. */
export async function deleteThread(
  trx: DbExecutor,
  deps: AppDeps,
  userId: string,
  id: string,
): Promise<void> {
  const thread = await trx
    .selectFrom('coachThread')
    .select('id')
    .where('id', '=', id)
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (thread === undefined) throw httpError('not_found');
  await detachThreads(trx, deps, [id]);
  await trx.deleteFrom('coachThread').where('id', '=', id).execute();
}

/** Supprime tous les fils de `userId` (messages en cascade), détachés d'abord. */
export async function deleteAllThreads(trx: DbExecutor, deps: AppDeps, userId: string): Promise<void> {
  const threads = await trx.selectFrom('coachThread').select('id').where('userId', '=', userId).execute();
  await detachThreads(
    trx,
    deps,
    threads.map((t) => t.id),
  );
  await trx.deleteFrom('coachThread').where('userId', '=', userId).execute();
}
