# Task 45 report: written procedures P1 to P9, rebuild runbook, processing record and incident register

Lane O, worktree `C:\Users\eliott.colin\appsport-ops`, branch `socle-ops` (base cace270). Issue #46.

**Status:** DONE_WITH_CONCERNS (the concerns are minor and listed at the end)
**Commit:** `d8f35a2` docs(docs): procédures P1 à P9, runbook de reconstruction, fiche de traitement et registre des incidents
**Review package:** `/c/Users/eliott.colin/appsport-ops/.superpowers/sdd/2026-10-06-socle/review-cace270..d8f35a2.diff`

## What I implemented

All documents are in French and use straight apostrophes. Commands and messages are copied from the shipped code: `infra/host/*`, `lib/common.sh`, `cli.ts`, `startup-guard.ts`, `release.yml` and the web UI labels. The placeholders are `vX.Y.Z`, `<tailnet>`, `AAAAMM`, `AAAAMMJJ`, `AAAA-MM-JJ`, `<compte>`, `<disque>` and `<date ISO>`. There is no real secret, tailnet name, code or personal name anywhere.

Every procedure follows the same format:
- the title `# Pn <Titre>`;
- the lines « Quand : … » and « Durée : … »;
- numbered steps written `N. **action**`, each with its command block (when there is a command), « Résultat attendu : … » and « Sinon : … ».

The relatives' sheet, the phone acceptance checklist and the runbook use the same step format.

Compose commands always have the host-script prefix `docker compose --project-name appsport -f /opt/appsport/infra/compose.yaml --env-file /srv/appsport/deploy.env`, followed by `exec -T app node /app/server.mjs <cmd>` when the app is running, or `run --rm --no-deps app node /app/server.mjs <cmd>` when it is stopped. The test enforces this.

### `docs/exploitation/`
- **P1-installation.md:** 15 `##` sections in the order the test requires.
  - **Volume chiffré:**
    - the `appsport-data` partition is created with `sgdisk`;
    - the LUKS phrase has **6 mots** at least;
    - `luksFormat` and `mkfs`;
    - `chattr +i /srv/appsport` comes before the first `mount /srv/appsport`;
    - crypttab: `appsport /dev/disk/by-partlabel/appsport-data none luks,noauto`;
    - fstab: `/dev/mapper/appsport /srv/appsport ext4 noauto,nofail 0 2`;
    - a check that writes fail (« Operation not permitted ») while the volume is closed.
  - **Docker:**
    - `daemon.json` and the drop-in are written before the install;
    - Docker is installed from its official apt repo;
    - `DockerRootDir` is checked to be `/srv/appsport/docker`;
    - `systemctl disable docker.service docker.socket`.
  - **Tailscale:**
    - in the console: DNS, HTTPS Certificates, and a tailnet name that never changes;
    - the policy is pasted in;
    - `tailscale up --ssh`;
    - key expiry is disabled;
    - `tailscale serve --bg --https=443 http://127.0.0.1:3000`;
    - `tailscale set --auto-update`;
    - the admin's own devices are connected;
    - the free-plan assumption (08 Risques) is checked.
  - **Pare-feu (ufw):** `IPV6=yes` in `/etc/default/ufw`, then deny by default, `allow in on tailscale0`, and 22/tcp from the LAN subnet only.
  - **Dépôt et secrets:**
    - a read-only deploy key;
    - `/root/.ssh/known_hosts` checked against the fingerprint published by GitHub;
    - the clone;
    - `ln -s /opt/appsport/infra/host/appsport-* /usr/local/sbin/`;
    - the host files installed from the repo (daemon.json, drop-in, apt `52appsport-unattended`);
    - `app.env` (APP_ORIGIN only at the socle);
    - `restic.pass`;
    - the GHCR login with `DOCKER_CONFIG`;
    - the repository variable `VITE_OWNER_FIRST_NAME`;
    - `chmod 600` on every secret.
  - **Dépôts restic:**
    - the `/srv/backup` disk (also `chattr +i`);
    - the B2 account in **EU Central**, with a key **limitée au bucket**;
    - `b2.env` with `RESTIC_OFFSITE_REPOSITORY`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`;
    - `init` for both repositories.
  - **Timers systemd:** the units are copied into `/etc/systemd/system`, then `enable --now` on the 4 timers.
  - **Healthchecks:**
    - the 4 checks with the exact strings `alive : 5 min, grâce 8 min`, `backup : 24 h, grâce 2 h`, `host : 24 h, grâce 2 h` and `restore-test : 35 j, grâce 3 j`;
    - `healthchecks.env` in mode 600, with the 4 URLs and `APPSPORT_URL`, plus `SMART_DEVICES` for a USB disk;
    - a first run of `appsport-check`.
  - **Initialisation de la base et invitation admin:**
    - the first version is published through P3, without `appsport-update`;
    - `git checkout vX.Y.Z`, then `APPSPORT_VERSION=vX.Y.Z`, then `pull app`;
    - `.appsport-volume` and `chown -R 1000:1000 /srv/appsport/data`;
    - `run --rm --no-deps … server.mjs init`, then `… server.mjs admin:bootstrap`, with the exact CLI messages;
    - the link and code stay on screen only.
  - **Premier déploiement:**
    1. `up -d` and `/api/health`.
    2. The admin account is created from the installed PWA.
    3. Only then `sudo appsport-unlock`. It is idempotent: it relaunches the missed backup and restore test. The restore test needs at least one user, so creating the admin first avoids a false « aucun utilisateur » alert.
    4. `curl` on the ts.net URL without `-k`.
  - **Recette:** the 11 criteria of 08 §13 as steps, each with its command, expected result and fallback, then step 12 → `recette-telephones.md`. Criterion 4 tests the sentinel on the host; the missing-database case is covered by the startup-guard tests. Criterion 8 covers the image-only rollback on the host; the rollback with a restore is covered by CI (update.bats, epoch E2E).
  - **Exercice de reconstruction:** links to the runbook, « avant la première invitation ».
  - **Enveloppe de secours:** P2 and P9 printed; a handwritten sheet with the phrase LUKS, the compte Unix, the mot de passe restic and the clé B2; sealed and datée; given to a trusted adult; dated in the password manager.
- **P2-deverrouiller.md:** `ssh appsport` (Tailscale SSH « check »), then `sudo appsport-unlock` → « OK : appsport répond (version vX.Y.Z). ». Otherwise « Phrase refusée. » or P8 « Déverrouillage en échec ». Lists the catch-up messages.
- **P3-deployer.md:**
  1. CI of `main` is green.
  2. The numbers on the Aide page are rechecked (`help-resources.ts`, `verifiedOn`).
  3. The phone acceptance checklist runs if `git diff` touches `src/sw`, the sync, `local-db` or `public`, or for iOS behaviour. It uses the PC's recette build behind its `tailscale serve`. Without it, no tag.
  4. `git tag`, then the `release` workflow (its 3 refusal messages are listed).
  5. `sudo appsport-update vX.Y.Z` in `tmux`, with `sessions:active` and its failure messages.
  6. A `deploy.log` table with the 6 results (`ok`, `pull-failed`, `backup-failed`, `rolled-back-image`, `rolled-back-restore`, `rollback-failed`).
  7. `--rollback`.
  8. A diff check of the host files installed under `/etc`. An expired GHCR token sends the admin to P5.
- **P4-restaurer.md:**
  - « Sur place »:
    1. The `reapply-pending` marker is checked (T43 note: a list is already pending, so jump to the reapply step).
    2. Choose the snapshot and its instant (mtime − 300 s, as `appsport-update` does).
    3. `privacy:collect --since … --out /data/ops/privacy-AAAAMMJJ.json` (`--source` the newest snapshot if the DB is unreadable).
    4. Set the marker.
    5. `stop app`.
    6. `restore`; the replaced DB is kept 30 days in `snapshots/replaced-…/`, and a wrong pick is redone from it.
    7. `privacy:reapply` (« Aucun administrateur actif » → `admin:bootstrap`).
    8. Delete the list and the marker.
    9. `up -d`.
    10. Check the 60-day resend (`db:stats` syncCounter, and each relative's pending counter).
  - « Nouvelle machine »:
    1. P1 up to the Tailscale package, then `systemctl stop tailscaled`.
    2. The restic and B2 secrets are typed in from the password manager.
    3. `restic restore latest --target /`, including `/var/lib/tailscale`, the secrets, the snapshots and `deploy.env`/`deploy.log`.
    4. Then `systemctl start tailscaled`; otherwise the console fallback and new share links.
    5. The rest of P1: no offsite `init`, and `healthchecks.env` rewritten.
    6. The image of the same version.
    7. The sentinel.
    8. `privacy:collect` with `--source`.
    9. The « Sur place » steps.
- **P5-rotation-secrets.md:**
  - the 08 §10 table, plus the Unix password row;
  - one section per secret: the Anthropic prod key (the 6 steps of 08 §10, `appsport-prod-AAAAMM`), the dev key, the GHCR token, the deploy key, the B2 key, the restic password (`key add --new-password-file`, swap, then `key remove`), the LUKS phrase (`luksAddKey`, test, then `luksRemoveKey`), the Unix password, the Healthchecks URLs and 2FA on the online accounts;
  - « Enveloppe refaite ».
- **P6-proches.md:**
  - adding a relative: the invitation through Administration → Invitations (MIN_AGE), the Tailscale share, the message, then the check;
  - removing a relative: revoke the share, then « Désactiver » or « Supprimer le compte »;
  - « son propre compte Tailscale » (P-MIN-4) and R-OPS-8.
- **P7-maintenance.md:**
  1. `apt full-upgrade`.
  2. A conditional reboot, then P2.
  3. Healthchecks and `status.json`.
  4. `sessions:active`, then `up -d --force-recreate app`: container logs stay at 90 days at most (R-OPS-15, 03 §7).
  5. Dependabot, then P3.
  6. Anthropic spend, SMART and `df`.
  7. A table of deadlines: GHCR, the annual keys, 2FA, the yearly exercise, 31-day snapshots, Node 26 after 28/10/2026, Debian 14 before 30/06/2030.
- **P8-incident.md:** one section per 08 §9 alert:
  - `alive` silence;
  - `alive` /fail, with a table of the motifs, `db:check`, `db:stats` and relaunch;
  - `backup`, with all the motifs of `appsport-backup` and a manual `snapshot`;
  - `restore-test`, with all the motifs of `appsport-restore-test`;
  - `host`, with all the problems of `appsport-check`.
  
  Further sections:
  - « Déverrouillage en échec », with every unlock KO message (T43 notes);
  - « Mot de passe admin oublié » (`admin:reset`);
  - « Interrupteur d'urgence »: `SW_KILL_SWITCH=1` in `secrets/app.env`, then `up -d app`, then `"swKill":true`; the fix through P3; then removal and `"swKill":false`;
  - « Vol, cambriolage ou fuite », following 03 §14: cut access, assess, rotate everything (P5), `admin:reset` and close sessions, warn within 72 h, then a row in `docs/incidents.md`.
- **P9-admin-indisponible.md:**
  - written for the trusted person, in plain language;
  - short absence: nothing to do;
  - long absence, as steps: open the envelope, log in at the keyboard, `sudo appsport-unlock`, relatives export (Profil → Confidentialité → « Télécharger mes données »), `sudo poweroff`, keep the envelope;
  - « Aucune invitation ni réinitialisation n'est possible sans admin. »
- **installer-appsport.md** (tutoiement, 08 §6 relative side, plus §11 on the admin's absence):
  - 6 steps, each with its line « Capture : à ajouter pendant P1 (captures/installer-0N.png). »;
  - « son propre compte Tailscale »;
  - « Sur l'écran d'accueil » and « Installer l'application »;
  - « VPN permanent » without « Bloquer les connexions sans VPN »;
  - Dépannage: « Site introuvable », the work VPN, a forgotten password, a lost phone.
- **recette-telephones.md:**
  - Préparation: build A and B on the PC, a recette server with its own DB behind `tailscale serve`, the PC shared for the duration of the recette, the PWA installed.
  - The 7 R-TST-4 controls, verbatim, as step titles (ruling C2). « sans objet au socle » appears only for controls 2, 4 and 5. Control 7 is timed.
  - On iPhone: « Interrupteur d'urgence » and « Bandeau de mise à jour ».
  - The 2 landscape items from the owner ruling of 2026-10-08, after the 7 controls (not instead of them).
  - The final table `| Date | Version | Appareil | Résultat |`.

### `infra/RUNBOOK-reconstruction.md`
- Timed, with a target of under 2 h, on another machine with Docker. It uses only the password manager, GitHub and B2.
- Steps:
  - a private folder;
  - `b2.env` and `restic.pass` from the password manager;
  - `restic snapshots`, then `restore latest`;
  - the image of the version in `deploy.env`;
  - a `data/` folder with the sentinel;
  - `privacy:collect --source`, then `restore`, then `privacy:reapply` (as in P4);
  - the app container with `--network none`, checked with `/api/health` and `db:stats`;
  - on the first exercise only, a check of the Tailscale identity (08 Risques: « déduite, pas vérifiée »);
  - « Détruire la copie »;
  - a row in the log.
- `## Journal des exercices` holds the table `| Date | Durée | Écarts constatés |`.

### `docs/fiche-de-traitement.md`
- Version 1.0 (`PRIVACY_POLICY_VERSION`).
- Sections: Responsable (the owner; the first name only through `VITE_OWNER_FIRST_NAME`), Finalités, Personnes concernées, Catégories de données (C0 to C3 table, P-ADM-3), Destinataires (Anthropic, Backblaze, Tailscale), Transferts hors UE, Durées de conservation (the 03 §7 table) and Mesures de sécurité (03 §9, §10).
- It names `privacy-content.ts` as the source it feeds. I checked it against the T28 page (durations, what the admin sees, where the data lives).

### `docs/incidents.md`
- The 03 §14 instructions (72 h), the test's header, and « Aucun incident enregistré. ».

### `apps/server/test/infra/docs.test.ts` (50 tests)
Helpers: `proseLines` (aware of fenced blocks, indented ones included), `sections`, `steps` and `expectInOrder` (the first occurrence of each string, strictly increasing).

The tests check:
- **Format of P1 to P9:** each page has its `# Pn` title, « Quand : », « Durée : », a code block, and every `N. **…**` step has « Résultat attendu : » and « Sinon : ». The same step check applies to the relatives' sheet, the phone checklist and the runbook.
- **Commands:**
  - the 6 scripts;
  - the 10 `server.mjs <cmd>` commands, with the brief's regex;
  - every `docker compose` line in a code block carries the host-script prefix;
  - every compose CLI call uses `exec -T` or `run --rm --no-deps`.
- **P1:**
  - the list of headings;
  - each decided string in its own section;
  - chattr before mount;
  - known_hosts against the fingerprint published by GitHub;
  - the 4 Healthchecks strings;
  - the first-install order, plus the exact `run --rm --no-deps` init and bootstrap commands, and no `appsport-update`;
  - Recette: at least 12 steps, with `recette-telephones.md` after the 11th;
  - the exercise;
  - the envelope.
- **P2 to P9:**
  - P2 order;
  - P3: the 5 items before `git tag`, the order `git tag` < `release` < `sudo appsport-update vX.Y.Z` < `deploy.log`, the 6 table rows, `--rollback`, and the expired GHCR token → P5;
  - P4 « Sur place » order, plus `--source`, `replaced-`, « Aucun administrateur actif », `reapply-pending` and 60 days; « Nouvelle machine » order;
  - P5 strings;
  - P6;
  - P7;
  - P8: the 4 alert sections, the kill-switch order, and the theft section;
  - P9.
- **The relatives' sheet:** the strings, and one capture line per step, numbered to match the step.
- **The phone checklist:**
  - the 7 RTST4 controls are present in `01-architecture.md` (verbatim guard) and are step titles;
  - no « sans objet au socle » outside controls 2, 4 and 5;
  - iPhone, Android, the kill switch, the banner, the table, and `/chronom/i`.
- **The runbook:** its required strings.
- **The processing record:**
  - the 8 headings in order;
  - the words C0 to C3, Anthropic, Backblaze, Tailscale and « 30 jours »;
  - `Version ${PRIVACY_POLICY_VERSION}`, imported from `@appsport/contracts`;
  - `privacy-content.ts`.
- **The incident register:** its content.
- **Hygiene:**
  - every `*.ts.net` ends with `<tailnet>.ts.net` or `*.ts.net`;
  - no `ghp_`, `github_pat_`, `tskey-`, Anthropic key prefix, or Healthchecks UUID;
  - relative links resolve.
- **Old TCA number (ruling C5):**
  - the pattern is built with `['0810','037','037'].join('[ .]?')`;
  - the scan walks the repo and skips `node_modules`, `.git`, `dist`, `.e2e-data`, `test-results`, `playwright-report`, `docs/research`, `docs/superpowers` and `.superpowers`, plus binary files (a NUL byte).

The brief's separate assertion « moins de 2 minutes hors écran Santé » is dropped (ruling C2). The 7th control carries « moins de 2 min, hors écran Santé ».

## TDD evidence

**RED.** I wrote the test first and ran it before any document existed:
```
$ pnpm --filter @appsport/server test infra/docs
 FAIL  |server| test/infra/docs.test.ts [ apps/server/test/infra/docs.test.ts ]
Error: ENOENT: no such file or directory, open 'C:\Users\eliott.colin\appsport-ops\docs\exploitation\P1-installation.md'
 ❯ read test/infra/docs.test.ts:8:40
 ❯ doc test/infra/docs.test.ts:25:39
 Test Files  1 failed (1)
      Tests  no tests
```
This is the failure the brief expects: the suite reads the documents at collection time, and none existed yet.

**GREEN.** After writing the documents:
```
$ pnpm --filter @appsport/server test infra/docs
 Test Files  1 passed (1)
      Tests  50 passed (50)
```

**The test catches real breakage.** The first green run happened with no correction, so I checked the test with a mutation script, kept in the scratchpad and not committed. It applies one change to a document, runs the suite, then restores the file. It ran 27 mutations, and the suite failed on every one:
- a step with no « Sinon »;
- chattr after mount;
- a P1 section renamed;
- `appsport-update` in the first install;
- `server.mjs init` before the pull;
- a wrong grace period;
- the P2 OK message;
- `git tag` before the checks;
- a `deploy.log` result missing;
- `up -d` before the reapply;
- tailscaled started before the restore;
- `up -d app` without `--force-recreate`;
- `"swKill":false` before `true`;
- a compose line without the prefix;
- a CLI call with neither `exec` nor `run`;
- the P9 sentence missing;
- an RTST4 control reworded;
- « sans objet au socle » on control 1;
- a capture line missing;
- a capture line misnumbered;
- the runbook journal heading changed;
- the processing record at version 2.0;
- the incident sentence missing;
- a real tailnet name;
- a broken link;
- the old number in `docs/incidents.md`;
- the old number in a temporary text file outside `docs/`.

Every file was restored, and the final run passed.

## Full checks
- `pnpm lint`: `Checked 444 files … No fixes applied.` I fixed one formatting issue (`biome format`) and an unused constant first.
- `pnpm typecheck`: exit 0.
- `pnpm test`: `Test Files 162 passed (162)`, `Tests 1965 passed | 2 skipped (1967)`, exit 0. The 2 skips predate this task, and vitest's happy-dom performance notice predates it too.
- I did not run bats: no script changed. Docker is not available locally.
- `git show --stat HEAD`: `d8f35a2`, 15 files, +3191, all added: the 11 `docs/exploitation/*.md`, `docs/fiche-de-traitement.md`, `docs/incidents.md`, `infra/RUNBOOK-reconstruction.md` and `apps/server/test/infra/docs.test.ts`. `git status` is clean. Nothing was written under docs/superpowers, docs/research or docs/adr.

## Files changed
- A `apps/server/test/infra/docs.test.ts`
- A `docs/exploitation/P1-installation.md`, `P2-deverrouiller.md`, `P3-deployer.md`, `P4-restaurer.md`, `P5-rotation-secrets.md`, `P6-proches.md`, `P7-maintenance.md`, `P8-incident.md`, `P9-admin-indisponible.md`, `installer-appsport.md`, `recette-telephones.md`
- A `docs/fiche-de-traitement.md`, `docs/incidents.md`
- A `infra/RUNBOOK-reconstruction.md`

## Self-review (fixes made before the commit)
- `journalctl` on system units needs root or the `adm` group, which Debian's first user does not have. Every call is now `sudo journalctl`.
- `git -C /opt/appsport` run by a non-root user hits git's « dubious ownership » check, because the repo belongs to root. P3 now uses `sudo git`.
- P7: the reboot is conditional (`if [ -e /var/run/reboot-required ]; then sudo reboot; …`), so pasting the block can never reboot by accident. The `sessions:active` check sits in its own block before `--force-recreate`.
- P5: the `git grep` for a leaked Anthropic key no longer contains the literal key prefix, which the hygiene test forbids.
- P1: the expected `lsattr` output is now « contains an `i` », because the exact attribute string varies.
- P8: a `|` inside a table cell (`dmesg | tail`) would have broken the table. It is now `dmesg --level=err,warn`.
- P4 « Nouvelle machine »: the restored secrets are not recreated (they are rotated through P5 after a theft), and root's `known_hosts` is redone.

## Process note
While editing P7 I used a bash `node -e "…"` command that contained Markdown backticks inside double quotes. Bash ran them as command substitutions on this Windows workstation: an `ls /var/run/reboot-required` and a `sudo reboot`. Windows refused the `sudo` (« Sudo est désactivé sur cet ordinateur »), so nothing happened. The only side effect was one bad line in P7, which I fixed. `git status` showed no other change. I then made every later edit with the Edit tool.

## Concerns
1. **Docker Engine 29 and the containerd image store (to confirm on the host).** As far as I know, recent Docker Engine makes the containerd image store the default on fresh installs. Images and layers would then sit under `/var/lib/containerd`, on the unencrypted disk, while container logs stay in `data-root`. Images hold no personal data, and the app container is `read_only` with `/data` bind-mounted. P1 recette criterion 5 (the witness string on the unencrypted disk) would catch a leak. If the owner wants everything under `/srv/appsport`, T44's `daemon.json` would need `"features": {"containerd-snapshotter": false}` or containerd's root moved. I did not touch infra files.
2. **P9 and backups after a definitive shutdown.** When the server is switched off for good, the nightly `forget` stops. The encrypted offsite and local backups then outlive the 30-day limit (03 §7). The spec does not say who erases them, so I added nothing.
3. **Recette build on the PC (P3, recette-telephones).** R-TST-4 asks for relatives' phones. To reach the PC's `tailscale serve`, the PC is shared with the testing relatives for the recette only, then the share is revoked. The policy gives `autogroup:shared` only tcp:443. This is my reading of « build de recette du poste, via son tailscale serve ».
4. **Runbook step 11 (Tailscale identity check).** It is an addition that answers 08 Risques (« à valider lors de l'exercice R-OPS-12 »). It requires stopping tailscaled on the real server, so it is limited to the first exercise, before any invitation, on a spare Linux machine.
5. **Systemd units are copied into `/etc/systemd/system`, not linked.** `appsport-update` updates the scripts (links into the repo) but not the copies under `/etc`. P3 step 10 diffs `infra/systemd|docker|apt|tailscale-policy` between versions and tells the admin to reinstall.
6. **`ANTHROPIC_API_KEY` is absent from `app.env` at the socle** (the key is read but unused). P1 says the `appsport-prod-AAAAMM` key arrives with brick 4 through P5. Step 4 of the P5 Anthropic section (the coach test message) is marked « sans objet avant la brique 4 ».
7. **The test reads `docs/superpowers/specs/…/01-architecture.md`** to prove that the 7 RTST4 controls are verbatim. A later edit of that spec section would fail this test, and that is intended.
8. **The processing record and the Privacy page (T28 `privacy-content.ts`)** are consistent today. The page text is still flagged in the ledger for the owner's review before go-live. Any substantive change must update both, plus `PRIVACY_POLICY_VERSION`.

---

## Fix report, round 1: integration of the four fix groups (2026-10-12)

Integrated on `socle-ops` in `C:\Users\eliott.colin\appsport-ops`, from `d8f35a2`, by `git cherry-pick d8f35a2..<branch>` in group order (linear history, no merge commits):

| Commit | Origin | Subject |
|---|---|---|
| `528fc75` | g1 `c870ae3` | docs(docs): procédures, recette, runbook et registres corrigés après la revue de la tâche 45 |
| `3e0a919` | g2 `1f7f688` | test(docs): procédures contrôlées page par page et dans l'ordre, fiche alignée sur 03 §7, registre des incidents prêt pour sa première ligne |
| `b9ad645` | g3 `88c531a` | docs(docs): P4 et P8, restauration sans retour de données, alertes et incidents (revue T45, groupe 3) |
| `db813c4` | g4 `6decc91` | docs(docs): P1 et P3 corrigés après revue (secrets en place, recette, reprise après rollback-failed) |
| `683421a` | integration | fix(docs): intégration des corrections de la tâche 45, sondes de santé et conduite d'incident alignées |

Round diff `d8f35a2..683421a`: 14 files, +1498 / −272 (`docs.test.ts`, P1–P8 except P9, installer, recette, fiche, incidents, runbook). `privacy-content.ts`, specs and infra scripts are untouched.

### Group 1 (F71, F70, F21, F63, F57, F16, F74, F35, F34, F31, F30, F73, F38, F20, F7, F5, F69, F62, F76, F39, F6)
- F6: every `/api/health` probe after `up -d` / `--force-recreate` waits (`curl -fsS --retry 60 --retry-delay 2 --retry-all-errors`, « en 2 minutes au plus ») in P4, P5, P7 and P8. Runbook step 10 uses a `for i in $(seq 60)` loop.
- F71 (P5):
  - manual restic gets `--cache-dir /srv/appsport/cache/restic`;
  - the dev key is checked from the PC (`/v1/models`, 200 or 401), then the old key is revoked;
  - the Unix password section refreshes the manager, then redoes the envelope.
- F70: the deploy key rotation has 4 steps: Add deploy key, `git fetch` with the new key, `mv`, delete the old key.
- F21: the Healthchecks rotation creates new checks, runs `sudoedit` (4 lines), pings all four, then deletes the old checks.
- F69:
  - P2 step 2 « Sinon » covers 4 cases;
  - P2 step 3 shows unit status and journal;
  - the P8 unlock table gets a disk-error row.
- F63 / F57:
  - installer wording (« consulter et saisir », sync and coach blocked);
  - both MagicDNS settings;
  - login screen → « J'ai un code d'invitation » (label checked in LoginPage.tsx).
- F16:
  - P1 « Recette » step 13 makes the 6 masked captures with a test identity;
  - P6 sends the installer page as a PDF;
  - the installer test accepts either the placeholder or the image.
- F62: P6 uses the real « Supprimer » labels and the last-admin error (checked in MembersPage.tsx and ui/errors.ts).
- F74 / F35 / F34 / F30 (fiche):
  - measures (tailscale serve only, SSH, 127.0.0.1, certificate logs, HSTS/CSP, `coach_report`, spending limit, outbound flows);
  - the P-COA-1 sent list (« jamais l'âge exact »);
  - 03 §2 categories and the P-LOG-1 fields;
  - retention rows for `account_deleted`, tombstones and `applied_op`.
- F31 / F76: incidents.md and P8 step 6 record categories, never contents and never pseudos; GitHub history is called out.
- F73 / F38 / F20 / F7 / F5: recette-telephones rewritten:
  - relatives' phones only, fictitious data, P1 and P3 cases;
  - clean build dirs with `a/content`/`b/content`, PC renamed `recette`;
  - init/bootstrap refusals, the banner-control note, and a « Fin de la recette » cleanup section.
- F39 (runbook):
  - B2 keys only in a `( set -a; … )` subshell;
  - the secrets listing is checked;
  - the Tailscale put-back is step 12, the destroy step 14 checks `.avant-exercice`, and the steps are renumbered.
- Tests: 18 new (68 in the file on its branch), full server package 645 passed | 2 skipped.

### Group 2 (F49, F48, F47, F45, F44, F43, F40, F29, F12, F11, F10, F9)
- F10:
  - CLI state is tracked per section (after `stop`/`down` → `run --rm --no-deps app`, after `up -d` → `exec -T app`);
  - P8 theft « Fermer les sessions » revokes the shares, then runs `up -d app` before `exec -T … admin:reset`, with a « Sinon » for `service "app" is not running`.
- F12:
  - fiche retention labels equal 03 §7 labels in order, with durations prefixed by the spec's;
  - two-way duration cross-check with `privacy-content.ts` (the `account_deleted` row is exempt: anonymised sessions);
  - the fiche rows are aligned verbatim.
- F29: incidents.md gets a row template and the « retirer la phrase » instruction; the `incidentProblems` helper is tested on synthetic registers.
- F47: fences are even per page, and every numbered prose line is a `N. **…**` step.
- F48: order checks for the P1 chown, ufw/IPV6, the Docker drop-in, P6 add/remove and installer §11.
- F45: the P3 recette « Sinon » says « pas de tag », and the `git diff` paths exist.
- F44: both alive titles are present, and the kill-switch order is checked.
- F43: VPN permanent **sans** « Bloquer… ».
- F11: R-TST-4 controls come from their own section; checks for chronométrage, the iPhone kill-switch and banner, and landscape last.
- F9: P4 « Sur place » full order and marker removal; « Nouvelle machine » restores tailscale before starting it; off-site `restore latest` in the runbook.
- F49: patterns forbidden for Healthchecks/B2 secrets; placeholders required in code blocks.
- F40: `textFiles()` uses `git ls-files -z`.
- Tests: 6 new (56 in the file on its branch), full server package 633 passed | 2 skipped. Mutation evidence is in the group's notes.

### Group 3 (F52, F51, F50, F28, F27, F23, F4, F1, F54, F53, F37, F26, F25, F24, F3)
- F1 / F50:
  - snapshot copies keep their date (`install -p`, `cp -p`);
  - the collection instant is never the current time;
  - « Nouvelle machine » step 8 computes the instant (`stat -c %Y … - 300`).
- F23: P4 step 1 reads the state (`find … -newer reapply-pending`) before branching.
- F28: new P4 step 3 puts back `v<précédente>` (deploy.env and checkout) when restoring `pre-vX.Y.Z`. « Sur place » now has 11 steps.
- F27: the stop step checks with `ps`; « Nouvelle machine » step 9 = « Étapes 5 à 10 de « Sur place » ».
- F51: case « Un administrateur existe déjà » (disabled admin, no CLI to reactivate): finish P4, then open an issue.
- F4: « Nouvelle machine » preamble after a theft (P8 step 1 first, no old Tailscale identity); old system disk wiped after a breakdown.
- F52: « Nouvelle machine » checks out the restored version right after the clone.
- F24: 6 unlock motifs in P8 alive /fail; a test extracts every Healthchecks motif from the 5 scripts.
- F25: alive /fail step 2 reads `reapply-pending`; every `up -d` in alive /fail and unlock failure is guarded by `test ! -e /srv/appsport/reapply-pending &&`.
- F37: unlock failure stops Docker before umount/close.
- F53: restore-test checks both repositories and moves a damaged repository aside before `init`.
- F54: alive silence step references fixed; incident PR done on the PC.
- F26: theft order is cut, assess, **notify within 72 h of discovery**, rotate, close sessions, record (03 §14).
- F3: sessions really closed (« Fermer les sessions », « Déconnecter tous mes appareils »); a link alone closes nothing.
- Tests: 14 new (64 in the file on its branch), full server package 641 passed | 2 skipped.

### Group 4 (F61, F60, F59, F56, F55, F14, F13, F8, F2, F68, F67, F66, F65, F64, F19, F18, F17)
- F14: `partx -u /dev/<disque système>`; header declares `<disque système>` and `<disque de sauvegarde>`.
- F61: `Host appsport` in `~/.ssh/config`; real cryptsetup message; secrets-only header rule.
- F8: every secret under `/srv/appsport/secrets` is edited with `sudo nano` (P1, P4, P5); `sudoedit` is kept only for healthchecks.env and crypttab/fstab; a test forbids `sudoedit /srv/appsport/secrets`.
- F2: SMART_DEVICES is quoted, with a bash-parse error « Sinon ».
- F59: expected alerts listed before the first deploy.
- F56: `ls -lan` (P1 init 5, P4 « Nouvelle machine » 7).
- F55: full `admin:bootstrap` command in the « Sinon ».
- F13 (recette 4): never type the LUKS phrase; `--no-ask-password` start and cleanup, ~90 s failure; marked PLAUSIBLE until run on the host.
- F60: recette 8 uses `vX.Y.Z+1` and redeploys it.
- P3:
  - F66: verifiedOn PR first, then CI on the `<commit candidat>`, recette and tag on that commit;
  - F19: recette diff paths widened;
  - F65: VITE_OWNER_FIRST_NAME;
  - F67 / F17: answer `N` on sessions, no Ctrl+C, `tmux attach`, new step 11 to recover after « suivez P4. » or `rollback-failed`;
  - F18: a conduct for every refusal message, cross-checked against the script;
  - F64: the bare `logs --tail 200` is removed, replaced by CI or runbook reproduction;
  - F68: `--name-status`, `infra/host`, Docker restart, script links.
- Tests: 22 new (72 in the file on its branch), full server package 649 passed | 2 skipped.

### Conflicts resolved (both fixes kept working)
1. **g2 on g1, `docs.test.ts`, installer test.** Kept g2's two assertions, then g1's capture comment.
   - g2's §11 assertion looked for the old sentence « la synchronisation attend son retour ». g1 (F63) had replaced that sentence with the 08 §11 wording.
   - The assertion is now `/la synchronisation et le coach[^\n]*restent bloqués jusqu'à son retour/`. It still fails if the paragraph is removed (g2's mutation).
2. **g2 on g1, `docs/fiche-de-traitement.md`, retention table.** Took g2's verbatim 03 §7 rows and kept g1's `applied_op` row, after the tombstones row.
   - g1's `applied_op` row is not in 03 §7, so g2's strict « same labels, same order » test would have failed. That test now ignores the rows listed in an explicit `FICHE_ONLY` map (the `applied_op` label, source R-SYN-23). Each listed row must still be present. The remaining labels must equal 03 §7, in order.
   - The page cross-check skips `FICHE_ONLY` rows. Every other fiche label must now be a key of `ON_PAGE`.
   - g1's exact-cell assertion `| Sessions \`account_deleted\` | jusqu'à leur expiration absolue |` lost its trailing ` |`, because g2's row continues with « ; anonymisées … (P-DRT-3) ».
3. **g3 on g1+g2, P4 « Sur place » restart step.** g3's number (10) and indentation, with g1's waiting `curl` and « en 2 minutes au plus ».
4. **g3 on g1+g2, P8 alive /fail step 4.** g3's guard `sudo test ! -e /srv/appsport/reapply-pending && … up -d`, followed by g1's waiting `curl`. Both texts are kept.
5. **g3 on g1+g2, P8 theft « Fermer les sessions » (now step 5).**
   - g3's intro, bullets, expected result and order, with g2's paragraph that revokes the shares and restarts `app` placed before the bullets.
   - The code block keeps g2's `up -d app` before `exec -T … admin:reset`, which g2's CLI-state test requires after `stop app` at step 1.
   - The « Sinon » joins g2's `service "app" is not running` and g3's 24 h link case.
   - g1/g2's old step 5 (notify) is dropped: g3 moved it to step 3. g1's step 6 (categories, no pseudo) and g3's « Sur le PC » line were auto-merged.
6. **g3 on g1+g2, `docs.test.ts` (no textual conflict, semantic break).**
   - g3's « Nouvelle machine » preamble quotes `--include /var/lib/tailscale` in prose. g2's test took the first matching line, which was prose.
   - The line lookup and the order check now run on `codeOf(body)`: commands only. g2's mutations (restore after start, `restore <id>`) are still caught. This fix is inside `b9ad645`.
7. **g4 on g1–g3, P4 « Quand ».** Joined g4's « d'abord P3, étape 11 » and g3's « après un vol, P8 … étape 1, d'abord ».
8. **g4 on g1–g3, P5 « Clé B2 » step 2.** g4's `sudo nano` (F8), with g1's `--cache-dir /srv/appsport/cache/restic` (F71).
9. **g4 on g1–g3, `docs.test.ts`, P3 tests.** Kept g2's « recette en échec, pas de tag ; chemins du git diff », then g4's `p3Step` helper and its 8 P3 tests. The P4 « Sur place » test keeps g2's title.

### Integration fixes (`683421a`, Refs #46)
- **Health probes.** g4 added two probes after `up -d` with its own retry flags: P1 « Recette » 4 (`--retry 10 --retry-connrefused --retry-delay 3`) and P3 step 11 (`--retry 20 --retry-connrefused --retry-delay 6`). g1's R-OPS-6 test failed on them.
  - RED: `Tests 1 failed | 109 passed (110)`, « P1-installation: expected '   curl -fsS --retry 10 --retry-connr…' to match /--retry 60 --retry-delay 2 --retry-al…/ ».
  - Both now use g1's form, with « en 2 minutes au plus » in the expected result.
- **Incident conduct order.**
  - g1 wrote incidents.md as cut, assess, rotate, notify, record (08 §12 order).
  - g3 (F26, the controller's 03 §14 ruling) made P8 cut, assess, notify, rotate, close sessions, record.
  - incidents.md now follows P8: notify within 72 h after discovery, without waiting for rotation or rebuild; then rotate (P5) and redo the envelope; close sessions; record.
  - New test « registre des incidents : la conduite reprend les étapes de P8 … dans le même ordre »: each numbered line of incidents.md must start with the matching P8 theft step title, with the same count.
  - RED: `expected [ …(5) ] to have a length of 6 but got 5`. GREEN after the edit.
- Lint: I first wrote the new test with an arrow `forEach` that returned a value (biome `useIterableCallbackReturn`), then rewrote it as a block.

### Final checks (on `683421a`)
- `pnpm --filter @appsport/server test infra/docs`: `Test Files 1 passed (1)`, `Tests 111 passed (111)` (50 original + 18 + 6 + 14 + 22 + 1 integration).
- `pnpm lint`: `Checked 444 files in 287ms. No fixes applied.`, exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm test`: `Test Files 162 passed (162)`, `Tests 2026 passed | 2 skipped (2028)`, exit 0. The 2 skips and the happy-dom performance notice predate this round.
- `pnpm --filter @appsport/server test`: `Test Files 74 passed (74)`, `Tests 688 passed | 2 skipped (690)`.
- bats was not run: no infra script changed.
- Cross-references checked by hand after integration:
  - every « P3, étape N », « P4, « Sur place », étape N » and « P8 … étape N » reference across the docs points to the right step;
  - the runbook's internal step references (6, 8, 12, 14) match its renumbered steps;
  - no `sudoedit /srv/appsport/secrets` remains.
- `git status`: clean. `git show --stat HEAD`: `683421a`, 4 files (+22 −7): `docs.test.ts`, `P1-installation.md`, `P3-deployer.md`, `incidents.md`.
- Cleanup:
  - `git worktree remove --force` on the 4 fix worktrees;
  - their leftover ignored `node_modules` folders deleted with `rmdir /s /q`, which does not follow junctions;
  - branches `fix/T45-r1-g1..g4` deleted (`-D`: cherry-picked, so not merged by SHA);
  - `git worktree list` now shows only appsport, appsport-infra, appsport-ops and appsport-pwa.

### Open points for the controller
1. **F51, product follow-up.** No CLI command reactivates a disabled admin, and `admin:reset` does not either. P4 documents the issue route. A code change is needed: a reactivate command, or `admin:reset` reactivating the account.
2. **T28 page review (F35, F12).**
   - The Privacy page has no rows for `account_deleted` sessions or `applied_op` (both exempted in the cross-check, with reasons).
   - The page also lacks: the US location of Tailscale and Backblaze, the full C1 and C2 lists, Tailscale coordination under « Où », and the age_band list.
   - `PRIVACY_POLICY_VERSION` is to be decided at that review. The fiche stays at 1.0.
3. **F76.** It is still open whether a CNIL notification (art. 33, 72 h) is expected, since the fiche does not rely on the household exemption. Nothing was added.
4. **Restic cache.** `--cache-dir` is still missing on the manual `restic -r` commands in P1, P4, P7 and P8. Only P5 is covered (g1 note 3).
5. **P1 « Recette » 4.** `logs --tail 5` still runs right after `up -d --force-recreate` without waiting (g1 note 4). The recette 4 commands are marked PLAUSIBLE until run on the host (g4, F13).
6. **F56 side note.** UID 1000 is also the admin's Debian account, so that account can read `/srv/appsport/data` without sudo. This is a design point for R-OPS-3.
7. **P8 theft, step 5.** When `app` was stopped, the relatives' shares are revoked before the sessions are closed. No step re-shares the machine afterwards, so relatives cannot use their reset links until someone does. This came in with g2; flagged, not changed.

## Fix report, round 2: P3 git diff paths (T45-F45, T45-R1-1) (2026-10-12)

Branch `socle-ops`, worktree `C:\Users\eliott.colin\appsport-ops`, from `683421a`. One commit:

| Commit | Subject |
|---|---|
| `45d6247` | test(docs): chemins du git diff de P3 lus sur la commande entière, continuations jointes (Refs #46) |

Only `apps/server/test/infra/docs.test.ts` changed (+12 −3). No document under `docs/` changed: P3 was already right.

### Findings
- **T45-R1-1 (Important), confirmed.** Since g4 (F19), the P3 step 3 `git diff --stat … -- \` command spans 6 lines. The test took the first code line matching `/git diff .* -- /` and split it after ` -- `, so the only "path" was the continuation backslash.
  - A simulation script (scratchpad) on the HEAD P3 gave `old extraction: ["\\"]`.
  - With `path.win32.join` it gave `C:\Users\eliott.colin\appsport-ops\`, which exists, so the check passed without testing anything.
  - With `path.posix.join` (ubuntu-latest) it gave `<root>/\`. On Linux the backslash is an ordinary filename character, so that file does not exist and the test fails. CI on `main` would have been red.
- **T45-F45 (Minor).** Both assertions were added in round 1 (g2). The `Sinon :… pas de tag` assertion still worked. The path check was the one broken by R1-1, and it is fixed here. Both are now proven by mutation (below).

### Change
In the test « P3 : recette en échec, pas de tag ; les chemins comparés par git diff existent »:
- the paths now come from the code block of the recette step (the step whose body cites `recette-telephones.md`) that contains `git diff --stat`;
- continuation lines are joined first (`replace(/\\\r?\n\s*/g, ' ')`), then the paths after ` -- ` are read;
- new guards, so the check cannot pass vacuously again: no extracted path contains a backslash, and there are exactly 16 paths;
- unchanged: `existsSync(join(ROOT, path))` for each path, and `/Sinon :[^\n]*pas de tag/` on the recette step.

### TDD evidence
- **RED.** I added the two guards and kept the old extraction. `pnpm --filter @appsport/server test infra/docs -t 'pas de tag'`:
  - `AssertionError: un chemin vaut « \ » : ligne de continuation lue comme chemin: expected [ '\' ] to not include '\'`;
  - `Tests 1 failed | 110 skipped (111)`, exit 1.
  - This is the expected failure: the extraction returns only the backslash.
  - The guard was then widened to "no path contains a backslash", which the GREEN version uses.
- **GREEN.** With the joined-block extraction, same command: `Tests 1 passed | 110 skipped (111)`.
- **Mutations of P3.** Each was run with the same command, then reverted with `git checkout` on the one file:
  - M1, `apps/web/src/local-db` renamed to `apps/web/src/localdb`: `chemin du git diff : apps/web/src/localdb: expected false to be true`, 1 failed;
  - M2, `packages/contracts/src/entity-rules.ts` dropped: `les 16 chemins de l'étape 3: expected [ 'apps/web/src/sw', …(14) ] to have a length of 16 but got 15`, 1 failed;
  - M3, « Sinon : recette en échec : pas de tag » changed to « taguer quand même »: `expected '…' to match /Sinon :[^\n]*pas de tag/`, 1 failed.
- **Linux simulation.** The new extraction gives 16 paths, and each `path.posix.join(<root>, path)` exists. `git ls-files` shows tracked files under all 16 paths, so a fresh CI checkout has them.

### Checks (on `45d6247`)
- `pnpm --filter @appsport/server test infra/docs`: `Test Files 1 passed (1)`, `Tests 111 passed (111)`.
- `pnpm lint`:
  - first run: 1 format error, the `codeBlocks(…).find(…)` line was too long; I applied biome's layout by hand;
  - rerun: `Checked 444 files in 251ms. No fixes applied.`, exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm test`: `Test Files 162 passed (162)`, `Tests 2026 passed | 2 skipped (2028)`, exit 0. No warning in the log (deleted afterwards). The 2 skips predate this round.
- `git show --stat HEAD`: `45d6247`, `apps/server/test/infra/docs.test.ts | 15 ++++++++++++---`.
- `git status`: clean.
- Review package: `.superpowers/sdd/2026-10-06-socle/review-683421a..45d6247.diff`. It is git-ignored.

### Notes
- The 16-path count is deliberate (fix asked for it). Adding or removing a path in P3 step 3 means updating that number in the test.
- The test « P3 : recette décidée sur tout ce qui construit, sert ou démarre le SW » checks its 11 paths by name in the step body. It was never affected by R1-1.
