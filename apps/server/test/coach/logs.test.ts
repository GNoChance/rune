import { afterEach, describe, expect, it } from 'vitest';
import { AiError, fakeRefusal, fakeText, fakeToolUse } from '../../src/ai';
import { PROMPTS } from '../../src/coach/prompts';
import { openTodayThread } from '../../src/coach/threads';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/*
 * Journal technique de l'échange (spec brique 4 §8.8, P-LOG-2) : jamais de prompt, de réponse, de dossier, de texte
 * d'outil, de note ni d'identifiant de personne ; `coach_exchange` ne porte que l'issue et ses compteurs.
 */

const BRIEF_CANARY = 'CANARI-DOSSIER-7f3a';
const NOTE_CANARY = 'CANARI-NOTE-9b21';
const REPLY_CANARY = 'canari reponse zanzibar';

let kit: ExchangeKit;
afterEach(() => kit?.ctx.close());

const logged = () => kit.lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('journal technique (canari P-LOG-2)', () => {
  it('aucune ligne ne contient le canari, le prompt, la réponse ni un identifiant de personne', async () => {
    kit = await exchangeKit({
      chat: [
        fakeToolUse('t1', 'refer_to_help', { resource: 'pain' }),
        fakeText(`Je te lis. ${REPLY_CANARY}.`),
        fakeRefusal(null),
        { error: new AiError('server', `Boum ${NOTE_CANARY}`) },
      ],
    });
    const { ctx, user } = kit;
    const thread = await openTodayThread(ctx.deps, user.id, ctx.clock.now());
    ctx.deps.sqlite.prepare('UPDATE coach_thread SET brief = ?').run(JSON.stringify({ note: BRIEF_CANARY }));

    await kit.ask(`Ma note : ${NOTE_CANARY}`);
    await kit.ask(`Refus : ${NOTE_CANARY}`);
    await kit.ask(`Erreur : ${NOTE_CANARY}`);

    const text = kit.lines.join('\n');
    expect(text).toContain('coach_exchange');
    for (const secret of [
      BRIEF_CANARY,
      NOTE_CANARY,
      REPLY_CANARY,
      PROMPTS['coach-1/adult'].slice(0, 80),
      user.id,
      user.username,
      thread.id,
    ]) {
      expect(text).not.toContain(secret);
    }
    const exchanges = logged().filter((l) => l.msg === 'coach_exchange');
    expect(exchanges.map((l) => l.event)).toEqual(['answered', 'refused', 'error']);
    for (const line of exchanges) {
      const expected = ['blocks', 'durationMs', 'event', 'level', 'msg', 'rounds', 'time'];
      if (line.event === 'error') expected.push('code');
      expect(Object.keys(line).sort()).toEqual(expected.sort());
    }
    expect(exchanges[0]).toMatchObject({ rounds: 1, blocks: 0 });
    expect(exchanges[2]).toMatchObject({ code: 'api_unavailable' });
  });

  it('double blocage : coach_exchange replaced, blocks 2', async () => {
    kit = await exchangeKit({
      chat: [fakeText('Voici ta charge : 200 kg.'), fakeText('Voici ta charge : 200 kg.')],
    });
    await kit.ask();
    expect(logged().filter((l) => l.msg === 'coach_exchange')).toEqual([
      expect.objectContaining({ event: 'replaced', blocks: 2, rounds: 0 }),
    ]);
  });

  it('modèle sans prix : price_unknown avec le modèle pour code', async () => {
    kit = await exchangeKit({ chat: [fakeText('Garde ton rythme actuel.', { priceUnknown: true })] });
    await kit.ask();
    expect(logged().find((l) => l.msg === 'price_unknown')).toMatchObject({
      level: 'warn',
      code: 'claude-opus-5-5',
    });
  });
});
