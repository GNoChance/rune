/**
 * Client IA (04 §9) : un seul point d'appel à l'API Claude, posé en brique 2 pour la rédaction des fiches
 * (`pnpm exercises:draft`, poste de dev seulement) et repris par le coach en brique 4. `complete()` fixe le modèle
 * et l'effort, demande une sortie structurée par JSON Schema, met en cache la partie fixe du message système, lit
 * `stop_reason` et calcule le coût depuis `usage`. `chat()`, la conversation en flux du coach, vit dans `chat.ts`.
 * Un faux déterministe le remplace dans les tests (`fake.ts`).
 *
 * Valeurs de l'API (modèle, effort, sortie structurée, cache, prix) vérifiées dans la documentation d'Anthropic :
 * voir `scripts/exercises/NOTES.md`. Aucune donnée personnelle ne passe par ce client.
 */
import Anthropic from '@anthropic-ai/sdk';
// Cycle voulu avec `chat.ts`, sans danger : aucun des deux modules ne lit l'autre à son chargement.
import { type AiChatEvent, type AiChatFinal, type AiChatRequest, streamChat } from './chat';

/** Niveaux d'effort exposés (`output_config.effort`) ; l'API accepte aussi `xhigh` et `max`. */
export type AiEffort = 'low' | 'medium' | 'high';

/** Bloc du message système ; `cache` pose un point de cache éphémère (5 minutes) à la fin de ce bloc. */
export type CachedBlock = { text: string; cache?: boolean };

export type AiRequest = {
  /** Identifiant du modèle ; à défaut, celui du client. */
  model?: string;
  effort: AiEffort;
  /** Partie fixe d'abord (mise en cache), la partie variable va dans `user`. */
  system: readonly CachedBlock[];
  user: string;
  /** JSON Schema de la sortie (objet), par exemple tiré de `z.toJSONSchema` ; adapté par `toStructuredSchema`. */
  schema: object;
  /** Plafond de jetons de sortie, réflexion comprise ; `DEFAULT_MAX_TOKENS` à défaut. */
  maxTokens?: number;
};

/**
 * Réponse lue. `value` est le JSON rendu par le modèle, **non validé** : la sortie structurée ne porte pas toutes
 * les bornes du schéma (`toStructuredSchema`), l'appelant la repasse donc par son schéma Zod.
 */
export type AiResult<T> = { value: T; stopReason: string; costUsd: number; model: string };

export interface AiClient {
  /** Modèle par défaut des requêtes. */
  readonly model: string;
  complete<T>(req: AiRequest): Promise<AiResult<T>>;
  /**
   * Conversation en flux du coach (spec brique 4, §5.3) : `onEvent` reçoit les deltas de texte et les bornes des
   * blocs, la promesse rend le message final. Lève une `AiError` du code classé par `classifyAiError`.
   */
  chat(req: AiChatRequest, onEvent: (e: AiChatEvent) => void): Promise<AiChatFinal>;
}

/**
 * Plafond par défaut : assez pour la réflexion et une fiche, et sous la limite du SDK pour un appel non diffusé
 * (au-delà d'environ 21 000 jetons, il exige le streaming).
 */
export const DEFAULT_MAX_TOKENS = 16_000;

/** Points de cache par requête (documentation du cache de prompt). */
export const MAX_CACHE_BREAKPOINTS = 4;

/** Prix en dollars par million de jetons (5 min et 1 h : écritures en cache ; `cacheRead` : lecture). */
export type ModelPrices = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

/**
 * Prix de l'API Claude (premier parti, routage global), relevés le 2026-10-30 sur la page Pricing d'Anthropic
 * (`scripts/exercises/NOTES.md`) ; replis du coach (`claude-opus-5`, `claude-opus-4-8`) relevés le 2026-11-03.
 * `complete()` refuse un modèle absent d'ici : un coût faux serait pire qu'une erreur. `chat()` ne choisit pas le
 * modèle qui répond après un repli : il compte un modèle sans prix à `HIGHEST_PRICES` (`chatCost`).
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrices>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 },
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
};

/**
 * Entrée de `MODEL_PRICES` au plus haut prix de sortie : le prix d'un modèle servi sans prix connu (spec brique 4,
 * choix C18). Ici plutôt que dans `chat.ts`, qui la lit, car elle est calculée au chargement depuis la table.
 */
export const HIGHEST_PRICES: ModelPrices = Object.values(MODEL_PRICES).reduce((top, prices) =>
  prices.output > top.output ? prices : top,
);

/** Champs de `usage` utiles au coût (forme de l'API Messages). */
export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
};

export function pricesOf(model: string): ModelPrices {
  const prices = MODEL_PRICES[model];
  if (prices === undefined) {
    throw new Error(
      `Prix inconnus pour le modèle ${model} : ajoute-les à MODEL_PRICES (apps/server/src/ai/client.ts) ` +
        "d'après la page Pricing d'Anthropic, et note-les dans scripts/exercises/NOTES.md.",
    );
  }
  return prices;
}

/** Coût d'un appel en dollars. `input_tokens` ne compte que les jetons ni lus ni écrits en cache. */
export function costUsd(model: string, usage: TokenUsage): number {
  return costAtPrices(pricesOf(model), usage);
}

/** Coût en dollars de `usage` aux prix donnés ; `costUsd` pour un modèle de la table. */
export function costAtPrices(p: ModelPrices, usage: TokenUsage): number {
  const written = usage.cache_creation_input_tokens ?? 0;
  const by1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const by5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? written - by1h;
  const dollars =
    usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    by5m * p.cacheWrite5m +
    by1h * p.cacheWrite1h +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  return dollars / 1_000_000;
}

/**
 * `max_tokens`, `refusal`, `stop_reason`, `invalid_json` et `api` : `complete()`. Les autres codes viennent de
 * `classifyAiError` (`chat()`, spec brique 4 §5.3), où `api` reste le code d'une erreur non reconnue.
 */
export type AiErrorCode =
  | 'max_tokens'
  | 'refusal'
  | 'stop_reason'
  | 'invalid_json'
  | 'api'
  | 'rate_limited'
  | 'overloaded'
  | 'server'
  | 'network'
  | 'spend_limit'
  | 'bad_request'
  | 'auth'
  | 'aborted'
  | 'timeout';

/**
 * Échec d'un appel. `fatal` : la même requête échouera pour tout le lot (clé refusée, requête invalide), inutile
 * de continuer. `costUsd` : ce que l'appel a coûté malgré l'échec ; exact pour `complete()` (sortie coupée, refus,
 * lus dans `usage`). `costPartial` : `costUsd` n'est qu'une estimation prudente, pour un appel de `chat()` que
 * l'API a pu traiter : interrompu (`aborted`, `timeout`), en erreur après l'ouverture du flux, ou en erreur réseau
 * après l'envoi ; la réflexion non relayée ne s'y mesure pas. Un appel arrêté avant l'envoi (requête invalide,
 * signal déjà aborté) et une erreur HTTP reçue avant tout flux, non facturés, ont un coût nul et `costPartial` faux.
 */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly stopReason: string | undefined;
  readonly costUsd: number;
  readonly costPartial: boolean;
  readonly fatal: boolean;

  constructor(
    code: AiErrorCode,
    message: string,
    details: {
      stopReason?: string;
      costUsd?: number;
      costPartial?: boolean;
      fatal?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'AiError';
    this.code = code;
    this.stopReason = details.stopReason;
    this.costUsd = details.costUsd ?? 0;
    this.costPartial = details.costPartial ?? false;
    this.fatal = details.fatal ?? false;
  }
}

/** Contrôles communs au vrai client et au faux, avant tout appel. */
export function checkRequest(req: AiRequest): void {
  const breakpoints = req.system.filter((block) => block.cache === true).length;
  if (breakpoints > MAX_CACHE_BREAKPOINTS) {
    throw new Error(
      `${breakpoints} blocs en cache : ${MAX_CACHE_BREAKPOINTS} points de cache au plus par requête.`,
    );
  }
  if ((req.schema as { type?: unknown }).type !== 'object') {
    throw new Error('Le schéma de sortie est un objet JSON (type "object").');
  }
}

/** Réponse brute, commune au vrai client et au faux : texte rendu, raison d'arrêt, coût. */
export type RawOutput = {
  text: string;
  stopReason: string;
  costUsd: number;
  model: string;
  maxTokens: number;
  refusalCategory?: string | null;
};

/**
 * Lit `stop_reason` puis le JSON. Seul `end_turn` donne une valeur : `max_tokens` coupe la sortie (JSON
 * incomplet), `refusal` la remplace par un refus ; les autres raisons n'ont pas lieu d'être sans outils.
 */
export function readOutput<T>(raw: RawOutput): AiResult<T> {
  const details = { stopReason: raw.stopReason, costUsd: raw.costUsd };
  if (raw.stopReason === 'max_tokens') {
    throw new AiError(
      'max_tokens',
      `stop_reason max_tokens : sortie coupée à ${raw.maxTokens} jetons (réflexion comprise), JSON incomplet. ` +
        "Augmente max_tokens ou baisse l'effort.",
      details,
    );
  }
  if (raw.stopReason === 'refusal') {
    const category = raw.refusalCategory ? ` (catégorie ${raw.refusalCategory})` : '';
    throw new AiError('refusal', `stop_reason refusal : le modèle a refusé de répondre${category}.`, details);
  }
  if (raw.stopReason !== 'end_turn') {
    throw new AiError('stop_reason', `stop_reason inattendu : ${raw.stopReason}.`, details);
  }
  try {
    return {
      value: JSON.parse(raw.text) as T,
      stopReason: raw.stopReason,
      costUsd: raw.costUsd,
      model: raw.model,
    };
  } catch (error) {
    throw new AiError('invalid_json', `Sortie illisible : JSON invalide (${(error as Error).message}).`, {
      ...details,
      cause: error,
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Formats de chaîne acceptés par la sortie structurée. */
const STRING_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** Mots-clés recopiés tels quels quand ils sont présents. */
const KEPT = ['type', 'title', 'description', 'enum', 'const', 'default'] as const;

function strictNode(node: unknown): unknown {
  if (!isRecord(node)) return node;
  const rest: Record<string, unknown> = { ...node };
  const take = (key: string) => {
    const value = rest[key];
    delete rest[key];
    return value;
  };
  const out: Record<string, unknown> = {};
  take('$schema');
  for (const key of ['$defs', 'definitions']) {
    const defs = take(key);
    if (isRecord(defs)) {
      out[key] = Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, strictNode(def)]));
    }
  }
  const ref = take('$ref');
  if (ref !== undefined) out.$ref = ref;
  for (const key of ['anyOf', 'allOf']) {
    const variants = take(key);
    if (Array.isArray(variants)) out[key] = variants.map(strictNode);
  }
  const oneOf = take('oneOf');
  if (Array.isArray(oneOf)) out.anyOf = oneOf.map(strictNode);
  for (const key of KEPT) {
    const value = take(key);
    if (value !== undefined) out[key] = value;
  }
  if (out.type === 'object') {
    const properties = take('properties');
    out.properties = isRecord(properties)
      ? Object.fromEntries(Object.entries(properties).map(([name, prop]) => [name, strictNode(prop)]))
      : {};
    const required = take('required');
    if (Array.isArray(required)) out.required = required;
    take('additionalProperties');
    out.additionalProperties = false;
  } else if (out.type === 'array') {
    const items = take('items');
    if (items !== undefined) out.items = strictNode(items);
    // Autre valeur : laissée dans `rest`, donc décrite, à sa place.
    if (rest.minItems === 0 || rest.minItems === 1) out.minItems = take('minItems');
  } else if (out.type === 'string') {
    if (typeof rest.format === 'string' && STRING_FORMATS.has(rest.format)) out.format = take('format');
  }
  const left = Object.entries(rest);
  if (left.length > 0) {
    const note = `{${left.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ')}}`;
    out.description = typeof out.description === 'string' ? `${out.description}\n\n${note}` : note;
  }
  return out;
}

/**
 * Adapte un JSON Schema à la sortie structurée (`output_config.format`). L'API refuse (erreur 400) les bornes
 * numériques, `minLength`/`maxLength`, `maxItems` et `minItems` au-delà de 1 : elles passent dans `description`,
 * que le modèle lit, comme le fait le SDK. Contrairement à l'aide du SDK (`jsonSchemaOutputFormat`), `enum` et
 * `const` restent des contraintes : les codes de la taxonomie sont imposés au modèle. Tout objet reçoit
 * `additionalProperties: false`. Le schéma reçu n'est pas modifié.
 */
export function toStructuredSchema(schema: object): Record<string, unknown> {
  return strictNode(structuredClone(schema)) as Record<string, unknown>;
}

export type AnthropicClientOptions = {
  /** Clé d'API : jamais écrite dans un journal ni un message d'erreur. */
  apiKey: string;
  /** Modèle par défaut (04 §9 : `claude-opus-5-5`), dont le prix doit être connu. */
  model: string;
  /** `fetch` du SDK, remplacé dans les tests (aucun appel réseau). */
  fetch?: typeof fetch;
  /** Nouveaux essais du SDK sur 408, 409, 429, 5xx et erreurs réseau (2 par défaut). */
  maxRetries?: number;
};

/** Erreur du SDK → `AiError`. Une erreur 4xx autre que 408, 409, 429 vaudra pour toutes les fiches : fatale. */
function apiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const fatal = status !== undefined && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
    const where = status === undefined ? '' : ` (${status})`;
    return new AiError('api', `Erreur de l'API Anthropic${where} : ${error.message}`, {
      fatal,
      cause: error,
    });
  }
  // Erreur levée par le SDK avant l'envoi (paramètre refusé, par exemple) : la même pour toutes les requêtes.
  const message = error instanceof Error ? error.message : String(error);
  return new AiError('api', `Appel à l'API Anthropic impossible : ${message}`, { fatal: true, cause: error });
}

/**
 * Client réel (SDK officiel `@anthropic-ai/sdk`). Requête de `complete()` : `system` en blocs texte avec
 * `cache_control` sur les blocs marqués, un message `user`, `output_config` avec l'effort et la sortie structurée.
 * Pas de paramètre `thinking` : la réflexion adaptative est toujours active sur Claude Opus 5.5 (`disabled` y est
 * refusé), l'effort la règle. Pas d'API Batch, pas de modèle de repli (04 §9 : le modèle est noté dans la fiche).
 * `chat()` passe par `streamChat` (`chat.ts`) : flux, et replis côté serveur pour un fil adulte.
 */
export function createAnthropicClient(options: AnthropicClientOptions): AiClient {
  pricesOf(options.model);
  const sdk = new Anthropic({
    apiKey: options.apiKey,
    // La clé passée fait foi : ni jeton `ANTHROPIC_AUTH_TOKEN` ni profil local en plus.
    authToken: null,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });
  return {
    model: options.model,
    async complete<T>(req: AiRequest): Promise<AiResult<T>> {
      checkRequest(req);
      const model = req.model ?? options.model;
      pricesOf(model);
      const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
      let message: Anthropic.Message;
      try {
        message = await sdk.messages.create({
          model,
          max_tokens: maxTokens,
          system: req.system.map((block) => ({
            type: 'text' as const,
            text: block.text,
            ...(block.cache === true ? { cache_control: { type: 'ephemeral' as const } } : {}),
          })),
          messages: [{ role: 'user', content: req.user }],
          output_config: {
            effort: req.effort,
            format: { type: 'json_schema', schema: toStructuredSchema(req.schema) },
          },
        });
      } catch (error) {
        throw apiError(error);
      }
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      return readOutput<T>({
        text,
        stopReason: message.stop_reason ?? 'unknown',
        costUsd: costUsd(model, message.usage),
        model: message.model,
        maxTokens,
        refusalCategory: message.stop_details?.category ?? null,
      });
    },
    chat(req: AiChatRequest, onEvent: (e: AiChatEvent) => void): Promise<AiChatFinal> {
      return streamChat(sdk, req, onEvent);
    },
  };
}
