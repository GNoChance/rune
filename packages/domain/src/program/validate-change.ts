import {
  CHANGE_ERROR_CODES,
  type ChangeAuthor,
  type ChangeErrorCode,
  type EquipmentCode,
  type InstanceChangeOperation,
  type MovementPattern,
  type PROGRAM_LEVELS,
  type ServedProgramTemplate,
  type SessionProfile,
} from '@rune/contracts';
import { expandEquipment, feasible } from '../catalog/equipment';
import type { CatalogSheet } from '../catalog/usable';
import { applyOperation, type EffectiveProgram, findSlot, workSetCount } from './effective';
import { RULES_VERSION, type RulesSet, rulesFor } from './rules';
import type { PlaceContext } from './types';
import {
  COVERAGE_GROUPS,
  coverageGaps,
  referenceEquipment,
  VOLUME_GROUPS,
  type VolumeGroup,
  volumeRange,
  weeklyVolume,
} from './volume';

/*
 * Validateur des changements de programme (05 §15) : bornes de chaque opération (adulte ou prudent), auteurs
 * permis, puis couverture et volume du programme résultant (05 §15.3). La révision est vérifiée par le serveur.
 */

export type ProgramLevel = (typeof PROGRAM_LEVELS)[number];

export interface ChangeValidationInput {
  program: EffectiveProgram;
  /** Révision courante de l'instance : non lue ici, le serveur compare `baseRevision` lui-même. */
  revision: number;
  /** `id` : celui du changement à créer, qui nomme un slot ajouté ; à défaut, un identifiant provisoire. */
  change: {
    id?: string;
    author: ChangeAuthor;
    baseRevision: number;
    operations: readonly InstanceChangeOperation[];
  };
  /** Fiches connues (le catalogue servi) : une fiche absente n'est pas utilisable. */
  catalog: readonly CatalogSheet[];
  /** Lieux de l'utilisateur ; aucun lieu = tout est faisable, comme sans lieu principal (spec brique 2 §4.1). */
  places: readonly PlaceContext[];
  profile: SessionProfile;
  /** Niveau de l'utilisateur (`experience`, 05 §3). */
  level: ProgramLevel;
  servedTemplates: readonly ServedProgramTemplate[];
  /** `template_version` de l'instance, pour `switch_template` vers le même modèle (D18). */
  instanceTemplateVersion: number;
}

export interface ChangeError {
  op: number;
  code: ChangeErrorCode;
}

export type ChangeValidation = { ok: true; program: EffectiveProgram } | { ok: false; errors: ChangeError[] };

/** Auteurs permis par opération (05 §15). Le coach ne lève jamais une suspension. */
export const OPERATION_AUTHORS: Readonly<Record<InstanceChangeOperation['op'], readonly ChangeAuthor[]>> = {
  replace_exercise: ['user', 'coach', 'engine'],
  change_sets: ['user', 'coach'],
  set_rep_range: ['user', 'coach'],
  set_target_rir: ['user', 'coach'],
  set_rest: ['user', 'coach'],
  lighten_exercise: ['user', 'coach'],
  start_deload: ['user', 'coach', 'engine'],
  suspend_slot: ['user', 'coach', 'engine'],
  resume_slot: ['user'],
  remove_slot: ['user', 'coach'],
  add_slot: ['user', 'coach'],
  set_days_per_week: ['user', 'coach'],
  switch_template: ['user', 'coach'],
};

/**
 * Bornes adultes de 05 §15 qui ne sont pas dans les règles du moteur (les bornes prudentes et le repos y sont). Le
 * RIR minimal d'un slot principal vaut pour un utilisateur débutant comme pour un modèle débutant (règle 3).
 */
export const CHANGE_BOUNDS = {
  workSets: [1, 5],
  reps: [5, 30],
  minRepsGap: 2,
  targetRir: [1, 4],
  minRirBeginnerMain: 2,
  maxSlotsPerWorkout: 8,
  days: [2, 4],
} as const;

/** Identifiant d'un changement pas encore créé (nom provisoire d'un slot ajouté). */
export const PENDING_CHANGE_ID = 'pending';

function currentRules(): RulesSet {
  const rules = rulesFor(RULES_VERSION);
  if (rules === null) throw new Error(`Règles ${RULES_VERSION} absentes`);
  return rules;
}

type Context = {
  author: ChangeAuthor;
  cautious: boolean;
  level: ProgramLevel;
  rules: RulesSet;
  byId: ReadonlyMap<string, CatalogSheet>;
  /** Matériel de chaque lieu, étendu ; `null` sans lieu (tout est faisable). */
  places: readonly ReadonlySet<EquipmentCode>[] | null;
  servedTemplates: readonly ServedProgramTemplate[];
  instanceTemplateVersion: number;
  /** Séances qui ont déjà reçu un `add_slot` dans ce changement. */
  addedTo: Set<string>;
};

/** Fiche publiée et faisable dans au moins un lieu de l'utilisateur. */
const usableSomewhere = (sheet: CatalogSheet, ctx: Context): boolean =>
  sheet.status === 'published' && (ctx.places === null || ctx.places.some((p) => feasible(sheet, p)));

/** `replace_exercise` (05 §15) : même type de mouvement, publiée, faisable quelque part ; non `notForMinors` en prudent. */
function checkExercise(id: string, pattern: MovementPattern, ctx: Context): ChangeErrorCode | null {
  const sheet = ctx.byId.get(id);
  if (sheet === undefined) return 'exercise_unusable';
  if (sheet.movement_pattern !== pattern) return 'pattern_mismatch';
  if (!usableSomewhere(sheet, ctx)) return 'exercise_unusable';
  if (ctx.cautious && sheet.not_for_minors) return 'forbidden_cautious';
  return null;
}

/** Fiches d'un `add_slot` : toutes connues et du type de mouvement, au moins une utilisable quelque part. */
function checkNewSlotExercises(
  ids: readonly string[],
  pattern: MovementPattern,
  ctx: Context,
): ChangeErrorCode | null {
  const sheets: CatalogSheet[] = [];
  for (const id of ids) {
    const sheet = ctx.byId.get(id);
    if (sheet === undefined) return 'exercise_unusable';
    if (sheet.movement_pattern !== pattern) return 'pattern_mismatch';
    sheets.push(sheet);
  }
  return sheets.some((s) => usableSomewhere(s, ctx)) ? null : 'exercise_unusable';
}

const outside = (value: number, [min, max]: readonly [number, number]) => value < min || value > max;

/** Bornes d'une opération sur l'état courant du changement (opérations précédentes appliquées). */
function checkOperation(
  state: EffectiveProgram,
  op: InstanceChangeOperation,
  ctx: Context,
): ChangeErrorCode | null {
  if (!OPERATION_AUTHORS[op.op].includes(ctx.author)) return 'forbidden_for_author';
  const { template } = state;
  const { cautious } = ctx.rules;
  switch (op.op) {
    case 'start_deload':
      return null;
    case 'add_slot': {
      if (ctx.cautious) return 'forbidden_cautious';
      const workout = template.workouts.find((w) => w.id === op.workout);
      if (workout === undefined) return 'workout_unknown';
      if (ctx.addedTo.has(op.workout) || workout.slots.length >= CHANGE_BOUNDS.maxSlotsPerWorkout) {
        return 'slot_limit';
      }
      return checkNewSlotExercises(op.exercises, op.movementPattern, ctx);
    }
    case 'set_days_per_week': {
      const { min, max } = template.daysPerWeek;
      const [low, high] = CHANGE_BOUNDS.days;
      return outside(op.days, [Math.max(min, low), Math.min(max, high)]) ? 'days_out_of_range' : null;
    }
    case 'switch_template': {
      const served = ctx.servedTemplates.find((s) => s.template.id === op.templateId);
      if (served === undefined || !served.available) return 'template_unavailable';
      if (op.templateId === template.id && served.template.version <= ctx.instanceTemplateVersion) {
        return 'template_unchanged';
      }
      if (op.daysPerWeek === undefined) return null;
      const { min, max } = served.template.daysPerWeek;
      const [low, high] = CHANGE_BOUNDS.days;
      return outside(op.daysPerWeek, [Math.max(min, low), Math.min(max, high)]) ? 'days_out_of_range' : null;
    }
  }
  const found = findSlot(template, op.slot);
  if (found === undefined) return 'slot_unknown';
  const { slot, workout } = found;
  switch (op.op) {
    case 'replace_exercise':
      return checkExercise(op.exercise, slot.movementPattern, ctx);
    case 'change_sets': {
      if (ctx.cautious && op.delta > 0) return 'forbidden_cautious';
      const max = ctx.cautious ? cautious.maxWorkSets : CHANGE_BOUNDS.workSets[1];
      return outside(workSetCount(slot) + op.delta, [CHANGE_BOUNDS.workSets[0], max])
        ? 'sets_out_of_bounds'
        : null;
    }
    case 'set_rep_range': {
      if (!slot.sets.some((s) => s.kind === 'work' && s.reps !== undefined)) return 'reps_out_of_bounds';
      const range: readonly [number, number] = ctx.cautious
        ? [cautious.repsMin, cautious.repsMax]
        : CHANGE_BOUNDS.reps;
      const gap = ctx.cautious ? cautious.minRepsGap : CHANGE_BOUNDS.minRepsGap;
      return outside(op.min, range) || outside(op.max, range) || op.max - op.min < gap
        ? 'reps_out_of_bounds'
        : null;
    }
    case 'set_target_rir': {
      const current = slot.sets.flatMap((s) =>
        s.kind === 'work' && s.targetRir !== undefined ? [s.targetRir] : [],
      );
      if (ctx.cautious && current.some((rir) => op.value < rir)) return 'forbidden_cautious';
      const beginnerMain =
        slot.role === 'main' && (ctx.level === 'beginner' || template.level === 'beginner');
      const min = beginnerMain ? CHANGE_BOUNDS.minRirBeginnerMain : CHANGE_BOUNDS.targetRir[0];
      return outside(op.value, [min, CHANGE_BOUNDS.targetRir[1]]) ? 'rir_out_of_bounds' : null;
    }
    case 'set_rest':
      return outside(op.seconds, ctx.rules.restS) ? 'rest_out_of_bounds' : null;
    case 'lighten_exercise':
      return null;
    case 'suspend_slot':
      return state.suspended.has(op.slot) ? 'already_suspended' : null;
    case 'resume_slot':
      return state.suspended.has(op.slot) ? null : 'not_suspended';
    case 'remove_slot':
      // Une séance garde au moins un slot (`WorkoutSpecSchema`).
      return workout.slots.length <= 1 ? 'slot_limit' : null;
  }
}

/**
 * Index de l'opération qui a fait basculer `bad` pour de bon : la dernière `j` dont l'état d'après est en défaut
 * et celui d'avant non. `states[0]` est le programme reçu (jamais en défaut), `states[j + 1]` l'état après `j`.
 */
function culprit(states: number, bad: (i: number) => boolean): number {
  for (let i = states - 1; i > 0; i -= 1) if (bad(i) && !bad(i - 1)) return i - 1;
  return 0;
}

/**
 * Couverture et volume du résultat (05 §15.3), comparés au programme reçu : un groupe de couverture couvert qui ne
 * l'est plus donne `coverage_lost` ; un groupe de volume qui sort de la fourchette, ou qui s'en éloigne s'il en
 * était déjà sorti (catalogue servi plus pauvre que celui de la CI), donne `volume_out_of_range`. La suspension
 * n'y entre pas : elle reste toujours permise.
 */
function resultErrors(states: readonly EffectiveProgram[], catalog: readonly CatalogSheet[]): ChangeError[] {
  const original = states[0];
  if (original === undefined || states.length < 2) return [];
  const errors: ChangeError[] = [];
  const gaps = states.map((s) => new Set(coverageGaps(s.template, catalog).map((g) => g.group)));
  const before = gaps[0] ?? new Set();
  for (const group of COVERAGE_GROUPS) {
    const lost = (i: number) => (gaps[i]?.has(group) ?? false) && !before.has(group);
    if (lost(states.length - 1)) errors.push({ op: culprit(states.length, lost), code: 'coverage_lost' });
  }
  const [min, max] = volumeRange(original.template);
  const distance = (sets: number) => (sets < min ? min - sets : sets > max ? sets - max : 0);
  const equipment = referenceEquipment(original.template.context);
  const volumes = states.map((s) => weeklyVolume(s.template, catalog, equipment));
  for (const group of Object.keys(VOLUME_GROUPS) as VolumeGroup[]) {
    const start = distance(volumes[0]?.[group] ?? 0);
    const worse = (i: number) => distance(volumes[i]?.[group] ?? 0) > start;
    if (worse(states.length - 1))
      errors.push({ op: culprit(states.length, worse), code: 'volume_out_of_range' });
  }
  return errors;
}

const codeRank = (code: ChangeErrorCode) => CHANGE_ERROR_CODES.indexOf(code);

/**
 * Valide un changement (05 §15) sur le programme effectif `program`. Les opérations s'appliquent l'une après
 * l'autre : chacune est bornée sur l'état laissé par les précédentes ; une opération refusée n'est pas appliquée.
 * Si toutes passent, la couverture et le volume se jugent sur le résultat. Rend le programme résultant, ou une
 * erreur par opération fautive (`op` = son index), triées par opération puis dans l'ordre de `CHANGE_ERROR_CODES`.
 */
export function validateChange(input: ChangeValidationInput): ChangeValidation {
  const ctx: Context = {
    author: input.change.author,
    cautious: input.profile === 'cautious',
    level: input.level,
    rules: currentRules(),
    byId: new Map(input.catalog.map((s) => [s.id, s])),
    places: input.places.length === 0 ? null : input.places.map((p) => expandEquipment(p.equipment)),
    servedTemplates: input.servedTemplates,
    instanceTemplateVersion: input.instanceTemplateVersion,
    addedTo: new Set(),
  };
  const changeId = input.change.id ?? PENDING_CHANGE_ID;
  const errors: ChangeError[] = [];
  const states: EffectiveProgram[] = [input.program];
  let state = input.program;
  input.change.operations.forEach((op, index) => {
    const code = checkOperation(state, op, ctx);
    if (code === null) {
      state = applyOperation(state, op, changeId);
      if (op.op === 'add_slot') ctx.addedTo.add(op.workout);
    } else {
      errors.push({ op: index, code });
    }
    states.push(state);
  });
  if (errors.length === 0) errors.push(...resultErrors(states, input.catalog));
  if (errors.length === 0) return { ok: true, program: state };
  errors.sort((a, b) => a.op - b.op || codeRank(a.code) - codeRank(b.code));
  return { ok: false, errors };
}
