# Task 42 report: Release GHCR and Dependabot

Status: DONE_WITH_CONCERNS (concern is outside this task's files, see below)
Worktree: C:\Users\eliott.colin\appsport-infra, branch socle-infra. Issue: #43.
Commit: c7d547e ci(ci): release GHCR sur tag d'un commit vert de main et Dependabot

## What was implemented

- `.github/workflows/release.yml`
  - `on: { push: { tags: ['v*.*.*'] } }` only; workflow `permissions: { contents: read, packages: write, actions: read }`.
  - One job `publish` (`ubuntu-latest`), 7 steps in this order:
    1. `actions/checkout@v4` with `fetch-depth: 0`;
    2. Tag guard: `[[ "$GITHUB_REF_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]`, else « Tag invalide : $GITHUB_REF_NAME » and exit 1;
    3. Main guard: `git fetch origin main` then `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`, else « Le commit n'est pas sur main : publication refusée. »;
    4. CI guard with `GH_TOKEN: ${{ github.token }}`: `gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}&status=success" --jq '.total_count'`, must be at least 1, else « La CI du commit ${GITHUB_SHA} n'est pas verte : publication refusée. Relancer ce job quand la CI de main sera verte. »;
    5. `docker/setup-buildx-action@v3`;
    6. `docker/login-action@v3` (registry ghcr.io, username `${{ github.actor }}`, password `${{ github.token }}`);
    7. `docker/build-push-action@v6`: context `.`, file `infra/Dockerfile`, platforms `linux/amd64`, push true, tags `ghcr.io/gnochance/appsport:${{ github.ref_name }}`, build-args exactly `VERSION=${{ github.ref_name }}` and `VITE_OWNER_FIRST_NAME=${{ vars.VITE_OWNER_FIRST_NAME }}`.
  - No `:latest`, no deployment step (R-OPS-13: the release only publishes the image), no Anthropic mention.
  - Shell guards read the default env vars (`$GITHUB_REF_NAME`, `$GITHUB_SHA`, `$GITHUB_REPOSITORY`), not `${{ }}` interpolation inside `run`, so a tag name cannot inject shell.
- `.github/dependabot.yml`: version 2; npm on `/` weekly with `groups: { npm-minor-patch: { patterns: ['*'], update-types: ['minor', 'patch'] } }`; docker on `/infra` weekly (base image of infra/Dockerfile); github-actions on `/` weekly (08 §8).
- `apps/server/test/infra/release.test.ts`: 10 tests (parses with `yaml`, same style as compose.test.ts):
  1. tag-only trigger; 2. exact permissions; 3. single job `publish` on ubuntu-latest, exactly 7 steps, checkout with fetch-depth 0, steps in the required order; 4. tag guard regex and message; 5. main guard (fetch before merge-base in the same step, exact command and message); 6. CI guard (exact env, gh api command, `--jq '.total_count'`, message; the three guards come before build-push); 7. login-action `with` exact, build-push `with` and the two build-args lines; 8. no `:latest`, no `/anthropic/i` in release.yml or ci.yml; 9. ci.yml runs on pull_request and push to main; 10. dependabot.yml exact `updates` list.
- `ci.yml` not modified (controller ruling D7): it already has `on: { push: { branches: [main] }, pull_request }` since T1. Test 9 checks this and was green before any code.

## TDD evidence

RED (test written first, before release.yml and dependabot.yml existed):
```
$ pnpm --filter @appsport/server test infra/release
 FAIL  |server| test/infra/release.test.ts [ apps/server/test/infra/release.test.ts ]
Error: ENOENT: no such file or directory, open 'C:\Users\eliott.colin\appsport-infra\.github\workflows\release.yml'
 Test Files  1 failed (1)
      Tests  no tests
```
Expected: the suite reads release.yml at collection time, and the file did not exist yet.

GREEN (after writing release.yml and dependabot.yml):
```
$ pnpm --filter @appsport/server test infra/release
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Full checks

- `pnpm lint`: first run flagged my test (non-null assertions plus formatting). Fixed by adding a checked `stepAt(index)` accessor that throws a clear error, then `biome format`. Now: `Checked 408 files ... No fixes applied.`, no warnings.
- `pnpm typecheck`: exit 0.
- `pnpm test`: `Test Files 147 passed (147)`, `Tests 1750 passed | 2 skipped (1752)` on 3 of 4 full runs. The 2 skipped tests were already there and are not in my file.

## Host-only behavior

The workflow runs only on GitHub when a vX.Y.Z tag is pushed. Locally, the only check is the YAML test above. The owner must create the repository variable `VITE_OWNER_FIRST_NAME` (Settings, Secrets and variables, Actions, Variables). Otherwise the image shows « l'administrateur » (T28 fallback). The first real publish is checked during P3.

## Files changed

- A `.github/workflows/release.yml` (64 lines)
- A `.github/dependabot.yml` (21 lines)
- A `apps/server/test/infra/release.test.ts` (136 lines)

`git show --stat HEAD` confirms these 3 files and nothing else; `git status` is clean.

## Self-review

- Every ruling value is used verbatim, and the test pins each one.
- YAGNI: no concurrency group, no cache-from/to, no labels/metadata-action, no extra tags.
- When `gh api` fails (network or 404), `count=$(...)` fails under the runner's `bash -e`, so the job stops with gh's error instead of the French message. That still fails closed. `${count:-0}` covers an empty result.
- The CI guard only accepts a ci.yml run with status success for the exact tagged SHA. Re-running the job after main's CI goes green works, as the message says.

## Concerns

- Flaky test outside this task: `apps/web/test/places/places-page.test.tsx` > PlaceDetail > « maison : cocher → PUT …/equipment/<code> {} ; décocher → DELETE (R-LIEU-3) » failed in 1 of 4 full `pnpm test` runs (`expected false to be true` at line 422, `checkbox(dumbbells).checked` right after waiting for the chair checkbox to be re-enabled). It looks like a timing race in the test or the component when the full suite runs under load. The other 3 full runs passed. My commit touches only YAML and a server test, so it cannot cause this. I did not change it (out of scope). Note: my commit command was chained after the run that showed this failure. I re-ran the suite (all passed) and investigated before reporting.

---

# Fix report — round 1 (integration of groups 1 and 2, on socle-infra)

Base: `c7d547e` on `socle-infra` (worktree `C:\Users\eliott.colin\appsport-infra`). Each branch was cherry-picked with `git cherry-pick c7d547e..<branch>`. History stays linear, with no merge commits.

| Group | Findings | Branch head | Commit on socle-infra |
|---|---|---|---|
| 1 | T42-F2 | 27d8abd | `2e7ca99` fix(ci): garde CI de la release fermée sur un total_count non entier |
| 2 | T42-F1, T42-F3, T42-F4, T42-F5 | ebd1ee1 | `66d2333` test(ci): gardes de la release exécutées sous bash, étapes et entrées comparées en entier |

## Group 1: T42-F2 (CI guard fails closed)

- `.github/workflows/release.yml`, CI guard step: `if [ "${count:-0}" -lt 1 ]; then` became `if ! [[ "$count" =~ ^[0-9]+$ ]] || (( count < 1 )); then`, with a one-line French comment saying the guard fails closed. The message, the `gh api` command, the env and the step order are unchanged.
- New file `apps/server/test/infra/release-ci-guard.test.ts`. It runs the CI guard's own `run` under `bash --noprofile --norc -eo pipefail -c` with a stub `gh` function. On Windows it uses Git for Windows bash (`%ProgramFiles%\Git\bin\bash.exe`). Cases:
  - total_count 1 gives exit 0.
  - 0, empty, `null` and `abc` each give exit 1 with the exact refusal message.
  - gh failing gives a non-zero exit.
- RED before the fix: `Tests 2 failed | 4 passed (6)`. `null` and `abc` exited 0 (`[: abc: integer expected`), so the guard failed open. GREEN after the fix: `infra/release` 2 files, 16 passed.

## Group 2: T42-F1, F3, F4, F5 (test only; the workflow was already correct)

- Only file changed: `apps/server/test/infra/release.test.ts`. It still has 10 `it` blocks.
- **F1:** a `runGuard` helper runs each guard's `run` under `bash --noprofile --norc -e -c`. `git` and `gh` are stub functions that trace their calls. Every case checks the exact `{status, stdout, calls}`:
  - Tag guard: accepts v1.2.3 and v10.0.27; refuses v1.2.3-rc1, v1.2, v1.2.3.4, 1.2.3 and refs/tags/v1.2.3.
  - Main guard: the calls are fetch then merge-base; merge-base 0 gives exit 0, merge-base 1 gives exit 1 with the message.
  - CI guard: the expanded `gh api ... --jq .total_count` call. 1 or 3 gives exit 0; 0 or empty gives exit 1; gh failing gives a non-zero exit.
  - Each step's keys are compared exactly, so no `if`, `continue-on-error` or `shell` can be added.
- **F5:** the step list is asserted exactly by uses/name. checkout's `with` must equal `{fetch-depth: 0}`. Each message is checked inside its own named step.
- **F4:** the keys of `jobs.publish` must equal `['runs-on','steps']`.
- **F3:** toEqual on the whole build-push `with` map, including the exact `build-args` string.
- RED: 11 workflow mutations (deleted `exit 1`, dropped `!`, `-ge 1`, `continue-on-error`, `if: false`, quoted regex, `$GITHUB_REF`, `permissions: write-all`, `cache-to`, an extra deploy step, merged guards). The original test missed 9 of them, and the new test fails on all 11. GREEN: 10 passed on the unmodified workflow.

## Conflicts and integration

- No textual conflict. Group 1 changed `release.yml` and added its own test file; group 2 changed only `release.test.ts`.
- Semantic check: group 2's CI guard cases run the guard script as it is now, which includes group 1's `[[ =~ ]] || (( ))` guard. With gh printing 1 or 3 the guard exits 0. With 0 or empty it exits 1 with the message. When gh fails, the guard still exits non-zero. Both test files pass together, so both fixes keep working. No integration commit was needed.
- Folding F2's cases into group 2's `runGuard` harness, as group 1 suggested, was not done; the two files are independent and both green. Remaining duplication: there are two bash-discovery methods, `%ProgramFiles%\Git\bin\bash.exe` and `git --exec-path`/../../../bin/bash.exe. They could be merged into one later.

## Final command outputs (HEAD 66d2333)

- `pnpm --filter @appsport/server test infra/release`: `Test Files 2 passed (2)`, `Tests 16 passed (16)`.
- `pnpm lint`: `Checked 409 files in 243ms. No fixes applied.`
- `pnpm typecheck`: exit 0.
- `pnpm test`:
  - First run: `Test Files 1 failed | 147 passed (148)`, `Tests 1 failed | 1755 passed | 2 skipped (1758)`. The failing test was `apps/web/test/profile/profile-page.test.tsx` > « dialogue ouvert : une relecture du compte ne reprend pas le focus », a focus assertion. This flaky test is already known (T37 report, progress.md) and is outside the diff, which touches only `release.yml` and two server tests. Run alone it passed 33/33.
  - Rerun of the full suite: `Test Files 148 passed (148)`, `Tests 1756 passed | 2 skipped (1758)`, exit 0.
- Fix worktrees `appsport-infra-fix-T42-r1-g1` and `-g2` were removed and branches `fix/T42-r1-g1` and `fix/T42-r1-g2` deleted.

## Concerns

- The profile-page focus test is still flaky under full-suite load. It was already known, and a ticket is still worth opening.
