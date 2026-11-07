import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AdviceSheetFile,
  ExerciseSheet,
  IllustrationEntry,
  MovementPattern,
  ProgramTemplate,
  SetSpec,
  SlotSpec,
} from '@rune/contracts';
import { canonicalJson, validateAdviceSheet, validateCatalog, validateTemplate } from '@rune/domain';

/*
 * Dossier de contenu de test (`RUNE_CONTENT_DIR`) : le `data/` du dépôt n'a que des brouillons, jamais servis. Ici,
 * des fiches publiées en forme canonique, un manifeste et des SVG réels (un pompiste au trait, deux poses),
 * vérifiés par `validateCatalog` avant le démarrage du serveur : un contenu refusé échoue ici, avec ses erreurs,
 * plutôt qu'en un catalogue vide. Le contenu des séances y ajoute un modèle de programme, vérifié aussi par
 * `validateTemplate` (les règles de `pnpm data:validate`).
 */

/** Fiches conseils fictives, titrées « [Test] » : adulte (deux modes), mineur (qualitatif), mode complet seul. */
export const E2E_ADVICE: readonly AdviceSheetFile[] = [
  {
    id: 'test-adults-both',
    title: '[Test] Repères pour adultes',
    body_md: "Fiche fictive pour les tests.\n\n## Repères\n\n- Mange varié.\n- Bois de l'eau.",
    audience: 'adults',
    visible_modes: ['full', 'qualitative'],
    tags: ['test'],
    sources: [
      {
        title: 'Source fictive (test)',
        url: 'https://example.org/rune-test',
        accessed_on: '2026-11-07',
      },
    ],
    draft_origin: 'human',
  },
  {
    id: 'test-minors-qualitative',
    title: '[Test] Repères pour jeunes',
    body_md:
      'Fiche fictive pour les tests, destinée aux mineurs.\n\n- Fais des repas réguliers.\n- Prends une collation.',
    audience: 'minors',
    visible_modes: ['qualitative'],
    tags: ['test'],
    sources: [
      {
        title: 'Source fictive (test)',
        url: 'https://example.org/rune-test',
        accessed_on: '2026-11-07',
      },
    ],
    draft_origin: 'human',
  },
  {
    id: 'test-full-only',
    title: '[Test] Pourquoi le poids varie',
    body_md:
      "Fiche fictive réservée au mode complet.\n\nTon poids bouge avec l'eau et le sel : **regarde la tendance**, pas le chiffre du jour.",
    audience: 'adults',
    visible_modes: ['full'],
    tags: ['test'],
    sources: [
      {
        title: 'Source fictive (test)',
        url: 'https://example.org/rune-test',
        accessed_on: '2026-11-07',
      },
    ],
    draft_origin: 'human',
  },
];

/** Pompe publiée, illustrée (positions de départ et de fin) : la fiche ouverte hors ligne. */
export const E2E_PUSH_UP = { id: 'e2e-push-up', name: 'Pompe' } as const;

/** Fiches publiées sans illustration, toutes trouvées par « pompe e2e » : une liste assez longue pour défiler. */
export const E2E_LIST_QUERY = 'pompe e2e';
export const E2E_LIST_SIZE = 14;
export const e2eListName = (n: number) => `Pompe e2e ${String(n).padStart(2, '0')}`;

/** Une fiche du modèle de test : identifiant et nom affiché. */
export interface E2EExercise {
  id: string;
  name: string;
}

/** Un slot du modèle de test, tel que la séance du jour le montre au lieu « Maison » sans matériel. */
export interface E2ESlot {
  slot: string;
  movementPattern: MovementPattern;
  role: SlotSpec['role'];
  exercise: E2EExercise;
  /** Séries de travail prévues. */
  sets: number;
  restS: number;
  measure: 'reps' | 'duration';
}

const SQUAT: E2EExercise = { id: 'e2e-squat', name: 'Squat au poids du corps' };
const INVERTED_ROW: E2EExercise = { id: 'e2e-inverted-row', name: 'Rowing inversé' };
const TOWEL_ROW: E2EExercise = { id: 'e2e-towel-row', name: 'Rowing à la serviette' };
const GLUTE_BRIDGE: E2EExercise = { id: 'e2e-glute-bridge', name: 'Pont fessier' };
const PLANK: E2EExercise = { id: 'e2e-plank', name: 'Gainage' };

/** Repos de chaque série de travail du modèle de test (s). */
const REST_S = 60;

const slot = (
  id: string,
  movementPattern: MovementPattern,
  role: SlotSpec['role'],
  exercise: E2EExercise,
  measure: E2ESlot['measure'] = 'reps',
): E2ESlot => ({ slot: id, movementPattern, role, exercise, sets: 2, restS: REST_S, measure });

/**
 * Modèle de programme de test : maison, débutant (recommandé à E8 après l'onboarding « À la maison », niveau
 * « Jamais »), une seule séance de 5 slots au poids du corps, 2 séries de travail chacun, un slot par groupe de
 * couverture (05 §5, règle 4). Le slot du tirage a un second exercice : celui qui prend la suite après une douleur.
 */
export const E2E_TEMPLATE: {
  id: string;
  name: string;
  workout: { id: string; name: string };
  daysPerWeek: number;
  slots: readonly E2ESlot[];
  /** Second exercice du slot du tirage (même type de mouvement) : le changement après « Douleur ». */
  swap: E2EExercise;
} = {
  id: 'e2e-home-full-body',
  name: 'Maison · Corps entier (test)',
  workout: { id: 'A', name: 'Séance A' },
  daysPerWeek: 3,
  slots: [
    slot('A1', 'squat', 'main', SQUAT),
    slot('A2', 'horizontal_push', 'main', E2E_PUSH_UP),
    slot('A3', 'horizontal_pull', 'secondary', INVERTED_ROW),
    slot('A4', 'glute_bridge', 'accessory', GLUTE_BRIDGE),
    slot('A5', 'core_anti_extension', 'accessory', PLANK, 'duration'),
  ],
  swap: TOWEL_ROW,
};

/** Répétitions (8 à 12) et durée (20 à 60 s) visées par le modèle de test. */
export const E2E_TARGETS = { reps: { min: 8, max: 12 }, durationS: { min: 20, max: 60 } } as const;

/**
 * Le modèle de test, en version 1 ; la version 2 ne cite plus le premier exercice du tirage (`E2E_TEMPLATE.slots`,
 * slot A3), que l'admin peut alors retirer : un modèle chargé qui cite une fiche en bloque le retrait.
 */
function programTemplate(version: 1 | 2): ProgramTemplate {
  const rows = version === 1 ? [INVERTED_ROW.id, E2E_TEMPLATE.swap.id] : [E2E_TEMPLATE.swap.id];
  const work = (s: E2ESlot): SetSpec => ({
    kind: 'work',
    count: s.sets,
    ...(s.measure === 'reps'
      ? { reps: { ...E2E_TARGETS.reps } }
      : { durationS: { ...E2E_TARGETS.durationS } }),
    targetRir: 2,
    restS: s.restS,
  });
  return {
    schemaVersion: 1,
    id: E2E_TEMPLATE.id,
    version,
    name: E2E_TEMPLATE.name,
    description:
      'Une séance corps entier au poids du corps, pour les tests de bout en bout : squat, pompe, tirage, pont et gainage.',
    context: 'home',
    level: 'beginner',
    daysPerWeek: { min: 2, max: 3, default: E2E_TEMPLATE.daysPerWeek },
    estimatedMinutes: 30,
    block: { mode: 'reactive' },
    workouts: [
      {
        id: E2E_TEMPLATE.workout.id,
        name: E2E_TEMPLATE.workout.name,
        slots: E2E_TEMPLATE.slots.map((s) => ({
          id: s.slot,
          movementPattern: s.movementPattern,
          role: s.role,
          exercises: s.exercise.id === INVERTED_ROW.id ? rows : [s.exercise.id],
          sets: [work(s)],
          progression: s.measure === 'reps' ? { type: 'double' } : { type: 'duration', stepS: 5 },
        })),
      },
    ],
  };
}

/** Pompe au trait sur un sol : `chest` = hauteur des épaules (bras tendus en haut, poitrine près du sol en bas). */
function pushUpSvg(pose: 'start' | 'end'): string {
  const shoulderY = pose === 'start' ? 118 : 160;
  const hipY = pose === 'start' ? 146 : 170;
  const elbow = pose === 'start' ? '64,148' : '40,176';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">',
    `<title>Pompe, position de ${pose === 'start' ? 'départ' : 'fin'}</title>`,
    '<g fill="none" stroke="#1d2433" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M16 200h208"/>',
    `<path d="M60 196 ${elbow} 62,${shoulderY}"/>`,
    `<path d="M62 ${shoulderY} 140 ${hipY} 212 192"/>`,
    '</g>',
    `<circle cx="40" cy="${shoulderY - 14}" r="14" fill="#1d2433"/>`,
    '</svg>',
    '',
  ].join('\n');
}

function illustration(pose: 'start' | 'end'): { entry: IllustrationEntry; body: string } {
  const id = `${E2E_PUSH_UP.id}-${pose}`;
  const body = pushUpSvg(pose);
  const sha256 = createHash('sha256').update(body).digest('hex');
  return {
    body,
    entry: {
      id,
      file: `${id}.${sha256.slice(0, 8)}.svg`,
      sha256,
      bytes: Buffer.byteLength(body),
      media_type: 'image/svg+xml',
      source: 'everkinetic',
      source_url: `https://github.com/everkinetic/data/blob/0123abc/svg/${id}.svg`,
      creators: ['Rune (test E2E)'],
      license: 'CC0-1.0',
      license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      replace_before_public: false,
    },
  };
}

/** Fiche publiée au poids du corps, sans matériel ; par défaut celle de la pompe, `fields` la change. */
function publishedSheet(id: string, name: string, fields: Partial<ExerciseSheet> = {}): ExerciseSheet {
  return {
    id,
    schema_version: 1,
    revision: 1,
    status: 'published',
    batch: 'A',
    name,
    aliases: [],
    movement_pattern: 'horizontal_push',
    mechanics: 'compound',
    unilateral: false,
    measure: 'reps',
    load_mode: 'bodyweight',
    primary_muscles: ['chest', 'triceps'],
    secondary_muscles: ['front_delts', 'abs'],
    equipment_options: [[]],
    level: 1,
    not_for_minors: false,
    stressed_joints: ['shoulders', 'wrists'],
    instructions: [
      'Pose les mains au sol, un peu plus écartées que tes épaules.',
      'Gaine le tronc pour former une ligne droite des talons à la tête.',
      'Descends la poitrine près du sol, puis pousse pour remonter.',
    ],
    key_points: ["Ton corps bouge d'un seul bloc.", 'Garde la nuque dans le prolongement du dos.'],
    mistakes: [
      { mistake: "Les hanches s'affaissent.", fix: 'Serre le ventre et les fessiers.' },
      { mistake: 'Les coudes partent sur les côtés.', fix: 'Rapproche les coudes du corps.' },
    ],
    safety: ["Arrête la série si tu sens une douleur vive à l'épaule ou au poignet."],
    breathing: 'Inspire en descendant, souffle en poussant.',
    illustrations: [],
    published_at: '2026-10-22T08:00:00.000Z',
    ...fields,
  };
}

/** Fiches du modèle de test autres que la pompe (déjà publiée, avec ses illustrations). */
function programSheets(): ExerciseSheet[] {
  const row = (exercise: E2EExercise, grip: string) =>
    publishedSheet(exercise.id, exercise.name, {
      movement_pattern: 'horizontal_pull',
      primary_muscles: ['lats'],
      secondary_muscles: ['biceps', 'rear_delts'],
      stressed_joints: ['shoulders', 'elbows'],
      instructions: [
        `Installe-toi sous ${grip}, les bras tendus.`,
        'Gaine le tronc, les talons au sol.',
        'Tire la poitrine vers tes mains, puis redescends lentement.',
      ],
      key_points: ['Serre les omoplates en haut.', 'Ton corps reste droit.'],
      mistakes: [
        { mistake: 'Les hanches tombent.', fix: 'Serre les fessiers.' },
        { mistake: 'Les épaules montent vers les oreilles.', fix: 'Garde les épaules basses.' },
      ],
      safety: ["Vérifie que l'appui tient ton poids avant de tirer."],
      breathing: 'Souffle en tirant, inspire en descendant.',
    });
  return [
    publishedSheet(SQUAT.id, SQUAT.name, {
      movement_pattern: 'squat',
      primary_muscles: ['quadriceps', 'glutes'],
      secondary_muscles: ['hamstrings'],
      stressed_joints: ['knees', 'hips'],
      instructions: [
        'Tiens-toi debout, les pieds à la largeur des épaules.',
        "Descends en poussant les hanches en arrière, comme pour t'asseoir.",
        'Remonte en poussant dans tout le pied.',
      ],
      key_points: ['Les genoux suivent la pointe des pieds.', 'Le dos reste droit.'],
      mistakes: [
        { mistake: 'Les talons décollent.', fix: 'Garde le poids sur tout le pied.' },
        { mistake: "Les genoux rentrent vers l'intérieur.", fix: 'Écarte les genoux en descendant.' },
      ],
      safety: ['Arrête la série si tu sens une douleur vive au genou.'],
      breathing: 'Inspire en descendant, souffle en remontant.',
    }),
    row(INVERTED_ROW, 'une table solide'),
    row(TOWEL_ROW, 'une serviette coincée dans une porte'),
    publishedSheet(GLUTE_BRIDGE.id, GLUTE_BRIDGE.name, {
      movement_pattern: 'glute_bridge',
      mechanics: 'isolation',
      primary_muscles: ['glutes', 'hamstrings'],
      secondary_muscles: ['lower_back'],
      stressed_joints: ['hips', 'lower_back'],
      instructions: [
        'Allonge-toi sur le dos, les genoux pliés, les pieds au sol.',
        'Pousse dans les talons pour monter le bassin.',
        'Redescends lentement sans poser les fessiers.',
      ],
      key_points: ['Serre les fessiers en haut.', 'Ne cambre pas le bas du dos.'],
      mistakes: [
        { mistake: 'Le bas du dos se creuse.', fix: 'Monte moins haut, fessiers serrés.' },
        { mistake: "Les genoux s'écartent.", fix: "Garde les genoux dans l'axe des pieds." },
      ],
      safety: ['Arrête la série si tu sens une douleur dans le bas du dos.'],
      breathing: 'Souffle en montant, inspire en descendant.',
    }),
    publishedSheet(PLANK.id, PLANK.name, {
      movement_pattern: 'core_anti_extension',
      mechanics: 'isolation',
      measure: 'duration',
      primary_muscles: ['abs'],
      secondary_muscles: ['obliques'],
      stressed_joints: ['shoulders', 'lower_back'],
      instructions: [
        'Pose les avant-bras au sol, les coudes sous les épaules.',
        'Tends les jambes et gaine le tronc.',
        'Tiens la position sans bouger.',
      ],
      key_points: ['Ton corps forme une ligne droite.', 'Respire calmement.'],
      mistakes: [
        { mistake: 'Les hanches montent.', fix: 'Aligne les hanches avec les épaules.' },
        { mistake: 'Le bas du dos se creuse.', fix: 'Serre le ventre et les fessiers.' },
      ],
      safety: ['Arrête si tu sens une douleur dans le bas du dos.'],
      breathing: 'Respire lentement pendant tout le maintien.',
    }),
  ];
}

/**
 * Écrit dans `dir` les fiches (forme canonique), la pompe illustrée et son manifeste, et les modèles ; vérifie le tout
 * (`validateCatalog`, puis `validateTemplate` sur chaque modèle) et lève avec les erreurs si quelque chose est refusé.
 */
function writeContent(dir: string, sheets: ExerciseSheet[], templates: ProgramTemplate[]): string {
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  const poses = [illustration('start'), illustration('end')];
  const all: ExerciseSheet[] = [
    publishedSheet(E2E_PUSH_UP.id, E2E_PUSH_UP.name, {
      illustrations: poses.map(({ entry }, i) => ({
        illustration_id: entry.id,
        role: i === 0 ? 'start' : 'end',
      })),
    }),
    ...sheets,
  ];
  const files = all.map((sheet) => {
    const text = canonicalJson(sheet);
    const file = `exercises/${sheet.id}.json`;
    write(file, text);
    return { file, json: JSON.parse(text) as unknown, text };
  });
  const manifest = poses.map((p) => p.entry);
  write('illustrations/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  for (const { entry, body } of poses) write(`illustrations/files/${entry.file}`, body);
  for (const a of E2E_ADVICE)
    write(
      `advice/${a.id}.json`,
      `${JSON.stringify(a, null, 2)}
`,
    );
  for (const template of templates) {
    write(`programs/${template.id}.json`, `${JSON.stringify(template, null, 2)}\n`);
  }

  const illustrationFiles = new Map(poses.map(({ entry }) => [entry.file, entry.sha256]));
  const { errors } = validateCatalog({ sheets: files, manifest, templates, illustrationFiles });
  const refused = [
    ...errors.map((e) => `${e.file} ${e.code} ${e.message}`),
    ...templates.flatMap((t) =>
      validateTemplate(t, all).map((i) => `programs/${t.id}.json ${i.code} ${i.path} ${i.message}`),
    ),
  ];
  for (const a of E2E_ADVICE) {
    const verdict = validateAdviceSheet(a, 'published');
    if (!verdict.ok) refused.push(...verdict.issues.map((i) => `advice/${a.id}.json ${i.code} ${i.detail}`));
  }
  if (refused.length > 0) throw new Error(`Contenu de test refusé :\n${refused.join('\n')}`);
  return dir;
}

/** Contenu de l'onglet Exercices : la pompe illustrée et la liste « pompe e2e » ; rend `dir`. */
export function writeExercisesContent(dir: string): string {
  const list = Array.from({ length: E2E_LIST_SIZE }, (_, i) =>
    publishedSheet(`e2e-push-up-${String(i + 1).padStart(2, '0')}`, e2eListName(i + 1)),
  );
  return writeContent(dir, list, []);
}

/**
 * Contenu des séances : le modèle de test (version 1 par défaut) et ses fiches publiées, la pompe illustrée comprise ;
 * rend `dir`.
 */
export function writeWorkoutContent(dir: string, o: { templateVersion?: 1 | 2 } = {}): string {
  return writeContent(dir, programSheets(), [programTemplate(o.templateVersion ?? 1)]);
}
