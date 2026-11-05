import type { CoachStatusView } from '@rune/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { coachStoreFor } from '../../src/features/coach/coach-store';
import { MY_COACH_TEXTS, STATE_TEXTS } from '../../src/features/coach/coach-texts';
import { fill } from '../support/auth';
import { coachStatus, serveCoach } from '../support/coach';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedProfile, serveProfile } from '../support/onboarding';
import { makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

const TRAINING = { goal: 'muscle', experience: 'none', daysPerWeek: 3, sessionMinutes: 45 } as const;
const LATER =
  "Pour l'instant, ton coach parle avec des messages préparés à l'avance. La vraie conversation arrivera plus tard.";
const ACTIONS = [
  'Ouvrir la conversation',
  'Ce que le coach voit',
  'Conversations précédentes',
  'Bien utiliser le coach',
  'Supprimer mes conversations',
  'Désactiver le coach IA',
];
const DISABLED = coachStatus({ consent: { active: false, textVersion: null } });

async function renderCoach(status: CoachStatusView = coachStatus(), api: FakeApi = createFakeApi()) {
  const me = makeMe();
  const db = createTestLocalDb();
  await seedProfile(db, { ...TRAINING, coach: 'skald' });
  serveProfile(api, db, me);
  serveCoach(api, status);
  const view = await renderApp({ path: '/profile/coach', me, db, api });
  await screen.findByRole('heading', { level: 1, name: 'Mon coach' });
  return { ...view, api };
}

const calls = (api: FakeApi, method: string, path: string) =>
  api.calls.filter((c) => c.method === method && c.path === path);

/** Liens et boutons de la page qui portent un de ces noms, dans l'ordre du document. */
function orderOf(names: readonly string[]): string[] {
  const main = screen.getByRole('main');
  return [...main.querySelectorAll('a, button')]
    .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '')
    .filter((name) => names.includes(name));
}

describe('Mon coach : section « Coach IA » (spec brique 4 §16.7)', () => {
  it('hors ligne sans statut : « Hors ligne », pas « indisponible pour le moment »', async () => {
    const api = createFakeApi();
    const me = makeMe();
    const db = createTestLocalDb();
    await seedProfile(db, { ...TRAINING, coach: 'skald' });
    serveProfile(api, db, me);
    api.setOffline('reject');
    await renderApp({ path: '/profile/coach', me, db, api });
    await screen.findByText(STATE_TEXTS.offline);
    expect(screen.queryByText(MY_COACH_TEXTS.unknown)).toBeNull();
  });

  it('remplace la mention « la vraie conversation arrivera plus tard »', async () => {
    await renderCoach();
    await screen.findByText(MY_COACH_TEXTS.active);
    expect(screen.queryByText(LATER)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Coach IA' })).toBeTruthy();
  });

  it("coach actif : l'état, puis les actions dans l'ordre, « Désactiver le coach IA » en dernier et isolé", async () => {
    await renderCoach();
    await screen.findByText(MY_COACH_TEXTS.active);
    expect(orderOf(ACTIONS)).toEqual(ACTIONS);
    const controls = within(screen.getByRole('main')).getAllByRole('button');
    expect(controls.at(-1)).toBe(screen.getByRole('button', { name: 'Désactiver le coach IA' }));
    expect(screen.getByRole('link', { name: 'Ouvrir la conversation' }).getAttribute('href')).toBe('/coach');
    expect(screen.getByRole('link', { name: 'Ce que le coach voit' }).getAttribute('href')).toBe(
      '/coach/brief',
    );
    expect(screen.getByRole('link', { name: 'Conversations précédentes' }).getAttribute('href')).toBe(
      '/coach/threads',
    );
    expect(screen.getByRole('link', { name: 'Bien utiliser le coach' }).getAttribute('href')).toBe(
      '/help/coach',
    );
  });

  it("coach désactivé : « Activer le coach IA » mène à l'accord, ni suppression ni désactivation", async () => {
    await renderCoach(DISABLED);
    await screen.findByText(MY_COACH_TEXTS.disabled);
    expect(screen.getByRole('link', { name: 'Activer le coach IA' }).getAttribute('href')).toBe(
      '/coach/consent',
    );
    expect(screen.queryByRole('link', { name: 'Ouvrir la conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Supprimer mes conversations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Désactiver le coach IA' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Bien utiliser le coach' })).toBeTruthy();
  });

  it("texte d'accord changé : pas de conversation, mais les conversations, leur suppression et la désactivation restent", async () => {
    await renderCoach(coachStatus({ consent: { needsRenewal: true, textVersion: '0.9' } }));
    await screen.findByRole('link', { name: 'Activer le coach IA' });
    expect(screen.queryByRole('link', { name: 'Ouvrir la conversation' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Conversations précédentes' })).toBeTruthy();
    // Transparence avant de redonner son accord : « Ce que le coach voit » reste lisible.
    expect(screen.getByRole('link', { name: 'Ce que le coach voit' }).getAttribute('href')).toBe(
      '/coach/brief',
    );
    expect(screen.getByRole('button', { name: 'Supprimer mes conversations' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Désactiver le coach IA' })).toBeTruthy();
  });

  it('coach désactivé : pas de lien « Ce que le coach voit »', async () => {
    await renderCoach(DISABLED);
    await screen.findByText(MY_COACH_TEXTS.disabled);
    expect(screen.queryByRole('link', { name: 'Ce que le coach voit' })).toBeNull();
  });

  it("coach en pause : l'état dit la pause du cercle", async () => {
    await renderCoach(coachStatus({ available: false, unavailableReason: 'disabled' }));
    await screen.findByText(MY_COACH_TEXTS.paused);
    expect(screen.getByRole('link', { name: 'Ouvrir la conversation' })).toBeTruthy();
  });

  it('« Changer de coach » : la ligne du nouveau ton', async () => {
    await renderCoach();
    fireEvent.click(await screen.findByRole('button', { name: 'Changer de coach' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Changer de coach' }));
    expect(sheet.getByText("Le nouveau ton s'appliquera à ta conversation de demain.")).toBeTruthy();
  });

  it('« Supprimer mes conversations » : confirmation sans mot de passe, DELETE /api/coach/threads', async () => {
    const { api } = await renderCoach();
    api.on('DELETE', '/api/coach/threads', { status: 204 });
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer mes conversations' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Supprimer mes conversations' }));
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
    expect(calls(api, 'DELETE', '/api/coach/threads')).toHaveLength(0);
    fireEvent.click(dialog.getByRole('button', { name: 'Supprimer' }));
    await until(() => screen.queryByRole('dialog') === null);
    expect(calls(api, 'DELETE', '/api/coach/threads')).toHaveLength(1);
  });

  it("« Annuler » la suppression : rien n'est envoyé", async () => {
    const { api } = await renderCoach();
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer mes conversations' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    await until(() => screen.queryByRole('dialog') === null);
    expect(calls(api, 'DELETE', '/api/coach/threads')).toHaveLength(0);
  });
});

describe('Mon coach : « Désactiver le coach IA » (spec brique 4 §14.2)', () => {
  async function open(api?: FakeApi) {
    const view = await renderCoach(coachStatus(), api);
    fireEvent.click(await screen.findByRole('button', { name: 'Désactiver le coach IA' }));
    const dialog = await screen.findByRole('dialog', { name: 'Désactiver le coach IA' });
    return { ...view, dialog: within(dialog) };
  }

  it("liste ce qui sera supprimé, ce qui reste, propose l'export et le mot de passe", async () => {
    const { dialog } = await open();
    expect(dialog.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Tes conversations avec le coach.',
      'Tes signalements.',
      'Les propositions du coach encore en attente.',
    ]);
    expect(dialog.getByText(MY_COACH_TEXTS.deactivateKept)).toBeTruthy();
    expect(dialog.getByText(MY_COACH_TEXTS.deactivateAnthropic)).toBeTruthy();
    expect(dialog.getByRole('button', { name: "Télécharger mes données d'abord" })).toBeTruthy();
    const confirm = dialog.getByRole('button', { name: 'Désactiver le coach IA' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fill('Mot de passe', 'un mot de passe');
    expect(confirm.disabled).toBe(false);
  });

  it('mot de passe faux : « Mot de passe incorrect. », le coach reste actif', async () => {
    const api = createFakeApi();
    api.on('POST', '/api/me/consents/withdraw', { status: 401, body: { error: 'invalid_credentials' } });
    const { dialog } = await open(api);
    fill('Mot de passe', 'faux');
    fireEvent.click(dialog.getByRole('button', { name: 'Désactiver le coach IA' }));
    expect(await screen.findByText('Mot de passe incorrect.')).toBeTruthy();
    expect(screen.queryByText(MY_COACH_TEXTS.disabled)).toBeNull();
  });

  it('bon mot de passe : retrait { type: ai_coach, password }, Mon coach « désactivé », rien du fil en mémoire', async () => {
    const api = createFakeApi();
    api.on('POST', '/api/me/consents/withdraw', () => {
      // Dès le retrait, le serveur dit l'accord inactif.
      serveCoach(api, DISABLED);
      return { status: 200, body: makeMe() };
    });
    const { dialog, services } = await open(api);
    const store = coachStoreFor(services);
    store.setDraft('brouillon');
    fill('Mot de passe', 'le bon');
    fireEvent.click(dialog.getByRole('button', { name: 'Désactiver le coach IA' }));
    await screen.findByText(MY_COACH_TEXTS.disabled);
    expect(calls(api, 'POST', '/api/me/consents/withdraw').map((c) => c.body)).toEqual([
      { type: 'ai_coach', password: 'le bon' },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.getState()).toMatchObject({ draft: '', pending: null, phase: 'idle', error: null });
    expect(store.getState().today?.messages ?? []).toEqual([]);
  });
});
