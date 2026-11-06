import { DisplayExtras, type GuidedRequest } from '@rune/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeText } from '../../src/ai';
import { currentCatalog } from '../../src/catalog/bundle';
import { sheetFixture, templateFixture } from '../support/catalog';
import { type ExchangeKit, exchangeKit } from '../support/coach';
import { enroll } from '../support/program';
import { rebuild, seedSheet } from '../support/review';

/*
 * Messages des parcours guidés (spec brique 4.1 §4.2) : le serveur recompose le texte à partir des identifiants, ignore
 * celui du client, vérifie l'exercice dans le programme courant, et déclare les durées de « Nouvelle séance ».
 * Un message guidé reste un message de la personne : mêmes gardes, même limite, même filtre.
 */

const FINE = 'Garde ton rythme actuel.';
let kit: ExchangeKit;
afterEach(() => {
  vi.useRealTimers();
  kit?.ctx.close();
});

const messages = () =>
  kit.rows('SELECT seq, role, display_text, display_extras FROM coach_message ORDER BY seq');
const nameOf = async (id: string) =>
  (await currentCatalog(kit.ctx.deps, kit.ctx.deps.db)).exercises.find((e) => e.id === id)?.name;

describe('message guidé', () => {
  it('ignore le texte du client : le texte composé part au modèle et reste dans le fil', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    const { events } = await kit.ask('Texte glissé par le client', {
      guided: { flow: 'recovery', choices: ['sleep'] },
    });

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const composed = 'Conseille-moi sur mon sommeil.';
    expect(kit.fake.chatCalls[0]?.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: composed }],
    });
    expect(messages()[0]).toMatchObject({ role: 'user', display_text: composed });
    expect(JSON.stringify(kit.rows('SELECT blocks FROM coach_message'))).not.toContain('glissé');
  });

  it("un texte vide est accepté avec guided (le texte du client n'est pas lu)", async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('', { guided: { flow: 'next_session', choices: [] } });
    expect(messages()[0]?.display_text).toBe(
      'Explique-moi ma prochaine séance : les exercices, les charges prévues et pourquoi.',
    );
  });

  it('stocke display_extras.guided sur le message de la personne', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('', { guided: { flow: 'new_session', choices: ['legs', 'medium'] } });
    expect(JSON.parse(messages()[0]?.display_extras as string)).toEqual({
      helpCards: [],
      proposalIds: [],
      links: [],
      replaced: false,
      guided: { flow: 'new_session', choices: ['legs', 'medium'] },
    });
    expect(() => DisplayExtras.parse(JSON.parse(messages()[0]?.display_extras as string))).not.toThrow();
    expect(messages()[1]?.display_extras).not.toContain('guided');
  });

  it('un message libre ne porte pas de guided', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('Salut.');
    expect(messages()[0]?.display_extras).toBeNull();
  });

  it.each([
    ['identifiant de puce inconnu', { flow: 'recovery', choices: ['inconnu'] }],
    ['nombre de choix faux', { flow: 'new_session', choices: ['legs'] }],
    ['choix en trop', { flow: 'next_session', choices: ['legs'] }],
  ] satisfies [string, GuidedRequest][])(
    "%s : 400 validation, bail libéré, rien d'écrit",
    async (_name, guided) => {
      kit = await exchangeKit({ chat: [] });
      await expect(kit.ask('x', { guided })).rejects.toMatchObject({ code: 'validation', status: 400 });
      expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
      expect(kit.rows('SELECT id FROM coach_message')).toEqual([]);
      expect(kit.fake.chatCalls).toHaveLength(0);
    },
  );

  it('« Mes charges » : le nom du catalogue, pour un exercice du programme courant', async () => {
    kit = await exchangeKit({ program: true, chat: [fakeText(FINE)] });
    const name = await nameOf('goblet-squat');
    expect(name).toBeDefined();
    await kit.ask('', { guided: { flow: 'loads', choices: ['goblet-squat', 'too_heavy'] } });
    expect(messages()[0]?.display_text).toBe(`À propos de ${name} : je la trouve trop lourde.`);
  });

  it('« Mes charges » : un exercice du catalogue hors du programme donne 400', async () => {
    kit = await exchangeKit({ program: true, chat: [] });
    expect(await nameOf('leg-press')).toBeDefined();
    await expect(
      kit.ask('', { guided: { flow: 'loads', choices: ['leg-press', 'why'] } }),
    ).rejects.toMatchObject({ code: 'validation', status: 400 });
    await expect(
      kit.ask('', { guided: { flow: 'loads', choices: ['inconnu-du-catalogue', 'why'] } }),
    ).rejects.toMatchObject({ code: 'validation', status: 400 });
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
  });

  it("« Mes charges » sur un slot à chaîne : l'exercice courant de la chaîne, pas son identifiant", async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await seedSheet(kit.ctx, sheetFixture('chain-a', { chain_id: 'rangee' }));
    await seedSheet(kit.ctx, sheetFixture('chain-b', { chain_id: 'rangee', easier_id: 'chain-a' }));
    const template = templateFixture('chain-program', [{ chain: 'rangee' }]);
    await rebuild(kit.ctx, [template]);
    await enroll(kit.ctx, kit.user.id, template);

    const ask = (id: string) => kit.ask('', { guided: { flow: 'loads', choices: [id, 'why'] } });
    await expect(ask('rangee')).rejects.toMatchObject({ code: 'validation', status: 400 });
    await expect(ask('chain-b')).rejects.toMatchObject({ code: 'validation', status: 400 });
    await ask('chain-a');
    expect(messages()[0]?.display_text).toContain(await nameOf('chain-a'));
  });

  it('« Mes charges » sans programme actif : 400', async () => {
    kit = await exchangeKit({ chat: [] });
    await expect(
      kit.ask('', { guided: { flow: 'loads', choices: ['goblet-squat', 'why'] } }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('un mineur ne peut pas envoyer la nutrition des adultes (400) ; son parcours général passe', async () => {
    kit = await exchangeKit({ birthDate: '2010-01-01', chat: [fakeText(FINE)] });
    await expect(kit.ask('', { guided: { flow: 'nutrition', choices: ['protein'] } })).rejects.toMatchObject({
      code: 'validation',
      status: 400,
    });
    await kit.ask('', { guided: { flow: 'nutrition', choices: [] } });
    expect(messages()[0]?.display_text).toBe(
      'Donne-moi des conseils généraux pour bien manger quand on fait du sport.',
    );
  });

  it('un adulte ne peut pas envoyer le parcours de nutrition des mineurs', async () => {
    kit = await exchangeKit({ chat: [] });
    await expect(kit.ask('', { guided: { flow: 'nutrition', choices: [] } })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('« 40 min » est relayé avec ou sans le parcours (le filtre ne contrôle pas les durées)', async () => {
    const TEXT = 'Prévois environ 40 min pour cette séance.';
    kit = await exchangeKit({ chat: [fakeText(TEXT)] });
    const guided = await kit.ask('', { guided: { flow: 'new_session', choices: ['legs', 'medium'] } });
    expect(guided.events.map((e) => e.type)).toEqual(['text', 'done']);
    kit.ctx.close();
    kit = await exchangeKit({ chat: [fakeText(TEXT)] });
    const free = await kit.ask('Une séance de 40 min ?');
    expect(free.events.map((e) => e.type)).toEqual(['text', 'done']);
  });

  it("le message guidé compte dans la limite d'un message libre", async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('', { guided: { flow: 'recovery', choices: ['sleep'] } });
    expect(kit.rows('SELECT user_message_count FROM coach_thread')).toEqual([{ user_message_count: 1 }]);
  });

  it('les journaux ne portent ni le texte composé, ni les identifiants du parcours', async () => {
    kit = await exchangeKit({ program: true, chat: [fakeText(FINE)] });
    await kit.ask('', { guided: { flow: 'loads', choices: ['goblet-squat', 'too_heavy'] } });
    const logs = kit.lines.join('\n');
    expect(logs).not.toContain('trop lourde');
    expect(logs).not.toContain('goblet-squat');
    expect(logs).not.toContain('too_heavy');
  });
});
