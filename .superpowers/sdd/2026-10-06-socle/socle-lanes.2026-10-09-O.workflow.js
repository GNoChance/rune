export const meta = {
  name: 'socle-lanes',
  description: 'Continue the socle plan in parallel lanes (implement, multi-lens review, adversarial verify, fix loop) lane O (T40, T43-T45) under a 6-agent cap',
  whenToUse: 'Continue docs/superpowers/plans/2026-10-06-socle.md on several branches under a global agent cap',
  phases: [
    { title: 'Implement', detail: 'implementer writes the task with TDD and commits' },
    { title: 'Review', detail: 'one reviewer per lens' },
    { title: 'Triage', detail: 'merge duplicate findings, classify minors' },
    { title: 'Verify', detail: '3 skeptics try to refute each Critical/Important finding' },
    { title: 'Fix', detail: 'one fixer applies confirmed findings and cheap minors' },
    { title: 'Re-review', detail: 'scoped re-review of each fix diff' },
  ],
}

const ARGS = {
 "maxAgents": 6,
 "lanes": [
  {
   "lane": "O",
   "repo": "C:\\Users\\eliott.colin\\appsport-ops",
   "branch": "socle-ops",
   "startHead": "1a20c96",
   "tasks": [
    {
     "task": "40",
     "title": "snapshots, restore with a new epoch, and epoch E2E",
     "issue": 41,
     "kind": "server",
     "implModel": "opus",
     "context": "The server is complete through T24: rotateServerEpoch (T22, deliberately left unwired until this restore), privacy:collect / privacy:reapply (T24), dumpDatabase (T20), runCli with COMMANDS and assertStartupPreconditions (T7); T38's harness provides startE2EServer with stop, restart and cli, and bootstrapAdmin. This task adds takeSnapshot / pruneSnapshots / restoreSnapshot with the snapshot and restore CLI, and the epoch-change E2E (01 §9.1.6 scenario 7).\nLANE O (2026-10-09): you work in the worktree C:\\Users\\eliott.colin\\appsport-ops on branch socle-ops (= socle at 857e972 with T37 and T38 done, plus socle-infra merged as 1a20c96: T41 bundle/Dockerfile/compose and T42 release/Dependabot are present). T39 is being implemented at the same time on branch socle in C:\\Users\\eliott.colin\\appsport: never touch that checkout. If you run E2E, use free ports and this worktree's own .e2e-data. jq 1.8.2 and bats 1.13.0 are installed locally (Git Bash and PowerShell), so bats suites run locally; Docker is not available (image checks stay CI-only).",
     "rulings": "- Spec is the binding authority over the brief. Rules: R-DEP-7, R-SYN-25, R-SYN-26, R-SYN-28, R-OPS-10, R-OPS-16, 08 §7, §12 P4 (a), 03 §7, §8, §17 n°10. CLI lines in French, verbatim: stdout « Instantané écrit : <chemin absolu> »; « Base remplacée conservée 30 jours dans <dossier>. », « Restauration terminée. Nouvelle époque : <uuid> (epoch_base_rev <n>). », « Lancez maintenant privacy:reapply, avant de redémarrer le service. »; stderr with exit 1: « Étiquette invalide « <tag> » : attendu daily ou pre-vX.Y.Z. », « Instantané introuvable : <chemin>. », « Instantané corrompu (PRAGMA integrity_check) : base actuelle laissée intacte. », « Volume de données absent : sentinelle <chemin> introuvable. ».\n- SNAPSHOT_TAG_RE = /^(daily|pre-v\\d+\\.\\d+\\.\\d+)$/; invalid → SnapshotError('invalid_tag') and no file. daily uses the Paris civil date (parisDate): '2026-10-06T22:30:00.000Z' → daily-20261007.db. takeSnapshot: mkdir snapshots, remove a stale .partial, node:sqlite backup(sqlite, partial, { rate: 0x7fffffff }) in one step, PRAGMA journal_mode=DELETE on the copy, renameSync to the final name (same name replaces); no -wal or .partial left.\n- pruneSnapshots(dataDir, now, { keep = 3, maxAgeDays = 30 }): first delete every daily-*.db, pre-*.db and replaced-* directory whose mtime is older than 30 days (03 §7, R-OPS-10: nothing older than 30 days, even among the last 3), then keep the 3 newest per prefix (mtimeMs then name, descending); other files untouched. The snapshot CLI prunes after writing.\n- restoreSnapshot order imposed (Review Focus 4): 1 snapshot exists else RestoreError('snapshot_missing'); 2 integrity_check on the snapshot opened read-only, exception or not [{ integrity_check: 'ok' }] → 'integrity_failed'; 3 copy to appsport.db.restoring; 4 open it, rotateServerEpoch(db, { ids, clock }) (epoch_base_rev = sync_counter, epoch_started_at = restore time, R-SYN-25), journal_mode=DELETE, close — any error removes .restoring and rethrows; 5 move appsport.db, -wal and -shm into snapshots/replaced-<AAAAMMJJTHHMMSSZ from clock>/ (R-OPS-16; replacedDir, else null); 6 rename .restoring → appsport.db. The live DB stays byte-identical (sha256) on every failure path.\n- snapshot requires sentinel and DB; restore requires only the sentinel (P4 (b) on a fresh machine; no current DB → exit 0 and no replaced-*). restore uses cryptoIds(), systemClock and path.resolve; snapshot uses systemClock.\n- restore-privacy (Review Focus 4, 03 §17 n°10): after restoreSnapshot then reapplyPrivacyEvents on a new context of the same file, alice's old cookie → 410 { error: 'account_deleted' }, alice absent from user, isHealthConsentActive(bob) false, bob's limitations deleted and empty, dumpDatabase without 'TEMOIN-C2-genou'. T24 ruling stands: a consent withdrawn then re-granted after the snapshot is withdrawn again (fail-closed).\n- epoch.spec (Chromium and WebKit, 180 s), through T38's harness only (no page.route): admin created by API (bootstrapAdmin, accept, profile, home place, complete; no health consent); snapshot --tag daily; PATCH daysPerWeek 4; privacy:collect, stop, restore, privacy:reapply, restart; then epoch2 ≠ epoch1, meta.serverEpoch epoch2, watermark '<epoch2>:…', mirror daysPerWeek back to 3 (R-SYN-28: the server wins), no …/consents/health/replay-withdraw request (T26), pending-counter data-count '0', outbox empty, no 401 nor 410 response, one pull without since (full pull).\n- Windows: close every DatabaseSync / Kysely handle (and the test context) before restoreSnapshot — renaming or moving an open SQLite file fails on Windows while it passes on Linux. Expected: pnpm --filter @appsport/server test ops/ → Test Files 4 passed; pnpm --filter @appsport/web test:e2e epoch → 2 passed. Reports never contain invitation codes or links with a fragment.\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) The concurrent-writes snapshot test passing vacuously or flaking: it must prove at least one insert landed between the backup start and its resolution, with count(pair_a) = count(pair_b) ≥ 20 000 and integrity ok, within 60 s. (b) Restore failure paths leaving .restoring or replaced-* behind or touching the live DB; the epoch rotated in the live DB instead of the copy; the foreign WAL ('apres-instantane') replayed into the restored base instead of moving away with the old -wal/-shm. (c) Prune grouping or ordering by name instead of mtime (pre-v1.9.0 vs pre-v1.10.0), deleting non-matching files (notes.txt) or recent replaced-* dirs. (d) Dates: UTC instead of the Paris date for daily names, replaced-<stamp> not taken from the injected clock. (e) CLI: snapshot accepted without sentinel or DB or without --tag, the last three restore lines out of order (lines.at(-3) to at(-1)), Windows path separators not covered by [\\\\/] in the regexes. (f) epoch.spec: a replay-withdraw sent, or an incremental pull instead of a full one after the epoch change.",
     "dependsOn": [
      "38"
     ],
     "parallelOk": "Its server half (apps/server/src/ops, cli.ts, test/ops) is independent of T37-T39; only epoch.spec needs T38's harness. Can run alongside T39 (disjoint files) and T41/T42. Not alongside T43/T44 (they edit cli.ts and consume snapshot/restore).",
     "repo": "C:\\Users\\eliott.colin\\appsport-ops",
     "branch": "socle-ops"
    },
    {
     "task": "43",
     "title": "appsport-unlock and appsport-update with R-DEP-4 rollback",
     "issue": 44,
     "kind": "infra",
     "implModel": "opus",
     "context": "T40 provides the snapshot --tag pre-vX.Y.Z and restore CLI (sentinel only, new epoch, replaced-* kept 30 days), T24 privacy:collect --since --out (read-only) and privacy:reapply, T41 infra/compose.yaml (project appsport, service app, env file deploy.env), T12 the OpsStatus read by the admin health page. This task creates the host shell library, appsport-unlock, appsport-update with automatic and manual rollback, the bats harness and the CI infra job, plus the sessions:active CLI.\nLANE O (2026-10-09): you work in the worktree C:\\Users\\eliott.colin\\appsport-ops on branch socle-ops (= socle at 857e972 with T37 and T38 done, plus socle-infra merged as 1a20c96: T41 bundle/Dockerfile/compose and T42 release/Dependabot are present). T39 is being implemented at the same time on branch socle in C:\\Users\\eliott.colin\\appsport: never touch that checkout. If you run E2E, use free ports and this worktree's own .e2e-data. jq 1.8.2 and bats 1.13.0 are installed locally (Git Bash and PowerShell), so bats suites run locally; Docker is not available (image checks stay CI-only).",
     "rulings": "- Spec is the binding authority over the brief. Rules: R-DEP-3, R-DEP-4, R-DEP-6, R-OPS-4, R-OPS-6, R-VER-7, 08 §3, §8, §10, §13.8, 03 §7, §8. Messages in French, verbatim from the brief (the die messages, « OK : appsport répond (version <v>). », « KO : sentinelle absente, ce n'est pas le volume appsport. », « KO : /api/health ne répond pas 200 après 2 min (voir P8). », « Phrase refusée. », « Aucune séance en cours depuis moins de 3 h. », « - <pseudo> (début <startedAt>) », « [o/N] », « Abandon : rien n'a été changé. »); T45 quotes them.\n- common.sh: defaults with : \"${X:=…}\" (Interfaces §8 plus the brief's list), exports DOCKER_CONFIG, RESTIC_PASSWORD_FILE, RESTIC_CACHE_DIR and GIT_SSH_COMMAND (secrets/deploy_key, IdentitiesOnly=yes); APPSPORT_VERSION is NEVER exported (only inline APPSPORT_VERSION=\"$NEW\" compose pull app; compose reads deploy.env). compose = $DOCKER compose --project-name appsport -f \"$APPSPORT_REPO/infra/compose.yaml\" --env-file \"$APPSPORT_ROOT/deploy.env\" \"$@\"; app_cli = exec -T when app runs, else app_cli_run (run --rm --no-deps); take_lock = exec 9>\"$LOCK_FILE\" then $FLOCK -n 9 (update, backup and restore-test are exclusive); hc_ping puts the URL last and only warns (exit 0) when the URL is missing; status_merge does chmod 0640 and chown 1000:1000 BEFORE mv; wait_health = HEALTH_TIMEOUT_S / (2 × HEALTH_POLL_S) tries, 2 min max. Exit codes: update 0 / 1 / 2 (usage), unlock 0 / 1; deploy section {at, version, previousVersion, ok}.\n- appsport-update follows the brief's main() and rollback() verbatim. R-DEP-4 / Review Focus 4: image only first (no restore, no new epoch); only if the previous image stays unhealthy: privacy:collect --since <snapshot mtime − 300 s> --out /data/ops/privacy-<v>-<stamp>.json via run --rm --no-deps (read-only, no --source), stop app, restore /data/snapshots/pre-<v>.db, privacy:reapply, delete the list (ledger T24 deferred item: removing privacy-*.json after reapply belongs to the ops scripts; 03 §7), up -d. Any failure → finish rollback-failed and « … : suivez P4. ». deploy.log lines: auto '<prev> <new> <result>', manual '<cur> <prev> <result>'; results ok, pull-failed, backup-failed, rolled-back-image, rolled-back-restore, rollback-failed.\n- Scripts: #!/usr/bin/env bash, set -euo pipefail, source common.sh through readlink -f of BASH_SOURCE (they run from /usr/local/sbin symlinks), body in functions, last line main \"$@\"; exit $? so the git checkout that replaces the running file is harmless.\n- sessions:active [--hours N]: listActiveWorkoutSessions returns [] when the workout_session table does not exist (socle), else in_progress, not deleted, started less than maxAgeHours ago, sorted; one '<pseudo>\\t<startedAt>' line per session, exit 0.\n- Bats harness per brief: stub.sh copied as $T/bin/<name> for docker, curl, restic, cryptsetup, systemctl, mount, mountpoint, git, df, smartctl, chown, flock; helpers.bash (setup_host with SLEEP=true, LOCK_FILE=$T/appsport.lock, SMART_DEVICES, HC URLs https://hc.test/…, APPSPORT_URL=https://appsport.test.ts.net, b2.env with s3:https://s3.test/appsport-backups, healthy v1.2.0); defaults.bash (T44 extends it). unlock.bats 7 tests, update.bats 17 tests; the symlink test is skipped on Windows.\n- How to run host-only parts: never run the real scripts on this PC (cryptsetup, mount, systemctl). Locally: pnpm --filter @appsport/server test ops/active-sessions → Tests 3 passed. Bats needs jq, which is NOT installed on this machine (checked 2026-10-08; winget install jqlang.jq needs the owner's go-ahead): unless jq is available, report bats as CI-only. Expected in the blocking CI job infra (pnpm install, shellcheck -x infra/host/appsport-* infra/host/lib/common.sh infra/host/test/stub.sh infra/test/image-contract.sh, pnpm test:infra): 24 tests, 0 failures, shellcheck silent. Root script test:infra = \"bats infra/host/test\", bats 1.x dev dep.\n- Scripts committed with git add --chmod=+x (mode 100755 in git ls-files -s); LF endings guaranteed by .gitattributes.\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) Rollback branch selection: restoring (new epoch) when the previous image is healthy, or an auto/manual rollback failure not recorded as rollback-failed with .deploy.ok false (Review Focus 4, 08 §13.8). (b) set -e pitfalls: failures swallowed inside if / || / command substitutions or subshells, a die inside a subshell not ending the script, read <<< on an empty line. (c) APPSPORT_VERSION leaking into the environment so a later compose up -d starts the wrong tag; deploy.env not written atomically. (d) Lock taken after a mutating step or released early; the « rien n'a été changé » guarantee broken because git or pull runs before the volume, sentinel and health checks. (e) Stubs too permissive (assert_calls_in_order matching substrings, rules that never fail on reordering), or bats relying on Linux-only behaviour without a Windows skip. (f) The privacy list left in data/ops after reapply, or data/ops and status.json modes or owner (0750 / 0640, 1000:1000) wrong so the container cannot read them.",
     "dependsOn": [
      "40",
      "41"
     ],
     "parallelOk": "Not alongside T40 or T44 (cli.ts; T44 builds on common.sh, helpers and defaults.bash). Can run alongside T39 and T42 (disjoint files; its ci.yml job merges trivially).",
     "repo": "C:\\Users\\eliott.colin\\appsport-ops",
     "branch": "socle-ops"
    },
    {
     "task": "44",
     "title": "backups, monthly restore test, monitoring and host configuration",
     "issue": 45,
     "kind": "infra",
     "implModel": "opus",
     "context": "T43 delivered infra/host/lib/common.sh (lock, compose, app_cli, hc_ping, status_merge, restic_on, restic_backup_all), the bats harness (stub.sh, helpers.bash, defaults.bash) and the CI infra job; T40 the snapshot --tag daily CLI with retention; T12 the OpsStatus sections shown on the admin health page. This task adds appsport-backup, appsport-restore-test, appsport-alive, appsport-check, the systemd / Docker / apt / Tailscale host files and the db:stats CLI.\nLANE O (2026-10-09): you work in the worktree C:\\Users\\eliott.colin\\appsport-ops on branch socle-ops (= socle at 857e972 with T37 and T38 done, plus socle-infra merged as 1a20c96: T41 bundle/Dockerfile/compose and T42 release/Dependabot are present). T39 is being implemented at the same time on branch socle in C:\\Users\\eliott.colin\\appsport: never touch that checkout. If you run E2E, use free ports and this worktree's own .e2e-data. jq 1.8.2 and bats 1.13.0 are installed locally (Git Bash and PowerShell), so bats suites run locally; Docker is not available (image checks stay CI-only).",
     "rulings": "- Spec is the binding authority over the brief. Rules: R-OPS-1, R-OPS-2, R-OPS-4, R-OPS-8 to R-OPS-11, R-DEP-5, R-DEP-7, 08 §2, §4, §5.6, §7, §9, §13.3, §13.6, §13.11, §15, 03 §10.\n- Ruling C3 (ledger): db:stats finds the DB through APPSPORT_DATA_DIR (default /data) WITHOUT loadConfig, so no APP_ORIGIN is needed (the restore test runs it in a bare docker run without env_file); readOnly, no startup guard, no withAppDeps, no migration (unlike db:check, T7 deferred minor). Add the db-stats.test CLI case run with an env lacking APP_ORIGIN. One JSON line, exit 0 even when integrity is KO; missing DB → 1 « Base introuvable : <chemin>. »; an unknown breaking migration row ('0099_future', 1) → still reads, DB unchanged (sha256); integrity KO or throwing → the message, users 0, syncCounter 0, lastWriteAt null, no other read.\n- dbStats: integrity = PRAGMA integrity_check rows joined by \\n; users = count(*) of user; syncCounter from server_meta; lastWriteAt = max updated_at over every table that has it and security_event.at, or null.\n- Scripts reuse T43's structure; no personal data in any Healthchecks motif (no username, no value); take_lock || fail \"verrou occupé\" after the volume check (backup, restore-test).\n- appsport-backup: hc start, exec -T snapshot --tag daily, restic local then offsite with the brief's exact --exclude \"$APPSPORT_ROOT/data/appsport.db*\" and paths (data/snapshots, secrets, deploy.env, deploy.log, $TAILSCALE_STATE), forget --keep-daily 30 --prune only after a successful backup of the same repo (R-OPS-10); offsite failure → local still backed up and pruned, /fail names offsite, .backup.detail contains « offsite »; success detail 'local+offsite'; fail → status_merge backup (skipped when the volume is not mounted), hc_ping backup fail, exit 1; B2 keys only for offsite.\n- appsport-restore-test (R-OPS-11): restic restore latest --tag daily from the OFFSITE repo into $APPSPORT_ROOT/tmp/restore-test-<AAAAMMJJTHHMMSSZ>/ only (never outside tmp/, never on the plaintext disk), --include data/snapshots; chown -R 1000:1000; db:stats in docker run --rm --network none on a copy of the most recent daily; live db:stats through exec -T; ≥ 1 user and lag ≤ 172 800 s; throwaway container appsport-restore-test (--network none --read-only --tmpfs /tmp --user 1000) on ghcr.io/gnochance/appsport:<current_version> with APP_ORIGIN=https://restore-test.invalid, probe docker exec … node -e fetch, docker rm -f; restic check --read-data-subset=5% local then offsite; trap cleanup EXIT (container and copy); detail '<fichier> ; écart <h> h'.\n- appsport-alive: $CURL -sS --fail-with-body --max-time 10 \"$APPSPORT_URL/api/health\", body parsed by jq whatever the status; motifs « volume verrouillé : lancer appsport-unlock », « appli KO : api/health injoignable », « appli KO : status=error db=error ». appsport-check: $DF --output=pcent on /, $APPSPORT_ROOT, $BACKUP_ROOT (> 80 % → « disque <m> à <pct> % », exactly 80 is fine), $SMARTCTL -H must contain PASSED or 'SMART Health Status: OK', reboot-required file → « redémarrage requis », problems joined by ' ; '; volume locked → ping anyway, status.json not written.\n- Host files verbatim: timers OnCalendar alive '*:0/5', backup '*-*-* 03:30:00', check '*-*-* 04:00:00', restore-test 'Sun *-*-01..07 05:00:00', WantedBy=timers.target, Persistent=true except alive; services Type=oneshot, ExecStart=/usr/local/sbin/<name>; docker.service.d/appsport.conf RequiresMountsFor=/srv/appsport; daemon.json exactly as 08 §4; 52appsport-unattended with Unattended-Upgrade::Automatic-Reboot \"false\"; no reboot / poweroff / halt / kexec / shutdown -r|-h anywhere under infra/systemd or infra/host (08 §2, §13.11); tailscale-policy.hujson = the 08 §5 policy preceded by the brief's comment line (R-OPS-8).\n- infra/host/test/defaults.bash is owned by T43 and extended here (preflight Doc ruling): restic restore, db:stats, df, smartctl, docker run/exec/rm.\n- How to run: locally pnpm --filter @appsport/server test ops/db-stats infra/host-config → Test Files 2 passed. The 4 bats files (backup 5, restore-test 6, alive 4, check 6 = 21 tests) need jq, not installed on this PC → the CI job infra is authoritative: pnpm test:infra → 45 tests, 0 failures. systemd units, daemon.json, apt and Tailscale files only run on the host during P1 (documented by T45). Scripts committed with --chmod=+x.\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) C3 regression: db:stats needing APP_ORIGIN or going through loadConfig / withAppDeps / migrations — bats stubs docker, so only the host's monthly restore test would catch it. (b) restore-test writing outside $APPSPORT_ROOT/tmp/, restoring from the local repo instead of offsite, measuring the lag on the wrong DB, or leaving the copy or the container behind on failure (trap). (c) forget after a failed backup, an offsite failure aborting the local backup, or status.json written while the volume is locked. (d) Personal data in Healthchecks motifs or logs. (e) host-config: a reboot-like command slipping into a script or unit, timers missing Persistent or with a wrong OnCalendar.",
     "dependsOn": [
      "40",
      "43"
     ],
     "parallelOk": "After T43 (shares common.sh, helpers.bash, defaults.bash and cli.ts). Only T45's drafting can overlap it.",
     "repo": "C:\\Users\\eliott.colin\\appsport-ops",
     "branch": "socle-ops"
    },
    {
     "task": "45",
     "title": "written procedures P1-P9, rebuild runbook, processing record and incident register",
     "issue": 46,
     "kind": "docs",
     "implModel": "opus",
     "context": "All code and infra exist: snapshot / restore CLI (T40), image and compose (T41), release (T42), appsport-unlock and appsport-update (T43), backup, restore test, alive and check plus the systemd / Docker / apt / Tailscale files (T44). This task writes the operating procedures P1-P9, the relatives' install sheet, the phone acceptance checklist, the rebuild runbook, the processing record (fiche de traitement) and the incident register, all checked by apps/server/test/infra/docs.test.ts.\nLANE O (2026-10-09): you work in the worktree C:\\Users\\eliott.colin\\appsport-ops on branch socle-ops (= socle at 857e972 with T37 and T38 done, plus socle-infra merged as 1a20c96: T41 bundle/Dockerfile/compose and T42 release/Dependabot are present). T39 is being implemented at the same time on branch socle in C:\\Users\\eliott.colin\\appsport: never touch that checkout. If you run E2E, use free ports and this worktree's own .e2e-data. jq 1.8.2 and bats 1.13.0 are installed locally (Git Bash and PowerShell), so bats suites run locally; Docker is not available (image checks stay CI-only).",
     "rulings": "- Spec is the binding authority over the brief. Rules: 08 §6, §9 to §13, R-OPS-1, R-OPS-5, R-OPS-7, R-OPS-9, R-OPS-12, R-OPS-14, 01 R-TST-4, 02 R-ONB-4, 03 P-MIN-4, §1, §7, §10, §13.5, §13.7, §14. Exception to implementer-common.md: this task writes under docs/, limited to docs/exploitation/*, docs/fiche-de-traitement.md and docs/incidents.md (plus infra/RUNBOOK-reconstruction.md); never touch docs/superpowers, docs/research or docs/adr. French; straight apostrophe ' (the test matches « Sur l'écran d'accueil », « Installer l'application », « Interrupteur d'urgence »).\n- Ruling C2 (ledger): RTST4 = the 7 controls of 01 §9.3 R-TST-4 verbatim, the 7th included (« onboarding complet en moins de 2 min, hors écran Santé (section Comptes, R-ONB-4) »), without the trailing ';' or '.'; the brief's « 6 » is wrong. The separate assertion 'moins de 2 minutes hors écran Santé' is dropped or rewritten in the spec wording 'moins de 2 min, hors écran Santé'. « sans objet au socle » is allowed for controls 2, 4 and 5.\n- Ruling C5 (ledger): the old-TCA-number scan also excludes .superpowers/ (besides node_modules, .git, dist, .e2e-data, test-results, playwright-report, docs/research, docs/superpowers). Build the pattern from pieces joined with '[ .]?' as the brief does and never write the number itself in any file, report or commit (pre-check 2026-10-08: it only appears under docs/research and docs/superpowers).\n- Procedure format: '# Pn <Titre>', « Quand : … », « Durée : … », numbered steps as **action**, a command block, « Résultat attendu : … », « Sinon : … ».\n- Commands and messages must match what T40, T41, T43 and T44 ship: compose forms docker compose --project-name appsport -f /opt/appsport/infra/compose.yaml --env-file /srv/appsport/deploy.env exec -T app node /app/server.mjs <cmd> (running) and … run --rm --no-deps app node /app/server.mjs <cmd> (stopped); the 10 CLI commands cited as 'server.mjs <cmd>' (init, db:check, admin:bootstrap, admin:reset, snapshot, restore, privacy:collect, privacy:reapply, sessions:active, db:stats); the 6 scripts of 08 §15; P2 expected « OK : appsport répond (version vX.Y.Z). »; P3 lists deploy.log's 6 results (ok, pull-failed, backup-failed, rolled-back-image, rolled-back-restore, rollback-failed), --rollback, expired GHCR token → P5. [décision plan] Healthchecks strings: 'alive : 5 min, grâce 8 min', 'backup : 24 h, grâce 2 h', 'host : 24 h, grâce 2 h', 'restore-test : 35 j, grâce 3 j'.\n- P1: sections in the test's order with the decided strings (crypttab 'appsport /dev/disk/by-partlabel/appsport-data none luks,noauto', fstab '/dev/mapper/appsport /srv/appsport ext4 noauto,nofail 0 2', chattr +i /srv/appsport BEFORE the first mount, systemctl disable docker.service docker.socket, tailscale serve --bg --https=443 http://127.0.0.1:3000, tailscale set --auto-update, IPV6=yes in /etc/default/ufw, root known_hosts checked against GitHub's published fingerprint, ln -s /opt/appsport/infra/host/appsport-* /usr/local/sbin/, secrets mode 600, '6 mots', 'EU Central', 'limitée au bucket', RESTIC_OFFSITE_REPOSITORY / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, APPSPORT_URL, VITE_OWNER_FIRST_NAME (repository variable used by T42's release), chown -R 1000:1000 /srv/appsport/data); first install in the test's order APPSPORT_VERSION=v < pull < .appsport-volume < server.mjs init < server.mjs admin:bootstrap < up -d, without appsport-update (it requires a healthy app), init and admin:bootstrap through run --rm --no-deps; « Recette » = 08 §13 (≥ 11 items) then recette-telephones.md; « Enveloppe de secours » per R-OPS-14 (phrase LUKS, compte Unix, mot de passe restic, clé B2, P2, P9, datée).\n- P4 « Sur place »: privacy:collect (--source of the newest snapshot if the DB is unreadable) < stop app < restore (replaced DB kept 30 days in snapshots/replaced-…/) < privacy:reapply (« Aucun administrateur actif » → admin:bootstrap) < list deleted < up -d, then check the phones' 60-day resend; « Nouvelle machine »: /var/lib/tailscale restored before systemctl start tailscaled, then the same sequence with the image of the same version. P7: up -d --force-recreate app (container logs ≤ 90 days, R-OPS-15, 03 §7). P8: one section per 08 §9 alert; « Interrupteur d'urgence »: SW_KILL_SWITCH=1 in secrets/app.env < \"swKill\":true < \"swKill\":false, removed after the fix (P3); theft, burglary or leak per 03 §14 with admin:reset. P9: « Aucune invitation ni réinitialisation n'est possible sans admin. »\n- recette-telephones.md: iPhone and Android with the installed PWA, the 7 controls, R-ONB-4 timed, kill switch and update banner on iPhone, « Résultat attendu / Sinon » format, final table '| Date | Version | Appareil | Résultat |'; P3 requires it before git tag when a version touches src/sw, the sync, local-db or iOS. Owner ruling 2026-10-08 (screens usable in landscape): the T34 report proposed two extra items — the re-acceptance gate in landscape (667×375) and account deletion with pending items in iPhone SE portrait; they may follow the 7 verbatim controls, never replace or reword them.\n- installer-appsport.md: 08 §6 relative side and §11, one « Capture : à ajouter pendant P1 (captures/installer-0N.png). » line per step; 'son propre compte Tailscale' (P-MIN-4) in installer-appsport and in P6. Runbook (R-OPS-12): timed, under 2 h, B2 restore on another machine, copy destroyed, '## Journal des exercices' with a Date | Durée | Écarts constatés table.\n- Fiche de traitement: 03 §1, §2, §7, §10, version 1.0 (= PRIVACY_POLICY_VERSION), headings and words required by the test (C0 to C3, Anthropic, Backblaze, Tailscale, 30 jours); it is the source of the Privacy page (T28 privacy-content.ts, flagged in the ledger for the owner's review before go-live): keep both consistent. incidents.md: 03 §14 (72 h), the test's header '| Date | Faits | Données exposées | Mesures | Personnes prévenues |' and « Aucun incident enregistré. »\n- No real secret, tailnet name, code or personal name anywhere: placeholders (vX.Y.Z, <tailnet>, AAAAMM). Expected: pnpm --filter @appsport/server test infra/docs → Test Files 1 passed (docs/ is outside biome).\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) R-TST-4 copied from the brief (6 controls) or reworded instead of the spec's 7 verbatim (C2). (b) Procedures drifting from the shipped code: flags, messages, compose forms, P4 order, deploy.log results, script names — reviewers diff them against T40, T43 and T44. (c) The old TCA number reintroduced anywhere, or the scan excluding too much (all of docs/) and losing its value. (d) Order assertions using a global indexOf, so an earlier mention in another section satisfies them vacuously — scope them to the named section. (e) Secrets or personal data in examples; processing record inconsistent with the privacy page or with 03 §7 durations.",
     "dependsOn": [
      "41",
      "43",
      "44"
     ],
     "parallelOk": "Docs plus one test: drafting can overlap T44 from the briefs, but finish and merge after T43/T44 so quoted messages and options match the shipped scripts; no file conflict with any other task.",
     "repo": "C:\\Users\\eliott.colin\\appsport-ops",
     "branch": "socle-ops"
    }
   ]
  }
 ]
}

const MAX = ARGS.maxAgents || 5
let active = 0
const waiting = []
async function lim(prompt, opts) {
  while (active >= MAX) await new Promise(r => waiting.push(r))
  active++
  try { return await agent(prompt, opts) } finally { active--; const w = waiting.shift(); if (w) w() }
}

const WS = 'C:\\Users\\eliott.colin\\appsport\\.superpowers\\sdd\\2026-10-06-socle'
const PKG = 'bash C:/Users/eliott.colin/.claude/skills/subagent-driven-development/scripts/review-package docs/superpowers/plans/2026-10-06-socle.md'

const IMPL_SCHEMA = { type: 'object', properties: {
  status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
  head: { type: 'string', description: 'short SHA of HEAD after your commit(s)' },
  commits: { type: 'string' },
  tests: { type: 'string', description: 'one-line summary of RED/GREEN, lint, typecheck, full test results' },
  diffPath: { type: 'string', description: 'path printed by the review-package command' },
  concerns: { type: 'array', items: { type: 'string' } },
}, required: ['status', 'head', 'commits', 'tests', 'diffPath', 'concerns'] }
const FINDING = { type: 'object', properties: {
  severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
  file: { type: 'string' }, line: { type: 'string' },
  title: { type: 'string', description: 'one line' },
  problem: { type: 'string', description: 'what is wrong and the concrete failure scenario' },
  fix: { type: 'string' },
  specRef: { type: 'string', description: 'spec/plan/brief reference, or empty' },
}, required: ['severity', 'file', 'line', 'title', 'problem', 'fix', 'specRef'] }
const REVIEW_SCHEMA = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['approved', 'needs_fixes'] },
  findings: { type: 'array', items: FINDING },
  checks: { type: 'array', items: { type: 'string' } },
}, required: ['verdict', 'findings', 'checks'] }
const TRIAGE_SCHEMA = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
    lenses: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' }, line: { type: 'string' }, title: { type: 'string' },
    problem: { type: 'string' }, fix: { type: 'string' }, specRef: { type: 'string' },
    minorAction: { type: 'string', enum: ['fix_now', 'defer', 'n/a'] },
  }, required: ['id', 'severity', 'lenses', 'file', 'line', 'title', 'problem', 'fix', 'specRef', 'minorAction'] } },
}, required: ['findings'] }
const VERDICT_SCHEMA = { type: 'object', properties: {
  real: { type: 'boolean' },
  severity: { type: 'string', enum: ['Critical', 'Important', 'Minor', 'None'] },
  planConflict: { type: 'string', enum: ['none', 'spec_wins', 'product_choice'] },
  evidence: { type: 'string' },
}, required: ['real', 'severity', 'planConflict', 'evidence'] }
const FIX_SCHEMA = { type: 'object', properties: {
  head: { type: 'string' }, fixDiffPath: { type: 'string' }, tests: { type: 'string' },
  addressed: { type: 'array', items: { type: 'string' } },
  notAddressed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
}, required: ['head', 'fixDiffPath', 'tests', 'addressed', 'notAddressed'] }
const REREVIEW_SCHEMA = { type: 'object', properties: {
  results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, addressed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['id', 'addressed', 'evidence'] } },
  newBreakage: { type: 'array', items: FINDING },
}, required: ['results', 'newBreakage'] }

const LENS_TEXT = {
  spec: 'SPEC COMPLIANCE: compare the diff with the brief, the controller rulings and the spec rules the brief cites (grep the spec). Missing / Extra / Misunderstood requirements; values or texts that differ from the brief or the spec.',
  correctness: 'CORRECTNESS: bugs, edge cases, error handling, races and ordering, state machines, boundary values, interaction with code from earlier tasks. For every finding give a concrete input or state that produces the wrong result.',
  tests: 'TEST STRENGTH: would the new tests fail on plausible wrong implementations? Vacuous or tautological assertions, missing edge cases the brief lists, non-determinism (timers, randomness, ordering), tests passing for the wrong reason, noisy output. You may run focused tests but must NOT modify any file (no mutation edits); reason about mutations instead.',
  security: 'SECURITY AND PRIVACY: secrets, codes, tokens and passwords never logged, stored or returned beyond the brief; health (C2) data never written without consent and never leaked to logs, other users or the admin; user isolation (another user resource gives 404); CSRF, Origin and JSON rules; injection; sensitive data in client storage, URLs or browser history.',
  ux: 'UI, COPY AND ACCESSIBILITY: French texts exactly as the brief or spec fix them (straight apostrophe only), glossary vocabulary, labels associated to inputs, roles and accessible names the tests rely on, focus and keyboard use, offline states and the « Nécessite le réseau » message, no Dexie access from screens (only repos), no navigator.onLine, no inline script or dangerouslySetInnerHTML, no confusing transient screens or redirect flicker.',
  ops: 'OPERATIONS AND PORTABILITY: commands runnable on the Windows 11 dev machine (PowerShell or Git Bash, no Docker or Python) or explicitly CI/host-only with the expected output; bash strictness and portability; systemd, Docker and restic correctness; data safety on failure paths; idempotency of scripts; secrets in files and logs.',
}
const LENSES_BY_KIND = {
  server: ['spec', 'correctness', 'security', 'tests'],
  sync: ['spec', 'correctness', 'security', 'tests'],
  web: ['spec', 'correctness', 'ux', 'security', 'tests'],
  pwa: ['spec', 'correctness', 'ux', 'tests', 'ops'],
  infra: ['spec', 'correctness', 'ops', 'security', 'tests'],
  docs: ['spec', 'ops', 'tests'],
}


const EXPERT_BY_KIND = {
  web: "a senior React and TypeScript front-end engineer who ships accessible, offline-first PWAs",
  pwa: "a senior web platform engineer expert in service workers, Cache Storage, Vite builds and HTTP caching",
  server: "a senior Node.js back-end engineer expert in Hono, SQLite and secure session handling",
  sync: "a distributed-systems engineer expert in offline-first sync, idempotency and conflict handling",
  infra: "a senior DevOps and SRE engineer expert in Docker, systemd, restic, bash and GitHub Actions",
  docs: "a senior technical writer for operations runbooks and privacy registers",
}
const EXPERT_LENS = {
  spec: "a meticulous requirements analyst who checks every rule of the brief and the spec",
  correctness: "a principal engineer known for finding race conditions, ordering bugs and edge cases",
  tests: "a test architect who thinks in mutations and hunts vacuous assertions",
  security: "an application security and GDPR privacy specialist",
  ux: "a UX writer and WCAG accessibility specialist, native French speaker",
  ops: "a site reliability engineer for small self-hosted servers on Windows dev machines and Linux hosts",
}
const EXPERT_VERIFY = [
  "a skeptical debugger who reproduces failures by tracing the exact code path",
  "a code archaeologist who finds existing guards elsewhere in the codebase",
  "a spec lawyer who checks what the brief and the spec actually require",
]
const NICK_LENS = { spec: "Lynx", correctness: "Renard", ux: "Colibri", security: "Chouette", tests: "Pic", ops: "Marmotte" }
const you = s => "You are " + s + ". "

const PFIX_SCHEMA = { type: 'object', properties: {
  branch: { type: 'string' }, worktree: { type: 'string' }, head: { type: 'string' },
  tests: { type: 'string' }, notes: { type: 'string' },
  addressed: { type: 'array', items: { type: 'string' } },
  notAddressed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
}, required: ['branch', 'worktree', 'head', 'tests', 'notes', 'addressed', 'notAddressed'] }

// Split findings into groups that touch disjoint files, so parallel fixers rarely conflict.
function groupFindings(items, maxGroups) {
  if (items.length < 3) return [items]
  const filesOf = f => String(f.file || '').split(/[\s,;()]+/).map(x => x.replace(/:.*$/, '').replace(/^.*?(apps|packages|infra|docs|scripts)\//, '$1/')).filter(x => /\.[a-z]+$/i.test(x))
  let groups = []
  for (const f of items) {
    const fs = filesOf(f)
    const hit = groups.filter(g => fs.some(x => g.files.has(x)))
    const g = { files: new Set(fs), items: [f] }
    for (const h of hit) { h.files.forEach(x => g.files.add(x)); g.items.push(...h.items) }
    groups = groups.filter(x => !hit.includes(x)).concat([g])
  }
  while (groups.length > maxGroups) {
    groups.sort((a, b) => a.items.length - b.items.length)
    const a = groups.shift()
    a.files.forEach(x => groups[0].files.add(x)); groups[0].items.push(...a.items)
  }
  return groups.map(g => g.items)
}

async function runTask(A) {
  const EXP = EXPERT_BY_KIND[A.kind] || EXPERT_BY_KIND.server
  const REPO = A.repo || 'C:\\Users\\eliott.colin\\appsport'
  const BRANCH = A.branch || 'socle'
  const WHERE = A.repo
    ? ('IMPORTANT: you work ONLY in ' + REPO + ', a git worktree on branch ' + BRANCH + '. Wherever the rules files say C:\\Users\\eliott.colin\\appsport or branch socle, read ' + REPO + ' and branch ' + BRANCH + '. Never read, run commands in, or modify C:\\Users\\eliott.colin\\appsport (another team is working there); briefs, reports and rules files under .superpowers\\sdd of that repo are the only exception (read them; write only your report file).\n')
    : 'IMPORTANT: another team works in parallel in the separate worktree C:\\Users\\eliott.colin\\appsport-pwa (branch socle-pwa); never read, run commands in, or modify it.\n'
  const T = A.task
  const BRIEF = WS + '\\task-' + T + '-brief.md'
  const REPORT = WS + '\\task-' + T + '-report.md'
  const COMMON_IMPL = WS + '\\implementer-common.md'
  const COMMON_REV = WS + '\\reviewer-common.md'
  const GC = WS + '\\global-constraints.md'
  const SPEC = REPO + '\\docs\\superpowers\\specs\\2026-10-06-appsport-design.md and its sections in ' + REPO + '\\docs\\superpowers\\specs\\2026-10-06-appsport-design\\'
  const DETAILS = 'When an item carries detailsIn, read its full text (file, line, problem, fix, specRef) under the same id in that JSON file.'

  const implPrompt = you(EXP) + WHERE + 'You are implementing Task ' + T + ' (' + A.title + ') of appsport\'s socle, a private French strength-training PWA (pnpm TS monorepo), on branch ' + BRANCH + ' in ' + REPO + '.\n'
    + 'Context: ' + (A.context || '') + '\n'
    + '1. Read first: ' + COMMON_IMPL + ' (rules: mandatory separate RED run; check git show --stat HEAD before reporting; never dispatch subagents).\n'
    + '2. Your requirements, with exact values and texts to use verbatim: ' + BRIEF + '\n'
    + '3. Issue to close: #' + A.issue + '.\n'
    + '4. Write your full report to: ' + REPORT + '\n'
    + '5. Controller rulings (they win over the brief where they differ):\n' + A.rulings + '\n'
    + '6. After your final commit run `' + PKG + ' ' + A.base + ' HEAD` from ' + REPO + ' and return the path it prints as diffPath.\n'
    + 'Your final answer is the structured result.'
  const reviewPrompt = (lens, diffPath, head) => you(EXPERT_LENS[lens]) + WHERE + 'Review Task ' + T + ' (' + A.title + ') of appsport\'s socle through ONE lens only.\n'
    + 'Lens: ' + LENS_TEXT[lens] + '\n'
    + 'Rules: ' + COMMON_REV + ' (read-only: never modify files, git state or the working tree; never dispatch subagents).\n'
    + 'Inputs: brief ' + BRIEF + '; global constraints ' + GC + '; implementer report ' + REPORT + '; diff ' + diffPath + ' (base ' + A.base + ', head ' + head + '); spec ' + SPEC + '.\n'
    + 'Controller rulings already decided (do not report them as defects; do report code that does not follow them):\n' + A.rulings + '\n'
    + 'Named risks to examine with this lens where relevant:\n' + (A.risks || '(none)') + '\n'
    + 'Report only findings within your lens, each with file and line, a concrete failure scenario and a fix. Severity: Critical = data loss, security or privacy breach, or app unusable; Important = the task cannot be trusted (incorrect or fragile behaviour, missed requirement, test that asserts nothing); Minor = polish. Your final answer is the structured result.'
  const triagePrompt = all => you("an engineering lead") + 'You merge code-review findings for Task ' + T + ' of appsport\'s socle. Below are findings from several reviewers, each tagged with its lens (JSON). Merge duplicates (same root cause gives one finding; keep the highest severity; list all lenses), give each an id T' + T + '-F1, T' + T + '-F2, and so on, and keep file, line, problem and fix precise. For each Minor set minorAction to fix_now if it is cheap (under about 20 lines), low-risk and improves correctness, robustness or test strength for later tasks, else defer. Critical and Important get minorAction n/a. Do not invent findings. Do not read files; work only from this list.\nFindings:\n' + JSON.stringify(all)
  const verifyPrompt = (f, k, head) => {
    const angle = k === 0 ? 'Reproduce the failure: trace the exact code path at HEAD.'
      : k === 1 ? 'Look for an existing guard elsewhere (callers, server side, other modules, tests) that already prevents the failure.'
      : 'Check the brief and the spec: is the flagged behaviour actually required, allowed, or out of scope for this task?'
    return you(EXPERT_VERIFY[k]) + WHERE + 'Adversarially verify one code-review finding on appsport\'s socle (branch ' + BRANCH + ', ' + REPO + ', HEAD ' + head + '). Try hard to REFUTE it. ' + angle + ' Read-only: do not modify files or git state; never dispatch subagents.\n'
      + 'Finding ' + f.id + ' [' + f.severity + '] ' + f.file + ':' + f.line + ' - ' + f.title + '\n'
      + 'Problem: ' + f.problem + '\nProposed fix: ' + f.fix + '\nSpec ref: ' + f.specRef + '\n'
      + 'Brief: ' + BRIEF + '; spec: ' + SPEC + '.\nController rulings:\n' + A.rulings + '\n'
      + 'Answer real=true only if a concrete failure scenario exists at HEAD. If real, give the severity you would assign and planConflict: none if the fix does not contradict the brief; spec_wins if the brief mandates the defect but the spec supports the fix; product_choice if neither the brief nor the spec decides it and it is a product decision for the owner. If you cannot confirm a concrete failure, answer real=false. Your final answer is the structured result.'
  }
  const fixPrompt = (items, round, head) => you(EXP) + WHERE + 'Fix round ' + round + ' for Task ' + T + ' (' + A.title + ') of appsport\'s socle, branch ' + BRANCH + ', ' + REPO + ', current HEAD ' + head + '.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\nController rulings:\n' + A.rulings + '\n'
    + 'Fix each finding below in new commit(s) whose message ends with "Refs #' + A.issue + '" and the Co-Authored-By trailer. For each, write or adjust the covering test first and see it fail when that is meaningful (RED), then fix (GREEN). Run the covering tests, then pnpm lint, pnpm typecheck and pnpm test; check git show --stat HEAD and git status. Append a fix report (changes, tests, commands, output) to ' + REPORT + '. If a finding turns out to be wrong after checking the code and spec, do not apply it and explain why in notAddressed. Never dispatch subagents. ' + DETAILS + '\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\n'
    + 'After your final commit run `' + PKG + ' ' + head + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'
  const rereviewPrompt = (items, fixDiff, fromHead, head) => you("a senior reviewer who checks fixes precisely and spots regressions") + WHERE + 'Scoped re-review of a fix round for Task ' + T + ' of appsport\'s socle. Rules: ' + COMMON_REV + ', section "Scoped re-review rules" (read-only; never dispatch subagents). Inputs: brief ' + BRIEF + '; report ' + REPORT + ' (fix report at the end); fix diff ' + fixDiff + ' (' + fromHead + '..' + head + ').\n'
    + 'For each finding below, say whether the fix diff addresses it, with file:line evidence; when a covering test was needed, check it exists and would fail without the fix. Then list only NEW Critical or Important breakage introduced by the fix diff (Minor new issues may be listed with severity Minor). ' + DETAILS + ' Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'

  const fixWt = (round, k) => REPO.replace(/\\/g, '/') + '-fix-T' + T + '-r' + round + '-g' + k
  const fixBr = (round, k) => 'fix/T' + T + '-r' + round + '-g' + k
  const pfixPrompt = (items, k, n, round, head) => you(EXP) + WHERE
    + 'Exception to any rule above about where you work: you create and work in your OWN fix worktree ' + fixWt(round, k) + ' (branch ' + fixBr(round, k) + '), and nowhere else.\n'
    + 'Parallel fix group ' + k + ' of ' + n + ', round ' + round + ', for Task ' + T + ' (' + A.title + ') of appsport\'s socle. Other experts fix the other findings at the same time in their own worktrees: fix ONLY the findings below and touch as few files as possible.\n'
    + 'Setup, from ' + REPO + ': if ' + fixWt(round, k) + ' or branch ' + fixBr(round, k) + ' exists from an earlier attempt, remove it (`git worktree remove --force`, `git branch -D`). Then `git worktree add ' + fixWt(round, k) + ' -b ' + fixBr(round, k) + ' ' + head + '`, cd there for EVERY later command, and run `pnpm install --prefer-offline --frozen-lockfile`. Never modify ' + REPO + ' itself, its branch ' + BRANCH + ', or any other worktree.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\nController rulings:\n' + A.rulings + '\n'
    + 'For each finding, write or adjust the covering test first and see it fail when meaningful (RED), then fix (GREEN). Run the covering tests, pnpm lint, pnpm typecheck and the tests of the package(s) you touched. Commit on ' + fixBr(round, k) + ' with messages ending "Refs #' + A.issue + '" and the Co-Authored-By trailer. Leave the worktree in place (the integrator removes it). Do NOT write to the report file: put your fix notes (changes, tests, RED/GREEN evidence) in `notes`. Never dispatch subagents. ' + DETAILS + '\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'
  const integratePrompt = (parts, round, head) => you('a senior engineer who integrates parallel fix branches cleanly') + WHERE
    + 'Integrate the parallel fix branches of round ' + round + ' for Task ' + T + ' (' + A.title + ') into branch ' + BRANCH + ' in ' + REPO + ' (current HEAD ' + head + ').\n'
    + 'Branches, in order (JSON with each group\'s branch, worktree, findings and notes):\n' + JSON.stringify(parts) + '\n'
    + 'For each branch: `git cherry-pick ' + head + '..<branch>` (keep history linear, no merge commits). On a conflict, resolve it so that BOTH fixes keep working, and record how. Then run pnpm lint, pnpm typecheck and the full pnpm test; fix any integration breakage in a new commit ending "Refs #' + A.issue + '" with the Co-Authored-By trailer. Append ONE fix report for this round to ' + REPORT + ' (each group\'s changes and tests from its notes, the conflicts you resolved, the final command outputs). Then remove every fix worktree (`git worktree remove --force <path>`) and delete the fix branches. Check git status and git show --stat HEAD. Read ' + COMMON_IMPL + ' for the rules; never dispatch subagents.\n'
    + 'addressed = the finding ids the groups fixed that survive integration; notAddressed = the others with the reason. After your final commit run `' + PKG + ' ' + head + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'

  let head = A.head
  let diffPath = A.diffPath
  let impl = null
  if (!head) {
    impl = await lim(implPrompt, { phase: 'Implement', label: 'Castor · T' + T + ' implement', schema: IMPL_SCHEMA, model: A.implModel })
    if (!impl) return { task: T, stage: 'implement', error: 'implementer returned nothing' }
    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') return { task: T, stage: 'implement', impl }
    head = impl.head
    diffPath = impl.diffPath
    log('T' + T + ' implemented at ' + head + ': ' + impl.tests)
  }

  let reviews = []
  let confirmed = [], minorsNow = [], deferred = [], refuted = [], needsRuling = []
  if (A.preTriaged) {
    const P = A.preTriaged
    const tag = x => Object.assign({}, x, { detailsIn: P.file })
    confirmed = P.confirmed.map(tag)
    minorsNow = P.minorsNow.map(tag)
    deferred = P.deferred.map(tag)
    log('T' + T + ': resuming from the saved review (' + confirmed.length + ' confirmed, ' + minorsNow.length + ' minors to fix now)')
  } else {
    const lenses = A.lenses || LENSES_BY_KIND[A.kind] || LENSES_BY_KIND.server
    const reviewsRaw = await parallel(lenses.map(l => () =>
      lim(reviewPrompt(l, diffPath, head), { phase: 'Review', label: (NICK_LENS[l] || 'Relecteur') + ' · T' + T + ' review:' + l, schema: REVIEW_SCHEMA })
        .then(r => (r ? { lens: l, verdict: r.verdict, findings: r.findings, checks: r.checks } : null))))
    reviews = reviewsRaw.filter(Boolean)
    const raw = reviews.flatMap(r => r.findings.map(f => Object.assign({}, f, { lens: r.lens })))
    log('T' + T + ': ' + raw.length + ' raw findings from ' + reviews.length + '/' + lenses.length + ' reviewers')
    let merged = []
    if (raw.length) {
      const tri = await lim(triagePrompt(raw), { phase: 'Triage', label: 'Écureuil · T' + T + ' triage', schema: TRIAGE_SCHEMA, model: 'sonnet', effort: 'low' })
      merged = (tri && tri.findings) || raw.map((f, i) => Object.assign({}, f, { id: 'T' + T + '-F' + (i + 1), lenses: [f.lens], minorAction: f.severity === 'Minor' ? 'defer' : 'n/a' }))
    }
    const serious = merged.filter(f => f.severity !== 'Minor')
    minorsNow = merged.filter(f => f.severity === 'Minor' && f.minorAction === 'fix_now')
    deferred = merged.filter(f => f.severity === 'Minor' && f.minorAction !== 'fix_now')
    let verified = []
    if (serious.length) {
      verified = (await parallel(serious.map(f => () =>
        parallel([0, 1, 2].map(k => () =>
          lim(verifyPrompt(f, k, head), { phase: 'Verify', label: 'Corbeau ' + (k + 1) + ' · T' + T + ' verify ' + f.id + ' #' + (k + 1), schema: VERDICT_SCHEMA, effort: 'high' })))
          .then(vs => {
            const v = vs.filter(Boolean)
            const yes = v.filter(x => x.real)
            const product = yes.filter(x => x.planConflict === 'product_choice').length >= 2
            return Object.assign({}, f, { real: yes.length >= 2, product, votes: v.map(x => ({ real: x.real, severity: x.severity, planConflict: x.planConflict, evidence: x.evidence })) })
          })))).filter(Boolean)
    }
    confirmed = verified.filter(f => f.real && !f.product)
    needsRuling = verified.filter(f => f.real && f.product)
    refuted = verified.filter(f => !f.real)
    log('T' + T + ': ' + confirmed.length + ' confirmed, ' + refuted.length + ' refuted, ' + needsRuling.length + ' need a ruling, ' + minorsNow.length + ' minors to fix now, ' + deferred.length + ' deferred')
  }

  let open = confirmed.concat(minorsNow)
  const rounds = []
  let round = 0
  const maxRounds = A.maxRounds || 3
  while (open.length && round < maxRounds) {
    round++
    const groups = groupFindings(open, A.maxFixers || 4)
    let fix = null
    if (groups.length >= 2) {
      log('T' + T + ' round ' + round + ': ' + open.length + ' findings split across ' + groups.length + ' parallel fixers')
      const parts = (await parallel(groups.map((g, k) => () =>
        lim(pfixPrompt(g, k + 1, groups.length, round, head), { phase: 'Fix', label: 'Fourmi ' + (k + 1) + ' · T' + T + ' fix round ' + round, schema: PFIX_SCHEMA, model: A.implModel })
          .then(r => (r ? Object.assign({ group: k + 1, ids: g.map(f => f.id) }, r) : null))))).filter(Boolean)
      if (parts.length) fix = await lim(integratePrompt(parts, round, head), { phase: 'Fix', label: 'Castor · T' + T + ' integrate round ' + round, schema: FIX_SCHEMA, model: A.implModel })
    } else {
      fix = await lim(fixPrompt(open, round, head), { phase: 'Fix', label: 'Fourmi · T' + T + ' fix round ' + round, schema: FIX_SCHEMA, model: A.implModel })
    }
    if (!fix) { rounds.push({ round, error: 'fixer returned nothing' }); break }
    const fromHead = head
    head = fix.head
    const rr = await lim(rereviewPrompt(open, fix.fixDiffPath, fromHead, head), { phase: 'Re-review', label: 'Hibou · T' + T + ' re-review ' + round, schema: REREVIEW_SCHEMA })
    const stillOpen = rr ? open.filter(f => { const r = rr.results.find(x => x.id === f.id); return !r || !r.addressed }) : open
    const fresh = rr ? rr.newBreakage.filter(b => b.severity !== 'Minor').map((b, i) => Object.assign({}, b, { id: 'T' + T + '-R' + round + '-' + (i + 1), lenses: ['re-review'], minorAction: 'n/a' })) : []
    const refusedIds = new Set(fix.notAddressed.map(n => n.id))
    rounds.push({ round, from: fromHead, head, tests: fix.tests, notAddressed: fix.notAddressed, stillOpen: stillOpen.map(f => f.id), newBreakage: fresh.map(f => f.id + ' ' + f.title), newMinor: rr ? rr.newBreakage.filter(b => b.severity === 'Minor').map(b => b.title) : [] })
    open = stillOpen.filter(f => !refusedIds.has(f.id)).concat(fresh)
    log('T' + T + ' round ' + round + ': head ' + head + ', ' + open.length + ' still open')
  }

  return {
    task: T, base: A.base, head, implemented: impl,
    reviewers: reviews.map(r => ({ lens: r.lens, verdict: r.verdict, findings: r.findings.length })),
    confirmed: confirmed.map(f => ({ id: f.id, severity: f.severity, title: f.title, file: f.file })),
    minorsFixedNow: minorsNow.map(f => f.id + ' ' + f.title),
    deferred: deferred.map(f => f.id + ' ' + (f.file || '') + ': ' + f.title),
    refuted: refuted.map(f => f.id + ' ' + f.title),
    needsRuling: needsRuling.map(f => ({ id: f.id, title: f.title, problem: f.problem, fix: f.fix, votes: f.votes })),
    rounds,
    remainingOpen: open.map(f => ({ id: f.id, severity: f.severity, title: f.title })),
  }
}

async function runLane(L) {
  let head = L.startHead
  const results = []
  for (const t of L.tasks) {
    const A = Object.assign({}, t)
    if (L.repo) { A.repo = L.repo; A.branch = L.branch }
    if (!A.head) A.base = head
    log('Lane ' + L.lane + ': starting T' + A.task + (A.head ? ' (fixes on existing ' + A.head + ')' : ' from ' + head))
    const r = await runTask(A)
    results.push(r)
    if (!r || r.stage === 'implement') { log('Lane ' + L.lane + ': T' + A.task + ' stopped at implement'); break }
    head = r.head
    if (r.remainingOpen && r.remainingOpen.length) { log('Lane ' + L.lane + ': T' + A.task + ' still has open findings after the fix rounds; stopping the lane'); break }
    log('Lane ' + L.lane + ': T' + A.task + ' done at ' + head + ' (' + r.confirmed.length + ' confirmed fixed, ' + r.needsRuling.length + ' need a ruling, ' + r.deferred.length + ' deferred)')
  }
  return { lane: L.lane, head, results }
}

const lanes = await parallel(ARGS.lanes.map(L => () => runLane(L)))
return { lanes }
