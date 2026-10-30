import type { DraftSheet, IllustrationEntry } from '@rune/contracts';
import { canonicalJson, contentOf } from '@rune/domain';
import type { Insertable, Selectable } from 'kysely';
import type { DbExecutor, ExerciseTable, IllustrationTable } from '../db/schema';

/*
 * Lecture et écriture des fiches et des illustrations en base (04 « Modèle de données », migration 0003_catalog).
 * Une fiche passe de sa forme de fichier (`DraftSheet`, clés de 04 §4) à sa ligne : colonnes JSON en texte, booléens
 * 0/1, clé absente = NULL, textes rédigés regroupés dans `content`.
 */

/** Champs de la fiche rangés dans la colonne `content` (04 « Modèle de données »). */
export const CONTENT_COLUMN_KEYS = [
  'instructions',
  'key_points',
  'mistakes',
  'safety',
  'breathing',
  'setup',
  'easier_tip',
  'harder_tip',
] as const satisfies readonly (keyof DraftSheet)[];

const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));
const fromJson = (text: string | null): unknown => (text === null ? undefined : JSON.parse(text));
const bit = (value: boolean): number => (value ? 1 : 0);
const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

/** Ligne `exercise` d'une fiche ; `exportedRevision` est une colonne de base sans champ de fichier. */
export function sheetToRow(sheet: DraftSheet, exportedRevision: number | null): Insertable<ExerciseTable> {
  const content = Object.fromEntries(
    CONTENT_COLUMN_KEYS.filter((key) => sheet[key] !== undefined).map((key) => [key, sheet[key]]),
  );
  return {
    id: sheet.id,
    schemaVersion: sheet.schema_version,
    revision: sheet.revision,
    status: sheet.status,
    batch: sheet.batch,
    name: sheet.name,
    aliases: toJson(sheet.aliases),
    movementPattern: sheet.movement_pattern,
    mechanics: sheet.mechanics,
    unilateral: bit(sheet.unilateral),
    measure: sheet.measure,
    loadMode: sheet.load_mode,
    level: sheet.level,
    notForMinors: bit(sheet.not_for_minors),
    primaryMuscles: toJson(sheet.primary_muscles),
    secondaryMuscles: toJson(sheet.secondary_muscles),
    equipmentOptions: JSON.stringify(sheet.equipment_options),
    stressedJoints: toJson(sheet.stressed_joints),
    content: JSON.stringify(content),
    chainId: sheet.chain_id ?? null,
    easierId: sheet.easier_id ?? null,
    harderId: sheet.harder_id ?? null,
    illustrations: toJson(sheet.illustrations),
    reviewNotes: sheet.review_notes ?? null,
    drafting: toJson(sheet.drafting),
    reviewedBy: sheet.reviewed_by ?? null,
    reviewedAt: sheet.reviewed_at ?? null,
    publishedAt: sheet.published_at ?? null,
    retiredAt: sheet.retired_at ?? null,
    updatedAt: sheet.updated_at ?? null,
    exportedRevision,
  };
}

/**
 * Fiche d'une ligne `exercise`, clés dans l'ordre de 04 §4 (forme canonique) ; colonne NULL = clé absente. La ligne
 * a été validée à l'écriture : elle n'est pas revalidée ici.
 */
export function rowToSheet(row: Selectable<ExerciseTable>): DraftSheet {
  const content = JSON.parse(row.content) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: row.id,
    schema_version: row.schemaVersion,
    revision: row.revision,
    status: row.status,
    batch: row.batch,
    name: row.name,
    aliases: fromJson(row.aliases),
    movement_pattern: row.movementPattern,
    mechanics: row.mechanics,
    unilateral: row.unilateral === 1,
    measure: row.measure,
    load_mode: row.loadMode,
    primary_muscles: fromJson(row.primaryMuscles),
    secondary_muscles: fromJson(row.secondaryMuscles),
    equipment_options: JSON.parse(row.equipmentOptions),
    level: row.level,
    not_for_minors: row.notForMinors === 1,
    stressed_joints: fromJson(row.stressedJoints),
    ...Object.fromEntries(CONTENT_COLUMN_KEYS.map((key) => [key, content[key]])),
    chain_id: opt(row.chainId),
    easier_id: opt(row.easierId),
    harder_id: opt(row.harderId),
    illustrations: fromJson(row.illustrations),
    review_notes: opt(row.reviewNotes),
    drafting: fromJson(row.drafting),
    reviewed_by: opt(row.reviewedBy),
    reviewed_at: opt(row.reviewedAt),
    published_at: opt(row.publishedAt),
    retired_at: opt(row.retiredAt),
    updated_at: opt(row.updatedAt),
  };
  return JSON.parse(canonicalJson(record)) as DraftSheet;
}

/**
 * Insère une fiche et sa ligne `exercise_revision` (spec brique 2 §3.5) : `content` = `contentOf` en forme
 * canonique, `saved_by` NULL pour le chargeur. À appeler dans une transaction.
 */
export async function insertSheet(
  db: DbExecutor,
  sheet: DraftSheet,
  o: { savedAt: string; savedBy: string | null; exportedRevision: number | null },
): Promise<void> {
  await db.insertInto('exercise').values(sheetToRow(sheet, o.exportedRevision)).execute();
  await db
    .insertInto('exerciseRevision')
    .values({
      exerciseId: sheet.id,
      revision: sheet.revision,
      content: canonicalJson(contentOf(sheet)),
      status: sheet.status,
      savedBy: o.savedBy,
      savedAt: o.savedAt,
    })
    .execute();
}

/** Ligne `illustration` d'une entrée du manifeste. */
export function entryToRow(entry: IllustrationEntry): Insertable<IllustrationTable> {
  return {
    id: entry.id,
    file: entry.file,
    sha256: entry.sha256,
    bytes: entry.bytes,
    mediaType: entry.media_type,
    source: entry.source,
    sourceUrl: entry.source_url,
    creators: JSON.stringify(entry.creators),
    license: entry.license,
    licenseUrl: entry.license_url,
    modifications: entry.modifications ?? null,
    replaceBeforePublic: bit(entry.replace_before_public),
  };
}

/** Entrée du manifeste d'une ligne `illustration`, clés dans l'ordre de `IllustrationEntry`. */
export function rowToEntry(row: Selectable<IllustrationTable>): IllustrationEntry {
  return {
    id: row.id,
    file: row.file,
    sha256: row.sha256,
    bytes: row.bytes,
    media_type: row.mediaType,
    source: row.source,
    source_url: row.sourceUrl,
    creators: JSON.parse(row.creators) as string[],
    license: row.license,
    license_url: row.licenseUrl,
    ...(row.modifications === null ? {} : { modifications: row.modifications }),
    replace_before_public: row.replaceBeforePublic === 1,
  };
}

/** Insère ou met à jour une illustration : le dépôt fait foi pour le manifeste (04 §10). */
export async function upsertIllustration(db: DbExecutor, entry: IllustrationEntry): Promise<void> {
  const { id: _, ...changes } = entryToRow(entry);
  await db
    .insertInto('illustration')
    .values(entryToRow(entry))
    .onConflict((oc) => oc.column('id').doUpdateSet(changes))
    .execute();
}
