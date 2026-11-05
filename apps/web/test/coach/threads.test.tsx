import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { callText } from '../../src/features/coach/coach-texts';
import { coachMessage, coachStatus, serveCoach } from '../support/coach';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { renderApp } from '../support/render';
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
  ) {
    const api = serveCoach(createFakeApi(), coachStatus());
    api.on('GET', '/api/coach/threads/t2', { status: 200, body: { thread: THREAD, messages } });
    api.on('DELETE', '/api/coach/threads/t2', { status: 204 });
    const view = await renderApp({ path: '/coach/threads/t2', api });
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
