import { sql } from 'kysely';
import type { Migration } from './index';

/**
 * Catalogue d'exercices et relecture à plusieurs (04 « Modèle de données », 09 §2, spec brique 2 §3 et §6).
 * Valeurs figées ici comme dans 0001 : les constantes de contracts les recoupent (test enum-consistency),
 * le lot (`batch`, un motif) est recoupé avec `BatchSchema` dans schema.test. Pas de CHECK sur les codes de
 * taxonomie extensibles (`movement_pattern`, muscles, articulations, matériel), comme `equipment_code` dans
 * 0001 : le schéma Zod de la fiche les garde avant toute écriture.
 * Les cinq clés vers `user` sont en SET NULL : un compte supprimé ne laisse son id dans aucune ligne, et
 * ses commentaires, validations et révisions restent (« Ancien relecteur »). Une fiche ne se supprime jamais
 * (on la retire) : les clés vers `exercise` n'ont pas d'action. Les pointeurs de chaîne sont vérifiés en fin
 * de transaction, pour que le chargeur insère dans n'importe quel ordre deux fiches qui se pointent.
 */

const FK_USER = 'TEXT REFERENCES user(id) ON DELETE SET NULL';
const FK_EXERCISE = 'TEXT NOT NULL REFERENCES exercise(id)';
const FK_CHAIN = 'TEXT REFERENCES exercise(id) DEFERRABLE INITIALLY DEFERRED';
const STATUS = "TEXT NOT NULL CHECK (status IN ('draft','reviewed','published','retired'))";

const bool = (col: string, withDefault = true) =>
  `${col} INTEGER NOT NULL${withDefault ? ' DEFAULT 0' : ''} CHECK (${col} IN (0,1))`;
const json = (col: string, notNull = false) =>
  `${col} TEXT${notNull ? ' NOT NULL' : ''} CHECK (json_valid(${col}))`;
const revision = 'revision INTEGER NOT NULL CHECK (revision >= 1)';

const table = (name: string, ...defs: string[]) => `CREATE TABLE ${name} (${defs.join(', ')}) STRICT`;

const STATEMENTS: string[] = [
  // Drapeaux de relecteur (spec brique 2 §3.1), écrits par l'admin seulement.
  `ALTER TABLE user ADD COLUMN ${bool('catalog_reviewer')}`,
  `ALTER TABLE user ADD COLUMN ${bool('health_professional')}`,
  // Une ligne par fiche. Champs IA nullables : absents d'un brouillon (R-FIC-1), ils le restent à l'export.
  table(
    'exercise',
    'id TEXT PRIMARY KEY',
    'schema_version INTEGER NOT NULL',
    revision,
    `status ${STATUS}`,
    "batch TEXT NOT NULL CHECK (batch = 'A' OR batch = 'B' OR batch GLOB 'E[1-9]' OR batch GLOB 'E[1-9][0-9]')",
    'name TEXT NOT NULL CHECK (length(name) <= 60)',
    json('aliases'),
    'movement_pattern TEXT NOT NULL',
    "mechanics TEXT NOT NULL CHECK (mechanics IN ('compound','isolation'))",
    bool('unilateral', false),
    "measure TEXT NOT NULL CHECK (measure IN ('reps','duration'))",
    "load_mode TEXT NOT NULL CHECK (load_mode IN ('barbell','dumbbell','machine','weighted','bodyweight','band'))",
    'level INTEGER NOT NULL CHECK (level IN (1,2,3))',
    bool('not_for_minors', false),
    json('primary_muscles'),
    json('secondary_muscles'),
    json('equipment_options', true),
    json('stressed_joints'),
    json('content', true),
    'chain_id TEXT',
    `easier_id ${FK_CHAIN}`,
    `harder_id ${FK_CHAIN}`,
    json('illustrations'),
    // Colonnes éditoriales : jamais servies aux téléphones.
    'review_notes TEXT',
    json('drafting'),
    `reviewed_by ${FK_USER}`,
    'reviewed_at TEXT',
    'published_at TEXT',
    'retired_at TEXT',
    'updated_at TEXT',
    'exported_revision INTEGER',
  ),
  // Une ligne par fichier retenu ; le dépôt fait foi (manifeste).
  table(
    'illustration',
    'id TEXT PRIMARY KEY',
    'file TEXT NOT NULL UNIQUE',
    'sha256 TEXT NOT NULL',
    'bytes INTEGER NOT NULL',
    "media_type TEXT NOT NULL CHECK (media_type IN ('image/svg+xml','image/png','image/webp','image/jpeg'))",
    "source TEXT NOT NULL CHECK (source IN ('everkinetic','workout_guide'))",
    'source_url TEXT NOT NULL',
    json('creators', true),
    "license TEXT NOT NULL CHECK (license IN ('CC-BY-SA-4.0','CC-BY-4.0','CC0-1.0'))",
    'license_url TEXT NOT NULL',
    'modifications TEXT',
    bool('replace_before_public'),
  ),
  // Relecture (classe H) : jamais modifiés ni supprimés ; « Traité » pose resolved_at.
  table(
    'exercise_comment',
    'id TEXT PRIMARY KEY',
    `exercise_id ${FK_EXERCISE}`,
    `author_id ${FK_USER}`,
    "part TEXT NOT NULL CHECK (part IN ('general','name','muscles','equipment','level','not_for_minors','stressed_joints','instructions','key_points','mistakes','safety','breathing','setup','variants','illustrations'))",
    'body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000)',
    revision,
    'created_at TEXT NOT NULL',
    'resolved_at TEXT',
    `resolved_by ${FK_USER}`,
    'CHECK (resolved_at IS NOT NULL OR resolved_by IS NULL)',
  ),
  // `health` : drapeau effectif au moment de valider, pour l'historique ; le feu vert relit le drapeau actuel.
  table(
    'exercise_validation',
    'id TEXT PRIMARY KEY',
    `exercise_id ${FK_EXERCISE}`,
    `reviewer_id ${FK_USER}`,
    revision,
    bool('health', false),
    'created_at TEXT NOT NULL',
    'UNIQUE (exercise_id, reviewer_id, revision)',
  ),
  // Une ligne par enregistrement et par transition ; `content` = contentOf, sans identifiant de compte.
  table(
    'exercise_revision',
    `exercise_id ${FK_EXERCISE}`,
    revision,
    json('content', true),
    `status ${STATUS}`,
    `saved_by ${FK_USER}`,
    'saved_at TEXT NOT NULL',
    'PRIMARY KEY (exercise_id, revision)',
  ),
  'CREATE INDEX exercise_status_idx ON exercise (status)',
  'CREATE INDEX exercise_movement_pattern_idx ON exercise (movement_pattern)',
  'CREATE INDEX exercise_chain_idx ON exercise (chain_id)',
  'CREATE INDEX exercise_comment_exercise_idx ON exercise_comment (exercise_id)',
  'CREATE INDEX exercise_comment_author_idx ON exercise_comment (author_id)',
  'CREATE INDEX exercise_validation_reviewer_idx ON exercise_validation (reviewer_id)',
];

export const catalog: Migration = {
  id: '0003_catalog',
  breaking: false,
  up: async (db) => {
    for (const ddl of STATEMENTS) await sql.raw(ddl).execute(db);
  },
};
