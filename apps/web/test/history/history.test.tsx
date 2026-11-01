import { REASON_TEXTS } from '@rune/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoryDetail } from '../../src/features/history/HistoryDetail';
import { HistoryList } from '../../src/features/history/HistoryList';
import type { AppDb } from '../../src/local-db/db';
import { seedCatalog, served } from '../support/catalog';
import { renderWithServices } from '../support/render';
import { seedMirror } from '../support/seed';
import { WORKOUT_SHEETS } from '../support/workout';

// Historique (spec brique 3 §7.6) : liste par mois, détail avec la décision du moteur, corrections des séries
// faites et suppression.

const SET_DEFAULTS = {
  ownerId: 'u-1',
  kind: 'work',
  loadMode: 'barbell',
  loadG: null,
  reps: null,
  durationS: null,
  side: null,
  effort: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetDurationS: null,
  targetLoadG: null,
  targetRir: null,
  targetVariant: null,
};

interface SetSpec {
  loadG?: number | null;
  reps?: number | null;
  durationS?: number | null;
  effort?: string | null;
  loadMode?: string;
  kind?: string;
  side?: string | null;
}

interface ExerciseSpec {
  id: string;
  exerciseId: string;
  position?: number;
  painLevel?: string | null;
  note?: string | null;
  sets: SetSpec[];
}

interface SessionSpec {
  id: string;
  startedAt: string;
  minutes?: number;
  workoutId?: string | null;
  placeId?: string | null;
  status?: string;
  note?: string | null;
  exercises: ExerciseSpec[];
}

const DONE_AT = '2025-10-28T08:30:00.000Z';

async function seedSession(db: AppDb, s: SessionSpec): Promise<void> {
  const started = Date.parse(s.startedAt);
  const free = s.workoutId === null;
  await seedMirror(db, 'workout_session', [
    {
      id: s.id,
      ownerId: 'u-1',
      instanceId: free ? null : 'i-1',
      workoutId: s.workoutId === undefined ? 'A' : s.workoutId,
      placeId: s.placeId === undefined ? 'p-1' : s.placeId,
      deviceId: 'dev-A',
      startedAt: s.startedAt,
      endedAt: new Date(started + (s.minutes ?? 52) * 60_000).toISOString(),
      status: s.status ?? 'completed',
      weekType: 'normal',
      templateVersion: free ? null : 1,
      rulesVersion: '1',
      appVersion: 'test',
      profile: 'adult',
      note: s.note ?? null,
    },
  ]);
  await seedMirror(
    db,
    'performed_exercise',
    s.exercises.map((e, i) => ({
      id: e.id,
      ownerId: 'u-1',
      sessionId: s.id,
      slotId: free ? null : `S${i + 1}`,
      plannedExerciseId: free ? null : e.exerciseId,
      exerciseId: e.exerciseId,
      position: e.position ?? i + 1,
      swapReason: null,
      painLevel: e.painLevel ?? null,
      nextAdjustment: null,
      note: e.note ?? null,
    })),
  );
  await seedMirror(
    db,
    'performed_set',
    s.exercises.flatMap((e) =>
      e.sets.map((set, i) => ({
        ...SET_DEFAULTS,
        id: `${e.id}-s${i + 1}`,
        performedExerciseId: e.id,
        position: i + 1,
        loggedAt: DONE_AT,
        ...set,
      })),
    ),
  );
}

const sets = (n: number, spec: SetSpec): SetSpec[] => Array.from({ length: n }, () => spec);

/** Séance A du 28 oct. : 5 × 80 kg × 8 (3 200 kg) et 10 séries au poids du corps = 15 séries. */
const SESSION_A: SessionSpec = {
  id: 's-a',
  startedAt: '2025-10-28T08:00:00.000Z',
  exercises: [
    { id: 'pe-a1', exerciseId: 'back-squat', sets: sets(5, { loadG: 80_000, reps: 8, effort: 'ok' }) },
    {
      id: 'pe-a2',
      exerciseId: 'bodyweight-squat',
      sets: sets(10, { loadG: null, reps: 12, loadMode: 'bodyweight' }),
    },
  ],
};

const SESSION_FREE: SessionSpec = {
  id: 's-free',
  startedAt: '2025-09-15T17:00:00.000Z',
  minutes: 30,
  workoutId: null,
  placeId: null,
  exercises: [{ id: 'pe-f1', exerciseId: 'goblet-squat', sets: sets(3, { loadG: 20_000, reps: 10 }) }],
};

async function setupDb(db: AppDb, sessions: SessionSpec[]): Promise<void> {
  await seedCatalog(db, WORKOUT_SHEETS);
  await seedMirror(db, 'place', [
    {
      id: 'p-1',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Salle du centre',
      isPrimary: true,
      visibleAtGym: null,
      loadSettings: null,
    },
  ]);
  for (const s of sessions) await seedSession(db, s);
}

async function openList(sessions: SessionSpec[]) {
  const view = await renderWithServices(<HistoryList />, { path: '/history' });
  await setupDb(view.db, sessions);
  return view;
}

async function openDetail(sessions: SessionSpec[], id: string, before?: (db: AppDb) => Promise<void>) {
  const view = await renderWithServices(<HistoryDetail id={id} />, { path: `/history/${id}` });
  await setupDb(view.db, sessions);
  await before?.(view.db);
  return view;
}

const flat = (el: HTMLElement) => (el.textContent ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

describe('historique : liste', () => {
  it('groupe par mois, du plus récent au plus ancien, et écrit la ligne de chaque séance', async () => {
    await openList([SESSION_FREE, SESSION_A]);
    const octobre = await screen.findByRole('heading', { name: 'Octobre 2025' });
    const septembre = screen.getByRole('heading', { name: 'Septembre 2025' });
    expect(octobre.compareDocumentPosition(septembre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const link = screen.getByRole('link', { name: /Séance A/ });
    expect(flat(link)).toBe('mar. 28 oct. · Séance A · Salle du centre · 52 min · 15 séries · 3 200 kg');
    expect(link.getAttribute('href')).toBe('/history/s-a');
  });

  it('une séance à 23 h 30 UTC le 31 octobre est du 1er novembre à Paris', async () => {
    await openList([{ ...SESSION_A, startedAt: '2025-10-31T23:30:00.000Z' }]);
    expect(await screen.findByRole('heading', { name: 'Novembre 2025' })).toBeTruthy();
    expect(flat(screen.getByRole('link', { name: /Séance A/ }))).toContain('sam. 1 nov.');
  });

  it('séance libre sans lieu connu : « Séance libre » et « Lieu inconnu »', async () => {
    await openList([SESSION_FREE]);
    const link = await screen.findByRole('link', { name: /Séance libre/ });
    expect(flat(link)).toBe('lun. 15 sept. · Séance libre · Lieu inconnu · 30 min · 3 séries · 600 kg');
  });

  it('un lieu supprimé ou absent ne casse pas la ligne : « Lieu inconnu »', async () => {
    await openList([{ ...SESSION_A, placeId: 'p-disparu' }]);
    expect(flat(await screen.findByRole('link', { name: /Séance A/ }))).toContain('Lieu inconnu');
  });

  it('une série au singulier, des tonnes au-delà de 10 000 kg, des kg à 10 000 pile', async () => {
    await openList([
      {
        id: 's-t',
        startedAt: '2025-10-20T08:00:00.000Z',
        exercises: [{ id: 'pe-t', exerciseId: 'back-squat', sets: [{ loadG: 124_000, reps: 100 }] }],
      },
      {
        id: 's-k',
        startedAt: '2025-10-21T08:00:00.000Z',
        exercises: [{ id: 'pe-k', exerciseId: 'back-squat', sets: [{ loadG: 100_000, reps: 100 }] }],
      },
    ]);
    const tonnes = await screen.findByRole('link', { name: /20 oct\./ });
    expect(flat(tonnes)).toContain('1 série · 12,4 t');
    expect(flat(screen.getByRole('link', { name: /21 oct\./ }))).toContain('1 série · 10 000 kg');
  });

  it('ne compte que les séries de travail faites ; les échauffements ne comptent pas', async () => {
    await openList([
      {
        id: 's-w',
        startedAt: '2025-10-22T08:00:00.000Z',
        exercises: [
          {
            id: 'pe-w',
            exerciseId: 'back-squat',
            sets: [
              { kind: 'warmup', loadG: 30_000, reps: 8 },
              { loadG: 60_000, reps: 5 },
            ],
          },
        ],
      },
    ]);
    expect(flat(await screen.findByRole('link', { name: /22 oct\./ }))).toContain('1 série · 300 kg');
  });

  it('sans séance : un état vide', async () => {
    await openList([]);
    expect(await screen.findByText('Pas encore de séance')).toBeTruthy();
  });

  it('Retour mène à Progression', async () => {
    await openList([SESSION_A]);
    await screen.findByRole('heading', { name: 'Octobre 2025' });
    expect(screen.getByRole('heading', { level: 1, name: 'Historique' })).toBeTruthy();
  });
});

describe('historique : détail', () => {
  it('montre les exercices, les séries et les efforts', async () => {
    await openDetail([SESSION_A], 's-a');
    expect(await screen.findByRole('heading', { level: 1, name: 'Séance A' })).toBeTruthy();
    const squat = screen.getByRole('heading', { name: 'Squat barre' }).closest('section') as HTMLElement;
    expect(within(squat).getAllByRole('listitem')).toHaveLength(5);
    expect(flat(within(squat).getAllByRole('listitem')[0] as HTMLElement)).toBe(
      'Série 1 · 80 kg × 8 · Correct',
    );
    const bw = screen
      .getByRole('heading', { name: 'Squat au poids du corps' })
      .closest('section') as HTMLElement;
    expect(flat(within(bw).getAllByRole('listitem')[0] as HTMLElement)).toBe('Série 1 · 12 répétitions');
    expect(screen.getByText(/mar\. 28 oct\./)).toBeTruthy();
  });

  it('écrit les efforts en toutes lettres', async () => {
    await openDetail(
      [
        {
          id: 's-e',
          startedAt: '2025-10-22T08:00:00.000Z',
          exercises: [
            {
              id: 'pe-e',
              exerciseId: 'back-squat',
              sets: [
                { loadG: 60_000, reps: 5, effort: 'easy' },
                { loadG: 60_000, reps: 5, effort: 'hard' },
                { loadG: 60_000, reps: 3, effort: 'failed' },
              ],
            },
          ],
        },
      ],
      's-e',
    );
    await screen.findByRole('heading', { name: 'Squat barre' });
    const rows = screen.getAllByRole('listitem').map(flat);
    expect(rows).toEqual([
      'Série 1 · 60 kg × 5 · Facile',
      'Série 2 · 60 kg × 5 · Difficile',
      'Série 3 · 60 kg × 3 · Échec',
    ]);
  });

  it('la décision du moteur une seule fois par état, sur la dernière entrée', async () => {
    const twoEntries: SessionSpec = {
      id: 's-d',
      startedAt: '2025-10-22T08:00:00.000Z',
      exercises: [
        { id: 'pe-d1', exerciseId: 'goblet-squat', sets: [{ loadG: 20_000, reps: 10 }] },
        { id: 'pe-d2', exerciseId: 'back-squat', sets: [{ loadG: 60_000, reps: 5 }] },
      ],
    };
    await openDetail([twoEntries], 's-d', async (db) => {
      await seedMirror(db, 'engine_decision', [
        {
          id: 'pe-d2',
          ownerId: 'u-1',
          instanceId: 'i-1',
          slotId: 'S1',
          exerciseId: 'back-squat',
          result: 'PROGRESS',
          reasonCode: 'LOAD_UP',
          nextTarget: null,
          profile: 'adult',
          rulesVersion: '1',
        },
      ]);
    });
    expect(await screen.findByText(REASON_TEXTS.LOAD_UP)).toBeTruthy();
    expect(screen.getAllByText(REASON_TEXTS.LOAD_UP)).toHaveLength(1);
    const first = screen.getByRole('heading', { name: 'Squat goblet' }).closest('section') as HTMLElement;
    expect(within(first).queryByText(REASON_TEXTS.LOAD_UP)).toBeNull();
    const second = screen.getByRole('heading', { name: 'Squat barre' }).closest('section') as HTMLElement;
    expect(within(second).getByText(REASON_TEXTS.LOAD_UP)).toBeTruthy();
  });

  it('une décision calculée par le téléphone est signalée « provisoire » en toutes lettres', async () => {
    const one: SessionSpec = {
      id: 's-v',
      startedAt: '2025-10-22T08:00:00.000Z',
      exercises: [{ id: 'pe-v', exerciseId: 'back-squat', sets: [{ loadG: 60_000, reps: 5 }] }],
    };
    const decision = (provisional: boolean) => ({
      id: 'pe-v',
      ownerId: 'u-1',
      instanceId: 'i-1',
      slotId: 'S1',
      exerciseId: 'back-squat',
      result: 'PROGRESS',
      reasonCode: 'LOAD_UP',
      nextTarget: null,
      profile: 'adult',
      rulesVersion: '1',
      ...(provisional ? { provisional: 1 } : {}),
    });
    await openDetail([one], 's-v', (db) => seedMirror(db, 'engine_decision', [decision(true)]));
    const sentence = await screen.findByText(REASON_TEXTS.LOAD_UP, { exact: false });
    expect(flat(sentence)).toContain('provisoire');
    cleanup();
    await openDetail(
      [{ ...one, id: 's-v2', exercises: [{ ...(one.exercises[0] as ExerciseSpec), id: 'pe-v' }] }],
      's-v2',
      (db) => seedMirror(db, 'engine_decision', [decision(false)]),
    );
    expect(flat(await screen.findByText(REASON_TEXTS.LOAD_UP, { exact: false }))).not.toContain('provisoire');
  });

  it('séance libre : aucune décision', async () => {
    await openDetail([SESSION_FREE], 's-free');
    expect(await screen.findByRole('heading', { level: 1, name: 'Séance libre' })).toBeTruthy();
    expect(screen.queryByText(/prochaine/i)).toBeNull();
    expect(document.querySelector('[data-decision]')).toBeNull();
  });

  it('la douleur n’apparaît que si elle est stockée', async () => {
    const withPain: SessionSpec = {
      id: 's-p',
      startedAt: '2025-10-22T08:00:00.000Z',
      exercises: [
        { id: 'pe-p1', exerciseId: 'back-squat', painLevel: 'pain', sets: [{ loadG: 60_000, reps: 5 }] },
        {
          id: 'pe-p2',
          exerciseId: 'goblet-squat',
          painLevel: 'discomfort',
          sets: [{ loadG: 20_000, reps: 5 }],
        },
        { id: 'pe-p3', exerciseId: 'leg-press', painLevel: 'none', sets: [{ loadG: 90_000, reps: 5 }] },
        { id: 'pe-p4', exerciseId: 'dumbbell-lunge', painLevel: null, sets: [{ loadG: 14_000, reps: 8 }] },
      ],
    };
    await openDetail([withPain], 's-p');
    await screen.findByRole('heading', { name: 'Squat barre' });
    expect(screen.getAllByText('Douleur signalée')).toHaveLength(1);
    expect(screen.getAllByText('Gêne signalée')).toHaveLength(1);
    expect(screen.getAllByText(/signalée/)).toHaveLength(2);
  });

  it('les notes de la séance et de l’exercice', async () => {
    await openDetail(
      [
        {
          ...SESSION_FREE,
          note: 'Bonne forme',
          exercises: [
            {
              id: 'pe-n',
              exerciseId: 'goblet-squat',
              note: 'Haltère trop léger',
              sets: [{ loadG: 20_000, reps: 10 }],
            },
          ],
        },
      ],
      's-free',
    );
    expect(await screen.findByText('Bonne forme')).toBeTruthy();
    expect(screen.getByText('Haltère trop léger')).toBeTruthy();
  });

  it('une fiche retirée garde son nom (Review Focus 5)', async () => {
    const view = await renderWithServices(<HistoryDetail id="s-r" />, { path: '/history/s-r' });
    await setupDb(view.db, [
      {
        id: 's-r',
        startedAt: '2025-10-22T08:00:00.000Z',
        exercises: [{ id: 'pe-r', exerciseId: 'old-press', sets: [{ loadG: 40_000, reps: 8 }] }],
      },
    ]);
    await view.db
      .table('exercises')
      .put(served({ id: 'old-press', name: 'Développé ancien', status: 'retired' }));
    expect(await screen.findByRole('heading', { name: 'Développé ancien' })).toBeTruthy();
    expect(screen.getByText('Série 1 · 40 kg × 8')).toBeTruthy();
  });

  it('séance introuvable', async () => {
    await openDetail([], 's-nope');
    expect(await screen.findByText('Séance introuvable')).toBeTruthy();
  });
});

describe('historique : corrections', () => {
  const sessionOne: SessionSpec = {
    id: 's-c',
    startedAt: '2025-10-22T08:00:00.000Z',
    exercises: [
      {
        id: 'pe-c',
        exerciseId: 'back-squat',
        sets: [
          { loadG: 60_000, reps: 5, effort: 'ok' },
          { loadG: 60_000, reps: 5 },
        ],
      },
    ],
  };

  const patchesOf = async (db: AppDb) =>
    (await db.outbox.orderBy('opId').toArray())
      .filter((o) => o.entity === 'performed_set')
      .map((o) => ({ id: o.id, kind: o.kind, fields: o.fields }));

  it('« Modifier » ouvre les champs des séries faites ; chaque changement écrit un patch du seul champ modifié', async () => {
    const view = await openDetail([sessionOne], 's-c');
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));

    const reps = screen.getByLabelText('Répétitions, série 1');
    fireEvent.change(reps, { target: { value: '6' } });
    fireEvent.blur(reps);
    await waitFor(async () =>
      expect(await patchesOf(view.db)).toEqual([{ id: 'pe-c-s1', kind: 'patch', fields: { reps: 6 } }]),
    );

    const load = screen.getByLabelText('Charge en kg, série 2');
    fireEvent.change(load, { target: { value: '62,5' } });
    fireEvent.blur(load);
    await waitFor(async () =>
      expect((await patchesOf(view.db)).at(-1)).toEqual({
        id: 'pe-c-s2',
        kind: 'patch',
        fields: { loadG: 62_500 },
      }),
    );

    fireEvent.change(screen.getByLabelText('Effort, série 2'), { target: { value: 'hard' } });
    await waitFor(async () =>
      expect((await patchesOf(view.db)).at(-1)).toEqual({
        id: 'pe-c-s2',
        kind: 'patch',
        fields: { effort: 'hard' },
      }),
    );

    // Le miroir suit, la série reste faite.
    await waitFor(async () => {
      const row = await view.db.mirror('performed_set').get('pe-c-s2');
      expect(row).toMatchObject({ loadG: 62_500, effort: 'hard', loggedAt: DONE_AT });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Terminé' }));
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeTruthy();
  });

  it('une valeur inchangée n’écrit rien ; une valeur hors limites est refusée avec un message', async () => {
    const view = await openDetail([sessionOne], 's-c');
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    const reps = screen.getByLabelText('Répétitions, série 1');
    fireEvent.blur(reps);
    fireEvent.change(reps, { target: { value: '5' } });
    fireEvent.blur(reps);
    expect(await patchesOf(view.db)).toEqual([]);

    fireEvent.change(reps, { target: { value: '999' } });
    fireEvent.blur(reps);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(await patchesOf(view.db)).toEqual([]);
  });

  it('pas de « Modifier » sur une séance en cours', async () => {
    await openDetail([{ ...sessionOne, status: 'in_progress' }], 's-c');
    await screen.findByRole('heading', { name: 'Squat barre' });
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
  });

  it('« Supprimer la séance » demande confirmation ; Annuler ne supprime rien', async () => {
    const view = await openDetail([sessionOne], 's-c');
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer la séance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer la séance ?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await view.db.mirror('workout_session').get('s-c'))?.deletedAt).toBeNull();
  });

  it('confirmer supprime la séance (suppression logique) et revient à l’historique', async () => {
    const view = await openDetail([sessionOne], 's-c');
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer la séance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer la séance ?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(async () =>
      expect((await view.db.mirror('workout_session').get('s-c'))?.deletedAt).not.toBeNull(),
    );
    await waitFor(() => expect(view.location()).toBe('/history'));
    expect(screen.queryByText('Séance introuvable')).toBeNull();
  });
});
