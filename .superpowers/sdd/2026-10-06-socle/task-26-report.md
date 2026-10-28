# Task 26 — Moteur de synchro client — rapport

Status: DONE_WITH_CONCERNS
Commit: 4eb4a4e feat(synchro): moteur client (push, pull, époque, reprises, catalogue) (Closes #27)

## Ce qui a été fait
- `apps/web/src/sync/transport.ts` : `SyncTransport`, `browserTransport(baseUrl)` (credentials same-origin), `OfflineError`, `fetchWithTimeout` (race avec un délai, AbortController ; TypeError/AbortError → OfflineError ; toute réponse HTTP rendue telle quelle ; le délai couvre l'arrivée de la réponse, pas la lecture du corps).
- `apps/web/src/sync/apply-pull.ts` : `applyPulledRows`, une transaction ; `{ ...row, serverRevSeen: rev }` puis les ops en attente sur `[entity+id]` rejouées dans l'ordre des opId (patch → Object.assign, delete → deletedAt = clientTs, create/restore_upsert ignorés) ; entité sans miroir ignorée.
- `apps/web/src/sync/engine.ts` : `createSyncEngine`, `retryDelayMs`, types `ConnectionState`/`SyncTrigger`/`SyncState`/`SyncEngine`.
  - File unique : un cycle en vol, au plus un autre programmé (passe à « complet » si un `syncNow` est demandé pendant qu'un `pullNow` attend) ; `syncNow`, `pullNow`, `flushBefore` y passent. `syncNow('set_logged')` regroupé à +SYNC_DEBOUNCE_MS. `flushBefore(ms)` = race(syncNow('coach'), délai), sans rejet.
  - Garde : rien sans `meta.userId` ni après `stop()` ; userId différent du précédent → `connection='unknown'`, `failures=0` ; userId relu avant chaque lot de push (et de renvoi), chaque page de pull et l'écriture de l'époque → fin de cycle silencieuse.
  - Cycle : health → online, failures=0 → époque (première prise de contact : enregistrée ; différente : restore_upsert parents d'abord puis par id, lots de 200, hors outbox, C2 exclues/retirées sans accord local, rejected → deadletter ; puis R-SYN-28 : dernier consent_event health = withdraw et /api/me health actif → un seul POST replay-withdraw { withdrawnAt: createdAt }, 409 conflict accepté ; puis serverEpoch + deleteMeta(watermark) en une transaction ; un échec en a/b laisse l'époque inchangée) → push (snapshot des opIds de l'utilisateur triés, lots de 200, attempts++ avant envoi, convertOutboxOp ; résultats appliqués en une transaction : duplicate traité via originalStatus/dropped/rev, rev absent → serverRevSeen inchangé, droppedFields → null, dropped → copie supprimée, rejected → deadletter { kind, fieldNames triés } puis copie supprimée si jamais acceptée et sans autre op, sinon deleteMeta(watermark)) → pull (hasMore enchaîné ; incrémental : watermark par page ; complet : watermark écrit à la fin avec la suppression des lignes non reçues et sans op, en une transaction ; serverCatalogVersion ; consent_event health tiré + accord local inactif → purgeHealthData ; lastPullOkAt) → catalogue si serverCatalogVersion ≠ catalogVersion (erreur avalée).
  - Erreurs : en-tête `X-Appsport-Epoch` lu avant le corps, ≠ époque du cycle → fin du cycle et un seul cycle immédiat de plus (dans le même créneau ; un second changement pendant ce cycle devient un échec avec reprise). Puis selon `error` : unauthenticated → 'unauthenticated' ; password_change_required → fin, connection inchangée (sans reprise pour ces deux) ; account_deleted → wipeUserData({keepOutbox:false}), 'account_deleted', onAccountDeleted ; watermark_expired (avec since, une fois) → clearMirrors + deleteMeta(watermark) + pull complet, outbox intacte ; protocol_unsupported → 'protocol_unsupported' ; OfflineError → 'offline' + échec ; tout le reste (autre 4xx dont autre 410, 5xx, réponse invalide) → failures++ et reprise à retryDelayMs si start().
  - `start()` : `(deps.triggers ?? installSyncTriggers)(engine)` une seule fois puis `syncNow('launch')` ; `stop()` retire les déclencheurs, annule reprise et regroupement.
  - État : pending (outbox de l'utilisateur), rejected (opId distincts de la deadletter de l'utilisateur ∪ sync_rejection non ignorés ni supprimés), lastPullOkAt, serverEpoch relus en fin de créneau ; syncing passe à true de façon synchrone au lancement ; abonnés notifiés à chaque changement.
- `apps/web/src/sync/catalog.ts` : `refreshCatalog` (If-None-Match `"<catalogVersion>"`, 304 → 'unchanged', 200 → validation `z.looseObject({ id })`/`IllustrationRef`, 4 magasins remplacés + catalogVersion = serverCatalogVersion = version en une transaction, puis `postToSw({ type: 'SYNC_ILLUSTRATIONS', files })` ; autre statut → `Error('catalog_http_<status>')`).
- `apps/web/src/sync/triggers.ts` : `installSyncTriggers` (visibilitychange visible → 'foreground', `online` → 'online', setInterval 60 s → 'interval' si visible et pending > 0 ; jamais `navigator.onLine`).
- `apps/web/src/sw/protocol.ts` (`PageToSw`) et `apps/web/src/sw/sw-client.ts` (`postToSw`, false sans contrôleur).
- Support de test : `test/support/fake-sync-server.ts` (faux serveur : routes par défaut, surcharge par route, pannes hang/offline, en-tête d'époque, compteur en vol) et `test/support/wait.ts` (`until` : attend sur la vraie boucle via setImmediate sans avancer l'horloge simulée — `vi.waitFor` l'avance sous fake timers, ce qui faussait les tests de reprise).

## Tests
Fichiers : transport (5), apply-pull (7), engine (31), engine-epoch (14), catalog (11), triggers (5). Ids des créations en UUIDv7 via `createMonotonicUuidV7` (ou `makeOp`/seqIds). Fake timers limités à setTimeout/clearTimeout/setInterval/clearInterval.

### RED
`pnpm --filter @appsport/web test sync/transport sync/apply-pull sync/engine sync/catalog sync/triggers`
```
 FAIL  |web| test/sync/apply-pull.test.ts  Error: Cannot find module '../../src/sync/apply-pull'
 FAIL  |web| test/sync/catalog.test.ts     Error: Cannot find module '../../src/sw/sw-client'
 FAIL  |web| test/sync/engine-epoch.test.ts Error: Cannot find module '../../src/sync/engine'
 FAIL  |web| test/sync/engine.test.ts      Error: Cannot find module '../../src/sync/engine'
 FAIL  |web| test/sync/transport.test.ts   Error: Cannot find module '../../src/sync/transport'
 FAIL  |web| test/sync/triggers.test.ts    Error: Failed to resolve import "../../src/sync/triggers"
 Test Files  6 failed (6)
```
Attendu : modules introuvables (Step 2).

Premier passage après implémentation : 7 échecs dus aux tests eux-mêmes (pull complet par défaut effaçant les lignes de test sans watermark ; `vi.waitFor` avançant l'horloge simulée). Corrigés côté tests (watermark 'E1:1' par défaut dans engine.test, helper `until`).

### GREEN
`pnpm --filter @appsport/web test sync` → `Test Files  8 passed (8)`, `Tests  86 passed (86)` (3 passages consécutifs identiques).
`pnpm lint` → propre ; `pnpm typecheck` → propre ; `pnpm test` → `Test Files  94 passed (94)`, `Tests  982 passed | 2 skipped (984)`, sortie sans avertissement.

## Revue personnelle / points d'attention
1. **failures = 0 à chaque health réussi (brief, étape 1)** : une erreur persistante après health (ex. 400 ou 500 répété sur le push) ne fait jamais grandir l'attente au-delà de 2 s — reprise toutes les 2 s tant que l'appli tourne. Conforme au brief mot pour mot, mais à trancher (remise à zéro seulement en fin de cycle réussi ?).
2. **« autre 410 → fin sans effacer »** : traité comme un autre 4xx (échec, reprise avec attente) ; rien n'est effacé.
3. **Taille de `engine.ts`** (~650 lignes formatées) : file, cycle, époque, push et pull dans le même fichier du plan. On pourrait sortir l'époque (renvoi + R-SYN-28) et l'application des résultats de push dans des fichiers à part si le relecteur le souhaite.
4. Ordre à la nouvelle époque : renvoi restore_upsert puis replay-withdraw (ordre du brief), les deux avant le pull complet ; sans accord local, aucune donnée C2 n'est renvoyée, donc l'ordre ne change rien côté vie privée.
5. Après `watermark_expired`, `clearMirrors` efface aussi une copie locale qui a une op en attente (spécifié) ; elle revient après le push et le pull suivants.
6. Une réponse sans en-tête d'époque n'est pas comparée (pas d'erreur) ; l'époque du cycle se rabat sur `epoch` du corps de /api/health si l'en-tête manque.
7. Le délai de `fetchWithTimeout` couvre l'arrivée de la réponse ; le téléchargement du catalogue n'est donc pas coupé à 4 s.

---

# Correctifs — revue, tour 1

Commit : voir `git log --oneline -1` (fix(synchro): file sans recouvrement, échéance sur le corps, reprises et garde utilisateur — Refs #27).

## Changements
- **I1** `engine.ts` : `failures = 0` retiré du succès de /api/health ; remis à zéro juste avant `return 'done'`, après `syncCatalog` (et toujours au changement d'utilisateur).
- **I2** File : `running` booléen ; `launch` démarre le cycle programmé de façon synchrone dans son `finally` (plus de `.then` séparé), et le résout à la fin ; `enqueue` fusionne d'abord dans `next`, puis regarde `running`. Un appelant qui fait `await syncNow(); await syncNow();` ne peut plus lancer un cycle en parallèle de celui déjà programmé.
- **I3** `transport.ts` : `fetchJsonWithTimeout(t, path, init, timeoutMs, onHeaders?)` garde l'échéance (et l'abandon) jusqu'à la fin de `res.text()` ; `onHeaders` lit l'époque avant le corps. Le moteur n'utilise plus que cette fonction. `catalog.ts` : `CATALOG_TIMEOUT_MS = 30_000`, corps compris. `HttpError`, `httpErrorOf`, `JsonReply` déplacés dans `transport.ts` (partagés par le moteur et l'époque). `fetchWithTimeout` est gardée (en-têtes seulement) pour le client API de T28.
- **M3/M4** `handleFailure` vérifie d'abord que le cycle est toujours le courant (même génération, même `meta.userId`) : sinon rien (ni effacement sur account_deleted, ni état sur 401, ni reprise). `assertCurrent` avant `applyPushResults`, avant l'écriture de la deadletter du renvoi, avant `clearMirrors` sur watermark_expired, et juste après le health.
- **M5** `push-results.ts` : pull complet seulement si la ligne rejetée existe et a été acceptée ou a d'autres ops ; ligne absente → rien.
- **M9** Compteur de génération incrémenté par `stop()` ; chaque cycle garde sa génération ; `assertCurrent`/`isCurrent` le comparent. Un cycle d'avant `stop()` s'arrête à sa prochaine vérification, même si `start()` a suivi aussitôt.
- **M2** Découpage sans changement de comportement : `sync/epoch.ts` (`EpochIo`, `resendJournal`, `replayWithdrawal`, `handleEpoch`) et `sync/push-results.ts` (`effectiveStatus`, `deadletterOf`, `applyPushResults`). `engine.ts` passe de 653 à 509 lignes.

## Tests ajoutés
- transport : `fetchJsonWithTimeout` décode le corps ; corps vide → null ; corps bloqué → OfflineError à 4000 ms et requête abandonnée ; exception de `onHeaders` propagée.
- engine :
  - health OK + push 500 → reprises à +2 s puis +4 s ;
  - un cycle réussi remet à zéro (échec suivant repris à +2 s) ;
  - `await syncNow(); await syncNow()` pendant qu'un autre appelant programme un cycle → maxInFlight 1 (3 cycles : le 2e appel de A arrive après le lancement du cycle programmé de B) ;
  - corps de pull bloqué → offline à l'échéance, puis le `syncNow` suivant tourne ;
  - corps de health bloqué → offline, syncing false ;
  - `stop()` + `start()` pendant un cycle en vol → l'ancien cycle ne pousse pas, ordre [health, health, push, pull], maxInFlight 1 ;
  - `stop()` pendant un cycle → plus aucune requête ;
  - utilisateur changé pendant la requête : 410 account_deleted (rien effacé, onAccountDeleted non appelé), 401 (connection inchangée), résultats de push non appliqués ;
  - rejet sur une ligne absente → watermark gardé.

## RED
`pnpm --filter @appsport/web test sync/engine.test sync/transport` avant implémentation → `Tests  13 failed | 38 passed (51)`. Les 4 tests `fetchJsonWithTimeout` échouent (fonction absente), et 9 tests du moteur (reprises +2/+4 s, deux en vol, corps bloqués ×2, stop/start, utilisateur changé ×3, ligne absente). Les deux corps bloqués échouaient au délai de 5 s du test : le moteur était gelé.
Contre l'ancien `src` (git stash), le test « jamais deux en vol » échoue sur `expected 2 to be 1` (maxInFlight).

## GREEN
- `pnpm --filter @appsport/web test sync`, 3 fois : `Test Files  8 passed (8)`, `Tests  101 passed (101)`.
- `pnpm lint` et `pnpm typecheck` : propres.
- `pnpm test` : `Test Files  94 passed (94)`, `Tests  997 passed | 2 skipped (999)`, sortie sans avertissement.
