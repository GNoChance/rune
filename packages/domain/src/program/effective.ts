import type {
  InstanceChangeOperation,
  ProgramTemplate,
  ProgressionSpec,
  SetSpec,
  SlotSpec,
  WorkoutSpec,
} from '@rune/contracts';
import { currentRules } from './rules';
import type { AcceptedChange } from './types';

/**
 * Programme effectif (spec brique 3, D5) : le `snapshot` de l'inscription, jamais réécrit, plus les changements
 * acceptés. `daysPerWeek` est celui en vigueur ; `suspended` les slots mis de côté (05 §13.7, §15).
 */
export interface EffectiveProgram {
  template: ProgramTemplate;
  daysPerWeek: number;
  suspended: ReadonlySet<string>;
}

/** Nombre de fiches au plus dans une liste de slot (`SlotSpecSchema`). */
const MAX_SLOT_EXERCISES = 12;

/** Ordre binaire des `id`, jamais `localeCompare` : le même sur le téléphone et le serveur. */
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Slot `slotId` et sa séance, s'il existe. */
export function findSlot(
  template: ProgramTemplate,
  slotId: string,
): { workout: WorkoutSpec; slot: SlotSpec } | undefined {
  for (const workout of template.workouts) {
    const slot = workout.slots.find((s) => s.id === slotId);
    if (slot !== undefined) return { workout, slot };
  }
  return undefined;
}

/** Nombre de séries de travail d'un slot (somme des `count` des groupes `work`). */
export const workSetCount = (slot: SlotSpec): number =>
  slot.sets.reduce((n, s) => (s.kind === 'work' ? n + s.count : n), 0);

/** Vrai si le slot se mesure en durée (un groupe de travail porte `durationS`). */
const isDurationSlot = (slot: SlotSpec): boolean =>
  slot.sets.some((s) => s.kind === 'work' && s.durationS !== undefined);

/** Identifiant du slot créé par un `add_slot` (spec brique 3, plan tâche 3). */
export const addedSlotId = (workoutId: string, changeId: string): string => `${workoutId}-${changeId}`;

/** Séries d'un slot ajouté : accessoire en `double`, 2 × 8–12, RIR 2, 90 s. */
const addedSlotSets = (): SetSpec[] => [
  { kind: 'work', count: 2, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 },
];

function mapSlots(template: ProgramTemplate, f: (slot: SlotSpec) => SlotSpec): ProgramTemplate {
  return { ...template, workouts: template.workouts.map((w) => ({ ...w, slots: w.slots.map(f) })) };
}

function updateSlot(
  template: ProgramTemplate,
  slotId: string,
  f: (slot: SlotSpec) => SlotSpec,
): ProgramTemplate {
  return mapSlots(template, (s) => (s.id === slotId ? f(s) : s));
}

/** Applique `f` à chaque groupe de séries de travail du slot. */
const mapWorkSets = (slot: SlotSpec, f: (set: SetSpec) => SetSpec): SlotSpec => ({
  ...slot,
  sets: slot.sets.map((s) => (s.kind === 'work' ? f(s) : s)),
});

/**
 * `replace_exercise` : la fiche en tête de liste ; un slot `chain` devient une liste à une fiche, en `double`, ou en
 * `duration` s'il se mesure en durée (pas des règles en vigueur s'il n'en avait pas).
 */
function replaceExercise(slot: SlotSpec, exercise: string): SlotSpec {
  if (slot.chain !== undefined) {
    const { chain: _chain, ...rest } = slot;
    const progression: ProgressionSpec = !isDurationSlot(slot)
      ? { type: 'double' }
      : slot.progression.type === 'duration'
        ? slot.progression
        : { type: 'duration', stepS: currentRules().stepS };
    return { ...rest, exercises: [exercise], progression };
  }
  const others = (slot.exercises ?? []).filter((e) => e !== exercise);
  return { ...slot, exercises: [exercise, ...others].slice(0, MAX_SLOT_EXERCISES) };
}

/** `change_sets` : ±1 sur le dernier groupe de travail ; un groupe tombé à 0 disparaît. Jamais sous 1 série. */
function changeSets(slot: SlotSpec, delta: -1 | 1): SlotSpec {
  if (workSetCount(slot) + delta < 1) return slot;
  const last = slot.sets.findLastIndex((s) => s.kind === 'work');
  const sets = slot.sets.flatMap((s, i) => {
    if (i !== last) return [s];
    const count = s.count + delta;
    return count === 0 ? [] : [{ ...s, count }];
  });
  return { ...slot, sets };
}

/**
 * Applique une opération **structurelle** au programme (05 §15). `lighten_exercise`, `start_deload` et
 * `switch_template` sont des événements laissés au rejeu : le programme ne change pas. Une opération sur un slot
 * ou une séance absents est ignorée (le changement a été validé contre un état antérieur).
 */
export function applyOperation(
  program: EffectiveProgram,
  op: InstanceChangeOperation,
  changeId: string,
): EffectiveProgram {
  const { template } = program;
  const hasSlot = (id: string) => findSlot(template, id) !== undefined;
  switch (op.op) {
    case 'replace_exercise':
      return { ...program, template: updateSlot(template, op.slot, (s) => replaceExercise(s, op.exercise)) };
    case 'change_sets':
      return { ...program, template: updateSlot(template, op.slot, (s) => changeSets(s, op.delta)) };
    case 'set_rep_range':
      return {
        ...program,
        template: updateSlot(template, op.slot, (slot) =>
          mapWorkSets(slot, (s) => (s.reps === undefined ? s : { ...s, reps: { min: op.min, max: op.max } })),
        ),
      };
    case 'set_target_rir':
      return {
        ...program,
        template: updateSlot(template, op.slot, (slot) =>
          mapWorkSets(slot, (s) => ({ ...s, targetRir: op.value })),
        ),
      };
    case 'set_rest':
      return {
        ...program,
        template: updateSlot(template, op.slot, (slot) =>
          mapWorkSets(slot, (s) => ({ ...s, restS: op.seconds })),
        ),
      };
    case 'remove_slot': {
      if (!hasSlot(op.slot)) return program;
      const suspended = new Set(program.suspended);
      suspended.delete(op.slot);
      return {
        template: {
          ...template,
          workouts: template.workouts.map((w) => ({ ...w, slots: w.slots.filter((s) => s.id !== op.slot) })),
        },
        daysPerWeek: program.daysPerWeek,
        suspended,
      };
    }
    case 'add_slot': {
      const id = addedSlotId(op.workout, changeId);
      if (hasSlot(id) || !template.workouts.some((w) => w.id === op.workout)) return program;
      const slot: SlotSpec = {
        id,
        movementPattern: op.movementPattern,
        role: 'accessory',
        exercises: [...op.exercises],
        sets: addedSlotSets(),
        progression: { type: 'double' },
      };
      return {
        ...program,
        template: {
          ...template,
          workouts: template.workouts.map((w) =>
            w.id === op.workout ? { ...w, slots: [...w.slots, slot] } : w,
          ),
        },
      };
    }
    case 'set_days_per_week':
      return { ...program, daysPerWeek: op.days };
    case 'suspend_slot':
    case 'resume_slot': {
      if (!hasSlot(op.slot)) return program;
      const suspended = new Set(program.suspended);
      if (op.op === 'suspend_slot') suspended.add(op.slot);
      else suspended.delete(op.slot);
      return { ...program, suspended };
    }
    case 'lighten_exercise':
    case 'start_deload':
    case 'switch_template':
      return program;
  }
}

/**
 * Programme effectif (D5) : `snapshot` plus les opérations structurelles des changements acceptés, appliqués dans
 * l'ordre de `decidedAt`, puis d'`id` (ordre binaire). Fonction pure : ni `snapshot` ni `changes` ne sont modifiés.
 */
export function effectiveProgram(
  snapshot: ProgramTemplate,
  daysPerWeek: number,
  changes: readonly AcceptedChange[],
): EffectiveProgram {
  const ordered = [...changes].sort((a, b) => a.decidedAt - b.decidedAt || binary(a.id, b.id));
  let program: EffectiveProgram = { template: structuredClone(snapshot), daysPerWeek, suspended: new Set() };
  for (const change of ordered) {
    for (const op of change.operations) program = applyOperation(program, op, change.id);
  }
  return program;
}
