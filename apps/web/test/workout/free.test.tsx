import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb, MirrorRow } from '../../src/local-db/db';
import { reposFor } from '../../src/repos';
import { seedCatalog, served } from '../support/catalog';
import { parseCssBlocks } from '../support/css-blocks';
import { createTestServices, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { WORKOUT_SHEETS } from '../support/workout';
import { seedBase } from './seed';

// Séance libre (spec brique 3 §7.5) : on ajoute des exercices par recherche dans le catalogue, avec le filtre
// « Faisable : <lieu> » de la brique 2 au lieu de la séance, puis des séries sans cible. Pas de décision du moteur
// (D7), pas de minuteur de repos (ruling R45), l'effort reste facultatif ; même fin de séance, sans « La prochaine
// fois ».

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

/** Deux développés couchés sans alias : aux haltères (faisable au Salon) et à la barre (pas au Salon). */
const BENCH_SHEETS = [
  served({
    id: 'db-bench',
    name: 'Développé couché aux haltères',
    aliases: [],
    movement_pattern: 'horizontal_push',
    load_mode: 'dumbbell',
    primary_muscles: ['chest'],
    secondary_muscles: ['triceps'],
    equipment_options: [['dumbbells']],
  }),
  served({
    id: 'bar-bench',
    name: 'Développé couché à la barre',
    aliases: [],
    movement_pattern: 'horizontal_push',
    load_mode: 'barbell',
    primary_muscles: ['chest'],
    secondary_muscles: ['triceps'],
    equipment_options: [['barbell']],
  }),
];

/**
 * Séance libre commencée au Salon (haltères seulement), alors que le lieu principal, le Garage, a aussi une barre :
 * le filtre doit suivre le lieu de la séance.
 */
async function freeSession(): Promise<{ db: AppDb; id: string }> {
  const db = await seedBase();
  opened.push(db);
  await seedCatalog(db, [...WORKOUT_SHEETS, ...BENCH_SHEETS]);
  await seedMirror(db, 'home_equipment', [
    { id: 'p-1:barbell', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'barbell' },
  ]);
  const { services } = await createTestServices({ db });
  const id = await reposFor(services).workouts.start({
    plan: null,
    placeId: 'p-2',
    instanceId: null,
    workoutId: null,
    templateVersion: null,
  });
  return { db, id };
}

async function open(s: { db: AppDb; id: string }) {
  const view = await renderApp({ path: `/workout/${s.id}`, db: s.db });
  await screen.findByRole('heading', { level: 1, name: 'Séance libre' }, { timeout: 5000 });
  return view;
}

const liveRows = async (db: AppDb, entity: string): Promise<MirrorRow[]> =>
  (await db.mirror(entity).toArray()).filter((r) => r.deletedAt == null);

/** Ouvre la recherche, tape `query` et rend la feuille. */
async function search(query: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un exercice' }));
  const sheet = await screen.findByRole('dialog', { name: 'Ajouter un exercice' });
  fireEvent.change(within(sheet).getByRole('searchbox', { name: 'Rechercher un exercice' }), {
    target: { value: query },
  });
  return sheet;
}

/** Ajoute le développé couché aux haltères et attend sa carte. */
async function addBench(): Promise<HTMLElement> {
  const sheet = await search('développé couché');
  fireEvent.click(await within(sheet).findByRole('button', { name: 'Développé couché aux haltères' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  return screen.findByRole('region', { name: 'Développé couché aux haltères' });
}

describe('séance libre (spec §7.5)', () => {
  it('séance vide : une phrase et « Ajouter un exercice », aucune carte', async () => {
    await open(await freeSession());
    expect(screen.getByText('Ajoute un exercice pour commencer.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajouter un exercice' })).toBeTruthy();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('recherche avec le filtre « Faisable : <lieu de la séance> » de la brique 2', async () => {
    await open(await freeSession());
    const sheet = await search('développé couché');
    const filter = await within(sheet).findByRole('switch', { name: 'Faisable : Salon' });
    expect(filter.getAttribute('aria-checked')).toBe('true');
    expect(await within(sheet).findByRole('button', { name: 'Développé couché aux haltères' })).toBeTruthy();
    // La barre est au Garage (lieu principal), pas au Salon (lieu de la séance).
    expect(within(sheet).queryByRole('button', { name: 'Développé couché à la barre' })).toBeNull();
    fireEvent.click(filter);
    expect(await within(sheet).findByRole('button', { name: 'Développé couché à la barre' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Faisable : Salon' }));
    await waitFor(() =>
      expect(within(sheet).queryByRole('button', { name: 'Développé couché à la barre' })).toBeNull(),
    );
  });

  it('rien de faisable : « Aucun exercice ne correspond. » et les fiches masquées par le filtre, « Les voir »', async () => {
    await open(await freeSession());
    const sheet = await search('à la barre');
    expect(await within(sheet).findByText('Aucun exercice ne correspond.')).toBeTruthy();
    expect(within(sheet).getByText(/1 exercice masqué par le filtre Faisable/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Les voir' }));
    expect(await within(sheet).findByRole('button', { name: 'Développé couché à la barre' })).toBeTruthy();
  });

  it('l’exercice choisi arrive avec une série sans cible ; « Ajouter une série » en ajoute une autre', async () => {
    const s = await freeSession();
    await open(s);
    const card = await addBench();
    // Ni cible, ni calibration : des champs vides.
    expect(within(card).queryByText(/×|Calibration/)).toBeNull();
    expect(
      (within(card).getByRole('textbox', { name: 'Charge en kg, série 1' }) as HTMLInputElement).value,
    ).toBe('');
    expect(
      (within(card).getByRole('textbox', { name: 'Répétitions, série 1' }) as HTMLInputElement).value,
    ).toBe('');
    const [exercise] = await liveRows(s.db, 'performed_exercise');
    expect(exercise).toMatchObject({ exerciseId: 'db-bench', slotId: null, plannedExerciseId: null });
    const [set] = await liveRows(s.db, 'performed_set');
    expect(set).toMatchObject({
      kind: 'work',
      position: 1,
      targetRepsMin: null,
      targetRepsMax: null,
      targetLoadG: null,
      targetDurationS: null,
      loggedAt: null,
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Ajouter une série' }));
    expect(await within(card).findByRole('textbox', { name: 'Charge en kg, série 2' })).toBeTruthy();
    expect(await liveRows(s.db, 'performed_set')).toHaveLength(2);
  });

  it('une série validée : ni feuille d’effort, ni minuteur de repos (ruling R45)', async () => {
    const s = await freeSession();
    await open(s);
    const card = await addBench();
    fireEvent.change(within(card).getByRole('textbox', { name: 'Charge en kg, série 1' }), {
      target: { value: '14' },
    });
    fireEvent.change(within(card).getByRole('textbox', { name: 'Répétitions, série 1' }), {
      target: { value: '10' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Valider la série 1' }));
    await within(card).findByRole('button', { name: 'Corriger la série 1' });
    const [set] = await liveRows(s.db, 'performed_set');
    expect(set).toMatchObject({ loadG: 14_000, reps: 10 });
    expect(set?.loggedAt).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByText(/^Repos/)).toBeNull();
  });

  it('effort non noté : demandé une fois à la fin (05 §7), facultatif ; puis le résumé, sans « La prochaine fois »', async () => {
    const s = await freeSession();
    const view = await open(s);
    const card = await addBench();
    fireEvent.change(within(card).getByRole('textbox', { name: 'Charge en kg, série 1' }), {
      target: { value: '14' },
    });
    fireEvent.change(within(card).getByRole('textbox', { name: 'Répétitions, série 1' }), {
      target: { value: '10' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Valider la série 1' }));
    await within(card).findByRole('button', { name: 'Corriger la série 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    const finish = await screen.findByRole('dialog', { name: 'Avant de terminer' });
    expect(within(finish).getByText('Effort non noté sur la dernière série')).toBeTruthy();
    expect(within(finish).queryByText(/la charge n'augmentera pas/)).toBeNull();
    expect(within(finish).getByText('Développé couché aux haltères')).toBeTruthy();
    fireEvent.click(within(finish).getByRole('button', { name: 'Terminer quand même' }));
    await waitFor(() => expect(view.location()).toBe(`/workout/${s.id}/summary`));
    expect(await screen.findByRole('group', { name: 'Séance gravée.' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'La prochaine fois' })).toBeNull();
  });

  it('effort noté sur la dernière série (pastille « Effort ») : fin directe', async () => {
    const s = await freeSession();
    const view = await open(s);
    const card = await addBench();
    fireEvent.change(within(card).getByRole('textbox', { name: 'Charge en kg, série 1' }), {
      target: { value: '14' },
    });
    fireEvent.change(within(card).getByRole('textbox', { name: 'Répétitions, série 1' }), {
      target: { value: '10' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Valider la série 1' }));
    fireEvent.click(await within(card).findByRole('button', { name: "Noter l'effort de la série 1" }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Effort' })).getByRole('button', {
        name: 'Encore 2 ou 3',
      }),
    );
    await within(card).findByRole('button', { name: 'Effort de la série 1 : Correct' });
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    await waitFor(() => expect(view.location()).toBe(`/workout/${s.id}/summary`));
    expect(screen.queryByRole('dialog', { name: 'Avant de terminer' })).toBeNull();
  });
});

describe('live.module.css : cibles de la séance libre (écran de séance, 48 px)', () => {
  const FILE = resolve(import.meta.dirname, '../../src/features/workout/live.module.css');
  const rule = (selector: string) =>
    new Map(
      parseCssBlocks(readFileSync(FILE, 'utf8'))
        .filter((b) => b.media === null && b.selector.split(', ').includes(selector))
        .flatMap((b) => [...b.declarations]),
    );

  it('« Ajouter une série », « Les voir » et les résultats de la recherche : 48 px de haut au moins', () => {
    for (const selector of ['.addSet', '.textButton', '.menuItem']) {
      expect(Number.parseFloat(rule(selector).get('min-height') ?? '0'), selector).toBeGreaterThanOrEqual(48);
    }
  });
});
