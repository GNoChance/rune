# Task 43 report: appsport-unlock and appsport-update with R-DEP-4 rollback

Lane O: worktree `C:\Users\eliott.colin\appsport-ops`, branch `socle-ops`. Issue #44.

**Status:** DONE_WITH_CONCERNS. The concerns are tooling notes, not open defects (see the end).
**Commit:** `4919285 feat(ops): appsport-unlock et appsport-update avec retour arrière R-DEP-4` (14 files, +1276).
**Review package:** `/c/Users/eliott.colin/appsport-ops/.superpowers/sdd/2026-10-06-socle/review-68c6464..4919285.diff`

## What was implemented

### Server: `sessions:active`
- `apps/server/src/ops/active-sessions.ts`: `listActiveWorkoutSessions(sqlite, now, maxAgeHours = 3)`.
  - It returns `[]` when the `workout_session` table is missing (the socle).
  - Otherwise it returns sessions that are `in_progress`, have `deleted_at IS NULL` and have `started_at > now − maxAgeHours`, sorted by `started_at` then pseudo. It joins `user` to get the pseudo.
- `apps/server/src/cli.ts`: new `sessions:active [--hours N]` command (default 3; a value that is not a positive integer gives exit 1).
  - It opens the database read-only, with no guard and no migration, because the service is running.
  - It prints one `<pseudo>\t<startedAt>` line per session and exits 0.

### Host library: `infra/host/lib/common.sh`
- **Defaults** use `: "${X:=…}"`. They cover Interfaces §8 and the brief's list, including `SMART_DEVICES` taken from `lsblk -dno PATH,TYPE`.
- **Exported:** `DOCKER_CONFIG`, `RESTIC_PASSWORD_FILE`, `RESTIC_CACHE_DIR`, and `GIT_SSH_COMMAND` (`ssh -i $APPSPORT_ROOT/secrets/deploy_key -o IdentitiesOnly=yes`).
- **`APPSPORT_VERSION` is unset, never exported.** Compose gives a shell variable priority over `--env-file`, so an inherited value would silently override `deploy.env`. `HC_ENV` is sourced when readable.
- **Functions** follow the brief:
  - `log`, `die`, `now_iso`.
  - `take_lock`: `exec 9>"$LOCK_FILE"`, then `$FLOCK -n 9`.
  - `compose`: the exact form from the rulings.
  - `app_running` (`compose ps --status running --quiet app`), `app_cli` (`exec -T`, or falls back to `app_cli_run`), `app_cli_run` (`run --rm --no-deps`).
  - `volume_mounted`, `sentinel_present`.
  - `health_json [max_s]`.
  - `wait_health [version]`: `HEALTH_TIMEOUT_S / (2 × HEALTH_POLL_S)` tries, no sleep after the last one. It sets `HEALTH_VERSION`.
  - `hc_ping`: URL last. A missing URL gives a warning and exit 0.
  - `ensure_ops_dir`.
  - `status_merge`: `mktemp` inside `data/ops`, `jq '.[$k]=$v'`, then `chmod 0640` and `$CHOWN 1000:1000` before `mv`. An unreadable or non-object `status.json` restarts from `{}`.
  - `restic_on`: `b2.env` is sourced with `set -a` in a subshell.
  - `restic_backup_all`: local then offsite with the `--exclude` and the five paths. Failed repositories go to stdout and restic's own output to stderr.
  - `current_version`, `write_deploy_env` (atomic), `log_deploy`.
- **Error handling:** every function propagates its own failures with `&&` or `|| return 1`. The scripts call them inside `if` and `||`, where `set -e` is switched off.

### `infra/host/appsport-unlock` (exit 0 OK, 1 KO)
The script is idempotent:
1. `cryptsetup status`, then `open` only if the volume is closed. A failure prints « Phrase refusée. ».
2. `mount` only if `mountpoint -q` fails.
3. Sentinel check. If it is missing: « KO : sentinelle absente, ce n'est pas le volume appsport. » and `hc_ping alive fail "sentinelle absente"`.
4. `systemctl start docker`, then `compose up -d`, then `wait_health`.
5. On success:
   - it prints « OK : appsport répond (version <v>). » and runs `hc_ping alive`;
   - if `.backup.at` is missing or older than 24 h, it runs `systemctl start --no-block appsport-backup.service`.
6. On failure: « KO : /api/health ne répond pas 200 après 2 min (voir P8). » plus `alive/fail` with a reason.

### `infra/host/appsport-update` (exit 0 / 1 / 2)
- `main()` and `rollback()` follow the brief's flow and messages verbatim.
- `parse_args` accepts `vX.Y.Z` (regex) or `--rollback`, plus `--yes`. Anything else prints a usage message and exits 2.
- `confirm` shows `[o/N]`. Any answer other than o/oui gives « Abandon : rien n'a été changé. ».
- `show_active_sessions` prints either « Aucune séance en cours depuis moins de 3 h. » or « - <pseudo> (début <startedAt>) ».
- The pull runs only as `APPSPORT_VERSION="$NEW" compose pull app`.
- **Rollback, image only first:** write `deploy.env`, `checkout`, `up -d`, then wait for health. Nothing is restored and no new epoch is created.
- **Only if the previous image is still KO:**
  1. `privacy:collect --since <snapshot mtime − 300 s> --out /data/ops/privacy-<v>-<stamp>.json` through `run --rm --no-deps`, without `--source`;
  2. `stop app`;
  3. `restore /data/snapshots/pre-<v>.db`;
  4. `privacy:reapply`;
  5. the list is deleted (03 §7);
  6. `up -d`, then wait for health.
- **Any failure** goes through `ko`: `finish rollback-failed`, then « … : suivez P4. ».
- `finish` writes `deploy.log` and `.deploy`:
  - auto: `'<prev> <new> <result>'` and `{version: new, previousVersion: prev, ok: false}`;
  - manual: `'<cur> <prev> <result>'` and `ok = result ≠ rollback-failed`.
- The script ends with `main "$@"; exit $?`, and everything is in functions.

### Bats harness (`infra/host/test`)
- **`stub.sh`** is copied to `$T/bin/<name>` for the 12 commands. Each call:
  1. appends `<name> <args>` to `$CALLS`;
  2. applies the first matching rule in `$T/rules/<name>` (tab-separated glob, code, snippet passed to `eval`);
  3. otherwise runs `default_<name>`.
- **`defaults.bash`** simulates the host in `$STATE`:
  - LUKS, mount, running app and current image;
  - `compose ps/up/stop/pull`, `exec`/`run` of `server.mjs` (`sessions:active`, `snapshot`, `restore`, `privacy:collect` writing `--out`, `privacy:reapply`);
  - health, as described under "Self-review" below;
  - it records the environment seen by `pull`, `up` and `restic`.
- **`helpers.bash`:**
  - `setup_host` builds the temporary tree and sets the stub variables, `SLEEP=true`, `LOCK_FILE`, `SMART_DEVICES`, the HC URLs, `b2.env`, and a healthy v1.2.0 host with a backup less than 24 h old. `$T/bin` comes first in `PATH`, so no real host command can ever run.
  - Helpers: `on`, `set_healthy_versions`, `set_health`, `write_deploy_env_for_test`, `write_backup_at`, `reset_calls`, `assert_calls_in_order`, `refute_call`, `count_calls`.
  - On Windows only, `jq` is wrapped with `-b`, because the local jq.exe writes CRLF.
- **Suites:** `unlock.bats` has 7 tests (the symlink test is skipped on Windows). `update.bats` has 17 tests matching the brief's list. The confirmation case is two tests (« n » and « o ») and the three preconditions are three tests.

### Root and CI
- Root `package.json`: `"test:infra": "bats infra/host/test"`, plus the dev dependency `bats ^1.13.0` (lockfile updated).
- `.github/workflows/ci.yml`: new blocking `infra` job: `pnpm install --frozen-lockfile`, then `shellcheck -x infra/host/appsport-* infra/host/lib/common.sh infra/host/test/stub.sh infra/test/image-contract.sh`, then `pnpm test:infra` with `LC_ALL: C.UTF-8` (the test names are in French).
- Scripts are committed with mode 100755 (`appsport-unlock`, `appsport-update`, `stub.sh`). Every file is `i/lf w/lf`.

## TDD evidence

### RED, server (run separately, before any implementation)
`pnpm --filter @appsport/server test ops/active-sessions`
```
Error: Cannot find module '../../src/ops/active-sessions' imported from C:/Users/eliott.colin/appsport-ops/apps/server/test/ops/active-sessions.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```
Expected: the module did not exist yet.

### RED, bats (run separately, before stub.sh, helpers, defaults and the scripts existed)
`LC_ALL=C.UTF-8 bats infra/host/test/unlock.bats infra/host/test/update.bats` gave exit 1, with 24 × `not ok`:
```
1..24
not ok 1 volume verrouillé : ouverture, montage, Docker, compose, santé, OK puis ping alive
# (from function `setup' in test file infra/host/test/unlock.bats, line 7)
#   `setup() {' failed
# bats_load_safe: Could not find '/c/Users/eliott.colin/appsport-ops/infra/host/test/helpers'[.bash]
...
not ok 24 version mal formée : usage, code 2, aucune commande
```
Expected: `load helpers` cannot be found, exactly as the brief's Step 2 says.

### GREEN, server
`pnpm --filter @appsport/server test ops/active-sessions` gives `Test Files 1 passed (1)`, `Tests 3 passed (3)`.

### GREEN, bats
From Git Bash: `LC_ALL=C.UTF-8 pnpm exec bats "$PWD/infra/host/test/unlock.bats" "$PWD/infra/host/test/update.bats"` exits 0:
```
1..24
ok 1 … ok 6
ok 7 lancé par un lien symbolique (/usr/local/sbin) : common.sh trouvé, OK # skip liens symboliques non fiables sous Windows : vérifié par le job infra
ok 8 … ok 24
```
That is 24 tests, 0 failures, 1 skipped on Windows.

The first GREEN attempt had two failures in the restore branch: the simulated `v1.2.0@restored` was unhealthy even before v1.3.0 had migrated anything. The simulation was fixed (see "Self-review"); the scripts did not change.

### Mutation checks (run locally, then reverted)
- Removing the image-only branch of `rollback` makes tests 11, 12 and 15 of `update.bats` fail.
- Exporting `APPSPORT_VERSION` from common.sh makes tests 1 and 3 fail.
- Moving `chown` after `mv` in `status_merge` makes test 1 (the nominal case) fail.

### shellcheck
shellcheck 0.10.0 was downloaded as a release binary into the session scratchpad; nothing was installed. On the exact CI file list it produced no output and exit 0. `helpers.bash` and `defaults.bash` are also clean.

### Full checks before the commit
- `pnpm lint`: biome checked 439 files, no fixes.
- `pnpm typecheck`: exit 0.
- `pnpm test`: `Test Files 159 passed (159)`, `Tests 1891 passed | 2 skipped (1893)`, exit 0.
  - One earlier full run was hit by a machine freeze of about 34 minutes. Seven unrelated tests each showed about 2,070,000 ms and failed on timeout. The rerun just afterwards was entirely green; the first full run of this session was green too.

`git show --stat HEAD` lists all 14 files claimed above, and `git status` is clean.

## Files changed
- `.github/workflows/ci.yml` (infra job)
- `apps/server/src/cli.ts` (`sessions:active`)
- `apps/server/src/ops/active-sessions.ts` (new)
- `apps/server/test/ops/active-sessions.test.ts` (new, 3 tests)
- `infra/host/appsport-unlock`, `infra/host/appsport-update` (new, 100755)
- `infra/host/lib/common.sh` (new)
- `infra/host/test/{stub.sh (100755), helpers.bash, defaults.bash, unlock.bats, update.bats}` (new)
- `package.json`, `pnpm-lock.yaml` (bats, test:infra)

## Self-review
- **Review Focus 4 (image only first):** tests 11 and 15 assert there is no `restore`, no `privacy:` and no `stop`, and that the result is `rolled-back-image`. Test 12 asserts the exact restore order, no `--source`, the `--since` format, and that no `privacy-*.json` is left.
- **`v@restored` simulation:** `v@restored` counts as healthy until another version has run `compose up`, which may have migrated the schema. After that it is healthy only once `restore` has run. This models R-VER-7 and lets the pre-deploy health check pass.
- **Tests go beyond the brief where it was cheap:**
  - the B2 keys reach only the offsite restic call;
  - `up -d` never sees `APPSPORT_VERSION`;
  - the full `--exclude` and path list;
  - `status.json` keeps the existing `backup` section after a merge;
  - a failed restore keeps the privacy list for P4.
- **`setup_host` sets `HEALTH_TIMEOUT_S=8`** (2 tries) to keep runs fast. The unlock health test sets 12 / 2 as the brief requires, and the production default stays 120.
- **`hc_ping` with a curl failure** returns curl's status; only a missing URL warns and returns 0. Callers that must not fail on a ping use `|| true` or `|| log`.

## Concerns
1. **`pnpm test:infra` fails on Windows only.** pnpm runs scripts through cmd, the inherited `PWD` is `C:/…`, and bats rejects that as not absolute. Locally, run `LC_ALL=C.UTF-8 pnpm exec bats "$PWD/infra/host/test"` from Git Bash. The Linux CI job is not affected, but it has not been run yet (nothing pushed). Expected CI output: shellcheck silent, then 24 tests, 0 failures.
2. **bats needs a UTF-8 locale** for the French test names. Without one, every test fails with "unknown test name". Git Bash normally sets `LANG` to UTF-8; the Bash tool here did not. The CI step sets `LC_ALL: C.UTF-8`.
3. **shellcheck version:** checked with 0.10.0. ubuntu-latest may ship an older shellcheck. The `# shellcheck source-path=SCRIPTDIR source=lib/common.sh` directive needs a recent version (I believe 0.8.0 or later; to confirm in CI).
4. **Messages added beyond the brief, for T45 to quote or drop:**
   - unlock KO messages: « KO : montage de <root> impossible. », « KO : Docker ne démarre pas (voir P8). », « KO : docker compose up -d a échoué (voir P8). »;
   - update failures: « Impossible de lister les séances en cours. Rien n'a été changé. », « Version en place illisible dans <root>/deploy.env. Rien n'a été changé. », « deploy.env non écrit. Le service n'a pas été modifié. »;
   - update progress: the header « Séances en cours depuis moins de 3 h : », « Retour à <v> (image seule, sans restauration). », « L'image <v> ne démarre pas sur ce schéma : restauration de l'instantané pre-<v>. »;
   - the rollback reason « Date de l'instantané pre-<v> illisible »;
   - the warning when the repository cannot go back to the previous tag after a `pull-failed` or `backup-failed`;
   - « Sauvegarde de la nuit manquée : relance de appsport-backup. »;
   - « Option --hours invalide : nombre entier d'heures attendu. ».
5. **No vitest guard on the CI `infra` job.** T41 pinned the `image` job in `compose.test.ts`; that file is outside this brief's file list, so I did not add one.


---

## Fix report, round 1 (integration of four parallel fix branches)

Integrated on `socle-ops` in `C:\Users\eliott.colin\appsport-ops`, from `4919285`. Each branch went in with `git cherry-pick 4919285..<branch>`, so history stays linear with no merge commits. Order: g1, g2, g3, g4, then one integration commit.

**Status:** DONE_WITH_CONCERNS. 23 findings fixed and integrated. The 7 group-4 test findings were never committed and are not integrated (see "Not integrated").

### Commits (4919285..HEAD)
- `f3dd494 test(ops): sessions:active épinglé sur la borne de 3 h, abandoned et --hours` (g1, F27)
- `0404f95 test(ops): le stub compose up préfère APPSPORT_VERSION du shell, comme compose` (g1, F25)
- `38163fd fix(ops): versions relues dans deploy.log et deploy.env validées comme vX.Y.Z` (g1, F21)
- `c557d8d fix(ops): réapplication en attente après restauration, aucun up -d avant P4` (g1, F5)
- `b9854b5 fix(ops): appsport-update consigne une interruption et ignore un SSH coupé` (g1, F2)
- `6533ce7 fix(ops): échecs consignés et KO affiché avant le ping (T43 revue, groupe 2)` (g2: F12, F11, F19, F13; conflicts 1 to 4)
- `b536b0a fix(ops): status.json hors d'atteinte du conteneur, verrou propre, jq requis et attente de santé de 2 min` (g3: F16, F15, F6, F3, F1; conflict 5)
- `82f3ab5 test(ops): bats lancés depuis Git Bash sous Windows (source de helpers.bash, locale UTF-8)` (g4: F4; applied cleanly)
- `b3c2a45 fix(ops): intégration des correctifs T43 (revue, tour 1)` (integration)

Review package: `/c/Users/eliott.colin/appsport-ops/.superpowers/sdd/2026-10-06-socle/review-4919285..b3c2a45.diff` (9 commits).

### Group 1: T43-F27, F25, F21, F5, F2 (5 commits)
- **F27 (test only):** `active-sessions.test.ts` adds carol's session at exactly 17:00:00.000Z, excluded at 3 h and included at 4 h, plus an abandoned session, which is excluded. The CLI test starts the session 2 h ago: `--hours 3` gives one line, `--hours 1` gives none, and `--hours 0` exits 1 with « Option --hours invalide : nombre entier d'heures attendu. ». RED by mutation: `>` changed to `>=`, the status filter changed to `!= 'completed'`, `--hours` hard-coded to 3, and `.positive()` changed to `.nonnegative()`. All four pass the old test and fail the new one.
- **F25 (tests only):** in `defaults.bash`, the stub `up` writes `${APPSPORT_VERSION:-<deploy.env>}` as the image, the way compose does, and `up-env` gets one line per `up`. The new `assert_up_env_unset` runs in the auto image-only rollback, restore rollback and manual `--rollback` tests. RED: the mutant `APPSPORT_VERSION="$2" compose up -d` passed the old tests and fails tests 11, 12 and 15.
- **F21:** `valid_version` in `common.sh` is checked in three places: `parse_args`; the in-place version from deploy.env (« Version en place illisible dans <root>/deploy.env. Rien n'a été changé. »); and prev and cur of the last ok line in `--rollback` mode (« Dernier déploiement réussi illisible dans <root>/deploy.log. Rien n'a été changé. »). There is no `--` in `git checkout`, because it would turn the ref into a pathspec. A new test covers `../../../etc`, `--orphan` as cur, and `--orphan` in deploy.env: each exits 1 and nothing changes.
- **F5:** `REAPPLY_MARKER=$APPSPORT_ROOT/reapply-pending` (owned by root, outside data/) and `reapply_pending()`.
  - rollback writes the list path into the marker after `compose stop app` and before restore (`|| ko`).
  - appsport-update refuses to run in both modes while the marker exists (« Réapplication des suppressions en attente : suivez P4. »).
  - appsport-unlock checks for it after `systemctl start docker` and before `compose up -d` (« KO : réapplication des suppressions en attente : suivez P4. », plus an alive/fail ping with reason `reapplication en attente`).
  - Tests: the marker is removed after a successful restore and kept after a failed one. A new test makes the reapply fail, then checks that unlock exits 1 with no up and that `--rollback` and `update v1.3.0` both exit 1.
- **F2:** after confirmation, `trap '' HUP` (the children inherit the ignore), and `log` becomes `printf … 2>/dev/null || true`.
  - INT/TERM before deploy.env is written: `interrupted_early` checks out the current tag again, then « Interrompu : le service n'a pas été modifié. ».
  - INT/TERM from just before `write_deploy_env` onward, and inside rollback: `interrupted` records rollback-failed, then « Interrompu : suivez P4. ».
  - The trap is cleared before every success finish and in `ko`.
  - Three tests: TERM during up; TERM during the local restic backup; HUP ignored.
- Group 1's own run: bats 29 tests (unlock 7, update 22), 0 failures, 1 skipped. Server 553 passed. lint, typecheck and shellcheck clean.

### Group 2: T43-F12, F11, F19, F13 (1 commit)
- **F12:** a failed `write_deploy_env "$NEW"` is now a step-5 failure. The script logs « deploy.env non écrit : retour arrière automatique. », runs `rollback "$prev" "$NEW" auto` and returns 1. rollback accepts a deploy.env that already names the target: `write_deploy_env "$1" || [ "$(current_version)" = "$1" ] || ko …`.
- **F19:**
  - `record_deploy` (deploy.log write failure → « Avertissement : deploy.log non écrit. ») is used for pull-failed, backup-failed, ok and in `finish`.
  - The privacy list's timestamp comes from `stamp=$(date …) || ko "Horodatage de la liste privacy impossible"`.
  - A failure to delete the list logs « Avertissement : liste <path> non supprimée (données personnelles) : supprimez-la à la main. » and the rollback continues.
- **F13:** unlock's `ko` prints `KO : <msg>` first, then the alive/fail ping (`|| true`), then exits 1.
- **F11 (tests only):**
  - The unlock "santé jamais 200" test records `sleep` through a copy of `stub.sh` and asserts the curl/sleep order with exactly 2 sleeps.
  - The update.bats "source common.sh" test asserts the defaults `120 2 sleep` under `env -u`.
- Scenarios added to existing tests (`reset_host`, `break_deploy_log`, `break_deploy_env_writes`): deploy.log unwritable (tests 12, 16, 17); deploy.env unwritable (test 18: image-only rollback, `rolled-back-image`); list that cannot be deleted (test 19); unlock KO before the ping.
- Group 2's own run: 24 tests, 0 failures, 1 skipped. RED was shown against the old scripts and against four F11 mutants of `common.sh`.

### Group 3: T43-F16, F15, F6, F3, F1 (1 commit)
- **F16:** `take_lock` returns 2 when `exec 9>` fails, which maps to « Impossible d'ouvrir <LOCK_FILE> : lancez avec sudo. », and 1 when the lock is busy (the existing message).
- **F15:** the work moves to `status_merge_locked`, which runs under its own lock (`8>$APPSPORT_ROOT/.ops-tmp/status.lock`, `flock -w 30 8`). It never uses fd 9 or LOCK_FILE.
- **F6:**
  - `in_ops_dir` refuses data/ops when it is a symlink or not a directory, and runs the command after `cd -P` with a `pwd -P` check.
  - `ensure_ops_dir` runs `in_ops_dir chmod 0750 .`, then `chown -h`.
  - The temp file and the lock live in the new root-only directory `$APPSPORT_ROOT/.ops-tmp`, and chmod and chown happen before the `mv -T`.
  - `read_status_json` refuses a symlinked status.json.
  - The privacy list is purged with `in_ops_dir rm -f`.
- **F3:** `JQ` is set with `: "${JQ:=jq}"`, and every jq call goes through `"$JQ"`. `require_cmds` dies with « Commande <x> absente de l'hôte. Rien n'a été changé. ». Update checks jq, flock, git, restic and curl before the lock. Unlock checks jq, curl and cryptsetup before cryptsetup.
- **F1:** each `wait_health` try gets a slice of 2 × HEALTH_POLL_S, filled with a sleep. The number of tries is unchanged, and a probe that fails at once now takes about 116 s in production instead of 58 s.
- New `infra/host/test/common.bats` (8 tests). In update.bats, the nominal test expects `chown 1000:1000 <root>/.ops-tmp/status.*` and the restore test expects `chown -h 1000:1000 <root>/data/ops`.
- Group 3's own run: 32 tests, 0 failures, 3 skipped (symlink tests on Windows).

### Group 4: T43-F4 (1 commit)
- **F4:** `load helpers` becomes `source "$BATS_TEST_DIRNAME/helpers.bash"` in unlock.bats and update.bats, and `test:infra` becomes `env LC_ALL=C.UTF-8 bats infra/host/test`. Before the fix, `pnpm test:infra` from Git Bash failed with "library load path is not an absolute path" and "Executed 2 instead of expected 24 tests". After it, the run passes.

### Conflicts resolved
1. **g2 on g1, `appsport-update` main, step 5.** g1 armed `RB_* =auto` and `trap interrupted INT TERM` before `write_deploy_env` and died if the write failed. g2 sent that failure to `rollback auto`.
   - Kept both: the `RB_*` assignment and the trap come first, then g2's `if ! write_deploy_env …; then log …; rollback …; return 1; fi`.
   - On success the trap is cleared (g1), then `record_deploy … ok` (g2).
   - g1's old « deploy.env non écrit. Le service n'a pas été modifié. » is gone, because that path now rolls back.
2. **g2 on g1, top of `rollback()`:** kept g1's `trap interrupted INT TERM` and g2's comment.
3. **g2 on g1, list purge after reapply.** g1 had `rm -f list marker || ko "Liste privacy ou marqueur … non supprimé"`, and g2 made a list deletion failure a warning. Resolution:
   - the list is deleted first, and a failure only warns, with g2's message;
   - then `rm -f "$REAPPLY_MARKER" || ko "Marqueur $REAPPLY_MARKER non supprimé"`.
   - A failure to delete the list no longer stops the rollback (F19), while a marker that stays still stops it, so it never blocks later runs silently (F5).
   - **New message for T45:** « Marqueur <root>/reapply-pending non supprimé : suivez P4. ». It replaces g1's « Liste privacy ou marqueur <root>/reapply-pending non supprimé : suivez P4. ».
4. **g2 on g1, update.bats restore test:** kept g1's `[ ! -e reapply-pending ]` and g2's scenario where the list cannot be deleted. That scenario also asserts the marker is gone.
5. **g3 on g1+g2, the same purge line.** g3 had `in_ops_dir rm -f "${list#ops/}" || log "Avertissement : liste … non supprimée."`. The result keeps g3's pinned-directory `in_ops_dir rm -f`, g2's fuller warning (which g2's test asserts), and the marker removal from item 3.

### Integration commit (breakage that no single branch could see)
`b3c2a45` (4 files, +7 −4). Each branch was green on its own; these three problems appear only once they are combined.
1. **shellcheck fails in the CI job (g3 F3 on the existing jq filters).** shellcheck exempts a literal `jq` from SC2016 but not `"$JQ"`. Both filters that use `$var` in single quotes now warn, and SC2016 makes `shellcheck -x` exit 1:
   - `deploy_json` in appsport-update;
   - `status_merge_locked` in common.sh.

   RED: `shellcheck -x infra/host/appsport-* infra/host/lib/common.sh infra/host/test/stub.sh infra/test/image-contract.sh` → `SC2016 (info): Expressions don't expand in single quotes` at appsport-update:67 and common.sh:206, exit 1. Fix: `# shellcheck disable=SC2016 # variables du filtre jq, pas du shell` on both lines. GREEN: silent, exit 0.
2. **g3's new common.bats still used `load helpers`.** g4's F4 moved unlock.bats and update.bats to `source "$BATS_TEST_DIRNAME/helpers.bash"`, because bats from Git Bash rejects the C:/ load path. common.bats was not part of g4's change, so it now uses `source` as well, and `pnpm test:infra` runs all three files from Git Bash.
3. **The unlock "santé jamais 200" test (g2 F11) contradicts g3's F1.** The test expected `sleep 2` between tries. F1 now fills each try up to a slice of 2 × HEALTH_POLL_S, so with POLL=2 the sleep is 4 s, or 3 s when a second ticks over during the probe. The pattern became `sleep [34]`; the order (curl, sleep, curl, sleep, curl) and the exactly-2-sleeps count stay.
   - It still fails on a missing pause, a pause after the last try, and the old fixed `sleep $HEALTH_POLL_S` (the F1 regression).
   - RED: the old test against the merged code, `bats -f "santé jamais"`, gives `not ok 1`, « appel attendu absent ou hors ordre : sleep 2 ». The recorded calls show `sleep 4` then `sleep 3`, the very case `[34]` covers. GREEN: ok 12 in the full run.

Checked and needing no change:
- g1's `log`, which tolerates a dead terminal, kept the same form through g3's common.sh changes.
- `REAPPLY_MARKER`, `reapply_pending` and `valid_version` sit next to g3's `require_cmds`, `take_lock`, `in_ops_dir` and `.ops-tmp`.
- The order in update main is parse_args, require_cmds, take_lock, volume, sentinel, reapply marker.
- unlock calls `require_cmds` first, and its reapply check happens after Docker, through g2's `ko`, which prints the KO before the ping.
- g2's `reset_host` and its mktemp wrapper (`*.deploy.env.*`) do not interfere with g3's `mktemp .ops-tmp/status.XXXXXX`.
- Scripts are still 100755, and every file under infra/host is i/lf w/lf.

### Not integrated
Group 4 stopped before verifying seven of its findings. T43-F26, F24, F23, F20, F17, F9 and F8 were written in its worktree (`defaults.bash`, `helpers.bash`, `update.bats`) but never committed: there is no RED evidence, and the GREEN run had not finished. They are not on `fix/T43-r1-g4`, so they are not integrated. The uncommitted diff (against 49feaa5, 253 lines) is saved as `T43-r1-g4-uncommitted.patch` in the integrator session's scratchpad (`C:\Users\eliott.colin\AppData\Local\Temp\claude\c--Users-eliott-colin-appsport\ca3308e0-0f9a-41f3-98a6-0e3d2ef19eb6\scratchpad\T43-r1-g4-uncommitted.patch`; a session temp directory). It is also stored in the repo's object store as blob `aa5deb3ed8d8f2fd94d5eff9a5f6b9a85a7cad7a`. Nothing references that blob, so `git gc` will prune it after about two weeks. Recover it with `git cat-file -p aa5deb3 > g4.patch`, then `git apply`. before the worktree was removed. It is a starting point for round 2, not verified work.
- Note for round 2: that diff was written before g1's F25 changes to `defaults.bash` and before g3's `.ops-tmp` and `status_merge` lock. Its nominal-test chown rule on `.status.*` and its `default_flock` that requires fd 9 must be rebased onto `.ops-tmp/status.*` and `flock -w 30 8` (fd 8).

### Final checks (HEAD b3c2a45)
- `pnpm test:infra` (Git Bash, jq in `~/.local/bin`, run after the integration commit): `1..37`, 37 ok, 0 `not ok`, 3 skipped (the three symlink tests, Windows only), exit 0. That is common.bats 8, unlock.bats 7 and update.bats 22. **Expected in the CI infra job: 37 tests, 0 failures.**
- `shellcheck -x` (0.10.0) on the CI file list plus helpers.bash and defaults.bash: silent, exit 0.
- `pnpm lint`: `Checked 439 files in 445ms. No fixes applied.`
- `pnpm typecheck`: exit 0.
- `pnpm --filter @appsport/server test`: `Test Files 71 passed (71)`, `Tests 553 passed | 2 skipped (555)`, exit 0.
- `pnpm test` (the full vitest suite) was **not** pristine on this machine during this session. Four runs each failed 1 or 2 timing tests, and a different set each time:
  - run 1: `release.test.ts` « garde CI » (timed out at 5000 ms) and `profile-page.test.tsx` « Annuler »;
  - run 2: `release.test.ts` « garde CI »;
  - run 3 (`--maxWorkers=4`): `profile-page.test.tsx` « dialogue ouvert »;
  - run 4: `release.test.ts` « garde CI » and `precache-plugin.test.ts`.

  Each run otherwise gave 1889 or 1890 passed and 2 skipped out of 1893. All three files pass together on their own: `pnpm exec vitest run apps/server/test/infra/release.test.ts apps/web/test/pwa/precache-plugin.test.ts apps/web/test/profile/profile-page.test.tsx` gives `Test Files 3 passed (3)`, `Tests 57 passed (57)`.

  This round changes nothing those tests read: `git diff --name-only 4919285 HEAD` outside `infra/host/` lists only `apps/server/test/ops/active-sessions.test.ts` and `package.json` (the `test:infra` script). They timed out because the machine was loaded: the other lanes had about 30 `bash.exe` processes running. «garde CI» spawns Git Bash five times within a 5 s budget. I am noting this as a concern, not treating it as integration breakage.
- `git status`: clean. `git show --stat HEAD`: `b3c2a45`, 4 files, +7 −4 (appsport-update, lib/common.sh, test/common.bats, test/unlock.bats), which matches the integration commit described above.
- The four fix worktrees were removed with `git worktree remove --force`, and the branches `fix/T43-r1-g1..g4` were deleted (they were at 55b9341, 53d9abe, ff022e4, 49feaa5). `git worktree list` now shows appsport, appsport-infra, appsport-ops and appsport-pwa.

### Notes for T45 (docs), merged from the groups
- New or changed messages:
  - « Réapplication des suppressions en attente : suivez P4. » and its KO form in unlock;
  - « Marqueur <root>/reapply-pending non écrit : suivez P4. » and « Marqueur <root>/reapply-pending non supprimé : suivez P4. »;
  - « Avertissement : liste <path> non supprimée (données personnelles) : supprimez-la à la main. »;
  - « Dernier déploiement réussi illisible dans <root>/deploy.log. Rien n'a été changé. »;
  - « Interrompu : suivez P4. » and « Interrompu : le service n'a pas été modifié. »;
  - « deploy.env non écrit : retour arrière automatique. »;
  - « Avertissement : deploy.log non écrit. »;
  - « Impossible d'ouvrir <LOCK_FILE> : lancez avec sudo. »;
  - « Commande <x> absente de l'hôte. Rien n'a été changé. »;
  - « Horodatage de la liste privacy impossible : suivez P4. ».
- P4 must say: reapply the list named in `<root>/reapply-pending`, then `rm <root>/reapply-pending` before restarting app. It should still recommend running appsport-update inside tmux or `systemd-run --scope`.
- 08 §3 and T45 P1: add jq to the host packages and the root-only `<root>/.ops-tmp` (temporary files and the status.json lock, not backed up).
- T44: `status_merge` now takes the status lock (fd 8). Its tests must not use a catch-all `on flock '*' 1` when they expect `status_merge` to succeed, and callers of `take_lock` must handle return code 2.
- Residual risk (g3): the container could swap status.json for a FIFO between the `-f` check and the open, which would block the update. This needs code execution in the container.

## Fix round 2 (T43-F8, F9, F17, F20, F23, F24, F26), branch socle-ops, base b3c2a45

All seven findings are about tests, so only `infra/host/test/{defaults.bash, helpers.bash, update.bats}` changed. No script was touched (`git diff --name-only b3c2a45 HEAD` lists only those three files). I used the saved g4 diff as a starting point and rebased it onto HEAD:
- the chown rule now targets `.ops-tmp/status.*`;
- the flock stub knows fd 8 (status lock) as well as fd 9;
- `reset_host` is the one in update.bats (the g4 copy in helpers.bash was dropped);
- F20 extends the existing F5 reapply-failure test instead of duplicating it;
- the g4 `set_healthy_versions none` scenario was wrong on HEAD: the precondition health check would have refused before any rollback. It now starts healthy and the restore stub turns every version unhealthy.

**RED method.** The implementation is already correct, so RED means a mutant of the implementation that each finding names. A scratch script applies it with sed, runs `LC_ALL=C.UTF-8 pnpm exec bats -f <test>`, and restores the file with `git checkout`. "Gap" means the HEAD tests still pass against the mutant, which shows the finding is real. RED means the new test fails. GREEN means the new test passes on the real code.

### Commits (each ends with Refs #44 and the trailer)
- `1b3967e` test(ops): le stub flock exige le descripteur ouvert sur le fichier verrou (F26)
- `7c9dab9` test(ops): le Non par défaut de [o/N] est vérifié (Entrée et « y » abandonnent) (F24)
- `08963da` test(ops): instantané pre-deploy et dépôt restic local en échec couverts (F9)
- `343952b` test(ops): échecs du retour arrière après l'image seule et service laissé arrêté (F8, F20)
- `9aea873` test(ops): réapplication avant tout redémarrage et modes de data/ops et status.json (F23, F17)

### F26: flock stub checks the fd
**Change.** `defaults.bash` gains `fd_open_on <fd> <file>`: the fd must be writable, and where `/proc/$$/fd` exists (Linux and MSYS), `[ /proc/$$/fd/N -ef <file> ]` must hold. `default_flock` maps fd 9 to `$LOCK_FILE` (take_lock) and fd 8 to `.ops-tmp/status.lock` (status_merge), refuses any other fd, and otherwise fails like the real flock with "Bad file descriptor". The nominal test adds a chown rule on `.ops-tmp/status.*` that records whether fd 9 is still open on LOCK_FILE at the last status.json write, then asserts it.

**Why `-ef` instead of comparing readlink strings.** My first version compared strings and failed on the real code under MSYS: `/proc` gives `/c/Users/…/Temp/bats-run-…/appsport.lock` while `readlink -f` gives `/tmp/bats-run-…/appsport.lock` (the `/tmp` mount). The earlier "RED" runs of that version were therefore invalid, and I redid them all after switching to device and inode.

**Gap.** Mutant A (take_lock without `exec 9>"$LOCK_FILE"`) gives `ok 1 nominal` with the HEAD harness.

**RED, after the fix:**
- A: `not ok`, `[ "$status" -eq 0 ]` (flock: 9: Bad file descriptor).
- D (`exec 9>"$LOCK_FILE.other"`): `not ok`, same line.
- B (status_merge without `8>…status.lock`): common.bats « verrou propre » `not ok`.
- C (`exec 9>&-` right after the preconditions): `not ok`, `[ -f "$STATE/lock-held" ]` failed.

**GREEN.** nominal, verrou occupé, and all 4 status_merge tests in common.bats are ok. A full run of common.bats plus unlock.bats gives 15 ok (2 skipped).

### F24: default No of [o/N]
**Change.** The abort test loops over « n », an empty answer and « y », running `reset_host` each time. Each time it expects « Abandon : rien n'a été changé. », code 1 and `assert_nothing_changed`.

**Evidence.**
- Mutant: confirm aborts only on n/N/non and accepts anything else.
- Gap: the HEAD test is ok.
- RED: `not ok`, the « Abandon » assertion fails. With the empty answer the mutant deploys, then rolls back.
- GREEN: ok.

### F9: failed snapshot and failure of the local repository only
**Change.** New helper `assert_backup_failed`: status 1, the message, checkout v1.3.0 then v1.2.0, no up, deploy.env still v1.2.0, `backup-failed`. The test gains two scenarios:
- `on docker '* snapshot --tag pre-v1.3.0' 1`: no restic call at all;
- `on restic "-r $BACKUP_ROOT/restic backup *" 1`: order local, offsite, checkout v1.2.0.

**Evidence.**
- M1 (snapshot failure ignored): gap ok, RED `not ok` at the snapshot scenario.
- M2 (`failed=0` at each repository, so only the last status counts): gap ok, RED `not ok` at the local scenario.
- M3 (`return 1` at the first failure, offsite skipped): RED `not ok`, offsite missing from the calls.
- GREEN: ok.

### F8 and F20: rollback failures after the image-only step, service kept stopped
**Change.** New helper `assert_auto_rollback_failed <msg>`: status 1, « <msg> : suivez P4. », `v1.2.0 v1.3.0 rollback-failed`, and `.deploy == {v1.3.0, v1.2.0, ok false}`.
- The restore-failure test and the F5 reapply-failure test now use it, and both assert exactly 2 `up -d` (F20).
- New test « collecte, arrêt de app impossibles ou v1.2.0 KO après restauration »:
  - (c) collect fails: no stop, no restore, no marker, 2 up -d;
  - stop app fails: no restore, no reapply, no marker;
  - (b) v1.2.0 still KO after restore and reapply (healthy at the start; the restore stub turns every version unhealthy): « L'image v1.2.0 ne répond pas après restauration », order restore, reapply, up -d, curl, 3 up -d, no « Base restaurée ».
- (a) The checkout-failure test adds a manual `--rollback` scenario: line `v1.3.0 v1.2.0 rollback-failed`, `.deploy == {v1.2.0, v1.3.0, ok false}`.

**Gap on the HEAD tests.** Ma, Mc, Md and Mf pass all 5 related tests. Ma2 and Mb were already caught: Ma2 by the manual success test, Mb by the schema test.

**RED:**
- Ma (manual `ok` always true): checkout test `not ok` on the `.deploy` jq.
- Ma2 (manual line order swapped): `not ok` on the last-line regex.
- Mb (`compose up -d` without wait_health after restore): new test `not ok` at the « ne répond pas après restauration » assertion.
- Mc (`|| ko` lost after privacy:collect): `not ok` at « privacy:collect impossible ».
- Md (`|| ko` lost after stop app): `not ok` at « Arrêt de app impossible ».
- Mf (`compose up -d` before the ko of a failed restore or reapply): both tests `not ok` at `count_calls … -eq 2`.

**GREEN.** All 4 tests ok.

### F23: reapply before any restart
**Change.** New helper `refute_call_between <start> <end> <pattern>` in helpers.bash. It also fails when the start or end call is missing. The schema test refutes any `up`, `start` or `restart` between `stop app` and `privacy:reapply`, and asserts 3 `up -d`.

**Evidence.**
- Mutant: `compose start app` inserted after `compose stop app`.
- Gap: the HEAD test (a temporary untracked copy, then removed) is ok.
- RED: `not ok`, « appel inattendu entre « docker compose * stop app » et « * privacy:reapply * » : … start app ». With `compose up -d` inserted instead, RED is the same with « … up -d ».
- GREEN: ok.

### F17: modes of data/ops and status.json
**Change.** New helper `assert_ops_modes` checks `stat -c %a`: data/ops is 750 and status.json is 640. It is called after the nominal test and after the restore test. Under msys or cygwin it returns 0.

**Not RED locally.** Git Bash mounts with `noacl`: `chmod 0750` on a scratch directory and `chmod 0640` on a file still read 755 and 644 (`mount`: `… on /tmp type ntfs (binary,noacl,…)`), and WSL is not installed. The assertion can only fail in the Linux CI job. There, `setup_host` creates data/ops with mkdir (0755 under the default umask) and status.json at 0644, so dropping `chmod 0750` in `ensure_ops_dir` or `chmod 0640` in `status_merge_locked` would turn the job red. It is GREEN locally because the check is skipped.

### Final checks (HEAD 9aea873)
- `pnpm test:infra` (Git Bash): `1..38`, 38 ok, 0 `not ok`, 3 skipped (symlink tests, Windows only), exit 0. That is common.bats 8, unlock.bats 7 and update.bats 23; the only new test is the collect / stop / KO-after-restore one. **Expected in the CI infra job: 38 tests, 0 failures.**
- shellcheck 0.10.0 (the release binary from the round-1 session scratchpad), `-x` on the CI list plus helpers.bash and defaults.bash: silent, rc 0.
- `pnpm --filter @appsport/server test ops/active-sessions`: `Tests 3 passed (3)`.
- `pnpm lint`: `Checked 439 files … No fixes applied.`, exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm test`:
  - first run: exit 1, a single failure, `profile-page.test.tsx` « dialogue ouvert : une relecture du compte ne reprend pas le focus ». This is the same timing flake round 1 recorded under load, and nothing in this round touches it.
  - the file on its own: `Tests 33 passed (33)`.
  - second full run: `Test Files 159 passed (159)`, `Tests 1891 passed | 2 skipped (1893)`, exit 0.
- `git status`: clean. `git show --stat HEAD`: 9aea873, helpers.bash +29 and update.bats +8, which matches F23 and F17. Modes are unchanged (the scripts and stub.sh are 100755), and every file under infra/host/test is i/lf w/lf.
- Review package: `.superpowers/sdd/2026-10-06-socle/review-b3c2a45..9aea873.diff` in the socle-ops worktree (5 commits).

### Notes
- T44: `default_flock` now refuses an fd other than 8 or 9, and one not open on its file. A new lock on another fd needs a case in `default_flock`. `fd_open_on` is available to snippets after `. "$STUB_DEFAULTS"`.
- No message or behaviour changed, so there is nothing new for T45.
