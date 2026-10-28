### Task 20: Contrats du protocole de synchro et push serveur

**Files:**
- Create: `packages/contracts/src/sync.ts` ; Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/sync/{hooks.ts, push.ts, routes.ts}`, `apps/server/test/support/sync-fixtures.ts`
- Modify: `apps/server/src/deps.ts` (`AppDeps.syncHooks`, défaut `SYNC_HOOKS` dans `createAppDeps`), `apps/server/src/routes.ts` (`app.route('/api/sync', syncRoutes(deps))`), `apps/server/test/support/index.ts`
- Test: `packages/contracts/test/sync.test.ts`, `apps/server/test/sync/{push,push-c2}.test.ts`, `apps/server/test/db/enum-consistency.test.ts`

**Interfaces:**
- Consumes : T5 (`entityRules`, `EntityRule` dont `parent` et `c2Values`, `snakeToCamel`, `camelToSnake`) ; T2 (`SYNC_PROTOCOL`, `MIN_PROTOCOL`, `PROTOCOL_HEADER`, `isUuidV7`) ; T6 ; T4a (`writeStamp`, `Migration`) ; T9 (`requireUser`) ; T10 (`isHealthConsentActive`, `createUserAndLogin`) ; T19 (`grantConsent`, dans le test) ; constantes de T8 à T19 (enum-consistency).
- Produces : Interfaces partagées §5 (`sync.ts` sauf `COLUMN_CODECS` ; `hooks.ts` ; `OpRejection`, `applyPush`, `syncRoutes`) et §2 (support `sync-fixtures.ts` sauf `syncPull`, `snapshotDb`, `restoreInPlace`). `makeOp` : `clientTs '2026-10-06T10:00:00.000Z'`, `attempts 0`, `opId` de `seqIds(7000)` ; ids de ligne des tests serveur : UUIDv7 de `seqIds(8000)`.

**Spec:** 01 R-SYN-2, R-SYN-3, R-SYN-9, R-SYN-11, R-SYN-15 à R-SYN-18, §9.1.4 ; 03 P-CST-2, P-CST-4, P-LOG-2 ; 09 §0.6 ; Review Focus 3 (serveur).

- [ ] **Step 1: Write the failing test**

DDL des tables de test (`SYNC_FIXTURE_MIGRATION`, id `9001_sync_fixtures`, `breaking: false`, toutes `STRICT`, index `(rev)` et `(owner_id, rev)`, colonnes +SYNC de la Task 4b) :
```sql
CREATE TABLE fixture_note (id TEXT PRIMARY KEY, /* +SYNC */, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100), body TEXT) STRICT;
CREATE TABLE fixture_note_item (id TEXT PRIMARY KEY, /* +SYNC */, note_id TEXT NOT NULL REFERENCES fixture_note(id),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100), pain_note TEXT, reason TEXT) STRICT;
CREATE TABLE fixture_c2_log (id TEXT PRIMARY KEY, /* +SYNC */, value INTEGER, CHECK (deleted_at IS NOT NULL OR value IS NOT NULL)) STRICT;
```
Règles (`SYNC_FIXTURE_RULES`) : `fixture_note` C1/J/owner_id, clientWritable `['title','body']` ; `fixture_note_item` C1/J/owner_id, clientWritable `['note_id','label','pain_note','reason']`, c2Columns `['pain_note']`, c2Values `{ reason: ['pain'] }`, parent `{ entity: 'fixture_note', column: 'note_id' }` ; `fixture_c2_log` C2/J/owner_id, clientWritable `['value']` ; toutes `exported: true`, `onUserDelete: 'cascade'`. Champs C2 = `c2Columns` et toute colonne de `c2Values` portant une valeur listée.
```ts
// sync.test.ts
expect(SyncOp.safeParse({ ...op, kind: 'upsert' }).success).toBe(false); expect(SyncOp.safeParse({ ...op, opId: 'not-a-uuid' }).success).toBe(false);
expect(UuidV7.safeParse('017F22E2-79B0-7CC3-98C4-DC0C0C07398F').success).toBe(false);
// PushRequest : 200 ops acceptées, 201 refusées
expect(encodeWatermark('0199b9a0-0000-7000-8000-0000000000e1', 42)).toBe('0199b9a0-0000-7000-8000-0000000000e1:42');
expect(decodeWatermark('0199b9a0-0000-7000-8000-0000000000e1:42')).toEqual({ epoch: '0199b9a0-0000-7000-8000-0000000000e1', rev: 42 });
for (const bad of ['abc', ':3', 'e:-1', 'e:1.5', 'e:', '']) expect(decodeWatermark(bad)).toBeNull();
expect([SYNC_PUSH_MAX, SYNC_PULL_LIMIT, SYNC_TIMEOUT_MS, EPOCH_RESEND_DAYS, TOMBSTONE_TTL_DAYS, APPLIED_OP_TTL_MONTHS]).toEqual([200, 500, 4000, 60, 90, 12]);
expect([SYNC_RETRY_MIN_MS, SYNC_RETRY_MAX_MS, SYNC_INTERVAL_MS, SYNC_DEBOUNCE_MS, COACH_FLUSH_MS]).toEqual([2000, 300000, 60000, 2000, 4000]);
// push.test.ts — note(u, fields = { title: 'n' }) = makeOp create fixture_note
// 201 ops → 400 { error: 'validation' } ; 200 ops → toutes 'applied'
// opId déjà vu → { opId, status: 'duplicate', rev: <rev du premier> }, une seule ligne applied_op
// kind 'upsert' → { status: 'rejected', code: 'validation' } et sync_rejection { owner_id: a.id, entity: 'fixture_note', row_id, code: 'validation', dismissed_at: null }, rev > 0
// training_profile (non J) et 'nope' → unknown_entity ; create sur sync_rejection (allowedKinds) → forbidden ; userId ≠ session → forbidden sans sync_rejection ni applied_op
// create d'id 'pas-un-uuid' ou en majuscules → validation (reason 'id_format') ; { opId, kind: 'create' } entre deux notes → ['applied','rejected','applied'], sync_rejection { entity: '', row_id: '' }
// patch de la ligne d'un autre → forbidden, ligne intacte ; ownerId, rev, updatedBy, createdAt envoyés → ignorés (owner_id de la session, created_at '2026-10-06T10:00:00.000Z')
// create répété sur le même id → les deux 'applied', même rev, premier contenu gardé
// create + patch { title } + patch { body } → revs croissants, ligne { title: 't2', body: 'b3' }
// create + delete + patch → patch { status: 'applied', rev: <rev du delete> }, ligne { title: 'a', deleted_at: '2026-10-06T10:00:00.000Z' } ; patch d'une ligne absente → validation
// [n1, title '' (CHECK SQLite), n2] → ['applied','rejected','applied'], code 'validation' (point de sauvegarde)
// enfant d'un parent rejeté → parent_rejected, deux lignes sync_rejection
// detail_json : clés exactement ['fieldNames','kind','reason'], fieldNames ['body','title'], jamais 'VALEUR-SECRETE'
// applied_op { user_id, entity, row_id, status: 'applied', assigned_rev } ; patch dismissedAt sur son sync_rejection → applied ; protocol 99 → code 'protocol'
// hooks de test (deps.syncHooks) : OpRejection de beforeApply → rejected ; afterBatch une fois par lot, applied = [{ entity, id }] écrits, jamais sans écriture ;
//   beforeApply qui lève { code: 'ERR_SQLITE_ERROR', errcode: 13 } → 500, rien d'écrit
// enum-consistency.test.ts (01 §9.1.4) : chaque `col IN ('…')` de sqlite_schema (hors (0,1)) et chaque borne égale la constante de sa colonne (colonne absente de la
//   correspondance → échec) : PushResult.shape.status, RejectionCode, RoleSchema, UserStatusSchema, ONBOARDING_STEPS, GOALS, EXPERIENCES, SESSION_MINUTES,
//   DAYS_PER_WEEK, BODY_AREAS, LIMITATION_SIDES, LIMITATION_SEVERITIES, GymHistoryAction, LIMITATION_NOTE_MAX, SPORT_OTHER_LABEL_MAX, INVITATION_NOTE_MAX
// push-c2.test.ts (Review Focus 3, serveur) — WITNESS = 'TEMOIN-C2-7f3a', WITNESS_N = 987654, logger capturé
// sans consentement : item { painNote: WITNESS } → { status: 'applied_partial', droppedFields: ['painNote'] }, rev > 0, pain_note NULL
// sans consentement : item { reason: 'pain' } → applied_partial, droppedFields ['reason'], reason NULL ; { reason: 'fatigue' } → applied
// sans consentement : fixture_c2_log → { opId, status: 'applied_partial', dropped: true }, aucune ligne, applied_op { status: 'applied_partial', assigned_rev: null }
// avec grantConsent : même item → applied, pain_note = WITNESS
// sans consentement : 0 ligne sync_rejection ; ni WITNESS ni '987654' dans dumpDatabase ni dans le journal
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/contracts test sync` puis `pnpm --filter @appsport/server test sync/push db/enum-consistency` → `Failed to resolve import "../src/sync"`, `createSyncTestContext` absent de `@appsport/server/testing`.

- [ ] **Step 3: Implement**

`POST /push` : `requireUser`, `parseJson(c, PushEnvelope)`, `200 { results: await applyPush(…) }`. Tout le lot dans une transaction, un point de sauvegarde par opération (rollback + release en cas de rejet). Valeurs écrites : booléen → 0/1, objet ou tableau → `JSON.stringify`. `UuidV7` = `z.string().regex(UUID_V7_RE)`, motif de `isUuidV7` (contracts n'importe pas domain). Ordre par opération (R-SYN-16) :
```ts
// consent = isHealthConsentActive(trx, user.id) (une fois par lot) ; rejectedRows = Set<`${entity}:${id}`>
// 0. applied_op(opId) existe : même user → { status: 'duplicate', rev: assignedRev ?? undefined } ; autre user → rejected forbidden sans écriture
// 1. SyncOp.safeParse échoue → OpRejection('validation','schema') ; kind ∈ {create, restore_upsert} et !isUuidV7(id) → ('validation','id_format')
// 2. protocol ∉ [MIN_PROTOCOL, SYNC_PROTOCOL] → ('protocol','protocol')
// 3. règle absente ou syncClass ≠ 'J' → ('unknown_entity','not_journal') ; 4. kind hors allowedKinds → ('forbidden','kind_not_allowed')
// 5. op.userId ≠ session → rejected forbidden sans écriture, comme en 0 ; 6. ligne existante d'un autre propriétaire → ('forbidden','owner_mismatch')
// 7. rule.parent et kind ∈ {create, restore_upsert} : parent rejeté dans le lot, absent ou d'un autre → ('parent_rejected','parent_rejected')
// 8. !consent && category C2 && kind ≠ delete → { status: 'applied_partial', dropped: true }, AUCUNE écriture
// 9. champs gardés = clientWritable (les autres ignorés en silence) ; !consent → champs C2 à null, droppedFields
// 10. beforeApply(ctx, champs) ; create : existant → applied avec son rev, sans écriture ; sinon INSERT (ownerId session, stamp). patch : absent → ('validation','row_missing') ;
//     supprimé → applied avec son rev ; sinon UPDATE + stamp. delete : absent → applied sans rev ; supprimé → applied avec son rev ; sinon deletedAt + stamp.
//     restore_upsert → ('validation','not_supported') jusqu'à la Task 22
// 11. afterApply ; 12. applied_op { status: droppedFields.length ? 'applied_partial' : 'applied', assignedRev }
// Rejet (OpRejection, ou (err.errcode & 0xff) === 19 SQLITE_CONSTRAINT → 'validation'/'sql_constraint' ; toute autre erreur → 500, lot annulé) : rejectedRows.add ;
//   sync_rejection { ownerId: session, opId, entity, rowId ('' si non textuels), code, detailJson: { kind, fieldNames: clés triées, reason } } ; applied_op 'rejected' ;
//   logger.warn('sync op rejected', { event: 'sync_rejected', code }). Fin : afterBatch de chaque entité ayant des ops écrites (applied, applied_partial
//   non dropped), commit, logger.info('sync push', { event: 'sync_push', count }). Aucune valeur journalisée.
```

- [ ] **Step 4: Run test to verify it passes**

Mêmes commandes → `Test Files  1 passed` puis `Test Files  3 passed` ; `pnpm typecheck`, `pnpm lint`.

- [ ] **Step 5: Commit**

`git commit -m "feat(synchro): protocole v1 et push serveur avec points de sauvegarde"`

---

