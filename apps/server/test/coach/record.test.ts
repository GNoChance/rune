import { afterEach, describe, expect, it } from 'vitest';
import { fakeText, fakeToolUse } from '../../src/ai';
import type { CallRecord } from '../../src/coach/attempt';
import { bumpCounter, type CallSummary, recordCallOnly } from '../../src/coach/record';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/*
 * Enregistrement atomique d'un échange (spec brique 4 §8.7) : messages, tours d'outils, compteurs, ligne `coach_call`.
 */

const NOW = '2026-11-05T10:00:00.000Z';
const USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 20,
  cache_read_input_tokens: 10,
};

let kit: ExchangeKit;
afterEach(() => kit?.ctx.close());

const messages = () =>
  kit.rows(
    'SELECT seq, role, blocks, display_text, display_extras, client_message_id, ai_generated, effective_model, stop_reason, truncated, created_at FROM coach_message ORDER BY seq',
  );

describe('enregistrement atomique', () => {
  it('échange réussi : message de la personne, tour d’outil, réponse, compteurs, ligne coach_call, done', async () => {
    kit = await exchangeKit({
      chat: [
        fakeToolUse('t1', 'refer_to_help', { resource: 'pain' }, { costUsd: 0.01, usage: USAGE }),
        fakeText('Bien vu. Prends soin de toi.', { costUsd: 0.02, usage: USAGE }),
      ],
    });
    const { events, x } = await kit.ask('Mon dos tire un peu.', {
      clientMessageId: '019a5e00-0000-7000-8000-0000000000c1',
    });

    const rows = messages();
    expect(rows.map((r) => [r.seq, r.role])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
      [3, 'user'],
      [4, 'assistant'],
    ]);
    expect(rows[0]).toMatchObject({
      display_text: 'Mon dos tire un peu.',
      client_message_id: '019a5e00-0000-7000-8000-0000000000c1',
      ai_generated: 0,
    });
    expect(JSON.parse(rows[0]?.blocks as string)).toEqual([{ type: 'text', text: 'Mon dos tire un peu.' }]);
    // Tours d'outils : ni texte affiché ni identifiant de message client.
    expect(rows[1]).toMatchObject({ display_text: null, client_message_id: null, ai_generated: 1 });
    expect(JSON.parse(rows[1]?.blocks as string)[0]).toMatchObject({
      type: 'tool_use',
      name: 'refer_to_help',
    });
    expect(JSON.parse(rows[2]?.blocks as string)[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
    });
    expect(rows[3]).toMatchObject({
      display_text: 'Bien vu. Prends soin de toi.',
      ai_generated: 1,
      effective_model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      truncated: 0,
    });
    expect(JSON.parse(rows[3]?.display_extras as string)).toEqual({
      helpCards: ['pain'],
      proposalIds: [],
      links: [],
      replaced: false,
    });

    expect(kit.rows('SELECT user_message_count, last_message_at FROM coach_thread')).toEqual([
      { user_message_count: 1, last_message_at: NOW },
    ]);
    expect(kit.rows('SELECT * FROM coach_call')).toEqual([
      expect.objectContaining({
        user_id: kit.user.id,
        thread_id: x.thread.id,
        day: '2026-11-05',
        requested_model: 'claude-opus-5-5',
        effective_model: 'claude-opus-5-5',
        api_calls: 2,
        input_tokens: 200,
        output_tokens: 100,
        cache_write_tokens: 40,
        cache_read_tokens: 20,
        cost_usd_micros: 30_000,
        tool_rounds: 1,
        filter_blocks: 0,
        stop_reason: 'end_turn',
        error_code: null,
        counted: 1,
        fallback_used: 0,
      }),
    ]);
    expect(kit.rows('SELECT month, kind, count FROM coach_safety_counter')).toEqual([
      { month: '2026-11', kind: 'help_pain', count: 1 },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'done',
      threadId: x.thread.id,
      userSeq: 1,
      assistantSeq: 4,
      truncated: false,
      replaced: false,
      proposalIds: [],
      remainingToday: 29,
    });
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
  });

  it('erreur injectée dans l’écriture : rien du fil écrit, error internal, la ligne coach_call reste', async () => {
    kit = await exchangeKit({ chat: [fakeText('Bien vu. Prends soin de toi.', { costUsd: 0.02 })] });
    kit.ctx.deps.sqlite.exec(
      `CREATE TRIGGER boom BEFORE INSERT ON coach_message WHEN NEW.role = 'assistant'
       BEGIN SELECT RAISE(ABORT, 'écriture refusée'); END`,
    );
    const { events } = await kit.ask();

    expect(messages()).toEqual([]);
    expect(kit.rows('SELECT user_message_count, last_message_at FROM coach_thread')).toEqual([
      { user_message_count: 0, last_message_at: null },
    ]);
    expect(events.at(-1)).toEqual({ type: 'error', code: 'internal' });
    expect(kit.rows('SELECT error_code, counted, cost_usd_micros FROM coach_call')).toEqual([
      { error_code: 'internal', counted: 1, cost_usd_micros: 20_000 },
    ]);
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
  });

  it('sans accord santé : blocks nuls (comme après un retrait santé), display_text conservé, historique relu', async () => {
    kit = await exchangeKit({
      health: false,
      chat: [fakeText('Bien vu. Prends soin de toi.'), fakeText('Content de te lire.')],
    });
    await kit.ask('Salut.');
    expect(messages().map((r) => [r.blocks, r.display_text])).toEqual([
      [null, 'Salut.'],
      [null, 'Bien vu. Prends soin de toi.'],
    ]);

    await kit.ask('Merci.');
    // Le 2e échange relit le 1er par son texte affiché.
    expect(kit.fake.chatCalls[1]?.messages.map((m) => [m.role, m.content[0]?.text])).toEqual([
      ['user', 'Salut.'],
      ['assistant', 'Bien vu. Prends soin de toi.'],
      ['user', 'Merci.'],
    ]);
  });
});

describe('recordCallOnly et compteurs', () => {
  const call = (costUsd: number): CallRecord => ({
    model: 'claude-opus-5-5',
    usage: { input_tokens: 1, output_tokens: 1 },
    costUsd,
    priceUnknown: false,
    fallbackUsed: false,
    thinkingDropped: 0,
    stopReason: 'end_turn',
    refusalCategory: null,
  });
  const summary = (calls: CallRecord[], o: Partial<CallSummary> = {}): CallSummary => ({
    calls,
    toolRounds: 0,
    filterBlocks: 0,
    firstTextLatencyMs: null,
    stopReason: null,
    refusalCategory: null,
    errorCode: null,
    counted: false,
    durationMs: 0,
    ...o,
  });

  it('cost_usd_micros = plafond de la somme, sans bruit de flottants (3e-6 donne 3, 3,1e-6 donne 4)', async () => {
    kit = await exchangeKit({ chat: [fakeText('Bien vu. Prends soin de toi.')] });
    const { x } = await kit.ask();
    kit.ctx.deps.sqlite.exec('DELETE FROM coach_call');
    for (const usd of [0.000003, 0.0000031, 0]) {
      await recordCallOnly(kit.ctx.deps.db, kit.ctx.deps, x, summary([call(usd)]));
    }
    expect(kit.rows('SELECT cost_usd_micros AS c FROM coach_call ORDER BY rowid').map((r) => r.c)).toEqual([
      3, 4, 0,
    ]);
  });

  it('écrit filter_block (par blocage) et refusal (stop_reason refusal), sans fil si le fil a disparu', async () => {
    kit = await exchangeKit({ chat: [fakeText('Bien vu. Prends soin de toi.')] });
    const { x } = await kit.ask();
    kit.ctx.deps.sqlite.exec(
      'DELETE FROM coach_call; DELETE FROM coach_safety_counter; DELETE FROM coach_thread',
    );
    await recordCallOnly(
      kit.ctx.deps.db,
      kit.ctx.deps,
      x,
      summary([call(0)], { filterBlocks: 2, stopReason: 'refusal', refusalCategory: 'cyber', counted: true }),
    );
    expect(kit.rows('SELECT thread_id, refusal_category, filter_blocks FROM coach_call')).toEqual([
      { thread_id: null, refusal_category: 'cyber', filter_blocks: 2 },
    ]);
    expect(kit.rows('SELECT kind, count FROM coach_safety_counter ORDER BY kind')).toEqual([
      { kind: 'filter_block', count: 2 },
      { kind: 'refusal', count: 1 },
    ]);
  });

  it('bumpCounter crée puis augmente', async () => {
    kit = await exchangeKit({ chat: [] });
    const { db } = kit.ctx.deps;
    await bumpCounter(db, '2026-11', 'filter_block');
    await bumpCounter(db, '2026-11', 'filter_block', 3);
    await bumpCounter(db, '2026-12', 'filter_block');
    expect(kit.rows('SELECT month, kind, count FROM coach_safety_counter ORDER BY month')).toEqual([
      { month: '2026-11', kind: 'filter_block', count: 4 },
      { month: '2026-12', kind: 'filter_block', count: 1 },
    ]);
  });
});
