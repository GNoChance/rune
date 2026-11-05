import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Router } from 'wouter';
import { ServicesProvider } from '../../src/app-services';
import { callText, REPORT_TEXTS, THREAD_TEXTS } from '../../src/features/coach/coach-texts';
import { ThreadPage } from '../../src/features/coach/ThreadPage';
import { coachMessage, coachStatus, serveCoach } from '../support/coach';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { changeRow, seedProgram } from '../support/program';
import { createTestServices, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { until } from '../support/wait';

const THREADS = {
  threads: [
    { id: 't2', day: '2025-10-28', userMessageCount: 6, open: false },
    { id: 't1', day: '2025-10-27', userMessageCount: 1, open: false },
  ],
};

const THREAD = {
  id: 't2',
  day: '2025-10-28',
  audience: 'adult',
  persona: 'skald',
  open: false,
  closedReason: 'day_over',
  userMessageCount: 1,
  createdAt: '2025-10-28T08:00:00.000Z',
};

const PROPOSAL = changeRow('c-coach', {
  author: 'coach',
  operations: [{ op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' }],
  reasonCode: 'COACH_PROPOSAL',
  reason: 'Ton genou te gêne sur la barre.',
  status: 'proposed',
  baseRevision: 4,
  createdAt: '2025-10-28T08:00:00.000Z',
  expiresAt: '2030-10-12T08:00:00.000Z',
  decidedAt: null,
  aiGenerated: true,
  aiModel: 'claude-opus-5-5',
  coachThreadId: 't2',
});

const calls = (api: FakeApi, method: string, path: string) =>
  api.calls.filter((c) => c.method === method && c.path === path);

async function renderThreads(body: unknown = THREADS) {
  const api = serveCoach(createFakeApi(), coachStatus());
  api.on('GET', '/api/coach/threads', { status: 200, body });
  api.on('DELETE', '/api/coach/threads', { status: 204 });
  const view = await renderApp({ path: '/coach/threads', api });
  await screen.findByRole('heading', { level: 1, name: 'Conversations précédentes' });
  return { ...view, api };
}

describe('ThreadsPage : conversations précédentes (spec brique 4 §16.3)', () => {
  it('une ligne par jour : « mar. 28 oct. · 6 messages », lien vers le fil', async () => {
    await renderThreads();
    const row = await screen.findByRole('link', { name: 'mar. 28 oct. · 6 messages' });
    expect(row.getAttribute('href')).toBe('/coach/threads/t2');
    expect(screen.getByRole('link', { name: 'lun. 27 oct. · 1 message' }).getAttribute('href')).toBe(
      '/coach/threads/t1',
    );
  });

  it('lecture seule : aucun champ de saisie', async () => {
    await renderThreads();
    await screen.findByRole('link', { name: 'mar. 28 oct. · 6 messages' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('« Supprimer toutes mes conversations » en tête, confirmation sans mot de passe, DELETE /api/coach/threads', async () => {
    const { api } = await renderThreads();
    await screen.findByRole('link', { name: 'mar. 28 oct. · 6 messages' });
    const all = screen.getByRole('button', { name: 'Supprimer toutes mes conversations' });
    const first = screen.getByRole('link', { name: 'mar. 28 oct. · 6 messages' });
    expect(all.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    api.on('GET', '/api/coach/threads', { status: 200, body: { threads: [] } });
    fireEvent.click(all);
    const dialog = within(await screen.findByRole('dialog'));
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Supprimer' }));
    await until(() => calls(api, 'DELETE', '/api/coach/threads').length === 1);
    await screen.findByText('Aucune conversation pour le moment.');
  });

  it('aucune conversation : un mot, pas de suppression en tête', async () => {
    await renderThreads({ threads: [] });
    expect(await screen.findByText('Aucune conversation pour le moment.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Supprimer toutes mes conversations' })).toBeNull();
  });
});

describe('ThreadPage : un fil en lecture seule', () => {
  async function renderThread(
    messages = [coachMessage(1, 'user', 'Salut'), coachMessage(2, 'assistant', 'Bonjour')],
    withProgram = false,
  ) {
    const api = serveCoach(createFakeApi(), coachStatus());
    api.on('GET', '/api/coach/threads/t2', { status: 200, body: { thread: THREAD, messages } });
    api.on('DELETE', '/api/coach/threads/t2', { status: 204 });
    const db = createTestLocalDb();
    if (withProgram) {
      await seedProgram(db);
      await seedMirror(db, 'instance_change', [PROPOSAL]);
    }
    const view = await renderApp({ path: '/coach/threads/t2', api, db });
    await screen.findByRole('heading', { level: 1, name: 'mar. 28 oct.' });
    return { ...view, api };
  }

  it("les messages dans l'ordre, sans champ de saisie", async () => {
    await renderThread();
    const log = await screen.findByRole('log');
    expect(within(log).getByText('Salut')).toBeTruthy();
    expect(within(log).getByText('Bonjour')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it("les cartes d'aide gardent leur place, sous le message qui les porte", async () => {
    await renderThread([
      coachMessage(1, 'user', 'Je me sens mal'),
      coachMessage(2, 'assistant', 'Je suis là.', { helpCards: ['distress'] }),
    ]);
    const bubble = await screen.findByText('Je suis là.');
    const call = screen.getByRole('link', { name: callText('3114') });
    expect(bubble.compareDocumentPosition(call) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("une proposition du coach s'affiche à sa place, sous le message qui la porte", async () => {
    await renderThread(
      [
        coachMessage(1, 'user', 'Change'),
        coachMessage(2, 'assistant', 'Voici.', { proposalIds: ['c-coach'] }),
      ],
      true,
    );
    const card = await screen.findByRole('article', {}, { timeout: 10_000 });
    const bubble = screen.getByText('Voici.');
    expect(bubble.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('« Signaler » sur une réponse du coach ouvre la feuille du signalement', async () => {
    await renderThread();
    fireEvent.click(await screen.findByRole('button', { name: 'Signaler' }));
    expect(await screen.findByRole('dialog', { name: REPORT_TEXTS.title })).toBeTruthy();
  });

  it('un message qui contient du HTML est rendu comme du texte', async () => {
    await renderThread([coachMessage(1, 'user', 'Salut'), coachMessage(2, 'assistant', 'Voici <b>x</b>')]);
    const log = await screen.findByRole('log');
    expect(within(log).getByText('Voici <b>x</b>')).toBeTruthy();
    expect(log.querySelector('b')).toBeNull();
  });

  it("fil absent : « Cette conversation n'existe plus. »", async () => {
    const api = serveCoach(createFakeApi(), coachStatus());
    api.on('GET', '/api/coach/threads/zz', { status: 404, body: { error: 'not_found' } });
    await renderApp({ path: '/coach/threads/zz', api });
    expect(await screen.findByText(THREAD_TEXTS.unavailable)).toBeTruthy();
  });

  it('« Supprimer cette conversation » : confirmation, DELETE du fil, retour à la liste', async () => {
    const { api, location } = await renderThread();
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer cette conversation' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Supprimer' }));
    await until(() => location() === '/coach/threads');
    expect(calls(api, 'DELETE', '/api/coach/threads/t2')).toHaveLength(1);
  });
});

describe('ThreadPage : changement de fil', () => {
  it("l'id qui change efface le fil précédent pendant la lecture du suivant", async () => {
    const { services, api, memory } = await createTestServices({ path: '/coach/threads/t2' });
    const other = { ...THREAD, id: 't1', day: '2025-10-27' };
    api.on('GET', '/api/coach/threads/t2', {
      status: 200,
      body: { thread: THREAD, messages: [coachMessage(1, 'user', 'Message du fil t2')] },
    });
    api.on('GET', '/api/coach/threads/t1', {
      status: 200,
      body: { thread: other, messages: [coachMessage(1, 'user', 'Message du fil t1')] },
    });
    render(
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <ServicesProvider services={services}>
          <Route path="/coach/threads/:id">
            <ThreadPage />
          </Route>
        </ServicesProvider>
      </Router>,
    );
    await screen.findByText('Message du fil t2');
    // Le fil suivant ne répond pas encore.
    api.on('GET', '/api/coach/threads/t1', () => new Promise<never>(() => {}));
    act(() => memory.navigate('/coach/threads/t1'));
    expect(screen.queryByText('Message du fil t2')).toBeNull();
  });
});
