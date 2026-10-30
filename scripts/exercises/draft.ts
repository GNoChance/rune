/**
 * `pnpm exercises:draft [--ids a,b] [--model <id>] [--max-tokens <n>] [--dir <dossier data>]` : rédige les
 * brouillons de fiches par l'API Claude (04 §9, étape 2 du circuit éditorial de 04 §8).
 *
 * - Lancé sur le poste de dev seulement, jamais en CI ni sur le serveur. Clé `ANTHROPIC_API_KEY` lue dans
 *   `.env.local` (ignoré par git) : clé d'un workspace Anthropic de développement, jamais affichée.
 * - Fiches traitées : les `draft` dont aucun champ IA n'est rempli, ou les ids passés par `--ids` (une fiche déjà
 *   rédigée est alors réécrite). Toute fiche qui n'est pas `draft` est refusée.
 * - Appel : modèle `claude-opus-5-5` par défaut, effort `high`, sortie structurée par le JSON Schema des champs IA
 *   (dérivé de Zod), partie fixe en cache (prompt, guide de style, glossaire, taxonomie, fiches étalons), puis le
 *   squelette et les noms des voisines de chaîne ; 4 appels en parallèle au plus, pas d'API Batch.
 * - Réponse : validée comme en CI (`ExerciseSheetSchema` complet, puis `validateCatalog` sur tout le catalogue),
 *   2 essais au plus ; seuls les champs IA changent, avec `drafting` renseigné, `revision` + 1 et le statut laissé
 *   à `draft` ; fichier écrit en forme canonique. Sinon le fichier reste intact.
 * - Aucune donnée personnelle envoyée : seuls des champs squelette listés ici partent vers l'API.
 *
 * Sortie 0 si tout est rédigé et le catalogue valide ; 1 sinon ; 2 pour une option inconnue.
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import {
  DraftSheetSchema,
  EQUIPMENT_LABELS,
  EXERCISE_AI_FIELDS,
  ExerciseSheetSchema,
  exerciseJsonSchema,
  JOINT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_LABELS,
} from '@rune/contracts';
import {
  type CatalogError,
  type CatalogFile,
  canonicalJson,
  EXERCISES_DIR,
  validateCatalog,
} from '@rune/domain';
import {
  type AiClient,
  type AiEffort,
  AiError,
  type CachedBlock,
  createAnthropicClient,
  DEFAULT_MAX_TOKENS,
} from '../../apps/server/src/ai/index';
import { DEFAULT_DATA_DIR, GLOSSARY_FILE, readCatalogInput, validateDataDir } from '../data/validate';

/** Modèle par défaut (04 §9), vérifié dans la documentation d'Anthropic (NOTES.md). */
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** Effort fixé explicitement (04 §9) : le défaut de Claude Opus 5.5 est `medium`. */
export const DRAFT_EFFORT: AiEffort = 'high';
/** Version du prompt (`prompt-v<n>.md`), notée dans `drafting.prompt_version`. */
export const PROMPT_VERSION = 1;
export const MAX_PARALLEL = 4;
export const MAX_ATTEMPTS = 2;
/** Fiches étalons (04 §8, étape 0), montrées au modèle une fois relues. */
export const REFERENCE_IDS = ['push-up', 'dumbbell-romanian-deadlift'] as const;

export const PROMPT_FILE = fileURLToPath(new URL(`./prompt-v${PROMPT_VERSION}.md`, import.meta.url));
export const STYLE_GUIDE_FILE = fileURLToPath(new URL('../../docs/catalog/style-guide.md', import.meta.url));
/** Fichier de la clé, à la racine du dépôt, ignoré par git. */
export const ENV_FILE = fileURLToPath(new URL('../../.env.local', import.meta.url));
export const API_KEY_VAR = 'ANTHROPIC_API_KEY';

const USAGE =
  'Usage : pnpm exercises:draft [--ids a,b] [--model <id>] [--max-tokens <n>] [--dir <dossier data>]';

const AI_FIELDS: ReadonlySet<string> = new Set(EXERCISE_AI_FIELDS);

/**
 * Seuls champs de la fiche envoyés à l'API (liste blanche) : le squelette utile à la rédaction. Ni `revision`,
 * ni `batch`, ni dates, ni `reviewed_by` (id de compte), ni illustrations.
 */
const PROMPT_SKELETON_KEYS = [
  'id',
  'name',
  'movement_pattern',
  'mechanics',
  'unilateral',
  'measure',
  'load_mode',
  'equipment_options',
  'level',
  'not_for_minors',
  'chain_id',
  'easier_id',
  'harder_id',
] as const;

/** Champs d'une fiche étalon montrés au modèle : squelette et textes, sans `review_notes`. */
const REFERENCE_KEYS = [...PROMPT_SKELETON_KEYS, ...EXERCISE_AI_FIELDS.filter((k) => k !== 'review_notes')];

export type DraftStatus = 'drafted' | 'refused' | 'failed' | 'skipped';

/** Bilan d'une fiche : `refused` sans appel, `failed` après appel(s), `skipped` après une erreur fatale. */
export type DraftOutcome = {
  id: string;
  status: DraftStatus;
  attempts: number;
  costUsd: number;
  message?: string;
};

export type DraftOptions = {
  dataDir: string;
  client: AiClient;
  /** `DEFAULT_MODEL` à défaut. */
  model?: string;
  /** Ids demandés ; à défaut, les brouillons aux champs IA vides. */
  ids?: readonly string[];
  maxTokens?: number;
  now?: () => Date;
};

export type DraftResult = { outcomes: DraftOutcome[]; costUsd: number };

type Json = Record<string, unknown>;

/** Fiche à rédiger : son fichier et son JSON tel que lu. */
type Target = { id: string; file: string; json: Json };

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sheetFile = (id: string) => `${EXERCISES_DIR}/${id}.json`;

const pick = (record: Json, keys: readonly string[]): Json =>
  Object.fromEntries(keys.filter((k) => record[k] !== undefined).map((k) => [k, record[k]]));

const hasAiField = (json: Json) => EXERCISE_AI_FIELDS.some((k) => json[k] !== undefined);

const issuesOf = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
  issues.map((issue) => `${issue.path.map(String).join('.') || '(fiche)'} : ${issue.message}`);

/** Fiche demandée → fiche à rédiger, ou motif du refus (aucun appel). */
function check(id: string, entry: CatalogFile | undefined): Target | string {
  if (entry === undefined) return `Fiche introuvable : ${sheetFile(id)}.`;
  const json = entry.json;
  if (!isRecord(json)) return "La fiche n'est pas un objet JSON.";
  if (json.status !== 'draft') {
    return `Statut ${String(json.status)} : seules les fiches draft sont rédigées (04 §9).`;
  }
  if (json.id !== id) return `L'id « ${String(json.id)} » ne correspond pas au fichier ${entry.file}.`;
  const parsed = DraftSheetSchema.safeParse(json);
  if (!parsed.success) {
    return `Squelette invalide, à corriger avant la rédaction : ${issuesOf(parsed.error.issues).join(' ; ')}.`;
  }
  return { id, file: entry.file, json };
}

/** Fiches à traiter, dans l'ordre de `--ids` ou des fichiers. */
function select(
  catalog: ReadonlyMap<string, CatalogFile>,
  ids: readonly string[] | undefined,
): (Target | { id: string; refused: string })[] {
  const asked = (id: string) => {
    const checked = check(id, catalog.get(sheetFile(id)));
    return typeof checked === 'string' ? { id, refused: checked } : checked;
  };
  if (ids !== undefined) return [...new Set(ids)].map(asked);
  const plan: (Target | { id: string; refused: string })[] = [];
  for (const entry of [...catalog.values()].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
  )) {
    const json = entry.json;
    if (!isRecord(json) || json.status !== 'draft' || hasAiField(json)) continue;
    const id = entry.file.slice(EXERCISES_DIR.length + 1, -'.json'.length);
    plan.push(asked(id));
  }
  return plan;
}

/** Taxonomie de l'appli, codes et libellés : les codes que le schéma impose, et les noms du matériel. */
function taxonomyText(): string {
  const list = (labels: Readonly<Record<string, string>>) =>
    Object.entries(labels)
      .map(([code, label]) => `- \`${code}\` : ${label}`)
      .join('\n');
  return [
    "# Taxonomie de l'appli (codes et libellés)",
    `## Muscles (\`primary_muscles\`, \`secondary_muscles\`)\n\n${list(MUSCLE_LABELS)}`,
    `## Articulations (\`stressed_joints\`)\n\n${list(JOINT_LABELS)}`,
    `## Matériel (\`equipment_options\`)\n\n${list(EQUIPMENT_LABELS)}`,
    `## Types de mouvement (\`movement_pattern\`)\n\n${list(MOVEMENT_PATTERN_LABELS)}`,
  ].join('\n\n');
}

/** Fiches étalons relues (`reviewed` ou `published`) et complètes ; les autres sont ignorées. */
function referencesText(catalog: ReadonlyMap<string, CatalogFile>): string {
  const sheets = REFERENCE_IDS.flatMap((id) => {
    const parsed = ExerciseSheetSchema.safeParse(catalog.get(sheetFile(id))?.json);
    if (!parsed.success || (parsed.data.status !== 'reviewed' && parsed.data.status !== 'published'))
      return [];
    return [`## ${id}\n\n\`\`\`json\n${canonicalJson(pick(parsed.data, REFERENCE_KEYS)).trimEnd()}\n\`\`\``];
  });
  if (sheets.length === 0) {
    return "# Fiches étalons\n\nAucune fiche étalon n'est encore relue : suis le guide de style.";
  }
  return [
    '# Fiches étalons',
    'Fiches écrites et relues à la main : modèle de ton, de longueur et de niveau de détail. Ne recopie pas leurs phrases.',
    ...sheets,
  ].join('\n\n');
}

/** Partie fixe du message système, identique pour toutes les fiches du lot : un point de cache, à la fin. */
async function fixedSystem(
  dataDir: string,
  catalog: ReadonlyMap<string, CatalogFile>,
): Promise<CachedBlock[]> {
  const [prompt, styleGuide, glossary] = await Promise.all([
    readFile(PROMPT_FILE, 'utf8'),
    readFile(STYLE_GUIDE_FILE, 'utf8'),
    readFile(join(dataDir, GLOSSARY_FILE), 'utf8'),
  ]);
  return [
    { text: prompt.trim() },
    { text: styleGuide.trim() },
    { text: `# Glossaire (\`data/glossary.json\`)\n\n\`\`\`json\n${glossary.trim()}\n\`\`\`` },
    { text: taxonomyText() },
    { text: referencesText(catalog), cache: true },
  ];
}

/** Message variable : le squelette (liste blanche) et les noms des voisines de chaîne. */
function userMessage(target: Target, catalog: ReadonlyMap<string, CatalogFile>): string {
  const neighbour = (label: string, key: 'easier_id' | 'harder_id') => {
    const id = target.json[key];
    if (typeof id !== 'string') return [];
    const json = catalog.get(sheetFile(id))?.json;
    const name = isRecord(json) && typeof json.name === 'string' ? `« ${json.name} »` : '(fiche absente)';
    return [`- ${label} : \`${id}\`, ${name}`];
  };
  const neighbours = [...neighbour('Plus facile', 'easier_id'), ...neighbour('Plus difficile', 'harder_id')];
  return [
    'Rédige les champs IA de cette fiche.',
    `## Squelette (fixé)\n\n\`\`\`json\n${canonicalJson(pick(target.json, PROMPT_SKELETON_KEYS)).trimEnd()}\n\`\`\``,
    `## Voisines de chaîne\n\n${neighbours.length > 0 ? neighbours.join('\n') : "Aucune : la fiche n'est dans aucune chaîne."}`,
  ].join('\n\n');
}

const retryNote = (problems: readonly string[]) =>
  [
    '',
    '## Essai précédent refusé',
    `Ta réponse précédente a été refusée par la validation :\n${problems.map((p) => `- ${p}`).join('\n')}`,
    'Rends une fiche complète qui respecte toutes les bornes.',
  ].join('\n\n');

/** JSON Schema de la sortie : les champs IA de `exerciseJsonSchema()`, obligatoires comme dans la fiche complète. */
function aiOutputSchema(): object {
  const full = exerciseJsonSchema() as { properties: Record<string, unknown>; required?: string[] };
  const properties = Object.fromEntries(
    EXERCISE_AI_FIELDS.map((key) => {
      const property = full.properties[key];
      if (property === undefined) throw new Error(`Champ IA absent du schéma de fiche : ${key}.`);
      return [key, property];
    }),
  );
  const required = (full.required ?? []).filter((key) => AI_FIELDS.has(key));
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Fiche rédigée : champs non IA repris tels quels, champs IA remplacés, `revision` + 1, `drafting`. */
function mergeDraft(json: Json, ai: Json, drafting: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(json)) if (!AI_FIELDS.has(key)) out[key] = value;
  for (const key of EXERCISE_AI_FIELDS) if (ai[key] !== undefined) out[key] = ai[key];
  out.revision = (json.revision as number) + 1;
  out.drafting = drafting;
  return out;
}

const sameError = (a: CatalogError, b: CatalogError) =>
  a.file === b.file && a.code === b.code && a.message === b.message;

/** Écrit `text` d'un coup : un fichier interrompu ne remplace jamais la fiche. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Exécute `run` sur chaque élément, `limit` à la fois au plus. */
async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Rédige les fiches choisies dans `dataDir` ; n'écrit que les fiches dont la sortie est valide. */
export async function draftExercises(options: DraftOptions): Promise<DraftResult> {
  const { dataDir, client } = options;
  const model = options.model ?? DEFAULT_MODEL;
  const now = options.now ?? (() => new Date());
  const { input } = await readCatalogInput(dataDir);
  const catalog = new Map(input.sheets.map((sheet) => [sheet.file, sheet]));

  const plan = select(catalog, options.ids);
  const outcomes: DraftOutcome[] = plan.map((item) =>
    'refused' in item
      ? { id: item.id, status: 'refused', attempts: 0, costUsd: 0, message: item.refused }
      : { id: item.id, status: 'skipped', attempts: 0, costUsd: 0 },
  );
  const targets = plan.flatMap((item, index) => ('refused' in item ? [] : [{ target: item, index }]));
  if (targets.length === 0) return { outcomes, costUsd: 0 };

  const system = await fixedSystem(dataDir, catalog);
  const schema = aiOutputSchema();
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  let stopped = false;

  /** Problèmes de la fiche rédigée : ceux du schéma complet, puis les erreurs que le catalogue n'avait pas. */
  const problemsOf = (target: Target, value: unknown, merged: Json, text: string): string[] => {
    if (!isRecord(value)) return ["La sortie n'est pas un objet JSON."];
    const problems = Object.keys(value)
      .filter((key) => !AI_FIELDS.has(key))
      .map((key) => `${key} : champ hors des champs IA, interdit (le squelette est fixé).`);
    // Fiche complète exigée pour les champs IA ; `illustrations` (champ admin, absent d'un squelette) vaut une
    // liste vide pour ce contrôle seulement. Le brouillon écrit reste un `draft` contrôlé ensuite comme en CI.
    const parsed = ExerciseSheetSchema.safeParse({ illustrations: [], ...merged });
    if (!parsed.success) problems.push(...issuesOf(parsed.error.issues));
    if (problems.length > 0) return problems;
    const before = validateCatalog({ ...input, sheets: [...catalog.values()] }).errors;
    const others = [...catalog.values()].filter((sheet) => sheet.file !== target.file);
    const after = validateCatalog({
      ...input,
      sheets: [...others, { file: target.file, json: merged, text }],
    });
    return after.errors
      .filter((error) => !before.some((known) => sameError(known, error)))
      .map((error) => `[${error.code}] ${error.file} : ${error.message}`);
  };

  const draftOne = async (target: Target): Promise<DraftOutcome> => {
    const user = userMessage(target, catalog);
    let cost = 0;
    let problems: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let value: unknown;
      let answeredBy: string;
      try {
        const result = await client.complete<unknown>({
          model,
          effort: DRAFT_EFFORT,
          system,
          user: attempt === 1 ? user : `${user}${retryNote(problems)}`,
          schema,
          maxTokens,
        });
        cost += result.costUsd;
        value = result.value;
        answeredBy = result.model;
      } catch (error) {
        if (!(error instanceof AiError)) {
          const message = error instanceof Error ? error.message : String(error);
          return { id: target.id, status: 'failed', attempts: attempt, costUsd: cost, message };
        }
        cost += error.costUsd;
        if (error.code === 'invalid_json') {
          problems = [error.message];
          continue;
        }
        if (error.fatal) stopped = true;
        const hint =
          error.code === 'max_tokens'
            ? ` Relance cette fiche avec --ids ${target.id} --max-tokens <n> (plafond actuel : ${maxTokens}).`
            : '';
        return {
          id: target.id,
          status: 'failed',
          attempts: attempt,
          costUsd: cost,
          message: `${error.message}${hint}`,
        };
      }
      const generatedAt = now()
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const drafting = {
        origin: 'ai',
        model: answeredBy,
        prompt_version: PROMPT_VERSION,
        generated_at: generatedAt,
      };
      const merged = isRecord(value) ? mergeDraft(target.json, value, drafting) : target.json;
      const text = canonicalJson(merged);
      problems = problemsOf(target, value, merged, text);
      if (problems.length > 0) continue;
      const previous = catalog.get(target.file);
      catalog.set(target.file, { file: target.file, json: merged, text });
      try {
        await writeAtomic(join(dataDir, target.file), text);
      } catch (error) {
        if (previous !== undefined) catalog.set(target.file, previous);
        const message = `Écriture impossible : ${(error as Error).message}`;
        return { id: target.id, status: 'failed', attempts: attempt, costUsd: cost, message };
      }
      return { id: target.id, status: 'drafted', attempts: attempt, costUsd: cost };
    }
    const message = `Sortie refusée après ${MAX_ATTEMPTS} essais : ${problems.join(' ; ')}`;
    return { id: target.id, status: 'failed', attempts: MAX_ATTEMPTS, costUsd: cost, message };
  };

  await pool(targets, MAX_PARALLEL, async ({ target, index }) => {
    outcomes[index] = stopped
      ? {
          id: target.id,
          status: 'skipped',
          attempts: 0,
          costUsd: 0,
          message: 'Non envoyée : arrêt après une erreur qui vaut pour tout le lot.',
        }
      : await draftOne(target);
  });
  return { outcomes, costUsd: outcomes.reduce((sum, o) => sum + o.costUsd, 0) };
}

/**
 * Clé lue dans `envFile` (`.env.local`, 04 §9), sinon dans la variable d'environnement du poste (procédure P5) ;
 * ou le message à afficher. La clé n'apparaît dans aucun message.
 */
async function readApiKey(
  envFile: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ key: string } | { error: string }> {
  let text = '';
  try {
    text = await readFile(envFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const key = parseEnv(text)[API_KEY_VAR]?.trim() || env[API_KEY_VAR]?.trim();
  if (key) return { key };
  return {
    error:
      `Clé absente : ajoute ${API_KEY_VAR}=<clé du workspace Anthropic de développement> dans .env.local, ` +
      'à la racine du dépôt (fichier ignoré par git, jamais commité).',
  };
}

const dollars = (amount: number) => `${amount.toFixed(4).replace('.', ',')} $`;

function report(o: DraftOutcome): string {
  const tail = o.message === undefined ? '' : ` ${o.message}`;
  switch (o.status) {
    case 'drafted':
      return `${o.id} : rédigée en ${o.attempts} essai(s), ${dollars(o.costUsd)}.`;
    case 'refused':
      return `${o.id} : refusée.${tail}`;
    case 'failed':
      return `${o.id} : échec après ${o.attempts} essai(s), ${dollars(o.costUsd)}.${tail}`;
    case 'skipped':
      return `${o.id} : non envoyée.${tail}`;
  }
}

export type MainDeps = {
  /** `ENV_FILE` à défaut. */
  envFile?: string;
  /** Variables d'environnement, repli de `envFile` ; `process.env` à défaut. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Client réel à défaut (`createAnthropicClient`). */
  createClient?: (apiKey: string, model: string) => AiClient;
  now?: () => Date;
};

/** Point d'entrée : rend le code de sortie. */
export async function main(
  argv: readonly string[],
  out: Pick<Console, 'log' | 'error'> = console,
  deps: MainDeps = {},
): Promise<number> {
  let dataDir = DEFAULT_DATA_DIR;
  let model = DEFAULT_MODEL;
  let ids: string[] | undefined;
  let maxTokens: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      out.error(USAGE);
      return 2;
    }
    if (arg === '--dir') {
      dataDir = resolve(value);
    } else if (arg === '--model') {
      model = value;
    } else if (arg === '--ids') {
      ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
    } else if (arg === '--max-tokens' && /^[1-9][0-9]*$/.test(value)) {
      maxTokens = Number(value);
    } else {
      out.error(USAGE);
      return 2;
    }
    i += 1;
  }

  const read = await readApiKey(deps.envFile ?? ENV_FILE, deps.env ?? process.env);
  if ('error' in read) {
    out.error(read.error);
    return 1;
  }
  let client: AiClient;
  try {
    client = (deps.createClient ?? ((apiKey, m) => createAnthropicClient({ apiKey, model: m })))(
      read.key,
      model,
    );
  } catch (error) {
    out.error((error as Error).message);
    return 1;
  }

  out.log(
    `Rédaction des brouillons : modèle ${model}, effort ${DRAFT_EFFORT}, prompt v${PROMPT_VERSION}, ` +
      `${MAX_PARALLEL} appels en parallèle au plus.`,
  );
  const result = await draftExercises({
    dataDir,
    client,
    model,
    ...(ids === undefined ? {} : { ids }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  if (result.outcomes.length === 0) out.log('Aucun brouillon à rédiger.');
  for (const outcome of result.outcomes) {
    if (outcome.status === 'drafted') out.log(report(outcome));
    else out.error(report(outcome));
  }
  out.log(`Coût total : ${dollars(result.costUsd)}.`);

  const { errors, counts } = await validateDataDir(dataDir);
  for (const e of errors) out.error(`${e.file} [${e.code}] ${e.message}`);
  if (errors.length > 0)
    out.error(`Catalogue invalide : ${errors.length} erreur(s), à corriger avant la PR.`);
  else out.log(`Catalogue valide : ${counts.sheets} fiche(s).`);

  const failed = result.outcomes.some((o) => o.status !== 'drafted');
  return failed || errors.length > 0 ? 1 : 0;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  if (process.env.CI) {
    console.error('exercises:draft se lance sur le poste de dev, jamais en CI (04 §9).');
    process.exitCode = 2;
  } else {
    process.exitCode = await main(process.argv.slice(2));
  }
}
