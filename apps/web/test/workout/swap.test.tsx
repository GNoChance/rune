import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb, MirrorRow } from '../../src/local-db/db';
import { reposFor } from '../../src/repos';
import { createFakeApi, createFakeSyncEngine } from '../support/fake-api';
import { createTestServices, renderApp } from '../support/render';
import { SWAP_START, SWAP_TEMPLATE, seedBase } from './seed';

// Menu « ⋯ » d'un exercice en séance (spec brique 3 §7.3) : « Changer d'exercice » (candidats de 05 §11 et raison),
// « La prochaine fois » (ajustement neutre, 05 §13.6) et « Pas de cette machine » (API en ligne, 05 §12).

const opened: AppDb[] = [];
afterEach(async () => {
  sessionStorage.clear();
  for (const db of opened.splice(0)) await db.delete();
});

async function openSession(o: Parameters<typeof renderApp>[0] = {}) {
  const db = await seedBase({ template: SWAP_TEMPLATE });
  opened.push(db);
  const { services } = await createTestServices({ db });
  const id = await reposFor(services).workouts.start(SWAP_START);
  const view = await renderApp({ path: `/workout/${id}`, db, ...o });
  await screen.findByRole('heading', { level: 1, name: 'Séance A' });
  return { ...view, id };
}

const card = (name: string) => screen.getByRole('region', { name });
const exerciseRows = async (db: AppDb): Promise<MirrorRow[]> =>
  (await db.mirror('performed_exercise').toArray()).filter((r) => r.deletedAt == null);
const rowOf = async (db: AppDb, slotId: string): Promise<MirrorRow> => {
  const row = (await exerciseRows(db)).find((r) => r.slotId === slotId);
  if (!row) throw new Error(`exercice du slot ${slotId} absent`);
  return row;
};

/** Ouvre le menu « ⋯ » de la carte (focus posé dessus, comme un toucher), puis l'entrée `item`. */
async function menu(name: string, item: string) {
  const button = within(card(name)).getByRole('button', { name: `Options pour ${name}` });
  button.focus();
  fireEvent.click(button);
  const sheet = await screen.findByRole('dialog', { name });
  fireEvent.click(within(sheet).getByRole('button', { name: item }));
}

describe('« Changer d’exercice »', () => {
  it('liste les candidats du slot, puis les raisons ; le choix change la fiche et garde la raison', async () => {
    const { db } = await openSession();
    await menu('Squat goblet', "Changer d'exercice");
    const sheet = await screen.findByRole('dialog', { name: "Changer d'exercice" });
    // Exercices du slot utilisables ici, puis les remplaçants ; jamais l'exercice en cours.
    await within(sheet).findByRole('button', { name: 'Squat bulgare' });
    const names = within(sheet)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining(['Squat bulgare', 'Squat au poids du corps']));
    expect(names).not.toContain('Squat goblet');
    // Pas faisables au Garage (barre, presse) : absents.
    expect(names).not.toContain('Squat barre');
    expect(names).not.toContain('Presse à cuisses');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Squat au poids du corps' }));
    const reasons = await screen.findByRole('group', { name: 'Pourquoi ?' });
    expect(
      within(reasons)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Matériel', 'Occupé', 'Douleur', 'Préférence']);
    fireEvent.click(within(reasons).getByRole('button', { name: 'Occupé' }));

    await screen.findByRole('region', { name: 'Squat au poids du corps' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await rowOf(db, 'A1')).toMatchObject({
      exerciseId: 'bodyweight-squat',
      plannedExerciseId: 'goblet-squat',
      swapReason: 'busy',
    });
    // Le focus revient au menu de la carte.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Options pour Squat au poids du corps' }),
      ),
    );
  });

  it('absent quand toutes les séries de l’exercice sont faites', async () => {
    await openSession();
    fireEvent.click(within(card('Squat goblet')).getByRole('button', { name: 'Valider la série 1' }));
    await within(card('Squat goblet')).findByRole('button', { name: 'Corriger la série 1' });
    fireEvent.click(within(card('Squat goblet')).getByRole('button', { name: 'Valider la série 2' }));
    // Dernière série : la feuille d'effort s'ouvre.
    fireEvent.click(await screen.findByRole('button', { name: 'Plus tard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        within(card('Squat goblet')).getByRole('button', { name: /^Séries faites/ }).textContent,
      ).toContain('2 / 2'),
    );
    fireEvent.click(within(card('Squat goblet')).getByRole('button', { name: 'Options pour Squat goblet' }));
    const sheet = await screen.findByRole('dialog', { name: 'Squat goblet' });
    expect(within(sheet).queryByRole('button', { name: "Changer d'exercice" })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Douleur ou gêne' })).toBeTruthy();
  });
});

describe('« La prochaine fois » (ajustement neutre)', () => {
  it('« Ne pas augmenter », « Alléger », puis « Pas d’ajustement »', async () => {
    const { db } = await openSession();
    await menu('Squat goblet', 'La prochaine fois');
    let sheet = await screen.findByRole('dialog', { name: 'La prochaine fois' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ne pas augmenter' }));
    await within(card('Squat goblet')).findByText('La prochaine fois : ne pas augmenter');
    expect((await rowOf(db, 'A1')).nextAdjustment).toBe('hold');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await menu('Squat goblet', 'La prochaine fois');
    sheet = await screen.findByRole('dialog', { name: 'La prochaine fois' });
    expect(within(sheet).getByRole('button', { name: 'Ne pas augmenter' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Alléger' }));
    await within(card('Squat goblet')).findByText('La prochaine fois : alléger');
    expect((await rowOf(db, 'A1')).nextAdjustment).toBe('lighten');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await menu('Squat goblet', 'La prochaine fois');
    sheet = await screen.findByRole('dialog', { name: 'La prochaine fois' });
    fireEvent.click(within(sheet).getByRole('button', { name: "Pas d'ajustement" }));
    await waitFor(() => expect(within(card('Squat goblet')).queryByText(/^La prochaine fois :/)).toBeNull());
    expect((await rowOf(db, 'A1')).nextAdjustment).toBeNull();
  });
});

describe('« Pas de cette machine »', () => {
  it('hors ligne : grisé, avec « Nécessite le réseau »', async () => {
    await openSession({ sync: createFakeSyncEngine({ connection: 'offline' }) });
    fireEvent.click(within(card('Presse à cuisses')).getByRole('button', { name: /^Séries faites/ }));
    fireEvent.click(
      within(card('Presse à cuisses')).getByRole('button', { name: 'Options pour Presse à cuisses' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Presse à cuisses' });
    const item = within(sheet).getByRole('button', { name: 'Pas de cette machine' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    const described = document.getElementById(item.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Nécessite le réseau');
  });

  it('en ligne : le pas saisi part à l’API pour l’état (slot, exercice) ; hors bornes, refusé sans appel', async () => {
    const api = createFakeApi();
    api.on('PUT', '/api/program/slot-states/:id/machine-step', (req) => ({
      status: 200,
      body: {
        slotState: {
          id: 'i-1:A2:leg-press',
          instanceId: 'i-1',
          slotId: 'A2',
          exerciseId: 'leg-press',
          mode: 'sum',
          loadG: null,
          targetReps: null,
          variantRank: null,
          durationS: null,
          machineStepGOverride: (req.body as { stepG: number }).stepG,
          calibrationLeft: 3,
          noProgressCount: 0,
          stallRank: 0,
          suspended: false,
        },
      },
    }));
    await openSession({ api });
    await menu('Presse à cuisses', 'Pas de cette machine');
    const sheet = await screen.findByRole('dialog', { name: 'Pas de cette machine' });
    const field = within(sheet).getByRole('textbox', { name: 'Pas en kg' }) as HTMLInputElement;
    expect(field.value).toBe('5');

    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(sheet).findByText('Entre 0,5 et 10 kg.')).toBeTruthy();
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);

    fireEvent.change(field, { target: { value: '2,5' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.filter((c) => c.method === 'PUT').map((c) => [c.path, c.body])).toEqual([
      ['/api/program/slot-states/i-1%3AA2%3Aleg-press/machine-step', { stepG: 2500 }],
    ]);
  });

  it('absent pour un exercice qui n’est pas sur machine', async () => {
    await openSession();
    fireEvent.click(within(card('Squat goblet')).getByRole('button', { name: 'Options pour Squat goblet' }));
    const sheet = await screen.findByRole('dialog', { name: 'Squat goblet' });
    expect(within(sheet).queryByRole('button', { name: 'Pas de cette machine' })).toBeNull();
  });
});
