import type { ChangeAuthor, InstanceChangeOperation } from '@rune/contracts';
import { loadGrid } from './loads';
import { type PlanInput, type PlannedExercise, type PlannedWorkout, planWorkout } from './plan';
import { type ReplayInput, type ReplayResult, replayInstance } from './replay';
import type { AcceptedChange, PlaceContext, SessionRecord } from './types';

/*
 * Aperçu des charges d'un changement de programme (spec brique 4 §12.4) et garde de hausse (§12.2, étape 6, choix
 * C6). Pour chaque slot, la charge prévue de sa prochaine séance au lieu donné, avant et après le changement, tirée
 * du rejeu et de `planWorkout`, les mêmes que la séance du jour. Le serveur refuse une proposition du coach qui fait
 * monter une charge (`coach_load_increase`, `coachLoadGuard`) ; le téléphone montre « avant → après » sous chaque
 * proposition, celles du moteur comprises. L'aperçu n'est jamais stocké.
 */

/** Ordre binaire des `id`, jamais `localeCompare` : le même sur le téléphone et le serveur. */
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Dernière charge de travail faite sur chaque exercice, toutes séances comprises (calibration, spec brique 3
 * §4.3.5) : la série de travail enregistrée la plus récente qui porte une charge ; à la même heure, celle au plus
 * grand `id` (ordre binaire), quel que soit l'ordre de lecture. Seule source de `PlanInput.lastLoadByExercise`, pour
 * le serveur comme pour le téléphone.
 */
export function lastLoadsOf(sessions: readonly SessionRecord[]): Map<string, number> {
  const latest = new Map<string, { at: number; id: string; loadG: number }>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      for (const set of e.sets) {
        if (set.kind !== 'work' || set.loggedAt === null || set.loadG === null) continue;
        const known = latest.get(e.exerciseId);
        if (known === undefined || (set.loggedAt - known.at || binary(set.id, known.id)) > 0) {
          latest.set(e.exerciseId, { at: set.loggedAt, id: set.id, loadG: set.loadG });
        }
      }
    }
  }
  return new Map([...latest].map(([id, v]) => [id, v.loadG]));
}

/**
 * Charge prévue d'un slot : une charge visée, une calibration (l'utilisateur choisira sa charge), ou rien (`none` :
 * sans charge, suspendu ou sauté).
 */
export type PlannedLoad = { kind: 'load'; loadG: number } | { kind: 'calibration' } | { kind: 'none' };

export interface SlotLoadPreview {
  slotId: string;
  workoutId: string;
  /** Nommé par une opération, ajouté, retiré, ou dont la charge prévue change. */
  touched: boolean;
  /** Null : slot absent de ce côté (ajouté, ou retiré ; tous après un `switch_template`). */
  before: PlannedLoad | null;
  after: PlannedLoad | null;
}

export interface ChangePreviewInput {
  /** Rejeu de l'instance telle qu'elle est, sans le changement. */
  replay: ReplayInput;
  change: { id: string; author: ChangeAuthor; operations: readonly InstanceChangeOperation[] };
  /** Heure à laquelle le changement serait accepté (millisecondes Unix). */
  decidedAt: number;
  /** Contexte de `planWorkout` : le lieu principal, le catalogue servi, le profil, le jour de Paris… */
  plan: Omit<PlanInput, 'replay' | 'workoutId'>;
}

const NONE: PlannedLoad = { kind: 'none' };

function plannedLoad(e: PlannedExercise, plan: ChangePreviewInput['plan']): PlannedLoad {
  if (e.exerciseId === null || e.loadMode === null) return NONE;
  const target = e.sets.find((s) => s.kind === 'work')?.targetLoadG ?? null;
  if (target !== null) return { kind: 'load', loadG: target };
  if (loadGrid(e.loadMode, plan.place.loadSettings).kind === 'none') return NONE;
  return e.calibration ? { kind: 'calibration' } : NONE;
}

const loadOf = (l: PlannedLoad): number | null => (l.kind === 'load' ? l.loadG : null);
const sameLoad = (a: PlannedLoad, b: PlannedLoad): boolean => a.kind === b.kind && loadOf(a) === loadOf(b);

/** Séance prévue de chaque séance du programme, au lieu de `plan`, dans l'ordre du programme. */
function plansOf(replay: ReplayResult, plan: ChangePreviewInput['plan']): PlannedWorkout[] {
  return replay.program.template.workouts.map((w) => planWorkout({ ...plan, replay, workoutId: w.id }));
}

/** Rejeux sans puis avec le changement ; `after` null pour un `switch_template`, qui termine l'instance. */
interface Replays {
  before: ReplayResult;
  after: ReplayResult | null;
}

function replaysOf(input: ChangePreviewInput): Replays {
  const { change } = input;
  const before = replayInstance(input.replay);
  if (change.operations.some((op) => op.op === 'switch_template')) return { before, after: null };
  const accepted: AcceptedChange = {
    id: change.id,
    author: change.author,
    reasonCode: change.author === 'coach' ? 'COACH_PROPOSAL' : 'USER_CHANGE',
    decidedAt: input.decidedAt,
    operations: [...change.operations],
  };
  return { before, after: replayInstance({ ...input.replay, changes: [...input.replay.changes, accepted] }) };
}

/** Aperçu de deux rejeux au lieu de `plan.place` (voir `changePreview`). */
function previewsOf(
  operations: readonly InstanceChangeOperation[],
  replays: Replays,
  plan: ChangePreviewInput['plan'],
): SlotLoadPreview[] {
  const before = plansOf(replays.before, plan);
  const after = replays.after === null ? [] : plansOf(replays.after, plan);
  const named = new Set(operations.flatMap((op) => ('slot' in op ? [op.slot] : [])));
  const previews: SlotLoadPreview[] = [];
  const push = (slotId: string, workoutId: string, b: PlannedLoad | null, a: PlannedLoad | null) => {
    const touched = named.has(slotId) || b === null || a === null || !sameLoad(b, a);
    previews.push({ slotId, workoutId, touched, before: b, after: a });
  };
  const workoutIds = [...new Set([...before, ...after].map((w) => w.workoutId))];
  for (const workoutId of workoutIds) {
    const was = before.find((w) => w.workoutId === workoutId)?.exercises ?? [];
    const now = after.find((w) => w.workoutId === workoutId)?.exercises ?? [];
    for (const e of was) {
      const next = now.find((n) => n.slotId === e.slotId);
      push(e.slotId, workoutId, plannedLoad(e, plan), next === undefined ? null : plannedLoad(next, plan));
    }
    for (const e of now) {
      if (!was.some((w) => w.slotId === e.slotId)) push(e.slotId, workoutId, null, plannedLoad(e, plan));
    }
  }
  return previews;
}

/**
 * Aperçu d'un changement (spec brique 4 §12.4) : pour chaque slot présent avant ou après, la charge prévue de sa
 * prochaine séance au lieu `plan.place`, sans le changement puis avec lui, accepté à `decidedAt`. La charge prévue
 * est celle de la première série de travail ; sans charge visée, `calibration` pour un exercice chargé en
 * calibration, `none` sinon (un slot suspendu donne `none`). Un `switch_template` termine l'instance : aucun slot
 * n'a de charge après. Ordre : les séances du programme, et dans chacune ses slots d'avant, puis ceux ajoutés. Les
 * entrées ne sont pas modifiées. Lève `UnknownRulesVersionError` comme `replayInstance`.
 */
export function changePreview(input: ChangePreviewInput): SlotLoadPreview[] {
  return previewsOf(input.change.operations, replaysOf(input), input.plan);
}

/** Le rejeu comme si aucun slot n'était suspendu : la séance prévue montre ce qu'il ferait à la reprise. */
const withoutSuspensions = (replay: ReplayResult): ReplayResult => ({
  ...replay,
  program: { ...replay.program, suspended: new Set() },
});

/**
 * Garde de hausse du serveur (spec brique 4 §12.2, étape 6, choix C6, avec l'écart consigné au registre) : les slots
 * où `loadIncreases` trouve une hausse dans l'un des lieux `places`, ou au lieu `plan.place` s'il n'y est pas,
 * triés (ordre binaire) et sans doublon. Les deux côtés se calculent comme si aucun slot n'était suspendu, que la
 * suspension vienne de l'état ou du changement lui-même : une suspension ne cache pas la charge qui reviendra à la
 * reprise. L'aperçu affiché reste celui de `changePreview`.
 */
export function coachLoadGuard(input: ChangePreviewInput, places: readonly PlaceContext[]): string[] {
  const { before, after } = replaysOf(input);
  const lifted: Replays = {
    before: withoutSuspensions(before),
    after: after === null ? null : withoutSuspensions(after),
  };
  const main = input.plan.place;
  const all = places.some((p) => p.id === main.id) ? places : [main, ...places];
  const slots = all.flatMap((place) =>
    loadIncreases(previewsOf(input.change.operations, lifted, { ...input.plan, place })),
  );
  return [...new Set(slots)].sort(binary);
}

/**
 * Hausses d'un aperçu (spec brique 4 §12.2, étape 6, choix C6) : les slots dont la charge visée monte, chargés des
 * deux côtés, dans l'ordre de l'aperçu. Un slot ajouté, une calibration ou un slot sans charge avant n'en sont pas.
 * `coachLoadGuard` l'applique dans chaque lieu, suspensions levées.
 */
export function loadIncreases(previews: readonly SlotLoadPreview[]): string[] {
  return previews.flatMap(({ slotId, before, after }) =>
    before?.kind === 'load' && after?.kind === 'load' && after.loadG > before.loadG ? [slotId] : [],
  );
}
