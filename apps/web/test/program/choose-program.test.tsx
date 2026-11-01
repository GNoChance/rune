import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getMeta } from '../../src/local-db/meta';
import { createFakeApi, createFakeSyncEngine, type FakeSyncEngine } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { CHANGE_VIEW, GYM_BEGINNER, INSTANCE_VIEW, type ProgramSetup, seedProgram } from '../support/program';
import { makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

/** Premier affichage d'un écran chargé à la demande (`import()`), large quand toute la suite tourne en parallèle. */
const LAZY = { timeout: 10_000 };

const SWITCH_WARNING =
  "Ton programme actuel s'arrête. Chaque exercice repart en calibration, avec ta dernière charge comme point de départ.";

/** Choisir un programme (`/program/choose`) ; sans programme actif par défaut. */
async function openChoose(o: { setup?: ProgramSetup; sync?: FakeSyncEngine } = {}) {
  const db = createTestLocalDb();
  await seedProgram(db, { instance: false, ...o.setup });
  const api = createFakeApi();
  const rendered = await renderApp({ path: '/program/choose', db, api, me: makeMe(), sync: o.sync });
  await screen.findByRole('heading', { level: 1, name: 'Choisir un programme' }, LAZY);
  await until(() => screen.queryAllByRole('article').length === 6);
  return { ...rendered, api };
}

const card = (name: string) => screen.getByRole('article', { name });

describe('Choisir un programme (/program/choose, spec §7.8)', () => {
  it('6 cartes : nom, description, jours, durée ; le modèle recommandé en tête avec son badge', async () => {
    await openChoose();
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(6);
    const first = cards[0] as HTMLElement;
    expect(within(first).getByRole('heading', { name: GYM_BEGINNER.name })).toBeTruthy();
    expect(within(first).getByText('Recommandé pour toi')).toBeTruthy();
    expect(within(first).getByText(GYM_BEGINNER.description)).toBeTruthy();
    expect(within(first).getByText('2 à 3 jours par semaine · 50 min environ')).toBeTruthy();
    expect(screen.getAllByText('Recommandé pour toi')).toHaveLength(1);
    expect(
      within(card('Complément sport · Débutant · Corps entier et prévention')).getByText(
        '2 jours par semaine · 35 min environ',
      ),
    ).toBeTruthy();
  });

  it('raisons de la recommandation en phrases (jours ramenés, peu de jours)', async () => {
    await openChoose({ setup: { profile: { experience: '6_to_24_months', daysPerWeek: 2 } } });
    const recommended = card(GYM_BEGINNER.name);
    expect(within(recommended).getByText('Recommandé pour toi')).toBeTruthy();
    expect(
      within(recommended).getByText(
        'Avec tes jours disponibles, un programme en corps entier te convient mieux.',
      ),
    ).toBeTruthy();
  });

  it('jours ramenés dans les bornes : la phrase le dit', async () => {
    await openChoose({ setup: { profile: { daysPerWeek: 4 } } });
    expect(
      within(card(GYM_BEGINNER.name)).getByText(
        'On part sur 3 jours par semaine, au plus près de ta disponibilité.',
      ),
    ).toBeTruthy();
  });

  it('modèle indisponible : grisé avec « Pas encore disponible », sans « Choisir »', async () => {
    await openChoose();
    const unavailable = card('Complément sport · Intermédiaire · Force et prévention');
    expect(within(unavailable).getByText('Pas encore disponible')).toBeTruthy();
    expect(within(unavailable).queryByRole('button')).toBeNull();
    expect(unavailable.getAttribute('data-unavailable')).toBe('true');
  });

  it('feuille d’inscription : jours dans les bornes, préréglés ; « Commencer ce programme » inscrit puis ouvre /program', async () => {
    const { api, db, location } = await openChoose();
    api.on('POST', '/api/program/enroll', { status: 201, body: { instance: INSTANCE_VIEW } });
    fireEvent.click(within(card(GYM_BEGINNER.name)).getByRole('button', { name: /^Choisir/ }));
    const sheet = screen.getByRole('dialog', { name: GYM_BEGINNER.name });
    expect(within(sheet).queryByText(SWITCH_WARNING)).toBeNull();
    const days = within(sheet)
      .getAllByRole('radio')
      .map((r) => (r as HTMLInputElement).value);
    expect(days).toEqual(['2', '3']);
    expect((within(sheet).getByRole('radio', { name: '3' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('radio', { name: '2' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Commencer ce programme' }));
    await until(() => location() === '/program');
    expect(api.calls.find((c) => c.path === '/api/program/enroll')?.body).toEqual({
      templateId: GYM_BEGINNER.id,
      daysPerWeek: 2,
    });
    // Le modèle recommandé est vu : le Profil ne le reproposera pas (R-REC-7).
    expect(await getMeta(db, 'recommendationSeen')).toBe(GYM_BEGINNER.id);
  });

  it('avec un programme actif : avertissement, puis switch_template ; le programme actuel n’est pas proposé', async () => {
    const { api } = await openChoose({ setup: { instance: {} } });
    expect(within(card(GYM_BEGINNER.name)).getByText('Ton programme actuel')).toBeTruthy();
    expect(within(card(GYM_BEGINNER.name)).queryByRole('button')).toBeNull();
    api.on('POST', '/api/program/changes', {
      status: 201,
      body: { change: CHANGE_VIEW, instance: INSTANCE_VIEW },
    });
    const home = card('Maison · Débutant · Corps entier');
    fireEvent.click(within(home).getByRole('button', { name: /^Choisir/ }));
    const sheet = screen.getByRole('dialog', { name: 'Maison · Débutant · Corps entier' });
    expect(within(sheet).getByText(SWITCH_WARNING)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Commencer ce programme' }));
    await until(() => api.calls.some((c) => c.path === '/api/program/changes'));
    expect(api.calls.find((c) => c.path === '/api/program/changes')?.body).toEqual({
      baseRevision: 4,
      operations: [{ op: 'switch_template', templateId: 'home-beginner-full-body', daysPerWeek: 3 }],
    });
  });

  it('409 session_in_progress : le message s’affiche dans la feuille', async () => {
    const { api } = await openChoose({ setup: { instance: {} } });
    api.on('POST', '/api/program/changes', { status: 409, body: { error: 'session_in_progress' } });
    fireEvent.click(
      within(card('Maison · Débutant · Corps entier')).getByRole('button', { name: /^Choisir/ }),
    );
    const sheet = screen.getByRole('dialog', { name: 'Maison · Débutant · Corps entier' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Commencer ce programme' }));
    await within(sheet).findByText('Termine ou abandonne ta séance en cours avant ce changement.');
  });

  it('hors ligne : « Choisir » grisé, « Nécessite le réseau »', async () => {
    await openChoose({ sync: createFakeSyncEngine({ connection: 'offline' }) });
    expect(screen.getByText('Nécessite le réseau')).toBeTruthy();
    const choose = within(card(GYM_BEGINNER.name)).getByRole('button', { name: /^Choisir/ });
    expect((choose as HTMLButtonElement).disabled).toBe(true);
  });

  it('aucun modèle disponible : la séance libre est annoncée', async () => {
    const db = createTestLocalDb();
    await seedProgram(db, { instance: false, templates: [] });
    await renderApp({ path: '/program/choose', db, me: makeMe() });
    await screen.findByText(
      'Pas encore de programme disponible : tu pourras faire des séances libres.',
      {},
      LAZY,
    );
  });
});
