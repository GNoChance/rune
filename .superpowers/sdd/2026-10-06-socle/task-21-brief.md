### Task 21: Pull serveur, garde de protocole et test de fuite

**Files:**
- Modify: `packages/contracts/src/sync.ts` (`ColumnCodec`, `COLUMN_CODECS`), `apps/server/src/sync/routes.ts` (garde + `GET /pull`), `apps/server/test/support/sync-fixtures.ts` (`syncPull`)
- Create: `apps/server/src/sync/{pull.ts, protocol-guard.ts}`
- Test: `apps/server/test/sync/{pull,pull-leak,protocol-guard,codecs}.test.ts`

**Interfaces:**
- Consumes : T20 ; T4a (`getServerMeta`) ; T5 (`insertFixtureRow`, `mirroredTables`, `snakeToCamel`) ; T10 ; T19 (`grantConsent`) ; T14 (`HEALTH_CONSENT_TEXT`).
- Produces : Interfaces partagées §5 (`ColumnCodec`, `COLUMN_CODECS`, `buildPull`, `protocolGuard`) et §2 (support `syncPull`). Valeur exacte :
```ts
export const COLUMN_CODECS = { training_profile: { cautious_mode: 'boolean' }, health_screening: { caution: 'boolean' }, limitation: { active: 'boolean' },
  gym: { load_settings: 'json' }, place: { is_primary: 'boolean', visible_at_gym: 'boolean', load_settings: 'json' }, sync_rejection: { detail_json: 'json' } };
```

**Spec:** 01 R-SYN-20, R-SYN-21, R-SYN-23, R-VER-1, R-VER-2 ; 03 §17 n°1 ; 09 §0 ; Global Constraints « Ajouts au modèle » (1).

- [ ] **Step 1: Write the failing test**

```ts
// protocol-guard.test.ts : X-Appsport-Protocol absent, '0', '2', 'abc', '1.5' sur GET /api/sync/pull et POST /api/sync/push sans cookie →
//   426 { error: 'protocol_unsupported', serverProtocol: 1, minProtocol: 1 } ; protocole 1 sans session → 401 unauthenticated
// pull.test.ts
// 3 notes → lignes triées par rev ; sans since : { hasMore: false, nextWatermark: `${serverEpoch}:${syncCounter}` }
// 5 notes, limit=2 → 2 lignes, hasMore true, nextWatermark `${epoch}:${rows[1].rev}` ; reprise au watermark → les 2 suivantes
// 600 notes → 500 lignes par défaut, hasMore true ; limit=501 → { error: 'validation' }
// jamais un groupe de même rev coupé (3 notes dont 2 au même rev, limit=2 → 3 lignes)
// tombstone incluse avec deletedAt ; tombstone health_screening → caution: null ; ligne user : la sienne seulement, sans passwordHash ; training_profile.cautiousMode === true ; chaque row a deletedAt
// salle créée par b → gym et gym_equipment présents, loadSettings objet ; aucun place de b
// since d'une autre époque → 410 { error: 'watermark_expired' } ; tombstone_purge_rev = 10 : since `${epoch}:5` → 410, `${epoch}:10` → 200
// since 'abc' → 400 validation ; server_meta.catalog_version 'abc' → catalogVersion 'abc'
// pull-leak.test.ts (membre et admin) : une ligne de l'autre utilisateur dans chaque table J/D/E liée (consentement accordé pour les tables C2) ;
//   le pull ne contient jamais son id ; aucune ligne ne porte une secretColumn ; chaque entity ∈ mirroredTables()
// codecs.test.ts : chaque colonne `IN (0,1)` des tables miroirs a le codec 'boolean', chaque `json_valid(x)` le codec 'json'
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test sync/pull sync/protocol-guard sync/codecs` → `syncPull is not exported`, 404 au lieu de 426.

- [ ] **Step 3: Implement**

`protocolGuard` : `/^\d+$/` dans `[MIN_PROTOCOL, SYNC_PROTOCOL]`, déclaré par `use('*')` avant toute route du routeur. `buildPull` dans une seule transaction (instantané cohérent) :
- `since` illisible → `validation` ; époque ≠ `serverEpoch` ou `rev < tombstonePurgeRev` → `watermark_expired` ;
- tables `J/D/E` du registre : filtre `ownerColumn = user.id` ; `ownerColumn` nul et C0 → toutes les lignes (`gym`, `gym_equipment`) ; sinon exclue ;
- par table `rev > sinceRev ORDER BY rev LIMIT limit + 1`, fusion triée, `limit` premières ; si une ligne écartée a le même `rev` que la dernière gardée, ajouter toutes les lignes de ce `rev` ;
- `nextWatermark = encodeWatermark(epoch, hasMore ? lastRev : max(sinceRev, syncCounter))` ;
- ligne : camelCase, sans `secretColumns`, codecs (`null` reste `null` ; `boolean` → `v === 1`, `json` → `JSON.parse`), `deletedAt: null` si la colonne manque.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test sync` → `Test Files  6 passed` (T20 compris).

- [ ] **Step 5: Commit**

`git commit -m "feat(synchro): pull paginé, garde de protocole 426 et test de fuite"`

---

