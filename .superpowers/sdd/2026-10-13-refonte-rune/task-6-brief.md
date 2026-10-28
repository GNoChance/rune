### Task 6: Coach du profil (contrats, migration, API, dépôt web)

**Files:**
- Create: `packages/contracts/src/coach.ts`, `apps/server/src/db/migrations/0002_coach.ts`, `apps/server/test/profile/coach.test.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/api/profile.ts` (`TrainingProfilePatch.coach`, profil renvoyé), `packages/contracts/src/entity-rules.ts` (`training_profile.columns` gagne `'coach'`), `apps/server/src/db/migrations/index.ts`, `apps/server/src/db/schema.ts` (`TrainingProfileTable.coach: string | null`), `apps/server/src/profile/routes.ts` (`EMPTY_PROFILE.coach`, fusion, `completeOnboarding` lève `httpError('validation', { field: 'coach' })` si `coach` est nul), `apps/server/src/auth/me.ts` si le profil y est exposé, le dépôt web du profil d'entraînement (`apps/web/src/repos/…`, exposer `coach` et `setCoach(c: CoachId)`), tests existants de fuite de colonnes et d'export

**Interfaces:**
- Produces: `COACH_IDS = ['ombre', 'skald', 'scribe'] as const` ; `CoachId` ; `CoachIdSchema = z.enum(COACH_IDS)` ; colonne SQL `coach TEXT CHECK (coach IN ('ombre','skald','scribe'))` (migration `0002_coach`, `breaking: false`, `ALTER TABLE training_profile ADD COLUMN …`) ; `PATCH /api/training-profile` accepte `{ coach }` ; `POST /api/onboarding/complete` refuse sans coach ; dépôt web `repos.profile.setCoach(coach: CoachId): Promise<void>` et `useTrainingProfile().coach: CoachId | null`.

- [ ] **Step 1: Tests qui échouent** — `coach.test.ts` : la migration ajoute la colonne et une base `0001` existante migre sans perte ; `PATCH {coach:'skald'}` puis lecture → `'skald'` ; `PATCH {coach:'berserker'}` → 400 `validation` ; `complete` avec tous les autres champs mais sans coach → 400 `{ field: 'coach' }` ; avec coach → 200 ; le pull de synchro renvoie `coach` pour le propriétaire et rien pour un autre utilisateur ; l'export JSON contient `coach`.
- [ ] **Step 2: Lancer** `pnpm --filter @rune/server test profile/coach` — FAIL.
- [ ] **Step 3: Implémenter** (contrats → migration → routes → dépôt web).
- [ ] **Step 4: Lancer** `pnpm test` (serveur et web) — PASS, y compris le test de fuite de la synchro et le test de schéma.
- [ ] **Step 5: Commit** `feat(server): coach choisi dans le profil d'entraînement, exigé pour terminer l'onboarding`.


