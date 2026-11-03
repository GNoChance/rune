import type {
  AgeBand,
  ExerciseLevel,
  LoadMode,
  ProgramTemplate,
  SessionProfile,
  SetKind,
  SetSpec,
  Side,
  SlotSpec,
  WeekType,
} from '@rune/contracts';
import { initialMode, stateExerciseId } from './evaluate';
import { type LoadGrid, lightest, loadGrid, platesPerSide, roundDown } from './loads';
import { aimBounds, clamp, type Measure, repRange, slotMeasure, slotShape, workSpec } from './primitives';
import { parisDaysUntil, upcomingWeekType } from './program-state';
import type { ReplayResult } from './replay';
import { type PlanSheet, profileChain, resolveSlot, type SlotResolutionKind } from './resolve';
import { currentRules, RULES_VERSION, type RulesSet } from './rules';
import type { PlaceContext, SlotState } from './types';

/*
 * Préparation d'une séance (spec brique 3 §4.2, §4.3.5 à §4.3.10, §7.2) : ce que montre la séance du jour et ce que
 * « Commencer » fige, à partir du rejeu de l'instance. Pour chaque slot, l'exercice du jour au lieu choisi
 * (`resolveSlot`), ses séries d'échauffement et de travail avec leurs cibles, les disques par côté et les avis.
 */

/** Avis au-dessus de la liste (spec §7.2) ; les avis d'un exercice portent son identifiant. */
export type PlanNotice =
  /** Reprise après absence (05 §10.4) : jours depuis la dernière séance terminée, baisse des cibles en %. */
  | { code: 'resume'; days: number; pct: number }
  | { code: 'deload' }
  /** Mineur, exercice à la barre : s'entraîner avec un adulte expérimenté (05 §14). */
  | { code: 'minor_barbell'; exerciseId: string }
  /** Modèle `sport` : garder 3 h d'écart avec l'entraînement du sport. */
  | { code: 'sport_gap' }
  /** Aucune charge du lieu sous la cible : la plus légère disponible (spec §4.3.10). */
  | { code: 'lightest_load'; exerciseId: string }
  /** Aucun exercice de la séance n'est disponible : tous les slots sont sautés ou suspendus. */
  | { code: 'all_skipped' };

/** Série prévue, avec les cibles que « Commencer » fige dans `performed_set` (D2). */
export interface PlannedSet {
  kind: SetKind;
  /** De 1 à n parmi les séries de son type (échauffement, travail) ; les deux côtés d'une série la partagent. */
  position: number;
  side: Side | null;
  /** Fourchette de répétitions (« 3 × 6 » : 6 et 6) ; null pour une série en durée. */
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  /**
   * Répétitions visées par série, dans la fourchette : la visée du moteur (`slot_state.target_reps`, ruling R57) ;
   * null sans visée (échauffement, durée, nombre fixe, premier passage, autre variante de chaîne que celle de l'état,
   * semaine allégée, reprise).
   */
  targetReps: number | null;
  targetDurationS: number | null;
  /** Charge visée en grammes, réalisable au lieu du jour ; null sans charge ou quand l'utilisateur la choisit. */
  targetLoadG: number | null;
  targetRir: number | null;
  /** Variante de la chaîne du slot ; null hors chaîne. */
  targetVariant: string | null;
}

export interface PlannedExercise {
  slotId: string;
  /**
   * Exercice prévu par le programme (tête de liste ou variante visée), même quand il est remplacé ou sauté ; jamais
   * une fiche `not_for_minors` en profil prudent, null si le profil n'en permet aucune (`resolveSlot`, R28).
   */
  plannedExerciseId: string | null;
  /** Exercice du jour ; null pour un slot sauté ou suspendu, qui n'a alors aucune série. */
  exerciseId: string | null;
  resolution: SlotResolutionKind;
  loadMode: LoadMode | null;
  measure: Measure;
  unilateral: boolean;
  /** Échauffement puis travail ; en unilatéral, gauche puis droite à chaque position. */
  sets: PlannedSet[];
  /** Repos après une série de travail ; null si le modèle n'en donne pas. */
  restS: number | null;
  /** Disques d'un côté de la barre pour la charge de travail ; null hors barre ou sans charge visée. */
  platesPerSide: number[] | null;
  /** Calibration en cours (spec §4.3.5) : premières séances de l'exercice dans ce slot. */
  calibration: boolean;
  /** Calibration sans charge visée : dernière charge faite sur l'exercice, ramenée au lieu ; null à défaut. */
  suggestionG: number | null;
}

export interface PlannedWorkout {
  workoutId: string;
  /** Figé dans la séance (spec §4.3.8). */
  weekType: WeekType;
  rulesVersion: string;
  notices: PlanNotice[];
  exercises: PlannedExercise[];
}

export interface PlanInput {
  replay: ReplayResult;
  /** Séance choisie : celle de la rotation (`replay.state.nextWorkoutId`) ou une autre du modèle. */
  workoutId: string;
  place: PlaceContext;
  catalog: readonly PlanSheet[];
  profile: SessionProfile;
  ageBand: AgeBand;
  context: ProgramTemplate['context'];
  /** Date civile de Paris du jour, `YYYY-MM-DD`. */
  today: string;
  /** Dernière charge faite sur chaque exercice, toutes séances comprises (spec §4.3.5). */
  lastLoadByExercise: ReadonlyMap<string, number>;
  /**
   * Niveau de fiche le plus haut des remplaçants (05 §11.2) : `maxExerciseLevel` de l'expérience du membre, tirée de
   * son profil d'entraînement (2 si elle est inconnue, comme l'onglet Exercices), jamais du niveau du modèle.
   */
  maxLevel: ExerciseLevel;
}

/** Règle de reprise de l'écart (05 §10.4), la plus forte atteinte ; null sous 14 jours ou sans séance terminée. */
function resumeRule(days: number | null, rules: RulesSet): RulesSet['resume']['days14'] | null {
  if (days === null) return null;
  const { days14, days28 } = rules.resume;
  return days >= days28.days ? days28 : days >= days14.days ? days14 : null;
}

/** `value` baissée de `pct` %, arrondie à l'entier inférieur (grammes, secondes). */
const minusPct = (value: number, pct: number) => Math.floor((value * (100 - pct)) / 100);

const findState = (states: readonly SlotState[], slotId: string, exerciseId: string) =>
  states.find((s) => s.slotId === slotId && s.exerciseId === exerciseId) ?? null;

/** Lignes d'une série : une, ou gauche puis droite en unilatéral. */
function lines(unilateral: boolean, set: Omit<PlannedSet, 'side'>): PlannedSet[] {
  return unilateral
    ? [
        { ...set, side: 'left' },
        { ...set, side: 'right' },
      ]
    : [{ ...set, side: null }];
}

interface Env {
  input: PlanInput;
  rules: RulesSet;
  weekType: WeekType;
  cautious: boolean;
  resume: RulesSet['resume']['days14'] | null;
  notices: PlanNotice[];
}

/** Slot sauté ou suspendu : rien à faire, l'écran le dit (spec §7.2). */
function skipped(
  slot: SlotSpec,
  plannedExerciseId: string | null,
  resolution: SlotResolutionKind,
): PlannedExercise {
  return {
    slotId: slot.id,
    plannedExerciseId,
    exerciseId: null,
    resolution,
    loadMode: null,
    measure: slotMeasure(slot),
    unilateral: false,
    sets: [],
    restS: workSpec(slot)?.restS ?? null,
    platesPerSide: null,
    calibration: false,
    suggestionG: null,
  };
}

function planSlot(slot: SlotSpec, env: Env): PlannedExercise {
  const { input, rules, resume } = env;
  const { replay, place } = input;
  const steps = slot.chain === undefined ? null : profileChain(input.catalog, slot.chain, env.cautious);

  // Variante visée : celle de l'état de la chaîne, une de moins après 28 jours d'absence (05 §10.4).
  const chainState = slot.chain === undefined ? null : findState(replay.slotStates, slot.id, slot.chain);
  const back = resume?.variantsBack ?? 0;
  const aimed =
    chainState === null || chainState.variantRank === null || back === 0
      ? chainState
      : { ...chainState, variantRank: Math.max(1, chainState.variantRank - back) };
  const r = resolveSlot(slot, {
    catalog: input.catalog,
    place,
    cautious: env.cautious,
    maxLevel: input.maxLevel,
    state: aimed,
    suspended: replay.program.suspended.has(slot.id),
  });
  const ex = r.exercise;
  if (ex === null) return skipped(slot, r.plannedExerciseId, r.resolution);

  // Cibles de l'état (slot, exercice) de l'exercice du jour, ramenées au profil et au lieu du jour.
  const state = findState(replay.slotStates, slot.id, stateExerciseId(slot, ex.id, steps));
  const grid = loadGrid(ex.load_mode, place.loadSettings, state?.machineStepGOverride);
  const index = steps === null ? -1 : steps.findIndex((s) => s.id === ex.id);
  const rank = index === -1 ? null : index + 1;
  const shape = slotShape(slot, input.profile, grid, rules, rank === null ? null : (steps?.length ?? null));
  const mode = state?.mode ?? initialMode(slot.progression.type, shape, rank !== null);
  const reps = shape.measure === 'reps' ? repRange(shape, mode, rank) : null;
  const { durations } = shape;
  const held =
    shape.measure === 'duration'
      ? clamp(state?.durationS ?? durations.min, durations.min, durations.max)
      : null;
  // Reprise : durée −10 % ou −20 %, jamais sous le minimum du slot (comme l'allègement standard, 05 §12).
  const duration =
    held === null || resume === null ? held : Math.max(durations.min, minusPct(held, resume.loadPct));

  // Une charge sous la grille du lieu prend la plus légère disponible, avec l'avis (spec §4.3.10).
  const fit = (g: number): number | null => {
    const down = roundDown(grid, g);
    if (down !== null) return down;
    const low = lightest(grid);
    if (low !== null) env.notices.push({ code: 'lightest_load', exerciseId: ex.id });
    return low;
  };
  const loaded = grid.kind !== 'none';
  const base = loaded ? (state?.loadG ?? null) : null;
  const workLoad = base === null ? null : fit(resume === null ? base : minusPct(base, resume.loadPct));
  const calibration = slot.progression.type !== 'fixed' && (state === null || state.calibrationLeft > 0);
  const last = input.lastLoadByExercise.get(ex.id);
  const suggestionG = calibration && loaded && workLoad === null && last !== undefined ? fit(last) : null;

  const deload = env.weekType === 'deload';
  const work = deload ? Math.ceil(shape.planned / 2) : shape.planned;
  // Visée par série (ruling R57) : celle de l'état, ramenée dans la fourchette du jour, quand l'état vise ce niveau-ci
  // (même variante de chaîne, le rang de l'état ramené dans la chaîne du profil comme `resolveSlot` et le moteur).
  // Aucune en semaine allégée ni à la reprise : la fourchette suffit.
  const stateRank =
    state === null || state.variantRank === null || steps === null
      ? (state?.variantRank ?? null)
      : Math.min(state.variantRank, steps.length);
  const aim =
    reps === null ||
    reps.min === reps.max ||
    state === null ||
    state.targetReps === null ||
    stateRank !== rank ||
    deload ||
    resume !== null
      ? null
      : clamp(state.targetReps, reps.min, aimBounds(shape, mode, rank).max);
  const rir = deload ? Math.min(shape.targetRir + rules.deloadRirPlus, rules.deloadRirMax) : shape.targetRir;
  const variant = rank === null ? null : ex.id;

  const sets: PlannedSet[] = [];
  // Échauffement (05 §13.5) : `pctWorkLoad` de la charge de travail, arrondi par `roundDown`, au moins la charge la
  // plus légère (la barre). Sans charge, il n'a pas de sens et n'est pas prévu.
  if (loaded) {
    const warmupSpecs = slot.sets.filter((s) => s.kind === 'warmup');
    let position = 0;
    for (const spec of warmupSpecs) {
      for (let i = 0; i < spec.count; i++) {
        position++;
        sets.push(...lines(ex.unilateral, warmupSet(spec, position, workLoad, grid, variant)));
      }
    }
  }
  for (let position = 1; position <= work; position++) {
    sets.push(
      ...lines(ex.unilateral, {
        kind: 'work',
        position,
        targetRepsMin: reps?.min ?? null,
        targetRepsMax: reps?.max ?? null,
        targetReps: aim,
        targetDurationS: duration,
        targetLoadG: workLoad,
        targetRir: rir,
        targetVariant: variant,
      }),
    );
  }

  if (input.ageBand === 'minor' && ex.load_mode === 'barbell') {
    env.notices.push({ code: 'minor_barbell', exerciseId: ex.id });
  }
  return {
    slotId: slot.id,
    plannedExerciseId: r.plannedExerciseId,
    exerciseId: ex.id,
    resolution: r.resolution,
    loadMode: ex.load_mode,
    measure: shape.measure,
    unilateral: ex.unilateral,
    sets,
    restS: workSpec(slot)?.restS ?? null,
    platesPerSide:
      grid.kind === 'barbell' && workLoad !== null
        ? platesPerSide(workLoad, place.loadSettings.barG, place.loadSettings.smallestPlateG)
        : null,
    calibration,
    suggestionG,
  };
}

function warmupSet(
  spec: SetSpec,
  position: number,
  workLoad: number | null,
  grid: LoadGrid,
  variant: string | null,
): Omit<PlannedSet, 'side'> {
  const pct = spec.pctWorkLoad;
  const load =
    workLoad === null || pct === undefined
      ? null
      : (roundDown(grid, Math.floor((workLoad * pct) / 100)) ?? lightest(grid));
  return {
    kind: 'warmup',
    position,
    targetRepsMin: spec.reps?.min ?? null,
    targetRepsMax: spec.reps?.max ?? null,
    targetReps: null,
    targetDurationS: spec.durationS?.min ?? null,
    targetLoadG: load,
    targetRir: spec.targetRir ?? null,
    targetVariant: variant,
  };
}

/** Avis d'un exercice une seule fois, dans l'ordre où ils sont apparus. */
function distinct(notices: readonly PlanNotice[]): PlanNotice[] {
  const seen = new Set<string>();
  return notices.filter((n) => {
    const key = `${n.code}|${'exerciseId' in n ? n.exerciseId : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Séance prévue (spec §4.2, §7.2). Cibles des `slot_state` du rejeu, ramenées à la grille du lieu du jour
 * (§4.3.10) ; semaine allégée (05 §10.3) : séries de travail divisées par deux arrondi au-dessus, `targetRir` + 2
 * plafonné à 5, charges et variantes inchangées ; bornes du profil prudent (05 §14) ; reprise après absence
 * (05 §10.4), l'écart compté en jours civils de Paris et ramené à 0 s'il est négatif (horloge fausse). Lève une
 * `RangeError` si `workoutId` n'est pas une séance du programme.
 */
export function planWorkout(input: PlanInput): PlannedWorkout {
  const { replay } = input;
  const rules = currentRules();
  const { program, state } = replay;
  const workout = program.template.workouts.find((w) => w.id === input.workoutId);
  if (workout === undefined) throw new RangeError(`séance ${input.workoutId} absente du programme`);

  const last = state.lastCompletedStartedAt;
  const days = last === null ? null : Math.max(0, parisDaysUntil(Date.parse(last), input.today));
  const env: Env = {
    input,
    rules,
    weekType: upcomingWeekType(state, program),
    cautious: input.profile === 'cautious',
    resume: resumeRule(days, rules),
    notices: [],
  };
  const exercises = workout.slots.map((slot) => planSlot(slot, env));

  const notices: PlanNotice[] = [];
  // Une séance sans slot (tous retirés) n'a rien de sauté.
  if (exercises.length > 0 && exercises.every((e) => e.exerciseId === null)) {
    notices.push({ code: 'all_skipped' });
  }
  if (env.resume !== null && days !== null) {
    notices.push({ code: 'resume', days, pct: env.resume.loadPct });
  }
  if (env.weekType === 'deload') notices.push({ code: 'deload' });
  if (input.context === 'sport') notices.push({ code: 'sport_gap' });
  return {
    workoutId: workout.id,
    weekType: env.weekType,
    rulesVersion: RULES_VERSION,
    notices: [...notices, ...distinct(env.notices)],
    exercises,
  };
}
