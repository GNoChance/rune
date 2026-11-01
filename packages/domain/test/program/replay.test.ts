/*
 * `replayInstance` par tableaux de cas (spec brique 3 §4.4, §4.3.7 à §4.3.9) : ordre du rejeu, semaines de programme
 * et blocs, allègements, douleur, événements du moteur, reprise après absence, règles par version, pas de machine.
 */
import {
  type Effort,
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
import { describe, expect, it } from 'vitest';
import type { CatalogSheet } from '../../src/catalog/usable';
import { effectiveProgram } from '../../src/program/effective';
import { parisDaysBetween, upcomingWeekType } from '../../src/program/program-state';
import {
  type EngineEvent,
  type ReplayResult,
  replayInstance,
  UnknownRulesVersionError,
} from '../../src/program/replay';
import { RULES_BY_VERSION, type RulesBook, type RulesSet } from '../../src/program/rules';
import type {
  AcceptedChange,
  EngineDecision,
  ExerciseRecord,
  SessionRecord,
  SetRecord,
  SlotState,
} from '../../src/program/types';
import { PUSH_UP_CHAIN } from '../fixtures/catalog';
import { accepted, GYM_AB, gymAb, PLACES, PROGRAM_CATALOG } from '../fixtures/program';

const fail = (what: string): never => {
  throw new Error(`${what} absent`);
};

const INSTANCE = 'inst-1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Lundi 2 novembre 2026, 18 h à Paris (UTC+1). */
const T0 = Date.UTC(2026, 10, 2, 17);
const at = (day: number, hours = 0) => T0 + day * DAY + hours * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------------------------------------------

let seq = 0;

/** Séries de travail faites, une par valeur ; effort sur la dernière (`ok` par défaut). */
function work(
  values: readonly number[],
  loadG: number | null,
  o: { effort?: Effort | null; measure?: 'reps' | 'duration' } = {},
): SetRecord[] {
  const effort = 'effort' in o ? (o.effort ?? null) : 'ok';
  const duration = o.measure === 'duration';
  return values.map((v, i) => ({
    id: `set-${++seq}`,
    position: i + 1,
    kind: 'work',
    loadMode: loadG === null ? 'bodyweight' : 'barbell',
    loadG,
    reps: duration ? null : v,
    durationS: duration ? v : null,
    side: null,
    effort: i === values.length - 1 ? effort : null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetDurationS: null,
    targetLoadG: null,
    targetRir: null,
    targetVariant: null,
    loggedAt: 1,
  }));
}

type ExerciseOptions = {
  painLevel?: PainLevel | null;
  nextAdjustment?: NextAdjustment | null;
  position?: number;
};

function done(
  slotId: string | null,
  exerciseId: string,
  sets: SetRecord[],
  o: ExerciseOptions = {},
): ExerciseRecord {
  return {
    id: `pe-${++seq}`,
    slotId,
    plannedExerciseId: exerciseId,
    exerciseId,
    position: o.position ?? 1,
    swapReason: null,
    painLevel: o.painLevel ?? null,
    nextAdjustment: o.nextAdjustment ?? null,
    sets,
  };
}

type SessionOptions = {
  status?: SessionStatus;
  weekType?: WeekType;
  profile?: SessionProfile;
  rulesVersion?: string;
  placeId?: string | null;
  endedAt?: number | null;
  instanceId?: string | null;
};

function session(
  id: string,
  startedAt: number,
  workoutId: string,
  exercises: ExerciseRecord[] = [],
  o: SessionOptions = {},
): SessionRecord {
  return {
    id,
    instanceId: o.instanceId === undefined ? INSTANCE : o.instanceId,
    workoutId,
    placeId: o.placeId === undefined ? 'gym' : o.placeId,
    startedAt,
    endedAt: o.endedAt === undefined ? startedAt + HOUR : o.endedAt,
    status: o.status ?? 'completed',
    weekType: o.weekType ?? 'normal',
    profile: o.profile ?? 'adult',
    rulesVersion: o.rulesVersion ?? '1',
    exercises,
  };
}

/** Squat arrière (A1 : linéaire 3 × 6, + 5 kg, barre de 20 kg et disques de 1,25 kg). */
const squat = (loadG: number, o: ExerciseOptions & { reps?: number[]; effort?: Effort | null } = {}) =>
  done('A1', 'back-squat', work(o.reps ?? [6, 6, 6], loadG, 'effort' in o ? { effort: o.effort } : {}), o);
/** Rowing barre (A3 : double [8, 12] × 3). */
const row = (reps: number[] = [10, 10, 10], loadG = 60000) =>
  done('A3', 'barbell-row', work(reps, loadG), { position: 3 });
/** Écarté aux haltères (A4 : double [10, 15] × 2, haltères de 2 kg en 2 kg). */
const fly = (reps: number[] = [12, 12], loadG = 10000) =>
  done('A4', 'dumbbell-fly', work(reps, loadG), { position: 4 });

/** Séances `s000`, `s001`… tous les deux jours, A et B en alternance, sans exercice. */
const blanks = (n: number): SessionRecord[] =>
  Array.from({ length: n }, (_, i) =>
    session(`s${String(i).padStart(3, '0')}`, at(i * 2), i % 2 === 0 ? 'A' : 'B'),
  );

// ---------------------------------------------------------------------------------------------------------------
// Rejeu
// ---------------------------------------------------------------------------------------------------------------

const PLACE_MAP = new Map(PLACES.map((p) => [p.id, p]));
const PLANNED: ProgramTemplate = gymAb((t) => {
  t.block = { mode: 'planned', weeks: 5, deloadWeek: 5 };
});

type ReplayOptions = {
  template?: ProgramTemplate;
  days?: number;
  catalog?: readonly CatalogSheet[];
  overrides?: ReadonlyMap<string, number>;
  rulesBook?: RulesBook;
};

function replay(
  sessions: readonly SessionRecord[],
  changes: readonly AcceptedChange[] = [],
  o: ReplayOptions = {},
): ReplayResult {
  return replayInstance({
    instance: { id: INSTANCE, snapshot: o.template ?? GYM_AB, daysPerWeek: o.days ?? 3, startedAt: T0 - DAY },
    sessions,
    changes,
    catalog: o.catalog ?? PROGRAM_CATALOG,
    places: PLACE_MAP,
    overrides: o.overrides ?? new Map(),
    ...(o.rulesBook === undefined ? {} : { rulesBook: o.rulesBook }),
  });
}

const decisionOf = (r: ReplayResult, pe: ExerciseRecord): EngineDecision =>
  r.decisions.find((d) => d.id === pe.id) ?? fail(`décision ${pe.id}`);
const stateOf = (r: ReplayResult, slotId: string, exerciseId: string): SlotState =>
  r.slotStates.find((s) => s.id === `${INSTANCE}:${slotId}:${exerciseId}`) ??
  fail(`état ${slotId}:${exerciseId}`);
const firstOf = <T>(list: readonly T[]): T => list[0] ?? fail('élément');
const key = (code: string, slot: string | null, exercise: string | null, trigger: string) =>
  `engine|${INSTANCE}|${code}|${slot ?? ''}|${exercise ?? ''}|${trigger}`;

// ---------------------------------------------------------------------------------------------------------------
// Ordre (spec §4.4.1)
// ---------------------------------------------------------------------------------------------------------------

describe('ordre du rejeu', () => {
  it('séances triées par startedAt puis id, quel que soit leur ordre d’arrivée', () => {
    const b = squat(60000);
    const a = squat(60000);
    const c = squat(60000);
    const r = replay([
      session('s-c', at(2), 'A', [c]),
      session('s-b', at(0), 'A', [b]),
      session('s-a', at(0), 'A', [a]),
    ]);
    expect(r.decisions.map((d) => d.id)).toEqual([a.id, b.id, c.id]);
    expect(r.decisions.map((d) => d.result)).toEqual(['CALIBRATION', 'PROGRESS', 'PROGRESS']);
    expect(stateOf(r, 'A1', 'back-squat').lastSessionId).toBe('s-c');
  });

  it('un changement à la même heure qu’une séance passe avant elle', () => {
    const second = squat(60000);
    const sessions = [session('s1', at(0), 'A', [squat(60000)]), session('s2', at(2), 'A', [second])];
    const suspend = (t: number) => accepted('c1', t, [{ op: 'suspend_slot', slot: 'A1' }]);

    const same = decisionOf(replay(sessions, [suspend(at(2))]), second);
    expect([same.result, same.reasonCode]).toEqual(['IGNORED', 'SLOT_SUSPENDED']);

    const after = decisionOf(replay(sessions, [suspend(at(2) + 1)]), second);
    expect([after.result, after.reasonCode]).toEqual(['PROGRESS', 'LOAD_UP']);
  });

  it('séances in_progress, abandoned et d’une autre instance ignorées : ni décision, ni semaine, ni rotation', () => {
    const kept = squat(60000);
    const r = replay([
      session('s1', at(0), 'A', [kept]),
      session('s2', at(2), 'B', [squat(60000)], { status: 'in_progress' }),
      session('s3', at(4), 'B', [squat(60000)], { status: 'abandoned' }),
      session('s4', at(6), 'B', [squat(60000)], { instanceId: 'autre' }),
      session('s5', at(8), 'B', [squat(60000)], { instanceId: null }),
    ]);
    expect(r.decisions.map((d) => d.id)).toEqual([kept.id]);
    expect(r.state).toEqual({
      weekIndex: 0,
      sessionsInWeek: 1,
      blockWeek: null,
      deloadSessionsLeft: 0,
      nextWorkoutId: 'B',
      lastCompletedStartedAt: iso(at(0)),
    });
  });

  it('chaque exercice est évalué sur le slot du programme effectif au début de la séance', () => {
    const second = row([10, 10, 10]);
    const sessions = [session('s1', at(0), 'A', [row([10, 10, 10])]), session('s2', at(2), 'A', [second])];
    const range = (t: number) => accepted('c1', t, [{ op: 'set_rep_range', slot: 'A3', min: 6, max: 10 }]);

    // [6, 10] : 10, 10, 10 est le sommet de la fourchette, la charge monte.
    const before = decisionOf(replay(sessions, [range(at(1))]), second);
    expect([before.result, before.reasonCode, before.nextTarget?.loadG]).toEqual([
      'PROGRESS',
      'LOAD_UP',
      62500,
    ]);
    // [8, 12] : même total que la séance d'avant, rien ne bouge.
    const later = decisionOf(replay(sessions, [range(at(3))]), second);
    expect([later.result, later.reasonCode]).toEqual(['HOLD', 'NO_PROGRESS']);
  });

  it('un exercice sans slot, d’un slot absent ou d’une fiche inconnue n’a pas de décision', () => {
    const r = replay([
      session('s1', at(0), 'A', [
        done(null, 'back-squat', work([6, 6, 6], 60000)),
        done('Z9', 'back-squat', work([6, 6, 6], 60000)),
        done('A1', 'fiche-inconnue', work([6, 6, 6], 60000)),
      ]),
    ]);
    expect(r.decisions).toEqual([]);
    expect(r.slotStates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Semaines de programme, blocs et allègements (spec §4.3.7, 05 §10)
// ---------------------------------------------------------------------------------------------------------------

describe('semaines de programme', () => {
  it('3 jours, 7 séances : semaine 2, 1 séance faite, la rotation reprend après la dernière', () => {
    const r = replay(blanks(7));
    expect(r.state).toEqual({
      weekIndex: 2,
      sessionsInWeek: 1,
      blockWeek: null,
      deloadSessionsLeft: 0,
      nextWorkoutId: 'B',
      lastCompletedStartedAt: iso(at(12)),
    });
  });

  it('rotation : la séance qui suit la dernière terminée, même choisie hors rotation', () => {
    expect(replay([]).state.nextWorkoutId).toBe('A');
    expect(replay([session('s1', at(0), 'B')]).state.nextWorkoutId).toBe('A');
    expect(replay([session('s1', at(0), 'A'), session('s2', at(2), 'A')]).state.nextWorkoutId).toBe('B');
    // Séance d'une séance inconnue du programme : la rotation ne bouge pas.
    expect(replay([session('s1', at(0), 'A'), session('s2', at(2), 'Z')]).state.nextWorkoutId).toBe('B');
  });

  it('passage de 3 à 2 jours en cours de semaine : la semaine se ferme dès que le compte est atteint', () => {
    const days2 = (t: number) => accepted('c1', t, [{ op: 'set_days_per_week', days: 2 }]);
    const two = replay(blanks(2), [days2(at(3))]);
    expect([two.state.weekIndex, two.state.sessionsInWeek, two.program.daysPerWeek]).toEqual([1, 0, 2]);
    const four = replay(blanks(4), [days2(at(3))]);
    expect([four.state.weekIndex, four.state.sessionsInWeek]).toEqual([2, 0]);

    const one = replay(blanks(1), [days2(at(1))]);
    expect([one.state.weekIndex, one.state.sessionsInWeek]).toEqual([0, 1]);
    const oneMore = replay(blanks(2), [days2(at(1))]);
    expect([oneMore.state.weekIndex, oneMore.state.sessionsInWeek]).toEqual([1, 0]);
  });

  it('modèle réactif : pas de bloc, aucune semaine allégée sans allègement accepté', () => {
    for (const n of [0, 12, 27]) {
      const r = replay(blanks(n));
      expect(r.state.blockWeek).toBeNull();
      expect(upcomingWeekType(r.state, r.program)).toBe('normal');
    }
  });

  it('modèle planifié : semaines 5 et 10 allégées', () => {
    const deloadWeeks: number[] = [];
    for (let n = 0; n <= 32; n++) {
      const r = replay(blanks(n), [], { template: PLANNED });
      const week = r.state.weekIndex + 1;
      expect(r.state.blockWeek).toBe(((week - 1) % 5) + 1);
      if (upcomingWeekType(r.state, r.program) === 'deload' && !deloadWeeks.includes(week)) {
        deloadWeeks.push(week);
      }
    }
    expect(deloadWeeks).toEqual([5, 10]);
    expect(replay(blanks(12), [], { template: PLANNED }).state.blockWeek).toBe(5);
    expect(replay(blanks(15), [], { template: PLANNED }).state.blockWeek).toBe(1);
  });

  it('allègement accepté en semaine 3 : les 3 séances suivantes allégées, puis le bloc repart à sa semaine 1', () => {
    // 6 séances faites : début de la semaine 3 (indice 2), semaine 3 du bloc.
    const deload = accepted('c1', at(11), [{ op: 'start_deload' }]);
    const after = (n: number) => replay(blanks(n), [deload], { template: PLANNED });

    const six = after(6);
    expect([six.state.weekIndex, six.state.blockWeek, six.state.deloadSessionsLeft]).toEqual([2, 3, 3]);
    expect(upcomingWeekType(six.state, six.program)).toBe('deload');
    expect(after(7).state.deloadSessionsLeft).toBe(2);
    expect(upcomingWeekType(after(8).state, after(8).program)).toBe('deload');

    const nine = after(9);
    expect([nine.state.weekIndex, nine.state.blockWeek, nine.state.deloadSessionsLeft]).toEqual([3, 1, 0]);
    expect(upcomingWeekType(nine.state, nine.program)).toBe('normal');
    // Le bloc repart : la semaine allégée planifiée revient 4 semaines plus tard.
    expect(after(18).state.blockWeek).toBe(4);
    const twentyOne = after(21);
    expect(twentyOne.state.blockWeek).toBe(5);
    expect(upcomingWeekType(twentyOne.state, twentyOne.program)).toBe('deload');
  });

  it('proposition d’allègement du moteur acceptée, modèle réactif : 3 séances allégées, toujours sans bloc', () => {
    const deload: AcceptedChange = {
      ...accepted('c1', at(3), [{ op: 'start_deload' }], 'engine'),
      reasonCode: 'ENGINE_REACTIVE_DELOAD',
    };
    const r = (n: number) => replay(blanks(n), [deload]);
    expect(r(2).state.deloadSessionsLeft).toBe(3);
    expect(upcomingWeekType(r(2).state, r(2).program)).toBe('deload');
    expect(r(4).state.deloadSessionsLeft).toBe(1);
    expect(r(5).state.deloadSessionsLeft).toBe(0);
    expect(r(5).state.blockWeek).toBeNull();
    expect(upcomingWeekType(r(5).state, r(5).program)).toBe('normal');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Allègement d'un exercice (05 §15) et règles par version (spec §4.1)
// ---------------------------------------------------------------------------------------------------------------

const lightenRules: RulesSet = { ...(RULES_BY_VERSION['1'] ?? fail('règles 1')), lightenPct: 20 };
const BOOK: RulesBook = { '1': RULES_BY_VERSION['1'] ?? fail('règles 1'), '2': lightenRules };

describe('allègement d’un exercice et règles par version', () => {
  it('lighten_exercise accepté s’applique à la prochaine séance du slot', () => {
    const second = squat(60000);
    const third = squat(57500);
    const sessions = [session('s1', at(0), 'A', [squat(60000)]), session('s2', at(2), 'A', [second])];
    const lighten = accepted('c1', at(3), [{ op: 'lighten_exercise', slot: 'A1' }]);

    // Après s2, la cible est 65 kg ; allégée de 10 % : roundDown(58 500) = 57 500.
    const r = replay(sessions, [lighten]);
    expect(decisionOf(r, second).nextTarget?.loadG).toBe(65000);
    expect(stateOf(r, 'A1', 'back-squat').loadG).toBe(57500);
    // La séance suivante part de ce qui a été fait.
    const next = replay([...sessions, session('s3', at(4), 'A', [third])], [lighten]);
    expect(decisionOf(next, third).nextTarget?.loadG).toBe(62500);
  });

  it('une séance garde l’allègement de sa version : 10 % en « 1 », 20 % en « 2 »', () => {
    const v1 = squat(60000, { nextAdjustment: 'lighten' });
    const v2 = squat(60000, { nextAdjustment: 'lighten' });
    const r = replay(
      [
        session('s1', at(0), 'A', [squat(60000)]),
        session('s2', at(2), 'A', [v1]),
        session('s3', at(4), 'A', [v2], { rulesVersion: '2' }),
      ],
      [],
      { rulesBook: BOOK },
    );
    expect([decisionOf(r, v1).reasonCode, decisionOf(r, v1).nextTarget?.loadG]).toEqual([
      'USER_LIGHTEN',
      52500,
    ]);
    expect(decisionOf(r, v1).rulesVersion).toBe('1');
    expect([decisionOf(r, v2).reasonCode, decisionOf(r, v2).nextTarget?.loadG]).toEqual([
      'USER_LIGHTEN',
      47500,
    ]);
    expect(decisionOf(r, v2).rulesVersion).toBe('2');
    expect(stateOf(r, 'A1', 'back-squat').rulesVersion).toBe('2');
  });

  it('lighten_exercise suit la version de la dernière séance de l’état', () => {
    const lighten = accepted('c1', at(5), [{ op: 'lighten_exercise', slot: 'A1' }]);
    const history = (version: string) => [
      session('s1', at(0), 'A', [squat(60000)], { rulesVersion: version }),
      session('s2', at(2), 'A', [squat(60000)], { rulesVersion: version }),
    ];
    // Cible 65 kg : × 0,9 → 57 500 ; × 0,8 → roundDown(52 000) = 50 000.
    expect(stateOf(replay(history('1'), [lighten], { rulesBook: BOOK }), 'A1', 'back-squat').loadG).toBe(
      57500,
    );
    expect(stateOf(replay(history('2'), [lighten], { rulesBook: BOOK }), 'A1', 'back-squat').loadG).toBe(
      50000,
    );
  });

  it('version inconnue du rulesBook : UnknownRulesVersionError, sauf pour une séance non rejouée', () => {
    const unknown = [session('s1', at(0), 'A', [squat(60000)], { rulesVersion: '9' })];
    expect(() => replay(unknown)).toThrow(UnknownRulesVersionError);
    try {
      replay(unknown);
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownRulesVersionError);
      expect((e as UnknownRulesVersionError).version).toBe('9');
      expect((e as UnknownRulesVersionError).sessionId).toBe('s1');
    }
    expect(() => replay([session('s1', at(0), 'A', [squat(60000)], { rulesVersion: '2' })])).toThrow(
      UnknownRulesVersionError,
    );
    expect(() =>
      replay([session('s1', at(0), 'A', [squat(60000)], { rulesVersion: '9', status: 'abandoned' })]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Pas de machine (05 §12) et chaînes (spec §4.3.6)
// ---------------------------------------------------------------------------------------------------------------

describe('entrées du moteur', () => {
  /** Tirage vertical (B3 : double [8, 12] × 3, machine). */
  const pulldown = (reps: number[]) => done('B3', 'lat-pulldown', work(reps, 50000));

  it('machine_step_g_override repris des overrides : grille et état', () => {
    const top = pulldown([12, 12, 12]);
    const sessions = [session('s1', at(0), 'B', [pulldown([10, 10, 10])]), session('s2', at(2), 'B', [top])];
    const id = `${INSTANCE}:B3:lat-pulldown`;

    const plain = replay(sessions);
    expect(decisionOf(plain, top).nextTarget?.loadG).toBe(55000);
    expect(stateOf(plain, 'B3', 'lat-pulldown').machineStepGOverride).toBeNull();

    const corrected = replay(sessions, [], { overrides: new Map([[id, 2500]]) });
    expect([decisionOf(corrected, top).reasonCode, decisionOf(corrected, top).nextTarget?.loadG]).toEqual([
      'LOAD_UP',
      52500,
    ]);
    expect(stateOf(corrected, 'B3', 'lat-pulldown').machineStepGOverride).toBe(2500);
  });

  describe('chaîne du slot : complète, dans l’ordre de chain_rank, coupée en prudent, jamais filtrée par le lieu', () => {
    const chainSlot: SlotSpec = {
      id: 'A6',
      movementPattern: 'horizontal_push',
      role: 'accessory',
      chain: 'push-up',
      sets: [{ kind: 'work', count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 }],
      progression: { type: 'chain' },
    };
    const template = gymAb((t) => {
      t.workouts[0]?.slots.push(chainSlot);
    });
    const catalog: CatalogSheet[] = [...PROGRAM_CATALOG.filter((s) => s.id !== 'push-up'), ...PUSH_UP_CHAIN];
    const pushUps = (exerciseId: string, profile: SessionProfile) => {
      const pe = done('A6', exerciseId, work([10, 10, 10], null));
      return { pe, r: replay([session('s1', at(0), 'A', [pe], { profile })], [], { template, catalog }) };
    };

    it('la pompe à la salle (sans chaise ni banc) garde son rang 3 de la chaîne complète', () => {
      const { r } = pushUps('push-up', 'adult');
      expect(stateOf(r, 'A6', 'push-up').variantRank).toBe(3);
    });

    it('adulte : la pompe pieds surélevés (rang 4 sur 5) n’est pas la dernière variante', () => {
      const { pe, r } = pushUps('feet-elevated-push-up', 'adult');
      expect(stateOf(r, 'A6', 'push-up').variantRank).toBe(4);
      expect(decisionOf(r, pe).nextTarget?.repsMax).toBe(12);
    });

    it('prudent : la chaîne s’arrête avant la pompe archer, la pompe pieds surélevés est la dernière', () => {
      const { pe, r } = pushUps('feet-elevated-push-up', 'cautious');
      expect(stateOf(r, 'A6', 'push-up').variantRank).toBe(4);
      expect(decisionOf(r, pe).nextTarget?.repsMax).toBe(15);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Douleur (spec §4.4.3 et §4.4.4, 05 §13.7)
// ---------------------------------------------------------------------------------------------------------------

describe('douleur', () => {
  const pain = { painLevel: 'pain', nextAdjustment: 'lighten' } as const;
  const build = () => {
    const third = squat(52500, pain);
    const fourth = squat(52500);
    const sessions = [
      session('s1', at(0), 'A', [squat(60000, { painLevel: 'none' })]),
      session('s2', at(2), 'A', [squat(60000, pain)]),
      session('s3', at(4), 'A', [third], { endedAt: at(4, 1.5) }),
      session('s4', at(6), 'A', [fourth]),
    ];
    return { sessions, third, fourth };
  };
  /** La suspension telle que le serveur l'a écrite : identifiant dérivé de la clé, acceptée à `decidedAt`. */
  const stored = (e: EngineEvent, reasonCode = 'PAIN_SUSPEND'): AcceptedChange => ({
    id: '0193c0de-0000-8000-8000-000000000001',
    author: 'engine',
    reasonCode,
    decidedAt: Date.parse(e.decidedAt ?? fail('decidedAt')),
    operations: e.operations,
  });

  it('2 séances de suite en douleur : suspension acceptée à la fin de la 2e, slot suspendu dès la suivante', () => {
    const { sessions, fourth } = build();
    const r = replay(sessions);
    expect(r.events).toEqual([
      {
        key: key('PAIN_SUSPEND', 'A1', 'back-squat', 's3'),
        kind: 'pain_suspend',
        slotId: 'A1',
        exerciseId: 'back-squat',
        triggerSessionId: 's3',
        decidedAt: iso(at(4, 1.5)),
        operations: [{ op: 'suspend_slot', slot: 'A1' }],
        reasonCode: 'PAIN_SUSPEND',
      } satisfies EngineEvent,
    ]);
    expect([decisionOf(r, fourth).result, decisionOf(r, fourth).reasonCode]).toEqual([
      'IGNORED',
      'SLOT_SUSPENDED',
    ]);
    expect(r.program.suspended.has('A1')).toBe(true);
    expect(stateOf(r, 'A1', 'back-squat').suspended).toBe(true);
    expect(stateOf(replay(sessions.slice(0, 3)), 'A1', 'back-squat').painStreak).toBe(2);
  });

  it('une séance commencée avant la fin de la séance déclenchante est évaluée avant la suspension', () => {
    const { sessions } = build();
    const overlap = squat(52500);
    const r = replay([...sessions, session('s3b', at(4, 1), 'A', [overlap])]);
    expect(decisionOf(r, overlap).result).not.toBe('IGNORED');
  });

  it('rejeu avec la suspension en entrée : aucun nouvel événement, même résultat', () => {
    const { sessions } = build();
    const first = replay(sessions);
    const again = replay(sessions, [stored(firstOf(first.events))]);
    expect(again.events).toEqual([]);
    expect(again.decisions).toEqual(first.decisions);
    expect(again.slotStates).toEqual(first.slotStates);
    expect(again.state).toEqual(first.state);
    expect(again.program).toEqual(first.program);
  });

  it('après le retrait du consentement (painLevel à null) : slot toujours suspendu, aucun événement', () => {
    const { sessions } = build();
    const first = replay(sessions);
    const withdrawn = sessions.map((s) => ({
      ...s,
      exercises: s.exercises.map((e) => ({ ...e, painLevel: null })),
    }));
    const r = replay(withdrawn, [stored(firstOf(first.events), 'USER_SUSPEND')]);
    expect(r.events).toEqual([]);
    expect(r.program.suspended.has('A1')).toBe(true);
    // Mêmes décisions aux codes PAIN_* près, mêmes états hors colonne C2 (`pain_streak`).
    const rewrite = (c: ReasonCode): ReasonCode =>
      c === 'PAIN_HOLD' || c === 'PAIN_LIGHTEN' ? PAIN_CODE_REWRITES[c] : c;
    expect(r.decisions).toEqual(first.decisions.map((d) => ({ ...d, reasonCode: rewrite(d.reasonCode) })));
    const noC2 = (states: SlotState[]) => states.map((s) => ({ ...s, painStreak: 0 }));
    expect(noC2(r.slotStates)).toEqual(noC2(first.slotStates));
  });

  it('gêne deux fois, ou douleur non stockée (sans consentement) : aucune suspension', () => {
    const discomfort = { painLevel: 'discomfort', nextAdjustment: 'hold' } as const;
    const unstored = { painLevel: null, nextAdjustment: 'lighten' } as const;
    for (const o of [discomfort, unstored]) {
      const r = replay([
        session('s1', at(0), 'A', [squat(60000)]),
        session('s2', at(2), 'A', [squat(60000, o)]),
        session('s3', at(4), 'A', [squat(60000, o)]),
      ]);
      expect(r.events).toEqual([]);
      expect(r.program.suspended.size).toBe(0);
    }
  });

  it('suspension levée par l’utilisateur : le slot est de nouveau évalué', () => {
    const { sessions, fourth } = build();
    const resume = accepted('c-resume', at(5), [{ op: 'resume_slot', slot: 'A1' }]);
    const r = replay(sessions, [resume]);
    expect(decisionOf(r, fourth).reasonCode).not.toBe('SLOT_SUSPENDED');
    expect(r.program.suspended.has('A1')).toBe(false);
    expect(stateOf(r, 'A1', 'back-squat').suspended).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Stagnation et allègement réactif (05 §9.6, §10.1, spec §4.4.4)
// ---------------------------------------------------------------------------------------------------------------

describe('événements de stagnation', () => {
  it('stagnation au rang de la proposition : propose_replace vers le suivant utilisable de la liste', () => {
    const rows = Array.from({ length: 7 }, () => row());
    const r = replay(rows.map((pe, i) => session(`s${i + 1}`, at(i * 2), 'A', [pe])));
    const proposed = r.decisions.filter((d) => d.reasonCode === 'STALL_REPLACE_PROPOSED');
    expect(proposed.map((d) => d.id)).toEqual([rows[6]?.id]);
    expect(r.events).toEqual([
      {
        key: key('ENGINE_STALL_REPLACE', 'A3', 'barbell-row', 's7'),
        kind: 'propose_replace',
        slotId: 'A3',
        exerciseId: 'barbell-row',
        triggerSessionId: 's7',
        decidedAt: null,
        operations: [{ op: 'replace_exercise', slot: 'A3', exercise: 'seated-cable-row' }],
        reasonCode: 'ENGINE_STALL_REPLACE',
      } satisfies EngineEvent,
    ]);
  });

  it('2 slots en stagnation dans la même séance : propose_deload', () => {
    const r = replay(
      Array.from({ length: 4 }, (_, i) => session(`s${i + 1}`, at(i * 2), 'A', [row(), fly()])),
    );
    expect(r.decisions.filter((d) => d.result === 'STALL').map((d) => d.slotId)).toEqual(['A3', 'A4']);
    expect(r.events).toEqual([
      {
        key: key('ENGINE_REACTIVE_DELOAD', null, null, 's4'),
        kind: 'propose_deload',
        slotId: null,
        exerciseId: null,
        triggerSessionId: 's4',
        decidedAt: null,
        operations: [{ op: 'start_deload' }],
        reasonCode: 'ENGINE_REACTIVE_DELOAD',
      } satisfies EngineEvent,
    ]);
  });

  /** Séances A tous les deux jours ; A3 de la 1re à la 4e, A4 à partir de la `flyFrom`-ième (4 séances). */
  const staggered = (flyFrom: number) =>
    Array.from({ length: flyFrom + 3 }, (_, i) => {
      const n = i + 1;
      const exercises = [...(n <= 4 ? [row()] : []), ...(n >= flyFrom ? [fly()] : [])];
      return session(`s${String(n).padStart(2, '0')}`, at(i * 2), 'A', exercises);
    });

  it('2 slots en stagnation sur les 2 dernières semaines de programme : propose_deload', () => {
    // A3 stagne à la 4e séance (semaine d'indice 1), A4 à la 8e (indice 2).
    const r = replay(staggered(5));
    expect(r.events.map((e) => e.key)).toEqual([key('ENGINE_REACTIVE_DELOAD', null, null, 's08')]);
  });

  it('stagnations à plus de 2 semaines d’écart : aucune proposition d’allègement', () => {
    // A3 stagne à la 4e séance (indice 1), A4 à la 11e (indice 3).
    const r = replay(staggered(8));
    expect(r.decisions.filter((d) => d.result === 'STALL').map((d) => d.slotId)).toEqual(['A3', 'A4']);
    expect(r.events).toEqual([]);
  });

  it('rejouer deux fois donne les mêmes événements, dans le même ordre', () => {
    const sessions = Array.from({ length: 7 }, (_, i) =>
      session(`s${i + 1}`, at(i * 2), 'A', [row(), fly()]),
    );
    const keys = (r: ReplayResult) => r.events.map((e) => e.key);
    expect(keys(replay(sessions))).toEqual(keys(replay([...sessions].reverse())));
    expect(keys(replay(sessions)).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Reprise après absence (spec §4.3.9, 05 §10.4) et horloges fausses (Review Focus 2)
// ---------------------------------------------------------------------------------------------------------------

describe('reprise après absence', () => {
  /** 1er novembre 2026 à 23 h 30, heure de Paris (UTC+1). */
  const NOV_1_2330 = Date.UTC(2026, 10, 1, 22, 30);

  it('écart en jours civils de Paris : du 1er à 23 h 30 au 15 à 0 h 30, 14 jours (13 en UTC)', () => {
    const nov15 = Date.UTC(2026, 10, 14, 23, 30);
    expect(parisDaysBetween(NOV_1_2330, nov15)).toBe(14);
    expect(Math.floor((nov15 - NOV_1_2330) / DAY)).toBe(13);
    expect(parisDaysBetween(NOV_1_2330, Date.UTC(2026, 10, 14, 22, 30))).toBe(13);
    // Passage à l'heure d'été (29 mars 2026) : jours civils, pas tranches de 24 h.
    expect(parisDaysBetween(Date.UTC(2026, 2, 28, 23, 30), Date.UTC(2026, 2, 29, 22, 30))).toBe(1);
  });

  it('14 jours civils après la dernière séance : la séance de reprise suit la calibration', () => {
    const resumed = squat(65000);
    const sessions = (t: number) => [
      session('s1', NOV_1_2330 - 2 * DAY, 'A', [squat(60000)]),
      session('s2', NOV_1_2330, 'A', [squat(60000)]),
      session('s3', t, 'A', [resumed]),
    ];
    const r14 = replay(sessions(Date.UTC(2026, 10, 14, 23, 30)));
    expect(decisionOf(r14, resumed).result).toBe('CALIBRATION');
    expect(r14.state.lastCompletedStartedAt).toBe('2026-11-14T23:30:00.000Z');
    const r13 = replay(sessions(Date.UTC(2026, 10, 14, 22, 30)));
    expect([decisionOf(r13, resumed).result, decisionOf(r13, resumed).reasonCode]).toEqual([
      'PROGRESS',
      'LOAD_UP',
    ]);
  });

  it('séance datée dans le futur : rejeu sans erreur, elle compte pour une séance sans toucher aux autres', () => {
    const normal = [
      session('s1', at(0), 'A', [squat(60000)]),
      session('s2', at(2), 'B'),
      session('s3', at(4), 'A', [squat(65000)]),
      session('s5', at(8), 'B'),
    ];
    const future = session('s4', Date.UTC(2031, 0, 1, 12), 'A', [squat(70000)]);
    const without = replay(normal);
    const r = replay([...normal, future]);

    expect(r.decisions.slice(0, without.decisions.length)).toEqual(without.decisions);
    expect([r.state.weekIndex, r.state.sessionsInWeek]).toEqual([1, 2]);
    expect(r.state.nextWorkoutId).toBe('B');
    expect(r.state.lastCompletedStartedAt).toBe('2031-01-01T12:00:00.000Z');
    // Les séances suivantes, datées correctement, se placent avant elle : leur évaluation ne dépend pas de la séance
    // future, et les semaines se comptent en séances, jamais en dates.
    const later = squat(70000);
    const next = replay([...normal, future, session('s6', at(10), 'A', [later])]);
    const nextWithout = replay([...normal, session('s6', at(10), 'A', [later])]);
    expect(decisionOf(next, later)).toEqual(decisionOf(nextWithout, later));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Résultat
// ---------------------------------------------------------------------------------------------------------------

describe('résultat du rejeu', () => {
  it('programme effectif = snapshot + changements acceptés + suspensions détectées', () => {
    const changes = [
      accepted('c1', at(1), [{ op: 'set_rest', slot: 'A3', seconds: 90 }]),
      accepted('c2', at(30), [{ op: 'set_days_per_week', days: 2 }]),
    ];
    const r = replay(
      [
        session('s1', at(0), 'A', [squat(60000, { painLevel: 'pain', nextAdjustment: 'lighten' })]),
        session('s2', at(2), 'A', [squat(55000, { painLevel: 'pain', nextAdjustment: 'lighten' })]),
      ],
      changes,
    );
    const suspension: AcceptedChange = {
      id: 'x',
      author: 'engine',
      reasonCode: 'PAIN_SUSPEND',
      decidedAt: at(2, 1),
      operations: [{ op: 'suspend_slot', slot: 'A1' }],
    };
    expect(r.program).toEqual(effectiveProgram(GYM_AB, 3, [...changes, suspension]));
  });

  it('états triés par identifiant, sans la mémoire interne du moteur', () => {
    const r = replay([session('s1', at(0), 'A', [row(), squat(60000)])]);
    expect(r.slotStates.map((s) => s.id)).toEqual([
      `${INSTANCE}:A1:back-squat`,
      `${INSTANCE}:A3:barbell-row`,
    ]);
    for (const s of r.slotStates) expect(Object.hasOwn(s, 'best')).toBe(false);
  });

  it('ne modifie pas ses entrées', () => {
    const sessions = [session('s1', at(0), 'A', [squat(60000)]), session('s2', at(2), 'A', [squat(60000)])];
    const changes = [accepted('c1', at(3), [{ op: 'lighten_exercise', slot: 'A1' }])];
    const before = structuredClone({ sessions, changes });
    replay(sessions, changes);
    expect({ sessions, changes }).toEqual(before);
  });
});
