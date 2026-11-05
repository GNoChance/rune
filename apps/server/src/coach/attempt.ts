import {
  type AgeBand,
  COACH_STREAM_ERROR_CODES,
  type CoachStreamErrorCode,
  type CoachStreamEvent,
} from '@rune/contracts';
import {
  type AllowedValues,
  type ApiBlock,
  type ApiMessage,
  allowedValues,
  currentRules,
  type FilterRule,
  historyForApi,
  outputFilter,
  SentenceBuffer,
  type StoredApiMessage,
  trailingWords,
} from '@rune/domain';
import {
  type AiChatEvent,
  type AiChatFinal,
  type AiChatRequest,
  type AiClient,
  AiError,
  type AiErrorCode,
  type TokenUsage,
} from '../ai';
import { runTool } from './tools';
import type { CoachTool, PendingProposal, ToolContext, ToolOutcome } from './tools/types';

/*
 * Tentative du coach (spec brique 4 §8.3 à §8.6) : un essai de réponse, soit un premier appel à `AiClient.chat()`
 * puis au plus `maxToolRounds` tours d'outils. Le texte part phrase par phrase, chaque phrase passée au filtre de
 * sortie (§11) ; les fins et les erreurs deviennent une issue que l'échange (tâche 21) relaie, régénère ou
 * enregistre. La tentative n'écrit rien en base (seuls les gestionnaires d'outils la lisent) et rien de son contenu
 * (texte, entrées et résultats d'outils) n'entre dans les journaux (P-LOG-2).
 */

/** Un appel à `chat()` de la tentative : servi (fin lue sur le final), ou en erreur (`stopReason` nul). */
export interface CallRecord {
  model: string;
  usage: TokenUsage;
  costUsd: number;
  priceUnknown: boolean;
  fallbackUsed: boolean;
  thinkingDropped: number;
  stopReason: string | null;
  refusalCategory: string | null;
}

export interface AttemptInput {
  ai: AiClient;
  request: Omit<AiChatRequest, 'messages' | 'signal'>;
  /** Historique du fil (`historyForApi`) puis message de l'utilisateur, et le message système d'une régénération. */
  messages: ApiMessage[];
  tools: readonly CoachTool[];
  /** État des outils neuf pour la tentative ; `allowed` y est recalculé avant chaque gestionnaire. */
  toolCtx: ToolContext;
  filter: { audience: AgeBand; brief: unknown; threadToolResults: readonly unknown[] };
  signal: AbortSignal;
  /** Le budget permet-il un appel de plus ? `spentUsd` : coût des appels de cette tentative. */
  canCall(spentUsd: number): Promise<boolean>;
  emit(e: CoachStreamEvent): void;
  now(): number;
  /** Accord santé actif : sans lui, le motif d'une proposition part nul (C2, C7). */
  healthConsent: boolean;
}

/**
 * Issue d'une tentative. `turns` : tours d'outils puis réponse finale, blocs tels que reçus (la réponse coupée par
 * `max_tokens` sans ses appels d'outil). `cause` : code de l'`AiError` à l'origine, null sinon. `empty` : réponse
 * finale sans texte relayé (Review Focus 5).
 */
export type AttemptOutcome =
  | {
      kind: 'answered';
      text: string;
      turns: StoredApiMessage[];
      truncated: boolean;
      stopReason: string;
      effectiveModel: string;
      toolRounds: number;
      toolResults: unknown[];
      firstTextAtMs: number | null;
      calls: CallRecord[];
    }
  | {
      kind: 'blocked';
      verdict: { rule: FilterRule; detail: string };
      toolRounds: number;
      calls: CallRecord[];
    }
  | { kind: 'refused'; category: string | null; calls: CallRecord[] }
  | {
      kind: 'failed';
      code: CoachStreamErrorCode | 'empty';
      cause: AiErrorCode | null;
      toolRounds: number;
      calls: CallRecord[];
    };

const DAY_MS = 86_400_000;

/** Code du flux d'une `AiError`, hors `aborted` (lu sur le signal) ; tout autre code → `internal`. */
const STREAM_ERRORS: Partial<Record<AiErrorCode, CoachStreamErrorCode>> = {
  rate_limited: 'api_unavailable',
  overloaded: 'api_unavailable',
  server: 'api_unavailable',
  network: 'api_unavailable',
  auth: 'api_unavailable',
  spend_limit: 'spend_limit',
  timeout: 'timeout',
  bad_request: 'internal',
};

const STREAM_ERROR_CODES: readonly unknown[] = COACH_STREAM_ERROR_CODES;

/** Raison de l'arrêt de l'échange (`shutdown`, `consent_withdrawn`, `timeout`) ; une autre raison → `internal`. */
function abortCode(signal: AbortSignal): CoachStreamErrorCode {
  const reason: unknown = signal.reason;
  return STREAM_ERROR_CODES.includes(reason) ? (reason as CoachStreamErrorCode) : 'internal';
}

const streamError = (error: AiError, signal: AbortSignal): CoachStreamErrorCode =>
  error.code === 'aborted' ? abortCode(signal) : (STREAM_ERRORS[error.code] ?? 'internal');

const servedCall = (final: AiChatFinal): CallRecord => ({
  model: final.model,
  usage: final.usage,
  costUsd: final.costUsd,
  priceUnknown: final.priceUnknown,
  // Calculé une seule fois, par `chat()` (P26).
  fallbackUsed: final.fallbackUsed,
  thinkingDropped: final.thinkingDropped,
  stopReason: final.stopReason,
  refusalCategory: final.stopDetails?.category ?? null,
});

/** Appel en erreur : son coût seul (`AiError.costUsd`, estimé ou nul), au modèle demandé. */
const failedCall = (model: string, error: AiError): CallRecord => ({
  model,
  usage: { input_tokens: 0, output_tokens: 0 },
  costUsd: error.costUsd,
  priceUnknown: false,
  fallbackUsed: false,
  thinkingDropped: 0,
  stopReason: null,
  refusalCategory: null,
});

const spent = (calls: readonly CallRecord[]): number => calls.reduce((sum, call) => sum + call.costUsd, 0);

/**
 * Valeurs autorisées (§11.2, C8, P11) : dossier du fil, résultats d'outils du fil, puis ceux de la tentative jusque-là.
 * Seule source du filtre comme des gestionnaires d'outils.
 */
function allowedFor(input: AttemptInput, toolResults: readonly unknown[]): AllowedValues {
  return allowedValues({
    brief: input.filter.brief,
    toolResults: [...input.filter.threadToolResults, ...toolResults],
    constants: input.toolCtx.deps.coachConfig.allowedConstants,
    nutritionFull: false,
  });
}

type Verdict = { rule: FilterRule; detail: string };

/**
 * Relais filtré (§8.4) : deltas par `SentenceBuffer`, chaque phrase passée à `outputFilter` avec les derniers mots de
 * la précédente (`trailingWords`, un numéro peut franchir deux phrases), puis émise. La première phrase bloquée arrête
 * le relais : plus rien ne part. Le texte d'un appel qui suit un texte déjà relayé commence un paragraphe, pour que
 * deux réponses séparées par un tour d'outils ne se collent pas.
 */
class Relay {
  private readonly input: AttemptInput;
  /** Valeurs autorisées à l'instant de la phrase (résultats d'outils de la tentative compris). */
  private readonly allowed: () => AllowedValues;
  private readonly buffer = new SentenceBuffer();
  private precedingWords: readonly string[] = [];
  private paragraph = false;
  /** Texte relayé de la tentative, et de l'appel en cours. */
  text = '';
  callText = '';
  firstTextAtMs: number | null = null;
  verdict: Verdict | null = null;

  constructor(input: AttemptInput, allowed: () => AllowedValues) {
    this.input = input;
    this.allowed = allowed;
  }

  startCall(): void {
    this.callText = '';
    this.paragraph = this.text !== '' && !/\s$/.test(this.text);
  }

  push(delta: string): void {
    for (const sentence of this.buffer.push(delta)) this.relay(sentence);
  }

  /** Fin du flux de l'appel : le tampon se vide. */
  flush(): void {
    for (const sentence of this.buffer.flush()) this.relay(sentence);
  }

  private relay(sentence: string): void {
    if (this.verdict !== null) return;
    const verdict = outputFilter(sentence, {
      audience: this.input.filter.audience,
      nutritionMode: 'none',
      allowed: this.allowed(),
      precedingWords: this.precedingWords,
    });
    if (!verdict.ok) {
      this.verdict = { rule: verdict.rule, detail: verdict.detail };
      return;
    }
    this.precedingWords = trailingWords(sentence, this.precedingWords);
    const text = this.paragraph && !/^\s/.test(sentence) ? `\n\n${sentence}` : sentence;
    this.paragraph = false;
    this.text += text;
    this.callText += text;
    this.firstTextAtMs ??= this.input.now();
    this.input.emit({ type: 'text', text });
  }
}

type BlockKind = Extract<AiChatEvent, { type: 'block_start' }>['block'];

/**
 * Un appel, relayé par `relay`. Son signal suit celui de l'échange, et s'arrête à la première phrase bloquée (§8.5).
 * Seuls les deltas d'un bloc `text` sont relayés : jamais la réflexion.
 */
async function callOnce(
  input: AttemptInput,
  messages: ApiMessage[],
  relay: Relay,
): Promise<{ final: AiChatFinal } | { error: AiError }> {
  const controller = new AbortController();
  const forward = () => controller.abort(input.signal.reason);
  input.signal.addEventListener('abort', forward, { once: true });
  let open: BlockKind | null = null;
  try {
    const final = await input.ai.chat({ ...input.request, messages, signal: controller.signal }, (e) => {
      if (relay.verdict !== null) return;
      if (e.type === 'block_start') open = e.block;
      else if (e.type === 'block_stop') open = null;
      else if (open === 'text') relay.push(e.text);
      if (relay.verdict !== null) controller.abort();
    });
    return { final };
  } catch (error) {
    // `chat()` ne rejette qu'avec une `AiError` ; autre chose est un défaut du code, qui remonte.
    if (error instanceof AiError) return { error };
    throw error;
  } finally {
    input.signal.removeEventListener('abort', forward);
  }
}

type ToolCall = { id: string; name: string; input: unknown };

/**
 * Appels d'outil à exécuter : ceux qui suivent le dernier bloc `fallback` ; ceux d'avant appartiennent à la réponse
 * refusée (§8.6), ne sont jamais exécutés et n'ont pas de `tool_result`.
 */
function executableToolCalls(blocks: readonly ApiBlock[]): ToolCall[] {
  const lastFallback = blocks.findLastIndex((block) => block.type === 'fallback');
  return blocks.flatMap((block, i) =>
    block.type === 'tool_use' && i > lastFallback
      ? [{ id: String(block.id), name: String(block.name), input: block.input }]
      : [],
  );
}

const toolResultBlock = (id: string, outcome: ToolOutcome): ApiBlock => ({
  type: 'tool_result',
  tool_use_id: id,
  content: JSON.stringify(outcome.result),
  ...(outcome.isError ? { is_error: true } : {}),
});

/** Carte de proposition : identifiant de la ligne à écrire (jamais envoyé au modèle), motif nul sans l'accord santé. */
function proposalEvent(p: PendingProposal, input: AttemptInput): CoachStreamEvent {
  return {
    type: 'proposal',
    id: p.id,
    baseRevision: p.baseRevision,
    operations: p.operations,
    reasonCode: 'COACH_PROPOSAL',
    reason: input.healthConsent ? p.reason : null,
    expiresAt: new Date(input.now() + currentRules().proposalValidDays * DAY_MS).toISOString(),
  };
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

/**
 * Tentative (§8.3) : avant chaque appel, `canCall` avec le coût des appels de la tentative, puis le signal de
 * l'échange. `stop_reason` est lu avant le contenu : `refusal` → `refused` ; `end_turn` et `max_tokens` → réponse,
 * `failed` `empty` sans texte relayé par cet appel ; `tool_use` → un tour d'outils, `tool_rounds_exceeded` au-delà de
 * `maxToolRounds` ; toute autre fin → `failed` `internal`. Un tour : par appel exécutable, dans l'ordre des blocs,
 * `tool_running` (outil connu), valeurs autorisées recalculées dans `toolCtx`, gestionnaire (`runTool`), puis
 * `proposal` et `help_card` pour ce qu'il a ajouté à l'état ; tous les `tool_result` dans un seul message `user`.
 * Une exception d'un gestionnaire termine la tentative (`failed` `internal`), sans `tool_result`.
 */
export async function runAttempt(input: AttemptInput): Promise<AttemptOutcome> {
  const { toolCtx } = input;
  const calls: CallRecord[] = [];
  const turns: StoredApiMessage[] = [];
  const toolResults: unknown[] = [];
  let toolRounds = 0;
  let allowed = allowedFor(input, toolResults);
  const relay = new Relay(input, () => allowed);
  const failed = (
    code: CoachStreamErrorCode | 'empty',
    cause: AiErrorCode | null = null,
  ): AttemptOutcome => ({
    kind: 'failed',
    code,
    cause,
    toolRounds,
    calls,
  });
  const blocked = (verdict: Verdict): AttemptOutcome => ({ kind: 'blocked', verdict, toolRounds, calls });

  for (;;) {
    if (!(await input.canCall(spent(calls)))) return failed('monthly_budget_reached');
    if (input.signal.aborted) return failed(abortCode(input.signal));
    relay.startCall();
    const call = await callOnce(input, [...input.messages, ...historyForApi(turns)], relay);
    if ('error' in call) {
      calls.push(failedCall(input.request.model, call.error));
      if (relay.verdict !== null) return blocked(relay.verdict);
      return failed(streamError(call.error, input.signal), call.error.code);
    }
    const { final } = call;
    calls.push(servedCall(final));
    const stop = final.stopReason;
    if (stop === 'refusal') return { kind: 'refused', category: final.stopDetails?.category ?? null, calls };
    if (stop !== 'end_turn' && stop !== 'max_tokens' && stop !== 'tool_use') return failed('internal');
    relay.flush();
    if (relay.verdict !== null) return blocked(relay.verdict);

    if (stop !== 'tool_use') {
      if (relay.callText.trim() === '') return failed('empty');
      const truncated = stop === 'max_tokens';
      // Coupée, la réponse perd ses appels d'outil : jamais exécutés, ils n'auraient pas de `tool_result`.
      const blocks = truncated ? final.blocks.filter((block) => block.type !== 'tool_use') : final.blocks;
      turns.push({ role: 'assistant', blocks });
      return {
        kind: 'answered',
        text: relay.text,
        turns,
        truncated,
        stopReason: stop,
        effectiveModel: final.model,
        toolRounds,
        toolResults,
        firstTextAtMs: relay.firstTextAtMs,
        calls,
      };
    }

    const toolCalls = executableToolCalls(final.blocks);
    if (toolCalls.length === 0) return failed('internal');
    if (toolRounds >= toolCtx.deps.coachConfig.limits.maxToolRounds) return failed('tool_rounds_exceeded');
    const results: ApiBlock[] = [];
    for (const toolCall of toolCalls) {
      const tool = input.tools.find((t) => t.name === toolCall.name);
      if (tool !== undefined) input.emit({ type: 'tool_running', tool: tool.name });
      toolCtx.allowed = allowed;
      const proposals = toolCtx.state.proposals.length;
      const helpCards = toolCtx.state.helpCards.length;
      let outcome: ToolOutcome;
      try {
        outcome = await runTool(toolCall.name, toolCall.input, toolCtx, input.tools);
      } catch (error) {
        // Nom de l'outil et classe de l'erreur seulement : son message peut citer le contenu.
        toolCtx.deps.logger.error('coach_tool_failed', { code: tool?.name, event: errorName(error) });
        return failed('internal');
      }
      toolResults.push(outcome.result);
      allowed = allowedFor(input, toolResults);
      results.push(toolResultBlock(toolCall.id, outcome));
      for (const proposal of toolCtx.state.proposals.slice(proposals)) {
        // Le modèle de la réponse qui a fait l'appel : celui du repli s'il y en a eu un.
        proposal.model = final.model;
        input.emit(proposalEvent(proposal, input));
      }
      for (const resource of toolCtx.state.helpCards.slice(helpCards))
        input.emit({ type: 'help_card', resource });
    }
    turns.push({ role: 'assistant', blocks: final.blocks }, { role: 'user', blocks: results });
    toolRounds += 1;
  }
}
