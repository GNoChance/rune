### Task 16: Profil d'entraînement et fin de l'onboarding côté serveur

**Files:**
- Modify: `packages/contracts/src/api/profile.ts` (`DAYS_PER_WEEK`, `SESSION_MINUTES`, `TrainingProfilePatch`), `apps/server/src/routes.ts` (`app.route('/api/me', profileRoutes(deps))`), `apps/server/test/support/index.ts`
- Create: `apps/server/src/profile/routes.ts`, `apps/server/test/support/onboarding.ts`
- Test: `apps/server/test/profile/{training-profile,onboarding-complete}.test.ts`

**Interfaces:**
- Consumes : T6 (`AppDeps`, `AppEnv`, `httpError`, `parseJson`) ; T4a (`writeStamp`) ; T9 (`requireUser`) ; T10 (`buildMe`, `MeResponse`, `OnboardingStep`, `createUserAndLogin`) ; T2 (`ageBandOn`, `parisDate`) ; T15 (`availableGoals`, `firstIncompleteStep`, `Goal`, `Experience`) ; T14 (`SportCodeSchema`, `SPORT_OTHER_LABEL_MAX`, `defaultLoadSettings`) ; T5 (`insertFixtureRow`).
- Produces : Interfaces partagées §4 (`DAYS_PER_WEEK`, `SESSION_MINUTES`, `TrainingProfilePatch`, `profileRoutes`) et §2 (support `completeOnboarding` : profil muscle, none, 3 j, 45 min, `onboardingStep 'health'`, lieu maison principal par `insertFixtureRow`, `POST /api/me/onboarding/complete` attendu à 200).

**Spec:** 02 R-ONB-1 à R-ONB-3, §8 E1, E2, E5, E6, R-AGE-5, R-AGE-6, R-CST-7, §15 n°11, 03 P-MIN-8, Global Constraints « Ajouts au modèle » (3) et (4).

- [ ] **Step 1: Write the failing test**

```ts
// training-profile.test.ts
// premier PATCH { goal: 'muscle', onboardingStep: 'goal' } → 200 et ligne { id: u.id, ownerId: u.id, goal: 'muscle', experience: null, daysPerWeek: null,
//   sessionMinutes: null, sportCode: null, sportOtherLabel: null, cautiousMode: 0, updatedBy: u.id, deletedAt: null } ; user.onboarding_step 'goal', user.rev augmenté
// PATCH suivant { experience: 'lt_6_months', daysPerWeek: 3, sessionMinutes: 45 } → fusion, rev augmenté ; { onboardingStep: 'place_kind' } seul crée la ligne vide
// même valeur renvoyée → pas de nouveau rev
it.each([[{ daysPerWeek: 5 }], [{ daysPerWeek: 1 }], [{ sessionMinutes: 50 }], [{ goal: 'cardio' }], [{ experience: 'expert' }], [{ sportCode: 'golf' }], [{ unknown: 1 }]])
  ('400 validation pour %o', /* (await res.json()).error === 'validation' */);
// fat_loss : mineur (birthDate '2009-10-07') → 400 validation ; majeur → 200 (E1) ; puis birth_date corrigée en mineur : { cautiousMode: true } → 200, { goal: 'fat_loss' } → 400
// E2 : goal sport_support puis { sportCode: null, onboardingStep: 'sport' } → 400 { error: 'validation', field: 'sportCode' } ; { sportCode: 'tennis', onboardingStep: 'sport' } → 200 ;
//   après completeOnboarding : { goal: 'sport_support' } → 400 { field: 'sportCode' } ; { goal: 'sport_support', sportCode: 'tennis' } → 200
// goal muscle : { sportCode: null, sportOtherLabel: null, onboardingStep: 'sport' } (« Non ») → 200
// sportOtherLabel (field 'sportOtherLabel') : 'Ultimate' avec 'tennis' → 400 ; 41 caractères → 400 ; { sportCode: 'other' } sans libellé → 400 ;
//   'Ultimate' avec 'other' → 200 ; puis { sportOtherLabel: null } → 400 ; passage à 'rugby' → sportOtherLabel NULL
// cautiousMode true → me.cautious true ; false → false et cautiousMode 0 (R-CST-7)
// mineur ('2008-10-07') : { ageBand: 'minor', cautious: true } ; à '2026-10-06T22:30:00.000Z' → { ageBand: 'adult', cautious: false }, profil inchangé, fat_loss → 200 (R-AGE-6)
// sans session → 401
// onboarding-complete.test.ts (R-ONB-1)
expect(await res.json()).toEqual({ error: 'onboarding_incomplete', step: 'goal' });   // 409 ; après profil sans lieu → step 'place_kind' ; validé 'availability' → 'health'
// profil + lieu principal + validé 'health' → 200, onboardingCompletedAt '2026-10-06T10:00:00.000Z', inchangé à un second appel (+60 s)
// après completeOnboarding, PATCH { goal: 'strength', onboardingStep: 'goal' } → 200 mais user.onboarding_step reste 'health' (R-ONB-3)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test training-profile onboarding-complete` → PATCH `/api/me/training-profile` renvoie 404 ; `completeOnboarding is not a function`.

- [ ] **Step 3: Implement**

`profileRoutes` : `requireUser` sur chaque route, jamais `use('*')` (d'autres routeurs partagent `/api/me`). PATCH en transaction : état fusionné ; refus `validation { field }` : `goal` hors `availableGoals(ageBand)`, contrôlé seulement si le patch porte `goal` ; `sportCode` si l'état fusionné a `goal = sport_support` et `sportCode` nul, dès que `onboarding_completed_at` est posé ou que l'étape écrite (`onboardingStep` du patch, sinon `user.onboarding_step`) est `sport` ou suivante (E2) ; `sportOtherLabel` non nul dans le patch avec un `sportCode` fusionné autre que `other`, ou `other` sans libellé **[décision plan]** (libellé remis à NULL si le sport n'est pas `other`) ; insertion ou mise à jour des seules colonnes changées avec `writeStamp` ; `onboardingStep` écrit seulement si `onboarding_completed_at` est NULL ; `user` (`onboarding_step`, `onboarding_completed_at`) écrit lui aussi avec `writeStamp` ; réponse `buildMe`. POST `/onboarding/complete` : `firstIncompleteStep` (lieu principal = `place` actif `is_primary = 1`) ≠ `ready` → `onboarding_incomplete { step }` ; sinon `onboarding_completed_at` posé une seule fois.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  2 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(profil): profil d'entraînement et fin de l'onboarding"`

---

