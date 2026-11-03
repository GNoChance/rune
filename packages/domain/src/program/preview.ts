import type { ChangeAuthor, InstanceChangeOperation } from '@rune/contracts';
import { loadGrid } from './loads';
import { type PlanInput, type PlannedExercise, type PlannedWorkout, planWorkout } from './plan';
import { type ReplayInput, type ReplayResult, replayInstance } from './replay';
import type { AcceptedChange, SessionRecord } from './types';

/*
 * Aperçu des charges d'un changement de programme (spec brique 4 §12.4) et garde de hausse (§12.2, étape 6, choix
 * C6). Pour chaque slot, la charge prévue de sa prochaine séance au lieu donné, avant et après le changement, tirée
 * du rejeu et de `planWorkout`, les mêmes que la séance du jour. Le serveur refuse une proposition du coach qui fait
 * monter une charge (`coach_load_increase`) ; le téléphone montre « avant → après » sous chaque proposition, celles
 * du moteur comprises. L'aperçu n'est jamais stocké.
 */

/**
 * Dernière charge de travail faite sur chaque exercice, toutes séances comprises (calibration, spec brique 3
 * §4.3.5) : la série de travail enregistrée la plus récente qui porte une charge. Seule source de
 * `PlanInput.lastLoadByExercise`, pour le serveur comme pour le téléphone.
 */
export function lastLoadsOf(sessions: readonly SessionRecord[]): Map<string, number> {
  const latest = new Map<string, { at: number; loadG: number }>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      for (const set of e.sets) {
        if (set.kind !== 'work' || set.loggedAt === null || set.loadG === null) continue;
        const known = latest.get(e.exerciseId);
        if (known === undefined || set.loggedAt >= known.at) {
          latest.set(e.exerciseId, { at: set.loggedAt, loadG: set.loadG });
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

/**
 * Aperçu d'un changement (spec brique 4 §12.4) : pour chaque slot présent avant ou après, la charge prévue de sa
 * prochaine séance au lieu `plan.place`, sans le changement puis avec lui, accepté à `decidedAt`. La charge prévue
 * est celle de la première série de travail ; sans charge visée, `calibration` pour un exercice chargé en
 * calibration, `none` sinon. Un `switch_template` termine l'instance : aucun slot n'a de charge après. Ordre : les
 * séances du programme, et dans chacune ses slots d'avant, puis ceux ajoutés. Les entrées ne sont pas modifiées.
 * Lève `UnknownRulesVersionError` comme `replayInstance`.
 */
export function changePreview(input: ChangePreviewInput): SlotLoadPreview[] {
  const { change, plan } = input;
  const before = plansOf(replayInstance(input.replay), plan);
  const ends = change.operations.some((op) => op.op === 'switch_template');
  const accepted: AcceptedChange = {
    id: change.id,
    author: change.author,
    reasonCode: change.author === 'coach' ? 'COACH_PROPOSAL' : 'USER_CHANGE',
    decidedAt: input.decidedAt,
    operations: [...change.operations],
  };
  const after = ends
    ? []
    : plansOf(replayInstance({ ...input.replay, changes: [...input.replay.changes, accepted] }), plan);

  const named = new Set(change.operations.flatMap((op) => ('slot' in op ? [op.slot] : [])));
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
 * Garde de hausse (spec brique 4 §12.2, étape 6, choix C6) : les slots dont la charge visée monte, chargés des deux
 * côtés, dans l'ordre de l'aperçu. Un slot ajouté, une calibration ou un slot sans charge avant n'en sont pas.
 */
export function loadIncreases(previews: readonly SlotLoadPreview[]): string[] {
  return previews.flatMap(({ slotId, before, after }) =>
    before?.kind === 'load' && after?.kind === 'load' && after.loadG > before.loadG ? [slotId] : [],
  );
}
