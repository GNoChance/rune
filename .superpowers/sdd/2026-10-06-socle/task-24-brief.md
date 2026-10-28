### Task 24: privacy:collect et privacy:reapply

**Files:**
- Create: `apps/server/src/privacy/reapply.ts`
- Modify: `apps/server/src/cli.ts` (`privacy:collect`, `privacy:reapply`), `apps/server/test/support/sync-fixtures.ts` (`snapshotDb`, `restoreInPlace`)
- Test: `apps/server/test/privacy/reapply.test.ts`, `apps/server/test/cli/privacy-cli.test.ts`

**Interfaces:**
- Consumes : T13 (`deleteAccount`) ; T19 (`withdrawHealthConsent`) ; T10 (`isHealthConsentActive`) ; T22 (`rotateServerEpoch`) ; T7 (`runCli`, `withAppDeps`, `parseFlags`) ; T6 (`loadConfig`) ; T3 (`NodeSqliteDialect`) ; T20 (`syncPush`, `makeOp`, `createSyncTestContext`, `dumpDatabase`) ; routes de T12, T13 et T19 ; T14.
- Produces : Interfaces partagées §5 (`PrivacyEventList`, `collectPrivacyEvents`, `reapplyPrivacyEvents`), §2 (support `snapshotDb` par `backup` de `node:sqlite`, `restoreInPlace`) et commandes CLI `privacy:collect`, `privacy:reapply` (syntaxe en §2).

**Spec:** 03 §8 étapes 1 à 4, §17 n°10, P-DRT-3, P-DRT-4, P-CST-3 ; 02 R-SUP-6 ; 08 P4 (a) étapes 1-2 ; Review Focus 4 (volet `privacy:reapply`).

- [ ] **Step 1: Write the failing test**

```ts
// reapply.test.ts (03 §17 n°10) — x, y, z ; z supprimé avant S (hors liste) ; y : consentement, questionnaire, limitation note 'TEMOIN-C2-genou'
// snapshotDb(ctx, S) ; since = now ; +60 s ; x supprimé (204) ; y retire son consentement (200)
expect(events).toEqual([{ type: 'account_deleted', at: expect.any(String), targetId: x.id },
                        { type: 'consent_revoked', at: expect.any(String), targetId: y.id, consentType: 'health' }]);
// restoreInPlace(ctx, S) → dumpDatabase contient 'TEMOIN-C2-genou'
expect(await reapplyPrivacyEvents(ctx.deps, { since, collectedAt, source: 'test', events })).toEqual({ accountsDeleted: 1, consentsWithdrawn: 1 });
// x absent de user ; GET /api/me avec l'ancien cookie de x → 410 { error: 'account_deleted' } ; push rejoué de x → 410 account_deleted
// 'TEMOIN-C2-genou' absent de dumpDatabase ; health_screening de y { caution: null, deleted_at: <non nul> }
// second appel → { accountsDeleted: 0, consentsWithdrawn: 0 } ; événements antérieurs à since et autres types ignorés ; consent_revoked ai_coach ignoré
// seul admin w promeut x puis se supprime après S ; après restoreInPlace(S), reapply supprime w sans last_admin
// privacy-cli.test.ts : après init, deux security_event (account_deleted u-x, consent_revoked u-y { consentType: 'health' }) ;
//   privacy:collect --since 2026-10-06T00:00:00.000Z [--source copie.db] --out l.json → 0, targetIds ['u-x','u-y']
// '9999_future' breaking dans schema_migrations → privacy:collect rend les mêmes événements, code 0 ; --source copie.db (journal DELETE) : sha256 inchangé, aucun copie.db-wal
expect(lines).toContain('Réapplication terminée : 0 compte(s) supprimé(s), 0 accord(s) santé retiré(s).');
expect(lines).toContain('Aucun administrateur actif : lancer admin:bootstrap');   // aucun admin après init, code 0 ; absent avec un admin actif
// --since invalide, --out manquant, fichier de liste invalide → code 1
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test privacy/reapply cli/privacy-cli` → `privacy/reapply` introuvable ; `Commande inconnue`.

- [ ] **Step 3: Implement**

`collectPrivacyEvents` : `security_event` de type `account_deleted` ou `consent_revoked`, `outcome = 'success'`, `at > since`, `ORDER BY at, id` ; `consentType` lu dans `details`. `privacy:collect` sans `withAppDeps` : `new DatabaseSync(--source ?? loadConfig(env).dbPath, { readOnly: true })` sous Kysely (`NodeSqliteDialect`, `CamelCasePlugin`), sans garde, pragma ni migration. `reapplyPrivacyEvents` : une transaction, dans l'ordre ; compte existant → `deleteAccount(trx, deps, id, { actorId: null, ip: null }, { enforceLastAdmin: false })` ; `health` actif → `withdrawHealthConsent` ; `ai_coach` ignoré (aucun accord coach avant la brique 4) ; ensuite, aucun `user` admin actif → la CLI écrit « Aucun administrateur actif : lancer admin:bootstrap » (stdout, code 0). `restoreInPlace` : `foreign_keys=OFF`, `ATTACH … AS snap`, recopie table par table, `DETACH`, `foreign_keys=ON`, puis `rotateServerEpoch(db, deps)`. Messages CLI : « Date --since invalide (format ISO 8601 attendu) » ; « Option --out obligatoire » ; « Fichier de réapplication invalide » ; succès de `collect` : `<n> événement(s) écrit(s) dans <fichier>` (liste en `JSON.stringify(list, null, 2)`, `source` = chemin lu).

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  2 passed`.

- [ ] **Step 5: Commit**

`git commit -m "feat(privacy): privacy:collect et privacy:reapply après restauration"`

---

