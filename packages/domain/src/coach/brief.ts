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
import { levelFromExperience, type TemplateContext, templateContext } from '../recommend-template';
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

/** Décision du moteur rendue par `read_training` : la `last_decision` d'un slot, avec ce slot et l'exercice fait. */
export type BriefDecision = NonNullable<BriefSlot['last_decision']> & { slot: string; exercise_id: string };

/** Textes libres : 200 caractères au plus (choix C24), la borne de `CoachBriefSchema`. */
const FREE_TEXT_MAX = 200;
/** Records gardés quand les séances retirées ne suffisent pas (15 au §9 ; 10, décision du contrôleur). */
const TRUNCATED_RECORDS = 10;
/** Séances gardées avant de toucher aux records et aux notes, puis en dernier recours. */
const KEPT_SESSIONS = 3;
const LAST_SESSIONS = 1;
const FREE_SESSION_NAME = 'Séance libre';

/**
 * Lieu de résolution sans lieu principal : tout est faisable (spec brique 2 §4.1), le slot montre l'exercice prévu.
 * Le même pour le dossier et pour le contexte de la séance prévue côté serveur (`loadPlanContext`).
 */
export const ANYWHERE: PlaceContext = {
  id: '',
  equipment: new Set(EQUIPMENT),
  loadSettings: defaultLoadSettings('gym'),
};

/** Codes de douleur réécrits sans l'accord C2, comme au retrait de l'accord santé (05 §13.9). */
const PAIN_REASONS: Partial<Record<ReasonCode, ReasonCode>> = {
  PAIN_HOLD: PAIN_CODE_REWRITES.PAIN_HOLD,
  PAIN_LIGHTEN: PAIN_CODE_REWRITES.PAIN_LIGHTEN,
};

/** Table des alias figée avec un fil (alias → identifiant réel, la forme de `slotAliases`) : aucune. */
const NO_ALIASES: ReadonlyMap<string, string> = new Map();

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

/** `RangeError` si `audience` et `ageBand` se contredisent (`minor` ⇔ `16-17`). */
function checkAge(input: CoachBriefInput): void {
  if ((input.audience === 'minor') !== (input.ageBand === '16-17')) {
    throw new RangeError(`audience ${input.audience} et tranche ${input.ageBand} incompatibles`);
  }
}

const primaryOf = (input: Pick<CoachBriefInput, 'places'>): BriefPlaceInput | undefined =>
  input.places.find((p) => p.primary);

/** Nom d'une fiche ; son identifiant si le catalogue ne la connaît pas. */
function sheetNames(input: CoachBriefInput): (id: string) => string {
  const names = new Map(input.catalog.map((s) => [s.id, s.name]));
  return (id) => names.get(id) ?? id;
}

/**
 * Lieux vivants sous leur nom neutre : le principal `lieu_1`, puis les autres `lieu_2`… dans l'ordre reçu ; les mêmes
 * noms dans le dossier et dans les outils (`feasible_at` de `search_exercises`).
 */
export function namedPlaces(
  input: Pick<CoachBriefInput, 'places'>,
): { place: BriefPlaceInput; name: string }[] {
  const primary = primaryOf(input);
  const ordered =
    primary === undefined ? input.places : [primary, ...input.places.filter((p) => p !== primary)];
  return ordered.map((place, i) => ({ place, name: `lieu_${i + 1}` }));
}

/** Séances des `days` derniers jours (bornes comprises), la plus récente d'abord ; `read_training` y prend ses records. */
export function sessionsWithin(input: CoachBriefInput, days: number): BriefSession[] {
  return input.sessions
    .filter((s) => parisDaysUntil(s.endedAt, input.today) <= days)
    .sort((a, b) => b.endedAt - a.endedAt);
}

// ---------------------------------------------------------------------------------------------------------------
// Profil et lieux
// ---------------------------------------------------------------------------------------------------------------

/** `context.kind` : règle de `recommendTemplate` ; `sport_code` seulement en contexte `sport`. */
const contextKind = (input: CoachBriefInput): TemplateContext =>
  templateContext(input.profile.goal, input.profile.sportCode, primaryOf(input)?.kind ?? 'gym');

function briefProfile(input: CoachBriefInput): CoachBrief['profile'] {
  const p = input.profile;
  const kind = contextKind(input);
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

/** Une décision du moteur, terminée à `at` : jours écoulés, résultat, code (de douleur réécrit sans l'accord C2). */
function decisionOf(
  decision: EngineDecision,
  at: number,
  input: CoachBriefInput,
): NonNullable<BriefSlot['last_decision']> {
  const code = healthAllowed(input)
    ? decision.reasonCode
    : (PAIN_REASONS[decision.reasonCode] ?? decision.reasonCode);
  return { days_ago: daysAgo(at, input.today), result: decision.result, reason_code: code };
}

/** Dernière décision d'un slot ; aucune sans décision, ou si sa séance n'est pas connue. */
function lastDecision(
  decision: EngineDecision | undefined,
  input: CoachBriefInput,
  program: BriefProgramInput,
): BriefSlot['last_decision'] {
  const at = decision === undefined ? undefined : program.decisionEndedAt.get(decision.id);
  if (decision === undefined || at === undefined) return undefined;
  return decisionOf(decision, at, input);
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

/** Rang `n` de l'alias `${workout}-x${n}` ; 0 pour un alias d'une autre forme. */
function aliasRank(alias: string, workout: string): number {
  const prefix = `${workout}-x`;
  const n = alias.startsWith(prefix) ? Number(alias.slice(prefix.length)) : 0;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * Seule règle des alias des slots créés par `add_slot` (identifiant réel → alias) : leur identifiant porte celui d'un
 * changement, un UUIDv7 avec son instant, qui ne part jamais au modèle. `${workoutId}-x1`, `-x2`… par séance, dans
 * l'ordre du programme effectif, puis des références `extraRefs` (propositions en attente) à un slot qui n'y est
 * plus ; jamais l'identifiant d'un slot du modèle. Les slots du modèle gardent le leur. Les références de `extraRefs`
 * passent après les slots du programme : elles ne changent l'alias d'aucun d'eux.
 *
 * `frozen` amorce la table : c'est la table figée d'un fil (alias → identifiant réel, `slotAliases` du dossier). Un
 * slot qui y est garde son alias, sauf si cet alias est devenu l'identifiant d'un slot du modèle ; un slot ajouté
 * depuis le gel reçoit un alias au-delà du plus grand alias figé de sa séance, et aucun alias figé ne change de slot.
 */
function assignAliases(
  program: EffectiveProgram,
  frozen: ReadonlyMap<string, string>,
  extraRefs: readonly string[],
): Map<string, string> {
  const workouts = program.template.workouts;
  const taken = new Set(workouts.flatMap((w) => w.slots.map((s) => s.id)));
  const counts = new Map<string, number>();
  const aliases = new Map<string, string>();
  for (const [alias, slotId] of frozen) {
    const workout = addedSlotWorkout(slotId);
    if (workout === null) continue;
    counts.set(workout, Math.max(counts.get(workout) ?? 0, aliasRank(alias, workout)));
    if (taken.has(alias) || aliases.has(slotId)) continue;
    taken.add(alias);
    aliases.set(slotId, alias);
  }
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
  for (const ref of extraRefs) give(ref);
  return aliases;
}

/** Slots cités par les propositions en attente, dans leur ordre. */
const pendingRefsOf = (program: BriefProgramInput): string[] =>
  program.pending.flatMap((c) => c.operations.flatMap((op) => ('slot' in op ? [op.slot] : [])));

/**
 * Alias du dossier et des outils (identifiant réel → alias) : slots du programme, puis références en attente, puis
 * `extraRefs` (slots des décisions du moteur, pour `read_training`).
 */
function slotAliasesOf(
  program: BriefProgramInput,
  frozen: ReadonlyMap<string, string>,
  extraRefs: readonly string[] = [],
): Map<string, string> {
  return assignAliases(program.program, frozen, [...pendingRefsOf(program), ...extraRefs]);
}

/**
 * Table figée d'un fil étendue au programme courant (alias → identifiant réel) : chaque alias de `frozen` gardé, slot
 * disparu compris (sauf s'il est devenu l'identifiant d'un slot du modèle), et un alias pour chaque slot ajouté qui
 * n'y figure pas, au-delà du plus grand alias de sa séance, par la règle de `buildCoachBrief`. Déterministe : la
 * table des alias que `read_training` montre (`briefProgram` amorcé par `frozen`), que `propose_program_change`
 * retraduit par `resolveSlotAlias` avec le même programme et la même table figée.
 */
export function extendSlotAliases(
  program: EffectiveProgram,
  frozen: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return new Map([...assignAliases(program, frozen, [])].map(([slotId, alias]) => [alias, slotId]));
}

/**
 * Identifiant réel d'une référence de slot venue du modèle : `aliases` est le `slotAliases` de `buildCoachBrief`
 * (alias → identifiant réel) ; une référence qui n'est pas un alias est rendue telle quelle.
 */
export function resolveSlotAlias(ref: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(ref) ?? ref;
}

/** `{ [key]: value }`, ou rien si `value` est nul : dans un slot, un champ nul ne s'écrit pas. */
function present<K extends string, V>(key: K, value: V | null | undefined): { [P in K]?: V } {
  return (value === null || value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/** État du moteur compact : sans ses valeurs nulles, ni `calibration_left` 0, ni `suspended` faux. */
function briefEngine(state: SlotState): NonNullable<BriefSlot['engine']> {
  return {
    mode: state.mode,
    ...present('load_kg', state.loadG === null ? null : kg(state.loadG)),
    ...present('target_reps', state.targetReps),
    ...present('variant_rank', state.variantRank),
    ...present('duration_s', state.durationS),
    ...(state.calibrationLeft > 0 ? { calibration_left: state.calibrationLeft } : {}),
    ...(state.suspended ? { suspended: true as const } : {}),
  };
}

/**
 * Cibles du modèle (groupe de travail du slot) et état du moteur, sans `planWorkout` (choix C23). Slot compact : ni
 * champ nul (exercice introuvable, mesure qui ne s'applique pas, repos absent, slot sans état ni décision), ni valeur
 * par défaut de l'état.
 */
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
    ...present('exercise', sheet === null ? null : { id: sheet.id, name: sheet.name }),
    sets: workSetCount(slot),
    ...present('reps', spec?.reps === undefined ? null : { min: spec.reps.min, max: spec.reps.max }),
    ...present(
      'duration_s',
      spec?.durationS === undefined ? null : { min: spec.durationS.min, max: spec.durationS.max },
    ),
    target_rir: spec?.targetRir ?? currentRules().defaultTargetRir,
    ...present('rest_s', spec?.restS),
    ...present('engine', state === null ? null : briefEngine(state)),
    ...present('last_decision', last),
  };
}

/**
 * Programme en cours (forme du dossier, aussi rendue par `read_training`) : modèle, révision, semaine, séance
 * suivante, slots, propositions en attente (jours restants), modèles disponibles et compatibles (06 §5 : ceux du
 * contexte du profil, `context.kind` ; un modèle ne porte pas de code de sport) ; null sans programme. Un slot créé
 * par `add_slot` y porte son alias, dans les slots comme dans les opérations en attente ; `frozen` (table figée du
 * fil, alias → identifiant réel) y garde les alias du dossier du fil (`read_training`).
 */
export function briefProgram(
  input: CoachBriefInput,
  frozen: ReadonlyMap<string, string> = NO_ALIASES,
): CoachBrief['program'] {
  const program = input.program;
  if (program === null) return null;
  const { template, daysPerWeek } = program.program;
  const { state, decisions } = program.replay;
  // Les décisions sont dans l'ordre du rejeu : la dernière d'un slot remplace les précédentes.
  const latest = new Map(decisions.map((d) => [d.slotId, d]));
  const aliases = slotAliasesOf(program, frozen);
  const sent = (slotId: string): string => aliases.get(slotId) ?? slotId;
  const context = contextKind(input);
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
      .filter((t) => t.available && t.template.context === context)
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

/**
 * Décisions du moteur des `days` derniers jours (`read_training`), la plus récente d'abord, dans l'ordre du rejeu pour
 * une même séance : la forme de `last_decision`, avec le slot (son alias pour un slot ajouté, `frozen` comme pour
 * `briefProgram`) et l'exercice fait. `exerciseId` : celles de cet exercice. Aucune sans programme.
 *
 * Le slot d'une décision peut ne plus être au programme (ajouté, travaillé, puis retiré) : les slots de toutes les
 * décisions du rejeu reçoivent aussi un alias, après les slots du programme et les références en attente, qui gardent
 * donc les leurs. Jamais l'identifiant d'un changement dans la sortie.
 */
export function briefDecisions(
  input: CoachBriefInput,
  opts: { days: number; exerciseId?: string },
  frozen: ReadonlyMap<string, string> = NO_ALIASES,
): BriefDecision[] {
  const program = input.program;
  if (program === null) return [];
  const aliases = slotAliasesOf(
    program,
    frozen,
    program.replay.decisions.map((d) => d.slotId),
  );
  return program.replay.decisions
    .flatMap((d) => {
      const at = program.decisionEndedAt.get(d.id);
      if (at === undefined || parisDaysUntil(at, input.today) > opts.days) return [];
      if (opts.exerciseId !== undefined && d.exerciseId !== opts.exerciseId) return [];
      return [{ at, decision: d }];
    })
    .sort((a, b) => b.at - a.at)
    .map(({ at, decision: d }) => ({
      ...decisionOf(d, at, input),
      slot: aliases.get(d.slotId) ?? d.slotId,
      exercise_id: d.exerciseId,
    }));
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
 * `pain` : douleur par exercice, rendue seulement si l'entrée a aussi l'accord santé et l'accord coach (C2).
 * `exerciseId` : seules les séances de cet exercice, réduites à lui. `RangeError` comme `buildCoachBrief`.
 */
export function briefHistory(
  input: CoachBriefInput,
  opts: { days: number; exerciseId?: string; pain: boolean },
): HistorySession[] {
  checkAge(input);
  const places = new Map(namedPlaces(input).map(({ place, name }) => [place.id, name]));
  const nameOf = sheetNames(input);
  const pain = opts.pain && healthAllowed(input);
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
          ...(pain && e.painLevel !== null ? { pain: e.painLevel } : {}),
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
 * autres, de la séance la plus récente à la plus ancienne. `RangeError` comme `buildCoachBrief`.
 */
export function briefRecords(input: CoachBriefInput, sessions: readonly BriefSession[]): BriefRecord[] {
  checkAge(input);
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

const hasNotes = (brief: CoachBrief): boolean =>
  brief.history.sessions.some((s) => s.user_notes !== undefined) ||
  (brief.health?.limitations.some((l) => l.note !== null) ?? false);

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
 * Plafond (choix C43, cascade du contrôleur, écart au §9) : au-delà de `max` jetons estimés, dans l'ordre, (a) les
 * séances les plus anciennes jusqu'à en garder 3, (b) les records au-delà de 15, (c) les notes (séances gardées et
 * limitations), (d) les séances jusqu'à en garder 1. Chaque étape s'arrête dès que le dossier tient ;
 * `history.truncated` n'est vrai que si une étape a retiré quelque chose. Le programme n'est jamais coupé : un dossier
 * encore trop gros est rendu tel quel (`oversize` de `buildCoachBrief`).
 */
function fit(brief: CoachBrief, max: number): CoachBrief {
  const fits = (b: CoachBrief) => estimateTokens(sortedJson(b)) <= max;
  const cut = (b: CoachBrief): CoachBrief => ({ ...b, history: { ...b.history, truncated: true } });
  let out = brief;
  const keepSessions = (floor: number): void => {
    while (out.history.sessions.length > floor && !fits(out)) {
      out = cut({ ...out, history: { ...out.history, sessions: out.history.sessions.slice(0, -1) } });
    }
  };
  keepSessions(KEPT_SESSIONS);
  if (!fits(out) && out.records.length > TRUNCATED_RECORDS) {
    out = cut({ ...out, records: out.records.slice(0, TRUNCATED_RECORDS) });
  }
  if (!fits(out) && hasNotes(out)) out = cut(withoutNotes(out));
  keepSessions(LAST_SESSIONS);
  return out;
}

/**
 * Dossier `coach-brief/1` du fil (§9) : le dossier validé par `CoachBriefSchema`, son JSON à clés triées sans espace
 * (celui que reçoit le modèle et que stocke le fil), ses jetons estimés, `oversize` (encore au-dessus du plafond après
 * la cascade de `fit`, hors du JSON, à journaliser sans contenu) et `slotAliases` (alias d'un slot créé par
 * `add_slot` → son identifiant réel), pour retraduire les références de slot des opérations proposées
 * (`resolveSlotAlias`). `RangeError` si `audience` et `ageBand` se contredisent (`minor` ⇔ `16-17`).
 */
export function buildCoachBrief(input: CoachBriefInput): {
  brief: CoachBrief;
  json: string;
  estimatedTokens: number;
  oversize: boolean;
  slotAliases: ReadonlyMap<string, string>;
} {
  checkAge(input);
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
  const max = COACH_CONFIG.limits.briefMaxTokens;
  const brief = CoachBriefSchema.parse(fit(draft, max));
  const json = sortedJson(brief);
  const estimatedTokens = estimateTokens(json);
  const aliases = input.program === null ? [] : [...slotAliasesOf(input.program, NO_ALIASES)];
  const slotAliases = new Map(aliases.map(([slotId, alias]) => [alias, slotId]));
  return { brief, json, estimatedTokens, oversize: estimatedTokens > max, slotAliases };
}
