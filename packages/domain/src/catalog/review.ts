import { CONTENT_EXCLUDED_KEYS, type DraftSheet, type Role, SENSITIVE_JOINTS } from '@rune/contracts';
import { canonicalJson } from './canonical';

const EXCLUDED: ReadonlySet<string> = new Set(CONTENT_EXCLUDED_KEYS);
const SENSITIVE: ReadonlySet<string> = new Set(SENSITIVE_JOINTS);

/**
 * Contenu d'une fiche (spec brique 2 §3.2) : tous ses champs sauf les champs système et éditoriaux
 * (`CONTENT_EXCLUDED_KEYS`), en forme canonique (04 §10) : clés dans l'ordre de 04 §4, sous-objets dans l'ordre
 * de leur schéma, clé absente ou `undefined` sautée. Copie profonde et idempotente : le contenu d'une révision
 * (`exercise_revision.content`) est son propre contenu. Accepte un brouillon incomplet.
 */
export function contentOf(sheet: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const content = Object.fromEntries(Object.entries(sheet).filter(([key]) => !EXCLUDED.has(key)));
  return JSON.parse(canonicalJson(content));
}

/** Empreinte du contenu : même texte si et seulement si même contenu. */
const contentKey = (sheet: Readonly<Record<string, unknown>>) => canonicalJson(contentOf(sheet));

/**
 * Différentiel (spec brique 2 §3.2) : clés de contenu dont la valeur diffère entre `a` et `b` (fiches ou contenus
 * de révision), en ordre binaire. Une clé présente d'un seul côté compte. `[]` si seuls des champs système ou
 * éditoriaux changent, une transition par exemple.
 */
export function contentDiff(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): string[] {
  const before = contentOf(a);
  const after = contentOf(b);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  // Valeurs déjà canoniques (clés des sous-objets ordonnées) : leur JSON suffit à les comparer.
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

/**
 * Fiche sensible (spec brique 2 §3.2) : niveau 2 ou plus, OU `not_for_minors`, OU une articulation de
 * `SENSITIVE_JOINTS` parmi `stressed_joints` (absent dans un brouillon : aucune). Elle ne se publie qu'avec le feu
 * vert santé à jour.
 */
export function isSensitive(
  sheet: Pick<DraftSheet, 'level' | 'not_for_minors' | 'stressed_joints'>,
): boolean {
  return (
    sheet.level >= 2 ||
    sheet.not_for_minors ||
    (sheet.stressed_joints ?? []).some((joint) => SENSITIVE.has(joint))
  );
}

/** Rôle et drapeaux d'un compte, relus à chaque requête (spec brique 2 §3.1). */
export type ReviewerState = {
  id: string;
  role: Role;
  catalogReviewer: boolean;
  healthProfessional: boolean;
};

/** Relecteur effectif (spec brique 2 §3.1) : drapeau `catalog_reviewer`, ou admin. */
export function isReviewer(user: Pick<ReviewerState, 'role' | 'catalogReviewer'>): boolean {
  return user.catalogReviewer || user.role === 'admin';
}

/**
 * Relecteur santé effectif (spec brique 2 §3.1) : `health_professional` ET `catalog_reviewer` ET rôle `member`.
 * Un admin ne l'est jamais, même drapeau coché.
 */
export function isHealthReviewer(
  user: Pick<ReviewerState, 'role' | 'catalogReviewer' | 'healthProfessional'>,
): boolean {
  return user.healthProfessional && user.catalogReviewer && user.role === 'member';
}

/**
 * Ligne `exercise_validation` (spec brique 2 §3.4) d'une fiche. `reviewerId` vaut `null` une fois le compte
 * supprimé ; `health` est le drapeau effectif au moment de valider (« Sécurité vérifiée »).
 */
export type Validation = { reviewerId: string | null; revision: number; health: boolean };

/** Ligne `exercise_revision` (spec brique 2 §3.5) : `content` = `contentOf`, `savedBy` `null` pour le chargeur. */
export type RevisionRow = { revision: number; content: Record<string, unknown>; savedBy: string | null };

/**
 * Dernière révision dont le contenu diffère de celui de la révision précédente ; la plus ancienne connue compte
 * comme un changement (création). `undefined` sans révision.
 */
function lastContentChange(revisions: readonly RevisionRow[]): RevisionRow | undefined {
  let last: RevisionRow | undefined;
  let previous: string | undefined;
  for (const row of [...revisions].sort((a, b) => a.revision - b.revision)) {
    const key = contentKey(row.content);
    if (key !== previous) last = row;
    previous = key;
  }
  return last;
}

/** Ordre binaire de deux chaînes (unités UTF-16), jamais `localeCompare`. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Validations santé d'une fiche qui remplissent encore les conditions 1 et 2 du feu vert (spec brique 2 §3.2),
 * quel que soit leur contenu :
 * 1. données comme validation santé (`health`) par un compte qui est encore relecteur santé effectif (compte
 *    supprimé, drapeau retiré ou passage admin : plus compté) ;
 * 2. par un autre que l'auteur (`savedBy`) de la dernière révision dont le contenu a changé.
 *
 * Triées par révision puis par auteur en ordre binaire : la dernière est la plus récente (point de départ du
 * différentiel de l'admin, §3.2). `revisions` et `validations` sont celles de la fiche.
 */
export function standingHealthValidations(
  revisions: readonly RevisionRow[],
  validations: readonly Validation[],
  users: ReadonlyMap<string, ReviewerState>,
): Validation[] {
  const lastAuthor = lastContentChange(revisions)?.savedBy ?? null;
  return validations
    .filter((v): v is Validation & { reviewerId: string } => {
      if (!v.health || v.reviewerId === null || v.reviewerId === lastAuthor) return false;
      const user = users.get(v.reviewerId);
      return user !== undefined && isHealthReviewer(user);
    })
    .sort((a, b) => a.revision - b.revision || compareText(a.reviewerId, b.reviewerId));
}

/** Vrai si la révision `revision` existe et a le contenu `current`. */
function revisionHasContent(
  byRevision: ReadonlyMap<number, RevisionRow>,
  revision: number,
  current: string,
): boolean {
  const row = byRevision.get(revision);
  return row !== undefined && contentKey(row.content) === current;
}

const indexRevisions = (revisions: readonly RevisionRow[]) => new Map(revisions.map((r) => [r.revision, r]));

/**
 * Feu vert santé à jour (spec brique 2 §3.2) : une validation remplit les conditions 1 et 2
 * (`standingHealthValidations`) et 3 : le contenu de la révision validée est celui de la fiche courante. Une
 * transition ne change pas le contenu : elle ne périme aucun feu vert. Ne regarde pas si la fiche est sensible.
 */
export function healthGreenLight(
  sheet: DraftSheet,
  revisions: readonly RevisionRow[],
  validations: readonly Validation[],
  users: ReadonlyMap<string, ReviewerState>,
): boolean {
  const current = contentKey(sheet);
  const byRevision = indexRevisions(revisions);
  return standingHealthValidations(revisions, validations, users).some((v) =>
    revisionHasContent(byRevision, v.revision, current),
  );
}

/**
 * Vrai si `reviewerId` a validé une révision dont le contenu est celui de la fiche courante (« validée par toi »,
 * file `to_review` de la spec brique 2 §3.8), même si des transitions ont suivi.
 */
export function hasValidatedContent(
  sheet: DraftSheet,
  revisions: readonly RevisionRow[],
  validations: readonly Validation[],
  reviewerId: string,
): boolean {
  const current = contentKey(sheet);
  const byRevision = indexRevisions(revisions);
  return validations.some(
    (v) => v.reviewerId === reviewerId && revisionHasContent(byRevision, v.revision, current),
  );
}
