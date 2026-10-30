import {
  CONTENT_EXCLUDED_KEYS,
  type DraftSheet,
  type ExerciseSheet,
  ExerciseSheetSchema,
  type Joint,
} from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/catalog/canonical';
import {
  contentDiff,
  contentOf,
  hasValidatedContent,
  healthGreenLight,
  isHealthReviewer,
  isReviewer,
  isSensitive,
  type ReviewerState,
  type RevisionRow,
  standingHealthValidations,
  type Validation,
} from '../../src/catalog/review';
import { arbSheet, reviewer, revisionRow, sheet, without } from '../fixtures/catalog';

const EXCLUDED: readonly string[] = CONTENT_EXCLUDED_KEYS;

describe('contentOf (spec §3.2)', () => {
  it("retire les champs système et éditoriaux, garde les autres dans l'ordre de 04 §4", () => {
    const s = {
      ...sheet({ reviewed_by: 'u-1', reviewed_at: '2026-10-21T18:30:00.000Z', setup: 'Règle le banc.' }),
      exported_revision: 3,
    };
    const content = contentOf(s);
    for (const key of EXCLUDED) expect(content).not.toHaveProperty(key);
    expect(Object.keys(content)).toEqual(
      Object.keys(ExerciseSheetSchema.shape).filter((k) => !EXCLUDED.includes(k) && k in s),
    );
    expect(content.name).toBe('Squat goblet');
    expect(content.instructions).toEqual(s.instructions);
  });

  it("forme canonique (04 §10) : le même contenu quel que soit l'ordre des clés, sous-objets compris", () => {
    const s = sheet();
    const reversed = Object.fromEntries(
      Object.entries(s)
        .reverse()
        .map(([k, v]) => [
          k,
          k === 'mistakes' ? s.mistakes.map((m) => ({ fix: m.fix, mistake: m.mistake })) : v,
        ]),
    );
    expect(canonicalJson(contentOf(reversed))).toBe(canonicalJson(contentOf(s)));
    expect(JSON.stringify(contentOf(reversed))).toBe(JSON.stringify(contentOf(s)));
  });

  it('brouillon incomplet : les clés absentes ou undefined sont sautées', () => {
    const draft = without(sheet({ status: 'draft' }), 'instructions', 'mistakes');
    const content = contentOf({ ...draft, setup: undefined });
    expect(content).not.toHaveProperty('instructions');
    expect(content).not.toHaveProperty('mistakes');
    expect(content).not.toHaveProperty('setup');
  });

  it('copie profonde : modifier le résultat ne touche pas la fiche', () => {
    const s = sheet();
    const content = contentOf(s);
    (content.instructions as string[]).push('Étape ajoutée');
    expect(s.instructions).toHaveLength(4);
  });

  it("idempotente : le contenu d'une révision est son propre contenu", () => {
    fc.assert(
      fc.property(arbSheet, (s) => {
        expect(contentOf(contentOf(s))).toEqual(contentOf(s));
      }),
    );
  });
});

describe('contentDiff (spec §3.2, différentiel)', () => {
  it('[] sans changement', () => expect(contentDiff(sheet(), sheet())).toEqual([]));

  it('[] quand seuls des champs système ou éditoriaux changent (transition comprise)', () => {
    const before = sheet({ status: 'reviewed', revision: 3 });
    expect(contentDiff(before, { ...before, status: 'published', revision: 4 })).toEqual([]);
    expect(
      contentDiff(before, {
        ...before,
        revision: 5,
        batch: 'E1',
        review_notes: 'Autre doute.',
        reviewed_by: 'u-1',
        reviewed_at: '2026-10-25T08:00:00.000Z',
        published_at: '2026-10-26T08:00:00.000Z',
        retired_at: '2026-10-27T08:00:00.000Z',
        updated_at: '2026-10-27T08:00:00.000Z',
        drafting: { origin: 'human', generated_at: '2026-10-01T08:00:00.000Z' },
        exported_revision: 5,
      } as ExerciseSheet),
    ).toEqual([]);
  });

  it('les clés de contenu changées, triées en ordre binaire', () => {
    const before = sheet();
    const after = sheet({ safety: ['Arrête-toi si ton genou fait mal.'], name: 'Squat gobelet', level: 2 });
    expect(contentDiff(before, after)).toEqual(['level', 'name', 'safety']);
    expect(contentDiff(after, before)).toEqual(['level', 'name', 'safety']);
  });

  it('une clé ajoutée ou retirée compte comme changée', () => {
    const before = sheet();
    expect(contentDiff(before, sheet({ setup: 'Règle le banc.' }))).toEqual(['setup']);
    expect(contentDiff(before, without(before, 'easier_tip'))).toEqual(['easier_tip']);
  });

  it("l'ordre des clés des sous-objets ne compte pas, l'ordre des listes compte", () => {
    const before = sheet();
    const swappedKeys = {
      ...before,
      mistakes: before.mistakes.map((m) => ({ fix: m.fix, mistake: m.mistake })),
    };
    expect(contentDiff(before, swappedKeys)).toEqual([]);
    expect(contentDiff(before, { ...before, mistakes: [...before.mistakes].reverse() })).toEqual([
      'mistakes',
    ]);
  });

  it("compare le contenu d'une révision à la fiche courante", () => {
    const v3 = sheet({ status: 'reviewed', revision: 3 });
    const current = sheet({ status: 'published', revision: 6, breathing: 'Souffle en remontant.' });
    expect(contentDiff(revisionRow(v3, 'admin').content, current)).toEqual(['breathing']);
  });

  it('propriété : vide si et seulement si les contenus canoniques sont égaux ; toujours trié', () => {
    fc.assert(
      fc.property(arbSheet, arbSheet, (a, b) => {
        const diff = contentDiff(a, b);
        expect(diff).toEqual([...diff].sort());
        expect(diff.length === 0).toBe(canonicalJson(contentOf(a)) === canonicalJson(contentOf(b)));
        expect(diff.every((k) => !EXCLUDED.includes(k))).toBe(true);
      }),
    );
  });
});

describe('isSensitive (spec §3.2)', () => {
  /** Fiche non sensible : niveau 1, pas `not_for_minors`, articulations hors `SENSITIVE_JOINTS`. */
  const calm = (overrides: Partial<ExerciseSheet> = {}) =>
    sheet({ level: 1, not_for_minors: false, stressed_joints: ['hips', 'wrists'], ...overrides });

  it.each<[string, Partial<ExerciseSheet>, boolean]>([
    ['niveau 2', { level: 2 }, true],
    ['niveau 3', { level: 3 }, true],
    ['not_for_minors', { not_for_minors: true }, true],
    ['bas du dos', { stressed_joints: ['lower_back'] }, true],
    ['genoux', { stressed_joints: ['knees'] }, true],
    ['épaules', { stressed_joints: ['hips', 'shoulders'] }, true],
    ['cou', { stressed_joints: ['neck'] }, true],
    ['fiche non sensible', {}, false],
    ['aucune articulation', { stressed_joints: [] }, false],
  ])('%s → %s', (_, overrides, expected) => {
    expect(isSensitive(calm(overrides))).toBe(expected);
  });

  it.each<Joint>(['hips', 'wrists', 'elbows', 'ankles'])('%s seule ne rend pas sensible', (joint) => {
    expect(isSensitive(calm({ stressed_joints: [joint] }))).toBe(false);
  });

  it('brouillon sans stressed_joints : jugé sur le niveau et not_for_minors', () => {
    expect(isSensitive(without(calm(), 'stressed_joints'))).toBe(false);
    expect(isSensitive(without(calm({ level: 2 }), 'stressed_joints'))).toBe(true);
  });
});

describe('isReviewer et isHealthReviewer (spec §3.1)', () => {
  it.each<[string, Partial<ReviewerState>, boolean, boolean]>([
    ['membre sans drapeau', { catalogReviewer: false }, false, false],
    ['relectrice', {}, true, false],
    ['relectrice santé', { healthProfessional: true }, true, true],
    [
      'drapeau santé sans drapeau relecteur',
      { catalogReviewer: false, healthProfessional: true },
      false,
      false,
    ],
    ['admin sans drapeau', { role: 'admin', catalogReviewer: false }, true, false],
    ['admin aux deux drapeaux cochés', { role: 'admin', healthProfessional: true }, true, false],
  ])('%s : relecteur %s, relecteur santé %s', (_, overrides, reviewerFlag, healthFlag) => {
    const user = reviewer('u-1', overrides);
    expect(isReviewer(user)).toBe(reviewerFlag);
    expect(isHealthReviewer(user)).toBe(healthFlag);
  });
});

/*
 * Historique type : la fiche est chargée en brouillon (v1, par le chargeur), corrigée par l'admin (v2), passée
 * en `reviewed` (v3, même contenu). La relectrice santé valide la v3.
 */
const ADMIN = reviewer('admin', { role: 'admin', catalogReviewer: false });
const NURSE = reviewer('nurse', { healthProfessional: true });
const READER = reviewer('reader');
const USERS: ReadonlyMap<string, ReviewerState> = new Map([ADMIN, NURSE, READER].map((u) => [u.id, u]));

const V1 = sheet({ status: 'draft', revision: 1 });
const V2 = sheet({ status: 'draft', revision: 2, safety: ['Arrête la série si ton genou fait mal.'] });
const V3: DraftSheet = { ...V2, status: 'reviewed', revision: 3 };
const HISTORY: readonly RevisionRow[] = [
  revisionRow(V1, null),
  revisionRow(V2, 'admin'),
  revisionRow(V3, 'admin'),
];
const NURSE_ON_V3: Validation = { reviewerId: 'nurse', revision: 3, health: true };

/** `V3` passée à `status` en `revision`, sans changement de contenu. */
const moved = (revision: number, status: DraftSheet['status']): DraftSheet => ({ ...V3, revision, status });

describe('healthGreenLight (spec §3.2, conditions 1 à 3)', () => {
  it('validation sur la version N, puis reviewed → draft → reviewed → published sans changer le contenu : vrai', () => {
    const v4 = moved(4, 'draft');
    const v5 = moved(5, 'reviewed');
    const v6 = moved(6, 'published');
    const history = [...HISTORY, ...[v4, v5, v6].map((s) => revisionRow(s, 'admin'))];
    expect(healthGreenLight(V3, HISTORY, [NURSE_ON_V3], USERS)).toBe(true);
    expect(healthGreenLight(v6, history, [NURSE_ON_V3], USERS)).toBe(true);
  });

  it('un champ éditorial modifié (notes, lot) ne périme pas le feu vert', () => {
    const v4: DraftSheet = { ...V3, revision: 4, review_notes: 'Vu avec la kiné.', batch: 'B' };
    expect(healthGreenLight(v4, [...HISTORY, revisionRow(v4, 'admin')], [NURSE_ON_V3], USERS)).toBe(true);
  });

  it('contenu modifié après la validation : faux', () => {
    const v4: DraftSheet = { ...V3, revision: 4, breathing: 'Souffle en remontant.' };
    expect(healthGreenLight(v4, [...HISTORY, revisionRow(v4, 'admin')], [NURSE_ON_V3], USERS)).toBe(false);
  });

  it("contenu modifié puis remis à l'identique : la validation de N compte de nouveau", () => {
    const v4: DraftSheet = { ...V3, revision: 4, breathing: 'Souffle en remontant.' };
    const v5: DraftSheet = { ...V3, revision: 5 };
    const history = [...HISTORY, revisionRow(v4, 'admin'), revisionRow(v5, 'admin')];
    expect(healthGreenLight(v5, history, [NURSE_ON_V3], USERS)).toBe(true);
  });

  it("validation par l'auteur de la dernière modification de contenu : faux", () => {
    const history = [revisionRow(V1, null), revisionRow(V2, 'nurse'), revisionRow(V3, 'admin')];
    expect(healthGreenLight(V3, history, [NURSE_ON_V3], USERS)).toBe(false);
  });

  it("l'auteur d'une modification plus ancienne peut donner le feu vert", () => {
    const v3: DraftSheet = { ...V3, name: 'Squat gobelet' };
    const history = [revisionRow(V1, null), revisionRow(V2, 'nurse'), revisionRow(v3, 'admin')];
    expect(healthGreenLight(v3, history, [NURSE_ON_V3], USERS)).toBe(true);
  });

  it('dernière modification de contenu faite par le chargeur (savedBy null) : la validation compte', () => {
    const seeded = sheet({ status: 'reviewed', revision: 1 });
    const validation: Validation = { reviewerId: 'nurse', revision: 1, health: true };
    expect(healthGreenLight(seeded, [revisionRow(seeded, null)], [validation], USERS)).toBe(true);
  });

  it('auteur au drapeau santé retiré : faux', () => {
    const users = new Map(USERS).set('nurse', { ...NURSE, healthProfessional: false });
    expect(healthGreenLight(V3, HISTORY, [NURSE_ON_V3], users)).toBe(false);
  });

  it("auteur qui n'est plus relectrice : faux", () => {
    const users = new Map(USERS).set('nurse', { ...NURSE, catalogReviewer: false });
    expect(healthGreenLight(V3, HISTORY, [NURSE_ON_V3], users)).toBe(false);
  });

  it('auteur promu admin : faux', () => {
    const users = new Map(USERS).set('nurse', { ...NURSE, role: 'admin' });
    expect(healthGreenLight(V3, HISTORY, [NURSE_ON_V3], users)).toBe(false);
  });

  it('auteur supprimé (reviewerId null) ou absent des comptes : faux', () => {
    expect(healthGreenLight(V3, HISTORY, [{ ...NURSE_ON_V3, reviewerId: null }], USERS)).toBe(false);
    const users = new Map(USERS);
    users.delete('nurse');
    expect(healthGreenLight(V3, HISTORY, [NURSE_ON_V3], users)).toBe(false);
  });

  it('admin au drapeau santé coché : faux', () => {
    const admin = reviewer('admin', { role: 'admin', healthProfessional: true });
    const users = new Map(USERS).set('admin', admin);
    expect(healthGreenLight(V3, HISTORY, [{ reviewerId: 'admin', revision: 3, health: true }], users)).toBe(
      false,
    );
  });

  it("relectrice simple : sa validation n'est pas un feu vert santé", () => {
    expect(healthGreenLight(V3, HISTORY, [{ reviewerId: 'reader', revision: 3, health: false }], USERS)).toBe(
      false,
    );
  });

  it("validation simple (health: false) d'une relectrice devenue relectrice santé ensuite : faux", () => {
    expect(healthGreenLight(V3, HISTORY, [{ ...NURSE_ON_V3, health: false }], USERS)).toBe(false);
  });

  it("révision validée absente de l'historique : faux", () => {
    expect(healthGreenLight(V3, HISTORY, [{ ...NURSE_ON_V3, revision: 9 }], USERS)).toBe(false);
  });

  it('sans validation : faux', () => expect(healthGreenLight(V3, HISTORY, [], USERS)).toBe(false));

  it("une validation à jour suffit parmi d'autres, quel que soit l'ordre des entrées", () => {
    const v4: DraftSheet = { ...V3, revision: 4, breathing: 'Souffle en remontant.' };
    const history = [...HISTORY, revisionRow(v4, 'admin')];
    const validations: Validation[] = [
      NURSE_ON_V3,
      { reviewerId: 'reader', revision: 4, health: false },
      { reviewerId: 'nurse', revision: 4, health: true },
    ];
    expect(healthGreenLight(v4, history, validations, USERS)).toBe(true);
    expect(healthGreenLight(v4, [...history].reverse(), [...validations].reverse(), USERS)).toBe(true);
  });
});

describe('standingHealthValidations (conditions 1 et 2)', () => {
  it('garde une validation santé périmée par le contenu, écarte les autres', () => {
    const v4: DraftSheet = { ...V3, revision: 4, breathing: 'Souffle en remontant.' };
    const history = [...HISTORY, revisionRow(v4, 'admin')];
    const validations: Validation[] = [
      { reviewerId: 'reader', revision: 3, health: false },
      NURSE_ON_V3,
      { reviewerId: null, revision: 3, health: true },
    ];
    expect(standingHealthValidations(history, validations, USERS)).toEqual([NURSE_ON_V3]);
    expect(healthGreenLight(v4, history, validations, USERS)).toBe(false);
  });

  it('triées par révision, puis par auteur en ordre binaire : la dernière est la plus récente', () => {
    const other = reviewer('kine', { healthProfessional: true });
    const users = new Map(USERS).set('kine', other);
    const validations: Validation[] = [
      { reviewerId: 'nurse', revision: 3, health: true },
      { reviewerId: 'nurse', revision: 1, health: true },
      { reviewerId: 'kine', revision: 3, health: true },
    ];
    expect(standingHealthValidations(HISTORY, validations, users)).toEqual([
      { reviewerId: 'nurse', revision: 1, health: true },
      { reviewerId: 'kine', revision: 3, health: true },
      { reviewerId: 'nurse', revision: 3, health: true },
    ]);
  });
});

describe('hasValidatedContent (« validée par toi »)', () => {
  it('vrai si la personne a validé une révision au contenu courant, transitions comprises', () => {
    const validations: Validation[] = [{ reviewerId: 'reader', revision: 3, health: false }];
    const v5 = moved(5, 'reviewed');
    const history = [...HISTORY, revisionRow(moved(4, 'draft'), 'admin'), revisionRow(v5, 'admin')];
    expect(hasValidatedContent(v5, history, validations, 'reader')).toBe(true);
    expect(hasValidatedContent(v5, history, validations, 'nurse')).toBe(false);
  });

  it('faux après une modification du contenu', () => {
    const validations: Validation[] = [{ reviewerId: 'reader', revision: 3, health: false }];
    const v4: DraftSheet = { ...V3, revision: 4, name: 'Squat gobelet' };
    expect(hasValidatedContent(v4, [...HISTORY, revisionRow(v4, 'admin')], validations, 'reader')).toBe(
      false,
    );
  });
});
