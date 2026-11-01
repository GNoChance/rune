import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { SideNav } from '../../src/ui/SideNav';
import { activeTab, TAB_ITEMS, TabBar } from '../../src/ui/TabBar';
import { renderWithServices } from '../support/render';
import { seedBase, seedSession } from './seed';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function base(running: 'here' | 'elsewhere' | null = null): Promise<AppDb> {
  const db = await seedBase();
  opened.push(db);
  if (running) {
    await seedSession(db, {
      id: 's-1',
      status: 'in_progress',
      deviceId: running === 'here' ? 'dev-A' : 'dev-Z',
      startedAt: '2026-10-06T11:00:00.000Z',
    });
  }
  return db;
}

const nav = () => screen.getByRole('navigation', { name: 'Navigation principale' });
const current = () =>
  within(nav())
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent);

describe('onglets', () => {
  it('cinq entrées : Accueil, Exercices, Séance, Progression, Profil', () => {
    expect(TAB_ITEMS).toEqual([
      { href: '/', label: 'Accueil' },
      { href: '/exercises', label: 'Exercices' },
      { href: '/workout', label: 'Séance' },
      { href: '/progression', label: 'Progression' },
      { href: '/profile', label: 'Profil' },
    ]);
  });

  it.each([
    ['/workout', '/workout'],
    ['/workout/s-1', '/workout'],
    ['/workout/s-1/summary', '/workout'],
    ['/program', '/workout'],
    ['/program/choose', '/workout'],
    ['/Program/Choose', '/workout'],
    ['/progression', '/progression'],
    ['/progression/exercises/back-squat', '/progression'],
    ['/history', '/progression'],
    ['/history/s-1', '/progression'],
    ['/workouts', null],
    ['/programs', null],
  ] as const)('%s → %s', (path, expected) => {
    expect(activeTab(path)).toBe(expected);
  });
});

describe('TabBar', () => {
  it('l’ordre des liens et le seul onglet actif', async () => {
    await renderWithServices(<TabBar />, { path: '/program/choose', db: await base() });
    expect(
      within(nav())
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Accueil', '/'],
      ['Exercices', '/exercises'],
      ['Séance', '/workout'],
      ['Progression', '/progression'],
      ['Profil', '/profile'],
    ]);
    expect(current()).toEqual(['Séance']);
  });

  it('Progression actif sur /history', async () => {
    await renderWithServices(<TabBar />, { path: '/history/s-1', db: await base() });
    expect(current()).toEqual(['Progression']);
  });

  it('sans séance en cours : nom « Séance », pas de point', async () => {
    await renderWithServices(<TabBar />, { path: '/', db: await base() });
    const link = within(nav()).getByRole('link', { name: 'Séance' });
    expect(link.getAttribute('href')).toBe('/workout');
    expect(link.querySelector('[data-running]')).toBeNull();
  });

  it('séance en cours ici : nom « Séance, en cours », lien vers /workout/:id, point', async () => {
    await renderWithServices(<TabBar />, { path: '/', db: await base('here') });
    const link = await within(nav()).findByRole('link', { name: 'Séance, en cours' });
    expect(link.getAttribute('href')).toBe('/workout/s-1');
    expect(link.querySelector('[data-running]')).not.toBeNull();
  });

  it('séance en cours sur un autre appareil : le bouton ouvre /workout', async () => {
    await renderWithServices(<TabBar />, { path: '/', db: await base('elsewhere') });
    const link = within(nav()).getByRole('link', { name: 'Séance' });
    expect(link.getAttribute('href')).toBe('/workout');
  });
});

describe('SideNav', () => {
  it('Séance juste sous Accueil, « en cours » compris', async () => {
    await renderWithServices(<SideNav />, { path: '/workout/s-1', db: await base('here') });
    const link = await within(nav()).findByRole('link', { name: 'Séance, en cours' });
    expect(
      within(nav())
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Accueil', 'Séance', 'Exercices', 'Progression', 'Profil']);
    expect(link.getAttribute('aria-current')).toBe('page');
  });
});
