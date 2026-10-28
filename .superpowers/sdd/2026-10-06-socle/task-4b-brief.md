### Task 4b: Schéma STRICT des 18 tables du socle

**Files:**
- Create: `apps/server/src/db/migrations/0001_socle.ts` ; Modify: `apps/server/src/db/migrations/index.ts` (`MIGRATIONS = [{ id: '0001_socle', breaking: false, up }]`), `apps/server/src/db/schema.ts` (version complète), `apps/server/test/db/{migrate,rev}.test.ts` (sur `MIGRATIONS`)
- Test: `apps/server/test/db/{schema,upgrade}.test.ts`, `apps/server/test/__snapshots__/schema.sql` (généré), `apps/server/test/fixtures/schema-v1.sql` (copie figée)

**Interfaces:**
- Consumes : Task 4a.
- Produces : `Database` et les 18 interfaces `XxxTable`, `MIGRATIONS` — Interfaces partagées §2.

**Spec:** 09 §0 et §1, 01 §9.1.4, R-SYN-28 (`epoch_started_at`), Global Constraints « Ajouts au modèle » (1) à (6).

- [ ] **Step 1: Write the failing test**

```ts
// schema.test.ts
it('instantané de sqlite_schema', /* `sql` non nul hors sqlite_%, tables puis index par nom, chacun suivi de ';\n' → toMatchFileSnapshot('../__snapshots__/schema.sql') */);
it('18 tables, toutes STRICT', /* pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' : 18 lignes, strict === 1 */);
// upgrade.test.ts (01 §9.1.4, passage de la version précédente) : sqlite.exec(fixtures/schema-v1.sql) + ligne schema_migrations '0001_socle'
//   → migrate(db, MIGRATIONS, clock) = { applied: [], unknownNonBreaking: [] } ; instantané identique à __snapshots__/schema.sql
```
Contraintes vérifiées une à une dans `schema.test.ts` (refus = `/CHECK constraint failed|UNIQUE constraint failed|FOREIGN KEY constraint failed/`) :

| Cas | Attendu |
|---|---|
| `server_meta.id = 2` ; `user.role = 'root'` ; `user.onboarding_step = 'nope'` | refusé |
| `user.onboarding_step` NULL ; `training_profile` avec `goal`, `experience`, `days_per_week`, `session_minutes` NULL | accepté |
| `training_profile.id ≠ owner_id` ; `days_per_week = 5` ; `session_minutes = 50` | refusé |
| `health_screening` / `limitation` sans contenu, `deleted_at` NULL ; `limitation.body_area = 'tete'` | refusé |
| `health_screening` sans contenu, `deleted_at` renseigné | accepté |
| `place` : deux principaux non supprimés pour un `owner_id` ; deux lieux non supprimés d'un même `owner_id` sur un `gym_id` ; `kind='gym'` sans `gym_id`, avec `load_settings` ou avec `name` | refusé |
| `place` : deux principaux dont un supprimé ; deux membres sur la même salle | accepté |
| `gym` doublon `(name_key, city_key)` ; `gym.name` d'un caractère ; `gym_equipment.id` ou `home_equipment.id` non conforme ; `invitation.note` de 61 caractères ; `session.must_change_password = 2` | refusé |
| `sport_other_label` de 41 caractères ; `limitation.note` de 201 ; `place.name` de 31 ; `session.revoked_reason = 'expired'` ; `consent_event.action = 'revoke'` ; `sync_rejection.code`, `applied_op.status` ou `gym_history.action` = `'nope'` | refusé (40, 200 et 30 caractères acceptés) |
| suppression d'un `user` | cascade sur `training_profile`, `place`, `consent_event`, `password_reset` ; `session.user_id` et `gym_history.author_id` à NULL |
| `PRAGMA foreign_key_check` à la fin | vide |

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test db/schema db/upgrade` → `toHaveLength(18)` échoue (1 table : `schema_migrations`), `no such table: user` et `ENOENT` sur `schema-v1.sql`.

- [ ] **Step 3: Implement**

DDL de `0001_socle` (`sql.raw`, chaque table `STRICT`). Gabarit **+SYNC** : `owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, rev INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT REFERENCES user(id) ON DELETE SET NULL, deleted_at TEXT`. « Booléen » = `INTEGER NOT NULL CHECK (x IN (0,1))`.

| Table | Colonnes (ordre du DDL) |
|---|---|
| `server_meta` | `id INTEGER PRIMARY KEY CHECK (id = 1)`, `server_epoch TEXT NOT NULL`, `epoch_started_at TEXT NOT NULL` (posé par `initServerMeta` et `rotateServerEpoch`), `epoch_base_rev INTEGER NOT NULL DEFAULT 0`, `sync_counter INTEGER NOT NULL DEFAULT 0`, `tombstone_purge_rev INTEGER NOT NULL DEFAULT 0`, `catalog_version TEXT`, `catalog_updated_at TEXT` |
| `applied_op` | `op_id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE`, `entity TEXT NOT NULL`, `row_id TEXT NOT NULL`, `status TEXT NOT NULL CHECK (status IN ('applied','applied_partial','duplicate','rejected'))`, `assigned_rev INTEGER`, `applied_at TEXT NOT NULL` |
| `sync_rejection` | `id TEXT PRIMARY KEY`, +SYNC, `op_id TEXT NOT NULL`, `entity TEXT NOT NULL`, `row_id TEXT NOT NULL`, `code TEXT NOT NULL CHECK (code IN ('validation','forbidden','parent_rejected','stale_revision','unknown_entity','protocol'))`, `detail_json TEXT CHECK (json_valid(detail_json))`, `dismissed_at TEXT` |
| `user` | `id TEXT PRIMARY KEY`, `username TEXT NOT NULL`, `username_key TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `role TEXT NOT NULL CHECK (role IN ('admin','member'))`, `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled'))`, `birth_date TEXT NOT NULL`, `terms_version TEXT`, `terms_accepted_at TEXT`, `last_login_at TEXT`, `password_changed_at TEXT`, `onboarding_step TEXT CHECK (onboarding_step IN ('goal','sport','place_kind','place','experience','availability','health','ready'))`, `onboarding_completed_at TEXT`, `invitation_id TEXT REFERENCES invitation(id) ON DELETE SET NULL`, `rev INTEGER NOT NULL`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`, `updated_by TEXT REFERENCES user(id) ON DELETE SET NULL` |
| `invitation` | `id TEXT PRIMARY KEY`, `code_hash TEXT NOT NULL UNIQUE`, `note TEXT CHECK (length(note) <= 60)`, `birth_date TEXT`, `is_admin_bootstrap` booléen `DEFAULT 0`, `created_by TEXT REFERENCES user(id) ON DELETE SET NULL`, `created_at TEXT NOT NULL`, `expires_at TEXT NOT NULL`, `used_at TEXT`, `used_by TEXT REFERENCES user(id) ON DELETE SET NULL`, `revoked_at TEXT` |
| `password_reset` | `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE`, `code_hash TEXT NOT NULL UNIQUE`, `created_by TEXT REFERENCES user(id) ON DELETE SET NULL`, `created_at TEXT NOT NULL`, `expires_at TEXT NOT NULL`, `used_at TEXT`, `cancelled_at TEXT` |
| `session` | `id TEXT PRIMARY KEY`, `token_hash TEXT NOT NULL UNIQUE`, `user_id TEXT REFERENCES user(id) ON DELETE SET NULL`, `created_at TEXT NOT NULL`, `last_seen_at TEXT NOT NULL`, `expires_at TEXT NOT NULL`, `must_change_password` booléen `DEFAULT 0`, `revoked_at TEXT`, `revoked_reason TEXT CHECK (revoked_reason IN ('logout','logout_all','password_change','password_reset','admin','account_deleted'))` |
| `consent_event` | `id TEXT PRIMARY KEY`, `owner_id` (FK cascade), `type TEXT NOT NULL CHECK (type IN ('health','ai_coach'))`, `action TEXT NOT NULL CHECK (action IN ('grant','withdraw'))`, `text_version TEXT NOT NULL`, `rev`, `created_at`, `updated_at`, `updated_by` (+SYNC **sans** `deleted_at`) |
| `security_event` | `id TEXT PRIMARY KEY`, `at TEXT NOT NULL`, `type TEXT NOT NULL`, `actor_id TEXT`, `target_id TEXT` (sans FK), `tailnet_ip TEXT`, `outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','blocked'))`, `details TEXT CHECK (json_valid(details))` |
| `training_profile` | `id TEXT PRIMARY KEY`, +SYNC, `goal TEXT CHECK (goal IN ('muscle','strength','fat_loss','fitness','sport_support'))`, `experience TEXT CHECK (experience IN ('none','lt_6_months','6_to_24_months','gt_24_months'))`, `days_per_week INTEGER CHECK (days_per_week BETWEEN 2 AND 4)`, `session_minutes INTEGER CHECK (session_minutes IN (30,45,60,75,90))`, `sport_code TEXT`, `sport_other_label TEXT CHECK (length(sport_other_label) <= 40)`, `cautious_mode` booléen `DEFAULT 0`, `CHECK (id = owner_id)` |
| `health_screening` | `id TEXT PRIMARY KEY`, +SYNC, `caution INTEGER CHECK (caution IN (0,1))`, `questionnaire_version TEXT`, `answered_at TEXT`, `CHECK (id = owner_id)`, `CHECK (deleted_at IS NOT NULL OR (caution IS NOT NULL AND questionnaire_version IS NOT NULL AND answered_at IS NOT NULL))` |
| `limitation` | `id TEXT PRIMARY KEY`, +SYNC, `body_area TEXT CHECK (body_area IN ('shoulder','elbow','wrist_hand','neck','upper_back','lower_back','hip','knee','ankle_foot','other'))`, `side TEXT CHECK (side IN ('left','right','both','not_applicable'))`, `severity TEXT CHECK (severity IN ('mild','severe'))`, `note TEXT CHECK (length(note) <= 200)`, `active INTEGER CHECK (active IN (0,1))`, `CHECK (deleted_at IS NOT NULL OR (body_area IS NOT NULL AND side IS NOT NULL AND severity IS NOT NULL AND active IS NOT NULL))` |
| `gym` | `id TEXT PRIMARY KEY`, `name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 60)`, `name_key TEXT NOT NULL`, `city TEXT NOT NULL CHECK (length(city) BETWEEN 2 AND 60)`, `city_key TEXT NOT NULL`, `load_settings TEXT NOT NULL CHECK (json_valid(load_settings))`, `created_by`, `updated_by` (`TEXT REFERENCES user(id) ON DELETE SET NULL`), `rev INTEGER NOT NULL`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`, `deleted_at TEXT`, `UNIQUE (name_key, city_key)` |
| `gym_equipment` | `id TEXT PRIMARY KEY`, `gym_id TEXT NOT NULL REFERENCES gym(id) ON DELETE CASCADE`, `equipment_code TEXT NOT NULL`, `added_by TEXT REFERENCES user(id) ON DELETE SET NULL`, `rev INTEGER NOT NULL`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`, `deleted_at TEXT`, `CHECK (id = gym_id \|\| ':' \|\| equipment_code)` |
| `gym_history` | `id TEXT PRIMARY KEY`, `gym_id TEXT NOT NULL REFERENCES gym(id) ON DELETE CASCADE`, `author_id TEXT REFERENCES user(id) ON DELETE SET NULL`, `at TEXT NOT NULL`, `action TEXT NOT NULL CHECK (action IN ('create','update_info','add_equipment','remove_equipment','update_load_settings'))`, `detail TEXT NOT NULL CHECK (json_valid(detail))` |
| `place` | `id TEXT PRIMARY KEY`, +SYNC, `kind TEXT NOT NULL CHECK (kind IN ('gym','home'))`, `gym_id TEXT REFERENCES gym(id)`, `name TEXT CHECK (length(name) <= 30)`, `is_primary` et `visible_at_gym` booléens `DEFAULT 0`, `load_settings TEXT CHECK (json_valid(load_settings))`, `CHECK (kind = 'home' OR load_settings IS NULL)`, `CHECK ((kind = 'gym') = (gym_id IS NOT NULL))`, `CHECK (kind = 'home' OR name IS NULL)` |
| `home_equipment` | `id TEXT PRIMARY KEY`, `place_id TEXT NOT NULL REFERENCES place(id) ON DELETE CASCADE`, `equipment_code TEXT NOT NULL`, +SYNC, `CHECK (id = place_id \|\| ':' \|\| equipment_code)` |

Index : `<t>_rev_idx (rev)` pour `user`, `gym`, `gym_equipment` et les 7 tables à `owner_id` ; `<t>_owner_rev_idx (owner_id, rev)` pour `sync_rejection`, `consent_event`, `training_profile`, `health_screening`, `limitation`, `place`, `home_equipment` ; `applied_op_user_applied_idx (user_id, applied_at)` ; `consent_event_owner_type_created_idx (owner_id, type, created_at)` ; `security_event_at_idx (at)` ; `password_reset_user_idx (user_id)` ; `session_user_idx (user_id)` ; `gym_equipment_gym_idx (gym_id)` ; `gym_history_gym_at_idx (gym_id, at)` ; `place_gym_idx (gym_id)` ; `home_equipment_place_idx (place_id)` ; `CREATE UNIQUE INDEX place_owner_gym_uq ON place(owner_id, gym_id) WHERE deleted_at IS NULL` ; `CREATE UNIQUE INDEX place_owner_primary_uq ON place(owner_id) WHERE is_primary = 1 AND deleted_at IS NULL`.

`schema.ts` : une interface `XxxTable` par table (camelCase ; `DEFAULT` → `Generated<T>` ; booléens `number`, JSON `string`).

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test db/` écrit `__snapshots__/schema.sql` ; le relire (18 tables, index du tableau) ; le copier en `test/fixtures/schema-v1.sql`, jamais régénéré ensuite ; relancer → `Test Files  5 passed` ; `pnpm typecheck` passe.

- [ ] **Step 5: Commit**

`git commit -m "feat(db): schéma STRICT des 18 tables du socle"`

---

