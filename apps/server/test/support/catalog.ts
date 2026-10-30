import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DraftSheet, ExerciseSheet, IllustrationEntry } from '@rune/contracts';
import { canonicalJson } from '@rune/domain';

/** Fiche publiée complète et valide (squat goblet de la maquette), sans chaîne ni illustration. */
const GOBLET_SQUAT: ExerciseSheet = {
  id: 'goblet-squat',
  schema_version: 1,
  revision: 4,
  status: 'published',
  batch: 'A',
  name: 'Squat goblet',
  aliases: ['Goblet squat'],
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
  setup: 'Choisis un haltère que tu tiens sans effort contre ta poitrine.',
  easier_tip: "Tiens-toi à un support devant toi pour garder l'équilibre.",
  illustrations: [],
  review_notes: 'REPERE-NOTES : profondeur à confirmer.',
  drafting: {
    origin: 'ai',
    model: 'claude-opus-5-5',
    prompt_version: 1,
    generated_at: '2026-10-20T09:00:00.000Z',
  },
  reviewed_at: '2026-10-21T18:30:00.000Z',
  published_at: '2026-10-22T08:00:00.000Z',
  updated_at: '2026-10-22T08:00:00.000Z',
};

/**
 * Fiche complète et valide d'id `id` (publiée par défaut), surchargée champ par champ. Le nom dérive de l'id et
 * les alias sont vides : plusieurs fiches passent ensemble le validateur du catalogue (alias uniques).
 */
export function sheetFixture(id: string, overrides: Partial<ExerciseSheet> = {}): ExerciseSheet {
  return { ...structuredClone(GOBLET_SQUAT), id, name: `Exercice ${id}`, aliases: [], ...overrides };
}

/**
 * Brouillon complet retiré sans avoir jamais été publié (`published_at` absent) : il passe le schéma de la fiche
 * servie, mais ne quitte jamais le serveur (spec brique 2 §3.6).
 */
export function retiredDraft(id = 'retired-draft'): ExerciseSheet {
  return sheetFixture(id, {
    status: 'retired',
    review_notes: 'REPERE-RETIRE',
    published_at: undefined,
    retired_at: '2026-10-27T08:00:00.000Z',
  });
}

/** Squelette de brouillon (04 §8 étape 1) : champs squelette et système seulement. */
export function skeletonFixture(id: string, overrides: Partial<DraftSheet> = {}): DraftSheet {
  return {
    id,
    schema_version: 1,
    revision: 1,
    status: 'draft',
    batch: 'B',
    name: `Brouillon ${id}`,
    movement_pattern: 'squat',
    mechanics: 'compound',
    unilateral: false,
    measure: 'reps',
    load_mode: 'dumbbell',
    equipment_options: [['dumbbells']],
    level: 1,
    not_for_minors: false,
    ...overrides,
  };
}

/** Fichier d'illustration et son entrée de manifeste, cohérents (nom `<id>.<hash8>.svg`, sha256, octets). */
export function illustrationFixture(
  id: string,
  overrides: Partial<IllustrationEntry> = {},
): { entry: IllustrationEntry; body: string } {
  const body = `<svg xmlns="http://www.w3.org/2000/svg"><!-- ${id} --></svg>`;
  const sha256 = createHash('sha256').update(body).digest('hex');
  const entry: IllustrationEntry = {
    id,
    file: `${id}.${sha256.slice(0, 8)}.svg`,
    sha256,
    bytes: Buffer.byteLength(body),
    media_type: 'image/svg+xml',
    source: 'everkinetic',
    source_url: `https://github.com/everkinetic/data/blob/0123abc/svg/${id}.svg`,
    creators: ['Greg Priday'],
    license: 'CC-BY-SA-4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    modifications: 'Nettoyage du SVG, renommage.',
    replace_before_public: false,
    ...overrides,
  };
  return { entry, body };
}

/**
 * Contenu d'un dossier `data/` de test : fiches écrites en forme canonique, illustrations (manifeste et fichiers),
 * modèles de programmes, et fichiers bruts (chemin relatif → texte) écrits en dernier.
 */
export type DataDirSpec = {
  sheets?: readonly Readonly<Record<string, unknown>>[];
  illustrations?: readonly { entry: IllustrationEntry; body: string }[];
  templates?: Readonly<Record<string, unknown>>;
  raw?: Readonly<Record<string, string>>;
};

/** Écrit `spec` dans `dir` (créé au besoin) ; les fichiers déjà là restent. */
export function writeDataDir(dir: string, spec: DataDirSpec): string {
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  for (const sheet of spec.sheets ?? []) write(`exercises/${String(sheet.id)}.json`, canonicalJson(sheet));
  if (spec.illustrations !== undefined) {
    write(
      'illustrations/manifest.json',
      `${JSON.stringify(
        spec.illustrations.map((i) => i.entry),
        null,
        2,
      )}\n`,
    );
    for (const { entry, body } of spec.illustrations) write(`illustrations/files/${entry.file}`, body);
  }
  for (const [name, template] of Object.entries(spec.templates ?? {})) {
    write(`programs/${name}.json`, JSON.stringify(template));
  }
  for (const [file, text] of Object.entries(spec.raw ?? {})) write(file, text);
  return dir;
}

/** Dossiers `data/` temporaires, supprimés par `cleanup`. */
export function tempDataDirs(): { create(spec?: DataDirSpec): string; cleanup(): void } {
  const dirs: string[] = [];
  return {
    create(spec = {}) {
      const dir = mkdtempSync(join(tmpdir(), 'rune-catalog-'));
      dirs.push(dir);
      return writeDataDir(dir, spec);
    },
    cleanup() {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
