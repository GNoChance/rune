import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AiChatEvent, AiError, fakeRefusal, fakeText, fakeToolUse } from '../../src/ai';
import { withdrawCoachConsent } from '../../src/coach/consent';
import { prepareExchange } from '../../src/coach/orchestrator';
import { REFUSAL_MESSAGE, regenerationNote, STANDARD_REPLY } from '../../src/coach/prompts';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/*
 * Échange du coach (spec brique 4 §7.3, §8) : garde avant le flux, une régénération au plus, enregistrement,
 * plafonds, interruptions. Faux client scripté ; chaque événement est relu par le schéma du flux.
 */

const REASON = 'Un repos plus court garde ta séance dans ton temps.';
const BLOCKED = 'Voici ta charge : 200 kg.';
const FINE = 'Garde ton rythme actuel.';
const REST = { op: 'set_rest', slot: 'A1', seconds: 90 };
const PROPOSE = { base_revision: 0, operations: [REST], reason: REASON };

let kit: ExchangeKit;
afterEach(() => {
  vi.useRealTimers();
  kit?.ctx.close();
});

const messages = () => kit.rows('SELECT seq, role, display_text, blocks FROM coach_message ORDER BY seq');
const calls = () => kit.rows('SELECT * FROM coach_call');
const counters = () => kit.rows('SELECT kind, count FROM coach_safety_counter ORDER BY kind');
const types = (events: { type: string }[]) => events.map((e) => e.type);
const lastEvent = (events: { type: string }[]) => events.at(-1);

/** Attend que le faux client ait reçu `n` appels (l'échange est alors suspendu sur son `gate`). */
const untilCalls = (n: number) =>
  vi.waitFor(() => expect(kit.fake.chatCalls.length).toBeGreaterThanOrEqual(n));

/** Tour de texte retenu par `gate` jusqu'à `release()`. */
function gated(text = FINE) {
  const gate = Promise.withResolvers<void>();
  return { turn: fakeText(text, { gate: gate.promise }), release: () => gate.resolve() };
}

const textBlock = (m: { content: { type: string; text?: unknown }[] }) => m.content[0]?.text;

describe('régénération', () => {
  it('réussie : 2e appel avec le message system en dernier, retry, message system enregistré, filter_block', async () => {
    kit = await exchangeKit({
      chat: [fakeText(BLOCKED, { costUsd: 0.01 }), fakeText(FINE, { costUsd: 0.02 })],
    });
    const { events, x } = await kit.ask('Comment était ma séance ?');

    const [first, second] = kit.fake.chatCalls;
    expect(first?.messages.map((m) => m.role)).toEqual(['user']);
    expect(second?.messages.map((m) => m.role)).toEqual(['user', 'system']);
    expect(second?.messages.at(-2)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Comment était ma séance ?' }],
    });
    expect(textBlock(second?.messages.at(-1) ?? { content: [] })).toBe(regenerationNote('unit'));
    expect(types(events)).toEqual(['retry', 'text', 'done']);
    expect(events[0]).toEqual({ type: 'retry', reason: 'filter' });
    expect(messages().map((m) => [m.role, m.display_text])).toEqual([
      ['user', 'Comment était ma séance ?'],
      ['system', null],
      ['assistant', FINE],
    ]);
    expect(JSON.parse(messages()[1]?.blocks as string)).toEqual([
      { type: 'text', text: regenerationNote('unit') },
    ]);
    expect(calls()).toEqual([
      expect.objectContaining({ filter_blocks: 1, api_calls: 2, counted: 1, cost_usd_micros: 30_000 }),
    ]);
    expect(counters()).toEqual([{ kind: 'filter_block', count: 1 }]);
    expect(lastEvent(events)).toMatchObject({ type: 'done', replaced: false, userSeq: 1, assistantSeq: 3 });
    expect(x.thread.audience).toBe('adult');
  });

  it('proposition de la tentative bloquée : ni événement, ni ligne ; la 2e tentative repart de zéro', async () => {
    kit = await exchangeKit({
      program: true,
      chat: [fakeToolUse('t1', 'propose_program_change', PROPOSE), fakeText(BLOCKED), fakeText(FINE)],
    });
    const { events } = await kit.ask();

    expect(types(events)).toEqual(['tool_running', 'retry', 'text', 'done']);
    expect(kit.rows('SELECT id FROM instance_change')).toEqual([]);
    expect(lastEvent(events)).toMatchObject({ type: 'done', proposalIds: [] });
    // La régénération ne voit pas le tour d'outils de la tentative abandonnée.
    expect(kit.fake.chatCalls[2]?.messages.map((m) => m.role)).toEqual(['user', 'system']);
  });

  it('double blocage : réponse type enregistrée (un bloc texte, replaced, liens), done.replaced, filter_blocks 2', async () => {
    kit = await exchangeKit({ chat: [fakeText(BLOCKED), fakeText(BLOCKED)] });
    const { events } = await kit.ask();

    expect(kit.fake.chatCalls).toHaveLength(2);
    expect(types(events)).toEqual(['retry', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'text', text: STANDARD_REPLY });
    expect(lastEvent(events)).toMatchObject({
      type: 'done',
      replaced: true,
      assistantSeq: 3,
      proposalIds: [],
    });
    const reply = kit.rows('SELECT * FROM coach_message WHERE seq = 3')[0];
    expect(JSON.parse(reply?.blocks as string)).toEqual([{ type: 'text', text: STANDARD_REPLY }]);
    expect(reply).toMatchObject({ display_text: STANDARD_REPLY, role: 'assistant' });
    expect(JSON.parse(reply?.display_extras as string)).toEqual({
      helpCards: [],
      proposalIds: [],
      links: ['program', 'coach_help'],
      replaced: true,
    });
    expect(calls()).toEqual([expect.objectContaining({ filter_blocks: 2, counted: 1 })]);
    expect(counters()).toEqual([{ kind: 'filter_block', count: 2 }]);
    expect(kit.rows('SELECT user_message_count FROM coach_thread')).toEqual([{ user_message_count: 1 }]);
  });

  it('budget : canCall de la 2e tentative reçoit le coût de la 1re (budget 0,02 $ < 0,03 $ dépensé)', async () => {
    kit = await exchangeKit({
      chat: [fakeText(BLOCKED, { costUsd: 0.03 }), fakeText(FINE)],
      coachConfig: (c) => ({ ...c, limits: { ...c.limits, personMonthlyBudgetUsd: 0.02 } }),
    });
    const { events } = await kit.ask();

    expect(kit.fake.chatCalls).toHaveLength(1);
    expect(types(events)).toEqual(['retry', 'error']);
    expect(lastEvent(events)).toEqual({ type: 'error', code: 'monthly_budget_reached' });
    expect(messages()).toEqual([]);
    expect(calls()).toEqual([
      expect.objectContaining({
        filter_blocks: 1,
        error_code: 'monthly_budget_reached',
        cost_usd_micros: 30_000,
        counted: 1,
      }),
    ]);
  });
});

describe('proposition', () => {
  it('proposal puis done.proposalIds ; même expiresAt que la ligne ; précédente du coach expirée, celle du moteur intacte', async () => {
    kit = await exchangeKit({
      program: true,
      chat: [
        fakeToolUse('t1', 'propose_program_change', PROPOSE),
        fakeText('Je te propose un repos plus court.'),
      ],
    });
    const { ctx, user, instanceId } = kit;
    const row = (author: 'engine' | 'coach') =>
      ctx.deps.sqlite
        .prepare(
          `INSERT INTO instance_change (id, owner_id, instance_id, base_revision, author, operations, reason_code, status,
            expires_at, created_at, rev, updated_at) VALUES (?, ?, ?, 0, ?, '[{"op":"start_deload"}]', ?, 'proposed',
            '2026-11-09T10:00:00.000Z', '2026-11-04T10:00:00.000Z', 1, '2026-11-04T10:00:00.000Z')`,
        )
        .run(
          ctx.deps.ids.uuidv7(),
          user.id,
          instanceId ?? '',
          author,
          author === 'coach' ? 'COACH_PROPOSAL' : 'ENGINE_REACTIVE_DELOAD',
        );
    row('engine');
    row('coach');

    const { events } = await kit.ask();

    expect(types(events)).toEqual(['tool_running', 'text', 'proposal', 'done']);
    const proposal = events.find((e) => e.type === 'proposal');
    const id = proposal?.type === 'proposal' ? proposal.id : '';
    expect(id).not.toBe('');
    expect(lastEvent(events)).toMatchObject({ type: 'done', proposalIds: [id] });
    const written = kit.rows('SELECT * FROM instance_change WHERE id = ?', id);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      author: 'coach',
      status: 'proposed',
      reason: REASON,
      ai_generated: 1,
      ai_model: 'claude-opus-5-5',
      prompt_version: 'coach-1/adult',
      expires_at: proposal?.type === 'proposal' ? proposal.expiresAt : null,
    });
    expect(proposal).toMatchObject({ reasonCode: 'COACH_PROPOSAL', reason: REASON, baseRevision: 0 });
    expect(kit.rows('SELECT author, status FROM instance_change WHERE id <> ? ORDER BY author', id)).toEqual([
      { author: 'coach', status: 'expired' },
      { author: 'engine', status: 'proposed' },
    ]);
  });

  it("sans accord santé : motif nul dans l'événement et dans la ligne", async () => {
    kit = await exchangeKit({
      program: true,
      health: false,
      chat: [
        fakeToolUse('t1', 'propose_program_change', PROPOSE),
        fakeText('Je te propose un repos plus court.'),
      ],
    });
    const { events } = await kit.ask();
    expect(events.find((e) => e.type === 'proposal')).toMatchObject({ reason: null });
    expect(kit.rows('SELECT reason FROM instance_change')).toEqual([{ reason: null }]);
  });
});

describe('refus', () => {
  it('avant le flux : aucun message, refusal_category, counted 1, compteur refusal, refused', async () => {
    kit = await exchangeKit({ chat: [fakeRefusal('cyber')] });
    const { events } = await kit.ask();

    expect(events).toEqual([{ type: 'refused', message: REFUSAL_MESSAGE }]);
    expect(messages()).toEqual([]);
    expect(calls()).toEqual([
      expect.objectContaining({
        stop_reason: 'refusal',
        refusal_category: 'cyber',
        counted: 1,
        error_code: null,
      }),
    ]);
    expect(counters()).toEqual([{ kind: 'refusal', count: 1 }]);
    expect(kit.rows('SELECT user_message_count FROM coach_thread')).toEqual([{ user_message_count: 0 }]);
  });

  it('pendant le flux : le texte déjà relayé n’est pas enregistré, même issue', async () => {
    const events: AiChatEvent[] = [
      { type: 'block_start', index: 0, block: 'text' },
      { type: 'text_delta', text: 'Un début de phrase. Et la suite' },
      { type: 'block_stop', index: 0 },
    ];
    kit = await exchangeKit({
      chat: [
        {
          events,
          final: {
            blocks: [],
            stopReason: 'refusal',
            stopDetails: { category: 'bio', explanation: null, recommendedModel: null },
          },
        },
      ],
    });
    const asked = await kit.ask();

    expect(types(asked.events)).toEqual(['text', 'refused']);
    expect(messages()).toEqual([]);
    expect(calls()).toEqual([expect.objectContaining({ refusal_category: 'bio', counted: 1 })]);
    expect(counters()).toEqual([{ kind: 'refusal', count: 1 }]);
  });

  it('fil mineur : un seul appel, ni fallbacks ni autre modèle, fallback_used 0', async () => {
    kit = await exchangeKit({ birthDate: '2010-06-01', chat: [fakeRefusal(null)] });
    const { events } = await kit.ask();

    expect(kit.fake.chatCalls).toHaveLength(1);
    expect(kit.fake.chatParams[0]?.body).not.toHaveProperty('fallbacks');
    expect(kit.fake.chatCalls[0]?.fallbacks).toBeNull();
    expect(events).toEqual([{ type: 'refused', message: REFUSAL_MESSAGE }]);
    expect(calls()).toEqual([
      expect.objectContaining({ fallback_used: 0, refusal_category: null, counted: 1 }),
    ]);
  });
});

describe('plafonds', () => {
  it('limite de dépense : suspended_until au 1er du mois à minuit de Paris, coach_suspended, spend_limit, counted 0', async () => {
    kit = await exchangeKit({ chat: [{ error: new AiError('spend_limit', 'Limite atteinte.') }] });
    const { events } = await kit.ask();

    expect(lastEvent(events)).toEqual({ type: 'error', code: 'spend_limit' });
    expect(kit.rows('SELECT suspended_until FROM coach_state')).toEqual([
      { suspended_until: '2026-11-30T23:00:00.000Z' },
    ]);
    expect(kit.rows("SELECT type, outcome FROM security_event WHERE type = 'coach_suspended'")).toEqual([
      { type: 'coach_suspended', outcome: 'success' },
    ]);
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'spend_limit', counted: 0 })]);
    expect(messages()).toEqual([]);
    // Coupé pour tous : la garde du message suivant refuse.
    await expect(kit.ask()).rejects.toMatchObject({
      code: 'coach_unavailable',
      extra: { reason: 'suspended' },
    });
  });

  it('budget atteint avant un tour : monthly_budget_reached, seule la ligne coach_call', async () => {
    kit = await exchangeKit({
      chat: [fakeToolUse('t1', 'refer_to_help', { resource: 'pain' }, { costUsd: 0.06 }), fakeText(FINE)],
      coachConfig: (c) => ({ ...c, limits: { ...c.limits, personMonthlyBudgetUsd: 0.05 } }),
    });
    const { events } = await kit.ask();

    expect(lastEvent(events)).toEqual({ type: 'error', code: 'monthly_budget_reached' });
    expect(kit.fake.chatCalls).toHaveLength(1);
    expect(messages()).toEqual([]);
    expect(calls()).toEqual([
      expect.objectContaining({
        error_code: 'monthly_budget_reached',
        cost_usd_micros: 60_000,
        tool_rounds: 1,
      }),
    ]);
    expect(counters()).toEqual([]);
  });

  it('429 après les essais du SDK : api_unavailable, counted 0', async () => {
    kit = await exchangeKit({ chat: [{ error: new AiError('rate_limited', 'Trop de demandes.') }] });
    const { events } = await kit.ask();
    expect(lastEvent(events)).toEqual({ type: 'error', code: 'api_unavailable' });
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'api_unavailable', counted: 0 })]);
    expect(messages()).toEqual([]);
  });

  it('limite du jour : 409/429 de la garde avant le flux, sans appel', async () => {
    kit = await exchangeKit({ chat: [] });
    for (let i = 0; i < 30; i++) {
      kit.ctx.deps.sqlite
        .prepare(
          `INSERT INTO coach_call (id, user_id, day, created_at, requested_model, counted) VALUES (?, ?, '2026-11-05', '2026-11-05T09:00:00.000Z', 'm', 1)`,
        )
        .run(kit.ctx.deps.ids.uuidv7(), kit.user.id);
    }
    await expect(kit.ask()).rejects.toMatchObject({ code: 'daily_limit_reached', status: 429 });
    expect(kit.fake.chatCalls).toHaveLength(0);
  });
});

describe('interruptions', () => {
  it("retrait de l'accord pendant l'échange (abortFor) : consent_withdrawn, rien d'enregistré", async () => {
    const { turn, release } = gated();
    kit = await exchangeKit({ chat: [turn] });
    const { ctx, user } = kit;
    const run = await kit.begin();
    await untilCalls(1);
    await ctx.deps.db
      .transaction()
      .execute((trx) => withdrawCoachConsent(trx, ctx.deps, user.id, { actorId: user.id, ip: null }));
    ctx.deps.coach.exchanges.abortFor(user.id, 'consent_withdrawn');
    release();
    await run.finished;

    expect(lastEvent(run.events)).toEqual({ type: 'error', code: 'consent_withdrawn' });
    expect(messages()).toEqual([]);
    expect(kit.rows('SELECT thread_id, error_code FROM coach_call')).toEqual([
      { thread_id: null, error_code: 'consent_withdrawn' },
    ]);
    expect(ctx.deps.coach.exchanges.inProgress(user.id)).toBe(false);
  });

  it("retrait de l'accord pendant le flux, sans abort : la transaction relit l'accord, rien dans le fil", async () => {
    const { turn, release } = gated();
    kit = await exchangeKit({ chat: [turn] });
    const { ctx, user } = kit;
    const run = await kit.begin();
    await untilCalls(1);
    // Retrait sans fil supprimé : seul l'événement `withdraw` change.
    ctx.deps.sqlite
      .prepare(
        `INSERT INTO consent_event (id, owner_id, type, action, text_version, created_at, rev, updated_at)
         VALUES (?, ?, 'ai_coach', 'withdraw', '1.0', '2026-11-05T10:00:01.000Z', 999, '2026-11-05T10:00:01.000Z')`,
      )
      .run(ctx.deps.ids.uuidv7(), user.id);
    release();
    await run.finished;

    expect(lastEvent(run.events)).toEqual({ type: 'error', code: 'consent_withdrawn' });
    expect(messages()).toEqual([]);
    expect(kit.rows('SELECT user_message_count FROM coach_thread')).toEqual([{ user_message_count: 0 }]);
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'consent_withdrawn', counted: 1 })]);
  });

  it('fil clos pendant le flux : thread_closed, rien dans le fil', async () => {
    const { turn, release } = gated();
    kit = await exchangeKit({ chat: [turn] });
    const run = await kit.begin();
    await untilCalls(1);
    kit.ctx.deps.sqlite.exec("UPDATE coach_thread SET is_open = 0, closed_reason = 'health_withdrawn'");
    release();
    await run.finished;

    expect(lastEvent(run.events)).toEqual({ type: 'error', code: 'thread_closed' });
    expect(messages()).toEqual([]);
  });

  it("retrait juste après begin : l'accord relu refuse, aucun appel chez Anthropic, bail libéré", async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const { ctx, user } = kit;
    const registry = ctx.deps.coach.exchanges;
    const realBegin = registry.begin.bind(registry);
    let withdrawal: Promise<void> | undefined;
    registry.begin = (userId) => {
      const lease = realBegin(userId);
      withdrawal = ctx.deps.db
        .transaction()
        .execute((trx) => withdrawCoachConsent(trx, ctx.deps, user.id, { actorId: user.id, ip: null }));
      return lease;
    };

    await expect(kit.ask()).rejects.toMatchObject({ code: 'consent_required', status: 403 });
    await withdrawal;
    expect(kit.fake.chatCalls).toHaveLength(0);
    expect(registry.inProgress(user.id)).toBe(false);
    expect(kit.rows('SELECT id FROM coach_thread')).toEqual([]);
  });

  it('abortAll(shutdown) : error shutdown, coach_call écrite en moins de 2 s', async () => {
    const { turn } = gated();
    kit = await exchangeKit({ chat: [turn] });
    const { ctx } = kit;
    const run = await kit.begin();
    await untilCalls(1);
    const started = Date.now();
    await ctx.deps.coach.exchanges.abortAll('shutdown');

    expect(Date.now() - started).toBeLessThan(2000);
    expect(lastEvent(run.events)).toEqual({ type: 'error', code: 'shutdown' });
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'shutdown' })]);
    expect(messages()).toEqual([]);
    await run.finished;
  });

  it('délai de 180 000 ms : error timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { turn } = gated();
    kit = await exchangeKit({ chat: [turn] });
    const run = await kit.begin();
    await untilCalls(1);
    await vi.advanceTimersByTimeAsync(180_000);
    await run.finished;

    expect(lastEvent(run.events)).toEqual({ type: 'error', code: 'timeout' });
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'timeout' })]);
    expect(messages()).toEqual([]);
  });
});

describe('fins anormales', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
  ])('réponse vide (%s) : error internal, aucun message, counted 1', async (_name, stopReason) => {
    kit = await exchangeKit({ chat: [{ final: { blocks: [], stopReason } }] });
    const { events } = await kit.ask();
    expect(events).toEqual([{ type: 'error', code: 'internal' }]);
    expect(messages()).toEqual([]);
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'internal', counted: 1 })]);
  });

  it('réponse coupée (max_tokens avec du texte) : enregistrée, truncated', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE, { stopReason: 'max_tokens' })] });
    const { events } = await kit.ask();
    expect(lastEvent(events)).toMatchObject({ type: 'done', truncated: true });
    expect(kit.rows('SELECT truncated, stop_reason FROM coach_message WHERE seq = 2')).toEqual([
      { truncated: 1, stop_reason: 'max_tokens' },
    ]);
  });

  it('auth : api_unavailable et coach_api_auth_failed au journal de sécurité, sans contenu', async () => {
    kit = await exchangeKit({ chat: [{ error: new AiError('auth', 'Clé refusée.') }] });
    const { events } = await kit.ask('Un texte privé.');
    expect(events).toEqual([{ type: 'error', code: 'api_unavailable' }]);
    expect(
      kit.rows(
        "SELECT actor_id, target_id, outcome, details FROM security_event WHERE type = 'coach_api_auth_failed'",
      ),
    ).toEqual([{ actor_id: null, target_id: null, outcome: 'failure', details: null }]);
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'api_unavailable', counted: 0 })]);
  });

  it('bad_request : error internal et coach_api_error {code: bad_request} au journal technique', async () => {
    kit = await exchangeKit({ chat: [{ error: new AiError('bad_request', 'Requête invalide.') }] });
    const { events } = await kit.ask();
    expect(events).toEqual([{ type: 'error', code: 'internal' }]);
    const line = kit.lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'coach_api_error');
    expect(line).toMatchObject({ level: 'error', code: 'bad_request' });
  });

  it('cinq tours d’outils : tool_rounds_exceeded', async () => {
    kit = await exchangeKit({
      chat: (_req, call) => fakeToolUse(`t${call}`, 'refer_to_help', { resource: 'pain' }),
    });
    const { events } = await kit.ask();
    expect(lastEvent(events)).toEqual({ type: 'error', code: 'tool_rounds_exceeded' });
    expect(calls()).toEqual([expect.objectContaining({ tool_rounds: 4, api_calls: 5, counted: 1 })]);
    expect(messages()).toEqual([]);
  });
});

describe('contexte du fil', () => {
  it("valeur d'outil du fil : une charge rendue au 1er message est relayée au 2e ; contenu illisible ignoré", async () => {
    kit = await exchangeKit({ chat: [fakeText('Tu soulevais 62,5 kg.')] });
    const { ctx, user } = kit;
    const { openTodayThread } = await import('../../src/coach/threads');
    const thread = await openTodayThread(ctx.deps, user.id, ctx.clock.now());
    const message = (seq: number, role: string, blocks: unknown[], text: string | null) =>
      ctx.deps.sqlite
        .prepare(
          `INSERT INTO coach_message (id, thread_id, user_id, seq, role, blocks, display_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-11-05T09:00:00.000Z')`,
        )
        .run(ctx.deps.ids.uuidv7(), thread.id, user.id, seq, role, JSON.stringify(blocks), text);
    message(1, 'user', [{ type: 'text', text: 'Ma presse ?' }], 'Ma presse ?');
    message(
      2,
      'assistant',
      [{ type: 'tool_use', id: 'old1', name: 'read_training', input: { since_days: 7 } }],
      null,
    );
    message(
      3,
      'user',
      [
        {
          type: 'tool_result',
          tool_use_id: 'old1',
          content: JSON.stringify({ sets: [[62.5, 8, null, 'ok']] }),
        },
      ],
      null,
    );
    message(4, 'assistant', [{ type: 'text', text: 'Je regarde.' }], 'Je regarde.');
    message(5, 'user', [{ type: 'text', text: 'Et encore ?' }], 'Et encore ?');
    message(
      6,
      'assistant',
      [{ type: 'tool_use', id: 'old2', name: 'read_training', input: { since_days: 7 } }],
      null,
    );
    message(7, 'user', [{ type: 'tool_result', tool_use_id: 'old2', content: '{"illisible' }], null);
    message(8, 'assistant', [{ type: 'text', text: 'Rien de plus.' }], 'Rien de plus.');

    const { events } = await kit.ask('Rappelle-moi ma charge.');

    expect(types(events)).toEqual(['text', 'done']);
    expect(kit.fake.chatCalls).toHaveLength(1);
    expect(kit.fake.chatCalls[0]?.messages).toHaveLength(9);
  });

  it('sans ce résultat, la même phrase est bloquée (contrôle du test précédent)', async () => {
    kit = await exchangeKit({ chat: [fakeText('Tu soulevais 62,5 kg.'), fakeText(FINE)] });
    const { events } = await kit.ask();
    expect(types(events)).toEqual(['retry', 'text', 'done']);
  });

  it("minuit de Paris : l'échange commencé à 23:59:58 reste dans le fil et le jour de départ ; le suivant ouvre le nouveau jour", async () => {
    const { turn, release } = gated();
    kit = await exchangeKit({ now: '2026-11-05T22:59:58.000Z', chat: [turn, fakeText(FINE)] });
    const { ctx } = kit;
    const run = await kit.begin();
    await untilCalls(1);
    ctx.clock.advance(5000);
    release();
    await run.finished;

    expect(kit.rows('SELECT day, user_message_count FROM coach_thread')).toEqual([
      { day: '2026-11-05', user_message_count: 1 },
    ]);
    expect(messages()).toHaveLength(2);
    expect(kit.rows('SELECT day FROM coach_call')).toEqual([{ day: '2026-11-05' }]);

    await kit.ask('Bonjour.');
    expect(kit.rows('SELECT day, user_message_count FROM coach_thread ORDER BY day')).toEqual([
      { day: '2026-11-05', user_message_count: 1 },
      { day: '2026-11-06', user_message_count: 1 },
    ]);
  });
});

describe('garde avant le flux', () => {
  it('texte vide après nettoyage ou de plus de 2 000 caractères : 400 validation, aucun bail gardé', async () => {
    kit = await exchangeKit({ chat: [] });
    await expect(kit.ask('  ‮\u0007 ')).rejects.toMatchObject({ code: 'validation', status: 400 });
    await expect(kit.ask('a'.repeat(2001))).rejects.toMatchObject({ code: 'validation' });
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
    expect(kit.rows('SELECT id FROM coach_thread')).toEqual([]);
  });

  it('2 000 « 💪 » passent (points de code)', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const { events } = await kit.ask('💪'.repeat(2000));
    expect(lastEvent(events)).toMatchObject({ type: 'done' });
  });

  it('échange en cours : 409 request_in_progress ; begin nul malgré la garde : le même 409', async () => {
    const { turn, release } = gated();
    kit = await exchangeKit({ chat: [turn] });
    const run = await kit.begin();
    await untilCalls(1);
    await expect(kit.ask()).rejects.toMatchObject({ code: 'request_in_progress', status: 409 });
    release();
    await run.finished;

    // La garde passe (rien en cours), mais le bail est déjà pris au moment du begin.
    kit.ctx.deps.coach.exchanges.begin = () => null;
    await expect(kit.ask()).rejects.toMatchObject({ code: 'request_in_progress', status: 409 });
  });

  it('fil clos : 409 thread_closed {reason} ; gel contrôlé (version_change)', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask();
    kit.ctx.deps.sqlite.exec("UPDATE coach_thread SET is_open = 0, closed_reason = 'day_over'");
    await expect(kit.ask()).rejects.toMatchObject({ code: 'thread_closed', extra: { reason: 'day_over' } });

    kit.ctx.deps.sqlite.exec('UPDATE coach_thread SET is_open = 1, closed_reason = NULL');
    kit.ctx.deps.coachConfig = { ...kit.ctx.deps.coachConfig, toolsVersion: 'tools-2' };
    await expect(kit.ask()).rejects.toMatchObject({
      code: 'thread_closed',
      extra: { reason: 'version_change' },
    });
    expect(kit.rows('SELECT is_open, closed_reason FROM coach_thread')).toEqual([
      { is_open: 0, closed_reason: 'version_change' },
    ]);
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
  });

  it('clientMessageId déjà enregistré : 409 duplicate_message {seq}', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const id = '019a5e00-0000-7000-8000-0000000000d1';
    await kit.ask('Salut.', { clientMessageId: id });
    await expect(kit.ask('Salut.', { clientMessageId: id })).rejects.toMatchObject({
      code: 'duplicate_message',
      status: 409,
      extra: { seq: 1 },
    });
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
  });

  it('accord absent : 403 consent_required ; coach inactif : 503 coach_unavailable', async () => {
    kit = await exchangeKit({ chat: [] });
    kit.ctx.deps.sqlite.exec("DELETE FROM consent_event WHERE type = 'ai_coach'");
    await expect(kit.ask()).rejects.toMatchObject({ code: 'consent_required', status: 403 });
    kit.ctx.deps.sqlite.exec('UPDATE coach_state SET enabled = 0');
    await expect(kit.ask()).rejects.toMatchObject({
      code: 'coach_unavailable',
      status: 503,
      extra: { reason: 'disabled' },
    });
  });

  it('prepareExchange nettoie le texte et rend le bail, le jour et le fil', async () => {
    kit = await exchangeKit({ chat: [] });
    const x = await prepareExchange(
      kit.ctx.deps,
      kit.user.id,
      { clientMessageId: '019a5e00-0000-7000-8000-0000000000d2', text: '  Salut\r\ntoi‮  ' },
      kit.ctx.clock.now(),
    );
    expect(x).toMatchObject({
      userId: kit.user.id,
      text: 'Salut\ntoi',
      day: '2026-11-05',
      healthConsent: true,
    });
    expect(x.thread).toMatchObject({ day: '2026-11-05', isOpen: 1 });
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(true);
    x.lease.done();
  });
});

describe('correction 1 : preuves des décisions 1b et 6, et pannes après la validation', () => {
  const withdrawAiCoachSync = () =>
    kit.ctx.deps.sqlite
      .prepare(
        `INSERT INTO consent_event (id, owner_id, type, action, text_version, created_at, rev, updated_at)
         VALUES (?, ?, ?, 'withdraw', '1.0', '2026-11-05T10:00:01.000Z', 999, '2026-11-05T10:00:01.000Z')`,
      )
      .run(kit.ctx.deps.ids.uuidv7(), kit.user.id, 'ai_coach');

  it('1b avec un fil du jour déjà ouvert : retrait juste après begin, la garde relue refuse, aucun appel, bail libéré', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE), fakeText(FINE)] });
    await kit.ask('Premier message.');
    expect(kit.rows('SELECT id FROM coach_thread')).toHaveLength(1);
    const callsBefore = kit.fake.chatCalls.length;

    const registry = kit.ctx.deps.coach.exchanges;
    const realBegin = registry.begin.bind(registry);
    // Retrait synchrone dans le crochet : déterministe, sans transaction lancée sans `await`.
    registry.begin = (userId) => {
      const lease = realBegin(userId);
      withdrawAiCoachSync();
      return lease;
    };

    await expect(kit.ask('Second message.')).rejects.toMatchObject({ code: 'consent_required', status: 403 });
    expect(kit.fake.chatCalls).toHaveLength(callsBefore);
    expect(registry.inProgress(kit.user.id)).toBe(false);
    expect(messages()).toHaveLength(2);
  });

  it('1b avec un fil existant : coach coupé juste après begin, coach_unavailable, aucun appel, bail libéré', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE), fakeText(FINE)] });
    await kit.ask('Premier message.');
    const callsBefore = kit.fake.chatCalls.length;
    const registry = kit.ctx.deps.coach.exchanges;
    const realBegin = registry.begin.bind(registry);
    registry.begin = (userId) => {
      const lease = realBegin(userId);
      kit.ctx.deps.sqlite.exec('UPDATE coach_state SET enabled = 0');
      return lease;
    };
    await expect(kit.ask('Second message.')).rejects.toMatchObject({
      code: 'coach_unavailable',
      status: 503,
    });
    expect(kit.fake.chatCalls).toHaveLength(callsBefore);
    expect(registry.inProgress(kit.user.id)).toBe(false);
  });

  it("6 : accord santé retiré pendant le flux, l'événement suit l'accord relu à l'enregistrement : motif nul comme en base", async () => {
    const { turn, release } = gated('Je te propose un repos plus court.');
    kit = await exchangeKit({
      program: true,
      chat: [fakeToolUse('t1', 'propose_program_change', PROPOSE), turn],
    });
    const run = await kit.begin();
    await untilCalls(2);
    // Retrait santé sans fermer le fil : seul l'événement `withdraw` change.
    kit.ctx.deps.sqlite
      .prepare(
        `INSERT INTO consent_event (id, owner_id, type, action, text_version, created_at, rev, updated_at)
         VALUES (?, ?, 'health', 'withdraw', '1.0', '2026-11-05T10:00:01.000Z', 999, '2026-11-05T10:00:01.000Z')`,
      )
      .run(kit.ctx.deps.ids.uuidv7(), kit.user.id);
    release();
    await run.finished;

    expect(run.x.healthConsent).toBe(true);
    expect(run.events.find((e) => e.type === 'proposal')).toMatchObject({ reason: null });
    expect(lastEvent(run.events)).toMatchObject({ type: 'done' });
    expect(kit.rows('SELECT blocks FROM coach_message').every((r) => r.blocks === null)).toBe(true);
    expect(messages()).toHaveLength(4);
    expect(kit.rows('SELECT reason, status FROM instance_change')).toEqual([
      { reason: null, status: 'proposed' },
    ]);
  });

  it("carte d'aide d'une tentative bloquée : gardée (événement, compteur help_*, carte enregistrée), une fois", async () => {
    kit = await exchangeKit({
      chat: [
        fakeToolUse('t1', 'refer_to_help', { resource: 'pain' }),
        fakeText(BLOCKED),
        fakeToolUse('t2', 'refer_to_help', { resource: 'pain' }),
        fakeText(FINE),
      ],
    });
    const { events } = await kit.ask();
    expect(types(events)).toEqual(['tool_running', 'retry', 'tool_running', 'text', 'help_card', 'done']);
    expect(events.filter((e) => e.type === 'help_card')).toEqual([{ type: 'help_card', resource: 'pain' }]);
    expect(counters()).toEqual([
      { kind: 'filter_block', count: 1 },
      { kind: 'help_pain', count: 1 },
    ]);
    const reply = kit.rows(
      'SELECT display_extras FROM coach_message WHERE role = ? AND display_text = ?',
      'assistant',
      FINE,
    );
    expect(JSON.parse(reply[0]?.display_extras as string).helpCards).toEqual(['pain']);
  });

  it('double blocage après refer_to_help(distress) : la réponse type porte la carte distress, compteur à 1', async () => {
    kit = await exchangeKit({
      chat: [
        fakeToolUse('t1', 'refer_to_help', { resource: 'distress' }),
        fakeText(BLOCKED),
        fakeText(BLOCKED),
      ],
    });
    const { events } = await kit.ask();
    expect(events.filter((e) => e.type === 'help_card')).toEqual([
      { type: 'help_card', resource: 'distress' },
    ]);
    expect(events.find((e) => e.type === 'text')).toEqual({ type: 'text', text: STANDARD_REPLY });
    expect(lastEvent(events)).toMatchObject({ type: 'done', replaced: true, proposalIds: [] });
    const reply = kit.rows("SELECT display_extras FROM coach_message WHERE role = 'assistant'");
    expect(JSON.parse(reply[0]?.display_extras as string)).toEqual({
      helpCards: ['distress'],
      proposalIds: [],
      links: ['program', 'coach_help'],
      replaced: true,
    });
    expect(counters()).toEqual([
      { kind: 'filter_block', count: 2 },
      { kind: 'help_distress', count: 1 },
    ]);
  });

  it('proposition écrite expired (révision changée pendant le flux) : pas de carte, done.proposalIds vide', async () => {
    const { turn, release } = gated('Je te propose un repos plus court.');
    kit = await exchangeKit({
      program: true,
      chat: [fakeToolUse('t1', 'propose_program_change', PROPOSE), turn],
    });
    const run = await kit.begin();
    await untilCalls(2);
    kit.ctx.deps.sqlite.exec('UPDATE program_instance SET revision = revision + 1');
    release();
    await run.finished;
    expect(kit.rows('SELECT status FROM instance_change')).toEqual([{ status: 'expired' }]);
    expect(run.events.some((e) => e.type === 'proposal')).toBe(false);
    expect(lastEvent(run.events)).toMatchObject({ type: 'done', proposalIds: [] });
    const reply = kit.rows(
      'SELECT display_extras FROM coach_message WHERE display_text IS NOT NULL AND role = ?',
      'assistant',
    );
    expect(JSON.parse(reply[0]?.display_extras as string).proposalIds).toEqual([]);
  });

  it("journal en panne après l'enregistrement : done part, une seule ligne coach_call, pas d'error", async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const { logger } = kit.ctx.deps;
    kit.ctx.deps.logger = {
      ...logger,
      info: (msg, f) => {
        if (msg === 'coach_exchange') throw new Error('journal en panne');
        logger.info(msg, f);
      },
    };
    const { events } = await kit.ask();
    expect(types(events)).toEqual(['text', 'done']);
    expect(calls()).toHaveLength(1);
    expect(messages()).toHaveLength(2);
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
  });

  it('compte du jour illisible après la validation : done part quand même (remainingToday 0)', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const { coachConfig } = kit.ctx.deps;
    const fake = kit.fake;
    kit.ctx.deps.coachConfig = {
      ...coachConfig,
      get limits(): typeof coachConfig.limits {
        if (fake.chatCalls.length > 0) throw new Error('réglages illisibles');
        return coachConfig.limits;
      },
    };
    const { events } = await kit.ask();
    expect(types(events)).toEqual(['text', 'done']);
    expect(lastEvent(events)).toMatchObject({ type: 'done', remainingToday: 0 });
    expect(calls()).toHaveLength(1);
  });

  it('journal de sécurité en panne sur auth : api_unavailable reste, une seule ligne coach_call', async () => {
    kit = await exchangeKit({ chat: [{ error: new AiError('auth', 'Clé refusée.') }] });
    kit.ctx.deps.sqlite.exec(
      `CREATE TRIGGER sec_boom BEFORE INSERT ON security_event BEGIN SELECT RAISE(ABORT, 'journal refusé'); END`,
    );
    const { events } = await kit.ask();
    expect(events).toEqual([{ type: 'error', code: 'api_unavailable' }]);
    expect(calls()).toEqual([expect.objectContaining({ error_code: 'api_unavailable' })]);
  });

  it('le lecteur parti (emit qui lève) : l’échange se termine, s’enregistre, le bail est libéré', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const x = await prepareExchange(
      kit.ctx.deps,
      kit.user.id,
      { clientMessageId: kit.ctx.deps.ids.uuidv7(), text: 'Salut.' },
      kit.ctx.clock.now(),
    );
    const { runExchange } = await import('../../src/coach/orchestrator');
    await runExchange(kit.ctx.deps, x, () => {
      throw new Error('téléphone parti');
    });
    expect(messages()).toHaveLength(2);
    expect(calls()).toHaveLength(1);
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
  });

  it('doublon dans un fil gelé : thread_closed (le contrôle du gel précède l’idempotence)', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const id = '019a5e00-0000-7000-8000-0000000000e1';
    await kit.ask('Salut.', { clientMessageId: id });
    kit.ctx.deps.coachConfig = { ...kit.ctx.deps.coachConfig, toolsVersion: 'tools-2' };
    await expect(kit.ask('Salut.', { clientMessageId: id })).rejects.toMatchObject({
      code: 'thread_closed',
      extra: { reason: 'version_change' },
    });
  });
});
