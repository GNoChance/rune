# Brique 3 · Programmes et séances — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les programmes et les séances de Rune : 6 modèles, moteur de progression déterministe partagé par le téléphone et le serveur, saisie des séances hors ligne, rejeu par le serveur, `InstanceChange`, historique, records, XP et rangs réels.

**Architecture:** Le métier vit en fonctions pures dans `packages/domain/src/program/` (charges, évaluation, rejeu, préparation d'une séance, validateurs) et `packages/domain/src/progress/` (XP, rangs, records), appelées à l'identique par le téléphone et le serveur. Les séances sont des tables J écrites hors ligne par `writeLocal` ; le serveur rejoue l'instance dans la transaction du push et fait foi. Le programme (`program_instance`, `instance_change`) passe par une API en ligne ; `slot_state` et `engine_decision` sont des caches de classe D.

**Tech Stack:** TypeScript, Zod 4, fast-check, Hono, Kysely/node:sqlite, React 19, wouter, Dexie, CSS Modules, Vitest + Testing Library + happy-dom, Playwright (Chromium, WebKit).

**Spec:** `docs/superpowers/specs/2026-11-01-brique-3-programmes-seances-design.md` et la section qu'elle complète, `docs/superpowers/specs/2026-10-06-appsport-design/05-programmes.md` (autorité pour les règles du moteur), plus 09 §3 (types), 01 §5 (synchro). Lire la spec de la brique 3 et 05 en entier avant toute tâche ; en cas d'écart, la spec de la brique 3 l'emporte là où son tableau §2 le déclare.

**Point de départ :** branche locale `brique-3`, tirée de `brique-2` (05ea59c) plus la spec (64a8948). Jamais de `git push`.

## Global Constraints

- Branche `brique-3`, un ou plusieurs commits par tâche, messages en français au format du dépôt (`feat(domain): …`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` verts à la fin de chaque tâche ; `pnpm --filter @rune/web test:e2e` (Chromium et WebKit) vert pour toute tâche qui touche un parcours E2E ; `pnpm data:validate` vert pour toute tâche qui touche `data/`.
- Contraintes du socle, de la refonte et de la brique 2 toujours valables : CSP `default-src 'self'`, format d'erreur API, 404 pour les données d'un autre, jamais de C1–C3 dans `/api/admin/*`, aucun accès Dexie hors de `repos/` et `sync/`, tables STRICT avec CHECK, migrations transactionnelles, `entityRules` couvre chaque colonne, `packages/domain` pur (ni `Date.now()`, ni `new Date()`, ni `Math.random()`, ni `node:`).
- Textes : français, apostrophe droite `'`, tutoiement, voix du Système seulement aux moments clés ; « repère », « estimation », jamais « prescription ».
- Accessibilité : cibles ≥ 48 × 48 px sur l'écran de séance (✓, −, +, actions du bas), ≥ 44 ailleurs ; contrastes ≥ 4,5:1 dans les 5 thèmes ; rien porté par la couleur seule ; `prefers-reduced-motion` respecté.
- Charges en grammes entiers partout (schémas, base, Dexie) ; affichage en kg avec virgule (`62,5 kg`, `60 kg`).
- Valeurs fixées, à reprendre telles quelles : `RULES_VERSION = '1'` ; RIR retenu facile 4, correct 2,5, difficile 1, échec 0 ; `LIGHTEN_PCT = 10` ; stagnation à 3 séances ; `sessionsAtTop = 2` ; `stepS = 5` ; reprise 14 j → −10 %, 28 j → −20 % et une variante de moins ; calibration 3 séances ; prudent : répétitions 6 à 15 (écart ≥ 2), ≤ 3 séries de travail, `targetRir` ≥ 3, fin de chaîne 15 (adulte 25), aucune hausse avant la 3e séance ; propositions valables 7 jours ; ≤ 5 opérations par changement ; séance oubliée 6 h (même appareil) / 24 h (autre appareil) ; bornes d'une série : charge 0 à 500 000 g, répétitions 0 à 200, durée 0 à 7 200 s, position 1 à 99 ; notes ≤ 500 caractères ; XP 10 / 5 / 20, plafond 300 ; rangs globaux E 0, D 1 000, C 5 000, B 12 000, A 30 000, S 60 000 ; rangs de groupe E 0, D 20, C 100, B 250, A 600, S 1 200 séries.
- Nouvelle dépendance : aucune prévue. Si une tâche en a besoin, version exacte publiée depuis au moins deux semaines.
- Données de douleur : sans consentement santé actif, aucune trace (`pain_level`, `swap_reason = 'pain'`) ni dans Dexie, ni dans l'outbox, ni sur le serveur.

## Review Focus

1. **Appli tuée en pleine séance** (iPhone qui décharge la PWA, batterie) : à la réouverture, la séance revient telle quelle, séries faites comprises, et le minuteur reprend à partir de son heure de fin. Test dans la tâche 15 (dépôt) et la tâche 19 (minuteur).
2. **Horloge du téléphone fausse ou fuseau changé** (voyage) : l'absence se compte en jours civils de Paris ; une séance datée dans le futur ne casse ni la rotation ni le rejeu. Test dans la tâche 5.
3. **Même séance sur deux appareils** (« Continuer ici », puis le premier continue hors ligne) : pas de série en double, la dernière écriture gagne champ par champ, l'appareil perdant passe en lecture seule au pull suivant. Test dans la tâche 15.
4. **Saisie de charge maladroite** (`62,5`, `62.5`, champ vide, `abc`, `600`) : aucune valeur `NaN` ni hors bornes écrite ; message attaché au champ. Test dans la tâche 18.
5. **Fiche retirée en cours de programme** : la séance prévue prend un remplaçant, l'historique garde le nom de la fiche retirée, ses records restent. Tests dans les tâches 6 et 21.

---

## Structure des fichiers

- `packages/contracts/src/program.ts` (modèles, opérations, codes, textes des raisons), `packages/contracts/src/api/program.ts` (contrats de l'API), `packages/contracts/src/entity-rules.ts` et `sync.ts` (7 tables).
- `packages/domain/src/program/` : `types.ts`, `rules.ts`, `loads.ts`, `effort.ts`, `effective.ts`, `validate-template.ts`, `validate-change.ts`, `volume.ts`, `evaluate.ts`, `primitives.ts`, `stall.ts`, `replay.ts`, `program-state.ts`, `resolve.ts`, `plan.ts`, `index.ts`.
- `packages/domain/src/progress/` : `rules.ts`, `xp.ts`, `ranks.ts`, `records.ts`, `stats.ts`, `index.ts`.
- `data/programs/*.json` (6 modèles), `docs/catalog/lot-a.md`, `docs/catalog/lot-b.md`, `data/exercises/*.json`.
- `apps/server/src/db/migrations/0004_program.ts` ; `apps/server/src/program/` : `sync-hooks.ts`, `replay-service.ts`, `expire.ts`, `routes.ts`, `enroll.ts`, `changes.ts`, `machine-step.ts` ; `apps/server/src/privacy/sets-csv.ts`.
- `apps/web/src/repos/` : `workout-repo.ts`, `program-repo.ts`, `program-view.ts` (rejeu local et vue du programme), `device-settings.ts`.
- `apps/web/src/features/workout/` (séance du jour, saisie, fin, séance libre), `features/history/`, `features/program/`, `features/progression/` (refait), `features/places/LoadSettingsPage.tsx`.
- `apps/web/e2e/workout.spec.ts`, `docs/exploitation/recette-telephones.md`.

**Ordre et parallélisme :** 1 → 2 → {3, 4, 7} ; 4 → 5 ; {2, 5} → 6 ; 3 → 8 → {9, 10} ; {5, 6} → 10 ; 1 → 11 → {12, 13, 14} (12 et 13 après 5) ; {6, 11} → 15 ; 13 → 16 ; {15, 16} → 17 → 18 → 19 → 20 ; 15 → 21 ; 16 → 22 ; {7, 15} → 23 ; 24 après 1 ; 25 en dernier.

---

### Task 1: Contrats des modèles, des opérations et des codes

**Files:**
- Create: `packages/contracts/src/program.ts`, `packages/contracts/src/api/program.ts`, `packages/contracts/test/program.test.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/api/errors.ts`, `packages/contracts/test/errors.test.ts`

**Interfaces:**
- Produces (`program.ts`) :
  - `ProgramTemplateSchema` (strict) et types `ProgramTemplate`, `WorkoutSpec {id, name, slots}`, `SlotSpec {id, movementPattern, role: 'main'|'secondary'|'accessory', exercises?: string[], chain?: string, sets: SetSpec[], progression: ProgressionSpec}` (exactement un de `exercises` ou `chain`), `SetSpec {kind: 'warmup'|'work', count: 1..5, reps?: {min,max}, durationS?: {min,max}, targetRir?: 1..5, restS?: number, pctWorkLoad?: number}` (exactement un de `reps` ou `durationS`), `ProgressionSpec = {type:'fixed'} | {type:'linear', incrementG} | {type:'double'} | {type:'chain'} | {type:'duration', stepS}` ; `block: {mode:'reactive'} | {mode:'planned', weeks: 5, deloadWeek: 5}` ; `daysPerWeek {min, max, default}` ; `context: 'gym'|'home'|'sport'` ; `level: 'beginner'|'intermediate'` ; `schemaVersion: 1`.
  - `ServedProgramTemplateSchema = {template: ProgramTemplate, available: boolean}`.
  - Constantes : `EFFORTS`, `PAIN_LEVELS`, `NEXT_ADJUSTMENTS`, `SWAP_REASONS`, `SESSION_STATUSES`, `WEEK_TYPES`, `SESSION_PROFILES`, `SET_KINDS`, `SIDES`, `SLOT_MODES` (`linear|double|sum|chain|duration`), `DECISION_RESULTS`, `REASON_CODES` (codes de décision du §4.3.13 de la spec), `CHANGE_REASON_CODES` (`USER_CHANGE`, `ENGINE_STALL_REPLACE`, `ENGINE_REACTIVE_DELOAD`, `PAIN_SUSPEND`, `USER_SUSPEND`), `PAIN_CODE_REWRITES = {PAIN_HOLD:'USER_HOLD', PAIN_LIGHTEN:'USER_LIGHTEN', PAIN_SUSPEND:'USER_SUSPEND'}`, `REASON_TEXTS: Record<ReasonCode | ChangeReasonCode, string>`, `CHANGE_AUTHORS`, `CHANGE_STATUSES`, `MAX_CHANGE_OPERATIONS = 5`.
  - Types dérivés exportés : `Effort`, `PainLevel`, `NextAdjustment`, `SwapReason`, `SessionStatus`, `WeekType`, `SessionProfile`, `SetKind`, `Side`, `SlotMode`, `DecisionResult`, `ReasonCode`, `ChangeReasonCode`, `ChangeAuthor`, `ChangeStatus`, `InstanceChangeOperation`.
  - `InstanceChangeOperationSchema` : union discriminée par `op`, chaque branche `.strict()` : `replace_exercise {slot, exercise}`, `change_sets {slot, delta: -1|1}`, `set_rep_range {slot, min, max}`, `set_target_rir {slot, value}`, `set_rest {slot, seconds}`, `lighten_exercise {slot}`, `start_deload {}`, `suspend_slot {slot}`, `resume_slot {slot}`, `remove_slot {slot}`, `add_slot {workout, movementPattern, exercises: string[] (≥ 1)}`, `set_days_per_week {days}`, `switch_template {templateId, daysPerWeek?}`.
- Produces (`api/program.ts`) : `EnrollRequest {templateId, daysPerWeek: 2|3|4}`, `CreateChangeRequest {baseRevision: int ≥ 0, operations: 1..5}`, `DecideChangeRequest {baseRevision}`, `MachineStepRequest {stepG: 500..10000 entier | null}`, `ChangeErrorsBody {error: 'invalid_change', errors: {op: number, code: ChangeErrorCode}[]}`, `CHANGE_ERROR_CODES` = `slot_unknown`, `workout_unknown`, `exercise_unusable`, `pattern_mismatch`, `sets_out_of_bounds`, `reps_out_of_bounds`, `rir_out_of_bounds`, `rest_out_of_bounds`, `coverage_lost`, `volume_out_of_range`, `slot_limit`, `forbidden_for_author`, `forbidden_cautious`, `days_out_of_range`, `template_unavailable`, `template_unchanged`, `not_suspended`, `already_suspended`. Vues camelCase : `ProgramInstanceView`, `InstanceChangeView`, `SlotStateView`.
- Nouveaux codes d'erreur API : `already_enrolled`, `template_unavailable`, `days_out_of_range`, `stale_revision`, `expired`, `not_proposed`, `session_in_progress`, `invalid_change`.

- [ ] **Step 1: Write the failing tests** — l'extrait de 05 §4 passe `ProgramTemplateSchema` ; un `SetSpec` avec `reps` et `durationS` → refusé ; `targetRir: 0` → refusé ; `lighten_exercise {slot, pct: 10}` → refusé ; 6 opérations → refusé ; `switch_template {templateId}` sans jours → accepté ; chaque code de `REASON_CODES` a un texte non vide, sans « appsport », sans apostrophe courbe ; chaque clé et chaque cible de `PAIN_CODE_REWRITES` est dans `REASON_CODES` ou `CHANGE_REASON_CODES` ; chaque nouveau code d'erreur a son statut HTTP dans `errors.ts` (409 pour `already_enrolled`, `stale_revision`, `expired`, `not_proposed`, `session_in_progress` ; 422 pour `template_unavailable`, `days_out_of_range`, `invalid_change`).
- [ ] **Step 2: Run** `pnpm --filter @rune/contracts test program errors` — FAIL.
- [ ] **Step 3: Implement** ; textes de `REASON_TEXTS` en une phrase au tutoiement (exemple : `LOAD_UP` « Toutes les séries passées avec de la marge : la charge monte. »), à relire par le propriétaire.
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(contracts): modèles de programmes, opérations et codes du moteur`.

### Task 2: Types, règles versionnées, charges réalisables et effort

**Files:**
- Create: `packages/domain/src/program/{types,rules,loads,effort,index}.ts`, `packages/domain/test/program/{rules,loads,effort}.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: Task 1 (constantes et types), `LoadSettings` (`contracts/src/load-settings.ts`), `LOAD_MODES`.
- Produces (`types.ts`) :
  - `SetRecord {id, position, kind, loadMode, loadG, reps, durationS, side, effort, targetRepsMin, targetRepsMax, targetDurationS, targetLoadG, targetRir, targetVariant, loggedAt}` (nullables sauf `id`, `position`, `kind`, `loadMode`) ; `isDone(set) = set.loggedAt !== null`.
  - `ExerciseRecord {id, slotId, plannedExerciseId, exerciseId, position, swapReason, painLevel, nextAdjustment, sets: SetRecord[]}`.
  - `SessionRecord {id, instanceId, workoutId, placeId, startedAt, endedAt, status, weekType, profile, rulesVersion, exercises: ExerciseRecord[]}`.
  - `AcceptedChange {id, author, reasonCode, decidedAt, operations}` ; `PlaceContext {id, equipment: ReadonlySet<EquipmentCode>, loadSettings: LoadSettings}`.
  - `SlotState {id, instanceId, slotId, exerciseId, mode, loadG, targetReps, variantRank, durationS, machineStepGOverride, calibrationLeft, noProgressCount, stallRank, painStreak, suspended, lastSessionId, rulesVersion}` ; `slotStateId(instanceId, slotId, exerciseId) = \`${instanceId}:${slotId}:${exerciseId}\``.
  - `NextTarget {mode, loadG, repsMin, repsMax, durationS, variantId, workSets}` ; `EngineDecision {id, instanceId, slotId, exerciseId, result, reasonCode, nextTarget, profile, rulesVersion}`.
- Produces (`rules.ts`) : `RULES_VERSION = '1'`, `RulesSet` (toutes les constantes chiffrées de la section Global Constraints qui concernent le moteur, plus `raiseCapPct: 10`, `sumModeStepPct: 10`, `sumAllowanceBelowMin: 2`, `durationFailMarginS: 5`, `defaultIncrementG: {upper: 2500, lower: 5000}`, `deloadRirPlus: 2`, `restS: [30, 300]`), `RULES_BY_VERSION` (gelé en profondeur), `rulesFor(version): RulesSet | null`, `RulesBook = Readonly<Record<string, RulesSet>>`.
- Produces (`loads.ts`) : `LoadGrid = {kind:'barbell', barG, plateStepG} | {kind:'dumbbell', valuesG: readonly number[]} | {kind:'machine', stepG} | {kind:'none'}` ; `loadGrid(loadMode, settings, overrideStepG?)` (barbell : `plateStepG = 2 × smallestPlateG` ; `weighted`, `bodyweight`, `band` → `none`) ; `roundDown(grid, g): number | null` ; `next(grid, g): number | null` ; `lightest(grid): number | null` ; `STANDARD_PLATES_G = [25000, 20000, 15000, 10000, 5000, 2500, 1250, 500, 250]` ; `platesPerSide(totalG, barG, smallestPlateG): number[] | null` (glouton sur les disques ≥ `smallestPlateG`, null si un reste subsiste).
- Produces (`effort.ts`) : `rirEval(sets: SetRecord[], rules): number | null` (minimum du RIR retenu sur les séries de travail faites qui portent un effort) ; `effortValidated(rirEval, targetRir): boolean` = `rirEval !== null && rirEval > 0 && rirEval >= targetRir - 1`.

- [ ] **Step 1: Write the failing tests** —
  - barre 20 kg, plus petit disque 1,25 kg : `roundDown(61000) = 60000`, `next(60000) = 62500`, `roundDown(15000) = null` (sous la barre), `lightest = 20000` ; haltères 2 000…40 000 pas 2 000 : `next(14000) = 16000`, `roundDown(15000) = 14000`, liste vide → `next` et `roundDown` null ; machine pas 5 000 : `roundDown(12000) = 10000`, `next(10000) = 15000`, surcharge 2 500 → `next(10000) = 12500` ;
  - `platesPerSide(62500, 20000, 1250) = [20000, 1250]`, `(60000, 20000, 1250) = [20000]`, `(20000, 20000, 1250) = []`, `(21000, 20000, 1250) = null` ;
  - effort : `targetRir` 2 → facile, correct, difficile validés, échec non ; `targetRir` 3 → difficile non validé ; aucun effort → null, non validé ; `rirEval` = minimum sur plusieurs séries ;
  - `RULES_BY_VERSION['1']` gelé (`Object.isFrozen` récursif) et `rulesFor('x') = null`.
- [ ] **Step 2: Run** `pnpm --filter @rune/domain test program` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` (dont `purity.test.ts`) — PASS.
- [ ] **Step 5: Commit** `feat(domain): règles versionnées du moteur, charges réalisables et effort`.

### Task 3: Programme effectif, validateurs et modèles servis

**Files:**
- Create: `packages/domain/src/program/{effective,validate-template,validate-change,volume}.ts`, `packages/domain/test/program/{effective,validate-template,validate-change}.test.ts`, `packages/domain/test/fixtures/program.ts` (catalogue et modèles de test)
- Modify: `packages/contracts/src/catalog.ts` (`programTemplates: ServedProgramTemplate[]`), `apps/server/src/catalog/{loader,bundle}.ts`, `apps/server/test/catalog/*.test.ts`, `apps/web/src/sync/catalog.ts`, `apps/web/test/sync/catalog.test.ts`, `scripts/data/validate.ts`, `scripts/test/data/validate.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 ; `CatalogSheet`, `isUsable`, `feasible`, `buildChains`, `REFERENCE_PROFILES`, `PATTERN_GROUPS`, `patternGroup`.
- Produces :
  - `EffectiveProgram {template: ProgramTemplate, daysPerWeek: number, suspended: ReadonlySet<string>}` ; `effectiveProgram(snapshot, daysPerWeek, changes: AcceptedChange[]): EffectiveProgram` — applique dans l'ordre (`decidedAt`, puis `id`) les opérations **structurelles** (`replace_exercise`, `change_sets`, `set_rep_range`, `set_target_rir`, `set_rest`, `remove_slot`, `add_slot`, `set_days_per_week`, `suspend_slot`, `resume_slot`) ; `lighten_exercise`, `start_deload` et `switch_template` sont des événements laissés au rejeu. Règles : `replace_exercise` met l'exercice en tête de `exercises` ; sur un slot `chain`, le slot devient `exercises: [exercice]` avec la progression `double` (ou `duration` si le slot est en durée) ; `change_sets`, `set_rep_range`, `set_target_rir`, `set_rest` portent sur les `SetSpec` de travail ; `add_slot` crée le slot `${workout}-${changeId}` (rôle `accessory`, progression `double`, séries `{kind:'work', count: 2, reps: {min: 8, max: 12}, targetRir: 2, restS: 90}`).
  - `validateTemplate(raw: unknown, catalog: CatalogSheet[]): TemplateIssue[]` avec `TemplateIssue {code, path, message}` et les codes `schema`, `duplicate_id`, `reps_order`, `rir_too_low`, `work_sets_count`, `rest_bounds`, `days_bounds`, `coverage_missing`, `coverage_needs_bodyweight`, `unknown_exercise`, `pattern_mismatch`, `unknown_chain`, `gym_first_not_reference`, `volume_out_of_range`, `forbidden_name` (règles 1 à 7 de 05 §5).
  - `VOLUME_GROUPS` (`quadriceps`, `hamstrings`, `glutes`, `chest`, `lats`, `delts` = front/side/rear) ; `weeklyVolume(program, catalog, equipment): Record<VolumeGroup, number>` : moyenne hebdomadaire sur un cycle de `ppcm(nombre de séances du modèle, jours)` séances, au nombre de jours par défaut, premier exercice faisable de chaque slot. Fourchettes : débutant 6–12, intermédiaire 10–20, `sport` 4–10. La couverture (règle 4) se vérifie sur chaque semaine de ce cycle.
  - `validateChange(input: {program: EffectiveProgram, revision, change: {author, baseRevision, operations}, catalog, places: PlaceContext[], profile: SessionProfile, level, servedTemplates: ServedProgramTemplate[], instanceTemplateVersion}): {ok: true, program: EffectiveProgram} | {ok: false, errors: {op, code: ChangeErrorCode}[]}` — bornes de 05 §15 (adulte ou prudent selon `profile`), auteurs permis, puis cohérence, couverture et volume sur le résultat (05 §15.3) ; ne vérifie pas la révision (c'est le serveur).
  - `templateAvailable(template, catalog): boolean`.
  - Serveur : `CatalogBundle.programTemplates` = `{template, available}[]` ; un fichier qui ne passe pas `ProgramTemplateSchema` n'est pas servi et le chargeur écrit `program_template_invalid` (nom du fichier seulement) au journal technique.
  - Web : `refreshCatalog` valide chaque entrée par `ServedProgramTemplateSchema` et stocke `{id, template, available}` dans `programTemplates` (entrée invalide ignorée).
  - `scripts/data/validate.ts` : `validateTemplate` sur chaque `data/programs/*.json` contre `data/exercises` (tous statuts) ; règle 8 avec `--base <ref>` (défaut `main`) : si le fichier existe dans `<ref>` et que son contenu diffère, `version` doit être plus haute.
- [ ] **Step 1: Write the failing tests** — l'extrait de 05 §4 complété en modèle valide (fixture) passe ; un cas par code de `TemplateIssue` ; volume : un modèle débutant à 4 séries de quadriceps par semaine → `volume_out_of_range` ; `effectiveProgram` : chaque opération structurelle, ordre `decidedAt` puis `id`, `add_slot` crée `A-<id>` ; `validateChange` (05 §17.5) : `add_slot` en prudent → `forbidden_cautious`, `change_sets +1` en prudent → `forbidden_cautious`, `set_target_rir` à la baisse en prudent → `forbidden_cautious`, `set_target_rir` 1 sur un `main` débutant → `rir_out_of_bounds`, `remove_slot` qui vide `core` → `coverage_lost`, `resume_slot` par `coach` → `forbidden_for_author`, `replace_exercise` vers une fiche d'un autre type → `pattern_mismatch`, vers une fiche infaisable dans tous les lieux → `exercise_unusable`, `switch_template` même id et même version → `template_unchanged`, 8e slot d'une séance → `slot_limit` ; serveur : modèle invalide non servi et journalisé, `available` faux quand un slot n'a aucune fiche publiée, `catalogVersion` change quand `available` change ; web : entrée invalide ignorée ; scripts : règle 8 (contenu changé sans hausse de `version` → erreur).
- [ ] **Step 2: Run** `pnpm --filter @rune/domain test program && pnpm --filter @rune/server test catalog && pnpm --filter @rune/scripts test data` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm data:validate` — PASS.
- [ ] **Step 5: Commit** `feat(domain): programme effectif, validateurs des modèles et des changements`.

### Task 4: Évaluation d'un exercice

**Files:**
- Create: `packages/domain/src/program/{evaluate,primitives,stall}.ts`, `packages/domain/test/program/evaluate.test.ts`, `packages/domain/test/program/evaluate.property.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2.
- Produces : `EngineBest` (meilleure charge, total de répétitions à cette charge, meilleure variante, meilleure durée : le record du moteur, §4.3.11 de la spec ; interne, jamais stocké) ; `evaluateExercise(input: {state: (SlotState & {best: EngineBest}) | null, slot: SlotSpec, exercise: CatalogSheet, chainSteps: CatalogSheet[] | null, performed: ExerciseRecord, session: {id, weekType, profile, resumeGapDays: number | null}, grid: LoadGrid, rules: RulesSet}): {decision: EngineDecision, state: SlotState & {best: EngineBest}, stalled: {rank: number, propose: boolean} | null, painStreak: number | null}`.
- Ordre strict de 05 §9 ; précisions §4.3.1 à §4.3.12 de la spec.

- [ ] **Step 1: Write the failing tests** (tableaux de cas, valeurs exactes) —
  - `linear` r = 6, `incrementG` 5 000, barre 20 kg / disque 1,25 kg, charge 60 kg : 3 × 6 + correct → `PROGRESS`/`LOAD_UP`, cible 65 000 ; sans effort → `HOLD`/`EFFORT_MISSING` ; difficile (`targetRir` 2) → `LOAD_UP` ; une série à 5 → `FAIL`/`REPS_UNDER_MIN` ; 2 séries faites sur 3, toutes à 6 → `HOLD`/`SETS_MISSING` ; charges 60, 60, 57,5 → charge réalisée 57 500 ; machine pas 10 000 à 40 kg (`incrementG` 2 500) → mode `double`, `LINEAR_TO_DOUBLE` ;
  - `double` [8, 12] × 3 : 12, 12, 12 + correct → `LOAD_UP` et répétitions à 8 ; 10, 10, 9 après 9, 9, 9 → `REPS_UP` ; total égal → `HOLD`/`NO_PROGRESS` ; une série à 7 → `FAIL` ; haltères 14 kg (pas 2 kg > 10 %) → mode `sum` ; 13, 13, 13 + correct → `SUM_LOAD_UP` vers 16 000 ; après la hausse, une série à 6 (min − 2) → pas d'échec ;
  - `chain` [8, 12] : sommet tenu 2 séances de suite → `CHAIN_NEXT`, `variantRank` + 1, répétitions à 8 ; 2 échecs de suite sur la nouvelle variante → `CHAIN_BACK` ; dernière variante : max 25 (15 en prudent) ;
  - `duration` [20, 60] pas 5 : séries tenues + correct → `DURATION_UP` (+5 s) ; une série sous la cible − 5 s → `FAIL`/`DURATION_UNDER` ; max tenu 2 séances sur un slot à chaîne → `CHAIN_NEXT` ;
  - ordre de 05 §9 : aucune série faite → `IGNORED`/`NO_DATA` ; `weekType` `deload` → `DELOAD`/`DELOAD_WEEK`, et un `next_adjustment = lighten` s'applique quand même ; `hold` → `ADJUSTED_HOLD`/`USER_HOLD` (`PAIN_HOLD` si `painLevel = discomfort`) ; `lighten` → `ADJUSTED_LIGHTEN`, charge `roundDown(c × 0,9)` au moins un pas sous c (60 kg → 52 500 sur la grille barre ; 54 000 n'existe pas) ;
  - calibration : facile → +2 pas (`CALIBRATION_UP`) ; correct → `CALIBRATION_DONE`, `calibrationLeft` 0 ; difficile → maintien ; échec → −10 % (`CALIBRATION_DOWN`) ; 3e séance → `CALIBRATION_END` ; prudent : facile → +1 pas, aucune hausse avant la 3e séance ; séance de reprise (`resumeGapDays` ≥ 14) → règle de calibration ;
  - stagnation (05 §9.6 et §4.3.12) : 3 séances valides sans progrès → `STALL` ; `linear` k = 1 `STALL_1_LIGHTEN`, k = 2 `STALL_2_DOUBLE` [6, 10], k = 3 `STALL_REPLACE_PROPOSED` (`propose: true`) ; `double` k = 1 allègement et retour à min, k = 2 proposition ; `chain` et `duration` k = 1 `STALL_RESET_MIN`, k = 2 proposition ; au-delà, compteur à 0, nouvelle proposition et allègement pour `linear` et `double` ; un record du moteur remet compteur et k à 0 ;
  - prudent : hausse d'un seul pas, répétitions ramenées dans [6, 15].
- [ ] **Step 2: Write the property tests** (fast-check) — jamais de hausse avec un ajustement, une douleur ou un effort manquant ; jamais au-delà de max(`incrementG`, 10 %) pour un adulte, ni plus d'un pas en prudent ; jamais de cible hors des bornes prudentes avec `profile = cautious` ; même entrée, même sortie.
- [ ] **Step 3: Run** `pnpm --filter @rune/domain test program/evaluate` — FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test` — PASS.
- [ ] **Step 6: Commit** `feat(domain): évaluation d'un exercice, primitives et stagnation`.

### Task 5: Rejeu d'une instance

**Files:**
- Create: `packages/domain/src/program/{replay,program-state}.ts`, `packages/domain/test/program/replay.test.ts`, `packages/domain/test/program/replay.property.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3 (`effectiveProgram`), 4 (`evaluateExercise`).
- Produces :
  - `ProgramState {weekIndex, sessionsInWeek, blockWeek: number | null, deloadSessionsLeft, nextWorkoutId, lastCompletedStartedAt: string | null}`.
  - `EngineEvent {key, kind: 'propose_replace' | 'propose_deload' | 'pain_suspend', slotId, exerciseId, triggerSessionId, decidedAt: string | null, operations: InstanceChangeOperation[], reasonCode}` ; `key = \`engine|${instanceId}|${reasonCode}|${slotId ?? ''}|${exerciseId ?? ''}|${triggerSessionId}\`` ; `decidedAt` = `endedAt` de la séance déclenchante pour `pain_suspend`, null pour une proposition.
  - `replayInstance(input: {instance: {id, snapshot: ProgramTemplate, daysPerWeek, startedAt}, sessions: SessionRecord[], changes: AcceptedChange[], catalog: CatalogSheet[], places: ReadonlyMap<string, PlaceContext>, overrides: ReadonlyMap<string, number>, rulesBook?: RulesBook}): ReplayResult {slotStates: SlotState[], decisions: EngineDecision[], state: ProgramState, events: EngineEvent[], program: EffectiveProgram}` ; lève `UnknownRulesVersionError` pour une séance dont la version manque à `rulesBook`.
- Règles : §4.4 de la spec (ordre, entrées figées, douleur, événements, suspension lue comme entrée après la première détection) et §4.3.7 à §4.3.9 (semaines, bloc, allègement, reprise) ; `lighten_exercise` accepté s'applique à la prochaine séance du slot ; `start_deload` accepté (utilisateur ou proposition du moteur acceptée) rend allégées les `daysPerWeek` séances suivantes puis remet le bloc à sa semaine 1 ; écart de reprise en jours civils de Paris (`parisDate`).

- [ ] **Step 1: Write the failing tests** —
  - ordre `startedAt` puis `id` ; un changement à la même heure qu'une séance passe avant ; séances `in_progress` et `abandoned` ignorées ;
  - semaines : 3 jours, 7 séances → `weekIndex` 2, `sessionsInWeek` 1 ; passage de 3 à 2 jours en cours de semaine ; modèle planifié : semaines 5 et 10 allégées ; allègement accepté en semaine 3 → les 3 séances suivantes `deload`, puis bloc en semaine 1 ;
  - douleur (avec `painLevel`) 2 séances de suite sur un slot → un `pain_suspend` dont `decidedAt` = `endedAt` de la 2e séance, slot suspendu dès la séance suivante ; rejeu avec cette suspension en entrée → aucun nouvel événement ; même rejeu après `painLevel` mis à null → slot toujours suspendu, aucun événement ;
  - stagnation → `propose_replace` ; 2 slots en stagnation sur les 2 dernières semaines → `propose_deload` ;
  - reprise : dernière séance le 1er à 23 h 30 Paris, suivante le 15 à 0 h 30 → 14 jours ; séance datée dans le futur : rejeu sans erreur, rotation inchangée pour les suivantes (Review Focus 2) ;
  - versions : avec un `rulesBook` de test `{ '1': …, '2': … (LIGHTEN_PCT 20) }`, une séance en `'1'` garde son allègement de 10 %, une en `'2'` prend 20 % ; version inconnue → `UnknownRulesVersionError` ;
  - `machine_step_g_override` repris des `overrides`.
- [ ] **Step 2: Write the property tests** — rejeu d'un préfixe puis de l'historique entier = rejeu de l'historique entier (mêmes états, mêmes décisions) ; rejouer deux fois donne les mêmes clés d'événements ; découper l'arrivée des séances en plusieurs lots ne change rien.
- [ ] **Step 3: Run** `pnpm --filter @rune/domain test program/replay` — FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test` — PASS.
- [ ] **Step 6: Commit** `feat(domain): rejeu d'une instance, semaines, blocs et événements du moteur`.

### Task 6: Préparation d'une séance

**Files:**
- Create: `packages/domain/src/program/{resolve,plan}.ts`, `packages/domain/test/program/{resolve,plan}.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5 ; `isUsable`, `substitutes`, `usableChainSteps`, `maxExerciseLevel`.
- Produces :
  - `resolveSlot(slot, ctx: {catalog, place: PlaceContext, cautious, maxLevel, state: SlotState | null, suspended: boolean}): {exercise: CatalogSheet | null, resolution: 'planned' | 'replaced_not_feasible' | 'not_feasible_here' | 'suspended', candidates: CatalogSheet[]}` (05 §11 ; `candidates` = liste du slot utilisable puis `substitutes`, pour « Changer d'exercice ») ; variante de chaîne non utilisable → la plus difficile des utilisables de rang inférieur (§4.3.6 de la spec).
  - `PlanNotice = {code: 'resume', days, pct} | {code: 'deload'} | {code: 'minor_barbell', exerciseId} | {code: 'sport_gap'} | {code: 'lightest_load', exerciseId} | {code: 'all_skipped'}`.
  - `PlannedSet {kind, position, side: 'left' | 'right' | null, targetRepsMin, targetRepsMax, targetDurationS, targetLoadG, targetRir, targetVariant}` ; `PlannedExercise {slotId, plannedExerciseId, exerciseId: string | null, resolution, loadMode, measure, unilateral, sets: PlannedSet[], restS, platesPerSide: number[] | null, calibration: boolean, suggestionG: number | null}` ; `PlannedWorkout {workoutId, weekType, rulesVersion, notices: PlanNotice[], exercises: PlannedExercise[]}`.
  - `planWorkout(input: {replay: ReplayResult, workoutId, place: PlaceContext, catalog, profile: SessionProfile, ageBand, context: 'gym' | 'home' | 'sport', today: string, lastLoadByExercise: ReadonlyMap<string, number>}): PlannedWorkout`.
- Règles : cibles depuis les `SlotState` du rejeu, ramenées à la grille du lieu (§4.3.10) ; semaine allégée (séries de travail divisées par deux arrondi au-dessus, `targetRir` + 2 plafonné à 5) ; bornes prudentes ; reprise ; échauffement `pctWorkLoad` × cible de travail arrondi par `roundDown` et au moins la barre ; unilatéral → paires gauche/droite de même `position` ; calibration → `suggestionG` = `lastLoadByExercise`.

- [ ] **Step 1: Write the failing tests** — premier exercice utilisable ; matériel retiré du lieu → `replaced_not_feasible` (R-MAT-3) ; aucune fiche → `not_feasible_here` ; prudent → fiche `not_for_minors` écartée ; **fiche retirée en tête de slot → la suivante** (Review Focus 5) ; variante non utilisable → variante inférieure ; allégée : 3 → 2, 4 → 2, 5 → 3 séries, RIR 2 → 4, RIR 4 → 5 ; prudent : 4–6 → 6–8, 5 séries → 3, RIR 2 → 3 ; reprise 14 j : 60 kg → 52 500 (−10 % puis `roundDown`), notice `resume` ; 28 j : −20 % et une variante de moins ; échauffement 50 % de 60 kg → 30 000 ; 50 % de 25 kg → 20 000 (barre) ; exercice unilatéral 3 séries → 6 lignes ; grille sans charge plus légère → `lightest_load` ; mineur et exercice `barbell` → `minor_barbell` ; modèle `sport` → `sport_gap` ; tous les slots sautés → `all_skipped`.
- [ ] **Step 2: Run** `pnpm --filter @rune/domain test program/resolve program/plan` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(domain): choix de l'exercice selon le lieu et préparation de la séance`.

### Task 7: XP, rangs, compteurs et records

**Files:**
- Create: `packages/domain/src/progress/{rules,xp,ranks,records,stats,index}.ts`, `packages/domain/test/progress/*.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: Task 2 (`SessionRecord`, `isDone`), `MUSCLE_GROUPS`, `CatalogSheet`, `parisDate`.
- Produces : `PROGRESS_RULES_VERSION = '1'` ; `RANKS = ['E','D','C','B','A','S'] as const`, `Rank` ; `XP_RULES = {perWorkSet: 10, perEffortExercise: 5, perCompletedSession: 20, sessionCap: 300}` ; `GLOBAL_RANK_XP` et `GROUP_RANK_SETS` (valeurs des Global Constraints) ; `sessionXp(session): number` ; `progressSummary(history: SessionRecord[], catalog: CatalogSheet[]): {xp, rank, nextRank: Rank | null, nextRankXp: number | null, groups: Record<MuscleGroupCode, {sets: number, rank: Rank}>, sessions, tonnageG, assiduityWeeks}` ; `exerciseRecords(history, exerciseId, ageBand): ExerciseRecords {bestLoad: {loadG, reps} | null, bestReps: number | null, bestDurationS: number | null, bestSessionVolumeG: number | null, e1rmG: number | null}` ; `sessionRecords(history, sessionId): RecordHit[]` (`RecordHit {exerciseId, kind: 'load' | 'reps' | 'duration' | 'volume', value}`) ; `rankUps(before, after): {global: Rank | null, groups: MuscleGroupCode[]}`.
- Le 1RM estimé : Epley `charge × (1 + (reps + RIR)/30)`, seulement si `reps + RIR ≤ 12` et charge externe (`barbell`, `dumbbell`, `machine`), RIR 0 sans effort, null pour `ageBand = minor`, arrondi au gramme inférieur.

- [ ] **Step 1: Write the failing tests** — 15 séries de travail, 6 exercices avec effort → 200 XP ; 40 séries → 300 ; séance `abandoned` → 0 ; échauffements ignorés ; paire unilatérale = 1 série ; 999 XP → E, 1 000 → D ; crédit de groupe : muscle principal 1, secondaire seul 0,5, au plus 1 par groupe et par série ; 19,5 séries → E, 20 → D ; tonnage 60 kg × 6 × 3 = 1 080 000 g ; semaines d'assiduité : séances le dimanche 23 h 30 et le lundi 0 h 30 (Paris) → 2 semaines ; 1RM : 60 kg × 6 + correct → 77 000 g ; 10 répétitions + facile → null ; poids du corps → null ; mineur → null ; première séance d'un exercice → aucun record ; égalité → pas de record.
- [ ] **Step 2: Run** `pnpm --filter @rune/domain test progress` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(domain): XP, rangs, compteurs et records`.

### Task 8: Les 6 modèles et le lot A définitif

**Files:**
- Create: `data/programs/{gym-beginner-full-body-ab,gym-intermediate-upper-lower,home-beginner-full-body,home-intermediate-upper-lower,sport-beginner-complement,sport-intermediate-strength-prevention}.json`
- Modify: `docs/catalog/lot-a-provisoire.md` → `git mv` vers `docs/catalog/lot-a.md`, `data/exercises/*.json` (squelettes ajoutés ou retirés), `scripts/test/data/validate.test.ts` (chaque id que `recommendTemplate` peut rendre existe dans `data/programs`, 05 §17.6)

**Interfaces:**
- Consumes: Tasks 1, 3 (`validateTemplate`), le lot A provisoire.
- Contenu (05 §3 et §3.1 de la spec) : chaque modèle reprend sa ligne du tableau de 05 §3 (jours, séances, séries, progression, bloc). Slugs pris dans le lot A ; listes du plus chargé au poids du corps ; `targetRir` 2 sur les slots `main` débutants, `restS` 150 en polyarticulaire principal et 60 à 90 en isolation ; échauffement `[{kind:'warmup', count: 2, reps: {min: 5, max: 5}, pctWorkLoad: 50}]` sur les slots `main` à la barre seulement ; `estimatedMinutes` réaliste (30 à 40 pour les modèles `sport`). Les volumes doivent tomber dans les fourchettes du validateur.

- [ ] **Step 1: Write** les 6 fichiers, `version: 1`.
- [ ] **Step 2: Run** `pnpm data:validate` — corriger jusqu'à PASS (aucun `TemplateIssue`).
- [ ] **Step 3: Write** `docs/catalog/lot-a.md` : la liste réelle (conditions a et b de 04 §7 tirées des 6 fichiers), avec les écarts au provisoire ; ajouter les squelettes manquants, retirer les fiches inutiles (encore `draft`, jamais chargées en base qui fait foi). **Arrêt pour le propriétaire : validation de la liste et des ids.** Les tâches de code continuent sans attendre.
- [ ] **Step 4: Run** `pnpm data:validate && pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(data): les 6 modèles de programmes et le lot A définitif`.

### Task 9: Lot B : liste, squelettes et CI stricte

**Files:**
- Create: `docs/catalog/lot-b.md`, `data/exercises/*.json` (squelettes `batch: "B"`)
- Modify: `.github/workflows/ci.yml` (ligne 57, `pnpm data:validate` → `pnpm data:validate --strict`), `README.md` si la commande y figure

**Interfaces:**
- Consumes: Task 8.

- [ ] **Step 1: Write** la liste du lot B : fiches nécessaires pour que chaque slot ait au moins 2 exercices utilisables (adulte, `maxLevel` du modèle) dans chaque profil de référence pertinent, 1 en prudent (04 §7, condition c), plus la couverture de `back_extension_bench`, `dip_station`, `ez_bar`, `smith_machine`, `suspension_trainer` ; un squelette par fiche ; un test de script calcule la condition (c) sur les 6 modèles et échoue si elle n'est pas remplie.
- [ ] **Step 2: Run** `pnpm data:validate --strict` — PASS.
- [ ] **Step 3: Modify** la CI pour lancer `data:validate --strict`.
- [ ] **Step 4: Commit** `feat(data): squelettes du lot B et validation stricte en CI`. **Arrêt pour le propriétaire : validation de la liste.**

### Task 10: Scénarios de référence et parité

**Files:**
- Create: `packages/domain/test/program/scenarios.test.ts`, `packages/domain/test/program/__snapshots__/`, `packages/domain/test/support/scripted-profiles.ts`, `packages/domain/test/fixtures/parity-history.json`, `apps/web/test/program/parity.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 8 ; les 6 modèles et `data/exercises` (le test les charge et les traite comme publiés).

- [ ] **Step 1: Write** `scripted-profiles.ts` : 5 profils (progresse toujours, échoue, signale une douleur, ne saisit jamais l'effort, profil prudent), chacun une fonction `(plannedSet) → SetRecord` déterministe.
- [ ] **Step 2: Write the tests** — pour chaque modèle et chaque profil, 12 semaines de programme au nombre de jours par défaut (`gym_reference` pour `gym`, `home_bodyweight` pour `home` et `sport`), `planWorkout` puis séance simulée puis `replayInstance` ; instantané lisible (par semaine : cibles de chaque slot, résultats, événements). Propriétés vérifiées en plus : « ne saisit jamais l'effort » → aucune hausse de charge sur 12 semaines ; « prudent » → toutes les cibles dans les bornes. Parité : `parity-history.json` (historique de 9 séances avec douleur, ajustement, changement accepté) rejoué sous Node, résultat écrit en instantané ; `apps/web/test/program/parity.test.ts` rejoue le même fichier sous happy-dom et compare à l'instantané.
- [ ] **Step 3: Run** `pnpm --filter @rune/domain test scenarios && pnpm --filter @rune/web test parity` — PASS (instantanés créés), puis relire les instantanés : aucune hausse au-delà des plafonds, allègements aux semaines attendues.
- [ ] **Step 4: Commit** `test(domain): scénarios de référence sur 12 semaines et parité téléphone/serveur`.

### Task 11: Tables, migration et registre

**Files:**
- Create: `apps/server/src/db/migrations/0004_program.ts`, `apps/server/test/db/program-migration.test.ts`
- Modify: `apps/server/src/db/migrations/index.ts`, `packages/contracts/src/entity-rules.ts`, `packages/contracts/src/sync.ts` (`COLUMN_CODECS`), `packages/contracts/test/entity-rules.test.ts`, `apps/server/test/db/entity-rules.test.ts`, `apps/server/test/__snapshots__/schema.sql`, `apps/server/test/ops/active-sessions.test.ts`, les jeux de `delete.test`, `pull-leak.test` et de l'isolation admin

**Interfaces:**
- Consumes: Task 1.
- Produces : les 7 tables de 09 §3 avec les ajouts de la spec §5.1 (`workout_session.profile`, `performed_set.logged_at` nullable, index unique partiel de `program_instance`, pas de clé étrangère pour `workout_session.instance_id`, `workout_session.place_id`, `slot_state.exercise_id`) ; `parent`, `c2Columns`, `c2Values` et `clientWritable` du tableau §5.2 ; l'aide `rule()` accepte `c2Columns`, `c2Values`, `parent` ; `COLUMN_CODECS` : JSON `snapshot`, `operations`, `next_target` ; booléens `suspended`, `ai_generated`.

- [ ] **Step 1: Write the failing tests** — migration sur base vide et sur `schema-v2.sql` ; deux instances `active` du même propriétaire → contrainte ; `reps` et `duration_s` ensemble → CHECK ; registre : chaque colonne déclarée, compte de tables mis à jour (« 18 tables du socle, 5 du catalogue, 7 des programmes »), `parent` admis sur les tables de la brique 3 seulement ; `listActiveWorkoutSessions` sur la vraie migration ; suppression de compte : plus aucune ligne des 7 tables ; `pull-leak` : aucune ligne d'un autre membre ; une session admin reçoit 404 sur les lignes des autres.
- [ ] **Step 2: Run** `pnpm --filter @rune/server test db ops privacy && pnpm --filter @rune/contracts test` — FAIL.
- [ ] **Step 3: Implement** (style `table()` de `0003_catalog.ts`, `breaking: false`).
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): tables des programmes et des séances`.

### Task 12: Push des séances et rejeu par le serveur

**Files:**
- Create: `apps/server/src/program/{sync-hooks,replay-service,expire,records}.ts`, `apps/server/test/program/{push,replay,expire}.test.ts`
- Modify: `apps/server/src/sync/hooks.ts` (enregistre les hooks), `apps/server/src/sync/pull.ts` (expiration avant le pull), `apps/server/src/deps.ts`

**Interfaces:**
- Consumes: Tasks 5, 11 ; `Clock` des dépendances.
- Produces : `PROGRAM_SYNC_HOOKS` (`beforeApply` du §5.3 de la spec, `afterBatch` qui rejoue chaque instance touchée une fois) ; `replayInstanceInDb(trx, {ownerId, instanceId}, deps): Promise<void>` (charge l'entrée du rejeu, appelle `replayInstance`, écrit seulement les lignes changées, supprime logiquement les lignes disparues sauf `slot_state` avec surcharge, insère les événements absents avec `id = uuidFromKey(key)`) ; `uuidFromKey(key): string` (SHA-256, 16 premiers octets, bits de version 8 et de variante RFC 9562) ; `expireProposals(trx, ownerId, now): Promise<void>` ; `toSessionRecords(rows)` (lignes → types du domaine).
- Événements : `propose_*` → `status 'proposed'`, `author 'engine'`, `expires_at` = maintenant + 7 jours ; `pain_suspend` → `status 'accepted'`, `decided_at` = celui de l'événement, `revision` + 1.

- [ ] **Step 1: Write the failing tests** —
  - push : création idempotente ; `forbidden_reference` (lieu ou instance d'un autre) ; instance ou lieu inconnus → acceptés, séance non rejouée ; `profile: 'adult'` d'un mineur → stocké `cautious` ; patch de `profile` ignoré ; `completed → in_progress` → `invalid_transition` ; `exercise_id` inconnu ou `draft` → `unknown_exercise` ; `reps: 201` → `out_of_range` ; `pain_level` sans consentement → `applied_partial`, NULL en base ;
  - rejeu : une séance terminée → `slot_state` et `engine_decision` écrits ; un second push sans changement d'état → aucun nouveau `rev` ; séance supprimée → ses décisions supprimées logiquement ; surcharge de pas gardée ; douleur 2 fois → un `instance_change` `PAIN_SUSPEND` accepté, `revision` + 1, une seule ligne après 3 rejeux ; mêmes séances en un ou deux pushs → mêmes lignes ;
  - expiration : proposition de plus de 7 jours ou à `base_revision` périmée → `expired` au pull suivant.
- [ ] **Step 2: Run** `pnpm --filter @rune/server test program` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): séances synchronisées et rejeu du programme par le serveur`.

### Task 13: API du programme

**Files:**
- Create: `apps/server/src/program/{routes,enroll,changes,machine-step}.ts`, `apps/server/test/program/{enroll,changes,machine-step,isolation}.test.ts`
- Modify: `apps/server/src/routes.ts`

**Interfaces:**
- Consumes: Tasks 3 (`validateChange`, `templateAvailable`), 12 (`replayInstanceInDb`, `expireProposals`).
- Produces : routes du §6 de la spec, corps et réponses de la Task 1 ; après toute acceptation, `replayInstanceInDb` dans la même transaction.

- [ ] **Step 1: Write the failing tests** — `enroll` : 201, `snapshot` = fichier complet servi, `template_version` ; seconde inscription → 409 `already_enrolled` ; modèle indisponible → 422 `template_unavailable` ; 5 jours → 422 `days_out_of_range` ; `changes` : changement utilisateur accepté, `revision` + 1 ; base périmée → 409 `stale_revision` ; erreurs → 422 `{errors}` ; `switch_template` : ancienne `ended`, nouvelle `active` dans la même transaction, jours ramenés dans les bornes, même modèle en version plus haute admis, même version → `template_unchanged`, séance `in_progress` → 409 `session_in_progress` ; `accept` : base périmée → 409 `stale_revision` et la proposition passe `expired` ; plus de 7 jours → 409 `expired` ; `reject` → `rejected` ; décision sur un changement non `proposed` → 409 `not_proposed` ; `machine-step` : crée la ligne pendant une calibration, `null` efface, 404 sur le slot d'un autre ; `Origin` étranger → 403 ; une session admin reçoit 404 sur les changements d'un membre.
- [ ] **Step 2: Run** `pnpm --filter @rune/server test program` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): inscription, changements de programme et pas des machines`.

### Task 14: Retrait santé, exports et textes de confidentialité

**Files:**
- Create: `apps/server/src/privacy/sets-csv.ts`, `apps/server/test/privacy/sets-csv.test.ts`
- Modify: `apps/server/src/privacy/consent.ts` (`HEALTH_WITHDRAW_HOOKS`), `apps/server/src/privacy/` (route `GET /api/me/export/sets.csv`), `apps/server/test/privacy/consent*.test.ts`, `apps/web/src/local-db/c2.ts` (purge des nouvelles colonnes et des opérations en attente), `apps/web/src/features/privacy/` (bouton « Télécharger mes séries (CSV) »), `docs/fiche-de-traitement.md`, `apps/web/src/features/public/privacy-content.ts`, `apps/server/test/infra/docs.test.ts`

**Interfaces:**
- Consumes: Task 11.
- Produces : en-tête CSV exact `date;heure;seance;lieu;exercice;exercice_id;position;cote;type;charge_kg;repetitions;duree_s;effort;cible_reps_min;cible_reps_max;cible_duree_s;cible_charge_kg;cible_rir`, plus `;douleur` avec le consentement santé ; BOM UTF-8, fins de ligne `\r\n`, virgule décimale, nom de fichier `rune-series-<AAAA-MM-JJ>.csv`.

- [ ] **Step 1: Write the failing tests** — retrait : `pain_level`, `swap_reason = 'pain'`, `pain_streak`, `reason` à NULL ; `PAIN_HOLD` → `USER_HOLD`, `PAIN_SUSPEND` → `USER_SUSPEND` dans `instance_change` et `engine_decision` ; nouveaux `rev` ; aucun autre champ de `slot_state` modifié ; la suspension reste ; téléphone : copies et opérations en attente purgées ; CSV : en-tête exact, BOM, `62,5`, une ligne par série faite, rien d'un autre membre, colonne douleur seulement avec consentement, `Sec-Fetch-Site: cross-site` → 403 `origin_mismatch`, journal sans contenu ; textes : la fiche de traitement et la page Confidentialité nomment séances, séries, programmes, CSV et le profil prudent (C1).
- [ ] **Step 2: Run** `pnpm --filter @rune/server test privacy infra && pnpm --filter @rune/web test privacy local-db` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): retrait santé des séances, CSV des séries et confidentialité`.

### Task 15: Base locale v2 et dépôt des séances

**Files:**
- Create: `apps/web/src/repos/workout-repo.ts`, `apps/web/src/repos/program-view.ts`, `apps/web/test/repos/{workout-repo,program-view}.test.ts`, `apps/web/test/local-db/fixtures/v1/` (jeu figé), `apps/web/test/local-db/db-v2.test.ts`
- Modify: `apps/web/src/local-db/db.ts` (`LOCAL_DB_VERSION = 2`, 7 magasins, index `provisional`), `apps/web/src/repos/index.ts`, `apps/web/src/sync/triggers.ts` (synchro 2 s après une série), `apps/web/test/local-db/db.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 7, 11 ; `writeLocal`, `meta.activeSessionId`.
- Produces :
  - `repos.workouts` : `start({plan: PlannedWorkout, placeId, instanceId, workoutId, profile, templateVersion}): Promise<string>` (séance, exercices, toutes les séries prévues, en une transaction) ; `logSet(setId, {loadG?, reps?, durationS?, effort?})` (pose `loggedAt`) ; `reopenSet(setId)` ; `setEffort(setId, effort)` ; `addSet(performedExerciseId)` ; `removeSet(setId)` (série non faite seulement) ; `swapExercise(performedExerciseId, exerciseId, reason)` (réécrit les séries non faites) ; `markPain(performedExerciseId, level: 'discomfort' | 'pain')` ; `setAdjustment(performedExerciseId, 'hold' | 'lighten' | null)` ; `setNote(target, text)` ; `changePlace(sessionId, plan, placeId)` ; `finish(sessionId)` ; `remove(sessionId)` ; `continueHere(sessionId)` ; `closeStale(now)` ; `addFreeExercise(sessionId, exerciseId)`.
  - Lectures (`useLive`) : `useActiveSession()`, `useSession(id)`, `useHistory()`, `useOtherDeviceSession()`.
  - `program-view.ts` : `useProgramView(): ProgramView | null | undefined` avec `ProgramView {instance, template, program: EffectiveProgram, replay: ReplayResult, slotStates: SlotState[], source: 'local' | 'server', proposals: InstanceChangeView[], changes: InstanceChangeView[]}` (rejeu local sur le miroir, ou `slot_state` du serveur si `UnknownRulesVersionError`) ; `usePlannedWorkout(placeId, workoutId)` ; `storeProvisional(replay)` (copies `provisional: true`, remplacées par le pull).
- Règles : D2, D4, D12 de la spec ; `markPain` sans consentement → écrit seulement `nextAdjustment` (`discomfort` → `hold`, `pain` → `lighten`) ; `device_id` = identifiant d'appareil existant du socle.

- [ ] **Step 1: Write the failing tests** — `start` : une transaction, une op par ligne, `meta.activeSessionId` posé ; `logSet` → `loggedAt` ; `finish` : `completed`, séries non faites supprimées logiquement, `activeSessionId` effacé ; sans série de travail → `abandoned` ; `closeStale` : 6 h sur cet appareil, 24 h sur un autre, `ended_at` = dernière `loggedAt` ; `continueHere` réécrit `device_id`, l'autre appareil voit `useOtherDeviceSession` ; **réouverture** : un nouveau `repos` sur la même base Dexie rend la même séance et les mêmes séries faites (Review Focus 1) ; **deux appareils** : patchs concurrents, aucune série en double, l'appareil perdant reçoit la séance en lecture seule après le pull (Review Focus 3) ; `markPain` sans consentement : ni `painLevel` ni `swapReason: 'pain'` dans Dexie ni dans l'outbox ; Dexie v2 relit l'outbox et le miroir du jeu figé v1 ; synchro déclenchée 2 s après `logSet` ; `useProgramView` repasse à `source: 'server'` sur une version de règles inconnue.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test repos local-db sync` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): base locale des séances, rejeu local et dépôt des séances`.

### Task 16: Dépôt du programme

**Files:**
- Create: `apps/web/src/repos/program-repo.ts`, `apps/web/test/repos/program-repo.test.ts`
- Modify: `apps/web/src/repos/index.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 13 ; `recommendTemplate`.
- Produces : `repos.program` : `templates(): ServedProgramTemplate[]` (vivant) ; `recommendation(): Recommendation | null` (profil d'entraînement + lieu principal + descripteurs `{id, context, level, days, available}`) ; `enroll(templateId, daysPerWeek)` ; `change(operations, baseRevision)` ; `accept(id, baseRevision)` ; `reject(id)` ; `setMachineStep(slotStateId, stepG | null)` ; chaque appel réussi déclenche `pullNow`. Utilitaires : `changeErrorsOf(e): {op, code}[] | null`, `isStaleRevision(e)`, `isExpired(e)` ; hors ligne → l'erreur existante « Nécessite le réseau ».

- [ ] **Step 1: Write the failing tests** — corps envoyés exacts ; 409 et 422 traduits par les utilitaires ; `recommendation` passe `available` et rend `null` sans profil ; hors ligne → erreur réseau, aucune écriture locale.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test repos/program-repo` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): dépôt du programme et recommandation`.

### Task 17: Bouton Séance et séance du jour

**Files:**
- Create: `apps/web/src/features/workout/{WorkoutToday,PlanList,PlaceChips,WorkoutPicker,OtherDeviceBanner}.tsx`, `apps/web/src/features/workout/{workout-labels.ts,workout.module.css,index.ts}`, `apps/web/test/workout/{today,tabbar}.test.tsx`
- Modify: `apps/web/src/ui/TabBar.tsx`, `apps/web/src/ui/SideNav.tsx`, `apps/web/src/ui/format.ts` (`formatKg(g)`, `formatSeconds(s)`), `apps/web/src/App.tsx` (routes de la spec §7, écrans de la brique 3 par `lazy(() => import(…))`), `apps/web/test/architecture.test.ts` (`features/workout`, `history`, `program` hors du bundle initial)

**Interfaces:**
- Consumes: Tasks 6, 15, 16 ; `CatalogMissing`, `SheetContent`, `BottomSheet`, `Chips`.
- Produces : `TAB_ITEMS` à 5 entrées (Accueil · Exercices · Séance · Progression · Profil), Séance actif sur `/workout…` et `/program…`, Progression sur `/progression…` et `/history…` ; `targetSummary(plannedExercise): string` dans `workout-labels.ts`.

- [ ] **Step 1: Write the failing tests** — barre : ordre et `aria-current` ; nom accessible « Séance, en cours » avec une séance en cours ; `/workout` avec une séance en cours sur cet appareil → `/workout/:id` ; résumés exacts « 3 × 6 · 60 kg », « 3 × 8–12 · 14 kg par main », « 3 × 30 s », « Calibration : tu choisis ta charge » ; mentions « Remplace Squat barre (pas faisable ici) », « Pas faisable ici : sauté », « Suspendu » ; avis « 16 jours depuis ta dernière séance : charges −10 % » ; pastilles de lieux, principal présélectionné ; « Changer » ouvre la liste des séances du modèle ; « Commencer » hors ligne crée la séance sans appel réseau ; sans programme : « Choisis ton programme » et « Séance libre » ; toute la séance sautée : « Aucun exercice de cette séance n'est disponible pour l'instant. » ; séance sur un autre appareil : « Séance en cours sur un autre appareil » avec « Continuer ici », « La terminer », « La supprimer ».
- [ ] **Step 2: Run** `pnpm --filter @rune/web test workout ui architecture` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): bouton Séance et séance du jour`.

### Task 18: Saisie d'une séance

**Files:**
- Create: `apps/web/src/features/workout/{LiveWorkout,ExerciseCard,SetRow,EffortSheet,FinishSheet,DurationTimer,SessionMenu}.tsx`, `apps/web/src/features/workout/number-input.ts`, `apps/web/test/workout/{live,set-row,number-input}.test.tsx`

**Interfaces:**
- Consumes: Tasks 2 (`loadGrid`, `next`, `roundDown`), 15, 17.
- Produces : `parseKg(text): {ok: true, g: number} | {ok: false, error: 'empty' | 'invalid' | 'too_high'}` (virgule ou point, arrondi au gramme, > 500 kg → `too_high`) ; `parseCount(text, max)`.
- Textes : colonnes « Série », « Préc. », « kg », « Reps » ; erreurs « Indique une charge », « Charge invalide », « Charge trop élevée » ; effort, libellés de 05 §7 mot pour mot (« J'aurais pu en faire 4 de plus, ou plus », « Encore 2 ou 3 », « Encore 1, pas plus », « La dernière n'est pas passée ») et « Plus tard » ; feuille de fin « Effort non noté : la charge n'augmentera pas », « Noter maintenant », « Terminer quand même » ; lecture seule « Cette séance continue sur un autre appareil. » ; rappel des notes « N'écris pas d'informations sur ton identité ni sur ta santé. ».

- [ ] **Step 1: Write the failing tests** — lignes pré-remplies avec la cible ; « Préc. » recopie la série de même position de la dernière fois ; + sur 62,5 kg (barre) → 65 kg, − → 60 kg ; + sur 14 kg (haltères) → 16 kg ; répétitions ± 1 ; **saisie** `62,5` et `62.5` → 62 500 ; vide, `abc`, `600` → message sous le champ et rien d'écrit (Review Focus 4) ; ✓ écrit la série et l'affiche faite ; toucher une série faite la rouvre ; unilatéral : lignes « Gauche » et « Droite » ; durée : le chronomètre remplit « Secondes » à l'arrêt ; feuille d'effort après la dernière série de travail ; « Ajouter une série », « Retirer une série » (non faite) ; « Changer de lieu » absent après la première série faite ; « Supprimer la séance » demande confirmation ; « Terminer » secondaire tant qu'il reste des séries, principal ensuite ; effort manquant → feuille de fin ; fin → `/workout/:id/summary` ; « N en attente » affiché ; note de 501 caractères refusée ; cibles ≥ 48 px (règle CSS vérifiée comme dans `admin-styles.test.ts`).
- [ ] **Step 2: Run** `pnpm --filter @rune/web test workout` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): saisie des séries, effort et fin de séance`.

### Task 19: Pendant la séance : repos, écran, changement d'exercice, douleur, ajustements

**Files:**
- Create: `apps/web/src/features/workout/{RestTimer,SwapSheet,PainSheet,AdjustSheet,MachineStepSheet}.tsx`, `apps/web/src/features/workout/{rest-timer,wake-lock,rest-sound}.ts`, `apps/web/src/repos/device-settings.ts`, `apps/web/test/workout/{rest-timer,wake-lock,swap,pain}.test.tsx`
- Modify: `apps/web/src/features/workout/ExerciseCard.tsx`, l'écran Réglages (section « Séance »)

**Interfaces:**
- Consumes: Tasks 6 (`candidates`), 15, 16 (`setMachineStep`), 18.
- Produces : `restTimer` (heure de fin absolue en mémoire et dans `sessionStorage`, recalculée à `visibilitychange`) ; `deviceSettings` : `keepScreenOn` et `restSound`, tous deux vrais par défaut, stockés sur l'appareil.
- Texte du conseil, mot pour mot : « Arrête l'exercice si la douleur augmente ; si elle persiste, consulte un médecin ou un kiné ; douleur à la poitrine ou malaise : appelle le 15 ou le 112. » ; pour un mineur, en plus : « Parles-en à un parent. » ; mineur et barre : « Entraîne-toi avec un adulte expérimenté. ».

- [ ] **Step 1: Write the failing tests** — minuteur lancé avec `restS` après une série de travail, pas après un échauffement ; −15 s, +15 s, « Passer » ; temps juste après un passage en arrière-plan simulé (faux minuteurs + `visibilitychange`) et après rechargement (Review Focus 1) ; à zéro, « Repos terminé » dans une région `aria-live` ; son joué seulement si visible et activé ; Wake Lock demandé au montage, redemandé au retour au premier plan, relâché à la fin, jamais si le réglage est coupé ; « Changer d'exercice » liste les candidats et les raisons (Matériel, Occupé, Douleur, Préférence) ; « Douleur » avec consentement → `painLevel` et `nextAdjustment`, sans consentement → seulement `nextAdjustment`, conseil affiché, feuille de changement ouverte sur le même type de mouvement ; « La prochaine fois : ne pas augmenter » / « alléger » ; « Pas de cette machine » grisé hors ligne avec « Nécessite le réseau ».
- [ ] **Step 2: Run** `pnpm --filter @rune/web test workout` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): minuteur de repos, écran allumé, changement d'exercice et douleur`.

### Task 20: Fin de séance et séance libre

**Files:**
- Create: `apps/web/src/features/workout/{WorkoutSummary,FreeWorkout,ExercisePicker}.tsx`, `apps/web/test/workout/{summary,free}.test.tsx`
- Modify: `apps/web/src/features/coach/coach-lines.ts` (moment `session_end`, 3 textes par coach), `apps/web/test/coach/coach-lines.test.ts`

**Interfaces:**
- Consumes: Tasks 7 (`sessionXp`, `progressSummary`, `sessionRecords`, `rankUps`), 15, 18 ; `RankBadge`, `SystemPanel`, `CoachBubble`.

- [ ] **Step 1: Write the failing tests** — « Séance gravée. », durée, séries de travail, kg soulevés ; XP gagnée et rang ; passage de rang → nouvelle pierre (fondu en mouvement réduit) ; « Nouveau record : 62,5 kg × 6 » ; premier passage → pas de record ; « La prochaine fois » : cible et phrase de `REASON_TEXTS`, mention « provisoire » tant que la décision du serveur n'est pas arrivée ; bulle `session_end` ; séance libre : recherche avec le filtre « Faisable : <lieu> », séries sans cible, pas de « La prochaine fois » ; textes de coach sans chiffre de charge (garde-fous de la refonte §8).
- [ ] **Step 2: Run** `pnpm --filter @rune/web test workout coach` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): fin de séance, XP, records et séance libre`.

### Task 21: Historique et corrections

**Files:**
- Create: `apps/web/src/features/history/{HistoryList,HistoryDetail}.tsx`, `history.module.css`, `apps/web/test/history/*.test.tsx`

**Interfaces:**
- Consumes: Task 15 ; `REASON_TEXTS`.

- [ ] **Step 1: Write the failing tests** — groupes par mois, ligne « mar. 28 oct. · Séance A · Salle du centre · 52 min · 15 séries · 3 200 kg » (en tonnes au-delà de 10 000 kg : « 12,4 t ») ; « Séance libre » ; « Lieu inconnu » ; détail : séries, efforts, décision en une phrase ; douleur affichée seulement si stockée ; « Modifier » rouvre les séries faites et écrit des patchs ; « Supprimer la séance » avec confirmation ; **fiche retirée** : nom affiché, records conservés (Review Focus 5).
- [ ] **Step 2: Run** `pnpm --filter @rune/web test history` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): historique des séances et corrections`.

### Task 22: Mon programme, choix du programme, E8 et Profil

**Files:**
- Create: `apps/web/src/features/program/{ProgramPage,SlotSheet,ProposalCard,ChangeLog,ChooseProgram,EnrollSheet,program-labels.ts,program.module.css}`, `apps/web/test/program/*.test.tsx`
- Modify: `apps/web/src/features/onboarding/ReadyStep.tsx`, `apps/web/src/features/profile/` (bandeau R-REC-7), tests existants de l'onboarding

**Interfaces:**
- Consumes: Tasks 3 (`validateChange` pour griser côté client), 15 (`useProgramView`), 16.
- Textes : messages par code de `CHANGE_ERROR_CODES` dans `program-labels.ts` ; « Proposition de Rune » ; avertissement de changement de programme (spec §7.8) ; « Une nouvelle version de ton programme existe. », « Passer à la nouvelle version » ; « Pas encore disponible » ; « Recommandé pour toi » et une phrase par raison de `recommendTemplate` ; « Un autre programme te correspond mieux » ; E8 « Commencer avec ce programme » ; « Pas encore de programme disponible : tu pourras faire des séances libres. ».

- [ ] **Step 1: Write the failing tests** — en-tête « Semaine 3 · bloc 3 / 5 » ; proposition avec avant/après, « Accepter », « Refuser » ; chaque action de la feuille d'un slot envoie l'opération attendue ; « Jours par semaine » envoie `set_days_per_week`, « Commencer une semaine allégée » envoie `start_deload`, « Changer de programme » ouvre `/program/choose` ; journal des changements avec « Toi », « Rune », « Coach IA » ; prudent : « Ajouter un exercice » absent et phrase d'explication, hausses absentes ; 422 → message sous l'action ; 409 `stale_revision` → « Le programme a changé : vérifie et recommence. » ; hors ligne → actions grisées « Nécessite le réseau » ; choix : 6 cartes, badge et raisons, modèle indisponible grisé ; feuille d'inscription avec jours dans les bornes ; E8 : case cochée par défaut, « Commencer » inscrit puis termine l'onboarding, case décochée → pas d'inscription ; bandeau de nouvelle version ; bandeau du Profil quand la recommandation change.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test program onboarding profile` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): mon programme, choix du programme et inscription à l'onboarding`.

### Task 23: Progression réelle, page d'un exercice et accueil

**Files:**
- Create: `apps/web/src/features/progression/{ExerciseProgress,LineChart}.tsx`, `apps/web/test/progression/*.test.tsx`, `apps/web/test/home/home-cards.test.tsx`
- Modify: `apps/web/src/features/progression/ProgressionPage.tsx`, `apps/web/src/features/home/HomePage.tsx`, `apps/web/src/features/exercises/ExercisesHome.tsx` (rang réel des tuiles)

**Interfaces:**
- Consumes: Tasks 7, 15, 16, 17.

- [ ] **Step 1: Write the failing tests** — Progression : « Rang D · 1 240 / 5 000 XP » ; compteurs réels ; « Quadriceps, rang D » ; records récents ; liens vers l'historique et les exercices ; page d'un exercice : courbe SVG avec un tableau équivalent pour les lecteurs d'écran, records, 1RM avec « estimation, écart possible de 10 % ou plus », absent pour un mineur ; sans séance : fenêtre du Système actuelle ; tuiles Exercices : nom accessible « Quadriceps, rang D, 18 exercices » ; accueil : ordre des cartes du §7.9, « Tes programmes et tes séances arriveront ici. » absent, Quêtes d'éveil masquées une fois faites, bandeau des 18 ans une fois par appareil.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test progression home exercises` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): progression réelle, rangs des groupes et cartes d'accueil`.

### Task 24: Réglages de charge

**Files:**
- Create: `apps/web/src/features/places/LoadSettingsPage.tsx`, `apps/web/test/places/load-settings.test.tsx`
- Modify: `packages/contracts/src/load-settings.ts` (`DUMBBELL_CHOICES_G`), `apps/web/src/App.tsx` (routes `/places/:id/load`, `/gyms/:id/load`), fiches de lieu et de salle (ligne « Réglages de charge »)

**Interfaces:**
- Consumes: `LoadSettingsSchema`, `PATCH /api/places/:id`, `PATCH /api/gyms/:id`, repos `places` et `gyms`.
- Produces : `DUMBBELL_CHOICES_G` = 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 7500, 8000, 9000, 10000, 12000, 12500, 14000, 15000, 16000, 17500, 18000, 20000, 22000, 22500, 24000, 25000, 26000, 27500, 28000, 30000, 32000, 32500, 34000, 35000, 36000, 37500, 38000, 40000, 42500, 45000, 47500, 50000, 55000, 60000, 65000, 70000, 75000, 80000 (48 valeurs).

- [ ] **Step 1: Write the failing tests** — champs barre, plus petit disque, pas des machines avec bornes de 02 §10.3 ; haltères à cocher, préréglages « Aucun » et « 2 à 40 kg par 2 kg » ; brouillon « Enregistrer » / « Annuler » avec le nombre de changements ; salle : l'historique note « Réglages de charge modifiés » ; hors ligne : « Nécessite le réseau ».
- [ ] **Step 2: Run** `pnpm --filter @rune/web test places` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(web): réglages de charge des lieux et des salles`.

### Task 25: Parcours de bout en bout et recette

**Files:**
- Create: `apps/web/e2e/workout.spec.ts`
- Modify: `apps/web/e2e/support/content.ts` (un modèle de test et ses fiches publiées), `docs/exploitation/recette-telephones.md`, `README.md` (commandes ou captures si besoin)

**Interfaces:**
- Consumes: tout le plan.

- [ ] **Step 1: Write the E2E** (Chromium et WebKit) — inscription à E8 ; séance complète **hors ligne** : séries, effort, minuteur, douleur sans consentement ; retour du réseau, synchro, cibles du serveur affichées ; séance reprise après rechargement ; « Continuer ici » dans un second contexte ; proposition du moteur acceptée (historique préparé côté serveur) ; CSV téléchargé.
- [ ] **Step 2: Run** `pnpm --filter @rune/web test:e2e` — PASS.
- [ ] **Step 3: Update** `recette-telephones.md` : contrôles 2, 4 et 5 actifs ; ajout de l'écran allumé et du minuteur après verrouillage.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm data:validate --strict` — PASS ; relevé des captures des nouveaux écrans (script de captures existant) pour le propriétaire.
- [ ] **Step 5: Commit** `test(e2e): parcours de séance hors ligne et recette de la brique 3`.

---

## Couverture de la spec

| Spec | Tâches |
|---|---|
| §2 D1 navigation | 17 |
| §2 D2–D4, D12 plan figé, profil, statuts, séance oubliée | 11, 12, 15, 18 |
| §2 D5–D6, D19 programme effectif, rejeu, règles par version | 2, 3, 5, 12 |
| §2 D7 séance libre | 15, 20 |
| §2 D8–D9 XP, rangs, records | 7, 20, 23 |
| §2 D10, §3 contenu, lots A et B | 8, 9 |
| §2 D11 quêtes | 23 |
| §2 D13 CSV | 14 |
| §2 D14 minuteur, écran | 19 |
| §2 D15 E8 | 22 |
| §2 D16 limitations | aucune (hors brique) |
| §2 D17 références des séances | 11, 12 |
| §2 D18 changer de programme | 1, 3, 13, 22 |
| §4.1–4.3 moteur | 2, 4, 5, 6 |
| §4.4 rejeu | 5, 12, 15 |
| §5.1–5.4 données et synchro | 11, 12, 15 |
| §5.5 retrait santé | 14 |
| §5.6 exports, suppression, 404 admin | 11, 14 |
| §6 API | 13, 16 |
| §7.1–7.5 écrans de séance | 17, 18, 19, 20 |
| §7.6 historique | 21 |
| §7.7–7.8 programme, choix, E8, Profil | 22 |
| §7.9–7.10 accueil, Progression | 23 |
| §7.11 réglages de charge | 24 |
| §7.12 réglages | 14, 19 |
| §8 XP, rangs, compteurs, records | 7 |
| §9 vie privée | 14, 18 |
| §10 critères 1–13 | 4, 5, 10 (1–4) ; 3 (5) ; 12 (6) ; 11 (7) ; 14 (8) ; 15 (9) ; 17–24 (10) ; 25 (11, 13) ; 17 (12) |
