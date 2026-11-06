import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CoachStatusView, CoachTodayResponse } from '@rune/contracts';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoachPage } from '../../src/features/coach/CoachPage';
import { GUIDED_TEXTS } from '../../src/features/coach/coach-texts';
import { programExercises } from '../../src/features/coach/guided-exercises';
import { coachMessage, coachStatus, EMPTY_TODAY } from '../support/coach';
import { declarationsOf, parseCssBlocks } from '../support/css-blocks';
import { createFakeApi, createFakeSyncEngine, type FakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedProgram } from '../support/program';
import { renderWithServices } from '../support/render';
import { until } from '../support/wait';

const THREAD = {
  id: 't1',
  day: '2026-10-06',
  audience: 'adult',
  persona: 'skald',
  open: true,
  closedReason: null,
  userMessageCount: 1,
  createdAt: '2026-10-06T10:00:00.000Z',
};

const DONE = `event: done\ndata: ${JSON.stringify({
  threadId: 't1',
  userSeq: 1,
  assistantSeq: 2,
  truncated: false,
  replaced: false,
  proposalIds: [],
  remainingToday: 29,
})}\n\n`;

const SSE = {
  status: 200,
  headers: { 'Content-Type': 'text/event-stream' },
  body: `event: text\ndata: {"text":"Voici."}\n\n${DONE}`,
};

const NEW_SESSION = { flow: 'new_session', choices: ['legs', 'medium'] };
const NEW_SESSION_TEXT =
  'Je voudrais une nouvelle séance : jambes, environ 40 minutes, avec le matériel de mon lieu principal.';

interface Setup {
  status?: CoachStatusView;
  today?: CoachTodayResponse | typeof EMPTY_TODAY;
  program?: boolean;
  sync?: ReturnType<typeof createFakeSyncEngine>;
}

async function setup(o: Setup = {}) {
  const db = createTestLocalDb();
  await seedProgram(db, o.program === false ? { instance: false } : {});
  const api: FakeApi = createFakeApi()
    .on('GET', '/api/coach/status', { status: 200, body: o.status ?? coachStatus() })
    .on('GET', '/api/coach/today', { status: 200, body: o.today ?? EMPTY_TODAY })
    .on('POST', '/api/coach/messages', SSE);
  const view = await renderWithServices(<CoachPage />, { path: '/coach', db, api, sync: o.sync });
  await screen.findByRole('log');
  return { ...view, api };
}

const posts = (api: FakeApi) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === '/api/coach/messages');
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

const todayWith = (messages: object[], thread: object = THREAD) =>
  ({ thread, messages, inProgress: false }) as CoachTodayResponse;

/** Une question de parcours puis sa réponse, comme `today` les rend. */
const answered = (guided: object, text = 'Une question', reply = 'Voici ma réponse.') => [
  coachMessage(1, 'user', text, { guided }),
  coachMessage(2, 'assistant', reply),
];

describe('Parcours guidés : « Nouvelle séance » de bout en bout dans la page', () => {
  it('étapes locales sans appel, puis un seul envoi : texte composé et parcours', async () => {
    const { api } = await setup();
    // Après l'envoi, le serveur rend le message enregistré avec son parcours.
    api.on('GET', '/api/coach/today', () => ({
      status: 200,
      body:
        posts(api).length === 0 ? EMPTY_TODAY : todayWith(answered(NEW_SESSION, NEW_SESSION_TEXT, 'Voici.')),
    }));
    await screen.findByText("Message d'accueil");
    click('Nouvelle séance');
    expect(screen.getByText('Quel muscle veux-tu travailler ?')).toBeTruthy();
    click('Jambes');
    expect(screen.getByText('Combien de temps as-tu ?')).toBeTruthy();
    expect(posts(api)).toHaveLength(0);
    click('Moyenne (40 min)');
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toEqual({
      clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      text: NEW_SESSION_TEXT,
      guided: NEW_SESSION,
    });
    // Le message part tel quel : il est déjà dans le fil, avec la mention.
    expect(await screen.findByText(NEW_SESSION_TEXT)).toBeTruthy();
    expect(screen.getByText(GUIDED_TEXTS.chosen)).toBeTruthy();
  });

  it('« Retour » revient à l’étape d’avant, sans appel', async () => {
    const { api } = await setup();
    click('Nouvelle séance');
    click('Jambes');
    click('Retour');
    expect(screen.getByText('Quel muscle veux-tu travailler ?')).toBeTruthy();
    click('Retour');
    expect(screen.getByRole('button', { name: 'Ma prochaine séance' })).toBeTruthy();
    expect(posts(api)).toHaveLength(0);
  });

  it('« Annuler » abandonne le parcours : rien n’est envoyé', async () => {
    const { api } = await setup();
    click('Nouvelle séance');
    click('Jambes');
    click('Annuler');
    expect(screen.queryByText('Combien de temps as-tu ?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Nouvelle séance' })).toBeTruthy();
    expect(posts(api)).toHaveLength(0);
  });

  it('un parcours sans étape part au premier toucher', async () => {
    const { api } = await setup();
    click('Ma prochaine séance');
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toMatchObject({
      text: 'Explique-moi ma prochaine séance : les exercices, les charges prévues et pourquoi.',
      guided: { flow: 'next_session', choices: [] },
    });
  });

  it('le brouillon de la personne reste dans le champ après un envoi guidé', async () => {
    await setup();
    const field = await screen.findByRole('textbox', { name: /message/i });
    fireEvent.change(field, { target: { value: 'Ma question en cours' } });
    click('Ma prochaine séance');
    await until(() => screen.queryByText('Voici.') !== null || (field as HTMLTextAreaElement).value !== '');
    expect((field as HTMLTextAreaElement).value).toBe('Ma question en cours');
  });

  it('une limite du jour atteinte : le parcours est grisé comme le champ', async () => {
    await setup({
      status: coachStatus({ today: { ...coachStatus().today, threadId: 't1', open: true, remaining: 0 } }),
    });
    expect((await screen.findByRole('button', { name: 'Nouvelle séance' })).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('une erreur du serveur à l’envoi : bannière et « Réessayer » renvoie le même parcours', async () => {
    const { api } = await setup();
    api.on('POST', '/api/coach/messages', { status: 429, body: { error: 'request_in_progress' } });
    click('Ma prochaine séance');
    await screen.findByText('Le coach termine une réponse…');
    expect(posts(api)).toHaveLength(1);
  });
});

describe('Parcours guidés : bouton « Parcours guidés » d’un fil non vide', () => {
  const FILLED = todayWith([coachMessage(1, 'user', 'Salut'), coachMessage(2, 'assistant', 'Bonjour.')]);

  it('les parcours ne sont pas affichés, le bouton les ouvre et les referme', async () => {
    await setup({ today: FILLED });
    await screen.findByText('Bonjour.');
    expect(screen.queryByRole('button', { name: 'Nouvelle séance' })).toBeNull();
    click('Parcours guidés');
    expect(screen.getByRole('button', { name: 'Nouvelle séance' })).toBeTruthy();
    click('Parcours guidés');
    expect(screen.queryByRole('button', { name: 'Nouvelle séance' })).toBeNull();
  });

  it('« Annuler » referme le panneau', async () => {
    await setup({ today: FILLED });
    await screen.findByText('Bonjour.');
    click('Parcours guidés');
    click('Récupération');
    click('Annuler');
    expect(screen.queryByRole('button', { name: 'Récupération' })).toBeNull();
  });

  it('envoyer referme le panneau', async () => {
    const { api } = await setup({ today: FILLED });
    await screen.findByText('Bonjour.');
    click('Parcours guidés');
    click('Récupération');
    click('Sommeil');
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toMatchObject({
      text: 'Conseille-moi sur mon sommeil.',
      guided: { flow: 'recovery', choices: ['sleep'] },
    });
    expect(screen.queryByRole('button', { name: 'Récupération' })).toBeNull();
  });
});

describe('Parcours guidés : puces de suite', () => {
  const NEW = answered(NEW_SESSION, NEW_SESSION_TEXT, 'Voici une séance jambes.');

  it('sous la dernière réponse d’un parcours « Nouvelle séance » : trois puces', async () => {
    await setup({ today: todayWith(NEW) });
    await screen.findByText('Voici une séance jambes.');
    for (const name of ["L'ajouter à mon programme", 'Une autre idée', 'Plus courte']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('une puce de suite envoie son texte, comme un message ordinaire', async () => {
    const { api } = await setup({ today: todayWith(NEW) });
    await screen.findByText('Voici une séance jambes.');
    click("L'ajouter à mon programme");
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toEqual({
      clientMessageId: expect.any(String),
      text: 'Ajoute cette séance à mon programme.',
    });
  });

  it('elles disparaissent dès qu’un autre message part', async () => {
    await setup({ today: todayWith(NEW) });
    await screen.findByText('Voici une séance jambes.');
    click('Plus courte');
    await until(() => screen.queryByRole('button', { name: 'Plus courte' }) === null);
  });

  it('pas de puces quand un message est parti depuis (la réponse n’est plus la dernière)', async () => {
    await setup({
      today: todayWith([
        ...NEW,
        coachMessage(3, 'user', 'Merci'),
        coachMessage(4, 'assistant', 'Avec plaisir.'),
      ]),
    });
    await screen.findByText('Avec plaisir.');
    expect(screen.queryByRole('button', { name: 'Une autre idée' })).toBeNull();
  });

  it('pas de puces sous une réponse remplacée', async () => {
    await setup({
      today: todayWith([NEW[0] as object, coachMessage(2, 'assistant', 'Remplacée.', { replaced: true })]),
    });
    await screen.findByText('Remplacée.');
    expect(screen.queryByRole('button', { name: 'Une autre idée' })).toBeNull();
  });

  it('pas de puces tant que la réponse n’est pas finie (flux en cours)', async () => {
    const { api } = await setup({ today: todayWith(NEW) });
    await screen.findByText('Voici une séance jambes.');
    api.on('POST', '/api/coach/messages', () => new Promise(() => {}));
    click('Une autre idée');
    await until(() => screen.queryByRole('button', { name: 'Plus courte' }) === null);
  });

  it('un message sans parcours n’en a pas', async () => {
    await setup({
      today: todayWith([coachMessage(1, 'user', 'Salut'), coachMessage(2, 'assistant', 'Bonjour.')]),
    });
    await screen.findByText('Bonjour.');
    expect(screen.queryByRole('button', { name: 'Une autre idée' })).toBeNull();
  });

  it('« Mes charges » : deux puces', async () => {
    const loads = answered({ flow: 'loads', choices: ['goblet-squat', 'why'] });
    await setup({ today: todayWith(loads) });
    await screen.findByText('Voici ma réponse.');
    expect(screen.getByRole('button', { name: "D'autres questions sur cet exercice" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Un autre exercice' })).toBeTruthy();
  });

  it('« Ajuster mon programme » : aucune puce de suite', async () => {
    await setup({ today: todayWith(answered({ flow: 'adjust_program', choices: ['shorter'] })) });
    await screen.findByText('Voici ma réponse.');
    expect(screen.queryByRole('button', { name: /autre|ajouter|courte/i })).toBeNull();
  });

  it('hors ligne, les puces de suite sont grisées', async () => {
    await setup({ today: todayWith(NEW), sync: createFakeSyncEngine({ connection: 'offline' }) });
    await screen.findByText('Voici une séance jambes.');
    expect((screen.getByRole('button', { name: 'Plus courte' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('mention « Choisi dans un parcours » sous le message de la personne venu d’un parcours seulement', async () => {
    await setup({
      today: todayWith([
        ...NEW,
        coachMessage(3, 'user', 'Merci'),
        coachMessage(4, 'assistant', 'Avec plaisir.'),
      ]),
    });
    await screen.findByText('Avec plaisir.');
    const mine = screen.getByText(NEW_SESSION_TEXT).closest('[data-role]') as HTMLElement;
    expect(within(mine).getByText(GUIDED_TEXTS.chosen)).toBeTruthy();
    const plain = screen.getByText('Merci').closest('[data-role]') as HTMLElement;
    expect(within(plain).queryByText(GUIDED_TEXTS.chosen)).toBeNull();
  });
});

describe('Parcours guidés : « Mes charges »', () => {
  it('liste les exercices du programme par leur nom, puis la question, puis envoie le slug', async () => {
    const { api } = await setup();
    // Le programme se lit dans la base locale : « Mes charges » s'ouvre quand il est arrivé.
    await until(() => screen.queryByRole('button', { name: /^Mes charges$/ }) !== null);
    click('Mes charges');
    expect(screen.getByText('Quel exercice ?')).toBeTruthy();
    for (const name of ['Squat barre', 'Squat goblet', 'Presse à cuisses', 'Pompe', 'Planche']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    click('Squat goblet');
    expect(screen.getByText('Quelle est ta question ?')).toBeTruthy();
    expect(posts(api)).toHaveLength(0);
    click('Pourquoi cette charge ?');
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toEqual({
      clientMessageId: expect.any(String),
      text: 'À propos de Squat goblet : pourquoi cette charge ?',
      guided: { flow: 'loads', choices: ['goblet-squat', 'why'] },
    });
  });

  it('sans programme : grisé, avec « Choisis d’abord un programme »', async () => {
    await setup({ program: false });
    const button = await screen.findByRole('button', { name: /Mes charges/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Choisis d'abord un programme")).toBeTruthy();
  });
});

describe('Parcours guidés : public mineur et hors ligne', () => {
  it('un mineur n’a pas « Nutrition » : « Bien manger quand on fait du sport » part au premier toucher', async () => {
    const { api } = await setup({ status: coachStatus({ audience: 'minor' }) });
    await screen.findByRole('button', { name: 'Récupération' });
    expect(screen.queryByRole('button', { name: 'Nutrition' })).toBeNull();
    click('Bien manger quand on fait du sport');
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toMatchObject({
      text: 'Donne-moi des conseils généraux pour bien manger quand on fait du sport.',
      guided: { flow: 'nutrition', choices: [] },
    });
  });

  it('un adulte a « Nutrition » et ses quatre repères', async () => {
    const { api } = await setup();
    click('Nutrition');
    for (const name of ['Avant la séance', 'Après la séance', 'Protéines', 'Hydratation']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    click('Protéines');
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toMatchObject({ guided: { flow: 'nutrition', choices: ['protein'] } });
  });

  it('hors ligne : tous les parcours sont grisés', async () => {
    await setup({ sync: createFakeSyncEngine({ connection: 'offline' }) });
    const flows = [
      'Ma prochaine séance',
      'Nouvelle séance',
      'Récupération',
      'Nutrition',
      'Ajuster mon programme',
    ];
    for (const name of flows) {
      expect((await screen.findByRole('button', { name })) as HTMLButtonElement).toHaveProperty(
        'disabled',
        true,
      );
    }
  });

  it('hors ligne en cours de parcours : les puces d’une étape sont grisées', async () => {
    const sync = createFakeSyncEngine({ connection: 'online' });
    await setup({ sync });
    click('Nouvelle séance');
    act(() => sync.set({ connection: 'offline' }));
    expect((screen.getByRole('button', { name: 'Jambes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('programExercises : les exercices du programme tels que le serveur les accepte', () => {
  const sheet = (id: string, name: string, extra: object = {}) => ({
    id,
    name,
    status: 'published',
    ...extra,
  });
  const sheets = [
    sheet('push-up', 'Pompe'),
    sheet('plank', 'Planche'),
    sheet('knee-push-up', 'Pompe sur les genoux', { chain_id: 'push', harder_id: 'incline-push-up' }),
    sheet('incline-push-up', 'Pompe inclinée', {
      chain_id: 'push',
      easier_id: 'knee-push-up',
      harder_id: 'floor-push-up',
    }),
    sheet('floor-push-up', 'Pompe au sol', {
      chain_id: 'push',
      easier_id: 'incline-push-up',
      not_for_minors: true,
    }),
  ];
  const view = (rank?: number) =>
    ({
      program: {
        template: {
          workouts: [
            {
              slots: [
                { id: 'A1', exercises: ['push-up', 'plank'] },
                { id: 'A2', chain: 'push' },
              ],
            },
            { slots: [{ id: 'B1', exercises: ['plank'] }] },
          ],
        },
      },
      slotStates: rank === undefined ? [] : [{ slotId: 'A2', exerciseId: 'push', variantRank: rank }],
    }) as never;
  const ctx = (profile: string) => ({ sheets, profile }) as never;

  it('la liste de chaque slot, sans doublon, avec le nom de la fiche', () => {
    expect(programExercises(view(), ctx('adult'))).toEqual([
      { id: 'push-up', name: 'Pompe' },
      { id: 'plank', name: 'Planche' },
      { id: 'knee-push-up', name: 'Pompe sur les genoux' },
    ]);
  });

  it('une chaîne : l’exercice courant de la chaîne, jamais son identifiant', () => {
    const ids = (rank: number, profile = 'adult') =>
      programExercises(view(rank), ctx(profile)).map((e) => e.id);
    expect(ids(2)).toContain('incline-push-up');
    expect(ids(2)).not.toContain('push');
    expect(ids(3)).toContain('floor-push-up');
  });

  it('profil prudent : la chaîne s’arrête avant la variante interdite aux mineurs', () => {
    const ids = programExercises(view(3), ctx('cautious')).map((e) => e.id);
    expect(ids).toContain('incline-push-up');
    expect(ids).not.toContain('floor-push-up');
  });
});

describe('guided.module : cibles et couleurs', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/features/coach/coach-page.module.css'),
    'utf8',
  );
  const blocks = parseCssBlocks(css);

  it('puces, « Retour », « Annuler » et « Parcours guidés » : 48 px', () => {
    for (const selector of ['.guidedChip', '.guidedLink', '.guidedToggle']) {
      expect(declarationsOf(blocks, selector)?.get('min-height'), selector).toBe('48px');
    }
  });

  it('aucune couleur écrite en dur', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
  });
});
