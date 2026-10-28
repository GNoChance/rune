### Task 19: Consentement santé, questionnaire d'alerte, limitations et retrait

**Files:**
- Create: `packages/contracts/src/api/consent.ts`, `apps/server/src/privacy/{consent.ts, consent-routes.ts}`
- Modify: `packages/contracts/src/index.ts`, `apps/server/src/routes.ts` (`app.route('/api/me', consentRoutes(deps))`), `apps/server/test/privacy/admin-isolation.test.ts` (T13)
- Test: `apps/server/test/privacy/{consent,withdraw,replay-withdraw}.test.ts`

**Interfaces:**
- Consumes : T6 ; T4a (`writeStamp`, `Migration`, `getServerMeta`, dont `epochStartedAt` de T4b) ; T5 (`SYNC_COLUMNS`, `entityRules`, `c2Values`) ; T8 (`CODE_CHECKS_PER_HOUR`) ; T9 (`requireUser`, `logSecurityEvent`) ; T10 (`ConsentType`, `getConsentState`, `isHealthConsentActive`, `buildMe`, `createIpLimiter`, `verifyUserPassword`) ; T14 (`HEALTH_CONSENT_TEXT`, `HEALTH_QUESTIONNAIRE`) ; T13 (`admin-isolation.test.ts`, constante `MIN_ID_ROUTES`).
- Produces : Interfaces partagées §4 (`api/consent.ts`, `grantConsent`, `withdrawHealthConsent`, `HEALTH_WITHDRAW_HOOKS`, `consentRoutes`) et routes `/api/me/consents*` (dont `replay-withdraw`, appelée par T26), `/api/me/health-screening`, `/api/me/limitations*`.

**Spec:** 02 R-CST-1 à R-CST-8, 03 P-CST-1 à P-CST-4, 02 §12 E7, 01 R-SYN-9, R-SYN-28 (exception à 03 P-AUT-5), 09 §8 « Retrait du consentement santé », 03 P-LOG-1, P-LOG-2, §17 n°3, n°4, n°7, 02 §15 n°13, Review Focus 3.

- [ ] **Step 1: Write the failing test**

```ts
// consent.test.ts
// grant (R-CST-1) : 200, me.consents.health = { active: true, textVersion: '1.0', at: '2026-10-06T10:00:00.000Z' } ;
//   un consent_event { type: 'health', action: 'grant', textVersion: '1.0', updatedBy: u.id } ; consent_granted, details { consentType: 'health' }
// textVersion '0.9' ou type 'ai_coach' → 400 ; grant identique répété → un seul événement
// sans consentement (R-CST-4, P-CST-2) : PUT health-screening et POST limitations → 403 { error: 'health_consent_required' }, même avec le corps {}, aucune ligne ;
//   PATCH et DELETE d'une limitation vivante du même utilisateur (insertFixtureRow) → 403, ligne inchangée
// questionnaire (E7) : [false ×4] → { caution: false } ; [false, false, true, false] → { caution: true } ;
expect(Object.keys(row).sort()).toEqual(['answeredAt','caution','createdAt','deletedAt','id','ownerId','questionnaireVersion','rev','updatedAt','updatedBy']);   // réponses jamais stockées
// row { caution: 1, questionnaireVersion: '1.0', answeredAt: '2026-10-06T10:00:00.000Z' } ; me.cautious true ; version '0.1' ou 3 réponses → 400
// limitations : POST { bodyArea: 'knee', side: 'left', severity: 'mild', note: 'gêne en descente' } → 201, active 1 ; PATCH { severity: 'severe', active: false } → 204 ;
//   note de 201 caractères ou bodyArea 'tail' → 400 ; admin, avec ou sans accord, corps {} → 404 ; DELETE → 204 et tombstone sans contenu
//   { bodyArea: null, side: null, severity: null, note: null, active: null, deletedAt: '2026-10-06T10:00:00.000Z' } **[décision plan]** ; PATCH ensuite → 404
// admin-isolation.test.ts (T13) : MIN_ID_ROUTES = 6 (+ PATCH, DELETE /api/me/limitations/:id)
// withdraw.test.ts — tables de test t19_note (C1 J ; pain_note dans c2Columns ; c2Values { reason: ['pain'] }) et t19_c2_log (C2 J) ;
//   deux utilisateurs avec consentement, cautiousMode, questionnaire [true, false, false, false], deux limitations et des lignes de test contenant WITNESS = 'TEMOIN-C2-5a1f'
// mot de passe faux → 401 invalid_credentials, consentement toujours actif ; 5 faux puis le bon → 429 { error: 'rate_limited' }
// retrait (R-CST-5, P-CST-3, 02 §15 n°13) : 200, consents.health.active false, cautious true (cautious_mode gardé) ;
//   health_screening { caution: null, questionnaireVersion: null, answeredAt: null, deletedAt: '2026-10-06T10:00:01.000Z' } ;
//   limitations sans contenu, supprimées, rev augmenté ; t19_note { label: 'séance', pain_note: null, deleted_at: null }, rev > 1 ;
//   t19_note.reason 'pain' → null, 'tired' gardé (09 §8) ; t19_c2_log { value: null, deleted_at: '2026-10-06T10:00:01.000Z' } ;
//   consent_event withdraw '1.0' ; un consent_revoked { consentType: 'health' } ; l'autre utilisateur intact
// second retrait → aucune nouvelle ligne (idempotent) ; cautiousMode false puis retrait → cautious false
// HEALTH_WITHDRAW_HOOKS vaut {} ; hooks { t19_c2_log: spy } → spy appelé une fois avec (trx, deps, u.id), t19_c2_log garde WITNESS
// Review Focus 3 : après retrait des deux utilisateurs, WITNESS n'apparaît ni dans aucune table (SELECT * de sqlite_schema) ni dans le journal
// nouveau consentement puis questionnaire → la même ligne health_screening est réactivée (deletedAt null)
// replay-withdraw.test.ts (R-SYN-28) — grant à 10:00, questionnaire, une limitation ; server_meta.epoch_started_at '2026-10-06T12:00:00.000Z' ; appels à 12:30, sans mot de passe
// { withdrawnAt: '2026-10-06T11:00:00.000Z' } → 200, accord inactif, health_screening et limitation en tombstone, consent_revoked details { consentType: 'health', replay: true }
// 409 { error: 'conflict' }, rien ne change : withdrawnAt '2026-10-06T10:00:00.000Z' (= grant) ; '2026-10-06T12:00:00.000Z' (= début d'époque) ; accord déjà retiré
// withdrawnAt 'hier' → 400 ; 21e appel depuis 100.64.0.7 dans l'heure → 429 rate_limited
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test consent.test withdraw` → `POST /api/me/consents` renvoie 404.

- [ ] **Step 3: Implement**

Libellés exacts : `BODY_AREA_LABELS` shoulder « Épaule », elbow « Coude », wrist_hand « Poignet ou main », neck « Cou », upper_back « Haut du dos », lower_back « Bas du dos », hip « Hanche », knee « Genou », ankle_foot « Cheville ou pied », other « Autre » ; `LIMITATION_SIDE_LABELS` left « Gauche », right « Droite », both « Les deux », not_applicable « Sans objet » ; `LIMITATION_SEVERITY_LABELS` mild « Légère », severe « Forte : m'empêche certains mouvements ».

`withdrawHealthConsent(…, opts?: { replay?: boolean; hooks?: HealthWithdrawHooks /* défaut HEALTH_WITHDRAW_HOOKS = {} */ })` n'agit que si le consentement est actif. Un hook remplace la règle générique pour sa table et s'exécute une fois (briques 3 et 5 : `nutrition_profile`, `PAIN_*` → `USER_*`, 09 §8). Règle générique, pour chaque autre table de `deps.entityRules` liée au propriétaire :
- `category === 'C2'` : colonnes de contenu (hors `id` et `SYNC_COLUMNS`) à NULL, `deleted_at = COALESCE(deleted_at, now)`, un `writeStamp` par ligne, sur les lignes non supprimées ou encore pleines ;
- sinon : `c2Columns` à NULL, colonne de `c2Values` à NULL si elle vaut une valeur listée, nouveau stamp sur les lignes concernées ;
- SQL dynamique par `sql.table` et `sql.id` (noms snake_case du registre) ; puis `consent_event withdraw` (`textVersion` du dernier grant, `ORDER BY created_at DESC, rev DESC`) et `consent_revoked { consentType: 'health' }` (+ `replay: true` si `opts.replay`) ; aucune valeur de contenu journalisée.

Gardes route par route (`requireUser`, jamais `use('*')`). PATCH et DELETE `/limitations/:id` : chargement `id, owner_id` (404 si absente, supprimée ou à un autre) → garde C2 (403) → `parseJson` → écriture ; PUT `/health-screening` et POST `/limitations` : garde C2 → `parseJson`. `caution = answers.some(Boolean)` ; upsert du questionnaire sur `id = owner_id`. Retrait : `verifyUserPassword(deps.db, deps, user, password, clientIp(c))` (429 par le limiteur `login`, faux → 401) avant la transaction.

`POST /consents/health/replay-withdraw` (sans mot de passe) : IpLimiter de la route (`CODE_CHECKS_PER_HOUR` par heure, mémoïsé par `deps`) → 429 ; `parseJson(ReplayWithdrawRequest)` ; en transaction, 409 `conflict` sauf si l'accord est actif, `withdrawnAt` > `created_at` du dernier grant et < `getServerMeta(trx).epochStartedAt` ; sinon `withdrawHealthConsent(…, { replay: true })` ; 200 `buildMe`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test consent.test withdraw` → `Test Files  3 passed` ; puis `pnpm --filter @appsport/server test` → vert, dont « Review Focus 3 » et `admin-isolation` (≥ 6 routes) ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(privacy): consentement santé, questionnaire, limitations et retrait"`

---

## Partie 4 — Synchro

