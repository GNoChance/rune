import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridFor } from '../../src/features/workout/number-input';
import { SetRow, type SetRowProps } from '../../src/features/workout/SetRow';
import type { AppDb } from '../../src/local-db/db';
import type { SetInput, WorkoutSetView } from '../../src/repos';
import { DEFAULT_NOW, renderWithServices } from '../support/render';

// Une ligne de série de l'écran de séance (spec brique 3 §7.3) : Série · Préc. · kg · Reps · ✓, valeurs
// pré-remplies avec la cible, − / + au pas réalisable du lieu, saisie contrôlée avant toute écriture (Review Focus 4).

const SETTINGS = {
  barG: 20_000,
  smallestPlateG: 1250,
  dumbbellsG: [10_000, 12_000, 14_000, 16_000],
  machineStepG: 5000,
};
const BARBELL = gridFor('barbell', SETTINGS, null);
const DUMBBELL = gridFor('dumbbell', SETTINGS, null);

const line = (o: Partial<WorkoutSetView> = {}): WorkoutSetView => ({
  id: 'set-1',
  performedExerciseId: 'pe-1',
  position: 1,
  kind: 'work',
  loadMode: 'barbell',
  loadG: null,
  reps: null,
  durationS: null,
  side: null,
  effort: null,
  targetRepsMin: 6,
  targetRepsMax: 6,
  targetDurationS: null,
  targetLoadG: 60_000,
  targetRir: 2,
  targetVariant: null,
  loggedAt: null,
  ...o,
});

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function renderRow(o: Partial<SetRowProps> = {}) {
  const onLog = vi.fn<(values: SetInput) => Promise<void>>(async () => {});
  const onReopen = vi.fn(async () => {});
  const onEffort = vi.fn();
  const onActivate = vi.fn();
  const props: SetRowProps = {
    line: line(),
    previous: null,
    grid: BARBELL,
    measure: 'reps',
    active: true,
    readOnly: false,
    effortChip: false,
    onLog,
    onReopen,
    onEffort,
    onActivate,
    ...o,
  };
  const view = await renderWithServices(
    <ul>
      <SetRow {...props} />
    </ul>,
  );
  opened.push(view.db);
  return { ...view, onLog, onReopen, onEffort, onActivate };
}

const input = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const type = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });
const errorOf = (field: HTMLElement) => {
  const ids = (field.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
};

describe('ligne de série : valeurs de départ', () => {
  it('pré-remplie avec la cible ; clavier décimal pour la charge, numérique pour les répétitions', async () => {
    await renderRow();
    expect(input('Charge en kg, série 1').value).toBe('60');
    expect(input('Charge en kg, série 1').getAttribute('inputmode')).toBe('decimal');
    expect(input('Répétitions, série 1').value).toBe('6');
    expect(input('Répétitions, série 1').getAttribute('inputmode')).toBe('numeric');
  });

  it('fourchette de répétitions : le bas de la fourchette ; charge visée à virgule', async () => {
    await renderRow({ line: line({ targetRepsMin: 8, targetRepsMax: 12, targetLoadG: 62_500 }) });
    expect(input('Charge en kg, série 1').value).toBe('62,5');
    expect(input('Répétitions, série 1').value).toBe('8');
  });

  it('sans charge visée (calibration) : champ de charge vide', async () => {
    await renderRow({ line: line({ targetLoadG: null }) });
    expect(input('Charge en kg, série 1').value).toBe('');
  });

  it('poids du corps : pas de colonne kg', async () => {
    await renderRow({
      line: line({ loadMode: 'bodyweight', targetLoadG: null }),
      grid: gridFor('bodyweight', SETTINGS, null),
    });
    expect(screen.queryByRole('textbox', { name: /Charge/ })).toBeNull();
    expect(input('Répétitions, série 1').value).toBe('6');
  });

  it('échauffement : nommé comme tel', async () => {
    await renderRow({
      line: line({ kind: 'warmup', targetLoadG: 30_000, targetRepsMin: 8, targetRepsMax: 8 }),
    });
    expect(input('Charge en kg, échauffement 1').value).toBe('30');
    expect(screen.getByRole('button', { name: "Valider l'échauffement 1" })).toBeTruthy();
  });

  it('unilatéral : la ligne porte son côté (« Gauche », « Droite »)', async () => {
    await renderRow({ line: line({ side: 'left' }) });
    expect(screen.getByText('Gauche')).toBeTruthy();
    expect(input('Charge en kg, série 1 gauche')).toBeTruthy();
  });
});

describe('« Préc. » : la série de même position de la dernière fois', () => {
  it('affichée, et recopiée au toucher', async () => {
    await renderRow({ previous: line({ id: 'old', loadG: 57_500, reps: 7, loggedAt: 1 }) });
    const prev = screen.getByRole('button', { name: 'Recopier 57,5 kg × 7 dans la série 1' });
    expect(prev.textContent).toBe('57,5 × 7');
    fireEvent.click(prev);
    expect(input('Charge en kg, série 1').value).toBe('57,5');
    expect(input('Répétitions, série 1').value).toBe('7');
  });

  it('rien la dernière fois : un tiret, pas de bouton', async () => {
    await renderRow();
    expect(screen.queryByRole('button', { name: /Recopier/ })).toBeNull();
  });
});

describe('− / + au pas réalisable du lieu', () => {
  it('barre : + sur 62,5 kg → 65 kg, − sur 62,5 kg → 60 kg', async () => {
    await renderRow();
    type('Charge en kg, série 1', '62,5');
    fireEvent.click(screen.getByRole('button', { name: 'Monter la charge' }));
    expect(input('Charge en kg, série 1').value).toBe('65');
    type('Charge en kg, série 1', '62,5');
    fireEvent.click(screen.getByRole('button', { name: 'Baisser la charge' }));
    expect(input('Charge en kg, série 1').value).toBe('60');
  });

  it('haltères : + sur 14 kg → 16 kg', async () => {
    await renderRow({ line: line({ loadMode: 'dumbbell', targetLoadG: 14_000 }), grid: DUMBBELL });
    fireEvent.click(screen.getByRole('button', { name: 'Monter la charge' }));
    expect(input('Charge en kg, série 1').value).toBe('16');
  });

  it('répétitions ± 1, jamais sous 0', async () => {
    await renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Une répétition de plus' }));
    expect(input('Répétitions, série 1').value).toBe('7');
    fireEvent.click(screen.getByRole('button', { name: 'Une répétition de moins' }));
    fireEvent.click(screen.getByRole('button', { name: 'Une répétition de moins' }));
    expect(input('Répétitions, série 1').value).toBe('5');
    type('Répétitions, série 1', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Une répétition de moins' }));
    expect(input('Répétitions, série 1').value).toBe('0');
  });

  it('barre : disques par côté de la charge en cours (« Par côté : 20 + 1,25 »)', async () => {
    await renderRow();
    type('Charge en kg, série 1', '62,5');
    expect(screen.getByText('Par côté : 20 + 1,25')).toBeTruthy();
  });

  it('pas de − / + sur une ligne qui n’est pas en cours', async () => {
    await renderRow({ active: false });
    expect(screen.queryByRole('button', { name: 'Monter la charge' })).toBeNull();
  });
});

describe('✓ : saisie contrôlée (Review Focus 4)', () => {
  it('« 62,5 » et « 62.5 » écrivent 62 500 g', async () => {
    const { onLog } = await renderRow();
    type('Charge en kg, série 1', '62,5');
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    await waitFor(() => expect(onLog).toHaveBeenCalledWith({ loadG: 62_500, reps: 6 }));
    type('Charge en kg, série 1', '62.5');
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    await waitFor(() => expect(onLog).toHaveBeenCalledTimes(2));
    expect(onLog).toHaveBeenLastCalledWith({ loadG: 62_500, reps: 6 });
  });

  it.each([
    ['', 'Indique une charge'],
    ['abc', 'Charge invalide'],
    ['600', 'Charge trop élevée'],
  ])('« %s » : « %s » sous le champ, rien d’écrit', async (text, message) => {
    const { onLog } = await renderRow();
    type('Charge en kg, série 1', text);
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    const field = input('Charge en kg, série 1');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(field)).toContain(message);
    // Le champ fautif prend le focus : son message est lu avec lui.
    expect(document.activeElement).toBe(field);
    expect(onLog).not.toHaveBeenCalled();
    // Une saisie corrigée efface le message.
    type('Charge en kg, série 1', '60');
    expect(input('Charge en kg, série 1').getAttribute('aria-invalid')).toBeNull();
  });

  it('répétitions vides ou fausses : message sous le champ, rien d’écrit', async () => {
    const { onLog } = await renderRow();
    type('Répétitions, série 1', '6,5');
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    expect(errorOf(input('Répétitions, série 1'))).toContain('Nombre invalide');
    type('Répétitions, série 1', '');
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    expect(errorOf(input('Répétitions, série 1'))).toContain('Indique un nombre');
    type('Répétitions, série 1', '201');
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    expect(errorOf(input('Répétitions, série 1'))).toContain('Nombre trop élevé');
    expect(onLog).not.toHaveBeenCalled();
  });

  it('poids du corps : seulement les répétitions', async () => {
    const { onLog } = await renderRow({
      line: line({ loadMode: 'bodyweight', targetLoadG: null }),
      grid: gridFor('bodyweight', SETTINGS, null),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    await waitFor(() => expect(onLog).toHaveBeenCalledWith({ reps: 6 }));
  });
});

describe('série faite', () => {
  const done = line({ loadG: 62_500, reps: 6, loggedAt: DEFAULT_NOW });

  it('valeurs affichées, plus de champ ; la toucher la rouvre', async () => {
    const { onReopen } = await renderRow({ line: done });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('62,5')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rouvrir la série 1' }));
    await waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1));
  });

  it('pastille « Effort » facultative', async () => {
    const { onEffort } = await renderRow({ line: done, effortChip: true });
    fireEvent.click(screen.getByRole('button', { name: "Noter l'effort de la série 1" }));
    expect(onEffort).toHaveBeenCalledTimes(1);
  });

  it('pastille avec l’effort noté', async () => {
    await renderRow({ line: { ...done, effort: 'ok' }, effortChip: true });
    const chip = screen.getByRole('button', { name: 'Effort de la série 1 : Correct' });
    expect(chip.textContent).toBe('Correct');
  });

  it('lecture seule : ni champ ni bouton', async () => {
    await renderRow({ line: line(), readOnly: true });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('exercice en durée', () => {
  const plank = line({
    loadMode: 'bodyweight',
    targetRepsMin: null,
    targetRepsMax: null,
    targetDurationS: 30,
    targetLoadG: null,
  });

  it('champ « Secondes » pré-rempli ; ✓ écrit la durée', async () => {
    const { onLog } = await renderRow({
      line: plank,
      measure: 'duration',
      grid: gridFor('bodyweight', SETTINGS, null),
    });
    expect(input('Secondes, série 1').value).toBe('30');
    fireEvent.click(screen.getByRole('button', { name: 'Valider la série 1' }));
    await waitFor(() => expect(onLog).toHaveBeenCalledWith({ durationS: 30 }));
  });

  it('le chronomètre remplit « Secondes » à l’arrêt', async () => {
    const view = await renderRow({
      line: plank,
      measure: 'duration',
      grid: gridFor('bodyweight', SETTINGS, null),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lancer le chrono' }));
    view.services.now = () => DEFAULT_NOW + 42_400;
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter le chrono' }));
    expect(input('Secondes, série 1').value).toBe('42');
    expect(screen.getByRole('button', { name: 'Lancer le chrono' })).toBeTruthy();
  });
});
