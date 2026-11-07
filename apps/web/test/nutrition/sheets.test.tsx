import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { LAZY, openNutritionAt } from './full-setup';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

const SHEET = {
  id: 'sommeil',
  title: 'Dormir pour récupérer',
  body_md:
    '## Le sommeil\n\nDormir aide **beaucoup**. Voir [la source](https://example.org/s).\n\n![x](https://example.org/i.png)',
  audience: 'all',
  visible_modes: ['full', 'qualitative'],
  tags: [],
  sources: [{ title: 'Étude sommeil', url: 'https://example.org/s', accessed_on: '2026-08-01' }],
  version: 1,
  reviewed_at: '2026-09-15',
};
const OTHER = { ...SHEET, id: 'eau', title: 'Boire de l’eau', sources: [], reviewed_at: null };

async function open(path: string, o: Parameters<typeof openNutritionAt>[1] = {}) {
  const view = await openNutritionAt(path, { sheets: [SHEET, OTHER], ...o });
  opened.push(view.db);
  return view;
}

describe('liste des fiches', () => {
  it.each(['full', 'qualitative'] as const)('mode %s : chaque fiche mène à sa lecture', async (mode) => {
    await open('/nutrition', { mode });
    const link = await screen.findByRole('link', { name: 'Dormir pour récupérer' }, LAZY);
    expect(link.getAttribute('href')).toBe('/nutrition/sheets/sommeil');
  });

  it('la liste servie est gardée dans nutritionSheets', async () => {
    const { db } = await open('/nutrition');
    await screen.findByRole('link', { name: 'Dormir pour récupérer' }, LAZY);
    expect((await db.table('nutritionSheets').toArray()).map((s) => s.id).sort()).toEqual(['eau', 'sommeil']);
  });
});

describe('lecture d’une fiche', () => {
  it('titre, corps en Markdown restreint, sources et date de relecture en pied', async () => {
    await open('/nutrition/sheets/sommeil');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dormir pour récupérer' }, LAZY),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Le sommeil' })).toBeTruthy();
    expect(screen.getByText('beaucoup').tagName).toBe('STRONG');
    expect(document.querySelector('img')).toBeNull();
    const foot = screen.getByRole('region', { name: 'Sources' });
    const link = within(foot).getByRole('link', { name: 'Étude sommeil' });
    expect(link.getAttribute('href')).toBe('https://example.org/s');
    expect(within(foot).getByText(/15 septembre 2026/)).toBeTruthy();
  });

  it('sans date de relecture, pas de ligne de date', async () => {
    await open('/nutrition/sheets/eau');
    await screen.findByRole('heading', { level: 1, name: 'Boire de l’eau' }, LAZY);
    expect(screen.queryByText(/Relue le/)).toBeNull();
  });

  it('fiche inconnue : message neutre', async () => {
    await open('/nutrition/sheets/nope');
    expect(await screen.findByText("Cette fiche n'est pas disponible.", {}, LAZY)).toBeTruthy();
  });

  it('lue hors ligne, depuis la copie locale', async () => {
    const first = await open('/nutrition');
    await screen.findByRole('link', { name: 'Dormir pour récupérer' }, LAZY);
    expect(await first.db.table('nutritionSheets').count()).toBe(2);
    first.api.setOffline('reject');
    screen.getByRole('link', { name: 'Dormir pour récupérer' }).click();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dormir pour récupérer' }, LAZY),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sources' })).toBeTruthy();
  });
});
