# Brique 5 · Nutrition — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le module Nutrition de Rune : repères chiffrés `nutri-1` pour les adultes en mode complet, pesées lissées et bilan hebdomadaire borné, fiches conseils relues pour tous, mineurs compris, et le branchement du coach (dossier, outil, pause de sécurité, filtre), sans qu'aucun chiffre ni aucune pesée n'atteigne une personne hors mode complet.

**Architecture:** Le métier pur vit dans `packages/domain/src/nutrition/` (arithmétique exacte, calcul, mode effectif, écran, lissage, bilan, contrôle des fiches) ; il ne tourne que sur le serveur, sauf la moyenne glissante dessinée par le téléphone. Le serveur porte la migration `0009_nutrition`, le module `apps/server/src/nutrition/` (état, ouverture, écran, réglages, bilan, fiches, synchro) et les branchements du coach (`coach-brief/2`, `tools-2`, `coach-3`). Le téléphone ajoute la version 3 de la base locale, un dépôt nutrition, l'intention de descente hors ligne dans le moteur de synchro, et les écrans `/nutrition/*`.

**Tech Stack:** TypeScript, Zod 4, fast-check, Hono, Kysely/node:sqlite, React 19, wouter, CSS Modules, Dexie, Vitest + Testing Library + happy-dom, Playwright (Chromium, WebKit).

**Spec:** `docs/superpowers/specs/2026-11-06-brique-5-nutrition-design.md` (fait autorité, D1 à D14, choix C1 à C31), qui précise `docs/superpowers/specs/2026-10-06-appsport-design/07-nutrition.md` (règles, formules, arrondis, cas A à F, scénario du bilan, vocabulaire, modèle). Lire les deux en entier avant toute tâche ; en cas d'écart, la spec de la brique 5 l'emporte là où son §3.1 le déclare.

**Point de départ :** branche locale `brique-5` (worktree `C:\Users\kevin\rune-wt\b5`), tirée de `brique-4` = 63a3f4d, spec comprise. Jamais de `git push`.

**Prérequis du propriétaire (spec §2.1) :** aucune tâche n'attend le propriétaire. La publication des fiches réelles (tâche 22 : brouillons seulement), l'ouverture du mode complet (interrupteur fermé), les horaires TCA et la campagne réelle du coach restent hors plan.

**Ordre :** 1 → 5 (contrats et domaine), 6 → 11 (serveur), 12 → 14 (coach), 15 → 21 (web), 22 (contenu), 23 (E2E), 24 (docs et vérification). Séquentiel ; 2, 3 et 4 peuvent aller en parallèle après 1 ; 22 peut aller en parallèle de n'importe quelle tâche après 5.

## Global Constraints

- Branche `brique-5`, un ou plusieurs commits par tâche, messages en français au format du dépôt (`feat(domain): …`), terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` verts à la fin de chaque tâche ; `pnpm test:e2e` (Chromium et WebKit) vert pour toute tâche qui touche un parcours E2E. Test ciblé : `npx vitest run --project <contracts|domain|scripts|server|web> <fichier>`. Les tests du domaine ne sont pas typés par `pnpm typecheck` : vérifier avec une config temporaire `include: ["src", "test"]` sur les tâches 2 à 5.
- Contraintes des briques 1 à 4 toujours valables : CSP `default-src 'self'`, format d'erreur API, 404 pour les ressources d'un autre (admin compris, P-ADM-2), jamais de C1–C3 dans `/api/admin/*`, tables STRICT avec CHECK, migrations transactionnelles non cassantes, `entityRules` couvre chaque colonne, `packages/domain` pur (ni `Date.now()`, ni `new Date()`, ni `Math.random()`, ni `node:`), aucun accès Dexie hors de `repos/`, `sync/` et `local-db/`.
- Valeurs de 07 à reprendre telles quelles : PAL 1,40 / 1,55 / 1,75 / 2,00 ; s = +5 / −161 / −78 ; f = 0,80 / 1,00 / 1,10 ; bornes `lose` [0,75 DET ; DET], `maintain` [0,90 DET ; 1,10 DET], `gain` [DET ; 1,15 DET] ; protéines 1,6–2,2 g/kg de Pg ; lipides max(0,6 Pg ; 20 % kcal / 9) ; fibres 30 g ; eau 2 500 / 2 000 / 2 250 mL ; Pg = 25 × T² si IMC ≥ 30 ; énergie arrondie à 50, grammes à 5 (moitié vers le haut), fourchette ± 100 ; domaines : âge 18–78, taille 120–220 cm, poids 30–250 kg ; bandes du bilan `lose` [−1,0 ; −0,5], `gain` [+0,25 ; +0,5], `maintain` [−0,25 ; +0,25] ; `rapid_loss` < −1,5 ; recalibrage ≥ 2 kg ; M(S) à 3 pesées ; pas de 100 kcal ; `NUTRI_ALGO_VERSION = 'nutri-1.0.0'` ; `SAFETY_SCREEN.version = 1` ; `NUTRITION_MAX_AGE = 78`.
- `HELP_RESOURCES` reste la seule source des numéros ; l'ancien `0810 037 037` n'apparaît nulle part.
- Textes : français, tutoiement, apostrophe droite `'`, guillemets « » ; vocabulaire de 07 §5.10 ; l'IMC n'est jamais affiché ; ni rouge ni vert sur le poids ; aucune félicitation liée au poids ; nombres au format français (espace fine insécable `\u202F` des milliers, virgule décimale), eau à 0,05 L près.
- Données : rien de C2 dans un journal ; aucune réponse de l'écran de sécurité stockée nulle part (ni base, ni Dexie, ni journal) ; colonnes C2 du profil et tables `weigh_in`, `nutrition_target`, `nutrition_checkin` jamais servies hors mode effectif `full`.
- Accessibilité : cibles ≥ 48 × 48 px ; contrastes ≥ 4,5:1 dans les 5 thèmes ; la courbe est `aria-hidden` avec une table d'accompagnement ; `prefers-reduced-motion` respecté.
- Nouvelle dépendance : aucune.

## Review Focus

1. **Semaines et jours de Paris aux changements d'heure** (pesée à 0 h 30 de Paris le lundi du passage à l'heure d'hiver, bilan ouvert ce lundi-là) : la pesée tombe le bon jour, la semaine S est la bonne, le bilan est créé une fois. Tests dans les tâches 4 et 7.
2. **Deux appareils qui notent une pesée hors ligne pour le même jour**, puis se synchronisent : une seule pesée vivante au serveur (la dernière arrivée), l'autre appareil la voit remplacée au pull, aucune ne finit en rejet. Tests dans les tâches 10 et 15.
3. **Descente de mode hors ligne, puis appli fermée et rouverte avant le retour du réseau** : aucun chiffre ne réapparaît à la réouverture ; l'intention part au premier cycle en ligne. Test dans la tâche 15.
4. **Saisie du poids « 72,5 », « 72.5 », « 72 », « 72,55 », « 7 2 », vide** : les trois premières donnent 72 500 g et 72 000 g ; « 72,55 » est refusé avec « Une décimale au plus » ; le bouton reste inactif sur une saisie vide ou hors 30–250. Test dans la tâche 19.
5. **Plus aucune pesée depuis 15 jours**, puis changement de niveau d'activité : `409 weigh_in_required`, la feuille de pesée s'ouvre, l'aperçu se relance une fois la pesée envoyée ; l'ouverture du module rend `needs = weigh_in` sans planter. Tests dans les tâches 7, 9 et 18.

---

### Task 1: Contrats de la nutrition

**Files:**
- Create: `packages/contracts/src/nutrition.ts`, `packages/contracts/src/nutrition-screen.ts`
- Modify: `packages/contracts/src/index.ts` (exports), le module des codes d'erreur de l'API (ajout des codes ci-dessous)
- Test: `packages/contracts/test/nutrition.test.ts`, `packages/contracts/test/nutrition-screen.test.ts`

**Interfaces:**
- Produces :
  - énumérations `NUTRITION_MODES = ['full','qualitative','disabled']`, `MODE_REASONS = ['choice','safety']`, `SEX_FOR_CALC = ['male','female','unspecified']`, `NUTRITION_GOALS = ['lose','maintain','gain']`, `ACTIVITY_LEVELS = [1,2,3,4]`, `TARGET_REASONS` (07 §5.12), `APPLIED_RULES` (ordre de 07 §5.12), `CHECKIN_DECISIONS` (8 valeurs), `CHECKIN_POSITIONS = ['above','in','below']`, `MODE_CAUSES = ['stored','minor','over_max_age','no_health_consent','screen_outdated','full_closed']`, `NUTRITION_NEEDS = ['consent','screen','setup','weigh_in']`, `ADVICE_AUDIENCES`, `ADVICE_STATUSES` ;
  - schémas Zod stricts : `NutritionTargetsSchema` (sortie de 07 §5.6.4), `NutritionStateSchema` (spec §7, « État rendu »), `ScreenRequestSchema` (`answers: {pregnancy, eating_disorder, medical}` ∈ `yes|no|prefer_not`, `mode`, `setup?`), `ModeRequestSchema` (`mode` ∈ `qualitative|disabled`), `SettingsChangesSchema`, `CheckinResponseSchema`, `AdminNutritionSchema` (`full_open: boolean`), `AdviceSheetFileSchema` (spec §10.1), `ServedAdviceSheetSchema` ;
  - `NUTRITION_ERROR_CODES` : `mode_not_allowed`, `setup_required`, `screen_required`, `weigh_in_required`, `goal_not_allowed`, `checkin_not_actionable` (statuts de la spec §7) ;
  - types inférés exportés : `NutritionMode`, `ModeReason`, `ModeCause`, `SexForCalc`, `NutritionGoal`, `ActivityLevel`, `TargetReason`, `AppliedRule`, `CheckinDecision`, `CheckinPosition`, `NutritionNeed`, `ScreenAnswers`, `NutritionTargets`, `NutritionState`, `AdviceSheetFile`, `ServedAdviceSheet`, `Orientation` ;
  - `SAFETY_SCREEN = { version: 1, questions: [{ id: 'pregnancy', text }, { id: 'eating_disorder', text }, { id: 'medical', text }] }`, textes exacts de 07 §5.4 (Q1 à Q3).

- [ ] **Step 1: Write the failing tests** — `SAFETY_SCREEN.version === 1` et les trois textes égaux, caractère pour caractère, à ceux de 07 §5.4 ; `NutritionStateSchema` refuse un état `qualitative` qui porte `target`, `settings`, `safety_pause` ou `weekly_means` (schéma discriminé par `effective_mode`) ; `ScreenRequestSchema` refuse une réponse `maybe` et un `mode` hors énumération ; `AdviceSheetFileSchema` refuse un `id` qui n'est pas en kebab-case anglais (`Bien-Manger`, `eat_well`) ; `APPLIED_RULES` vaut exactement `['no_deficit_low_bmi','deficit_cap_25','surplus_cap_15','maintenance_band','bmr_floor','ref_weight_bmi25']`.
- [ ] **Step 2: Run** `npx vitest run --project contracts test/nutrition` — Expected: FAIL (modules absents).
- [ ] **Step 3: Implement** les deux modules et les exports.
- [ ] **Step 4: Run** le même test, puis `pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): contrats de la nutrition et écran de sécurité v1`.

### Task 2: Arithmétique exacte et calcul `nutri-1`

**Files:**
- Create: `packages/domain/src/nutrition/exact.ts`, `packages/domain/src/nutrition/constants.ts`, `packages/domain/src/nutrition/targets.ts`, `packages/domain/src/nutrition/index.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/nutrition/exact.test.ts`, `packages/domain/test/nutrition/targets.test.ts`

**Interfaces:**
- Consumes: `NutritionTargetsSchema`, `APPLIED_RULES` (Task 1).
- Produces :
  - `type Q = { n: bigint; d: bigint }` et `q(n, d?)`, `add`, `sub`, `mul`, `div`, `cmp`, `roundHalfUpTo(x: Q, step: bigint): bigint`, `ceilTo`, `floorTo`, `toNumber(x: Q, decimals: number): number` dans `exact.ts` ;
  - `NUTRITION_CONSTANTS` (gelé) et `NUTRI_ALGO_VERSION` dans `constants.ts` ;
  - `interface TargetsInput { age: number; sexForCalc: SexForCalc; heightCm: number; weightG: number; activityLevel: 1|2|3|4; goal: NutritionGoal; cumulativeAdjustmentKcal: number }` ;
  - `computeNutritionTargets(input: TargetsInput): NutritionTargets | { refusal: 'MODE_NOT_FULL' | 'INPUT_OUT_OF_RANGE' }` (sortie en snake_case comme `NutritionTargetsSchema`, plus `inputs` figés avec `pal` et `ref_weight_g`) ;
  - `bmiBelow(heightCm: number, weightG: number, threshold: '18.5' | '30'): boolean` (comparaison exacte) ;
  - `adjustedTargetIsSame(input: TargetsInput, delta: -100 | 100): boolean` (règle `limit_reached`, choix C25).

- [ ] **Step 1: Write the failing tests** — les six cas de 07 §5.6.6, une assertion par valeur :
  - A : `bmr_kcal` 1780, `tdee_kcal` 2759, `kcal_target` 2200, `kcal_min` 2100, `kcal_max` 2300, protéines 130–175, `fat_g_min` 50, `carbs_g` 310, `fiber_g` 30, `water_ml` 2500, `applied_rules` `[]` ;
  - B : 1345,25 ; 1883,35 ; 2050 ; 1950–2150 ; 95–130 ; 45 ; 315 ; 2000 ;
  - C : `effective_goal` `maintain`, règles `['no_deficit_low_bmi']`, MB 1199, 1850, 1750–1950, 75–105, 40, 295 ;
  - D : 2100, 2100–2200, règles `['deficit_cap_25']` ;
  - E : `{ refusal: 'MODE_NOT_FULL' }` ;
  - F : règles `['ref_weight_bmi25']`, MB 1998,75, 2250, 2150–2350, 125–170, 50, 330 ;
  - entrées hors domaine (taille 119 et 221, poids 29 900 g et 250 100 g, poids non multiple de 100) → `INPUT_OUT_OF_RANGE` ; âge 79 → `MODE_NOT_FULL` ;
  - propriétés fast-check (entrées valides aléatoires, 500 tirages) : `kcal_target` ≥ MB, `kcal_target` dans les bornes arrondies de l'objectif effectif, `kcal_min ≤ kcal_target ≤ kcal_max`, `carbs_g` ≥ 0, IMC < 18,5 ⇒ `effective_goal` ≠ `lose`, `algo_version` présent, multiples de 50 et de 5 respectés ;
  - `exact.ts` : `roundHalfUpTo(q(1225, 10), 5n) === 125n`, `roundHalfUpTo(q(3275, 10), 5n) === 330n`, `ceilTo(q(206925, 100), 50n) === 2100n`.
- [ ] **Step 2: Run** `npx vitest run --project domain test/nutrition` — Expected: FAIL.
- [ ] **Step 3: Implement** — entrées converties en rationnels dès l'entrée (P = `weightG/1000`, PAL et facteurs en centièmes) ; ordre des opérations de 07 §5.6.2, arrondis de 07 §5.6.3 (énergie arrondie, ramenée vers l'intérieur si l'arrondi sort des bornes ; fourchette coupée aux bornes arrondies vers l'intérieur ; grammes depuis `kcal_target` arrondie et Pg, lipides non arrondis) ; une règle n'entre dans `applied_rules` que si elle a changé le résultat ; un glucide négatif lève une `Error` (invariant).
- [ ] **Step 4: Run** le test, puis la config de typage temporaire — Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): calcul nutri-1 en arithmétique exacte`.

### Task 3: Mode effectif, écran de sécurité, présélections

**Files:**
- Create: `packages/domain/src/nutrition/mode.ts`, `screen.ts`, `preselect.ts`
- Test: `packages/domain/test/nutrition/mode.test.ts`, `screen.test.ts`, `preselect.test.ts`

**Interfaces:**
- Consumes: Task 1, `ageOn` (`packages/domain/src/age.ts`), `bmiBelow` (Task 2).
- Produces :
  - `NUTRITION_MAX_AGE = 78` ;
  - `effectiveNutritionMode(i: { stored: NutritionMode; age: number; healthConsentActive: boolean; screenVersion: number | null; currentScreenVersion: number; fullOpen: boolean }): { mode: NutritionMode; cause: ModeCause }` ;
  - `screenOutcome(answers: ScreenAnswers): { allowedModes: NutritionMode[]; reason: ModeReason; orientations: Orientation[] }` avec `Orientation = 'midwife' | 'doctor' | 'dietitian' | 'eating_disorder_line'` ;
  - `preselectGoal(onboardingGoal: Goal | null, heightCm: number, weightG: number): NutritionGoal`, `preselectActivity(sportCode: string | null): 2 | 3`.

- [ ] **Step 1: Write the failing tests** —
  - table de vérité : `disabled` reste `disabled` (cause `stored`) à tout âge ; âge 17 → `qualitative`/`minor` ; 18 et 78 avec tout en ordre → `full`/`stored` ; 79 → `qualitative`/`over_max_age` ; `full` sans accord → `no_health_consent` ; `screenVersion` 0 ou `null` avec `full` → `screen_outdated` ; `fullOpen` faux → `full_closed` ; ordre : un mineur sans accord rend `minor` ; un adulte sans accord avec `fullOpen` faux rend `no_health_consent` ;
  - matrice de l'écran : trois `no` → `['full','qualitative','disabled']`, raison `choice`, aucune orientation ; Q1 `yes` → `['qualitative','disabled']`, `safety`, `['midwife','doctor']` ; Q2 `yes` → `['qualitative','disabled']`, `safety`, `['eating_disorder_line']` ; Q3 `yes` → `safety`, `['doctor','dietitian']` ; un `prefer_not` → `['qualitative','disabled']`, `safety`, aucune orientation ; Q1 et Q2 `yes` → orientations réunies, sans doublon ;
  - présélections : `fat_loss` → `lose`, mais `maintain` à 160 cm / 47 kg ; `muscle` → `gain` ; `strength`, `fitness`, `sport_support`, `null` → `maintain` ; `sportCode` non nul → 3, nul → 2.
- [ ] **Step 2: Run** `npx vitest run --project domain test/nutrition/mode test/nutrition/screen test/nutrition/preselect` — Expected: FAIL.
- [ ] **Step 3: Implement** — ordre de `effectiveNutritionMode` : 07 §5.3 règles 1 à 5, puis `full_closed`, puis `stored`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): mode nutrition effectif, issue de l'écran de sécurité, présélections`.

### Task 4: Lissage du poids et décision du bilan

**Files:**
- Create: `packages/domain/src/nutrition/weights.ts`, `packages/domain/src/nutrition/checkin.ts`
- Test: `packages/domain/test/nutrition/weights.test.ts`, `packages/domain/test/nutrition/checkin.test.ts`, `packages/domain/test/nutrition/checkin-scenario.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces :
  - `type WeighIn = { date: string; weightG: number }` (vivantes seulement) ;
  - `movingAverage7(w: WeighIn[], day: string): number | null` (g, arrondi au gramme) ; `referenceWeight(w: WeighIn[], day: string): number | null` (moyenne glissante, sinon dernière pesée de moins de 14 jours, arrondie à 100 g pour le calcul) ; `weekMean(w: WeighIn[], monday: string): { count: number; meanG: number | null }` ; `isSuspiciousEntry(w: WeighIn[], weightG: number, day: string): boolean` (> 3 000 g d'écart avec la moyenne des 7 jours précédents) ; `mondayOf(day: string): string`, `addDays(day: string, n: number): string` (dates `YYYY-MM-DD` sans fuseau) ;
  - `interface CheckinInput { weekStart: string; weighIns: WeighIn[]; startPoint: string; target: { effectiveGoal: NutritionGoal; refWeightG: number }; targetForPrevWeek: { effectiveGoal: NutritionGoal } | null; previousCheckin: { meanWeightG: number | null; position: CheckinPosition | null; representative: boolean; countable: boolean } | null; representative: boolean; heightCm: number; requestedGoal: NutritionGoal; safetyPause: boolean; limitReached: (delta: -100 | 100) => boolean }` ;
  - `decideCheckin(i: CheckinInput): { decision: CheckinDecision; position: CheckinPosition | null; meanWeightG: number | null; changePct: number | null; weighInCount: number; proposedDeltaKcal: -100 | 100 | null; recalibrate: boolean; lowBmiSafety: boolean }`.

- [ ] **Step 1: Write the failing tests** —
  - lissage : moyenne glissante de d−6 à d ; poids de référence : pesée de 13 jours → elle, de 14 jours → `null` ; M(S) à 2 pesées → `meanG` nul, à 3 → défini ; `isSuspiciousEntry` à 3 000 g → faux, 3 100 g → vrai ;
  - `mondayOf('2026-10-26') === '2026-10-26'` (lundi du passage à l'heure d'hiver), `mondayOf('2026-11-01') === '2026-10-26'` ;
  - scénario 07 §5.7.4, fixture de pesées construite pour M(S0..S5) = 80,0 / 79,9 / 79,8 / — / 79,2 / 78,7 : décisions `insufficient_data`, `out_of_band_pending` (`above`), `proposal` −100, `insufficient_data`, `insufficient_data`, `in_band` ; `changePct` arrondi à 2 décimales (−0,13, −0,63) ;
  - variantes : v = −1,2 puis −1,3 → `proposal` +100 ; −1,6 une semaine → `rapid_loss` +100 ; `limitReached(-100)` vrai → `limit_reached` ; refus (point de départ remis) → `insufficient_data` puis `out_of_band_pending` avant toute nouvelle proposition ; semaine non représentative → `non_representative_week`, sans delta ; `safetyPause` et deux semaines au-dessus → `safety_pause` ; écart ≥ 2 kg avec `refWeightG` → `recalibrate: true` puis la décision continue ; `lose` et IMC(M(S)) < 18,5 → `lowBmiSafety: true`, décision `safety_pause` ; S−1 avant le point de départ → `countable: false` → v non définie.
- [ ] **Step 2: Run** `npx vitest run --project domain test/nutrition/weights test/nutrition/checkin` — Expected: FAIL.
- [ ] **Step 3: Implement** — ordre des règles de 07 §5.7.3, positions de la spec §9 ; v(S) en rationnel, arrondie à 2 décimales seulement en sortie ; comparaisons aux bandes en exact.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): lissage du poids et décision du bilan hebdomadaire`.

### Task 5: Termes interdits v2, unités partagées, contrôle des fiches

**Files:**
- Modify: `packages/contracts/src/forbidden-terms.ts` (v2), `packages/domain/src/coach/values.ts` (expression des unités exportée, famille volume), `packages/domain/src/coach/filter.ts` (liste « pour tous » dans tous les modes, liste « hors mode complet »)
- Create: `packages/domain/src/nutrition/sheet-check.ts`
- Test: `packages/contracts/test/forbidden-terms.test.ts`, `packages/domain/test/coach/filter.test.ts`, `packages/domain/test/coach/values.test.ts`, `packages/domain/test/nutrition/sheet-check.test.ts`

**Interfaces:**
- Produces :
  - `FORBIDDEN_TERMS` `version: '2'` avec `all`, `notFull` (`déficit`, `déficitaire`, `jeûne`, `jeûner`, `sécher` et formes fléchies), `minor` (v1 inchangée) ;
  - `findUnitNumbers(text: string): { value: string; unit: 'kcal' | 'g' | 'kg' | 'pct' | 'ml'; index: number }[]` dans `values.ts` (volumes `L`, `l`, `litre(s)`, `mL`, `ml`, `cL`, `cl` convertis en mL) ; `allowedValues` range `_ml` dans la famille volume ;
  - `validateAdviceSheet(sheet: AdviceSheetFile, phase: 'reviewed' | 'published'): { ok: true } | { ok: false; issues: { code: 'no_source' | 'numbers_not_allowed' | 'forbidden_term' | 'markdown_not_allowed' | 'link_not_in_sources'; detail: string }[] }`.

- [ ] **Step 1: Write the failing tests** —
  - filtre : en mode `full` adulte, « Évite le régime » est bloqué (`forbidden_term`) ; « 2,5 L d'eau » passe si `water_ml: 2500` est autorisé et est bloqué en `qualitative` ; « 2 l de lait » bloqué hors `full` ; « jeûne » bloqué pour un adulte en `qualitative`, permis en `full` ; « perdre du poids » permis à un adulte en `qualitative`, bloqué pour un mineur ; les tests existants du filtre restent verts (seule la version change) ;
  - `validateAdviceSheet` : fiche sans source → `no_source` ; fiche `all` avec « 500 g de viande » → `numbers_not_allowed` ; fiche `adults`/`['full']` avec « 500 g » → `ok` ; fiche `minors` avec « créatine » → `forbidden_term` ; fiche `qualitative` avec « jeûne » → `forbidden_term` ; image ou tableau Markdown → `markdown_not_allowed` ; lien vers une URL absente de `sources` → `link_not_in_sources`.
- [ ] **Step 2: Run** les quatre fichiers — Expected: FAIL.
- [ ] **Step 3: Implement.** Les scans existants (`apps/web/test/coach/*`, `apps/server/test/coach/prompts.test.ts`, `tools/propose.test.ts`) passent à la v2 sans autre changement.
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain,contracts): termes interdits v2, volumes au filtre, contrôle des fiches conseils`.

### Task 6: Migration `0009_nutrition` et registre

**Files:**
- Create: `apps/server/src/db/migrations/0009_nutrition.ts`
- Modify: `apps/server/src/db/migrations/index.ts`, `apps/server/src/db/schema.ts`, `apps/server/test/__snapshots__/schema.sql`, `packages/contracts/src/entity-rules.ts`
- Test: `apps/server/test/db/migration-0009.test.ts`, `packages/contracts/test/entity-rules.test.ts`

**Interfaces:**
- Produces : tables `nutrition_profile`, `weigh_in`, `nutrition_target`, `nutrition_checkin`, `advice_sheet`, `nutrition_state` (spec §6.1) ; `coach_thread` reconstruite avec `closed_reason` ∈ `version_change`, `health_withdrawn`, `day_over`, `persona_change`, `nutrition_mode_change` (même méthode que `0008`) ; règles `entityRules` de la spec §6.2 (`nutrition_profile` : `category 'C2'`, `syncClass 'E'`, `ownerColumn 'id'`, `c2Columns` = toutes sauf `mode` et `mode_reason`, `c2Values: { mode_reason: ['safety'] }` ; `weigh_in` J `clientWritable ['date','weight_g']` ; `nutrition_target` et `nutrition_checkin` D ; `advice_sheet` C, `ownerColumn null`, `exported false`).

- [ ] **Step 1: Write the failing tests** — la migration s'applique sur une base 0008 avec des fils ouverts, sans perte de ligne de `coach_thread` ; les CHECK refusent `weight_g` 29 900, 72 550, `mode` `partial`, `cumulative_adjustment_kcal` 50, `activity_level` 5, deux pesées vivantes pour le même (`owner_id`, `date`), deux bilans pour la même semaine ; une pesée supprimée et une vivante au même jour coexistent ; `nutrition_state` contient une ligne `full_open = 0` ; l'instantané de schéma correspond ; `entityRules` couvre chaque colonne de chaque table (test existant étendu).
- [ ] **Step 2: Run** `npx vitest run --project server test/db/migration-0009` — Expected: FAIL.
- [ ] **Step 3: Implement** la migration (transactionnelle), les types Kysely et les règles.
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS (instantané mis à jour).
- [ ] **Step 5: Commit** `feat(server): migration 0009 de la nutrition et registre de synchro`.

### Task 7: État nutrition, cibles et ouverture du module

**Files:**
- Create: `apps/server/src/nutrition/context.ts`, `apps/server/src/nutrition/targets-service.ts`, `apps/server/src/nutrition/open.ts`, `apps/server/src/nutrition/state.ts`, `apps/server/src/nutrition/routes.ts`
- Modify: `apps/server/src/routes.ts` (`app.route('/api/nutrition', nutritionRoutes(deps))`)
- Test: `apps/server/test/nutrition/open.test.ts`, `apps/server/test/nutrition/rows.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4, 6 ; `ageOn`, `parisDate`, l'état de l'accord santé (`apps/server/src/privacy/consent-state.ts`).
- Produces :
  - `loadNutritionContext(db: DbExecutor, deps: AppDeps, userId: string): Promise<NutritionContext>` (`profile`, `age`, `healthConsentActive`, `fullOpen`, `effective: { mode, cause }`, `today`) ;
  - `NutritionTargetRow` : ligne Kysely de `nutrition_target` (camelCase, `inputs` et `appliedRules` décodés) ;
  - `currentTarget(db, userId)`, `createTarget(trx, deps, userId, reason: TargetReason, input: TargetsInput): Promise<NutritionTargetRow>` (refuse sans `full`) ;
  - `openNutrition(deps, user): Promise<NutritionState>` (spec §8) et `buildNutritionState(ctx, rows): NutritionState` ;
  - routes `POST /open`, `GET /rows`.

- [ ] **Step 1: Write the failing tests** —
  - ouverture hors `full` : état réduit, aucune ligne C2 dans la réponse (inspection du JSON), aucun bilan créé ;
  - `full` sans réglages → `needs: 'setup'` ; avec réglages sans pesée de moins de 14 jours et cible d'une autre `algo_version` → `needs: 'weigh_in'`, ancienne cible rendue ;
  - lundi 2026-11-09 : bilan de la semaine du 2026-11-02 créé une fois (deux ouvertures → une ligne) ; pas de bilan pour une semaine finie avant la première cible ; pas de rattrapage de la semaine du 2026-10-26 ;
  - lundi 2026-10-26 à 0 h 30 de Paris (23 h 30 UTC le 25) : semaine S = 2026-10-19 ;
  - un bilan plus ancien sans réponse est rendu « sans suite » (non actionnable) ;
  - `GET /rows` : lignes vivantes des trois tables en `full`, listes vides sinon ; session d'un autre membre ou admin → aucune ligne d'autrui.
- [ ] **Step 2: Run** `npx vitest run --project server test/nutrition/open test/nutrition/rows` — Expected: FAIL.
- [ ] **Step 3: Implement** — ouverture en une transaction ; recalibrage et règle 2 du bilan créent leur cible avant la ligne `nutrition_checkin` ; `createdTargetId`/`recalibrationTargetId` renseignés.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): ouverture du module nutrition, cibles et bilan de la semaine écoulée`.

### Task 8: Écran de sécurité, mode, interrupteur d'administration

**Files:**
- Create: `apps/server/src/nutrition/screen.ts`, `apps/server/src/nutrition/admin-routes.ts`
- Modify: `apps/server/src/nutrition/routes.ts`, `apps/server/src/admin/routes.ts` (montage de `/api/admin/nutrition`)
- Test: `apps/server/test/nutrition/screen.test.ts`, `apps/server/test/nutrition/mode.test.ts`, `apps/server/test/nutrition/admin.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 7.
- Produces : `POST /api/nutrition/screen`, `PUT /api/nutrition/mode`, `PUT /api/admin/nutrition` ; `setSafetyPause(db, userId, on: boolean): Promise<void>` (exporté pour la tâche 13).

- [ ] **Step 1: Write the failing tests** —
  - trois `no` + `full` + `setup` → profil, pesée (identifiant client gardé), cible `initial`, `safety_screen_version = 1`, `safety_pause = 0` ; la base ne contient nulle part les réponses (recherche de `yes`, `prefer_not`, `pregnancy` dans toutes les tables et dans le journal) ;
  - Q2 `yes` + `full` → `422 mode_not_allowed` ; Q2 `yes` + `disabled` → `mode_reason = safety` ;
  - `full` sans `setup` ni réglages → `422 setup_required` ; mineur → `422 mode_not_allowed` même avec des réponses `no` ; sans accord santé → `403 health_consent_required` ; `full_open` fermé → `422 mode_not_allowed` ;
  - `PUT /mode` `qualitative` depuis `disabled` sans écran → 200 ; `full` → `422 screen_required` (schéma) ; descente depuis `full` → données conservées en base, plus servies par `/open` ;
  - repasser l'écran lève `safety_pause` ;
  - admin : `PUT /api/admin/nutrition` par un non-admin → 403 ; fermer `full_open` → `/open` d'un membre en `full` rend `qualitative`/`full_closed` ; journal sans donnée personnelle.
- [ ] **Step 2: Run** les trois fichiers — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): écran de sécurité, changement de mode et ouverture du mode complet`.

### Task 9: Réglages, aperçu, réponses au bilan, suppression des données

**Files:**
- Create: `apps/server/src/nutrition/settings.ts`, `apps/server/src/nutrition/checkin-routes.ts`
- Modify: `apps/server/src/nutrition/routes.ts`
- Test: `apps/server/test/nutrition/settings.test.ts`, `apps/server/test/nutrition/checkin-response.test.ts`, `apps/server/test/nutrition/delete-data.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 7, 8.
- Produces : `POST /settings/preview`, `PUT /settings`, `POST /checkins/:weekStart/respond`, `POST /checkins/:weekStart/non-representative`, `DELETE /data`.

- [ ] **Step 1: Write the failing tests** —
  - aperçu sans écriture (nombre de lignes inchangé) ; changement de niveau → cible `profile_change`, ajustement conservé ; changement d'objectif → ajustement remis à 0 ; `goal = lose` pendant `safety_pause` ou à IMC < 18,5 → `422 goal_not_allowed` ; aucune pesée de moins de 14 jours → `409 weigh_in_required` (aperçu et enregistrement) ;
  - accepter une `proposal` −100 → `cumulative_adjustment_kcal` −100, cible `checkin` avec P = poids de référence du jour, `created_target_id` renseigné, point de départ remis ; refuser → seul le point de départ bouge ; répondre deux fois ou à un bilan non le plus récent → `409 checkin_not_actionable` ;
  - non représentative → décision `non_representative_week`, proposition annulée, valeurs figées inchangées ;
  - `DELETE /data` → tombstones des trois tables, colonnes C2 du profil à NULL, mode inchangé ; un autre membre et un admin → 404 sur chaque route (P-ADM-2).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): réglages nutrition avec aperçu, réponses au bilan, suppression des données`.

### Task 10: Synchro des pesées, pull filtré, retrait de l'accord santé

**Files:**
- Create: `apps/server/src/nutrition/sync-hooks.ts`
- Modify: `apps/server/src/sync/hooks.ts` (`...NUTRITION_SYNC_HOOKS`), `apps/server/src/sync/pull.ts` (sources filtrées par mode, colonnes C2 du profil retirées, champ `nutrition`), `packages/contracts/src/sync.ts` (`PullResponse.nutrition: { effective_mode, cause }`), `apps/server/src/privacy/consent.ts` (`HEALTH_WITHDRAW_HOOKS.nutrition_profile`)
- Test: `apps/server/test/nutrition/push.test.ts`, `apps/server/test/nutrition/pull.test.ts`, `apps/server/test/privacy/consent-nutrition.test.ts`, `apps/server/test/privacy/export.test.ts` (étendu)

**Interfaces:**
- Consumes: Tasks 6–7.
- Produces : `NUTRITION_SYNC_HOOKS: SyncHooksMap` (`weigh_in` : `allowedKinds ['create','patch','delete']`, `immutableColumns ['date']`, `beforeApply` des contrôles de la spec §6.3) ; motif de rejet `nutrition_mode_<mode>`.

- [ ] **Step 1: Write the failing tests** — dans l'ordre de la spec §6.3 : sans accord → `applied_partial`, aucune ligne, aucun `sync_rejection` ; mode `qualitative` → `sync_rejection` `forbidden`, motif `nutrition_mode_qualitative` ; 250 100 g, 72 550 g, date de demain (Paris) → `validation` ; deux créations pour le même jour depuis deux appareils → la première en tombstone (rev neuf), la seconde vivante ; patch de `date` → ignoré comme colonne immuable, le reste s'applique ; pull en `qualitative` : aucune ligne des trois tables, profil sans colonne C2, `nutrition.effective_mode = 'qualitative'` ; retrait de l'accord : trois tables en tombstones sans contenu, profil neutralisé (C2 à NULL, `mode_reason` `safety` effacé, `safety_pause` 0, ajustement 0, `mode` `disabled`), rev neuf ; l'export contient les quatre tables en `full` ; la suppression du compte efface les quatre tables du membre et rien d'un autre.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Le filtrage du pull lit le mode effectif une fois par requête, dans la transaction du pull.
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): synchro des pesées, pull filtré par le mode, retrait de l'accord santé`.

### Task 11: Fiches conseils côté serveur

**Files:**
- Create: `apps/server/src/nutrition/advice-loader.ts`, `apps/server/src/nutrition/advice-review.ts`, `apps/server/src/nutrition/advice-routes.ts`
- Modify: `apps/server/src/catalog/loader.ts` (appel de `seedOrMergeAdviceSheets` dans la même transaction que `seedOrMergeCatalog`), `apps/server/src/review/routes.ts` (montage de `/api/review/advice`, admin seul), `apps/server/src/nutrition/routes.ts` (`GET /sheets`)
- Test: `apps/server/test/nutrition/advice-loader.test.ts`, `advice-review.test.ts`, `sheets.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 7.
- Produces : `seedOrMergeAdviceSheets(trx, files: AdviceSheetFile[], nowIso: string): Promise<{ added: number; changed: number }>` ; `ADVICE_DIR = 'advice'` ; routes `GET /api/review/advice`, `GET /api/review/advice/:id`, `PUT /api/review/advice/:id` (texte), `POST /api/review/advice/:id/{review,publish,retire}` ; `GET /api/nutrition/sheets` (ETag `"<version des fiches>-<audience>-<mode>"`).

- [ ] **Step 1: Write the failing tests** — fiche nouvelle → `draft` ; contenu changé (`content_hash`) → `draft`, `version` + 1 ; statut gardé si le contenu ne change pas ; passage en `reviewed` ou `published` refusé `422` avec les `issues` de `validateAdviceSheet` ; relectrice non admin → 403 ; service : un mineur ne reçoit que `minors` et `all` visibles en `qualitative` ; un adulte en `qualitative` ne reçoit pas `weight-fluctuations` ; `disabled` → `[]` ; ETag change avec le mode et avec une publication ; `If-None-Match` → 304 ; le champ `adviceSheets` de `GET /api/catalog` reste `[]`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): fiches conseils, chargeur, relecture par l'admin et service filtré`.

### Task 12: Dossier du coach `coach-brief/2`

**Files:**
- Modify: `packages/contracts/src/coach-brief.ts` (schéma v2, bloc `nutrition`), `packages/domain/src/coach/brief.ts` (`CoachBriefInput.nutrition`), le chargeur du dossier côté serveur (`apps/server/src/coach/` : là où `buildCoachBrief` reçoit son entrée), `packages/domain/src/coach/config.ts` (`briefSchema: 'coach-brief/2'`)
- Test: `packages/domain/test/coach/brief-nutrition.test.ts`, `apps/server/test/coach/brief-nutrition.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 11.
- Produces : `CoachBriefInput.nutrition: { mode: NutritionMode; minor: boolean; safetyPause: boolean; sheets: { id: string; title: string }[]; target: NutritionTargetRow | null; weeklyChange: { weeksAgo: number; changePct: number | null }[]; lastCheckin: { weeksAgo: number; decision: CheckinDecision; proposedDeltaKcal: -100 | 100 | null; response: 'accepted' | 'declined' | null } | null }` ; bloc de sortie de la spec §11.1 (clés `energy_kcal`, `energy_min_kcal`, `energy_max_kcal`, `protein_min_g`, `protein_max_g`, `fat_min_g`, `carbs_g`, `fiber_g`, `water_ml`, `effective_goal`, `applied_rules`, `algo_version`, `days_ago`).

- [ ] **Step 1: Write the failing tests** — `directives` par cas (mineur → les trois ; adulte `qualitative` → `no_numbers`, `no_deficit` ; `full` avec `safety_pause` → `no_deficit` ; `full` `maintain` → `no_deficit` ; `full` `lose` sans pause → `[]`) ; hors `full`, ni `target`, ni `weekly_change`, ni `last_checkin` ; le JSON sérialisé ne contient jamais `weight_g`, `height_cm`, `sex_for_calc`, `mode_reason`, `bmr_kcal`, `tdee_kcal`, ni une moyenne en kg ; accord coach sans accord santé → mode effectif non `full`, donc pas de `target` ; un fil `coach-brief/1` existant se relit sans erreur.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): dossier coach-brief/2 avec le bloc nutrition`.

### Task 13: Outil `open_nutrition_screen`, pause de sécurité, filtre branché, fil fermé à la descente

**Files:**
- Create: `apps/server/src/coach/tools/open-nutrition-screen.ts`
- Modify: `apps/server/src/coach/tools/index.ts` (`TOOLS_2`), `apps/server/src/coach/tools/refer-to-help.ts`, `packages/contracts/src/coach.ts` (`COACH_TOOL_NAMES`, événement SSE `nutrition_screen`), `apps/server/src/coach/attempt.ts:184,232`, `apps/server/src/coach/orchestrator.ts:310`, `apps/server/src/coach/tools/propose-program-change.ts:226`, l'ouverture du fil (fermeture `nutrition_mode_change`), `packages/domain/src/coach/config.ts` (`toolsVersion: 'tools-2'`)
- Test: `apps/server/test/coach/tools/open-nutrition-screen.test.ts`, `apps/server/test/coach/safety-pause.test.ts`, `apps/server/test/coach/nutrition-filter.test.ts`, `packages/contracts/test/coach.test.ts:282` (le test négatif devient positif), `apps/server/test/coach/attempt.test.ts:449`

**Interfaces:**
- Consumes: Tasks 8 (`setSafetyPause`), 12.
- Produces : outil `open_nutrition_screen` (entrée `{ screen: 'goal'|'activity'|'mode', suggestion?: NutritionGoal | 1|2|3|4 | 'qualitative'|'disabled' }`, sortie `{ shown: true, screen }`) ; événement SSE `{ type: 'nutrition_screen', screen, suggestion? }` ; `nutritionModeOf(thread): NutritionMode` (lu dans `brief.nutrition.mode`).

- [ ] **Step 1: Write the failing tests** — refus `not_available` : `goal` en `qualitative`, `activity` pour un mineur, suggestion `lose` pendant la pause ; un seul événement par message ; `refer_to_help('eating_disorder')` avec profil et accord → `safety_pause = 1` ; sans accord → inchangé ; échange refusé par le modèle (faux client) → pause posée quand même ; le filtre en `full` laisse passer « entre 2 100 et 2 300 kcal » (valeurs du dossier) et bloque « 1 800 kcal » ; descente de mode après l'ouverture du fil → message suivant ouvre un nouveau fil, l'ancien `closed_reason = 'nutrition_mode_change'`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Aucun `nutritionMode: 'none'` ni `nutritionFull: false` codé en dur ne reste (`rg "nutritionFull: false|nutritionMode: 'none'" apps/server/src` vide).
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): outil open_nutrition_screen, pause de sécurité, filtre selon le mode du fil`.

### Task 14: Prompts `coach-3`, parcours guidés, cas d'évaluation

**Files:**
- Create: `apps/server/src/coach/prompts/coach-3-adult.ts`, `coach-3-minor.ts`, 10 cas `eval/coach/cases/n-cible-*.json` et `m-*.json`, fixtures `eval/coach/fixtures/members/adulte-nutrition-complet.json`, `adulte-nutrition-qualitatif.json`
- Modify: `apps/server/src/coach/prompts/index.ts`, `packages/domain/src/coach/config.ts` (`promptVersion: 'coach-3'`, `promptVariant`), `packages/contracts/src/coach-guided.ts` et `apps/server/src/coach/guided.ts` (puces « Mes repères », « Mon bilan de la semaine » en `full`), `scripts/coach-eval/checks.ts` (contrôle `safety_pause` actif)
- Test: `apps/server/test/coach/prompts.test.ts`, `apps/server/test/coach/guided.test.ts`, `scripts/coach-eval/*.test.ts`

**Interfaces:**
- Consumes: Tasks 12–13.

- [ ] **Step 1: Write the failing tests** — les prompts `coach-3-*` passent le scan v2 et citent `open_nutrition_screen` et les trois `directives` ; « nutrition : rien pour l'instant » n'y figure plus ; puces `full` présentes seulement si le dossier est en `full`, jamais pour un mineur ; les 10 cas (spec §11.7) se chargent, et le lanceur sur le faux client les passe tous, `safety_pause` vérifiée sur les cas TCA avec profil ; les réponses du faux client de ces cas passent le scan `FORBIDDEN_TERMS` v2 (07 §5.10.4).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** `COACH_CONFIG.evaluated` reste vide pour `coach-3`/`tools-2`/`coach-brief/2`.
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): prompts coach-3, puces nutrition, cas d'évaluation nutrition`.

### Task 15: Base locale v3, dépôt nutrition, purge et intention de descente

**Files:**
- Modify: `apps/web/src/local-db/db.ts` (`LOCAL_DB_VERSION = 3`, `STORES_V3` = `STORES_V2` + `nutrition_profile: 'id'`, `weigh_in: 'id, date'`, `nutrition_target: 'id, validFrom'`, `nutrition_checkin: 'id, weekStart'`, `nutritionSheets: 'id'` ; `nutritionSheets` dans `NON_MIRROR_STORES`), `apps/web/src/local-db/meta.ts` (`nutritionPendingMode`, `nutritionEffectiveMode`), `apps/web/src/sync/engine.ts` (étape avant le pull), `apps/web/src/sync/apply-pull.ts` (purge et instantané)
- Create: `apps/web/src/repos/nutrition-repo.ts`, `apps/web/src/repos/weigh-in-repo.ts`
- Test: `apps/web/test/local-db/db-v3.test.ts`, `apps/web/test/sync/nutrition-sync.test.ts`, `apps/web/test/repos/nutrition-repo.test.ts`

**Interfaces:**
- Consumes: routes des tâches 7–11.
- Produces : `nutritionRepo` (`open()`, `screen(req)`, `setMode(mode)` — hors ligne, écrit l'intention et purge —, `preview(changes)`, `saveSettings(changes)`, `respond(weekStart, response)`, `markNonRepresentative(weekStart)`, `deleteData()`, `sheets()`, `useNutritionView()`) ; `weighInRepo` (`save({ date, weightG })` remplace la pesée vivante du jour localement et passe par l'outbox, `correct(id, weightG)`, `remove(id)`, `useWeighIns()`) ; `localNutritionMode(): 'full' | 'qualitative' | 'disabled'` = le plus strict entre l'intention et le dernier mode lu.

- [ ] **Step 1: Write the failing tests** — la mise à niveau v2 → v3 garde l'outbox et les miroirs ; un pull `nutrition.effective_mode = 'qualitative'` vide les trois magasins, les colonnes C2 du profil local et `nutritionSheets` ; un pull `full` après `qualitative` appelle `GET /api/nutrition/rows` une fois et remplace les copies ; `setMode('qualitative')` hors ligne purge tout de suite, garde l'intention après une réouverture de la base, `localNutritionMode()` vaut `qualitative` même si le dernier pull disait `full` ; au cycle en ligne suivant, `PUT /mode` part avant le pull, l'intention s'efface sur 200 et sur 4xx, reste sur 503 ; deux pesées locales le même jour → une seule vivante dans Dexie ; une pesée rejetée `forbidden` apparaît dans les rejets du socle.
- [ ] **Step 2: Run** `npx vitest run --project web test/local-db/db-v3 test/sync/nutrition-sync test/repos/nutrition-repo` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): base locale v3, dépôt nutrition, purge et descente hors ligne`.

### Task 16: Coquille du module, entrées, textes

**Files:**
- Create: `apps/web/src/features/nutrition/nutrition-texts.ts`, `format.ts`, `NutritionPage.tsx`, `NutritionFooter.tsx`, `nutrition.module.css`, `apps/web/src/features/public/NutritionHelpPage.tsx`
- Modify: `apps/web/src/App.tsx` (routes `/nutrition/*`, `/help/nutrition`), `apps/web/src/ui/TabBar.tsx` (`SECTIONS` : `/nutrition` → Profil), `apps/web/src/features/profile/ProfileHub.tsx` (entrée Nutrition), `apps/web/src/features/home/HomePage.tsx` (carte Nutrition, texte R-AGE-6), `apps/web/src/features/public/HelpPage.tsx` (rubrique), `coach-lines.ts` (phrases nutrition)
- Test: `apps/web/test/nutrition/texts.test.ts`, `format.test.ts`, `nutrition-page.test.tsx`, `entries.test.tsx`

**Interfaces:**
- Consumes: Task 15.
- Produces : `NUTRITION_TEXTS` (toutes les chaînes du module, dont les phrases du §13 de la spec) ; `formatKcal(n)`, `formatGrams(n)`, `formatLitres(ml)`, `formatKg(g)`, `formatPct(x)` (format français, `\u202F`, eau à 0,05 L).

- [ ] **Step 1: Write the failing tests** — `NUTRITION_TEXTS`, les textes de `/help/nutrition`, de la carte de l'accueil et de l'entrée du Profil passent `FORBIDDEN_TERMS` v2 (liste « pour tous ») et ne contiennent ni « IMC » ni le numéro autrement que via `HELP_RESOURCES` ; `formatKcal(2100) === '2\u202F100'`, `formatLitres(2250) === '2,25'`, `formatLitres(2000) === '2'` ; `NutritionPage` rend l'activation en `disabled`, « Conseils sans chiffres » en `qualitative` avec la ligne de cause pour `minor`, `over_max_age`, `no_health_consent`, `screen_outdated`, `full_closed`, et les sections du §12.2 en `full` ; pied toujours présent avec la ligne TCA ; carte de l'accueil absente en `disabled` ; entrée du Profil avec le sous-titre du mode ; `/help/nutrition` lisible sans session.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): module nutrition, entrées, page d'aide et textes`.

### Task 17: Activation et écran de sécurité

**Files:**
- Create: `apps/web/src/features/nutrition/StartFlow.tsx`, `SafetyScreenSteps.tsx`, `SetupSteps.tsx`
- Test: `apps/web/test/nutrition/start-flow.test.tsx`

**Interfaces:**
- Consumes: Tasks 15–16 ; `screenOutcome`, `preselectGoal`, `preselectActivity`, `bmiBelow` (domaine, pour l'affichage seulement).

- [ ] **Step 1: Write the failing tests** — accord santé refusé → qualitatif sans écran ; Q2 « Oui » → la ligne TCA s'affiche avant le choix du mode ; `full` grisé quand `full_open` est faux ; présélections affichées et modifiables ; 160 cm / 47 kg → « perte » absent sans message chiffré ; rien n'est envoyé avant la dernière étape (aucune requête), puis une seule requête `POST /screen` ; hors ligne : « Nécessite le réseau » ; un mineur voit « Activer les conseils » et aucune question ; repasser l'écran depuis Réglages réutilise les étapes 3, 4 et 6.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Les réponses vivent dans l'état React seulement.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): activation du module et écran de sécurité`.

### Task 18: Repères du jour, page de calcul, réglages

**Files:**
- Create: `apps/web/src/features/nutrition/TargetsCard.tsx`, `HowPage.tsx`, `SettingsPage.tsx`
- Test: `apps/web/test/nutrition/targets-card.test.tsx`, `how-page.test.tsx`, `settings-page.test.tsx`

**Interfaces:**
- Consumes: Tasks 15–17.

- [ ] **Step 1: Write the failing tests** — carte avec le cas A : « 2 100 à 2 300 kcal », « repère : 2 200 kcal », « 130 à 175 g », « au moins 50 g », « environ 310 g », « 30 g », « 2,5 L, aliments compris », « Une estimation, pas une consigne. » ; objectif effectif `maintain` pour `lose` demandé → « Ton objectif est réglé sur le maintien. » ; `/nutrition/how` affiche les valeurs de la cible et les règles en phrases ; réglages : aperçu avant « Enregistrer », `?focus=activity&suggest=3` ouvre la section avec 3 présélectionné et « Suggestion du coach » ; `409 weigh_in_required` → feuille de pesée puis une seule relance ; descente de mode en un geste ; « Supprimer mes données nutrition » confirmé par une feuille.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): repères du jour, page de calcul et réglages nutrition`.

### Task 19: Pesée et courbe

**Files:**
- Create: `apps/web/src/features/nutrition/WeighInSheet.tsx`, `WeightPage.tsx`, `parse-weight.ts`
- Modify: `apps/web/src/features/progression/LineChart.tsx` (prop `points?: (number | null)[]` dessinés en points discrets ; l'existant ne change pas)
- Test: `apps/web/test/nutrition/parse-weight.test.ts`, `weigh-in-sheet.test.tsx`, `weight-page.test.tsx`, `apps/web/test/progression/line-chart.test.tsx` (étendu)

**Interfaces:**
- Consumes: Tasks 15–16 ; `movingAverage7`, `isSuspiciousEntry` (domaine).
- Produces : `parseWeight(text: string): { ok: true; weightG: number } | { ok: false; reason: 'empty' | 'format' | 'decimals' | 'range' }`.

- [ ] **Step 1: Write the failing tests** — `parseWeight` : « 72,5 » et « 72.5 » → 72 500 ; « 72 » → 72 000 ; « 72,55 » → `decimals` ; « 7 2 » → `format` ; « » → `empty` ; « 29,9 » et « 250,1 » → `range` ; feuille : date du jour par défaut, date passée possible, date future impossible, « Remplace la pesée de ce jour » si la date est prise, « Vérifie ta saisie » à 3,1 kg d'écart sans bloquer, hors ligne l'enregistrement passe par l'outbox ; courbe : plages 4 semaines, 3 mois, 1 an ; table des moyennes de semaine pour les lecteurs d'écran ; aucune couleur `danger`/`success` ni texte de félicitation (scan du rendu).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): pesée et courbe du poids`.

### Task 20: Bilan et fiches

**Files:**
- Create: `apps/web/src/features/nutrition/CheckinCard.tsx`, `SheetsList.tsx`, `SheetPage.tsx`, `markdown-lite.tsx`
- Test: `apps/web/test/nutrition/checkin-card.test.tsx`, `sheets.test.tsx`, `markdown-lite.test.tsx`

**Interfaces:**
- Consumes: Tasks 15–16.
- Produces : `MarkdownLite({ source, allowedLinks })` (titres, paragraphes, listes, gras ; lien seulement si l'URL est dans `allowedLinks`, sinon texte).

- [ ] **Step 1: Write the failing tests** — une phrase par décision (spec §13), valeurs lues dans le bilan et la cible ; « Accepter » et « Garder mes repères » seulement sur le bilan actionnable ; « Cette semaine n'était pas représentative » relance l'affichage avec la nouvelle décision ; un bilan plus ancien non traité affiché « sans suite » ; hors ligne, boutons grisés ; fiches : liste servie par `nutritionSheets`, lecture hors ligne, sources et date de relecture en pied ; `MarkdownLite` ignore une image, un tableau, un HTML brut et un lien hors sources.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): bilan de la semaine et fiches conseils`.

### Task 21: Coach, administration et relecture côté web

**Files:**
- Modify: `apps/web/src/features/coach/*` (bouton sous la bulle pour `nutrition_screen` ; bouton « Passer en mode sans chiffres » sur la carte TCA en `full` ; section Nutrition de `/coach/brief`), `apps/web/src/features/admin/ServerHealthPage.tsx` (interrupteur « Repères chiffrés »), `apps/web/src/features/review/*` (segment « Fiches conseils », admin seul), `apps/web/src/repos/review-repo.ts`, `apps/web/src/repos/admin-repo.ts`
- Test: `apps/web/test/coach/nutrition-screen-button.test.tsx`, `apps/web/test/admin/nutrition-switch.test.tsx`, `apps/web/test/review/advice-review.test.tsx`

**Interfaces:**
- Consumes: Tasks 11, 13, 15, 18.

- [ ] **Step 1: Write the failing tests** — l'événement `nutrition_screen` affiche « Ouvrir mes réglages nutrition » vers `/nutrition/settings?focus=…&suggest=…` ; la carte TCA montre le bouton en `full` seulement ; `/coach/brief` montre la section Nutrition (mode, consignes, fiches, repères en `full`) ; l'interrupteur appelle `PUT /api/admin/nutrition` et affiche le rappel du prérequis ; le segment « Fiches conseils » est absent pour une relectrice, présent pour l'admin, et affiche les `issues` d'un refus 422.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): coach nutrition, interrupteur d'administration, relecture des fiches`.

### Task 22: Rédaction des 8 fiches (brouillons) et fiches de test

**Files:**
- Create: `data/advice/eat-well-daily.json`, `eat-well-daily-simple.json`, `protein-every-meal.json`, `eat-around-training.json`, `hydration.json`, `vegetarian-training.json`, `young-athletes.json`, `weight-fluctuations.json` ; fiches fictives pour les E2E dans le contenu de test (`apps/web/e2e/support/content.ts`) et pour l'évaluation (`eval/coach/fixtures/catalog/`)
- Modify: `docs/catalog/style-guide.md` (section « Fiches conseils »)
- Test: `apps/server/test/nutrition/advice-files.test.ts`

**Interfaces:**
- Consumes: Task 5 (`validateAdviceSheet`), Task 1 (`AdviceSheetFileSchema`).

- [ ] **Step 1: Write the failing test** — chaque fichier de `data/advice` passe `AdviceSheetFileSchema` et `validateAdviceSheet(…, 'published')` ; 250 à 450 mots ; `draft_origin: 'ai'` ; chaque source a `title`, `url`, `accessed_on` ; audience et modes égaux au tableau de la spec §10.5.
- [ ] **Step 2: Run** — Expected: FAIL (fichiers absents).
- [ ] **Step 3: Write the sheets** — bases de 07 §5.8 et ses sources ; sources de « Manger autour de la séance » et du végétarien choisies et vérifiées en ligne à la rédaction ; tutoiement, vocabulaire de 07 §5.10 ; aucune fiche n'est publiée (statut `draft` au chargement).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `content(nutrition): brouillons des 8 fiches conseils`.

### Task 23: Parcours E2E

**Files:**
- Create: `apps/web/e2e/nutrition.spec.ts`
- Modify: `apps/web/e2e/support/fixtures.ts`, `flows.ts` (membre adulte, membre mineur, interrupteur ouvert), `apps/web/e2e/support/coach-server-entry.ts` (script TCA)

- [ ] **Step 1: Write the specs** (Chromium et WebKit) — adulte : activation complète, trois pesées, horloge du serveur avancée au lundi, ouverture, proposition acceptée, nouveaux repères ; mineur : conseils seulement, aucun chiffre dans la page (recherche de `kcal`, `g`, `kg`, `L` après un nombre) ; descente de mode : tout chiffre disparaît, y compris après rechargement hors ligne ; coach (faux client) : signal TCA → carte avec la ligne, bouton vers le mode sans chiffres, pause visible dans le bilan suivant.
- [ ] **Step 2: Run** `pnpm test:e2e` — Expected: les nouveaux parcours passent, les 50 existants restent verts.
- [ ] **Step 3: Commit** `test(e2e): parcours nutrition`.

### Task 24: Documents et vérification finale

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-appsport-design/07-nutrition.md` (renvois aux écarts : règle `full_closed`, pages fixes, termes v2), `06-coach.md` (§6 `suggestion`, §7 termes), `03-vie-privee.md` (rien de nouveau à déclarer : vérifier que le texte santé v1.0 couvre la nutrition et le noter), `docs/catalog/` (fiches à relire), `apps/server/test/infra/docs.test.ts` si un numéro apparaît dans un document
- Test: suite complète

- [ ] **Step 1: Update the docs** — une phrase par écart, renvoyant au §3.1 de la spec de la brique 5.
- [ ] **Step 2: Run** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` ; puis `rg "0810 ?037 ?037"` (vide) et `rg "nutritionFull: false|nutritionMode: 'none'" apps/server/src` (vide) — Expected: tout vert.
- [ ] **Step 3: Commit** `docs: brique 5, écarts reportés dans la spec maîtresse`.
