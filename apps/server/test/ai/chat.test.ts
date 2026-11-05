import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AiChatEvent,
  type AiChatRequest,
  AiError,
  type AiIteration,
  buildChatParams,
  chatCost,
  classifyAiError,
  costUsd,
  createAnthropicClient,
  HIGHEST_PRICES,
  MODEL_PRICES,
  type TokenUsage,
  toStructuredSchema,
} from '../../src/ai';
import { usedFallback } from '../../src/ai/chat';
import * as ai from '../../src/ai/index';

/** JSON Schema d'entrée d'un outil, tel que `z.toJSONSchema` le produit (bornes que l'API refuse comprises). */
const readTrainingSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { since_days: { type: 'integer', minimum: 1, maximum: 28 } },
  required: ['since_days'],
  additionalProperties: false,
};
const searchSchema = {
  type: 'object',
  properties: { query: { type: 'string', maxLength: 80 } },
  required: ['query'],
};

const request = (extra: Partial<AiChatRequest> = {}): AiChatRequest => ({
  model: 'claude-opus-5-5',
  effort: 'low',
  maxTokens: 16_000,
  system: [
    { text: 'Prompt figé de la variante.', cache: true },
    { text: 'Bloc sans point de cache.' },
    { text: 'Voix du fil, puis <dossier>.', cache: true },
  ],
  tools: [
    { name: 'read_training', description: 'Lit les séances.', inputSchema: readTrainingSchema },
    { name: 'search_exercises', description: 'Cherche une fiche.', inputSchema: searchSchema },
  ],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Salut.' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        { type: 'text', text: 'Salut !' },
      ],
    },
    { role: 'user', content: [{ type: 'text', text: 'Je peux monter ?' }] },
  ],
  thinkingBinding: 'drop_block',
  fallbacks: 'default',
  timeoutMs: 120_000,
  signal: new AbortController().signal,
  ...extra,
});

const ephemeral = { type: 'ephemeral' };

describe('buildChatParams', () => {
  it('fil adult : replis par défaut, deux bêtas, réflexion liée, outils stricts, cache aux trois endroits', () => {
    const { body, betas } = buildChatParams(request());
    expect(betas).toEqual(['thinking-binding-controls-2026-08-01', 'server-side-fallback-2026-07-01']);
    expect(body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16_000,
      system: [
        { type: 'text', text: 'Prompt figé de la variante.', cache_control: ephemeral },
        { type: 'text', text: 'Bloc sans point de cache.' },
        { type: 'text', text: 'Voix du fil, puis <dossier>.', cache_control: ephemeral },
      ],
      tools: [
        {
          name: 'read_training',
          description: 'Lit les séances.',
          input_schema: toStructuredSchema(readTrainingSchema),
          strict: true,
        },
        {
          name: 'search_exercises',
          description: 'Cherche une fiche.',
          input_schema: toStructuredSchema(searchSchema),
          strict: true,
        },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Salut.' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '', signature: 'sig-1' },
            { type: 'text', text: 'Salut !' },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'Je peux monter ?', cache_control: ephemeral }] },
      ],
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: 'low' },
      fallbacks: 'default',
    });
    expect(body.thinking).not.toHaveProperty('display');
    for (const key of ['tool_choice', 'metadata', 'inference_geo', 'temperature']) {
      expect(body).not.toHaveProperty(key);
    }
    for (const tool of body.tools as Record<string, unknown>[]) {
      expect(tool.strict).toBe(true);
      expect(tool).not.toHaveProperty('eager_input_streaming');
    }
  });

  it('fil minor : ni fallbacks ni bêta server-side-fallback, seulement thinking-binding-controls', () => {
    const { body, betas } = buildChatParams(request({ fallbacks: null, thinkingBinding: 'error' }));
    expect(betas).toEqual(['thinking-binding-controls-2026-08-01']);
    expect(betas.some((beta) => beta.startsWith('server-side-fallback'))).toBe(false);
    expect(body).not.toHaveProperty('fallbacks');
    expect(body.thinking).toEqual({ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'error' } });
  });

  it("message role: 'system' final sérialisé tel quel, point de cache sur le message qui le précède", () => {
    const base = request();
    const reminder = { role: 'system' as const, content: [{ type: 'text', text: 'Rappel : une règle.' }] };
    const { body } = buildChatParams({ ...base, messages: [...base.messages, reminder] });
    const messages = body.messages as unknown[];
    expect(messages.at(-1)).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'Rappel : une règle.' }],
    });
    expect(messages.at(-2)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Je peux monter ?', cache_control: ephemeral }],
    });
  });

  it('point de cache sur le dernier bloc du dernier message, sans toucher aux messages reçus', () => {
    const toolResults = {
      role: 'user' as const,
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"a":1}' },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"b":2}' },
      ],
    };
    const req = request({ messages: [...request().messages, toolResults] });
    const copy = structuredClone(req.messages);
    const messages = buildChatParams(req).body.messages as { content: Record<string, unknown>[] }[];
    expect(messages.at(-1)?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"a":1}' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"b":2}', cache_control: ephemeral },
    ]);
    expect(messages.at(-2)?.content).toEqual([{ type: 'text', text: 'Je peux monter ?' }]);
    expect(req.messages).toEqual(copy);
  });

  it("refuse plus de 4 points de cache, comme l'API (blocs système marqués + dernier message)", () => {
    const system = Array.from({ length: 4 }, (_, i) => ({ text: `Bloc ${i}`, cache: true }));
    expect(() => buildChatParams(request({ system }))).toThrow(/4 points de cache/);
  });
});

/** Aucun appel réseau : le `fetch` global échoue et ne doit jamais être appelé. */
let networkFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  networkFetch = vi.fn(() => {
    throw new Error('Appel réseau interdit dans les tests.');
  });
  vi.stubGlobal('fetch', networkFetch);
});
afterEach(() => {
  expect(networkFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

/** Événements du flux de l'API Messages, au format SSE documenté. */
type ApiEvent = { type: string } & Record<string, unknown>;

const usage = (extra: Record<string, unknown> = {}) => ({
  input_tokens: 120,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 6000,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
  ...extra,
});
const messageStart = (extra: Record<string, unknown> = {}): ApiEvent => ({
  type: 'message_start',
  message: {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: usage(),
    input_transformations: [],
    ...extra,
  },
});
const blockStart = (index: number, block: Record<string, unknown>): ApiEvent => ({
  type: 'content_block_start',
  index,
  content_block: block,
});
const blockDelta = (index: number, delta: Record<string, unknown>): ApiEvent => ({
  type: 'content_block_delta',
  index,
  delta,
});
const blockStop = (index: number): ApiEvent => ({ type: 'content_block_stop', index });
const messageDelta = (
  stopReason: string,
  deltaUsage: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): ApiEvent => ({
  type: 'message_delta',
  delta: { stop_reason: stopReason, stop_sequence: null, stop_details: null, container: null },
  usage: deltaUsage,
  context_management: null,
  ...extra,
});
const ping: ApiEvent = { type: 'ping' };
const messageStop: ApiEvent = { type: 'message_stop' };
const textBlock = (index: number, ...parts: string[]): ApiEvent[] => [
  blockStart(index, { type: 'text', text: '' }),
  ...parts.map((text) => blockDelta(index, { type: 'text_delta', text })),
  blockStop(index),
];
const iteration = (type: string, model: string, extra: Record<string, unknown> = {}) => ({
  type,
  model,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: null,
  ...extra,
});

type Reply =
  | { status: number; json: unknown }
  /** `stall` : le flux reste ouvert après ses événements, jusqu'à l'abandon de la requête. */
  | { events: ApiEvent[]; stall?: boolean };

/** `fetch` injecté dans le SDK : garde chaque requête et rejoue `replies` dans l'ordre, comme le vrai `fetch`. */
function stubFetch(...replies: Reply[]) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    const reply = replies[requests.length - 1] ?? { status: 500, json: { error: 'aucune réponse prévue' } };
    if ('json' in reply) {
      return new Response(JSON.stringify(reply.json), {
        status: reply.status,
        headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
      });
    }
    const text = reply.events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Morceaux coupés n'importe où, comme sur le réseau.
        for (let at = 0; at < text.length; at += 97) {
          controller.enqueue(new TextEncoder().encode(text.slice(at, at + 97)));
        }
        if (reply.stall !== true) controller.close();
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' },
    });
  });
  return { fetch, requests };
}

const client = (fetch: typeof globalThis.fetch, maxRetries = 0) =>
  createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-opus-5-5', fetch, maxRetries });

/** Tour avec repli en cours de sortie : réflexion du modèle demandé, bloc `fallback`, texte, appel d'outil. */
const fallbackStream: ApiEvent[] = [
  messageStart({
    input_transformations: [
      { type: 'thinking_dropped', path: 'messages.1.content.0', reason: 'prefix_binding_mismatch' },
    ],
  }),
  ping,
  blockStart(0, { type: 'thinking', thinking: '', signature: '' }),
  blockDelta(0, { type: 'signature_delta', signature: 'sig-2' }),
  blockStop(0),
  blockStart(1, {
    type: 'fallback',
    from: { model: 'claude-opus-5-5' },
    to: { model: 'claude-opus-5' },
    trigger: { type: 'refusal', category: 'cyber' },
  }),
  blockStop(1),
  ...textBlock(2, 'Bonjour', ' Kevin.'),
  blockStart(3, { type: 'tool_use', id: 'toolu_1', name: 'read_training', input: {} }),
  blockDelta(3, { type: 'input_json_delta', partial_json: '{"since_days":' }),
  blockDelta(3, { type: 'input_json_delta', partial_json: ' 28}' }),
  blockStop(3),
  messageDelta(
    'tool_use',
    {
      input_tokens: 5100,
      output_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      iterations: [
        iteration('message', 'claude-opus-5-5', {
          input_tokens: 120,
          output_tokens: 50,
          cache_read_input_tokens: 6000,
        }),
        iteration('fallback_message', 'claude-opus-5', { input_tokens: 5100, output_tokens: 250 }),
      ],
    },
    {
      // Repli en cours de flux : le message_delta final remplace input_transformations de message_start.
      input_transformations: [
        { type: 'thinking_dropped', path: 'messages.1.content.0', reason: 'model_binding_mismatch' },
        {
          type: 'thinking_mismatch_allowed',
          path: 'messages.3.content.0',
          reason: 'prefix_binding_mismatch',
        },
        { type: 'thinking_dropped', path: 'messages.3.content.1', reason: 'model_binding_mismatch' },
      ],
    },
  ),
  messageStop,
];

/** Tour simple, sans repli ni itérations. */
const textStream = (...parts: string[]): ApiEvent[] => [
  messageStart(),
  ...textBlock(0, ...parts),
  messageDelta('end_turn', { output_tokens: 40 }),
  messageStop,
];

describe('createAnthropicClient().chat (fetch injecté, flux rejoué)', () => {
  it('envoie la requête de buildChatParams en flux, avec les bêtas en en-tête', async () => {
    const { fetch, requests } = stubFetch({ events: textStream('Oui.') }, { events: textStream('Oui.') });
    const ai = client(fetch);
    const adult = request();
    await ai.chat(adult, () => {});
    await ai.chat(request({ fallbacks: null }), () => {});

    const [sent, minor] = requests;
    expect(sent?.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(sent?.headers.get('x-api-key')).toBe('cle-de-test');
    expect(sent?.headers.get('anthropic-beta')).toBe(
      'thinking-binding-controls-2026-08-01,server-side-fallback-2026-07-01',
    );
    expect(sent?.body).toEqual({ ...buildChatParams(adult).body, stream: true });
    expect(sent?.body.fallbacks).toBe('default');
    for (const key of ['tool_choice', 'metadata', 'inference_geo', 'temperature']) {
      expect(sent?.body).not.toHaveProperty(key);
    }
    expect(minor?.headers.get('anthropic-beta')).toBe('thinking-binding-controls-2026-08-01');
    expect(minor?.body).not.toHaveProperty('fallbacks');
  });

  it("message role: 'system' final sérialisé tel quel dans la requête envoyée", async () => {
    const { fetch, requests } = stubFetch({ events: textStream('Oui.') });
    const base = request();
    const reminder = { role: 'system' as const, content: [{ type: 'text', text: 'Rappel : une règle.' }] };
    await client(fetch).chat({ ...base, messages: [...base.messages, reminder] }, () => {});
    expect(requests[0]?.body.messages).toEqual([
      ...(buildChatParams(base).body.messages as unknown[]),
      reminder,
    ]);
  });

  it('rend les deltas dans l’ordre, début et fin de bloc des 4 types, puis le message final', async () => {
    const { fetch } = stubFetch({ events: fallbackStream });
    const events: AiChatEvent[] = [];
    const final = await client(fetch).chat(request(), (e) => events.push(e));

    expect(events).toEqual([
      { type: 'block_start', index: 0, block: 'thinking' },
      { type: 'block_stop', index: 0 },
      { type: 'block_start', index: 1, block: 'fallback' },
      { type: 'block_stop', index: 1 },
      { type: 'block_start', index: 2, block: 'text' },
      { type: 'text_delta', text: 'Bonjour' },
      { type: 'text_delta', text: ' Kevin.' },
      { type: 'block_stop', index: 2 },
      { type: 'block_start', index: 3, block: 'tool_use' },
      { type: 'block_stop', index: 3 },
    ]);
    expect(final.blocks).toEqual([
      { type: 'thinking', thinking: '', signature: 'sig-2' },
      {
        type: 'fallback',
        from: { model: 'claude-opus-5-5' },
        to: { model: 'claude-opus-5' },
        trigger: { type: 'refusal', category: 'cyber' },
      },
      { type: 'text', text: 'Bonjour Kevin.' },
      { type: 'tool_use', id: 'toolu_1', name: 'read_training', input: { since_days: 28 } },
    ]);
    expect(final.stopReason).toBe('tool_use');
    expect(final.stopDetails).toBeNull();
    expect(final.model).toBe('claude-opus-5');
    expect(final.usage).toEqual({
      input_tokens: 5100,
      output_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    });
    const zeroCache = { cache_creation_input_tokens: 0, cache_creation: null };
    expect(final.iterations).toEqual([
      {
        type: 'message',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 120, output_tokens: 50, cache_read_input_tokens: 6000, ...zeroCache },
      },
      {
        type: 'fallback_message',
        model: 'claude-opus-5',
        usage: { input_tokens: 5100, output_tokens: 250, cache_read_input_tokens: 0, ...zeroCache },
      },
    ]);
    expect(final.thinkingDropped).toBe(2);
    expect(final.fallbackUsed).toBe(true);
    // 120 × 4 $ + 50 × 20 $ + 6 000 × 0,20 $ (Opus 5.5) + 5 100 × 5 $ + 250 × 25 $ (Opus 5), par million.
    expect(final.costUsd).toBeCloseTo((480 + 1000 + 1200 + 25_500 + 6250) / 1_000_000, 10);
    expect(final.priceUnknown).toBe(false);
  });

  it('sans repli : fallbackUsed faux, coût de l’usage de tête au prix du modèle, rien de retiré', async () => {
    const { fetch } = stubFetch({ events: textStream('Tu peux ', 'garder la charge.') });
    const deltas: string[] = [];
    const final = await client(fetch).chat(request(), (e) => {
      if (e.type === 'text_delta') deltas.push(e.text);
    });
    expect(deltas).toEqual(['Tu peux ', 'garder la charge.']);
    expect(final.blocks).toEqual([{ type: 'text', text: 'Tu peux garder la charge.' }]);
    expect(final.stopReason).toBe('end_turn');
    expect(final.model).toBe('claude-opus-5-5');
    expect(final.iterations).toBeNull();
    expect(final.thinkingDropped).toBe(0);
    expect(final.fallbackUsed).toBe(false);
    expect(final.costUsd).toBeCloseTo(costUsd('claude-opus-5-5', final.usage), 12);
    expect(final.usage.output_tokens).toBe(40);
  });

  it('repli collant (itération fallback_message sans bloc fallback) : fallbackUsed vrai', async () => {
    const { fetch } = stubFetch({
      events: [
        messageStart({ model: 'claude-opus-5' }),
        ...textBlock(0, 'Oui.'),
        messageDelta('end_turn', {
          output_tokens: 10,
          iterations: [
            iteration('fallback_message', 'claude-opus-5', { input_tokens: 100, output_tokens: 10 }),
          ],
        }),
        messageStop,
      ],
    });
    const final = await client(fetch).chat(request(), () => {});
    expect(final.blocks.some((b) => b.type === 'fallback')).toBe(false);
    expect(final.fallbackUsed).toBe(true);
    expect(final.model).toBe('claude-opus-5');
  });

  it('refus : stop_details lu (catégorie, explication, modèle conseillé)', async () => {
    const { fetch } = stubFetch({
      events: [
        messageStart(),
        {
          type: 'message_delta',
          delta: {
            stop_reason: 'refusal',
            stop_sequence: null,
            container: null,
            stop_details: {
              type: 'refusal',
              category: 'bio',
              explanation: 'Refus de la politique.',
              recommended_model: 'claude-opus-4-8',
              fallback_credit_token: null,
              fallback_has_prefill_claim: null,
            },
          },
          usage: { output_tokens: 0 },
          context_management: null,
        },
        messageStop,
      ],
    });
    const final = await client(fetch).chat(request(), () => {});
    expect(final.stopReason).toBe('refusal');
    expect(final.blocks).toEqual([]);
    expect(final.stopDetails).toEqual({
      category: 'bio',
      explanation: 'Refus de la politique.',
      recommendedModel: 'claude-opus-4-8',
    });
    expect(final.fallbackUsed).toBe(false);
  });

  it('début de bloc redacted_thinking, et other pour un type que le coach ne lit pas', async () => {
    const { fetch } = stubFetch({
      events: [
        messageStart(),
        blockStart(0, { type: 'redacted_thinking', data: 'chiffré' }),
        blockStop(0),
        blockStart(1, { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} }),
        blockStop(1),
        ...textBlock(2, 'Oui.'),
        messageDelta('end_turn', { output_tokens: 5 }),
        messageStop,
      ],
    });
    const starts: AiChatEvent[] = [];
    await client(fetch).chat(request(), (e) => {
      if (e.type === 'block_start') starts.push(e);
    });
    expect(starts).toEqual([
      { type: 'block_start', index: 0, block: 'redacted_thinking' },
      { type: 'block_start', index: 1, block: 'other' },
      { type: 'block_start', index: 2, block: 'text' },
    ]);
  });

  /** Entrée de `message_start` (120 × 4 $ + 6 000 × 0,20 $, par million de jetons). */
  const knownInputUsd = (480 + 1200) / 1_000_000;
  /** Sortie estimée d'un texte relayé : un jeton pour 3 caractères, au prix de sortie d'Opus 5.5 (20 $). */
  const relayedOutputUsd = (text: string) => (Math.ceil(text.length / 3) * 20) / 1_000_000;

  it('timeoutMs dépassé pendant le flux → AiError timeout, après les événements reçus, coût estimé', async () => {
    const { fetch } = stubFetch({ events: [messageStart(), ...textBlock(0, 'Je réfléchis')], stall: true });
    const events: AiChatEvent[] = [];
    const error = await client(fetch)
      .chat(request({ timeoutMs: 50 }), (e) => events.push(e))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'timeout', costPartial: true });
    expect(events).toContainEqual({ type: 'text_delta', text: 'Je réfléchis' });
    expect((error as AiError).costUsd).toBeCloseTo(knownInputUsd + relayedOutputUsd('Je réfléchis'), 12);
  });

  it('signal aborté après « Mets 65 kg. » relayé → aborted, plus aucun événement, sortie au moins le texte relayé', async () => {
    const { fetch } = stubFetch({ events: textStream('Mets ', '65 kg.', ' Puis ', 'repose-toi.') });
    const controller = new AbortController();
    const events: AiChatEvent[] = [];
    const error = await client(fetch)
      .chat(request({ signal: controller.signal }), (e) => {
        events.push(e);
        if (e.type === 'text_delta' && e.text === '65 kg.') controller.abort();
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'aborted', costPartial: true });
    expect(events.at(-1)).toEqual({ type: 'text_delta', text: '65 kg.' });
    // message_start ne compte qu'un jeton de sortie : le texte relayé (11 caractères, 4 jetons) l'emporte.
    expect((error as AiError).costUsd).toBeCloseTo(knownInputUsd + relayedOutputUsd('Mets 65 kg.'), 12);
  });

  it('signal aborté avant message_start → coût de la requête sérialisée estimé, jamais nul', async () => {
    const { fetch } = stubFetch({ events: [], stall: true });
    const controller = new AbortController();
    const req = request({ signal: controller.signal });
    const pending = client(fetch).chat(req, () => {});
    setTimeout(() => controller.abort(), 20);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'aborted', costPartial: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Entrée estimée : un jeton pour 3 caractères de la requête sérialisée, au prix d'entrée d'Opus 5.5 (4 $).
    const inputTokens = Math.ceil(JSON.stringify(buildChatParams(req).body).length / 3);
    expect((error as AiError).costUsd).toBeGreaterThan(0);
    expect((error as AiError).costUsd).toBeCloseTo((inputTokens * 4) / 1_000_000, 12);
  });

  it('signal déjà aborté → AiError aborted, sans requête, coût nul et exact (costPartial faux)', async () => {
    const { fetch } = stubFetch({ events: textStream('Oui.') });
    const controller = new AbortController();
    controller.abort();
    await expect(client(fetch).chat(request({ signal: controller.signal }), () => {})).rejects.toMatchObject({
      code: 'aborted',
      costUsd: 0,
      costPartial: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requête impossible à construire → AiError bad_request, jamais une Error simple, sans requête', async () => {
    const { fetch } = stubFetch({ events: textStream('Oui.') });
    const system = Array.from({ length: 4 }, (_, i) => ({ text: `Bloc ${i}`, cache: true }));
    const error = await client(fetch)
      .chat(request({ system }), () => {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'bad_request', costUsd: 0, costPartial: false });
    expect((error as AiError).message).toMatch(/4 points de cache/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('overloaded_error reçu dans le flux après message_start → overloaded, coût estimé', async () => {
    const overloaded = {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    } as ApiEvent;
    const { fetch } = stubFetch({ events: [messageStart(), ...textBlock(0, 'Je'), overloaded] });
    await expect(client(fetch).chat(request(), () => {})).rejects.toMatchObject({
      code: 'overloaded',
      costPartial: true,
      costUsd: expect.closeTo(knownInputUsd + relayedOutputUsd('Je'), 12),
    });
  });

  it.each([
    [429, 'rate_limit_error', 'rate_limited'],
    [529, 'overloaded_error', 'overloaded'],
  ] as const)(
    'erreur HTTP %i (%s) avant tout flux, non facturée : coût 0, costPartial faux',
    async (status, type, code) => {
      const { fetch } = stubFetch({
        status,
        json: { type: 'error', error: { type, message: 'Plus tard.' } },
      });
      await expect(client(fetch).chat(request(), () => {})).rejects.toMatchObject({
        code,
        costUsd: 0,
        costPartial: false,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('erreur réseau après l’envoi → network, coût de la requête estimé par prudence', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const req = request();
    const error = await client(fetch)
      .chat(req, () => {})
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'network', costPartial: true });
    const inputTokens = Math.ceil(JSON.stringify(buildChatParams(req).body).length / 3);
    expect((error as AiError).costUsd).toBeCloseTo((inputTokens * 4) / 1_000_000, 12);
  });
});

const tokens = (input: number, output: number): TokenUsage => ({
  input_tokens: input,
  output_tokens: output,
});

describe('chatCost', () => {
  const million = 1_000_000;

  it('somme des itérations, chacune au prix de son modèle', () => {
    const iterations: AiIteration[] = [
      { type: 'message', model: 'claude-opus-5-5', usage: tokens(million, 0) },
      { type: 'fallback_message', model: 'claude-opus-5', usage: tokens(0, million) },
    ];
    expect(chatCost('claude-opus-5', tokens(0, million), iterations)).toEqual({
      costUsd: 4 + 25,
      priceUnknown: false,
    });
  });

  it('sans itérations (null ou vide) : usage de tête au prix du modèle', () => {
    for (const iterations of [null, []]) {
      expect(chatCost('claude-opus-5-5', tokens(million, million), iterations)).toEqual({
        costUsd: 4 + 20,
        priceUnknown: false,
      });
    }
  });

  it('modèle sans prix : compté au prix le plus élevé de la table, priceUnknown', () => {
    expect(chatCost('claude-inconnu', tokens(million, million), null)).toEqual({
      costUsd: HIGHEST_PRICES.input + HIGHEST_PRICES.output,
      priceUnknown: true,
    });
    const iterations: AiIteration[] = [
      { type: 'message', model: 'claude-opus-5-5', usage: tokens(million, 0) },
      { type: 'fallback_message', model: 'claude-inconnu', usage: tokens(0, million) },
    ];
    expect(chatCost('claude-inconnu', tokens(0, million), iterations)).toEqual({
      costUsd: 4 + HIGHEST_PRICES.output,
      priceUnknown: true,
    });
  });

  it('HIGHEST_PRICES est l’entrée de MODEL_PRICES au plus haut prix de sortie', () => {
    const top = Math.max(...Object.values(MODEL_PRICES).map((p) => p.output));
    expect(HIGHEST_PRICES.output).toBe(top);
    expect(Object.values(MODEL_PRICES)).toContain(HIGHEST_PRICES);
  });

  it('prix des replis claude-opus-5 et claude-opus-4-8 relevés dans NOTES.md', () => {
    for (const model of ['claude-opus-5', 'claude-opus-4-8']) {
      expect(MODEL_PRICES[model]).toEqual({
        input: 5,
        output: 25,
        cacheWrite5m: 6.25,
        cacheWrite1h: 10,
        cacheRead: 0.5,
      });
    }
  });
});

describe('usedFallback', () => {
  const text = { type: 'text', text: 'Oui.' };
  const fallback = { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } };
  const iterations = (type: string): AiIteration[] => [{ type, model: 'b', usage: tokens(1, 1) }];

  it.each([
    ['un bloc fallback', true, [fallback, text], null],
    ['une itération fallback_message', true, [text], iterations('fallback_message')],
    ['ni bloc ni itération de repli', false, [text], iterations('message')],
    ['ni bloc ni itérations', false, [text], null],
  ] as const)('%s → %s', (_, expected, blocks, its) => {
    expect(usedFallback(blocks, its)).toBe(expected);
  });

  it("n'est pas exporté par l'index : fallbackUsed se lit dans le final, jamais recalculé (P26)", () => {
    expect(ai).not.toHaveProperty('usedFallback');
  });
});

/** Erreur du SDK telle qu'il la lève pour une réponse HTTP (statut, corps JSON de l'API). */
const httpError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers());

describe('classifyAiError (statut, type, message)', () => {
  it.each([
    [
      429,
      'rate_limit_error',
      'Number of request tokens has exceeded your per-minute rate limit',
      'rate_limited',
    ],
    [429, 'enforced_spend_limit_reached', 'Spend limit reached.', 'spend_limit'],
    [429, 'rate_limit_error', 'enforced_spend_limit_reached: workspace spend limit', 'spend_limit'],
    [
      400,
      'invalid_request_error',
      'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01.',
      'spend_limit',
    ],
    [400, 'invalid_request_error', 'messages.1.content.0: unexpected block', 'bad_request'],
    [404, 'not_found_error', 'model: claude-inconnu', 'bad_request'],
    [408, 'timeout_error', 'Request timed out', 'timeout'],
    [409, 'conflict_error', 'Conflict', 'server'],
    [401, 'authentication_error', 'invalid x-api-key', 'auth'],
    [403, 'permission_error', 'Your API key does not have permission', 'auth'],
    [500, 'api_error', 'Internal server error', 'server'],
    [502, 'api_error', 'Bad gateway', 'server'],
    [503, 'api_error', 'Service unavailable', 'server'],
    [529, 'overloaded_error', 'Overloaded', 'overloaded'],
  ] as const)('%i %s « %s » → %s', (status, type, message, code) => {
    expect(classifyAiError(httpError(status, type, message))).toBe(code);
  });

  it.each([
    ['overloaded_error', 'overloaded'],
    ['rate_limit_error', 'rate_limited'],
    ['api_error', 'server'],
  ] as const)('erreur dans le flux, sans statut : %s → %s', (type, code) => {
    const error = new Anthropic.APIError(
      undefined,
      { type: 'error', error: { type } },
      undefined,
      undefined,
      type,
    );
    expect(classifyAiError(error)).toBe(code);
  });

  it.each([
    ['APIConnectionError', new Anthropic.APIConnectionError({ message: 'fetch failed' }), 'network'],
    ['APIConnectionTimeoutError', new Anthropic.APIConnectionTimeoutError(), 'timeout'],
    ['APIUserAbortError', new Anthropic.APIUserAbortError(), 'aborted'],
    ['AiError', new AiError('refusal', 'Refus.'), 'refusal'],
    ['autre erreur', new Error('inattendue'), 'api'],
  ] as const)('%s → %s', (_, error, code) => {
    expect(classifyAiError(error)).toBe(code);
  });
});
