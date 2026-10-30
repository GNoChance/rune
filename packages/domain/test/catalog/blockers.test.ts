import {
  CATALOG_MAX_SHEETS,
  type DraftSheet,
  EXERCISE_STATUSES,
  type ExerciseSheet,
  type ExerciseStatus,
  PUBLISH_BLOCKERS,
  type PublishBlocker,
} from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EXERCISE_TRANSITIONS,
  isExerciseTransition,
  type TransitionInput,
  templateExerciseIds,
  transitionBlockers,
} from '../../src/catalog/blockers';
import { linkChain, PUSH_UP_CHAIN, sheet, without } from '../fixtures/catalog';

const MANIFEST: ReadonlySet<string> = new Set(['goblet-squat-start', 'goblet-squat-end']);

/** Entrée où rien ne bloque : fiche complète et valide, cases cochées, feu vert, manifeste complet. */
function input(s: DraftSheet, to: ExerciseStatus, overrides: Partial<TransitionInput> = {}): TransitionInput {
  return {
    sheet: s,
    to,
    comments: [],
    greenLight: true,
    reviewChecked: true,
    minorsConfirmed: true,
    manifestIds: MANIFEST,
    templateRefs: new Set(),
    catalog: [s],
    ...overrides,
  };
}

const blockers = (s: DraftSheet, to: ExerciseStatus, overrides: Partial<TransitionInput> = {}) =>
  transitionBlockers(input(s, to, overrides));

/** La fiche de référence (squat goblet, sensible : genoux) au statut `status`. */
const at = (status: ExerciseStatus, overrides: Partial<ExerciseSheet> = {}) =>
  sheet({ status, ...overrides });

const TOO_LONG_SAFETY: Partial<ExerciseSheet> = { safety: ['x'.repeat(121)] };

/** `n` fiches non retirées (brouillons compris), autres que la fiche de référence. */
const others = (n: number, status: ExerciseStatus = 'draft') =>
  Array.from({ length: n }, (_, i) => ({ id: `other-${i}`, status }));

/** Champs obligatoires de la fiche complète qu'un brouillon peut laisser vides (R-FIC-1). */
const AI_REQUIRED = [
  'aliases',
  'primary_muscles',
  'secondary_muscles',
  'stressed_joints',
  'instructions',
  'key_points',
  'mistakes',
  'safety',
  'breathing',
  'illustrations',
] as const;

describe('transitionBlockers : transitions sans blocage', () => {
  it.each<[ExerciseStatus, ExerciseStatus]>([
    ['draft', 'reviewed'],
    ['reviewed', 'draft'],
    ['reviewed', 'published'],
    ['draft', 'retired'],
    ['reviewed', 'retired'],
    ['published', 'retired'],
    ['retired', 'reviewed'],
    ['draft', 'draft'],
    ['reviewed', 'reviewed'],
    ['published', 'published'],
    ['retired', 'retired'],
  ])('%s → %s : []', (from, to) => {
    expect(blockers(at(from), to)).toEqual([]);
  });

  it('reviewed → draft est toujours permis (renvoi en rédaction), même si tout le reste bloquerait', () => {
    const bad = without(at('reviewed', TOO_LONG_SAFETY), 'instructions');
    const overrides: Partial<TransitionInput> = {
      comments: [{ resolvedAt: null }],
      greenLight: false,
      reviewChecked: false,
      minorsConfirmed: false,
      manifestIds: new Set(),
      templateRefs: new Set(['goblet-squat']),
      catalog: others(CATALOG_MAX_SHEETS),
    };
    expect(blockers(bad, 'draft', overrides)).toEqual([]);
  });

  it("transition absente de 04 §8 (published → draft) : aucun blocage, c'est à l'appelant de la refuser", () => {
    expect(blockers(at('published'), 'draft', { greenLight: false, manifestIds: new Set() })).toEqual([]);
  });
});

describe('transitionBlockers : un test par code (tableau §3.6)', () => {
  describe('incomplete', () => {
    it.each(AI_REQUIRED)('draft → reviewed sans %s', (key) => {
      expect(blockers(without(at('draft'), key), 'reviewed')).toEqual(['incomplete']);
    });

    it('un champ facultatif absent (setup, tips, notes) ne bloque pas', () => {
      expect(
        blockers(without(at('draft'), 'setup', 'easier_tip', 'review_notes', 'drafting'), 'reviewed'),
      ).toEqual([]);
    });

    it('retired → reviewed : un brouillon retiré encore incomplet ne revient pas en reviewed (R-FIC-1)', () => {
      expect(blockers(without(at('retired'), 'instructions', 'mistakes'), 'reviewed')).toEqual([
        'incomplete',
      ]);
    });
  });

  describe('invalid_sheet', () => {
    it('draft → reviewed avec une entrée de sécurité de 121 caractères', () => {
      expect(blockers(at('draft', TOO_LONG_SAFETY), 'reviewed')).toEqual(['invalid_sheet']);
    });

    it('draft → reviewed avec des muscles secondaires qui recoupent les principaux', () => {
      expect(blockers(at('draft', { secondary_muscles: ['glutes'] }), 'reviewed')).toEqual(['invalid_sheet']);
    });

    it('un champ absent ne masque pas une règle entre champs : incomplete et invalid_sheet', () => {
      const s = without(at('draft', { secondary_muscles: ['glutes'] }), 'instructions');
      expect(blockers(s, 'reviewed')).toEqual(['incomplete', 'invalid_sheet']);
    });

    it('retired → reviewed avec une fiche invalide', () => {
      expect(blockers(at('retired', TOO_LONG_SAFETY), 'reviewed')).toEqual(['invalid_sheet']);
    });

    it.each<ExerciseStatus>(['reviewed', 'published'])(
      "enregistrement (PUT) invalide d'une fiche %s",
      (status) => {
        expect(blockers(at(status, TOO_LONG_SAFETY), status)).toEqual(['invalid_sheet']);
      },
    );

    it.each<ExerciseStatus>(['reviewed', 'published'])(
      "enregistrement (PUT) qui vide un champ obligatoire d'une fiche %s : invalid_sheet seul",
      (status) => {
        expect(blockers(without(at(status), 'breathing'), status)).toEqual(['invalid_sheet']);
      },
    );

    it.each<ExerciseStatus>(['draft', 'retired'])("enregistrement (PUT) d'une fiche %s : libre", (status) => {
      expect(blockers(without(at(status, TOO_LONG_SAFETY), 'instructions'), status)).toEqual([]);
    });
  });

  it('review_unchecked : draft → reviewed sans la case « Consignes et sécurité vérifiées »', () => {
    expect(blockers(at('draft'), 'reviewed', { reviewChecked: false })).toEqual(['review_unchecked']);
  });

  it('minors_unconfirmed : draft → reviewed sans confirmer « Déconseillé aux mineurs »', () => {
    expect(blockers(at('draft'), 'reviewed', { minorsConfirmed: false })).toEqual(['minors_unconfirmed']);
  });

  it('retired → reviewed (réactivation) : ni la case de relecture ni la confirmation mineurs ne sont demandées', () => {
    expect(blockers(at('retired'), 'reviewed', { reviewChecked: false, minorsConfirmed: false })).toEqual([]);
  });

  describe('open_comments', () => {
    it('reviewed → published avec un commentaire ouvert, quelle que soit sa révision', () => {
      const comments = [{ resolvedAt: '2026-10-28T10:00:00.000Z' }, { resolvedAt: null }];
      expect(blockers(at('reviewed'), 'published', { comments })).toEqual(['open_comments']);
    });

    it('tous les commentaires traités : pas de blocage', () => {
      const comments = [{ resolvedAt: '2026-10-28T10:00:00.000Z' }];
      expect(blockers(at('reviewed'), 'published', { comments })).toEqual([]);
    });
  });

  describe('health_validation_missing', () => {
    it("reviewed → published d'une fiche sensible sans feu vert santé à jour", () => {
      expect(blockers(at('reviewed'), 'published', { greenLight: false })).toEqual([
        'health_validation_missing',
      ]);
    });

    it("fiche non sensible : le feu vert santé n'est pas demandé", () => {
      const calm = at('reviewed', { level: 1, not_for_minors: false, stressed_joints: ['hips'] });
      expect(blockers(calm, 'published', { greenLight: false })).toEqual([]);
    });
  });

  describe('illustrations_missing', () => {
    it('reviewed → published avec une illustration absente du manifeste', () => {
      expect(blockers(at('reviewed'), 'published', { manifestIds: new Set(['goblet-squat-start']) })).toEqual(
        ['illustrations_missing'],
      );
    });

    it('aucune illustration : pas de blocage (04 §8)', () => {
      expect(
        blockers(at('reviewed', { illustrations: [] }), 'published', { manifestIds: new Set() }),
      ).toEqual([]);
    });
  });

  it.each<ExerciseStatus>(['draft', 'reviewed', 'published'])(
    "referenced_by_template : %s → retired d'une fiche citée par un modèle",
    (status) => {
      expect(blockers(at(status), 'retired', { templateRefs: new Set(['goblet-squat']) })).toEqual([
        'referenced_by_template',
      ]);
    },
  );

  describe('chain_break', () => {
    const retire = (id: string, catalog: readonly DraftSheet[]) => {
      const target = catalog.find((s) => s.id === id);
      if (target === undefined) throw new Error(id);
      return blockers(target, 'retired', { catalog: [...catalog] });
    };

    it("retirer le milieu d'une chaîne la couperait", () => {
      expect(retire('push-up', PUSH_UP_CHAIN)).toEqual(['chain_break']);
    });

    it('retirer une extrémité encore pointée par sa voisine la couperait aussi', () => {
      expect(retire('wall-push-up', PUSH_UP_CHAIN)).toEqual(['chain_break']);
      expect(retire('archer-push-up', PUSH_UP_CHAIN)).toEqual(['chain_break']);
    });

    it("voisines reliées entre elles d'abord (R-CH-6) : on peut retirer", () => {
      const relinked = PUSH_UP_CHAIN.map((s) => {
        if (s.id === 'incline-push-up') return { ...s, harder_id: 'feet-elevated-push-up' };
        if (s.id === 'feet-elevated-push-up') return { ...s, easier_id: 'incline-push-up' };
        return s;
      });
      expect(retire('push-up', relinked)).toEqual([]);
    });

    it('une voisine déjà retirée ne compte pas ; une voisine en brouillon compte', () => {
      const pair = linkChain('squat', [sheet({ id: 'box-squat' }), sheet({ id: 'goblet-squat' })]);
      const [box, goblet] = pair as [ExerciseSheet, ExerciseSheet];
      expect(retire('goblet-squat', [{ ...box, status: 'retired' }, goblet])).toEqual([]);
      expect(retire('goblet-squat', [{ ...box, status: 'draft' }, goblet])).toEqual(['chain_break']);
    });

    it('fiche hors chaîne : pas de blocage', () => {
      expect(retire('goblet-squat', [sheet(), ...PUSH_UP_CHAIN])).toEqual([]);
    });
  });

  describe('catalog_full', () => {
    it(`retired → reviewed à ${CATALOG_MAX_SHEETS} fiches non retirées : bloqué`, () => {
      expect(blockers(at('retired'), 'reviewed', { catalog: others(CATALOG_MAX_SHEETS) })).toEqual([
        'catalog_full',
      ]);
    });

    it(`retired → reviewed à ${CATALOG_MAX_SHEETS - 1} fiches non retirées : permis`, () => {
      expect(blockers(at('retired'), 'reviewed', { catalog: others(CATALOG_MAX_SHEETS - 1) })).toEqual([]);
    });

    it('tous statuts confondus, brouillons compris ; les retirées et la fiche elle-même ne comptent pas', () => {
      const catalog = [
        ...others(100, 'draft'),
        ...others(100, 'reviewed').map((s) => ({ ...s, id: `r-${s.id}` })),
        ...others(99, 'published').map((s) => ({ ...s, id: `p-${s.id}` })),
        ...others(50, 'retired').map((s) => ({ ...s, id: `x-${s.id}` })),
        at('retired'),
      ];
      expect(blockers(at('retired'), 'reviewed', { catalog })).toEqual([]);
      expect(
        blockers(at('retired'), 'reviewed', { catalog: [...catalog, { id: 'one-more', status: 'draft' }] }),
      ).toEqual(['catalog_full']);
    });

    it('ne vaut que pour retired → reviewed', () => {
      expect(blockers(at('draft'), 'reviewed', { catalog: others(CATALOG_MAX_SHEETS) })).toEqual([]);
    });
  });
});

describe("transitionBlockers : ordre fixe quand plusieurs codes s'appliquent", () => {
  it('draft → reviewed', () => {
    const s = without(at('draft', TOO_LONG_SAFETY), 'mistakes');
    expect(blockers(s, 'reviewed', { reviewChecked: false, minorsConfirmed: false })).toEqual([
      'incomplete',
      'invalid_sheet',
      'review_unchecked',
      'minors_unconfirmed',
    ]);
  });

  it('reviewed → published', () => {
    expect(
      blockers(at('reviewed'), 'published', {
        comments: [{ resolvedAt: null }],
        greenLight: false,
        manifestIds: new Set(),
      }),
    ).toEqual(['open_comments', 'health_validation_missing', 'illustrations_missing']);
  });

  it('→ retired', () => {
    const [, middle] = PUSH_UP_CHAIN as [ExerciseSheet, ExerciseSheet];
    expect(
      blockers(middle, 'retired', { templateRefs: new Set([middle.id]), catalog: [...PUSH_UP_CHAIN] }),
    ).toEqual(['referenced_by_template', 'chain_break']);
  });

  it('retired → reviewed', () => {
    const s = without(at('retired', TOO_LONG_SAFETY), 'key_points');
    expect(blockers(s, 'reviewed', { catalog: others(CATALOG_MAX_SHEETS) })).toEqual([
      'incomplete',
      'invalid_sheet',
      'catalog_full',
    ]);
  });

  /** Transitions où chaque code s'applique (tableau §3.6 ; `from === to` = enregistrement par `PUT`). */
  const APPLIES: Record<PublishBlocker, (from: ExerciseStatus, to: ExerciseStatus) => boolean> = {
    incomplete: (f, t) => t === 'reviewed' && (f === 'draft' || f === 'retired'),
    invalid_sheet: (f, t) =>
      (t === 'reviewed' && (f === 'draft' || f === 'retired')) ||
      (f === t && (f === 'reviewed' || f === 'published')),
    review_unchecked: (f, t) => f === 'draft' && t === 'reviewed',
    minors_unconfirmed: (f, t) => f === 'draft' && t === 'reviewed',
    open_comments: (f, t) => f === 'reviewed' && t === 'published',
    health_validation_missing: (f, t) => f === 'reviewed' && t === 'published',
    illustrations_missing: (f, t) => f === 'reviewed' && t === 'published',
    referenced_by_template: (f, t) => f !== 'retired' && t === 'retired',
    chain_break: (f, t) => f !== 'retired' && t === 'retired',
    catalog_full: (f, t) => f === 'retired' && t === 'reviewed',
  };

  const FULL_CATALOG = others(CATALOG_MAX_SHEETS);
  const POINTER = { id: 'box-squat', status: 'published' as const, harder_id: 'goblet-squat' };

  it("propriété : les codes qui échouent et s'appliquent, dans l'ordre de PUBLISH_BLOCKERS, sans doublon", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EXERCISE_STATUSES),
        fc.constantFrom(...EXERCISE_STATUSES),
        fc.subarray([...PUBLISH_BLOCKERS]),
        (from, to, failing) => {
          const fails = (b: PublishBlocker) => failing.includes(b);
          let s: DraftSheet = at(from, fails('invalid_sheet') ? TOO_LONG_SAFETY : {});
          if (fails('incomplete')) s = without(s, 'instructions');
          const result = transitionBlockers(
            input(s, to, {
              comments: fails('open_comments') ? [{ resolvedAt: null }] : [],
              greenLight: !fails('health_validation_missing'),
              reviewChecked: !fails('review_unchecked'),
              minorsConfirmed: !fails('minors_unconfirmed'),
              manifestIds: fails('illustrations_missing') ? new Set() : MANIFEST,
              templateRefs: new Set(fails('referenced_by_template') ? ['goblet-squat'] : []),
              catalog: [
                s,
                ...(fails('chain_break') ? [POINTER] : []),
                ...(fails('catalog_full') ? FULL_CATALOG : []),
              ],
            }),
          );
          // Enregistrement : un champ vide rend la fiche invalide (incomplete ne s'y applique pas).
          const isSave = from === to;
          const expected = PUBLISH_BLOCKERS.filter(
            (b) =>
              APPLIES[b](from, to) && (fails(b) || (isSave && b === 'invalid_sheet' && fails('incomplete'))),
          );
          expect(result).toEqual(expected);
        },
      ),
    );
  });
});

describe('circuit éditorial (04 §8)', () => {
  const ALLOWED = [
    'draft → reviewed',
    'draft → retired',
    'reviewed → draft',
    'reviewed → published',
    'reviewed → retired',
    'published → retired',
    'retired → reviewed',
  ];

  it('les 7 transitions de 04 §8, et aucune autre (même statut compris)', () => {
    const pairs = EXERCISE_STATUSES.flatMap((from) => EXERCISE_STATUSES.map((to) => [from, to] as const));
    const allowed = pairs
      .filter(([from, to]) => isExerciseTransition(from, to))
      .map(([f, t]) => `${f} → ${t}`);
    expect(allowed).toEqual(ALLOWED);
    const table = Object.entries(EXERCISE_TRANSITIONS).flatMap(([from, targets]) =>
      targets.map((to) => `${from} → ${to}`),
    );
    expect(table).toEqual(ALLOWED);
  });
});

describe('templateExerciseIds : fiches citées par les modèles de programmes (05 §4)', () => {
  const catalog = [
    ...PUSH_UP_CHAIN,
    sheet({ id: 'goblet-squat' }),
    sheet({ id: 'leg-press', status: 'retired' }),
    sheet({ id: 'front-plank', chain_id: 'front-plank' }),
  ];
  const template = (slots: unknown[]) => ({ id: 'gym-beginner', workouts: [{ id: 'A', slots }] });

  it('listes de slot, et chaînes développées en leurs membres de tous statuts', () => {
    const ids = templateExerciseIds(
      [
        template([
          { id: 'A1', exercises: ['goblet-squat', 'leg-press', 'inconnue'] },
          { id: 'A2', chain: 'push-up' },
        ]),
        template([{ id: 'B1', chain: 'front-plank' }]),
      ],
      catalog,
    );
    expect([...ids].sort()).toEqual([
      'archer-push-up',
      'feet-elevated-push-up',
      'front-plank',
      'goblet-squat',
      'incline-push-up',
      'inconnue',
      'leg-press',
      'push-up',
      'wall-push-up',
    ]);
  });

  it('modèle de forme inattendue : ignoré sans lever', () => {
    const odd = [
      null,
      'texte',
      { workouts: 'x' },
      { workouts: [null, { slots: [3, { exercises: [1, 'goblet-squat'], chain: 7 }] }] },
    ];
    expect([...templateExerciseIds(odd, catalog)]).toEqual(['goblet-squat']);
    expect(templateExerciseIds([], catalog).size).toBe(0);
  });
});
