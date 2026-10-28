### Task 44: Sauvegarde, test de restauration, supervision, systemd, Docker et Tailscale

**Files:**
- Create: `infra/host/{appsport-backup, appsport-restore-test, appsport-alive, appsport-check}`, `infra/host/test/{backup,restore-test,alive,check}.bats`, `infra/systemd/appsport-{alive,backup,check,restore-test}.{service,timer}`, `infra/systemd/docker.service.d/appsport.conf`, `infra/docker/daemon.json`, `infra/apt/52appsport-unattended`, `infra/tailscale-policy.hujson`, `apps/server/src/ops/db-stats.ts`
- Modify: `apps/server/src/cli.ts` (`db:stats`), `infra/host/test/defaults.bash` (`restic restore`, `db:stats`, `df`, `smartctl`, `docker run/exec/rm`)
- Test: `apps/server/test/ops/db-stats.test.ts`, `apps/server/test/infra/host-config.test.ts`, les 4 fichiers `.bats`

**Interfaces:**
- Consumes : T43 (`common.sh`, `helpers.bash`, `stub.sh`) ; T40 (`snapshot --tag daily`, rétention incluse) ; T12 (`OpsStatus`, `OpsCheck`) ; support serveur.
- Produces : Interfaces partagées §8 (`DbStats`, `dbStats` : `integrity` = lignes de `PRAGMA integrity_check` jointes par `\n`, `users` = `count(*)` de `user`, `syncCounter`, `lastWriteAt` = max de `updated_at` de toutes les tables qui l'ont et de `security_event.at`, ou null ; intégrité KO ou qui lève → message, `0`, `0`, `null` sans autre lecture ; CLI `db:stats` → une ligne JSON, code 0 même si l'intégrité est KO, base en `readOnly` sans garde, `withAppDeps` ni migration). Scripts sortant en 0 ou 1 (échec signalé par `/fail`) ; sections `backup` et `restoreTest` `{at, ok, detail}`, `host` `{at, ok, detail, disks: [{mount, usedPct}], smartOk, rebootRequired}` ; conteneur jetable `appsport-restore-test` ; copie de test sous `$APPSPORT_ROOT/tmp/restore-test-<AAAAMMJJTHHMMSSZ>/`.

**Spec:** R-OPS-1, R-OPS-2, R-OPS-4, R-OPS-8 à R-OPS-11, R-DEP-5, R-DEP-7, 08 §2, §4 (`daemon.json`), §5.6, §7, §9, §13.3, §13.6, §13.11, §15 ; 03 §10.

- [ ] **Step 1: Write the failing test**

```ts
// db-stats.test.ts
expect(dbStats(sqlite)).toMatchObject({ integrity: 'ok', users: 1, lastWriteAt: '2026-10-07T08:00:00.000Z' });   // + syncCounter ≥ 1
// base vide → { integrity: 'ok', users: 0, lastWriteAt: null } ; CLI après init → { integrity: 'ok', users: 0, syncCounter: 0, lastWriteAt: null }
// ligne ('0099_future', 1) dans schema_migrations (migration cassante inconnue) → CLI 0, users et syncCounter lus, base inchangée (sha256)
// pages 2 et 3 écrasées → CLI 0, integrity ≠ 'ok', users 0, syncCounter 0, lastWriteAt null ; base absente → 1, « Base introuvable : <chemin>. »
// host-config.test.ts
const timers = { 'appsport-alive': '*:0/5', 'appsport-backup': '*-*-* 03:30:00', 'appsport-check': '*-*-* 04:00:00', 'appsport-restore-test': 'Sun *-*-01..07 05:00:00' };
// chaque timer : OnCalendar, WantedBy=timers.target, Persistent=true (sauf alive) ; service Type=oneshot, ExecStart=/usr/local/sbin/<nom>
// docker.service.d/appsport.conf : RequiresMountsFor=/srv/appsport
expect(JSON.parse(read('infra/docker/daemon.json'))).toEqual({ 'data-root': '/srv/appsport/docker', 'log-driver': 'local', 'log-opts': { 'max-size': '10m', 'max-file': '5' }, 'live-restore': true });
// 52appsport-unattended : /^Unattended-Upgrade::Automatic-Reboot "false";$/m ; aucun fichier de infra/systemd ni infra/host ne correspond à
//   /systemctl\s+(reboot|poweroff|kexec)|shutdown\s+-[rh]|^\s*(reboot|poweroff|halt)\b/m
expect(policy).toEqual({ grants: [{ src: ['autogroup:member'], dst: ['*'], ip: ['*'] }, { src: ['autogroup:shared'], dst: ['*'], ip: ['tcp:443'] }],
  ssh: [{ action: 'check', src: ['autogroup:member'], dst: ['autogroup:self'], users: ['autogroup:nonroot'] }] });
```
`backup.bats` (5 tests) : nominal → 0, ordre `curl * https://hc.test/backup/start`, `exec -T app … snapshot --tag daily`, `restic -r $BACKUP_ROOT/restic backup --tag daily --exclude $APPSPORT_ROOT/data/appsport.db* $APPSPORT_ROOT/data/snapshots $APPSPORT_ROOT/secrets $APPSPORT_ROOT/deploy.env $APPSPORT_ROOT/deploy.log $TAILSCALE_STATE`, `restic -r $BACKUP_ROOT/restic forget --keep-daily 30 --prune`, puis offsite `backup` et `forget` ; dernier appel `https://hc.test/backup` ; `.backup.ok` true ; `RESTIC_PASSWORD_FILE` = `secrets/restic.pass`, clés B2 seulement pour offsite. Volume verrouillé → 1, motif « volume verrouillé », aucun restic. Verrou occupé → 1, motif « verrou occupé », aucun restic. Instantané KO → 1, aucun restic, `.backup.ok` false. Offsite KO → local sauvegardé et purgé, pas de `forget` offsite, `/fail` qui nomme offsite, `.backup.detail` contient « offsite ».

`restore-test.bats` (6 tests) : nominal → 0, ordre `…/restore-test/start`, `restic -r s3:… restore latest --tag daily --target $APPSPORT_ROOT/tmp/restore-test-* --include $APPSPORT_ROOT/data/snapshots`, `chown -R 1000:1000 …/data`, `docker run --rm --network none * node /app/server.mjs db:stats` sur la copie du plus récent (`daily-20261005`), `exec -T app … db:stats`, `docker run -d --name appsport-restore-test --network none --read-only --tmpfs /tmp --user 1000 *`, `docker exec appsport-restore-test node -e *`, `docker rm -f appsport-restore-test`, `restic … check --read-data-subset=5%` local puis offsite, `…/restore-test` ; `tmp/` vide ; `.restoreTest.ok` true. Aucune cible `--target` hors de `$APPSPORT_ROOT/tmp/`. Intégrité KO → « intégrité », pas de conteneur, nettoyage ; 0 utilisateur → « utilisateur » ; écart de plus de 48 h avec la base réelle → « retard » ; conteneur sans 200 → `rm -f` puis `/fail` ; `check` offsite KO → motif « offsite ».

`alive.bats` (4 tests) : santé de `https://appsport.test.ts.net/api/health` OK → `…/alive` ; volume verrouillé → « volume verrouillé » ; injoignable (sans corps) → « appli KO : api/health injoignable » ; 503 avec corps `{"status":"error","db":"error",…}` → « appli KO : status=error db=error ».

`check.bats` (6 tests) : tout bon → `…/host`, `.host` `{ ok: true, smartOk: true, rebootRequired: false }`, montages `["/", $APPSPORT_ROOT, $BACKUP_ROOT]` à `[42, 42, 42]` ; disque à 85 % → « disque $BACKUP_ROOT à 85 % » ; 80 % pile → 0 ; SMART KO sur `/dev/sdb` → « SMART » ; `REBOOT_REQUIRED_FILE` présent → « redémarrage requis » ; volume verrouillé → ping quand même, `status.json` non écrit.

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test ops/db-stats infra/host-config` → module et `infra/systemd/appsport-alive.timer` introuvables ; Git Bash ou job `infra` : `pnpm exec bats infra/host/test/{backup,restore-test,alive,check}.bats` → scripts introuvables.

- [ ] **Step 3: Implement**

Structure des scripts de T43 ; aucun motif Healthchecks ne contient de donnée personnelle. `take_lock || fail "verrou occupé"` après le contrôle du volume (backup, restore-test). `appsport-backup` : `fail <motif>` = `status_merge backup` (sauté si le volume n'est pas monté), `hc_ping backup fail`, exit 1 ; `forget --keep-daily 30 --prune` seulement après une sauvegarde réussie du même dépôt ; succès → `detail: "local+offsite"`. `appsport-restore-test` : ordre du test, `trap cleanup EXIT` (`rm -f` du conteneur, `rm -rf` de la copie), copie en `data/appsport.db` + sentinelle, image `ghcr.io/gnochance/appsport:$(current_version)` avec `APP_ORIGIN=https://restore-test.invalid`, sonde `docker exec … node -e fetch(…)`, écart ≤ 172 800 s, `detail: "<fichier> ; écart <h> h"`. `appsport-alive` : `$CURL -sS --fail-with-body --max-time 10 "$APPSPORT_URL/api/health"`, corps lu par `jq` quel que soit le statut ; motifs du test et « volume verrouillé : lancer appsport-unlock ». `appsport-check` : `$DF --output=pcent` sur `/`, `$APPSPORT_ROOT`, `$BACKUP_ROOT` (> 80 % → « disque <m> à <pct> % ») ; `$SMARTCTL -H` doit contenir `PASSED` ou `SMART Health Status: OK` ; problèmes joints par ` ; `. `tailscale-policy.hujson` précédé de `// Collé dans la console Tailscale (Access controls). Aucun proche n'est membre : partage de la machine seulement (R-OPS-8).`

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test ops/db-stats infra/host-config` → `Test Files  2 passed` ; Git Bash ou job `infra` : les 4 fichiers bats → `21 tests, 0 failures` ; `pnpm test:infra` → `45 tests, 0 failures` (le job `infra` fait foi).

- [ ] **Step 5: Commit**

`git commit -m "feat(ops): sauvegardes restic, test de restauration mensuel, supervision et configuration hôte"` (scripts en `--chmod=+x`)

---

