/**
 * Condition (c) de 04 §7, contrôlée en CI (04 §13, critère 5) : chaque slot des modèles a au moins 2 exercices
 * utilisables (adulte, `maxLevel` du modèle) dans chaque profil de référence pertinent, et au moins 1 en profil
 * prudent. Le test `scripts/test/data/coverage.test.ts` la vérifie sur `data/`.
 *
 * - Profils (04 §7) : `gym_reference` pour un modèle `gym`, `home_bodyweight` et `home_small_equipment` pour un
 *   modèle `home`, les trois pour un modèle `sport`.
 * - Exercices utilisables d'un slot (05 §11, « Changer d'exercice ») : les fiches utilisables de sa liste, ou les
 *   variantes utilisables de sa chaîne (`usableChainSteps`), puis les remplaçants (`substitutes`) de la référence,
 *   sans doublon. La référence est le premier exercice de la liste ; pour une chaîne, c'est la variante courante,
 *   qui peut être n'importe quel membre : on garde le pire des cas.
 * - Seules comptent les fiches de la mesure du slot (répétitions ou durée, lue sur sa première série de travail
 *   comme le moteur) : un slot n'a qu'un type de séries (05 §4), et `substitutes` ne regarde pas la mesure. Le
 *   contrôle compte donc parfois moins que ce que le moteur proposerait, jamais plus.
 * - Les fiches non retirées comptent comme publiées : les lots A et B doivent l'être avant la fin de la brique 3
 *   (04 §7), et la CI vérifie la liste avant leur publication. Une fiche retirée ne compte jamais.
 * - `maxLevel` : `maxExerciseLevel` d'une expérience du niveau du modèle (`beginner` → 1, `intermediate` → 2,
 *   04 §3.5). Seul `substitutes` le lit : une liste de slot ou une chaîne peut citer un niveau plus haut.
 */
import {
  EXPERIENCES,
  type ExerciseLevel,
  maxExerciseLevel,
  type ProgramTemplate,
  ProgramTemplateSchema,
  REFERENCE_PROFILES,
  type SlotSpec,
} from '@rune/contracts';
import {
  buildChains,
  type CatalogContext,
  expandEquipment,
  isUsable,
  levelFromExperience,
  substitutes,
  usableChainSteps,
} from '@rune/domain';
import { catalogSheets, type DataSheet, readCatalogInput } from './validate';

export type ReferenceProfile = keyof typeof REFERENCE_PROFILES;

/** Profils de référence pertinents par contexte de modèle (04 §7, condition c). */
export const COVERAGE_PROFILES = {
  gym: ['gym_reference'],
  home: ['home_bodyweight', 'home_small_equipment'],
  sport: ['gym_reference', 'home_bodyweight', 'home_small_equipment'],
} as const satisfies Record<ProgramTemplate['context'], readonly ReferenceProfile[]>;

/** Seuils de la condition (c) : 2 exercices utilisables pour un adulte, 1 en profil prudent. */
export const COVERAGE_MIN = { adult: 2, cautious: 1 } as const;

/** Niveau de fiche le plus haut proposé par un modèle (04 §3.5), par la correspondance unique `maxExerciseLevel`. */
export function templateMaxLevel(level: ProgramTemplate['level']): ExerciseLevel {
  const experiences = EXPERIENCES.filter((e) => levelFromExperience(e) === level);
  return Math.max(...experiences.map((e) => maxExerciseLevel(e))) as ExerciseLevel;
}

/** Mesure d'un slot, comme le moteur la lit : sa première série de travail (à défaut, sa première série). */
export function slotMeasure(slot: Pick<SlotSpec, 'sets'>): DataSheet['measure'] {
  const spec = slot.sets.find((s) => s.kind === 'work') ?? slot.sets[0];
  return spec?.durationS === undefined ? 'reps' : 'duration';
}

/** Une fiche non retirée, vue comme publiée (voir l'en-tête). */
const asPublished = (sheet: DataSheet): DataSheet =>
  sheet.status === 'retired' ? sheet : { ...sheet, status: 'published' };

/**
 * Exercices utilisables d'un slot dans `ctx` (05 §11) : liste ou chaîne utilisable, puis remplaçants de
 * `reference`, sans doublon, dans cet ordre ; seulement ceux de la mesure du slot.
 */
function slotExercises(
  slot: Pick<SlotSpec, 'exercises' | 'chain' | 'sets'>,
  reference: DataSheet | undefined,
  ctx: CatalogContext<DataSheet>,
  byId: ReadonlyMap<string, DataSheet>,
): string[] {
  const own =
    slot.chain !== undefined
      ? usableChainSteps(slot.chain, ctx)
      : (slot.exercises ?? []).flatMap((id) => {
          const sheet = byId.get(id);
          return sheet !== undefined && isUsable(sheet, ctx) ? [sheet] : [];
        });
  const subs = reference === undefined ? [] : substitutes(reference, ctx);
  const measure = slotMeasure(slot);
  return [...new Set([...own, ...subs].filter((s) => s.measure === measure).map((s) => s.id))];
}

/** Couverture d'un slot dans un profil : exercices utilisables, adulte et prudent (pire variante courante). */
export type SlotCoverage = {
  templateId: string;
  slotId: string;
  movementPattern: SlotSpec['movementPattern'];
  profile: ReferenceProfile;
  adult: string[];
  cautious: string[];
};

/**
 * Couverture de chaque slot de chaque modèle, dans chaque profil pertinent, sur `catalog` (tous statuts, voir
 * l'en-tête). Pour un slot `chain`, `adult` et `cautious` sont la plus courte des listes obtenues avec chaque
 * membre non retiré de la chaîne comme variante courante.
 */
export function templateCoverage(
  templates: readonly ProgramTemplate[],
  catalog: readonly DataSheet[],
): SlotCoverage[] {
  const sheets = catalog.map(asPublished);
  const byId = new Map(sheets.map((s) => [s.id, s]));
  const chains = buildChains(sheets);
  const rows: SlotCoverage[] = [];
  for (const template of templates) {
    const maxLevel = templateMaxLevel(template.level);
    for (const profile of COVERAGE_PROFILES[template.context]) {
      const equipment = expandEquipment(REFERENCE_PROFILES[profile]);
      for (const slot of template.workouts.flatMap((w) => w.slots)) {
        const first = slot.exercises?.[0];
        const references =
          slot.chain !== undefined
            ? (chains.get(slot.chain) ?? [])
            : [first === undefined ? undefined : byId.get(first)];
        const worst = (cautious: boolean) => {
          const ctx = { catalog: sheets, equipment, maxLevel, cautious };
          const lists = references.map((reference) => slotExercises(slot, reference, ctx, byId));
          return lists.reduce((min, ids) => (ids.length < min.length ? ids : min), lists[0] ?? []);
        };
        rows.push({
          templateId: template.id,
          slotId: slot.id,
          movementPattern: slot.movementPattern,
          profile,
          adult: worst(false),
          cautious: worst(true),
        });
      }
    }
  }
  return rows;
}

/** Lignes qui ne remplissent pas la condition (c). */
export function coverageFailures(rows: readonly SlotCoverage[]): SlotCoverage[] {
  return rows.filter((r) => r.adult.length < COVERAGE_MIN.adult || r.cautious.length < COVERAGE_MIN.cautious);
}

/**
 * Couverture des modèles de `dataDir` sur ses fiches. Fichiers illisibles, fiches et modèles invalides sont
 * sautés : `pnpm data:validate` les signale.
 */
export async function dataCoverage(dataDir: string): Promise<SlotCoverage[]> {
  const { input } = await readCatalogInput(dataDir);
  const templates = input.templates.flatMap((json) => {
    const parsed = ProgramTemplateSchema.safeParse(json);
    return parsed.success ? [parsed.data] : [];
  });
  return templateCoverage(templates, catalogSheets(input.sheets));
}
