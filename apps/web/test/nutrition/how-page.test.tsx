import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { LAZY, openNutritionAt, RAW } from './full-setup';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});
async function open(...args: Parameters<typeof openNutritionAt>) {
  const view = await openNutritionAt(...args);
  opened.push(view.db);
  return view;
}
const title = { level: 1, name: 'Comment sont calculés mes repères' } as const;

describe('/nutrition/how', () => {
  it('les valeurs de la cible, les règles en phrases, les sources et la date de relecture', async () => {
    await open('/nutrition/how', {
      settings: { activityLevel: 2 },
      target: { appliedRules: ['no_deficit_low_bmi', 'ref_weight_bmi25'] },
    });
    await screen.findByRole('heading', title, LAZY);
    expect(screen.getByText(/2 100 à 2 300 kcal/, RAW)).toBeTruthy();
    expect(screen.getByText(/130 à 175 g/)).toBeTruthy();
    expect(screen.getByText(/au moins 50 g/)).toBeTruthy();
    expect(screen.getByText(/environ 310 g/)).toBeTruthy();
    expect(screen.getByText(/2,5 L/)).toBeTruthy();
    // Les règles appliquées, en phrases ; l'IMC n'est jamais nommé.
    expect(screen.getByText('Ton objectif est réglé sur le maintien.')).toBeTruthy();
    expect(screen.getByText(/poids de référence/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bIMC\b/);
    // Les quatre niveaux d'activité, le tien repéré.
    expect(screen.getByText(/Un peu actif : assis la plupart du temps/)).toBeTruthy();
    expect(screen.getByText('Ton niveau')).toBeTruthy();
    // Sources et relecture.
    for (const name of [/Mifflin/, /FAO/, /ISSN/, /ANSES/, /EFSA/]) {
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Relu le 7 novembre 2026/)).toBeTruthy();
  });

  it('sans règle appliquée : pas de liste de règles', async () => {
    await open('/nutrition/how');
    await screen.findByRole('heading', title, LAZY);
    expect(screen.queryByText('Règles appliquées à tes repères')).toBeNull();
  });

  it('pendant une pause de sécurité, aucune mention de « perte »', async () => {
    await open('/nutrition/how', { safetyPause: true });
    await screen.findByRole('heading', title, LAZY);
    expect(document.body.textContent).not.toMatch(/perte/i);
  });

  it('hors du mode complet : retour au module', async () => {
    const { location } = await open('/nutrition/how', { mode: 'qualitative' });
    await waitFor(() => expect(location()).toBe('/nutrition'), LAZY);
  });
});

describe('/nutrition/how : « perte » pendant le chargement', () => {
  it('aucune ligne « perte » à aucun moment sous le seuil', async () => {
    let seen = false;
    const observer = new MutationObserver(() => {
      if (/perte/i.test(document.body.textContent ?? '')) seen = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    await open('/nutrition/how', {
      settings: { heightCm: 160 },
      weighIns: [
        {
          id: 'w1',
          ownerId: 'u-1',
          serverRevSeen: 1,
          deletedAt: null,
          updatedAt: '2026-10-05T10:00:00.000Z',
          date: '2026-10-05',
          weightG: 47_000,
        },
      ],
    });
    await screen.findByRole('heading', title, LAZY);
    await new Promise((r) => setTimeout(r, 300));
    observer.disconnect();
    expect(seen).toBe(false);
  });
});
