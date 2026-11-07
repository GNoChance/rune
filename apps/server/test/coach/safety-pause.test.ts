import { afterEach, describe, expect, it } from 'vitest';
import { fakeRefusal, fakeText, fakeToolUse } from '../../src/ai';
import { setSafetyPause } from '../../src/nutrition/screen';
import { fullMember, seedTarget } from '../nutrition/fixtures';
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

  it('écriture de la pause en échec : la carte part quand même, l’échange s’enregistre, journal sans contenu', async () => {
    kit = await exchangeKit({ chat: [ED, fakeText('Parle-en à un professionnel.')] });
    await profile();
    kit.ctx.deps.sqlite.exec(
      "CREATE TRIGGER no_pause BEFORE UPDATE ON nutrition_profile BEGIN SELECT RAISE(ABORT, 'panne'); END",
    );
    const { events } = await kit.ask('Je ne mange plus.');
    expect(events.map((e) => e.type)).toEqual(['tool_running', 'text', 'help_card', 'done']);
    expect(events.find((e) => e.type === 'help_card')).toEqual({
      type: 'help_card',
      resource: 'eating_disorder',
    });
    expect(JSON.stringify(kit.fake.chatCalls[1]?.messages.at(-1))).toContain('"shown\\":true');
    const failed = kit.lines.filter((l) => l.includes('coach_safety_pause_failed'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).not.toContain(kit.user.id);
    expect(failed[0]).not.toContain('panne');
    expect(pause()[0]).toMatchObject({ safety_pause: 0 });
  });

  it('pause déjà posée : rien n’est réécrit (pas de rev neuf)', async () => {
    kit = await exchangeKit({ chat: [ED, fakeText('Parle-en à un professionnel.')] });
    await profile();
    await setSafetyPause(kit.ctx.deps.db, kit.ctx.deps, kit.user.id, true);
    const before = pause()[0];
    const counter = kit.rows('SELECT sync_counter FROM server_meta')[0];
    await setSafetyPause(kit.ctx.deps.db, kit.ctx.deps, kit.user.id, true);
    expect(pause()[0]).toEqual(before);
    expect(kit.rows('SELECT sync_counter FROM server_meta')[0]).toEqual(counter);
    await kit.ask('Je ne mange plus.');
    expect(pause()[0]).toEqual(before);
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

describe('cartes d’aide d’un échange non enregistré (R14)', () => {
  it('refus du modèle après refer_to_help : la carte part avant refused', async () => {
    kit = await exchangeKit({ chat: [ED, fakeRefusal('cyber')] });
    const { events } = await kit.ask('Je ne mange plus.');
    expect(events.map((e) => e.type)).toEqual(['tool_running', 'help_card', 'refused']);
    expect(events[1]).toEqual({ type: 'help_card', resource: 'eating_disorder' });
    expect(kit.rows('SELECT id FROM coach_message')).toEqual([]);
  });

  it('erreur après refer_to_help : la carte part avant error, rien d’enregistré', async () => {
    kit = await exchangeKit({ chat: [ED] });
    const { events } = await kit.ask('Je ne mange plus.');
    expect(events.at(-1)?.type).toBe('error');
    const cards = events.filter((e) => e.type === 'help_card');
    expect(cards).toEqual([{ type: 'help_card', resource: 'eating_disorder' }]);
    expect(events.indexOf(cards[0] as (typeof events)[number])).toBeLessThan(events.length - 1);
    expect(kit.rows('SELECT id FROM coach_message')).toEqual([]);
  });

  it('sans refer_to_help, un refus n’envoie aucune carte', async () => {
    kit = await exchangeKit({ chat: [fakeRefusal('cyber')] });
    const { events } = await kit.ask('Salut');
    expect(events.map((e) => e.type)).toEqual(['refused']);
  });
});

describe('pause posée en cours de fil full (R15)', () => {
  const DEFICIT = 'Un léger déficit peut t’aider.';

  it('fil full ouvert avant la pause : la liste « hors mode complet » s’applique au message suivant', async () => {
    kit = await exchangeKit({ chat: [fakeText(DEFICIT), fakeText(DEFICIT), fakeText(DEFICIT)] });
    await fullMember(kit.ctx, kit.user.id, { goal: 'lose' });
    await seedTarget(kit.ctx, kit.user.id, { validFrom: '2026-11-01', goal: 'lose' });
    const first = await kit.ask('Comment avancer ?');
    expect(first.events.at(-1)).toMatchObject({ type: 'done', replaced: false });
    await setSafetyPause(kit.ctx.deps.db, kit.ctx.deps, kit.user.id, true);
    const second = await kit.ask('Et maintenant ?');
    expect(second.events.map((e) => e.type)).toEqual(['retry', 'text', 'done']);
    expect(second.events.at(-1)).toMatchObject({ type: 'done', replaced: true });
    expect(kit.rows('SELECT id FROM coach_thread')).toHaveLength(1);
  });
});
