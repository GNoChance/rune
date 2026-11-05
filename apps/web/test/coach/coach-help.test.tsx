import { HELP_RESOURCES, helpPhones } from '@rune/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRIVACY_SECTIONS } from '../../src/features/public/privacy-content';
import { renderApp } from '../support/render';

const h2 = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('CoachHelpPage : Bien utiliser le coach (spec brique 4 §16.8)', () => {
  it('rendue sans session et sans requête, titrée « Bien utiliser le coach »', async () => {
    const { api } = await renderApp({ path: '/help/coach', me: null });
    await screen.findByRole('heading', { level: 1, name: 'Bien utiliser le coach' });
    expect(api.calls).toEqual([]);
  });

  it('deux parties : « Pour tous » et « Tu as 16 ou 17 ans » (ancre jeunes)', async () => {
    await renderApp({ path: '/help/coach', me: null });
    await screen.findByRole('heading', { level: 1, name: 'Bien utiliser le coach' });
    expect(h2()).toEqual(['Pour tous', 'Tu as 16 ou 17 ans']);
    const young = screen.getByRole('region', { name: 'Tu as 16 ou 17 ans' });
    expect(young.id).toBe('jeunes');
  });

  it('« Pour tous » : ce que le coach fait et ne fait pas, ses chiffres, accepter, signaler, désactiver', async () => {
    await renderApp({ path: '/help/coach', me: null });
    const all = within(await screen.findByRole('region', { name: 'Pour tous' }));
    expect(all.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Ce que le coach fait',
      "Ce qu'il ne fait pas",
      "D'où viennent ses chiffres",
      'Accepter une proposition',
      'Signaler une réponse',
      'Désactiver le coach',
    ]);
  });

  it('« Tu as 16 ou 17 ans » : ce que le coach ne fera pas, à qui en parler, numéros de HELP_RESOURCES', async () => {
    await renderApp({ path: '/help/coach', me: null });
    const young = within(await screen.findByRole('region', { name: 'Tu as 16 ou 17 ans' }));
    expect(young.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Ce que le coach ne fera pas pour toi',
      'À qui en parler',
      'Numéros utiles',
    ]);
    const tel = young
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((h) => h?.startsWith('tel:'));
    const expected = HELP_RESOURCES.flatMap((r) => helpPhones(r).map((p) => `tel:${p.digits}`));
    expect(tel).toEqual(expected);
    expect(tel).toEqual(expect.arrayContaining(['tel:15', 'tel:112', 'tel:3114', 'tel:0969325900']));
  });

  it("l'Aide mène à /help/coach", async () => {
    await renderApp({ path: '/help', me: null });
    const link = await screen.findByRole('link', { name: 'Bien utiliser le coach' });
    expect(link.getAttribute('href')).toBe('/help/coach');
  });
});

describe('Confidentialité : Coach et mineurs (spec brique 4 §15, §16.9)', () => {
  const text = PRIVACY_SECTIONS.flatMap((s) => [
    s.title,
    ...s.items,
    ...(s.table ? [...s.table.head, ...s.table.rows.flat()] : []),
  ]).join('\n');

  it('aucune mention « (brique 4) »', () => {
    expect(text).not.toContain('(brique 4)');
  });

  it('le tableau du §15 : six exigences, lisible sans connexion', async () => {
    await renderApp({ path: '/privacy', me: null });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Coach et mineurs' });
    const table = within(heading.parentElement as HTMLElement).getByRole('table');
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((c) => c.textContent),
    ).toEqual([
      "Vérification de l'âge",
      'Consignes dédiées',
      'Modération et filtrage',
      'Surveillance et signalement',
      'Ressources éducatives',
      'Conformité affichée',
    ]);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Exigence', 'Mise en œuvre']);
  });

  it('les durées du §14.3 : 90 jours, 12 mois, 30 jours', () => {
    expect(text).toContain('90 jours après le dernier message');
    expect(text).toContain('12 mois');
    expect(text).toContain('30 jours au plus');
  });
});
