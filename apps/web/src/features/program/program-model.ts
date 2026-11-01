import type {
  ChangeAuthor,
  InstanceChangeOperation,
  InstanceChangeView,
  ServedSheet,
  SlotSpec,
} from '@rune/contracts';
import {
  applyOperation,
  type ChangeValidation,
  type EffectiveProgram,
  findSlot,
  profileChain,
  resolveSlot,
  slotCandidates,
  validateChange,
} from '@rune/domain';
import type { ProgramEditContext, ProgramView } from '../../repos';
import { formatKg } from '../../ui';
import {
  CHANGE_ERROR_MESSAGES,
  daysLabel,
  formatRest,
  type ProgramNames,
  repsInReserve,
  setsSummary,
  slotSummary,
  workSet,
} from './program-labels';

/*
 * Calculs des écrans du programme, sur le domaine (spec brique 3 §7.7) : exercice résolu au lieu principal, contrôle
 * d'un changement par `validateChange` avant l'envoi (le serveur reste l'autorité), avant / après d'une proposition
 * par `applyOperation`.
 */

const collator = new Intl.Collator('fr', { sensitivity: 'base' });
export const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Mesure d'un slot : en durée si son groupe de travail porte `durationS`. */
export const measureOf = (slot: SlotSpec): 'reps' | 'duration' =>
  workSet(slot)?.durationS === undefined ? 'reps' : 'duration';

/** Validation d'un changement sur le programme effectif, comme le serveur la fera. */
export type ChangeCheck = (operations: InstanceChangeOperation[]) => ChangeValidation;

export function changeCheck(
  view: ProgramView,
  ctx: ProgramEditContext,
  change: { author: ChangeAuthor; id?: string } = { author: 'user' },
): ChangeCheck {
  return (operations) =>
    validateChange({
      program: view.program,
      revision: view.instance.revision,
      change: { ...change, baseRevision: view.instance.revision, operations },
      catalog: ctx.sheets,
      places: ctx.places,
      profile: ctx.profile,
      level: ctx.level,
      servedTemplates: ctx.templates,
      instanceTemplateVersion: view.instance.templateVersion,
    });
}

/** Premier message d'un refus du validateur, null si le changement passe. */
export const checkMessage = (result: ChangeValidation): string | null =>
  result.ok ? null : CHANGE_ERROR_MESSAGES[result.errors[0]?.code ?? 'forbidden_for_author'];

/** Exercice prévu par le slot (tête de liste, ou première variante de la chaîne), pour les résumés. */
export function plannedName(slot: SlotSpec, sheets: readonly ServedSheet[]): string {
  const first = slotCandidates(slot, sheets)[0] as ServedSheet | undefined;
  return first?.name ?? slot.exercises?.[0] ?? slot.chain ?? slot.id;
}

export interface SlotDisplay {
  slot: SlotSpec;
  /** Exercice résolu au lieu principal (05 §11), sinon celui que prévoit le slot. */
  name: string;
  exerciseId: string | null;
  summary: string;
  suspended: boolean;
  /** Repère de l'état du slot : charge, durée ou variante ; null sans état. */
  target: string | null;
}

/** Ligne d'un slot dans « Séances du modèle » (spec §7.7). */
export function slotDisplay(slot: SlotSpec, view: ProgramView, ctx: ProgramEditContext): SlotDisplay {
  const cautious = ctx.profile === 'cautious';
  const suspended = view.program.suspended.has(slot.id);
  const place = ctx.primary ?? ctx.places[0] ?? null;
  const ofSlot = view.slotStates.filter((st) => st.slotId === slot.id);
  const chainState = slot.chain ? (ofSlot.find((st) => st.exerciseId === slot.chain) ?? null) : null;
  const resolution = place
    ? resolveSlot(slot, {
        catalog: ctx.sheets,
        place,
        cautious,
        maxLevel: ctx.maxLevel,
        state: chainState,
        suspended,
      })
    : null;
  const exercise = resolution?.exercise ?? null;
  const byId = new Map(ctx.sheets.map((s) => [s.id, s]));
  const plannedId = resolution?.plannedExerciseId ?? null;
  const name =
    exercise?.name ?? (plannedId ? byId.get(plannedId)?.name : undefined) ?? plannedName(slot, ctx.sheets);
  const state = chainState ?? ofSlot.find((st) => st.exerciseId === exercise?.id) ?? null;
  let target: string | null = null;
  if (state !== null && !suspended) {
    if (state.mode === 'chain' && slot.chain && state.variantRank !== null) {
      target = profileChain(ctx.sheets, slot.chain, cautious)[state.variantRank - 1]?.name ?? null;
    } else if (state.mode === 'duration' && state.durationS !== null) {
      target = formatRest(state.durationS);
    } else if (state.loadG !== null && state.loadG > 0) {
      target = formatKg(state.loadG);
    }
  }
  return { slot, name, exerciseId: exercise?.id ?? null, summary: slotSummary(slot), suspended, target };
}

/**
 * Exercices qui peuvent remplacer celui du slot : même type de mouvement et même mesure, publiés, sans l'exercice
 * actuel, et que le validateur accepte (`ops` : le changement complet, « Remplacer et reprendre » compris).
 */
export function replacementCandidates(
  display: SlotDisplay,
  ctx: ProgramEditContext,
  check: ChangeCheck,
  ops: (exerciseId: string) => InstanceChangeOperation[],
): ServedSheet[] {
  const { slot } = display;
  const current = new Set([display.exerciseId, slot.exercises?.[0]].filter((x): x is string => !!x));
  const measure = measureOf(slot);
  return ctx.sheets
    .filter(
      (s) =>
        s.status === 'published' &&
        s.movement_pattern === slot.movementPattern &&
        s.measure === measure &&
        !current.has(s.id),
    )
    .filter((s) => check(ops(s.id)).ok)
    .sort(byName);
}

/** Exercices à ajouter à une séance (`add_slot`) : publiés, acceptés par le validateur, hors exercices déjà prévus. */
export function addableExercises(
  workoutId: string,
  view: ProgramView,
  ctx: ProgramEditContext,
  check: ChangeCheck,
): ServedSheet[] {
  const workout = view.program.template.workouts.find((w) => w.id === workoutId);
  if (workout === undefined) return [];
  const planned = new Set(workout.slots.flatMap((s) => s.exercises?.slice(0, 1) ?? []));
  return ctx.sheets
    .filter((s) => s.status === 'published' && !planned.has(s.id))
    .filter(
      (s) =>
        check([
          { op: 'add_slot', workout: workoutId, movementPattern: s.movement_pattern, exercises: [s.id] },
        ]).ok,
    )
    .sort(byName);
}

/** Noms des résumés, lus dans le programme effectif, puis dans le modèle servi (slot retiré depuis). */
export function programNames(view: ProgramView, ctx: ProgramEditContext): ProgramNames {
  const byId = new Map(ctx.sheets.map((s) => [s.id, s]));
  const templates = new Map(ctx.templates.map((t) => [t.template.id, t.template]));
  const slotOf = (id: string) =>
    findSlot(view.program.template, id) ?? (view.template ? findSlot(view.template.template, id) : undefined);
  return {
    slot: (id) => {
      const found = slotOf(id);
      return found ? plannedName(found.slot, ctx.sheets) : 'Un exercice';
    },
    exercise: (id) => byId.get(id)?.name ?? id,
    workout: (id) => view.program.template.workouts.find((w) => w.id === id)?.name ?? id,
    template: (id) =>
      templates.get(id)?.name ?? (id === view.instance.templateId ? view.program.template.name : id),
  };
}

export interface ChangeLine {
  before: string;
  after: string;
}

/** Facette d'un slot que l'opération change, dans un état du programme. */
function slotFacet(program: EffectiveProgram, op: InstanceChangeOperation, ctx: ProgramEditContext): string {
  if (!('slot' in op)) return '';
  const found = findSlot(program.template, op.slot);
  if (found === undefined) return 'Retiré de la séance';
  const { slot } = found;
  const name = plannedName(slot, ctx.sheets);
  switch (op.op) {
    case 'set_rest': {
      const rest = workSet(slot)?.restS;
      return rest === undefined ? name : `${name} · repos ${formatRest(rest)}`;
    }
    case 'set_target_rir': {
      const rir = workSet(slot)?.targetRir;
      return rir === undefined ? name : `${name} · ${repsInReserve(rir)}`;
    }
    case 'suspend_slot':
    case 'resume_slot':
      return program.suspended.has(slot.id) ? `${name} · Suspendu` : name;
    case 'lighten_exercise':
      return name;
    default:
      return `${name} · ${setsSummary(slot)}`;
  }
}

/**
 * Avant / après de chaque opération d'un changement (spec §7.7) : les opérations s'appliquent l'une après l'autre
 * (`applyOperation`, celle du programme effectif), chacune lue sur l'état laissé par la précédente.
 */
export function changeLines(
  change: Pick<InstanceChangeView, 'id' | 'operations'>,
  view: ProgramView,
  ctx: ProgramEditContext,
  names: ProgramNames,
): ChangeLine[] {
  let state = view.program;
  return change.operations.map((op) => {
    const next = applyOperation(state, op, change.id);
    let line: ChangeLine;
    switch (op.op) {
      case 'start_deload':
        line = { before: 'Semaine normale', after: 'Semaine allégée' };
        break;
      case 'set_days_per_week':
        line = { before: daysLabel(state.daysPerWeek), after: daysLabel(op.days) };
        break;
      case 'switch_template':
        line = { before: names.template(view.instance.templateId), after: names.template(op.templateId) };
        break;
      case 'add_slot':
        line = {
          before: names.workout(op.workout),
          after: `${names.workout(op.workout)} · ${op.exercises[0] ? names.exercise(op.exercises[0]) : ''} ajouté`,
        };
        break;
      case 'lighten_exercise':
        line = {
          before: slotFacet(state, op, ctx),
          after: `${slotFacet(next, op, ctx)} · plus léger la prochaine fois`,
        };
        break;
      default:
        line = { before: slotFacet(state, op, ctx), after: slotFacet(next, op, ctx) };
    }
    state = next;
    return line;
  });
}
