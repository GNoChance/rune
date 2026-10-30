import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RankBadge } from '../../src/ui';
import artStyles from '../../src/ui/art.module.css';

// Fichier à part : `lazy` garde le module chargé pour tout le fichier de test. Ici, la première pierre D à S
// rendue l'est forcément avant le chargement de RankStoneUpper, et l'attente se voit.

describe('RankBadge, rangs D à S chargés à la demande', () => {
  it('le temps du chargement : image vide de même nom, même taille et même classe, puis la pierre', async () => {
    render(<RankBadge rank="S" size={48} locked />);
    const pending = screen.getByRole('img', { name: 'Rang S' });
    expect(pending.getAttribute('width')).toBe('48');
    expect(pending.getAttribute('height')).toBe('48');
    expect(pending.hasAttribute('data-variant')).toBe(false);
    expect(pending.childElementCount).toBe(0);
    expect(pending.classList.contains(artStyles.locked ?? '.locked absente')).toBe(true);

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Rang S' }).getAttribute('data-variant')).toBe('S'),
    );
    const stone = screen.getByRole('img', { name: 'Rang S' });
    expect(stone.getAttribute('width')).toBe('48');
    expect(stone.classList.contains(artStyles.locked ?? '.locked absente')).toBe(true);
  });
});
