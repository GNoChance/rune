import { MUSCLE_GROUPS } from '@rune/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProgressionPage } from '../../src/features/progression/ProgressionPage';
import { renderWithServices } from '../support/render';

// Rang S : plus de prochain rang, la barre est pleine. Le calcul des rangs est celui du domaine (testé là) ;
// on lui donne ici un résumé tout fait, sans semer des centaines de séances.

vi.mock('../../src/features/progression/use-progress', () => ({
  useProgress: () => ({
    summary: {
      xp: 61_200,
      rank: 'S',
      nextRank: null,
      nextRankXp: null,
      groups: Object.fromEntries(MUSCLE_GROUPS.map((g) => [g.code, { sets: 1300, rank: 'S' }])),
      sessions: 204,
      tonnageG: 285_600_000,
      assiduityWeeks: 30,
    },
    history: [],
    names: new Map(),
  }),
}));

describe('rang S', () => {
  it('« Rang S · 61 200 XP », sans prochain rang, barre pleine', async () => {
    await renderWithServices(<ProgressionPage />);
    const hero = await screen.findByRole('region', { name: 'Rang global' });
    expect(within(hero).getByText('Rang S · 61 200 XP')).toBeTruthy();
    expect(within(hero).queryByText(/Prochain/)).toBeNull();
    expect((hero.querySelector('[data-fill]') as HTMLElement).style.width).toBe('100%');
    expect(within(hero).getByRole('img', { name: 'Rang S' })).toBeTruthy();
    // 285 600 kg soulevés : en tonnes.
    expect(screen.getByText('285,6 t')).toBeTruthy();
  });
});
