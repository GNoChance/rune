import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlannedExercise, PlannedWorkout } from '@rune/domain';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb, MirrorRow } from '../../src/local-db/db';
import { reposFor, type StartInput } from '../../src/repos';
import ui from '../../src/ui/ui.module.css';
import { parseCssBlocks } from '../support/css-blocks';
import { createFakeSyncEngine } from '../support/fake-api';
import { createTestServices, DEFAULT_NOW, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { LUNGE, SQUAT } from '../support/workout';
import { seedBase } from './seed';

// Séance en cours (`/workout/:id`, spec brique 3 §7.3) sur une vraie base locale : saisie des séries, « Préc. »,
// pas du lieu, effort, menus, fin de séance. Le minuteur de repos, le changement d'exercice et la douleur sont à la
// tâche suivante.

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

/** Gainage au poids du corps, en durée : 2 × 30 s (fiche « Squat au poids du corps » du catalogue de test). */
const PLANK: PlannedExercise = {
  slotId: 'A3',
  plannedExerciseId: 'bodyweight-squat',
  exerciseId: 'bodyweight-squat',
  resolution: 'planned',
  loadMode: 'bodyweight',
  measure: 'duration',
  unilateral: false,
  sets: [1, 2].map((position) => ({
    kind: 'work' as const,
    position,
    side: null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetDurationS: 30,
    targetLoadG: null,
    targetRir: 2,
    targetVariant: null,
  })),
  restS: 60,
  platesPerSide: null,
  calibration: false,
  suggestionG: null,
};

const PLAN: PlannedWorkout = {
  workoutId: 'A',
  weekType: 'normal',
  rulesVersion: '1',
  notices: [],
  exercises: [SQUAT, LUNGE, PLANK],
};

const START: StartInput = {
  plan: PLAN,
  placeId: 'p-1',
  instanceId: 'i-1',
  workoutId: 'A',
  profile: 'adult',
  templateVersion: 1,
};

interface Setup {
  db: AppDb;
  id: string;
}

/** Base de la séance du jour (lieu p-1 : barre 20 kg, disques 1,25 kg, haltères 10 à 16 kg) et séance commencée. */
async function started(
  o: { start?: Partial<StartInput>; before?(db: AppDb): Promise<void> } = {},
): Promise<Setup> {
  const db = await seedBase();
  opened.push(db);
  await o.before?.(db);
  const { services } = await createTestServices({ db });
  const id = await reposFor(services).workouts.start({ ...START, ...o.start });
  return { db, id };
}

async function open(s: Setup, opts: Parameters<typeof renderApp>[0] = {}) {
  const view = await renderApp({ path: `/workout/${s.id}`, db: s.db, ...opts });
  await screen.findByRole('heading', { level: 1, name: 'Séance A' });
  return view;
}

const card = (name: string) => screen.getByRole('region', { name });
const liveSets = async (db: AppDb, performedExerciseId: string): Promise<MirrorRow[]> =>
  (await db.mirror('performed_set').toArray()).filter(
    (r) => r.performedExerciseId === performedExerciseId && r.deletedAt == null,
  );
const exerciseRow = async (db: AppDb, exerciseId: string): Promise<MirrorRow> => {
  const row = (await db.mirror('performed_exercise').toArray()).find((r) => r.exerciseId === exerciseId);
  if (!row) throw new Error(`exercice ${exerciseId} absent`);
  return row;
};
const setRow = async (
  db: AppDb,
  exerciseId: string,
  kind: string,
  position: number,
  side: string | null = null,
) => {
  const pe = await exerciseRow(db, exerciseId);
  const row = (await liveSets(db, pe.id)).find(
    (r) => r.kind === kind && r.position === position && r.side === side,
  );
  if (!row) throw new Error(`série ${kind} ${position} absente`);
  return row;
};

/** Séance close plus ancienne : squat barre 57,5 kg × 7, 8 et 6 (série 1 à 3), sur cet appareil. */
async function seedPrevious(db: AppDb): Promise<void> {
  await seedMirror(db, 'workout_session', [
    {
      id: 's-old',
      ownerId: 'u-1',
      instanceId: null,
      workoutId: null,
      placeId: 'p-1',
      deviceId: 'dev-A',
      startedAt: '2026-10-01T08:00:00.000Z',
      endedAt: '2026-10-01T09:00:00.000Z',
      status: 'completed',
      weekType: 'normal',
      templateVersion: null,
      rulesVersion: '1',
      appVersion: 'dev',
      profile: 'adult',
      note: null,
    },
  ]);
  await seedMirror(db, 'performed_exercise', [
    {
      id: 's-old-pe',
      ownerId: 'u-1',
      sessionId: 's-old',
      slotId: null,
      plannedExerciseId: null,
      exerciseId: 'back-squat',
      swapReason: null,
      position: 1,
      painLevel: null,
      nextAdjustment: null,
      note: null,
    },
  ]);
  await seedMirror(
    db,
    'performed_set',
    [7, 8, 6].map((reps, i) => ({
      id: `s-old-set-${i + 1}`,
      ownerId: 'u-1',
      performedExerciseId: 's-old-pe',
      position: i + 1,
      kind: 'work',
      loadMode: 'barbell',
      loadG: 57_500,
      reps,
      durationS: null,
      side: null,
      effort: null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetDurationS: null,
      targetLoadG: null,
      targetRir: null,
      targetVariant: null,
      loggedAt: '2026-10-01T08:30:00.000Z',
    })),
  );
}

describe('séance en cours : en-tête et cartes', () => {
  it('nom de la séance, durée, « N en attente », exercices dans l’ordre, celui en cours ouvert', async () => {
    const s = await started();
    await open(s, { sync: createFakeSyncEngine({ pending: 3 }) });
    expect(screen.getByText('3 en attente')).toBeTruthy();
    expect(screen.getByText('0:00')).toBeTruthy();
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions).toEqual(['Squat barre', 'Fente aux haltères', 'Squat au poids du corps']);
    const squat = card('Squat barre');
    expect(within(squat).getByText('3 × 6 · 60 kg')).toBeTruthy();
    // Le premier exercice est ouvert, les autres repliés avec « 0 / n ».
    const toggle = (name: string) => within(card(name)).getByRole('button', { name: /^Séries faites/ });
    expect(toggle('Squat barre').getAttribute('aria-expanded')).toBe('true');
    expect(toggle('Fente aux haltères').getAttribute('aria-expanded')).toBe('false');
    expect(toggle('Fente aux haltères').textContent).toContain('0 / 2');
    fireEvent.click(toggle('Fente aux haltères'));
    expect(toggle('Fente aux haltères').getAttribute('aria-expanded')).toBe('true');
  });

  it('colonnes « Série », « Préc. », « kg », « Reps » ; échauffement marqué ; lignes pré-remplies avec la cible', async () => {
    await open(await started());
    const squat = card('Squat barre');
    for (const column of ['Série', 'Préc.', 'kg', 'Reps'])
      expect(within(squat).getByText(column)).toBeTruthy();
    expect(within(squat).getByText('Échauffement')).toBeTruthy();
    const kg = within(squat).getByRole('textbox', {
      name: 'Charge en kg, échauffement 1',
    }) as HTMLInputElement;
    expect(kg.value).toBe('30');
    const work = within(squat).getByRole('textbox', { name: 'Charge en kg, série 3' }) as HTMLInputElement;
    expect(work.value).toBe('60');
    expect(
      (within(squat).getByRole('textbox', { name: 'Répétitions, série 3' }) as HTMLInputElement).value,
    ).toBe('6');
  });

  it('« Préc. » montre la série de même position de la dernière fois et la recopie', async () => {
    await open(await started({ before: seedPrevious }));
    const squat = card('Squat barre');
    const prev = within(squat).getByRole('button', { name: 'Recopier 57,5 kg × 8 dans la série 2' });
    fireEvent.click(prev);
    expect(
      (within(squat).getByRole('textbox', { name: 'Charge en kg, série 2' }) as HTMLInputElement).value,
    ).toBe('57,5');
    expect(
      (within(squat).getByRole('textbox', { name: 'Répétitions, série 2' }) as HTMLInputElement).value,
    ).toBe('8');
  });

  it('+ et − au pas du lieu : barre 62,5 → 65 et 60 kg, haltères 14 → 16 kg', async () => {
    await open(await started());
    const squat = card('Squat barre');
    const warmupKg = within(squat).getByRole('textbox', { name: 'Charge en kg, échauffement 1' });
    fireEvent.change(warmupKg, { target: { value: '62,5' } });
    fireEvent.click(within(squat).getByRole('button', { name: 'Monter la charge' }));
    expect((warmupKg as HTMLInputElement).value).toBe('65');
    fireEvent.change(warmupKg, { target: { value: '62,5' } });
    fireEvent.click(within(squat).getByRole('button', { name: 'Baisser la charge' }));
    expect((warmupKg as HTMLInputElement).value).toBe('60');

    fireEvent.click(within(card('Fente aux haltères')).getByRole('button', { name: /^Séries faites/ }));
    const lunge = card('Fente aux haltères');
    fireEvent.click(within(lunge).getByRole('button', { name: 'Monter la charge' }));
    expect(
      (within(lunge).getByRole('textbox', { name: 'Charge en kg, série 1 gauche' }) as HTMLInputElement)
        .value,
    ).toBe('16');
  });

  it('unilatéral : lignes « Gauche » et « Droite »', async () => {
    await open(await started());
    fireEvent.click(within(card('Fente aux haltères')).getByRole('button', { name: /^Séries faites/ }));
    const lunge = card('Fente aux haltères');
    expect(within(lunge).getAllByText('Gauche')).toHaveLength(2);
    expect(within(lunge).getAllByText('Droite')).toHaveLength(2);
  });

  it('durée : colonne « Secondes » et chronomètre qui la remplit à l’arrêt', async () => {
    const s = await started();
    const view = await open(s);
    fireEvent.click(within(card('Squat au poids du corps')).getByRole('button', { name: /^Séries faites/ }));
    const plank = card('Squat au poids du corps');
    expect(within(plank).getByText('Secondes')).toBeTruthy();
    fireEvent.click(within(plank).getByRole('button', { name: 'Lancer le chrono' }));
    view.services.now = () => DEFAULT_NOW + 35_000;
    fireEvent.click(within(plank).getByRole('button', { name: 'Arrêter le chrono' }));
    expect(
      (within(plank).getByRole('textbox', { name: 'Secondes, série 1' }) as HTMLInputElement).value,
    ).toBe('35');
  });
});

describe('✓ et saisie (Review Focus 4)', () => {
  it('✓ écrit la série et l’affiche faite ; la toucher la rouvre', async () => {
    const s = await started();
    await open(s);
    const squat = card('Squat barre');
    fireEvent.change(within(squat).getByRole('textbox', { name: 'Charge en kg, série 1' }), {
      target: { value: '62.5' },
    });
    fireEvent.click(within(squat).getByRole('button', { name: 'Valider la série 1' }));
    await within(squat).findByRole('button', { name: 'Rouvrir la série 1' });
    expect(await setRow(s.db, 'back-squat', 'work', 1)).toMatchObject({
      loadG: 62_500,
      reps: 6,
      loggedAt: new Date(DEFAULT_NOW).toISOString(),
    });
    fireEvent.click(within(squat).getByRole('button', { name: 'Rouvrir la série 1' }));
    await within(squat).findByRole('button', { name: 'Valider la série 1' });
    expect((await setRow(s.db, 'back-squat', 'work', 1)).loggedAt).toBeNull();
  });

  it.each([
    ['', 'Indique une charge'],
    ['abc', 'Charge invalide'],
    ['600', 'Charge trop élevée'],
  ])('« %s » : « %s » sous le champ, rien d’écrit', async (text, message) => {
    const s = await started();
    await open(s);
    const before = await s.db.outbox.count();
    const squat = card('Squat barre');
    const kg = within(squat).getByRole('textbox', { name: 'Charge en kg, série 1' });
    fireEvent.change(kg, { target: { value: text } });
    fireEvent.click(within(squat).getByRole('button', { name: 'Valider la série 1' }));
    const id = kg.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(id)?.textContent).toContain(message);
    expect(kg.getAttribute('aria-invalid')).toBe('true');
    expect(await s.db.outbox.count()).toBe(before);
    expect((await setRow(s.db, 'back-squat', 'work', 1)).loggedAt).toBeNull();
  });
});

describe('effort', () => {
  it('après la dernière série de travail : feuille aux 4 libellés de 05 §7 et « Plus tard »', async () => {
    const s = await started();
    await open(s);
    const squat = card('Squat barre');
    for (const n of [1, 2]) {
      fireEvent.click(within(squat).getByRole('button', { name: `Valider la série ${n}` }));
      await within(squat).findByRole('button', { name: `Rouvrir la série ${n}` });
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    fireEvent.click(within(squat).getByRole('button', { name: 'Valider la série 3' }));
    // La feuille s'ouvre sur la dernière série de travail ; le reste de l'écran devient inerte.
    const sheet = await screen.findByRole('dialog', { name: 'Effort' });
    expect(within(sheet).getByText('Squat barre · série 3')).toBeTruthy();
    for (const label of [
      "J'aurais pu en faire 4 de plus, ou plus",
      'Encore 2 ou 3',
      'Encore 1, pas plus',
      "La dernière n'est pas passée",
      'Plus tard',
    ]) {
      expect(within(sheet).getByRole('button', { name: label })).toBeTruthy();
    }
    fireEvent.click(within(sheet).getByRole('button', { name: 'Encore 2 ou 3' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(async () => expect((await setRow(s.db, 'back-squat', 'work', 3)).effort).toBe('ok'));
    expect((await setRow(s.db, 'back-squat', 'work', 2)).effort).toBeNull();
    // L'exercice suivant s'ouvre, le premier se replie.
    const toggle = (name: string) => within(card(name)).getByRole('button', { name: /^Séries faites/ });
    await waitFor(() => expect(toggle('Fente aux haltères').getAttribute('aria-expanded')).toBe('true'));
    expect(toggle('Squat barre').getAttribute('aria-expanded')).toBe('false');
    expect(toggle('Squat barre').textContent).toContain('3 / 3');
  });

  it('pastille « Effort » sur une autre série faite', async () => {
    const s = await started();
    await open(s);
    const squat = card('Squat barre');
    fireEvent.click(within(squat).getByRole('button', { name: 'Valider la série 1' }));
    fireEvent.click(await within(squat).findByRole('button', { name: "Noter l'effort de la série 1" }));
    const sheet = await screen.findByRole('dialog', { name: 'Effort' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Encore 1, pas plus' }));
    await within(squat).findByRole('button', { name: 'Effort de la série 1 : Difficile' });
    expect((await setRow(s.db, 'back-squat', 'work', 1)).effort).toBe('hard');
  });
});

describe('menu de l’exercice', () => {
  it('« Ajouter une série » puis « Retirer une série » (non faite)', async () => {
    const s = await started();
    await open(s);
    const pe = await exerciseRow(s.db, 'back-squat');
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Options pour Squat barre' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Squat barre' })).getByRole('button', {
        name: 'Ajouter une série',
      }),
    );
    await within(card('Squat barre')).findByRole('button', { name: 'Valider la série 4' });
    expect((await liveSets(s.db, pe.id)).filter((r) => r.kind === 'work')).toHaveLength(4);

    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Options pour Squat barre' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Squat barre' })).getByRole('button', {
        name: 'Retirer une série',
      }),
    );
    await waitFor(() =>
      expect(within(card('Squat barre')).queryByRole('button', { name: 'Valider la série 4' })).toBeNull(),
    );
    expect((await liveSets(s.db, pe.id)).filter((r) => r.kind === 'work')).toHaveLength(3);
  });

  it('« Retirer une série » absent quand toutes les séries de travail sont faites', async () => {
    const s = await started({
      start: {
        plan: {
          ...PLAN,
          exercises: [{ ...SQUAT, sets: SQUAT.sets.filter((x) => x.position === 1 && x.kind === 'work') }],
        },
      },
    });
    await open(s);
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Valider la série 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Plus tard' }));
    await waitFor(() =>
      expect(
        within(card('Squat barre')).getByRole('button', { name: /^Séries faites/ }).textContent,
      ).toContain('1 / 1'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Options pour Squat barre' }));
    const menu = await screen.findByRole('dialog', { name: 'Squat barre' });
    expect(within(menu).getByRole('button', { name: 'Ajouter une série' })).toBeTruthy();
    expect(within(menu).queryByRole('button', { name: 'Retirer une série' })).toBeNull();
  });
});

describe('menu de la séance', () => {
  it('« Changer de lieu » refait le plan au lieu choisi, puis disparaît après la première série faite', async () => {
    const s = await started();
    await open(s);
    fireEvent.click(screen.getByRole('button', { name: 'Options de la séance' }));
    let menu = await screen.findByRole('dialog', { name: 'Séance A' });
    fireEvent.click(within(menu).getByRole('button', { name: 'Changer de lieu' }));
    const places = await screen.findByRole('dialog', { name: 'Changer de lieu' });
    expect((await within(places).findByRole('button', { name: 'Garage' })).getAttribute('aria-current')).toBe(
      'true',
    );
    fireEvent.click(within(places).getByRole('button', { name: 'Salon' }));
    await waitFor(async () => expect((await s.db.mirror('workout_session').get(s.id))?.placeId).toBe('p-2'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const squat = await screen.findByRole('region', { name: 'Squat goblet' });
    // Calibration au nouveau lieu : pas de charge visée, le membre choisit la sienne.
    expect(within(squat).getByText('Calibration : tu choisis ta charge')).toBeTruthy();
    fireEvent.change(within(squat).getByRole('textbox', { name: 'Charge en kg, série 1' }), {
      target: { value: '12' },
    });
    fireEvent.click(within(squat).getByRole('button', { name: 'Valider la série 1' }));
    await within(squat).findByRole('button', { name: 'Rouvrir la série 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Options de la séance' }));
    menu = await screen.findByRole('dialog', { name: 'Séance A' });
    expect(within(menu).queryByRole('button', { name: 'Changer de lieu' })).toBeNull();
    expect(within(menu).getByRole('button', { name: 'Note de séance' })).toBeTruthy();
  });

  it('« Supprimer la séance » demande confirmation, puis la supprime et mène à /workout', async () => {
    const s = await started();
    const view = await open(s);
    fireEvent.click(screen.getByRole('button', { name: 'Options de la séance' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Séance A' })).getByRole('button', {
        name: 'Supprimer la séance',
      }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Supprimer cette séance ?' });
    expect((await s.db.mirror('workout_session').get(s.id))?.deletedAt ?? null).toBeNull();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(view.location()).toBe('/workout'));
    expect((await s.db.mirror('workout_session').get(s.id))?.deletedAt).toBeTruthy();
  });

  it('note de séance : rappel affiché ; 501 caractères refusés, rien d’écrit ; 500 acceptés', async () => {
    const s = await started();
    await open(s);
    fireEvent.click(screen.getByRole('button', { name: 'Options de la séance' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Séance A' })).getByRole('button', {
        name: 'Note de séance',
      }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Note de séance' });
    expect(
      within(sheet).getByText("N'écris pas d'informations sur ton identité ni sur ta santé."),
    ).toBeTruthy();
    const field = within(sheet).getByRole('textbox', { name: 'Note de séance' });
    fireEvent.change(field, { target: { value: 'a'.repeat(501) } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(sheet).findByText('500 caractères au plus.')).toBeTruthy();
    expect((await s.db.mirror('workout_session').get(s.id))?.note).toBeNull();

    fireEvent.change(field, { target: { value: 'b'.repeat(500) } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () =>
      expect((await s.db.mirror('workout_session').get(s.id))?.note).toBe('b'.repeat(500)),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Terminer', () => {
  it('secondaire tant qu’il reste des séries de travail, principal ensuite', async () => {
    const s = await started({
      start: { plan: { ...PLAN, exercises: [{ ...SQUAT, sets: SQUAT.sets.slice(0, 2) }] } },
    });
    await open(s);
    const finish = () => screen.getByRole('button', { name: 'Terminer' });
    expect(finish().classList.contains(ui.secondary as string)).toBe(true);
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Valider la série 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Plus tard' }));
    await waitFor(() => expect(finish().classList.contains(ui.primary as string)).toBe(true));
  });

  it('effort manquant : feuille de fin, « Noter maintenant » ouvre l’effort', async () => {
    const s = await started();
    await open(s);
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Valider la série 1' }));
    await within(card('Squat barre')).findByRole('button', { name: 'Rouvrir la série 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    const sheet = await screen.findByRole('dialog', { name: 'Avant de terminer' });
    expect(within(sheet).getByText('Squat barre')).toBeTruthy();
    expect(within(sheet).getByText("Effort non noté : la charge n'augmentera pas")).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Terminer quand même' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Noter maintenant' }));
    const effort = await screen.findByRole('dialog', { name: 'Effort' });
    fireEvent.click(within(effort).getByRole('button', { name: 'Encore 2 ou 3' }));
    await waitFor(async () => expect((await setRow(s.db, 'back-squat', 'work', 1)).effort).toBe('ok'));
    expect((await s.db.mirror('workout_session').get(s.id))?.status).toBe('in_progress');
  });

  it('« Terminer quand même » termine la séance et mène à /workout/:id/summary', async () => {
    const s = await started();
    const view = await open(s);
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Valider la série 1' }));
    await within(card('Squat barre')).findByRole('button', { name: 'Rouvrir la série 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Avant de terminer' })).getByRole('button', {
        name: 'Terminer quand même',
      }),
    );
    await waitFor(() => expect(view.location()).toBe(`/workout/${s.id}/summary`));
    expect((await s.db.mirror('workout_session').get(s.id))?.status).toBe('completed');
  });

  it('effort noté partout : fin directe, sans feuille', async () => {
    const s = await started({
      start: { plan: { ...PLAN, exercises: [{ ...SQUAT, sets: SQUAT.sets.slice(0, 2) }] } },
    });
    const view = await open(s);
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Valider la série 1' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Effort' })).getByRole('button', {
        name: 'Encore 2 ou 3',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // La pastille de la série 1 porte l'effort noté (carte repliée : plus de série de travail à faire).
    expect(await screen.findByText('Correct')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    await waitFor(() => expect(view.location()).toBe(`/workout/${s.id}/summary`));
    expect(screen.queryByRole('dialog', { name: 'Avant de terminer' })).toBeNull();
  });
});

describe('séance qui ne s’édite pas ici', () => {
  it('reprise sur un autre appareil : lecture seule, « Cette séance continue sur un autre appareil. »', async () => {
    const s = await started();
    await s.db.mirror('workout_session').update(s.id, { deviceId: 'dev-Z' });
    await renderApp({ path: `/workout/${s.id}`, db: s.db });
    expect(await screen.findByText('Cette séance continue sur un autre appareil.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Valider/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Terminer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Options de la séance' })).toBeNull();
  });

  it('séance close : rien à saisir, renvoi vers l’historique', async () => {
    const s = await started();
    const { services } = await createTestServices({ db: s.db });
    await reposFor(services).workouts.logSet((await setRow(s.db, 'back-squat', 'work', 1)).id, {
      loadG: 60_000,
      reps: 6,
    });
    await reposFor(services).workouts.finish(s.id);
    await renderApp({ path: `/workout/${s.id}`, db: s.db });
    expect(await screen.findByText('Cette séance est terminée.')).toBeTruthy();
    expect(screen.getByRole('link', { name: "Voir dans l'historique" }).getAttribute('href')).toBe(
      `/history/${s.id}`,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('séance inconnue : « Séance introuvable »', async () => {
    const db = await seedBase();
    opened.push(db);
    await renderApp({ path: '/workout/inconnue', db });
    expect(await screen.findByText('Séance introuvable')).toBeTruthy();
  });
});

describe('live.module.css : cibles tactiles et mouvement (spec brique 3 §7.3)', () => {
  const FILE = resolve(import.meta.dirname, '../../src/features/workout/live.module.css');
  const css = () => readFileSync(FILE, 'utf8');
  const rule = (selector: string, media: string | null = null) =>
    new Map(
      parseCssBlocks(css())
        .filter((b) => b.media === media && b.selector.split(', ').includes(selector))
        .flatMap((b) => [...b.declarations]),
    );
  const px = (v: string | undefined) => Number.parseFloat(v ?? '0');

  it('✓, −, + et chrono : 48 × 48 px au moins', () => {
    for (const selector of ['.check', '.step', '.chrono']) {
      expect(px(rule(selector).get('min-width')), selector).toBeGreaterThanOrEqual(48);
      expect(px(rule(selector).get('min-height')), selector).toBeGreaterThanOrEqual(48);
    }
  });

  it('champs, « Préc. », menus et pastille : 48 px de haut au moins (44 pour la pastille)', () => {
    for (const selector of ['.input', '.prev', '.menuButton', '.toggle']) {
      expect(px(rule(selector).get('min-height')), selector).toBeGreaterThanOrEqual(48);
    }
    expect(px(rule('.menuButton').get('min-width'))).toBeGreaterThanOrEqual(48);
    expect(px(rule('.effortChip').get('min-height'))).toBeGreaterThanOrEqual(44);
  });

  it('champs en 16 px (pas de zoom sur iOS) ; « Terminer » en bas, collé au-dessus de la barre d’onglets', () => {
    expect(rule('.input').get('font-size')).toBe('16px');
    expect(rule('.footer').get('position')).toBe('sticky');
    expect(rule('.header').get('position')).toBe('sticky');
  });

  it('carte étroite (texte agrandi, 320 px) : la ligne passe sur deux rangs, ✓ à droite des deux', () => {
    expect(rule('.card').get('container-type')).toBe('inline-size');
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '');
    const query = /@container \(width < ([\d.]+)rem\)\s*\{([\s\S]*?)\n\}/.exec(text);
    expect(query, 'requête de conteneur des lignes').not.toBeNull();
    // Seuil au-dessus de ce que les colonnes demandent : 11,75 rem + 64 px (au texte par défaut, 16 px le rem).
    expect(Number(query?.[1]) * 16).toBeGreaterThanOrEqual(11.75 * 16 + 64);
    const inner = parseCssBlocks(query?.[2] ?? '');
    const decl = (selector: string) =>
      new Map(
        inner.filter((b) => b.selector.split(', ').includes(selector)).flatMap((b) => [...b.declarations]),
      );
    expect(decl('.main').get('grid-template-columns')).toBe('minmax(0, 1fr) minmax(0, 1fr) 48px');
    expect(decl('.main > :nth-child(5)').get('grid-area')).toBe('1 / 3 / 3 / 4');
    expect(decl('.main > :nth-child(n + 6)').get('grid-column')).toBe('1 / -1');
  });

  it('focus jamais caché sous l’en-tête ni sous « Terminer » (WCAG 2.4.11)', () => {
    expect(rule(':global(html):has(.header)').get('scroll-padding-top')).toBeTruthy();
    expect(rule(':global(html):has(.footer)').get('scroll-padding-bottom')).toContain(
      rule('.footer')
        .get('bottom')
        ?.replace(/^calc\((.*) \+ env.*$/, '$1') ?? '?',
    );
  });

  it('aucune couleur écrite en dur : jetons de tokens.css seulement', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi) ?? []).toEqual([]);
  });

  it('mouvement réduit : rien ne bouge', () => {
    for (const block of parseCssBlocks(css())) {
      const animated = block.declarations.has('animation') || block.declarations.has('transition');
      if (!animated || block.media === '(prefers-reduced-motion: reduce)') continue;
      const reduced = rule(block.selector, '(prefers-reduced-motion: reduce)');
      expect(reduced.get('animation') ?? reduced.get('transition'), block.selector).toBe('none');
    }
  });
});
