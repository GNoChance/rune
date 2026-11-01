import { type ProgramTemplate, ProgramTemplateSchema, type SlotSpec } from '@rune/contracts';
import { buildChains } from '../catalog/chains';
import { feasible } from '../catalog/equipment';
import type { CatalogSheet } from '../catalog/usable';
import { normalize } from '../text';
import { workSetCount } from './effective';
import { currentRules } from './rules';
import { coverageGaps, referenceEquipment, volumeRange, weeklyVolume } from './volume';

/*
 * Validateur des modèles de programmes (05 §5, règles 1 à 7), lancé par `pnpm data:validate` sur chaque fichier de
 * `data/programs/`. La règle 8 (version augmentée) compare deux révisions du dépôt : c'est le script qui la tient.
 */

/** Codes d'erreur, dans l'ordre des règles de 05 §5. */
export const TEMPLATE_ISSUE_CODES = [
  'schema',
  'duplicate_id',
  'reps_order',
  'rir_too_low',
  'work_sets_count',
  'rest_bounds',
  'days_bounds',
  'coverage_missing',
  'coverage_needs_bodyweight',
  'unknown_exercise',
  'pattern_mismatch',
  'unknown_chain',
  'gym_first_not_reference',
  'volume_out_of_range',
  'forbidden_name',
] as const;
export type TemplateIssueCode = (typeof TEMPLATE_ISSUE_CODES)[number];

/** Erreur d'un modèle : `path` en notation pointée (`workouts.0.slots.1.sets.0.targetRir`), vide pour la racine. */
export interface TemplateIssue {
  code: TemplateIssueCode;
  path: string;
  message: string;
}

/** Noms de programmes déposés (05 §1.7) : aucun ne paraît dans un nom ou une description. */
export const FORBIDDEN_PROGRAM_NAMES = ['StrongLifts', 'Starting Strength', '5/3/1', 'Wendler'] as const;

type ZodIssue = NonNullable<ReturnType<typeof ProgramTemplateSchema.safeParse>['error']>['issues'][number];
type Path = readonly PropertyKey[];

const dotted = (path: Path) => path.map(String).join('.');
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** Valeur brute à `path`, sans hypothèse sur la forme. */
function valueAt(raw: unknown, path: Path): unknown {
  let value = raw;
  for (const key of path) {
    if (Array.isArray(value) && typeof key === 'number') value = value[key];
    else if (isRecord(value) && typeof key === 'string') value = value[key];
    else return undefined;
  }
  return value;
}

/**
 * Règle 2 sur le fichier brut : identifiants de séance, et de slot dans tout le modèle, en double. Chaque doublon
 * après le premier est signalé à son chemin.
 */
function duplicateIds(raw: unknown): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const workouts = new Set<unknown>();
  const slots = new Set<unknown>();
  const seen = (set: Set<unknown>, id: unknown, path: string, what: string) => {
    if (set.has(id))
      issues.push({ code: 'duplicate_id', path, message: `${what} « ${String(id)} » en double.` });
    set.add(id);
  };
  listOf(isRecord(raw) ? raw.workouts : undefined).forEach((workout, w) => {
    if (!isRecord(workout)) return;
    seen(workouts, workout.id, `workouts.${w}.id`, 'Séance');
    listOf(workout.slots).forEach((slot, s) => {
      if (isRecord(slot)) seen(slots, slot.id, `workouts.${w}.slots.${s}.id`, 'Slot');
    });
  });
  return issues;
}

/** Code d'une erreur du schéma : celui de la règle 2 ou 3 qu'elle traduit, sinon `schema`. */
function schemaCode(raw: unknown, issue: ZodIssue): TemplateIssueCode {
  const last = issue.path.at(-1);
  const bound = issue.code === 'too_small' || issue.code === 'too_big';
  if ((last === 'reps' || last === 'durationS') && issue.code === 'custom') return 'reps_order';
  if (last === 'targetRir' && issue.code === 'too_small') return 'rir_too_low';
  if (last === 'restS' && bound) return 'rest_bounds';
  if (issue.path[0] === 'daysPerWeek' && (bound || issue.code === 'custom')) return 'days_bounds';
  if (last === 'count' && bound && valueAt(raw, [...issue.path.slice(0, -1), 'kind']) === 'work') {
    return 'work_sets_count';
  }
  return 'schema';
}

/** Règle 1 : erreurs du schéma, traduites en codes des règles 2 et 3 quand elles en relèvent. */
function schemaIssues(raw: unknown, issues: readonly ZodIssue[]): TemplateIssue[] {
  return issues.flatMap((issue): TemplateIssue[] => {
    if (issue.path.length === 0 && issue.code === 'custom') {
      const duplicates = duplicateIds(raw);
      if (duplicates.length > 0) return duplicates;
    }
    return [{ code: schemaCode(raw, issue), path: dotted(issue.path), message: issue.message }];
  });
}

type SlotAt = { slot: SlotSpec; path: string };

const slotsOf = (template: ProgramTemplate): SlotAt[] =>
  template.workouts.flatMap((w, wi) =>
    w.slots.map((slot, si) => ({ slot, path: `workouts.${wi}.slots.${si}` })),
  );

/**
 * Règle 3, hors schéma : RIR des slots `main` débutants, nombre de séries de travail, repos. Bornes des règles en
 * vigueur (`programBounds`, `restS`).
 */
function coherenceIssues(template: ProgramTemplate): TemplateIssue[] {
  const { programBounds, restS } = currentRules();
  const minRir = programBounds.minRirBeginnerCompound;
  const [minSets, maxSets] = programBounds.workSets;
  const issues: TemplateIssue[] = [];
  for (const { slot, path } of slotsOf(template)) {
    slot.sets.forEach((set, i) => {
      const at = `${path}.sets.${i}`;
      const lowRir =
        set.kind === 'work' &&
        template.level === 'beginner' &&
        slot.role === 'main' &&
        set.targetRir !== undefined &&
        set.targetRir < minRir;
      if (lowRir) {
        issues.push({
          code: 'rir_too_low',
          path: `${at}.targetRir`,
          message: `RIR ${minRir} au moins sur un slot principal d'un modèle débutant.`,
        });
      }
      if (set.restS !== undefined && (set.restS < restS[0] || set.restS > restS[1])) {
        issues.push({
          code: 'rest_bounds',
          path: `${at}.restS`,
          message: `Repos de ${restS[0]} à ${restS[1]} s (${set.restS} s).`,
        });
      }
    });
    const work = workSetCount(slot);
    if (work < minSets || work > maxSets) {
      issues.push({
        code: 'work_sets_count',
        path: `${path}.sets`,
        message: `De ${minSets} à ${maxSets} séries de travail par slot (${work}).`,
      });
    }
  }
  return issues;
}

/** Règle 4 : une erreur par groupe et par code, avec les semaines en défaut. */
function coverageIssues(template: ProgramTemplate, catalog: readonly CatalogSheet[]): TemplateIssue[] {
  const byKey = new Map<string, { code: TemplateIssueCode; group: string; weeks: string[] }>();
  for (const gap of coverageGaps(template, catalog)) {
    const key = `${gap.code}\n${gap.group}`;
    const entry = byKey.get(key) ?? { code: gap.code, group: gap.group, weeks: [] };
    entry.weeks.push(`semaine ${gap.week} à ${gap.days} jours`);
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ code, group, weeks }) => ({
    code,
    path: 'workouts',
    message:
      code === 'coverage_missing'
        ? `Aucun slot du groupe ${group} : ${weeks.join(', ')}.`
        : `Aucun slot du groupe ${group} faisable au poids du corps (home_bodyweight) : ${weeks.join(', ')}.`,
  }));
}

/** Règle 5 : fiches et chaînes du catalogue (tous statuts), type de mouvement, tête de liste à la salle. */
function referenceIssues(template: ProgramTemplate, catalog: readonly CatalogSheet[]): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const chains = buildChains(catalog);
  const gym = template.context === 'gym' ? referenceEquipment('gym') : null;
  for (const { slot, path } of slotsOf(template)) {
    (slot.exercises ?? []).forEach((id, i) => {
      const sheet = byId.get(id);
      if (sheet === undefined) {
        issues.push({
          code: 'unknown_exercise',
          path: `${path}.exercises.${i}`,
          message: `Fiche « ${id} » absente.`,
        });
      } else if (sheet.movement_pattern !== slot.movementPattern) {
        issues.push({
          code: 'pattern_mismatch',
          path: `${path}.exercises.${i}`,
          message: `« ${id} » est un ${sheet.movement_pattern}, le slot un ${slot.movementPattern}.`,
        });
      }
    });
    if (slot.chain !== undefined && !chains.has(slot.chain)) {
      issues.push({
        code: 'unknown_chain',
        path: `${path}.chain`,
        message: `Chaîne « ${slot.chain} » absente.`,
      });
    }
    const first =
      slot.chain === undefined ? byId.get(slot.exercises?.[0] ?? '') : chains.get(slot.chain)?.[0];
    if (gym !== null && first !== undefined && !feasible(first, gym)) {
      issues.push({
        code: 'gym_first_not_reference',
        path: slot.chain === undefined ? `${path}.exercises.0` : `${path}.chain`,
        message: `« ${first.id} » n'est pas faisable dans la salle de référence (gym_reference).`,
      });
    }
  }
  return issues;
}

/** Règle 6 : chaque groupe de volume dans la fourchette du modèle. */
function volumeIssues(template: ProgramTemplate, catalog: readonly CatalogSheet[]): TemplateIssue[] {
  const [min, max] = volumeRange(template);
  const volume = weeklyVolume(template, catalog, referenceEquipment(template.context));
  return Object.entries(volume)
    .filter(([, sets]) => sets < min || sets > max)
    .map(([group, sets]) => ({
      code: 'volume_out_of_range',
      path: `volume.${group}`,
      message: `${String(sets).replace('.', ',')} séries par semaine pour ${group}, hors de ${min} à ${max}.`,
    }));
}

/** Nom interdit trouvé dans `text`, à la casse, aux accents, aux espaces et à la ponctuation près. */
function forbiddenNameIn(text: string): string | undefined {
  const words = ` ${normalize(text)} `;
  const squashed = words.replaceAll(' ', '');
  return FORBIDDEN_PROGRAM_NAMES.find((name) => {
    const target = normalize(name);
    return (
      words.includes(` ${target} `) ||
      (/^[a-z ]+$/.test(target) && squashed.includes(target.replaceAll(' ', '')))
    );
  });
}

/** Règle 7 : nom, description et noms des séances. */
function nameIssues(template: ProgramTemplate): TemplateIssue[] {
  const texts: [string, string][] = [
    ['name', template.name],
    ['description', template.description],
    ...template.workouts.map((w, i): [string, string] => [`workouts.${i}.name`, w.name]),
  ];
  return texts.flatMap(([path, text]) => {
    const name = forbiddenNameIn(text);
    return name === undefined
      ? []
      : [{ code: 'forbidden_name' as const, path, message: `« ${name} » est un nom déposé (05 §1.7).` }];
  });
}

/**
 * Règles 1 à 7 de 05 §5 sur un fichier de modèle. `catalog` : toutes les fiches du dépôt, tous statuts (la règle 5
 * vérifie l'existence et le type, pas la publication). Un fichier qui ne passe pas le schéma ne rend que les erreurs
 * du schéma. Rend `[]` pour un modèle valide.
 */
export function validateTemplate(raw: unknown, catalog: readonly CatalogSheet[]): TemplateIssue[] {
  const parsed = ProgramTemplateSchema.safeParse(raw);
  if (!parsed.success) return schemaIssues(raw, parsed.error.issues);
  const template = parsed.data;
  return [
    ...coherenceIssues(template),
    ...coverageIssues(template, catalog),
    ...referenceIssues(template, catalog),
    ...volumeIssues(template, catalog),
    ...nameIssues(template),
  ];
}

/**
 * Disponibilité d'un modèle (05 §5, spec brique 3 §3.6) : chaque slot a au moins une fiche publiée de sa liste, ou
 * un membre publié de sa chaîne.
 */
export function templateAvailable(template: ProgramTemplate, catalog: readonly CatalogSheet[]): boolean {
  const published = catalog.filter((s) => s.status === 'published');
  const ids = new Set(published.map((s) => s.id));
  const chains = new Set(published.flatMap((s) => (s.chain_id === undefined ? [] : [s.chain_id])));
  return template.workouts.every((w) =>
    w.slots.every((slot) =>
      slot.chain === undefined ? (slot.exercises ?? []).some((id) => ids.has(id)) : chains.has(slot.chain),
    ),
  );
}
