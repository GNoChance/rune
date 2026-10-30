import {
  type DraftSheet,
  DraftSheetSchema,
  EQUIPMENT,
  type EquipmentCode,
  type ExerciseLevel,
  ExerciseSheetSchema,
  ILLUSTRATION_ROLES,
  type IllustrationEntry,
  type IllustrationRole,
  type IllustrationSource,
  type Joint,
  type LoadMode,
  type MEASURES,
  type MECHANICS,
  type MovementPattern,
  type Muscle,
} from '@rune/contracts';
import { levelText } from '../exercises/exercise-labels';
import {
  fieldLabel,
  fieldValueText,
  LOAD_MODE_LABELS,
  MEASURE_LABELS,
  MECHANICS_LABELS,
} from './review-labels';

/*
 * Formulaire d'édition d'une fiche par l'admin (spec brique 2 §4.5, 04 §4 et §8), en fonctions pures : fiche →
 * saisie, saisie → fiche à enregistrer, validation côté client par le schéma du statut (le serveur ne renvoie pas
 * d'erreur par champ), différences avec la version courante après un 409.
 */

/** Cases de chaque liste de textes : le maximum de 04 §4 ; une case vide est ignorée. */
export const LIST_SLOTS = { aliases: 6, instructions: 7, key_points: 4, mistakes: 4, safety: 3 } as const;

/** Options de matériel (04 §4) : 1 à 4 options de 0 à 3 codes chacune. */
export const EQUIPMENT_OPTIONS = 4;
export const EQUIPMENT_PER_OPTION = 3;

/** Illustrations de la fiche : une source pour toute la fiche (04 §12, règle 4), un fichier par pose. */
export type IllustrationChoice = { source: IllustrationSource | '' } & Record<IllustrationRole, string>;

type Mistake = { mistake: string; fix: string };

/**
 * Saisie du formulaire : une clé par champ de la fiche que l'admin modifie (04 §4 hors champs système), dans
 * l'ordre de 04 §4. Les listes gardent l'ordre de la fiche (cocher ajoute à la fin), pour qu'un enregistrement
 * sans changement ne change pas le contenu (et ne périme aucun feu vert santé).
 */
export interface SheetForm {
  batch: string;
  name: string;
  aliases: string[];
  movement_pattern: MovementPattern;
  mechanics: (typeof MECHANICS)[number];
  unilateral: boolean;
  measure: (typeof MEASURES)[number];
  load_mode: LoadMode;
  primary_muscles: Muscle[];
  secondary_muscles: Muscle[];
  /** `EQUIPMENT_OPTIONS` options de `EQUIPMENT_PER_OPTION` choix ; `''` : aucun. */
  equipment_options: (EquipmentCode | '')[][];
  level: ExerciseLevel;
  not_for_minors: boolean;
  stressed_joints: Joint[];
  instructions: string[];
  key_points: string[];
  mistakes: Mistake[];
  safety: string[];
  breathing: string;
  setup: string;
  chain_id: string;
  easier_id: string;
  harder_id: string;
  easier_tip: string;
  harder_tip: string;
  illustrations: IllustrationChoice;
  review_notes: string;
}

export type FormKey = keyof SheetForm;

/** Champs du formulaire, dans l'ordre de 04 §4 (`batch` juste après `status`, spec brique 2 §2). */
export const FORM_KEYS = [
  'batch',
  'name',
  'aliases',
  'movement_pattern',
  'mechanics',
  'unilateral',
  'measure',
  'load_mode',
  'primary_muscles',
  'secondary_muscles',
  'equipment_options',
  'level',
  'not_for_minors',
  'stressed_joints',
  'instructions',
  'key_points',
  'mistakes',
  'safety',
  'breathing',
  'setup',
  'chain_id',
  'easier_id',
  'harder_id',
  'easier_tip',
  'harder_tip',
  'illustrations',
  'review_notes',
] as const satisfies readonly FormKey[];

/** Champs système (04 §4), repris tels quels de la fiche de départ : le serveur les ignore de toute façon. */
const LEADING_SYSTEM_KEYS = ['id', 'schema_version', 'revision', 'status'] as const;
const TRAILING_SYSTEM_KEYS = [
  'drafting',
  'reviewed_by',
  'reviewed_at',
  'published_at',
  'retired_at',
  'updated_at',
] as const;

const pad = <T>(values: readonly T[], size: number, empty: T): T[] => [
  ...values,
  ...Array.from({ length: Math.max(0, size - values.length) }, () => empty),
];

/** Choix d'illustrations de la fiche : source tirée du manifeste local (première illustration qui y figure). */
function illustrationChoice(
  uses: DraftSheet['illustrations'],
  manifest: ReadonlyMap<string, IllustrationEntry>,
): IllustrationChoice {
  const choice: IllustrationChoice = { source: '', start: '', mid: '', end: '' };
  for (const use of uses ?? []) {
    choice[use.role] = use.illustration_id;
    if (choice.source === '') choice.source = manifest.get(use.illustration_id)?.source ?? '';
  }
  return choice;
}

/** Saisie de départ : la fiche, listes complétées de cases vides. */
export function formOf(sheet: DraftSheet, manifest: ReadonlyMap<string, IllustrationEntry>): SheetForm {
  return {
    batch: sheet.batch,
    name: sheet.name,
    aliases: pad(sheet.aliases ?? [], LIST_SLOTS.aliases, ''),
    movement_pattern: sheet.movement_pattern,
    mechanics: sheet.mechanics,
    unilateral: sheet.unilateral,
    measure: sheet.measure,
    load_mode: sheet.load_mode,
    primary_muscles: [...(sheet.primary_muscles ?? [])],
    secondary_muscles: [...(sheet.secondary_muscles ?? [])],
    equipment_options: pad(
      sheet.equipment_options.map((option) => pad<EquipmentCode | ''>(option, EQUIPMENT_PER_OPTION, '')),
      EQUIPMENT_OPTIONS,
      [],
    ).map((option) => pad(option, EQUIPMENT_PER_OPTION, '')),
    level: sheet.level,
    not_for_minors: sheet.not_for_minors,
    stressed_joints: [...(sheet.stressed_joints ?? [])],
    instructions: pad(sheet.instructions ?? [], LIST_SLOTS.instructions, ''),
    key_points: pad(sheet.key_points ?? [], LIST_SLOTS.key_points, ''),
    mistakes: pad(
      (sheet.mistakes ?? []).map((m) => ({ ...m })),
      LIST_SLOTS.mistakes,
      { mistake: '', fix: '' },
    ),
    safety: pad(sheet.safety ?? [], LIST_SLOTS.safety, ''),
    breathing: sheet.breathing ?? '',
    setup: sheet.setup ?? '',
    chain_id: sheet.chain_id ?? '',
    easier_id: sheet.easier_id ?? '',
    harder_id: sheet.harder_id ?? '',
    easier_tip: sheet.easier_tip ?? '',
    harder_tip: sheet.harder_tip ?? '',
    illustrations: illustrationChoice(sheet.illustrations, manifest),
    review_notes: sheet.review_notes ?? '',
  };
}

/**
 * La fiche doit être complète (`ExerciseSheetSchema`) : relue, publiée, ou retirée après avoir été publiée (elle
 * reste servie, spec brique 2 §3.6). Sinon, le schéma des brouillons (R-FIC-1).
 */
export const mustBeComplete = (base: DraftSheet): boolean =>
  base.status === 'reviewed' ||
  base.status === 'published' ||
  (base.status === 'retired' && base.published_at !== undefined);

const filled = (values: readonly string[]): string[] => values.map((v) => v.trim()).filter((v) => v !== '');

/** Pose de chaque illustration dans l'ordre de la fiche de départ, puis les nouvelles poses dans l'ordre start, mid, end. */
function illustrationUses(
  choice: IllustrationChoice,
  base: DraftSheet,
): NonNullable<DraftSheet['illustrations']> {
  const baseOrder = (base.illustrations ?? []).map((use) => use.role);
  const rank = (role: IllustrationRole) => {
    const index = baseOrder.indexOf(role);
    return index < 0 ? baseOrder.length + ILLUSTRATION_ROLES.indexOf(role) : index;
  };
  return ILLUSTRATION_ROLES.filter((role) => choice[role] !== '')
    .sort((a, b) => rank(a) - rank(b))
    .map((role) => ({ illustration_id: choice[role], role }));
}

/**
 * Fiche à enregistrer (`PUT`, spec brique 2 §3.5) : champs système de `base`, puis la saisie, textes sans blancs
 * autour. Un champ vidé est une clé absente, jamais `null`. Une liste qui peut être vide (`aliases`,
 * `secondary_muscles`, `stressed_joints`, `illustrations`) reste `[]` si la fiche de départ la portait ou doit être
 * complète, sinon elle reste absente (champ pas encore rédigé d'un brouillon, R-FIC-1).
 */
export function sheetOf(form: SheetForm, base: DraftSheet): Record<string, unknown> {
  const source = base as Record<string, unknown>;
  const complete = mustBeComplete(base);
  const out: Record<string, unknown> = {};
  for (const key of LEADING_SYSTEM_KEYS) out[key] = source[key];
  const text = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed !== '') out[key] = trimmed;
  };
  /** Liste à 1 élément au moins : absente si vide. */
  const list = (key: string, values: readonly unknown[]) => {
    if (values.length > 0) out[key] = values;
  };
  /** Liste qui peut être vide. */
  const optionalList = (key: string, values: readonly unknown[]) => {
    if (values.length > 0 || complete || source[key] !== undefined) out[key] = values;
  };
  text('batch', form.batch);
  text('name', form.name);
  optionalList('aliases', filled(form.aliases));
  out.movement_pattern = form.movement_pattern;
  out.mechanics = form.mechanics;
  out.unilateral = form.unilateral;
  out.measure = form.measure;
  out.load_mode = form.load_mode;
  list('primary_muscles', form.primary_muscles);
  optionalList('secondary_muscles', form.secondary_muscles);
  // Option 1 toujours gardée (vide : sans matériel) ; les suivantes seulement si un matériel y est choisi.
  out.equipment_options = form.equipment_options
    .map((option) => option.filter((code): code is EquipmentCode => code !== ''))
    .filter((option, index) => index === 0 || option.length > 0);
  out.level = form.level;
  out.not_for_minors = form.not_for_minors;
  optionalList('stressed_joints', form.stressed_joints);
  list('instructions', filled(form.instructions));
  list('key_points', filled(form.key_points));
  list(
    'mistakes',
    form.mistakes
      .map((m) => ({ mistake: m.mistake.trim(), fix: m.fix.trim() }))
      .filter((m) => m.mistake !== '' || m.fix !== ''),
  );
  list('safety', filled(form.safety));
  text('breathing', form.breathing);
  text('setup', form.setup);
  text('chain_id', form.chain_id);
  text('easier_id', form.easier_id);
  text('harder_id', form.harder_id);
  text('easier_tip', form.easier_tip);
  text('harder_tip', form.harder_tip);
  optionalList('illustrations', illustrationUses(form.illustrations, base));
  text('review_notes', form.review_notes);
  for (const key of TRAILING_SYSTEM_KEYS) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Nom de la case `index` (0 = la première remplie) d'une liste, pour situer une erreur. */
function slotName(form: SheetForm, key: FormKey, index: number, sub: unknown): string | null {
  const slot = (values: readonly boolean[]) => {
    let seen = -1;
    for (let i = 0; i < values.length; i += 1) {
      if (values[i]) seen += 1;
      if (seen === index) return i + 1;
    }
    return index + 1;
  };
  switch (key) {
    case 'aliases':
      return `Autre nom ${slot(form.aliases.map((v) => v.trim() !== ''))}`;
    case 'instructions':
      return `Étape ${slot(form.instructions.map((v) => v.trim() !== ''))}`;
    case 'key_points':
      return `Point clé ${slot(form.key_points.map((v) => v.trim() !== ''))}`;
    case 'safety':
      return `Consigne de sécurité ${slot(form.safety.map((v) => v.trim() !== ''))}`;
    case 'mistakes': {
      const n = slot(form.mistakes.map((m) => m.mistake.trim() !== '' || m.fix.trim() !== ''));
      return sub === 'fix' ? `Correction ${n}` : `Erreur ${n}`;
    }
    case 'equipment_options':
      return `Option ${index + 1}`;
    default:
      return null;
  }
}

/** Message d'un refus du schéma pour un champ, en français (Zod n'en donne pas). */
function customText(message: string): string {
  if (message.startsWith('Obligatoire')) return 'Obligatoire.';
  if (message === 'Valeur en double') return 'Valeur en double.';
  if (message === 'Pose ou illustration en double') return 'Pose ou illustration en double.';
  if (message.startsWith('Option de matériel')) return 'Une option est en double ou incluse dans une autre.';
  if (message.startsWith('Les muscles secondaires')) {
    return 'Un muscle ne peut pas être à la fois principal et secondaire.';
  }
  return 'Valeur invalide.';
}

type Issue = {
  code: string;
  path: readonly PropertyKey[];
  message: string;
  origin?: string;
  minimum?: unknown;
  maximum?: unknown;
};

function issueText(issue: Issue, key: string): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'Obligatoire.';
    case 'too_small':
      if (issue.origin === 'string') return 'Obligatoire.';
      return Number(issue.minimum) <= 1 ? 'Au moins un choix.' : `Au moins ${String(issue.minimum)}.`;
    case 'too_big':
      return issue.origin === 'string'
        ? `${String(issue.maximum)} caractères au plus.`
        : `${String(issue.maximum)} au plus.`;
    case 'invalid_format':
      return key === 'batch'
        ? "A, B, ou E suivi d'un nombre de 1 à 99."
        : 'Lettres minuscules, chiffres et tirets seulement.';
    case 'custom':
      return customText(issue.message);
    default:
      return 'Valeur invalide.';
  }
}

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase('fr') + text.slice(1);
const FORM_KEY_SET: ReadonlySet<string> = new Set(FORM_KEYS);

/** Erreurs de la saisie : un message par champ (le premier), vide si la fiche passe le schéma de son statut. */
export type FormErrors = Partial<Record<FormKey, string>>;

/**
 * Validation côté client (spec brique 2 §3.6 : `invalid_sheet`, sans détail par champ côté serveur) : la fiche à
 * enregistrer passe `ExerciseSheetSchema` si elle doit être complète, `DraftSheetSchema` sinon. Les règles entre
 * fiches (alias, chaînes, manifeste) restent au serveur (422 `invalid_sheet`).
 */
export function formErrors(form: SheetForm, base: DraftSheet): FormErrors {
  const schema = mustBeComplete(base) ? ExerciseSheetSchema : DraftSheetSchema;
  const result = schema.safeParse(sheetOf(form, base));
  if (result.success) return {};
  const errors: FormErrors = {};
  for (const issue of result.error.issues as Issue[]) {
    const key = String(issue.path[0] ?? '');
    if (!FORM_KEY_SET.has(key)) continue;
    const formKey = key as FormKey;
    if (errors[formKey] !== undefined) continue;
    const text = issueText(issue, key);
    const index = issue.path[1];
    const slot = typeof index === 'number' ? slotName(form, formKey, index, issue.path[2]) : null;
    errors[formKey] = slot ? `${slot} : ${lowerFirst(text)}` : text;
  }
  return errors;
}

/** Valeur comparable d'un champ : les illustrations par pose, le reste tel quel. */
function comparable(key: FormKey, value: unknown): string {
  if (key === 'illustrations' && Array.isArray(value)) {
    const uses = value as { role: IllustrationRole }[];
    return JSON.stringify(
      [...uses].sort((a, b) => ILLUSTRATION_ROLES.indexOf(a.role) - ILLUSTRATION_ROLES.indexOf(b.role)),
    );
  }
  return JSON.stringify(value ?? null);
}

/**
 * Champs dont la saisie diffère de la version courante (409 `revision_conflict`, spec brique 2 §3.5), dans l'ordre
 * du formulaire : la saisie est gardée, la version courante écrite sous chacun d'eux.
 */
export function conflictingKeys(form: SheetForm, current: DraftSheet): FormKey[] {
  const typed = sheetOf(form, current);
  const saved = current as Record<string, unknown>;
  return FORM_KEYS.filter((key) => comparable(key, typed[key]) !== comparable(key, saved[key]));
}

/** La saisie, avec la valeur courante du champ `key` reprise. */
export function adoptCurrent(
  form: SheetForm,
  key: FormKey,
  current: DraftSheet,
  manifest: ReadonlyMap<string, IllustrationEntry>,
): SheetForm {
  return { ...form, [key]: formOf(current, manifest)[key] };
}

/** Valeur courante d'un champ en clair, pour « Version courante : … ». */
export function currentValueText(key: FormKey, sheet: DraftSheet): string {
  switch (key) {
    case 'mechanics':
      return MECHANICS_LABELS[sheet.mechanics];
    case 'measure':
      return MEASURE_LABELS[sheet.measure];
    case 'load_mode':
      return LOAD_MODE_LABELS[sheet.load_mode];
    case 'level':
      return levelText(sheet.level);
    default:
      return fieldValueText(key, (sheet as Record<string, unknown>)[key]);
  }
}

/** Nom d'un champ du formulaire (« Nom », « Étapes »…), comme dans le différentiel. */
export const formKeyLabel = (key: FormKey): string => fieldLabel(key);

/** Matériel proposé dans chaque choix, dans l'ordre de la taxonomie (04 §3.2). */
export const EQUIPMENT_CHOICES: readonly EquipmentCode[] = EQUIPMENT;
