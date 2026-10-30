import {
  CATALOG_MAX_SHEETS,
  DraftSheetSchema,
  EQUIPMENT,
  type EquipmentCode,
  type IllustrationEntry,
  LOAD_MODES,
  type LoadMode,
  MOVEMENT_PATTERNS,
  type MovementPattern,
  patternGroup,
} from '@rune/contracts';
import { normalize } from '../text';
import { missingRequiredKeys } from './blockers';
import { canonicalJson } from './canonical';

/*
 * Validateur du catalogue (04 §13, critère 1 ; spec brique 2 §2) : `pnpm data:validate` en CI et le chargeur du
 * serveur. `ExerciseSheetSchema` ne juge qu'une fiche à la fois ; ce module y ajoute les règles entre fichiers
 * (nom de fichier, forme canonique, alias, chaînes, manifeste, modèles, plafond) et le mode de charge par
 * rapport au matériel. Les chemins des erreurs sont relatifs au dossier `data/`.
 */

/** Dossier des fiches, relatif à `data/` (04 §10) : les erreurs qui portent sur tout le catalogue y renvoient. */
export const EXERCISES_DIR = 'exercises';
/** Manifeste des illustrations, relatif à `data/`. */
export const MANIFEST_FILE = 'illustrations/manifest.json';
/** Fichiers d'illustrations, relatif à `data/`. */
export const ILLUSTRATION_FILES_DIR = 'illustrations/files';

/** Codes d'erreur, dans l'ordre où ils sont rendus pour un même fichier. */
export const CATALOG_ERROR_CODES = [
  'invalid_sheet',
  'unknown_code',
  'incomplete',
  'id_mismatch',
  'duplicate_id',
  'not_canonical',
  'duplicate_alias',
  'equipment_option_redundant',
  'load_mode_mismatch',
  'chain_pointer',
  'chain_not_reciprocal',
  'chain_branch',
  'chain_cycle',
  'chain_discontinuous',
  'chain_muscles',
  'chain_pattern_group',
  'chain_level',
  'illustration_unknown',
  'illustration_sources_mixed',
  'duplicate_illustration',
  'illustration_file_missing',
  'illustration_hash_mismatch',
  'retired_in_template',
  'catalog_full',
  'equipment_unused',
] as const;
export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[number];

export type CatalogError = { file: string; code: CatalogErrorCode; message: string };

/**
 * Un fichier de fiche : `file`, son chemin relatif à `data/` (`exercises/<id>.json`) ; `json`, son contenu lu ;
 * `text`, son texte brut, comparé à la forme canonique s'il est fourni (sinon ce contrôle est sauté).
 */
export type CatalogFile = { file: string; json: unknown; text?: string };

/**
 * Entrée du validateur.
 * - `manifest` : entrées déjà validées par `IllustrationManifest`.
 * - `templates` : modèles de programmes (`data/programs/*.json`), lus sans hypothèse sur leur forme.
 * - `illustrationFiles` : sha256 des octets de chaque fichier de `illustrations/files/`, par nom ; absent, la
 *   présence et l'empreinte des fichiers ne sont pas vérifiées.
 */
export type CatalogInput = {
  sheets: readonly CatalogFile[];
  manifest: readonly IllustrationEntry[];
  templates: readonly unknown[];
  illustrationFiles?: ReadonlyMap<string, string>;
};

/**
 * `strict` : exige aussi R-EQ-5 (chaque code de matériel utilisé par au moins une fiche non retirée), en CI une
 * fois le lot A publié.
 */
export type CatalogValidationOptions = { strict?: boolean };

export type CatalogValidation = { ok: boolean; errors: CatalogError[] };

/**
 * Matériel qui porte la charge, par mode de charge (04 §3.6). Interprétation de « toutes les options ont le même
 * mode de charge » : en `barbell`, `dumbbell`, `machine` et `band`, chaque option contient un de ces codes, sinon
 * elle ne mesure pas la charge de ce mode et il faut une seconde fiche (`[[]]` ne convient donc jamais). Les
 * codes `machines` (dont `smith_machine`) valent `machine`. `bodyweight` et `weighted` ne sont pas contrôlés : la
 * barre fixe d'un rowing inversé, l'élastique d'assistance ou le lest peuvent varier d'une option à l'autre.
 */
export const LOAD_EQUIPMENT: Readonly<Partial<Record<LoadMode, readonly EquipmentCode[]>>> = {
  barbell: ['barbell', 'ez_bar'],
  dumbbell: ['dumbbells', 'kettlebell'],
  machine: [
    'cable_station',
    'lat_pulldown',
    'seated_row',
    'leg_press',
    'smith_machine',
    'leg_extension',
    'leg_curl',
    'upper_body_machines',
  ],
  band: ['resistance_band'],
};

/** Champs dont les valeurs sont des codes de la taxonomie partagée (04 §3). */
const TAXONOMY_FIELDS: ReadonlySet<string> = new Set([
  'movement_pattern',
  'load_mode',
  'primary_muscles',
  'secondary_muscles',
  'equipment_options',
  'stressed_joints',
  'level',
]);

type Json = Readonly<Record<string, unknown>>;
type Report = (file: string, code: CatalogErrorCode, message: string) => void;
/** Fiche lisible (un objet avec un `id` texte), pour les règles entre fiches. */
type Entry = { file: string; id: string; record: Json };

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const isLoadMode = (value: unknown): value is LoadMode => LOAD_MODES.some((m) => m === value);
const isPattern = (value: unknown): value is MovementPattern => MOVEMENT_PATTERNS.some((p) => p === value);
/** Ordre binaire des chaînes (comme `<`), jamais `localeCompare`. */
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Les fiches retirées sortent des chaînes (R-CH-6) et du plafond ; un statut invalide compte comme actif. */
const isActive = (record: Json) => record.status !== 'retired';

function valueAt(record: Json, path: readonly PropertyKey[]): unknown {
  let value: unknown = record;
  for (const key of path) value = (value as Record<PropertyKey, unknown> | undefined)?.[key];
  return value;
}

/** Nom de fichier sans dossier ni `.json`. */
function baseName(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? file;
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
}

/**
 * Schéma de la fiche (`DraftSheetSchema`) : les champs IA peuvent manquer en `draft` et `retired` (R-FIC-1). En
 * `reviewed` et `published`, les clés obligatoires absentes donnent un seul `incomplete` (même règle que le
 * blocage `incomplete`), et le reste est jugé comme pour un brouillon. Un code hors taxonomie et une option de
 * matériel en double ou incluse ont leur propre code.
 */
function checkSchema(file: string, record: Json, report: Report): void {
  const complete = record.status === 'reviewed' || record.status === 'published';
  const missing = complete ? missingRequiredKeys(record) : [];
  if (missing.length > 0) {
    report(
      file,
      'incomplete',
      `Champs obligatoires vides au statut ${String(record.status)} (R-FIC-1) : ${missing.join(', ')}.`,
    );
  }
  const result = DraftSheetSchema.safeParse(complete ? { ...record, status: 'draft' } : record);
  if (result.success) return;
  for (const issue of result.error.issues) {
    const head = String(issue.path[0] ?? '');
    if (issue.path.length === 1 && missing.includes(head)) continue;
    const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(fiche)';
    if (issue.code === 'invalid_value' && TAXONOMY_FIELDS.has(head)) {
      const value = JSON.stringify(valueAt(record, issue.path));
      report(file, 'unknown_code', `${where} : ${value} n'est pas un code de la taxonomie (04 §3).`);
    } else if (issue.code === 'custom' && issue.path.length === 1 && head === 'equipment_options') {
      report(
        file,
        'equipment_option_redundant',
        'equipment_options : une option est en double ou en contient une autre (04 §4).',
      );
    } else {
      report(file, 'invalid_sheet', `${where} : ${issue.message}`);
    }
  }
}

function checkLoadMode(file: string, record: Json, report: Report): void {
  const mode = record.load_mode;
  if (!isLoadMode(mode)) return;
  const carriers: readonly string[] | undefined = LOAD_EQUIPMENT[mode];
  if (carriers === undefined) return;
  for (const option of list(record.equipment_options)) {
    const codes = strings(option);
    if (codes.some((code) => carriers.includes(code))) continue;
    report(
      file,
      'load_mode_mismatch',
      `L'option [${codes.join(', ')}] ne porte pas la charge du mode ${mode} (${carriers.join(' ou ')} attendu) : ` +
        'toutes les options ont le même mode de charge, sinon crée une seconde fiche (04 §3.6).',
    );
  }
}

/** Illustrations de la fiche : toutes dans le manifeste, et d'une seule source (04 §12, règle 4). */
function checkIllustrations(
  file: string,
  record: Json,
  manifest: ReadonlyMap<string, IllustrationEntry>,
  report: Report,
): void {
  const sources = new Set<string>();
  for (const use of list(record.illustrations)) {
    const id = isRecord(use) ? str(use.illustration_id) : undefined;
    if (id === undefined) continue;
    const entry = manifest.get(id);
    if (entry === undefined) {
      report(file, 'illustration_unknown', `L'illustration « ${id} » n'est pas dans ${MANIFEST_FILE}.`);
    } else {
      sources.add(entry.source);
    }
  }
  if (sources.size > 1) {
    report(
      file,
      'illustration_sources_mixed',
      `Illustrations de plusieurs sources (${[...sources].sort(binary).join(', ')}) : une seule par fiche (04 §12).`,
    );
  }
}

/** Contrôles d'un fichier seul. Rend la fiche pour les règles entre fiches si elle a un `id` texte. */
function checkFile(
  sheet: CatalogFile,
  manifest: ReadonlyMap<string, IllustrationEntry>,
  report: Report,
): Entry | null {
  const { file, json } = sheet;
  if (!isRecord(json)) {
    report(file, 'invalid_sheet', "La fiche n'est pas un objet JSON.");
    return null;
  }
  checkSchema(file, json, report);
  const id = str(json.id);
  if (id !== undefined && id !== baseName(file)) {
    report(file, 'id_mismatch', `L'id « ${id} » diffère du nom de fichier « ${baseName(file)} » (04 §4).`);
  }
  if (sheet.text !== undefined && sheet.text !== canonicalJson(json)) {
    report(
      file,
      'not_canonical',
      "Le fichier n'est pas en forme canonique (ordre des clés de 04 §4, 2 espaces, LF, un LF final) : " +
        'réécris-le avec canonicalJson (04 §10).',
    );
  }
  checkLoadMode(file, json, report);
  checkIllustrations(file, json, manifest, report);
  return id === undefined ? null : { file, id, record: json };
}

/** Alias uniques dans tout le catalogue après `normalize`, y compris face aux noms des fiches (04 §4). */
function checkAliases(entries: readonly Entry[], report: Report): void {
  const names = new Map<string, string>();
  for (const { id, record } of entries) {
    const name = normalize(str(record.name) ?? '');
    if (name !== '' && !names.has(name)) names.set(name, id);
  }
  const aliases = new Map<string, string>();
  for (const { file, id, record } of entries) {
    for (const alias of strings(record.aliases)) {
      const key = normalize(alias);
      if (key === '') continue;
      const named = names.get(key);
      const owner = aliases.get(key);
      if (named !== undefined) {
        report(
          file,
          'duplicate_alias',
          `L'alias « ${alias} » reprend le nom de la fiche ${named} après normalize.`,
        );
      } else if (owner !== undefined) {
        report(
          file,
          'duplicate_alias',
          `L'alias « ${alias} » est déjà un alias de la fiche ${owner} après normalize.`,
        );
      } else {
        aliases.set(key, id);
      }
    }
  }
}

const POINTERS = [
  ['easier_id', 'harder_id'],
  ['harder_id', 'easier_id'],
] as const;

/** Pointeurs `easier_id` / `harder_id` des fiches non retirées (04 §4, R-CH-1, R-CH-6). */
function checkPointers(active: readonly Entry[], byId: ReadonlyMap<string, Entry>, report: Report): void {
  for (const { file, id, record } of active) {
    const chain = str(record.chain_id);
    for (const [key, back] of POINTERS) {
      const target = str(record[key]);
      if (target === undefined) continue;
      const other = byId.get(target);
      if (chain === undefined) {
        report(
          file,
          'chain_pointer',
          `${key} sans chain_id : les pointeurs relient les membres d'une chaîne.`,
        );
      } else if (target === id) {
        report(file, 'chain_pointer', `${key} pointe vers la fiche elle-même.`);
      } else if (other === undefined) {
        report(file, 'chain_pointer', `${key} pointe vers « ${target} », absente du catalogue.`);
      } else if (!isActive(other.record)) {
        report(
          file,
          'chain_discontinuous',
          `${key} pointe vers « ${target} », retirée donc sortie de la chaîne : relie d'abord ses voisines (R-CH-6).`,
        );
      } else if (str(other.record.chain_id) !== chain) {
        report(file, 'chain_pointer', `${key} pointe vers « ${target} », hors de la chaîne ${chain}.`);
      } else if (str(other.record[back]) !== id) {
        report(
          file,
          'chain_not_reciprocal',
          `${key} vaut ${target}, mais ${target}.${back} ne vaut pas ${id} (R-CH-1).`,
        );
      }
    }
  }
}

/** Premier cycle de `next` (au plus un successeur par membre), du membre répété à son retour ; sinon null. */
function findCycle(ids: readonly string[], next: ReadonlyMap<string, string>): string[] | null {
  const done = new Set<string>();
  for (const start of ids) {
    const path: string[] = [];
    let id: string | undefined = start;
    while (id !== undefined && !done.has(id)) {
      const seen = path.indexOf(id);
      if (seen !== -1) return [...path.slice(seen), id];
      path.push(id);
      id = next.get(id);
    }
    for (const p of path) done.add(p);
  }
  return null;
}

/**
 * Une chaîne, membres non retirés triés par `id` : chemin linéaire (R-CH-2), muscles et groupe (R-CH-3), niveau
 * (R-CH-4). Les erreurs de la chaîne entière vont au fichier de son premier membre par `id`.
 */
function checkChain(chainId: string, members: readonly Entry[], report: Report): void {
  const byId = new Map(members.map((m) => [m.id, m]));
  const inChain = (value: unknown) => {
    const id = str(value);
    return id !== undefined && byId.has(id) ? id : undefined;
  };
  const first = members[0]?.file ?? EXERCISES_DIR;

  for (const key of ['harder_id', 'easier_id'] as const) {
    const sources = new Map<string, string[]>();
    for (const m of members) {
      const target = inChain(m.record[key]);
      if (target !== undefined) sources.set(target, [...(sources.get(target) ?? []), m.id]);
    }
    for (const [target, from] of [...sources].sort(([a], [b]) => binary(a, b))) {
      if (from.length < 2) continue;
      const file = byId.get(target)?.file ?? first;
      report(
        file,
        'chain_branch',
        `Plusieurs fiches ont ${target} pour ${key} : ${from.join(', ')} (R-CH-2).`,
      );
    }
  }

  const next = new Map<string, string>();
  for (const m of members) {
    const harder = inChain(m.record.harder_id);
    if (harder !== undefined) next.set(m.id, harder);
  }
  const cycle = members.length > 1 ? findCycle([...byId.keys()], next) : null;
  if (members.length === 1) {
    report(
      first,
      'chain_discontinuous',
      `La chaîne ${chainId} n'a qu'un membre : retire chain_id ou relie une voisine.`,
    );
  } else if (cycle !== null) {
    report(first, 'chain_cycle', `La chaîne ${chainId} forme un cycle : ${cycle.join(' → ')} (R-CH-2).`);
  } else {
    const heads = members.filter((m) => inChain(m.record.easier_id) === undefined).map((m) => m.id);
    const path = new Set<string>();
    for (let id = heads.length === 1 ? heads[0] : undefined; id !== undefined; id = next.get(id))
      path.add(id);
    const outside = members.filter((m) => !path.has(m.id)).map((m) => m.id);
    if (heads.length !== 1 || outside.length > 0) {
      report(
        first,
        'chain_discontinuous',
        `La chaîne ${chainId} n'est pas un seul chemin : début(s) ${heads.join(', ') || 'aucun'}` +
          (heads.length === 1 ? `, hors du chemin ${outside.join(', ')}` : '') +
          ' (R-CH-2).',
      );
    }
  }

  const muscles = members
    .map((m) => m.record.primary_muscles)
    .filter(Array.isArray)
    .map(strings);
  const common = muscles.reduce((acc, ms) => acc.filter((m) => ms.includes(m)), muscles[0] ?? []);
  if (muscles.length > 1 && common.length === 0) {
    report(
      first,
      'chain_muscles',
      `Les membres de la chaîne ${chainId} n'ont aucun muscle principal commun (R-CH-3).`,
    );
  }
  const groups = new Set(
    members
      .map((m) => m.record.movement_pattern)
      .filter(isPattern)
      .map((p) => patternGroup(p)),
  );
  if (groups.size > 1) {
    report(
      first,
      'chain_pattern_group',
      `La chaîne ${chainId} mêle des groupes de couverture (${[...groups].sort(binary).join(', ')}) (R-CH-3).`,
    );
  }

  for (const [from, to] of next) {
    const a = byId.get(from);
    const b = byId.get(to);
    const levelA = a?.record.level;
    const levelB = b?.record.level;
    if (b !== undefined && typeof levelA === 'number' && typeof levelB === 'number' && levelB < levelA) {
      report(b.file, 'chain_level', `Le niveau baisse de ${from} (${levelA}) à ${to} (${levelB}) (R-CH-4).`);
    }
  }
}

function checkChains(entries: readonly Entry[], byId: ReadonlyMap<string, Entry>, report: Report): void {
  const active = entries.filter((e) => isActive(e.record));
  checkPointers(active, byId, report);
  const chains = new Map<string, Entry[]>();
  for (const entry of active) {
    const chainId = str(entry.record.chain_id);
    if (chainId !== undefined) chains.set(chainId, [...(chains.get(chainId) ?? []), entry]);
  }
  for (const [chainId, members] of [...chains].sort(([a], [b]) => binary(a, b))) {
    checkChain(
      chainId,
      [...members].sort((a, b) => binary(a.id, b.id)),
      report,
    );
  }
}

/** Manifeste : ids et fichiers uniques ; si les fichiers sont fournis, présence et empreinte (04 §12, règle 5). */
function checkManifest(
  manifest: readonly IllustrationEntry[],
  files: ReadonlyMap<string, string> | undefined,
  report: Report,
): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const entry of manifest) {
    if (ids.has(entry.id)) {
      report(MANIFEST_FILE, 'duplicate_illustration', `L'illustration « ${entry.id} » y figure deux fois.`);
    } else if (names.has(entry.file)) {
      report(MANIFEST_FILE, 'duplicate_illustration', `Le fichier « ${entry.file} » y figure deux fois.`);
    }
    ids.add(entry.id);
    names.add(entry.file);
    if (files === undefined) continue;
    const path = `${ILLUSTRATION_FILES_DIR}/${entry.file}`;
    const sha256 = files.get(entry.file);
    if (sha256 === undefined) {
      report(path, 'illustration_file_missing', `Fichier absent, alors que ${MANIFEST_FILE} le cite.`);
    } else if (sha256 !== entry.sha256) {
      report(
        path,
        'illustration_hash_mismatch',
        `L'empreinte du fichier diffère du sha256 de ${MANIFEST_FILE}.`,
      );
    }
  }
}

/**
 * Une fiche retirée n'est citée par aucun modèle de programme chargé, dans une liste de slot (04 §8, transition
 * `→ retired`). Seule la forme `workouts[].slots[].exercises[]` (05 §4) est lue ; le reste des modèles relève du
 * validateur de Programmes.
 */
function checkTemplates(
  templates: readonly unknown[],
  byId: ReadonlyMap<string, Entry>,
  report: Report,
): void {
  const reported = new Set<string>();
  for (const template of templates) {
    if (!isRecord(template)) continue;
    const name = str(template.id) ?? '(sans id)';
    const cited = list(template.workouts)
      .flatMap((w) => (isRecord(w) ? list(w.slots) : []))
      .flatMap((s) => (isRecord(s) ? strings(s.exercises) : []));
    for (const id of cited) {
      const entry = byId.get(id);
      const key = `${name}\n${id}`;
      if (entry === undefined || isActive(entry.record) || reported.has(key)) continue;
      reported.add(key);
      report(
        entry.file,
        'retired_in_template',
        `Fiche retirée, mais le modèle ${name} la cite dans un slot (04 §8).`,
      );
    }
  }
}

/**
 * Valide le catalogue entier (04 §13, critère 1, et spec brique 2 §2). Fonction pure : rend toutes les erreurs,
 * triées par fichier (ordre binaire), puis dans l'ordre de `CATALOG_ERROR_CODES`, puis par message. Une fiche
 * invalide n'empêche pas les règles entre fiches : chacune lit ce qui a le bon type et laisse le reste au schéma.
 *
 * Ne juge pas si une nouvelle fiche peut entrer avec un statut autre que `draft` : c'est le chargeur qui décide
 * (spec brique 2 §3.6). R-EQ-5 seulement avec `strict`.
 */
export function validateCatalog(
  input: CatalogInput,
  options: CatalogValidationOptions = {},
): CatalogValidation {
  const errors: CatalogError[] = [];
  const report: Report = (file, code, message) => errors.push({ file, code, message });

  const manifest = new Map<string, IllustrationEntry>();
  for (const entry of input.manifest) if (!manifest.has(entry.id)) manifest.set(entry.id, entry);
  checkManifest(input.manifest, input.illustrationFiles, report);

  const sheets = [...input.sheets].sort((a, b) => binary(a.file, b.file));
  const entries: Entry[] = [];
  for (const sheet of sheets) {
    const entry = checkFile(sheet, manifest, report);
    if (entry !== null) entries.push(entry);
  }

  const byId = new Map<string, Entry>();
  for (const entry of entries) {
    const first = byId.get(entry.id);
    if (first === undefined) byId.set(entry.id, entry);
    else report(entry.file, 'duplicate_id', `L'id « ${entry.id} » est déjà celui de ${first.file}.`);
  }
  checkAliases(entries, report);
  checkChains(entries, byId, report);
  checkTemplates(input.templates, byId, report);

  const active = sheets.map((s) => s.json).filter((json): json is Json => isRecord(json) && isActive(json));
  if (active.length > CATALOG_MAX_SHEETS) {
    report(
      EXERCISES_DIR,
      'catalog_full',
      `${active.length} fiches non retirées : ${CATALOG_MAX_SHEETS} au plus, brouillons compris (spec brique 2 §2).`,
    );
  }
  if (options.strict === true) {
    const used = new Set(active.flatMap((json) => list(json.equipment_options).flatMap(strings)));
    for (const code of EQUIPMENT) {
      if (used.has(code)) continue;
      report(
        EXERCISES_DIR,
        'equipment_unused',
        `Le code de matériel « ${code} » n'est utilisé par aucune fiche non retirée (R-EQ-5).`,
      );
    }
  }

  const rank = (code: CatalogErrorCode) => CATALOG_ERROR_CODES.indexOf(code);
  errors.sort(
    (a, b) => binary(a.file, b.file) || rank(a.code) - rank(b.code) || binary(a.message, b.message),
  );
  return { ok: errors.length === 0, errors };
}
