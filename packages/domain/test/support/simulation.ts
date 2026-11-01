import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultLoadSettings,
  type EquipmentCode,
  type ExerciseLevel,
  type ProgramTemplate,
  REFERENCE_PROFILES,
} from '@rune/contracts';
import { parisDate } from '../../src/age';
import { expandEquipment } from '../../src/catalog/equipment';
import {
  type PlanNotice,
  type PlannedExercise,
  type PlannedWorkout,
  planWorkout,
} from '../../src/program/plan';
import { type EngineEvent, type ReplayResult, replayInstance } from '../../src/program/replay';
import type { PlanSheet } from '../../src/program/resolve';
import { RULES_VERSION } from '../../src/program/rules';
import type {
  AcceptedChange,
  EngineDecision,
  ExerciseRecord,
  NextTarget,
  PlaceContext,
  SessionRecord,
  SetRecord,
} from '../../src/program/types';
import type { ScriptedProfile } from './scripted-profiles';

/*
 * Banc de simulation (05 §17.3) : le vrai moteur, les vrais modèles de `data/programs` et les 84 fiches de
 * `data/exercises` traitées comme publiées. Les règles de la simulation sont décrites en tête de `scripted-profiles.ts`.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Lundi 5 janvier 2026, 18 h à Paris (UTC+1). */
export const START_MS = Date.parse('2026-01-05T18:00:00+01:00');
export const SESSION_GAP_DAYS = 2;
export const PROGRAM_WEEKS = 12;
export const INSTANCE_ID = 'inst-ref';

function readJson(...parts: string[]): unknown {
  return JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8'));
}

/** Les modèles de `data/programs`. */
export function loadTemplates(): ProgramTemplate[] {
  return readdirSync(join(ROOT, 'data', 'programs'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson('data', 'programs', f) as ProgramTemplate);
}

export function loadTemplate(id: string): ProgramTemplate {
  const t = loadTemplates().find((x) => x.id === id);
  if (t === undefined) throw new Error(`modèle ${id} absent`);
  return t;
}

/** Les fiches de `data/exercises` (lots A et B), toutes traitées comme publiées. */
export function loadCatalog(): PlanSheet[] {
  return readdirSync(join(ROOT, 'data', 'exercises'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ ...(readJson('data', 'exercises', f) as PlanSheet), status: 'published' as const }));
}

/** Lieu de référence du contexte : salle équipée pour `gym`, maison sans matériel pour `home` et `sport`. */
export function placeFor(context: ProgramTemplate['context']): PlaceContext {
  const gym = context === 'gym';
  const codes: readonly EquipmentCode[] = gym
    ? REFERENCE_PROFILES.gym_reference
    : REFERENCE_PROFILES.home_bodyweight;
  return {
    id: gym ? 'place-gym' : 'place-home',
    equipment: expandEquipment(codes),
    loadSettings: defaultLoadSettings(gym ? 'gym' : 'home'),
  };
}

/** `maxExerciseLevel` de l'expérience qui correspond au niveau du modèle (02 R-REC-2). */
export const maxLevelFor = (level: ProgramTemplate['level']): ExerciseLevel => (level === 'beginner' ? 1 : 2);

export interface SimulationStep {
  index: number;
  /** Semaine de programme (à partir de 0) et semaine du bloc avant la séance. */
  weekIndex: number;
  blockWeek: number | null;
  planned: PlannedWorkout;
  session: SessionRecord;
  /** Rejeu après la séance. */
  replay: ReplayResult;
  /** Décisions des exercices de cette séance. */
  decisions: EngineDecision[];
  /** Événements vus pour la première fois à ce rejeu. */
  events: EngineEvent[];
}

export interface Simulation {
  template: ProgramTemplate;
  profile: ScriptedProfile;
  days: number;
  place: PlaceContext;
  steps: SimulationStep[];
  sessions: SessionRecord[];
  changes: AcceptedChange[];
  final: ReplayResult;
}

export const replayOf = (
  template: ProgramTemplate,
  days: number,
  place: PlaceContext,
  catalog: readonly PlanSheet[],
  sessions: readonly SessionRecord[],
  changes: readonly AcceptedChange[],
): ReplayResult =>
  replayInstance({
    instance: { id: INSTANCE_ID, snapshot: template, daysPerWeek: days, startedAt: START_MS - DAY },
    sessions,
    changes,
    catalog,
    places: new Map([[place.id, place]]),
    overrides: new Map(),
  });

/** Suspension du moteur écrite comme le serveur : clé = identifiant, `decidedAt` = fin de la séance déclenchante. */
export function acceptedFromEvent(e: EngineEvent): AcceptedChange {
  return {
    id: e.key,
    author: 'engine',
    reasonCode: e.reasonCode,
    decidedAt: Date.parse(e.decidedAt ?? ''),
    operations: e.operations,
  };
}

function exerciseRecord(
  profile: ScriptedProfile,
  ex: PlannedExercise,
  sessionId: string,
  position: number,
  occurrence: number,
  firstSlot: string,
  loggedAt: number,
): ExerciseRecord {
  const works = ex.sets.filter((s) => s.kind === 'work');
  const lastPosition = works[works.length - 1]?.position;
  const sets: SetRecord[] = ex.sets.map((p, i) =>
    profile.doSet(p, {
      exercise: ex,
      occurrence,
      lastWork: p.kind === 'work' && p.position === lastPosition,
      loggedAt: loggedAt + i * 60_000,
      id: `${sessionId}-${ex.slotId}-s${i + 1}`,
    }),
  );
  const pain = profile.report({ exercise: ex, occurrence, slotIsFirst: ex.slotId === firstSlot });
  return {
    id: `${sessionId}-${ex.slotId}`,
    slotId: ex.slotId,
    plannedExerciseId: ex.plannedExerciseId,
    exerciseId: ex.exerciseId ?? '',
    position,
    swapReason: null,
    painLevel: pain?.painLevel ?? null,
    nextAdjustment: pain?.nextAdjustment ?? null,
    sets,
  };
}

/** Simule `weeks` semaines de programme : planifie, fait la séance selon le profil, rejoue, recommence. */
export function simulate(
  template: ProgramTemplate,
  profile: ScriptedProfile,
  catalog: readonly PlanSheet[],
  weeks = PROGRAM_WEEKS,
): Simulation {
  const days = template.daysPerWeek.default;
  const place = placeFor(template.context);
  const firstSlot = template.workouts[0]?.slots[0]?.id ?? '';
  const sessions: SessionRecord[] = [];
  const changes: AcceptedChange[] = [];
  const steps: SimulationStep[] = [];
  const lastLoad = new Map<string, number>();
  const occurrences = new Map<string, number>();
  const seenEvents = new Set<string>();
  let replay = replayOf(template, days, place, catalog, sessions, changes);

  for (let index = 0; index < weeks * days; index++) {
    const startedAt = START_MS + index * SESSION_GAP_DAYS * DAY;
    const planned = planWorkout({
      replay,
      workoutId: replay.state.nextWorkoutId,
      place,
      catalog,
      profile: profile.sessionProfile,
      ageBand: profile.ageBand,
      context: template.context,
      today: parisDate(new Date(startedAt)),
      lastLoadByExercise: lastLoad,
      maxLevel: maxLevelFor(template.level),
    });
    const sessionId = `ses-${String(index + 1).padStart(3, '0')}`;
    const exercises: ExerciseRecord[] = [];
    for (const ex of planned.exercises) {
      if (ex.exerciseId === null) continue;
      const occurrence = (occurrences.get(ex.slotId) ?? 0) + 1;
      occurrences.set(ex.slotId, occurrence);
      exercises.push(
        exerciseRecord(profile, ex, sessionId, exercises.length + 1, occurrence, firstSlot, startedAt),
      );
    }
    for (const e of exercises) {
      for (const s of e.sets) {
        if (s.kind === 'work' && s.loadG !== null) lastLoad.set(e.exerciseId, s.loadG);
      }
    }
    const session: SessionRecord = {
      id: sessionId,
      instanceId: INSTANCE_ID,
      workoutId: planned.workoutId,
      placeId: place.id,
      startedAt,
      endedAt: startedAt + HOUR,
      status: 'completed',
      weekType: planned.weekType,
      profile: profile.sessionProfile,
      rulesVersion: RULES_VERSION,
      exercises,
    };
    const before = replay.state;
    sessions.push(session);
    replay = replayOf(template, days, place, catalog, sessions, changes);

    const ids = new Set(exercises.map((e) => e.id));
    const fresh = replay.events.filter((e) => !seenEvents.has(e.key));
    for (const e of fresh) {
      seenEvents.add(e.key);
      // Les suspensions du moteur sont acceptées d'office ; les propositions ne le sont jamais.
      if (e.kind === 'pain_suspend') changes.push(acceptedFromEvent(e));
    }
    steps.push({
      index,
      weekIndex: before.weekIndex,
      blockWeek: before.blockWeek,
      planned,
      session,
      replay,
      decisions: replay.decisions.filter((d) => ids.has(d.id)),
      events: fresh,
    });
  }
  return {
    template,
    profile,
    days,
    place,
    steps,
    sessions,
    changes,
    final: replayOf(template, days, place, catalog, sessions, changes),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Instantané lisible
// ---------------------------------------------------------------------------------------------------------------

/** `62500` → `62,5 kg`. */
export const kg = (g: number): string => `${String(g / 1000).replace('.', ',')} kg`;

const range = (a: number | null, b: number | null) => (a === b ? `${a}` : `${a}-${b}`);

function targetText(ex: PlannedExercise): string {
  const work = ex.sets.filter((s) => s.kind === 'work');
  const first = work[0];
  if (first === undefined) return 'aucune série';
  const lines = ex.unilateral ? 2 : 1;
  const n = work.length / lines;
  const what =
    first.targetRepsMin === null
      ? `${first.targetDurationS} s`
      : `${range(first.targetRepsMin, first.targetRepsMax)} rép.`;
  const load = first.targetLoadG === null ? '' : ` @ ${kg(first.targetLoadG)}`;
  const warm = ex.sets.filter((s) => s.kind === 'warmup').length / lines;
  const tags = [
    warm > 0 ? `échauffement ${warm}` : '',
    first.targetRir === null ? '' : `RIR ${first.targetRir}`,
    ex.calibration ? 'calibration' : '',
    ex.suggestionG === null ? '' : `suggestion ${kg(ex.suggestionG)}`,
  ].filter((t) => t !== '');
  const side = ex.unilateral ? ' par côté' : '';
  return `${n}×${what}${load}${side}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}`;
}

function doneText(e: ExerciseRecord): string {
  const work = e.sets.filter((s) => s.kind === 'work');
  const values = work.map((s) => (s.reps !== null ? `${s.reps}` : `${s.durationS} s`)).join('/');
  const load = work[0]?.loadG ?? null;
  const effort = work.find((s) => s.effort !== null)?.effort ?? 'sans effort';
  const pain = e.painLevel === null || e.painLevel === 'none' ? '' : `, douleur ${e.painLevel}`;
  return `fait ${values}${load === null ? '' : ` @ ${kg(load)}`} (${effort}${pain})`;
}

function nextText(t: NextTarget | null): string {
  if (t === null) return 'aucune cible';
  const parts = [
    t.loadG === null ? '' : kg(t.loadG),
    t.repsMin === null ? `${t.durationS} s` : `${range(t.repsMin, t.repsMax)} rép. (cible ${t.targetReps})`,
    `${t.workSets} séries`,
    t.variantId === null ? '' : t.variantId,
  ].filter((p) => p !== '');
  return parts.join(', ');
}

const noticeText = (n: PlanNotice): string => ('exerciseId' in n ? `${n.code}:${n.exerciseId}` : n.code);

/** Récit de la simulation : par semaine de programme, par séance, par slot cible, résultat, événements. */
export function formatSimulation(sim: Simulation): string {
  const out: string[] = [
    `modèle ${sim.template.id} · profil ${sim.profile.id} · ${sim.days} séances par semaine · ${PROGRAM_WEEKS} semaines`,
  ];
  let week = -1;
  for (const step of sim.steps) {
    if (step.weekIndex !== week) {
      week = step.weekIndex;
      const bw = step.blockWeek === null ? 'bloc réactif' : `semaine ${step.blockWeek} du bloc`;
      out.push('', `== Semaine ${week + 1} (${bw}) ==`);
    }
    const p = step.planned;
    const notices = p.notices.length > 0 ? ` · avis ${p.notices.map(noticeText).join(', ')}` : '';
    const date = parisDate(new Date(step.session.startedAt));
    out.push(
      '',
      `-- Séance ${step.index + 1} · ${p.workoutId} · ${date} · ${p.weekType === 'deload' ? 'ALLÉGÉE' : 'normale'}${notices}`,
    );
    for (const ex of p.exercises) {
      if (ex.exerciseId === null) {
        out.push(`${ex.slotId} ${ex.plannedExerciseId ?? '-'} : ${ex.resolution}`);
        continue;
      }
      const record = step.session.exercises.find((e) => e.slotId === ex.slotId);
      const decision = step.decisions.find((d) => d.id === record?.id);
      const plannedName = ex.plannedExerciseId !== ex.exerciseId ? ` [prévu ${ex.plannedExerciseId}]` : '';
      const res = ex.resolution === 'planned' ? '' : ` {${ex.resolution}}`;
      out.push(`${ex.slotId} ${ex.exerciseId}${plannedName}${res} : ${targetText(ex)}`);
      if (record !== undefined) out.push(`    ${doneText(record)}`);
      if (decision !== undefined) {
        out.push(
          `    -> ${decision.result} ${decision.reasonCode} ; prochain : ${nextText(decision.nextTarget)}`,
        );
      }
    }
    for (const e of step.events) {
      const what = `${e.kind} ${e.reasonCode} slot ${e.slotId ?? '-'} ${e.exerciseId ?? ''}`.trimEnd();
      out.push(`   ! ${what} ${JSON.stringify(e.operations)}`);
    }
  }
  const s = sim.final.state;
  const suspended = [...sim.final.program.suspended].sort().join(', ');
  out.push(
    '',
    `état final : semaine ${s.weekIndex + 1}, séance suivante ${s.nextWorkoutId}, suspendus [${suspended}]`,
  );
  return `${out.join('\n')}\n`;
}
