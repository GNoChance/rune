import type { PlannedExercise, PlannedWorkout } from '@rune/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanList } from '../../src/features/workout/PlanList';
import { noticeText, resolutionNote, targetSummary } from '../../src/features/workout/workout-labels';
import type { AppDb } from '../../src/local-db/db';
import { formatKg, formatSeconds } from '../../src/ui/format';
import { renderApp } from '../support/render';
import { LUNGE, SKIPPED, SQUAT } from '../support/workout';
import { seedBase, seedSession, TEMPLATE } from './seed';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function open(db: AppDb, path = '/workout') {
  opened.push(db);
  return renderApp({ path, db });
}

const NAMES = new Map([
  ['back-squat', 'Squat barre'],
  ['dumbbell-lunge', 'Fente aux haltères'],
  ['nordic-curl', 'Curl nordique'],
  ['goblet-squat', 'Squat goblet'],
]);

describe('formats', () => {
  it('formatKg et formatSeconds', () => {
    expect(formatKg(60_000)).toBe('60 kg');
    expect(formatKg(62_500)).toBe('62,5 kg');
    expect(formatSeconds(30)).toBe('30 s');
    expect(formatSeconds(60)).toBe('1 min');
    expect(formatSeconds(90)).toBe('1 min 30 s');
    expect(formatSeconds(0)).toBe('0 s');
  });
});

describe('targetSummary', () => {
  const work = (o: Partial<PlannedExercise>): PlannedExercise => ({ ...SQUAT, ...o });

  it('3 × 6 · 60 kg', () => {
    expect(targetSummary(SQUAT)).toBe('3 × 6 · 60 kg');
  });

  it('fourchette, haltères : par main, unilatéral compté par série', () => {
    // 2 séries de 8 à 12, gauche puis droite : 4 lignes, 2 séries.
    expect(targetSummary(LUNGE)).toBe('2 × 8–12 · 14 kg par main');
  });

  it('durée', () => {
    const plank = work({
      measure: 'duration',
      loadMode: 'bodyweight',
      sets: [1, 2, 3].map((position) => ({
        ...(SQUAT.sets[1] as (typeof SQUAT.sets)[number]),
        position,
        targetRepsMin: null,
        targetRepsMax: null,
        targetDurationS: 30,
        targetLoadG: null,
      })),
    });
    expect(targetSummary(plank)).toBe('3 × 30 s');
  });

  it('au poids du corps : sans charge', () => {
    const squat = work({
      loadMode: 'bodyweight',
      sets: SQUAT.sets.map((s) => ({ ...s, targetLoadG: null })),
    });
    expect(targetSummary(squat)).toBe('3 × 6');
  });

  it('calibration : tu choisis ta charge', () => {
    expect(
      targetSummary(work({ calibration: true, sets: SQUAT.sets.map((s) => ({ ...s, targetLoadG: null })) })),
    ).toBe('Calibration : tu choisis ta charge');
  });

  it('calibration d’un exercice sans charge (poids du corps, élastique, durée) : la cible normale', () => {
    const noLoad = SQUAT.sets.map((s) => ({ ...s, targetLoadG: null }));
    const lunges = LUNGE.sets.map((s) => ({ ...s, targetLoadG: null }));
    expect(targetSummary(work({ calibration: true, loadMode: 'bodyweight', sets: noLoad }))).toBe('3 × 6');
    expect(targetSummary(work({ calibration: true, loadMode: 'band', sets: lunges }))).toBe('2 × 8–12');
    const plank = work({
      calibration: true,
      measure: 'duration',
      loadMode: 'bodyweight',
      sets: [1, 2, 3].map((position) => ({
        ...(SQUAT.sets[1] as (typeof SQUAT.sets)[number]),
        position,
        targetRepsMin: null,
        targetRepsMax: null,
        targetDurationS: 30,
        targetLoadG: null,
      })),
    });
    expect(targetSummary(plank)).toBe('3 × 30 s');
  });
});

describe('mentions et avis', () => {
  it('Remplace…, Pas faisable ici : sauté, Suspendu', () => {
    const replaced: PlannedExercise = {
      ...SQUAT,
      exerciseId: 'dumbbell-lunge',
      resolution: 'replaced_not_feasible',
    };
    expect(resolutionNote(replaced, NAMES)).toBe('Remplace Squat barre (pas faisable ici)');
    expect(resolutionNote(SKIPPED, NAMES)).toBe('Pas faisable ici : sauté');
    expect(resolutionNote({ ...SKIPPED, resolution: 'suspended' }, NAMES)).toBe('Suspendu');
    expect(resolutionNote(SQUAT, NAMES)).toBeNull();
  });

  it('fiche prévue retirée du catalogue : « Remplace … (retiré du catalogue) »', () => {
    const replaced: PlannedExercise = {
      ...SQUAT,
      exerciseId: 'goblet-squat',
      resolution: 'replaced_not_feasible',
    };
    expect(resolutionNote(replaced, NAMES, new Set(['back-squat']))).toBe(
      'Remplace Squat barre (retiré du catalogue)',
    );
    expect(resolutionNote(replaced, NAMES, new Set(['goblet-squat']))).toBe(
      'Remplace Squat barre (pas faisable ici)',
    );
  });

  it('reprise après absence', () => {
    expect(noticeText({ code: 'resume', days: 16, pct: 10 }, NAMES)).toBe(
      '16 jours depuis ta dernière séance : charges −10 %',
    );
  });
});

describe('PlanList', () => {
  const plan: PlannedWorkout = {
    workoutId: 'A',
    weekType: 'normal',
    rulesVersion: '1',
    notices: [],
    exercises: [
      SQUAT,
      LUNGE,
      SKIPPED,
      { ...SQUAT, slotId: 'A4', exerciseId: 'goblet-squat', resolution: 'replaced_not_feasible' },
      { ...SKIPPED, slotId: 'A5', resolution: 'suspended' },
    ],
  };

  it('un exercice par slot : nom, cible, mention ; un bouton par exercice utilisable', () => {
    const touched: string[] = [];
    render(<PlanList plan={plan} names={NAMES} onOpen={(id) => touched.push(id)} />);
    const items = within(screen.getByRole('list', { name: 'Exercices de la séance' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toContain('Squat barre');
    expect(items[0]?.textContent).toContain('3 × 6 · 60 kg');
    expect(items[1]?.textContent).toContain('2 × 8–12 · 14 kg par main');
    expect(items[2]?.textContent).toContain('Curl nordique');
    expect(items[2]?.textContent).toContain('Pas faisable ici : sauté');
    expect(items[3]?.textContent).toContain('Squat goblet');
    expect(items[3]?.textContent).toContain('Remplace Squat barre (pas faisable ici)');
    expect(items[4]?.textContent).toContain('Suspendu');
    fireEvent.click(screen.getByRole('button', { name: /^Squat barre/ }));
    expect(touched).toEqual(['back-squat']);
    expect(screen.queryByRole('button', { name: /Curl nordique/ })).toBeNull();
  });

  it('fiche prévue retirée : la mention le dit', () => {
    render(<PlanList plan={plan} names={NAMES} retired={new Set(['back-squat'])} onOpen={() => {}} />);
    const items = within(screen.getByRole('list', { name: 'Exercices de la séance' })).getAllByRole(
      'listitem',
    );
    expect(items[3]?.textContent).toContain('Remplace Squat barre (retiré du catalogue)');
  });
});

describe('séance du jour', () => {
  it('en-tête, lieux (principal présélectionné), séance de la rotation, durée', async () => {
    await open(await seedBase());
    expect(await screen.findByRole('heading', { level: 1, name: 'Corps entier' })).toBeTruthy();
    expect(screen.getByText('Semaine 1 · Séance A')).toBeTruthy();
    const garage = screen.getByRole('radio', { name: 'Garage' }) as HTMLInputElement;
    const salon = screen.getByRole('radio', { name: 'Salon' }) as HTMLInputElement;
    expect(garage.checked).toBe(true);
    expect(salon.checked).toBe(false);
    expect(await screen.findByText('Squat goblet')).toBeTruthy();
    expect(screen.getByText('Durée estimée : 45 min')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mon programme' }).getAttribute('href')).toBe('/program');
    fireEvent.click(salon);
    expect(salon.checked).toBe(true);
  });

  it('« Changer » ouvre la liste des séances du modèle ; le choix remplace la séance', async () => {
    await open(await seedBase());
    await screen.findByText('Squat goblet');
    fireEvent.click(screen.getByRole('button', { name: 'Changer' }));
    const dialog = screen.getByRole('dialog', { name: 'Choisir la séance' });
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(expect.arrayContaining(['Séance A', 'Séance B', 'Séance C']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Séance B' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Fente aux haltères')).toBeTruthy();
    expect(screen.getByText('Semaine 1 · Séance B')).toBeTruthy();
  });

  it('toucher un exercice ouvre sa fiche en feuille du bas', async () => {
    await open(await seedBase());
    fireEvent.click(await screen.findByRole('button', { name: /Squat goblet/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Squat goblet' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('avis de reprise après 16 jours', async () => {
    const db = await seedBase();
    await seedSession(db, {
      id: 's-old',
      status: 'completed',
      deviceId: 'dev-A',
      startedAt: '2026-09-20T08:00:00.000Z',
    });
    await open(db);
    expect(await screen.findByText('16 jours depuis ta dernière séance : charges −10 %')).toBeTruthy();
  });

  it('« Commencer » crée la séance sans appel réseau et ouvre /workout/:id', async () => {
    const view = await open(await seedBase());
    await screen.findByText('Squat goblet');
    const before = view.api.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Commencer' }));
    await waitFor(() => expect(view.location()).toMatch(/^\/workout\/.+/));
    const rows = await view.db.table('workout_session').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workoutId: 'A',
      placeId: 'p-1',
      instanceId: 'i-1',
      status: 'in_progress',
    });
    expect(view.api.calls.slice(before)).toEqual([]);
  });

  it('sans programme : « Choisis ton programme » et « Séance libre »', async () => {
    const view = await open(await seedBase({ template: null }));
    const choose = await screen.findByRole('link', { name: /Choisis ton programme/ });
    expect(choose.getAttribute('href')).toBe('/program/choose');
    fireEvent.click(screen.getByRole('button', { name: 'Séance libre' }));
    await waitFor(() => expect(view.location()).toMatch(/^\/workout\/.+/));
    const rows = await view.db.table('workout_session').toArray();
    expect(rows[0]).toMatchObject({ workoutId: null, instanceId: null, placeId: 'p-1' });
  });

  it('toute la séance sautée : phrase, « Séance libre », « Changer de programme », pas de « Commencer »', async () => {
    const skippedTemplate = {
      ...TEMPLATE,
      workouts: TEMPLATE.workouts.map((w) => ({
        ...w,
        slots: w.slots.map((s) => ({ ...s, exercises: ['nordic-curl'] })),
      })),
    };
    await open(await seedBase({ template: skippedTemplate }));
    expect(
      await screen.findByText("Aucun exercice de cette séance n'est disponible pour l'instant."),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Séance libre' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Changer de programme' }).getAttribute('href')).toBe(
      '/program/choose',
    );
    expect(screen.queryByRole('button', { name: 'Commencer' })).toBeNull();
  });

  it('fiche prévue retirée du catalogue : le slot prend la suivante, « Remplace … (retiré du catalogue) »', async () => {
    const template = {
      ...TEMPLATE,
      workouts: TEMPLATE.workouts.map((w) =>
        w.id === 'A'
          ? {
              ...w,
              slots: w.slots.map((s) => ({ ...s, exercises: ['goblet-squat', 'bulgarian-split-squat'] })),
            }
          : w,
      ),
    };
    const db = await seedBase({ template });
    await db.table('exercises').update('goblet-squat', { status: 'retired' });
    await open(db);
    expect(await screen.findByText('Remplace Squat goblet (retiré du catalogue)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Squat bulgare/ })).toBeTruthy();
  });

  it('séance en cours sur cet appareil : /workout mène à /workout/:id', async () => {
    const db = await seedBase();
    await seedSession(db, {
      id: 's-1',
      status: 'in_progress',
      deviceId: 'dev-A',
      startedAt: '2026-10-06T11:00:00.000Z',
    });
    const view = await open(db);
    await waitFor(() => expect(view.location()).toBe('/workout/s-1'));
  });
});

describe('séance sur un autre appareil', () => {
  async function setup() {
    const db = await seedBase();
    await seedSession(db, {
      id: 's-1',
      status: 'in_progress',
      deviceId: 'dev-Z',
      startedAt: '2026-10-06T11:00:00.000Z',
    });
    const view = await open(db);
    await screen.findByText('Séance en cours sur un autre appareil');
    return view;
  }

  it('propose les trois actions et rien d’autre', async () => {
    await setup();
    expect(screen.getByRole('button', { name: 'Continuer ici' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'La terminer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'La supprimer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commencer' })).toBeNull();
  });

  it('« Continuer ici » reprend la séance ici', async () => {
    const view = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer ici' }));
    await waitFor(() => expect(view.location()).toBe('/workout/s-1'));
    expect((await view.db.table('workout_session').get('s-1')).deviceId).toBe('dev-A');
  });

  it('« La terminer » clôt la séance', async () => {
    const view = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'La terminer' }));
    await waitFor(async () =>
      expect(['completed', 'abandoned']).toContain(
        (await view.db.table('workout_session').get('s-1')).status,
      ),
    );
    expect(await screen.findByRole('button', { name: 'Commencer' })).toBeTruthy();
  });

  it('« La supprimer » demande confirmation puis supprime', async () => {
    const view = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'La supprimer' }));
    const dialog = screen.getByRole('dialog', { name: 'Supprimer cette séance ?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(async () =>
      expect((await view.db.table('workout_session').get('s-1'))?.deletedAt).toBeTruthy(),
    );
  });
});
