import {
  type DraftSheet,
  type EquipmentCode,
  EXERCISE_LEVELS,
  type ExerciseSheet,
  type ExerciseStatus,
  type LoadMode,
  type MovementPattern,
  type Muscle,
} from '@rune/contracts';
import fc from 'fast-check';
import { expandEquipment } from '../../src/catalog/equipment';
import { contentOf, type ReviewerState, type RevisionRow } from '../../src/catalog/review';
import type { CatalogContext } from '../../src/catalog/usable';

/** Fiche publiée complète et valide (squat goblet de la maquette), sans chaîne. */
const GOBLET_SQUAT: ExerciseSheet = {
  id: 'goblet-squat',
  schema_version: 1,
  revision: 4,
  status: 'published',
  batch: 'A',
  name: 'Squat goblet',
  aliases: ['Goblet squat', 'Squat avec haltère'],
  movement_pattern: 'squat',
  mechanics: 'compound',
  unilateral: false,
  measure: 'reps',
  load_mode: 'dumbbell',
  primary_muscles: ['quadriceps', 'glutes'],
  secondary_muscles: ['adductors', 'abs'],
  equipment_options: [['dumbbells'], ['kettlebell']],
  level: 1,
  not_for_minors: false,
  stressed_joints: ['knees', 'hips'],
  instructions: [
    'Tiens un haltère à la verticale contre ta poitrine, les mains sous le disque du haut.',
    "Écarte les pieds un peu plus que la largeur des hanches, pointes légèrement vers l'extérieur.",
    "Descends en poussant les hanches en arrière et les genoux vers l'extérieur, le buste droit.",
    "Remonte en poussant dans tout le pied jusqu'à te tenir droit.",
  ],
  key_points: ['Garde les talons au sol pendant toute la descente.', 'Tes genoux suivent tes orteils.'],
  mistakes: [
    {
      mistake: "Les genoux rentrent vers l'intérieur en remontant.",
      fix: "Pousse les genoux vers l'extérieur, dans l'axe des pieds.",
    },
    {
      mistake: 'Les talons décollent en bas du mouvement.',
      fix: 'Descends moins bas et répartis ton poids sur tout le pied.',
    },
  ],
  safety: ['Arrête la série si tu ressens une douleur vive au genou ou dans le bas du dos.'],
  breathing: 'Inspire en descendant, souffle en remontant.',
  easier_tip: "Tiens-toi à un support devant toi pour garder l'équilibre.",
  illustrations: [
    { illustration_id: 'goblet-squat-start', role: 'start' },
    { illustration_id: 'goblet-squat-end', role: 'end' },
  ],
  review_notes: 'Profondeur à confirmer pour les débutants raides des chevilles.',
  drafting: {
    origin: 'ai',
    model: 'claude-opus-5-5',
    prompt_version: 1,
    generated_at: '2026-10-20T09:00:00.000Z',
  },
  published_at: '2026-10-22T08:00:00.000Z',
};

/** Copie de la fiche de référence (publiée, valide), surchargée champ par champ. */
export function sheet(overrides: Partial<ExerciseSheet> = {}): ExerciseSheet {
  return { ...structuredClone(GOBLET_SQUAT), ...overrides };
}

/** Relie des fiches en chaîne, de la plus facile à la plus dure (R-CH-1) : `chain_id`, `easier_id`, `harder_id`. */
export function linkChain(chainId: string, members: readonly ExerciseSheet[]): ExerciseSheet[] {
  return members.map((m, i) => {
    const { easier_id: _e, harder_id: _h, ...rest } = m;
    const easier = members[i - 1]?.id;
    const harder = members[i + 1]?.id;
    return {
      ...rest,
      chain_id: chainId,
      ...(easier === undefined ? {} : { easier_id: easier }),
      ...(harder === undefined ? {} : { harder_id: harder }),
    };
  });
}

const pushUp = (id: string, name: string, level: 1 | 2 | 3, extra: Partial<ExerciseSheet> = {}) =>
  sheet({
    id,
    name,
    aliases: [],
    movement_pattern: 'horizontal_push',
    load_mode: 'bodyweight',
    primary_muscles: ['chest', 'triceps'],
    secondary_muscles: ['front_delts', 'abs'],
    equipment_options: [[]],
    level,
    stressed_joints: ['shoulders', 'wrists'],
    ...extra,
  });

/** Chaîne des pompes (04 §5), de la plus facile à la plus dure ; la pompe archer est `not_for_minors`. */
export const PUSH_UP_CHAIN: readonly ExerciseSheet[] = linkChain('push-up', [
  pushUp('wall-push-up', 'Pompe murale', 1),
  pushUp('incline-push-up', 'Pompe inclinée', 1, { equipment_options: [['chair'], ['table']] }),
  pushUp('push-up', 'Pompe', 1),
  pushUp('feet-elevated-push-up', 'Pompe pieds surélevés', 2, { equipment_options: [['chair'], ['box']] }),
  pushUp('archer-push-up', 'Pompe archer', 3, { not_for_minors: true }),
]);

/** Contexte d'un adulte sans lieu principal, tout niveau accepté. */
export function context(catalog: ExerciseSheet[], overrides: Partial<CatalogContext> = {}): CatalogContext {
  return { catalog, equipment: 'all', maxLevel: 3, cautious: false, ...overrides };
}

/*
 * Arbitraires fast-check : peu de valeurs par champ, pour que les fiches se recoupent souvent (même pattern,
 * muscles communs, même chaîne) et que les égalités de score soient fréquentes.
 */
const PATTERNS: readonly MovementPattern[] = ['squat', 'lunge', 'horizontal_push'];
const MUSCLE_POOL: readonly Muscle[] = ['quadriceps', 'glutes', 'chest', 'triceps', 'hamstrings'];
const EQUIPMENT_POOL: readonly EquipmentCode[] = [
  'dumbbells',
  'barbell',
  'flat_bench',
  'adjustable_bench',
  'chair',
];
const LOAD_POOL: readonly LoadMode[] = ['dumbbell', 'barbell', 'bodyweight'];
/** Publiée trois fois sur six : assez de candidats, assez de fiches à écarter. */
const STATUS_POOL: readonly ExerciseStatus[] = [
  'published',
  'published',
  'published',
  'draft',
  'reviewed',
  'retired',
];

export const arbSheet: fc.Arbitrary<ExerciseSheet> = fc
  .record({
    id: fc.stringMatching(/^[a-z0-9]{1,4}(-[a-z0-9]{1,3})?$/),
    status: fc.constantFrom(...STATUS_POOL),
    level: fc.constantFrom(...EXERCISE_LEVELS),
    not_for_minors: fc.boolean(),
    movement_pattern: fc.constantFrom(...PATTERNS),
    unilateral: fc.boolean(),
    load_mode: fc.constantFrom(...LOAD_POOL),
    primary: fc.subarray([...MUSCLE_POOL], { minLength: 1, maxLength: 3 }),
    secondary: fc.subarray([...MUSCLE_POOL], { maxLength: 4 }),
    equipment_options: fc.array(fc.subarray([...EQUIPMENT_POOL], { maxLength: 2 }), {
      minLength: 1,
      maxLength: 3,
    }),
    chain_id: fc.option(fc.constantFrom('chain-a', 'chain-b'), { nil: undefined }),
  })
  .map(({ primary, secondary, chain_id, ...rest }) =>
    sheet({
      ...rest,
      primary_muscles: primary,
      secondary_muscles: secondary.filter((m) => !primary.includes(m)),
      ...(chain_id === undefined ? {} : { chain_id }),
    }),
  );

/** Catalogue aux `id` distincts. */
export const arbCatalog = (minLength = 0) =>
  fc.uniqueArray(arbSheet, { selector: (s) => s.id, minLength, maxLength: 25 });

/** Matériel d'un lieu (déjà étendu), ou `'all'` sans lieu principal. */
export const arbEquipment: fc.Arbitrary<Set<EquipmentCode> | 'all'> = fc.oneof(
  fc.constant('all' as const),
  fc.subarray([...EQUIPMENT_POOL]).map((codes) => expandEquipment(codes)),
);

/** Catalogue, fiche de départ (dans le catalogue ou non) et contexte. */
export const arbSubstituteCase = arbCatalog(1).chain((catalog) =>
  fc.record({
    ex: fc.oneof(fc.constantFrom(...catalog), arbSheet),
    ctx: fc.record({
      catalog: fc.constant(catalog),
      equipment: arbEquipment,
      maxLevel: fc.constantFrom(...EXERCISE_LEVELS),
      cautious: fc.boolean(),
    }),
  }),
);

/*
 * Relecture (spec brique 2 §3) : comptes, lignes de révision, brouillons incomplets.
 */

/** Compte de relecture : relectrice simple (membre, `catalogReviewer`) par défaut. */
export function reviewer(id: string, overrides: Partial<ReviewerState> = {}): ReviewerState {
  return { id, role: 'member', catalogReviewer: true, healthProfessional: false, ...overrides };
}

/** Ligne `exercise_revision` de la fiche `s` : son `revision`, son contenu, l'auteur de l'enregistrement. */
export function revisionRow(s: DraftSheet, savedBy: string | null): RevisionRow {
  return { revision: s.revision, content: contentOf(s), savedBy };
}

/** Copie de `s` sans les clés `keys` (brouillon dont des champs IA sont encore vides, R-FIC-1). */
export function without(s: DraftSheet, ...keys: (keyof ExerciseSheet)[]): DraftSheet {
  const copy: Record<string, unknown> = { ...s };
  for (const key of keys) delete copy[key];
  return copy as DraftSheet;
}
