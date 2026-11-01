import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExerciseProgress } from '../../src/features/progression/ExerciseProgress';
import { createTestLocalDb } from '../support/local-db';
import { makeMe, renderApp, renderWithServices } from '../support/render';
import { FIVE_SESSIONS, repeat, type SessionSpec, seedProgress } from './seed';

// Page d'un exercice (spec brique 3 §7.10) : courbe de la meilleure série par séance, tableau équivalent pour
// les lecteurs d'écran, records, 1RM estimé avec sa mention, jamais pour un mineur.

const flat = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const MENTION = 'estimation, écart possible de 10 % ou plus';

async function open(id: string, sessions: SessionSpec[] = FIVE_SESSIONS, me = makeMe()) {
  const db = createTestLocalDb();
  await seedProgress(db, sessions);
  const view = await renderWithServices(<ExerciseProgress id={id} />, {
    db,
    me,
    path: `/progression/exercises/${id}`,
  });
  await screen.findByRole('heading', { level: 1 });
  return view;
}

describe('page d’un exercice', () => {
  it('titre, retour vers Progression, courbe SVG et tableau équivalent', async () => {
    const { container } = await open('back-squat');
    expect(await screen.findByRole('heading', { level: 1, name: 'Squat barre' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour' }).getAttribute('href')).toBe('/progression');
    const svg = container.querySelector('svg[data-chart]') as SVGElement;
    expect(svg).not.toBeNull();
    // La courbe est décorative pour un lecteur d'écran : le tableau dit la même chose.
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
    const table = screen.getByRole('table', { name: 'Meilleure série par séance' });
    const rows = within(table)
      .getAllByRole('row')
      .map((r) => within(r).queryAllByRole('cell').map(flat));
    expect(rows.filter((r) => r.length > 0)).toEqual([
      ['28/09/2026', '30 kg'],
      ['29/09/2026', '40 kg'],
    ]);
    expect(within(table).getAllByRole('columnheader').map(flat)).toEqual(['Séance du', 'Meilleure charge']);
  });

  it('records de l’exercice et 1RM estimé avec sa mention', async () => {
    await open('back-squat');
    const records = screen.getByRole('region', { name: 'Records' });
    const text = flat(records);
    expect(text).toContain('Meilleure charge 40 kg × 5');
    expect(text).toContain('Meilleur volume en une séance 3 000 kg');
    // Epley : 40 kg × (1 + 5 / 30) = 46,666 kg, arrondi au demi-kilo.
    expect(text).toContain('1RM estimé 46,5 kg');
    expect(text).toContain(MENTION);
  });

  it('jamais de 1RM estimé pour un mineur, ni sa mention', async () => {
    await open(
      'back-squat',
      FIVE_SESSIONS,
      makeMe({ ageBand: 'minor', birthDate: '2011-01-01', cautious: true }),
    );
    const records = screen.getByRole('region', { name: 'Records' });
    expect(flat(records)).toContain('Meilleure charge 40 kg × 5');
    expect(screen.queryByText(/1RM/)).toBeNull();
    expect(screen.queryByText(new RegExp(MENTION))).toBeNull();
  });

  it('exercice tenu : courbe en secondes, record de durée', async () => {
    const plank: SessionSpec[] = [
      {
        id: 'p1',
        startedAt: '2026-09-07T08:00:00.000Z',
        exercises: [{ exerciseId: 'plank', sets: repeat(3, { durationS: 45, loadMode: 'bodyweight' }) }],
      },
      {
        id: 'p2',
        startedAt: '2026-09-14T08:00:00.000Z',
        exercises: [{ exerciseId: 'plank', sets: repeat(3, { durationS: 75, loadMode: 'bodyweight' }) }],
      },
    ];
    await open('plank', plank);
    const table = screen.getByRole('table', { name: 'Meilleure série par séance' });
    expect(within(table).getAllByRole('columnheader').map(flat)).toEqual([
      'Séance du',
      'Durée la plus longue',
    ]);
    expect(within(table).getAllByRole('cell').map(flat)).toEqual([
      '07/09/2026',
      '45 s',
      '14/09/2026',
      '1 min 15 s',
    ]);
    expect(flat(screen.getByRole('region', { name: 'Records' }))).toContain(
      'Durée la plus longue 1 min 15 s',
    );
    expect(screen.queryByText(/1RM/)).toBeNull();
  });

  it('exercice au poids du corps : courbe en répétitions', async () => {
    const reps: SessionSpec[] = [
      {
        id: 'r1',
        startedAt: '2026-09-07T08:00:00.000Z',
        exercises: [{ exerciseId: 'back-squat', sets: repeat(3, { reps: 12, loadMode: 'bodyweight' }) }],
      },
    ];
    await open('back-squat', reps);
    const table = screen.getByRole('table', { name: 'Meilleure série par séance' });
    expect(within(table).getAllByRole('columnheader').map(flat)).toEqual(['Séance du', 'Répétitions']);
    expect(within(table).getAllByRole('cell').map(flat)).toEqual(['07/09/2026', '12']);
  });

  it('un exercice jamais fait : une phrase, ni courbe ni records', async () => {
    const { container } = await open('plank', FIVE_SESSIONS);
    expect(screen.getByText("Aucune série faite sur cet exercice pour l'instant.")).toBeTruthy();
    expect(container.querySelector('svg[data-chart]')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Records' })).toBeNull();
  });

  it('un exercice inconnu du catalogue : une phrase', async () => {
    await open('inconnu');
    expect(screen.getByRole('heading', { level: 1, name: 'Exercice' })).toBeTruthy();
    expect(screen.getByText("Cet exercice n'est pas dans ton catalogue.")).toBeTruthy();
  });

  it('/progression/exercises/:id dans l’appli : page chargée à la demande', async () => {
    const db = createTestLocalDb();
    await seedProgress(db, FIVE_SESSIONS);
    await renderApp({ db, path: '/progression/exercises/back-squat' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Squat barre' }, { timeout: 5000 }),
    ).toBeTruthy();
  });
});
