### Task 1: Taxonomie complète et schéma de fiche

**Files:**
- Modify: `packages/contracts/src/taxonomy.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/api/errors.ts`, `packages/contracts/test/errors.test.ts`
- Create: `packages/contracts/src/exercise.ts`, `packages/contracts/test/exercise.test.ts`
- Test: `packages/contracts/test/taxonomy.test.ts`

**Interfaces:**
- Produces (taxonomy.ts) : `MOVEMENT_PATTERNS` (20 codes de 04 §3.4) + `MOVEMENT_PATTERN_LABELS`, `PATTERN_GROUPS` (5 groupes, 04 §3.4), `patternGroup(p): string`, `MUSCLES` (18) + `MUSCLE_LABELS`, `JOINTS` (8) + `JOINT_LABELS`, `EXERCISE_LEVELS = [1,2,3]`, `LOAD_MODES` (6), `SENSITIVE_JOINTS`, `MUSCLE_GROUPS: readonly {code, label, muscles}[]` (spec §4.3, dans cet ordre : chest, back, shoulders, arms, core, glutes, quads, hamstrings, calves), `maxExerciseLevel(experience): 1|2|3`, `SUBSTITUTE_LIMIT = 5`, `CATALOG_MAX_SHEETS = 300`, types `MovementPattern`, `Muscle`, `Joint`, `LoadMode`, `MuscleGroupCode`.
- Produces (exercise.ts) : `EXERCISE_STATUSES = ['draft','reviewed','published','retired']`, `BatchSchema` (`/^(A|B|E([1-9][0-9]?))$/`), `ExerciseSheetSchema` (Zod, champs et bornes de 04 §4 + `batch` ; `safety` : entrées ≤ 120 caractères), `DraftSheetSchema` (champs IA facultatifs, R-FIC-1), `type ExerciseSheet`, `CONTENT_EXCLUDED_KEYS` (spec §3.2), `COMMENT_PARTS` (15 valeurs, spec §3.3), `PUBLISH_BLOCKERS` dans l'ordre du tableau §3.6 (`incomplete`, `invalid_sheet`, `review_unchecked`, `minors_unconfirmed`, `open_comments`, `health_validation_missing`, `illustrations_missing`, `referenced_by_template`, `chain_break`, `catalog_full`), `type PublishBlocker`, `exerciseJsonSchema()` (via `z.toJSONSchema`).
- Produces (errors.ts) : codes `revision_conflict` 409, `transition_blocked` 422, `not_reviewable` 409, `self_health_flag` 403 (ajouter 422 à `ERROR_STATUS` s'il n'y est pas).

- [ ] **Step 1: Write the failing tests**

```ts
// taxonomy.test.ts
it('MUSCLE_GROUPS couvre chacun des 18 muscles une seule fois, dans l\'ordre de la refonte', () => {
  expect(MUSCLE_GROUPS.map((g) => g.code)).toEqual(['chest','back','shoulders','arms','core','glutes','quads','hamstrings','calves']);
  expect(MUSCLE_GROUPS.map((g) => g.label)).toEqual(['Pectoraux','Dos','Épaules','Bras','Abdos','Fessiers','Quadriceps','Ischios','Mollets']);
  expect(MUSCLE_GROUPS.flatMap((g) => g.muscles).sort()).toEqual([...MUSCLES].sort());
});
it('SENSITIVE_JOINTS est inclus dans JOINTS', () => expect(SENSITIVE_JOINTS.every((j) => JOINTS.includes(j))).toBe(true));
it('patternGroup rend son groupe ou le pattern lui-même', () => {
  expect(patternGroup('lunge')).toBe('lower_body');
  expect(patternGroup('calf_raise')).toBe('calf_raise');
});
// exercise.test.ts
it('refuse une entrée de sécurité de 121 caractères', () => expect(ExerciseSheetSchema.safeParse(sheet({ safety: ['x'.repeat(121)] })).success).toBe(false));
it('batch accepte A, B, E1, E99 et refuse E0, E100, C', () => { /* table de cas */ });
it('PUBLISH_BLOCKERS suit l\'ordre de la spec', () => expect(PUBLISH_BLOCKERS[0]).toBe('incomplete'));
// errors.test.ts : les 4 codes dans leurs groupes de statut
```

`sheet()` est une fabrique locale au test qui rend une fiche publiée valide (squat goblet, valeurs de la maquette de fiche).

- [ ] **Step 2: Run** `pnpm --filter @rune/contracts test` — FAIL (exports absents).
- [ ] **Step 3: Implement** les constantes, `ExerciseSheetSchema` (ordre des clés = ordre de 04 §4, utilisé ensuite par la forme canonique) et les codes d'erreur.
- [ ] **Step 4: Run** `pnpm --filter @rune/contracts test` puis `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(contracts): taxonomie complète, schéma des fiches et codes de la relecture`.
