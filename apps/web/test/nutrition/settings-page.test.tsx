import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { localNutritionMode } from '../../src/local-db/nutrition';
import type { FakeApi } from '../support/fake-api';
import { DISABLED_STATE, FULL_STATE, LAZY, openNutritionAt, RAW, TARGET_A } from './full-setup';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});
async function open(path: string, o: Parameters<typeof openNutritionAt>[1] = {}) {
  const view = await openNutritionAt(path, o);
  opened.push(view.db);
  await screen.findByRole('heading', { level: 1, name: 'Réglages' }, LAZY);
  return view;
}

const GAIN = { ...TARGET_A, kcal_target: 2500, kcal_min: 2400, kcal_max: 2600, effective_goal: 'gain' };
const previews = (api: FakeApi) => api.calls.filter((c) => c.path === '/api/nutrition/settings/preview');

describe('réglages : objectif, activité, sexe, taille', () => {
  it('aperçu de la nouvelle cible avant « Enregistrer », puis l’enregistrement', async () => {
    const { api } = await open('/nutrition/settings');
    api.on('POST', '/api/nutrition/settings/preview', { status: 200, body: { target: GAIN } });
    api.on('PUT', '/api/nutrition/settings', { status: 200, body: FULL_STATE });
    const section = screen.getByRole('group', { name: 'Objectif' });
    const save = within(section.closest('details') as HTMLElement).getByRole('button', {
      name: 'Enregistrer',
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(section).getByRole('radio', { name: 'Prise de muscle' }));
    await screen.findByText('2 400 à 2 600 kcal', RAW, LAZY);
    expect(previews(api)[0]?.body).toEqual({ changes: { goal: 'gain' } });
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ goal: 'gain' });
  });

  it('?focus=activity&suggest=3 : la section est ouverte, 3 présélectionné, « Suggestion du coach »', async () => {
    const { api } = await open('/nutrition/settings?focus=activity&suggest=3');
    api.on('POST', '/api/nutrition/settings/preview', { status: 200, body: { target: GAIN } });
    const details = screen
      .getByRole('group', { name: "Niveau d'activité" })
      .closest('details') as HTMLElement;
    expect((details as HTMLDetailsElement).open).toBe(true);
    expect(within(details).getByText('Suggestion du coach')).toBeTruthy();
    const three = within(details).getByRole('radio', { name: /^Actif : métier debout/ }) as HTMLInputElement;
    expect(three.checked).toBe(true);
    await waitFor(() => expect(previews(api)[0]?.body).toEqual({ changes: { activity_level: 3 } }));
  });

  it('les quatre libellés d’activité, ceux du calcul', async () => {
    await open('/nutrition/settings');
    const group = screen.getByRole('group', { name: "Niveau d'activité" });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    expect(within(group).getByRole('radio', { name: /^Très actif : métier physique/ })).toBeTruthy();
  });

  it('409 weigh_in_required : la feuille de pesée, puis une seule relance de l’aperçu', async () => {
    const { api, sync } = await open('/nutrition/settings');
    let n = 0;
    api.on('POST', '/api/nutrition/settings/preview', () =>
      n++ === 0
        ? { status: 409, body: { error: 'weigh_in_required' } }
        : { status: 200, body: { target: GAIN } },
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Objectif' })).getByRole('radio', { name: 'Prise de muscle' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Noter mon poids' }, LAZY);
    expect(screen.getByText('Note ton poids pour recalculer tes repères')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Poids (kg)'), { target: { value: '72,4' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('2 400 à 2 600 kcal', RAW, LAZY);
    expect(previews(api)).toHaveLength(2);
    expect(sync.triggers).toContain('coach');
  });

  it('un second 409 ne relance pas encore : le message de l’erreur', async () => {
    const { api } = await open('/nutrition/settings');
    api.on('POST', '/api/nutrition/settings/preview', { status: 409, body: { error: 'weigh_in_required' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Objectif' })).getByRole('radio', { name: 'Prise de muscle' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Noter mon poids' }, LAZY);
    fireEvent.change(within(sheet).getByLabelText('Poids (kg)'), { target: { value: '72,4' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText("Ajoute d'abord une pesée.", {}, LAZY);
    expect(previews(api)).toHaveLength(2);
  });

  it('pendant une pause de sécurité, « Perte de gras » n’est pas proposé', async () => {
    await open('/nutrition/settings', { safetyPause: true });
    const group = screen.getByRole('group', { name: 'Objectif' });
    expect(within(group).queryByRole('radio', { name: 'Perte de gras' })).toBeNull();
    expect(within(group).getByRole('radio', { name: 'Maintien' })).toBeTruthy();
  });
});

describe('réglages : mode', () => {
  it('descente en un geste, effet local tout de suite, sections chiffrées retirées', async () => {
    const { db, api } = await open('/nutrition/settings');
    api.setOffline('reject');
    fireEvent.click(screen.getByRole('button', { name: 'Passer en conseils sans chiffres' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Objectif' })).toBeNull());
    expect(await localNutritionMode(db)).toBe('qualitative');
    expect(
      screen.getByRole('link', { name: 'Repasser les questions de sécurité' }).getAttribute('href'),
    ).toBe('/nutrition/start?screen=1');
    expect(screen.getByRole('button', { name: 'Supprimer mes données nutrition' })).toBeTruthy();
  });

  it('en qualitatif, pas de réglages chiffrés mais la montée par l’écran de sécurité', async () => {
    await open('/nutrition/settings', { mode: 'qualitative' });
    expect(screen.queryByRole('group', { name: 'Objectif' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Repasser les questions de sécurité' }).getAttribute('href'),
    ).toBe('/nutrition/start?screen=1');
  });

  it('en pause de sécurité, le lien pour repasser les questions', async () => {
    await open('/nutrition/settings', { safetyPause: true });
    expect(
      screen.getByRole('link', { name: 'Repasser les questions de sécurité' }).getAttribute('href'),
    ).toBe('/nutrition/start?screen=1');
  });
});

describe('réglages : suppression des données', () => {
  it('confirmée par une feuille ; annuler n’envoie rien', async () => {
    const { api, location } = await open('/nutrition/settings');
    api.on('DELETE', '/api/nutrition/data', { status: 200, body: DISABLED_STATE });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer mes données nutrition' }));
    const sheet = await screen.findByRole('dialog', { name: 'Supprimer mes données nutrition' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer mes données nutrition' }));
    const again = await screen.findByRole('dialog', { name: 'Supprimer mes données nutrition' });
    fireEvent.click(within(again).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(location()).toBe('/nutrition'));
  });

  it('hors ligne : « Nécessite le réseau »', async () => {
    const { api } = await open('/nutrition/settings');
    api.setOffline('reject');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer mes données nutrition' }));
    const sheet = await screen.findByRole('dialog', { name: 'Supprimer mes données nutrition' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Supprimer' }));
    expect(await within(sheet).findByText('Nécessite le réseau')).toBeTruthy();
  });
});
