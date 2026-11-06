import type { CoachCounterKind, CoachLink, DisplayExtras, HelpResourceId } from '@rune/contracts';
import { parisMonthOf } from '@rune/domain';
import { sql } from 'kysely';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { isConsentActive, isHealthConsentActive } from '../privacy/consent-state';
import type { AttemptOutcome, CallRecord } from './attempt';
import type { PreparedExchange } from './orchestrator';
import { STANDARD_REPLY } from './prompts';
import { insertCoachProposal } from './proposals';
import type { AttemptToolState } from './tools/types';

/*
 * Enregistrement d'un échange du coach (spec brique 4 §8.7) : une transaction pour le fil (messages, proposition,
 * compteur de messages), la ligne d'usage `coach_call` et les compteurs anonymes de la tentative retenue. Un échange
 * non enregistré (refus, erreur, arrêt) n'écrit que sa ligne `coach_call` et ses compteurs. Rien du contenu n'entre
 * dans `coach_call` ni dans les compteurs (C1, C0).
 */

/** Ce qu'un échange a fait, pour la ligne `coach_call` : tous les appels de toutes ses tentatives. */
export interface CallSummary {
  calls: CallRecord[];
  toolRounds: number;
  filterBlocks: number;
  firstTextLatencyMs: number | null;
  /** `refusal` pour un refus du modèle : `recordCallOnly` en tire le compteur `refusal`. */
  stopReason: string | null;
  refusalCategory: string | null;
  errorCode: string | null;
  /** Une réponse du modèle est arrivée : l'échange compte dans la limite du jour. */
  counted: boolean;
  durationMs: number;
}

export type RecordedReply =
  | {
      kind: 'answered';
      attempt: Extract<AttemptOutcome, { kind: 'answered' }>;
      regenerationNote: string | null;
      state: AttemptToolState;
      helpCards: readonly HelpResourceId[];
    }
  | { kind: 'replaced'; regenerationNote: string; helpCards: readonly HelpResourceId[] };

/**
 * L'accord `ai_coach` ou le fil a disparu pendant l'échange (course avec un retrait ou une suppression, §8.7) :
 * `recordExchange` lève avant toute écriture, l'appelant n'écrit alors que `coach_call` (`recordCallOnly`).
 */
export class ExchangeGoneError extends Error {
  readonly reason: 'consent_withdrawn' | 'thread_closed';

  constructor(reason: 'consent_withdrawn' | 'thread_closed') {
    super(reason);
    this.name = 'ExchangeGoneError';
    this.reason = reason;
  }
}

/** Compteur anonyme du mois de Paris `month` : créé à `by`, ou augmenté de `by`. */
export async function bumpCounter(
  trx: DbExecutor,
  month: string,
  kind: CoachCounterKind,
  by = 1,
): Promise<void> {
  await trx
    .insertInto('coachSafetyCounter')
    .values({ month, kind, count: by })
    .onConflict((oc) => oc.columns(['month', 'kind']).doUpdateSet({ count: sql`count + ${by}` }))
    .execute();
}

/**
 * Micro-dollars arrondis au-dessus ; l'arrondi à 6 décimales écarte le bruit des flottants (3e-6 × 1e6 donne
 * 3,0000000000000004, dont le plafond serait 4).
 */
const costMicros = (usd: number): number => Math.ceil(Number((usd * 1_000_000).toFixed(6)));

const sumOf = (calls: readonly CallRecord[], pick: (call: CallRecord) => number): number =>
  calls.reduce((total, call) => total + pick(call), 0);

/** Ligne `coach_call` de l'échange ; `thread_id` seulement si le fil existe encore. */
async function insertCall(
  trx: DbExecutor,
  deps: AppDeps,
  x: PreparedExchange,
  summary: CallSummary,
): Promise<void> {
  const thread = await trx
    .selectFrom('coachThread')
    .select('id')
    .where('id', '=', x.thread.id)
    .executeTakeFirst();
  const { calls } = summary;
  const served = calls.filter((call) => call.stopReason !== null);
  await trx
    .insertInto('coachCall')
    .values({
      id: deps.ids.uuidv7(),
      userId: x.userId,
      threadId: thread === undefined ? null : thread.id,
      day: x.day,
      createdAt: deps.clock.now().toISOString(),
      requestedModel: x.thread.model,
      effectiveModel: served.at(-1)?.model ?? null,
      fallbackUsed: calls.some((call) => call.fallbackUsed) ? 1 : 0,
      apiCalls: calls.length,
      inputTokens: sumOf(calls, (c) => c.usage.input_tokens),
      cacheWriteTokens: sumOf(calls, (c) => c.usage.cache_creation_input_tokens ?? 0),
      cacheReadTokens: sumOf(calls, (c) => c.usage.cache_read_input_tokens ?? 0),
      outputTokens: sumOf(calls, (c) => c.usage.output_tokens),
      costUsdMicros: costMicros(sumOf(calls, (c) => c.costUsd)),
      firstTextLatencyMs: summary.firstTextLatencyMs,
      durationMs: summary.durationMs,
      stopReason: summary.stopReason,
      refusalCategory: summary.refusalCategory,
      toolRounds: summary.toolRounds,
      filterBlocks: summary.filterBlocks,
      thinkingDropped: sumOf(calls, (c) => c.thinkingDropped),
      errorCode: summary.errorCode,
      counted: summary.counted ? 1 : 0,
    })
    .execute();
}

/** Compteurs de tout échange : un blocage du filtre par blocage, un refus par refus du modèle. */
async function bumpExchangeCounters(
  trx: DbExecutor,
  x: PreparedExchange,
  summary: CallSummary,
): Promise<void> {
  const month = parisMonthOf(x.day);
  if (summary.filterBlocks > 0) await bumpCounter(trx, month, 'filter_block', summary.filterBlocks);
  if (summary.stopReason === 'refusal') await bumpCounter(trx, month, 'refusal');
}

/** Échange non enregistré : la ligne `coach_call` et les compteurs `filter_block` et `refusal`. */
export async function recordCallOnly(
  db: DbExecutor,
  deps: AppDeps,
  x: PreparedExchange,
  summary: CallSummary,
): Promise<void> {
  await insertCall(db, deps, x, summary);
  await bumpExchangeCounters(db, x, summary);
}

type NewMessage = {
  role: 'user' | 'assistant' | 'system';
  blocks: readonly unknown[];
  displayText?: string;
  displayExtras?: DisplayExtras;
  clientMessageId?: string;
  aiGenerated: boolean;
  effectiveModel?: string;
  stopReason?: string;
  truncated?: boolean;
};

/**
 * Enregistrement atomique d'un échange abouti (§8.7), dans la transaction `trx` : message de la personne
 * (`display_text`, `client_message_id`), message système de régénération s'il existe, tours d'outils de la tentative
 * retenue, réponse (`display_text` = texte relayé, `display_extras`, `effective_model`, `stop_reason`, `truncated`,
 * `ai_generated`), proposition (§12.3), `user_message_count + 1`, `last_message_at`, ligne `coach_call` et compteurs
 * de la tentative retenue (`help_<ressource>`, `filter_block`).
 *
 * Avant toute écriture, la transaction relit l'accord `ai_coach`, l'existence du fil et `is_open` : un retrait ou une
 * suppression arrivé pendant le flux lève `ExchangeGoneError` (l'appelant n'écrit alors que `coach_call`). L'accord
 * santé relu ici décide aussi de `blocks` (nul sans lui, comme après un retrait santé) et du motif de la proposition.
 */
export async function recordExchange(
  trx: DbExecutor,
  deps: AppDeps,
  x: PreparedExchange,
  reply: RecordedReply,
  summary: CallSummary,
): Promise<{ userSeq: number; assistantSeq: number; proposalIds: string[]; healthConsent: boolean }> {
  if (!(await isConsentActive(trx, x.userId, 'ai_coach'))) throw new ExchangeGoneError('consent_withdrawn');
  const thread = await trx
    .selectFrom('coachThread')
    .select(['isOpen', 'closedReason'])
    .where('id', '=', x.thread.id)
    .where('userId', '=', x.userId)
    .executeTakeFirst();
  // Un changement de coach ne défait pas l'échange commencé avant lui : un fil clos `persona_change` s'enregistre.
  if (thread === undefined || (thread.isOpen !== 1 && thread.closedReason !== 'persona_change')) {
    throw new ExchangeGoneError('thread_closed');
  }
  const healthConsent = await isHealthConsentActive(trx, x.userId);
  const now = deps.clock.now();

  const messages: NewMessage[] = [
    {
      role: 'user',
      blocks: [{ type: 'text', text: x.text }],
      displayText: x.text,
      clientMessageId: x.clientMessageId,
      ...(x.guided === null
        ? {}
        : {
            displayExtras: { helpCards: [], proposalIds: [], links: [], replaced: false, guided: x.guided },
          }),
      aiGenerated: false,
    },
  ];
  if (reply.regenerationNote !== null) {
    messages.push({
      role: 'system',
      blocks: [{ type: 'text', text: reply.regenerationNote }],
      aiGenerated: false,
    });
  }
  // Cartes d'aide de toutes les tentatives de l'échange, sans doublon, même pour la réponse type (§8.5).
  const helpCards = [...new Set(reply.helpCards)];
  const proposalIds: string[] = [];
  if (reply.kind === 'answered') {
    const { attempt, state } = reply;
    const final = attempt.turns.at(-1);
    if (final === undefined) throw new Error('coach_reply_missing');
    for (const turn of attempt.turns.slice(0, -1)) {
      messages.push({ role: turn.role, blocks: turn.blocks, aiGenerated: turn.role === 'assistant' });
    }
    for (const p of state.proposals) {
      const status = await insertCoachProposal(trx, deps, p, {
        userId: x.userId,
        threadId: x.thread.id,
        promptVersion: x.thread.promptVersion,
        now,
        healthConsent,
      });
      // Une proposition écrite `expired` n'a pas de carte : ni `proposalIds`, ni événement.
      if (status === 'proposed') proposalIds.push(p.id);
    }
    messages.push({
      role: 'assistant',
      blocks: final.blocks,
      displayText: attempt.text,
      displayExtras: { helpCards, proposalIds, links: [], replaced: false },
      aiGenerated: true,
      effectiveModel: attempt.effectiveModel,
      stopReason: attempt.stopReason,
      truncated: attempt.truncated,
    });
  } else {
    // Réponse type de l'appli (§8.5) : pas une sortie du modèle, donc ni modèle ni `ai_generated`.
    const links: CoachLink[] = ['program', 'coach_help'];
    messages.push({
      role: 'assistant',
      blocks: [{ type: 'text', text: STANDARD_REPLY }],
      displayText: STANDARD_REPLY,
      displayExtras: { helpCards, proposalIds: [], links, replaced: true },
      aiGenerated: false,
    });
  }

  for (const resource of helpCards) {
    await bumpCounter(trx, parisMonthOf(x.day), `help_${resource}`);
  }

  const last = await trx
    .selectFrom('coachMessage')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .where('threadId', '=', x.thread.id)
    .executeTakeFirstOrThrow();
  let seq = Number(last.seq ?? 0);
  let userSeq = 0;
  for (const message of messages) {
    seq += 1;
    if (message.clientMessageId !== undefined) userSeq = seq;
    await trx
      .insertInto('coachMessage')
      .values({
        id: deps.ids.uuidv7(),
        threadId: x.thread.id,
        userId: x.userId,
        seq,
        role: message.role,
        blocks: healthConsent ? JSON.stringify(message.blocks) : null,
        displayText: message.displayText ?? null,
        displayExtras: message.displayExtras === undefined ? null : JSON.stringify(message.displayExtras),
        clientMessageId: message.clientMessageId ?? null,
        aiGenerated: message.aiGenerated ? 1 : 0,
        effectiveModel: message.effectiveModel ?? null,
        stopReason: message.stopReason ?? null,
        truncated: message.truncated === true ? 1 : 0,
        createdAt: now.toISOString(),
      })
      .execute();
  }
  await trx
    .updateTable('coachThread')
    .set((eb) => ({ userMessageCount: eb('userMessageCount', '+', 1), lastMessageAt: now.toISOString() }))
    .where('id', '=', x.thread.id)
    .execute();
  await insertCall(trx, deps, x, summary);
  await bumpExchangeCounters(trx, x, summary);
  return { userSeq, assistantSeq: seq, proposalIds, healthConsent };
}
