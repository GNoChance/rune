import { sql } from 'kysely';
import type { Migration } from './index';

/**
 * Nutrition (spec brique 5 §6.1, 07 §5.12, 09 §5). Six tables : `nutrition_profile` (E), `weigh_in` (J),
 * `nutrition_target` et `nutrition_checkin` (D), `advice_sheet` (C, partagée) et `nutrition_state` (une ligne,
 * `id` = 1, insérée ici comme `coach_state`). Valeurs figées ici comme dans 0001 et 0007 : les constantes de
 * contracts les recoupent (test enum-consistency).
 *
 * Les colonnes C2 des tables personnelles sont nullables : au retrait du consentement santé il ne reste de la
 * ligne qu'une tombstone sans contenu (`id`, `owner_id`, `rev`, `deleted_at`, 09 §5). Un CHECK exige les
 * colonnes tant que la ligne est vivante, comme `health_screening`.
 *
 * `coach_thread` est reconstruite pour que `closed_reason` accepte `nutrition_mode_change` (spec §11.1,
 * choix C31), par la méthode de 0008 : messages mis de côté, table recréée à l'identique, index rétablis.
 */

const bool = (col: string, def = 0) => `${col} INTEGER NOT NULL DEFAULT ${def} CHECK (${col} IN (0,1))`;
const json = (col: string, notNull = false) =>
  `${col} TEXT${notNull ? ' NOT NULL' : ''} CHECK (json_valid(${col}))`;
const oneOf = (col: string, values: readonly string[], notNull = false) =>
  `${col} TEXT${notNull ? ' NOT NULL' : ''} CHECK (${col} IN (${values.map((v) => `'${v}'`).join(',')}))`;

/** Gabarit +SYNC (09 §0). */
const sync = () =>
  [
    'owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE',
    'rev INTEGER NOT NULL',
    'created_at TEXT NOT NULL',
    'updated_at TEXT NOT NULL',
    'updated_by TEXT REFERENCES user(id) ON DELETE SET NULL',
    'deleted_at TEXT',
  ].join(', ');

/** Colonnes exigées tant que la ligne n'est pas une tombstone. */
const live = (...cols: string[]) =>
  `CHECK (deleted_at IS NOT NULL OR (${cols.map((c) => `${c} IS NOT NULL`).join(' AND ')}))`;

const table = (name: string, ...defs: string[]) => `CREATE TABLE ${name} (${defs.join(', ')}) STRICT`;

const GOALS = ['lose', 'maintain', 'gain'] as const;

const TARGET_INTS = [
  'kcal_target',
  'kcal_min',
  'kcal_max',
  'protein_g_min',
  'protein_g_max',
  'fat_g_min',
  'carbs_g',
  'fiber_g',
  'water_ml',
] as const;

const PERSONAL = ['nutrition_profile', 'weigh_in', 'nutrition_target', 'nutrition_checkin'] as const;

const NUTRITION_STATEMENTS: string[] = [
  // 1-1 avec user, `id` = `owner_id`. `mode` et `mode_reason` en C1 (`safety` : C2), le reste en C2.
  table(
    'nutrition_profile',
    'id TEXT PRIMARY KEY',
    sync(),
    "mode TEXT NOT NULL DEFAULT 'disabled' CHECK (mode IN ('full','qualitative','disabled'))",
    oneOf('mode_reason', ['choice', 'safety']),
    'safety_screen_version INTEGER',
    'safety_screen_at TEXT',
    bool('safety_pause'),
    oneOf('sex_for_calc', ['male', 'female', 'unspecified']),
    'height_cm INTEGER CHECK (height_cm BETWEEN 120 AND 220)',
    'activity_level INTEGER CHECK (activity_level BETWEEN 1 AND 4)',
    oneOf('goal', GOALS),
    'cumulative_adjustment_kcal INTEGER NOT NULL DEFAULT 0 CHECK (cumulative_adjustment_kcal % 100 = 0)',
    'CHECK (id = owner_id)',
  ),
  // Classe J : `id` UUIDv7 du client ; une seule pesée vivante par (owner_id, date), voir l'index plus bas.
  table(
    'weigh_in',
    'id TEXT PRIMARY KEY',
    sync(),
    'date TEXT',
    'weight_g INTEGER CHECK (weight_g BETWEEN 30000 AND 250000 AND weight_g % 100 = 0)',
    live('date', 'weight_g'),
  ),
  // Immuable, écrite par le serveur ; la cible en vigueur est la dernière par (valid_from, id).
  table(
    'nutrition_target',
    'id TEXT PRIMARY KEY',
    sync(),
    'valid_from TEXT',
    'algo_version TEXT',
    oneOf('reason', [
      'initial',
      'checkin',
      'weight_recalibration',
      'profile_change',
      'low_bmi_safety',
      'new_algo_version',
    ]),
    json('inputs'),
    oneOf('effective_goal', GOALS),
    'bmr_kcal REAL',
    'tdee_kcal REAL',
    ...TARGET_INTS.map((c) => `${c} INTEGER`),
    json('applied_rules'),
    live(
      'valid_from',
      'algo_version',
      'reason',
      'inputs',
      'effective_goal',
      'bmr_kcal',
      'tdee_kcal',
      ...TARGET_INTS,
      'applied_rules',
    ),
  ),
  // Écrit par le serveur ; `response` par l'API en ligne. Un seul bilan par (owner_id, week_start).
  table(
    'nutrition_checkin',
    'id TEXT PRIMARY KEY',
    sync(),
    'week_start TEXT',
    'weigh_in_count INTEGER',
    'mean_weight_g INTEGER',
    'change_pct REAL',
    'representative INTEGER CHECK (representative IN (0,1))',
    oneOf('decision', [
      'insufficient_data',
      'non_representative_week',
      'in_band',
      'out_of_band_pending',
      'proposal',
      'rapid_loss',
      'limit_reached',
      'safety_pause',
    ]),
    oneOf('position', ['above', 'in', 'below']),
    'proposed_delta_kcal INTEGER CHECK (proposed_delta_kcal IN (-100,100))',
    oneOf('response', ['accepted', 'declined']),
    'responded_at TEXT',
    'created_target_id TEXT REFERENCES nutrition_target(id)',
    'recalibration_target_id TEXT REFERENCES nutrition_target(id)',
    'UNIQUE (owner_id, week_start)',
    live('week_start', 'weigh_in_count', 'representative', 'decision'),
  ),
  // C0 partagée, sans colonne de synchro par propriétaire. `content_hash` sert au chargeur de fiches.
  table(
    'advice_sheet',
    'id TEXT PRIMARY KEY',
    'title TEXT NOT NULL',
    'body_md TEXT NOT NULL',
    oneOf('audience', ['adults', 'minors', 'all'], true),
    json('visible_modes', true),
    json('tags', true),
    json('sources', true),
    oneOf('status', ['draft', 'reviewed', 'published', 'retired'], true),
    'version INTEGER NOT NULL DEFAULT 1',
    oneOf('draft_origin', ['ai', 'human'], true),
    'reviewed_by TEXT REFERENCES user(id) ON DELETE SET NULL',
    'reviewed_at TEXT',
    'published_at TEXT',
    'retired_at TEXT',
    'updated_at TEXT NOT NULL',
    'content_hash TEXT NOT NULL',
  ),
  // C0 : une seule ligne (`id` = 1), insérée juste après ; `full_open` = 0 tant que le mode complet est fermé.
  table(
    'nutrition_state',
    'id INTEGER PRIMARY KEY CHECK (id = 1)',
    bool('full_open'),
    'updated_at TEXT NOT NULL',
    'updated_by TEXT REFERENCES user(id) ON DELETE SET NULL',
  ),
  "INSERT INTO nutrition_state (id, full_open, updated_at, updated_by) VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL)",
];

const NUTRITION_INDEXES: string[] = [
  ...PERSONAL.map((t) => `CREATE INDEX ${t}_rev_idx ON ${t} (rev)`),
  ...PERSONAL.map((t) => `CREATE INDEX ${t}_owner_rev_idx ON ${t} (owner_id, rev)`),
  'CREATE UNIQUE INDEX weigh_in_owner_date_uq ON weigh_in (owner_id, date) WHERE deleted_at IS NULL',
  'CREATE INDEX nutrition_target_owner_valid_from_idx ON nutrition_target (owner_id, valid_from)',
];

const THREAD_COLUMNS = `id, user_id, day, audience, persona, model, effort, prompt_version, tools_version, brief_schema, brief, slot_aliases, is_open, closed_reason, user_message_count, created_at, last_message_at`;
const MESSAGE_COLUMNS = `id, thread_id, user_id, seq, role, blocks, display_text, display_extras, client_message_id, ai_generated, effective_model, stop_reason, truncated, created_at`;

/** DDL sur une ligne, comme celui de 0007 et 0008 (le schéma figé en garde le texte). */
const oneLine = (ddl: string): string =>
  ddl
    .replace(/\(\n\s*/, '(')
    .replace(/,\n\s*/g, ', ')
    .replace(/\n\)/, ')');

const CREATE_THREAD = oneLine(`CREATE TABLE coach_thread (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('adult','minor')),
  persona TEXT NOT NULL CHECK (persona IN ('ombre','skald','scribe')),
  model TEXT NOT NULL,
  effort TEXT NOT NULL CHECK (effort IN ('low','medium','high')),
  prompt_version TEXT NOT NULL,
  tools_version TEXT NOT NULL,
  brief_schema TEXT NOT NULL,
  brief TEXT CHECK (json_valid(brief)),
  slot_aliases TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(slot_aliases)),
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0,1)),
  closed_reason TEXT CHECK (closed_reason IN ('version_change','health_withdrawn','day_over','persona_change','nutrition_mode_change')),
  user_message_count INTEGER NOT NULL DEFAULT 0 CHECK (user_message_count >= 0),
  created_at TEXT NOT NULL,
  last_message_at TEXT
) STRICT`);

const CREATE_MESSAGE = oneLine(`CREATE TABLE coach_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES coach_thread(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  blocks TEXT CHECK (json_valid(blocks)),
  display_text TEXT,
  display_extras TEXT CHECK (json_valid(display_extras)),
  client_message_id TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0 CHECK (ai_generated IN (0,1)),
  effective_model TEXT,
  stop_reason TEXT,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (thread_id, seq),
  UNIQUE (thread_id, client_message_id)
) STRICT`);

const REBUILD_COACH: string[] = [
  `CREATE TABLE coach_message_save AS SELECT ${MESSAGE_COLUMNS} FROM coach_message`,
  'DROP TABLE coach_message',
  `CREATE TABLE coach_thread_new AS SELECT ${THREAD_COLUMNS} FROM coach_thread`,
  'DROP TABLE coach_thread',
  CREATE_THREAD,
  `INSERT INTO coach_thread (${THREAD_COLUMNS}) SELECT ${THREAD_COLUMNS} FROM coach_thread_new`,
  'DROP TABLE coach_thread_new',
  CREATE_MESSAGE,
  `INSERT INTO coach_message (${MESSAGE_COLUMNS}) SELECT ${MESSAGE_COLUMNS} FROM coach_message_save`,
  'DROP TABLE coach_message_save',
  'CREATE INDEX coach_thread_last_message_idx ON coach_thread (last_message_at)',
  'CREATE INDEX coach_thread_created_idx ON coach_thread (created_at)',
  'CREATE UNIQUE INDEX coach_thread_open_day_idx ON coach_thread (user_id, day) WHERE is_open = 1',
];

export const nutrition: Migration = {
  id: '0009_nutrition',
  breaking: false,
  up: async (db) => {
    for (const ddl of [...NUTRITION_STATEMENTS, ...NUTRITION_INDEXES, ...REBUILD_COACH])
      await sql.raw(ddl).execute(db);
  },
};
