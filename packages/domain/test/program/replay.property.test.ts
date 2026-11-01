/*
 * Propriétés de `replayInstance` (spec brique 3 §4.4, 05 §17.2), sur des historiques tirés au hasard : séances de
 * salle et de maison, douleur, ajustements, semaines allégées, absences, changements acceptés.
 * - un préfixe de l'historique donne les mêmes décisions que l'historique entier, et rejouer ne laisse aucune trace ;
 * - les événements sont stables : rejouer donne les mêmes clés, et une suspension pour douleur relue comme entrée
 *   donne le même résultat sans nouvel événement, y compris après le retrait du consentement santé ;
 * - l'arrivée des séances en plusieurs lots, comme sur le serveur, ne change rien.
 */
import {
  type Effort,
  type InstanceChangeOperation,
  type LoadMode,
  type NextAdjustment,
  PAIN_CODE_REWRITES,
  type PainLevel,
  type ProgramTemplate,
  type ReasonCode,
  type SessionProfile,
  type SessionStatus,
  type SlotSpec,
  type WeekType,
} from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { feasible } from '../../src/catalog/equipment';
import type { CatalogSheet } from '../../src/catalog/usable';
import { type EngineEvent, type ReplayResult, replayInstance } from '../../src/program/replay';
import type {
  AcceptedChange,
  ExerciseRecord,
  SessionRecord,
  SetRecord,
  SlotState,
} from '../../src/program/types';
import { GYM_AB, gymAb, PLACES, PROGRAM_CATALOG } from '../fixtures/program';

const INSTANCE = 'inst-p';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 2, 17);
const RUNS = { numRuns: 150 };

const PLACE_MAP = new Map(PLACES.map((p) => [p.id, p]));
const BY_ID = new Map(PROGRAM_CATALOG.map((s) => [s.id, s]));
const PLANNED: ProgramTemplate = gymAb((t) => {
  t.block = { mode: 'planned', weeks: 5, deloadWeek: 5 };
});
const SLOT_IDS = GYM_AB.workouts.flatMap((w) => w.slots.map((s) => s.id));

const sheetOf = (id: string): CatalogSheet => {
  const s = BY_ID.get(id);
  if (s === undefined) throw new Error(`fiche ${id} absente`);
  return s;
};

/** Exercice fait pour un slot dans un lieu : le premier faisable de la liste, ou une variante de la chaîne. */
function exerciseFor(slot: SlotSpec, placeId: string, pick: number): CatalogSheet | null {
  const place = PLACE_MAP.get(placeId);
  if (place === undefined) return null;
  const ids =
    slot.chain === undefined
      ? (slot.exercises ?? [])
      : PROGRAM_CATALOG.filter((s) => s.chain_id === slot.chain).map((s) => s.id);
  const usable = ids.map(sheetOf).filter((s) => feasible(s, place.equipment));
  return slot.chain === undefined ? (usable[0] ?? null) : (usable[pick % usable.length] ?? null);
}

/** Charges proposées par mode de charge, toutes sur les grilles par défaut. */
function loadsFor(mode: LoadMode): readonly (number | null)[] {
  switch (mode) {
    case 'barbell':
      return [50000, 55000, 60000];
    case 'dumbbell':
      return [8000, 10000, 12000];
    case 'machine':
      return [40000, 45000, 50000];
    default:
      return [null];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Arbitraires
// ---------------------------------------------------------------------------------------------------------------

const weighted = <T>(...entries: [T, number][]) =>
  fc.oneof(...entries.map(([v, weight]) => ({ arbitrary: fc.constant(v), weight })));

/** Ce qui varie pour un exercice d'une séance. */
const arbExerciseSeed = fc.record({
  level: fc.integer({ min: 0, max: 3 }),
  vary: weighted<boolean>([false, 4], [true, 1]),
  load: fc.integer({ min: 0, max: 2 }),
  effort: weighted<Effort | null>(['ok', 4], ['easy', 2], ['hard', 1], ['failed', 1], [null, 1]),
  pain: weighted<PainLevel | null>([null, 4], ['none', 2], ['discomfort', 1], ['pain', 2]),
  adjustment: weighted<NextAdjustment | null>([null, 6], ['hold', 1], ['lighten', 1]),
  skipped: weighted<boolean>([false, 8], [true, 1]),
  pick: fc.integer({ min: 0, max: 3 }),
});
type ExerciseSeed = typeof arbExerciseSeed extends fc.Arbitrary<infer T> ? T : never;

const arbSessionSeed = fc.record({
  gapDays: weighted<number>([1, 3], [2, 4], [3, 2], [0, 1], [15, 1], [30, 1]),
  status: weighted<SessionStatus>(['completed', 8], ['abandoned', 1], ['in_progress', 1]),
  workoutId: fc.constantFrom('A', 'B'),
  placeId: weighted<string>(['gym', 3], ['home', 1]),
  weekType: weighted<WeekType>(['normal', 6], ['deload', 1]),
  exercises: fc.array(arbExerciseSeed, { minLength: 5, maxLength: 5 }),
});
type SessionSeed = typeof arbSessionSeed extends fc.Arbitrary<infer T> ? T : never;

const arbOperation: fc.Arbitrary<InstanceChangeOperation> = fc.oneof(
  fc.constant({ op: 'start_deload' } as const),
  fc.constantFrom(...SLOT_IDS).map((slot) => ({ op: 'lighten_exercise', slot }) as const),
  fc.constantFrom(2, 3).map((days) => ({ op: 'set_days_per_week', days }) as const),
  fc.constantFrom(...SLOT_IDS).map((slot) => ({ op: 'suspend_slot', slot }) as const),
  fc.constantFrom(...SLOT_IDS).map((slot) => ({ op: 'resume_slot', slot }) as const),
  fc.constant({ op: 'set_rep_range', slot: 'A3', min: 6, max: 10 } as const),
  fc.constant({ op: 'replace_exercise', slot: 'A3', exercise: 'seated-cable-row' } as const),
  fc.constantFrom(...SLOT_IDS).map((slot) => ({ op: 'change_sets', slot, delta: -1 }) as const),
);

/**
 * Changement accepté de l'utilisateur, placé par rapport au début d'une séance : 12 h avant, 30 min ou 2 h après.
 * Jamais à l'heure d'une fin de séance (1 h après le début), où naît une suspension pour douleur.
 */
const arbChangeSeed = fc.record({
  session: fc.nat(),
  offset: fc.constantFrom(-12 * HOUR, HOUR / 2, 2 * HOUR),
  operation: arbOperation,
});

const arbHistory = fc.record({
  sessions: fc.array(arbSessionSeed, { minLength: 1, maxLength: 16 }),
  changes: fc.array(arbChangeSeed, { maxLength: 4 }),
  planned: fc.boolean(),
  profile: weighted<SessionProfile>(['adult', 3], ['cautious', 1]),
  /** Membre qui refait la même chose à chaque séance (mêmes charges, mêmes répétitions) : il finit par stagner. */
  steady: fc.boolean(),
});

// ---------------------------------------------------------------------------------------------------------------
// Construction des séances
// ---------------------------------------------------------------------------------------------------------------

function buildSets(slot: SlotSpec, sheet: CatalogSheet, seed: ExerciseSeed, key: string): SetRecord[] {
  const spec = slot.sets.find((s) => s.kind === 'work');
  const count = slot.sets.reduce((n, s) => (s.kind === 'work' ? n + s.count : n), 0);
  const duration = spec?.durationS !== undefined;
  const range = spec?.durationS ?? spec?.reps ?? { min: 1, max: 1 };
  const span = Math.max(1, range.max - range.min);
  const base =
    [range.min - 1, range.min, range.min + Math.floor(span / 2), range.max][seed.level] ?? range.min;
  const loads = loadsFor(sheet.load_mode);
  const loadG = loads[seed.load % loads.length] ?? null;
  return Array.from({ length: count }, (_, i) => {
    const value = Math.max(0, base - (seed.vary && i === count - 1 ? 1 : 0));
    const last = i === count - 1;
    return {
      id: `${key}-set-${i + 1}`,
      position: i + 1,
      kind: 'work',
      loadMode: sheet.load_mode,
      loadG,
      reps: duration ? null : value,
      durationS: duration ? value : null,
      side: null,
      effort: last ? seed.effort : null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetDurationS: null,
      targetLoadG: loadG,
      targetRir: null,
      targetVariant: null,
      loggedAt: seed.skipped && last ? null : 1,
    };
  });
}

function buildSession(
  seed: SessionSeed,
  index: number,
  startedAt: number,
  profile: SessionProfile,
): SessionRecord {
  const id = `s${String(index).padStart(2, '0')}`;
  const workout = GYM_AB.workouts.find((w) => w.id === seed.workoutId) ?? GYM_AB.workouts[0];
  const exercises: ExerciseRecord[] = [];
  workout?.slots.forEach((slot, i) => {
    const e = seed.exercises[i];
    const sheet = e === undefined ? null : exerciseFor(slot, seed.placeId, e.pick);
    if (e === undefined || sheet === null) return;
    // Le bouton douleur écrit toujours l'ajustement (ruling R15) ; sinon, un ajustement neutre au hasard.
    const nextAdjustment = e.pain === 'pain' ? 'lighten' : e.pain === 'discomfort' ? 'hold' : e.adjustment;
    exercises.push({
      id: `${id}-${slot.id}`,
      slotId: slot.id,
      plannedExerciseId: sheet.id,
      exerciseId: sheet.id,
      position: i + 1,
      swapReason: null,
      painLevel: e.pain,
      nextAdjustment,
      sets: buildSets(slot, sheet, e, `${id}-${slot.id}`),
    });
  });
  return {
    id,
    instanceId: INSTANCE,
    workoutId: seed.workoutId,
    placeId: seed.placeId,
    startedAt,
    endedAt: startedAt + HOUR,
    status: seed.status,
    weekType: seed.weekType,
    profile,
    rulesVersion: '1',
    exercises,
  };
}

interface History {
  template: ProgramTemplate;
  /** Séances dans l'ordre du rejeu (début puis `id`). */
  sessions: SessionRecord[];
  changes: AcceptedChange[];
}

function buildHistory(h: typeof arbHistory extends fc.Arbitrary<infer T> ? T : never): History {
  let t = T0;
  const head = h.sessions[0];
  const sessions = h.sessions.map((seed, i) => {
    // Membre régulier : la séance, le rythme, la charge, le niveau de répétitions et l'effort de sa 1re séance, à
    // chaque position, séries toutes faites, sans douleur ni ajustement. Lieux, statuts et changements restent tirés.
    const steady =
      h.steady && head !== undefined
        ? {
            ...seed,
            workoutId: head.workoutId,
            weekType: 'normal' as const,
            gapDays: Math.min(seed.gapDays, 3),
            exercises: seed.exercises.map((e, k) => {
              const f = head.exercises[k] ?? e;
              const pain: PainLevel | null = e.pain === 'none' ? 'none' : null;
              const same = { level: f.level, load: f.load, vary: f.vary, effort: f.effort };
              return { ...e, ...same, skipped: false, pain, adjustment: null };
            }),
          }
        : seed;
    t += steady.gapDays * DAY;
    return buildSession(steady, i, t, h.profile);
  });
  const changes = h.changes.map((c, i): AcceptedChange => {
    const anchor = sessions[c.session % sessions.length];
    return {
      id: `c${i}`,
      author: 'user',
      reasonCode: 'USER_CHANGE',
      decidedAt: (anchor?.startedAt ?? T0) + c.offset,
      operations: [c.operation],
    };
  });
  return { template: h.planned ? PLANNED : GYM_AB, sessions, changes };
}

const arbBuiltHistory = arbHistory.map(buildHistory);

// ---------------------------------------------------------------------------------------------------------------
// Rejeu et simulation du serveur
// ---------------------------------------------------------------------------------------------------------------

function replay(
  h: History,
  sessions: readonly SessionRecord[],
  changes: readonly AcceptedChange[],
): ReplayResult {
  return replayInstance({
    instance: { id: INSTANCE, snapshot: h.template, daysPerWeek: 3, startedAt: T0 },
    sessions,
    changes,
    catalog: PROGRAM_CATALOG,
    places: PLACE_MAP,
    overrides: new Map(),
  });
}

/** Suspension écrite par le serveur : identifiant à lui (dérivé de la clé), acceptée à `decidedAt`. */
function storedSuspension(e: EngineEvent, n: number, reasonCode = 'PAIN_SUSPEND'): AcceptedChange {
  if (e.decidedAt === null) throw new Error('suspension sans decidedAt');
  return {
    id: `0193c0de-0000-8000-8000-${String(n).padStart(12, '0')}`,
    author: 'engine',
    reasonCode,
    decidedAt: Date.parse(e.decidedAt),
    operations: e.operations,
  };
}

/**
 * Le serveur (spec §4.4.4) : un rejeu par lot arrivé ; les suspensions pour douleur absentes sont écrites et
 * deviennent des entrées des rejeux suivants. Rend le dernier rejeu, toutes les clés vues et les suspensions écrites.
 */
function serverLoop(h: History, batches: readonly (readonly SessionRecord[])[]) {
  const known: SessionRecord[] = [];
  const written: AcceptedChange[] = [];
  const writtenKeys: string[] = [];
  const seen = new Set<string>();
  for (const batch of batches) {
    known.push(...batch);
    for (const e of replay(h, known, [...h.changes, ...written]).events) {
      seen.add(e.key);
      if (e.kind === 'pain_suspend' && !writtenKeys.includes(e.key)) {
        writtenKeys.push(e.key);
        written.push(storedSuspension(e, writtenKeys.length));
      }
    }
  }
  const last = replay(h, known, [...h.changes, ...written]);
  for (const e of last.events) seen.add(e.key);
  return { last, keys: [...seen].sort(), written: writtenKeys.sort() };
}

const comparable = (r: ReplayResult) => ({
  slotStates: r.slotStates,
  decisions: r.decisions,
  state: r.state,
  program: r.program,
  events: r.events.map((e) => e.key),
});

/** Découpe en lots consécutifs aux tailles données (la dernière taille se répète). */
function chunks<T>(list: readonly T[], sizes: readonly number[]): T[][] {
  const out: T[][] = [];
  let i = 0;
  let k = 0;
  while (i < list.length) {
    const size = Math.max(1, sizes[Math.min(k, sizes.length - 1)] ?? 1);
    out.push(list.slice(i, i + size));
    i += size;
    k++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Propriétés
// ---------------------------------------------------------------------------------------------------------------

describe('propriétés du rejeu', () => {
  it('un préfixe donne les mêmes décisions et les mêmes événements ; rejouer ne laisse aucune trace', () => {
    fc.assert(
      fc.property(arbBuiltHistory, fc.nat(), (h, cut) => {
        const full = replay(h, h.sessions, h.changes);
        const k = cut % (h.sessions.length + 1);
        const prefixSessions = h.sessions.slice(0, k);
        const prefix = replay(h, prefixSessions, h.changes);

        expect(full.decisions.slice(0, prefix.decisions.length)).toEqual(prefix.decisions);
        expect(full.events.slice(0, prefix.events.length)).toEqual(prefix.events);
        // Mêmes états pour ceux que la suite de l'historique ne touche plus : ni séance, ni allègement.
        const later = new Set(h.sessions.slice(k).map((s) => s.id));
        const touchedLater = new Set(
          full.decisions
            .filter((d) => h.sessions.some((s) => later.has(s.id) && s.exercises.some((e) => e.id === d.id)))
            .map((d) => `${d.instanceId}:${d.slotId}:${d.exerciseId}`),
        );
        const lightened = new Set(
          h.changes.flatMap((c) =>
            c.operations.flatMap((op) => (op.op === 'lighten_exercise' ? [op.slot] : [])),
          ),
        );
        const stable = (s: SlotState) => !touchedLater.has(s.id) && !lightened.has(s.slotId);
        const strip = (s: SlotState) => ({ ...s, suspended: false });
        const byId = new Map(full.slotStates.map((s) => [s.id, s]));
        for (const s of prefix.slotStates.filter(stable))
          expect(strip(byId.get(s.id) ?? s)).toEqual(strip(s));

        // Rejouer l'historique entier après un préfixe, ou dans un autre ordre d'arrivée : même résultat.
        expect(replay(h, [...h.sessions].reverse(), [...h.changes].reverse())).toEqual(full);
      }),
      RUNS,
    );
  });

  it('rejouer donne les mêmes clés ; la suspension relue comme entrée ne change rien et ne revient pas', () => {
    fc.assert(
      fc.property(arbBuiltHistory, (h) => {
        const first = replay(h, h.sessions, h.changes);
        expect(replay(h, h.sessions, h.changes).events.map((e) => e.key)).toEqual(
          first.events.map((e) => e.key),
        );

        const suspensions = first.events.filter((e) => e.kind === 'pain_suspend');
        const stored = suspensions.map((e, i) => storedSuspension(e, i));
        const again = replay(h, h.sessions, [...h.changes, ...stored]);
        expect(comparable(again)).toEqual({
          ...comparable(first),
          events: first.events.filter((e) => e.kind !== 'pain_suspend').map((e) => e.key),
        });

        // Retrait du consentement santé : `painLevel` effacé, codes PAIN_* réécrits (05 §13.9).
        const withdrawn = h.sessions.map((s) => ({
          ...s,
          exercises: s.exercises.map((e) => ({ ...e, painLevel: null })),
        }));
        const rewritten = suspensions.map((e, i) => storedSuspension(e, i, 'USER_SUSPEND'));
        const after = replay(h, withdrawn, [...h.changes, ...rewritten]);
        const rewrite = (c: ReasonCode): ReasonCode =>
          c === 'PAIN_HOLD' || c === 'PAIN_LIGHTEN' ? PAIN_CODE_REWRITES[c] : c;
        const noC2 = (states: SlotState[]) => states.map((s) => ({ ...s, painStreak: 0 }));
        expect(after.events.map((e) => e.key)).toEqual(
          first.events.filter((e) => e.kind !== 'pain_suspend').map((e) => e.key),
        );
        expect(after.decisions).toEqual(
          first.decisions.map((d) => ({ ...d, reasonCode: rewrite(d.reasonCode) })),
        );
        expect(noC2(after.slotStates)).toEqual(noC2(first.slotStates));
        expect(after.state).toEqual(first.state);
        expect(after.program).toEqual(first.program);
      }),
      RUNS,
    );
  });

  it('séances arrivées en lots consécutifs : même résultat qu’en un seul lot', () => {
    fc.assert(
      fc.property(arbBuiltHistory, fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1 }), (h, sizes) => {
        const once = serverLoop(h, [h.sessions]);
        const split = serverLoop(h, chunks(h.sessions, sizes));
        expect(comparable(split.last)).toEqual(comparable(once.last));
        expect(split.keys).toEqual(once.keys);
        expect(split.written).toEqual(once.written);
      }),
      RUNS,
    );
  });

  it('sans douleur stockée, l’ordre d’arrivée des lots ne compte pas non plus', () => {
    // Avec la douleur, une séance arrivée en retard peut effacer la cause d'une suspension déjà écrite : la
    // suspension reste (spec §4.4.4). Sans douleur stockée, aucune entrée ne naît du rejeu : le dernier rejeu est
    // celui d'un seul lot. Les rejeux intermédiaires, eux, voient un historique troué et peuvent proposer sur une
    // autre séance déclenchante ; ces propositions restent `proposed` puis expirent (05 §15.4) : on ne compare donc
    // que le dernier rejeu.
    const noPain = arbBuiltHistory.map((h) => ({
      ...h,
      sessions: h.sessions.map((s) => ({
        ...s,
        exercises: s.exercises.map((e) => ({ ...e, painLevel: null })),
      })),
    }));
    fc.assert(
      fc.property(
        noPain.chain((h) =>
          fc.tuple(
            fc.constant(h),
            fc.shuffledSubarray(h.sessions, { minLength: h.sessions.length, maxLength: h.sessions.length }),
            fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1 }),
          ),
        ),
        ([h, arrival, sizes]) => {
          const once = serverLoop(h, [h.sessions]);
          const split = serverLoop(h, chunks(arrival, sizes));
          expect(comparable(split.last)).toEqual(comparable(once.last));
          expect(split.written).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it('les historiques tirés produisent des décisions, des stagnations, des suspensions et des propositions', () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(arbBuiltHistory, (h) => {
        const r = replay(h, h.sessions, h.changes);
        for (const d of r.decisions) seen.add(d.result);
        for (const e of r.events) seen.add(e.kind);
      }),
      { numRuns: 300, seed: 20261101 },
    );
    for (const expected of ['PROGRESS', 'STALL', 'DELOAD', 'IGNORED', 'pain_suspend', 'propose_replace']) {
      expect(seen).toContain(expected);
    }
  });
});
