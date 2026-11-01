import { MUSCLE_GROUPS } from '@rune/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressionPage } from '../../src/features/progression/ProgressionPage';
import { createTestLocalDb } from '../support/local-db';
import { renderApp, renderWithServices } from '../support/render';
import { until } from '../support/wait';
import { FIVE_SESSIONS, repeat, type SessionSpec, SHEETS, seedProgress } from './seed';

// Progression réelle (spec brique 3 §7.10 et §8) : rang global et XP, compteurs, rangs des groupes, records
// récents, liens vers l'historique et les exercices. Sans séance, la fenêtre du Système reste.

const flat = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const spoken = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return flat(copy);
};

async function openWith(sessions: SessionSpec[] = FIVE_SESSIONS) {
  const db = createTestLocalDb();
  await seedProgress(db, sessions);
  const view = await renderWithServices(<ProgressionPage />, { db, path: '/progression' });
  await screen.findByRole('region', { name: 'Rang global' }, { timeout: 30_000 });
  return view;
}

describe('Progression avec des séances', () => {
  it('rang global D : « Rang D · 1 240 / 5 000 XP », prochain rang C, barre remplie à 24,8 %', async () => {
    await openWith();
    const hero = screen.getByRole('region', { name: 'Rang global' });
    expect(within(hero).getByRole('img', { name: 'Rang D' })).toBeTruthy();
    expect(within(hero).getByText('Rang D · 1 240 / 5 000 XP')).toBeTruthy();
    expect(spoken(hero)).toContain('Rang D · 1 240 sur 5 000 XP');
    expect(within(hero).getByText('Prochain : C')).toBeTruthy();
    const fill = hero.querySelector('[data-xp] [data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('24.8%');
  });

  it('compteurs réels : séances, kg soulevés, semaines d’assiduité', async () => {
    await openWith();
    const stat = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
    expect(spoken(stat('séances'))).toBe('5 séances');
    expect(spoken(stat('soulevés'))).toBe('9 480 kg soulevés');
    expect(spoken(stat("d'assiduité"))).toBe("4 semaines d'assiduité");
  });

  it('au-delà de 10 000 kg, les kg soulevés passent en tonnes', async () => {
    const heavy: SessionSpec[] = [
      ...FIVE_SESSIONS,
      {
        id: 's6',
        startedAt: '2026-10-05T08:00:00.000Z',
        exercises: [{ exerciseId: 'lat-pulldown', sets: repeat(2, { loadG: 400_000, reps: 5 }) }],
      },
    ];
    await openWith(heavy);
    const stat = screen.getByText('soulevés').closest('li') as HTMLElement;
    expect(spoken(stat)).toBe('13,5 t soulevés');
  });

  it('les groupes portent leur rang réel : « Quadriceps, rang D », « Dos, rang D », les autres au rang E', async () => {
    await openWith();
    const section = screen.getByRole('region', { name: 'Rangs par muscle' });
    const names = within(section)
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label'));
    // Le tirage crédite aussi les bras (biceps, secondaire : 42 séries) et le squat les fessiers (principal).
    const ranked = new Set(['Dos', 'Bras', 'Quadriceps', 'Fessiers']);
    expect(names).toEqual(MUSCLE_GROUPS.map((g) => `${g.label}, rang ${ranked.has(g.label) ? 'D' : 'E'}`));
    expect(names).toContain('Quadriceps, rang D');
    expect(within(section).getAllByRole('img', { name: 'Rang D' })).toHaveLength(4);
  });

  it('records récents : les plus récents d’abord, avec l’exercice et la valeur', async () => {
    await openWith();
    const section = screen.getByRole('region', { name: 'Records récents' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(flat(items[0] as Element)).toContain('Squat barre');
    expect(flat(items[0] as Element)).toContain('Meilleure charge 40 kg');
    expect(flat(items[1] as Element)).toContain('Tirage vertical');
    expect(flat(items[1] as Element)).toContain('Meilleure charge 12 kg');
    // Le meilleur volume en une séance de la même séance (28 × 12 kg × 5 = 1 680 kg).
    expect(flat(items[2] as Element)).toContain('Meilleur volume en une séance 1 680 kg');
  });

  it('liens vers l’historique et vers chaque exercice fait', async () => {
    await openWith();
    expect(screen.getByRole('link', { name: 'Historique des séances' }).getAttribute('href')).toBe(
      '/history',
    );
    const mine = screen.getByRole('region', { name: 'Mes exercices' });
    const links = within(mine).getAllByRole('link');
    expect(links.map((a) => [flat(a), a.getAttribute('href')])).toEqual([
      ['Squat barre', '/progression/exercises/back-squat'],
      ['Tirage vertical', '/progression/exercises/lat-pulldown'],
    ]);
  });

  it('la fenêtre du Système n’est plus là dès qu’une séance est terminée', async () => {
    await openWith();
    expect(screen.queryByText('Aucune séance gravée. Ta première séance débloque tes rangs.')).toBeNull();
  });

  it('une séance abandonnée ne donne ni XP ni compteur', async () => {
    await openWith([{ ...(FIVE_SESSIONS[0] as SessionSpec), status: 'abandoned' }]);
    const hero = screen.getByRole('region', { name: 'Rang global' });
    expect(within(hero).getByText('Rang E · 0 / 1 000 XP')).toBeTruthy();
    expect(screen.getByText('Aucune séance gravée. Ta première séance débloque tes rangs.')).toBeTruthy();
  });
});

describe('Progression sans séance', () => {
  it('rang E, 0 / 1 000 XP, compteurs à 0 et fenêtre du Système', async () => {
    const db = createTestLocalDb();
    await seedProgress(db, []);
    await renderWithServices(<ProgressionPage />, { db });
    const hero = await screen.findByRole('region', { name: 'Rang global' });
    expect(within(hero).getByText('Rang E · 0 / 1 000 XP')).toBeTruthy();
    expect(within(hero).getByText('Prochain : D')).toBeTruthy();
    expect(hero.querySelector('[data-fill]')).toBeNull();
    expect(screen.getByText('Aucune séance gravée. Ta première séance débloque tes rangs.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Records récents' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mes exercices' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Historique des séances' })).toBeTruthy();
  });

  it('dans l’appli : /progression montre le rang réel', async () => {
    const db = createTestLocalDb();
    await seedProgress(db, FIVE_SESSIONS, SHEETS);
    await renderApp({ db, path: '/progression' });
    await until(() => screen.queryByText('Rang D · 1 240 / 5 000 XP') !== null);
  });
});
