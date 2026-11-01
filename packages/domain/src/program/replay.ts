import {
  type ChangeReasonCode,
  defaultLoadSettings,
  type InstanceChangeOperation,
  type ProgramTemplate,
  type SessionProfile,
  type SlotSpec,
} from '@rune/contracts';
import { buildChains } from '../catalog/chains';
import { substitutes } from '../catalog/substitutes';
import { type CatalogSheet, compareIds, isUsable } from '../catalog/usable';
import { applyOperation, type EffectiveProgram, effectiveProgram, findSlot } from './effective';
import { type EngineState, type EvaluateResult, evaluateExercise, stateExerciseId } from './evaluate';
import { type LoadGrid, loadGrid } from './loads';
import { lightenTargets, slotShape } from './primitives';
import {
  afterDaysChange,
  afterDeloadAccepted,
  countSession,
  initialProgramState,
  isoInstant,
  type ProgramState,
  parisDaysBetween,
  upcomingWeekType,
} from './program-state';
import { RULES_BY_VERSION, type RulesBook, type RulesSet } from './rules';
import {
  type AcceptedChange,
  type EngineDecision,
  type ExerciseRecord,
  type PlaceContext,
  type SessionRecord,
  type SlotState,
  slotStateId,
} from './types';

/*
 * Rejeu d'une instance (spec brique 3 §4.4) : l'état de progression entier reconstruit à partir de l'historique, les
 * séances terminées et les changements acceptés. Le serveur le lance dans la transaction du push et fait foi ; le
 * téléphone lance la même fonction sur son miroir. Fonction pure et déterministe : mêmes entrées, même résultat,
 * quel que soit l'ordre d'arrivée des séances et des changements.
 */

/** Une séance à rejouer porte une version de règles absente du `rulesBook` (appli plus récente, spec §4.4.8). */
export class UnknownRulesVersionError extends Error {
  readonly version: string;
  readonly sessionId: string;

  constructor(version: string, sessionId: string) {
    super(`règles du moteur inconnues : version ${version} (séance ${sessionId})`);
    this.name = 'UnknownRulesVersionError';
    this.version = version;
    this.sessionId = sessionId;
  }
}

export type EngineEventKind = 'propose_replace' | 'propose_deload' | 'pain_suspend';

/**
 * Événement du moteur (spec §4.4.4). Le serveur en tire l'identifiant du changement (UUID dérivé de `key`) et n'écrit
 * que ceux qu'il n'a pas : une proposition naît `proposed` (`decidedAt` null), une suspension pour douleur naît
 * acceptée à la fin de la séance déclenchante.
 */
export interface EngineEvent {
  key: string;
  kind: EngineEventKind;
  slotId: string | null;
  /** Exercice de l'état concerné (le `chain_id` pour une chaîne, comme `slot_state`) ; null pour un allègement. */
  exerciseId: string | null;
  triggerSessionId: string;
  /** ISO 8601 UTC : fin de la séance déclenchante pour `pain_suspend` ; null pour une proposition. */
  decidedAt: string | null;
  operations: InstanceChangeOperation[];
  reasonCode: ChangeReasonCode;
}

/** `engine|instance|code|slot|exercice|séance déclenchante` (spec §4.4.4). */
export const engineEventKey = (
  instanceId: string,
  reasonCode: ChangeReasonCode,
  slotId: string | null,
  exerciseId: string | null,
  triggerSessionId: string,
): string => `engine|${instanceId}|${reasonCode}|${slotId ?? ''}|${exerciseId ?? ''}|${triggerSessionId}`;

export interface ReplayInput {
  instance: {
    id: string;
    snapshot: ProgramTemplate;
    /** Jours par semaine à l'inscription ; les `set_days_per_week` acceptés le changent ensuite. */
    daysPerWeek: number;
    /**
     * Début de l'inscription (millisecondes Unix). Le rejeu ne le lit pas : les semaines se comptent en séances et
     * l'absence part de la dernière séance terminée, jamais de l'inscription (spec §4.3.7 et §4.3.9).
     */
    startedAt: number;
  };
  /** Séances de l'instance ; seules les `completed` de cette instance sont rejouées. */
  sessions: readonly SessionRecord[];
  /** Changements acceptés, suspensions pour douleur déjà écrites et propositions acceptées comprises. */
  changes: readonly AcceptedChange[];
  /** Catalogue entier, fiches retirées comprises (une séance ancienne peut en citer une). */
  catalog: readonly CatalogSheet[];
  /** Lieux du membre, lieux supprimés compris (réglages de charge et matériel). */
  places: ReadonlyMap<string, PlaceContext>;
  /** `machine_step_g_override` des `slot_state` existants, par identifiant d'état (spec §4.4.2). */
  overrides: ReadonlyMap<string, number>;
  /** Règles par version ; `RULES_BY_VERSION` par défaut. */
  rulesBook?: RulesBook;
}

export interface ReplayResult {
  /** États (slot, exercice), triés par identifiant. */
  slotStates: SlotState[];
  /** Une décision par exercice évalué, dans l'ordre du rejeu. */
  decisions: EngineDecision[];
  state: ProgramState;
  /** Événements du moteur, dans l'ordre où le rejeu les rencontre. */
  events: EngineEvent[];
  /** Programme effectif après tous les changements, suspensions détectées comprises. */
  program: EffectiveProgram;
}

// ---------------------------------------------------------------------------------------------------------------
// Ordre et entrées figées
// ---------------------------------------------------------------------------------------------------------------

/** Ordre binaire des `id`, jamais `localeCompare` : le même sur le téléphone et le serveur. */
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sessionOrder = (a: SessionRecord, b: SessionRecord) => a.startedAt - b.startedAt || binary(a.id, b.id);
const changeOrder = (a: AcceptedChange, b: AcceptedChange) => a.decidedAt - b.decidedAt || binary(a.id, b.id);
const exerciseOrder = (a: ExerciseRecord, b: ExerciseRecord) => a.position - b.position || binary(a.id, b.id);

/** Lieu absent des entrées (supprimé et non transmis) : réglages de charge par défaut d'une salle. */
const UNKNOWN_PLACE_SETTINGS = defaultLoadSettings('gym');

function rulesIn(book: RulesBook, version: string): RulesSet | undefined {
  return Object.hasOwn(book, version) ? book[version] : undefined;
}

/**
 * Heure d'une suspension pour douleur : la fin de la séance déclenchante (spec §4.4.4). Une fin absente ou qui ne
 * suit pas le début (horloge fausse) est ramenée juste après le début, pour que la suspension suive toujours la
 * séance, au premier rejeu comme aux suivants.
 */
const suspensionTime = (s: SessionRecord): number => Math.max(s.endedAt ?? s.startedAt, s.startedAt + 1);

const suspends = (change: AcceptedChange, slotId: string): boolean =>
  change.operations.some((op) => op.op === 'suspend_slot' && op.slot === slotId);

// ---------------------------------------------------------------------------------------------------------------
// Déroulé
// ---------------------------------------------------------------------------------------------------------------

/** Ce qu'il faut pour réévaluer les cibles d'un état hors séance (`lighten_exercise`) : sa dernière évaluation. */
interface Tracked {
  state: EngineState;
  grid: LoadGrid;
  profile: SessionProfile;
  chainLength: number | null;
}

interface Context {
  instanceId: string;
  catalog: CatalogSheet[];
  byId: ReadonlyMap<string, CatalogSheet>;
  chains: ReadonlyMap<string, readonly CatalogSheet[]>;
  places: ReadonlyMap<string, PlaceContext>;
  overrides: ReadonlyMap<string, number>;
  book: RulesBook;
}

interface Run {
  program: EffectiveProgram;
  state: ProgramState;
  tracked: Map<string, Tracked>;
  decisions: EngineDecision[];
  events: EngineEvent[];
  /** Changements pas encore appliqués, triés ; les suspensions détectées s'y insèrent à leur heure. */
  queue: AcceptedChange[];
  /** Stagnations depuis le dernier allègement ou la dernière proposition d'allègement, avec leur semaine. */
  stalls: { slotId: string; week: number }[];
  previousStart: number | null;
}

function insertSorted(queue: AcceptedChange[], change: AcceptedChange): void {
  const at = queue.findIndex((c) => changeOrder(change, c) < 0);
  if (at === -1) queue.push(change);
  else queue.splice(at, 0, change);
}

/**
 * Chaîne d'un slot pour `evaluateExercise` : complète, dans l'ordre de `chain_rank`, coupée avant la première
 * variante `not_for_minors` en profil prudent (05 §14), jamais filtrée par le lieu.
 */
function chainSteps(ctx: Context, slot: SlotSpec, profile: SessionProfile): readonly CatalogSheet[] | null {
  if (slot.chain === undefined) return null;
  const steps = ctx.chains.get(slot.chain) ?? [];
  const stop = profile === 'cautious' ? steps.findIndex((s) => s.not_for_minors) : -1;
  return stop === -1 ? steps : steps.slice(0, stop);
}

/** Opérations d'un changement accepté, dans l'ordre ; `lighten_exercise`, `start_deload` et les jours sont des événements. */
function applyChange(ctx: Context, run: Run, change: AcceptedChange): void {
  for (const op of change.operations) {
    run.program = applyOperation(run.program, op, change.id);
    switch (op.op) {
      case 'lighten_exercise':
        lightenSlot(ctx, run, op.slot);
        break;
      case 'start_deload':
        run.state = afterDeloadAccepted(run.state, run.program);
        run.stalls = [];
        break;
      case 'set_days_per_week':
        run.state = afterDaysChange(run.state, run.program);
        break;
      case 'suspend_slot':
        resetPainStreak(run, op.slot);
        break;
      default:
        // Structurelle (appliquée au programme), ou `switch_template` : l'instance se termine, rien à rejouer.
        break;
    }
  }
}

/**
 * Suspension appliquée, quel qu'en soit l'auteur : la série de douleurs des états du slot repart de zéro, pour qu'il
 * faille de nouveau 2 séances de suite après la reprise (ruling R25).
 */
function resetPainStreak(run: Run, slotId: string): void {
  for (const [id, t] of run.tracked) {
    if (t.state.slotId === slotId) run.tracked.set(id, { ...t, state: { ...t.state, painStreak: 0 } });
  }
}

/**
 * `lighten_exercise` accepté : allègement standard (05 §12) des cibles de chaque état du slot, que la séance suivante
 * reprend. Il suit les règles de la dernière séance de l'état, son lieu et son profil.
 */
function lightenSlot(ctx: Context, run: Run, slotId: string): void {
  const found = findSlot(run.program.template, slotId);
  if (found === undefined) return;
  for (const [id, t] of run.tracked) {
    const rules = rulesIn(ctx.book, t.state.rulesVersion);
    if (t.state.slotId !== slotId || rules === undefined) continue;
    const shape = slotShape(found.slot, t.profile, t.grid, rules, t.chainLength);
    const { mode, loadG, targetReps, variantRank, durationS } = t.state;
    const lighter = lightenTargets({ mode, loadG, targetReps, variantRank, durationS }, shape);
    run.tracked.set(id, { ...t, state: { ...t.state, ...lighter } });
  }
}

interface Evaluated {
  slot: SlotSpec;
  sheet: CatalogSheet;
  exerciseId: string;
  result: EvaluateResult;
  /** Place de la décision dans `run.decisions`, pour en corriger le code. */
  decisionIndex: number;
}

/**
 * Évalue un exercice contre le slot du programme effectif au début de la séance. Pas de décision sans slot (exercice
 * ajouté), pour un slot absent du programme ou une fiche inconnue. Un slot suspendu donne IGNORED / SLOT_SUSPENDED
 * sans rien évaluer, et sa douleur ne compte pas (la série repart de zéro à la suspension, ruling R25). Rend null
 * sans décision ou sur un slot suspendu : ni stagnation ni douleur à suivre.
 */
function evaluateOne(
  ctx: Context,
  run: Run,
  s: SessionRecord,
  ex: ExerciseRecord,
  rules: RulesSet,
  gap: number | null,
): Evaluated | null {
  const found = ex.slotId === null ? undefined : findSlot(run.program.template, ex.slotId);
  const sheet = ctx.byId.get(ex.exerciseId);
  if (found === undefined || sheet === undefined) return null;
  const { slot } = found;
  const steps = chainSteps(ctx, slot, s.profile);
  const exerciseId = stateExerciseId(slot, sheet.id, steps);
  const id = slotStateId(ctx.instanceId, slot.id, exerciseId);
  const override = ctx.overrides.get(id) ?? null;
  const place = s.placeId === null ? undefined : ctx.places.get(s.placeId);
  const grid = loadGrid(sheet.load_mode, place?.loadSettings ?? UNKNOWN_PLACE_SETTINGS, override);
  const previous = run.tracked.get(id);
  const suspended = run.program.suspended.has(slot.id);

  const result = evaluateExercise({
    state: previous === undefined ? null : { ...previous.state, machineStepGOverride: override },
    slot,
    exercise: sheet,
    chainSteps: steps,
    performed: suspended ? { ...ex, sets: [], nextAdjustment: null, painLevel: null } : ex,
    session: {
      id: s.id,
      instanceId: ctx.instanceId,
      weekType: s.weekType,
      profile: s.profile,
      rulesVersion: s.rulesVersion,
      resumeGapDays: gap,
    },
    grid,
    rules,
  });
  const decisionIndex =
    run.decisions.push(suspended ? { ...result.decision, reasonCode: 'SLOT_SUSPENDED' } : result.decision) -
    1;

  // L'état rendu est gardé tel quel, IGNORED compris : la douleur y est comptée même sans série (05 §13.7), et son
  // existence ne dépend jamais d'une colonne C2. Le contexte des cibles est celui de la dernière évaluation qui les a
  // fixées : une séance IGNORED garde celui d'avant.
  const ignored = result.decision.result === 'IGNORED';
  const inChain = steps?.some((c) => c.id === sheet.id) === true;
  const here = { grid, profile: s.profile, chainLength: inChain ? (steps?.length ?? null) : null };
  const { grid: g, profile, chainLength } = ignored && previous !== undefined ? previous : here;
  run.tracked.set(id, {
    state: { ...result.state, machineStepGOverride: override },
    grid: g,
    profile,
    chainLength,
  });
  return suspended ? null : { slot, sheet, exerciseId, result, decisionIndex };
}

function processSession(ctx: Context, run: Run, s: SessionRecord, rules: RulesSet): void {
  const gap = run.previousStart === null ? null : parisDaysBetween(run.previousStart, s.startedAt);
  const week = run.state.weekIndex;
  const deload = s.weekType === 'deload' || upcomingWeekType(run.state, run.program) === 'deload';
  let stalled = false;
  for (const ex of [...s.exercises].sort(exerciseOrder)) {
    const e = evaluateOne(ctx, run, s, ex, rules, gap);
    if (e === null) continue;
    if (e.result.stalled !== null) {
      stalled = true;
      run.stalls.push({ slotId: e.slot.id, week });
      if (e.result.stalled.propose) proposeReplace(ctx, run, s, e);
    }
    if (e.result.painStreak !== null && e.result.painStreak >= rules.painSuspendStreak) {
      suspendForPain(ctx, run, s, e);
    }
  }
  run.state = countSession(run.state, run.program, s);
  run.previousStart = s.startedAt;
  if (deload) run.stalls = [];
  else if (stalled) proposeDeload(ctx, run, s, week, rules);
}

/**
 * Suspension pour douleur (05 §13.7, spec §4.4.4) : acceptée à la fin de la séance déclenchante et appliquée à cette
 * heure-là. Une suspension du moteur déjà en attente pour ce slot, au plus tard à cette heure, n'est pas refaite :
 * c'est celle de cette séance, lue comme une entrée, ou celle d'une séance qui la chevauche.
 */
function suspendForPain(ctx: Context, run: Run, s: SessionRecord, e: Evaluated): void {
  const decidedAt = suspensionTime(s);
  const slotId = e.slot.id;
  if (run.queue.some((c) => c.author === 'engine' && c.decidedAt <= decidedAt && suspends(c, slotId))) return;
  const key = engineEventKey(ctx.instanceId, 'PAIN_SUSPEND', slotId, e.exerciseId, s.id);
  const operations: InstanceChangeOperation[] = [{ op: 'suspend_slot', slot: slotId }];
  run.events.push({
    key,
    kind: 'pain_suspend',
    slotId,
    exerciseId: e.exerciseId,
    triggerSessionId: s.id,
    decidedAt: isoInstant(decidedAt),
    operations,
    reasonCode: 'PAIN_SUSPEND',
  });
  insertSorted(run.queue, { id: key, author: 'engine', reasonCode: 'PAIN_SUSPEND', decidedAt, operations });
}

/** Lieux où chercher un remplaçant : celui de la séance d'abord, puis les autres par `id`. */
function placesFrom(ctx: Context, placeId: string | null): PlaceContext[] {
  const others = [...ctx.places.values()].filter((p) => p.id !== placeId).sort(compareIds);
  const here = placeId === null ? undefined : ctx.places.get(placeId);
  return here === undefined ? others : [here, ...others];
}

/**
 * Remplaçant proposé pour un exercice qui stagne (05 §9.6) : une fiche du même type de mouvement que le slot,
 * utilisable dans un lieu du membre (publiée, faisable, non `not_for_minors` en prudent, 05 §15), qui serait choisie
 * en tête du slot. D'abord la liste du slot, puis `substitutes` sans monter en niveau ; jamais l'exercice qui stagne,
 * la tête actuelle ni une variante de la chaîne du slot. Le lieu de la séance passe avant les autres.
 */
function replacementFor(
  ctx: Context,
  slot: SlotSpec,
  stalled: CatalogSheet,
  s: SessionRecord,
): string | null {
  const cautious = s.profile === 'cautious';
  const head = slot.exercises?.[0];
  const chained = new Set(
    (slot.chain === undefined ? [] : (ctx.chains.get(slot.chain) ?? [])).map((c) => c.id),
  );
  const listed = (slot.exercises ?? []).flatMap((id) => {
    const sheet = ctx.byId.get(id);
    return sheet === undefined ? [] : [sheet];
  });
  const allowed = (c: CatalogSheet) =>
    c.id !== stalled.id && c.id !== head && !chained.has(c.id) && c.movement_pattern === slot.movementPattern;
  for (const place of placesFrom(ctx, s.placeId)) {
    const equipment = new Set(place.equipment);
    const near = substitutes(stalled, { catalog: ctx.catalog, equipment, maxLevel: stalled.level, cautious });
    const found = [...listed, ...near].find((c) => allowed(c) && isUsable(c, { equipment, cautious }));
    if (found !== undefined) return found.id;
  }
  return null;
}

/**
 * Proposition de remplacement (05 §9.6, spec §4.3.12). S'il n'existe aucun remplaçant utilisable, rien n'est proposé
 * et la décision le dit : STALL_NO_REPLACEMENT au lieu de STALL_REPLACE_PROPOSED (ruling R26).
 */
function proposeReplace(ctx: Context, run: Run, s: SessionRecord, e: Evaluated): void {
  const exercise = replacementFor(ctx, e.slot, e.sheet, s);
  if (exercise === null) {
    const decision = run.decisions[e.decisionIndex];
    if (decision !== undefined)
      run.decisions[e.decisionIndex] = { ...decision, reasonCode: 'STALL_NO_REPLACEMENT' };
    return;
  }
  run.events.push({
    key: engineEventKey(ctx.instanceId, 'ENGINE_STALL_REPLACE', e.slot.id, e.exerciseId, s.id),
    kind: 'propose_replace',
    slotId: e.slot.id,
    exerciseId: e.exerciseId,
    triggerSessionId: s.id,
    decidedAt: null,
    operations: [{ op: 'replace_exercise', slot: e.slot.id, exercise }],
    reasonCode: 'ENGINE_STALL_REPLACE',
  });
}

/**
 * Allègement réactif (05 §10.1) : au moins 2 slots en stagnation sur les 2 dernières semaines de programme, celle de
 * la séance comprise. Les stagnations comptées repartent de zéro à chaque proposition et à chaque allègement ; pas de
 * proposition quand la séance suivante est déjà allégée.
 */
function proposeDeload(ctx: Context, run: Run, s: SessionRecord, week: number, rules: RulesSet): void {
  const { stalledSlots, weeks } = rules.reactiveDeload;
  const recent = new Set(run.stalls.filter((m) => m.week > week - weeks).map((m) => m.slotId));
  if (recent.size < stalledSlots || upcomingWeekType(run.state, run.program) === 'deload') return;
  run.events.push({
    key: engineEventKey(ctx.instanceId, 'ENGINE_REACTIVE_DELOAD', null, null, s.id),
    kind: 'propose_deload',
    slotId: null,
    exerciseId: null,
    triggerSessionId: s.id,
    decidedAt: null,
    operations: [{ op: 'start_deload' }],
    reasonCode: 'ENGINE_REACTIVE_DELOAD',
  });
  run.stalls = [];
}

// ---------------------------------------------------------------------------------------------------------------
// Rejeu
// ---------------------------------------------------------------------------------------------------------------

/**
 * Rejeu d'une instance (spec §4.4). Séances `completed` de l'instance par `startedAt` puis `id`, changements acceptés
 * à leur `decidedAt` (à égalité, le changement passe avant la séance), chacune évaluée avec les règles de sa version
 * et ses entrées figées. Lève `UnknownRulesVersionError` si une séance à rejouer a une version absente du `rulesBook`.
 */
export function replayInstance(input: ReplayInput): ReplayResult {
  const { instance } = input;
  const book = input.rulesBook ?? RULES_BY_VERSION;
  const sessions = input.sessions
    .filter((s) => s.status === 'completed' && s.instanceId === instance.id)
    .sort(sessionOrder);
  const rulesBySession = sessions.map((s) => {
    const rules = rulesIn(book, s.rulesVersion);
    if (rules === undefined) throw new UnknownRulesVersionError(s.rulesVersion, s.id);
    return rules;
  });

  const ctx: Context = {
    instanceId: instance.id,
    catalog: [...input.catalog],
    byId: new Map(input.catalog.map((s) => [s.id, s])),
    chains: buildChains(input.catalog),
    places: input.places,
    overrides: input.overrides,
    book,
  };
  const program = effectiveProgram(instance.snapshot, instance.daysPerWeek, []);
  const run: Run = {
    program,
    state: initialProgramState(program),
    tracked: new Map(),
    decisions: [],
    events: [],
    queue: [...input.changes].sort(changeOrder),
    stalls: [],
    previousStart: null,
  };

  let i = 0;
  for (;;) {
    const change = run.queue[0];
    const session = sessions[i];
    const rules = rulesBySession[i];
    if (change !== undefined && (session === undefined || change.decidedAt <= session.startedAt)) {
      run.queue.shift();
      applyChange(ctx, run, change);
    } else if (session !== undefined && rules !== undefined) {
      processSession(ctx, run, session, rules);
      i++;
    } else {
      break;
    }
  }

  const slotStates = [...run.tracked.values()]
    .map(({ state: { best: _best, ...state } }) => ({
      ...state,
      suspended: run.program.suspended.has(state.slotId),
    }))
    .sort((a, b) => binary(a.id, b.id));
  return { slotStates, decisions: run.decisions, state: run.state, events: run.events, program: run.program };
}
