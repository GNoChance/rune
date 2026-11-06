import {
  type CoachMessageRequest,
  type CoachStreamErrorCode,
  type CoachStreamEvent,
  cleanCoachText,
  coachTextLength,
  type GuidedRequest,
} from '@rune/contracts';
import {
  type ApiBlock,
  type ApiMessage,
  allowedValues,
  coachAccessGuard,
  historyForApi,
  parisDate,
  parisMonthOf,
  type StoredApiMessage,
} from '@rune/domain';
import { logSecurityEvent } from '../auth/security-log';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { isHealthConsentActive } from '../privacy/consent-state';
import type { AttemptInput, AttemptOutcome, CallRecord } from './attempt';
import { runAttempt } from './attempt';
import { composeForUser } from './guided';
import {
  type PromptVersion,
  REFUSAL_MESSAGE,
  regenerationNote,
  STANDARD_REPLY,
  systemBlocks,
} from './prompts';
import {
  type CallSummary,
  ExchangeGoneError,
  type RecordedReply,
  recordCallOnly,
  recordExchange,
} from './record';
import type { ExchangeLease } from './registry';
import { suspendCoach } from './state';
import { closeIfFrozenStale, openTodayThread, type ThreadRow } from './threads';
import { TOOLS_1, toolDefinitions } from './tools';
import type { AttemptToolState, ToolContext } from './tools/types';
import { loadGuardSnapshot, monthSpentMicros } from './views';

/*
 * Échange du coach (spec brique 4 §7.3, §8) : `prepareExchange` (garde, validation, fil, idempotence, bail du registre)
 * puis `runExchange` (une tentative, au plus une régénération, enregistrement atomique, plafonds, interruptions,
 * journaux). Les routes (tâche 22) ne font que brancher le flux sur ces deux fonctions. Rien du contenu (prompt,
 * réponse, dossier, texte d'outil, identifiant de personne) n'entre dans les journaux techniques (P-LOG-2).
 */

export interface PreparedExchange {
  userId: string;
  thread: ThreadRow;
  clientMessageId: string;
  /** Texte nettoyé (`cleanCoachText`). */
  text: string;
  /** Parcours guidé du message : son texte a été recomposé par le serveur (`composeForUser`). */
  guided: GuidedRequest | null;
  lease: ExchangeLease;
  startedAt: Date;
  /** Jour de Paris du départ : celui du fil, de `coach_call.day` et des compteurs, même si l'échange passe minuit. */
  day: string;
  /** Accord santé lu par `prepareExchange` ; l'enregistrement relit le sien dans sa transaction (§8.7). */
  healthConsent: boolean;
}

/**
 * Tout ce qui précède le flux (§7.3, §8.1). Dans l'ordre : garde (instantané puis `coachAccessGuard`), validation du
 * texte, bail du registre (`begin`, 409 `request_in_progress` s'il est pris malgré la garde), puis, bail tenu, garde
 * relue (un retrait de l'accord qui précède le bail n'est plus à craindre : son `abortFor` atteint le bail), fil du
 * jour (ouvert seulement si l'accord est actif ; refermé puis rouvert si la voix ou un réglage a changé), idempotence
 * sur tous les fils du jour. Toute erreur libère le bail avant de
 * remonter ; sinon `runExchange` le libère.
 */
export async function prepareExchange(
  deps: AppDeps,
  userId: string,
  body: CoachMessageRequest,
  now: Date,
): Promise<PreparedExchange> {
  const guard = async (holdsLease: boolean): Promise<void> => {
    const snapshot = await loadGuardSnapshot(deps.db, deps, userId, now);
    const refusal = coachAccessGuard(
      holdsLease ? { ...snapshot, inProgress: false } : snapshot,
      deps.coachConfig,
    );
    if (refusal === null) return;
    throw refusal.code === 'coach_unavailable'
      ? httpError('coach_unavailable', { reason: refusal.reason })
      : httpError(refusal.code);
  };
  await guard(false);
  const text =
    body.guided === undefined
      ? cleanCoachText(body.text)
      : await composeForUser(deps, userId, body.guided, now);
  if (text === '' || coachTextLength(text) > deps.coachConfig.limits.messageChars) {
    throw httpError('validation');
  }
  const lease = deps.coach.exchanges.begin(userId);
  if (lease === null) throw httpError('request_in_progress');
  try {
    await guard(true);
    // Le bail est à nous : un changement de coach ferme le fil du jour, le fil neuf prend la nouvelle voix.
    const open = () => openTodayThread(deps, userId, now, { requireConsent: true, holdsLease: true });
    let thread = await open();
    // Gel : un fil dont un réglage a changé est fermé, un fil neuf s'ouvre le même jour avec les réglages courants.
    if (await deps.db.transaction().execute((trx) => closeIfFrozenStale(trx, deps, thread))) {
      thread = await open();
    }
    // `health_withdrawn` et `day_over` ferment jusqu'au lendemain.
    if (thread.isOpen !== 1) throw httpError('thread_closed', { reason: thread.closedReason });
    // Idempotence sur tous les fils du jour : le doublon d'un fil gelé ou changé de voix reste un doublon.
    const duplicate = await deps.db
      .selectFrom('coachMessage')
      .innerJoin('coachThread', 'coachThread.id', 'coachMessage.threadId')
      .select('coachMessage.seq')
      .where('coachThread.userId', '=', userId)
      .where('coachThread.day', '=', thread.day)
      .where('coachMessage.clientMessageId', '=', body.clientMessageId)
      .executeTakeFirst();
    if (duplicate !== undefined) throw httpError('duplicate_message', { seq: duplicate.seq });
    return {
      userId,
      thread,
      clientMessageId: body.clientMessageId,
      text,
      guided: body.guided ?? null,
      lease,
      startedAt: now,
      day: parisDate(now),
      healthConsent: await isHealthConsentActive(deps.db, userId),
    };
  } catch (error) {
    lease.done();
    throw error;
  }
}

/**
 * Messages stockés du fil, pour l'API, et résultats d'outils déjà enregistrés (C8). Un message sans `blocks`
 * (retrait santé, ou fil écrit sans l'accord santé) se relit par son `display_text` ; sans texte, il est ignoré.
 */
async function loadThread(
  db: DbExecutor,
  threadId: string,
): Promise<{ stored: StoredApiMessage[]; toolResults: unknown[] }> {
  const rows = await db
    .selectFrom('coachMessage')
    .select(['role', 'blocks', 'displayText'])
    .where('threadId', '=', threadId)
    .orderBy('seq')
    .execute();
  const stored: StoredApiMessage[] = [];
  const toolResults: unknown[] = [];
  for (const row of rows) {
    const blocks: ApiBlock[] | null =
      row.blocks !== null
        ? (JSON.parse(row.blocks) as ApiBlock[])
        : row.displayText !== null
          ? [{ type: 'text', text: row.displayText }]
          : null;
    if (blocks === null) continue;
    stored.push({ role: row.role, blocks });
    for (const block of blocks) {
      if (block.type !== 'tool_result' || typeof block.content !== 'string') continue;
      try {
        toolResults.push(JSON.parse(block.content));
      } catch {
        // Contenu illisible : ignoré, ses valeurs ne sont simplement pas autorisées.
      }
    }
  }
  return { stored, toolResults };
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

const costOf = (calls: readonly CallRecord[]): number => calls.reduce((sum, call) => sum + call.costUsd, 0);

/** Tentative terminée : son issue, son état d'outils, et les cartes qu'elle a produites (émises si elle est retenue). */
type Attempted = { outcome: AttemptOutcome; state: AttemptToolState; held: CoachStreamEvent[] };

/**
 * Exécute l'échange et l'enregistre (§8.2 à §8.8) ; le flux reçoit chaque événement par `emit`, dont les erreurs sont
 * ignorées (le téléphone peut être parti : le serveur termine et enregistre, 06 §10.5). Toute issue finit par `done`,
 * `refused` ou `error`, puis le bail est libéré.
 *
 * - Requête : `historyForApi` + message de la personne ; réglages figés du fil ; `fallbacks` selon son public.
 * - Au plus une régénération, après `retry` : mêmes messages, suivis du message `system` de `regenerationNote`.
 *   Chaque tentative a son état d'outils neuf ; ses cartes `proposal` ne partent qu'à la fin de la tentative
 *   retenue, et seulement si la ligne est écrite `proposed` ; les cartes `help_card` de toutes les tentatives partent, sans
 *   doublon (§8.5). Un second blocage donne la réponse type.
 * - Plafonds : avant chaque appel, dépense du mois + coût de l'échange (régénération comprise) contre le budget.
 * - Un échec d'écriture, ou un fil disparu : rien du fil n'est écrit, seule la ligne `coach_call` l'est.
 */
export async function runExchange(
  deps: AppDeps,
  x: PreparedExchange,
  emit: (e: CoachStreamEvent) => void,
): Promise<void> {
  const send = (e: CoachStreamEvent): void => {
    try {
      emit(e);
    } catch {
      // Lecteur parti : l'échange se termine quand même.
    }
  };
  const tally = { calls: [] as CallRecord[], toolRounds: 0, filterBlocks: 0 };
  const summarize = (
    o: Partial<Pick<CallSummary, 'firstTextLatencyMs' | 'stopReason' | 'refusalCategory' | 'errorCode'>> & {
      received?: boolean;
    },
  ): CallSummary => ({
    calls: tally.calls,
    toolRounds: tally.toolRounds,
    filterBlocks: tally.filterBlocks,
    firstTextLatencyMs: o.firstTextLatencyMs ?? null,
    stopReason: o.stopReason ?? tally.calls.findLast((call) => call.stopReason !== null)?.stopReason ?? null,
    refusalCategory: o.refusalCategory ?? null,
    errorCode: o.errorCode ?? null,
    counted:
      o.received === true || tally.filterBlocks > 0 || tally.calls.some((call) => call.stopReason !== null),
    durationMs: Math.max(0, deps.clock.now().getTime() - x.startedAt.getTime()),
  });
  /**
   * Journal technique de l'issue : ses compteurs seulement (P-LOG-2) ; un modèle sans prix est signalé. Il passe
   * après l'écriture : une panne du journal ne doit ni défaire l'issue ni écrire une 2e ligne `coach_call`.
   */
  const log = (event: 'answered' | 'replaced' | 'refused' | 'error', summary: CallSummary): void => {
    try {
      for (const model of new Set(tally.calls.filter((c) => c.priceUnknown).map((c) => c.model))) {
        deps.logger.warn('price_unknown', { code: model });
      }
      deps.logger.info('coach_exchange', {
        event,
        rounds: summary.toolRounds,
        blocks: summary.filterBlocks,
        durationMs: summary.durationMs,
        ...(summary.errorCode === null ? {} : { code: summary.errorCode }),
      });
    } catch {
      // Journal en panne : l'issue est déjà écrite.
    }
  };
  /** Journal d'erreur dont la panne est absorbée : après un échec déjà traité, il ne doit rien produire de plus. */
  const logError = (msg: string, fields: Parameters<AppDeps['logger']['error']>[1]): void => {
    try {
      deps.logger.error(msg, fields);
    } catch {
      // Journal en panne : l'issue de l'échange ne dépend pas de lui.
    }
  };
  /** Échange non enregistré : `coach_call` (et la suspension si la limite de dépense est atteinte), puis l'événement. */
  const settleError = async (code: CoachStreamErrorCode, received = false): Promise<void> => {
    const summary = summarize({ errorCode: code, received });
    try {
      await deps.db.transaction().execute(async (trx) => {
        await recordCallOnly(trx, deps, x, summary);
        if (code === 'spend_limit') await suspendCoach(trx, deps, deps.clock.now());
      });
    } catch (error) {
      logError('coach_call_failed', { event: errorName(error) });
    }
    log('error', summary);
    send({ type: 'error', code });
  };

  try {
    const ai = deps.ai;
    if (ai === null) return await settleError('internal');
    const { stored, toolResults: threadToolResults } = await loadThread(deps.db, x.thread.id);
    const { thread } = x;
    const brief: unknown = thread.brief === null ? {} : JSON.parse(thread.brief);
    const base: ApiMessage[] = [
      ...historyForApi(stored),
      { role: 'user', content: [{ type: 'text', text: x.text }] },
    ];
    const month = parisMonthOf(x.day);
    const budgetMicros = deps.coachConfig.limits.personMonthlyBudgetUsd * 1_000_000;
    const request: AttemptInput['request'] = {
      model: thread.model,
      effort: thread.effort,
      maxTokens: deps.coachConfig.maxTokens,
      system: systemBlocks(thread.promptVersion as PromptVersion, thread.persona, thread.brief ?? '{}'),
      tools: toolDefinitions(TOOLS_1),
      thinkingBinding: deps.coachThinkingBinding,
      fallbacks: thread.audience === 'adult' ? 'default' : null,
      timeoutMs: deps.coachConfig.limits.callTimeoutMs,
    };

    const attempt = async (note: string | null, priorCostUsd: number): Promise<Attempted> => {
      const state: AttemptToolState = { proposals: [], invalidProposals: 0, helpCards: [] };
      const held: CoachStreamEvent[] = [];
      const toolCtx: ToolContext = {
        db: deps.db,
        deps,
        userId: x.userId,
        thread: { id: thread.id, audience: thread.audience, promptVersion: thread.promptVersion },
        now: x.startedAt,
        state,
        allowed: allowedValues({
          brief,
          toolResults: threadToolResults,
          constants: deps.coachConfig.allowedConstants,
          nutritionFull: false,
        }),
      };
      const outcome = await runAttempt({
        ai,
        request,
        messages:
          note === null ? base : [...base, { role: 'system', content: [{ type: 'text', text: note }] }],
        tools: TOOLS_1,
        toolCtx,
        filter: { audience: thread.audience, brief, threadToolResults },
        signal: x.lease.signal,
        async canCall(spentUsd) {
          const spentMicros = await monthSpentMicros(deps.db, x.userId, month);
          return spentMicros + (priorCostUsd + spentUsd) * 1_000_000 < budgetMicros;
        },
        // Cartes de proposition retenues avec la tentative ; cartes d'aide relues de `state` (toutes les tentatives).
        emit: (e) => (e.type === 'proposal' ? held.push(e) : e.type === 'help_card' ? undefined : send(e)),
        now: () => deps.clock.now().getTime(),
        healthConsent: x.healthConsent,
      });
      tally.calls.push(...outcome.calls);
      tally.toolRounds += outcome.kind === 'refused' ? 0 : outcome.toolRounds;
      return { outcome, state, held };
    };

    let current = await attempt(null, 0);
    const attempted = [current];
    let note: string | null = null;
    if (current.outcome.kind === 'blocked') {
      tally.filterBlocks = 1;
      note = regenerationNote(current.outcome.verdict.rule);
      send({ type: 'retry', reason: 'filter' });
      current = await attempt(note, costOf(current.outcome.calls));
      attempted.push(current);
      if (current.outcome.kind === 'blocked') tally.filterBlocks = 2;
    }

    const { outcome } = current;
    if (outcome.kind === 'refused') {
      const summary = summarize({ stopReason: 'refusal', refusalCategory: outcome.category, received: true });
      await deps.db.transaction().execute((trx) => recordCallOnly(trx, deps, x, summary));
      log('refused', summary);
      send({ type: 'refused', message: REFUSAL_MESSAGE });
      return;
    }
    if (outcome.kind === 'failed') {
      // La réponse vide est reçue (comptée) mais n'est pas un message : erreur interne, rien d'enregistré.
      const code = outcome.code === 'empty' ? 'internal' : outcome.code;
      if (outcome.cause === 'auth') {
        // Clé refusée : l'administrateur doit le savoir, sans contenu.
        try {
          await logSecurityEvent(deps.db, deps, {
            type: 'coach_api_auth_failed',
            actorId: null,
            targetId: null,
            ip: null,
            outcome: 'failure',
          });
        } catch (error) {
          // Le journal de sécurité en panne ne doit pas masquer `api_unavailable`.
          logError('coach_security_log_failed', { event: errorName(error) });
        }
      } else if (outcome.cause === 'bad_request') {
        logError('coach_api_error', { code: 'bad_request' });
      }
      return await settleError(code, outcome.code === 'empty');
    }

    // Cartes d'aide de toutes les tentatives, sans doublon, dans l'ordre : une tentative bloquée a pu les appeler (§8.5).
    const helpCards = [...new Set(attempted.flatMap((a) => a.state.helpCards))];
    const reply: RecordedReply =
      outcome.kind === 'answered'
        ? { kind: 'answered', attempt: outcome, regenerationNote: note, state: current.state, helpCards }
        : { kind: 'replaced', regenerationNote: note ?? '', helpCards };
    const firstTextLatencyMs =
      outcome.kind === 'answered' && outcome.firstTextAtMs !== null
        ? Math.max(0, outcome.firstTextAtMs - x.startedAt.getTime())
        : null;
    const summary = summarize({
      firstTextLatencyMs,
      stopReason: outcome.kind === 'answered' ? outcome.stopReason : null,
      received: true,
    });
    let recorded: Awaited<ReturnType<typeof recordExchange>>;
    try {
      recorded = await deps.db.transaction().execute((trx) => recordExchange(trx, deps, x, reply, summary));
    } catch (error) {
      if (error instanceof ExchangeGoneError) return await settleError(error.reason, true);
      throw error;
    }
    // Après la validation : rien d'ici ne doit produire `error` ni une 2e ligne `coach_call`.
    let remainingToday = 0;
    try {
      const counted = await countedToday(deps.db, x.userId, x.day);
      remainingToday = Math.max(0, deps.coachConfig.limits.messagesPerDay - counted);
    } catch (error) {
      // Le téléphone relit `/api/coach/status` pour le compte exact.
      logError('coach_remaining_failed', { event: errorName(error) });
    }
    log(outcome.kind === 'answered' ? 'answered' : 'replaced', summary);
    for (const resource of helpCards) send({ type: 'help_card', resource });
    if (outcome.kind === 'answered') {
      // Seules les propositions écrites `proposed` ont une carte, dont le motif suit l'accord santé de l'enregistrement.
      for (const event of current.held) {
        if (event.type !== 'proposal' || !recorded.proposalIds.includes(event.id)) continue;
        const pending = current.state.proposals.find((p) => p.id === event.id);
        send({ ...event, reason: recorded.healthConsent ? (pending?.reason ?? event.reason) : null });
      }
    } else {
      send({ type: 'text', text: STANDARD_REPLY });
    }
    send({
      type: 'done',
      threadId: thread.id,
      userSeq: recorded.userSeq,
      assistantSeq: recorded.assistantSeq,
      truncated: outcome.kind === 'answered' && outcome.truncated,
      replaced: outcome.kind === 'blocked',
      proposalIds: recorded.proposalIds,
      remainingToday,
    });
  } catch (error) {
    // Défaut du code ou de la base (écriture refusée, par exemple) : rien du fil n'a été écrit (transaction annulée).
    logError('coach_exchange_failed', { code: 'internal', event: errorName(error) });
    await settleError('internal');
  } finally {
    x.lease.done();
  }
}

async function countedToday(db: DbExecutor, userId: string, day: string): Promise<number> {
  const row = await db
    .selectFrom('coachCall')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('userId', '=', userId)
    .where('day', '=', day)
    .where('counted', '=', 1)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
