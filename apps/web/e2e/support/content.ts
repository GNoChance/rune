import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExerciseSheet, IllustrationEntry } from '@rune/contracts';
import { canonicalJson, validateCatalog } from '@rune/domain';

/*
 * Dossier de contenu de test (`RUNE_CONTENT_DIR`) : le `data/` du dépôt n'a que des brouillons, jamais servis. Ici,
 * des fiches publiées en forme canonique, un manifeste et des SVG réels (un pompiste au trait, deux poses),
 * vérifiés par `validateCatalog` avant le démarrage du serveur : un contenu refusé échoue ici, avec ses erreurs,
 * plutôt qu'en un catalogue vide.
 */

/** Pompe publiée, illustrée (positions de départ et de fin) : la fiche ouverte hors ligne. */
export const E2E_PUSH_UP = { id: 'e2e-push-up', name: 'Pompe' } as const;

/** Fiches publiées sans illustration, toutes trouvées par « pompe e2e » : une liste assez longue pour défiler. */
export const E2E_LIST_QUERY = 'pompe e2e';
export const E2E_LIST_SIZE = 14;
export const e2eListName = (n: number) => `Pompe e2e ${String(n).padStart(2, '0')}`;

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

function pushUpSheet(id: string, name: string, illustrations: ExerciseSheet['illustrations']): ExerciseSheet {
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
    illustrations,
    published_at: '2026-10-22T08:00:00.000Z',
  };
}

/** Écrit le contenu de test dans `dir` (créé au besoin) et le vérifie ; rend `dir`. */
export function writeExercisesContent(dir: string): string {
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  const poses = [illustration('start'), illustration('end')];
  const sheets: ExerciseSheet[] = [
    pushUpSheet(
      E2E_PUSH_UP.id,
      E2E_PUSH_UP.name,
      poses.map(({ entry }, i) => ({ illustration_id: entry.id, role: i === 0 ? 'start' : 'end' })),
    ),
    ...Array.from({ length: E2E_LIST_SIZE }, (_, i) =>
      pushUpSheet(`e2e-push-up-${String(i + 1).padStart(2, '0')}`, e2eListName(i + 1), []),
    ),
  ];
  const files = sheets.map((sheet) => {
    const text = canonicalJson(sheet);
    const file = `exercises/${sheet.id}.json`;
    write(file, text);
    return { file, json: JSON.parse(text) as unknown, text };
  });
  const manifest = poses.map((p) => p.entry);
  write('illustrations/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  for (const { entry, body } of poses) write(`illustrations/files/${entry.file}`, body);

  const illustrationFiles = new Map(poses.map(({ entry }) => [entry.file, entry.sha256]));
  const { errors } = validateCatalog({ sheets: files, manifest, templates: [], illustrationFiles });
  if (errors.length > 0) {
    throw new Error(
      `Contenu de test refusé :\n${errors.map((e) => `${e.file} ${e.code} ${e.message}`).join('\n')}`,
    );
  }
  return dir;
}
