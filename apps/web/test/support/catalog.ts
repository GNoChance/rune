import { type IllustrationEntry, type ServedSheet, ServedSheetSchema } from '@rune/contracts';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { seedMirror } from './seed';

/** Fiche servie de référence (squat goblet, sans colonne éditoriale), surchargée champ par champ. */
export const BASE_SHEET: ServedSheet = {
  id: 'goblet-squat',
  schema_version: 1,
  revision: 4,
  status: 'published',
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
    'Tiens un haltère contre ta poitrine.',
    'Descends en poussant les hanches en arrière.',
    'Remonte en poussant dans tout le pied.',
  ],
  key_points: ['Garde les talons au sol.', 'Tes genoux suivent tes orteils.'],
  mistakes: [
    { mistake: 'Les genoux rentrent.', fix: "Pousse les genoux vers l'extérieur." },
    { mistake: 'Les talons décollent.', fix: 'Descends moins bas.' },
  ],
  safety: ['Arrête la série si tu ressens une douleur vive.'],
  breathing: 'Inspire en descendant, souffle en remontant.',
  illustrations: [],
};

/** Fiche servie valide (le schéma la vérifie : une fiche refusée serait écartée en silence par le dépôt). */
export const served = (o: Partial<ServedSheet>): ServedSheet =>
  ServedSheetSchema.parse({ ...structuredClone(BASE_SHEET), ...o });

/** Relie des fiches en chaîne, de la plus facile à la plus dure (R-CH-1). */
export function chain(chainId: string, members: ServedSheet[]): ServedSheet[] {
  return members.map((m, i) => {
    const easier = members[i - 1]?.id;
    const harder = members[i + 1]?.id;
    return served({
      ...m,
      chain_id: chainId,
      ...(easier ? { easier_id: easier } : {}),
      ...(harder ? { harder_id: harder } : {}),
    });
  });
}

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** Entrée de manifeste d'illustration (Everkinetic, CC BY-SA 4.0, modifiée par Rune). */
export const illustrationEntry = (id: string, o: Partial<IllustrationEntry> = {}): IllustrationEntry => ({
  id,
  file: `${id}.0a1b2c3d.svg`,
  sha256: `0a1b2c3d${'e'.repeat(56)}`,
  bytes: 2048,
  media_type: 'image/svg+xml',
  source: 'everkinetic',
  source_url: `https://github.com/everkinetic/data/blob/${COMMIT}/svg/${id}.svg`,
  creators: ['Greg Priday'],
  license: 'CC-BY-SA-4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  modifications: 'Rune : nettoyage du SVG.',
  replace_before_public: false,
  ...o,
});

/** Catalogue téléchargé : magasins `exercises` et `illustrations`, version posée dans meta. */
export async function seedCatalog(
  db: AppDb,
  sheets: readonly unknown[],
  illustrations: readonly IllustrationEntry[] = [],
  version = 'cat-1',
): Promise<void> {
  await db.table('exercises').bulkPut([...sheets]);
  if (illustrations.length > 0) await db.table('illustrations').bulkPut([...illustrations]);
  await setMeta(db, 'catalogVersion', version);
}

/** Profil d'entraînement du membre u-1 (expérience 6 à 24 mois : niveau max 2), mode prudent coupé par défaut. */
export async function seedTrainingProfile(db: AppDb, o: { cautiousMode?: boolean } = {}): Promise<void> {
  await seedMirror(db, 'training_profile', [
    {
      id: 'u-1',
      ownerId: 'u-1',
      goal: 'muscle',
      experience: '6_to_24_months',
      daysPerWeek: 3,
      sessionMinutes: 45,
      sportCode: null,
      sportOtherLabel: null,
      cautiousMode: o.cautiousMode ?? false,
      coach: 'skald',
    },
  ]);
}

/** Lieu principal « Garage » (maison) : haltères et banc réglable (qui vaut aussi un banc plat). */
export async function seedGarage(db: AppDb): Promise<void> {
  await seedMirror(db, 'place', [
    {
      id: 'p-1',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Garage',
      isPrimary: true,
      visibleAtGym: null,
      loadSettings: null,
    },
  ]);
  await seedMirror(db, 'home_equipment', [
    { id: 'p-1:dumbbells', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'dumbbells' },
    { id: 'p-1:adjustable_bench', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'adjustable_bench' },
  ]);
}
