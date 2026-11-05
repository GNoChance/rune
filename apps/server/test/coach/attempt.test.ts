import {
  type AgeBand,
  type CoachStreamEvent,
  CoachStreamEventSchema,
  type CoachToolName,
} from '@rune/contracts';
import type { ApiBlock, ApiMessage } from '@rune/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  type AiChatEvent,
  type AiChatFinal,
  type AiChatRequest,
  AiError,
  type AiErrorCode,
  chatCost,
  costUsd,
  createFakeAiClient,
  type FakeAiClient,
  type FakeChatTurn,
  fakeFallbackText,
  fakeText,
  fakeToolUse,
} from '../../src/ai';
import { type AttemptInput, type CallRecord, runAttempt } from '../../src/coach/attempt';
import { TOOLS_1, toolDefinitions } from '../../src/coach/tools';
import type { CoachTool, PendingProposal, ToolContext, ToolOutcome } from '../../src/coach/tools/types';
import { createLogger, createTestContext, createUserAndLogin, type TestContext } from '../support';
import { toolContext } from '../support/coach';

/*
 * Tentative du coach (spec brique 4 §8.3 à §8.6) : boucle d'outils sur le flux du faux client scripté, relais phrase
 * par phrase passé au filtre de sortie, conversion des fins et des erreurs. Chaque événement émis est relu par le
 * schéma du flux (`CoachStreamEventSchema`).
 */

const NOW = Date.parse('2026-11-05T10:00:00.000Z');
const DAY_MS = 86_400_000;
const MODEL = 'claude-opus-5-5';

/** Historique du fil puis message de l'utilisateur : les `messages` de la tentative. */
const MESSAGES: ApiMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'Comment était ma séance ?' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Elle était solide.' }] },
  { role: 'user', content: [{ type: 'text', text: 'Et aujourd’hui ?' }] },
];

let ctx: TestContext;
afterEach(() => ctx?.close());

type Setup = {
  chat: readonly FakeChatTurn[] | ((req: AiChatRequest, call: number) => FakeChatTurn);
  tools?: readonly CoachTool[];
  audience?: AgeBand;
  brief?: unknown;
  threadToolResults?: readonly unknown[];
  canCall?: (spentUsd: number) => Promise<boolean>;
  signal?: AbortSignal;
  healthConsent?: boolean;
  lines?: string[];
};

async function setup(o: Setup) {
  const lines = o.lines;
  ctx = await createTestContext({
    now: new Date(NOW).toISOString(),
    ...(lines === undefined ? {} : { deps: { logger: createLogger((l) => lines.push(l)) } }),
  });
  const u = await createUserAndLogin(ctx);
  const audience = o.audience ?? 'adult';
  const fake = createFakeAiClient([], { model: MODEL, chat: o.chat });
  const events: CoachStreamEvent[] = [];
  const toolCtx = toolContext(ctx, u.id, {
    thread: { audience, promptVersion: `coach-1/${audience}` },
  });
  const input: AttemptInput = {
    ai: fake,
    request: {
      model: MODEL,
      effort: 'low',
      maxTokens: 16_000,
      system: [
        { text: 'Prompt figé.', cache: true },
        { text: 'Voix et dossier.', cache: true },
      ],
      tools: toolDefinitions(TOOLS_1),
      thinkingBinding: 'error',
      fallbacks: audience === 'adult' ? 'default' : null,
      timeoutMs: 120_000,
    },
    messages: MESSAGES,
    tools: o.tools ?? TOOLS_1,
    toolCtx,
    filter: { audience, brief: o.brief ?? {}, threadToolResults: o.threadToolResults ?? [] },
    signal: o.signal ?? new AbortController().signal,
    canCall: o.canCall ?? (async () => true),
    emit: (e) => events.push(CoachStreamEventSchema.parse(e)),
    now: () => NOW,
    healthConsent: o.healthConsent ?? true,
  };
  return { fake, events, input, toolCtx, run: () => runAttempt(input) };
}

/** Outil factice : rend `outcome` (ou le calcule), après avoir noté son entrée et son contexte. */
function fakeTool(
  name: CoachToolName,
  outcome: ToolOutcome | ((input: unknown, ctx: ToolContext) => ToolOutcome | Promise<ToolOutcome>),
) {
  const seen: { input: unknown; allowedMass: string[] }[] = [];
  const run = vi.fn(async (input: unknown, ctx: ToolContext) => {
    seen.push({ input, allowedMass: [...ctx.allowed.mass].sort() });
    return typeof outcome === 'function' ? outcome(input, ctx) : outcome;
  });
  const tool: CoachTool = { name, description: 'Factice.', input: z.unknown(), run };
  return { tool, run, seen };
}

const ok = (result: unknown): ToolOutcome => ({ isError: false, result });

type BlockKind = Extract<AiChatEvent, { type: 'block_start' }>['block'];
const KINDS: readonly string[] = ['thinking', 'redacted_thinking', 'text', 'tool_use', 'fallback'];

/** Deltas de 5 caractères d'un texte. */
function deltas(t: string): AiChatEvent[] {
  const chars = Array.from(t);
  const out: AiChatEvent[] = [];
  for (let at = 0; at < chars.length; at += 5) {
    out.push({ type: 'text_delta', text: chars.slice(at, at + 5).join('') });
  }
  return out;
}

/** Tour scripté depuis ses blocs : bornes de chaque bloc, texte en deltas. */
function turn(blocks: ApiBlock[], stopReason: string, final: Partial<AiChatFinal> = {}): FakeChatTurn {
  const events = blocks.flatMap((block, index): AiChatEvent[] => [
    { type: 'block_start', index, block: (KINDS.includes(block.type) ? block.type : 'other') as BlockKind },
    ...(block.type === 'text' ? deltas(String(block.text)) : []),
    { type: 'block_stop', index },
  ]);
  return { events, final: { blocks, stopReason, ...final } };
}

const text = (t: string): ApiBlock => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: unknown = {}): ApiBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const fallback = (from: string, to: string): ApiBlock => ({
  type: 'fallback',
  from: { model: from },
  to: { model: to },
  trigger: { type: 'refusal', category: null },
});

const texts = (events: readonly CoachStreamEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.text] : []));

/** Fiche d'un appel servi, au coût nul du faux par défaut. */
const record = (o: Partial<CallRecord> = {}): CallRecord => ({
  model: MODEL,
  usage: { input_tokens: 0, output_tokens: 0 },
  costUsd: 0,
  priceUnknown: false,
  fallbackUsed: false,
  thinkingDropped: 0,
  stopReason: 'end_turn',
  refusalCategory: null,
  ...o,
});

/** Aucun appel n'a reçu deux messages `assistant` de suite (historique, message de l'utilisateur, tours). */
function expectAlternating(fake: FakeAiClient): void {
  for (const req of fake.chatCalls) {
    const roles = req.messages.map((m) => m.role);
    expect(roles.some((role, i) => role === 'assistant' && roles[i + 1] === 'assistant')).toBe(false);
  }
}

describe('runAttempt : relais filtré', () => {
  it('échange simple : 3 phrases → 3 text, answered ; requête = historique + message de l’utilisateur', async () => {
    const canCall = vi.fn(async () => true);
    const { fake, events, run } = await setup({
      chat: [fakeText('Bonjour. Tu as bien dormi ? Allons-y !')],
      canCall,
    });
    const outcome = await run();
    expect(events).toEqual([
      { type: 'text', text: 'Bonjour. ' },
      { type: 'text', text: 'Tu as bien dormi ? ' },
      { type: 'text', text: 'Allons-y !' },
    ]);
    expect(outcome).toEqual({
      kind: 'answered',
      text: 'Bonjour. Tu as bien dormi ? Allons-y !',
      turns: [{ role: 'assistant', blocks: [text('Bonjour. Tu as bien dormi ? Allons-y !')] }],
      truncated: false,
      stopReason: 'end_turn',
      effectiveModel: MODEL,
      toolRounds: 0,
      toolResults: [],
      firstTextAtMs: NOW,
      calls: [record()],
    });
    expect(fake.chatCalls).toHaveLength(1);
    expect(fake.chatCalls[0]?.messages).toEqual(MESSAGES);
    expect(canCall).toHaveBeenCalledWith(0);
  });

  it('phrase bloquée « Mets 65 kg. » : appel aborté, blocked unit, aucune phrase après, coût compté', async () => {
    const usage = { input_tokens: 3000, output_tokens: 40 };
    const { fake, events, run } = await setup({
      chat: [fakeText('Bonne idée. Mets 65 kg. Puis repose-toi.', { usage })],
      brief: { profile: { bodyweight_kg: 70 } },
    });
    const outcome = await run();
    expect(outcome).toEqual({
      kind: 'blocked',
      verdict: { rule: 'unit', detail: '65 kg' },
      toolRounds: 0,
      // Aborté avant le final : le faux rend le coût que le final aurait eu (tour scripté par son usage).
      calls: [
        record({
          costUsd: chatCost(MODEL, usage, null).costUsd,
          stopReason: null,
        }),
      ],
    });
    expect((outcome as { calls: CallRecord[] }).calls[0]?.costUsd).toBeGreaterThan(0);
    expect(fake.chatCalls[0]?.signal.aborted).toBe(true);
    expect(events).toEqual([{ type: 'text', text: 'Bonne idée. ' }]);
  });

  it('valeur d’un outil d’un message précédent, ou du dossier : relayée (C8)', async () => {
    const { events, run } = await setup({
      chat: [fakeText('Mets 65 kg. Ou reste à 62,5 kg.')],
      brief: { program: { workouts: [{ slots: [{ last_load_kg: 62.5 }] }] } },
      threadToolResults: [{ sessions: [{ exercises: [{ load_kg: 65 }] }] }],
    });
    expect(await run()).toMatchObject({ kind: 'answered', text: 'Mets 65 kg. Ou reste à 62,5 kg.' });
    expect(texts(events)).toEqual(['Mets 65 kg. ', 'Ou reste à 62,5 kg.']);
  });

  it('numéro découpé sur deux phrases : le contexte passe d’une phrase à la suivante, bloqué', async () => {
    const { events, run } = await setup({ chat: [fakeText('Si ça ne va pas, appelle le\n3237.')] });
    expect(await run()).toMatchObject({ kind: 'blocked', verdict: { rule: 'phone', detail: '3237' } });
    expect(texts(events)).toEqual(['Si ça ne va pas, appelle le\n']);
  });

  it('numéro d’aide sur deux phrases : relayé', async () => {
    const { run } = await setup({ chat: [fakeText('Si c’est urgent, appelle le\n15.')] });
    expect(await run()).toMatchObject({ kind: 'answered', text: 'Si c’est urgent, appelle le\n15.' });
  });

  it('réflexion gardée dans les tours, jamais relayée ni filtrée', async () => {
    const thinking = { type: 'thinking', thinking: 'Mets 65 kg, appelle le 3237.', signature: 'sig' };
    const redacted = { type: 'redacted_thinking', data: 'opaque' };
    // Deltas de texte dans un bloc de réflexion : un client qui relaierait la réflexion ne passerait pas non plus.
    const events: AiChatEvent[] = [
      { type: 'block_start', index: 0, block: 'thinking' },
      { type: 'text_delta', text: 'Mets 65 kg, appelle le 3237. ' },
      { type: 'block_stop', index: 0 },
      { type: 'block_start', index: 1, block: 'redacted_thinking' },
      { type: 'text_delta', text: 'Mets 65 kg. ' },
      { type: 'block_stop', index: 1 },
      { type: 'block_start', index: 2, block: 'text' },
      { type: 'text_delta', text: 'Garde ta charge.' },
      { type: 'block_stop', index: 2 },
    ];
    const blocks = [thinking, redacted, text('Garde ta charge.')];
    const { events: emitted, run } = await setup({
      chat: [{ events, final: { blocks, stopReason: 'end_turn' } }],
    });
    expect(await run()).toMatchObject({
      kind: 'answered',
      text: 'Garde ta charge.',
      turns: [{ role: 'assistant', blocks }],
    });
    expect(texts(emitted)).toEqual(['Garde ta charge.']);
  });

  it('texte avant un outil puis après : deux paragraphes, jamais collés', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { events, run } = await setup({
      chat: [
        turn([text('Je regarde ton historique.'), toolUse('toolu_1', 'read_training')], 'tool_use'),
        fakeText('Tu n’as pas encore de séance.'),
      ],
      tools: [reader.tool],
    });
    const outcome = await run();
    expect(events).toEqual([
      { type: 'text', text: 'Je regarde ton historique.' },
      { type: 'tool_running', tool: 'read_training' },
      { type: 'text', text: '\n\nTu n’as pas encore de séance.' },
    ]);
    expect(outcome).toMatchObject({
      kind: 'answered',
      text: 'Je regarde ton historique.\n\nTu n’as pas encore de séance.',
    });
  });
});

describe('runAttempt : boucle d’outils', () => {
  it('read_training puis texte : 2 appels, un tool_running, tool_result au JSON compact', async () => {
    const { fake, events, run } = await setup({
      chat: [
        fakeToolUse('toolu_1', 'read_training', { since_days: 7 }),
        fakeText('Rien encore cette semaine.'),
      ],
    });
    const outcome = await run();
    const result = {
      revision: null,
      program: null,
      sessions: [],
      decisions: [],
      records: [],
      pending_proposals: [],
      truncated: false,
    };
    const toolTurn = { role: 'assistant', blocks: [toolUse('toolu_1', 'read_training', { since_days: 7 })] };
    const resultTurn = {
      role: 'user',
      blocks: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify(result) }],
    };
    expect(events).toEqual([
      { type: 'tool_running', tool: 'read_training' },
      { type: 'text', text: 'Rien encore cette semaine.' },
    ]);
    expect(outcome).toEqual({
      kind: 'answered',
      text: 'Rien encore cette semaine.',
      turns: [toolTurn, resultTurn, { role: 'assistant', blocks: [text('Rien encore cette semaine.')] }],
      truncated: false,
      stopReason: 'end_turn',
      effectiveModel: MODEL,
      toolRounds: 1,
      toolResults: [result],
      firstTextAtMs: NOW,
      calls: [record({ stopReason: 'tool_use' }), record()],
    });
    expect(fake.chatCalls).toHaveLength(2);
    expect(fake.chatCalls[1]?.messages).toEqual([
      ...MESSAGES,
      { role: 'assistant', content: toolTurn.blocks },
      { role: 'user', content: resultTurn.blocks },
    ]);
  });

  it('4 tours puis texte → answered ; jamais deux messages assistant de suite', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const uses = [1, 2, 3, 4].map((n) => fakeToolUse(`toolu_${n}`, 'read_training', { since_days: n }));
    const { fake, events, run } = await setup({
      chat: [...uses, fakeText('Voilà ce que je vois.')],
      tools: [reader.tool],
    });
    expect(await run()).toMatchObject({ kind: 'answered', toolRounds: 4, text: 'Voilà ce que je vois.' });
    expect(fake.chatCalls).toHaveLength(5);
    expect(reader.run).toHaveBeenCalledTimes(4);
    expect(events.filter((e) => e.type === 'tool_running')).toHaveLength(4);
    expect(fake.chatCalls[4]?.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      ...['assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user'],
    ]);
    expectAlternating(fake);
  });

  it('5 tours → tool_rounds_exceeded, le 5e jamais exécuté', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const uses = [1, 2, 3, 4, 5].map((n) => fakeToolUse(`toolu_${n}`, 'read_training', { since_days: n }));
    const { fake, events, run } = await setup({ chat: uses, tools: [reader.tool] });
    expect(await run()).toEqual({
      kind: 'failed',
      code: 'tool_rounds_exceeded',
      cause: null,
      toolRounds: 4,
      calls: Array.from({ length: 5 }, () => record({ stopReason: 'tool_use' })),
    });
    expect(fake.chatCalls).toHaveLength(5);
    expect(reader.run).toHaveBeenCalledTimes(4);
    expect(events.filter((e) => e.type === 'tool_running')).toHaveLength(4);
  });

  it('deux outils parallèles : tool_running dans l’ordre, un seul message user aux deux résultats dans l’ordre', async () => {
    const order: string[] = [];
    const search = fakeTool('search_exercises', () => {
      order.push('search');
      return ok({ total_matching: 0 });
    });
    const reader = fakeTool('read_training', () => {
      order.push('read');
      return ok({ sessions: [] });
    });
    const { fake, events, run } = await setup({
      chat: [
        turn([toolUse('toolu_a', 'search_exercises'), toolUse('toolu_b', 'read_training')], 'tool_use'),
        fakeText('C’est noté.'),
      ],
      tools: [reader.tool, search.tool],
    });
    expect(await run()).toMatchObject({
      kind: 'answered',
      toolRounds: 1,
      toolResults: [{ total_matching: 0 }, { sessions: [] }],
    });
    expect(events.slice(0, 2)).toEqual([
      { type: 'tool_running', tool: 'search_exercises' },
      { type: 'tool_running', tool: 'read_training' },
    ]);
    expect(order).toEqual(['search', 'read']);
    expect(fake.chatCalls[1]?.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_a', content: '{"total_matching":0}' },
        { type: 'tool_result', tool_use_id: 'toolu_b', content: '{"sessions":[]}' },
      ],
    });
  });

  it('résultat en erreur : tool_result is_error, la tentative continue', async () => {
    const reader = fakeTool('read_training', {
      isError: true,
      result: { error: 'invalid_input', issues: [] },
    });
    const { fake, run } = await setup({
      chat: [
        fakeToolUse('toolu_1', 'read_training', { since_days: 90 }),
        fakeText('Je lis 28 jours au plus.'),
      ],
      tools: [reader.tool],
    });
    expect(await run()).toMatchObject({ kind: 'answered', toolRounds: 1 });
    expect(fake.chatCalls[1]?.messages.at(-1)?.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: '{"error":"invalid_input","issues":[]}',
        is_error: true,
      },
    ]);
  });

  it('outil inconnu : ni tool_running ni gestionnaire, résultat unknown_tool', async () => {
    const { fake, events, run } = await setup({
      chat: [fakeToolUse('toolu_1', 'open_nutrition_screen', {}), fakeText('Je ne peux pas.')],
    });
    expect(await run()).toMatchObject({ kind: 'answered', toolResults: [{ error: 'unknown_tool' }] });
    expect(events.filter((e) => e.type === 'tool_running')).toEqual([]);
    expect(fake.chatCalls[1]?.messages.at(-1)?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"error":"unknown_tool"}', is_error: true },
    ]);
  });

  it('valeurs autorisées des outils : au 2e outil d’un tour, une charge rendue par le 1er', async () => {
    const search = fakeTool('search_exercises', ok({ exercises: [{ start_load_kg: 42.5 }] }));
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { run } = await setup({
      chat: [
        turn([toolUse('toolu_a', 'search_exercises'), toolUse('toolu_b', 'read_training')], 'tool_use'),
        fakeText('Commence à 42,5 kg.'),
      ],
      tools: [reader.tool, search.tool],
      brief: { profile: { bodyweight_kg: 70 } },
      threadToolResults: [{ load_kg: 30 }],
    });
    expect(await run()).toMatchObject({ kind: 'answered', text: 'Commence à 42,5 kg.' });
    // Mêmes sources que le filtre : dossier, résultats du fil, puis ceux de la tentative jusque-là.
    expect(search.seen[0]?.allowedMass).toEqual(['30', '70']);
    expect(reader.seen[0]?.allowedMass).toEqual(['30', '42.5', '70']);
  });

  it('exception d’un gestionnaire : failed internal, aucun tool_result envoyé, rien du contenu au journal', async () => {
    const lines: string[] = [];
    const broken = fakeTool('read_training', () => {
      throw new Error('CANARI-ERREUR');
    });
    const { fake, run } = await setup({
      chat: [fakeToolUse('toolu_1', 'read_training', { query: 'CANARI-ENTREE' }), fakeText('Jamais.')],
      tools: [broken.tool],
      lines,
    });
    expect(await run()).toEqual({
      kind: 'failed',
      code: 'internal',
      cause: null,
      toolRounds: 0,
      calls: [record({ stopReason: 'tool_use' })],
    });
    expect(fake.chatCalls).toHaveLength(1);
    expect(lines.join('\n')).not.toMatch(/CANARI/);
    expect(lines.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({ msg: 'coach_tool_failed', code: 'read_training', event: 'Error' }),
    );
  });

  it('repli en cours de sortie : un tool_use avant le dernier fallback n’est jamais exécuté', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const search = fakeTool('search_exercises', ok({ total_matching: 0 }));
    const blocks = [
      { type: 'thinking', thinking: 'Je lis.', signature: 'sig' },
      toolUse('toolu_a', 'read_training'),
      fallback(MODEL, 'claude-opus-5'),
      toolUse('toolu_b', 'search_exercises'),
    ];
    const { fake, events, run } = await setup({
      chat: [turn(blocks, 'tool_use', { model: 'claude-opus-5' }), fakeText('Voilà.')],
      tools: [reader.tool, search.tool],
    });
    const outcome = await run();
    expect(reader.run).not.toHaveBeenCalled();
    expect(search.run).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'tool_running')).toEqual([
      { type: 'tool_running', tool: 'search_exercises' },
    ]);
    // Tour stocké tel que reçu ; renvoyé à l'API sans la réflexion ni l'appel d'avant le repli (`historyForApi`).
    expect(outcome.kind).toBe('answered');
    expect(outcome.kind === 'answered' && outcome.turns[0]).toEqual({ role: 'assistant', blocks });
    expect(fake.chatCalls[1]?.messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: [fallback(MODEL, 'claude-opus-5'), toolUse('toolu_b', 'search_exercises')],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: '{"total_matching":0}' }],
      },
    ]);
  });

  it('tool_use sans aucun appel exécutable (tous avant le repli) → failed internal', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const blocks = [toolUse('toolu_a', 'read_training'), fallback(MODEL, 'claude-opus-5'), text('Je')];
    const { run } = await setup({ chat: [turn(blocks, 'tool_use')], tools: [reader.tool] });
    expect(await run()).toMatchObject({ kind: 'failed', code: 'internal', cause: null, toolRounds: 0 });
    expect(reader.run).not.toHaveBeenCalled();
  });
});

describe('runAttempt : cartes', () => {
  it('help_card quand refer_to_help réussit, une seule fois par ressource', async () => {
    const { events, toolCtx, run } = await setup({
      chat: [
        turn(
          [
            toolUse('toolu_a', 'refer_to_help', { resource: 'pain' }),
            toolUse('toolu_b', 'refer_to_help', { resource: 'pain' }),
            toolUse('toolu_c', 'refer_to_help', { resource: 'sos' }),
            toolUse('toolu_d', 'refer_to_help', { resource: 'distress' }),
          ],
          'tool_use',
        ),
        fakeText('Prends soin de toi.'),
      ],
    });
    expect(await run()).toMatchObject({ kind: 'answered' });
    expect(events.filter((e) => e.type !== 'text')).toEqual([
      { type: 'tool_running', tool: 'refer_to_help' },
      { type: 'help_card', resource: 'pain' },
      { type: 'tool_running', tool: 'refer_to_help' },
      { type: 'tool_running', tool: 'refer_to_help' },
      { type: 'tool_running', tool: 'refer_to_help' },
      { type: 'help_card', resource: 'distress' },
    ]);
    expect(toolCtx.state.helpCards).toEqual(['pain', 'distress']);
  });

  const PROPOSAL_ID = '019a5e00-0000-7000-8000-000000000001';
  const pending = (): PendingProposal => ({
    id: PROPOSAL_ID,
    instanceId: 'instance-1',
    baseRevision: 3,
    operations: [{ op: 'start_deload' }],
    reason: 'Ta récupération compte.',
    model: null,
    expiresAt: null,
  });
  const proposer = () =>
    fakeTool('propose_program_change', (_input, ctx) => {
      ctx.state.proposals.push(pending());
      return ok({ ok: true, change_id: 'P-1', expires_in_days: 7 });
    });

  it.each([
    [true, 'Ta récupération compte.'],
    [false, null],
  ])(
    'proposal quand l’outil réussit (accord santé %s) : id de la proposition, modèle de l’itération',
    async (healthConsent, reason) => {
      const propose = proposer();
      const { fake, events, toolCtx, run } = await setup({
        chat: [
          turn([fallback(MODEL, 'claude-opus-5'), toolUse('toolu_1', 'propose_program_change')], 'tool_use', {
            model: 'claude-opus-5',
          }),
          fakeText('Je te propose une semaine plus légère.'),
        ],
        tools: [propose.tool],
        healthConsent,
      });
      expect(await run()).toMatchObject({ kind: 'answered' });
      expect(events.filter((e) => e.type === 'proposal')).toEqual([
        {
          type: 'proposal',
          id: PROPOSAL_ID,
          baseRevision: 3,
          operations: [{ op: 'start_deload' }],
          reasonCode: 'COACH_PROPOSAL',
          reason,
          expiresAt: new Date(NOW + 7 * DAY_MS).toISOString(),
        },
      ]);
      // La tentative pose la fin de validité sur la proposition : la même que l'événement, que l'échange écrit.
      expect(toolCtx.state.proposals).toEqual([
        { ...pending(), model: 'claude-opus-5', expiresAt: new Date(NOW + 7 * DAY_MS).toISOString() },
      ]);
      // L'identifiant de la proposition ne part jamais au modèle.
      expect(JSON.stringify(fake.chatCalls.map((c) => c.messages))).not.toContain(PROPOSAL_ID);
    },
  );

  it('proposition refusée par l’outil : aucun événement proposal', async () => {
    const refused = fakeTool('propose_program_change', { isError: true, result: { errors: [] } });
    const { events, run } = await setup({
      chat: [fakeToolUse('toolu_1', 'propose_program_change', {}), fakeText('Je n’ai pas pu.')],
      tools: [refused.tool],
    });
    expect(await run()).toMatchObject({ kind: 'answered' });
    expect(events.map((e) => e.type)).toEqual(['tool_running', 'text']);
  });
});

describe('runAttempt : fins', () => {
  it('max_tokens avec tool_use inachevé : bloc retiré, outil non exécuté, truncated', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { events, run } = await setup({
      chat: [
        // Entrée coupée en cours d'écriture : le SDK n'en rend que le début lisible.
        turn([text('Je regarde ton historique.'), toolUse('toolu_1', 'read_training', {})], 'max_tokens'),
      ],
      tools: [reader.tool],
    });
    expect(await run()).toMatchObject({
      kind: 'answered',
      text: 'Je regarde ton historique.',
      turns: [{ role: 'assistant', blocks: [text('Je regarde ton historique.')] }],
      truncated: true,
      stopReason: 'max_tokens',
      toolRounds: 0,
    });
    expect(reader.run).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['text']);
  });

  it('max_tokens sans outil : texte gardé, truncated', async () => {
    const { run } = await setup({
      chat: [fakeText('Garde ta charge. Ensuite, ajoute une répétition et', { stopReason: 'max_tokens' })],
    });
    expect(await run()).toMatchObject({
      kind: 'answered',
      text: 'Garde ta charge. Ensuite, ajoute une répétition et',
      truncated: true,
      stopReason: 'max_tokens',
    });
  });

  it('max_tokens sans aucun texte relayé → failed empty', async () => {
    const { run } = await setup({
      chat: [turn([{ type: 'thinking', thinking: 'Je réfléchis…', signature: 'sig' }], 'max_tokens')],
    });
    expect(await run()).toEqual({
      kind: 'failed',
      code: 'empty',
      cause: null,
      toolRounds: 0,
      calls: [record({ stopReason: 'max_tokens' })],
    });
  });

  it('réponse vide (Review Focus 5) : end_turn sans texte après un outil → failed empty', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { run } = await setup({
      chat: [fakeToolUse('toolu_1', 'read_training', {}), turn([], 'end_turn')],
      tools: [reader.tool],
    });
    expect(await run()).toMatchObject({ kind: 'failed', code: 'empty', cause: null, toolRounds: 1 });
  });

  it('réponse finale sans texte après un texte relayé avant l’outil → failed empty', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { run } = await setup({
      chat: [
        turn([text('Je regarde.'), toolUse('toolu_1', 'read_training')], 'tool_use'),
        turn([{ type: 'thinking', thinking: 'Fini.', signature: 'sig' }], 'end_turn'),
      ],
      tools: [reader.tool],
    });
    expect(await run()).toMatchObject({ kind: 'failed', code: 'empty', toolRounds: 1 });
  });

  it('refus pendant le flux → refused avec la catégorie, sans vider le tampon', async () => {
    const scripted = fakeText('Bien sûr. Je vais');
    const { events, run } = await setup({
      chat: [
        {
          ...scripted,
          final: {
            blocks: [text('Bien sûr. Je vais')],
            stopReason: 'refusal',
            stopDetails: { category: 'cyber', explanation: null, recommendedModel: null },
          },
        },
      ],
    });
    expect(await run()).toEqual({
      kind: 'refused',
      category: 'cyber',
      calls: [record({ stopReason: 'refusal', refusalCategory: 'cyber' })],
    });
    expect(texts(events)).toEqual(['Bien sûr. ']);
  });

  it.each(['pause_turn', 'model_context_window_exceeded', 'stop_sequence'])(
    '%s → failed internal',
    async (stop) => {
      const { run } = await setup({ chat: [fakeText('Bonjour.', { stopReason: stop })] });
      expect(await run()).toEqual({
        kind: 'failed',
        code: 'internal',
        cause: null,
        toolRounds: 0,
        calls: [record({ stopReason: stop })],
      });
    },
  );
});

describe('runAttempt : replis et coûts', () => {
  it('repli : fallbackUsed, effectiveModel = modèle de la réponse, coût par itération', async () => {
    const first = { input_tokens: 3000, output_tokens: 20 };
    const second = { input_tokens: 3100, output_tokens: 60 };
    const scripted = fakeFallbackText('Garde ta charge.', MODEL, 'claude-opus-5');
    if (!('final' in scripted)) throw new Error('tour attendu');
    const iterations = [
      { type: 'message', model: MODEL, usage: first },
      { type: 'fallback_message', model: 'claude-opus-5', usage: second },
    ];
    const { run } = await setup({
      chat: [{ ...scripted, final: { ...scripted.final, usage: second, iterations } }],
    });
    const outcome = await run();
    const cost = costUsd(MODEL, first) + costUsd('claude-opus-5', second);
    expect(outcome).toMatchObject({
      kind: 'answered',
      effectiveModel: 'claude-opus-5',
      // Jetons sommés sur les essais, comme le coût.
      calls: [
        record({
          model: 'claude-opus-5',
          usage: {
            input_tokens: 6100,
            output_tokens: 80,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          fallbackUsed: true,
          costUsd: cost,
        }),
      ],
    });
    expect(cost).toBeGreaterThan(costUsd('claude-opus-5', second));
  });

  it('bloc de texte sans ponctuation finale suivi d’un repli : la phrase part à la fin du bloc, pas collée à la suivante', async () => {
    const { events, run } = await setup({
      chat: [
        turn(
          [text('Garde ton rythme'), fallback(MODEL, 'claude-opus-5'), text('Fais trois séries.')],
          'end_turn',
          {
            fallbackUsed: true,
          },
        ),
      ],
    });
    expect(await run()).toMatchObject({ kind: 'answered', text: 'Garde ton rythmeFais trois séries.' });
    expect(texts(events)).toEqual(['Garde ton rythme', 'Fais trois séries.']);
  });

  it('fallbackUsed lu sur AiChatFinal (tâche 12), jamais recalculé ici', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { run } = await setup({
      chat: [
        fakeToolUse('toolu_1', 'read_training', {}, { fallbackUsed: true }),
        turn([fallback(MODEL, 'claude-opus-5'), text('Oui.')], 'end_turn', { fallbackUsed: false }),
      ],
      tools: [reader.tool],
    });
    const outcome = await run();
    expect((outcome as { calls: CallRecord[] }).calls.map((c) => c.fallbackUsed)).toEqual([true, false]);
  });

  it('budget : canCall reçoit le coût des appels de la tentative, faux au 2e → monthly_budget_reached', async () => {
    const canCall = vi.fn(async (spent: number) => spent === 0);
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { fake, run } = await setup({
      chat: [fakeToolUse('toolu_1', 'read_training', {}, { costUsd: 0.05 }), fakeText('Jamais.')],
      tools: [reader.tool],
      canCall,
    });
    expect(await run()).toEqual({
      kind: 'failed',
      code: 'monthly_budget_reached',
      cause: null,
      toolRounds: 1,
      calls: [record({ stopReason: 'tool_use', costUsd: 0.05 })],
    });
    expect(canCall.mock.calls).toEqual([[0], [0.05]]);
    expect(fake.chatCalls).toHaveLength(1);
  });

  it('requête d’un fil mineur : fallbacks null à chaque appel, ni fallbacks ni bêta de repli', async () => {
    const reader = fakeTool('read_training', ok({ sessions: [] }));
    const { fake, run } = await setup({
      chat: [fakeToolUse('toolu_1', 'read_training', {}), fakeText('Bonne séance.')],
      tools: [reader.tool],
      audience: 'minor',
    });
    expect(await run()).toMatchObject({ kind: 'answered' });
    expect(fake.chatCalls.map((c) => c.fallbacks)).toEqual([null, null]);
    for (const params of fake.chatParams) {
      expect(params.body).not.toHaveProperty('fallbacks');
      expect(params.betas.some((b) => b.startsWith('server-side-fallback'))).toBe(false);
    }
  });
});

describe('runAttempt : erreurs', () => {
  const cases: [string, AiErrorCode, string][] = [
    ['429', 'rate_limited', 'api_unavailable'],
    ['529', 'overloaded', 'api_unavailable'],
    ['5xx', 'server', 'api_unavailable'],
    ['réseau', 'network', 'api_unavailable'],
    ['limite de dépense', 'spend_limit', 'spend_limit'],
    ['délai de l’appel', 'timeout', 'timeout'],
    ['400', 'bad_request', 'internal'],
    ['401', 'auth', 'api_unavailable'],
    ['non reconnue', 'api', 'internal'],
    ['autre code', 'invalid_json', 'internal'],
  ];
  it.each(cases)(
    '%s (%s) → failed %s, cause = code de l’AiError, coût compté',
    async (_n, code, expected) => {
      const { run } = await setup({ chat: [{ error: new AiError(code, 'Échec.', { costUsd: 0.002 }) }] });
      expect(await run()).toEqual({
        kind: 'failed',
        code: expected,
        cause: code,
        toolRounds: 0,
        calls: [record({ stopReason: null, costUsd: 0.002 })],
      });
    },
  );

  it.each(['shutdown', 'consent_withdrawn', 'timeout'] as const)(
    'signal aborté %s pendant l’appel → failed de sa raison, coût de l’appel compté',
    async (reason) => {
      const controller = new AbortController();
      const { fake, run } = await setup({
        chat: [{ ...fakeText('Bonjour.', { gate: new Promise<void>(() => {}) }), abortCostUsd: 0.003 }],
        signal: controller.signal,
      });
      const pending = run();
      await vi.waitFor(() => expect(fake.chatCalls).toHaveLength(1));
      controller.abort(reason);
      expect(await pending).toEqual({
        kind: 'failed',
        code: reason,
        cause: 'aborted',
        toolRounds: 0,
        calls: [record({ stopReason: null, costUsd: 0.003 })],
      });
    },
  );

  it('signal déjà aborté → failed de sa raison, sans appel', async () => {
    const controller = new AbortController();
    controller.abort('shutdown');
    const { fake, run } = await setup({ chat: [fakeText('Jamais.')], signal: controller.signal });
    expect(await run()).toEqual({ kind: 'failed', code: 'shutdown', cause: null, toolRounds: 0, calls: [] });
    expect(fake.chatCalls).toEqual([]);
  });

  it('accord retiré pendant un outil → failed consent_withdrawn avant l’appel suivant', async () => {
    const controller = new AbortController();
    const reader = fakeTool('read_training', () => {
      controller.abort('consent_withdrawn');
      return ok({ sessions: [] });
    });
    const { fake, run } = await setup({
      chat: [fakeToolUse('toolu_1', 'read_training', {}), fakeText('Jamais.')],
      tools: [reader.tool],
      signal: controller.signal,
    });
    expect(await run()).toMatchObject({
      kind: 'failed',
      code: 'consent_withdrawn',
      cause: null,
      toolRounds: 1,
    });
    expect(fake.chatCalls).toHaveLength(1);
  });

  it('raison d’abandon hors des codes du flux → internal', async () => {
    const controller = new AbortController();
    controller.abort();
    const { run } = await setup({ chat: [fakeText('Jamais.')], signal: controller.signal });
    expect(await run()).toMatchObject({ kind: 'failed', code: 'internal', cause: null });
  });
});
