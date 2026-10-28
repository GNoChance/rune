# Task 14 report — Décisions de confidentialité et déploiements ratés (#62)

Status: DONE_WITH_CONCERNS
Worktree: `C:\Users\eliott.colin\rune-revue`, branch `socle-revue`
Commit: `c87ef0e` fix(ops): enveloppe de secours dite, sauvegardes effacées à l'arrêt, admin réactivé et déploiements ratés visibles (base 245c1ef, 1 commit, Closes #62)
Review package: `C:\Users\eliott.colin\rune-revue\.superpowers\sdd\2026-10-13-refonte-rune\review-245c1ef..c87ef0e.diff`

## What was implemented

1. **T45-F32: sealed rescue envelope stated.**
   - `docs/fiche-de-traitement.md`, section Responsable. The owner's wording is used: « seul détenteur des clés au quotidien ; une copie scellée (enveloppe de secours, R-OPS-14) est confiée à une personne de confiance majeure, ouverte seulement en cas d'indisponibilité longue, pour permettre l'export (P9) ».
   - Destinataires: new line for the trusted adult. They have no day-to-day access, and the sealed copy (LUKS phrase, restic password, B2 key) is opened only for export, then for deleting the backups and stopping the service (P9).
   - Sauvegardes row: « effacées à l'arrêt du service, après le dernier export de chaque proche (P9) ». The duration is unchanged, so the cross-check against the spec and the Privacy page still matches.
   - Header date set to 2026-10-13. A sentence says the version stays 1.0 because nobody has accepted the policy yet.
   - `apps/web/src/features/public/privacy-content.ts`, section « Où sont les données »:
     - the existing line becomes « … ; au quotidien, seul ${owner} en détient les clés. »;
     - new line: « Une copie scellée de ces clés (l'enveloppe de secours) est confiée à une personne de confiance majeure. Elle n'est ouverte que si ${owner} est indisponible longtemps : tu peux alors exporter tes données, puis les sauvegardes sont effacées et le service arrêté. »
   - Wording rules: tutoiement, straight apostrophes, no « appsport ». The app name does not appear in the new text (ruling P1).
2. **T45-F42: P9 deletes the backups after the last export.** `docs/exploitation/P9-admin-indisponible.md` now has 9 steps.
   - Steps 1 to 4 are unchanged. Step 4 asks for each relative's export to be confirmed and dated.
   - 5: stop `rune-backup.timer` and `rune-restore-test.timer`, only after the announced date and once every export is confirmed or the relative's answer is noted.
   - 6: delete the B2 offsite backups with `restic … --no-cache forget --host rune --unsafe-allow-remove-all --prune` (b2.env in a `sudo bash -c` subshell, the same pattern as P1), then check with `snapshots`.
   - 7: `findmnt /srv/backup`, then `sudo rm -rf /srv/backup/restic /srv/rune/data/snapshots /srv/rune/cache/restic`. That covers the local restic repository, the database snapshots (replaced databases live in `snapshots/replaced-*`) and the restic cache. Then a check.
   - 8: poweroff.
   - 9: keep the envelope, with the deletion date noted on it.
   - When no export was possible (LUKS phrase missing, or unlock failed), nothing is deleted. The backups are then the only way to rebuild the service so relatives can export.
   - **P1, beyond the brief.** `docs/exploitation/P1-installation.md`, bucket step: set the bucket's « Lifecycle Settings » to « Keep only the last version of the file ». See Concerns 1.
3. **T45-F51: `admin:reset` reactivates a disabled admin.**
   - New `apps/server/src/auth/admin-reset.ts`, function `adminReset(deps, username)`. In one transaction it:
     - looks the user up by `usernameKey`;
     - if the user is an admin and `disabled`: sets `status = 'active'` with a new `writeStamp` (actor null) and logs `status_changed {status: 'active'}` with actor null;
     - then calls `createPasswordReset` as before.
   - A disabled member is never reactivated: the link is still printed and still refused when used (`account_disabled`), as today. An unknown or deleted username still gets « Pseudo inconnu ».
   - `apps/server/src/cli.ts`: `runAdminReset` calls `adminReset`. On reactivation it first prints « Compte administrateur <pseudo> réactivé. ». The usage text adds « ; réactive un administrateur désactivé ». `cli.ts` is outside `apps/server/src/auth/`, but the command is defined there.
   - P4 « Sur place », step 8 « Un administrateur existe déjà » case: now gives the `run --rm --no-deps … admin:reset <pseudo>` command and its expected output. The old « aucune commande du socle ne le réactive… ouvrir une issue » text is removed.
   - P8 « Mot de passe admin oublié »: one sentence on the reactivation line.
4. **T43-F14: failed deploys visible on the health page.** In `infra/host/rune-update`:
   - new `not_deployed <en place> <résultat>`: `checkout_back`, then `record_deploy`, then `record_status "$(deploy_json "$1" "$1" false)"`;
   - this writes `.deploy = {at, version: <en place>, previousVersion: <en place>, ok: false}` through the existing `status_merge`;
   - used by `pull-failed` and `backup-failed`.
   - New `record_status` helper (status_merge, or the existing warning « Avertissement : status.json non mis à jour. »). It also replaces the three earlier copies of that two-line pattern (success, auto and manual rollback), with no change in behaviour.
   - shellcheck is clean.

## Tests

- `apps/server/test/auth/password-reset.test.ts`: new CLI test using `init`, then `createUser` on the file database.
  - `admin:reset leo` on a disabled admin: 4 lines, starting with « Compte administrateur leo réactivé. ».
  - Status is `active` with `updatedBy` null, and exactly one `status_changed` event (actor null, details `{"status":"active"}`).
  - The printed code really works: `consumePasswordReset` succeeds, then login.
  - Active admin: 3 lines, as before.
  - Disabled member `mia`: 3 lines, stays `disabled`, `consumePasswordReset` is rejected with `account_disabled`, and no new `status_changed` event.
- `apps/server/test/infra/docs.test.ts`: new describe « décisions de confidentialité du 2026-10-12 (refonte Rune, §11.1) », 6 tests:
  - fiche Responsable and Destinataires, including « copie scellée »;
  - `privacy-content.ts` says « copie scellée », « personne de confiance majeure » and « au quotidien »;
  - P9: steps in this order: export confirmed, timers, B2, local, poweroff. The B2 commands use the b2.env subshell with `--no-cache`, then `forget --host rune --unsafe-allow-remove-all --prune`, then `snapshots`. The step cites « Keep only the last version of the file ». `rm -rf` covers all three paths;
  - P9: when unlock fails, nothing is deleted;
  - P1: lifecycle setting in the instruction and in the expected result;
  - P4 and P8: reactivation command and output, old wording gone.
- `apps/web/test/app/public-pages.test.tsx`: the owner-less variant says « si le porteur du projet est indisponible longtemps ». The named variant has the full envelope sentence. `/privacy` contains « copie scellée ».
- `infra/host/test/update.bats`:
  - new helper `assert_failed_deploy_status`: `.deploy` is v1.2.0/v1.2.0/ok false/at ends with Z, and `.backup` is kept;
  - used for pull-failed, pull-failed with deploy.log unwritable, and all three backup-failed cases (snapshot, local, offsite);
  - new case with status.json unwritable (status lock held): warning shown, failure message still shown, deploy.log line written, `.deploy` absent.

## TDD evidence

**RED, server** (`pnpm --filter @rune/server test infra/docs test/auth/password-reset`, before any implementation): 7 failed | 123 passed.
```
× fiche : clés détenues au quotidien par le porteur, copie scellée chez une personne de confiance (T45-F32)
× page Confidentialité : la copie scellée est dite, comme dans la fiche (T45-F32)
× P9 : export de chaque proche confirmé, timers arrêtés, sauvegardes B2 et locales effacées, puis l'arrêt (T45-F42)
× P9 : sans export possible, rien n'est effacé (les sauvegardes permettront de reconstruire)
× P1 : bucket B2 en « Keep only the last version of the file », sinon restic ne fait que cacher (30 jours au plus)
× P4 et P8 : admin:reset réactive un admin désactivé et donne son lien (T45-F51)
× réactive un administrateur désactivé, dont le lien sert ; un membre désactivé le reste (T45-F51)
AssertionError: expected [ …(3) ] to have a length of 4 but got 3
AssertionError: seul détenteur des clés au quotidien: expected '\nLe porteur du projet, personne phys…' to contain 'seul détenteur des clés au quotidien'
Error: aucune étape avec la commande sudo systemctl stop rune-backup.timer rune-restore-test.timer
```
In the first RED run, the P9 test failed for a bad reason: step bodies exclude the step's title line. I fixed the test (it now locates the export step by its « Résultat attendu ») and re-ran RED before implementing. The output above is from that second RED run.

**RED, web** (`pnpm --filter @rune/web test test/app/public-pages`): 5 failed | 5 passed.
```
× sans prénom (undefined|""|"   ") : … → expected 'Rune est un outil de suivi entre proc…' to contain 'si le porteur du projet est indisponi…'
× enveloppe de secours : copie scellée des clés … → expected … to contain 'au quotidien, seul Bastien en détient…'
× /privacy reprend la fiche de traitement → copie scellée: expected 'RuneConfidentialité et règlesVersion …' to contain 'copie scellée'
```

**RED, bats** (`env LC_ALL=C.UTF-8 bats infra/host/test/update.bats`, before touching `rune-update`):
```
not ok 9 pull en échec : retour au tag précédent, ni instantané ni up, pull-failed
# (from function `assert_failed_deploy_status' in file infra/host/test/update.bats, line 24, … line 201)
not ok 10 sauvegarde pre-deploy en échec (instantané, dépôt local ou offsite) : pas de up, backup-failed, deploy.env inchangé
# (from function `assert_failed_deploy_status' … from function `assert_backup_failed' …)
```
Tests 1 to 8 and 11 to 13 passed. I stopped the run after test 13, before editing `rune-update` (bash reads scripts as it runs), and killed only my own orphaned bats processes.

**GREEN**
- `pnpm --filter @rune/server test infra/docs test/auth/password-reset`: 2 files, 130 passed. Two of my test assertions needed fixing on the way:
  - an unanchored regex;
  - a `RegExp` template literal that had lost its backslash.

  Also, in P9 step 6 the lifecycle explanation moved off the step's title line.
- `pnpm --filter @rune/web test test/app/public-pages`: 10 passed.
- `pnpm test:infra` (Git Bash, all 79 bats tests): all `ok`, exit 0. Tests 65 and 66 are the pull-failed and backup-failed cases.
- `pnpm lint`: exit 0 (450 files).
- `pnpm typecheck`: exit 0.
- `pnpm test`: 163 files, 2042 passed, 2 skipped, exit 0, no stderr or warnings.
  - A first full run, made while my bats suite and another lane's E2E were running, had 3 timeouts at 5 s in `test/build/bundle.test.ts` and `test/infra/release.test.ts`.
  - Both files pass alone, and the full suite passed once bats had finished.
- shellcheck: not installed on this PC. I downloaded the official v0.10.0 Windows binary into the scratchpad (outside the repo) and ran the CI command `shellcheck -x infra/host/rune-* infra/host/lib/common.sh infra/host/test/stub.sh infra/test/image-contract.sh`: exit 0, no output. A deliberately bad script (SC2086) was flagged, so the binary works.
- E2E: the brief names none. No E2E spec uses the changed texts (grep of `apps/web/e2e`).

## Files changed (13)
`apps/server/src/auth/admin-reset.ts` (new), `apps/server/src/cli.ts`, `apps/server/test/auth/password-reset.test.ts`, `apps/server/test/infra/docs.test.ts`, `apps/web/src/features/public/privacy-content.ts`, `apps/web/test/app/public-pages.test.tsx`, `docs/exploitation/P1-installation.md`, `docs/exploitation/P4-restaurer.md`, `docs/exploitation/P8-incident.md`, `docs/exploitation/P9-admin-indisponible.md`, `docs/fiche-de-traitement.md`, `infra/host/rune-update`, `infra/host/test/update.bats`.
`git show --stat HEAD` lists exactly these files, and `git status` is clean.

## Self-review
- Every point of the brief and of the controller rulings T45-F32, F42, F51 and T43-F14 is covered and tested.
- No « appsport », no curly apostrophes, `git diff --check` is clean, LF endings, and `rune-update` keeps mode 100755.
- No secrets, codes or `#` links in this report or the commit message.
- Shell edits were made with the file tools only. No procedure command was run on this PC.
- Only `docs/fiche-de-traitement.md` and `docs/exploitation/*` were touched under `docs/` (the exception granted to this task). `docs/superpowers`, `docs/research` and `docs/adr` are untouched.
- `cli.ts` was touched although it is outside `apps/server/src/auth/`: that is where the `admin:reset` command lives.
- The `record_status` helper also replaces three identical existing two-line blocks in the same file. This is a mechanical cleanup covered by the existing bats assertions (success, auto rollback, manual rollback).

## Concerns
1. **B2 retention gap, before this task, now fixed in P1 for new installs** (decision needed only if you disagree):
   - restic's S3 backend only *hides* the files it deletes on B2. B2 buckets keep all versions by default. Sources: restic docs, « Preparing a new repository › Backblaze B2 »; Backblaze docs, « Lifecycle Rules ».
   - So without the lifecycle setting, both the nightly `forget --keep-daily 30 --prune` and the P9 deletion would leave every backup readable, as hidden versions, indefinitely. That breaks « Sauvegardes : 30 jours au plus ».
   - I added the setting to P1 (allowed under `docs/exploitation/*`). Nothing is installed yet, so no migration is needed.
2. **T43-F14 value choice.** I followed the ruling literally (« ok false and the version still running ») and the spec (« avec ok: false et la même version »): `.deploy = {version: <en place>, previousVersion: <en place>, ok: false}`.
   - The health page will read « Dernier déploiement : v1.2.0 le … (échoué) » above « Version en service : v1.2.0 ». The requested version is only in `deploy.log`.
   - The original finding instead proposed `deploy_json "$NEW" "$prev" false`: version = requested, as the automatic rollback already writes it.
   - If that was the intent, it is a one-line change in `not_deployed` plus the bats helper.
3. **`restic forget --unsafe-allow-remove-all`** requires restic 0.17 or later and a snapshot filter (`--host rune`, the hostname P1 sets). This is per the restic docs; Debian 13 ships 0.18. It was not run against a real repository (no restic on this PC).
4. **`PRIVACY_POLICY_VERSION` stays 1.0** although the page gains a substantive sentence. The reasoning is the one spec §3 uses for the consent text: the app is not in service and nobody has accepted a version yet. The fiche states it. Merge note (ruling P1): the phase 2 integrator must keep both lanes' changes to `privacy-content.ts` and `public-pages.test.tsx`.
5. **For the T15 sweep, not changed here:** `forget --keep-daily 30` keeps the last 30 *days that have a snapshot*. If backups fail for a while, older snapshots outlive 30 calendar days. `--keep-within 30d` would match the promise more exactly.

## Fix report — round 1, integration (groups 1 to 3)

Integrated into `socle-revue` (C:\Users\eliott.colin\rune-revue) from base c87ef0e, with `git cherry-pick c87ef0e..<branch>` for each branch in order. History is linear, with no merge commit. No separate integration commit was needed: the conflicts were resolved inside the cherry-picked commits (details below).

| Group | Branch (head) | Commits on socle-revue | Findings |
|---|---|---|---|
| 1 | fix/T14-r1-g1 (121698a) | f1b9413 | T14-F1, T14-F11, T14-F7, T14-F8 |
| 2 | fix/T14-r1-g2 (23a791a) | 442cbc1, 67d3f01 (conflicts resolved), 0eb8789 | T14-F13, T14-F3, T14-F14 |
| 3 | fix/T14-r1-g3 (0f040b6) | 2b08f85 (conflicts resolved) | T14-F15, T14-F12, T14-F9 |

### Group 1 (from its notes)
- **T14-F1 (Important).** P9 step 5 now runs four commands in order:
  1. `findmnt /srv/rune`
  2. `sudo systemctl disable --now rune-backup.timer rune-restore-test.timer`
  3. `sudo systemctl stop rune-backup.service rune-restore-test.service`
  4. `systemctl is-active …`

  The expected result is two lines, each `inactive` or `failed`. On `active`, `activating` or `deactivating`: wait 2 minutes, then run the last two commands again.

  Step 6 runs `sudo rm /srv/rune/secrets/b2.env` only once `snapshots` shows nothing. Step 9 has the returning admin rewrite `b2.env`, recreate the local repository and re-enable the timers (P1).
- **T14-F11 (Minor).** Step 6 « Sinon » now covers two more cases:
  - a locked volume (`b2.env: No such file or directory`, `Please specify repository location`);
  - a stale lock (restic `unlock`, which replaces « attendre 10 minutes »).

  Step 7 chains each deletion to its mount (`findmnt … && sudo rm -rf …`), also removes `/srv/rune/tmp/restore-test-*`, and ends with a positive check (`lost+found` and `rune.db` listed).
- **T14-F7 (Minor).** The fiche puts the Unix account in the envelope contents. The Backblaze transfer line now reads « copie scellée chez la personne de confiance, voir Destinataires ».
- **T14-F8 (Minor).** The fiche header is dated with no version exception: « Version 1.0 (`PRIVACY_POLICY_VERSION`), complétée le 2026-10-13, avant toute mise en service. » `PRIVACY_POLICY_VERSION` is unchanged.
- **Tests from the group.**
  - RED: `vitest run test/infra/docs.test.ts -t "décisions de confidentialité"` gave 5 failed, each for the intended reason.
  - GREEN: docs.test 122/122, server 707 passed and 2 skipped, lint and typecheck exit 0.
  - A mutation check on the step-9 assertion failed as expected.

### Group 2 (from its notes)
- **T14-F13.** `password-reset.test.ts` now checks that `admin:reset` stamps the row: rev goes up, updatedAt changes, updatedBy is null. It also checks the full `status_changed` event: outcome `success`, tailnetIp null, details.
  - RED by mutation: removing `...stamp` gave « expected 1 to be greater than 1 »; outcome failure with an IP set was caught too.
  - GREEN: 12 passed. No src change.
- **T14-F3.** The privacy page now says « Une copie scellée des clés du serveur et des sauvegardes (l'enveloppe de secours) … cette personne remet alors le serveur en marche, sans consulter tes données, … ».
  - The fiche « Personne de confiance » line names the Unix account with sudo, the same technical access as the admin, and the P-ADM-3 commitment.
  - RED: server 2 failed, web 2 failed. GREEN: docs 119 passed, public-pages 10 passed.
- **T14-F14.** `update.bats`: the scenario « deploy.log non inscriptible » now also calls `assert_failed_deploy_status`.
  - RED by temporary mutation of `rune-update`: « not ok 1 … assert_failed_deploy_status ». The script was restored byte-identical, mode 100755.
  - GREEN: test:infra 79/79.

### Group 3 (from its notes)
- **T14-F15.** New test: the fiche's « Sauvegardes » retention row must contain « effacées à l'arrêt du service, après le dernier export de chaque proche (P9) ».
- **T14-F12.** The step-5 regex is replaced by the exact clause « seulement après la date annoncée, une fois l'export de chaque proche confirmé ou sa réponse notée (étape N) », where N is the export step.
- **T14-F9.** Three changes:
  - the « **Absence longue ou définitive** » intro line is checked for the 30-day promise and for deletion only after the last export;
  - step 4 must contain « noter chaque confirmation et sa date »;
  - the source test on `privacy-content.ts`, which its JSDoc alone satisfied, is removed. The rendered page is checked in `public-pages.test.tsx`.
- **Tests from the group.**
  - The old tests stayed green on mutated docs, which shows they were vacuous. With the new tests: 2 failed, 116 passed.
  - F12 was checked on strings with a scratchpad script, since a weakening mutant of P9 was denied.
  - GREEN: 118 passed, server 703 passed and 2 skipped, lint and typecheck exit 0.

### Conflicts resolved
1. **`docs/fiche-de-traitement.md`, Destinataires line « Personne de confiance » (G1 T14-F7 against G2 T14-F3).**
   - I kept G2's line. It is the longer one and already lists the Unix account, which is what G1's merge note asks for: a single list with the Unix password in it.
   - G1's T14-F7 test still expected the old comma list. I changed its regex to the merged wording: `(phrase du volume chiffré ; nom et mot de passe du compte Unix du serveur, qui a les droits sudo ; mot de passe des sauvegardes ; clé B2)`.
   - G1's Backblaze transfer check is unchanged, and so is the header. Both merged without conflict.
   - This edit is in commit 67d3f01.
2. **`docs.test.ts`, the tests after T45-F32.** G1's two new tests (F7, F8) and G2's new F3 test were all kept, in that order.
3. **`docs.test.ts`, test « page Confidentialité : la copie scellée est dite » (G2 against G3).**
   - G2 added three assertions on the page source: the new sentence, « sans consulter tes données », and not « copie scellée de ces clés ». G3 removed the test (T14-F9 c).
   - I kept the removal and G3's comment. G2's same three checks run on the rendered page in `apps/web/test/app/public-pages.test.tsx` (lines 28, 30, 69 and 70; 10/10 passing), so T14-F3 stays covered and T14-F9 holds.
   - This edit is in commit 2b08f85.
4. **`docs.test.ts`, P9 test T45-F42 (G1 against G3).**
   - I kept G3's step-4 assertion (`noter chaque confirmation et sa date`) and G1's new step-5 anchor (`sudo systemctl disable --now rune-backup.timer rune-restore-test.timer`).
   - G3's exact step-5 clause (T14-F12) holds against G1's rewritten step 5: G1 kept that sentence word for word and only added text after it.
   - G1's `findmnt … && sudo rm -rf` loop and G3's intro assertions merged without conflict.
   - G3's integration note asked to update strings if T14-F2 rewrote step 5. T14-F2 is not in this round, so nothing needed updating.
- Test count check: docs.test.ts has 123 tests. That is 118 at base, +4 from G1, +1 from G2, -1 and +1 from G3. All 123 pass.

### Final command outputs (integrated HEAD 2b08f85)
- `pnpm lint`: « Checked 450 files … No fixes applied. », exit 0.
- `pnpm typecheck`: exit 0, no output from tsc.
- `pnpm test`, three runs:
  - Run 1, exit 1: 2 timeouts at 5000 ms in `test/build/bundle.test.ts` (« node build.mjs produit un seul server.mjs ») and `test/infra/release.test.ts` (« garde du tag »). Neither file is touched by this round. Re-run alone: 2 files, 12 passed.
  - Run 2, exit 1: 1 failure in `apps/web/test/places/places-page.test.tsx` (« maison : cocher → PUT … », a timing assertion). That file is not touched by this round. Run alone 3 times with `pnpm --filter @rune/web test test/places/places-page`: 30 passed each time.
  - Run 3, exit 0: « Test Files 163 passed (163) », « Tests 2047 passed | 2 skipped (2049) ». No stderr and no warning (grep count 0).
  - These failures belong to the flaky-test sweep planned for step 4 of the redesign.
- `pnpm test:infra` (bats, Git Bash): 79 tests ok, exit 0.
- Not run:
  - shellcheck: not installed, and no shell script changed. `rune-update` is byte-identical to c87ef0e.
  - E2E: none is named, and no spec uses the changed texts.
- `git diff --check c87ef0e HEAD` is clean. The added lines contain no « appsport » and no curly apostrophe.
- Files changed since c87ef0e (7):
  - `apps/server/test/auth/password-reset.test.ts`
  - `apps/server/test/infra/docs.test.ts`
  - `apps/web/src/features/public/privacy-content.ts`
  - `apps/web/test/app/public-pages.test.tsx`
  - `docs/exploitation/P9-admin-indisponible.md`
  - `docs/fiche-de-traitement.md`
  - `infra/host/test/update.bats`
- No procedure command (systemctl, restic, mount and so on) was run on this PC.
- `git status` is clean. `git show --stat HEAD` shows 2b08f85 with `apps/server/test/infra/docs.test.ts` only (19 insertions, 15 deletions).

### Owner points carried over (for the controller's ledger)
- **T14-F8.** The finding asks the owner to confirm keeping version 1.0. As a subagent, G1 could not ask, so the confirmation is still to be recorded.
- **T14-F3.** The legal wording is to be validated by the owner, on two points: the « sans consulter tes données » promise made on the trusted person's behalf, and the P-ADM-3 commitment in the fiche.

### Cleanup
- `git worktree remove --force` was run for the three fix worktrees, and `git branch -D` deleted fix/T14-r1-g1, g2 and g3.
- Git left the ignored `node_modules` folders on disk. I checked that every link in them pointed inside its own folder, deleted the three folders, then ran `git worktree prune`.
- `git worktree list` now shows no T14 entry.
