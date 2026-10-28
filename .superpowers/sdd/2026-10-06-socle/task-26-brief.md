### Task 26: Moteur de synchro client

**Files:**
- Create: `apps/web/src/sync/{transport.ts, apply-pull.ts, engine.ts, triggers.ts, catalog.ts}`, `apps/web/src/sw/{protocol.ts, sw-client.ts}`
- Test: `apps/web/test/sync/{transport,apply-pull,engine,engine-epoch,catalog,triggers}.test.ts`

**Interfaces:**
- Consumes : T25 ; T5 (`EntityRule.parent`) ; T20/T21 (`PushResponse`, `PullResponse`, `PulledRow`, `SyncOp`, constantes) ; T2 (`PROTOCOL_HEADER`, `EPOCH_HEADER`, `createMonotonicUuidV7`) ; T6 (`HealthResponse`) ; T10 (`MeResponse`) ; T19 (`replay-withdraw`) ; T23.
- Produces : Interfaces partagées §5 (`transport.ts`, `engine.ts` avec `retryDelayMs`, `apply-pull.ts`, `catalog.ts`, `triggers.ts`), §6 (`sw/protocol.ts` avec `PageToSw`, `sw/sw-client.ts` avec `postToSw` ; T29 y ajoute `SwStatus` et `getSwStatus`) et comportements client fixés.

**Spec:** 01 R-SYN-9, R-SYN-12, R-SYN-13, R-SYN-18, R-SYN-22 à R-SYN-24, R-SYN-26, R-SYN-28 à R-SYN-30, R-SYN-32, R-VER-2 ; 03 P-DRT-4, P-CST-3 étape 4, P-CST-4 ; 04 §11 ; Review Focus 2 (ordre client) et 3 (client).

- [ ] **Step 1: Write the failing test**

Fichiers en `// @vitest-environment node` (sauf `triggers.test.ts`) ; faux transport local, en-tête `X-Appsport-Epoch` = époque du faux serveur (E1 ; E2 dans engine-epoch sauf mention) ; `triggers` factices ; `vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval'] })` (jamais `setImmediate` ni `queueMicrotask`, utilisés par fake-indexeddb).
```ts
// transport.test.ts : transport muet → OfflineError à 4000 ms ; TypeError → OfflineError ; 500 renvoyée telle quelle
// apply-pull.test.ts : ligne écrite avec serverRevSeen = rev ; rebase R-SYN-22 :
await applyPulledRows(db, [{ entity: 'fixture_note', rev: 9, row: { id: 'n1', ownerId: 'u1', title: 'serveur', body: 'b', deletedAt: null, rev: 9, updatedAt: '2026-10-06T11:00:00.000Z' } }]);
expect(await db.mirror('fixture_note').get('n1')).toMatchObject({ title: 'serveur', body: 'local', serverRevSeen: 9 });   // patch local { body: 'local' } en attente
// delete en attente → deletedAt gardé ; create en attente sur une ligne reçue → ignoré (title 'serveur') ; tombstone serveur sans contenu remplace la copie ; entité sans miroir ignorée
// engine.test.ts (meta.userId 'u1', serverEpoch 'E1', rules SYNC_FIXTURE_RULES)
expect(paths).toEqual(['GET /api/health', 'POST /api/sync/push', 'POST /api/sync/push', 'POST /api/sync/push', 'GET /api/sync/pull']);   // 450 ops
expect(sent.map((o) => o.length)).toEqual([200, 200, 50]);   // triées par opId ; en-tête X-Appsport-Protocol '1'
// ops d'un autre userId jamais envoyées (P-AUT-6) ; meta.userId changé après le 1er lot → aucun autre lot ; op retirée seulement après accusé, serverRevSeen = rev ;
//   duplicate sans rev → serverRevSeen inchangé ; op sans résultat gardée
// rejected → deadletter { opId, userId, entity, id, code, detail: { kind, fieldNames }, receivedAt }, retirée de l'outbox ; create rejeté → ligne locale absente ;
//   patch rejeté d'une ligne acceptée → pull suivant sans since
// applied_partial dropped → copie locale supprimée ; droppedFields ['painNote'] → champ local null ; 'TEMOIN-C2-7f3a' absent de toutes les tables
// 401 unauthenticated → 'unauthenticated', outbox intacte ; 403 password_change_required → connection inchangée ; aucune reprise pour ces deux ;
//   400 validation au push → reprise à +2 s ; 410 account_deleted → outbox, deadletter, miroirs vides, meta.userId absente, onAccountDeleted une fois,
//   syncNow suivant sans requête, puis setMeta(userId 'u2') → GET /api/health, 'online' ; 410 watermark_expired → miroirs vidés, outbox gardée, second pull sans since ;
//   410 { error: 'gone' } → rien d'effacé ; 426 → 'protocol_unsupported', outbox intacte
// délai 4 s → 'offline', syncNow ne rejette pas ; reprises à +2 s puis +4 s
expect([1, 2, 3, 8, 9, 20].map(retryDelayMs)).toEqual([2000, 4000, 8000, 256000, 300000, 300000]);
// pull : watermark, lastPullOkAt, serverCatalogVersion mis à jour, hasMore enchaîne ; consent_event health/withdraw tiré → purgeHealthData ;
//   pull complet : ligne non reçue sans op → supprimée, avec op → gardée ; coupé en page 2 → watermark toujours absent
// start() → triggers installés une fois puis cycle 'launch' ; stop() → désinstallés, aucune reprise ; trois syncNow('set_logged') en 1 s → un cycle, à +2000 ms
// flushBefore(4000) rend la main en 4 s au plus ; deux syncNow, ou un pullNow, pendant un cycle → un seul cycle ensuite, jamais deux en vol ; pending et rejected à jour, subscribe notifié
// engine-epoch.test.ts (Review Focus 2) — miroir : n10 (updatedAt −10 j, serverRevSeen 5), item i10 de n10 (−10 j), n70 (−70 j), tombstone t5 (−5 j), un sync_rejection ; outbox : 1 patch
// 1er push = restore_upsert de { n10, t5, i10 }, i10 en dernier (parents d'abord) : n10 { serverRevSeen: 5, fields: { title, deletedAt: null } }, t5 deletedAt non nul ;
//   2e push = ['patch'] ; puis pull sans since ; meta.serverEpoch 'E2' ; n70 et le sync_rejection absents du pull → supprimés du miroir
// health E1 puis 410 watermark_expired portant E2 → miroirs intacts, un seul cycle immédiat de plus : renvoi, puis pull sans since
// renvoi en 500 ou hors ligne → époque locale E1, outbox intacte, reprise à +2 s, tout rejoué ensuite ; renvoi rejected → deadletter, époque E2 enregistrée ;
//   sans consentement local : tables C2 exclues, champs C2 retirés
// R-SYN-28 : dernier consent_event health local withdraw (createdAt W), /api/me health actif → un seul POST …/replay-withdraw { withdrawnAt: W } avant le pull ;
//   409 → époque E2 enregistrée ; dernier événement grant → ni /api/me ni renvoi ; première prise de contact → époque enregistrée sans restore_upsert
// catalog.test.ts : If-None-Match "<catalogVersion>" ; 304 → 'unchanged' ; 200 → 4 stores remplacés, catalogVersion = serverCatalogVersion = version → 'updated' ;
//   SW contrôleur → postMessage({ type: 'SYNC_ILLUSTRATIONS', files }), sans contrôleur → postToSw false ; après un pull où serverCatalogVersion ≠ catalogVersion, GET /api/catalog
// triggers.test.ts (happy-dom) : visible → syncNow('foreground') ; 'online' → syncNow('online') ; toutes les 60 s 'interval' si visible et pending > 0 ;
//   vi.spyOn(navigator, 'onLine', 'get') jamais appelé ; la fonction rendue retire écouteurs et intervalle
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test sync/transport sync/apply-pull sync/engine sync/catalog sync/triggers` → modules introuvables.

- [ ] **Step 3: Implement**

`applyPulledRows` : une transaction ; `merged = { ...row, serverRevSeen: rev }`, puis les ops en attente sur `[entity+id]` rejouées dans l'ordre des `opId` (`patch` → `Object.assign(fields)`, `delete` → `deletedAt = clientTs`, `create` ignoré). File unique à un cycle en vol : `syncNow`, `pullNow` et `flushBefore` y passent, un appel pendant un cycle en programme un seul autre. Rien sans `meta.userId` ni après `stop()` ; `meta.userId` différent du précédent → `connection = 'unknown'`, `failures = 0`. `start()` : `(deps.triggers ?? installSyncTriggers)(engine)` puis `syncNow('launch')` ; `stop()` désinstalle et annule reprises et minuteries ; `syncNow('set_logged')` (re)programme un cycle à +`SYNC_DEBOUNCE_MS`. Cycle, dans l'ordre :
```ts
// Toute réponse : X-Appsport-Epoch lu avant le corps ; ≠ époque du cycle (en-tête de /api/health) → fin du cycle quel que soit le statut, un seul nouveau cycle
//   immédiat par cycle. Sinon selon `error` : unauthenticated → 'unauthenticated' ; password_change_required → fin, connection inchangée (sans reprise pour ces
//   deux) ; account_deleted → wipeUserData({ keepOutbox: false }), 'account_deleted', onAccountDeleted ; watermark_expired → clearMirrors, deleteMeta(watermark),
//   un seul pull complet ; autre 410 → fin sans effacer ; protocol_unsupported → 'protocol_unsupported' ; OfflineError → 'offline' ; OfflineError, autre 4xx
//   ou 5xx → failures++, reprise à retryDelayMs(failures) si start().
// 1. GET /api/health → 'online', failures = 0.
// 2. Époque : meta.serverEpoch absente → l'enregistrer. Différente (outbox en pause) :
//    a. restore_upsert des lignes J de l'utilisateur (sauf sync_rejection) dont updatedAt ≥ now − EPOCH_RESEND_DAYS (sans consentement local : tables C2 exclues,
//       champs C2 retirés), { fields: clientWritable présents + deletedAt, serverRevSeen }, parents d'abord (rules[entity].parent) puis par id, lots de 200,
//       jamais dans l'outbox ; rejected → deadletter, pas un échec ;
//    b. R-SYN-28 : dernier consent_event health du miroir = withdraw et GET /api/me → consents.health.active → POST /api/me/consents/health/replay-withdraw
//       { withdrawnAt: son createdAt } (409 conflict accepté) ;
//    c. setMeta(serverEpoch), deleteMeta(watermark). Un échec en a ou b termine le cycle sans changer meta.serverEpoch.
// 3. Push : meta.userId relu avant chaque lot (changé → fin) ; lots de 200 ops de l'utilisateur triées par opId (attempts++ avant envoi) ; applied |
//    applied_partial | duplicate → op retirée, serverRevSeen = rev si présent, droppedFields → null, dropped → copie supprimée ; rejected → deadletter puis
//    retirée ; en fin de lot, ligne rejetée sans serverRevSeen ni autre op → copie supprimée, sinon deleteMeta(watermark).
// 4. Pull : depuis meta.watermark jusqu'à hasMore false ; serverCatalogVersion ; consent_event health tiré et consentement local inactif → purgeHealthData ;
//    fin → lastPullOkAt. Pull complet (watermark absent au départ) : watermark écrit seulement à la fin, puis lignes miroirs non reçues et sans op supprimées.
// 5. serverCatalogVersion ≠ catalogVersion → refreshCatalog (erreur avalée).
```
`pullNow` = cycle sans l'étape 3 ; `flushBefore(ms)` = `Promise.race(syncNow('coach'), délai)` sans rejet ; `rejected` = `opId` distincts de la deadletter de l'utilisateur et des `sync_rejection` non ignorés ni supprimés. `refreshCatalog` : éléments de `exercises`, `programTemplates`, `adviceSheets` validés par `z.looseObject({ id: z.string() })`, `illustrations` par `IllustrationRef` (relues par T37 au démarrage du SW), puis `postToSw({ type: 'SYNC_ILLUSTRATIONS', files })` ; autre statut → `Error('catalog_http_<status>')`. `sw/protocol.ts` porte `PageToSw` (T29 y ajoute `SwStatus`) ; `postToSw` poste au contrôleur, `false` sans lui.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/web test sync` → `Test Files  8 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(synchro): moteur client (push, pull, époque, reprises, catalogue)"`

---

