# Brique 4 · Coach IA — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le coach IA de Rune : une conversation du jour en flux, ancrée dans un dossier figé et quatre outils, filtrée phrase par phrase par le code, qui propose des changements de programme validés, avec les garde-fous des 16-17 ans, l'accord `ai_coach`, l'administration, le jeu d'évaluation, et la dette retenue de la brique 3.

**Architecture:** Le métier pur vit dans `packages/domain/src/coach/` (configuration, garde d'accès, historique envoyé, découpe et filtre, dossier) et `packages/domain/src/program/preview.ts` (aperçu des charges), appelés par le serveur et, pour l'aperçu et le filtre des textes, par le téléphone. Le serveur porte `AiClient.chat()` (flux, outils stricts, replis), les 6 tables de classe H de `0007_coach`, l'échange en deux étages (tentative, puis échange atomique), les routes `/api/coach/*` en SSE et l'administration ; tout se construit et se teste sur le faux client scripté. Le téléphone ne garde rien du coach hors de la mémoire : dépôt en ligne, lecteur SSE, magasin en mémoire, écrans chargés à la demande.

**Tech Stack:** TypeScript, Zod 4 (`z.toJSONSchema`), `@anthropic-ai/sdk` 0.135.0, fast-check, Hono, Kysely/node:sqlite, React 19, wouter, CSS Modules, Vitest + Testing Library + happy-dom, Playwright (Chromium, WebKit).

**Spec:** `docs/superpowers/specs/2026-11-03-brique-4-coach-ia-design.md` (fait autorité, choix C1 à C49), qui s'appuie sur `docs/superpowers/specs/2026-10-06-appsport-design/06-coach.md` et sur les chapitres 01, 03, 08 et 09. Lire la spec de la brique 4 et 06 en entier avant toute tâche ; en cas d'écart, la spec de la brique 4 l'emporte là où son §3.1 le déclare.

**Point de départ :** branche locale `brique-4` (6ae53cf, spec comprise). Jamais de `git push`.

**Prérequis du propriétaire (spec §2.1) :** la tâche 13 attend la clé `rune-dev` dans `.env.local` ; la tâche 32 attend l'accord sur la dépense (environ 20 $), la publication du lot A et la relecture du §24 et des prompts. Aucune autre tâche ne les attend.

## Global Constraints

- Branche `brique-4`, un ou plusieurs commits par tâche, messages en français au format du dépôt (`feat(server): …`), terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` verts à la fin de chaque tâche ; `pnpm --filter @rune/web test:e2e` (Chromium et WebKit) vert pour toute tâche qui touche un parcours E2E. Test ciblé : `npx vitest run --project <contracts|domain|scripts|server|web> <fichier>` (chemin relatif au paquet).
- Contraintes des briques 1 à 3 toujours valables : CSP `default-src 'self'`, format d'erreur API, 404 pour les ressources d'un autre (admin compris), jamais de C1–C3 dans `/api/admin/*` hors des routes des signalements (P-ADM-1), tables STRICT avec CHECK, migrations transactionnelles non cassantes, `entityRules` couvre chaque colonne, `packages/domain` pur (ni `Date.now()`, ni `new Date()`, ni `Math.random()`, ni `node:`), aucun accès Dexie hors de `repos/` et `sync/`.
- Rien du coach sur l'appareil : ni Dexie, ni `localStorage`, ni `sessionStorage` ; fil du jour et saisie en mémoire seulement (C17). `SYNC_PROTOCOL` et la version de Dexie ne changent pas. Les 6 tables du coach sont de classe H, `clientWritable` vide.
- `COACH_CONFIG` (spec §5.2), valeurs à reprendre telles quelles : `defaultModel` `claude-opus-5-5` ; `allowedModels` `claude-opus-5-5`, `claude-sonnet-5-5` ; `evaluated` vide à la livraison ; `effort` `low` ; `maxTokens` 16 000 ; `limits` : `messagesPerDay` 30, `messageChars` 2 000, `personMonthlyBudgetUsd` 3, `maxToolRounds` 4, `maxPatchCorrections` 2, `maxProposalsPerMessage` 1, `reasonChars` 300, `reportCommentChars` 500, `readTrainingMaxDays` 28, `searchLimit` 10, `briefTargetTokens` 3 000, `briefMaxTokens` 4 500, `readTrainingMaxTokens` 4 000, `exchangeTimeoutMs` 180 000, `callTimeoutMs` 120 000 ; `promptVersion` `coach-1` (stockée `coach-1/adult` ou `coach-1/minor`) ; `toolsVersion` `tools-1` ; `briefSchema` `coach-brief/1` ; `retention` : `threadDays` 90, `usageLogMonths` 12, `reportDays` 90 ; `workspaceMonthlyLimitUsd` 20.
- Appel à l'API (spec §5.3) : bêta `thinking-binding-controls-2026-08-01` toujours ; bêta `server-side-fallback-2026-07-01` et `fallbacks: "default"` pour un fil `adult` seulement ; `thinking: {type: "adaptive", block_binding: {prefix_mismatch_behavior}}` sans `display` ; `drop_block` en production, `error` dans les tests et l'évaluation ; jamais `tool_choice`, `metadata`, `inference_geo`, `temperature`, `eager_input_streaming` ; `cache_control` éphémère (5 min) ; 2 nouvelles tentatives du SDK.
- Dates : jour et mois de Paris (`parisDate`) pour les fils, la limite du jour, le budget du mois ; suspension jusqu'au 1er du mois suivant, minuit à Paris.
- Flux : SSE, `event: <type>` puis `data: <JSON>`, commentaire `: ping` toutes les 15 s ; 30 s sans octet ferment la lecture du téléphone ; `flushBefore(4000)` avant d'ouvrir `/coach` et avant le premier message du jour.
- Numéros admis par le filtre : `15`, `112`, `3114`, `0969325900`, `0800152000` (tirés de `HELP_RESOURCES`).
- Journaux : jamais de prompt, de réponse, de dossier, de texte d'outil, de note ni d'identifiant de personne dans le journal technique (P-LOG-2) ; journal de sécurité sans contenu.
- Textes : français, tutoiement, apostrophe droite `'`, guillemets « » ; bulles du coach en texte brut (retours à la ligne, listes « - »), sans Markdown ni lien (C29) ; chaque texte du coach produit par l'appli passe `outputFilter` et `FORBIDDEN_TERMS` dans un test. Toute modification d'un prompt crée une nouvelle `prompt_version`.
- Accessibilité : cibles ≥ 48 × 48 px (envoyer, signaler, accepter, refuser, appeler) ; contrastes ≥ 4,5:1 dans les 5 thèmes ; `prefers-reduced-motion` : phrases et cartes sans animation ; le fil a `role="log"`.
- Le faux client IA n'entre jamais dans `server.mjs` ni dans une variable du serveur de production : seul un point d'entrée de test l'injecte.
- Nouvelle dépendance : aucune (lecteur SSE écrit à la main). Si une tâche en a besoin : version exacte publiée depuis au moins deux semaines.

## Review Focus

1. **Quitter `/coach` pendant une réponse** (carte de proposition vers Mon programme, retour à l'accueil) : la réponse continue dans le magasin en mémoire ; revenir montre la bulle où elle en est ou la réponse finie, sans second envoi ni texte perdu. Test dans la tâche 24.
2. **Échange à cheval sur minuit de Paris** (message à 23 h 59, fin à 0 h 00) : l'échange s'enregistre dans le fil où il a commencé et compte pour ce jour (`coach_call.day`) ; le message suivant ouvre le fil du nouveau jour ; une dépense du 1er à 0 h 30 de Paris (31 à 23 h 30 UTC) compte dans le nouveau mois. Tests dans les tâches 15 et 21.
3. **Saisie avec émojis, accents composés ou `\r\n`** près de 2 000 caractères : le compteur du téléphone et le serveur comptent la même longueur (points de code, après le même nettoyage) ; un texte que le compteur accepte n'est jamais refusé en 400. Tests dans les tâches 5, 22 et 25.
4. **Membre sans programme, sans lieu ou sans séance** (juste après l'onboarding) : le dossier passe son schéma avec `program: null` et un historique vide, `read_training` rend des listes vides, `search_exercises` sans lieu rend les fiches publiées, une proposition rend `no_active_program`. Tests dans les tâches 9, 17 et 18.
5. **Réponse finale vide** (`end_turn` sans texte, après des outils ou une réflexion) : aucune bulle vide enregistrée ; `error` `internal`, échange non enregistré, texte rendu au champ, `coach_call.counted = 1` (C12). Tests dans les tâches 20 et 21.

---

## Structure des fichiers

- `packages/contracts/src/` : `coach.ts` (schémas, vues, événements, entrées d'outils, `CoachOperationSchema`), `forbidden-terms.ts`, `texts.ts`, `help-resources.ts`, `program.ts` (`COACH_PROPOSAL`, `OPERATION_AUTHORS`), `api/{consent,errors,program,admin}.ts`, `entity-rules.ts`.
- `packages/domain/src/coach/` : `config.ts`, `guard.ts`, `history.ts`, `sentences.ts`, `values.ts`, `filter.ts`, `brief.ts`, `index.ts` ; `packages/domain/src/program/preview.ts`.
- `apps/server/src/ai/chat.ts` (et `client.ts`, `fake.ts`) ; `apps/server/src/db/migrations/0007_coach.ts` ; `apps/server/src/coach/` : `state.ts`, `registry.ts`, `threads.ts`, `brief-input.ts`, `views.ts`, `consent.ts`, `tools/{types,index,read-training,search-exercises,propose-program-change,refer-to-help}.ts`, `proposals.ts`, `prompts/{coach-1-adult,coach-1-minor,style-ombre,style-skald,style-scribe,index}.ts`, `attempt.ts`, `orchestrator.ts`, `record.ts`, `sse.ts`, `routes.ts`, `reports.ts`, `admin-routes.ts`, `purge.ts`.
- `apps/web/src/repos/{coach-repo,sse-reader}.ts` ; `apps/web/src/features/coach/` : `coach-store.ts`, `coach-texts.ts`, `CoachPage.tsx`, `ChatBubble.tsx`, `Composer.tsx`, `HelpCard.tsx`, `ReportSheet.tsx`, `ConsentPage.tsx`, `DeactivateSheet.tsx`, `ThreadsPage.tsx`, `ThreadPage.tsx`, `BriefPage.tsx`, `coach-page.module.css` ; `features/public/CoachHelpPage.tsx` ; `features/admin/AdminCoachPage.tsx` ; `ui/ReadErrorBoundary.tsx`.
- `eval/coach/{cases,fixtures,reports}/`, `scripts/coach-eval/{run,cases,checks,report,verify-api}.ts`, `scripts/coach-eval/NOTES.md` ; `apps/web/e2e/coach.spec.ts`, `apps/web/e2e/support/coach-server-entry.ts`.

**Ordre et parallélisme :** 1 → {3, 4} ; 2 seule ; 10 seule ; 5 → {6, 7, 11, 24} ; 6 → {9, 12} ; 7 → 8 ; {6, 8} → 19 ; 12 → 13 (bloquée sans clé, rien ne l'attend) ; {6, 11, 12} → 14 → 15 (après 9) → {16, 17, 23} ; {8, 10, 17} → 18 → 20 ; {16, 19, 20} → 21 → 22 → 30 ; {8, 24} → 25 → {26 (après 10), 27} ; 24 → 28 ; {2, 23, 25} → 29 ; {22, 23, 26–29} → 31 ; 32 en dernier (après 13 et 30).
**Worktrees :** au départ, en parallèle, {1, 2, 5, 10} ; puis {3, 4, 6, 7, 11, 24} ; ensuite la branche serveur (12 → 14 → 15 → 20 → 22, avec 8, 9, 16 à 19 et 23 à côté) et la branche web (25 → 26, 27, 28, 29) avancent ensemble. Les tâches de dette 1 à 4 ne touchent pas au coach et passent tôt ; 2 et 29 touchent `HomePage.tsx` (29 après 2) ; 3 et 4 utilisent l'aide à deux appareils de 1.

---

### Task 1: Dette M1 (parité des chargeurs) et garde-fou M8

**Files:**
- Create: `apps/web/test/support/two-devices.ts`, `apps/web/test/repos/loader-parity.test.ts`
- Modify: `apps/web/test/repos/workout-two-devices.test.ts` (utilise l'aide extraite, cas inchangés), `packages/domain/test/program/rules.test.ts`
- Modify si l'écart existe : `apps/server/src/program/{records,replay-service}.ts`, `apps/web/src/repos/{session-records,program-view}.ts`

**Interfaces:**
- Consumes: `createTestContext`, `createUserAndLogin`, `enroll`, `seedSheet`, `sheetFixture`, `templateFixture` (`@rune/server/testing`), `createSyncEngine`, `inProcessTransport`, `programViewFor`.
- Produces (`two-devices.ts`) : `startServerWith(sheetIds: readonly string[]): Promise<TestContext>` ; `createDevice(ctx: TestContext, opts: {cookie: string; db?: AppDb}): Promise<Device>` avec `Device {db; engine; repos; services: AppServices; cookie; offline: boolean}` ; `syncAll(...devices: Device[]): Promise<void>` (push puis pull de chaque appareil, deux tours).

- [ ] **Step 1: Write the failing tests** —
  - `loader-parity.test.ts › le rejeu du téléphone égale slot_state et engine_decision du serveur` : deux appareils du même membre inscrits au modèle de test ; 6 séances terminées réparties sur les deux, dont une hors ligne poussée en retard, une dans un second lieu, un « ne pas augmenter », un « alléger », une douleur sans accord santé, un changement d'exercice ; après `syncAll`, pour chaque appareil, `programViewFor(services).view()` a `source: 'local'`, et `replay.slotStates` et `replay.decisions` égalent, champ par champ hors colonnes de synchro, les lignes vivantes de `slot_state` et `engine_decision` lues dans `ctx.deps.db`.
  - `rules.test.ts › une seconde version des règles exige un pas versionné` : `stepGuardViolated(versionCount: number, effectiveSource: string): boolean` (défini dans le test) vaut vrai pour `(2, "currentRules().stepS")`, faux pour `(1, …)` ; puis `stepGuardViolated(Object.keys(RULES_BY_VERSION).length, readFileSync('src/program/effective.ts'))` est faux.
- [ ] **Step 2: Run** `npx vitest run --project web test/repos/loader-parity.test.ts` et `npx vitest run --project domain test/program/rules.test.ts` — FAIL (aide absente ; écart s'il existe).
- [ ] **Step 3: Implement** l'aide (extraite telle quelle de `workout-two-devices.test.ts`) ; si l'égalité échoue, corriger le chargeur fautif (serveur : `toSessionRecords`, `acceptedChanges`, `placesOf` ; téléphone : `composeSessions`, `placeContexts`, `slotStateOf`) sans toucher au domaine.
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `test(web): parité des chargeurs du rejeu entre téléphone et serveur (M1, M8)`.

### Task 2: Dette M2 (copies provisoires) et M5 (erreurs de lecture)

**Files:**
- Create: `apps/web/src/ui/ReadErrorBoundary.tsx`, `apps/web/test/ui/read-error.test.tsx`, `apps/web/test/repos/provisional.test.ts`
- Modify: `apps/web/src/app-services.tsx` (`useLive`), `apps/web/src/ui/{index,AppShell}.tsx`, `apps/web/src/features/home/HomePage.tsx`, `apps/web/src/repos/{program-view,workout-repo}.ts`, `apps/web/src/sync/engine.ts`, `apps/web/test/home/home.test.tsx`

**Interfaces:**
- Produces :
  - `useLive<T>(query, deps): T | undefined` (signature inchangée) : l'erreur de la requête est relancée au rendu suivant, pour la frontière la plus proche.
  - `ReadErrorBoundary(p: {children: ReactNode; compact?: boolean})` : « Impossible d'afficher cette page. » et « Réessayer » (remonte les enfants, donc relance les requêtes) ; posée autour du contenu routé dans `AppShell` et autour de chaque carte de l'accueil (`compact`).
  - `ProgramViewRepo.storeProvisional(replay: ReplayResult, sessionId: string): Promise<void>` : seulement les décisions dont l'`id` est un `performed_exercise` de cette séance et les états dont `lastSessionId === sessionId` ; `refreshProvisional(sessionId: string)` ; `afterCompleted` passe l'identifiant de la séance terminée.
  - Moteur : après un pull réussi avec l'outbox vide, s'il reste une ligne `provisional: 1` dans `slot_state` ou `engine_decision`, un seul pull complet relancé (watermark effacé, `dropUnreceived` comme aujourd'hui), jamais deux de suite.

- [ ] **Step 1: Write the failing tests** —
  - `read-error.test.tsx › une lecture qui échoue affiche le message et Réessayer relit` : requête qui lève au premier appel → « Impossible d'afficher cette page. » et « Réessayer » ; clic → contenu affiché, requête appelée 2 fois.
  - `home.test.tsx › le rejeu qui lève garde la bulle du coach et les tuiles` : `useProgramView` qui lève → message compact à la place de la carte du programme, bulle « Aujourd'hui » et tuiles présentes.
  - `provisional.test.ts` : fin d'une séance → copies provisoires de ses seules décisions et des états qu'elles touchent (une décision d'une séance plus ancienne absente du miroir n'est pas écrite) ; pull réussi, outbox vide, une copie non réécrite par le serveur → un pull complet relancé et la copie disparaît ; second pull réussi avec une copie encore là → aucune nouvelle relance ; outbox non vide → aucune relance.
- [ ] **Step 2: Run** `npx vitest run --project web test/ui/read-error.test.tsx test/repos/provisional.test.ts test/home/home.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `fix(web): copies provisoires réconciliées et erreurs de lecture affichées (M2, M5)`.

### Task 3: Dette I2 (série ressuscitée), gel de M3, transition completed → abandoned

**Files:**
- Create: `apps/web/test/repos/revive-set.test.ts`
- Modify: `apps/server/src/sync/{hooks,push}.ts`, `apps/server/src/program/sync-hooks.ts`, `apps/server/test/program/push.test.ts`

**Interfaces:**
- Consumes: Task 1 (`two-devices.ts`).
- Produces :
  - `EntitySyncHooks.reviveOnWrite?(ctx: HookCtx, fields: Record<string, unknown>): Promise<boolean>` : consulté par `writeRow` quand un `patch` ou un `create` vise une ligne supprimée logiquement ; vrai → la ligne revit (`deleted_at` à NULL, champs écrits, rev neuf), `afterBatch` la reçoit (rejeu habituel).
  - `performedSet.reviveOnWrite` : vrai si `fields.logged_at` n'est pas nul et la séance parente vivante ; fait revivre aussi le `performed_exercise` parent supprimé (rev neuf). Séance supprimée : faux (la suppression l'emporte).
  - `workoutSession.beforeApply` : ligne stockée hors de `in_progress` → `week_type` et `rules_version` retirés du patch, le reste appliqué ; `status: 'abandoned'` sur une séance `completed` → champ retiré, op `applied` ; retour à `in_progress` toujours `invalid_transition`.

- [ ] **Step 1: Write the failing tests** —
  - `push.test.ts` : **série faite poussée après sa suppression** → vivante, rev neuf, exercice parent ressuscité, décision rejouée ; **séance supprimée** → la série reste supprimée, op `applied` sans effet ; **patch sans `logged_at` sur une tombe** → sans effet (comportement actuel) ; **`week_type` et `rules_version` sur une séance `completed`** → inchangés, `note` du même patch appliquée ; **`completed` puis `abandoned`** → `applied`, statut `completed`, reste du patch appliqué ; **`completed` puis `in_progress`** → `invalid_transition`.
  - `revive-set.test.ts › série faite hors ligne sur A, retirée sur B avant` : A valide une série hors ligne ; B, qui ne l'a pas reçue faite, la retire et pousse ; A revient et pousse ; après `syncAll`, la série est vivante sur le serveur et dans les deux miroirs avec ses valeurs, et la décision du moteur la compte.
- [ ] **Step 2: Run** `npx vitest run --project server test/program/push.test.ts` et `npx vitest run --project web test/repos/revive-set.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `fix(server): une série faite revit après une suppression arrivée avant elle (I2, M3)`.

### Task 4: Dette I3 (changer d'exercice en retard)

**Files:**
- Create: `apps/web/test/repos/late-swap.test.ts`
- Modify: `apps/web/src/repos/workout-repo.ts` (`swapExercise`), `apps/web/test/repos/workout-repo.test.ts` (cas de la brique 3 repris)

**Interfaces:**
- Consumes: Task 1.
- Produces : `swapExercise(performedExerciseId, exerciseId, reason): Promise<string>` rend toujours l'identifiant d'un **nouveau** `performed_exercise` (même `sessionId`, `slotId`, `plannedExerciseId`, `position`) ; l'ancien est supprimé logiquement s'il n'a aucune série faite connue localement, sinon gardé avec ses séries faites ; plus aucun patch de `exercise_id`.

- [ ] **Step 1: Write the failing tests** —
  - `workout-repo.test.ts` : **sans série faite** → nouvel exercice, ancien supprimé, aucune op de l'outbox ne patche `exerciseId` ; **avec une série faite** → ancien gardé avec elle, séries non faites recréées sous le nouveau.
  - `late-swap.test.ts › changement d'exercice sur un miroir en retard` : A fait 2 séries de `back-squat` hors ligne ; B, sans les avoir reçues, change l'exercice vers `dumbbell-lunge` et pousse ; A pousse ; sur le serveur les 2 séries faites restent sous un exercice `back-squat` (`keepOnDelete`), le nouvel exercice porte la suite, aucune série faite n'a `exercise_id = 'dumbbell-lunge'`.
- [ ] **Step 2: Run** `npx vitest run --project web test/repos/late-swap.test.ts test/repos/workout-repo.test.ts` — FAIL.
- [ ] **Step 3: Implement** (le chemin `split` actuel devient le seul chemin).
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `fix(web): changer d'exercice crée toujours une nouvelle entrée (I3)`.

### Task 5: Contrats du coach

**Files:**
- Create: `packages/contracts/src/forbidden-terms.ts`, `packages/contracts/test/forbidden-terms.test.ts`
- Modify: `packages/contracts/src/{coach,program,texts,help-resources,index}.ts`, `packages/contracts/src/api/{errors,program}.ts`, `packages/contracts/test/{coach,program,errors,help-resources,consent}.test.ts`, `packages/domain/src/program/validate-change.ts` (réexporte `OPERATION_AUTHORS`), `apps/server/src/program/changes.ts` (`changeView`), `apps/server/test/program/changes.test.ts`, `apps/web/src/repos/program-view.ts` (`changeOf`), `apps/web/test/repos/program-view.test.ts`, les jeux de test qui construisent un `InstanceChangeView` (`apps/web/test/support/program.ts` et voisins)

**Interfaces:**
- Produces :
  - `program.ts` : `CHANGE_REASON_CODES` + `'COACH_PROPOSAL'`, `REASON_TEXTS.COACH_PROPOSAL = 'Le coach IA te propose ce changement.'` ; `OPERATION_AUTHORS` déplacé ici depuis `validate-change.ts`, table inchangée.
  - `api/program.ts` : `InstanceChangeView` + `aiGenerated: boolean`, `aiModel: string | null`, `coachThreadId: string | null` (remplis par `changeView` et `changeOf`).
  - `api/errors.ts` : `coach_unavailable` 503, `consent_required` 403, `daily_limit_reached` 429, `monthly_budget_reached` 429, `request_in_progress` 409, `thread_closed` 409, `duplicate_message` 409.
  - `help-resources.ts` : `HELP_RESOURCE_IDS` (ordre de `HELP_RESOURCES`) ; `helpPhones(r: HelpResource): {label: string; digits: string}[]` (`'15 / 112'` → `15`, `112` ; `'09 69 325 900'` → libellé tel quel, `digits` `0969325900`) ; `HELP_PHONE_DIGITS: readonly string[]`.
  - `texts.ts` : `AI_COACH_CONSENT_TEXT: VersionedText = {version: '1.0', text: <citation du §14.1 mot pour mot>}` ; `CURRENT_CONSENT_TEXTS: Record<ConsentType, VersionedText>`.
  - `forbidden-terms.ts` : `ForbiddenTerm {term: string; forms: readonly string[]}` ; `FORBIDDEN_TERMS: {version: '1'; all: readonly ForbiddenTerm[]; minor: readonly ForbiddenTerm[]; allowedForMinor: readonly string[]}` — `term` = entrées du §11.4 telles quelles, dans l'ordre ; `forms` = le terme, plus pluriel et féminin des noms et adjectifs, infinitif, présent, participes et futur des verbes (`sécher` : `sécher`, `sèche`, `sèches`, `sèchent`, `séchons`, `séchez`, `séché`, `séchée`, `séchés`, `séchées`, `sécherai`, `sécheras`, `séchera`…) ; `allowedForMinor` = `dopage`, `produits dopants`, `Écoute Dopage`.
  - `coach.ts` (en plus de `COACH_IDS`) :
    - constantes et types : `COACH_EFFORTS` (`low`, `medium`, `high`), `COACH_CLOSED_REASONS` (`version_change`, `health_withdrawn`, `day_over`), `COACH_MESSAGE_ROLES` (`user`, `assistant`, `system`), `COACH_REPORT_CATEGORIES` (`inaccurate`, `unsafe`, `inappropriate`, `other`), `COACH_COUNTER_KINDS` (les 8 du §6.1), `COACH_LINKS` (`program`, `coach_help`), `COACH_TOOL_NAMES` (`propose_program_change`, `read_training`, `refer_to_help`, `search_exercises`), `COACH_STREAM_ERROR_CODES` (les 8 du §7.2), `COACH_UNAVAILABLE_REASONS` (`disabled`, `suspended`, `not_configured`), `COACH_AGE_BANDS` (`16-17`, `18-29`, `30-39`, `40-49`, `50-59`, `60+`) ; types `CoachToolName`, `CoachStreamErrorCode`, `CoachCounterKind`, `CoachLink`, `CoachAgeBand`.
    - texte : `cleanCoachText(raw: string): string` (contrôles retirés sauf `\n`, `\r\n` → `\n`, U+202A–U+202E et U+2066–U+2069 retirés, espaces de bord retirés) ; `coachTextLength(text: string): number` = nombre de points de code ; `COACH_COUNTER_FROM = 1800`.
    - `CoachOperationSchema` : union discriminée par `op` des variantes de `InstanceChangeOperationSchema.options` dont `OPERATION_AUTHORS[op]` contient `coach`.
    - entrées d'outils, `.strict()`, clés en snake_case : `ReadTrainingInput {since_days: int 1..28 (message « 28 jours au plus »), exercise_id?: slug}` ; `SearchExercisesInput {query?: string ≤ 80, muscle?: MuscleCode, movement_pattern?: MovementPattern, available_equipment_only?: boolean}` ; `ProposeProgramChangeInput {base_revision: int ≥ 0, operations: CoachOperationSchema[1..5], reason: string 1..300}` ; `ReferToHelpInput {resource: HelpResourceId}`.
    - `CoachBriefSchema` (strict, snake_case), `schema: 'coach-brief/1'`, `today`, `audience`, `age_band`, `profile {level, goal, days_per_week, session_minutes, cautious_mode, engine_profile, context {kind, sport_code}}`, `places[] {name ('lieu_1'…), kind, primary, equipment[], load_settings? {bar_kg, smallest_plate_kg, machine_step_kg}}`, `program {template {id, name, version}, revision, week, block_week, next_workout_id, days_per_week, workouts[] {id, name, slots[] {id, role, movement_pattern, exercise {id, name} | null, sets, reps {min, max} | null, duration_s {min, max} | null, target_rir, rest_s, engine {mode, load_kg, target_reps, variant_rank, duration_s, calibration_left, suspended} | null, last_decision {days_ago, result, reason_code, reason_text} | null}}, pending_proposals[] {author, operations, days_left}, templates[] {id, name, summary, context, level, days_min, days_max}} | null`, `history {sessions[] {days_ago, name, place, exercises[] {id, name, sets: [load_kg, reps, duration_s, effort][], pain?}, user_notes?}, truncated}`, `records[] {exercise_id, name, best_set {load_kg, reps} | null, most_reps, longest_s, e1rm_kg?}`, `health? {limitations[] {area, side, severity, note}}`, `nutrition: null`.
    - vues et requêtes : `DisplayExtras {helpCards: HelpResourceId[], proposalIds: string[], links: CoachLink[], replaced: boolean}` ; `CoachMessageRequest {clientMessageId: z.uuid({version: 'v7'}), text: string}` ; `CoachStatusView`, `CoachMessageView` (champs du §7.1) ; `CoachThreadView {id, day, audience, persona, open, closedReason, userMessageCount, createdAt}` ; `CoachTodayResponse`, `CoachThreadsResponse {threads: {id, day, userMessageCount, open}[]}`, `CoachThreadResponse`, `CoachBriefResponse {brief, threadId, day, preview}` ; `CoachReportRequest {threadId, messageSeq: int ≥ 1, category, comment?: string ≤ 500}` ; `CoachStreamEventSchema` (union par `type` des 8 événements du §7.2, données exactes du tableau ; `proposal.reasonCode` littéral `COACH_PROPOSAL`, `proposal.reason` nullable) et `CoachProposalEvent` ; administration : `CoachAdminView {state: {enabled, suspendedUntil, configured, notConfiguredCause: 'no_key' | 'model_not_allowed' | 'not_evaluated' | null, catalogChanged}, month, totalUsd, workspaceLimitUsd, members: {username, costUsd, budgetUsd}[], counters: {month, kind, count}[], openReports}`, `SetCoachEnabledRequest {enabled}`, `CoachReportSummary {id, createdAt, category, username, minor}`, `CoachReportDetail` (+ `exchangeText`, `comment`).

- [ ] **Step 1: Write the failing tests** —
  - `coach.test.ts` : **`CoachOperationSchema` sans `resume_slot`** → `{op: 'resume_slot', slot: 'a'}` refusé, les 12 autres opérations acceptées ; **`ReadTrainingInput`** → `since_days` 28 accepté, 29 et 90 refusés avec « 28 jours au plus » ; **`ProposeProgramChangeInput`** → 6 opérations et `reason` de 301 caractères refusés ; **nettoyage** → `cleanCoachText(' a\r\nb‮c\u0007 ') === 'a\nbc'` ; **longueur en points de code** (Review Focus 3) → `coachTextLength('💪🏽é') === 4`, 1 000 « 💪 » (2 000 unités UTF-16) → 1 000 ; **événements** → chacun des 8 du §7.2 passe avec ses données, `error` à code hors liste refusé ; **dossier** → un dossier complet passe `CoachBriefSchema`, une clé `pseudo` est refusée.
  - `program.test.ts` : `REASON_TEXTS.COACH_PROPOSAL` exact ; `OPERATION_AUTHORS.resume_slot` = `['user']`.
  - `errors.test.ts` : statuts des 7 codes. `help-resources.test.ts` : `[...HELP_PHONE_DIGITS].sort()` = `['0800152000', '0969325900', '112', '15', '3114']` ; `helpPhones(emergency)` libellés `15`, `112`.
  - `forbidden-terms.test.ts` : `all.map((t) => t.term)` et `minor.map((t) => t.term)` = listes du §11.4 dans l'ordre ; chaque `forms` contient son `term` ; aucune entrée de `allowedForMinor` n'est une forme listée.
  - `consent.test.ts` : `AI_COACH_CONSENT_TEXT` = `{version: '1.0', text: <citation du §14.1>}`.
  - `changes.test.ts` (serveur) et `program-view.test.ts` (web) : une proposition `author = coach` rend `aiGenerated: true`, `aiModel`, `coachThreadId`.
- [ ] **Step 2: Run** `npx vitest run --project contracts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(contracts): contrats du coach, opérations du coach, texte d'accord et termes interdits`.

### Task 6: Domaine : configuration, garde d'accès, historique envoyé

**Files:**
- Create: `packages/domain/src/coach/{config,guard,history,index}.ts`, `packages/domain/test/coach/{config,guard,history}.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: Task 5 ; `RULES_BY_VERSION`, `ageBandOn`, `HELP_RESOURCES`.
- Produces :
  - `CoachEvaluatedEntry {model, effort, promptVersion, toolsVersion, briefSchema, catalogVersion, report}` ; `CoachConfig` (type de la table §5.2) ; `COACH_CONFIG: CoachConfig` gelé en profondeur, valeurs des Global Constraints, `helpResources: HELP_RESOURCES`, `allowedConstants` = `lightenPct`, `resume.days14.loadPct`, `resume.days28.loadPct` de chaque version de `RULES_BY_VERSION`, sans doublon ; `promptVariant(audience: AgeBand): 'coach-1/adult' | 'coach-1/minor'` ; `isEvaluated(config: CoachConfig, combo: Omit<CoachEvaluatedEntry, 'report'>): boolean`.
  - `GuardSnapshot {configured: boolean; enabled: boolean; suspendedUntil: string | null; now: string; consent: {active: boolean; textVersion: string | null}; currentConsentVersion: string; countedToday: number; monthSpentUsdMicros: number; inProgress: boolean}` ; `GuardRefusal = {code: 'coach_unavailable'; reason: CoachUnavailableReason} | {code: 'consent_required' | 'daily_limit_reached' | 'monthly_budget_reached' | 'request_in_progress'}` ; `coachAccessGuard(s: GuardSnapshot, config?: CoachConfig): GuardRefusal | null` (ordre du §7.3) ; `coachAudience(birthDate: string, parisDay: string): AgeBand` ; `parisMonthOf(day: string): string` ; `nextParisMonthStart(now: Date): string` (ISO UTC du 1er du mois de Paris suivant, minuit à Paris).
  - `ApiBlock = {type: string} & Record<string, unknown>` ; `StoredApiMessage {role: 'user' | 'assistant' | 'system'; blocks: readonly ApiBlock[]}` ; `ApiMessage {role: StoredApiMessage['role']; content: ApiBlock[]}` ; `historyForApi(messages: readonly StoredApiMessage[]): ApiMessage[]` : chaque bloc tel que stocké, sauf, dans un message, les blocs `thinking`, `redacted_thinking` et `tool_use` situés avant le **dernier** bloc `fallback`.

- [ ] **Step 1: Write the failing tests** —
  - `config.test.ts` : valeurs exactes de la table (`limits.messagesPerDay` 30 … `callTimeoutMs` 120 000, `retention`, `promptVersion`, `toolsVersion`, `briefSchema`) ; `evaluated` vide ; gelé récursivement ; `allowedConstants` = `[10, 20]` ; `promptVariant('minor') === 'coach-1/minor'`.
  - `guard.test.ts › ordre des refus` (tableau) : tout bon → null ; non configuré → `{coach_unavailable, not_configured}` même sans accord ; `enabled` faux → `disabled` ; `suspendedUntil` après `now` → `suspended`, avant → passe ; accord `0.9` contre courante `1.0` → `consent_required` (C36), retiré → `consent_required` ; `countedToday` 30 → `daily_limit_reached`, 29 → passe ; `monthSpentUsdMicros` 3 000 000 → `monthly_budget_reached`, 2 999 999 → passe ; `inProgress` → `request_in_progress` ; limite du jour et budget ensemble → `daily_limit_reached`.
  - `guard.test.ts › public et dates de Paris` : né le 2008-11-04 : `coachAudience(…, '2026-11-03')` → `minor`, `'2026-11-04'` → `adult` ; né le 2008-02-29 : `'2026-02-28'` → `minor`, `'2026-03-01'` → `adult` ; `nextParisMonthStart(new Date('2026-10-31T23:30:00Z'))` → `'2026-11-30T23:00:00.000Z'` ; `nextParisMonthStart(new Date('2026-03-15T12:00:00Z'))` → `'2026-03-31T22:00:00.000Z'` ; `parisMonthOf('2026-11-01') === '2026-11'`.
  - `history.test.ts` (tableau) : sans `fallback` → blocs identiques, `thinking` compris ; `[thinking, tool_use, fallback, thinking, text]` → `[fallback, thinking, text]` ; `[thinking, fallback, redacted_thinking, fallback, text]` → `[fallback, fallback, text]` ; `text` avant `fallback` gardé ; messages `user` et `system` inchangés ; l'entrée n'est pas modifiée.
- [ ] **Step 2: Run** `npx vitest run --project domain test/coach` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` (dont `purity.test.ts`) — PASS.
- [ ] **Step 5: Commit** `feat(domain): configuration du coach, garde d'accès et historique envoyé`.

### Task 7: Domaine : découpe en phrases et valeurs autorisées

**Files:**
- Create: `packages/domain/src/coach/{sentences,values}.ts`, `packages/domain/test/coach/{sentences,values}.test.ts`
- Modify: `packages/domain/src/coach/index.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces :
  - `class SentenceBuffer { push(delta: string): string[]; flush(): string[] }` : coupe après `.`, `!`, `?` ou `…` suivis d'une espace (gardée avec la phrase) ou de la fin du flux, et après chaque `\n` (gardé) ; jamais dans un nombre (un `.` ou une `,` suivis d'un chiffre ; un `.` en fin de morceau attend le suivant) ; 400 caractères sans fin → les 400 caractères rendus tels quels.
  - `UnitFamily = 'mass' | 'percent' | 'nutrition'` ; unités en fin de mot : `kg`, `kilo(s)`, `kilogramme(s)` → `mass` ; `%`, `pour cent` → `percent` ; `kcal`, `cal`, `calorie(s)`, `g`, `gr`, `gramme(s)` → `nutrition`.
  - `normalizeNumber(raw: string): string` (virgule ou point décimal, espaces de milliers U+0020, U+00A0, U+202F, U+2009 retirées, zéros de fin retirés) ; `findQuantities(text: string): {value: string; unit: string; family: UnitFamily; index: number}[]` (nombre suivi, avec ou sans espace, d'une unité) ;
  - `AllowedValues = Readonly<Record<UnitFamily, ReadonlySet<string>>>` ; `allowedValues(sources: {brief: unknown; toolResults: readonly unknown[]; constants: readonly number[]; nutritionFull: boolean}): AllowedValues` : parcourt le JSON ; nombre sous une clé `_kg` → `mass`, `_pct` → `percent`, `_kcal` ou `_g` → `nutrition` (si `nutritionFull`) ; nombres des chaînes suivis d'une unité → famille de l'unité ; `constants` → `percent`.

- [ ] **Step 1: Write the failing tests** —
  - `sentences.test.ts` : « Bonjour. Ta charge est de 62.5 kg. » poussé caractère par caractère puis `flush` → `['Bonjour. ', 'Ta charge est de 62.5 kg.']` ; `'62,'` puis `'5 kg.'` → aucune coupe avant `kg.` ; « Et ensuite… voilà » → coupe après « … » ; `'- un\n- deux\n'` → `['- un\n', '- deux\n']` ; 450 caractères sans fin → une sortie de 400 caractères, le reste au `flush` ; « 3. » en fin de flux → rendu au `flush`.
  - `values.test.ts` : `normalizeNumber` : `'62,50'` → `'62.5'`, `'1 000'`, `'1 000'`, `'1 000'`, `'1 000'` → `'1000'`, `'60.0'` → `'60'` ; `findQuantities('Mets 62,5kg puis 10 % et 200 kcal')` → `62.5/mass`, `10/percent`, `200/nutrition` ; `'5 kilos'` → `mass` ; `'3 gr'` → `nutrition` ; `'10 grenouilles'` et `'10 kgs'` → aucun ; `allowedValues` : `{engine: {load_kg: 62.5}}` → `mass` ∋ `'62.5'` ; `{rest_s: 90}` → aucune famille ; résultat d'outil `{key_points: ['Garde 90 % de ta course']}` → `percent` ∋ `'90'` ; `constants: [10, 20]` → `percent` ∋ `'10'`, `'20'` ; `{target_kcal: 2000}` avec `nutritionFull: false` → `nutrition` vide.
- [ ] **Step 2: Run** `npx vitest run --project domain test/coach/sentences.test.ts test/coach/values.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(domain): découpe en phrases et valeurs autorisées du filtre`.

### Task 8: Domaine : filtre de sortie

**Files:**
- Create: `packages/domain/src/coach/filter.ts`, `packages/domain/test/coach/filter.test.ts`
- Modify: `packages/domain/src/coach/index.ts`

**Interfaces:**
- Consumes: Tasks 5 (`FORBIDDEN_TERMS`, `HELP_PHONE_DIGITS`), 7.
- Produces : `FilterRule = 'phone' | 'unit' | 'forbidden_term'` ; `FilterContext {audience: AgeBand; nutritionMode: 'none' | 'qualitative' | 'full'; allowed: AllowedValues}` ; `FilterVerdict = {ok: true} | {ok: false; rule: FilterRule; detail: string}` (`detail` : chiffres du numéro, `<valeur> <unité>`, ou le `term` interdit) ; `normalizeForTerms(text: string): string` (NFKC, minuscules, accents retirés, élisions `l'`, `d'`, `qu'`… séparées, tirets en espaces) ; `outputFilter(sentence: string, ctx: FilterContext): FilterVerdict` — règles du §11.3 dans l'ordre, première violation rendue ; famille nutrition et termes levés seulement pour un adulte en mode `full` ; mineur : listes `all` et `minor`.

- [ ] **Step 1: Write the failing tests** (tableaux, chaque règle × adulte et mineur × autorisé ou non) —
  - **téléphone** : « Appelle le 15. », « Appelle le 3114. », « Compose le 09 69 325 900. », « 0 800 15 2000 » → ok ; « 01 23 45 67 89 » → `phone` ; « appeler le 118 » → `phone` ; « Fais 118 pas. » → ok (pas de mot d'appel) ; « tél. 0612345678 » → `phone`.
  - **unités** (`mass` = {`62.5`, `1000`}, `percent` = {`10`}) : « 62,5 kg », « 62.5kg », « 1 000 kg », « 10 % » → ok ; « 65 kg » → `unit` détail `65 kg` ; « 15 pour cent » → `unit` ; « 5 kilos » → `unit` ; « 200 kcal » adulte `none` → `unit`, mineur → `unit`, adulte `full` avec `nutrition` = {`200`} → ok.
  - **termes** : adulte « Fais une sèche. » → `forbidden_term` détail `sèche` ; « C'est un échec. » et « l'échec » → `échec` ; « Évite les régimes. » → `régime` ; mineur « prends de la créatine » → `créatine`, adulte → ok ; mineur « Appelle Écoute Dopage. » et « les produits dopants » → ok ; adulte `full` « sèche » → ok.
  - **ordre** : « Appelle le 0123456789 pour ta sèche de 3 kg » → `phone`.
- [ ] **Step 2: Run** `npx vitest run --project domain test/coach/filter.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(domain): filtre de sortie du coach`.

### Task 9: Domaine : dossier `coach-brief/1`

**Files:**
- Create: `packages/domain/src/coach/brief.ts`, `packages/domain/test/coach/brief.test.ts`, `packages/domain/test/fixtures/coach-brief.ts` (entrée complète avec canaris)
- Modify: `packages/domain/src/coach/index.ts`

**Interfaces:**
- Consumes: Tasks 5 (`CoachBriefSchema`), 6 ; `parisDaysUntil`, `exerciseRecords`, `REASON_TEXTS`, `ageOn`.
- Produces :
  - `BriefSession {endedAt: number; workoutName: string | null; placeId: string | null; note: string | null; exercises: {exerciseId: string; painLevel: PainLevel | null; note: string | null; sets: SetRecord[]}[]}` ;
  - `CoachBriefInput {today: string; birthDate: string; consents: {health: boolean; coach: boolean}; profile: {experience; goal; daysPerWeek; sessionMinutes; sportCode: string | null; cautiousMode: boolean; engineProfile: SessionProfile}; places: {id; name; kind: 'gym' | 'home'; primary: boolean; equipment: EquipmentCode[]; loadSettings: LoadSettings}[]; program: {templateVersion: number; revision: number; program: EffectiveProgram; replay: ReplayResult; pending: {author: ChangeAuthor; operations: InstanceChangeOperation[]; expiresAt: number}[]; templates: ServedProgramTemplate[]} | null; sessions: BriefSession[]; catalog: readonly CatalogSheet[]; limitations: {area; side; severity; note: string | null}[]}` ;
  - `coachAgeBand(birthDate: string, today: string): CoachAgeBand` ; `sortedJson(value: unknown): string` (clés en ordre binaire, sans espace) ; `estimateTokens(json: string): number` = `Math.ceil(json.length / 3)` ; `cleanFreeText(text: string | null): string | null` (200 caractères au plus, contrôles et inversions retirés, vide → null) ; `briefProgram`, `briefHistory(input, opts: {days: number; exerciseId?: string; pain: boolean})`, `briefRecords(input, sessions)` (exportées pour `read_training`) ; `buildCoachBrief(input: CoachBriefInput): {brief: CoachBrief; json: string; estimatedTokens: number}`.
- Règles : lieux vivants renommés `lieu_1` (principal), `lieu_2`… dans l'ordre reçu ; `load_settings` en kg pour le principal seulement ; `context.kind` = règle de `recommendTemplate` (`sport` si `goal = sport_support` et `sportCode` non vide, sinon le `kind` du lieu principal, `gym` sans lieu) ; charges en kg (g / 1 000, 2 décimales au plus) ; jours écoulés par `parisDaysUntil`, seule `today` est absolue ; `health` et `pain` seulement si `consents.health && consents.coach` ; `e1rm_kg` pour un adulte seulement ; au-delà de 4 500 jetons estimés, retrait des séances les plus anciennes, puis des records au-delà de 15, puis des notes, et `history.truncated = true` ; sortie validée par `CoachBriefSchema`.

- [ ] **Step 1: Write the failing tests** —
  - **canaris absents** : entrée avec `birthDate: '2001-07-13'`, lieu « Salle Canari », identifiants `place-canari-1`, `session-canari-1`, `instance-canari` → `json` ne contient ni `2001-07-13`, ni `Canari`, ni `canari` (hors notes), ni aucun identifiant d'entrée.
  - **C2 selon les deux accords** : (santé faux, coach vrai) et (santé vrai, coach faux) → ni clé `health` ni `pain` ; les deux vrais → présentes.
  - **mineur sans `e1rm_kg`** ; adulte avec.
  - **clés triées, déterminisme** : `json === sortedJson(JSON.parse(json))`, deux appels → même chaîne, aucun espace hors des chaînes.
  - **troncature** : 40 séances → `estimatedTokens ≤ 4500`, séances récentes gardées, `truncated: true` ; petite entrée → `truncated: false`.
  - **notes** : note de 250 caractères avec U+202E → 200 caractères, sans U+202E, sous `user_notes`.
  - **membre sans programme, sans lieu, sans séance** (Review Focus 4) : `program: null`, `places: []`, `sessions: []`, `records: []`, passe `CoachBriefSchema`, `profile.context.kind === 'gym'`.
  - **dates relatives** : séance terminée la veille à 23 h 30 de Paris → `days_ago: 1` ; aucune chaîne ISO hors `today`.
- [ ] **Step 2: Run** `npx vitest run --project domain test/coach/brief.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(domain): dossier coach-brief/1`.

### Task 10: Domaine : aperçu des charges et garde de hausse

**Files:**
- Create: `packages/domain/src/program/preview.ts`, `packages/domain/test/program/{preview,preview.property}.test.ts`
- Modify: `packages/domain/src/program/index.ts`

**Interfaces:**
- Consumes: `replayInstance`, `planWorkout`, `effectiveProgram`, `validateChange`, fixtures de `packages/domain/test/fixtures/program.ts`.
- Produces :
  - `PlannedLoad = {kind: 'load'; loadG: number} | {kind: 'calibration'} | {kind: 'none'}` (`none` : sans charge, suspendu ou sauté) ;
  - `SlotLoadPreview {slotId: string; workoutId: string; touched: boolean; before: PlannedLoad | null; after: PlannedLoad | null}` (null : slot absent de ce côté) ;
  - `ChangePreviewInput {replay: ReplayInput; change: {id: string; author: ChangeAuthor; operations: readonly InstanceChangeOperation[]}; decidedAt: number; plan: Omit<PlanInput, 'replay' | 'workoutId'>}` ;
  - `changePreview(input: ChangePreviewInput): SlotLoadPreview[]` ; `loadIncreases(previews: readonly SlotLoadPreview[]): string[]` (slots où `before` et `after` sont `load` et `after.loadG > before.loadG`).
- Algorithme : avant = `replayInstance(input.replay)` puis `planWorkout` de chaque séance du programme au lieu `input.plan.place` ; après = idem avec le changement ajouté à `replay.changes` (`decidedAt`, `reasonCode` `COACH_PROPOSAL` pour le coach, `USER_CHANGE` sinon) ; charge prévue d'un slot = `targetLoadG` de sa première série de travail, `calibration` si `PlannedExercise.calibration` sans `targetLoadG`, `none` sans exercice ou sans charge ; un changement qui contient `switch_template` → `after: null` partout ; `touched` = slot nommé par une opération, ajouté, retiré, ou dont la charge change.

- [ ] **Step 1: Write the failing tests** —
  - `preview.test.ts` : **allègement** (40 kg, barre 20 kg, plus petit disque 1,25 kg) → `before {load 40000}`, `after {load 35000}`, `touched`, `loadIncreases` vide ; **remplacement** vers une fiche jamais faite → `after {calibration}` ; vers une fiche déjà faite à 60 kg dans ce slot quand la courante est à 40 kg → `loadIncreases = [slotId]` ; **chaîne** remplacée → `after {calibration}` ; **`remove_slot`** → `after: null` ; **`add_slot`** → `before: null`, `after {calibration}`, `touched` ; **`switch_template`** → tous `after: null` ; **`suspend_slot`** → `after {none}`.
  - `preview.property.test.ts` (fast-check) : pour toute suite de 1 à 3 opérations de `CoachOperationSchema` sur les slots et fiches de la fixture, acceptée par `validateChange` (auteur `coach`) et sans hausse selon `loadIncreases(changePreview(…))`, le plan recalculé sans `changePreview` (`effectiveProgram`, `replayInstance`, `planWorkout` sur les changements acceptés) n'a aucune charge de travail au-dessus de celle d'avant ; `changePreview` ne lève jamais et rend deux fois la même sortie.
- [ ] **Step 2: Run** `npx vitest run --project domain test/program/preview` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(domain): aperçu des charges d'un changement et garde de hausse`.

### Task 11: Serveur : migration `0007_coach`, schéma et registre

**Files:**
- Create: `apps/server/src/db/migrations/0007_coach.ts`, `apps/server/test/db/coach-migration.test.ts`
- Modify: `apps/server/src/db/migrations/index.ts`, `apps/server/src/db/schema.ts`, `packages/contracts/src/entity-rules.ts`, `packages/contracts/test/entity-rules.test.ts`, `apps/server/test/db/{entity-rules,enum-consistency}.test.ts`, `apps/server/test/__snapshots__/schema.sql`, `apps/server/test/privacy/{export,delete}.test.ts`, `apps/server/test/sync/pull-leak.test.ts`, `docs/superpowers/specs/2026-10-06-appsport-design/09-modele-de-donnees.md` (§4 : colonnes de C44, `coach_thread_id` sans clé)

**Interfaces:**
- Consumes: Task 5 (constantes des énumérations).
- Produces : `coachTables: Migration` (`id: '0007_coach'`, `breaking: false`) : les 6 tables du §6.1, STRICT, CHECK des énumérations (valeurs figées, recoupées par `enum-consistency`), `json_valid` sur `brief`, `blocks`, `display_extras`, `comment` ≤ 500, `UNIQUE (user_id, day)`, `UNIQUE (thread_id, seq)`, `UNIQUE (thread_id, client_message_id)`, index du §6.1, ligne `coach_state` (`id` 1, `enabled` 0, `suspended_until` NULL, `updated_at` = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`) ; interfaces Kysely `CoachThreadTable`, `CoachMessageTable`, `CoachCallTable`, `CoachReportTable`, `CoachSafetyCounterTable`, `CoachStateTable` ; règles du tableau §6.2.

- [ ] **Step 1: Write the failing tests** —
  - `coach-migration.test.ts` : base vide → 6 tables, `coach_state` = `{id: 1, enabled: 0, suspended_until: null}` ; base au schéma de la brique 3 migrée sans perte ; deux fils même `(user_id, day)` → contrainte ; `closed_reason = 'other'` et `role = 'tool'` → CHECK ; suppression d'un `user` → plus aucune ligne de ses 4 tables personnelles, `coach_safety_counter` et `coach_state` restent ; suppression d'un fil → ses messages partent.
  - registre : « 18 tables du socle, 5 du catalogue, 7 des programmes, 6 du coach » ; les 6 en classe H, `clientWritable` vide, catégories, `ownerColumn` et C2 du tableau §6.2 ; `mirroredTables()` inchangé.
  - export : un fil, 2 messages, un `coach_call`, un signalement → `tables.coach_thread`, `coach_message` (`blocks` compris), `coach_call`, `coach_report`, toutes colonnes, rien d'un autre membre ; `coach_safety_counter` et `coach_state` absents. Suppression du compte : aucune ligne du coach de la personne. `pull-leak` : aucune table du coach dans un pull.
- [ ] **Step 2: Run** `npx vitest run --project server test/db test/privacy/export.test.ts test/privacy/delete.test.ts test/sync/pull-leak.test.ts` et `npx vitest run --project contracts test/entity-rules.test.ts` — FAIL.
- [ ] **Step 3: Implement** (style `table()` de `0004_program.ts`) ; régénérer `schema.sql`.
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): tables du coach (0007_coach) et registre`.

### Task 12: Serveur : `AiClient.chat()` et faux client scripté

**Files:**
- Create: `apps/server/src/ai/chat.ts`, `apps/server/test/ai/{chat,fake-chat}.test.ts`
- Modify: `apps/server/src/ai/{client,fake,index}.ts`, `scripts/exercises/NOTES.md` (prix datés des modèles de repli)

**Interfaces:**
- Consumes: Task 6 (`ApiBlock`, `ApiMessage`) ; `CachedBlock`, `TokenUsage`, `costUsd`, `toStructuredSchema`.
- Produces (`chat.ts`) :
  - `AiTool {name: string; description: string; inputSchema: Record<string, unknown>}` ;
  - `AiChatRequest {model: string; effort: AiEffort; maxTokens: number; system: readonly CachedBlock[]; tools: readonly AiTool[]; messages: readonly ApiMessage[]; thinkingBinding: 'drop_block' | 'error'; fallbacks: 'default' | null; timeoutMs: number; signal: AbortSignal}` ;
  - `AiChatEvent = {type: 'text_delta'; text: string} | {type: 'block_start'; index: number; block: 'thinking' | 'redacted_thinking' | 'text' | 'tool_use' | 'fallback' | 'other'} | {type: 'block_stop'; index: number}` ;
  - `AiIteration {type: string; model: string; usage: TokenUsage}` ;
  - `AiChatFinal {blocks: ApiBlock[]; stopReason: string; stopDetails: {category: string | null; explanation: string | null; recommendedModel: string | null} | null; model: string; usage: TokenUsage; iterations: AiIteration[] | null; thinkingDropped: number; fallbackUsed: boolean; costUsd: number; priceUnknown: boolean}` ;
  - `buildChatParams(req: AiChatRequest): {body: Record<string, unknown>; betas: string[]}` — requête sérialisée ; seul endroit des champs que le SDK 0.135 ne type pas (`fallbacks`, `block_binding`, rôle `system`) ;
  - `chatCost(model: string, usage: TokenUsage, iterations: readonly AiIteration[] | null): {costUsd: number; priceUnknown: boolean}` ; `HIGHEST_PRICES` = l'entrée de `MODEL_PRICES` au plus haut prix de sortie ;
  - `classifyAiError(error: unknown): AiErrorCode` (un seul tableau de cas) ;
  - `AiClient.chat(req: AiChatRequest, onEvent: (e: AiChatEvent) => void): Promise<AiChatFinal>` par `client.beta.messages.stream` ; lève `AiError` du code classé.
- `AiErrorCode` gagne `rate_limited`, `overloaded`, `server`, `network`, `spend_limit`, `bad_request`, `auth`, `aborted`, `timeout` ; `MODEL_PRICES` gagne `claude-opus-5` et `claude-opus-4-8`, relevés sur la page Pricing et datés dans `NOTES.md`.
- `fake.ts` : `FakeChatTurn = {events?: AiChatEvent[]; final: Partial<AiChatFinal> & Pick<AiChatFinal, 'blocks' | 'stopReason'>; gate?: Promise<void>} | {error: AiError; afterEvents?: AiChatEvent[]}` ; `createFakeAiClient(responses, {model?, chat?: readonly FakeChatTurn[] | ((req: AiChatRequest, call: number) => FakeChatTurn)})` ; `FakeAiClient.chatCalls: readonly AiChatRequest[]`, `chatParams: readonly ReturnType<typeof buildChatParams>[]` ; aides `fakeText(text, opts?)` (deltas de 7 caractères), `fakeToolUse(id, name, input, opts?)`, `fakeRefusal(category)`, `fakeFallbackText(text, fromModel, toModel)` ; le faux respecte `req.signal` (`AiError('aborted')`) et attend `gate` avant ses derniers événements.

- [ ] **Step 1: Write the failing tests** —
  - `chat.test.ts` (`fetch` du SDK remplacé, flux de l'API rejoué) : **fil `adult`** → `body.fallbacks === 'default'`, `betas` = `['thinking-binding-controls-2026-08-01', 'server-side-fallback-2026-07-01']`, `thinking` = `{type: 'adaptive', block_binding: {prefix_mismatch_behavior: 'drop_block'}}` sans `display`, `output_config` = `{effort: 'low'}`, `strict: true` sur chaque outil, ni `tool_choice`, ni `metadata`, ni `inference_geo`, ni `temperature`, ni `eager_input_streaming`, `cache_control: {type: 'ephemeral'}` sur les blocs système marqués et le dernier bloc du dernier message ; **fil `minor`** (`fallbacks: null`) → ni `fallbacks` ni bêta `server-side-fallback-*` ; **flux** → deltas dans l'ordre, `block_start` des 4 types, final avec `stop_details`, `iterations`, `thinkingDropped` = nombre d'entrées `input_transformations` de type `thinking_dropped` ; message `role: 'system'` final sérialisé tel quel ; `timeoutMs` dépassé → `timeout` ; `signal` aborté → `aborted`.
  - `chatCost` : itérations `claude-opus-5-5` puis `claude-opus-5` → somme des deux prix ; sans `iterations` → usage de tête au prix de `model` ; modèle inconnu → `HIGHEST_PRICES`, `priceUnknown: true`.
  - `classifyAiError` (tableau statut, type, message) : 429 `rate_limit_error` → `rate_limited` ; 429 `enforced_spend_limit_reached` → `spend_limit` ; 400 « specified workspace API usage limits » → `spend_limit` ; autre 400 → `bad_request` ; 401, 403 → `auth` ; 500, 502, 503 → `server` ; 529 `overloaded_error` → `overloaded` ; `APIConnectionError` → `network` ; `APIConnectionTimeoutError` → `timeout` ; `APIUserAbortError` → `aborted`.
  - `fake-chat.test.ts` : tours rejoués, `chatCalls` et `chatParams` enregistrés, erreur prévue levée, `gate` et `signal` respectés.
- [ ] **Step 2: Run** `npx vitest run --project server test/ai` — FAIL (tests de `complete()` existants verts).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): AiClient.chat() en flux, coût par itération et classement des erreurs`.

### Task 13: Vérification sur la vraie API — **bloquée tant que le propriétaire n'a pas posé la clé `rune-dev`**

**Files:**
- Create: `scripts/coach-eval/verify-api.ts`, `scripts/coach-eval/NOTES.md`, `scripts/test/coach-eval/verify-api.test.ts`
- Modify si un écart apparaît : `apps/server/src/ai/{chat,fake}.ts`, `apps/server/test/ai/chat.test.ts`

**Interfaces:**
- Consumes: Task 12.
- Produces : `verifyApi(client: AiClient, opts: {model: string}): Promise<VerifyReport>` avec `VerifyReport {checks: {id: 'fallbacks_default' | 'fallback_shape' | 'block_binding' | 'input_transformations' | 'system_last' | 'spend_limit_shape'; ok: boolean; note: string}[]; costUsd: number}` ; CLI `node --import tsx scripts/coach-eval/verify-api.ts` : clé lue comme `exercises:draft` (`.env.local` d'abord), refus sous `CI`, 6 appels au plus, coût affiché.

- [ ] **Step 1: Write the failing test** — `verify-api.test.ts` (fetch factice) : réponses conformes au §5.3 → 6 contrôles `ok` ; 400 sur `fallbacks` → `fallbacks_default` en échec, message de l'API dans `note` ; `CI=1` → refus sans appel ; sans clé → « Clé rune-dev absente : pose ANTHROPIC_API_KEY dans .env.local ».
- [ ] **Step 2: Run** `npx vitest run --project scripts test/coach-eval/verify-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS ; commit `feat(scripts): vérification de AiClient.chat() sur la vraie API`.
- [ ] **Step 5 (bloqué jusqu'à la clé) : Run** `node --import tsx scripts/coach-eval/verify-api.ts` (moins de 1 $) et noter, datés, dans `scripts/coach-eval/NOTES.md` : `fallbacks: "default"` accepté avec son en-tête, forme du bloc `fallback` et de `usage.iterations` ; `block_binding` accepté avec son en-tête, forme d'`input_transformations` ; message `role: "system"` final accepté par `claude-opus-5-5` ; forme de l'erreur de limite de dépense (statut, type, message), provoquée sur un workspace plafonné par le propriétaire ou, à défaut, relevée dans la documentation des erreurs d'Anthropic, avec la source.
- [ ] **Step 6: Fix** chaque écart dans `buildChatParams`, la lecture du flux, `classifyAiError` et le faux client, avec son cas ajouté au tableau de `chat.test.ts` ; Run `pnpm test` — PASS ; commit `fix(server): AiClient.chat() aligné sur la vraie API`. Les tâches suivantes reprennent ces corrections sans avoir attendu cette tâche.

### Task 14: Serveur : état du coach, garde de démarrage, mode dev, registre des échanges

**Files:**
- Create: `apps/server/src/coach/{state,registry}.ts`, `apps/server/test/coach/{state,registry,startup}.test.ts`, `apps/server/test/support/coach.ts`
- Modify: `apps/server/src/{config,deps,main,startup}.ts`, `apps/server/src/auth/security-log.ts`, `apps/server/test/config.test.ts`, `apps/server/test/support/{context,index}.ts`

**Interfaces:**
- Consumes: Tasks 6 (`COACH_CONFIG`, `isEvaluated`, `nextParisMonthStart`), 11, 12.
- Produces :
  - `AppConfig.coachDevAllowUnevaluated: boolean` (`COACH_DEV_ALLOW_UNEVALUATED === '1'`) ; avec une `APP_ORIGIN` en `https`, `loadConfig` lève `ConfigError('COACH_DEV_ALLOW_UNEVALUATED est réservé au développement (APP_ORIGIN en http://localhost ou http://127.0.0.1).')`.
  - `AppDeps.ai: AiClient | null`, `AppDeps.coachConfig: CoachConfig` (défaut `COACH_CONFIG`), `AppDeps.coach: CoachRuntime` ; `startServer(env, {ai?: AiClient})` : à défaut, `createAnthropicClient` si la clé est posée, sinon `null` ; à l'arrêt, `deps.coach.exchanges.abortAll('shutdown')` avant la fermeture HTTP.
  - `CoachConfigCheck = {ok: true; devUnevaluated: boolean; catalogVersion: string} | {ok: false; cause: 'no_key' | 'model_not_allowed' | 'not_evaluated'}` ; `checkCoachConfig(deps: AppDeps, catalogVersion: string): CoachConfigCheck` (`deps.ai` nul → `no_key` ; `COACH_MODEL` hors `allowedModels` ou sans prix → `model_not_allowed` ; combinaison `{model, effort, promptVersion, toolsVersion, briefSchema, catalogVersion}` absente d'`evaluated` → `not_evaluated`, sauf mode dev) ;
  - `CoachRuntime {configured: CoachConfigCheck; exchanges: ExchangeRegistry}` ; `refreshCoachConfig(deps): Promise<CoachConfigCheck>` (lit `server_meta.catalog_version`, met à jour `deps.coach.configured`, journalise `coach_not_configured` avec `code: cause` seulement) ; `COACH_STARTUP_TASK` après `CATALOG_STARTUP_TASK` ;
  - `readCoachState(db): Promise<{enabled: boolean; suspendedUntil: string | null; updatedAt: string}>` ; `setCoachEnabled(trx, deps, enabled: boolean, actor): Promise<CoachConfigCheck>` (activer relance `refreshCoachConfig` ; `coach_state_changed`) ; `suspendCoach(trx, deps, now: Date): Promise<void>` (`suspended_until = nextParisMonthStart(now)`, `coach_suspended`) ; `resumeCoach(trx, deps, actor)` ; `catalogChangedSinceEvaluation(deps): Promise<boolean>` ;
  - `ExchangeRegistry` (`createExchangeRegistry(clock, timeoutMs)`) : `begin(userId: string): {signal: AbortSignal; done(): void} | null` (null si un échange est en cours ; délai `exchangeTimeoutMs`) ; `inProgress(userId): boolean` ; `abortFor(userId, reason: 'consent_withdrawn'): void` ; `abortAll(reason: 'shutdown'): Promise<void>` (attend les `done`, 2 s au plus) ; `signal.reason` ∈ `'shutdown' | 'consent_withdrawn' | 'timeout'` ;
  - `SecurityEventType` gagne `coach_state_changed`, `coach_suspended`, `coach_report_created`, `coach_report_classified` ;
  - support de test : `enableCoach(ctx: TestContext, chat: readonly FakeChatTurn[] | ((req, call) => FakeChatTurn)): Promise<FakeAiClient>` (faux client dans `ctx.deps.ai`, entrée `evaluated` pour la combinaison et la `catalogVersion` courantes dans `ctx.deps.coachConfig`, `enabled = 1`, `refreshCoachConfig`).

- [ ] **Step 1: Write the failing tests** —
  - `config.test.ts` : `COACH_DEV_ALLOW_UNEVALUATED=1` avec `http://localhost:3000` → vrai ; avec `https://rune.test.ts.net` → `ConfigError` ; absente → faux.
  - `state.test.ts` : sans client → `no_key` ; `COACH_MODEL=claude-fable-5-1` → `model_not_allowed` ; `claude-opus-5-5` sans entrée → `not_evaluated` ; entrée à la bonne `catalogVersion` → `ok` ; mode dev sans entrée → `{ok: true, devUnevaluated: true}` ; catalogue publié en marche → `configured` reste `ok`, `catalogChangedSinceEvaluation` vrai, puis `setCoachEnabled(true)` → `not_evaluated` ; `suspendCoach` à `2026-10-31T23:30:00Z` → `suspended_until = '2026-11-30T23:00:00.000Z'` et `coach_suspended` ; journal : `coach_not_configured` avec `code`, sans clé ni modèle.
  - `registry.test.ts` : second `begin` du même membre → null, d'un autre → bail ; `done` libère ; `abortFor` aborte avec `consent_withdrawn` ; `abortAll` attend un `done` différé de 500 ms et rend la main à 2 s au plus sans `done` ; faux minuteurs à 180 000 ms → `signal.reason === 'timeout'`.
  - `startup.test.ts` : `startServer` sans clé démarre, `GET /health` 200, coach `not_configured`.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/state.test.ts test/coach/registry.test.ts test/coach/startup.test.ts test/config.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): état du coach, garde de démarrage, mode dev et registre des échanges`.

### Task 15: Serveur : fils, dossier figé et instantané de la garde

**Files:**
- Create: `apps/server/src/coach/{threads,brief-input,views}.ts`, `apps/server/test/coach/{threads,brief-input,views}.test.ts`
- Modify: `apps/server/src/startup.ts` (`COACH_THREADS_STARTUP_TASK`)

**Interfaces:**
- Consumes: Tasks 6, 9, 11, 14 ; `toSessionRecords`, `acceptedChanges`, `placesOf`, `parseSnapshot`, `replayInstance`, `userTraits`, `getConsentState`, `currentCatalog`.
- Produces :
  - `CoachVersions {model; effort; promptVersion; toolsVersion; briefSchema}` ; `currentVersions(deps, audience: AgeBand): CoachVersions` (`promptVersion` = `promptVariant(audience)`) ;
  - `loadReplayInput(db, deps, userId): Promise<ReplayInput | null>` (instance active, ses séances, changements acceptés, lieux supprimés compris, surcharges ; null sans instance) et `loadPlanContext(db, deps, userId, now: Date): Promise<Omit<PlanInput, 'replay' | 'workoutId'>>` (lieu principal, catalogue servi, profil, âge, contexte, jour de Paris, dernières charges, niveau) — mêmes lectures que `replayInstanceInDb`, réutilisées par l'aperçu (tâche 18) ;
  - `loadBriefInput(db, deps, userId, now: Date): Promise<CoachBriefInput>` (séances `completed` des 28 derniers jours, lieux vivants, instance active et son rejeu par `loadReplayInput`, propositions en attente, modèles servis, limitations, accords) ;
  - `ThreadRow = Selectable<CoachThreadTable>` ; `openTodayThread(deps, userId, now: Date): Promise<ThreadRow>` (une transaction ; public par `coachAudience(birth_date, parisDate(now))`, jamais du client ; voix `training_profile.coach`, `scribe` si nulle ; versions courantes ; `brief` = `json` de `buildCoachBrief` ; conflit `UNIQUE (user_id, day)` → relit le fil gagnant) ; `todayThread(db, userId, day): Promise<ThreadRow | undefined>` ; `closeIfFrozenStale(trx, deps, thread): Promise<boolean>` (`version_change`) ; `COACH_THREADS_STARTUP_TASK` ; `deleteThread(trx, deps, userId, id): Promise<void>` et `deleteAllThreads(trx, deps, userId): Promise<void>` (`instance_change.coach_thread_id` à NULL avec rev neuf, `coach_call.thread_id` à NULL, puis suppression) ;
  - `loadGuardSnapshot(db, deps, userId, now: Date): Promise<GuardSnapshot>` (`countedToday` = `coach_call.counted = 1` du jour de Paris ; `monthSpentUsdMicros` = somme des `cost_usd_micros` dont `day` est dans `parisMonthOf(parisDate(now))`) ;
  - `views.ts` : `messageView(row): CoachMessageView | null` (null pour `system` et les tours d'outils) ; `threadView(row): CoachThreadView` ; `coachStatus(db, deps, userId, now): Promise<CoachStatusView>` (`remaining` = 30 − `countedToday`, `budgetUsedPct` entier, `needsRenewal`, `inProgress` du registre, `devUnevaluated`) ; `coachToday(…)` ; `coachThreads(db, userId, now)` (90 jours) ; `coachThread(db, userId, id)` (404 si à un autre) ; `coachBrief(db, deps, userId, now): Promise<CoachBriefResponse>` (JSON stocké du fil du jour, sinon aperçu `preview: true` non stocké).

- [ ] **Step 1: Write the failing tests** —
  - `threads.test.ts` : **ouverture concurrente** → deux `openTodayThread` simultanés rendent le même `id`, une seule ligne ; **gel** → `deps.config.coachModel` changé → `closeIfFrozenStale` vrai, `version_change` ; la tâche de démarrage ferme tous les fils concernés et seulement eux ; **public** → né le 2008-11-04 : fil du 2026-11-03 `minor` (`coach-1/minor`), du 2026-11-04 `adult` ; **voix nulle** → `scribe` ; **suppression puis réouverture le même jour** → nouveau fil du même `day`, `instance_change.coach_thread_id` du fil supprimé à NULL avec un `rev` plus haut, `coach_call.thread_id` à NULL.
  - `brief-input.test.ts` : `brief` stocké = `buildCoachBrief(loadBriefInput(…)).json` au même instant ; une séance d'il y a 29 jours absente ; limitations seulement avec les deux accords ; `replayInstance(loadReplayInput(…))` rend les mêmes `slot_state` que `replayInstanceInDb` vient d'écrire ; sans instance → `null`.
  - `views.test.ts` : **minuit de Paris** (Review Focus 2) → à `2026-10-31T23:30:00Z`, une ligne `coach_call` du `day` `2026-10-31` ne compte ni dans `countedToday` ni dans le mois, une du `2026-11-01` compte dans les deux ; messages `system` et tours d'outils absents ; `display_extras` rendu en `helpCards`, `proposalIds`, `links`, `replaced` ; `devUnevaluated` vrai seulement en mode dev ; brief sans fil → `preview: true`, aucune ligne écrite.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/threads.test.ts test/coach/brief-input.test.ts test/coach/views.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): fils du coach, dossier figé et instantané de la garde`.

### Task 16: Serveur : accord `ai_coach`, désactivation et retrait santé

**Files:**
- Create: `apps/server/src/coach/consent.ts`, `apps/server/test/coach/consent.test.ts`
- Modify: `packages/contracts/src/api/consent.ts` (`GrantConsentRequest.type` et `WithdrawConsentRequest.type` = `ConsentTypeSchema`), `apps/server/src/privacy/{consent-routes,consent,reapply}.ts`, `apps/server/test/privacy/{consent,reapply,replay-withdraw,withdraw}.test.ts`

**Interfaces:**
- Consumes: Tasks 5 (`CURRENT_CONSENT_TEXTS`), 14 (`abortFor`), 15 (`deleteAllThreads`).
- Produces :
  - `withdrawCoachConsent(trx, deps, userId, actor: {actorId: string | null; ip: string | null}, opts?: {replay?: boolean}): Promise<void>` — sans effet si l'accord n'est pas actif ; dans l'ordre du §6.3 : `instance_change.coach_thread_id` à NULL (rev neuf), propositions `proposed` d'auteur `coach` supprimées logiquement (rev neuf), `deleteAllThreads`, `coach_report` de la personne supprimés, événement `withdraw`, `consent_revoked` `{consentType: 'ai_coach'}` ; la route appelle `deps.coach.exchanges.abortFor(userId, 'consent_withdrawn')` après la validation ;
  - `coachHealthWithdrawHook: HealthWithdrawHook` (entrée `coach_thread` de `HEALTH_WITHDRAW_HOOKS`) : fils ouverts fermés (`health_withdrawn`), `brief` à NULL sur tous ses fils, `blocks` à NULL sur tous ses messages ; la route du retrait santé interrompt aussi l'échange en cours ;
  - routes : `POST /api/me/consents` accepte `ai_coach` à la version exacte `AI_COACH_CONSENT_TEXT.version` (sinon 400 `validation`) ; `POST /api/me/consents/withdraw {type: 'ai_coach', password}` ; `POST /api/me/consents/ai_coach/replay-withdraw` (mêmes trois conditions et même limiteur que le renvoi santé) ; `reapplyPrivacyEvents` traite `consentType: 'ai_coach'`.

- [ ] **Step 1: Write the failing tests** —
  - **accord** : version `1.0` → actif ; `0.9` → 400 `validation` ; accord identique → rien d'écrit.
  - **retrait coach** : mot de passe faux → 401, rien d'effacé ; bon → plus aucune ligne `coach_thread`, `coach_message`, `coach_report` de la personne ; `coach_call` gardées, `thread_id` NULL ; proposition `proposed` du coach → `deleted_at` posé, rev neuf ; proposition acceptée du coach gardée, `coach_thread_id` NULL, rev neuf ; propositions du moteur intactes ; `consent_revoked` avec `consentType: 'ai_coach'` ; un échange inscrit au registre reçoit `consent_withdrawn`.
  - **retrait santé** : fil ouvert → `is_open = 0`, `health_withdrawn` ; `brief` NULL sur tous ses fils ; `blocks` NULL, `display_text` gardé ; `coach_report.exchange_text` gardé ; échange en cours interrompu.
  - **renvoi R-SYN-28** : accepté pour un `withdrawnAt` entre l'accord et le début de l'époque ; sinon 409 `conflict` ; 21e appel de l'heure → 429.
  - **`privacy:reapply`** : un retrait `ai_coach` postérieur à la sauvegarde → `consentsWithdrawn: 1`, fils supprimés.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/consent.test.ts test/privacy` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): accord ai_coach, désactivation et retrait santé du coach`.

### Task 17: Serveur : outils `read_training` et `search_exercises`

**Files:**
- Create: `apps/server/src/coach/tools/{types,index,read-training,search-exercises}.ts`, `apps/server/test/coach/tools/{read-training,search-exercises,registry}.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 9 (`briefProgram`, `briefHistory`, `briefRecords`, `estimateTokens`), 12 (`AiTool`, `toStructuredSchema`), 15 (`loadBriefInput`) ; `normalize`, `feasible`.
- Produces (`tools/types.ts`, `tools/index.ts`, les deux outils) :
  - `PendingProposal {id: string; baseRevision: number; operations: InstanceChangeOperation[]; reason: string; model: string | null}` (`model` posé par la tentative : modèle de l'itération qui a fait l'appel) ;
  - `AttemptToolState {proposals: PendingProposal[]; invalidProposals: number; helpCards: HelpResourceId[]}` (neuf à chaque tentative) ; `ToolContext {db: DbExecutor; deps: AppDeps; userId: string; thread: {id: string; audience: AgeBand; promptVersion: string}; now: Date; state: AttemptToolState}` ;
  - `ToolOutcome {result: unknown; isError: boolean}` ; `CoachTool {name: CoachToolName; description: string; input: z.ZodType; run(input: unknown, ctx: ToolContext): Promise<ToolOutcome>}` ;
  - `TOOLS_1: readonly CoachTool[]` (triés par nom) ; `toolDefinitions(tools: readonly CoachTool[]): AiTool[]` (`z.toJSONSchema` puis `toStructuredSchema`) ; `runTool(name: string, raw: unknown, ctx: ToolContext): Promise<ToolOutcome>` (revalide par le schéma Zod complet ; invalide → `{isError: true, result: {errors: [{path, code: 'invalid_input', message}]}}`, une entrée par problème Zod, `path` joint par des points, `message` celui du schéma ; nom inconnu → `code: 'unknown_tool'`).
  - `read_training` : `{revision, program, sessions, decisions, records, pending_proposals, truncated}` aux formes du dossier, `since_days` jours au plus, filtre `exercise_id` ; `pain` seulement si l'accord santé est actif à l'instant de l'appel ; au-delà de 4 000 jetons estimés, séances les plus anciennes retirées et `truncated: true` ; pas de `e1rm_kg` pour un mineur ; description en français qui dit « 28 jours au plus ».
  - `search_exercises` : fiches `published`, 10 au plus, filtres `query` (`normalize`), `muscle`, `movement_pattern`, et par défaut faisables dans au moins un lieu vivant (sans lieu : toutes, C25) ; sans `not_for_minors` pour un mineur ou un profil prudent ; tri pertinence, puis niveau, puis nom ; champs du §10 dont `feasible_at` (`lieu_n`) et `total_matching`.

- [ ] **Step 1: Write the failing tests** —
  - `read-training.test.ts` : `since_days` 28 accepté, 29 et 90 → `isError`, code `invalid_input`, message « 28 jours au plus » ; séance d'il y a 29 jours absente ; accord santé actif → `pain` ; retiré entre deux appels → absent ; mineur → aucun `e1rm_kg` ; 60 séances → `truncated: true` et estimation ≤ 4 000 ; membre sans programme ni séance (Review Focus 4) → `program: null`, listes vides, `isError` faux.
  - `search-exercises.test.ts` : prudent et mineur → aucune fiche `not_for_minors` ; fiche faisable seulement au lieu secondaire → rendue avec `feasible_at: ['lieu_2']` ; `available_equipment_only: false` → fiches infaisables comprises ; sans lieu → toutes les publiées (Review Focus 4) ; 15 correspondances → 10 rendues, `total_matching: 15` ; aucune `draft` ; ordre niveau puis nom à pertinence égale.
  - `registry.test.ts` : `runTool('read_training', {since_days: '7'})` → `isError`, `errors[0]` = `{path: 'since_days', code: 'invalid_input'}` ; `runTool('x', {})` → `unknown_tool` ; noms triés.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/tools` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): outils read_training et search_exercises`.

### Task 18: Serveur : `propose_program_change`, `refer_to_help` et écriture des propositions

**Files:**
- Create: `apps/server/src/coach/tools/{propose-program-change,refer-to-help}.ts`, `apps/server/src/coach/proposals.ts`, `apps/server/test/coach/tools/{propose,refer-to-help,limits}.test.ts`, `apps/server/test/coach/proposals.test.ts`
- Modify: `apps/server/src/coach/tools/index.ts` (les 4 outils)

**Interfaces:**
- Consumes: Tasks 8 (`outputFilter`), 10 (`changePreview`, `loadIncreases`), 15 (`loadReplayInput`, `loadPlanContext`), 17 (`PendingProposal`, `ToolContext`) ; `instanceProgram`, `expireProposals`, `validateChange`, `currentCatalog`.
- Produces :
  - `ProposalErrorCode = ChangeErrorCode | 'invalid_input' | 'one_proposal_per_message' | 'no_active_program' | 'stale_revision' | 'coach_load_increase' | 'reason_blocked' | 'corrections_exhausted'` ; `PROPOSAL_ERROR_MESSAGES: Record<ProposalErrorCode, string>` (français, dit quoi corriger ; `stale_revision` cite la révision courante) ;
  - `propose_program_change` : étapes 1 à 7 du §12.2 dans l'ordre, première erreur rendue `{errors: [{op, code, message}]}` (`op` = index de l'opération, -1 pour le changement entier) ; après 3 appels invalides dans la tentative, tout appel rend `corrections_exhausted` ; succès `{ok: true, change_id, expires_in_days: 7}` et `PendingProposal` dans `ctx.state.proposals`, rien en base ;
  - `refer_to_help` : `{shown: true, resource, label, phone}` de `HELP_RESOURCES`, ressource ajoutée à `ctx.state.helpCards`, rien en base ;
  - `insertCoachProposal(trx, deps, p: PendingProposal, ctx: {userId: string; threadId: string; promptVersion: string; now: Date; healthConsent: boolean}): Promise<void>` (§12.3 : `expireProposals` ; propositions `proposed` du coach → `expired`, rev neuf ; insertion `author = coach`, `reason_code = COACH_PROPOSAL`, `reason` seulement avec l'accord santé, `status` `proposed` ou `expired` si la révision a changé ou l'instance n'est plus active, `expires_at` = +7 jours, `ai_generated = 1`, `ai_model`, `prompt_version`, `coach_thread_id`).

- [ ] **Step 1: Write the failing tests** —
  - `propose.test.ts` : valide → `ok`, `change_id`, `expires_in_days: 7`, aucune ligne `instance_change` ; seconde valide dans la tentative → `one_proposal_per_message` ; sans instance (Review Focus 4) → `no_active_program` ; `base_revision` périmée → `stale_revision` avec la révision courante dans `message` ; `resume_slot` → `invalid_input` ; `add_slot` en prudent → `forbidden_cautious` ; remplacement vers une fiche faite à 60 kg quand la courante est à 40 kg → `coach_load_increase` ; motif « Fais une sèche. » → `reason_blocked` ; 3 invalides puis une valide → `corrections_exhausted` ; 2 invalides puis une valide → `ok`.
  - `refer-to-help.test.ts` : `eating_disorder` → `phone: '09 69 325 900'`, ressource dans l'état, aucune écriture ; ressource hors liste → `invalid_input`.
  - `proposals.test.ts` : proposition précédente du coach en attente → `expired`, rev neuf ; celle du moteur → intacte ; sans accord santé → `reason` NULL ; révision changée entre validation et écriture → `expired` ; `expires_at` = création + 7 jours ; `ai_model` = modèle de l'itération.
  - `limits.test.ts` : sur `toolDefinitions(TOOLS_1)`, propriétés facultatives ≤ 24 et unions (`anyOf`) ≤ 16 ; les 4 noms de `COACH_TOOL_NAMES`, triés.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/tools test/coach/proposals.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): outils propose_program_change et refer_to_help, écriture des propositions`.

### Task 19: Serveur : prompts `coach-1`, voix des coachs et textes fixes

**Files:**
- Create: `apps/server/src/coach/prompts/{coach-1-adult,coach-1-minor,style-ombre,style-skald,style-scribe,index}.ts`, `apps/server/test/coach/prompts.test.ts`

**Interfaces:**
- Consumes: Tasks 5 (`FORBIDDEN_TERMS`), 6, 8.
- Produces : `PROMPTS: Record<'coach-1/adult' | 'coach-1/minor', string>` ; `STYLES: Record<CoachId, string>` ; `systemBlocks(promptVersion: 'coach-1/adult' | 'coach-1/minor', persona: CoachId, briefJson: string): CachedBlock[]` = `[{text: PROMPTS[promptVersion], cache: true}, {text: `${STYLES[persona]}\n\n<dossier>\n${briefJson}\n</dossier>`, cache: true}]` ; `regenerationNote(verdict: {rule: FilterRule; detail: string}): string` (un texte fixe par règle ; `forbidden_term` nomme le terme) ; `STANDARD_REPLY` = « Je préfère ne pas te répondre avec un chiffre ou un mot que je ne peux pas vérifier. Tes repères sont dans Mon programme, et la page « Bien utiliser le coach » explique ce que je peux faire pour toi. » ; `REFUSAL_MESSAGE` = « Le coach ne peut pas répondre à cette demande. ».
- Contenu, rédigé ici et relu par le propriétaire avant la tâche 32 : les 10 points du §13 dans les deux variantes, les ajouts de la variante `minor`, la liste des termes de chaque variante avec les tournures à préférer (« série à la limite », « avis d'un professionnel ») ; trois blocs de style tirés de la refonte §8 (L'Ombre froid et laconique, jamais humiliant ; le Skald chaleureux, qui raconte ; le Scribe calme et précis), qui règlent le ton, jamais le contenu ni la sécurité.

- [ ] **Step 1: Write the failing tests** — `systemBlocks('coach-1/minor', 'skald', '{}')` → 2 blocs `cache: true`, bloc 1 identique pour deux personas ; chaque prompt contient « Coach IA », « Claude », « Anthropic », « 28 jours » et les 4 noms d'outils ; `coach-1/minor` contient chaque `term` de `FORBIDDEN_TERMS.minor` et « adulte de confiance » ; `coach-1/adult` chaque `term` de `FORBIDDEN_TERMS.all` ; `STANDARD_REPLY` mot pour mot ; `STANDARD_REPLY`, `REFUSAL_MESSAGE` et les 3 notes de régénération passent `outputFilter` (adulte et mineur, aucune valeur autorisée) ; aucun chiffre dans les blocs de style.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/prompts.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): prompts coach-1, voix des trois coachs et textes fixes`.

### Task 20: Serveur : tentative (boucle d'outils et relais filtré)

**Files:**
- Create: `apps/server/src/coach/attempt.ts`, `apps/server/test/coach/attempt.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 8, 12, 17, 18.
- Produces :
  - `CallRecord {model: string; usage: TokenUsage; costUsd: number; priceUnknown: boolean; fallbackUsed: boolean; thinkingDropped: number; stopReason: string | null; refusalCategory: string | null}` ;
  - `AttemptInput {ai: AiClient; request: Omit<AiChatRequest, 'messages' | 'signal'>; messages: ApiMessage[]; tools: readonly CoachTool[]; toolCtx: ToolContext; filter: {audience: AgeBand; brief: unknown; threadToolResults: readonly unknown[]}; signal: AbortSignal; canCall(spentUsd: number): Promise<boolean>; emit(e: CoachStreamEvent): void; now(): number}` ;
  - `AttemptOutcome = {kind: 'answered'; text: string; turns: StoredApiMessage[]; truncated: boolean; stopReason: string; effectiveModel: string; toolRounds: number; toolResults: unknown[]; firstTextAtMs: number | null; calls: CallRecord[]} | {kind: 'blocked'; verdict: {rule: FilterRule; detail: string}; toolRounds: number; calls: CallRecord[]} | {kind: 'refused'; category: string | null; calls: CallRecord[]} | {kind: 'failed'; code: CoachStreamErrorCode | 'empty'; toolRounds: number; calls: CallRecord[]}` (`turns` : tours d'outils puis réponse finale, blocs tels que reçus) ;
  - `runAttempt(input: AttemptInput): Promise<AttemptOutcome>`.
- Règles (§8.3 à §8.6) : `canCall(coût de l'échange jusque-là)` avant chaque appel, faux → `failed` `monthly_budget_reached` ; `stop_reason` lu avant le contenu ; `tool_use` : un `tool_running {tool}` par bloc, gestionnaires dans l'ordre des blocs, tous les `tool_result` dans un seul message `user` ; 5e tour → `tool_rounds_exceeded` ; `max_tokens` : réponse gardée, `truncated`, bloc `tool_use` inachevé retiré et jamais exécuté ; `refusal` → `refused` ; `pause_turn`, `model_context_window_exceeded` et autres → `failed` `internal` ; deltas par `SentenceBuffer`, chaque phrase passée à `outputFilter` avec `allowedValues({brief, toolResults: [...threadToolResults, ...résultats de la tentative], constants: COACH_CONFIG.allowedConstants, nutritionFull: false})` et `nutritionMode: 'none'`, puis `emit({type: 'text'})` ; phrase bloquée → appel aborté, `blocked` ; texte de réflexion jamais relayé ; `help_card` et `proposal` émis quand l'outil réussit ; `fallbackUsed` par bloc `fallback` ou itération `fallback_message` ; `AiError` : `rate_limited`, `overloaded`, `server`, `network` → `api_unavailable` ; `spend_limit` → `spend_limit` ; `timeout` → `timeout` ; `aborted` → `signal.reason` ; `end_turn` sans texte relayé → `failed` `empty`.

- [ ] **Step 1: Write the failing tests** (faux client scripté) — **échange simple** : 3 phrases → 3 `text`, `answered` ; **un et quatre tours** : `read_training` puis texte → 2 appels, un `tool_running {tool: 'read_training'}` ; 4 tours puis texte → `answered` ; 5 tours → `tool_rounds_exceeded` ; **deux outils parallèles** → deux `tool_running` dans l'ordre, un seul message `user` à deux `tool_result` dans l'ordre des blocs ; **phrase bloquée** « Mets 65 kg. » sans 65 autorisé → `blocked {rule: 'unit', detail: '65 kg'}`, signal du faux aborté, aucune phrase après ; **valeur d'un outil d'un message précédent** (`threadToolResults` avec `load_kg: 65`) → relayée (C8) ; **`max_tokens`** avec `tool_use` inachevé → bloc retiré, outil non exécuté, `truncated` ; sans outil → texte gardé, `truncated` ; **refus** pendant le flux → `refused` avec la catégorie ; **repli** → `fallbackUsed`, `effectiveModel` = modèle de la réponse, coût par itération ; **budget** : `canCall` faux au 2e appel → `monthly_budget_reached`, un seul appel fait ; **erreurs** : 429 → `api_unavailable`, `spend_limit`, signal aborté `shutdown` → `failed` `shutdown` ; **réponse vide** (Review Focus 5) : `end_turn` sans texte après un outil → `failed` `empty` ; **requête** : `messages` = historique + message de l'utilisateur, `fallbacks: null` à chaque appel d'un fil mineur.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/attempt.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): tentative du coach, boucle d'outils et relais filtré`.

### Task 21: Serveur : échange (régénération, enregistrement atomique, plafonds, interruptions, journaux)

**Files:**
- Create: `apps/server/src/coach/{orchestrator,record}.ts`, `apps/server/test/coach/{orchestrator,record,logs,request}.test.ts`
- Modify: `apps/server/src/logger.ts` (`LogFields` : `rounds`, `blocks`)

**Interfaces:**
- Consumes: Tasks 6 (`historyForApi`, `coachAccessGuard`), 14, 15, 16, 18 (`insertCoachProposal`), 19, 20.
- Produces :
  - `PreparedExchange {userId: string; thread: ThreadRow; clientMessageId: string; text: string; lease: {signal: AbortSignal; done(): void}; startedAt: Date; day: string}` ;
  - `prepareExchange(deps, userId, body: CoachMessageRequest, now: Date): Promise<PreparedExchange>` — lève `HttpError` avant le flux : garde (`loadGuardSnapshot` puis `coachAccessGuard`), `validation` (texte vide après `cleanCoachText` ou `coachTextLength` > 2 000), fil ouvert ou gel contrôlé (`thread_closed {reason}`), `duplicate_message {seq}` ; inscrit l'échange au registre ;
  - `runExchange(deps, x: PreparedExchange, emit: (e: CoachStreamEvent) => void): Promise<void>` — `messages` = `historyForApi(fil)` + message de l'utilisateur ; `thinkingBinding: 'drop_block'` ; `fallbacks` = `'default'` pour `adult`, `null` pour `minor` ; au plus une régénération (mêmes messages + message de l'utilisateur + `{role: 'system', content: [{type: 'text', text: regenerationNote(verdict)}]}` en dernier), après `retry {reason: 'filter'}` ; second blocage → `STANDARD_REPLY` ; `failed` `empty` → `error internal` ; toute issue finit par `done`, `refused` ou `error`, puis `lease.done()` ;
  - `CallSummary {calls: CallRecord[]; toolRounds: number; filterBlocks: number; firstTextLatencyMs: number | null; stopReason: string | null; refusalCategory: string | null; errorCode: string | null; counted: boolean; durationMs: number}` ; `RecordedReply = {kind: 'answered'; attempt: Extract<AttemptOutcome, {kind: 'answered'}>; regenerationNote: string | null; state: AttemptToolState} | {kind: 'replaced'; regenerationNote: string}` ; `recordExchange(trx, deps, x: PreparedExchange, reply: RecordedReply, summary: CallSummary): Promise<{userSeq: number; assistantSeq: number; proposalIds: string[]}>` (une transaction du §8.7) ; `recordCallOnly(db, deps, x, summary): Promise<void>` ; `bumpCounter(trx, month: string, kind: CoachCounterKind, by?: number): Promise<void>` ; `cost_usd_micros` = `Math.ceil(somme × 1 000 000)` ; `counted` vrai dès qu'un appel a reçu une réponse (texte, outil, refus, coupure, réponse vide) ;
  - journal : `coach_exchange` avec `event` (`answered`, `replaced`, `refused`, `error`), `rounds`, `blocks`, `durationMs`, `code`, rien d'autre ; `price_unknown` avec `code` = modèle.

- [ ] **Step 1: Write the failing tests** —
  - `record.test.ts › enregistrement atomique` : échange réussi → message `user` (`display_text`, `client_message_id`), tours d'outils, réponse (`display_text` = texte relayé, `display_extras`, `effective_model`, `stop_reason`, `ai_generated = 1`), `user_message_count + 1`, `last_message_at`, une ligne `coach_call` (`api_calls`, jetons, `counted = 1`), compteurs `help_*` de la tentative retenue ; `done` après la validation avec `userSeq`, `assistantSeq`, `remainingToday` ; une erreur injectée dans l'écriture → rien du fil écrit, `error internal`.
  - `orchestrator.test.ts` : **régénération réussie** → 2e appel avec le message `system` en dernier, `retry` émis, aucune proposition de la tentative bloquée (ni événement, ni ligne), `filter_blocks = 1`, compteur `filter_block` + 1, message `system` enregistré ; **double blocage** → `STANDARD_REPLY` enregistrée (`blocks` un bloc texte, `replaced: true`, liens `program` et `coach_help`), `done.replaced`, `filter_blocks = 2` ; **refus avant et pendant le flux** → aucun message, `refusal_category`, `counted = 1`, compteur `refusal` + 1, `refused {message: REFUSAL_MESSAGE}` ; **refus d'un fil mineur** → un seul appel, aucun autre modèle, `fallback_used = 0` ; **proposition** → `proposal` puis `done.proposalIds`, ligne `instance_change` dans la même transaction, précédente du coach `expired`, celle du moteur intacte ; **limite de dépense** → `suspended_until` = 1er du mois suivant à minuit de Paris, `coach_suspended`, `error spend_limit`, `counted = 0` ; **budget atteint avant un tour** → `error monthly_budget_reached`, seule la ligne `coach_call` ; **429 après les essais du SDK** → `error api_unavailable`, `counted = 0` ; **retrait d'un accord pendant l'échange** → `error consent_withdrawn`, rien d'enregistré ; **`abortAll('shutdown')`** → `error shutdown`, `coach_call` écrite en moins de 2 s ; **délai** (faux minuteurs, 180 000 ms) → `error timeout` ; **réponse vide** (Review Focus 5) → `error internal`, aucun message, `counted = 1` ; **minuit de Paris** (Review Focus 2) → échange commencé à 23:59:58 de Paris, horloge avancée de 5 s pendant le flux : messages dans le fil du jour de départ, `coach_call.day` = jour de départ ; le message suivant ouvre le fil du nouveau jour.
  - `request.test.ts › requête sérialisée, pour chaque public` (`fake.chatParams`) : `metadata` et `tool_choice` absents, effort `low`, `strict` sur chaque outil, points de cache sur les 2 blocs système et le dernier bloc du dernier message, aucun canari du dossier ; `adult` : `fallbacks: 'default'` et ses deux bêtas ; `minor` : ni `fallbacks` ni `server-side-fallback-*`.
  - `logs.test.ts` (canari P-LOG-2) : après un échange avec un dossier, une note de séance et une réponse canaris, aucune ligne du journal technique ne contient le canari, le prompt, la réponse ni un identifiant de personne ; `coach_exchange` porte seulement `event`, `rounds`, `blocks`, `durationMs`, `code`.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/orchestrator.test.ts test/coach/record.test.ts test/coach/logs.test.ts test/coach/request.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): échange du coach, régénération, enregistrement atomique et plafonds`.

### Task 22: Serveur : routes `/api/coach` et flux SSE

**Files:**
- Create: `apps/server/src/coach/{routes,sse}.ts`, `apps/server/test/coach/{routes,stream}.test.ts`
- Modify: `apps/server/src/routes.ts` (`app.route('/api/coach', coachRoutes(deps))`)

**Interfaces:**
- Consumes: Tasks 15, 21.
- Produces : `coachRoutes(deps): Hono<AppEnv>` (routes du §7.1 hors consentements et signalements ; session exigée, `Origin` contrôlée pour les écritures) ; `sseStream(c: Context<AppEnv>, run: (send: (e: CoachStreamEvent) => void) => Promise<void>, opts?: {pingMs?: number}): Response` — en-têtes `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, sans compression ; `event: <type>\ndata: <JSON sans type>\n\n` ; `: ping\n\n` toutes les 15 s ; écritures ignorées une fois le téléphone parti, `run` va au bout (l'échange n'est pas lié à la déconnexion).

- [ ] **Step 1: Write the failing tests** —
  - `stream.test.ts` : en-têtes exacts ; événements `text`… `done` dans l'ordre ; `: ping` à 15 s (faux minuteurs, faux flux retenu par `gate`) ; téléphone déconnecté au milieu → échange enregistré ; `RunningServer.close()` pendant un flux → `error {code: 'shutdown'}` reçu.
  - `routes.test.ts` : second envoi pendant le premier → 409 `request_in_progress` ; même `clientMessageId` → 409 `duplicate_message {seq}` ; texte vide, de blancs, ou de 2 001 points de code → 400 `validation` ; 2 000 « 💪 » → accepté (Review Focus 3) ; fil fermé → 409 `thread_closed {reason: 'version_change'}` ; sans accord → 403 `consent_required` ; coach coupé → 503 `coach_unavailable` ; `Origin` étranger → 403 ; `GET /status`, `/today`, `/threads` (90 jours), `/threads/:id`, `/brief` (JSON stocké exact ; sans fil `preview: true`) ; `DELETE /threads/:id` et `/threads` → 204 ; identifiant d'un autre membre → 404, session admin comprise.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/routes.test.ts test/coach/stream.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): routes du coach et flux SSE`.

### Task 23: Serveur : signalements, administration et purge

**Files:**
- Create: `apps/server/src/coach/{reports,admin-routes,purge}.ts`, `apps/server/test/coach/{reports,admin,purge}.test.ts`
- Modify: `apps/server/src/routes.ts` (`app.route('/api/coach/reports', coachReportRoutes(deps))`), `apps/server/src/admin/{routes,members}.ts`, `packages/contracts/src/api/admin.ts` (`MemberSummary.aiCostMonthUsd: number`), `apps/server/src/jobs/registry.ts`, `apps/server/test/privacy/admin-isolation.test.ts`, `apps/server/test/admin/members.test.ts`, les jeux de test web qui construisent un `MemberSummary` (`apps/web/test/admin/*.test.tsx`)

**Interfaces:**
- Consumes: Tasks 5, 11, 14, 15.
- Produces :
  - `createReport(trx, deps, userId, req: CoachReportRequest): Promise<string>` — 404 si `(threadId, messageSeq)` n'est pas une réponse du coach de la personne ; `exchange_text` = `Toi : <message qui précède>\n\nCoach IA : <réponse>` ; `coach_report_created` sans contenu ; `coachReportRoutes(deps)` : `POST /` → 201 `{id}`.
  - `adminCoachRoutes(deps)` (sous `/api/admin/coach`, garde admin) : `GET /` → `CoachAdminView` (mois de Paris, coûts par membre en dollars à 2 décimales, total, `workspaceLimitUsd: 20`, compteurs des 12 derniers mois, signalements ouverts, `catalogChanged`) ; `PUT /state {enabled}` → `setCoachEnabled`, `coach_state_changed` ; `POST /resume` → `resumeCoach` ; `GET /reports` → `CoachReportSummary[]` (pseudo, mineur ou non) ; `GET /reports/:id` → `CoachReportDetail` ; `DELETE /reports/:id` → suppression, `coach_report_classified`.
  - `coachPurgeJob: DailyJob` (dans `DAILY_JOBS`) : fils dont `coalesce(last_message_at, created_at)` a plus de 90 jours (`coach_thread_id` à NULL d'abord, rev neuf) ; `coach_call` de plus de 12 mois ; `coach_report` de plus de 90 jours ; fils des jours passés encore ouverts → `is_open = 0`, `day_over`.
  - `listMembers` : `aiCostMonthUsd` (mois de Paris) ; aucun nombre de messages par personne.

- [ ] **Step 1: Write the failing tests** —
  - `reports.test.ts` : réponse du coach → 201, `exchange_text` exact, journal sans texte ; `messageSeq` d'un message de la personne → 404 ; fil d'un autre → 404 ; commentaire de 501 caractères → 400.
  - `admin.test.ts` : 2 membres, 3 `coach_call` dont une du mois précédent de Paris → coûts et total exacts, aucun champ de message ; `PUT /state {enabled: true}` sans évaluation → coach toujours `not_configured`, événement écrit ; `POST /resume` → `suspendedUntil: null` ; détail : `exchangeText`, `comment`, pseudo, `minor` ; `DELETE` → ligne supprimée, `coach_report_classified` ; membre → 403 ; `admin-isolation` : `/api/admin/coach/reports*` seules exemptées, aucune autre route admin ne rend de C1–C3.
  - `purge.test.ts` (horloge factice) : dernier message à 91 jours → fil supprimé, `instance_change.coach_thread_id` à NULL avec rev neuf ; 89 jours → gardé ; `coach_call` de 13 mois → supprimé, de 11 mois → gardé ; signalement de 91 jours → supprimé ; fil d'hier ouvert → `day_over`.
  - `members.test.ts` : 1 230 000 micros du mois → `aiCostMonthUsd: 1.23`.
- [ ] **Step 2: Run** `npx vitest run --project server test/coach/reports.test.ts test/coach/admin.test.ts test/coach/purge.test.ts test/admin test/privacy/admin-isolation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): signalements, administration du coach et purge quotidienne`.

### Task 24: Web : dépôt du coach, lecteur SSE et magasin en mémoire

**Files:**
- Create: `apps/web/src/repos/{coach-repo,sse-reader}.ts`, `apps/web/src/features/coach/coach-store.ts`, `apps/web/test/repos/{coach-repo,sse-reader}.test.ts`, `apps/web/test/coach/coach-store.test.ts`
- Modify: `apps/web/src/repos/index.ts` (`coach`)

**Interfaces:**
- Consumes: Task 5.
- Produces :
  - `readSse(body: ReadableStream<Uint8Array>, onEvent: (e: CoachStreamEvent) => void, opts?: {silenceMs?: number}): Promise<void>` — événements séparés par une ligne vide, `event:` et `data:` sur des morceaux quelconques, commentaires (`: ping`) ignorés mais comptés comme activité, chaque événement validé par `CoachStreamEventSchema` (nom inconnu ignoré) ; 30 s sans octet → `SseSilenceError` ;
  - `CoachRepo` (`coachRepoFor(services)`) : `status()`, `today()`, `send(input: CoachMessageRequest, onEvent, signal?: AbortSignal): Promise<void>` (POST par `services.transport.fetch` ; erreur JSON avant le flux → `ApiError`), `threads()`, `thread(id)`, `deleteThread(id)`, `deleteAllThreads()`, `brief()`, `report(req)`, `grant(textVersion)`, `withdraw(password)` ; hors ligne → `NetworkRequiredError`, aucune écriture locale ;
  - `CoachStore` (`coachStoreFor(services)`, un par `AppServices`) : état `{status: CoachStatusView | null; today: CoachTodayResponse | null; draft: string; pending: PendingExchange | null; phase: 'idle' | 'loading' | 'streaming' | 'error' | 'refused'; error: CoachStreamErrorCode | ApiErrorCode | 'offline' | 'silence' | null}`, `PendingExchange {clientMessageId; text; bubble: string; tool: CoachToolName | null; helpCards: HelpResourceId[]; proposals: CoachProposalEvent[]}` ; actions `load()` (`sync.flushBefore(4000)`, puis `status` et `today`), `setDraft(text)`, `send()` (`flushBefore(4000)` avant le premier message du jour ; UUIDv7 neuf ; `retry` efface `bubble` et les cartes ; `done` → relit `today`, `pullNow()` si `proposalIds` n'est pas vide, vide `draft` ; `error` → texte rendu à `draft` ; silence → erreur puis relecture de `today`), `retry()` (même `clientMessageId` ; 409 `duplicate_message` → relit `today`, vide `draft`), `pollInProgress()` (relit `today` toutes les 2 s, 3 min au plus) ; `useCoachStore()` ; état vidé à la déconnexion et au changement d'utilisateur ; rien dans Dexie ni dans le stockage du navigateur.

- [ ] **Step 1: Write the failing tests** —
  - `sse-reader.test.ts` : un flux coupé à chaque octet, et à des positions arbitraires (fast-check), rend les mêmes événements ; `: ping` seuls pendant 29 s puis un événement → pas d'erreur ; 30 s de silence (faux minuteurs) → `SseSilenceError` ; `data` invalide → erreur.
  - `coach-repo.test.ts` : corps envoyé exact ; 409 `request_in_progress` avant le flux → `ApiError` ; hors ligne → `NetworkRequiredError`.
  - `coach-store.test.ts` : `text` ajouté à `bubble` ; `retry` efface bulle et cartes ; `done` relit `today` et appelle `pullNow` avec `proposalIds` ; `error` rend le texte au champ ; `retry()` réutilise le `clientMessageId` ; 409 `duplicate_message` → `today` relu, champ vidé ; `pollInProgress` relit `today` toutes les 2 s, s'arrête dès `inProgress: false` et au plus tard à 3 min ; `flushBefore(4000)` appelé par `load` et avant le premier message du jour seulement ; tables Dexie inchangées, `localStorage` et `sessionStorage` vides ; **quitter `/coach` pendant le flux** (Review Focus 1) : `send` lancé, plus aucun abonné, le flux va jusqu'à `done`, un nouvel abonné voit la réponse finie et `phase: 'idle'`, un seul POST ; déconnexion → état vidé.
- [ ] **Step 2: Run** `npx vitest run --project web test/repos/coach-repo.test.ts test/repos/sse-reader.test.ts test/coach/coach-store.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): dépôt du coach, lecture du flux SSE et magasin en mémoire`.

### Task 25: Web : conversation et ses états

**Files:**
- Create: `apps/web/src/features/coach/{CoachPage,ChatBubble,Composer}.tsx`, `apps/web/src/features/coach/{coach-texts.ts,coach-page.module.css}`, `apps/web/test/coach/{coach-page.test.tsx,coach-texts.test.ts}`
- Modify: `apps/web/src/App.tsx` (`/coach` par `lazy`), `apps/web/test/architecture.test.ts`, `apps/web/test/ui/contrast.test.ts`

**Interfaces:**
- Consumes: Tasks 8 (`outputFilter`), 24 ; `CoachAvatar`, `SystemPanel`, `Banner`, `Page`.
- Produces : `CoachPage()` ; `coach-texts.ts` : `AI_BANNER` (06 §14 mot pour mot : « Tu échanges avec une intelligence artificielle (Claude, d'Anthropic), pas avec un humain. Ses conseils sont généraux et ne remplacent pas un professionnel de santé. En cas d'urgence : 15 ou 112. »), `WELCOME` (« Pose-moi une question sur ton programme, ta technique ou ta récupération. »), `SUGGESTIONS` (« Explique ma prochaine séance », « Pourquoi ma charge ne monte pas ? », « Ajuster mon programme »), `STATE_TEXTS` (tableau du §16.2 mot pour mot), `TOOL_LABELS` (`read_training` « Le coach consulte ton historique… », `search_exercises` « Le coach cherche des exercices… », `propose_program_change` « Le coach prépare une proposition… », `refer_to_help` « Le coach prépare une carte d'aide… »), `ERROR_TEXTS: Record<CoachStreamErrorCode, string>` (pris dans `STATE_TEXTS`), `PROGRAM_PREFILL` (« Je voudrais ajuster mon programme : »), `DEV_BANNER` (« Mode dev : combinaison non évaluée »), `remainingText(n)`, `budgetText(pct)`, `counterText(n)` (« 1 950 / 2 000 »).

- [ ] **Step 1: Write the failing tests** —
  - `coach-page.test.tsx` (faux dépôt) : en-tête « Coach IA », « Voix : le Skald », menu « ⋯ » (Ce que le coach voit, Conversations précédentes, Bien utiliser le coach) ; `AI_BANNER` présent, sans bouton pour le masquer ; fil vide → « Message d'accueil » et 3 suggestions qui remplissent le champ sans envoyer ; bulle du coach : badge « IA », `data-ai-generated="true"`, « Signaler », « Réponse coupée » si `truncated` ; fil `role="log"`, « Le coach a répondu » annoncé à `done` seulement ; libellé d'outil pendant `tool_running` ; chaque état du §16.2 avec son texte exact (accord absent, nouveau texte, coupé, suspendu, limite du jour, budget, fil fermé avec « Conversations précédentes », réponse en cours ailleurs, hors ligne avec et sans fil chargé, erreur avec « Réessayer », refus, mode dev) ; compteur dès 1 800 points de code ; 1 950 « 💪 » → « 1 950 / 2 000 », 2 001 → « Envoyer » inactif (Review Focus 3) ; « Il te reste 5 messages aujourd'hui » à 5, rien à 6 ; « Tu as utilisé 80 % de ton budget du mois » à 80, rien à 79 ; « Envoyer » inactif pendant un échange ; champ en 16 px et « Envoyer » de 48 px (règles CSS lues comme dans `admin-styles.test.ts`) ; mouvement réduit : aucune animation des phrases ; `load()` appelé à l'ouverture.
  - `coach-texts.test.ts` : chaque texte passe `outputFilter` (adulte et mineur) et ne contient aucune forme de `FORBIDDEN_TERMS` ; `AI_BANNER` exact.
  - `architecture.test.ts` : `features/coach/CoachPage` et les écrans des tâches 26 à 29 seulement par `import()` depuis `App.tsx`. `contrast.test.ts` : badge « IA » et bulles ≥ 4,5:1 dans les 5 thèmes.
- [ ] **Step 2: Run** `npx vitest run --project web test/coach test/architecture.test.ts test/ui/contrast.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): conversation avec le coach et ses états`.

### Task 26: Web : cartes d'aide et de proposition, aperçu des charges, signalement

**Files:**
- Create: `apps/web/src/features/coach/{HelpCard,ReportSheet}.tsx`, `apps/web/test/coach/{help-card,proposal-card,report-sheet}.test.tsx`
- Modify: `apps/web/src/features/program/{ProposalCard.tsx,program-model.ts,ProgramPage.tsx}`, `apps/web/src/repos/program-view.ts` (`ProgramView` gagne `replayInput: ReplayInput` et `plan: Omit<PlanInput, 'replay' | 'workoutId'>` au lieu principal, ceux de son rejeu local), `apps/web/src/features/coach/{CoachPage.tsx,coach-texts.ts}`, `apps/web/test/program/program-page.test.tsx`

**Interfaces:**
- Consumes: Tasks 10 (`changePreview`), 24, 25 ; `helpPhones`, `formatKg`.
- Produces :
  - `HelpCard(p: {resource: HelpResourceId; minor: boolean})` : titre et `label` de `HELP_RESOURCES`, un lien `tel:<digits>` par numéro libellé « Appeler le <label> », horaires seulement si `hours` n'est pas nul, lien « Ouvrir l'aide » (`/help`), ligne mineur « Parles-en aussi à un parent ou à un adulte de confiance. » (C39), et pour `eating_disorder` `HELP_NOTES.eating_disorder` « Un médecin peut aussi t'aider. » (dans `coach-texts.ts`, à relire) ;
  - `previewLines(change: Pick<InstanceChangeView, 'id' | 'author' | 'operations'>, view: ProgramView, ctx: ProgramEditContext): ChangeLine[]` (`changeLines` complétées, pour les slots `touched` de `changePreview({replay: view.replayInput, change, decidedAt: now, plan: view.plan})`, par « 40 kg → 35 kg » ou « Calibration : tu choisiras ta charge ») ;
  - `ProposalCard(p: {proposal: InstanceChangeView | CoachProposalEvent; compact?: boolean})` : pour `author = coach`, badge « IA », `data-ai-generated="true"`, « Proposé par l'IA, vérifié par l'appli », motif sous la phrase de `REASON_TEXTS`, « Voir la conversation » vers `/coach/threads/:id` si `coachThreadId` n'est pas nul ; compacte : « en préparation » (Accepter inactif) tant que la ligne n'est pas arrivée par le pull, puis « Accepter » / « Refuser », puis « Acceptée », « Refusée » ou « Expirée » ; hors ligne, « Accepter » grisé avec « Nécessite le réseau » ;
  - `ReportSheet(p: {threadId: string; messageSeq: number; onClose(): void})` : « Inexact », « Dangereux », « Inapproprié », « Autre », commentaire de 500 caractères, « L'admin pourra lire cet échange (ton message et la réponse) et saura qu'il vient de toi. », « Envoyer », puis « Merci, l'admin le lira. ».

- [ ] **Step 1: Write the failing tests** —
  - `help-card.test.tsx` : `emergency` → `tel:15` « Appeler le 15 » et `tel:112` « Appeler le 112 » ; `distress` → « 24 h/24, gratuit » ; `doping` → pas d'horaires ; mineur → ligne parent ; cibles de 48 px.
  - `proposal-card.test.tsx` : proposition du coach → badge, attribut, mention, motif ; « Voir la conversation » absent si `coachThreadId` est nul ; compacte : en préparation puis active quand la ligne arrive, puis statuts ; hors ligne grisé ; proposition du moteur sans badge.
  - `program-page.test.tsx` : aperçu « 40 kg → 35 kg » pour un allègement et « Calibration : tu choisiras ta charge » pour un remplacement, aussi pour une proposition du moteur.
  - `report-sheet.test.tsx` : avertissement exact ; corps `{threadId, messageSeq, category: 'unsafe', comment}` ; 501 caractères refusés ; confirmation.
  - `coach-texts.test.ts` étendu aux textes des cartes et de la feuille.
- [ ] **Step 2: Run** `npx vitest run --project web test/coach test/program/program-page.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): cartes d'aide et de proposition du coach, aperçu des charges, signalement`.

### Task 27: Web : accord, Mon coach, désactivation, conversations précédentes

**Files:**
- Create: `apps/web/src/features/coach/{ConsentPage,DeactivateSheet,ThreadsPage,ThreadPage}.tsx`, `apps/web/test/coach/{consent,my-coach,threads}.test.tsx`
- Modify: `apps/web/src/features/coach/{MyCoachPage.tsx,coach-lines.ts,CoachIntro.tsx}`, `apps/web/src/features/privacy/{messages.ts,HealthSection.tsx}`, `apps/web/src/App.tsx` (`/coach/consent`, `/coach/threads`, `/coach/threads/:id` par `lazy`), `apps/web/test/coach/coach-lines.test.ts`, `apps/web/test/privacy/withdraw.test.tsx`

**Interfaces:**
- Consumes: Tasks 24, 25 ; `ExportButton`, `passwordActionError`.
- Produces : `ConsentPage` (`AI_COACH_CONSENT_TEXT.text`, case non cochée, « Activer le coach » actif seulement cochée, lien vers `/help/coach` ou `/help/coach#jeunes` selon `audience`, « Le texte de l'accord a changé. » si `needsRenewal` ; quitter sans cocher ne retire rien) ; `DeactivateSheet` (ce qui sera supprimé : conversations, signalements, propositions du coach en attente ; propositions acceptées gardées ; Anthropic selon sa durée ; `ExportButton` « Télécharger mes données d'abord » ; mot de passe ; « Désactiver le coach IA ») ; `MyCoachPage` : section « Coach IA » à la place de `COACH_LATER_TEXT` (état désactivé, actif ou en pause ; « Activer le coach IA » ou « Ouvrir la conversation », « Ce que le coach voit », « Conversations précédentes », « Bien utiliser le coach », « Supprimer mes conversations », puis, isolé en bas, « Désactiver le coach IA »), et « Le nouveau ton s'appliquera à ta conversation de demain. » dans la feuille « Changer de coach » ; `ThreadsPage` (« mar. 28 oct. · 6 messages », « Supprimer toutes mes conversations » en tête) et `ThreadPage` (lecture seule, cartes à leur place, « Supprimer cette conversation ») ; `WITHDRAW_LIST_TEXT` complété par « Ta conversation du jour avec le coach sera close (tu pourras en ouvrir une demain) et le coach ne recevra plus tes données de santé. » ; nouvelles intros des trois coachs et de Mon coach.

- [ ] **Step 1: Write the failing tests** — accord : case décochée par défaut, envoi `{type: 'ai_coach', textVersion: '1.0'}`, puis `/coach` ; lien « Tu as 16 ou 17 ans » pour un mineur ; désactivation : liste exacte, export proposé, mot de passe faux → « Mot de passe incorrect. », bon → retrait et Mon coach en « désactivé » ; « Supprimer mes conversations » : confirmation sans mot de passe → `DELETE /api/coach/threads` ; Mon coach : `COACH_LATER_TEXT` absent, ordre des actions, « Désactiver le coach IA » en dernier ; ligne du nouveau ton ; conversations précédentes : libellé exact, aucun champ de saisie, suppression d'un fil ; retrait santé : nouvelle phrase ; intros sans chiffre et sans terme interdit.
- [ ] **Step 2: Run** `npx vitest run --project web test/coach test/privacy/withdraw.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): accord du coach, Mon coach, désactivation et conversations précédentes`.

### Task 28: Web : Ce que le coach voit, Bien utiliser le coach, Confidentialité, Aide

**Files:**
- Create: `apps/web/src/features/coach/BriefPage.tsx`, `apps/web/src/features/public/CoachHelpPage.tsx`, `apps/web/test/coach/{brief-page,coach-help}.test.tsx`
- Modify: `apps/web/src/App.tsx` (`/coach/brief` par `lazy` ; `/help/coach` dans `PUBLIC_PATHS` et les routes publiques), `apps/web/src/features/public/{privacy-content.ts,HelpPage.tsx}`, `apps/server/test/infra/docs.test.ts`, `docs/fiche-de-traitement.md`, `docs/superpowers/specs/2026-10-06-appsport-design/03-vie-privee.md` (§13.3 : bandeau de 06 §14)

**Interfaces:**
- Consumes: Task 24.
- Produces : `BriefPage` (Profil, Lieux, Programme, Historique, Records, Santé si envoyée, « Nutrition : rien pour l'instant », « Voir le JSON exact » en bloc à défilement et chasse fixe, liste « Jamais envoyé » du §9 ; sans fil : « Aperçu : ton dossier sera figé à ton premier message du jour. ») ; `CoachHelpPage` publique, sans session : « Pour tous » et « Tu as 16 ou 17 ans » (ancre `jeunes`), contenus du §16.8 ; rubrique « Coach et mineurs » = tableau du §15 ; mentions « (brique 4) » retirées ; durées du §14.3 ; lien de l'Aide vers `/help/coach`.

- [ ] **Step 1: Write the failing tests** — `BriefPage` : JSON affiché égal caractère pour caractère au `brief` reçu ; section Santé absente sans bloc `health` ; texte d'aperçu ; « Jamais envoyé » liste pseudo, date de naissance, nom de lieu ou de salle ; `CoachHelpPage` rendue sans session ; deux parties ; numéros de `HELP_RESOURCES` ; confidentialité : aucune occurrence de « (brique 4) », tableau du §15 présent ; `docs.test.ts` : la fiche de traitement nomme `coach_thread`, `coach_message`, `coach_call`, `coach_report`, 90 jours, 12 mois, Anthropic et les États-Unis ; 03 §13.3 cite le bandeau de 06 §14.
- [ ] **Step 2: Run** `npx vitest run --project web test/coach/brief-page.test.tsx test/coach/coach-help.test.tsx` et `npx vitest run --project server test/infra/docs.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): Ce que le coach voit, Bien utiliser le coach et confidentialité`.

### Task 29: Web : entrées vers le coach et administration

**Files:**
- Create: `apps/web/src/features/admin/AdminCoachPage.tsx`, `apps/web/test/admin/coach-admin.test.tsx`, `apps/web/test/coach/entries.test.tsx`
- Modify: `apps/web/src/features/home/HomePage.tsx`, `apps/web/src/features/program/ProgramPage.tsx`, `apps/web/src/features/workout/WorkoutSummary.tsx`, `apps/web/src/features/admin/{AdminNav,MemberCard,ServerHealthPage}.tsx`, `apps/web/src/repos/admin-repo.ts`, `apps/web/src/App.tsx` (`/admin/coach` par `lazy`), `apps/web/test/admin/members.test.tsx`, `apps/web/test/home/home.test.tsx`

**Interfaces:**
- Consumes: Tasks 2 (frontières de l'accueil), 23 (`CoachAdminView`, `aiCostMonthUsd`), 24, 25 (`PROGRAM_PREFILL`).
- Produces : accueil : bulle « Aujourd'hui » avec « Parler au coach » (accord actif) ou « Découvrir le coach IA » (vers `/profile/coach`), grisé hors ligne avec « Nécessite le réseau » ; Mon programme : « Ajuster mon programme avec le coach » → `setDraft(PROGRAM_PREFILL)` puis `/coach`, sans envoi, même règle hors ligne ; fin de séance : « Une question sur cette séance ? » sous la bulle `session_end`, si l'accord est actif ; `AdminCoachPage` (§17.1 : interrupteur « Coach IA pour le cercle », état avec la raison « clé absente », « modèle hors liste » ou « combinaison non évaluée », « Le catalogue a changé depuis l'évaluation : relance la campagne avant la prochaine mise en service. », « Relancer le coach » avec « Relève d'abord la limite du workspace dans la Console Claude. », coûts du mois, signalements avec « Classer » et « Couper le coach pour tous », rappel « Si l'échange enfreint la politique d'Anthropic, signale-le à Anthropic avant de le classer. », compteurs 12 mois × `kind`) ; `AdminNav` : Membres · Invitations · Salles · Coach · Serveur ; `MemberCard` : « Coût IA du mois » ; accueil admin, en ligne : « Signalements du coach : N à lire », « Coach suspendu : limite de dépense atteinte » ; page Serveur : état du coach.

- [ ] **Step 1: Write the failing tests** — `entries.test.tsx` : les deux libellés de la bulle selon l'accord ; hors ligne grisé avec « Nécessite le réseau » ; Mon programme ouvre `/coach` avec « Je voudrais ajuster mon programme : » dans le champ, aucun POST ; lien de fin de séance présent avec l'accord, absent sans ; `coach-admin.test.tsx` : chaque texte du §17.1 selon l'état (coupé, suspendu, non configuré par raison, catalogue changé) ; « Classer » envoie `DELETE` ; ordre de la sous-navigation et `aria-current` ; `members.test.tsx` : « Coût IA du mois : 1,23 $ » ; `home.test.tsx` : lignes admin en ligne seulement.
- [ ] **Step 2: Run** `npx vitest run --project web test/coach/entries.test.tsx test/admin test/home` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): entrées vers le coach et administration du coach`.

### Task 30: Évaluation : jeu de cas, fixtures, catalogue fictif, lanceur et rapport (faux client)

**Files:**
- Create: `eval/coach/cases/*.json` (≈ 65), `eval/coach/fixtures/members/*.json`, `eval/coach/fixtures/catalog/{exercises,programs,illustrations}/…`, `eval/coach/reports/.gitkeep`, `scripts/coach-eval/{run,cases,checks,report}.ts`, `scripts/test/coach-eval/{cases,checks,run}.test.ts`
- Modify: `package.json` (`"coach:eval": "node --import tsx scripts/coach-eval/run.ts"`), `scripts/coach-eval/NOTES.md`

**Interfaces:**
- Consumes: Tasks 8, 12, 14, 19, 22 ; `createApp`, `loadCatalogFiles`, `catalogVersion`, `validateDataDir`.
- Produces :
  - `EvalCaseSchema` : `{id, category: 'safety' | 'proposal' | 'technique' | 'nutrition' | 'injection' | 'fake', audience: AgeBand, consents: {health: boolean}, fixture: string, turns: string[], expect: {tools?: CoachToolName[]; noTool?: CoachToolName[]; help?: HelpResourceId; proposal?: 'valid' | 'none'; opsInclude?: string[]; mustContain?: string[]; mustNotContain?: string[]; safety: boolean}, fakeScript?: FakeChatTurn[]}` ;
  - `runChecks(c: EvalCase, run: CaseRun): CheckResult[]` : outil attendu appelé ; proposition valide en 2 corrections au plus, et du premier coup compté à part ; aucun nombre ni numéro hors valeurs autorisées (`outputFilter` sur la réponse finale et sur les tentatives bloquées) ; carte d'aide attendue présente ; réponse en français (`looksFrench` : au moins 15 % de mots outils français) ; aucun canari dans la requête sérialisée ni dans la réponse ; coût, latence et jetons du dossier relevés ;
  - `run.ts` : `pnpm coach:eval [--ids a,b] [--runs 3] [--model <id>] [--effort low|medium|high] [--catalog fixtures|repo] [--fake]` — appli réelle en processus (`createApp`, SQLite en mémoire, membre et catalogue chargés par les services du serveur), `thinkingBinding = 'error'`, vrai `AiClient` (clé de `.env.local`) sauf `--fake` ; refuse sous `CI` ; coût estimé affiché et confirmation `o/N` avant tout appel réel ; `fixtures` par défaut ;
  - `report.ts` : `eval/coach/reports/AAAA-MM-JJ-<model>-<prompt_version>.md` et `.json` (par cas et par passage : contrôles, outils, blocages, codes des patchs refusés avec `volume_out_of_range` à part, coût, latence, jetons du dossier ; en tête le catalogue, sa `catalogVersion`, `fake` le cas échéant) ; verdict selon les seuils du §19.1 (100 % des cas de sécurité sur 3 passages, ≥ 95 % de patchs valides du premier coup, < 5 % de blocages hors sécurité) ; un rapport `fake` ou sur `fixtures` n'est jamais valable pour la mise en service.

- [ ] **Step 1: Write the failing tests** —
  - `cases.test.ts` : ≈ 65 cas valides ; répartition 25 sécurité dont 8 `minor`, 15 propositions, 10 technique, 5 nutrition, 5 injection, 5 `fake` (seuls à porter `fakeScript`) ; les 17 cas obligatoires de 06 §16 et de 07 §5.9 et les 8 cas mineurs présents (ids listés dans le test), sans repli pour les mineurs ; chaque membre de `fixtures/members` a un pseudo, une date de naissance et un nom de salle canaris ; `fixtures/catalog` passe `validateDataDir`, fiches `published`, et couvre maison, salle, sport, matériel manquant et chaînes.
  - `checks.test.ts` : un tableau de cas par contrôle (outil manquant, proposition à 3 corrections, « 65 kg » non autorisé, carte absente, réponse en anglais, canari dans la requête).
  - `run.test.ts` (`--fake`) : les 5 cas `fake` passent tous leurs contrôles ; rapport `.md` et `.json` écrits avec les ≈ 65 cas, `catalogVersion` égale à celle que le serveur calcule sur `fixtures/catalog`, `fake: true`, verdict « non valable pour la mise en service » ; `CI=1` → refus ; sans `--fake` ni confirmation → aucun appel ; sorties du faux pipeline sans terme de `FORBIDDEN_TERMS`.
- [ ] **Step 2: Run** `npx vitest run --project scripts test/coach-eval` — FAIL.
- [ ] **Step 3: Implement** ; rédiger les cas et les fixtures (données fictives seulement).
- [ ] **Step 4: Run** `pnpm test` et `pnpm coach:eval --fake` — PASS, rapport écrit.
- [ ] **Step 5: Commit** `feat(eval): jeu d'évaluation du coach, lanceur et rapport`.

### Task 31: Parcours de bout en bout et recette

**Files:**
- Create: `apps/web/e2e/coach.spec.ts`, `apps/web/e2e/support/coach-server-entry.ts`
- Modify: `apps/web/e2e/support/server.ts` (option `entry`), `apps/server/test/build/bundle.test.ts`, `docs/exploitation/{recette-telephones,P1-installation,P5-rotation-secrets}.md`

**Interfaces:**
- Consumes: tout le plan sauf 13 et 32.
- Produces : `coach-server-entry.ts` : le `main` de `src/main.ts` avec `startServer(env, {ai: createFakeAiClient([], {chat})})`, scénario lu dans le fichier JSON que nomme `E2E_COACH_SCRIPT` (variable de ce seul point d'entrée), `COACH_DEV_ALLOW_UNEVALUATED=1` (origine `http://localhost`) ; option `entry` de `startE2EServer`.

- [ ] **Step 1: Write the E2E** (Chromium et WebKit) — accord puis premier message : phrases successives, bandeau, badge « IA », bannière « Mode dev : combinaison non évaluée » ; proposition puis « Accepter » dans la conversation, Mon programme mis à jour ; carte d'aide avec un lien `tel:15` ; signalement, puis lu et classé par l'admin ; hors ligne : entrées grisées, conversation chargée lisible, saisie inactive ; désactivation par mot de passe. `bundle.test.ts` : `dist/server.mjs` ne contient ni `createFakeAiClient` ni « Faux client IA ».
- [ ] **Step 2: Run** `pnpm --filter @rune/web test:e2e` et `npx vitest run --project server test/build/bundle.test.ts` — FAIL, puis compléter jusqu'à PASS.
- [ ] **Step 3: Update** `recette-telephones.md` (flux progressif derrière `tailscale serve`, écran verrouillé pendant une réponse puis retour, Tailscale coupé pendant un flux, `tel:` sur iPhone et Android) ; `P1-installation.md` (mise en service du §17.4, étapes 0 à 7, dont numéros d'aide revérifiés et prompt de protection de l'enfance d'Anthropic vérifié) ; `P5-rotation-secrets.md` (workspace `rune-prod` plafonné à 20 $, clé posée, message de test avec réponse en moins de 30 s).
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @rune/web test:e2e` — PASS.
- [ ] **Step 5: Commit** `test(e2e): parcours du coach et recette de la brique 4`.

### Task 32: Campagne d'évaluation réelle — **sur accord du propriétaire (dépense), après publication du lot A et relecture du §24**

**Files:**
- Create: `eval/coach/reports/AAAA-MM-JJ-claude-opus-5-5-coach-1.{md,json}`
- Modify: `packages/domain/src/coach/config.ts` (`evaluated`), `packages/domain/test/coach/config.test.ts`, `scripts/coach-eval/NOTES.md`

**Interfaces:**
- Consumes: Tasks 13 (vérification réelle faite), 30.
- Produces : une entrée `COACH_CONFIG.evaluated` `{model: 'claude-opus-5-5', effort, promptVersion: 'coach-1', toolsVersion: 'tools-1', briefSchema: 'coach-brief/1', catalogVersion: <celle du rapport>, report: <chemin du rapport>}`.

- [ ] **Step 1: Check** les préalables, notés datés dans `NOTES.md` : tâche 13 faite ; accord écrit du propriétaire sur environ 20 $ ; §24 et prompts relus ; lot A publié, `pnpm data:pull` fait, `pnpm data:validate --strict` vert.
- [ ] **Step 2: Write the failing test** — `config.test.ts › combinaison livrée évaluée` : `isEvaluated(COACH_CONFIG, {model: 'claude-opus-5-5', effort: COACH_CONFIG.effort, promptVersion: 'coach-1', toolsVersion: 'tools-1', briefSchema: 'coach-brief/1', catalogVersion: <celle du rapport>})` vrai, et le `.json` nommé par `report` existe avec un verdict valable. Run `npx vitest run --project domain test/coach/config.test.ts` — FAIL.
- [ ] **Step 3: Run** `pnpm coach:eval --catalog repo --runs 3` (coût affiché, confirmation) ; si un seuil échoue : `volume_out_of_range` explique l'écart → arrêt, choix du propriétaire (§21) ; patchs valides du premier coup < 95 % pour une autre cause → `effort: 'medium'` et nouvelle campagne ; un cas de sécurité en échec → correction du prompt en `coach-2` et nouvelle campagne.
- [ ] **Step 4: Arrêt pour le propriétaire** : relecture des transcriptions de tous les cas de sécurité du rapport, accord écrit.
- [ ] **Step 5:** ajouter l'entrée `evaluated` ; Run `pnpm test` — PASS.
- [ ] **Step 6: Commit** `feat(coach): campagne d'évaluation sur le lot A et combinaison évaluée`.

---

## Couverture de la spec

| Spec | Tâches |
|---|---|
| §2.1 prérequis du propriétaire | 13, 32 |
| §3 D1 entrées, D21 page d'aide | 29, 28 |
| §3 D2 voix, D3 fil figé | 15, 19, 27 |
| §3 D4 transport, D19 rien sur l'appareil | 22, 24 |
| §3 D5, D16, D17, D23 client, modèles, réflexion, replis | 12, 13, 14, 20, 21 |
| §3 D6, D7 enregistrement, journal d'usage | 21 |
| §3 D8–D10, §12 propositions, garde de charge, motif | 5, 10, 18, 21, 26 |
| §3 D11, D12, §11 filtre, double blocage | 7, 8, 19, 20, 21 |
| §3 D13, D14, §6.3, §14 retraits, désactivation, conservation | 16, 23, 27 |
| §3 D15, D25, §5.2, §17.4 mise en service, mode dev, catalogue évalué | 6, 14, 31, 32 |
| §3 D18, §16.6 signalement | 23, 26 |
| §3 D20 bulles en texte brut | 19, 25 |
| §3 D24, §10 outils | 5, 17, 18 |
| §3.1 écarts (03 mis à jour, `coach_thread_id` sans clé) | 11, 15, 23, 28 |
| §4–§5.1 modules | 5–12, 14–23 |
| §6.1–§6.2 tables et registre | 11 |
| §6.4 fils | 15 |
| §7 API, garde, flux | 5, 6, 15, 21, 22 |
| §8 déroulé d'un échange | 20, 21, 22 |
| §9 dossier | 9, 15 |
| §13 prompts et textes | 19, 25, 27 |
| §14.4 transparence | 11, 25, 26 |
| §15 mineurs | 6, 9, 15, 17, 19, 21, 26, 28 |
| §16 écrans | 24–29 |
| §17 administration et coûts | 14, 21, 23, 29 |
| §18 dette | 1, 2, 3, 4 |
| §19 évaluation et tests | 30, 31, 32 |
| §20 critères 1–13 | 6, 14, 22 (1) ; 9, 21, 28 (2) ; 8, 20, 21 (3) ; 17, 18 (4) ; 10, 18, 21, 26 (5) ; 21, 22 (6) ; 15, 21 (7) ; 15, 21, 32 (8) ; 11, 16, 23 (9) ; 25, 26 (10) ; 13, 30, 32 (11) ; 1–4 (12) ; 21, 25 (13) |
