# Preflight — plan du socle (2026-10-06)

Contrôle du plan `docs/superpowers/plans/2026-10-06-socle.md` (46 tâches, lu en entier) avant le début du code. Les extraits de spec ont été vérifiés pour 01 §5.6 et §9, et pour 08 §7 à §9. Légende : **OK** = cohérent ; **C<n>** = conflit (voir §4) ; **D<n>** = défaut imposé par le plan (voir §3) ; **doc** = écart de la File Structure, sans effet sur le code.

## 1. Paires de tâches (fichier ou interface partagés)

| Tâche A | Tâche B | Ce que A produit / ce que B consomme ou modifie | Constat |
|---|---|---|---|
| T1 | T2 | `constants.ts` minimal (MIN_AGE) complété par B ; `domain/index.ts` | OK |
| T1 | T3 | `apps/server/package.json` (B ajoute kysely, better-sqlite3) | OK |
| T1 | T5 | `contracts/src/index.ts` (B ajoute `export *` de case, entity-rules) | OK |
| T1 | T6 | contracts index + package.json (zod, hono, @hono/node-server) | OK |
| T1 | T7 | `apps/server/package.json` (tsx) | OK |
| T1 | T8 | index contracts et domain (exports auth) | OK |
| T1 | T11 | index contracts (api/admin) | OK |
| T1 | T12 | index contracts (ops) | OK |
| T1 | T13 | index contracts (api/export) | OK |
| T1 | T14 | index contracts et domain (taxonomie, text) | OK |
| T1 | T15 | index contracts et domain (profile, recommend) | OK |
| T1 | T17 | index contracts (api/places) | OK |
| T1 | T19 | index contracts (api/consent) | OK |
| T1 | T20 | index contracts (sync) | OK |
| T1 | T23 | index contracts (catalog) | OK |
| T1 | T28 | index contracts (help-resources) ; `vitest.config.ts` (setupFiles web) ; `apps/web/package.json` | OK (doc : vitest.config mod. T28 absent de la File Structure) |
| T1 | T25 | `apps/web/package.json` : dependencies.test de T1 exige déjà la devDep `@appsport/server`, que B rajoute | OK (ajout sans effet) |
| T1 | T27 | `apps/web/package.json` (fast-check) | OK |
| T1 | T35 | `package.json` racine `build` ; script web `build` | OK |
| T1 | T38 | script racine `test:e2e` délégué ; `ci.yml` job e2e ; dev @playwright/test | OK |
| T1 | T41 | `package.json` racine `build`/`build:server` ; server package.json ; `ci.yml` job image | OK |
| T1 | T42 | `ci.yml` : T1 pose déjà `push: main` + `pull_request` ; la modif de B ne change rien | D7 (sans effet, test vert d'avance) |
| T1 | T43 | `package.json` racine `test:infra` + bats ; `ci.yml` job infra | OK |
| T2 | T4a | `createMonotonicUuidV7`, `isUuidV7` → `seqIds` | OK |
| T2 | T5 | constantes | OK |
| T2 | T6 | constantes (PROTOCOL/EPOCH headers) | OK |
| T2 | T7 | `isUuidV7` | OK |
| T2 | T8 | `Role` | OK |
| T2 | T10 | `ageBandOn`, `parisDate`, `computeCautious`, `PRIVACY_POLICY_VERSION` | OK |
| T2 | T11 | `ageOn`, `MIN_AGE`, `PRIVACY_POLICY_VERSION` | OK |
| T2 | T15 | `AgeBand` | OK |
| T2 | T16 | `ageBandOn`, `parisDate` | OK |
| T2 | T17 | `ageBandOn` (visibilité mineur) | OK |
| T2 | T20 | `SYNC_PROTOCOL`, `MIN_PROTOCOL`, `PROTOCOL_HEADER`, `isUuidV7` (même motif que `UUID_V7_RE`) | OK |
| T2 | T25 | `SYNC_PROTOCOL` | OK |
| T2 | T26 | `EPOCH_HEADER`, `createMonotonicUuidV7` | OK |
| T2 | T28 | `createMonotonicUuidV7` | OK |
| T2 | T34 | `parisDate` (nom du fichier d'export) | OK |
| T2 | T40 | `parisDate` (daily-AAAAMMJJ), `isUuidV7` | OK |
| T3 | T4a | `openDatabase`, `DbExecutor` ; B ajoute `tableKey` à `schema.ts` | OK (doc : en-tête §2 « [T3 ; T4b ; mod. T5] » omet T4a) |
| T3 | T4b | `schema.ts` squelette → complet | OK |
| T3 | T5 | `schema.ts` : `tableKey` délègue à `snakeToCamel` | OK |
| T3 | T6 | `openDatabase(':memory:'|dbPath)` | OK |
| T3 | T7 | `openDatabase`, fermeture avant relance | OK |
| T3 | T20 | erreurs du pilote propagées avec `errcode` (rejet SQLITE_CONSTRAINT) | OK |
| T3 | T24 | `NodeSqliteDialect` sur une base `readOnly` | OK |
| T3 | T40 | `openDatabase(.restoring)` | OK |
| T4a | T4b | `MIGRATIONS = []` → `[0001_socle]` ; migrate/rev.test basculés de m1 vers MIGRATIONS | OK (voir D3) |
| T4a | T5 | `seqIds`, `migrate` | OK |
| T4a | T6 | `deps.ts` (+Argon2Params, AppDeps), index du support, `initServerMeta` | OK |
| T4a | T7 | `migrate`, `initServerMeta(cryptoIds, systemClock)` | OK |
| T4a | T9 | `DbExecutor`, `FakeClock` | OK |
| T4a | T10 | `writeStamp` | OK |
| T4a | T11 | `writeStamp` | OK |
| T4a | T16 | `writeStamp` | OK |
| T4a | T17 | `writeStamp` | OK |
| T4a | T19 | `getServerMeta().epochStartedAt`, `Migration` (tables t19_*) | OK |
| T4a | T20 | `deps.ts` (+`syncHooks`), `Migration` | OK |
| T4a | T21 | `getServerMeta` | OK |
| T4a | T22 | `getServerMeta`, `writeStamp` | OK |
| T4a | T23 | `getServerMeta` (catalogVersion) | OK |
| T4a | T40 | `migrate`, `initServerMeta`, `nextRev` | OK |
| T4b | T5 | DDL des 18 tables → `columns` du registre (test sqlite_schema ⇔ registre) | OK |
| T4b | T19 | `server_meta.epoch_started_at` | OK |
| T4b | T20 | CHECK `IN (…)` et bornes lus par enum-consistency | **C1** |
| T4b | T21 | colonnes booléennes/JSON → `COLUMN_CODECS` (codecs.test) | OK |
| T4b | T22 | `epoch_started_at` ; FK pour le tri topologique de la purge | OK |
| T5 | T6 | `entityRules` par défaut de `createAppDeps` | OK |
| T5 | T9 | `insertFixtureRow` | OK (voir D9) |
| T5 | T13 | `entityRules`, `rowToCamel`, `insertFixtureRow`, `onUserDelete` | OK |
| T5 | T16 | `insertFixtureRow(place)` dans `completeOnboarding` (défaut `is_primary` 0 : passer `isPrimary: 1`) | OK |
| T5 | T19 | `SYNC_COLUMNS`, `c2Values` | OK |
| T5 | T20 | `parent`, `c2Values`, conversions de casse | OK |
| T5 | T21 | `mirroredTables`, `insertFixtureRow` (pull-leak) | OK (voir D10) |
| T5 | T25 | `mirroredTables`, `camelToSnake`, `snakeToCamel` | OK |
| T5 | T26 | `EntityRule.parent` (renvoi parents d'abord) | OK |
| T6 | T7 | `loadConfig`, `createApp`, `createAppDeps`, `createLogger`, `HealthResponse` | OK |
| T6 | T8 | `Argon2Params`, `ARGON2_PARAMS`, `TEST_ARGON2`, `loadConfig` | OK (D6 : assertion dupliquée) |
| T6 | T9 | `app.ts` : `sessionMiddleware` après `originGuard` ; `AppEnv`, `SessionUser`, `errorHandler` | OK |
| T6 | T10 | `routes.ts` (+/api/auth, /api/me), `parseJson`, `httpError`, `clientIp` | OK |
| T6 | T11 | `routes.ts` (+/api/invitations, /api/admin/invitations) | OK |
| T6 | T12 | `routes.ts` (+/api/admin) | OK |
| T6 | T16 | `routes.ts` (profileRoutes sur /api/me) | OK |
| T6 | T17 | `routes.ts` (/api/gyms), `parseQuery` | OK |
| T6 | T18 | `routes.ts` (/api/places) | OK |
| T6 | T19 | `routes.ts` (consentRoutes sur /api/me) | OK |
| T6 | T20 | `routes.ts` (/api/sync), `deps.ts` `syncHooks` | OK |
| T6 | T22 | `createApp(ctx.deps)` dans epoch.test | OK |
| T6 | T23 | `routes.ts` (/api/catalog), `contentDir`, `Logger` | OK |
| T6 | T26 | `HealthResponse` | OK |
| T6 | T27 | `createLogger` réexporté par testing | OK |
| T6 | T28 | `ApiErrorCode` (33) → `ERROR_MESSAGES` exhaustif | OK |
| T6 | T35 | `security-headers.ts` (ne remplace pas une CSP posée) ; `mountWebApp` en dernier dans `routes.ts` | OK |
| T6 | T37 | `HealthResponse` (kill switch) | OK |
| T6 | T40 | `createTestContext({ dbPath })`, `loadConfig` | OK |
| T6 | T41 | `/api/health` (bundle, contrat d'image) | OK |
| T6 | T43 | `HealthResponse.version` (wait_health) | OK |
| T6 | T44 | `loadConfig` exige `APP_ORIGIN` ; `db:stats` lancé par `docker run` sans env_file | **C3** |
| T7 | T11 | `COMMANDS`, `withAppDeps`, `parseFlags` (admin:bootstrap) | OK |
| T7 | T12 | `cli.ts` (admin:reset) | OK |
| T7 | T13 | `jobs/registry.ts` (+authPurgeJob) | OK |
| T7 | T22 | `jobs/registry.ts` (+syncPurgeJob) | OK |
| T7 | T23 | `startup.ts` (+CATALOG_STARTUP_TASK) | OK |
| T7 | T24 | `cli.ts` (privacy:collect sans garde, privacy:reapply) | OK |
| T7 | T38 | `init` puis `node --import tsx src/main.ts` | OK |
| T7 | T40 | `cli.ts` (snapshot, restore), `assertStartupPreconditions` | OK |
| T7 | T41 | point d'entrée `import.meta.url` valable dans le bundle | OK |
| T7 | T43 | `cli.ts` (sessions:active) | OK |
| T7 | T44 | `cli.ts` (db:stats, sans withAppDeps) | OK (voir C3) |
| T8 | T9 | `hashSecret`, `SESSION_*` | OK |
| T8 | T10 | `hashPassword(pw, params, ids)` ; le support `createUser` l'appelle sans `ids` | **C4** |
| T8 | T10 | `api/auth.ts` (+ONBOARDING_STEPS … UpdateMeRequest) | OK |
| T8 | T11 | `api/auth.ts` (+Code/Invitation), `createSecretCode`, `parseSecretCode` | OK |
| T8 | T12 | `api/auth.ts` (+Reset*), `validatePassword` | OK |
| T8 | T13 | `api/auth.ts` (+DeleteAccountRequest), constantes de conservation | OK |
| T8 | T19 | `CODE_CHECKS_PER_HOUR` | OK |
| T8 | T20 | `INVITATION_NOTE_MAX` (enum-consistency) | OK |
| T8 | T30 | `parseSecretCode`, `validateUsername`, `validatePassword`, `PasswordRejection` | OK |
| T9 | T10 | sessions, cookies, `requireUser`, `logSecurityEvent` | OK |
| T9 | T11 | `createSession`, `logSecurityEvent` | OK |
| T9 | T12 | `revokeSessions(…,'admin')`, `requireAdmin` | OK |
| T9 | T13 | `clearSessionCookie`, `requireUser/Admin`, session `account_deleted` → 410 | OK |
| T9 | T16 | `requireUser` route par route | OK |
| T9 | T17 | `requireUser`, `requireAdmin`, `gym_deleted` | OK |
| T9 | T19 | `requireUser`, `consent_revoked { replay }` | OK |
| T9 | T20 | `requireUser` | OK |
| T9 | T23 | `requireUser` (catalogue) | OK |
| T10 | T11 | `authLimiters`, `buildMe`, `createUser(AndLogin)` | OK |
| T10 | T12 | `auth/routes.ts` (+reset), `verifyUserPassword`, `storeNewPassword`, `getConsentState` | OK |
| T10 | T13 | `me-routes.ts` (+export, delete), `verifyUserPassword` | OK |
| T10 | T15 | `ONBOARDING_STEPS`, `OnboardingStep` | OK |
| T10 | T16 | `/api/me` partagé : T16 interdit `use('*')`, T10 ne le précise pas | OK (note : même règle pour `meRoutes`) |
| T10 | T19 | `ConsentType`, `isHealthConsentActive`, `createIpLimiter`, `verifyUserPassword` | OK |
| T10 | T20 | `isHealthConsentActive`, `createUserAndLogin` | OK |
| T10 | T24 | `isHealthConsentActive` | OK |
| T10 | T25 | `MeResponse` dans `MetaValues.me` | OK |
| T10 | T29 | `UpdateMeRequest` strict, `ConsentState.aiCoach` | OK |
| T10 | T40 | `createUserAndLogin`, `isHealthConsentActive` | OK |
| T11 | T12 | `api/admin.ts` (+Member…), `acceptInvitation` (test CLI) | OK |
| T11 | T13 | `api/admin.ts` (+AdminDeleteMemberRequest) | OK |
| T11 | T30 | `InvitationCheckResponse.role` (minimum 12/14) | OK |
| T11 | T33 | `InvitationSummary`, `CreateInvitation*` | OK |
| T11 | T38 | sortie de `admin:bootstrap` en 3 lignes → `bootstrapAdmin` | OK |
| T12 | T13 | `admin/routes.ts` (+delete), `assertNotLastAdmin` | OK |
| T12 | T17 | `admin/routes.ts` (+DELETE /gyms/:id) | OK |
| T12 | T29 | `MemberSummary`, `ResetLinkResponse`, `OpsStatusResponse` | OK |
| T12 | T33 | `OpsStatus`, `MemberSummary.consents.aiCoach` | OK |
| T12 | T43 | `OpsStatus.deploy` écrit par `status_merge` | OK |
| T12 | T44 | `OpsStatus.backup/restoreTest/host` | OK |
| T13 | T18 | `admin-isolation.test.ts` : `MIN_ID_ROUTES` 0 → 4 | OK (D1) |
| T13 | T19 | `admin-isolation.test.ts` : `MIN_ID_ROUTES` 4 → 6 | OK |
| T13 | T24 | `deleteAccount(trx, …, { enforceLastAdmin: false })` | OK |
| T13 | T29 | `ExportV1`, `AdminDeleteMemberRequest` | OK |
| T13 | T33 | suppression admin avec mot de passe (401 invalid_credentials) | OK |
| T14 | T16 | `SportCodeSchema`, `SPORT_OTHER_LABEL_MAX`, `defaultLoadSettings` | OK |
| T14 | T17 | `normalize`, `EquipmentCodeSchema`, `LoadSettings`, `defaultLoadSettings` | OK |
| T14 | T18 | `defaultLoadSettings('home')`, matériel household admis | OK |
| T14 | T19 | `HEALTH_CONSENT_TEXT`, `HEALTH_QUESTIONNAIRE` | OK |
| T14 | T20 | `SPORT_OTHER_LABEL_MAX` | OK |
| T14 | T21 | `HEALTH_CONSENT_TEXT` | OK |
| T14 | T29 | `majorOf`, `LoadSettings`, `EquipmentCode` | OK |
| T14 | T31 | libellés, préréglages, `EQUIPMENT_CATEGORY_LABELS` | OK |
| T14 | T32 | `EQUIPMENT_LABELS`, `EQUIPMENT_PRESETS` | OK |
| T15 | T16 | `api/profile.ts` (+DAYS/SESSION/Patch), `availableGoals`, `firstIncompleteStep` | OK |
| T15 | T20 | `GOALS`, `EXPERIENCES` | OK |
| T15 | T29 | entrée de `firstIncompleteStep` (`onboardingInput`) | OK |
| T15 | T31 | `firstIncompleteStep`, `GOAL_LABELS`, `EXPERIENCE_LABELS` | OK |
| T16 | T18 | `completeOnboarding` | OK |
| T16 | T20 | `SESSION_MINUTES`, `DAYS_PER_WEEK` | OK |
| T16 | T29 | `TrainingProfilePatch` | OK |
| T17 | T18 | `api/places.ts` (+lieux), `insertGymPlace`, `demotePrimaries` | OK |
| T17 | T20 | `GymHistoryAction` | OK |
| T17 | T29 | `GymSummary`, `GymDetail`, `CreateGym*` | OK |
| T17 | T32 | `GymDetail.history` (10 lignes) | OK |
| T17 | T33 | `PATCH /api/gyms/:id`, `DELETE /api/admin/gyms/:id` | OK |
| T18 | T29 | `CreatePlaceRequest`, `UpdatePlaceRequest`, `DeletePlaceRequest` | OK |
| T19 | T20 | `grantConsent` (test) ; constantes de limitation ; tables t19_* doublant fixture_* | OK (D5) |
| T19 | T21 | `grantConsent` | OK |
| T19 | T24 | `withdrawHealthConsent` | OK |
| T19 | T26 | `POST …/replay-withdraw` (`ReplayWithdrawRequest`, 409 accepté) | OK |
| T19 | T27 | `grantConsent` réexporté | OK |
| T19 | T29 | `LimitationInput/Patch`, Grant/Withdraw | OK |
| T19 | T31 | libellés zone/côté/gravité | OK |
| T20 | T21 | `sync.ts` (+COLUMN_CODECS), `sync/routes.ts` (garde + pull), `sync-fixtures.ts` (+syncPull) | OK |
| T20 | T22 | `push.ts` (+restore_upsert, `deletedAt`) | OK |
| T20 | T24 | `sync-fixtures.ts` (+snapshotDb, restoreInPlace), `syncPush`, `makeOp`, `dumpDatabase` | OK |
| T20 | T25 | `SyncOp`, `SYNC_FIXTURE_RULES` (champs C2 retirés à l'identique côté client) | OK |
| T20 | T26 | `PushResponse`, `PulledRow`, constantes | OK |
| T20 | T27 | `createSyncTestContext` et support | OK |
| T20 | T40 | `dumpDatabase` | OK |
| T21 | T26 | `PullResponse`, `hasMore`, 410 `watermark_expired` | OK |
| T21 | T29 | miroirs déjà décodés (aucune conversion 0/1) | OK |
| T22 | T24 | `rotateServerEpoch` dans `restoreInPlace` | OK |
| T22 | T26 | époque/en-tête, `restore_upsert` | OK |
| T22 | T27 | époque bout en bout | OK |
| T22 | T40 | `rotateServerEpoch` dans `restoreSnapshot` | OK |
| T23 | T26 | `GET /api/catalog`, ETag `"<version>"` | OK |
| T23 | T29 | `IllustrationRef` | OK |
| T23 | T35 | `ILLUSTRATION_FILE_RE` | OK |
| T23 | T41 | `data/` copié en `/app/data` | OK |
| T24 | T40 | `collectPrivacyEvents`, `reapplyPrivacyEvents` | OK |
| T24 | T43 | formes CLI `privacy:collect --since --out` (sans `--source`) et `privacy:reapply` | OK |
| T25 | T26 | `AppDb`, outbox, `wipeUserData`, `clearMirrors`, `purgeHealthData` | OK |
| T25 | T28 | `createAppDb`, meta, `createTestLocalDb` | OK |
| T25 | T29 | `meta.ts` (+lastAgeBand) | OK |
| T25 | T34 | `dumpLocalDb` | OK |
| T25 | T35 | `LOCAL_DB_VERSION` lu par regex dans `db.ts` | OK |
| T25 | T37 | `LOCAL_DB_VERSION` (SW en attente) | OK |
| T25 | T38 | `OutboxOp`, `idbVersion = LOCAL_DB_VERSION * 10` | OK |
| T25 | T39 | `LOCAL_DB_VERSION` | OK |
| T26 | T27 | moteur, `applyPulledRows` | OK |
| T26 | T28 | `createSyncEngine`, transport, `SyncState` | OK |
| T26 | T29 | `sw/protocol.ts` (+SwStatus), `sw-client.ts` (+getSwStatus), `refreshCatalog` | OK |
| T26 | T36 | `PageToSw` | OK |
| T26 | T37 | `SyncEngine`, `PageToSw` | OK |
| T26 | T40 | renvoi `replay-withdraw` attendu absent | OK |
| T28 | T29 | `app-services.tsx`, `main.tsx`, `render.tsx`, `App.tsx`, `HomePage.tsx` modifiés | OK (doc : render.tsx, HomePage, App.tsx mod. T29 absents de la File Structure) |
| T28 | T30 | `App.tsx` (+/login,/invite,/reset), ui | OK |
| T28 | T31 | `App.tsx` (+/onboarding) | OK |
| T28 | T32 | `App.tsx` (+/profile…, /gyms/:id) | OK |
| T28 | T33 | `App.tsx` (+/admin/*), `formatAge` | OK |
| T28 | T34 | `App.tsx`, `ui/AppShell.tsx`, `ui/index.ts` (+download, zone d'état) | OK |
| T28 | T35 | `index.html`, `vite.config.ts` | OK |
| T28 | T37 | `ui/AppShell.tsx` (+UpdateBanner), `main.tsx` | OK |
| T28 | T38 | `bootApp`, `VITE_OWNER_FIRST_NAME` | OK |
| T29 | T30 | `MeRepo`, `seedOutbox` | OK |
| T29 | T31 | `useRepos`, `useReadiness`, `seedMirror` | OK |
| T29 | T32 | `useRepos`, `seedMirror` | OK |
| T29 | T33 | `AdminRepo.deleteMember(id, confirmUsername, password)` | OK |
| T29 | T34 | `RejectionsRepo`, `StatusRepo`, `seedOutbox` | OK |
| T29 | T36 | `SwStatus.localDbVersion` | OK |
| T29 | T37 | `StatusRepo.activeSessionId/illustrationFiles/requestPersistentStorage` | OK |
| T29 | T38 | `persistGranted` | OK |
| T30 | T32 | `LogoutDialog`, `PasswordFields`, `checkNewPassword`, `USERNAME_MESSAGES` | OK |
| T30 | T37 | `CreateAccountForm.tsx` modifié ; `isStandalone` | OK (doc : mod. T37 absent de la File Structure) |
| T30 | T38 | libellés exacts du compte et de la connexion | OK |
| T31 | T32 | étapes en mode edit, `GymPicker`, `EquipmentChecklist`, `CautiousModeToggle` | OK |
| T31 | T34 | `HealthConsentPanel`, `ScreeningQuestions`, `LimitationsEditor`, `CautiousModeToggle` | OK |
| T31 | T37 | `ONBOARDING_COMPLETED_EVENT` | OK |
| T31 | T38 | libellés de l'onboarding | OK |
| T32 | T38 | « Enregistrer le pseudo », /profile | OK |
| T34 | T38 | `connection-status` | OK |
| T34 | T39 | `connection-status`, `pending-counter`, `rejected-counter` | OK |
| T35 | T36 | `sw.ts` amorce → SW complet ; constantes de cache | OK |
| T35 | T37 | `SHELL_CACHE_PREFIX`, `ILLUSTRATIONS_CACHE` | OK |
| T35 | T38 | build avec `precachePlugin`, `mountWebApp` | OK |
| T35 | T39 | `precachePlugin` (builds A/B) | OK |
| T35 | T41 | `apps/web/dist` → `/app/public` | OK |
| T36 | T37 | `createFakeCacheStorage`, messages SKIP_WAITING/GET_STATUS | OK |
| T36 | T38 | SW réel | OK |
| T36 | T39 | coquille servie depuis le cache d'abord | OK |
| T37 | T38 | `bootServiceWorker`, `installPersistOnOnboarding` | OK |
| T37 | T39 | `UpdateBanner` (« Mettre à jour », « Plus tard »), interrupteur côté page | OK |
| T38 | T39 | `global-setup.ts` (+buildTwice), fixtures, `setFault`, `restart` | OK |
| T38 | T40 | `startE2EServer`, `cli`, `stop`, `restart`, `bootstrapAdmin` | OK |
| T40 | T43 | CLI `snapshot --tag pre-vX`, `restore /data/snapshots/pre-vX.db` | OK |
| T40 | T44 | `snapshot --tag daily` (rétention incluse) | OK |
| T41 | T42 | `infra/Dockerfile`, `ARG VERSION`, `ARG VITE_OWNER_FIRST_NAME` | OK |
| T41 | T43 | `infra/compose.yaml` (`--env-file deploy.env`) | OK |
| T41 | T45 | fichiers `infra/` cités | OK |
| T43 | T44 | `common.sh`, `helpers.bash`, `stub.sh` ; `defaults.bash` modifié | OK (doc : mod. T44 absent de la File Structure) |
| T43 | T45 | scripts `appsport-unlock/update` cités | OK |
| T44 | T45 | scripts `appsport-backup/restore-test/alive/check` cités | OK |
| T45 | (dépôt) | le test de non-régression sur l'ancien numéro TCA parcourt le disque ; `.superpowers/` n'est ni exclu ni ignoré par git | **C5** |
| T45 | (spec 01 §9.3) | « les 6 contrôles » de R-TST-4 alors que la spec en compte 7 | **C2** |

## 2. Contrôle tâche par tâche

| Tâche | Tests prévus cohérents avec le code prévu ? | Fichiers créés cohérents avec les modifications ultérieures ? | Constat |
|---|---|---|---|
| T1 | oui (3 fichiers) ; le package.json web doit déjà porter `@appsport/server` en dev | modifiés plus tard par T25/T27/T28/T35/T38/T41/T43, tous déclarés sauf vitest.config (T28) | OK (doc) |
| T2 | oui (domain 4, contracts 1) | constants.ts complété ici | OK |
| T3 | oui | schema.ts → T4a, T4b, T5 | OK (doc : T4a) |
| T4a | rev.test enchaîne `nextRev` 1→4 puis attend `writeStamp` rev 1 | tests repris par T4b comme prévu | **D3** |
| T4b | oui (5 fichiers) | schema-v1.sql figé | OK |
| T5 | oui ; les ids `seqIds(999)` sont ambigus sur plusieurs appels | factories étendues par personne | OK (D9) |
| T6 | oui (server 8, contracts 1) | deps.ts T20, app.ts T9, routes.ts T10–T35, security-headers T35 | OK |
| T7 | oui (3) | cli.ts, startup.ts, registry.ts modifiés comme déclaré | OK |
| T8 | oui (1/3/3) ; T6 refait l'assertion `config.argon2` | api/auth.ts modifié par T10 à T13 | OK (D6) |
| T9 | oui (2) | app.ts | OK |
| T10 | `createUser` appelle `hashPassword` sans `ids` | routes.ts T12, me-routes.ts T13 | **C4** |
| T11 | oui (3) | cli.ts, admin.ts | OK |
| T12 | oui (3) | admin/routes.ts T13, T17 | OK |
| T13 | `MIN_ID_ROUTES = 0` → `toBeGreaterThanOrEqual(0)` ne vérifie rien à T13 | test modifié par T18 et T19 (déclaré) | **D1** |
| T14 | oui (3+1) | — | OK |
| T15 | oui (240 cas, oracle conforme à l'ordre de l'algorithme) | profile.ts → T16 | OK |
| T16 | oui (2) | support onboarding : `isPrimary: 1` à passer | OK |
| T17 | oui (1) | admin/routes.ts | OK |
| T18 | oui (3) | admin-isolation (déclaré) | OK |
| T19 | oui (3) ; tables t19_* doublées par fixture_* en T20 | admin-isolation (déclaré) | OK (D5) |
| T20 | enum-consistency impossible à faire passer : 5 colonnes `IN` et 3 bornes sans constante | sync.ts, routes, sync-fixtures → T21, T22, T24 | **C1** |
| T21 | oui (6 fichiers sync) ; pull-leak sur contexte socle seulement | — | OK (D10) |
| T22 | epoch.test : `epochStartedAt` égal à celui d'`init` (horloge non avancée) | push.ts, registry | **D2** |
| T23 | oui (1+2) | startup.ts | OK |
| T24 | oui (2) | sync-fixtures, cli | OK |
| T25 | oui (5) | meta.ts → T29 ; package.json ajout sans effet | OK |
| T26 | oui (8 fichiers web sync) | sw/protocol, sw-client → T29 | OK |
| T27 | oui (2) | index du support serveur | OK |
| T28 | oui | modifié par T29–T37 ; mod. non déclarées : render.tsx, HomePage, App.tsx (T29) | OK (doc) |
| T29 | oui | — | OK |
| T30 | oui | CreateAccountForm → T37 (non déclaré dans la File Structure) | OK (doc) |
| T31 | oui | — | OK |
| T32 | oui | — | OK |
| T33 | oui | — | OK |
| T34 | oui | AppShell → T37 | OK |
| T35 | oui (2+1) | sw.ts → T36 | OK |
| T36 | oui (2) | — | OK |
| T37 | oui (5) | — | OK |
| T38 | oui (4 en CI ; 2+2 skipped sous Windows) | global-setup → T39 | OK |
| T39 | oui (10 = 5 specs × 2) | — | OK |
| T40 | oui (4 + E2E 2) | — | OK |
| T41 | oui (2 + contrat d'image en CI) | — | OK |
| T42 | modif. de `ci.yml` déjà faite par T1 : test vert avant le code | — | D7 |
| T43 | oui (3 vitest, 24 bats) | defaults.bash → T44 (non déclaré dans la File Structure) | OK (doc) |
| T44 | docker est simulé dans bats : le bug `db:stats` sans `APP_ORIGIN` passe les tests | — | **C3** |
| T45 | RTST4 = « 6 contrôles » contre 7 dans la spec ; l'analyse inclut `.superpowers/` | — | **C2, C5** |

## 3. Défauts imposés par le plan

- **D1 (T13)** : `MIN_ID_ROUTES = 0` rend `expect(owned.length).toBeGreaterThanOrEqual(MIN_ID_ROUTES)` vide à T13 (aucune route `/api/(me|places)/…:id` n'existe encore). C'est un cran assumé, relevé par T18 puis T19.
- **D2 (T22)** : epoch.test attend `epochStartedAt: '2026-10-06T10:00:00.000Z'`, la valeur déjà posée par `initServerMeta` avec la même FakeClock. Un `rotateServerEpoch` qui n'écrirait pas `epoch_started_at` passerait quand même.
- **D3 (T4a)** : rev.test enchaîne `nextRev` → [1,2,3], un rollback puis 4, et attend ensuite `writeStamp(...).rev === 1`. Le test ne peut pas passer sur la même base.
- **D4 = C1 (T20)** : enum-consistency échoue par construction (« colonne absente de la correspondance → échec »). Il manque des constantes pour :
  - `session.revoked_reason`, `consent_event.type`, `consent_event.action`, `security_event.outcome`, `place.kind` ;
  - les bornes `gym.name` (2–60), `gym.city` (2–60) et `place.name` (≤ 30).
- **D5 (T19/T20)** : le DDL et les règles de test sont dupliqués (t19_note/t19_c2_log contre fixture_note_item/fixture_c2_log, même `c2Columns`/`c2Values`).
- **D6 (T8)** : password-hash.test refait `loadConfig(...).argon2 === ARGON2_PARAMS`, déjà vérifié par config.test en T6.
- **D7 (T42, T25, T28)** : ces modifications sont déjà faites par T1, donc le test de T42 (« ci.yml tourne sur main ») ne passe pas au rouge avant le code. Les ajouts de dépendances web de T25 et T28 sont redondants.
- **D8 = C2 (T45)** : le texte imposé pour R-TST-4 contredit la spec (6 contrôles contre 7).
- **D9 (T5)** : « ids de `seqIds(999)` ». Si le générateur est recréé à chaque appel de `insertFixtureRow`, deux appels sur la même base produisent des clés primaires en double (T13 delete, T21 pull-leak).
- **D10 (T21)** : pull-leak exige `entity ∈ mirroredTables()` avec le registre par défaut. Le test casse s'il tourne sur `createSyncTestContext`, qui ajoute les tables fixture_*.
- **Ordre** : aucune tâche ne consomme une interface avant la tâche qui la produit (vérifié sur les 46 blocs Consumes).

## 4. Décisions proposées

- **C1** — Décision : T20 crée dans contracts les constantes manquantes, dans le module de chaque domaine : `SESSION_REVOKED_REASONS` (auth-constants), `CONSENT_TYPES` et `CONSENT_ACTIONS` (api/auth), `SECURITY_EVENT_OUTCOMES` (auth-constants), `PLACE_KINDS`, `GYM_NAME_MIN/MAX`, `GYM_CITY_MIN/MAX` et `PLACE_NAME_MAX` (api/places). T20 les branche sur les schémas Zod et sur les unions TS existantes (`revokeSessions`, `SecurityEventInput.outcome`), puis les ajoute à la correspondance ; aucune liste d'exemptions. — Pourquoi : 01 §9.1.4 (« cohérence entre Zod, les types Kysely et Dexie ») et la règle du plan « colonne absente → échec ». — Coût si c'est faux : T20 reste rouge, ou l'implémenteur ajoute une exemption ad hoc qui masque une dérive future.
- **C2** — Décision : RTST4 = les **7** contrôles de 01 §9.3 R-TST-4, mot pour mot, le 7e compris. L'assertion séparée « moins de 2 minutes hors écran Santé » est retirée, ou réécrite dans la formulation de la spec (« moins de 2 min, hors écran Santé »). « Sans objet au socle » reste admis pour 2, 4 et 5. — Pourquoi : la spec fait foi, et R-TST-4 est le critère de sortie de toute version. — Coût si c'est faux : la fiche de recette omet ou reformule un critère de sortie, et le test de T45 fige ce mauvais texte.
- **C3** — Décision : `db:stats` (et de préférence `privacy:collect`) trouve la base par `APPSPORT_DATA_DIR` (défaut `/data`), sans `loadConfig`, donc sans `APP_ORIGIN`. On ajoute à db-stats.test un cas CLI avec un env sans `APP_ORIGIN`. À défaut, `appsport-restore-test` passe `-e APP_ORIGIN=https://restore-test.invalid` au `docker run … db:stats`. — Pourquoi : 08 R-OPS-11 étapes 2 et 4 (intégrité et retard mesurés sur la copie restaurée, dans un conteneur sans réseau). Un `docker run` nu ne lit pas `secrets/app.env`. — Coût si c'est faux : le test de restauration mensuel échoue sur l'hôte alors que les tests bats (docker simulé) restent verts.
- **C4** — Décision : le support `createUser` appelle `hashPassword(password, ctx.deps.config.argon2, ctx.deps.ids)`. — Pourquoi : signature contractuelle de l'Interface partagée §3 (`hashPassword(pw, params, ids)`). — Coût si c'est faux : `pnpm typecheck` rouge à T10, ou une signature modifiée en douce.
- **C5** — Décision : ajouter `.superpowers` (dossier de pilotage SDD, non ignoré par git) aux exclusions du test de T45 sur l'ancien numéro TCA. Ne jamais recopier ce numéro dans les artefacts SDD. — Pourquoi : la non-régression de 07 §5.11 vise le code et les docs livrés, pas les notes d'orchestration. — Coût si c'est faux : `infra/docs.test` casse à cause d'un rapport de relecture qui cite le numéro.
- **D2** — Décision : dans epoch.test, `ctx.clock.advance(3_600_000)` avant `rotateServerEpoch`, puis attendre `epochStartedAt: '2026-10-06T11:00:00.000Z'`. — Pourquoi : R-SYN-25 (`epoch_started_at` = heure de la restauration), sur laquelle repose la fenêtre de R-SYN-28. — Coût si c'est faux : un oubli d'écriture passe inaperçu et rouvre la fenêtre de renvoi du retrait.
- **D3** — Décision : l'assertion `writeStamp` va dans son propre `it`, sur une base neuve (rev 1), ou attend 5 sur la même base. — Pourquoi : le test doit pouvoir passer avec les fichiers listés. — Coût si c'est faux : T4a reste rouge ou l'implémenteur réécrit le test.
- **D1** — Décision : garder le cran, mais à T13 écrire `expect(owned).toEqual([])` (la vacuité devient explicite). T18 et T19 remplacent par `≥ 4` puis `≥ 6`, comme prévu. — Pourquoi : P-ADM-2 est couvert dès que les routes existent. — Coût si c'est faux : nul ; un relecteur signalerait seulement un test vide.
- **D9** — Décision : `insertFixtureRow` garde un seul générateur `seqIds(999)` par base (WeakMap sur `db`). — Pourquoi : Interfaces §2 (fabriques déterministes) et usage répété en T13 et T21. — Coût si c'est faux : collisions de clés primaires dans les tests qui plantent beaucoup de lignes.
- **D10** — Décision : pull-leak tourne sur `createTestContext` (registre du socle) ; les tables fixture_* restent couvertes par push et pull en T20, T21 et T27. — Pourquoi : 01 §5.5 R-SYN-21 (fuite vérifiée sur les tables du socle). — Coût si c'est faux : faux échec sur `entity ∈ mirroredTables()`.
- **D5, D6, D7** — Décision : on accepte en l'état (doublons de test limités, aucune logique de production dupliquée). On traite la modification de `ci.yml` en T42 comme une vérification. — Pourquoi : TDD respecté sur le code de production. — Coût si c'est faux : faible, quelques remarques de revue.
- **Doc** — Décision : compléter la File Structure : schema.ts mod. T4a ; render.tsx, HomePage.tsx et App.tsx mod. T29 ; CreateAccountForm.tsx mod. T37 ; defaults.bash mod. T44 ; vitest.config.ts mod. T28. Préciser aussi que `meRoutes` (T10) suit la règle « jamais `use('*')` » de T16. — Pourquoi : chaque fichier doit avoir sa tâche propriétaire et ses modifications déclarées (en-tête File Structure). — Coût si c'est faux : un relecteur signale une modification hors propriétaire.
