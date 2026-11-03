/**
 * `AiClient.chat()` (spec brique 4, §5.3) : conversation en flux du coach par `client.beta.messages.stream`, avec
 * outils stricts, cache de prompt, replis côté serveur pour un fil adulte et contrôle des blocs de réflexion.
 *
 * Requête, flux, coût et erreurs vérifiés dans les types du SDK `@anthropic-ai/sdk` 0.135.0
 * (`resources/beta/messages/messages.d.ts`, `lib/BetaMessageStream`) et dans la documentation d'Anthropic ; prix
 * dans `MODEL_PRICES`, datés dans `scripts/exercises/NOTES.md`. La vérification sur la vraie API est la tâche 13.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ApiBlock, ApiMessage } from '@rune/domain';
import {
  type AiEffort,
  AiError,
  type AiErrorCode,
  type CachedBlock,
  costAtPrices,
  HIGHEST_PRICES,
  MAX_CACHE_BREAKPOINTS,
  MODEL_PRICES,
  type TokenUsage,
  toStructuredSchema,
} from './client';

/** Outil client du coach ; `inputSchema` (JSON Schema objet) passe par `toStructuredSchema` à l'envoi. */
export type AiTool = { name: string; description: string; inputSchema: Record<string, unknown> };

export type AiChatRequest = {
  model: string;
  effort: AiEffort;
  /** Plafond de sortie, réflexion comprise. */
  maxTokens: number;
  /** Blocs du prompt système ; `cache` y pose un point de cache. */
  system: readonly CachedBlock[];
  tools: readonly AiTool[];
  /** Blocs de l'API tels que stockés (`historyForApi`), rôle `system` compris. */
  messages: readonly ApiMessage[];
  /** Bloc de réflexion qui échoue au contrôle du préfixe : retiré (`drop_block`, production) ou erreur 400. */
  thinkingBinding: 'drop_block' | 'error';
  /** `'default'` pour un fil `adult`, `null` pour un fil `minor` : jamais de repli (choix C48). */
  fallbacks: 'default' | null;
  /** Délai de tout l'appel, nouveaux essais du SDK et lecture du flux compris (`callTimeoutMs`). */
  timeoutMs: number;
  signal: AbortSignal;
};

export type AiChatEvent =
  | { type: 'text_delta'; text: string }
  | {
      type: 'block_start';
      index: number;
      block: 'thinking' | 'redacted_thinking' | 'text' | 'tool_use' | 'fallback' | 'other';
    }
  | { type: 'block_stop'; index: number };

/** Une entrée de `usage.iterations` : un essai du modèle, dont celui du repli (`fallback_message`). */
export type AiIteration = { type: string; model: string; usage: TokenUsage };

export type AiChatFinal = {
  /** Blocs bruts du message, en JSON simple, à stocker et à renvoyer tels quels. */
  blocks: ApiBlock[];
  stopReason: string;
  stopDetails: {
    category: string | null;
    explanation: string | null;
    recommendedModel: string | null;
  } | null;
  /** Modèle qui a répondu (celui du repli après un bloc `fallback`). */
  model: string;
  /** Usage de tête : le seul essai qui a produit le message. */
  usage: TokenUsage;
  iterations: AiIteration[] | null;
  /** Entrées `thinking_dropped` d'`input_transformations` : blocs de réflexion retirés par l'API. */
  thinkingDropped: number;
  /** Seul calcul du repli (P26) : un bloc `fallback` ou une itération `fallback_message`. */
  fallbackUsed: boolean;
  costUsd: number;
  /** Un modèle de l'appel n'a pas de prix dans `MODEL_PRICES` : compté à `HIGHEST_PRICES`. */
  priceUnknown: boolean;
};

const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const EPHEMERAL = { type: 'ephemeral' } as const;

/** Dernier bloc de `content` marqué d'un point de cache, sans toucher au tableau reçu. */
function withCachePoint(content: readonly ApiBlock[]): ApiBlock[] {
  const last = content.at(-1);
  return last === undefined ? [...content] : [...content.slice(0, -1), { ...last, cache_control: EPHEMERAL }];
}

/**
 * Requête sérialisée de `chat()` : corps de `POST /v1/messages` (sans `stream`, que le SDK ajoute) et en-têtes
 * bêta. Le SDK 0.135 type `fallbacks`, `block_binding` et le rôle `system` ; les blocs stockés (`ApiBlock`), eux,
 * ne sont pas des types du SDK : ce corps passe donc au SDK sans type, depuis `streamChat` seulement.
 *
 * Point de cache sur les blocs système marqués et sur le dernier bloc du dernier message qui n'est pas un message
 * `system` : un message `system` final (règle rappelée à la régénération, §8.5) part tel quel, après le point.
 * Ni `tool_choice` (forcer un outil donne 400 sur Opus 5.5), ni `metadata`, ni `inference_geo`, ni `temperature`,
 * ni `eager_input_streaming`, ni `thinking.display` (réflexion jamais affichée).
 */
export function buildChatParams(req: AiChatRequest): { body: Record<string, unknown>; betas: string[] } {
  const breakpoints = req.system.filter((block) => block.cache === true).length + 1;
  if (breakpoints > MAX_CACHE_BREAKPOINTS) {
    throw new Error(
      `${breakpoints} points de cache (blocs système marqués et dernier message) : ` +
        `${MAX_CACHE_BREAKPOINTS} points de cache au plus par requête.`,
    );
  }
  const cached = req.messages.findLastIndex((message) => message.role !== 'system');
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system.map((block) => ({
      type: 'text',
      text: block.text,
      ...(block.cache === true ? { cache_control: EPHEMERAL } : {}),
    })),
    tools: req.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: toStructuredSchema(tool.inputSchema),
      strict: true,
    })),
    messages: req.messages.map((message, i) =>
      i === cached ? { ...message, content: withCachePoint(message.content) } : message,
    ),
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: req.thinkingBinding } },
    output_config: { effort: req.effort },
  };
  if (req.fallbacks !== null) body.fallbacks = req.fallbacks;
  const betas =
    req.fallbacks === null ? [THINKING_BINDING_BETA] : [THINKING_BINDING_BETA, SERVER_FALLBACK_BETA];
  return { body, betas };
}

/**
 * Coût d'un appel : somme, sur `iterations`, du coût de chaque essai au prix de son modèle ; sans itérations,
 * l'usage de tête au prix de `model`. Un modèle sans prix est compté à `HIGHEST_PRICES` (choix C18).
 */
export function chatCost(
  model: string,
  usage: TokenUsage,
  iterations: readonly AiIteration[] | null,
): { costUsd: number; priceUnknown: boolean } {
  const parts = iterations !== null && iterations.length > 0 ? iterations : [{ model, usage }];
  let costUsd = 0;
  let priceUnknown = false;
  for (const part of parts) {
    const prices = MODEL_PRICES[part.model];
    if (prices === undefined) priceUnknown = true;
    costUsd += costAtPrices(prices ?? HIGHEST_PRICES, part.usage);
  }
  return { costUsd, priceUnknown };
}

/** Un repli a servi la réponse : un bloc `fallback` ou une itération `fallback_message` (spec §8.6). */
export function usedFallback(
  blocks: readonly ApiBlock[],
  iterations: readonly AiIteration[] | null,
): boolean {
  return (
    blocks.some((block) => block.type === 'fallback') ||
    (iterations ?? []).some((iteration) => iteration.type === 'fallback_message')
  );
}

type SdkError = InstanceType<typeof Anthropic.APIError>;
const apiError = (e: unknown): SdkError | null => (e instanceof Anthropic.APIError ? e : null);
const statusOf = (e: unknown): number => apiError(e)?.status ?? 0;
/** `error.type` du corps de l'API, aussi pour une erreur reçue dans le flux (sans statut). */
const typeOf = (e: unknown): string => apiError(e)?.type ?? '';
/** Message du SDK : statut puis corps JSON de l'API, dont son `message`. */
const textOf = (e: unknown): string => apiError(e)?.message ?? '';

/**
 * Cas du classement, dans l'ordre : le premier qui correspond donne le code. Les classes de connexion d'abord
 * (une interruption ou un délai du SDK sont des `APIConnectionError` sans statut), puis le statut HTTP ou, pour
 * une erreur reçue dans le flux, le type d'erreur de l'API. 408 et 409 n'arrivent qu'après les nouveaux essais
 * du SDK : délai pour l'un, conflit passager du serveur pour l'autre.
 */
const AI_ERROR_CASES: readonly (readonly [AiErrorCode, (e: unknown) => boolean])[] = [
  ['aborted', (e) => e instanceof Anthropic.APIUserAbortError],
  ['timeout', (e) => e instanceof Anthropic.APIConnectionTimeoutError || statusOf(e) === 408],
  ['network', (e) => e instanceof Anthropic.APIConnectionError],
  [
    'spend_limit',
    (e) =>
      `${typeOf(e)} ${textOf(e)}`.includes('enforced_spend_limit_reached') ||
      (statusOf(e) === 400 && /specified workspace API usage limits/i.test(textOf(e))),
  ],
  ['rate_limited', (e) => statusOf(e) === 429 || typeOf(e) === 'rate_limit_error'],
  ['overloaded', (e) => statusOf(e) === 529 || typeOf(e) === 'overloaded_error'],
  [
    'auth',
    (e) =>
      [401, 403].includes(statusOf(e)) || ['authentication_error', 'permission_error'].includes(typeOf(e)),
  ],
  [
    'server',
    (e) => statusOf(e) >= 500 || statusOf(e) === 409 || ['api_error', 'timeout_error'].includes(typeOf(e)),
  ],
  [
    'bad_request',
    (e) => statusOf(e) >= 400 || ['invalid_request_error', 'not_found_error'].includes(typeOf(e)),
  ],
];

/** Code d'une erreur de `chat()` ; `api` si rien ne correspond. Une `AiError` garde son code. */
export function classifyAiError(error: unknown): AiErrorCode {
  if (error instanceof AiError) return error.code;
  return AI_ERROR_CASES.find(([, matches]) => matches(error))?.[0] ?? 'api';
}

type SdkMessage = Anthropic.Beta.Messages.BetaMessage;
type SdkUsage = Pick<
  SdkMessage['usage'],
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_creation_input_tokens'
  | 'cache_read_input_tokens'
  | 'cache_creation'
>;

type BlockKind = Extract<AiChatEvent, { type: 'block_start' }>['block'];
const KNOWN_BLOCKS: ReadonlySet<string> = new Set<BlockKind>([
  'thinking',
  'redacted_thinking',
  'text',
  'tool_use',
  'fallback',
]);

function chatEvent(event: Anthropic.Beta.Messages.BetaRawMessageStreamEvent): AiChatEvent | null {
  switch (event.type) {
    case 'content_block_start': {
      const type = event.content_block.type;
      const block = KNOWN_BLOCKS.has(type) ? (type as BlockKind) : 'other';
      return { type: 'block_start', index: event.index, block };
    }
    case 'content_block_delta':
      return event.delta.type === 'text_delta' ? { type: 'text_delta', text: event.delta.text } : null;
    case 'content_block_stop':
      return { type: 'block_stop', index: event.index };
    default:
      return null;
  }
}

function tokenUsage(usage: SdkUsage): TokenUsage {
  const created = usage.cache_creation;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
    cache_creation: created
      ? {
          ephemeral_5m_input_tokens: created.ephemeral_5m_input_tokens,
          ephemeral_1h_input_tokens: created.ephemeral_1h_input_tokens,
        }
      : null,
  };
}

/** `usage.iterations` ; une itération sans modèle (compaction, ou `model` nul) est au modèle du message. */
function iterationsOf(message: SdkMessage): AiIteration[] | null {
  return (
    message.usage.iterations?.map((iteration) => ({
      type: iteration.type,
      model: ('model' in iteration ? iteration.model : null) ?? message.model,
      usage: tokenUsage(iteration),
    })) ?? null
  );
}

/** Jetons estimés d'un texte : un pour 3 caractères, arrondi au-dessus. */
const estimatedTokens = (chars: number): number => Math.ceil(chars / 3);

/**
 * Coût estimé, par excès, d'un appel interrompu ou en erreur après l'envoi de la requête (`costPartial`).
 * Entrée : l'usage de `message_start` s'il est arrivé, sinon la requête sérialisée (`estimatedTokens`) au prix
 * d'entrée du modèle demandé, sans remise du cache. Sortie : le plus grand de l'usage connu (un jeton à
 * `message_start`, le total au `message_delta` final) et du texte déjà relayé. La réflexion produite mais non
 * relayée ne se mesure pas : elle manque à l'estimation, ce que `costPartial` signale.
 */
function partialCost(
  req: AiChatRequest,
  body: Record<string, unknown>,
  message: SdkMessage | undefined,
  relayedChars: number,
): number {
  const relayedTokens = estimatedTokens(relayedChars);
  if (message === undefined) {
    const input = estimatedTokens(JSON.stringify(body).length);
    return chatCost(req.model, { input_tokens: input, output_tokens: relayedTokens }, null).costUsd;
  }
  const usage = tokenUsage(message.usage);
  const output = Math.max(usage.output_tokens, relayedTokens);
  return chatCost(message.model, { ...usage, output_tokens: output }, iterationsOf(message)).costUsd;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function readFinal(message: SdkMessage): AiChatFinal {
  // JSON simple : le SDK pose des propriétés non énumérables et des accesseurs sur ses blocs.
  const blocks = JSON.parse(JSON.stringify(message.content)) as ApiBlock[];
  const usage = tokenUsage(message.usage);
  const iterations = iterationsOf(message);
  const details = message.stop_details;
  return {
    blocks,
    stopReason: message.stop_reason ?? 'unknown',
    stopDetails: details
      ? {
          category: details.category ?? null,
          explanation: details.explanation ?? null,
          recommendedModel: details.recommended_model ?? null,
        }
      : null,
    model: message.model,
    usage,
    iterations,
    thinkingDropped: (message.input_transformations ?? []).filter((t) => t.type === 'thinking_dropped')
      .length,
    fallbackUsed: usedFallback(blocks, iterations),
    ...chatCost(message.model, usage, iterations),
  };
}

/**
 * `AiClient.chat()` du client réel. Un seul délai couvre tout l'appel (nouveaux essais du SDK et lecture du flux,
 * que le délai du SDK ne couvre pas) ; `req.signal` l'interrompt. Après une interruption, plus aucun événement
 * n'est rendu, même déjà reçu. Ne rejette qu'avec une `AiError` : `bad_request` si la requête ne se construit
 * pas (rien n'est envoyé, coût nul), sinon le code classé, avec un coût estimé (`partialCost`, `costPartial`).
 */
export async function streamChat(
  sdk: Anthropic,
  req: AiChatRequest,
  onEvent: (e: AiChatEvent) => void,
): Promise<AiChatFinal> {
  let built: ReturnType<typeof buildChatParams>;
  try {
    built = buildChatParams(req);
  } catch (error) {
    throw new AiError('bad_request', `Requête invalide, non envoyée : ${messageOf(error)}`, { cause: error });
  }
  // Rien n'est encore envoyé : aucun coût.
  if (req.signal.aborted) throw new AiError('aborted', 'Appel interrompu.', { costPartial: true });
  const { body, betas } = built;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, req.timeoutMs);
  const forward = () => controller.abort();
  req.signal.addEventListener('abort', forward, { once: true });
  let stream: ReturnType<typeof sdk.beta.messages.stream> | undefined;
  let relayedChars = 0;
  try {
    const params = { ...body, betas } as unknown as Parameters<typeof sdk.beta.messages.stream>[0];
    stream = sdk.beta.messages.stream(params, { signal: controller.signal });
    for await (const event of stream) {
      if (controller.signal.aborted) break;
      const relayed = chatEvent(event);
      if (relayed === null) continue;
      if (relayed.type === 'text_delta') relayedChars += relayed.text.length;
      onEvent(relayed);
    }
    if (controller.signal.aborted) throw new Anthropic.APIUserAbortError();
    return readFinal(await stream.finalMessage());
  } catch (error) {
    const snapshot = stream?.currentMessage ?? stream?.receivedMessages.at(-1);
    const details = {
      cause: error,
      costUsd: partialCost(req, body, snapshot, relayedChars),
      costPartial: true,
    };
    if (timedOut) throw new AiError('timeout', `Délai de ${req.timeoutMs} ms dépassé.`, details);
    if (req.signal.aborted) throw new AiError('aborted', 'Appel interrompu.', details);
    const code = classifyAiError(error);
    throw new AiError(code, `Erreur de l'API Anthropic (${code}) : ${messageOf(error)}`, details);
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', forward);
  }
}
