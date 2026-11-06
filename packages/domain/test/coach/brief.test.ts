/*
 * Dossier `coach-brief/2` (spec brique 4 §9, §15) : ce que le coach sait de la personne. Canaris de vie privée,
 * accords C2, mineurs, dates relatives, clés triées, troncature, textes libres, membre sans rien.
 */
import { CoachBriefSchema, REASON_TEXTS } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  type BriefSession,
  briefDecisions,
  briefHistory,
  briefProgram,
  briefRecords,
  buildCoachBrief,
  type CoachBriefInput,
  cleanFreeText,
  estimateTokens,
  extendSlotAliases,
  namedPlaces,
  resolveSlotAlias,
  sortedJson,
} from '../../src/coach/brief';
import { addedSlotId, effectiveProgram } from '../../src/program/effective';
import { parisDaysUntil } from '../../src/program/program-state';
import type { AcceptedChange } from '../../src/program/types';
import {
  ADDED_CHANGE_ID,
  ADDED_SLOT_ID,
  addSlotChange,
  BRIEF_CATALOG,
  briefInput,
  briefSession,
  type DoneSpec,
  daysBefore,
  HOME_ID,
  inputIds,
  PRIMARY_ID,
  realSizeInput,
  TODAY,
  UUID_ANYWHERE,
} from '../fixtures/coach-brief';
import { GYM_AB, gymAb } from '../fixtures/program';

const build = (edit?: (input: CoachBriefInput) => void) => buildCoachBrief(briefInput(edit));

type Brief = ReturnType<typeof buildCoachBrief>['brief'];

const fail = (what: string): never => {
  throw new Error(`${what} absent`);
};

const slotOf = (brief: Brief, id: string) =>
  brief.program?.workouts.flatMap((w) => w.slots).find((s) => s.id === id) ?? fail(`slot ${id}`);

const stateOf = (input: CoachBriefInput, slotId: string, exerciseId: string) =>
  input.program?.replay.slotStates.find((st) => st.slotId === slotId && st.exerciseId === exerciseId) ??
  fail(`état ${slotId}`);

/** Le JSON sans le contenu de ses chaînes : ce qui reste, ce sont la ponctuation, les nombres et les littéraux. */
const outsideStrings = (json: string) => json.replace(/"(?:[^"\\]|\\.)*"/g, '""');

describe('canaris', () => {
  it('ni nom de lieu ni identifiant de base dans le JSON envoyé', () => {
    const input = briefInput();
    expect(input.places.map((p) => p.name)).toEqual(['Salle Canari', 'Maison Canari']);
    const ids = inputIds(input);
    expect(ids).toEqual(
      expect.arrayContaining([
        'instance-canari',
        'place-canari-1',
        'place-canari-supprime',
        'session-canari-3',
        ADDED_CHANGE_ID,
        ADDED_SLOT_ID,
      ]),
    );
    expect(ids.some((id) => id.includes('session-canari-1'))).toBe(true);
    expect(ids.length).toBeGreaterThan(20);

    const { json } = buildCoachBrief(input);
    expect(json).not.toContain('Canari');
    expect(json).not.toMatch(/canari/i);
    expect(json).not.toMatch(UUID_ANYWHERE);
    for (const id of ids) expect(json, id).not.toContain(id);
  });
});

describe("alias des slots ajoutés (identifiant d'un changement)", () => {
  it('slot A-<uuidv7> : A-x1 dans le JSON, slotAliases le retraduit', () => {
    const { brief, json, slotAliases } = build();
    expect(ADDED_SLOT_ID).toBe(`A-${ADDED_CHANGE_ID}`);
    expect(json).not.toContain(ADDED_CHANGE_ID);
    expect(brief.program?.workouts[0]?.slots.map((s) => s.id)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A-x1',
    ]);
    expect(slotOf(brief, 'A-x1')).toMatchObject({
      exercise: { id: 'calf-raise', name: 'Mollets debout' },
      last_decision: { days_ago: 7 },
    });
    expect(slotAliases.get('A-x1')).toBe(ADDED_SLOT_ID);
    expect([...slotAliases]).toEqual([['A-x1', ADDED_SLOT_ID]]);
  });

  it("proposition en attente sur ce slot : la référence est l'alias", () => {
    const { brief } = build();
    expect(brief.program?.pending_proposals[1]).toEqual({
      author: 'coach',
      operations: [{ op: 'set_rest', slot: 'A-x1', seconds: 45 }],
      days_left: 6,
    });
  });

  it("alias par séance, dans l'ordre du programme effectif ; référence d'un slot disparu aliasée aussi", () => {
    const later = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7c';
    const inB = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7d';
    const gone = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7e';
    const { brief, json, slotAliases } = build((i) => {
      if (i.program === null) return;
      i.program.program = effectiveProgram(GYM_AB, 3, [
        addSlotChange(later, daysBefore(14)),
        addSlotChange(ADDED_CHANGE_ID, daysBefore(15)),
        addSlotChange(inB, daysBefore(13), 'B'),
      ]);
      i.program.pending.push({
        author: 'user',
        operations: [{ op: 'remove_slot', slot: addedSlotId('A', gone) }],
        expiresAt: daysBefore(-1),
      });
    });
    expect(brief.program?.workouts.map((w) => w.slots.map((s) => s.id).slice(-2))).toEqual([
      ['A-x1', 'A-x2'],
      ['B4', 'B-x1'],
    ]);
    expect(Object.fromEntries(slotAliases)).toEqual({
      'A-x1': ADDED_SLOT_ID,
      'A-x2': addedSlotId('A', later),
      'B-x1': addedSlotId('B', inB),
      'A-x3': addedSlotId('A', gone),
    });
    expect(brief.program?.pending_proposals[2]?.operations).toEqual([{ op: 'remove_slot', slot: 'A-x3' }]);
    expect(json).not.toMatch(UUID_ANYWHERE);
  });

  it("un alias ne prend jamais l'identifiant d'un slot du modèle", () => {
    const { brief, slotAliases } = build((i) => {
      if (i.program === null) return;
      const template = gymAb((t) => {
        const a5 = t.workouts[0]?.slots[4];
        if (a5) a5.id = 'A-x1';
      });
      i.program.program = effectiveProgram(template, 3, [addSlotChange(ADDED_CHANGE_ID, daysBefore(15))]);
    });
    expect(brief.program?.workouts[0]?.slots.map((s) => s.id).slice(-2)).toEqual(['A-x1', 'A-x2']);
    expect(slotAliases.get('A-x2')).toBe(ADDED_SLOT_ID);
    expect(slotAliases.has('A-x1')).toBe(false);
  });

  it('deux appels : mêmes alias', () => {
    const first = build();
    const second = build();
    expect([...second.slotAliases]).toEqual([...first.slotAliases]);
    expect(second.json).toBe(first.json);
  });

  it("resolveSlotAlias : l'identifiant réel d'un alias, toute autre référence telle quelle", () => {
    const { slotAliases } = build();
    expect(resolveSlotAlias('A-x1', slotAliases)).toBe(ADDED_SLOT_ID);
    expect(resolveSlotAlias('A1', slotAliases)).toBe('A1');
    expect(resolveSlotAlias('A-x9', slotAliases)).toBe('A-x9');
  });

  it('sans programme : aucun alias', () => {
    expect(build((i) => (i.program = null)).slotAliases.size).toBe(0);
  });
});

describe('extendSlotAliases : table figée du fil étendue (read_training, propose_program_change)', () => {
  const later = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7c';
  const gone = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7e';
  /** Programme `GYM_AB` avec le slot ajouté du dossier, puis un second, ajouté après le gel. */
  const program = () =>
    effectiveProgram(GYM_AB, 3, [
      addSlotChange(ADDED_CHANGE_ID, daysBefore(15)),
      addSlotChange(later, daysBefore(1)),
    ]);

  it('sans table figée : la table de buildCoachBrief', () => {
    const input = briefInput();
    expect([...extendSlotAliases(input.program?.program ?? fail('programme'), new Map())]).toEqual([
      ...buildCoachBrief(input).slotAliases,
    ]);
  });

  it("la table figée est conservée ; un slot ajouté après le gel reçoit l'alias suivant de sa séance", () => {
    const frozen = new Map([['A-x4', ADDED_SLOT_ID]]);
    expect([...extendSlotAliases(program(), frozen)]).toEqual([
      ['A-x4', ADDED_SLOT_ID],
      ['A-x5', addedSlotId('A', later)],
    ]);
  });

  it('deux appels : même table, dans le même ordre', () => {
    const frozen = new Map([['A-x4', ADDED_SLOT_ID]]);
    expect([...extendSlotAliases(program(), frozen)]).toEqual([...extendSlotAliases(program(), frozen)]);
  });

  it("alias figé d'un slot disparu : gardé, jamais donné à un autre slot", () => {
    const frozen = new Map([
      ['A-x1', addedSlotId('A', gone)],
      ['A-x2', ADDED_SLOT_ID],
    ]);
    const extended = extendSlotAliases(program(), frozen);
    expect(Object.fromEntries(extended)).toEqual({
      'A-x1': addedSlotId('A', gone),
      'A-x2': ADDED_SLOT_ID,
      'A-x3': addedSlotId('A', later),
    });
  });

  it('les alias de briefProgram sont ceux de la table étendue (ce que propose_program_change retraduit)', () => {
    const input = briefInput((i) => {
      if (i.program !== null) i.program.program = program();
    });
    const frozen = new Map([['A-x4', ADDED_SLOT_ID]]);
    const extended = extendSlotAliases(input.program?.program ?? fail('programme'), frozen);
    const sent = briefProgram(input, frozen)?.workouts.flatMap((w) => w.slots.map((s) => s.id)) ?? [];
    const real = input.program?.program.template.workouts.flatMap((w) => w.slots.map((s) => s.id)) ?? [];
    expect(sent.map((ref) => resolveSlotAlias(ref, extended))).toEqual(real);
  });
});

describe('briefProgram amorcé par la table figée du fil (read_training)', () => {
  const later = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7c';
  const inB = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7d';
  const gone = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7e';

  it('table du dossier, rien de changé : le programme du dossier, alias compris', () => {
    const input = briefInput();
    const built = buildCoachBrief(input);
    expect(briefProgram(input, built.slotAliases)).toEqual(built.brief.program);
    expect(briefProgram(input)).toEqual(built.brief.program);
  });

  it('un slot de la table figée garde son alias, dans les slots et les propositions en attente', () => {
    const program = briefProgram(briefInput(), new Map([['A-x4', ADDED_SLOT_ID]]));
    expect(program?.workouts[0]?.slots.map((s) => s.id).at(-1)).toBe('A-x4');
    expect(program?.pending_proposals[1]?.operations).toEqual([
      { op: 'set_rest', slot: 'A-x4', seconds: 45 },
    ]);
  });

  it('slot ajouté après le gel : alias au-delà du plus grand de sa séance, slot disparu compris', () => {
    const input = briefInput((i) => {
      if (i.program === null) return;
      i.program.program = effectiveProgram(GYM_AB, 3, [
        addSlotChange(ADDED_CHANGE_ID, daysBefore(15)),
        addSlotChange(later, daysBefore(1)),
        addSlotChange(inB, daysBefore(1), 'B'),
      ]);
    });
    // `gone` (A-x5) n'est plus au programme : son alias n'est pas repris pour un autre slot.
    const frozen = new Map([
      ['A-x2', ADDED_SLOT_ID],
      ['A-x5', addedSlotId('A', gone)],
    ]);
    const program = briefProgram(input, frozen);
    expect(program?.workouts.map((w) => w.slots.map((s) => s.id).slice(-2))).toEqual([
      ['A-x2', 'A-x6'],
      ['B4', 'B-x1'],
    ]);
    expect(JSON.stringify(program)).not.toMatch(UUID_ANYWHERE);
  });

  it("un alias figé devenu l'identifiant d'un slot du modèle n'est pas repris", () => {
    const input = briefInput((i) => {
      if (i.program === null) return;
      const template = gymAb((t) => {
        const a5 = t.workouts[0]?.slots[4];
        if (a5) a5.id = 'A-x3';
      });
      i.program.program = effectiveProgram(template, 3, [addSlotChange(ADDED_CHANGE_ID, daysBefore(15))]);
    });
    const ids = briefProgram(input, new Map([['A-x3', ADDED_SLOT_ID]]))?.workouts[0]?.slots.map((s) => s.id);
    expect(ids?.slice(-2)).toEqual(['A-x3', 'A-x4']);
  });
});

describe('briefDecisions (read_training)', () => {
  const decision = (
    days_ago: number,
    slot: string,
    exercise_id: string,
    result: string,
    reason_code: string,
  ) => ({
    days_ago,
    slot,
    exercise_id,
    result,
    reason_code,
  });

  it("décisions de la période, la plus récente d'abord, slot ajouté sous son alias", () => {
    expect(briefDecisions(briefInput(), { days: 7 })).toEqual([
      decision(3, 'B2', 'overhead-press', 'CALIBRATION', 'CALIBRATION_DONE'),
      decision(3, 'B3', 'lat-pulldown', 'CALIBRATION', 'CALIBRATION_DONE'),
      decision(7, 'A1', 'back-squat', 'PROGRESS', 'LOAD_UP'),
      decision(7, 'A2', 'bench-press', 'ADJUSTED_HOLD', 'PAIN_HOLD'),
      decision(7, 'A5', 'front-plank', 'CALIBRATION', 'CALIBRATION_DONE'),
      decision(7, 'A-x1', 'calf-raise', 'CALIBRATION', 'CALIBRATION_DONE'),
    ]);
    expect(briefDecisions(briefInput(), { days: 28 })).toHaveLength(10);
  });

  it('un exercice : ses décisions seulement ; table figée : son alias', () => {
    expect(briefDecisions(briefInput(), { days: 28, exerciseId: 'back-squat' })).toEqual([
      decision(7, 'A1', 'back-squat', 'PROGRESS', 'LOAD_UP'),
      decision(12, 'A1', 'back-squat', 'CALIBRATION', 'CALIBRATION_DONE'),
    ]);
    const frozen = new Map([['A-x4', ADDED_SLOT_ID]]);
    expect(briefDecisions(briefInput(), { days: 28, exerciseId: 'calf-raise' }, frozen)).toEqual([
      decision(7, 'A-x4', 'calf-raise', 'CALIBRATION', 'CALIBRATION_DONE'),
    ]);
  });

  it("sans l'accord santé ou l'accord coach : code de douleur réécrit (C2)", () => {
    for (const consents of [
      { health: false, coach: true },
      { health: true, coach: false },
    ]) {
      const input = briefInput((i) => (i.consents = consents));
      expect(briefDecisions(input, { days: 28, exerciseId: 'bench-press' })[0]).toMatchObject({
        result: 'ADJUSTED_HOLD',
        reason_code: 'USER_HOLD',
      });
    }
  });

  it('sans programme : aucune', () => {
    expect(
      briefDecisions(
        briefInput((i) => (i.program = null)),
        { days: 28 },
      ),
    ).toEqual([]);
  });

  describe('slot ajouté, travaillé une fois, puis retiré (vie privée)', () => {
    const removed: AcceptedChange = {
      id: '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7f',
      author: 'user',
      reasonCode: 'USER_CHANGE',
      decidedAt: daysBefore(2),
      operations: [{ op: 'remove_slot', slot: ADDED_SLOT_ID }],
    };
    /** Le rejeu garde la décision du slot retiré ; `keepPending` : la proposition du coach sur ce slot reste. */
    const input = (keepPending: boolean) =>
      briefInput((i) => {
        if (i.program === null) return;
        i.program.program = effectiveProgram(GYM_AB, 3, [
          addSlotChange(ADDED_CHANGE_ID, daysBefore(15)),
          removed,
        ]);
        if (!keepPending) i.program.pending = i.program.pending.filter((c) => c.author !== 'coach');
      });

    it("sa décision porte un alias, jamais l'UUID, avec ou sans table figée", () => {
      const i = input(false);
      const slots = i.program?.program.template.workouts.flatMap((w) => w.slots.map((s) => s.id));
      expect(slots).not.toContain(ADDED_SLOT_ID);
      expect(i.program?.replay.decisions.map((d) => d.slotId)).toContain(ADDED_SLOT_ID);

      const decisions = briefDecisions(i, { days: 28 });
      expect(decisions.find((d) => d.exercise_id === 'calf-raise')?.slot).toBe('R-x1');
      expect(JSON.stringify(decisions)).not.toMatch(UUID_ANYWHERE);
      // Figé avec le fil (le slot existait à son ouverture) : son alias figé.
      const frozen = new Map([['A-x2', ADDED_SLOT_ID]]);
      expect(briefDecisions(i, { days: 28 }, frozen).find((d) => d.exercise_id === 'calf-raise')?.slot).toBe(
        'A-x2',
      );
    });

    it('espace distinct R-x : un slot ajouté ensuite prend A-x1, la décision garde R-x1, extendSlotAliases ignore R-x', () => {
      const i = input(false);
      const slotOf = (x: typeof i) =>
        briefDecisions(x, { days: 28 }).find((d) => d.exercise_id === 'calf-raise')?.slot;
      expect(slotOf(i)).toBe('R-x1');
      const later = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a80';
      const grown = briefInput((x) => {
        if (x.program === null || i.program === null) return;
        x.program.program = effectiveProgram(GYM_AB, 3, [
          addSlotChange(ADDED_CHANGE_ID, daysBefore(15)),
          removed,
          addSlotChange(later, daysBefore(1)),
        ]);
        x.program.pending = i.program.pending;
      });
      expect(slotOf(grown)).toBe('R-x1');
      const program = grown.program?.program ?? fail('programme');
      const table = extendSlotAliases(program, new Map());
      expect([...table]).toEqual([['A-x1', `A-${later}`]]);
      expect(resolveSlotAlias('R-x1', table)).toBe('R-x1');
    });

    it('référence en attente et décision du même slot retiré : le même alias', () => {
      const i = input(true);
      const pending = briefProgram(i)?.pending_proposals.find((c) => c.author === 'coach')?.operations[0];
      const decision = briefDecisions(i, { days: 28 }).find((d) => d.exercise_id === 'calf-raise');
      expect(pending).toMatchObject({ slot: 'A-x1' });
      expect(decision?.slot).toBe('A-x1');
    });
  });
});

describe('lieux', () => {
  it("namedPlaces : le principal lieu_1, les autres ensuite dans l'ordre reçu", () => {
    const input = briefInput((i) => {
      i.places.reverse();
      i.places.push({
        ...(i.places[0] as CoachBriefInput['places'][number]),
        id: 'place-canari-3',
        primary: false,
      });
    });
    expect(namedPlaces(input).map(({ place, name }) => [place.id, name])).toEqual([
      [PRIMARY_ID, 'lieu_1'],
      [HOME_ID, 'lieu_2'],
      ['place-canari-3', 'lieu_3'],
    ]);
  });

  it('lieu_1 au principal même reçu en second, réglages de charge en kg pour lui seul, matériel trié', () => {
    const { brief } = build((i) => i.places.reverse());
    expect(brief.places.map((p) => [p.name, p.kind, p.primary])).toEqual([
      ['lieu_1', 'gym', true],
      ['lieu_2', 'home', false],
    ]);
    expect(brief.places[0]?.load_settings).toEqual({
      bar_kg: 20,
      smallest_plate_kg: 1.25,
      machine_step_kg: 5,
    });
    expect(brief.places[1]).not.toHaveProperty('load_settings');
    expect(brief.places[1]?.equipment).toEqual(['chair', 'table']);
  });

  it("lieu inconnu : séance sans lieu et séance d'un lieu supprimé → place null, le schéma passe", () => {
    const { brief } = build();
    const placeAt = new Map(brief.history.sessions.map((s) => [s.days_ago, s.place]));
    expect(placeAt.get(7)).toBeNull(); // lieu supprimé
    expect(placeAt.get(1)).toBeNull(); // séance libre sans lieu
    expect(placeAt.get(3)).toBe('lieu_1');
    expect(placeAt.get(10)).toBe('lieu_2');
    expect(CoachBriefSchema.safeParse(brief).success).toBe(true);
  });
});

describe('profil', () => {
  it('niveau, objectif, jours, durée, prudence et profil du moteur', () => {
    expect(build().brief.profile).toEqual({
      level: 'intermediate',
      goal: 'muscle',
      days_per_week: 3,
      session_minutes: 60,
      cautious_mode: false,
      engine_profile: 'adult',
      context: { kind: 'gym', sport_code: null },
    });
  });

  it.each([
    ['sport_support', 'football', 'gym', { kind: 'sport', sport_code: 'football' }],
    ['sport_support', null, 'home', { kind: 'home', sport_code: null }],
    ['sport_support', '  ', 'gym', { kind: 'gym', sport_code: null }],
    ['muscle', 'football', 'home', { kind: 'home', sport_code: null }],
  ] as const)(
    'contexte : objectif %s, sport %s, lieu principal %s → %o',
    (goal, sportCode, kind, context) => {
      const { brief } = build((i) => {
        i.profile.goal = goal;
        i.profile.sportCode = sportCode;
        for (const p of i.places) p.primary = p.kind === kind;
      });
      expect(brief.profile.context).toEqual(context);
    },
  );

  it('profil incomplet ou hors des valeurs du contrat : null', () => {
    const { brief } = build((i) => {
      i.profile.experience = null;
      i.profile.goal = null;
      i.profile.daysPerWeek = 5;
      i.profile.sessionMinutes = null;
    });
    expect(brief.profile).toMatchObject({
      level: null,
      goal: null,
      days_per_week: null,
      session_minutes: null,
    });
  });
});

describe('programme', () => {
  it('modèle, révision, semaine, séance suivante, jours en vigueur, propositions et modèles disponibles', () => {
    const input = briefInput();
    const { brief } = buildCoachBrief(input);
    const replay = input.program?.replay ?? fail('rejeu');
    expect(brief.program).toMatchObject({
      template: { id: 'gym-beginner-full-body-ab', name: 'Salle · Débutant · Corps entier A/B', version: 1 },
      revision: 4,
      week: replay.state.weekIndex + 1,
      block_week: null,
      next_workout_id: replay.state.nextWorkoutId,
      days_per_week: 3,
      pending_proposals: [
        { author: 'engine', operations: [{ op: 'start_deload' }], days_left: 5 },
        { author: 'coach', operations: [{ op: 'set_rest', slot: 'A-x1', seconds: 45 }], days_left: 6 },
      ],
      templates: [
        {
          id: 'gym-beginner-full-body-ab',
          name: 'Salle · Débutant · Corps entier A/B',
          summary: 'Deux séances qui alternent, 2 ou 3 fois par semaine.',
          context: 'gym',
          level: 'beginner',
          days_min: 2,
          days_max: 3,
        },
      ],
    });
    expect(brief.program?.workouts.map((w) => [w.id, w.name, w.slots.length])).toEqual([
      ['A', 'Séance A', 6],
      ['B', 'Séance B', 4],
    ]);
  });

  it('slot : exercice au lieu principal, cibles du modèle, état du moteur en kg, dernière décision', () => {
    const input = briefInput();
    const { brief } = buildCoachBrief(input);
    const state = stateOf(input, 'A1', 'back-squat');
    expect(state).toMatchObject({ variantRank: null, durationS: null, calibrationLeft: 0, suspended: false });
    expect(state.loadG).not.toBeNull();
    expect(slotOf(brief, 'A1')).toEqual({
      id: 'A1',
      role: 'main',
      movement_pattern: 'squat',
      exercise: { id: 'back-squat', name: 'Squat barre' },
      sets: 3,
      reps: { min: 6, max: 6 },
      target_rir: 2,
      rest_s: 150,
      engine: { mode: state.mode, load_kg: (state.loadG ?? 0) / 1000, target_reps: state.targetReps },
      last_decision: { days_ago: 7, result: 'PROGRESS', reason_code: 'LOAD_UP' },
    });
  });

  it("slots compacts : ni null ni valeur par défaut ; un état suspendu ou en calibration l'écrit", () => {
    const { brief } = build();
    const workouts = sortedJson(brief.program?.workouts);
    expect(workouts).not.toContain('null');
    expect(workouts).not.toContain('"suspended":false');
    expect(workouts).not.toContain('"calibration_left":0');
    const edited = build((i) => {
      if (i.program === null) return;
      i.program.replay.slotStates = i.program.replay.slotStates.map((st) =>
        st.slotId === 'A1' ? { ...st, suspended: true, calibrationLeft: 2 } : st,
      );
    });
    expect(slotOf(edited.brief, 'A1').engine).toMatchObject({ suspended: true, calibration_left: 2 });
  });

  it('dernière décision : le code seul, sans sa phrase (la table est dans le prompt)', () => {
    const { json } = build();
    expect(json).not.toContain('reason_text');
    expect(json).not.toContain(REASON_TEXTS.LOAD_UP);
  });

  it('slot en durée : fourchette de durée, pas de répétitions', () => {
    const a5 = slotOf(build().brief, 'A5');
    expect(a5).toMatchObject({
      exercise: { id: 'front-plank', name: 'Gainage' },
      duration_s: { min: 20, max: 60 },
      rest_s: 60,
    });
    expect(a5).not.toHaveProperty('reps');
    expect(a5.engine).not.toHaveProperty('target_reps');
    expect(a5.engine).not.toHaveProperty('load_kg');
  });

  it("slot jamais fait : ni état ni décision ; à la maison, l'exercice faisable là", () => {
    const { brief } = build((i) => {
      for (const p of i.places) p.primary = p.kind === 'home';
    });
    expect(slotOf(brief, 'A3')).not.toHaveProperty('engine');
    expect(slotOf(brief, 'A3')).not.toHaveProperty('last_decision');
    expect(slotOf(brief, 'A1').exercise).toEqual({ id: 'bodyweight-squat', name: 'Squat au poids du corps' });
  });

  it.each([
    ['home', 'muscle', ['home-beginner-full-body']],
    ['gym', 'muscle', ['gym-beginner-full-body-ab']],
    ['gym', 'sport_support', ['sport-beginner-complement']],
  ] as const)('modèles compatibles : lieu principal %s, objectif %s → %o', (kind, goal, ids) => {
    const { brief } = build((i) => {
      for (const p of i.places) p.primary = p.kind === kind;
      i.profile.goal = goal;
      i.profile.sportCode = 'football';
      i.program?.templates.push(
        {
          template: { ...structuredClone(GYM_AB), id: 'home-beginner-full-body', context: 'home' },
          available: true,
        },
        {
          template: { ...structuredClone(GYM_AB), id: 'sport-beginner-complement', context: 'sport' },
          available: true,
        },
      );
    });
    expect(brief.program?.templates.map((t) => t.id)).toEqual(ids);
  });

  it("sans lieu principal : l'exercice prévu par le programme", () => {
    const { brief } = build((i) => {
      i.places = [];
    });
    expect(slotOf(brief, 'A1').exercise).toEqual({ id: 'back-squat', name: 'Squat barre' });
  });

  it("décision dont la séance n'est pas connue : pas de last_decision", () => {
    const { brief } = build((i) => {
      if (i.program) i.program.decisionEndedAt = new Map();
    });
    expect(slotOf(brief, 'A1')).not.toHaveProperty('last_decision');
  });
});

describe('historique', () => {
  it('séances terminées des 28 derniers jours, la plus récente en premier, séries de travail faites en tuples', () => {
    const { brief } = build((i) => {
      i.sessions.push(briefSession({ daysAgo: 29, exercises: [{ exerciseId: 'push-up', values: [10] }] }));
      i.sessions.push(briefSession({ daysAgo: 28, exercises: [{ exerciseId: 'push-up', values: [10] }] }));
    });
    expect(brief.history.sessions.map((s) => s.days_ago)).toEqual([1, 3, 7, 10, 12, 28]);
    const [libre, , withPain] = brief.history.sessions;
    expect(libre).toMatchObject({ name: 'Séance libre', place: null });
    expect(withPain?.exercises[0]).toEqual({
      id: 'back-squat',
      name: 'Squat barre',
      sets: [
        [42.5, 6, null, null],
        [42.5, 6, null, null],
        [42.5, 6, null, 'hard'],
      ],
    });
    expect(withPain?.exercises[2]?.sets).toEqual([
      [null, null, 30, null],
      [null, null, 30, null],
      [null, null, 25, 'ok'],
    ]);
  });

  it('charges en kg, 2 décimales au plus', () => {
    const { brief } = build((i) => {
      i.sessions = [
        briefSession({
          exercises: [{ exerciseId: 'bench-press', loadG: 41_257, values: [5], loadMode: 'barbell' }],
        }),
      ];
    });
    expect(brief.history.sessions[0]?.exercises[0]?.sets).toEqual([[41.26, 5, null, 'ok']]);
  });
});

describe('dates relatives', () => {
  it('séance finie la veille à 23 h 30 de Paris : days_ago 1 ; le jour même à 0 h 30 : 0', () => {
    const { brief } = build((i) => {
      i.sessions = [
        briefSession({ endedAt: Date.UTC(2026, 10, 2, 22, 30) }),
        briefSession({ endedAt: Date.UTC(2026, 10, 2, 23, 30) }),
      ];
    });
    expect(brief.history.sessions.map((s) => s.days_ago)).toEqual([0, 1]);
  });

  it('aucune date absolue hors today', () => {
    const { json } = build();
    expect(json.match(/\d{4}-\d{2}-\d{2}/g)).toEqual([TODAY]);
    expect(json).not.toMatch(/T\d{2}:\d{2}/);
    expect(json).not.toMatch(/\d{10,}/);
  });
});

describe('accords C2 (santé et coach)', () => {
  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])('santé %s, coach %s : ni health, ni pain, ni code de douleur', (health, coach) => {
    const { brief, json } = build((i) => {
      i.consents = { health, coach };
    });
    expect(brief).not.toHaveProperty('health');
    expect(json).not.toContain('"health"');
    expect(json).not.toContain('"pain"');
    expect(json).not.toContain('PAIN_');
    expect(json).not.toContain(REASON_TEXTS.PAIN_HOLD);
    expect(json).not.toContain('Gêne au développé');
    expect(slotOf(brief, 'A2').last_decision?.reason_code).toBe('USER_HOLD');
  });

  it('les deux accords : limitations, douleur par exercice et code de douleur', () => {
    const { brief } = build();
    expect(brief.health).toEqual({
      limitations: [{ area: 'shoulder', side: 'right', severity: 'mild', note: 'Gêne au développé.' }],
    });
    const bench = brief.history.sessions.find((s) => s.days_ago === 7)?.exercises[1];
    expect(bench).toMatchObject({ id: 'bench-press', pain: 'discomfort' });
    const squat = brief.history.sessions.find((s) => s.days_ago === 7)?.exercises[0];
    expect(squat).not.toHaveProperty('pain');
    expect(slotOf(brief, 'A2').last_decision).toMatchObject({ reason_code: 'PAIN_HOLD' });
  });

  it.each([
    [false, true],
    [true, false],
  ])("briefHistory avec pain demandé, santé %s, coach %s : la douleur n'est pas rendue", (health, coach) => {
    const input = briefInput((i) => {
      i.consents = { health, coach };
    });
    const sessions = briefHistory(input, { days: 28, pain: true });
    expect(sessions.flatMap((s) => s.exercises).some((e) => 'pain' in e)).toBe(false);
    expect(briefHistory(briefInput(), { days: 28, pain: true }).flatMap((s) => s.exercises)).toContainEqual(
      expect.objectContaining({ pain: 'discomfort' }),
    );
  });
});

describe('public et tranche', () => {
  it.each([
    ['adult', '16-17'],
    ['minor', '18-29'],
    ['minor', '60+'],
  ] as const)('audience %s et tranche %s : RangeError', (audience, ageBand) => {
    expect(() =>
      build((i) => {
        i.audience = audience;
        i.ageBand = ageBand;
      }),
    ).toThrow(RangeError);
  });

  it.each([
    ['adult', '16-17'],
    ['minor', '18-29'],
  ] as const)(
    'briefHistory et briefRecords (read_training) aussi : %s et %s → RangeError',
    (audience, ageBand) => {
      const input = briefInput((i) => {
        i.audience = audience;
        i.ageBand = ageBand;
      });
      expect(() => briefHistory(input, { days: 28, pain: true })).toThrow(RangeError);
      expect(() => briefRecords(input, input.sessions)).toThrow(RangeError);
    },
  );
});

describe('records et mineurs', () => {
  it('adulte : meilleure série, plus de répétitions, plus longue durée, e1rm_kg', () => {
    const { brief } = build();
    const byId = new Map(brief.records.map((r) => [r.exercise_id, r]));
    expect(byId.get('back-squat')).toEqual({
      exercise_id: 'back-squat',
      name: 'Squat barre',
      best_set: { load_kg: 42.5, reps: 6 },
      most_reps: null,
      longest_s: null,
      e1rm_kg: expect.any(Number),
    });
    expect(byId.get('push-up')).toEqual({
      exercise_id: 'push-up',
      name: 'Pompes',
      best_set: null,
      most_reps: 15,
      longest_s: null,
    });
    expect(byId.get('front-plank')).toMatchObject({ best_set: null, longest_s: 30 });
  });

  it("exercices du programme (slots résolus) en tête, puis ceux de l'historique du plus récent au plus ancien", () => {
    expect(build().brief.records.map((r) => r.exercise_id)).toEqual([
      'back-squat',
      'bench-press',
      'front-plank',
      'calf-raise',
      'overhead-press',
      'lat-pulldown',
      'push-up',
      'single-leg-romanian-deadlift',
      'split-squat',
    ]);
  });

  it('mineur : aucun e1rm_kg', () => {
    const { brief, json } = build((i) => {
      i.audience = 'minor';
      i.ageBand = '16-17';
    });
    expect(brief).toMatchObject({ audience: 'minor', age_band: '16-17' });
    expect(brief.records.length).toBeGreaterThan(0);
    expect(json).not.toContain('e1rm_kg');
  });
});

describe('textes libres', () => {
  it('cleanFreeText : nettoyage de cleanCoachText, 200 caractères au plus, vide → null', () => {
    expect(cleanFreeText(null)).toBeNull();
    expect(cleanFreeText(' \u0007 ‮ ')).toBeNull();
    expect(cleanFreeText(' a\r\nb‮c\u0007 ')).toBe('a\nbc');
    expect(cleanFreeText('x'.repeat(250))).toBe('x'.repeat(200));
    expect(cleanFreeText(`${'x'.repeat(199)} y`)).toBe('x'.repeat(199));
  });

  it('cleanFreeText ne coupe jamais une paire UTF-16', () => {
    expect(cleanFreeText(`x${'💪'.repeat(150)}`)).toBe(`x${'💪'.repeat(99)}`);
  });

  it('note de 250 caractères avec U+202E : 200 caractères, sans U+202E, sous user_notes', () => {
    const note = `${'a'.repeat(100)}‮${'b'.repeat(149)}`;
    expect(note).toHaveLength(250);
    const { brief } = build((i) => {
      i.sessions = [briefSession({ note })];
    });
    const notes = brief.history.sessions[0]?.user_notes;
    expect(notes).toHaveLength(200);
    expect(notes).not.toContain('‮');
    expect(notes).toBe(`${'a'.repeat(100)}${'b'.repeat(100)}`);
  });

  it("note de séance puis notes d'exercice, chacune nettoyée, jointes sous user_notes, 200 caractères au tout", () => {
    const { brief } = build();
    expect(brief.history.sessions.find((s) => s.days_ago === 7)?.user_notes).toBe(
      'Salle bondée, attente au rack.\nDéveloppé couché : Barre glissante, prise à revoir.',
    );
    expect(brief.history.sessions.find((s) => s.days_ago === 3)).not.toHaveProperty('user_notes');

    const long = build((i) => {
      i.sessions = [
        briefSession({
          note: `  ${'s'.repeat(150)}\u0007 `,
          exercises: [
            { exerciseId: 'push-up', values: [10], note: '   ' },
            { exerciseId: 'bench-press', values: [5], loadG: 40_000, note: 'e'.repeat(250) },
          ],
        }),
      ];
    });
    const notes = long.brief.history.sessions[0]?.user_notes ?? fail('notes');
    expect(notes).toHaveLength(200);
    expect(notes.startsWith(`${'s'.repeat(150)}\nDéveloppé couché : e`)).toBe(true);
  });

  it('note de limitation nettoyée et coupée', () => {
    const { brief } = build((i) => {
      i.limitations = [
        { area: 'knee', side: 'left', severity: 'severe', note: `‮${'k'.repeat(210)}` },
        { area: 'hip', side: 'both', severity: 'mild', note: ' ' },
      ];
    });
    expect(brief.health?.limitations.map((l) => l.note)).toEqual(['k'.repeat(200), null]);
  });
});

describe('sérialisation', () => {
  it('sortedJson : clés en ordre binaire à toute profondeur, sans espace, undefined omis', () => {
    expect(sortedJson({ b: 1, a: [{ d: 2, c: undefined, B: 'x y' }], 10: 0, 9: null })).toBe(
      '{"10":0,"9":null,"a":[{"B":"x y","d":2}],"b":1}',
    );
    expect(sortedJson([undefined, 1])).toBe('[null,1]');
  });

  it('estimateTokens : caractères / 3, arrondi au-dessus', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
  });

  it('dossier : clés triées, aucun espace hors des chaînes, même chaîne à chaque appel', () => {
    const { brief, json, estimatedTokens } = build();
    expect(json).toBe(sortedJson(JSON.parse(json)));
    expect(outsideStrings(json)).not.toMatch(/\s/);
    expect(build().json).toBe(json);
    expect(JSON.parse(json)).toEqual(brief);
    expect(estimatedTokens).toBe(Math.ceil(json.length / 3));
    expect(brief.schema).toBe('coach-brief/2');
    expect(brief.nutrition.mode).toBe('disabled');
  });
});

describe('taille', () => {
  /** Séance chargée : 5 exercices de 3 séries. */
  const heavy = (n: number): BriefSession => {
    const exercises: DoneSpec[] = [
      'back-squat',
      'bench-press',
      'barbell-row',
      'overhead-press',
      'lat-pulldown',
    ].map((exerciseId, k) => ({
      exerciseId,
      loadG: 20_000 + 2500 * k + 250 * n,
      values: [10, 9, 8],
      loadMode: 'barbell',
    }));
    return briefSession({ endedAt: daysBefore(Math.floor((n * 28) / 40), 8 + (n % 2) * 10), exercises });
  };

  const limitations = (n: number, note: string | null) =>
    Array.from({ length: n }, () => ({
      area: 'knee' as const,
      side: 'left' as const,
      severity: 'mild' as const,
      note,
    }));

  it('petite entrée : truncated faux, oversize faux', () => {
    const { brief, estimatedTokens, oversize } = build();
    expect(brief.history.truncated).toBe(false);
    expect(oversize).toBe(false);
    expect(estimatedTokens).toBeLessThanOrEqual(3000);
  });

  it('(a) 40 séances : 4 500 jetons au plus, les plus récentes gardées, truncated vrai', () => {
    const sessions = Array.from({ length: 40 }, (_, n) => heavy(n));
    const full = sessions.map((s) => parisDaysUntil(s.endedAt, TODAY)).sort((a, b) => a - b);
    const { brief, estimatedTokens, oversize } = build((i) => {
      i.sessions = sessions;
    });
    expect(estimatedTokens).toBeLessThanOrEqual(4500);
    expect(oversize).toBe(false);
    expect(brief.history.truncated).toBe(true);
    const kept = brief.history.sessions.map((s) => s.days_ago);
    expect(kept.length).toBeGreaterThan(5);
    expect(kept.length).toBeLessThan(40);
    expect(kept).toEqual(full.slice(0, kept.length));
    expect(brief.records.length).toBe(5);
  });

  it('(a) puis (b) puis (c) : 3 séances gardées, records coupés à 10, notes retirées', () => {
    const many = BRIEF_CATALOG.filter(
      (s) => s.status === 'published' && s.movement_pattern !== 'core_anti_extension',
    );
    expect(many.length).toBeGreaterThan(10);
    const { brief, estimatedTokens, oversize } = build((i) => {
      i.sessions = [
        briefSession({
          daysAgo: 20,
          exercises: many.map((s) => ({
            exerciseId: s.id,
            values: [10],
            loadG: 10_000,
            loadMode: 'barbell',
          })),
        }),
        ...[3, 2, 1].map((daysAgo) => briefSession({ daysAgo, note: 'n'.repeat(200) })),
      ];
      i.limitations = limitations(60, 'l'.repeat(200));
    });
    expect(estimatedTokens).toBeLessThanOrEqual(4500);
    expect(oversize).toBe(false);
    expect(brief.history.truncated).toBe(true);
    expect(brief.history.sessions.map((s) => s.days_ago)).toEqual([1, 2, 3]);
    expect(brief.history.sessions.some((s) => 'user_notes' in s)).toBe(false);
    expect(brief.records).toHaveLength(10);
    expect(brief.health?.limitations.every((l) => l.note === null)).toBe(true);
  });

  it('(d) trois séances trop lourdes, ni records en trop ni notes : la plus récente seule', () => {
    const exercises: DoneSpec[] = Array.from({ length: 40 }, (_, k) => ({
      exerciseId: ['back-squat', 'bench-press', 'barbell-row', 'overhead-press'][k % 4] ?? 'back-squat',
      loadG: 40_000,
      values: [10, 10, 10, 10, 10],
      loadMode: 'barbell',
    }));
    const { brief, estimatedTokens, oversize } = build((i) => {
      i.sessions = [5, 4, 3].map((daysAgo) => briefSession({ daysAgo, exercises }));
      i.limitations = [];
    });
    expect(estimatedTokens).toBeLessThanOrEqual(4500);
    expect(oversize).toBe(false);
    expect(brief.history.truncated).toBe(true);
    expect(brief.history.sessions.map((s) => s.days_ago)).toEqual([3]);
  });

  it('rien à retirer : truncated faux, dossier rendu tel quel, oversize vrai', () => {
    const { brief, estimatedTokens, oversize } = build((i) => {
      i.sessions = [];
      i.limitations = limitations(300, null);
    });
    expect(estimatedTokens).toBeGreaterThan(4500);
    expect(oversize).toBe(true);
    expect(brief.history.truncated).toBe(false);
    expect(brief.health?.limitations).toHaveLength(300);
  });

  it('taille réelle, gym-intermediate-upper-lower et 16 séances : 4 500 jetons au plus, 3 séances au moins', () => {
    const input = realSizeInput();
    const slots = input.program?.program.template.workouts.flatMap((w) => w.slots) ?? [];
    expect(slots).toHaveLength(23);
    const states = new Set(input.program?.replay.slotStates.map((st) => st.slotId));
    const decided = new Set(input.program?.replay.decisions.map((d) => d.slotId));
    expect(slots.every((s) => states.has(s.id) && decided.has(s.id))).toBe(true);
    expect(input.sessions).toHaveLength(16);
    expect(input.program?.templates).toHaveLength(6);

    const { brief, estimatedTokens, oversize } = buildCoachBrief(input);
    expect(estimatedTokens).toBeLessThanOrEqual(4500);
    expect(oversize).toBe(false);
    expect(brief.history.sessions.length).toBeGreaterThanOrEqual(3);
    expect(brief.program?.workouts.flatMap((w) => w.slots).every((s) => s.engine && s.last_decision)).toBe(
      true,
    );
    expect(brief.program?.templates.map((t) => t.context)).toEqual(['gym', 'gym']);
  });

  it('taille réelle, 8 slots par séance et 10 limitations : oversize vrai, une séance au moins, truncated vrai', () => {
    const input = realSizeInput({ slotsPerWorkout: 8, limitations: 10 });
    const slots = input.program?.program.template.workouts.map((w) => w.slots.length);
    expect(slots).toEqual([8, 8, 8, 8]);
    expect(input.program?.replay.decisions.length).toBeGreaterThan(0);
    const { brief, oversize } = buildCoachBrief(input);
    expect(oversize).toBe(true);
    expect(brief.history.truncated).toBe(true);
    expect(brief.history.sessions.length).toBeGreaterThanOrEqual(1);
    expect(brief.program?.workouts.flatMap((w) => w.slots)).toHaveLength(32);
  });
});

describe('membre sans programme, sans lieu, sans séance (Review Focus 4)', () => {
  it('program null, listes vides, contexte salle, le schéma passe', () => {
    const { brief } = build((i) => {
      i.program = null;
      i.places = [];
      i.sessions = [];
      i.limitations = [];
    });
    expect(brief.program).toBeNull();
    expect(brief.places).toEqual([]);
    expect(brief.history).toEqual({ sessions: [], truncated: false });
    expect(brief.records).toEqual([]);
    expect(brief.health).toEqual({ limitations: [] });
    expect(brief.profile.context).toEqual({ kind: 'gym', sport_code: null });
    expect(CoachBriefSchema.safeParse(brief).success).toBe(true);
  });

  it('séance dans un lieu vivant secondaire : lieu_2', () => {
    const { brief } = build((i) => {
      i.sessions = [briefSession({ placeId: HOME_ID }), briefSession({ daysAgo: 1, placeId: PRIMARY_ID })];
    });
    expect(brief.history.sessions.map((s) => s.place)).toEqual(['lieu_2', 'lieu_1']);
  });
});
