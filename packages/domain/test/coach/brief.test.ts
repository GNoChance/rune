/*
 * Dossier `coach-brief/1` (spec brique 4 §9, §15) : ce que le coach sait de la personne. Canaris de vie privée,
 * accords C2, mineurs, dates relatives, clés triées, troncature, textes libres, membre sans rien.
 */
import { CoachBriefSchema, REASON_TEXTS } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  type BriefSession,
  buildCoachBrief,
  type CoachBriefInput,
  cleanFreeText,
  estimateTokens,
  sortedJson,
} from '../../src/coach/brief';
import { parisDaysUntil } from '../../src/program/program-state';
import {
  BRIEF_CATALOG,
  briefInput,
  briefSession,
  type DoneSpec,
  daysBefore,
  HOME_ID,
  inputIds,
  PRIMARY_ID,
  TODAY,
} from '../fixtures/coach-brief';

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
      ]),
    );
    expect(ids.some((id) => id.includes('session-canari-1'))).toBe(true);
    expect(ids.length).toBeGreaterThan(20);

    const { json } = buildCoachBrief(input);
    expect(json).not.toContain('Canari');
    expect(json).not.toMatch(/canari/i);
    for (const id of ids) expect(json, id).not.toContain(id);
  });
});

describe('lieux', () => {
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
      pending_proposals: [{ author: 'engine', operations: [{ op: 'start_deload' }], days_left: 5 }],
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
      ['A', 'Séance A', 5],
      ['B', 'Séance B', 4],
    ]);
  });

  it('slot : exercice au lieu principal, cibles du modèle, état du moteur en kg, dernière décision', () => {
    const input = briefInput();
    const { brief } = buildCoachBrief(input);
    const state = stateOf(input, 'A1', 'back-squat');
    expect(state.loadG).not.toBeNull();
    expect(slotOf(brief, 'A1')).toEqual({
      id: 'A1',
      role: 'main',
      movement_pattern: 'squat',
      exercise: { id: 'back-squat', name: 'Squat barre' },
      sets: 3,
      reps: { min: 6, max: 6 },
      duration_s: null,
      target_rir: 2,
      rest_s: 150,
      engine: {
        mode: state.mode,
        load_kg: (state.loadG ?? 0) / 1000,
        target_reps: state.targetReps,
        variant_rank: state.variantRank,
        duration_s: state.durationS,
        calibration_left: state.calibrationLeft,
        suspended: false,
      },
      last_decision: {
        days_ago: 7,
        result: expect.any(String),
        reason_code: expect.any(String),
        reason_text: expect.any(String),
      },
    });
    const decision = slotOf(brief, 'A1').last_decision ?? fail('décision');
    expect(decision.reason_text).toBe(REASON_TEXTS[decision.reason_code]);
  });

  it('slot en durée : fourchette de durée, pas de répétitions', () => {
    expect(slotOf(build().brief, 'A5')).toMatchObject({
      exercise: { id: 'front-plank', name: 'Gainage' },
      reps: null,
      duration_s: { min: 20, max: 60 },
      rest_s: 60,
    });
  });

  it("slot jamais fait : ni état ni décision ; à la maison, l'exercice faisable là", () => {
    const { brief } = build((i) => {
      for (const p of i.places) p.primary = p.kind === 'home';
    });
    expect(slotOf(brief, 'A3')).toMatchObject({ engine: null, last_decision: null });
    expect(slotOf(brief, 'A1').exercise).toEqual({ id: 'bodyweight-squat', name: 'Squat au poids du corps' });
  });

  it("sans lieu principal : l'exercice prévu par le programme", () => {
    const { brief } = build((i) => {
      i.places = [];
    });
    expect(slotOf(brief, 'A1').exercise).toEqual({ id: 'back-squat', name: 'Squat barre' });
  });

  it("décision dont la séance n'est pas connue : last_decision null", () => {
    const { brief } = build((i) => {
      if (i.program) i.program.decisionEndedAt = new Map();
    });
    expect(slotOf(brief, 'A1').last_decision).toBeNull();
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
    expect(slotOf(brief, 'A2').last_decision).toMatchObject({
      reason_code: 'PAIN_HOLD',
      reason_text: REASON_TEXTS.PAIN_HOLD,
    });
  });
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
    expect(brief.schema).toBe('coach-brief/1');
    expect(brief.nutrition).toBeNull();
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

  it('petite entrée : truncated faux', () => {
    const { brief, estimatedTokens } = build();
    expect(brief.history.truncated).toBe(false);
    expect(estimatedTokens).toBeLessThanOrEqual(3000);
  });

  it('40 séances : 4 500 jetons au plus, les plus récentes gardées, truncated vrai', () => {
    const sessions = Array.from({ length: 40 }, (_, n) => heavy(n));
    const full = sessions.map((s) => parisDaysUntil(s.endedAt, TODAY)).sort((a, b) => a - b);
    const { brief, estimatedTokens } = build((i) => {
      i.sessions = sessions;
    });
    expect(estimatedTokens).toBeLessThanOrEqual(4500);
    expect(brief.history.truncated).toBe(true);
    const kept = brief.history.sessions.map((s) => s.days_ago);
    expect(kept.length).toBeGreaterThan(5);
    expect(kept.length).toBeLessThan(40);
    expect(kept).toEqual(full.slice(0, kept.length));
    expect(brief.records.length).toBe(5);
  });

  it('encore trop gros sans séance : records coupés à 15, puis notes retirées', () => {
    const many = BRIEF_CATALOG.filter(
      (s) => s.status === 'published' && s.movement_pattern !== 'core_anti_extension',
    );
    expect(many.length).toBeGreaterThan(15);
    const { brief, estimatedTokens } = build((i) => {
      i.sessions = [
        briefSession({
          daysAgo: 2,
          note: 'n'.repeat(200),
          exercises: many.map((s) => ({
            exerciseId: s.id,
            values: [10],
            loadG: 10_000,
            loadMode: 'barbell',
          })),
        }),
      ];
      i.limitations = Array.from({ length: 60 }, () => ({
        area: 'knee' as const,
        side: 'left' as const,
        severity: 'mild' as const,
        note: 'l'.repeat(200),
      }));
    });
    expect(estimatedTokens).toBeLessThanOrEqual(4500);
    expect(brief.history).toEqual({ sessions: [], truncated: true });
    expect(brief.records).toHaveLength(15);
    expect(brief.health?.limitations.every((l) => l.note === null)).toBe(true);
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
