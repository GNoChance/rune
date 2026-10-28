### Task 27: Convergence sur deux appareils et scénarios ciblés

**Files:**
- Create: `apps/web/test/support/{in-process-transport.ts, lossy-transport.ts}`
- Modify: `apps/web/package.json` (dev `fast-check` 4.x), `apps/server/test/support/index.ts` (réexporte `createLogger` et `grantConsent`)
- Test: `apps/web/test/sync/{convergence,scenarios}.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Consumes : `@appsport/server/testing` (`createSyncTestContext`, `SYNC_FIXTURE_RULES`, `createUserAndLogin`, `snapshotDb`, `restoreInPlace`, `dumpDatabase`, `createLogger`, `grantConsent`) ; T25 ; T26.
- Produces : Interfaces partagées §5 (`inProcessTransport` : ajoute `cookie` et `origin = appOrigin`, journalise `{ method, path, body }` ; `LossyOptions`, `lossyTransport`).

**Spec:** 01 §9.1.2, R-SYN-9, R-SYN-12, R-SYN-26, R-SYN-27 ; 03 §17 n°3 et n°11, P-AUT-6, P-CST-4 ; Review Focus 2 et 3 (bout en bout).

- [ ] **Step 1: Write the failing test**

```ts
// ids de ligne : createMonotonicUuidV7
// convergence.test.ts — commandes fast-check createNote (titre '' ou 1..20), patchNote, deleteNote, createItem, sync sur l'appareil 0 ou 1
it.each([{ seed: 20261006, dropRate: 0.3, dupRate: 0.2, maxDelayMs: 3, reorder: false }, { seed: 7, dropRate: 0.2, dupRate: 0.4, maxDelayMs: 3, reorder: true }])
  ('deux appareils convergent malgré pertes, doublons, retards et réordonnancements (%o)', /* numRuns 25, seed fixée, 120 s */);
// après heal() et jusqu'à 10 tours de syncNow puis pullNow : miroirs fixture_note (title, body, deletedAt) et fixture_note_item (noteId, label, deletedAt)
// identiques au serveur ; pendingCount 0 ; items serveur = items créés hors rejets ; sync_rejection identiques ; chaque opId de deadletter a sa ligne sync_rejection
// scenarios.test.ts
// 401 puis reconnexion du même utilisateur : 3 notes, 'unauthenticated', pendingCount 3 ; bon cookie + syncNow('manual') → pendingCount 0, 3 notes au serveur
// outbox de A jamais envoyée sous la session de B (03 §17 n°11) : aucune op de A dans les push, 0 fixture_note au serveur, pendingCount(A) 2
// changement d'époque avec appareil en retard (R-SYN-26/27) : A et B sur E1 ; n1 'avant' ; snapshotDb(S) ; A patche n1 'apres-S' et crée n2 ; B tire ;
//   restoreInPlace(S) → E2 ; B patche hors ligne n1 body 'B-hors-ligne' ; A rejoue (n1 'apres-S', n2 réinséré) puis patche n1 'final-A' ;
//   B : pendingCount 1 avant l'envoi, puis
expect(seq).toEqual(['GET /api/health', 'POST /api/sync/push:restore_upsert', 'POST /api/sync/push:patch', 'GET /api/sync/pull']);   // pull sans since
expect(n1).toEqual({ title: 'final-A', body: 'B-hors-ligne' });   // n2 présent ; miroirs de A et B identiques au serveur
// retrait du consentement pendant que B a des ops C2 en attente (Review Focus 3) : B hors ligne crée item { painNote: 'TEMOIN-C2-7f3a' } et
//   fixture_c2_log { value: 987654 } ; A retire le consentement ; B.syncNow → 0 sync_rejection ; aucun témoin dans dumpDatabase, le journal,
//   ni aucune table Dexie de A et B ; deadletter de B vide ; fixture_c2_log de B vide
// variante : B tire le retrait avant de pousser → aucun témoin dans le journal des requêtes de B
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test sync/convergence sync/scenarios` → `in-process-transport` introuvable.

- [ ] **Step 3: Implement**

`lossyTransport` (mulberry32(`seed`)), à chaque appel : retard réel `rand() * maxDelayMs` ; si `reorder` et un doublon attend, rejeu tardif sur `inner` (réponse ignorée, `replayedLate++`) ; perte (`dropRate`) : une fois sur deux `TypeError('lossy: request dropped')` sans appel, sinon appel puis `TypeError('lossy: response dropped')` (`dropped++`) ; doublon (`dupRate`) : mis en attente si `reorder`, sinon deux appels et première réponse (`duplicated++`) ; sinon `inner.fetch`. `heal()` remet les taux et le délai à 0 et vide la file. Si une propriété échoue, corriger le code de production (T20 à T26), jamais le test, avec un commit `fix(synchro): …`.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  2 passed` (graines fixées) ; puis `pnpm test` complet, vert.

- [ ] **Step 5: Commit**

`git commit -m "test(synchro): convergence deux appareils et scénarios d'époque et de consentement"`

---

## Partie 5 — Web

