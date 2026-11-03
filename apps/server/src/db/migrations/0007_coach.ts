import { sql } from 'kysely';
import type { Migration } from './index';

/**
 * Coach IA (spec brique 4 §6.1). Six tables de classe H : jamais synchronisées, jamais dans Dexie. Valeurs
 * figées ici comme dans 0001 et 0004 : les constantes de contracts les recoupent (test enum-consistency).
 *
 * Les quatre tables personnelles portent `user_id` en cascade : un compte supprimé n'en laisse aucune ligne.
 * `coach_safety_counter` (anonyme, sans `user_id`) et `coach_state` (une seule ligne, `id` = 1, insérée ici,
 * coach désactivé) restent.
 *
 * `coach_call.thread_id` et `coach_report.thread_id` n'ont pas de clé : le journal d'usage vit 12 mois et le
 * signalement 90 jours, la suppression d'un fil ne doit pas les emporter (spec §6.3).
 *
 * `coach_thread.slot_aliases` (ajout du contrôleur) : table alias → identifiant réel des slots ajoutés par la
 * personne, figée avec le dossier du jour. Elle ne peut pas aller dans `brief`, envoyé tel quel au modèle ;
 * elle n'est pas exportée (identifiants internes, `secretColumns` du registre).
 */

const bool = (col: string, def = 0) => `${col} INTEGER NOT NULL DEFAULT ${def} CHECK (${col} IN (0,1))`;
const json = (col: string) => `${col} TEXT CHECK (json_valid(${col}))`;
const oneOf = (col: string, values: readonly string[], notNull = true) =>
  `${col} TEXT${notNull ? ' NOT NULL' : ''} CHECK (${col} IN (${values.map((v) => `'${v}'`).join(',')}))`;
const count = (col: string) => `${col} INTEGER NOT NULL DEFAULT 0 CHECK (${col} >= 0)`;
const note = (col: string) => `${col} TEXT CHECK (length(${col}) <= 500)`;

const FK_USER = 'TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE';

const table = (name: string, ...defs: string[]) => `CREATE TABLE ${name} (${defs.join(', ')}) STRICT`;

const STATEMENTS: string[] = [
  // C3. Un fil par personne et par jour de Paris ; réglages et dossier figés à l'ouverture.
  table(
    'coach_thread',
    'id TEXT PRIMARY KEY',
    `user_id ${FK_USER}`,
    'day TEXT NOT NULL',
    oneOf('audience', ['adult', 'minor']),
    oneOf('persona', ['ombre', 'skald', 'scribe']),
    'model TEXT NOT NULL',
    oneOf('effort', ['low', 'medium', 'high']),
    'prompt_version TEXT NOT NULL',
    'tools_version TEXT NOT NULL',
    'brief_schema TEXT NOT NULL',
    json('brief'),
    "slot_aliases TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(slot_aliases))",
    bool('is_open', 1),
    oneOf('closed_reason', ['version_change', 'health_withdrawn', 'day_over'], false),
    count('user_message_count'),
    'created_at TEXT NOT NULL',
    'last_message_at TEXT',
    'UNIQUE (user_id, day)',
  ),
  // C3, en ajout seulement (`blocks` au retrait santé et la suppression font exception).
  table(
    'coach_message',
    'id TEXT PRIMARY KEY',
    'thread_id TEXT NOT NULL REFERENCES coach_thread(id) ON DELETE CASCADE',
    `user_id ${FK_USER}`,
    'seq INTEGER NOT NULL',
    oneOf('role', ['user', 'assistant', 'system']),
    json('blocks'),
    'display_text TEXT',
    json('display_extras'),
    'client_message_id TEXT',
    bool('ai_generated'),
    'effective_model TEXT',
    'stop_reason TEXT',
    bool('truncated'),
    'created_at TEXT NOT NULL',
    'UNIQUE (thread_id, seq)',
    'UNIQUE (thread_id, client_message_id)',
  ),
  // C1 : journal d'usage sans contenu, une ligne par échange.
  table(
    'coach_call',
    'id TEXT PRIMARY KEY',
    `user_id ${FK_USER}`,
    'thread_id TEXT',
    'day TEXT NOT NULL',
    'created_at TEXT NOT NULL',
    'requested_model TEXT NOT NULL',
    'effective_model TEXT',
    bool('fallback_used'),
    count('api_calls'),
    count('input_tokens'),
    count('cache_write_tokens'),
    count('cache_read_tokens'),
    count('output_tokens'),
    count('cost_usd_micros'),
    'first_text_latency_ms INTEGER',
    count('duration_ms'),
    'stop_reason TEXT',
    'refusal_category TEXT',
    count('tool_rounds'),
    count('filter_blocks'),
    count('thinking_dropped'),
    'error_code TEXT',
    bool('counted'),
  ),
  // C3 : copie de l'échange choisie par la personne.
  table(
    'coach_report',
    'id TEXT PRIMARY KEY',
    `user_id ${FK_USER}`,
    'thread_id TEXT',
    'message_seq INTEGER NOT NULL',
    oneOf('category', ['inaccurate', 'unsafe', 'inappropriate', 'other']),
    note('comment'),
    'exchange_text TEXT NOT NULL',
    'created_at TEXT NOT NULL',
  ),
  // C0 : compteurs mensuels anonymes du cercle, sans `user_id`.
  table(
    'coach_safety_counter',
    'month TEXT NOT NULL',
    oneOf('kind', [
      'help_emergency',
      'help_pain',
      'help_eating_disorder',
      'help_doping',
      'help_pregnancy',
      'help_distress',
      'filter_block',
      'refusal',
    ]),
    count('count'),
    'PRIMARY KEY (month, kind)',
  ),
  // C0 : une seule ligne (`id` = 1), insérée juste après.
  table(
    'coach_state',
    'id INTEGER PRIMARY KEY CHECK (id = 1)',
    bool('enabled'),
    'suspended_until TEXT',
    'updated_at TEXT NOT NULL',
  ),
  "INSERT INTO coach_state (id, enabled, suspended_until, updated_at) VALUES (1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
];

const INDEXES: string[] = [
  'CREATE INDEX coach_thread_last_message_idx ON coach_thread (last_message_at)',
  'CREATE INDEX coach_thread_created_idx ON coach_thread (created_at)',
  'CREATE INDEX coach_call_user_day_idx ON coach_call (user_id, day)',
  'CREATE INDEX coach_call_created_idx ON coach_call (created_at)',
];

export const coachTables: Migration = {
  id: '0007_coach',
  breaking: false,
  up: async (db) => {
    for (const ddl of [...STATEMENTS, ...INDEXES]) await sql.raw(ddl).execute(db);
  },
};
