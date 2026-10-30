import {
  CATALOG_MAX_SHEETS,
  type CommentPart,
  type EquipmentCode,
  type ExerciseStatus,
  type GreenLight,
  ILLUSTRATION_ROLE_LABELS,
  type IllustrationRole,
  JOINT_LABELS,
  type Joint,
  type LoadMode,
  type MEASURES,
  type MECHANICS,
  MOVEMENT_PATTERN_LABELS,
  MOVEMENT_PATTERNS,
  type MovementPattern,
  MUSCLE_LABELS,
  type Muscle,
  type PublishBlocker,
  type ReviewListItem,
  type ReviewQueue,
  SENSITIVE_JOINTS,
} from '@rune/contracts';
import { plural } from '../../ui/format';
import { equipmentText } from '../exercises/exercise-labels';

/*
 * Textes de l'écran de relecture (spec brique 2 §3.3, §3.8 et §4.5) : statuts, filtres, parties commentables,
 * état du feu vert santé, raisons de la sensibilité, différentiel depuis une validation.
 */

/** Statut d'une fiche, au féminin (« la fiche »). */
export const STATUS_LABELS: Record<ExerciseStatus, string> = {
  draft: 'Brouillon',
  reviewed: 'Relue',
  published: 'Publiée',
  retired: 'Retirée',
};

/** Teinte d'une pastille (`Badge`) : elle appuie le texte, qui dit seul l'état. */
export type PillTone = 'accent' | 'success' | 'muted' | 'warning';

/** Pastille d'une ligne de la liste ou de l'en-tête d'une fiche. */
export interface Pill {
  text: string;
  tone: PillTone;
}

export const STATUS_TONES: Record<ExerciseStatus, PillTone> = {
  draft: 'muted',
  reviewed: 'accent',
  published: 'success',
  retired: 'muted',
};

/**
 * Filtres de la liste, dans l'ordre affiché : les files de la relectrice (§4.5 et §3.8), puis toutes les fiches
 * (« Toutes » : une fiche publiée non sensible n'est dans aucune file, mais reste lisible et commentable). Le code
 * est la valeur de `?queue=` ; la liste est lue une fois, sans file, et filtrée sur place.
 */
export const LIST_FILTERS = [
  { id: 'to_review', label: 'À relire' },
  { id: 'drafts', label: 'Brouillons à commenter' },
  { id: 'health_pending', label: 'Feu vert santé' },
  { id: 'revalidate', label: 'À revalider' },
  { id: 'mine', label: 'Mes commentaires' },
  { id: 'all', label: 'Toutes' },
] as const satisfies readonly { id: ReviewQueue | 'all'; label: string }[];

export type ListFilter = (typeof LIST_FILTERS)[number]['id'];

/** Filtre de `?queue=` : absent ou inconnu → « À relire ». */
export function listFilterOf(value: string | null | undefined): ListFilter {
  return LIST_FILTERS.find((f) => f.id === value)?.id ?? 'to_review';
}

/**
 * Filtres de la liste réservés à l'admin (spec brique 2 §4.5, 04 §8 étape 4), cumulés avec la file : type de
 * mouvement (`?pattern=`) et fiches sans illustration (`?illustrations=none`). Gardés dans l'adresse de la liste
 * et de chaque fiche, pour que Retour et « Fiche suivante » les retrouvent ; ignorés pour une relectrice.
 */
export interface AdminFilters {
  pattern: MovementPattern | null;
  withoutIllustration: boolean;
}

export const NO_ADMIN_FILTERS: AdminFilters = { pattern: null, withoutIllustration: false };

/** Filtres de l'admin lus dans l'adresse ; valeur inconnue ignorée. */
export function adminFiltersOf(params: URLSearchParams): AdminFilters {
  const pattern = params.get('pattern');
  const patterns: readonly string[] = MOVEMENT_PATTERNS;
  return {
    pattern: pattern !== null && patterns.includes(pattern) ? (pattern as MovementPattern) : null,
    withoutIllustration: params.get('illustrations') === 'none',
  };
}

/** Paramètres d'adresse des filtres de l'admin, à la suite de `?queue=` ; vide sans filtre. */
function adminQuery(admin: AdminFilters = NO_ADMIN_FILTERS): string {
  return `${admin.pattern ? `&pattern=${admin.pattern}` : ''}${admin.withoutIllustration ? '&illustrations=none' : ''}`;
}

/** La fiche passe les filtres de l'admin (aucun par défaut). */
export function inAdminFilters(
  item: Pick<ReviewListItem, 'movementPattern' | 'illustrationCount'>,
  admin: AdminFilters = NO_ADMIN_FILTERS,
): boolean {
  return (
    (admin.pattern === null || item.movementPattern === admin.pattern) &&
    (!admin.withoutIllustration || item.illustrationCount === 0)
  );
}

/** La fiche passe le filtre (elle est dans sa file, ou le filtre est « Toutes ») et ceux de l'admin. */
export function inFilter(
  item: Pick<ReviewListItem, 'queues' | 'movementPattern' | 'illustrationCount'>,
  filter: ListFilter,
  admin: AdminFilters = NO_ADMIN_FILTERS,
): boolean {
  return (filter === 'all' || item.queues.includes(filter)) && inAdminFilters(item, admin);
}

/** Liste de la relecture, au filtre donné (et aux filtres de l'admin). */
export const reviewListPath = (filter: ListFilter, admin?: AdminFilters): string =>
  `/review/exercises?queue=${filter}${adminQuery(admin)}`;

/** Fiche de la relecture ; les filtres suivent (Retour, « Fiche suivante »). */
export const reviewSheetPath = (id: string, filter: ListFilter, admin?: AdminFilters): string =>
  `/review/exercises/${encodeURIComponent(id)}?queue=${filter}${adminQuery(admin)}`;

/** Nom de chaque partie commentable (`COMMENT_PARTS`), dans « Commenter : <partie> » et le titre de la feuille. */
export const PART_LABELS: Record<CommentPart, string> = {
  general: 'Toute la fiche',
  name: 'Nom',
  muscles: 'Muscles',
  equipment: 'Matériel',
  level: 'Niveau',
  not_for_minors: 'Déconseillé aux mineurs',
  stressed_joints: 'Articulations sollicitées',
  instructions: 'Étapes',
  key_points: 'Points clés',
  mistakes: 'Erreurs',
  safety: 'Sécurité',
  breathing: 'Respiration',
  setup: 'Réglage',
  variants: 'Variantes',
  illustrations: 'Illustrations',
};

/** État agrégé du feu vert santé, sans auteur (§3.1) : « Feu vert santé : à jour / manquant / à refaire ». */
export const GREEN_LIGHT_LABELS: Record<GreenLight, string> = {
  ok: 'à jour',
  stale: 'à refaire',
  missing: 'manquant',
};

/**
 * Ce qui rend la fiche sensible (`isSensitive`, §3.2), en minuscules pour la pastille « Sensible : … » : niveau 2
 * ou plus, déconseillée aux mineurs, articulations de `SENSITIVE_JOINTS` dans l'ordre de la fiche.
 */
export function sensitiveReasons(
  item: Pick<ReviewListItem, 'level' | 'notForMinors' | 'stressedJoints'>,
): string[] {
  const sensitiveJoints: readonly Joint[] = SENSITIVE_JOINTS;
  return [
    ...(item.level >= 2 ? [`niveau ${item.level}`] : []),
    ...(item.notForMinors ? ['déconseillée aux mineurs'] : []),
    ...item.stressedJoints
      .filter((joint) => sensitiveJoints.includes(joint))
      .map((joint) => JOINT_LABELS[joint].toLocaleLowerCase('fr')),
  ];
}

/** Nom affiché d'une clé de contenu (différentiel depuis une validation, §3.2) ; une clé inconnue reste telle quelle. */
const FIELD_LABELS: Record<string, string> = {
  id: 'Identifiant',
  batch: 'Lot',
  name: 'Nom',
  aliases: 'Autres noms',
  movement_pattern: 'Type de mouvement',
  mechanics: 'Mécanique',
  unilateral: 'Un côté à la fois',
  measure: 'Mesure',
  load_mode: 'Mode de charge',
  primary_muscles: 'Muscles principaux',
  secondary_muscles: 'Muscles secondaires',
  equipment_options: 'Matériel',
  level: 'Niveau',
  not_for_minors: 'Déconseillé aux mineurs',
  stressed_joints: 'Articulations sollicitées',
  instructions: 'Étapes',
  key_points: 'Points clés',
  mistakes: 'Erreurs',
  safety: 'Sécurité',
  breathing: 'Respiration',
  setup: 'Réglage',
  chain_id: 'Chaîne',
  easier_id: 'Fiche plus facile',
  harder_id: 'Fiche plus difficile',
  easier_tip: 'Conseil plus facile',
  harder_tip: 'Conseil plus difficile',
  illustrations: 'Illustrations',
  review_notes: 'Notes pour la relecture',
};

export const fieldLabel = (key: string): string => FIELD_LABELS[key] ?? key;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Un élément d'une liste de la fiche, en clair : muscle, articulation, option de matériel, erreur, pose. */
function itemText(key: string, item: unknown): string {
  if (typeof item === 'string') {
    if (key === 'primary_muscles' || key === 'secondary_muscles') {
      return MUSCLE_LABELS[item as Muscle] ?? item;
    }
    if (key === 'stressed_joints') return JOINT_LABELS[item as Joint] ?? item;
    return item;
  }
  if (key === 'equipment_options' && Array.isArray(item)) return equipmentText(item as EquipmentCode[]);
  if (key === 'mistakes' && isRecord(item)) return `${String(item.mistake)} → ${String(item.fix)}`;
  if (key === 'illustrations' && isRecord(item)) {
    const role = ILLUSTRATION_ROLE_LABELS[item.role as IllustrationRole] ?? String(item.role);
    return `${String(item.illustration_id)} (${role})`;
  }
  return JSON.stringify(item);
}

/**
 * Valeur d'une clé de contenu en texte brut (différentiel) : « oui » / « non », éléments d'une liste séparés par
 * « · », codes de taxonomie traduits ; « vide » pour un champ absent, « aucun » pour une liste vide.
 */
export function fieldValueText(key: string, value: unknown): string {
  if (value === undefined || value === null) return 'vide';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return key === 'movement_pattern' ? (MOVEMENT_PATTERN_LABELS[value as MovementPattern] ?? value) : value;
  }
  if (Array.isArray(value))
    return value.length === 0 ? 'aucun' : value.map((v) => itemText(key, v)).join(' · ');
  return JSON.stringify(value);
}

/**
 * Message de chaque blocage (spec brique 2 §3.6, colonne « Message affiché ») : `open_comments` porte le nombre de
 * commentaires ouverts (0 : le serveur en a vu que l'écran n'a pas encore relus).
 */
export function blockerMessage(code: PublishBlocker, openComments: number): string {
  switch (code) {
    case 'incomplete':
      return 'Des champs obligatoires sont vides.';
    case 'invalid_sheet':
      return 'La fiche ne passe pas la validation complète.';
    case 'review_unchecked':
      return 'Coche « Consignes et sécurité vérifiées ».';
    case 'minors_unconfirmed':
      return 'Confirme le réglage « Déconseillé aux mineurs ».';
    case 'open_comments':
      return openComments === 0
        ? 'Des commentaires ne sont pas traités.'
        : `${openComments} ${plural(openComments, "commentaire n'est pas traité", 'commentaires ne sont pas traités')}.`;
    case 'health_validation_missing':
      return 'Il manque le feu vert santé sur cette version.';
    case 'illustrations_missing':
      return "Une illustration n'est pas dans le manifeste.";
    case 'referenced_by_template':
      return 'Un modèle de programme utilise cette fiche.';
    case 'chain_break':
      return 'Retirer cette fiche couperait sa chaîne.';
    case 'catalog_full':
      return `Le catalogue a atteint ${CATALOG_MAX_SHEETS} fiches.`;
  }
}

/**
 * Bouton de chaque changement de statut (04 §8), selon le statut visé et celui de départ : « Marquer relue »
 * depuis un brouillon, « Réactiver » depuis une fiche retirée.
 */
export function transitionLabel(from: ExerciseStatus, to: ExerciseStatus): string {
  switch (to) {
    case 'reviewed':
      return from === 'retired' ? 'Réactiver' : 'Marquer relue';
    case 'published':
      return 'Publier';
    case 'draft':
      return 'Renvoyer en brouillon';
    case 'retired':
      return 'Retirer';
  }
}

/** Mécanique d'un exercice (04 §4). */
export const MECHANICS_LABELS = {
  compound: 'Polyarticulaire',
  isolation: 'Isolation',
} as const satisfies Record<(typeof MECHANICS)[number], string>;

/** Mesure d'une série (04 §4) : des répétitions ou une durée. */
export const MEASURE_LABELS = {
  reps: 'Répétitions',
  duration: 'Durée',
} as const satisfies Record<(typeof MEASURES)[number], string>;

/** Mode de charge (04 §3.6), par ce que l'on charge. */
export const LOAD_MODE_LABELS = {
  barbell: 'Barre',
  dumbbell: 'Haltère ou kettlebell',
  machine: 'Machine ou poulie',
  weighted: 'Lest ajouté',
  bodyweight: 'Poids du corps',
  band: 'Élastique',
} as const satisfies Record<LoadMode, string>;
