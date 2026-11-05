/**
 * Faux client IA, déterministe, pour les tests : aucun appel réseau. `complete()` applique les mêmes contrôles et
 * la même lecture de `stop_reason` que le vrai client (`checkRequest`, `readOutput`). `chat()` rejoue des tours
 * scriptés, garde chaque requête et sa forme sérialisée (`buildChatParams`, celle du vrai client), et complète le
 * message final comme le vrai client (`chatCost`, `usedFallback`).
 */
import {
  type AiChatEvent,
  type AiChatFinal,
  type AiChatRequest,
  buildChatParams,
  chatCost,
  usedFallback,
} from './chat';
import {
  type AiClient,
  AiError,
  type AiRequest,
  type AiResult,
  checkRequest,
  DEFAULT_MAX_TOKENS,
  readOutput,
} from './client';

/**
 * Réponse prévue : une valeur (rendue en JSON) ou un texte brut, avec sa raison d'arrêt (`end_turn` par défaut)
 * et son coût (0 par défaut) ; ou une erreur levée telle quelle (erreur d'API simulée).
 */
export type FakeAiResponse =
  | { value: unknown; stopReason?: string; costUsd?: number; model?: string }
  | { text: string; stopReason?: string; costUsd?: number; model?: string }
  | { error: Error };

/** Réponses dans l'ordre des appels, ou calculées depuis la requête (utile quand les appels sont parallèles). */
export type FakeAiResponses =
  | readonly FakeAiResponse[]
  | ((req: AiRequest, call: number) => FakeAiResponse | Promise<FakeAiResponse>);

/**
 * Tour scripté de `chat()` : des événements puis le message final, complété par défaut (modèle de la requête,
 * usage nul, coût par `chatCost`, repli par `usedFallback`) ; `gate` retient le dernier événement et le final.
 * Ou une erreur, levée après `afterEvents`. `abortCostUsd` : coût de l'`AiError('aborted')` si `req.signal`
 * interrompt le tour en cours ; à défaut le coût du final complété (`final.costUsd`, sinon `chatCost` de son usage
 * et de ses itérations), sinon 0 ; toujours avec `costPartial`, comme le vrai client. Un `req.signal` déjà aborté
 * avant l'appel ne joue aucun tour, comme le vrai client qui n'envoie rien : `AiError('aborted')` au coût nul et
 * exact (`costPartial` faux), rien d'enregistré.
 */
export type FakeChatTurn =
  | {
      events?: AiChatEvent[];
      final: Partial<AiChatFinal> & Pick<AiChatFinal, 'blocks' | 'stopReason'>;
      gate?: Promise<void>;
      abortCostUsd?: number;
    }
  | { error: AiError; afterEvents?: AiChatEvent[]; abortCostUsd?: number };

type ScriptedFinal = Extract<FakeChatTurn, { final: unknown }>['final'];

export type FakeAiClient = AiClient & {
  /** Requêtes de `complete()` reçues, dans l'ordre des appels. */
  readonly calls: readonly AiRequest[];
  /** Requêtes de `chat()` reçues, dans l'ordre des appels. */
  readonly chatCalls: readonly AiChatRequest[];
  /** Forme sérialisée de chaque requête de `chat()`, telle que le vrai client l'enverrait. */
  readonly chatParams: readonly ReturnType<typeof buildChatParams>[];
};

/** Interruption d'un tour : son `signal` et le coût de l'`AiError('aborted')` qu'elle lève. */
type Abort = { signal: AbortSignal; costUsd: number };

const aborted = (abort: Abort) =>
  new AiError('aborted', 'Appel interrompu.', { costUsd: abort.costUsd, costPartial: true });

function throwIfAborted(abort: Abort): void {
  if (abort.signal.aborted) throw aborted(abort);
}

/** Rend les événements un par un ; `signal` aborté (avant, entre deux, ou par l'un d'eux) arrête l'appel. */
function replay(events: readonly AiChatEvent[], abort: Abort, onEvent: (e: AiChatEvent) => void): void {
  for (const event of events) {
    throwIfAborted(abort);
    onEvent(event);
  }
  throwIfAborted(abort);
}

/** Attend `gate`, sauf si `signal` interrompt l'appel avant. */
function waitFor(gate: Promise<void>, abort: Abort): Promise<void> {
  throwIfAborted(abort);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted(abort));
    abort.signal.addEventListener('abort', onAbort, { once: true });
    gate.then(resolve, reject).finally(() => abort.signal.removeEventListener('abort', onAbort));
  });
}

function completeFinal(final: ScriptedFinal, req: AiChatRequest): AiChatFinal {
  const model = final.model ?? req.model;
  const usage = final.usage ?? { input_tokens: 0, output_tokens: 0 };
  const iterations = final.iterations ?? null;
  const priced = chatCost(model, usage, iterations);
  return {
    blocks: final.blocks,
    stopReason: final.stopReason,
    stopDetails: final.stopDetails ?? null,
    model,
    usage,
    iterations,
    thinkingDropped: final.thinkingDropped ?? 0,
    fallbackUsed: final.fallbackUsed ?? usedFallback(final.blocks, iterations),
    costUsd: final.costUsd ?? priced.costUsd,
    priceUnknown: final.priceUnknown ?? priced.priceUnknown,
  };
}

export function createFakeAiClient(
  responses: FakeAiResponses,
  options: {
    model?: string;
    /** Tours de `chat()` dans l'ordre des appels, ou calculés depuis la requête et le rang de l'appel. */
    chat?: readonly FakeChatTurn[] | ((req: AiChatRequest, call: number) => FakeChatTurn);
  } = {},
): FakeAiClient {
  const calls: AiRequest[] = [];
  const chatCalls: AiChatRequest[] = [];
  const chatParams: ReturnType<typeof buildChatParams>[] = [];
  const defaultModel = options.model ?? 'fake-model';
  return {
    model: defaultModel,
    calls,
    chatCalls,
    chatParams,
    async complete<T>(req: AiRequest): Promise<AiResult<T>> {
      checkRequest(req);
      const call = calls.length;
      calls.push(req);
      const response = typeof responses === 'function' ? await responses(req, call) : responses[call];
      if (response === undefined) {
        throw new Error(`Faux client IA : aucune réponse prévue pour l'appel ${call + 1}.`);
      }
      if ('error' in response) throw response.error;
      return readOutput<T>({
        text: 'text' in response ? response.text : JSON.stringify(response.value),
        stopReason: response.stopReason ?? 'end_turn',
        costUsd: response.costUsd ?? 0,
        model: response.model ?? req.model ?? defaultModel,
        maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
    },
    /** Rejoue le tour : ses événements sauf le dernier, `gate`, le dernier, puis le final ; `req.signal` l'arrête. */
    async chat(req: AiChatRequest, onEvent: (e: AiChatEvent) => void): Promise<AiChatFinal> {
      let params: ReturnType<typeof buildChatParams>;
      try {
        params = buildChatParams(req);
      } catch (error) {
        // Comme le vrai client : rien n'est envoyé, donc rien n'est enregistré.
        const message = error instanceof Error ? error.message : String(error);
        throw new AiError('bad_request', `Requête invalide, non envoyée : ${message}`, { cause: error });
      }
      // Comme le vrai client : rien n'est envoyé, donc rien n'est enregistré ni joué, et le coût nul est exact.
      if (req.signal.aborted) throw new AiError('aborted', 'Appel interrompu.');
      const call = chatCalls.length;
      chatCalls.push(req);
      chatParams.push(params);
      const turn = typeof options.chat === 'function' ? options.chat(req, call) : options.chat?.[call];
      if (turn === undefined) {
        // Erreur du script du test, pas de l'appel : elle reste une `Error` simple, bien visible.
        throw new Error(`Faux client IA : aucun tour prévu pour l'appel ${call + 1} de chat().`);
      }
      // Tour scripté par son usage ou ses itérations : l'abandon coûte ce que son final aurait coûté.
      const finalCost = 'final' in turn ? completeFinal(turn.final, req).costUsd : undefined;
      const abort: Abort = { signal: req.signal, costUsd: turn.abortCostUsd ?? finalCost ?? 0 };
      if ('error' in turn) {
        replay(turn.afterEvents ?? [], abort, onEvent);
        throw turn.error;
      }
      const events = turn.events ?? [];
      replay(events.slice(0, -1), abort, onEvent);
      if (turn.gate !== undefined) await waitFor(turn.gate, abort);
      replay(events.slice(-1), abort, onEvent);
      return completeFinal(turn.final, req);
    },
  };
}

/** Options des aides : champs du final à fixer, et `gate` du tour. */
type FakeTurnOptions = Partial<AiChatFinal> & { gate?: Promise<void> };

/** Taille des deltas de texte du faux, en caractères. */
const DELTA_CHARS = 7;

function textEvents(index: number, text: string): AiChatEvent[] {
  const chars = Array.from(text);
  const deltas: AiChatEvent[] = [];
  for (let at = 0; at < chars.length; at += DELTA_CHARS) {
    deltas.push({ type: 'text_delta', text: chars.slice(at, at + DELTA_CHARS).join('') });
  }
  return [{ type: 'block_start', index, block: 'text' }, ...deltas, { type: 'block_stop', index }];
}

function scripted(events: AiChatEvent[], final: ScriptedFinal, opts: FakeTurnOptions): FakeChatTurn {
  const { gate, ...fields } = opts;
  return { events, final: { ...final, ...fields }, ...(gate === undefined ? {} : { gate }) };
}

/** Réponse texte (`end_turn`), en deltas de 7 caractères. */
export function fakeText(text: string, opts: FakeTurnOptions = {}): FakeChatTurn {
  return scripted(textEvents(0, text), { blocks: [{ type: 'text', text }], stopReason: 'end_turn' }, opts);
}

/** Appel d'un outil (`tool_use`). */
export function fakeToolUse(
  id: string,
  name: string,
  input: unknown,
  opts: FakeTurnOptions = {},
): FakeChatTurn {
  return scripted(
    [
      { type: 'block_start', index: 0, block: 'tool_use' },
      { type: 'block_stop', index: 0 },
    ],
    { blocks: [{ type: 'tool_use', id, name, input }], stopReason: 'tool_use' },
    opts,
  );
}

/** Refus avant toute sortie (`refusal`), avec sa catégorie. */
export function fakeRefusal(category: string | null): FakeChatTurn {
  return {
    final: {
      blocks: [],
      stopReason: 'refusal',
      stopDetails: { category, explanation: null, recommendedModel: null },
    },
  };
}

/** Repli côté serveur : `fromModel` refuse, `toModel` répond le texte (bloc `fallback`, itérations des deux). */
export function fakeFallbackText(text: string, fromModel: string, toModel: string): FakeChatTurn {
  const none = { input_tokens: 0, output_tokens: 0 };
  return {
    events: [
      { type: 'block_start', index: 0, block: 'fallback' },
      { type: 'block_stop', index: 0 },
      ...textEvents(1, text),
    ],
    final: {
      blocks: [
        {
          type: 'fallback',
          from: { model: fromModel },
          to: { model: toModel },
          trigger: { type: 'refusal', category: null },
        },
        { type: 'text', text },
      ],
      stopReason: 'end_turn',
      model: toModel,
      iterations: [
        { type: 'message', model: fromModel, usage: none },
        { type: 'fallback_message', model: toModel, usage: none },
      ],
    },
  };
}
