import { afterEach, describe, expect, it } from 'vitest';
import { fakeRefusal, fakeText, fakeToolUse } from '../../src/ai';
import { insertFixtureRow } from '../support';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/*
 * Pause de sécurité (spec brique 5 §11.3, D14) : `refer_to_help("eating_disorder")` la pose quand le profil nutrition
 * existe et que l'accord santé est actif, même si l'échange n'est pas enregistré ; sans l'un ou l'autre, rien.
 */

let kit: ExchangeKit;
afterEach(() => kit?.ctx.close());

const ED = fakeToolUse('t1', 'refer_to_help', { resource: 'eating_disorder' });
const pause = () => kit.rows('SELECT safety_pause, rev FROM nutrition_profile');
const profile = (mode: 'full' | 'qualitative' | 'disabled' = 'qualitative') =>
  insertFixtureRow(kit.ctx.deps.db, 'nutrition_profile', {
    ownerId: kit.user.id,
    mode,
    modeReason: 'choice',
  });

describe('safety_pause', () => {
  it('profil et accord santé : pause posée avec un rev neuf, échange enregistré, compteur help comme avant la brique 5', async () => {
    kit = await exchangeKit({ chat: [ED, fakeText('Parle-en à un professionnel.')] });
    await profile();
    const before = Number(pause()[0]?.rev);
    const { events } = await kit.ask('Je ne mange plus.');
    expect(events.map((e) => e.type)).toContain('help_card');
    expect(pause()[0]).toMatchObject({ safety_pause: 1 });
    expect(Number(pause()[0]?.rev)).toBeGreaterThan(before);
    // La pause ne change pas le compteur agrégé de la brique 4, et ne prévient pas l'admin.
    expect(kit.rows('SELECT kind, count FROM coach_safety_counter')).toEqual([
      { kind: 'help_eating_disorder', count: 1 },
    ]);
  });

  it('sans accord santé : pause inchangée', async () => {
    kit = await exchangeKit({ health: false, chat: [ED, fakeText('Parle-en à un professionnel.')] });
    await profile();
    await kit.ask('Je ne mange plus.');
    expect(pause()).toEqual([expect.objectContaining({ safety_pause: 0 })]);
  });

  it('sans profil nutrition : aucune ligne créée', async () => {
    kit = await exchangeKit({ chat: [ED, fakeText('Parle-en à un professionnel.')] });
    await kit.ask('Je ne mange plus.');
    expect(pause()).toEqual([]);
  });

  it('échange refusé par le modèle, rien d’enregistré : la pause est posée quand même', async () => {
    kit = await exchangeKit({ chat: [ED, fakeRefusal('cyber')] });
    await profile('disabled');
    const { events } = await kit.ask('Je ne mange plus.');
    expect(events.at(-1)?.type).toBe('refused');
    expect(kit.rows('SELECT id FROM coach_message')).toEqual([]);
    expect(pause()[0]).toMatchObject({ safety_pause: 1 });
  });

  it('autre ressource que eating_disorder : pause inchangée', async () => {
    kit = await exchangeKit({
      chat: [fakeToolUse('t1', 'refer_to_help', { resource: 'pain' }), fakeText('Vois un médecin.')],
    });
    await profile();
    await kit.ask('Mal au genou.');
    expect(pause()[0]).toMatchObject({ safety_pause: 0 });
  });
});
