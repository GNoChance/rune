export type DataCategory = 'C0' | 'C1' | 'C2' | 'C3';
export type SyncClass = 'J' | 'D' | 'E' | 'C' | 'H';
export type OnUserDelete = 'cascade' | 'set_null' | 'anonymize' | 'keep' | 'not_linked';

export interface EntityRule {
  category: DataCategory;
  syncClass: SyncClass;
  ownerColumn: 'owner_id' | 'user_id' | 'id' | null;
  columns: readonly string[];
  clientWritable: readonly string[];
  c2Columns: readonly string[];
  secretColumns: readonly string[];
  exported: boolean;
  onUserDelete: OnUserDelete;
  /** Parent d'une table J (rejet `parent_rejected`, renvoi `restore_upsert` trié parents d'abord). */
  parent?: { entity: string; column: string };
  /** Colonne C1 → valeurs C2 (ex. `swap_reason: ['pain']`) ; clés ⊂ columns \ c2Columns. */
  c2Values?: Record<string, readonly string[]>;
  /** Colonnes vers `user` d'une table sans propriétaire, mises à null au pull sauf si elles valent l'utilisateur de la session. */
  pullRedact?: readonly string[];
}

export type EntityRulesMap = Readonly<Record<string, EntityRule>>;

export const SYNC_COLUMNS = [
  'owner_id',
  'rev',
  'created_at',
  'updated_at',
  'updated_by',
  'deleted_at',
] as const;

type Spec = Pick<
  EntityRule,
  'category' | 'syncClass' | 'ownerColumn' | 'columns' | 'exported' | 'onUserDelete'
> &
  Partial<Pick<EntityRule, 'clientWritable' | 'secretColumns' | 'pullRedact'>>;

const rule = (spec: Spec): EntityRule => ({ clientWritable: [], c2Columns: [], secretColumns: [], ...spec });

export const entityRules: EntityRulesMap = {
  server_meta: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: [
      'id',
      'server_epoch',
      'epoch_started_at',
      'epoch_base_rev',
      'sync_counter',
      'tombstone_purge_rev',
      'catalog_version',
      'catalog_updated_at',
    ],
    exported: false,
    onUserDelete: 'not_linked',
  }),
  schema_migrations: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: ['id', 'breaking', 'applied_at'],
    exported: false,
    onUserDelete: 'not_linked',
  }),
  applied_op: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: 'user_id',
    columns: ['op_id', 'user_id', 'entity', 'row_id', 'status', 'assigned_rev', 'applied_at'],
    exported: false,
    onUserDelete: 'cascade',
  }),
  sync_rejection: rule({
    category: 'C1',
    syncClass: 'J',
    ownerColumn: 'owner_id',
    columns: ['id', ...SYNC_COLUMNS, 'op_id', 'entity', 'row_id', 'code', 'detail_json', 'dismissed_at'],
    clientWritable: ['dismissed_at'],
    exported: true,
    onUserDelete: 'cascade',
  }),
  user: rule({
    category: 'C0',
    syncClass: 'E',
    ownerColumn: 'id',
    columns: [
      'id',
      'username',
      'username_key',
      'password_hash',
      'role',
      'status',
      'birth_date',
      'terms_version',
      'terms_accepted_at',
      'last_login_at',
      'password_changed_at',
      'onboarding_step',
      'onboarding_completed_at',
      'invitation_id',
      'rev',
      'created_at',
      'updated_at',
      'updated_by',
      // Drapeaux de relecteur (spec brique 2 §3.1) : C0 admin comme `role`, exportés, effacés avec le compte.
      'catalog_reviewer',
      'health_professional',
    ],
    secretColumns: ['password_hash'],
    exported: true,
    onUserDelete: 'cascade',
  }),
  invitation: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: [
      'id',
      'code_hash',
      'note',
      'birth_date',
      'is_admin_bootstrap',
      'created_by',
      'created_at',
      'expires_at',
      'used_at',
      'used_by',
      'revoked_at',
    ],
    secretColumns: ['code_hash'],
    exported: false,
    onUserDelete: 'set_null',
  }),
  password_reset: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: 'user_id',
    columns: [
      'id',
      'user_id',
      'code_hash',
      'created_by',
      'created_at',
      'expires_at',
      'used_at',
      'cancelled_at',
    ],
    secretColumns: ['code_hash'],
    exported: false,
    onUserDelete: 'cascade',
  }),
  session: rule({
    category: 'C1',
    syncClass: 'H',
    ownerColumn: 'user_id',
    columns: [
      'id',
      'token_hash',
      'user_id',
      'created_at',
      'last_seen_at',
      'expires_at',
      'must_change_password',
      'revoked_at',
      'revoked_reason',
    ],
    secretColumns: ['token_hash'],
    exported: false, // anonymisée à la suppression, non exportée (02 R-EXP-2)
    onUserDelete: 'anonymize',
  }),
  consent_event: rule({
    category: 'C1',
    syncClass: 'E',
    ownerColumn: 'owner_id',
    columns: [
      'id',
      'owner_id',
      'type',
      'action',
      'text_version',
      'rev',
      'created_at',
      'updated_at',
      'updated_by',
    ],
    exported: true,
    onUserDelete: 'cascade',
  }),
  security_event: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: ['id', 'at', 'type', 'actor_id', 'target_id', 'tailnet_ip', 'outcome', 'details'],
    exported: false,
    onUserDelete: 'keep',
  }),
  training_profile: rule({
    category: 'C1',
    syncClass: 'E',
    ownerColumn: 'owner_id',
    columns: [
      'id',
      ...SYNC_COLUMNS,
      'goal',
      'experience',
      'days_per_week',
      'session_minutes',
      'sport_code',
      'sport_other_label',
      'cautious_mode',
      'coach',
    ],
    exported: true,
    onUserDelete: 'cascade',
  }),
  health_screening: rule({
    category: 'C2',
    syncClass: 'E',
    ownerColumn: 'owner_id',
    columns: ['id', ...SYNC_COLUMNS, 'caution', 'questionnaire_version', 'answered_at'],
    exported: true,
    onUserDelete: 'cascade',
  }),
  limitation: rule({
    category: 'C2',
    syncClass: 'E',
    ownerColumn: 'owner_id',
    columns: ['id', ...SYNC_COLUMNS, 'body_area', 'side', 'severity', 'note', 'active'],
    exported: true,
    onUserDelete: 'cascade',
  }),
  gym: rule({
    category: 'C0',
    syncClass: 'E',
    ownerColumn: null,
    columns: [
      'id',
      'name',
      'name_key',
      'city',
      'city_key',
      'load_settings',
      'created_by',
      'updated_by',
      'rev',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    pullRedact: ['created_by', 'updated_by'],
    exported: false,
    onUserDelete: 'set_null',
  }),
  gym_equipment: rule({
    category: 'C0',
    syncClass: 'E',
    ownerColumn: null,
    columns: ['id', 'gym_id', 'equipment_code', 'added_by', 'rev', 'created_at', 'updated_at', 'deleted_at'],
    pullRedact: ['added_by'],
    exported: false,
    onUserDelete: 'set_null',
  }),
  gym_history: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: ['id', 'gym_id', 'author_id', 'at', 'action', 'detail'],
    exported: false,
    onUserDelete: 'set_null',
  }),
  place: rule({
    category: 'C1',
    syncClass: 'E',
    ownerColumn: 'owner_id',
    columns: [
      'id',
      ...SYNC_COLUMNS,
      'kind',
      'gym_id',
      'name',
      'is_primary',
      'visible_at_gym',
      'load_settings',
    ],
    exported: true,
    onUserDelete: 'cascade',
  }),
  home_equipment: rule({
    category: 'C1',
    syncClass: 'E',
    ownerColumn: 'owner_id',
    columns: ['id', 'place_id', 'equipment_code', ...SYNC_COLUMNS],
    exported: true,
    onUserDelete: 'cascade',
  }),
  // Catalogue (brique 2) : classe C, servi en bloc par GET /api/catalog, hors pull et hors export personnel.
  exercise: rule({
    category: 'C0',
    syncClass: 'C',
    ownerColumn: null,
    columns: [
      'id',
      'schema_version',
      'revision',
      'status',
      'batch',
      'name',
      'aliases',
      'movement_pattern',
      'mechanics',
      'unilateral',
      'measure',
      'load_mode',
      'level',
      'not_for_minors',
      'primary_muscles',
      'secondary_muscles',
      'equipment_options',
      'stressed_joints',
      'content',
      'chain_id',
      'easier_id',
      'harder_id',
      'illustrations',
      'review_notes',
      'drafting',
      'reviewed_by',
      'reviewed_at',
      'published_at',
      'retired_at',
      'updated_at',
      'exported_revision',
    ],
    exported: false,
    onUserDelete: 'set_null',
  }),
  illustration: rule({
    category: 'C0',
    syncClass: 'C',
    ownerColumn: null,
    columns: [
      'id',
      'file',
      'sha256',
      'bytes',
      'media_type',
      'source',
      'source_url',
      'creators',
      'license',
      'license_url',
      'modifications',
      'replace_before_public',
    ],
    exported: false,
    onUserDelete: 'not_linked',
  }),
  // Relecture (spec brique 2 §3.3 à §3.5) : classe H, en ligne seulement. Commentaires et validations de la
  // personne entrent dans son export par un traitement explicite (§3.9), pas par `exported`.
  exercise_comment: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: [
      'id',
      'exercise_id',
      'author_id',
      'part',
      'body',
      'revision',
      'created_at',
      'resolved_at',
      'resolved_by',
    ],
    exported: false,
    onUserDelete: 'set_null',
  }),
  exercise_validation: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: ['id', 'exercise_id', 'reviewer_id', 'revision', 'health', 'created_at'],
    exported: false,
    onUserDelete: 'set_null',
  }),
  exercise_revision: rule({
    category: 'C0',
    syncClass: 'H',
    ownerColumn: null,
    columns: ['exercise_id', 'revision', 'content', 'status', 'saved_by', 'saved_at'],
    exported: false,
    onUserDelete: 'set_null',
  }),
};

/** Tables miroir côté client (classes J, D, E), triées. */
export function mirroredTables(rules: EntityRulesMap = entityRules): string[] {
  return Object.entries(rules)
    .filter(([, r]) => r.syncClass === 'J' || r.syncClass === 'D' || r.syncClass === 'E')
    .map(([t]) => t)
    .sort();
}
