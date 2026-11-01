import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { repeat, seedSession } from '../progression/seed';
import { seedCatalog, seedGarage, seedTrainingProfile, served } from '../support/catalog';
import { createTestLocalDb } from '../support/local-db';
import { renderApp } from '../support/render';

// Tuiles de l'onglet Exercices : le rang du groupe est celui de la progression réelle (spec brique 3 §7.10),
// nom accessible « Quadriceps, rang D, 18 exercices ».

const quads = Array.from({ length: 18 }, (_, i) =>
  served({
    id: `quad-${i + 1}`,
    name: `Quadriceps ${String(i + 1).padStart(2, '0')}`,
    aliases: [],
    load_mode: 'bodyweight',
    primary_muscles: ['quadriceps'],
    secondary_muscles: ['glutes'],
    equipment_options: [[]],
    illustrations: [],
  }),
);

describe('rang des tuiles de l’onglet Exercices', () => {
  it('« Quadriceps, rang D, 18 exercices » après 30 séries de quadriceps ; les autres groupes au rang E', async () => {
    const db = createTestLocalDb();
    await seedTrainingProfile(db);
    await seedGarage(db);
    await seedCatalog(db, quads);
    await seedSession(db, {
      id: 's1',
      startedAt: '2026-09-07T08:00:00.000Z',
      exercises: [{ exerciseId: 'quad-1', sets: repeat(30, { reps: 12, loadMode: 'bodyweight' }) }],
    });
    await renderApp({ db, path: '/exercises' });
    const tile = await screen.findByRole('link', { name: 'Quadriceps, rang D, 18 exercices' });
    expect(within(tile).getByRole('img', { name: 'Rang D' })).toBeTruthy();
    const names = within(screen.getByRole('list', { name: 'Groupes musculaires' }))
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label'));
    expect(names).toContain('Fessiers, rang E, 0 exercice');
    expect(names.filter((n) => n?.includes('rang D'))).toEqual(['Quadriceps, rang D, 18 exercices']);
  });
});
