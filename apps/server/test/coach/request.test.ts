import { afterEach, describe, expect, it } from 'vitest';
import { fakeText } from '../../src/ai';
import { openTodayThread } from '../../src/coach/threads';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/*
 * Requête sérialisée du coach (spec brique 4 §5.3, §8.2), telle que le vrai client l'enverrait (`chatParams` du faux),
 * pour chaque public.
 */

type Body = {
  model: string;
  max_tokens: number;
  metadata?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  fallbacks?: unknown;
  output_config: { effort: string };
  thinking: { type: string; display?: unknown; block_binding: { prefix_mismatch_behavior: string } };
  system: { text: string; cache_control?: unknown }[];
  tools: { name: string; strict?: boolean }[];
  messages: { role: string; content: { cache_control?: unknown }[] }[];
};

let kit: ExchangeKit;
afterEach(() => kit?.ctx.close());

const BIRTH_DATES = { adult: '1990-01-01', minor: '2010-06-01' } as const;

describe('requête sérialisée, pour chaque public', () => {
  it.each(['adult', 'minor'] as const)(
    '%s : réglages, outils stricts, points de cache, aucun canari du dossier',
    async (audience) => {
      kit = await exchangeKit({
        birthDate: BIRTH_DATES[audience],
        chat: [fakeText('Garde ton rythme actuel.')],
      });
      await kit.ask('Salut.');
      const params = kit.fake.chatParams[0];
      const body = params?.body as unknown as Body;

      expect(body).not.toHaveProperty('metadata');
      expect(body).not.toHaveProperty('tool_choice');
      expect(body).not.toHaveProperty('temperature');
      expect(body.output_config.effort).toBe('low');
      expect(body.thinking).toEqual({
        type: 'adaptive',
        block_binding: { prefix_mismatch_behavior: 'error' },
      });
      expect(body.tools.map((t) => t.name)).toEqual([
        'propose_program_change',
        'read_training',
        'refer_to_help',
        'search_exercises',
      ]);
      expect(body.tools.every((t) => t.strict === true)).toBe(true);
      // Deux blocs système en cache, et le dernier bloc du dernier message.
      expect(body.system).toHaveLength(2);
      expect(body.system.every((b) => b.cache_control !== undefined)).toBe(true);
      expect(body.messages.at(-1)?.content.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
      expect(
        body.messages.slice(0, -1).every((m) => m.content.every((b) => b.cache_control === undefined)),
      ).toBe(true);

      const sent = JSON.stringify(body);
      for (const canary of [kit.user.id, kit.user.username, BIRTH_DATES[audience]]) {
        expect(sent).not.toContain(canary);
      }
      if (audience === 'adult') {
        expect(body.fallbacks).toBe('default');
        expect(params?.betas).toEqual([
          'thinking-binding-controls-2026-08-01',
          'server-side-fallback-2026-07-01',
        ]);
      } else {
        expect(body).not.toHaveProperty('fallbacks');
        expect(params?.betas).toEqual(['thinking-binding-controls-2026-08-01']);
      }
    },
  );

  it('prefix_mismatch_behavior suit coachThinkingBinding : drop_block en production', async () => {
    kit = await exchangeKit({ chat: [fakeText('Garde ton rythme actuel.')] });
    kit.ctx.deps.coachThinkingBinding = 'drop_block';
    await kit.ask('Salut.');
    const body = kit.fake.chatParams[0]?.body as unknown as Body;
    expect(body.thinking.block_binding.prefix_mismatch_behavior).toBe('drop_block');
  });

  it('modèle et effort figés avec le fil, texte de la personne seul dans le dernier message', async () => {
    kit = await exchangeKit({ chat: [fakeText('Garde ton rythme actuel.')] });
    await openTodayThread(kit.ctx.deps, kit.user.id, kit.ctx.clock.now());
    await kit.ask('Salut.');
    const body = kit.fake.chatParams[0]?.body as unknown as Body;
    expect(body.model).toBe(kit.ctx.deps.config.coachModel);
    expect(body.max_tokens).toBe(16_000);
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Salut.', cache_control: { type: 'ephemeral' } }] },
    ]);
  });
});

describe('point de cache avec un historique', () => {
  it('plusieurs messages et le message system de régénération : le point porte sur le dernier bloc du dernier message non system', async () => {
    kit = await exchangeKit({
      chat: [
        fakeText('Garde ton rythme actuel.'),
        fakeText('Voici ta charge : 200 kg.'),
        fakeText('Reste sur ton programme.'),
      ],
    });
    await kit.ask('Premier message.');
    await kit.ask('Second message.');
    const body = kit.fake.chatParams[2]?.body as unknown as Body;

    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'system']);
    const marked = body.messages.map((m) => m.content.map((b) => b.cache_control !== undefined));
    expect(marked).toEqual([[false], [false], [true], [false]]);
  });
});
