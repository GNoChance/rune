### Task 43: appsport-unlock et appsport-update

**Files:**
- Create: `infra/host/lib/common.sh`, `infra/host/{appsport-unlock, appsport-update}`, `infra/host/test/{helpers.bash, stub.sh, defaults.bash, unlock.bats, update.bats}`, `apps/server/src/ops/active-sessions.ts`
- Modify: `apps/server/src/cli.ts` (`sessions:active`), `package.json` racine (`test:infra: "bats infra/host/test"`, dev `bats` 1.x), `.github/workflows/ci.yml` (job `infra`)
- Test: `apps/server/test/ops/active-sessions.test.ts`, `infra/host/test/{unlock,update}.bats`

**Interfaces:**
- Consumes : T40 (`snapshot`, `restore`) ; T24 (`privacy:collect` en lecture seule, `privacy:reapply`) ; T41 (`infra/compose.yaml`) ; T6 (`HealthResponse.version`) ; T12 (`OpsStatus`) ; support serveur.
- Produces : Interfaces partagées §8 (`listActiveWorkoutSessions` : `[]` sans table `workout_session` ; sinon `in_progress`, non supprimées, démarrées depuis moins de `maxAgeHours`, triées ; CLI `sessions:active [--hours N]` → une ligne `<pseudo>\t<startedAt>` par séance, code 0) et `infra/host/lib/common.sh` :
  - variables par défaut (`: "${X:=…}"`) des Interfaces partagées §8, plus `SYSTEMCTL=systemctl`, `MOUNT=mount`, `MOUNTPOINT=mountpoint`, `GIT=git`, `SLEEP=sleep`, `DF=df`, `SMARTCTL=smartctl`, `CHOWN=chown`, `LUKS_DEVICE=/dev/disk/by-partlabel/appsport-data`, `LUKS_NAME=appsport`, `HEALTH_TIMEOUT_S=120`, `HEALTH_POLL_S=2`, `TAILSCALE_STATE=/var/lib/tailscale`, `REBOOT_REQUIRED_FILE=/var/run/reboot-required`, `FLOCK=flock`, `LOCK_FILE=/run/appsport.lock`, `SMART_DEVICES` (disques de `lsblk -dno PATH,TYPE`) ; exportés : `DOCKER_CONFIG=$APPSPORT_ROOT/secrets/docker`, `RESTIC_PASSWORD_FILE=$APPSPORT_ROOT/secrets/restic.pass`, `RESTIC_CACHE_DIR=$APPSPORT_ROOT/cache/restic`, `GIT_SSH_COMMAND="ssh -i $APPSPORT_ROOT/secrets/deploy_key -o IdentitiesOnly=yes"` ; `APPSPORT_VERSION` n'est **jamais** exportée ; variables de `HC_ENV` et `b2.env` : Interfaces partagées §8 ;
  - fonctions : `log`, `die <msg> [code]`, `now_iso` ; `take_lock` (`exec 9>"$LOCK_FILE"` puis `$FLOCK -n 9`, 1 si occupé) ; `compose` = `$DOCKER compose --project-name appsport -f "$APPSPORT_REPO/infra/compose.yaml" --env-file "$APPSPORT_ROOT/deploy.env" "$@"` ; `app_running` ; `app_cli` (forme `exec -T` de §8 si en marche, sinon `app_cli_run`) ; `app_cli_run` (forme `run --rm --no-deps`) ; `volume_mounted` ; `sentinel_present` ; `health_json [max_s]` (`$CURL -fsS --max-time "${1:-5}" "$HEALTH_URL"`) ; `wait_health [version]` (`HEALTH_TIMEOUT_S / (2 × HEALTH_POLL_S)` essais de `health_json "$HEALTH_POLL_S"` puis `$SLEEP "$HEALTH_POLL_S"` : 2 min au plus ; `.status=="ok"` et version) ; `hc_ping <alive|backup|restore-test|host> [ok|start|fail] [motif]` (`$CURL -fsS -m 10 --retry 3 -o /dev/null [--data-raw motif] <url>[/start|/fail]`, **URL en dernier**, URL absente → avertissement et 0) ; `ensure_ops_dir` (`mkdir -p data/ops`, `$CHOWN 1000:1000`, `chmod 0750`) ; `status_merge <section> <json>` (`ensure_ops_dir`, temporaire `mktemp` dans `data/ops`, `jq --arg k --argjson v '.[$k]=$v'`, `chmod 0640` et `$CHOWN 1000:1000` **avant** `mv`) ; `restic_on <local|offsite>` (offsite : `b2.env` lu dans un sous-shell, `-r "$RESTIC_OFFSITE_REPOSITORY"`) ; `restic_backup_all <tag>` (local puis offsite, `--exclude "$APPSPORT_ROOT/data/appsport.db*"`, sauvegarde de `data/snapshots`, `secrets`, `deploy.env`, `deploy.log` et `$TAILSCALE_STATE`, dépôts en échec sur stdout, 1 si un échec) ; `current_version`, `write_deploy_env <v>` (atomique) ; `log_deploy <ancienne> <nouvelle> <résultat>` (`ok`, `pull-failed`, `backup-failed`, `rolled-back-image`, `rolled-back-restore`, `rollback-failed`) ;
  - codes : `appsport-update` 0 succès, 1 échec ou abandon, 2 usage ; `appsport-unlock` 0 OK, 1 KO ; section `deploy` = `{at, version: demandée, previousVersion, ok}`.

**Spec:** R-DEP-3, R-DEP-4, R-DEP-6, R-OPS-4, R-OPS-6, R-VER-7, 08 §3, §8 (étapes 1 à 8 et `--rollback`), §10, §13.8 ; 03 §7, §8 ; Review Focus 4 (bats).

- [ ] **Step 1: Write the failing test**

```ts
// active-sessions.test.ts : base du socle → [] ; table workout_session de test à '2026-10-06T20:00:00.000Z' :
expect(listActiveWorkoutSessions(sqlite, now)).toEqual([{ username: 'alice', startedAt: '2026-10-06T19:00:00.000Z' }]);
// (exclues : démarrée à 16:59:59, terminée, supprimée) ; CLI sessions:active --hours 3 sur la base du socle → 0, aucune ligne
```
`unlock.bats` (7 tests ; stubs de `helpers.bash`, `HC_ALIVE_URL=https://hc.test/alive`, sauvegarde de moins de 24 h) :
- volume verrouillé → code 0, « OK », appels dans l'ordre `cryptsetup open $LUKS_DEVICE appsport`, `mount $APPSPORT_ROOT`, `systemctl start docker`, `docker compose * up -d`, `curl *http://127.0.0.1:3000/api/health`, `curl * https://hc.test/alive` ;
- volume déjà ouvert et monté → ni `cryptsetup open` ni `mount` ;
- sentinelle absente → 1, « KO », pas de `up -d`, ping `…/alive/fail` avec le motif « sentinelle » ;
- santé jamais 200 → 1, `/fail`, exactement 3 essais `--max-time 2` (`HEALTH_TIMEOUT_S=12`, `HEALTH_POLL_S=2`) ;
- phrase refusée → 1, pas de `mount` ;
- `.backup.at` absent ou de plus de 24 h → après « OK », `systemctl start --no-block appsport-backup.service` (jamais sinon) ;
- lancé par un lien symbolique `$T/sbin/appsport-unlock` → « OK » ; `skip` sous Windows.

`update.bats` (17 tests ; état initial : `deploy.env` v1.2.0, `deploy.log` `2026-09-01T20:00:00Z v1.1.0 v1.2.0 ok`) :
- nominal (`--yes`) → 0, séance « alice » affichée ; ordre : santé, `exec -T app … sessions:active --hours 3`, `git -C $APPSPORT_REPO fetch --tags`, `checkout --quiet v1.3.0`, `compose * pull app`, `exec -T app … snapshot --tag pre-v1.3.0`, `restic -r $BACKUP_ROOT/restic backup --tag pre-deploy *`, `restic -r s3:https://s3.test/appsport-backups backup --tag pre-deploy *`, `compose * up -d`, santé, `chown 1000:1000 $APPSPORT_ROOT/data/ops/.status.*` ; `APPSPORT_VERSION=v1.3.0` ; dernière ligne `<ISO> v1.2.0 v1.3.0 ok` ; `.deploy` `{ version: 'v1.3.0', previousVersion: 'v1.2.0', ok: true }` ;
- verrou occupé → 1, « Une autre opération appsport est en cours », aucun `git` ;
- `source common.sh` → `GIT_SSH_COMMAND` avec `secrets/deploy_key` et `IdentitiesOnly=yes` ;
- confirmation « n » → 1, « rien n'a été changé », aucun `git` ; « o » → 0 ;
- volume non monté (« Volume non monté »), sentinelle absente, `/api/health` ≠ 200 → 1, aucun `git` ni `pull`, `deploy.env` et `deploy.log` inchangés ;
- `pull` en échec → 1, « Rien n'a été changé », retour `checkout --quiet v1.2.0`, ni instantané ni `up`, résultat `pull-failed` ;
- sauvegarde `pre-deploy` en échec → 1, pas de `up`, `backup-failed`, `deploy.env` v1.2.0 ;
- nouvelle version KO, image précédente saine → 1, `deploy.env` v1.2.0, ni `restore` ni `privacy:`, `rolled-back-image`, `.deploy` `{ version: 'v1.3.0', ok: false }` (Review Focus 4 : ni restauration ni nouvelle époque) ;
- schéma incompatible (v1.2.0 saine seulement après restauration) → ordre `up -d`, `up -d`, `chown 1000:1000 $APPSPORT_ROOT/data/ops`, `run --rm --no-deps … privacy:collect --since * --out /data/ops/privacy-v1.3.0-*.json` (sans `--source`), `stop app`, `run … restore /data/snapshots/pre-v1.3.0.db`, `run … privacy:reapply /data/ops/privacy-v1.3.0-*.json`, `up -d` ; `rolled-back-restore` ; plus aucun `data/ops/privacy-*.json` ;
- restauration impossible → « P4 », `rollback-failed` ;
- retour arrière dont le `checkout --quiet v1.2.0` échoue → 1, « P4 », dernière ligne `… rollback-failed`, `.deploy.ok` false ;
- `--rollback` manuel (v1.3.0 en place, image v1.2.0 saine) → 0, `deploy.env` v1.2.0, `checkout --quiet v1.2.0` puis `up -d`, ni `restore` ni `privacy:`, ligne `v1.3.0 v1.2.0 rolled-back-image`, `.deploy` `{ version: 'v1.2.0', previousVersion: 'v1.3.0', ok: true }` ;
- `--rollback` sans ligne `ok` → « Aucun déploiement » ; `v1.3` → code 2.

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test ops/active-sessions` → module introuvable ; Git Bash ou job `infra` : `pnpm exec bats infra/host/test/unlock.bats infra/host/test/update.bats` → `load helpers` introuvable.

- [ ] **Step 3: Implement**

Outillage bats : `stub.sh` copié en `$T/bin/<nom>` pour `docker`, `curl`, `restic`, `cryptsetup`, `systemctl`, `mount`, `mountpoint`, `git`, `df`, `smartctl`, `chown`, `flock` ; `helpers.bash` fournit `setup_host` (arborescence temporaire, variables pointées vers les stubs, `SLEEP=true`, `LOCK_FILE=$T/appsport.lock`, `SMART_DEVICES=/dev/sda /dev/sdb`, `HC_ENV` avec `https://hc.test/{alive,backup,restore-test,host}` et `APPSPORT_URL=https://appsport.test.ts.net`, `b2.env` avec `RESTIC_OFFSITE_REPOSITORY=s3:https://s3.test/appsport-backups`, état sain en v1.2.0), `on <cmd> <glob> <code> [extrait]`, `set_healthy_versions`, `set_health`, `write_deploy_env_for_test`, `assert_calls_in_order`, `refute_call` ; `defaults.bash` simule `compose ps/up/stop`, `snapshot`, `restore`, `privacy:collect` (écrit `--out`), la santé (version saine si le jeton `v` ou `v@restored` + `restored` figure dans `$STATE/healthy`), `cryptsetup status/open`, `mount`, `mountpoint`. `stub.sh` : ajoute `<nom> <args>` à `$CALLS`, applique la première règle de `$T/rules/<nom>` (motif glob `[[ "$args" == $pat ]]`, code, extrait passé à `eval`), sinon `default_<nom>` de `defaults.bash`.
Scripts : `#!/usr/bin/env bash`, `set -euo pipefail`, `source "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/lib/common.sh"`, corps en fonctions, dernière ligne `main "$@"; exit $?` (le `git checkout` qui remplace le fichier en cours est sans effet). `appsport-unlock` : `cryptsetup open` si fermé (« Phrase refusée. »), `mount`, sentinelle (« KO : sentinelle absente, ce n'est pas le volume appsport. », `hc_ping alive fail "sentinelle absente"`), `systemctl start docker`, `compose up -d`, `wait_health` → « OK : appsport répond (version <v>). », `hc_ping alive` et relance de la sauvegarde manquée (test) ; sinon « KO : /api/health ne répond pas 200 après 2 min (voir P8). ». Flux imposé de `appsport-update` :
```bash
main() {
  parse_args "$@"   # ni ^v[0-9]+\.[0-9]+\.[0-9]+$ ni --rollback → usage, exit 2
  take_lock || die "Une autre opération appsport est en cours. Rien n'a été changé."
  volume_mounted || die "Volume non monté : lancez d'abord sudo appsport-unlock. Rien n'a été changé."
  sentinel_present || die "Sentinelle $APPSPORT_ROOT/data/.appsport-volume absente. Rien n'a été changé."
  if [ "$MODE" = rollback ]; then
    line=$(grep ' ok$' "$APPSPORT_ROOT/deploy.log" | tail -n1) || die "Aucun déploiement réussi à annuler."
    read -r _ prev cur _ <<<"$line"; [ "$(current_version)" = "$cur" ] || die "La version en place n'est pas $cur."
    confirm "Revenir de $cur à $prev ?"; rollback "$prev" "$cur" manual; return $?
  fi
  health_json >/dev/null || die "L'appli ne répond pas 200 sur /api/health : voir P8. Rien n'a été changé."
  prev=$(current_version); [ "$NEW" != "$prev" ] || die "$NEW est déjà déployée."
  show_active_sessions   # « Aucune séance en cours depuis moins de 3 h. » ou « - <pseudo> (début <startedAt>) »
  confirm "Déployer $NEW (version actuelle $prev) ?"   # --yes saute ; « [o/N] » ; refus → « Abandon : rien n'a été changé. » exit 1
  $GIT -C "$APPSPORT_REPO" fetch --tags || die "git fetch impossible. Rien n'a été changé."
  $GIT -C "$APPSPORT_REPO" checkout --quiet "$NEW" || die "Tag $NEW introuvable. Rien n'a été changé."
  if ! APPSPORT_VERSION="$NEW" compose pull app; then
    $GIT -C "$APPSPORT_REPO" checkout --quiet "$prev"; log_deploy "$prev" "$NEW" pull-failed
    die "Échec du téléchargement de l'image $NEW (jeton GHCR expiré ? voir P5). Rien n'a été changé."; fi
  if ! app_cli snapshot --tag "pre-$NEW" || ! restic_backup_all pre-deploy; then
    $GIT -C "$APPSPORT_REPO" checkout --quiet "$prev"; log_deploy "$prev" "$NEW" backup-failed
    die "Échec de l'instantané ou de la sauvegarde pre-deploy. Le service n'a pas été modifié."; fi
  write_deploy_env "$NEW"
  if compose up -d && wait_health "$NEW"; then
    log_deploy "$prev" "$NEW" ok; status_merge deploy "$(deploy_json "$NEW" "$prev" true)"; log "Déploiement de $NEW réussi."; return 0; fi
  log "Échec du démarrage de $NEW : retour arrière automatique."; rollback "$prev" "$NEW" auto; return 1
}
rollback() {  # $1 cible, $2 abandonnée, $3 auto|manual ; deploy.log : auto → "$1 $2", manual → "$2 $1"
  ko() { finish rollback-failed; die "$1 : suivez P4."; }   # tout échec est consigné
  write_deploy_env "$1" || ko "deploy.env non écrit"
  $GIT -C "$APPSPORT_REPO" checkout --quiet "$1" || ko "Tag $1 introuvable"
  if compose up -d && wait_health "$1"; then finish rolled-back-image; return; fi   # image seule : ni restore ni nouvelle époque
  snap="$APPSPORT_ROOT/data/snapshots/pre-$2.db"; [ -f "$snap" ] || ko "Instantané pre-$2 introuvable"
  since=$(date -u -d "@$(( $(stat -c %Y "$snap") - 300 ))" +%Y-%m-%dT%H:%M:%SZ); list="ops/privacy-$2-$(date -u +%Y%m%dT%H%M%SZ).json"
  ensure_ops_dir || ko "data/ops inaccessible"
  # T24 : lecture seule, sans migration
  app_cli_run privacy:collect --since "$since" --out "/data/$list" || ko "privacy:collect impossible"
  compose stop app || ko "Arrêt de app impossible"
  { app_cli_run restore "/data/snapshots/pre-$2.db" && app_cli_run privacy:reapply "/data/$list"; } || ko "Restauration ou réapplication impossible"
  rm -f "$APPSPORT_ROOT/data/$list"   # liste purgée après réapplication (03 §7)
  { compose up -d && wait_health "$1"; } || ko "L'image $1 ne répond pas après restauration"
  finish rolled-back-restore; log "Base restaurée : les téléphones renverront leurs 60 derniers jours."
}
```
`finish` écrit `deploy.log` et `.deploy` (auto : `version=$2, previousVersion=$1, ok=false` ; manuel : `version=$1, previousVersion=$2, ok` = résultat ≠ `rollback-failed`). Job CI `infra` : `pnpm install`, `shellcheck -x infra/host/appsport-* infra/host/lib/common.sh infra/host/test/stub.sh infra/test/image-contract.sh`, `pnpm test:infra`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test ops/active-sessions` → `Tests  3 passed` ; Git Bash ou job `infra` : `pnpm exec bats infra/host/test/unlock.bats infra/host/test/update.bats` → `24 tests, 0 failures` (1 `skipped` sous Windows) ; shellcheck sans sortie (job `infra` seulement).

- [ ] **Step 5: Commit**

`git commit -m "feat(ops): appsport-unlock et appsport-update avec retour arrière R-DEP-4"` (scripts ajoutés avec `--chmod=+x`)

---

