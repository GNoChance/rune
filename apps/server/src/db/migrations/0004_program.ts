import { sql } from 'kysely';
import type { Migration } from './index';

/**
 * Programmes et séances (09 §3, spec brique 3 §5.1). Valeurs figées ici comme dans 0001 et 0003 : les
 * constantes de contracts les recoupent (test enum-consistency). Tables +SYNC (09 §0), toutes à `owner_id`
 * en cascade : un compte supprimé n'en laisse aucune ligne.
 *
 * Écarts à 09 §3 (spec §5.1) : pas de clé étrangère de `workout_session.instance_id` vers `program_instance`
 * ni de `workout_session.place_id` vers `place` (une restauration rejoue les séances de moins de 60 jours
 * sans les lignes de classe E écrites depuis la sauvegarde : une séance orpheline est gardée, non rejetée,
 * R-SYN-26 et R-SYN-28), ni de `slot_state.exercise_id` vers `exercise` (il peut porter un `chain_id`).
 * `coach_thread_id` n'a pas de clé étrangère non plus : `coach_thread` n'existe pas avant la brique 4.
 * Le `slot_id` d'un slot ajouté vaut `<séance>-<UUIDv7>` : aucun plafond de longueur.
 */

const FK_USER = 'TEXT REFERENCES user(id) ON DELETE SET NULL';

const bool = (col: string) => `${col} INTEGER NOT NULL DEFAULT 0 CHECK (${col} IN (0,1))`;
const json = (col: string, notNull = false) =>
  `${col} TEXT${notNull ? ' NOT NULL' : ''} CHECK (json_valid(${col}))`;
const oneOf = (col: string, values: readonly string[], notNull = true) =>
  `${col} TEXT${notNull ? ' NOT NULL' : ''} CHECK (${col} IN (${values.map((v) => `'${v}'`).join(',')}))`;
const between = (col: string, min: number, max: number, notNull = false) =>
  `${col} INTEGER${notNull ? ' NOT NULL' : ''} CHECK (${col} BETWEEN ${min} AND ${max})`;
const count = (col: string) => `${col} INTEGER NOT NULL DEFAULT 0 CHECK (${col} >= 0)`;
const note = (col: string) => `${col} TEXT CHECK (length(${col}) <= 500)`;

/** Gabarit +SYNC (09 §0). */
const sync = () =>
  [
    'owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE',
    'rev INTEGER NOT NULL',
    'created_at TEXT NOT NULL',
    'updated_at TEXT NOT NULL',
    `updated_by ${FK_USER}`,
    'deleted_at TEXT',
  ].join(', ');

const table = (name: string, ...defs: string[]) => `CREATE TABLE ${name} (${defs.join(', ')}) STRICT`;

const LOAD_MODES = ['barbell', 'dumbbell', 'machine', 'weighted', 'bodyweight', 'band'] as const;

const STATEMENTS: string[] = [
  // Copie figée du modèle ; `revision` (version du contenu) est distincte de `rev` (synchro).
  table(
    'program_instance',
    'id TEXT PRIMARY KEY',
    sync(),
    'template_id TEXT NOT NULL',
    'template_version INTEGER NOT NULL',
    json('snapshot', true),
    between('days_per_week', 2, 4, true),
    oneOf('status', ['active', 'ended']),
    'revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)',
    'started_at TEXT NOT NULL',
    'ended_at TEXT',
  ),
  // Seule entité de proposition ou de modification du programme. `reason` est C2.
  table(
    'instance_change',
    'id TEXT PRIMARY KEY',
    sync(),
    'instance_id TEXT NOT NULL REFERENCES program_instance(id) ON DELETE CASCADE',
    'base_revision INTEGER NOT NULL CHECK (base_revision >= 0)',
    oneOf('author', ['user', 'coach', 'engine']),
    json('operations', true),
    'reason_code TEXT NOT NULL',
    'reason TEXT',
    oneOf('status', ['proposed', 'accepted', 'rejected', 'expired']),
    'expires_at TEXT',
    'decided_at TEXT',
    bool('ai_generated'),
    'ai_model TEXT',
    'prompt_version TEXT',
    'coach_thread_id TEXT',
    'CHECK (json_array_length(operations) BETWEEN 1 AND 5)',
  ),
  // Cache recalculable (classe D). Clé déterministe `instance:slot:exercice`.
  table(
    'slot_state',
    'id TEXT PRIMARY KEY',
    sync(),
    'instance_id TEXT NOT NULL REFERENCES program_instance(id) ON DELETE CASCADE',
    'slot_id TEXT NOT NULL',
    'exercise_id TEXT NOT NULL',
    oneOf('mode', ['linear', 'double', 'sum', 'chain', 'duration']),
    'load_g INTEGER',
    'target_reps INTEGER',
    'variant_rank INTEGER',
    'duration_s INTEGER',
    'machine_step_g_override INTEGER',
    count('calibration_left'),
    count('no_progress_count'),
    count('stall_rank'),
    'pain_streak INTEGER',
    bool('suspended'),
    'last_session_id TEXT',
    'rules_version TEXT NOT NULL',
    "CHECK (id = instance_id || ':' || slot_id || ':' || exercise_id)",
  ),
  // Séance libre (`instance_id` NULL), voir l'écart de clé étrangère plus haut.
  table(
    'workout_session',
    'id TEXT PRIMARY KEY',
    sync(),
    'instance_id TEXT',
    'workout_id TEXT',
    'place_id TEXT',
    'device_id TEXT NOT NULL',
    'started_at TEXT NOT NULL',
    'ended_at TEXT',
    oneOf('status', ['in_progress', 'completed', 'abandoned']),
    oneOf('week_type', ['normal', 'deload']),
    'template_version INTEGER',
    'rules_version TEXT NOT NULL',
    'app_version TEXT NOT NULL',
    oneOf('profile', ['adult', 'cautious']),
    note('note'),
  ),
  // `pain_level` et `swap_reason = 'pain'` sont C2. L'exercice peut être retiré du catalogue : pas de clé.
  table(
    'performed_exercise',
    'id TEXT PRIMARY KEY',
    sync(),
    'session_id TEXT NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE',
    'slot_id TEXT',
    'planned_exercise_id TEXT',
    'exercise_id TEXT NOT NULL',
    oneOf('swap_reason', ['equipment', 'busy', 'pain', 'preference'], false),
    between('position', 1, 99, true),
    oneOf('pain_level', ['none', 'discomfort', 'pain'], false),
    oneOf('next_adjustment', ['hold', 'lighten'], false),
    note('note'),
  ),
  // 1-1 avec performed_exercise (`id` = son identifiant), calculé par le serveur.
  table(
    'engine_decision',
    'id TEXT PRIMARY KEY REFERENCES performed_exercise(id) ON DELETE CASCADE',
    sync(),
    'instance_id TEXT',
    'slot_id TEXT',
    'exercise_id TEXT NOT NULL',
    oneOf('result', [
      'PROGRESS',
      'HOLD',
      'FAIL',
      'IGNORED',
      'DELOAD',
      'ADJUSTED_HOLD',
      'ADJUSTED_LIGHTEN',
      'CALIBRATION',
      'STALL',
    ]),
    'reason_code TEXT NOT NULL',
    json('next_target'),
    oneOf('profile', ['adult', 'cautious']),
    'rules_version TEXT NOT NULL',
  ),
  table(
    'performed_set',
    'id TEXT PRIMARY KEY',
    sync(),
    'performed_exercise_id TEXT NOT NULL REFERENCES performed_exercise(id) ON DELETE CASCADE',
    between('position', 1, 99, true),
    oneOf('kind', ['warmup', 'work']),
    oneOf('load_mode', LOAD_MODES),
    between('load_g', 0, 500_000),
    between('reps', 0, 200),
    between('duration_s', 0, 7200),
    oneOf('side', ['left', 'right'], false),
    oneOf('effort', ['easy', 'ok', 'hard', 'failed'], false),
    'target_reps_min INTEGER',
    'target_reps_max INTEGER',
    'target_duration_s INTEGER',
    'target_load_g INTEGER',
    'target_rir INTEGER',
    'target_variant TEXT',
    'logged_at TEXT',
    'CHECK (reps IS NULL OR duration_s IS NULL)',
  ),
];

const TABLES = [
  'program_instance',
  'instance_change',
  'slot_state',
  'workout_session',
  'performed_exercise',
  'engine_decision',
  'performed_set',
];

const INDEXES: string[] = [
  ...TABLES.map((t) => `CREATE INDEX ${t}_rev_idx ON ${t} (rev)`),
  ...TABLES.map((t) => `CREATE INDEX ${t}_owner_rev_idx ON ${t} (owner_id, rev)`),
  // Une seule instance active vivante par propriétaire (09 §3).
  "CREATE UNIQUE INDEX program_instance_owner_active_uq ON program_instance (owner_id) WHERE status = 'active' AND deleted_at IS NULL",
  'CREATE INDEX instance_change_instance_created_idx ON instance_change (instance_id, created_at)',
  'CREATE INDEX instance_change_owner_status_idx ON instance_change (owner_id, status)',
  'CREATE INDEX slot_state_instance_idx ON slot_state (instance_id)',
  'CREATE INDEX workout_session_owner_started_idx ON workout_session (owner_id, started_at)',
  'CREATE INDEX performed_exercise_session_idx ON performed_exercise (session_id)',
  'CREATE INDEX performed_set_exercise_idx ON performed_set (performed_exercise_id)',
];

export const program: Migration = {
  id: '0004_program',
  breaking: false,
  up: async (db) => {
    for (const ddl of [...STATEMENTS, ...INDEXES]) await sql.raw(ddl).execute(db);
  },
};
