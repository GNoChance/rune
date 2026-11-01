import { DUMBBELL_CHOICES_G, defaultLoadSettings, type GymDetail, LoadSettingsSchema } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GymPage } from '../../src/features/places/GymPage';
import { GymLoadSettings, PlaceLoadSettings } from '../../src/features/places/LoadSettingsPage';
import { PlaceDetail } from '../../src/features/places/PlaceDetail';
import type { AppDb } from '../../src/local-db/db';
import { settle } from '../support/auth';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { button, checkbox, radio, seedPrimaryGym } from '../support/onboarding';
import { renderWithServices } from '../support/render';
import { seedMirror } from '../support/seed';
import { until } from '../support/wait';

function gymDetail(o: Partial<GymDetail> = {}): GymDetail {
  return {
    id: 'g-1',
    name: 'Basic Fit',
    city: 'Lyon',
    loadSettings: defaultLoadSettings('gym'),
    deletedAt: null,
    equipment: ['barbell'],
    canEdit: true,
    visibleMembers: ['lea'],
    history: [],
    ...o,
  };
}

/** p-1 : salle g-1 ; p-2 : maison « Garage » aux réglages par défaut d'une maison. */
async function seedPlaces(db: AppDb, home = defaultLoadSettings('home')) {
  await seedPrimaryGym(db);
  await seedMirror(db, 'place', [
    {
      id: 'p-2',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Garage',
      isPrimary: false,
      visibleAtGym: null,
      loadSettings: home,
    },
  ]);
}

async function renderHome(o: { api?: FakeApi; home?: ReturnType<typeof defaultLoadSettings> } = {}) {
  const api = o.api ?? createFakeApi();
  api.on('PATCH', '/api/places/:id', { status: 204 });
  const db = createTestLocalDb();
  await seedPlaces(db, o.home);
  const view = await renderWithServices(<PlaceLoadSettings params={{ id: 'p-2' }} />, { api, db });
  await screen.findByRole('heading', { level: 1, name: 'Réglages de charge' });
  await settle();
  return { ...view, api };
}

async function renderGymLoad(o: { api?: FakeApi; detail?: GymDetail } = {}) {
  const api = o.api ?? createFakeApi();
  api.on('GET', '/api/gyms/:id', { status: 200, body: o.detail ?? gymDetail() });
  api.on('PATCH', '/api/gyms/:id', { status: 204 });
  const db = createTestLocalDb();
  await seedPlaces(db);
  const view = await renderWithServices(<GymLoadSettings params={{ id: 'g-1' }} />, { api, db });
  await screen.findByRole('heading', { level: 1, name: 'Réglages de charge' });
  await settle();
  return { ...view, api };
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const change = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const bar = () => screen.queryByRole('region', { name: 'Changements à enregistrer' });
const summary = () => bar()?.querySelector('p')?.textContent ?? null;
const patches = (api: FakeApi, path: string) =>
  api.calls.filter((c) => c.method === 'PATCH' && c.path === path).map((c) => c.body);

describe('DUMBBELL_CHOICES_G', () => {
  it('48 valeurs strictement croissantes, dans les bornes du schéma', () => {
    expect(DUMBBELL_CHOICES_G).toHaveLength(48);
    expect(DUMBBELL_CHOICES_G[0]).toBe(500);
    expect(DUMBBELL_CHOICES_G.at(-1)).toBe(80000);
    const all = { ...defaultLoadSettings('home'), dumbbellsG: [...DUMBBELL_CHOICES_G] };
    expect(LoadSettingsSchema.safeParse(all).success).toBe(true);
  });
});

describe("Réglages de charge d'une maison", () => {
  it('montre barre, plus petit disque et pas des machines en kg à virgule décimale', async () => {
    await renderHome();
    expect(field('Barre (kg)').value).toBe('20');
    expect(field('Plus petit disque (kg)').value).toBe('1,25');
    expect(field('Pas des machines (kg)').value).toBe('5');
    expect(bar()).toBeNull();
  });

  it('un changement fait apparaître la barre, Enregistrer envoie les réglages complets en grammes', async () => {
    const { api, location } = await renderHome();
    change('Barre (kg)', '22,5');
    expect(summary()).toContain('1 changement');
    fireEvent.click(button('Enregistrer'));
    await settle();
    expect(patches(api, '/api/places/p-2')).toEqual([
      { loadSettings: { ...defaultLoadSettings('home'), barG: 22500 } },
    ]);
    expect(location()).toBe('/places/p-2');
  });

  it('Annuler remet les valeurs reçues et retire la barre', async () => {
    await renderHome();
    change('Barre (kg)', '15');
    change('Pas des machines (kg)', '2,5');
    expect(summary()).toContain('2 changements');
    fireEvent.click(button('Annuler'));
    expect(field('Barre (kg)').value).toBe('20');
    expect(field('Pas des machines (kg)').value).toBe('5');
    expect(bar()).toBeNull();
  });

  it("remettre la valeur d'origine ne compte plus pour un changement", async () => {
    await renderHome();
    change('Barre (kg)', '15');
    change('Barre (kg)', '20');
    expect(bar()).toBeNull();
  });

  it.each([
    ['Barre (kg)', '4', 'Entre 5 et 25 kg.'],
    ['Barre (kg)', '25,5', 'Entre 5 et 25 kg.'],
    ['Plus petit disque (kg)', '0,2', 'Entre 0,25 et 5 kg.'],
    ['Plus petit disque (kg)', '5,5', 'Entre 0,25 et 5 kg.'],
    ['Pas des machines (kg)', '0,4', 'Entre 0,5 et 10 kg.'],
    ['Pas des machines (kg)', '10,5', 'Entre 0,5 et 10 kg.'],
    ['Pas des machines (kg)', 'abc', 'Entre 0,5 et 10 kg.'],
  ])("%s = « %s » est refusé : « %s », rien n'est envoyé", async (label, value, message) => {
    const { api } = await renderHome();
    change(label, value);
    fireEvent.click(button('Enregistrer'));
    expect(screen.getByText(message)).toBeTruthy();
    expect(patches(api, '/api/places/p-2')).toEqual([]);
  });

  it('haltères : cocher une valeur, préréglage « 2 à 40 kg par 2 kg »', async () => {
    const { api } = await renderHome();
    expect(radio('Aucun').checked).toBe(true);
    fireEvent.click(checkbox('7,5 kg'));
    expect(summary()).toContain('1 changement');
    expect(radio('Aucun').checked).toBe(false);
    fireEvent.click(radio('2 à 40 kg par 2 kg'));
    expect(checkbox('2 kg').checked).toBe(true);
    expect(checkbox('40 kg').checked).toBe(true);
    expect(checkbox('7,5 kg').checked).toBe(false);
    expect(checkbox('42,5 kg').checked).toBe(false);
    expect(summary()).toContain('20 changements');
    fireEvent.click(button('Enregistrer'));
    await settle();
    const sent = patches(api, '/api/places/p-2')[0] as { loadSettings: { dumbbellsG: number[] } };
    expect(sent.loadSettings.dumbbellsG).toEqual(Array.from({ length: 20 }, (_, i) => 2000 * (i + 1)));
  });

  it('« Aucun » décoche tout', async () => {
    await renderHome({ home: { ...defaultLoadSettings('home'), dumbbellsG: [2000, 4000] } });
    expect(checkbox('4 kg').checked).toBe(true);
    fireEvent.click(radio('Aucun'));
    expect(checkbox('4 kg').checked).toBe(false);
    expect(summary()).toContain('2 changements');
  });

  it('hors ligne : « Nécessite le réseau », le brouillon reste', async () => {
    const { api } = await renderHome();
    change('Barre (kg)', '15');
    api.setOffline('reject');
    fireEvent.click(button('Enregistrer'));
    expect((await screen.findByRole('alert')).textContent).toBe('Nécessite le réseau');
    expect(field('Barre (kg)').value).toBe('15');
    expect(summary()).toContain('1 changement');
  });

  it('lieu inconnu : « Lieu introuvable. »', async () => {
    const db = createTestLocalDb();
    await seedPlaces(db);
    await renderWithServices(<PlaceLoadSettings params={{ id: 'nope' }} />, { db });
    expect(await screen.findByText('Lieu introuvable.')).toBeTruthy();
  });

  it('un lieu de type salle renvoie aux réglages de la salle', async () => {
    const db = createTestLocalDb();
    await seedPlaces(db);
    const view = await renderWithServices(<PlaceLoadSettings params={{ id: 'p-1' }} />, { db });
    await until(() => view.location() === '/gyms/g-1/load');
  });
});

describe("Réglages de charge d'une salle", () => {
  it('Enregistrer envoie PATCH /api/gyms/:id et revient à la fiche de la salle', async () => {
    const { api, location } = await renderGymLoad();
    expect(checkbox('20 kg').checked).toBe(true);
    change('Plus petit disque (kg)', '2,5');
    fireEvent.click(button('Enregistrer'));
    await settle();
    expect(patches(api, '/api/gyms/g-1')).toEqual([
      { loadSettings: { ...defaultLoadSettings('gym'), smallestPlateG: 2500 } },
    ]);
    expect(location()).toBe('/gyms/g-1');
  });

  it('sans droit de modification : lecture seule, pas de barre', async () => {
    await renderGymLoad({ detail: gymDetail({ canEdit: false }) });
    expect(field('Barre (kg)').disabled).toBe(true);
    expect(checkbox('20 kg').disabled).toBe(true);
    expect(screen.getByText(/Seuls les membres qui ont cette salle/)).toBeTruthy();
    expect(bar()).toBeNull();
  });

  it('salle illisible hors ligne : « Nécessite le réseau »', async () => {
    const api = createFakeApi();
    api.setOffline('reject');
    await renderWithServices(<GymLoadSettings params={{ id: 'g-9' }} />, { api });
    expect((await screen.findByRole('alert')).textContent).toBe('Nécessite le réseau');
  });
});

describe('lignes « Réglages de charge » des fiches', () => {
  it("fiche d'une maison : la ligne mène à /places/:id/load avec le résumé", async () => {
    const db = createTestLocalDb();
    await seedPlaces(db);
    await renderWithServices(<PlaceDetail params={{ id: 'p-2' }} />, { db });
    const link = await screen.findByRole('link', { name: /Réglages de charge/ });
    expect(link.getAttribute('href')).toBe('/places/p-2/load');
    expect(within(link).getByText('Barre 20 kg · disque 1,25 kg')).toBeTruthy();
  });

  it("fiche d'une salle : la ligne mène à /gyms/:id/load, l'historique note la modification", async () => {
    const api = createFakeApi();
    api.on('GET', '/api/gyms/:id', {
      status: 200,
      body: gymDetail({
        history: [
          {
            at: '2026-10-06T12:05:00.000Z',
            action: 'update_load_settings',
            authorUsername: 'lea',
            detail: {},
          },
        ],
      }),
    });
    const db = createTestLocalDb();
    await seedPlaces(db);
    await renderWithServices(<GymPage params={{ id: 'g-1' }} />, { api, db });
    const link = await screen.findByRole('link', { name: /Réglages de charge/ });
    expect(link.getAttribute('href')).toBe('/gyms/g-1/load');
    expect(await screen.findByText('Réglages de charge modifiés')).toBeTruthy();
  });
});
