import {
  type AgeBand,
  type BodyArea,
  type ChangeAuthor,
  type CoachAgeBand,
  type CoachBrief,
  CoachBriefSchema,
  cleanCoachText,
  DAYS_PER_WEEK,
  defaultLoadSettings,
  EQUIPMENT,
  type EquipmentCode,
  type ExerciseSheet,
  type Experience,
  type Goal,
  type InstanceChangeOperation,
  type LimitationSeverity,
  type LimitationSide,
  type LoadSettings,
  maxExerciseLevel,
  PAIN_CODE_REWRITES,
  type PainLevel,
  REASON_TEXTS,
  type ReasonCode,
  SESSION_MINUTES,
  type ServedProgramTemplate,
  type SessionProfile,
  type Side,
  type SlotSpec,
  SportCodeSchema,
  type WorkoutSpec,
} from '@rune/contracts';
import { expandEquipment } from '../catalog/equipment';
import { type EffectiveProgram, workSetCount } from '../program/effective';
import { workSpec } from '../program/primitives';
import { parisDaysUntil } from '../program/program-state';
import type { ReplayResult } from '../program/replay';
import { type PlanSheet, resolveSlot } from '../program/resolve';
import { currentRules, RULES_VERSION } from '../program/rules';
import {
  type EngineDecision,
  isDone,
  type PlaceContext,
  type SessionRecord,
  type SetRecord,
  type SlotState,
} from '../program/types';
import { exerciseRecords } from '../progress/records';
import { levelFromExperience, templateContext } from '../recommend-template';
import { COACH_CONFIG } from './config';

/*
 * Dossier envoyé au coach (`coach-brief/1`, spec brique 4 §9 et §15) : ce que le coach sait de la personne. Fonction
 * pure ; le serveur rassemble l'entrée (tâche 15). Vie privée : aucun nom de lieu (lieux renommés `lieu_n`), aucun
 * identifiant de base (instance, lieu, séance, exercice réalisé, série ; changement, porté par l'identifiant d'un slot
 * ajouté, d'où ses alias `A-x1`…), aucune date de naissance (l'entrée n'a que `audience` et `ageBand`, calculés dans
 * `age.ts`, R-AGE-3), aucune donnée de santé sans l'accord santé ET l'accord coach (C2). Seule `today` est une date
 * absolue. Sortie validée par `CoachBriefSchema`, clés triées, sans espace.
 */

/** Fiche lue par le dossier : celle de la préparation des séances, plus son nom (une `ServedSheet` les a). */
export type BriefSheet = PlanSheet & Pick<ExerciseSheet, 'name'>;

export interface BriefExercise {
  exerciseId: string;
  painLevel: PainLevel | null;
  note: string | null;
  sets: SetRecord[];
}

/** Séance `completed` ; ses identifiants de base ne sont pas dans l'entrée. */
export interface BriefSession {
  endedAt: number;
  /** Nom de la séance du programme ; null pour une séance libre. */
  workoutName: string | null;
  placeId: string | null;
  note: string | null;
  exercises: BriefExercise[];
}

/** Lieu vivant ; `id` et `name` ne sortent jamais du domaine. */
export interface BriefPlaceInput {
  id: string;
  name: string | null;
  kind: 'gym' | 'home';
  primary: boolean;
  equipment: EquipmentCode[];
  loadSettings: LoadSettings;
}

export interface BriefProgramInput {
  templateVersion: number;
  revision: number;
  program: EffectiveProgram;
  replay: ReplayResult;
  /**
   * Fin (millisecondes Unix) de la séance de chaque décision du rejeu, par `EngineDecision.id` (l'exercice réalisé) :
   * le `days_ago` de la dernière décision d'un slot. Le serveur la tire des séances de l'entrée du rejeu.
   */
  decisionEndedAt: ReadonlyMap<string, number>;
  pending: { author: ChangeAuthor; operations: InstanceChangeOperation[]; expiresAt: number }[];
  templates: ServedProgramTemplate[];
}

export interface BriefLimitation {
  area: BodyArea;
  side: LimitationSide;
  severity: LimitationSeverity;
  note: string | null;
}

export interface CoachBriefInput {
  /** Jour de Paris `YYYY-MM-DD`, seule date absolue du dossier. */
  today: string;
  audience: AgeBand;
  ageBand: CoachAgeBand;
  consents: { health: boolean; coach: boolean };
  /** Valeurs lues en base : une valeur hors du contrat part à null. */
  profile: {
    experience: Experience | null;
    goal: Goal | null;
    daysPerWeek: number | null;
    sessionMinutes: number | null;
    sportCode: string | null;
    cautiousMode: boolean;
    engineProfile: SessionProfile;
  };
  places: BriefPlaceInput[];
  program: BriefProgramInput | null;
  /** Séances `completed` des 28 derniers jours. */
  sessions: BriefSession[];
  catalog: readonly BriefSheet[];
  limitations: BriefLimitation[];
}

type BriefSlot = NonNullable<CoachBrief['program']>['workouts'][number]['slots'][number];
type HistorySession = CoachBrief['history']['sessions'][number];
type HistorySet = HistorySession['exercises'][number]['sets'][number];
type BriefRecord = CoachBrief['records'][number];

/** Textes libres : 200 caractères au plus (choix C24), la borne de `CoachBriefSchema`. */
const FREE_TEXT_MAX = 200;
/** Records gardés quand les séances retirées ne suffisent pas (§9). */
const TRUNCATED_RECORDS = 15;
const FREE_SESSION_NAME = 'Séance libre';

/** Sans lieu principal, tout est faisable (spec brique 2 §4.1) : le slot montre l'exercice prévu. */
const ANYWHERE: PlaceContext = {
  id: '',
  equipment: new Set(EQUIPMENT),
  loadSettings: defaultLoadSettings('gym'),
};

/** Codes de douleur réécrits sans l'accord C2, comme au retrait de l'accord santé (05 §13.9). */
const PAIN_REASONS: Partial<Record<ReasonCode, ReasonCode>> = {
  PAIN_HOLD: PAIN_CODE_REWRITES.PAIN_HOLD,
  PAIN_LIGHTEN: PAIN_CODE_REWRITES.PAIN_LIGHTEN,
};

// ---------------------------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------------------------

/** JSON à clés en ordre binaire (unités UTF-16) à toute profondeur, sans espace ; `undefined` omis comme par JSON. */
export function sortedJson(value: unknown): string {
  return serialize(value) ?? 'null';
}

function serialize(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => serialize(v) ?? 'null').join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = entries.flatMap(([k, v]) => {
    const s = serialize(v);
    return s === undefined ? [] : [`${JSON.stringify(k)}:${s}`];
  });
  return `{${parts.join(',')}}`;
}

/** Jetons estimés d'un JSON : un pour trois caractères (choix C43), recalé par l'évaluation. */
export function estimateTokens(json: string): number {
  return Math.ceil(json.length / 3);
}

/** Les premières unités UTF-16 de `text`, `max` au plus, sans couper une paire. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** Texte libre du dossier : `cleanCoachText` (seul nettoyage), puis 200 caractères au plus ; vide → null. */
export function cleanFreeText(text: string | null): string | null {
  if (text === null) return null;
  const cleaned = cut(cleanCoachText(text), FREE_TEXT_MAX).trimEnd();
  return cleaned === '' ? null : cleaned;
}

/** Grammes → kilogrammes, 2 décimales au plus. */
const kg = (g: number): number => Math.round(g / 10) / 100;

/** Jours civils de Paris jusqu'à `today` ; un instant à venir (horloge fausse) compte pour aujourd'hui. */
const daysAgo = (ms: number, today: string): number => Math.max(0, parisDaysUntil(ms, today));

/** `value` s'il est une des valeurs du contrat, sinon null. */
const oneOf = <T extends number>(allowed: readonly T[], value: number | null): T | null =>
  allowed.find((v) => v === value) ?? null;

const healthAllowed = (input: CoachBriefInput): boolean => input.consents.health && input.consents.coach;

const primaryOf = (input: CoachBriefInput): BriefPlaceInput | undefined =>
  input.places.find((p) => p.primary);

/** Nom d'une fiche ; son identifiant si le catalogue ne la connaît pas. */
function sheetNames(input: CoachBriefInput): (id: string) => string {
  const names = new Map(input.catalog.map((s) => [s.id, s.name]));
  return (id) => names.get(id) ?? id;
}

/** Lieux vivants sous leur nom neutre : le principal `lieu_1`, puis les autres `lieu_2`… dans l'ordre reçu. */
function namedPlaces(input: CoachBriefInput): { place: BriefPlaceInput; name: string }[] {
  const primary = primaryOf(input);
  const ordered =
    primary === undefined ? input.places : [primary, ...input.places.filter((p) => p !== primary)];
  return ordered.map((place, i) => ({ place, name: `lieu_${i + 1}` }));
}

/** Séances des `days` derniers jours (bornes comprises), la plus récente d'abord. */
function sessionsWithin(input: CoachBriefInput, days: number): BriefSession[] {
  return input.sessions
    .filter((s) => parisDaysUntil(s.endedAt, input.today) <= days)
    .sort((a, b) => b.endedAt - a.endedAt);
}

// ---------------------------------------------------------------------------------------------------------------
// Profil et lieux
// ---------------------------------------------------------------------------------------------------------------

/** `context.kind` : règle de `recommendTemplate` ; `sport_code` seulement en contexte `sport`. */
function briefProfile(input: CoachBriefInput): CoachBrief['profile'] {
  const p = input.profile;
  const kind = templateContext(p.goal, p.sportCode, primaryOf(input)?.kind ?? 'gym');
  const sport = SportCodeSchema.safeParse(p.sportCode?.trim());
  return {
    level: p.experience === null ? null : levelFromExperience(p.experience),
    goal: p.goal,
    days_per_week: oneOf(DAYS_PER_WEEK, p.daysPerWeek),
    session_minutes: oneOf(SESSION_MINUTES, p.sessionMinutes),
    cautious_mode: p.cautiousMode,
    engine_profile: p.engineProfile,
    context: { kind, sport_code: kind === 'sport' && sport.success ? sport.data : null },
  };
}

/** Matériel en codes de la taxonomie ; réglages de charge en kg pour le lieu principal seulement (choix C23). */
function briefPlaces(input: CoachBriefInput): CoachBrief['places'] {
  const primary = primaryOf(input);
  return namedPlaces(input).map(({ place, name }) => ({
    name,
    kind: place.kind,
    primary: place === primary,
    equipment: [...new Set(place.equipment)].sort(),
    ...(place === primary
      ? {
          load_settings: {
            bar_kg: kg(place.loadSettings.barG),
            smallest_plate_kg: kg(place.loadSettings.smallestPlateG),
            machine_step_kg: kg(place.loadSettings.machineStepG),
          },
        }
      : {}),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------------------------------------------

interface ResolvedSlot {
  slot: SlotSpec;
  sheet: BriefSheet | null;
  state: SlotState | null;
}

/**
 * Exercice de chaque slot au lieu principal (05 §11), comme « Mon programme » le montre : l'exercice résolu, sinon
 * celui que prévoit le programme (slot suspendu, rien de faisable) ; et l'état du moteur de cet exercice, celui de
 * la chaîne pour un slot `chain`.
 */
function resolvedWorkouts(
  input: CoachBriefInput,
  program: BriefProgramInput,
): { workout: WorkoutSpec; slots: ResolvedSlot[] }[] {
  const primary = primaryOf(input);
  const place: PlaceContext =
    primary === undefined
      ? ANYWHERE
      : { id: primary.id, equipment: expandEquipment(primary.equipment), loadSettings: primary.loadSettings };
  const sheets = new Map(input.catalog.map((s) => [s.id, s]));
  const ctx = {
    catalog: input.catalog,
    place,
    cautious: input.profile.engineProfile === 'cautious',
    maxLevel: maxExerciseLevel(input.profile.experience),
  };
  const { template, suspended } = program.program;
  return template.workouts.map((workout) => ({
    workout,
    slots: workout.slots.map((slot) => {
      const ofSlot = program.replay.slotStates.filter((st) => st.slotId === slot.id);
      const chainState =
        slot.chain === undefined ? null : (ofSlot.find((st) => st.exerciseId === slot.chain) ?? null);
      const r = resolveSlot(slot, { ...ctx, state: chainState, suspended: suspended.has(slot.id) });
      const planned = r.plannedExerciseId === null ? undefined : sheets.get(r.plannedExerciseId);
      const sheet = r.exercise ?? planned ?? null;
      const state = chainState ?? ofSlot.find((st) => st.exerciseId === sheet?.id) ?? null;
      return { slot, sheet, state };
    }),
  }));
}

/** Dernière décision d'un slot ; null sans décision, ou si sa séance n'est pas connue. */
function lastDecision(
  decision: EngineDecision | undefined,
  input: CoachBriefInput,
  program: BriefProgramInput,
): BriefSlot['last_decision'] {
  const at = decision === undefined ? undefined : program.decisionEndedAt.get(decision.id);
  if (decision === undefined || at === undefined) return null;
  const code = healthAllowed(input)
    ? decision.reasonCode
    : (PAIN_REASONS[decision.reasonCode] ?? decision.reasonCode);
  return {
    days_ago: daysAgo(at, input.today),
    result: decision.result,
    reason_code: code,
    reason_text: REASON_TEXTS[code],
  };
}

/** Suffixe d'un slot créé par `add_slot` (`addedSlotId`) : l'identifiant du changement, un UUID. */
const CHANGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANGE_ID_LENGTH = 36;

/** Séance d'un slot créé par `add_slot` (`${workoutId}-${changeId}`) ; null pour un slot du modèle. */
function addedSlotWorkout(slotId: string): string | null {
  const dash = slotId.length - CHANGE_ID_LENGTH - 1;
  if (dash < 1 || slotId[dash] !== '-' || !CHANGE_ID.test(slotId.slice(dash + 1))) return null;
  return slotId.slice(0, dash);
}

/**
 * Alias des slots créés par `add_slot` (identifiant réel → alias) : leur identifiant porte celui d'un changement, un
 * UUIDv7 avec son instant, qui ne part jamais au modèle. `${workoutId}-x1`, `-x2`… par séance, dans l'ordre du
 * programme effectif, puis des références des propositions en attente à un slot qui n'y est plus ; jamais
 * l'identifiant d'un slot du modèle. Les slots du modèle gardent le leur.
 */
function slotAliasesOf(program: BriefProgramInput): Map<string, string> {
  const workouts = program.program.template.workouts;
  const taken = new Set(workouts.flatMap((w) => w.slots.map((s) => s.id)));
  const counts = new Map<string, number>();
  const aliases = new Map<string, string>();
  const give = (slotId: string): void => {
    const workout = addedSlotWorkout(slotId);
    if (workout === null || aliases.has(slotId)) return;
    let n = counts.get(workout) ?? 0;
    let alias: string;
    do {
      n += 1;
      alias = `${workout}-x${n}`;
    } while (taken.has(alias));
    counts.set(workout, n);
    taken.add(alias);
    aliases.set(slotId, alias);
  };
  for (const w of workouts) for (const s of w.slots) give(s.id);
  for (const c of program.pending) for (const op of c.operations) if ('slot' in op) give(op.slot);
  return aliases;
}

/**
 * Identifiant réel d'une référence de slot venue du modèle : `aliases` est le `slotAliases` de `buildCoachBrief`
 * (alias → identifiant réel) ; une référence qui n'est pas un alias est rendue telle quelle.
 */
export function resolveSlotAlias(ref: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(ref) ?? ref;
}

/** Cibles du modèle (groupe de travail du slot) et état du moteur, sans `planWorkout` (choix C23). */
function briefSlot(
  { slot, sheet, state }: ResolvedSlot,
  id: string,
  last: BriefSlot['last_decision'],
): BriefSlot {
  const spec = workSpec(slot);
  return {
    id,
    role: slot.role,
    movement_pattern: slot.movementPattern,
    exercise: sheet === null ? null : { id: sheet.id, name: sheet.name },
    sets: workSetCount(slot),
    reps: spec?.reps === undefined ? null : { min: spec.reps.min, max: spec.reps.max },
    duration_s: spec?.durationS === undefined ? null : { min: spec.durationS.min, max: spec.durationS.max },
    target_rir: spec?.targetRir ?? currentRules().defaultTargetRir,
    rest_s: spec?.restS ?? null,
    engine:
      state === null
        ? null
        : {
            mode: state.mode,
            load_kg: state.loadG === null ? null : kg(state.loadG),
            target_reps: state.targetReps,
            variant_rank: state.variantRank,
            duration_s: state.durationS,
            calibration_left: state.calibrationLeft,
            suspended: state.suspended,
          },
    last_decision: last,
  };
}

/**
 * Programme en cours (forme du dossier, aussi rendue par `read_training`) : modèle, révision, semaine, séance
 * suivante, slots, propositions en attente (jours restants), modèles disponibles ; null sans programme. Un slot créé
 * par `add_slot` y porte son alias, dans les slots comme dans les opérations en attente.
 */
export function briefProgram(input: CoachBriefInput): CoachBrief['program'] {
  const program = input.program;
  if (program === null) return null;
  const { template, daysPerWeek } = program.program;
  const { state, decisions } = program.replay;
  // Les décisions sont dans l'ordre du rejeu : la dernière d'un slot remplace les précédentes.
  const latest = new Map(decisions.map((d) => [d.slotId, d]));
  const aliases = slotAliasesOf(program);
  const sent = (slotId: string): string => aliases.get(slotId) ?? slotId;
  return {
    template: { id: template.id, name: template.name, version: program.templateVersion },
    revision: program.revision,
    week: state.weekIndex + 1,
    block_week: state.blockWeek,
    next_workout_id: state.nextWorkoutId,
    days_per_week: daysPerWeek,
    workouts: resolvedWorkouts(input, program).map(({ workout, slots }) => ({
      id: workout.id,
      name: workout.name,
      slots: slots.map((r) =>
        briefSlot(r, sent(r.slot.id), lastDecision(latest.get(r.slot.id), input, program)),
      ),
    })),
    pending_proposals: program.pending.map((c) => ({
      author: c.author,
      operations: c.operations.map((op) => ('slot' in op ? { ...op, slot: sent(op.slot) } : op)),
      days_left: Math.max(0, -parisDaysUntil(c.expiresAt, input.today)),
    })),
    templates: program.templates
      .filter((t) => t.available)
      .map(({ template: t }) => ({
        id: t.id,
        name: t.name,
        summary: t.description,
        context: t.context,
        level: t.level,
        days_min: t.daysPerWeek.min,
        days_max: t.daysPerWeek.max,
      })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Historique et records
// ---------------------------------------------------------------------------------------------------------------

const sideRank = (side: Side | null): number => (side === 'right' ? 2 : side === 'left' ? 1 : 0);

/** Séries de travail faites, dans l'ordre de la séance, en tuples `[load_kg, reps, duration_s, effort]`. */
function workTuples(sets: readonly SetRecord[]): HistorySet[] {
  return sets
    .filter((s) => s.kind === 'work' && isDone(s))
    .sort((a, b) => a.position - b.position || sideRank(a.side) - sideRank(b.side))
    .map((s) => [s.loadG === null ? null : kg(s.loadG), s.reps, s.durationS, s.effort]);
}

/**
 * `user_notes` d'une séance (choix C24) : sa note, puis la note de chaque exercice précédée du nom de l'exercice,
 * chacune passée par `cleanFreeText`, jointes par des retours à la ligne, 200 caractères au plus au total.
 */
function userNotes(
  session: BriefSession,
  exercises: readonly BriefExercise[],
  nameOf: (id: string) => string,
): string | null {
  const parts = [
    cleanFreeText(session.note),
    ...exercises.map((e) => {
      const note = cleanFreeText(e.note);
      return note === null ? null : `${nameOf(e.exerciseId)} : ${note}`;
    }),
  ].filter((p) => p !== null);
  return cleanFreeText(parts.join('\n'));
}

/**
 * Séances terminées des `days` derniers jours, la plus récente d'abord : jours écoulés, nom (« Séance libre » hors
 * programme), lieu (`lieu_n`, null s'il n'est plus vivant ou absent), exercices et séries de travail faites, notes.
 * `pain` : douleur par exercice, à ne demander qu'avec l'accord santé et l'accord coach (C2). `exerciseId` : seules
 * les séances de cet exercice, réduites à lui.
 */
export function briefHistory(
  input: CoachBriefInput,
  opts: { days: number; exerciseId?: string; pain: boolean },
): HistorySession[] {
  const places = new Map(namedPlaces(input).map(({ place, name }) => [place.id, name]));
  const nameOf = sheetNames(input);
  return sessionsWithin(input, opts.days).flatMap((s) => {
    const exercises =
      opts.exerciseId === undefined
        ? s.exercises
        : s.exercises.filter((e) => e.exerciseId === opts.exerciseId);
    if (opts.exerciseId !== undefined && exercises.length === 0) return [];
    const notes = userNotes(s, exercises, nameOf);
    return [
      {
        days_ago: daysAgo(s.endedAt, input.today),
        name: s.workoutName ?? FREE_SESSION_NAME,
        place: (s.placeId === null ? undefined : places.get(s.placeId)) ?? null,
        exercises: exercises.map((e) => ({
          id: e.exerciseId,
          name: nameOf(e.exerciseId),
          sets: workTuples(e.sets),
          ...(opts.pain && e.painLevel !== null ? { pain: e.painLevel } : {}),
        })),
        ...(notes === null ? {} : { user_notes: notes }),
      },
    ];
  });
}

/** Séance du dossier telle que `exerciseRecords` la lit : seuls ses exercices et leurs séries comptent. */
function asSessionRecord(s: BriefSession): SessionRecord {
  return {
    id: '',
    instanceId: null,
    workoutId: null,
    placeId: null,
    startedAt: s.endedAt,
    endedAt: s.endedAt,
    status: 'completed',
    weekType: 'normal',
    profile: 'adult',
    rulesVersion: RULES_VERSION,
    exercises: s.exercises.map((e, i) => ({
      id: '',
      slotId: null,
      plannedExerciseId: null,
      exerciseId: e.exerciseId,
      position: i + 1,
      swapReason: null,
      painLevel: null,
      nextAdjustment: null,
      sets: e.sets,
    })),
  };
}

/**
 * Records sur `sessions` (meilleure série, plus de répétitions, plus longue durée ; `e1rm_kg` pour un adulte
 * seulement, brique 3 D9), un par exercice qui en a : ceux des slots du programme d'abord, dans son ordre, puis les
 * autres, de la séance la plus récente à la plus ancienne.
 */
export function briefRecords(input: CoachBriefInput, sessions: readonly BriefSession[]): BriefRecord[] {
  const history = sessions.map(asSessionRecord);
  const programIds =
    input.program === null
      ? []
      : resolvedWorkouts(input, input.program).flatMap(({ slots }) =>
          slots.flatMap(({ sheet }) => (sheet === null ? [] : [sheet.id])),
        );
  const recent = [...sessions].sort((a, b) => b.endedAt - a.endedAt);
  const ids = new Set([...programIds, ...recent.flatMap((s) => s.exercises.map((e) => e.exerciseId))]);
  const nameOf = sheetNames(input);
  return [...ids].flatMap((id) => {
    const r = exerciseRecords(history, id, input.audience);
    if (r.bestLoad === null && r.bestReps === null && r.bestDurationS === null) return [];
    return [
      {
        exercise_id: id,
        name: nameOf(id),
        best_set: r.bestLoad === null ? null : { load_kg: kg(r.bestLoad.loadG), reps: r.bestLoad.reps },
        most_reps: r.bestReps,
        longest_s: r.bestDurationS,
        ...(r.e1rmG === null ? {} : { e1rm_kg: kg(r.e1rmG) }),
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Dossier
// ---------------------------------------------------------------------------------------------------------------

function withoutNotes(brief: CoachBrief): CoachBrief {
  return {
    ...brief,
    history: { ...brief.history, sessions: brief.history.sessions.map(({ user_notes: _notes, ...s }) => s) },
    ...(brief.health === undefined
      ? {}
      : { health: { limitations: brief.health.limitations.map((l) => ({ ...l, note: null })) } }),
  };
}

/**
 * Plafond (§9, choix C43) : au-delà de `max` jetons estimés, retrait des séances les plus anciennes une à une, puis
 * des records au-delà de 15, puis des notes, chaque étape seulement si la précédente ne suffit pas ;
 * `history.truncated` le dit.
 */
function fit(brief: CoachBrief, max: number): CoachBrief {
  const fits = (b: CoachBrief) => estimateTokens(sortedJson(b)) <= max;
  if (fits(brief)) return brief;
  const { sessions } = brief.history;
  const keep = (n: number): CoachBrief => ({
    ...brief,
    history: { sessions: sessions.slice(0, n), truncated: true },
  });
  let n = sessions.length;
  let out = keep(n);
  while (n > 0 && !fits(out)) {
    n -= 1;
    out = keep(n);
  }
  if (!fits(out)) out = { ...out, records: out.records.slice(0, TRUNCATED_RECORDS) };
  if (!fits(out)) out = withoutNotes(out);
  return out;
}

/**
 * Dossier `coach-brief/1` du fil (§9) : le dossier validé par `CoachBriefSchema`, son JSON à clés triées sans espace
 * (celui que reçoit le modèle et que stocke le fil), ses jetons estimés, et `slotAliases` (alias d'un slot créé par
 * `add_slot` → son identifiant réel), pour retraduire les références de slot des opérations proposées
 * (`resolveSlotAlias`).
 */
export function buildCoachBrief(input: CoachBriefInput): {
  brief: CoachBrief;
  json: string;
  estimatedTokens: number;
  slotAliases: ReadonlyMap<string, string>;
} {
  const health = healthAllowed(input);
  const days = COACH_CONFIG.limits.readTrainingMaxDays;
  const draft: CoachBrief = {
    schema: 'coach-brief/1',
    today: input.today,
    audience: input.audience,
    age_band: input.ageBand,
    profile: briefProfile(input),
    places: briefPlaces(input),
    program: briefProgram(input),
    history: { sessions: briefHistory(input, { days, pain: health }), truncated: false },
    records: briefRecords(input, sessionsWithin(input, days)),
    ...(health
      ? {
          health: {
            limitations: input.limitations.map((l) => ({
              area: l.area,
              side: l.side,
              severity: l.severity,
              note: cleanFreeText(l.note),
            })),
          },
        }
      : {}),
    nutrition: null,
  };
  const brief = CoachBriefSchema.parse(fit(draft, COACH_CONFIG.limits.briefMaxTokens));
  const json = sortedJson(brief);
  const aliases = input.program === null ? [] : [...slotAliasesOf(input.program)];
  const slotAliases = new Map(aliases.map(([slotId, alias]) => [alias, slotId]));
  return { brief, json, estimatedTokens: estimateTokens(json), slotAliases };
}
