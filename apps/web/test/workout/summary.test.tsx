import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REASON_TEXTS } from '@rune/contracts';
import type { PlannedExercise } from '@rune/domain';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { coachLine } from '../../src/features/coach/coach-lines';
import type { AppDb } from '../../src/local-db/db';
import { reposFor, type StartInput } from '../../src/repos';
import { seedCatalog, served } from '../support/catalog';
import { parseCssBlocks } from '../support/css-blocks';
import { createTestServices, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { WORKOUT_SHEETS } from '../support/workout';
import { seedBase } from './seed';

// Fin de séance (`/workout/:id/summary`, spec brique 3 §7.4) : fenêtre du Système « Séance gravée. » (durée, séries
// de travail, kg soulevés), XP gagnée et rang, passage de rang, records battus, « La prochaine fois » (cible et phrase
// du code raison, « provisoire » tant que le serveur n'a pas répondu), bulle du coach, « Terminé ».

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

/** Tirage vertical : groupe Dos seulement (pour monter l'XP sans toucher aux Quadriceps). */
const LAT_PULLDOWN = served({
  id: 'lat-pulldown',
  name: 'Tirage vertical',
  aliases: [],
  movement_pattern: 'vertical_pull',
  load_mode: 'machine',
  primary_muscles: ['lats'],
  secondary_muscles: [],
  equipment_options: [['lat_pulldown']],
});

interface SetSpec {
  kind?: 'warmup' | 'work';
  loadG?: number | null;
  reps?: number | null;
  durationS?: number | null;
  effort?: string | null;
  loadMode?: string;
  /** Faux : série jamais faite (`loggedAt` nul). */
  done?: boolean;
}

interface ExerciseSpec {
  id: string;
  exerciseId: string;
  slotId?: string | null;
  sets: SetSpec[];
}

interface SessionSpec {
  id: string;
  startedAt: string;
  minutes?: number;
  status?: 'completed' | 'abandoned' | 'in_progress';
  /** Séance libre : sans instance ni séance du modèle. */
  free?: boolean;
  exercises: ExerciseSpec[];
}

const repeat = (n: number, spec: SetSpec): SetSpec[] => Array.from({ length: n }, () => spec);

async function seedSession(db: AppDb, s: SessionSpec): Promise<void> {
  const started = Date.parse(s.startedAt);
  const status = s.status ?? 'completed';
  await seedMirror(db, 'workout_session', [
    {
      id: s.id,
      ownerId: 'u-1',
      instanceId: s.free ? null : 'i-1',
      workoutId: s.free ? null : 'A',
      placeId: 'p-1',
      deviceId: 'dev-A',
      startedAt: s.startedAt,
      endedAt: status === 'in_progress' ? null : new Date(started + (s.minutes ?? 52) * 60_000).toISOString(),
      status,
      weekType: 'normal',
      templateVersion: s.free ? null : 1,
      rulesVersion: '1',
      appVersion: 'test',
      profile: 'adult',
      note: null,
    },
  ]);
  await seedMirror(
    db,
    'performed_exercise',
    s.exercises.map((e, i) => ({
      id: e.id,
      ownerId: 'u-1',
      sessionId: s.id,
      slotId: s.free ? null : (e.slotId ?? `A${i + 1}`),
      plannedExerciseId: s.free ? null : e.exerciseId,
      exerciseId: e.exerciseId,
      position: i + 1,
      swapReason: null,
      painLevel: null,
      nextAdjustment: null,
      note: null,
    })),
  );
  await seedMirror(
    db,
    'performed_set',
    s.exercises.flatMap((e) => {
      const counters = { warmup: 0, work: 0 };
      return e.sets.map((set, j) => {
        const kind = set.kind ?? 'work';
        counters[kind] += 1;
        return {
          id: `${e.id}-s${j + 1}`,
          ownerId: 'u-1',
          performedExerciseId: e.id,
          position: counters[kind],
          kind,
          loadMode: set.loadMode ?? 'barbell',
          loadG: set.loadG ?? null,
          reps: set.reps ?? null,
          durationS: set.durationS ?? null,
          side: null,
          effort: set.effort ?? null,
          targetRepsMin: null,
          targetRepsMax: null,
          targetDurationS: null,
          targetLoadG: null,
          targetRir: null,
          targetVariant: null,
          loggedAt: set.done === false ? null : s.startedAt,
        };
      });
    }),
  );
}

async function seedAll(sessions: SessionSpec[], before?: (db: AppDb) => Promise<void>): Promise<AppDb> {
  const db = await seedBase();
  opened.push(db);
  await seedCatalog(db, [...WORKOUT_SHEETS, LAT_PULLDOWN]);
  for (const s of sessions) await seedSession(db, s);
  await before?.(db);
  return db;
}

async function openSummary(id: string, db: AppDb) {
  const view = await renderApp({ path: `/workout/${id}/summary`, db });
  // Écran chargé à la demande : sous la charge de la suite complète, plus d'1 s.
  await screen.findByRole('group', { name: 'Séance gravée.' }, { timeout: 5000 });
  return view;
}

const panel = () => screen.getByRole('group', { name: 'Séance gravée.' });
/** Valeur (`dd`) qui suit un terme (`dt`) de la fenêtre du Système. */
const term = (name: string) =>
  within(panel()).getByText(name, { selector: 'dt' }).nextElementSibling?.textContent?.replace(/\s+/g, ' ');
const flat = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const section = (name: string) => screen.getByRole('region', { name });

/** Séance A du 6 oct. : échauffement, 3 × 60 kg × 6 (effort sur la dernière) et une série jamais faite. */
const TODAY: SessionSpec = {
  id: 's-now',
  startedAt: '2026-10-06T10:00:00.000Z',
  minutes: 52,
  exercises: [
    {
      id: 'pe-now',
      exerciseId: 'back-squat',
      sets: [
        { kind: 'warmup', loadG: 30_000, reps: 8 },
        { loadG: 60_000, reps: 6 },
        { loadG: 60_000, reps: 6 },
        { loadG: 60_000, reps: 6, effort: 'ok' },
        { loadG: 60_000, reps: null, done: false },
      ],
    },
  ],
};

/** Trois séances libres de 28 séries de tirage vertical : 3 × 300 XP plafonnées = 900 XP, rang E. */
const PULL_DAYS: SessionSpec[] = ['2026-09-07', '2026-09-14', '2026-09-21'].map((day, i) => ({
  id: `s-pull-${i + 1}`,
  startedAt: `${day}T08:00:00.000Z`,
  free: true,
  exercises: [
    { id: `pe-pull-${i + 1}`, exerciseId: 'lat-pulldown', sets: repeat(28, { loadG: 40_000, reps: 8 }) },
  ],
}));

describe('fenêtre du Système (spec §7.4)', () => {
  it('« Séance gravée. » : durée, séries de travail faites (sans échauffement ni série jamais faite), kg soulevés', async () => {
    const db = await seedAll([TODAY]);
    await openSummary('s-now', db);
    expect(screen.getByRole('heading', { level: 1, name: 'Séance A' })).toBeTruthy();
    expect(term('Durée')).toBe('52 min');
    expect(term('Séries de travail')).toBe('3');
    // 3 × 60 kg × 6 = 1 080 kg ; l'échauffement ne compte pas.
    expect(term('Total soulevé')).toBe('1 080 kg');
  });

  it('XP gagnée (20 + 3 × 10 + 5 pour l’effort) et rang global avec sa barre', async () => {
    const db = await seedAll([TODAY]);
    await openSummary('s-now', db);
    expect(term('XP gagnée')).toBe('+55 XP');
    const rank = within(panel()).getByRole('img', { name: 'Rang E' });
    expect(rank).toBeTruthy();
    expect(within(panel()).getByText('Rang E · 55 / 1 000 XP')).toBeTruthy();
    const bar = panel().querySelector('[data-xp-bar]') as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    // Avant la séance : 0 XP ; après : 55 / 1 000.
    const fill = bar.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.getPropertyValue('--from')).toBe('0');
    expect(fill.style.getPropertyValue('--to')).toBe('0.055');
    expect(screen.queryByText(/atteint/)).toBeNull();
  });

  it('passage au rang global D : la nouvelle pierre se grave, « Rang D atteint. »', async () => {
    const tenSets: SessionSpec = {
      ...TODAY,
      exercises: [{ id: 'pe-now', exerciseId: 'back-squat', sets: repeat(10, { loadG: 40_000, reps: 5 }) }],
    };
    const db = await seedAll([...PULL_DAYS, tenSets]);
    await openSummary('s-now', db);
    // 900 XP avant, 900 + 20 + 100 = 1 020 après.
    expect(term('XP gagnée')).toBe('+120 XP');
    expect(within(panel()).getByText('Rang D atteint.')).toBeTruthy();
    const engraved = panel().querySelector('[data-rank-up="global"]') as HTMLElement;
    expect(within(engraved).getByRole('img', { name: 'Rang D' })).toBeTruthy();
    expect(within(panel()).getByText('Rang D · 1 020 / 5 000 XP')).toBeTruthy();
    // Nouveau rang : la barre repart de zéro.
    const fill = panel().querySelector('[data-xp-bar] [data-fill]') as HTMLElement;
    expect(fill.style.getPropertyValue('--from')).toBe('0');
    // Aucun groupe ne change de rang (Quadriceps : 10 séries).
    expect(panel().querySelector('[data-rank-up="group"]')).toBeNull();
  });

  it('passage de rang de groupes (Fessiers, Quadriceps au rang D) sans rang global', async () => {
    const before: SessionSpec = {
      id: 's-old',
      startedAt: '2026-09-28T08:00:00.000Z',
      free: true,
      exercises: [{ id: 'pe-old', exerciseId: 'back-squat', sets: repeat(15, { loadG: 40_000, reps: 5 }) }],
    };
    const six: SessionSpec = {
      ...TODAY,
      exercises: [{ id: 'pe-now', exerciseId: 'back-squat', sets: repeat(6, { loadG: 40_000, reps: 5 }) }],
    };
    const db = await seedAll([before, six]);
    await openSummary('s-now', db);
    expect(screen.queryByText(/atteint/)).toBeNull();
    const groups = [...panel().querySelectorAll('[data-rank-up="group"]')] as HTMLElement[];
    // 15 + 6 = 21 séries : rang D (seuil 20) pour les deux groupes dont le squat barre est un muscle principal.
    expect(groups.map(flat)).toEqual(['Fessiers : rang D', 'Quadriceps : rang D']);
    for (const g of groups) expect(within(g).getByRole('img', { name: 'Rang D' })).toBeTruthy();
  });
});

describe('records (spec §7.4, §8.3)', () => {
  it('« Nouveau record : 62,5 kg × 6 » sous le nom de l’exercice, et le volume', async () => {
    const old: SessionSpec = {
      id: 's-old',
      startedAt: '2026-09-28T08:00:00.000Z',
      free: true,
      exercises: [{ id: 'pe-old', exerciseId: 'back-squat', sets: [{ loadG: 60_000, reps: 6 }] }],
    };
    const better: SessionSpec = {
      ...TODAY,
      exercises: [{ id: 'pe-now', exerciseId: 'back-squat', sets: repeat(3, { loadG: 62_500, reps: 6 }) }],
    };
    const db = await seedAll([old, better]);
    await openSummary('s-now', db);
    const records = section('Records battus');
    expect(within(records).getByText('Squat barre')).toBeTruthy();
    expect(within(records).getByText('Nouveau record : 62,5 kg × 6')).toBeTruthy();
    expect(within(records).getByText('Nouveau record de volume : 1 125 kg')).toBeTruthy();
  });

  it('premier passage sur un exercice : aucun record', async () => {
    const db = await seedAll([TODAY]);
    await openSummary('s-now', db);
    expect(screen.queryByRole('region', { name: 'Records battus' })).toBeNull();
    expect(screen.queryByText(/Nouveau record/)).toBeNull();
  });
});

describe('« La prochaine fois » (spec §7.4, ruling R34)', () => {
  const decision = (o: { provisional: boolean }) => ({
    id: 'pe-now',
    ownerId: 'u-1',
    instanceId: 'i-1',
    slotId: 'A1',
    exerciseId: 'back-squat',
    result: 'PROGRESS',
    reasonCode: 'LOAD_UP',
    nextTarget: {
      mode: 'linear',
      loadG: 62_500,
      repsMin: 6,
      repsMax: 6,
      targetReps: 6,
      durationS: null,
      variantId: null,
      workSets: 3,
    },
    profile: 'adult',
    rulesVersion: '1',
    ...(o.provisional ? { provisional: 1 } : {}),
  });

  /** Séance A : squat barre (porte la décision) et squat goblet (entrée sans décision). */
  const TWO: SessionSpec = {
    ...TODAY,
    exercises: [
      ...TODAY.exercises,
      {
        id: 'pe-goblet',
        exerciseId: 'goblet-squat',
        sets: [{ loadG: 14_000, reps: 10, loadMode: 'dumbbell' }],
      },
    ],
  };

  it('une ligne par décision : cible et phrase du code raison, « provisoire » jusqu’à la réponse du serveur', async () => {
    const db = await seedAll([TWO], (d) =>
      seedMirror(d, 'engine_decision', [decision({ provisional: true })]),
    );
    await openSummary('s-now', db);
    const next = section('La prochaine fois');
    const items = within(next).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    const line = items[0] as HTMLElement;
    expect(within(line).getByText('Squat barre')).toBeTruthy();
    expect(within(line).getByText('3 × 6 · 62,5 kg')).toBeTruthy();
    expect(flat(line)).toContain(REASON_TEXTS.LOAD_UP);
    expect(flat(line)).toContain('provisoire');
    // La décision du serveur remplace la copie du téléphone : la mention part.
    await seedMirror(db, 'engine_decision', [decision({ provisional: false })]);
    await waitFor(() => expect(flat(section('La prochaine fois'))).not.toContain('provisoire'));
    expect(flat(section('La prochaine fois'))).toContain(REASON_TEXTS.LOAD_UP);
  });

  it('exercice sauté (aucune série de travail faite, NO_DATA) : pas de ligne', async () => {
    const skipped: SessionSpec = {
      ...TODAY,
      exercises: [
        ...TODAY.exercises,
        {
          id: 'pe-goblet',
          exerciseId: 'goblet-squat',
          sets: [
            { kind: 'warmup', loadG: 8_000, reps: 10, loadMode: 'dumbbell' },
            { loadG: 14_000, reps: null, loadMode: 'dumbbell', done: false },
          ],
        },
      ],
    };
    const noData = {
      ...decision({ provisional: false }),
      id: 'pe-goblet',
      slotId: 'A2',
      exerciseId: 'goblet-squat',
      result: 'IGNORED',
      reasonCode: 'NO_DATA',
    };
    const db = await seedAll([skipped], (d) =>
      seedMirror(d, 'engine_decision', [decision({ provisional: false }), noData]),
    );
    await openSummary('s-now', db);
    const items = within(section('La prochaine fois')).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByText(/Squat/).textContent)).toEqual(['Squat barre']);
    expect(flat(section('La prochaine fois'))).not.toContain(REASON_TEXTS.NO_DATA);
  });

  it('seules des décisions NO_DATA : ni ligne ni « arriveront avec la synchronisation »', async () => {
    const noData = { ...decision({ provisional: false }), result: 'IGNORED', reasonCode: 'NO_DATA' };
    const db = await seedAll([TODAY], (d) => seedMirror(d, 'engine_decision', [noData]));
    await openSummary('s-now', db);
    expect(screen.queryByRole('region', { name: 'La prochaine fois' })).toBeNull();
    expect(screen.queryByText('Tes prochaines cibles arriveront avec la synchronisation.')).toBeNull();
  });

  it('séance de programme encore sans décision : les cibles arriveront avec la synchronisation', async () => {
    const db = await seedAll([TODAY]);
    await openSummary('s-now', db);
    expect(
      within(section('La prochaine fois')).getByText(
        'Tes prochaines cibles arriveront avec la synchronisation.',
      ),
    ).toBeTruthy();
  });

  it('séance libre : pas de « La prochaine fois » (D7)', async () => {
    const db = await seedAll([{ ...TODAY, free: true }]);
    await openSummary('s-now', db);
    expect(screen.getByRole('heading', { level: 1, name: 'Séance libre' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'La prochaine fois' })).toBeNull();
    expect(screen.queryByText(/prochaine/i)).toBeNull();
  });
});

describe('coach, « Terminé » et séances sans résumé', () => {
  it('bulle du coach « Fin de séance » : la ligne session_end du jour de la séance', async () => {
    const db = await seedAll([TODAY]);
    await openSummary('s-now', db);
    const line = coachLine('skald', 'session_end', new Date(TODAY.startedAt), 'lea');
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.getByText('Fin de séance')).toBeTruthy();
    expect(screen.getByText('Le Skald')).toBeTruthy();
  });

  it('« Terminé » ramène à l’accueil', async () => {
    const db = await seedAll([TODAY]);
    const view = await openSummary('s-now', db);
    fireEvent.click(screen.getByRole('button', { name: 'Terminé' }));
    await waitFor(() => expect(view.location()).toBe('/'));
  });

  it('séance abandonnée (ruling R39) : pas de résumé, retour à /workout', async () => {
    const db = await seedAll([{ ...TODAY, status: 'abandoned', exercises: [] }]);
    const view = await renderApp({ path: '/workout/s-now/summary', db });
    await waitFor(() => expect(view.location()).toBe('/workout'));
  });

  it('séance encore en cours : l’écran de séance', async () => {
    const db = await seedAll([{ ...TODAY, status: 'in_progress' }]);
    const view = await renderApp({ path: '/workout/s-now/summary', db });
    await waitFor(() => expect(view.location()).toBe('/workout/s-now'));
  });

  it('séance inconnue : « Séance introuvable »', async () => {
    const db = await seedAll([]);
    await renderApp({ path: '/workout/inconnue/summary', db });
    expect(await screen.findByText('Séance introuvable', undefined, { timeout: 5000 })).toBeTruthy();
  });
});

describe('depuis l’écran de séance', () => {
  /** Squat goblet du slot A1 du modèle de test : 2 × 8–12 à 14 kg. */
  const GOBLET: PlannedExercise = {
    slotId: 'A1',
    plannedExerciseId: 'goblet-squat',
    exerciseId: 'goblet-squat',
    resolution: 'planned',
    loadMode: 'dumbbell',
    measure: 'reps',
    unilateral: false,
    sets: [1, 2].map((position) => ({
      kind: 'work' as const,
      position,
      side: null,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationS: null,
      targetLoadG: 14_000,
      targetRir: 2,
      targetVariant: null,
    })),
    restS: 120,
    platesPerSide: null,
    calibration: false,
    suggestionG: null,
  };
  const START: StartInput = {
    plan: { workoutId: 'A', weekType: 'normal', rulesVersion: '1', notices: [], exercises: [GOBLET] },
    placeId: 'p-1',
    instanceId: 'i-1',
    workoutId: 'A',
    profile: 'adult',
    templateVersion: 1,
  };

  it('« Terminer » mène au résumé : séance gravée et décision provisoire du téléphone', async () => {
    const db = await seedAll([]);
    const { services } = await createTestServices({ db });
    const id = await reposFor(services).workouts.start(START);
    await renderApp({ path: `/workout/${id}`, db });
    const card = await screen.findByRole('region', { name: 'Squat goblet' }, { timeout: 5000 });
    fireEvent.click(within(card).getByRole('button', { name: 'Valider la série 1' }));
    await within(card).findByRole('button', { name: 'Corriger la série 1' });
    fireEvent.click(within(card).getByRole('button', { name: 'Valider la série 2' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Effort' })).getByRole('button', {
        name: 'Encore 2 ou 3',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // La séance observée porte l'effort noté (carte repliée : plus de série à faire).
    expect(await within(card).findByText('Correct')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    await screen.findByRole('group', { name: 'Séance gravée.' }, { timeout: 5000 });
    expect(term('Séries de travail')).toBe('2');
    const next = section('La prochaine fois');
    expect(within(next).getByText('Squat goblet')).toBeTruthy();
    expect(flat(next)).toContain('provisoire');
  }, 20_000);
});

describe('summary.module.css : mouvement et couleurs', () => {
  const FILE = resolve(import.meta.dirname, '../../src/features/workout/summary.module.css');
  const css = () => readFileSync(FILE, 'utf8');
  const REDUCE = '(prefers-reduced-motion: reduce)';
  const rule = (selector: string, media: string | null = null) =>
    new Map(
      parseCssBlocks(css())
        .filter((b) => b.media === media && b.selector.split(', ').includes(selector))
        .flatMap((b) => [...b.declarations]),
    );

  it('la pierre se grave (comme « Éveil terminé ») ; en mouvement réduit, un fondu court, sans étincelles', () => {
    expect(rule('.engrave').get('animation')).toContain('rank-engrave');
    const reduced = rule('.engrave', REDUCE);
    expect(reduced.get('animation-name')).toBe('fade');
    expect(reduced.get('animation-duration')).toBe('var(--dur-fast)');
    expect(reduced.get('animation-delay')).toBe('0ms');
    expect(rule('.spark', REDUCE).get('display')).toBe('none');
  });

  it('la barre se remplit ; en mouvement réduit, elle est là tout de suite', () => {
    expect(rule('.xpFill').get('animation')).toContain('xp-fill');
    expect(rule('.xpFill', REDUCE).get('animation')).toBe('none');
  });

  it('chaque bloc animé a sa règle de mouvement réduit', () => {
    for (const block of parseCssBlocks(css())) {
      const animated = block.declarations.has('animation');
      if (!animated || block.media === REDUCE) continue;
      const reduced = rule(block.selector, REDUCE);
      expect(reduced.get('animation') ?? reduced.get('animation-name'), block.selector).toBeDefined();
    }
  });

  it('aucune couleur écrite en dur : jetons de tokens.css seulement', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi) ?? []).toEqual([]);
  });
});
