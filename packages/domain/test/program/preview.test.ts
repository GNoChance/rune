/*
 * `changePreview` et `loadIncreases` (spec brique 4 §12.2 étape 6, §12.4, choix C6) : charge prévue de chaque slot à
 * sa prochaine séance au lieu principal, avant et après un changement, et slots où elle monte. `lastLoadsOf` :
 * dernière charge de travail faite par exercice (calibration, spec brique 3 §4.3.5).
 */
import {
  type ChangeAuthor,
  defaultLoadSettings,
  type InstanceChangeOperation,
  REFERENCE_PROFILES,
  type SetKind,
} from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  type ChangePreviewInput,
  changePreview,
  lastLoadsOf,
  loadIncreases,
  type SlotLoadPreview,
} from '../../src/program/preview';
import type { PlanSheet } from '../../src/program/resolve';
import type { ExerciseRecord, SessionRecord, SetRecord } from '../../src/program/types';
import { GYM_AB, PLACES, PROGRAM_CATALOG, place } from '../fixtures/program';

const fail = (what: string): never => {
  throw new Error(`${what} absent`);
};

const INSTANCE = 'inst-1';
const CHANGE = 'chg-1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Lundi 2 novembre 2026, 18 h à Paris (UTC+1). */
const T0 = Date.UTC(2026, 10, 2, 17);
const at = (day: number) => T0 + day * DAY;
/** Quatre jours après la dernière séance des cas : pas de reprise après absence. */
const TODAY = '2026-11-08';

/** Catalogue des programmes avec sa mesure : les gainages se tiennent en secondes, le reste se compte en répétitions. */
const CATALOG: PlanSheet[] = PROGRAM_CATALOG.map((s) => ({
  ...s,
  measure: s.movement_pattern === 'core_anti_extension' ? 'duration' : 'reps',
}));

/** Lieu principal : la salle de référence, barre de 20 kg, plus petit disque de 1,25 kg, machines au pas de 5 kg. */
const GYM = {
  ...place('gym', REFERENCE_PROFILES.gym_reference),
  loadSettings: { ...defaultLoadSettings('gym'), barG: 20_000, smallestPlateG: 1250 },
};

// ---------------------------------------------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------------------------------------------

let seq = 0;

function set(
  kind: SetKind,
  loadG: number | null,
  loggedAt: number | null,
  over: Partial<SetRecord> = {},
): SetRecord {
  return {
    id: `set-${++seq}`,
    position: 1,
    kind,
    loadMode: loadG === null ? 'bodyweight' : 'barbell',
    loadG,
    reps: 6,
    durationS: null,
    side: null,
    effort: null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetReps: null,
    targetDurationS: null,
    targetLoadG: null,
    targetRir: null,
    targetVariant: null,
    loggedAt,
    ...over,
  };
}

function exercise(slotId: string | null, exerciseId: string, sets: SetRecord[]): ExerciseRecord {
  return {
    id: `pe-${++seq}`,
    slotId,
    plannedExerciseId: exerciseId,
    exerciseId,
    position: 1,
    swapReason: null,
    painLevel: null,
    nextAdjustment: null,
    sets,
  };
}

/** 3 × 6 faites à `loadG`, effort « correct » sur la dernière : la calibration se termine à cette charge. */
function done(slotId: string, exerciseId: string, loadG: number, loggedAt: number): ExerciseRecord {
  const loadMode = CATALOG.find((s) => s.id === exerciseId)?.load_mode ?? fail(`fiche ${exerciseId}`);
  return exercise(
    slotId,
    exerciseId,
    [1, 2, 3].map((position) =>
      set('work', loadG, loggedAt + position, { position, loadMode, effort: position === 3 ? 'ok' : null }),
    ),
  );
}

function session(id: string, day: number, workoutId: string, exercises: ExerciseRecord[]): SessionRecord {
  return {
    id,
    instanceId: INSTANCE,
    workoutId,
    placeId: 'gym',
    startedAt: at(day),
    endedAt: at(day) + HOUR,
    status: 'completed',
    weekType: 'normal',
    profile: 'adult',
    rulesVersion: '1',
    exercises,
  };
}

/** Squat à la barre à 40 kg (A1), calibration finie. */
const SQUAT_40 = [session('s-2', 2, 'A', [done('A1', 'back-squat', 40_000, at(2))])];
/** La même chose, après une séance où A1 s'est fait à la presse à cuisses à 60 kg (« Changer d'exercice »). */
const PRESS_60_THEN_SQUAT_40 = [
  session('s-0', 0, 'A', [done('A1', 'leg-press', 60_000, at(0))]),
  ...SQUAT_40,
];

function previewInput(
  sessions: readonly SessionRecord[],
  operations: InstanceChangeOperation[],
  author: ChangeAuthor = 'coach',
): ChangePreviewInput {
  return {
    replay: {
      instance: { id: INSTANCE, snapshot: GYM_AB, daysPerWeek: 3, startedAt: at(-1) },
      sessions,
      changes: [],
      catalog: CATALOG,
      places: new Map([GYM, ...PLACES.filter((p) => p.id !== 'gym')].map((p) => [p.id, p])),
      overrides: new Map(),
    },
    change: { id: CHANGE, author, operations },
    decidedAt: at(5),
    plan: {
      place: GYM,
      catalog: CATALOG,
      profile: 'adult',
      ageBand: 'adult',
      context: 'gym',
      today: TODAY,
      lastLoadByExercise: lastLoadsOf(sessions),
      maxLevel: 2,
    },
  };
}

const slotOf = (previews: readonly SlotLoadPreview[], slotId: string): SlotLoadPreview =>
  previews.find((p) => p.slotId === slotId) ?? fail(`slot ${slotId}`);
const touchedIds = (previews: readonly SlotLoadPreview[]) =>
  previews.filter((p) => p.touched).map((p) => p.slotId);

const ALL_SLOTS = GYM_AB.workouts.flatMap((w) => w.slots.map((s) => s.id));

// ---------------------------------------------------------------------------------------------------------------
// Cas
// ---------------------------------------------------------------------------------------------------------------

describe('changePreview : charge prévue avant et après', () => {
  it('allègement de A1 (40 kg, barre 20 kg, plus petit disque 1,25 kg) : 40 kg → 35 kg, aucune hausse', () => {
    const previews = changePreview(previewInput(SQUAT_40, [{ op: 'lighten_exercise', slot: 'A1' }]));
    expect(slotOf(previews, 'A1')).toEqual({
      slotId: 'A1',
      workoutId: 'A',
      touched: true,
      before: { kind: 'load', loadG: 40_000 },
      after: { kind: 'load', loadG: 35_000 },
    });
    expect(touchedIds(previews)).toEqual(['A1']);
    expect(loadIncreases(previews)).toEqual([]);
  });

  it('tous les slots du programme, séance par séance, dans leur ordre', () => {
    const previews = changePreview(previewInput(SQUAT_40, [{ op: 'lighten_exercise', slot: 'A1' }]));
    expect(previews.map((p) => [p.workoutId, p.slotId])).toEqual(
      GYM_AB.workouts.flatMap((w) => w.slots.map((s) => [w.id, s.id])),
    );
    // Barre ou haltères jamais faits : calibration ; gainage au poids du corps : sans charge.
    expect(slotOf(previews, 'A2')).toMatchObject({
      before: { kind: 'calibration' },
      after: { kind: 'calibration' },
    });
    expect(slotOf(previews, 'A5')).toMatchObject({ before: { kind: 'none' }, after: { kind: 'none' } });
  });

  it('remplacement vers une fiche jamais faite dans ce slot : calibration', () => {
    const op: InstanceChangeOperation = { op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' };
    const previews = changePreview(previewInput(SQUAT_40, [op]));
    expect(slotOf(previews, 'A1')).toMatchObject({
      touched: true,
      before: { kind: 'load', loadG: 40_000 },
      after: { kind: 'calibration' },
    });
    expect(loadIncreases(previews)).toEqual([]);
  });

  it('remplacement vers une fiche déjà faite à 60 kg dans ce slot, la courante à 40 kg : hausse', () => {
    const op: InstanceChangeOperation = { op: 'replace_exercise', slot: 'A1', exercise: 'leg-press' };
    const previews = changePreview(previewInput(PRESS_60_THEN_SQUAT_40, [op]));
    expect(slotOf(previews, 'A1')).toMatchObject({
      touched: true,
      before: { kind: 'load', loadG: 40_000 },
      after: { kind: 'load', loadG: 60_000 },
    });
    expect(loadIncreases(previews)).toEqual(['A1']);
  });

  it('la même hausse proposée par le moteur ou l’utilisateur : le même aperçu', () => {
    const op: InstanceChangeOperation = { op: 'replace_exercise', slot: 'A1', exercise: 'leg-press' };
    const coach = changePreview(previewInput(PRESS_60_THEN_SQUAT_40, [op], 'coach'));
    expect(changePreview(previewInput(PRESS_60_THEN_SQUAT_40, [op], 'engine'))).toEqual(coach);
    expect(changePreview(previewInput(PRESS_60_THEN_SQUAT_40, [op], 'user'))).toEqual(coach);
  });

  it('chaîne de gainage remplacée par une fiche lestée jamais faite : sans charge → calibration', () => {
    const op: InstanceChangeOperation = { op: 'replace_exercise', slot: 'A5', exercise: 'weighted-plank' };
    const previews = changePreview(previewInput(SQUAT_40, [op]));
    expect(slotOf(previews, 'A5')).toMatchObject({
      touched: true,
      before: { kind: 'none' },
      after: { kind: 'calibration' },
    });
    expect(touchedIds(previews)).toEqual(['A5']);
  });

  it('remove_slot : le slot n’a plus de charge après', () => {
    const previews = changePreview(previewInput(SQUAT_40, [{ op: 'remove_slot', slot: 'A1' }]));
    expect(slotOf(previews, 'A1')).toEqual({
      slotId: 'A1',
      workoutId: 'A',
      touched: true,
      before: { kind: 'load', loadG: 40_000 },
      after: null,
    });
    expect(touchedIds(previews)).toEqual(['A1']);
    expect(loadIncreases(previews)).toEqual([]);
  });

  it('add_slot : le slot ajouté n’existait pas avant, il se calibre, à la fin de sa séance', () => {
    const op: InstanceChangeOperation = {
      op: 'add_slot',
      workout: 'B',
      movementPattern: 'horizontal_pull',
      exercises: ['seated-cable-row'],
    };
    const previews = changePreview(previewInput(SQUAT_40, [op]));
    const added = `B-${CHANGE}`;
    expect(slotOf(previews, added)).toEqual({
      slotId: added,
      workoutId: 'B',
      touched: true,
      before: null,
      after: { kind: 'calibration' },
    });
    expect(previews.filter((p) => p.workoutId === 'B').map((p) => p.slotId)).toEqual([
      'B1',
      'B2',
      'B3',
      'B4',
      added,
    ]);
    expect(touchedIds(previews)).toEqual([added]);
  });

  it('switch_template : l’instance se termine, aucun slot n’a de charge après', () => {
    const op: InstanceChangeOperation = { op: 'switch_template', templateId: 'gym-intermediate-upper-lower' };
    const previews = changePreview(previewInput(SQUAT_40, [{ op: 'lighten_exercise', slot: 'A1' }, op]));
    expect(previews.map((p) => p.slotId)).toEqual(ALL_SLOTS);
    expect(previews.every((p) => p.after === null && p.touched)).toBe(true);
    expect(slotOf(previews, 'A1').before).toEqual({ kind: 'load', loadG: 40_000 });
    expect(loadIncreases(previews)).toEqual([]);
  });

  it('suspend_slot : le slot est sauté, sans charge', () => {
    const previews = changePreview(previewInput(SQUAT_40, [{ op: 'suspend_slot', slot: 'A1' }]));
    expect(slotOf(previews, 'A1')).toMatchObject({
      touched: true,
      before: { kind: 'load', loadG: 40_000 },
      after: { kind: 'none' },
    });
    expect(loadIncreases(previews)).toEqual([]);
  });

  it('un slot nommé par une opération est touché même si sa charge ne change pas', () => {
    const previews = changePreview(previewInput(SQUAT_40, [{ op: 'set_rest', slot: 'A1', seconds: 180 }]));
    expect(slotOf(previews, 'A1')).toMatchObject({
      touched: true,
      before: { kind: 'load', loadG: 40_000 },
      after: { kind: 'load', loadG: 40_000 },
    });
    expect(touchedIds(previews)).toEqual(['A1']);
  });

  it('ne modifie pas ses entrées', () => {
    const input = previewInput(SQUAT_40, [{ op: 'lighten_exercise', slot: 'A1' }]);
    const copy = structuredClone(input);
    changePreview(input);
    expect(input).toEqual(copy);
  });
});

describe('loadIncreases', () => {
  const preview = (slotId: string, before: SlotLoadPreview['before'], after: SlotLoadPreview['after']) => ({
    slotId,
    workoutId: 'A',
    touched: true,
    before,
    after,
  });

  it('seulement les slots chargés des deux côtés dont la charge monte, dans l’ordre', () => {
    expect(
      loadIncreases([
        preview('up', { kind: 'load', loadG: 40_000 }, { kind: 'load', loadG: 42_500 }),
        preview('same', { kind: 'load', loadG: 40_000 }, { kind: 'load', loadG: 40_000 }),
        preview('down', { kind: 'load', loadG: 40_000 }, { kind: 'load', loadG: 35_000 }),
        preview('calibration', { kind: 'calibration' }, { kind: 'load', loadG: 60_000 }),
        preview('none', { kind: 'none' }, { kind: 'load', loadG: 60_000 }),
        preview('added', null, { kind: 'load', loadG: 60_000 }),
        preview('removed', { kind: 'load', loadG: 40_000 }, null),
        preview('up-2', { kind: 'load', loadG: 8000 }, { kind: 'load', loadG: 10_000 }),
      ]),
    ).toEqual(['up', 'up-2']);
  });
});

describe('lastLoadsOf', () => {
  it('dernière série de travail faite par exercice ; ni échauffement, ni série non faite, ni sans charge', () => {
    const older = session('s-1', 0, 'A', [
      exercise('A1', 'back-squat', [
        set('work', 40_000, at(0) + 1),
        set('work', 42_500, at(0) + 2),
        // Échauffement plus récent que tout le reste : ignoré.
        set('warmup', 80_000, at(9)),
      ]),
      exercise('A2', 'bench-press', [set('work', 30_000, at(0) + 3)]),
    ]);
    const newer = session('s-2', 2, 'A', [
      exercise('A1', 'back-squat', [
        set('work', 45_000, at(2) + 1),
        // Série prévue, jamais faite : ignorée.
        set('work', 50_000, null),
      ]),
      // Sans charge : aucune entrée.
      exercise('A4', 'push-up', [set('work', null, at(2) + 2)]),
      // Hors programme (exercice ajouté) : compte aussi.
      exercise(null, 'calf-raise', [set('work', 20_000, at(2) + 3, { loadMode: 'machine' })]),
    ]);
    const expected = new Map([
      ['back-squat', 45_000],
      ['bench-press', 30_000],
      ['calf-raise', 20_000],
    ]);
    expect(lastLoadsOf([older, newer])).toEqual(expected);
    // L'ordre des séances ne compte pas : seule l'heure des séries.
    expect(lastLoadsOf([newer, older])).toEqual(expected);
    expect(lastLoadsOf([])).toEqual(new Map());
  });
});
