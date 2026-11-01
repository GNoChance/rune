/*
 * `resolveSlot` (05 §11, spec brique 3 §4.3.6) : exercice du jour selon le lieu et le profil, raison du choix, et
 * candidats de « Changer d'exercice ».
 */
import { type EquipmentCode, REFERENCE_PROFILES, type SlotSpec } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { type PlanSheet, resolveSlot } from '../../src/program/resolve';
import { type SlotState, slotStateId } from '../../src/program/types';
import { PUSH_UP_CHAIN } from '../fixtures/catalog';
import { GYM_AB, PROGRAM_CATALOG, place, programSheet, slotOf } from '../fixtures/program';

/** Catalogue des programmes avec sa mesure : les gainages se tiennent en secondes, le reste se compte en répétitions. */
const CATALOG: PlanSheet[] = PROGRAM_CATALOG.map((s) => ({
  ...s,
  measure: s.movement_pattern === 'core_anti_extension' ? 'duration' : 'reps',
}));

const GYM = place('gym', REFERENCE_PROFILES.gym_reference);
const HOME = place('home', REFERENCE_PROFILES.home_bodyweight, 'home');
const BARE = place('bare', [], 'home');
const without = (code: EquipmentCode) =>
  place(
    'gym-2',
    REFERENCE_PROFILES.gym_reference.filter((c) => c !== code),
  );

const A1 = slotOf(GYM_AB, 'A1');

const listSlot = (id: string, pattern: SlotSpec['movementPattern'], exercises: string[]): SlotSpec => ({
  id,
  movementPattern: pattern,
  role: 'accessory',
  exercises,
  sets: [{ kind: 'work', count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 }],
  progression: { type: 'double' },
});

const PUSH_UPS: SlotSpec = {
  id: 'P1',
  movementPattern: 'horizontal_push',
  role: 'main',
  chain: 'push-up',
  sets: [{ kind: 'work', count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 }],
  progression: { type: 'chain' },
};

/** État d'une chaîne (tenu par `chain_id`) à la variante `rank`. */
const chainState = (rank: number): SlotState => ({
  id: slotStateId('inst-1', 'P1', 'push-up'),
  instanceId: 'inst-1',
  slotId: 'P1',
  exerciseId: 'push-up',
  mode: 'chain',
  loadG: null,
  targetReps: 8,
  variantRank: rank,
  durationS: null,
  machineStepGOverride: null,
  calibrationLeft: 0,
  noProgressCount: 0,
  stallRank: 0,
  painStreak: 0,
  suspended: false,
  lastSessionId: 's-1',
  rulesVersion: '1',
});

type Ctx = Parameters<typeof resolveSlot>[1];
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  catalog: CATALOG,
  place: GYM,
  cautious: false,
  maxLevel: 1,
  state: null,
  suspended: false,
  ...over,
});
const ids = (sheets: readonly { id: string }[]) => sheets.map((s) => s.id);

describe('resolveSlot : liste du slot (05 §11)', () => {
  it('premier exercice utilisable : prévu', () => {
    const r = resolveSlot(A1, ctx());
    expect(r.exercise?.id).toBe('back-squat');
    expect(r.resolution).toBe('planned');
    expect(r.plannedExerciseId).toBe('back-squat');
  });

  it('matériel retiré du lieu : exercice suivant de la liste, remplacé (R-MAT-3)', () => {
    const r = resolveSlot(A1, ctx({ place: without('barbell') }));
    expect(r.exercise?.id).toBe('goblet-squat');
    expect(r.resolution).toBe('replaced_not_feasible');
    expect(r.plannedExerciseId).toBe('back-squat');
  });

  it('fiche retirée en tête de slot : la suivante (Review Focus 5)', () => {
    const catalog = CATALOG.map((s) => (s.id === 'back-squat' ? { ...s, status: 'retired' as const } : s));
    const r = resolveSlot(A1, ctx({ catalog }));
    expect(r.exercise?.id).toBe('goblet-squat');
    expect(r.resolution).toBe('replaced_not_feasible');
    expect(r.plannedExerciseId).toBe('back-squat');
    expect(ids(r.candidates)).not.toContain('back-squat');
  });

  it('fiche en tête absente du catalogue : la suivante', () => {
    const r = resolveSlot(listSlot('X1', 'squat', ['unknown-squat', 'goblet-squat']), ctx());
    expect(r.exercise?.id).toBe('goblet-squat');
    expect(r.resolution).toBe('replaced_not_feasible');
    expect(r.plannedExerciseId).toBe('unknown-squat');
  });

  it('aucune fiche de la liste ni remplaçant : pas faisable ici', () => {
    const r = resolveSlot(listSlot('X1', 'core_anti_rotation', ['pallof-press']), ctx({ place: HOME }));
    expect(r.exercise).toBeNull();
    expect(r.resolution).toBe('not_feasible_here');
    expect(r.candidates).toEqual([]);
    expect(r.plannedExerciseId).toBe('pallof-press');
  });

  it('aucune fiche de la liste : premier remplaçant (substitutes de la tête)', () => {
    // À la maison, ni barre ni presse : le remplaçant le mieux classé de la tête (substitutes).
    const slot = listSlot('X1', 'squat', ['back-squat', 'leg-press']);
    const r = resolveSlot(slot, ctx({ place: HOME }));
    expect(r.exercise?.id).toBe('bodyweight-squat');
    expect(r.resolution).toBe('replaced_not_feasible');
  });

  it('profil prudent : fiche not_for_minors écartée', () => {
    const slot = listSlot('X1', 'squat', ['jump-squat', 'bodyweight-squat']);
    expect(resolveSlot(slot, ctx({ place: HOME })).exercise?.id).toBe('jump-squat');
    const r = resolveSlot(slot, ctx({ place: HOME, cautious: true }));
    expect(r.exercise?.id).toBe('bodyweight-squat');
    expect(r.resolution).toBe('replaced_not_feasible');
    expect(ids(r.candidates)).not.toContain('jump-squat');
  });

  it("un slot en répétitions n'est jamais résolu en gainage (substitutes ignore la mesure)", () => {
    const catalog: PlanSheet[] = [
      ...CATALOG,
      {
        ...programSheet(
          'cable-rollout',
          'core_anti_extension',
          { primary: ['abs'], secondary: ['obliques'] },
          [['cable_station']],
          { load_mode: 'machine', mechanics: 'isolation' },
        ),
        measure: 'reps',
      },
    ];
    const r = resolveSlot(
      listSlot('X1', 'core_anti_extension', ['cable-rollout']),
      ctx({ catalog, place: HOME }),
    );
    expect(r.exercise).toBeNull();
    expect(r.resolution).toBe('not_feasible_here');
    expect(r.candidates).toEqual([]);
  });

  it('candidats : liste utilisable dans son ordre, puis remplaçants, sans doublon, de la mesure du slot', () => {
    const r = resolveSlot(A1, ctx());
    const got = ids(r.candidates);
    expect(got.slice(0, 4)).toEqual(['back-squat', 'goblet-squat', 'leg-press', 'bodyweight-squat']);
    expect(got).toContain('jump-squat');
    expect(new Set(got).size).toBe(got.length);
    expect(got).not.toContain('draft-squat');
    expect(got).not.toContain('smith-squat'); // pas de Smith dans la salle de référence
    expect(r.candidates.every((s) => s.measure === 'reps')).toBe(true);
  });

  it('slot suspendu : rien de prévu, aucun candidat', () => {
    const r = resolveSlot(A1, ctx({ suspended: true }));
    expect(r).toEqual({
      exercise: null,
      resolution: 'suspended',
      candidates: [],
      plannedExerciseId: 'back-squat',
    });
  });
});

describe('resolveSlot : chaîne (spec §4.3.6)', () => {
  const chain = (over: Partial<Ctx>) => ctx({ catalog: [...PUSH_UP_CHAIN], ...over });

  it("variante de l'état utilisable : prévue", () => {
    const r = resolveSlot(PUSH_UPS, chain({ place: HOME, state: chainState(4) }));
    expect(r.exercise?.id).toBe('feet-elevated-push-up');
    expect(r.resolution).toBe('planned');
    expect(r.plannedExerciseId).toBe('feet-elevated-push-up');
  });

  it('variante non utilisable : la plus difficile des utilisables de rang inférieur', () => {
    const r = resolveSlot(PUSH_UPS, chain({ place: BARE, state: chainState(4) }));
    expect(r.exercise?.id).toBe('push-up');
    expect(r.resolution).toBe('replaced_not_feasible');
    expect(r.plannedExerciseId).toBe('feet-elevated-push-up');
  });

  it("jamais une variante plus difficile que celle de l'état", () => {
    // Pompe inclinée (rang 2) sans chaise ni table : la pompe (rang 3) est faisable, mais on descend au mur.
    const r = resolveSlot(PUSH_UPS, chain({ place: BARE, state: chainState(2) }));
    expect(r.exercise?.id).toBe('wall-push-up');
    expect(r.resolution).toBe('replaced_not_feasible');
  });

  it('aucune variante de rang inférieur : remplaçant hors chaîne, jamais une variante plus difficile', () => {
    const catalog: PlanSheet[] = [
      ...PUSH_UP_CHAIN.map((s) =>
        s.id === 'wall-push-up' ? { ...s, equipment_options: [['box' as const]] } : s,
      ),
      { ...programSheet('knee-push-up', 'horizontal_push', { primary: ['chest'] }, [[]]), measure: 'reps' },
    ];
    const r = resolveSlot(PUSH_UPS, ctx({ catalog, place: BARE, state: chainState(2) }));
    expect(r.exercise?.id).toBe('knee-push-up');
    expect(r.resolution).toBe('replaced_not_feasible');
    expect(ids(r.candidates)).toContain('push-up'); // au choix de l'utilisateur, pas d'office
  });

  it('sans état : première variante', () => {
    const r = resolveSlot(PUSH_UPS, chain({ place: HOME }));
    expect(r.exercise?.id).toBe('wall-push-up');
    expect(r.resolution).toBe('planned');
  });

  it('profil prudent : chaîne coupée avant la première variante not_for_minors, rang ramené dedans', () => {
    const r = resolveSlot(PUSH_UPS, chain({ place: HOME, state: chainState(5), cautious: true }));
    expect(r.exercise?.id).toBe('feet-elevated-push-up');
    expect(r.resolution).toBe('planned');
    expect(ids(r.candidates)).not.toContain('archer-push-up');
  });

  it('candidats : variantes utilisables de la chaîne, dans leur ordre', () => {
    const r = resolveSlot(PUSH_UPS, chain({ place: HOME, state: chainState(3) }));
    expect(ids(r.candidates)).toEqual([
      'wall-push-up',
      'incline-push-up',
      'push-up',
      'feet-elevated-push-up',
      'archer-push-up',
    ]);
  });
});
