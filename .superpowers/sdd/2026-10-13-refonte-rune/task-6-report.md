# Task 6 report: Coach du profil (contrats, migration, API, dépôt web)

- Worktree: `C:\Users\eliott.colin\rune-coach`, branch `socle-coach`, base `245c1ef`
- Commit: `01b6745` feat(server): coach choisi dans le profil d'entraînement, exigé pour terminer l'onboarding (closes #54)
- Review package: `/c/Users/eliott.colin/rune-coach/.superpowers/sdd/2026-10-13-refonte-rune/review-245c1ef..01b6745.diff`
- Status: DONE_WITH_CONCERNS (ruling P8 is based on a wrong premise, see Concerns 1; parallel full-suite runs hit known timeouts and flakes, see Concerns 7)

## What was implemented

**Contracts (`packages/contracts`)**
- New `src/coach.ts`: `COACH_IDS = ['ombre', 'skald', 'scribe'] as const`, `CoachIdSchema = z.enum(COACH_IDS)`, `type CoachId`. Exported from `src/index.ts`.
- `TrainingProfilePatch` gains `coach: CoachIdSchema.optional()`. The field cannot be null: once chosen, a coach can be changed but never cleared. This keeps the rule "onboarding completed ⇒ coach set".
- `entityRules.training_profile.columns` gains `'coach'` (C1, class E, exported, cascade). No change to `clientWritable` or `c2Columns`.

**Server (`apps/server`)**
- New migration `src/db/migrations/0002_coach.ts`: id `0002_coach`, `breaking: false`. It runs `ALTER TABLE training_profile ADD COLUMN coach TEXT CHECK (coach IN ('ombre','skald','scribe'))`. The values are fixed in the DDL, as in 0001, and `enum-consistency` cross-checks them against `COACH_IDS`. The migration runs inside the migration runner's single transaction. `MIGRATIONS = [socle, coach]`.
- `src/db/schema.ts`: `TrainingProfileTable.coach: CoachId | null`.
- `src/profile/routes.ts`:
  - `ProfileState` and `EMPTY_PROFILE` gain `coach` (null).
  - The merge is `coach: patch.coach ?? current.coach`, so the generic change detection bumps `rev` only when the value changes.
  - `completeOnboarding` reads `coach`. When it is null it throws `httpError('validation', { field: 'coach' })`. This happens before the step check and before any write.
  - `ONBOARDING_STEPS` is unchanged, so the `user` table is not rebuilt.
- `/api/auth/me`: `MeResponse` carries no training profile, so nothing changed there (ruling P8: "if it is there").
- The pull, export, account deletion and admin routes already work from `entityRules` and the foreign keys. No code changed there; tests prove the behaviour (see below).

**Web (`apps/web`)**
- `src/repos/profile-repo.ts`:
  - `TrainingProfileView.coach: CoachId | null`, read from the mirror with `oneOf(COACH_IDS, row.coach)`, so an unknown value gives null.
  - New `setCoach(coach: CoachId): Promise<void>`. It goes through the existing `update`, which uses `sendThenPull` and PATCH `/api/me/training-profile`, then saves `meta.me` and pulls.
  - Offline, it fails with the existing `NetworkRequiredError` « Nécessite le réseau »: nothing is written locally, nothing goes to the outbox and no pull runs.
- New `src/repos/use-training-profile.ts`: `useTrainingProfile(): { loaded, profile, coach }`, built on `useLive(() => repos.profile.get())`. `coach` is `CoachId | null`.

**Existing tests and helpers updated (ruling P7)**
- `test/support/onboarding.ts` (`completeOnboarding` helper, used by `places.test.ts` and `training-profile.test.ts`) and `test/profile/onboarding-complete.test.ts` now set `coach: 'skald'` first.
- I grepped for every caller of `/onboarding/complete`. The only server callers are these two and the helper's users. The web unit tests mock the API and still pass.
- `apps/web/e2e` was not touched. P7 assigns it to T7.

## Tests added or changed

- `apps/server/test/profile/coach.test.ts` (new, 15 tests):
  - Migration:
    - `MIGRATIONS` is `0001_socle`, then `0002_coach`, both non-breaking.
    - A 0001 database with rows (user, a fully filled training_profile, place) migrates with `applied: ['0002_coach']`. The user and place rows are identical, and the profile rows equal their old values plus `coach: null`. The CHECK refuses `'berserker'` and accepts each id in `COACH_IDS`.
    - When a later migration in the same run fails, the column is rolled back (it runs inside the transaction).
  - PATCH:
    - `{coach:'skald'}` is stored. Changing to `'scribe'` bumps `rev`. A patch without `coach` keeps it.
    - `'berserker'`, `'Skald'`, `''`, `null` and `1` each give 400 `validation`, and the coach stays unchanged.
  - Complete:
    - All other steps done but no coach: 400 `{ error: 'validation', field: 'coach' }`. The user row and `sync_counter` are unchanged, so nothing was written.
    - Coach and steps both missing: the coach error comes first.
    - With a coach: 200 and `onboardingCompletedAt` is set.
  - Owner only:
    - The owner's pull carries their own `training_profile` with `coach`.
    - Another member's PATCH writes only their own row.
    - The other member's pull has only their own profile and never contains A's id.
  - Export and deletion:
    - The JSON export `tables.training_profile[0].coach` is `'skald'`.
    - After `deleteAccount`, the profile row is gone.
- `apps/server/test/privacy/admin-isolation.test.ts`: the member's `training_profile` witness now has `coach: 'scribe'`. No `/api/admin/*` body may contain the key `"coach"`.
- `apps/server/test/sync/pull-leak.test.ts`: coach witnesses A `ombre` and B `scribe`. A's pull contains `"coach":"ombre"` and never `"coach":"scribe"` (member and admin sessions).
- `apps/server/test/db/migrate.test.ts`: the applied list is `['0001_socle', '0002_coach']`. The unknown non-breaking fixture id was renamed from `0002_future` to `0099_future` so it no longer looks like the real 0002.
- `apps/server/test/db/upgrade.test.ts`: the frozen v1 schema now receives `0002_coach` and then equals the snapshot.
- `apps/server/test/db/enum-consistency.test.ts`: `'training_profile.coach': COACH_IDS`.
- `apps/server/test/db/schema.test.ts`: the `coach` CHECK refuses `'berserker'` and accepts `'skald'`.
- `apps/server/test/__snapshots__/schema.sql`: regenerated. The only change is `coach TEXT CHECK (...)` on `training_profile`, inserted by SQLite before the `CHECK (id = owner_id)` table constraint. The v1 fixture is left frozen.
- `packages/contracts/test/coach.test.ts` (new):
  - `COACH_IDS` order, and `CoachIdSchema` refusals.
  - `TrainingProfilePatch` accepts `coach` and refuses `null` or an unknown id.
  - The `entityRules` column is there, in C1, class E, not C2 and not client-writable.
- `apps/web/test/repos/profile-places-gyms.test.ts`:
  - `get` returns `coach`; an absent or unknown mirror value gives null.
  - `setCoach('scribe')` sends PATCH `{ coach: 'scribe' }`, resolves to undefined, updates `meta.me` and pulls once.
- `apps/web/test/repos/offline-mutations.test.ts`: `profile.setCoach` offline gives « Nécessite le réseau ». The local database is unchanged, the outbox is empty and no pull runs.
- `apps/web/test/repos/use-training-profile.test.tsx` (new): the hook follows the mirror: no profile, then a profile without coach, then `skald`.

## TDD evidence

All RED runs came after the tests were written and before any implementation.

**RED 1 (the brief's command):** `pnpm --filter @rune/server test profile/coach` gave exit 1.
```
 ❯ |server| test/profile/coach.test.ts (15 tests | 14 failed) 455ms
   ❯ migration 0002_coach (3)
     × suit 0001_socle et n'est pas cassante 9ms
     × une base 0001 avec des lignes migre sans perte ; coach vaut null puis n'admet que les trois coachs 15ms
     × pose puis change le coach ; un patch sans coach le garde 106ms
     × 400 validation pour { coach: 'berserker' }, coach inchangé 64ms
     ...
     × toutes les autres étapes faites mais sans coach : 400 { field: coach }, rien écrit 23ms
     × le coach passe avant les autres étapes, comme dans l'interface (étape 1 sur 9) 14ms
     × avec un coach : 200 et onboarding terminé 17ms
     × le pull du propriétaire porte son coach ; un autre membre ne le lit ni ne l'écrit 24ms
     × l'export JSON contient le coach 18ms
     × supprimé avec le compte 15ms
 FAIL  ... toutes les autres étapes faites mais sans coach : 400 { field: coach }, rien écrit
AssertionError: expected 200 to be 400 // Object.is equality
      Tests  14 failed | 1 passed (15)
```
The failures were for the right reasons:
- PATCH with `coach` was refused by the strict schema (`expected 400 to be 200`).
- Complete without a coach succeeded (`expected 200 to be 400`).
- `MIGRATIONS` lacked 0002.

The one test that passed is the transaction guard, which can only fail once 0002 exists.

**RED 2 (updated existing server tests):** `pnpm --filter @rune/server test db/migrate db/upgrade db/enum-consistency db/schema.test profile/onboarding-complete profile/training-profile places/places privacy/admin-isolation sync/pull-leak` gave exit 1, with `Tests 15 failed | 40 passed (55)`.
- Migrate, upgrade and enum lists were missing 0002 and coach.
- The admin-isolation and pull-leak fixtures failed because the coach column did not exist.
- The onboarding helpers got `400` on the PATCH with `coach`.

**RED 3 (contracts):** `pnpm vitest run --project contracts coach` gave exit 1 with `Error: Cannot find module '../src/coach'`.

**RED 4 (web):** `pnpm --filter @rune/web test repos/` gave exit 1, with `Tests 4 failed | 75 passed`, plus a suite that failed to load (`Failed to resolve import "../../src/repos/use-training-profile"`). The failures were:
- `TypeError: r.profile.setCoach is not a function`;
- `expected { goal: 'muscle', …(6) } to deeply equal { goal: 'muscle', …(7) }`;
- `expected undefined to be null`.

**GREEN:**
- `pnpm --filter @rune/server test profile/coach`: exit 0, `Tests 15 passed (15)`.
- `pnpm --filter @rune/server test db/migrate db/upgrade db/enum-consistency db/schema.test db/entity-rules profile/ places/places privacy/admin-isolation privacy/export privacy/delete sync/pull-leak sync/pull.test`: exit 0, `Test Files 14 passed (14)`, `Tests 124 passed (124)`.
- `pnpm vitest run --project contracts`: exit 0, `Tests 77 passed (77)`.
- `pnpm --filter @rune/web test repos/`: exit 0, `Test Files 7 passed (7)`, `Tests 80 passed (80)`.

## Full verification

- `pnpm lint`: clean (`Checked 455 files … No fixes applied.`) after a biome format of one line in `packages/contracts/test/coach.test.ts`.
- `pnpm typecheck`: clean for all 4 packages.
- `pnpm test` (all projects in parallel), run twice: `Tests 3 failed | 2054 passed | 2 skipped (2059)` both times.
  - Each failure was a 5000 ms timeout in an infra or build test that spawns bash or esbuild. The tests differed between runs: `infra/release.test.ts`, `infra/release-ci-guard.test.ts`, `build/bundle.test.ts`.
  - The baseline run on the untouched tree also had 3 such failures: `release.test` (timeout), `profile/profile-page` (focus flake) and `pwa/precache-plugin` (timeout).
- Projects run one after another (`pnpm exec vitest run --project X`):
  - contracts 77/77;
  - domain 345/345;
  - server 711 passed, 2 skipped, 0 failed;
  - web 923/924. The 1 failure is `privacy/withdraw.test.tsx` « Je refuse » sur Santé, the consent-withdrawal flake that spec §11.4 lists for another task.
- Re-runs alone, all passing:
  - `build/bundle` and `infra/release`: 18/18;
  - `privacy/withdraw`, `profile/profile-page` and `pwa/precache-plugin`: 69/69.
- `infra/name` test (no « appsport » in tracked files): 5/5. A grep of every committed file for « appsport » found nothing.
- E2E: none named by the brief. Per P7, the onboarding E2E flows will fail until T7 adds the coach step. `apps/web/e2e` was not edited and not run.
- `git show --stat HEAD`: 24 files, +437/−17, all listed below. `git status` is clean.

## Files changed

- Created:
  - `packages/contracts/src/coach.ts`
  - `packages/contracts/test/coach.test.ts`
  - `apps/server/src/db/migrations/0002_coach.ts`
  - `apps/server/test/profile/coach.test.ts`
  - `apps/web/src/repos/use-training-profile.ts`
  - `apps/web/test/repos/use-training-profile.test.tsx`
- Modified, source:
  - `packages/contracts/src/index.ts`
  - `packages/contracts/src/api/profile.ts`
  - `packages/contracts/src/entity-rules.ts`
  - `apps/server/src/db/migrations/index.ts`
  - `apps/server/src/db/schema.ts`
  - `apps/server/src/profile/routes.ts`
  - `apps/web/src/repos/profile-repo.ts`
- Modified, tests and helpers:
  - `apps/server/test/__snapshots__/schema.sql`
  - `apps/server/test/db/{enum-consistency,migrate,schema,upgrade}.test.ts`
  - `apps/server/test/privacy/admin-isolation.test.ts`
  - `apps/server/test/profile/onboarding-complete.test.ts`
  - `apps/server/test/support/onboarding.ts`
  - `apps/server/test/sync/pull-leak.test.ts`
  - `apps/web/test/repos/offline-mutations.test.ts`
  - `apps/web/test/repos/profile-places-gyms.test.ts`

## Self-review

- **Completeness against brief and rulings:**
  - Contracts, migration, routes, web repo and the hook are all in.
  - Every interface the brief promises exists: `COACH_IDS`, `CoachId`, `CoachIdSchema`, the SQL column, PATCH accepting `{ coach }`, complete refusing without a coach, `repos.profile.setCoach` and `useTrainingProfile().coach`.
  - P7: helpers updated and the refusal test added.
  - P8 path checks: GET/PATCH, me, export, deletion, admin and pull; see Concerns 1 for the pull.
  - `breaking: false`, the migration runs inside the transaction, a 0001 database migrates without loss, and `ONBOARDING_STEPS` is unchanged.
- **YAGNI:**
  - No display names or texts for the coaches; T7 owns `COACHES`.
  - No change to `onboardingInput()` or the domain `firstIncompleteStep`; the coach resume is T7's job, using `profile.coach`.
  - No screen touched.
- **Behaviour-level tests:**
  - Everything goes through HTTP or the real migration runner on SQLite, except two cases: the deletion test calls `deleteAccount` directly, as `pull-leak` does, and the web tests use the fake API.
  - "Nothing written" is proven by an unchanged `user` row and `sync_counter`.
- **Clean output:** no stray stderr or log lines in the test output. Shell-generated logs live in the scratchpad only. No secrets anywhere.
- **Straight apostrophes:** all new strings use them.

## Concerns

1. **Ruling P8's premise does not match the code or the main spec.** The ruling says training_profile is "syncClass E (online API, not pulled)" and asks to assert that "the sync pull does not carry training_profile, as before". In fact:
   - Class E rows are mirrored. `apps/server/src/sync/pull.ts` has `MIRRORED = new Set(['J', 'D', 'E'])`.
   - The main spec 01 §5.2 says only class H is « pas copiés sur le téléphone ».
   - `apps/server/test/sync/pull.test.ts:177-183` already asserts that the owner's pull carries `training_profile`.
   - The web reads the profile from the `training_profile` mirror (`profile-repo.ts`, `db.mirror('training_profile')`).

   The literal assertion would therefore be false, on the current code and regardless of this task. I followed the ruling's governing rule instead: "coach follows exactly the path of the other training_profile columns; the main spec decides the class". Coach therefore travels in its owner's pull like `goal` or `cautious_mode`, and never in anyone else's. That is the brief's original assertion, and spec refonte §8 says « synchronisée comme le reste du profil ». Leaving coach out of the pull would have needed a special case in `pull.ts` and would leave the phone unable to show the chosen coach offline.

   **To confirm:** keep it as implemented, or decide otherwise.
2. **Routes as they really are:**
   - There is no `GET /api/training-profile`. The profile is read on the phone from the pull mirror.
   - The routes are `PATCH /api/me/training-profile` and `POST /api/me/onboarding/complete` (the brief wrote `/api/training-profile` and `/api/onboarding/complete`).
   - There is no `:id` route for the training profile, so a 404 for "another user's profile" is impossible to express. Isolation is tested instead: the other member's PATCH writes only their own row, their pull never contains A's row or id, and the existing admin `:id` sweep stays green.
3. **`useTrainingProfile` did not exist.** Ruling 5 speaks of "the training profile hook", but the screens use `useLive(() => repos.profile.get())`. Following the brief's Interfaces, I created `apps/web/src/repos/use-training-profile.ts`, which returns `{ loaded, profile, coach }`.
   - It is not re-exported from `repos/index.ts`, because it imports `useRepos` from there and a re-export would make an import cycle. Consumers (T7, T9, T10) import it from `'../../repos/use-training-profile'`.
   - `TrainingProfileView.coach` is also there, for T7's `profile.coach == null` resume check.
4. **`TrainingProfileTable.coach` is typed `CoachId | null`** instead of the brief's `string | null`. This matches `goal: Goal | null` and `experience: Experience | null` in the same table. The SQL CHECK guarantees the values.
5. **Order of the refusals:** without a coach, complete gives 400 `{ field: 'coach' }` before any 409 `onboarding_incomplete`, because the coach is step 1 of 9 in the interface. The existing R-ONB-1 409 test now sets a coach first.

   A user whose onboarding is already complete still gets the unchanged, write-free 200. No such user can lack a coach: nothing is installed, and PATCH cannot clear `coach`.
6. **P3 for the integrator:** `CoachId` is now exported from `@rune/contracts`, so T4's local `apps/web/src/ui/art/coach-id.ts` can become a re-export.
7. **Full-suite noise:** under parallel load on this shared machine, 3 tests per `pnpm test` run time out at 5 s. They are infra and build tests that spawn bash or esbuild (`release`, `release-ci-guard`, `bundle`), plus the known web flakes (`withdraw`, `profile-page`, `precache-plugin`). The same happened at baseline before any change. All of them pass alone, and server, contracts and domain are fully green run one after another. The flakes are spec §11.4 / T15 scope.
8. **Leftover stash:** the old stash `stash@{0}: On socle-coach: wip T6 (refonte run wf_0a72f685 arrêté pour le renommage)` is still there, untouched. This commit supersedes it, and the controller can drop it.

## Fix report: round 1 (integration of fix/T6-r1-g1, g2, g3)

- Integrated on `socle-coach` in `C:\Users\eliott.colin\rune-coach`, base `01b6745`, with `git cherry-pick 01b6745..<branch>` in order g1, g2, g3. History is linear, with no merge commit.
- HEAD after integration: `d480642`. No integration commit was needed, because lint, typecheck and the full suite were green on the cherry-picked commits.
- Commits on `socle-coach` (new hash ← fix-branch hash):
  - `99b71aa` ← `44dfe18` test(server): complete reste un 200 sans écriture pour un onboarding déjà terminé sans coach
  - `f9ea66c` ← `ecaf781` fix(web): useTrainingProfile distingue miroir lu et coach connu du serveur
  - `ca9664e` ← `8b933db` test: couverture du coach resserrée (ligne sans clé coach, chaque coach dans le patch)
  - `d480642` ← `f6fd67a` test(server): coach seul, reprise d'onboarding et isolation de l'UPDATE du profil
- Cumulative diff `01b6745..HEAD`: 6 files, +172/-26.
  - `apps/server/test/db/upgrade.test.ts` (2)
  - `apps/server/test/profile/coach.test.ts` (93)
  - `apps/web/src/repos/use-training-profile.ts` (23)
  - `apps/web/test/repos/profile-places-gyms.test.ts` (5)
  - `apps/web/test/repos/use-training-profile.test.tsx` (72)
  - `packages/contracts/test/coach.test.ts` (3)

### Group 1 (T6-F5, T6-F7, T6-F6 fixed; T6-F2 not fixed)

- **T6-F5 (test only, production already correct).**
  - New test in `coach.test.ts`: « déjà terminé sans coach (compte d'avant 0002) : 200 inchangé, rien écrit ». An onboarded user has a `training_profile` row with `coach: null`, and the clock then moves forward one minute.
  - Expected: complete answers 200 with the original `onboardingCompletedAt`, and the user row, the profile row and `sync_counter` are unchanged.
  - RED by mutation: the coach check was moved above the `onboardingCompletedAt` early return in `routes.ts`. The test failed with `AssertionError: expected 400 to be 200`. The mutation was reverted and is not in the diff.
- **T6-F7 and T6-F6 (web hook).**
  - `useTrainingProfile()` now returns `{ loaded, known, profile, coach }`:
    - `loaded`: the mirror has answered.
    - `known = loaded && (profile !== null || lastPullOkAt !== null)`, where `lastPullOkAt` comes from `useSyncState()` (user-scoped meta, cleared by `wipeUserData`).
    - The doc comments say that a null coach before the first pull does not mean « not chosen ».
  - The test file was rewritten as 4 tests:
    1. A held `profile.get` promise: « lecture · inconnu », then « lu · connu · muscle / skald ».
    2. « suit le miroir », with `lastPullOkAt` set.
    3. An empty mirror without a pull is « inconnu », and becomes « connu » after `sync.set({ lastPullOkAt })`.
    4. A seeded profile without a pull is « connu ».
  - RED: 4/4 failed before the implementation (« inconnu » where « connu » was expected). GREEN: 4/4.
  - Mutations, each caught:
    - `loaded = true`: test 1 fails.
    - `loaded = profile !== null`: 3 tests fail.
    - `known = loaded`: 2 tests fail.
    - `known = loaded && lastPullOkAt !== null`: 2 tests fail.
  - This updates Concern 3 above: the hook now also returns `known`. **T7, T9 and T10 must test `known`, not `loaded`, before concluding that no coach is chosen.**
- Group tests (from its worktree):
  - `pnpm lint` clean (455 files) and `pnpm typecheck` exit 0.
  - Server project: 76 files, 712 passed and 2 skipped. Web project: 67 files, 927 passed.
  - `profile/coach` 16/16 and `repos/use-training-profile` 4/4, with no stderr.

### Group 2 (T6-F9, T6-F8, T6-F10 fixed; tests only)

- **T6-F9:** the `upgrade.test.ts` title is now a double-quoted string with a straight apostrophe: "le schéma v1 figé reçoit 0002_coach et devient identique à l'instantané". The file contains 0 occurrences of U+2019. GREEN: the upgrade test passes. A RED run means nothing for a title change.
- **T6-F8:** `profile-places-gyms.test.ts` « get : coach absent ou inconnu du miroir → null » now first seeds a row with no `coach` key at all, as pulled before 0002. It asserts that `goal` is `'muscle'` (the row really was decoded) and that `coach` is `null`.
  - RED by mutation: a stricter decoder, `typeof row.coach === 'string' ? … : (row.coach as null)`, passed the old test but fails the new one with `expected undefined to be null`. The mutation was reverted.
- **T6-F10:** the tautological `CoachIdSchema.options` assertion is removed from `packages/contracts/test/coach.test.ts`. `TrainingProfilePatch` now accepts every value of `COACH_IDS` in a loop, and still refuses `null` and `'berserker'`.
  - RED by mutation: `CoachIdSchema.exclude(['scribe'])` passed the old test but fails the new one with a ZodError. The mutation was reverted. GREEN: 4/4.
- Group tests:
  - The 3 covering files: 21 passed.
  - `pnpm lint` clean (455 files) and `pnpm typecheck` exit 0.
  - contracts 77 passed; server 711 passed and 2 skipped; web 924 passed.

### Group 3 (T6-F4, T6-F3, T6-F1 fixed; tests only)

- **T6-F4:**
  - The first PATCH test now sends only `{coach:'scribe'}` on an existing 'skald' row after `clock.advance(60s)`. It asserts that `sync_counter` advances by 1 and that the whole row equals the previous row with the new coach, rev and `updatedAt`. A later patch without coach still keeps the coach.
  - New test « renvoyer le même coach n'écrit rien »: rev, `updatedAt`, `updatedBy` and `sync_counter` stay unchanged.
- **T6-F3:** new test « reprise sans coach à l'étape « availability » ».
  - complete returns 400 `{field:'coach'}`.
  - The coach-only PATCH returns `onboardingStep: 'availability'` and `onboardingCompletedAt: null`, and leaves the user row identical.
  - complete then returns 409 `{error:'onboarding_incomplete', step:'availability'}`.
- **T6-F1:** in the isolation test, B inserts and then UPDATEs its own row while A's row exists. A's full row stays identical (rev, `updatedAt` and `updatedBy` included). A's pull carries 'ombre' and B's pull carries 'skald'.
- RED by mutants of `routes.ts`. The old test file passed all four (15/15 each); the new tests catch each one with exactly one failure, and every mutant was reverted:
  - M1, the `where id` clause dropped from the UPDATE: the isolation test fails.
  - M4a, a coach-only write without `writeStamp`: `expected 3 to be 4`.
  - M4b, a stamp even when nothing changed: the same-coach test fails.
  - M3, a coach PATCH that resets the step to 'goal': the resume test fails.
- Group tests: `profile/coach` 17/17, server package 713 passed and 2 skipped, lint clean, typecheck exit 0.
- Side note from the group: the F1 test still asserts that the owner's pull carries `training_profile`. That is Concern 1 above, still open for the controller.

### Conflict resolved

- One conflict, in `apps/server/test/profile/coach.test.ts`, when g3 (`f6fd67a`) was applied after g1. Both groups had added a new `it(...)` at the same place in `describe('POST /api/me/onboarding/complete : coach exigé')`, right after « le coach passe avant les autres étapes… »:
  - g1: « déjà terminé sans coach (compte d'avant 0002) »
  - g3: « reprise sans coach à l'étape « availability » »
- Resolution: both tests are kept, g1's first and then g3's, each with its own closing `});`. No line of either test changed.
- g3's other hunks (the PATCH describe and the isolation test) applied cleanly.
- Check: `pnpm --filter @rune/server test profile/coach` gives **18 passed (18)**, that is the 15 base tests plus 1 from g1 plus 2 from g3. `grep` finds no conflict marker left.

### Not addressed: T6-F2

- `apps/web/e2e/epoch.spec.ts`, helper `createAdminViaApi` (lines 28-35): it PATCHes `/api/me/training-profile` without a coach, then POSTs `/api/me/onboarding/complete` and expects 200. Since T6, that call answers 400 `{field:'coach'}`, so this E2E spec is red.
- The one-line fix is to add `coach: 'skald'` to the PATCH body at line 31.
- Ruling P7 keeps `apps/web/e2e` out of T6 and gives T7 only `apps/web/e2e/support/flows.ts`. Neither the group nor this integration touched `apps/web/e2e`.
- **For the controller:** extend P7 so that T7 (or T8) also fixes `epoch.spec.ts:31`, or allow that line in T6. As P7 stands, `flows.ts` alone does not make the E2E suite green.

### Final verification (on `d480642`, in `C:\Users\eliott.colin\rune-coach`)

- `pnpm lint`: `Checked 455 files in 283ms. No fixes applied.` (exit 0)
- `pnpm typecheck`: exit 0. contracts, domain, server and web each ran `tsc --noEmit` with no error.
- `pnpm test`: exit 0, `Test Files  166 passed (166)` and `Tests  2063 passed | 2 skipped (2065)`, in 37 s.
  - No failure, no stderr. Vitest's only notice is its usual performance hint about happy-dom.
  - The timeouts and flakes of Concern 7 did not show up in this run.
- Covering files together (`coach.test.ts`, `use-training-profile.test.tsx`, `profile-places-gyms.test.ts`, contracts `coach.test.ts`, `upgrade.test.ts`): `Tests  43 passed (43)`.
- `useTrainingProfile` has no consumer in `apps/web/src` yet, so the new `known` field breaks nothing.
- E2E: not run. Only unit tests and one hook changed, and the epoch spec is known red (T6-F2 above).

### Cleanup

- `git worktree remove --force` was run on `rune-coach-fix-T6-r1-g1`, `-g2` and `-g3`, followed by `git worktree prune`.
- Git left three folders behind that held only empty folders and pnpm junctions. Every junction pointed either inside its own folder or to a path that no longer exists. They were removed with `rmdir /s /q`, which does not follow junctions.
- The branches `fix/T6-r1-g1` (`ecaf781`), `fix/T6-r1-g2` (`8b933db`) and `fix/T6-r1-g3` (`f6fd67a`) were deleted with `git branch -D`. Their commits are on `socle-coach` as cherry-picks.
- `git status`: `On branch socle-coach`, `nothing to commit, working tree clean`.
- `git show --stat HEAD`: `d480642` test(server): coach seul, reprise d'onboarding et isolation de l'UPDATE du profil. 1 file changed, `apps/server/test/profile/coach.test.ts`, 58 insertions(+), 9 deletions(-).
- Nothing was pushed.
