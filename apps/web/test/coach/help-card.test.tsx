import { HELP_RESOURCES } from '@rune/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HELP_NOTES, PARENT_LINE } from '../../src/features/coach/coach-texts';
import { HelpCard } from '../../src/features/coach/HelpCard';
import { renderWithServices } from '../support/render';

const labelOf = (id: string) => HELP_RESOURCES.find((r) => r.id === id)?.label ?? '';

describe('HelpCard (spec brique 4 §16.4)', () => {
  it("urgence : le titre, un lien tel: par numéro, « Ouvrir l'aide »", async () => {
    await renderWithServices(<HelpCard resource="emergency" minor={false} />);
    const card = screen.getByRole('region', { name: labelOf('emergency') });
    expect(within(card).getByRole('link', { name: 'Appeler le 15' }).getAttribute('href')).toBe('tel:15');
    expect(within(card).getByRole('link', { name: 'Appeler le 112' }).getAttribute('href')).toBe('tel:112');
    expect(within(card).getByRole('link', { name: "Ouvrir l'aide" }).getAttribute('href')).toBe('/help');
  });

  it('détresse : horaires « 24 h/24, gratuit » ; dopage : pas d’horaires', async () => {
    const { unmount } = await renderWithServices(<HelpCard resource="distress" minor={false} />);
    expect(screen.getByText('24 h/24, gratuit')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Appeler le 3114' }).getAttribute('href')).toBe('tel:3114');
    unmount();
    await renderWithServices(<HelpCard resource="doping" minor={false} />);
    expect(screen.queryByText(/24 h/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Appeler le 0 800 15 2000' }).getAttribute('href')).toBe(
      'tel:0800152000',
    );
  });

  it('une ressource sans numéro : aucun lien tel:', async () => {
    await renderWithServices(<HelpCard resource="pain" minor={false} />);
    expect(screen.queryAllByRole('link', { name: /Appeler/ })).toHaveLength(0);
    expect(screen.getByRole('link', { name: "Ouvrir l'aide" })).toBeTruthy();
  });

  it('mineur : la ligne « parle à un adulte » (C39) ; adulte : pas de ligne', async () => {
    const { unmount } = await renderWithServices(<HelpCard resource="distress" minor />);
    expect(screen.getByText(PARENT_LINE)).toBeTruthy();
    expect(PARENT_LINE).toBe('Parles-en aussi à un parent ou à un adulte de confiance.');
    unmount();
    await renderWithServices(<HelpCard resource="distress" minor={false} />);
    expect(screen.queryByText(PARENT_LINE)).toBeNull();
  });

  it("troubles alimentaires : la note « Un médecin peut aussi t'aider. »", async () => {
    await renderWithServices(<HelpCard resource="eating_disorder" minor={false} />);
    expect(HELP_NOTES.eating_disorder).toBe("Un médecin peut aussi t'aider.");
    expect(screen.getByText(HELP_NOTES.eating_disorder)).toBeTruthy();
  });

  it('chaque lien porte la classe « action » (la cible de 48 px, vérifiée dans la feuille de style)', async () => {
    await renderWithServices(<HelpCard resource="emergency" minor={false} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const link of links) expect(link.className).toMatch(/action/);
  });
});
