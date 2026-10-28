# Task 19 — rapport d'implémentation

Statut : DONE_WITH_CONCERNS (préoccupations mineures, voir fin)
Commit : voir `git log -1` sur `socle` — `feat(privacy): consentement santé, questionnaire, limitations et retrait` (Closes #20)

## Implémenté
- `packages/contracts/src/api/consent.ts` : BODY_AREAS/LIMITATION_SIDES/LIMITATION_SEVERITIES + schémas Zod, libellés exacts du brief, LIMITATION_NOTE_MAX 200, GrantConsentRequest, WithdrawConsentRequest (password max 1024), ReplayWithdrawRequest (`z.iso.datetime()`), HealthScreeningRequest/Response, LimitationInput/Patch, CreateLimitationResponse ; exporté par `index.ts`.
- `apps/server/src/privacy/consent.ts` : `grantConsent` (no-op si accord actif de même version ; consent_event grant + security_event consent_granted { consentType }), `HEALTH_WITHDRAW_HOOKS = {}`, types `HealthWithdrawHook(s)`, `withdrawHealthConsent` (n'agit que si actif ; hooks exécutés une fois chacun et remplaçant la règle générique de leur table ; règle générique sur `deps.entityRules` par SQL dynamique `sql.table`/`sql.ref` : C2 → contenu (hors id et SYNC_COLUMNS) à NULL + `deleted_at = coalesce(deleted_at, now)` sur lignes non supprimées ou encore pleines, un writeStamp par ligne ; sinon `c2Columns` à NULL et colonne `c2Values` à NULL si valeur listée, stamp seulement sur les lignes concernées ; puis consent_event withdraw avec la textVersion du dernier grant (created_at DESC, rev DESC) et consent_revoked { consentType: 'health' (+ replay: true) }, aucun contenu journalisé). Helper `latestGrant` exporté (utilisé par la route de renvoi).
- `apps/server/src/privacy/consent-routes.ts` (monté sur `/api/me`) : gardes route par route (jamais `use('*')`).
  - POST `/consents` → 400 si textVersion ≠ HEALTH_CONSENT_TEXT.version ; 200 MeResponse.
  - POST `/consents/withdraw` → parseJson, `verifyUserPassword(deps.db, deps, user, password, ip)` avant la transaction (401/429), 200 MeResponse ; idempotent.
  - POST `/consents/health/replay-withdraw` → limiteur IP propre (CODE_CHECKS_PER_HOUR / heure, WeakMap par deps) → parseJson → transaction : 409 conflict sauf accord actif, withdrawnAt > created_at du dernier grant et < epochStartedAt ; sinon withdraw { replay: true } ; 200 MeResponse.
  - PUT `/health-screening` : garde C2 → parseJson → version = HEALTH_QUESTIONNAIRE.version sinon 400 ; caution = answers.some(Boolean) ; upsert sur id = owner_id (réactive la tombstone).
  - POST `/limitations` : garde C2 → parseJson → 201 { id }.
  - PATCH/DELETE `/limitations/:id` : chargement id/owner_id (404 si absente, supprimée ou à un autre) → garde C2 (403) → parseJson (PATCH) → écriture ; DELETE = tombstone sans contenu.
- `routes.ts` : `app.route('/api/me', consentRoutes(deps))`.
- `admin-isolation.test.ts` : `MIN_ID_ROUTES = 6`.
- Schéma : rien à changer (contenu de health_screening et limitation déjà nullable seulement si deleted_at est posé, migration T4b).

## Tests
- `consent.test.ts` (10) : grant, versions/type refusés, grant répété unique, garde C2 (PUT/POST avec {} et corps valide, PATCH/DELETE d'une limitation existante → 403, ligne inchangée), questionnaire E7 (clés de ligne exactes, caution, me.cautious, version 0.1 et 3 réponses → 400), cycle POST/PATCH/DELETE + tombstone + PATCH/DELETE ensuite → 404, note 201 car./bodyArea 'tail' → 400, admin avec/sans accord → 404.
- `withdraw.test.ts` (10) : tables t19_note (C1 J, c2Columns pain_note, c2Values reason ['pain']) et t19_c2_log (C2 J) ; mot de passe faux → 401 consent actif ; 5 faux puis bon → 429 ; retrait complet (screening/limitations tombstones, rev augmenté, t19_note pain nettoyée, tired intacte rev 1, t19_c2_log tombstone, consent_event withdraw 1.0, un consent_revoked, autre utilisateur intact, cautious gardé) ; second retrait n'écrit rien (sync_counter et security_event inchangés) ; cautiousMode false → cautious false ; réactivation de la même ligne health_screening ; HEALTH_WITHDRAW_HOOKS = {} ; hook spy appelé une fois avec (trx, deps, u.id), WITNESS gardé ; Review Focus 3 (aucune table ni ligne de journal ne contient WITNESS après retrait des deux utilisateurs).
- `replay-withdraw.test.ts` (6) : accepté (11:00), 409 à = grant et = début d'époque (rien ne change), 409 accord déjà retiré, 'hier' → 400, 21e appel depuis 100.64.0.7 → 429.

### RED (séparé, avant toute implémentation serveur ; contrats déjà écrits)
`pnpm --filter @appsport/server test consent.test withdraw admin-isolation`
→ `Test Files 4 failed (4) / Tests 16 failed | 2 passed (18)` ; échecs : `expected 404 to be 200` ×8, `404 to be 201`, `404 to be 400` ×3, `404 to be 403` ×2 (routes absentes), `expected 4 to be greater than or equal to 6` (admin-isolation), `Cannot find module '../../src/privacy/consent'` (withdraw.test). Attendu : routes et module pas encore créés.

### GREEN
Même commande → `Test Files 4 passed (4) / Tests 27 passed (27)` (après correction des tests : les lectures `sql` brutes passent par CamelCasePlugin, clés camelCase).
`pnpm lint` → propre ; `pnpm typecheck` → propre ; `pnpm test` → `Test Files 66 passed (66) / Tests 740 passed | 2 skipped`, sortie sans warning.

## Fichiers
Créés : packages/contracts/src/api/consent.ts, apps/server/src/privacy/consent.ts, apps/server/src/privacy/consent-routes.ts, apps/server/test/privacy/{consent,withdraw,replay-withdraw}.test.ts
Modifiés : packages/contracts/src/index.ts, apps/server/src/routes.ts, apps/server/test/privacy/admin-isolation.test.ts

## Auto-revue / préoccupations
- IP : le brief dit `clientIp(c)` ; j'ai utilisé `validClientIp(c)` comme toutes les routes existantes (me-routes, admin, invitations) : IP syntaxiquement valide ou null, jamais une clé arbitraire de limiteur.
- DELETE `/limitations/:id` ne fait pas de `parseJson` (pas de corps attendu) ; ordre chargement → garde C2 respecté.
- consent_event (grant et withdraw) : `updated_by` = l'utilisateur ; le created_at de l'événement de renvoi est l'heure serveur (pas `withdrawnAt`).
- `meRoutes` pose déjà `use('*', requireUser)` sur `/api/me` ; mes routes gardent leur propre `requireUser` comme demandé (double passage sans effet).
- Règle générique : ignore les tables sans `ownerColumn` ; suppose les colonnes rev/updated_at/updated_by sur les tables concernées (vrai pour toute table C2 ou à c2Columns du registre).

## Fix report — review round 1 (commit `fix(privacy): garde C2 relue dans la transaction d'écriture`, Refs #20)

Changes:
1. (Important) TOCTOU on the C2 guard. `consent.ts` now exports `assertHealthConsent(db, userId)` (403 health_consent_required) and the write helpers `saveHealthScreening`, `createLimitation`, `updateLimitation`, `deleteLimitation`. Each one calls `assertHealthConsent(trx, …)` first inside its transaction. The routes keep their pre-check (load → guard → parseJson) so the error codes stay the same, and delegate the write to the helpers. Update and delete also filter on `owner_id`.
2. Replay limiter: explicit `REPLAY_WINDOW_MS = 60 * 60 * 1000` tied to the 20/h rule. It no longer uses `LOGIN_LIMITS.windowMs`.
3. Answer count: kept the `z.tuple` from the shared interface and added `packages/contracts/test/consent.test.ts`. The test checks that `HealthScreeningRequest` accepts exactly `HEALTH_QUESTIONNAIRE.questions.length` answers and refuses n-1 and n+1.
4. Limitation `note`: after `trim`, an empty or whitespace-only note becomes `null` (contracts test covers LimitationInput and LimitationPatch).
5. New replay test: a user who never granted consent gets 409 `conflict` and nothing changes.

Regression test (consent.test.ts, "garde C2 dans la transaction d'écriture"): grant, questionnaire, limitation, then withdrawal. Each of the 4 helpers called in a transaction throws HttpError 403 `health_consent_required`, and the health_screening and limitation tables stay the same.

RED (separate run, before the fix): `pnpm --filter @appsport/server test consent.test replay-withdraw` → 1 failed (TypeError: helpers not exported, as expected). `pnpm --filter @appsport/contracts test consent` → 1 failed (`expected '' to be null`). The no-grant replay test and the tuple-length test already passed: they add coverage of behaviour that was already correct.
GREEN: server `consent.test replay-withdraw withdraw admin-isolation` → 29/29. contracts `consent` → 2/2. `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` → 67 files, 744 passed, 2 skipped, clean output. `git show --stat HEAD`: 6 files, as claimed. Working tree clean.

Note: `updateLimitation` and `deleteLimitation` take a stamp even if the row disappeared between the load and the transaction (a harmless gap in rev, no write).
