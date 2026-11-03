import { describe, expect, it } from 'vitest';
import {
  type AiChatEvent,
  type AiChatRequest,
  AiError,
  buildChatParams,
  createFakeAiClient,
  fakeFallbackText,
  fakeRefusal,
  fakeText,
  fakeToolUse,
} from '../../src/ai';

const request = (extra: Partial<AiChatRequest> = {}): AiChatRequest => ({
  model: 'claude-opus-5-5',
  effort: 'low',
  maxTokens: 16_000,
  system: [{ text: 'Prompt figé.', cache: true }],
  tools: [{ name: 'read_training', description: 'Lit les séances.', inputSchema: { type: 'object' } }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Salut.' }] }],
  thinkingBinding: 'error',
  fallbacks: 'default',
  timeoutMs: 120_000,
  signal: new AbortController().signal,
  ...extra,
});

const collect = () => {
  const events: AiChatEvent[] = [];
  return { events, onEvent: (e: AiChatEvent) => events.push(e) };
};

describe('createFakeAiClient : chat()', () => {
  it("rejoue les tours dans l'ordre : texte en deltas de 7 caractères, puis appel d'outil", async () => {
    const fake = createFakeAiClient([], {
      chat: [fakeText('Bonjour Kevin, ça va ?'), fakeToolUse('toolu_1', 'read_training', { since_days: 28 })],
    });
    const first = collect();
    const text = await fake.chat(request(), first.onEvent);
    expect(first.events).toEqual([
      { type: 'block_start', index: 0, block: 'text' },
      { type: 'text_delta', text: 'Bonjour' },
      { type: 'text_delta', text: ' Kevin,' },
      { type: 'text_delta', text: ' ça va ' },
      { type: 'text_delta', text: '?' },
      { type: 'block_stop', index: 0 },
    ]);
    expect(text).toEqual({
      blocks: [{ type: 'text', text: 'Bonjour Kevin, ça va ?' }],
      stopReason: 'end_turn',
      stopDetails: null,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 0, output_tokens: 0 },
      iterations: null,
      thinkingDropped: 0,
      fallbackUsed: false,
      costUsd: 0,
      priceUnknown: false,
    });

    const second = collect();
    const tool = await fake.chat(request(), second.onEvent);
    expect(second.events).toEqual([
      { type: 'block_start', index: 0, block: 'tool_use' },
      { type: 'block_stop', index: 0 },
    ]);
    expect(tool.stopReason).toBe('tool_use');
    expect(tool.blocks).toEqual([
      { type: 'tool_use', id: 'toolu_1', name: 'read_training', input: { since_days: 28 } },
    ]);
    await expect(fake.chat(request(), () => {})).rejects.toThrow(/aucun tour prévu pour l'appel 3/);
  });

  it('garde chaque requête et sa forme sérialisée (buildChatParams)', async () => {
    const fake = createFakeAiClient([], { chat: [fakeText('Oui.'), fakeText('Non.')] });
    const adult = request();
    const minor = request({ fallbacks: null });
    await fake.chat(adult, () => {});
    await fake.chat(minor, () => {});
    expect(fake.chatCalls).toEqual([adult, minor]);
    expect(fake.chatParams).toEqual([buildChatParams(adult), buildChatParams(minor)]);
    expect(fake.chatParams[1]?.betas).toEqual(['thinking-binding-controls-2026-08-01']);
    expect(fake.calls).toEqual([]);
  });

  it('accepte une fonction de la requête et du rang de l’appel', async () => {
    const fake = createFakeAiClient([], { chat: (req, call) => fakeText(`${req.model} ${call}`) });
    const final = await fake.chat(request(), () => {});
    expect(final.blocks).toEqual([{ type: 'text', text: 'claude-opus-5-5 0' }]);
  });

  it('complète le final : modèle, coût par chatCost, repli, valeurs données', async () => {
    const fake = createFakeAiClient([], {
      chat: [
        fakeText('Oui.', { usage: { input_tokens: 1_000_000, output_tokens: 0 } }),
        fakeText('Oui.', { model: 'claude-opus-5', costUsd: 0.5, thinkingDropped: 1 }),
        fakeText('Oui.', { model: 'claude-inconnu' }),
      ],
    });
    expect(await fake.chat(request(), () => {})).toMatchObject({ costUsd: 4, priceUnknown: false });
    expect(await fake.chat(request(), () => {})).toMatchObject({
      model: 'claude-opus-5',
      costUsd: 0.5,
      thinkingDropped: 1,
    });
    expect(await fake.chat(request(), () => {})).toMatchObject({ costUsd: 0, priceUnknown: true });
  });

  it('refus et repli scriptés', async () => {
    const fake = createFakeAiClient([], {
      chat: [fakeRefusal('bio'), fakeFallbackText('Voilà.', 'claude-opus-5-5', 'claude-opus-5')],
    });
    const refused = collect();
    expect(await fake.chat(request(), refused.onEvent)).toMatchObject({
      blocks: [],
      stopReason: 'refusal',
      stopDetails: { category: 'bio', explanation: null, recommendedModel: null },
      fallbackUsed: false,
    });
    expect(refused.events).toEqual([]);

    const fallback = collect();
    const final = await fake.chat(request(), fallback.onEvent);
    expect(fallback.events).toEqual([
      { type: 'block_start', index: 0, block: 'fallback' },
      { type: 'block_stop', index: 0 },
      { type: 'block_start', index: 1, block: 'text' },
      { type: 'text_delta', text: 'Voilà.' },
      { type: 'block_stop', index: 1 },
    ]);
    expect(final).toMatchObject({
      stopReason: 'end_turn',
      model: 'claude-opus-5',
      fallbackUsed: true,
      priceUnknown: false,
    });
    expect(final.blocks[0]).toMatchObject({
      type: 'fallback',
      from: { model: 'claude-opus-5-5' },
      to: { model: 'claude-opus-5' },
    });
    expect(final.iterations?.map((i) => [i.type, i.model])).toEqual([
      ['message', 'claude-opus-5-5'],
      ['fallback_message', 'claude-opus-5'],
    ]);
  });

  it('lève l’erreur prévue après ses événements', async () => {
    const error = new AiError('overloaded', 'Surcharge.');
    const fake = createFakeAiClient([], {
      chat: [{ error, afterEvents: [{ type: 'block_start', index: 0, block: 'text' }] }],
    });
    const { events, onEvent } = collect();
    await expect(fake.chat(request(), onEvent)).rejects.toBe(error);
    expect(events).toEqual([{ type: 'block_start', index: 0, block: 'text' }]);
  });

  it('attend gate avant son dernier événement', async () => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fake = createFakeAiClient([], { chat: [fakeText('Bonjour.', { gate })] });
    const { events, onEvent } = collect();
    let settled = false;
    const pending = fake.chat(request(), onEvent).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(events).toEqual([
      { type: 'block_start', index: 0, block: 'text' },
      { type: 'text_delta', text: 'Bonjour' },
      { type: 'text_delta', text: '.' },
    ]);
    open();
    expect((await pending).blocks).toEqual([{ type: 'text', text: 'Bonjour.' }]);
    expect(events.at(-1)).toEqual({ type: 'block_stop', index: 0 });
  });

  it('respecte req.signal : déjà aborté, aborté pendant gate, aborté par un événement', async () => {
    const never = new Promise<void>(() => {});
    const fake = createFakeAiClient([], {
      chat: [
        fakeText('Oui.'),
        fakeText('Bonjour.', { gate: never }),
        fakeText('Mets 65 kg. Puis repose-toi.'),
      ],
    });

    const before = new AbortController();
    before.abort();
    const none = collect();
    await expect(fake.chat(request({ signal: before.signal }), none.onEvent)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(none.events).toEqual([]);

    const during = new AbortController();
    const waiting = fake.chat(request({ signal: during.signal }), () => {});
    setTimeout(() => during.abort(), 5);
    await expect(waiting).rejects.toMatchObject({ code: 'aborted' });

    const byEvent = new AbortController();
    const relayed = collect();
    const error = await fake
      .chat(request({ signal: byEvent.signal }), (e) => {
        relayed.onEvent(e);
        if (e.type === 'text_delta' && e.text.includes('kg')) byEvent.abort();
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'aborted' });
    expect(relayed.events.at(-1)).toEqual({ type: 'text_delta', text: ' kg. Pu' });
    expect(fake.chatCalls).toHaveLength(3);
  });
});
