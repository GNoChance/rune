import {
  type CoachBriefResponse,
  CoachBriefSchema,
  type CoachMessageView,
  type CoachStatusView,
  type CoachThreadResponse,
  type CoachThreadsResponse,
  type CoachThreadView,
  type CoachTodayResponse,
  CURRENT_CONSENT_TEXTS,
  DisplayExtras,
} from '@rune/contracts';
import { buildCoachBrief, coachAccessGuard, type GuardSnapshot, parisDate, parisMonthOf } from '@rune/domain';
import type { Selectable } from 'kysely';
import { traitsOn } from '../auth/me';
import type { CoachMessageTable, DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { getConsentState } from '../privacy/consent-state';
import { loadBriefInput } from './brief-input';
import { readCoachState } from './state';
import { currentThread, isReplaceable, personaOf, type ThreadRow } from './threads';

/*
 * Instantané de la garde (spec brique 4 §7.3) et vues des routes `/api/coach` (§7.1). Jours et mois de Paris. Les
 * messages système et les tours d'outils ne sont jamais rendus. Lecture seule, aperçu du dossier compris.
 */

type MessageRow = Selectable<CoachMessageTable>;

const NO_EXTRAS: DisplayExtras = { helpCards: [], proposalIds: [], links: [], replaced: false };

/** Dépense de `userId` pour le mois de Paris `month` (`YYYY-MM`), en micro-dollars, par `coach_call.day`. */
export async function monthSpentMicros(db: DbExecutor, userId: string, month: string): Promise<number> {
  const spent = await db
    .selectFrom('coachCall')
    .select((eb) => eb.fn.sum<number | null>('costUsdMicros').as('micros'))
    .where('userId', '=', userId)
    .where('day', '>=', `${month}-01`)
    .where('day', '<=', `${month}-31`)
    .executeTakeFirstOrThrow();
  return Number(spent.micros ?? 0);
}

/**
 * Instantané de la garde à `now` : coach configuré, interrupteur et suspension, accord `ai_coach`, échanges comptés
 * du jour de Paris, dépense du mois de Paris (par `coach_call.day`), échange en cours au registre.
 */
export async function loadGuardSnapshot(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
): Promise<GuardSnapshot> {
  const today = parisDate(now);
  const month = parisMonthOf(today);
  const state = await readCoachState(db);
  const { aiCoach } = await getConsentState(db, userId);
  const counted = await db
    .selectFrom('coachCall')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('userId', '=', userId)
    .where('day', '=', today)
    .where('counted', '=', 1)
    .executeTakeFirstOrThrow();
  return {
    configured: deps.coach.configured.ok,
    enabled: state.enabled,
    suspendedUntil: state.suspendedUntil,
    now: now.toISOString(),
    consent: { active: aiCoach.active, textVersion: aiCoach.textVersion },
    currentConsentVersion: CURRENT_CONSENT_TEXTS.ai_coach.version,
    countedToday: Number(counted.n),
    monthSpentUsdMicros: await monthSpentMicros(db, userId, month),
    inProgress: deps.coach.exchanges.inProgress(userId),
  };
}

/** Message rendu ; null pour un message système ou un tour d'outils (sans `display_text`). */
export function messageView(row: MessageRow): CoachMessageView | null {
  if (row.role === 'system' || row.displayText === null) return null;
  const extras = row.displayExtras === null ? NO_EXTRAS : DisplayExtras.parse(JSON.parse(row.displayExtras));
  return {
    seq: row.seq,
    role: row.role,
    text: row.displayText,
    createdAt: row.createdAt,
    aiGenerated: row.aiGenerated === 1,
    model: row.effectiveModel,
    truncated: row.truncated === 1,
    replaced: extras.replaced,
    helpCards: extras.helpCards,
    proposalIds: extras.proposalIds,
    links: extras.links,
    ...(extras.guided === undefined ? {} : { guided: extras.guided }),
  };
}

export function threadView(row: ThreadRow): CoachThreadView {
  return {
    id: row.id,
    day: row.day,
    audience: row.audience,
    persona: row.persona,
    open: row.isOpen === 1,
    closedReason: row.closedReason,
    userMessageCount: row.userMessageCount,
    createdAt: row.createdAt,
  };
}

async function messagesOf(db: DbExecutor, threadId: string): Promise<CoachMessageView[]> {
  const rows = await db
    .selectFrom('coachMessage')
    .selectAll()
    .where('threadId', '=', threadId)
    .orderBy('seq')
    .execute();
  return rows.flatMap((r) => {
    const view = messageView(r);
    return view === null ? [] : [view];
  });
}

/**
 * `GET /api/coach/status` : disponibilité (premier contrôle de la garde), accord (`needsRenewal` : accord actif d'une
 * autre version que le texte en vigueur), public (le plus strict de celui du fil du jour et de celui du profil) et voix du fil du jour (sinon celle du profil), fil du jour (sans
 * fil, rien n'empêche d'écrire : `open`), messages restants, budget du mois en pourcentage entier (par défaut, 100 au
 * plus), mode dev.
 */
export async function coachStatus(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
): Promise<CoachStatusView> {
  const today = parisDate(now);
  const snapshot = await loadGuardSnapshot(db, deps, userId, now);
  const refusal = coachAccessGuard(snapshot, deps.coachConfig);
  const unavailableReason = refusal?.code === 'coach_unavailable' ? refusal.reason : null;
  const thread = await currentThread(deps, userId, today);
  const { consent, currentConsentVersion } = snapshot;
  const { limits } = deps.coachConfig;
  const budgetMicros = limits.personMonthlyBudgetUsd * 1_000_000;
  const { configured } = deps.coach;
  return {
    available: unavailableReason === null,
    unavailableReason,
    suspendedUntil: unavailableReason === 'suspended' ? snapshot.suspendedUntil : null,
    consent: {
      active: consent.active,
      textVersion: consent.textVersion,
      currentVersion: currentConsentVersion,
      needsRenewal: consent.active && consent.textVersion !== currentConsentVersion,
    },
    audience: thread?.audience === 'minor' ? 'minor' : (await traitsOn(db, userId, today)).audience,
    persona: thread === undefined || isReplaceable(thread) ? await personaOf(db, userId) : thread.persona,
    today: {
      threadId: thread?.id ?? null,
      open: thread === undefined || thread.isOpen === 1 || isReplaceable(thread),
      closedReason: thread?.closedReason ?? null,
      userMessageCount: thread?.userMessageCount ?? 0,
      remaining: Math.max(0, limits.messagesPerDay - snapshot.countedToday),
      inProgress: snapshot.inProgress,
    },
    budgetUsedPct: Math.min(100, Math.floor((snapshot.monthSpentUsdMicros * 100) / budgetMicros)),
    devUnevaluated: configured.ok && configured.devUnevaluated,
  };
}

/** `GET /api/coach/today` : le fil du jour de Paris et ses messages rendus, ou rien. */
export async function coachToday(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
): Promise<CoachTodayResponse> {
  const thread = await currentThread(deps, userId, parisDate(now));
  return {
    thread: thread === undefined ? null : threadView(thread),
    messages: thread === undefined ? [] : await messagesOf(db, thread.id),
    inProgress: deps.coach.exchanges.inProgress(userId),
  };
}

/** Date civile `day` moins `days` jours. */
function daysBefore(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** `GET /api/coach/threads` : fils des 90 derniers jours de Paris (le jour d'il y a 90 jours compris), récents d'abord. */
export async function coachThreads(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
): Promise<CoachThreadsResponse> {
  const since = daysBefore(parisDate(now), deps.coachConfig.retention.threadDays);
  const rows = await db
    .selectFrom('coachThread')
    .select(['id', 'day', 'persona', 'userMessageCount', 'isOpen'])
    .where('userId', '=', userId)
    .where('day', '>=', since)
    .orderBy('day', 'desc')
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return {
    threads: rows.map((r) => ({
      id: r.id,
      day: r.day,
      persona: r.persona,
      userMessageCount: r.userMessageCount,
      open: r.isOpen === 1,
    })),
  };
}

/** `GET /api/coach/threads/:id` : un fil de `userId` en lecture seule ; 404 s'il n'est pas à lui. */
export async function coachThread(db: DbExecutor, userId: string, id: string): Promise<CoachThreadResponse> {
  const thread = await db
    .selectFrom('coachThread')
    .selectAll()
    .where('id', '=', id)
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (thread === undefined) throw httpError('not_found');
  return { thread: threadView(thread), messages: await messagesOf(db, thread.id) };
}

/**
 * Dossier stocké d'un fil, exactement (§9, transparence : l'ordre de ses clés compris) ; null après le retrait santé.
 * Au schéma courant, il doit passer `CoachBriefSchema` (sinon erreur interne) ; celui d'un ancien `brief_schema` est
 * rendu brut, sans être validé par un schéma qui n'est pas le sien.
 */
function storedBrief(deps: AppDeps, thread: ThreadRow): CoachBriefResponse['brief'] {
  if (thread.brief === null) return null;
  const raw: unknown = JSON.parse(thread.brief);
  if (thread.briefSchema === deps.coachConfig.briefSchema) CoachBriefSchema.parse(raw);
  return raw as CoachBriefResponse['brief'];
}

/**
 * `GET /api/coach/brief` (§16.5) : le dossier stocké du fil du jour, tel quel (`null` après le retrait santé) ; sans
 * fil, un aperçu construit à `now`, jamais stocké (`preview`).
 */
export async function coachBrief(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
): Promise<CoachBriefResponse> {
  const day = parisDate(now);
  // Même fil que `/today` : le dossier d'un fil périmé (changement de coach ou de réglage) n'est jamais rendu.
  const thread = await currentThread(deps, userId, day);
  if (thread !== undefined && !isReplaceable(thread)) {
    return { brief: storedBrief(deps, thread), threadId: thread.id, day, preview: false };
  }
  const { brief } = buildCoachBrief(await loadBriefInput(db, deps, userId, now));
  return { brief, threadId: null, day, preview: true };
}
