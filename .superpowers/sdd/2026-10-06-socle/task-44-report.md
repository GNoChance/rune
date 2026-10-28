# Task 44 — rapport d'implémentation (lane O, worktree appsport-ops, branche socle-ops)

**Statut : DONE_WITH_CONCERNS** (concerns mineurs, section 7).
**Commit :** `5316fd5` feat(ops): sauvegardes restic, test de restauration mensuel, supervision et configuration hôte (Closes #45).
**Base :** `9aea873` (fin de T43). Paquet de revue : `C:\Users\eliott.colin\appsport-ops\.superpowers\sdd\2026-10-06-socle\review-9aea873..5316fd5.diff`.

## 1. Ce qui a été implémenté

### Serveur
- `apps/server/src/ops/db-stats.ts` : `DbStats`, `dbStats(sqlite)`.
  - `integrity` = lignes de `PRAGMA integrity_check` jointes par `\n` ; si le pragma lève, le message de l'erreur.
  - Intégrité ≠ `ok` → `{ integrity, users: 0, syncCounter: 0, lastWriteAt: null }`, sans aucune autre lecture.
  - `users` = `count(*)` de `user` ; `syncCounter` = `server_meta.sync_counter`.
  - `lastWriteAt` = max de `updated_at` sur toutes les tables qui ont cette colonne (trouvées via `sqlite_schema` joint à `pragma_table_info`) et de `security_event.at` ; null si rien n'est écrit.
- `apps/server/src/cli.ts` : commande `db:stats` (ruling C3).
  - Elle trouve la base par `APPSPORT_DATA_DIR` (`/data` par défaut), via le nouveau `dataDirFrom(env)` de `config.ts`, que `loadConfig` réutilise désormais. Ni `loadConfig` ni `APP_ORIGIN`.
  - `DatabaseSync` est ouvert en `readOnly`, sans garde, sans `withAppDeps` et sans migration.
  - Sortie : une ligne JSON, code 0 même si l'intégrité est KO.
  - Base absente → code 1, « Base introuvable : <chemin>. »

### Scripts hôte (`infra/host`, même structure que T43, tous en 100755)
- `lib/common.sh`, ajouts de petite taille :
  - `volume_ready` (volume monté et sentinelle présente) ;
  - `ops_check_json <ok> <détail>` (section `{at, ok, detail}`) ;
  - `join_problems` (jointure par ` ; `) ;
  - `restic_backup_on <dépôt> <tag>`, extrait de `restic_backup_all`. Le comportement de `restic_backup_all` ne change pas, et la liste des chemins reste écrite à un seul endroit.
- `appsport-backup` :
  - Déroulé : `hc_ping backup start`, puis le volume (sinon « volume verrouillé : lancer appsport-unlock »), puis `take_lock || fail "verrou occupé"`, puis `app_cli snapshot --tag daily`.
  - Ensuite, pour local puis offsite : `restic_backup_on <dépôt> daily`, et `forget --keep-daily 30 --prune` seulement si cette sauvegarde-là a réussi (R-OPS-10).
  - Succès → `backup {ok: true, detail: "local+offsite"}`, puis ping.
  - `fail` : section backup (sautée si `volume_ready` est faux), puis `/fail` avec le motif, puis exit 1.
  - Si offsite échoue : le dépôt local est quand même sauvegardé et purgé, et le motif est « sauvegarde offsite en échec ».
- `appsport-restore-test` (R-OPS-11) :
  - Même ouverture : ping start, volume, verrou. Puis `trap cleanup EXIT` (avec `trap 'exit 1' INT TERM HUP`, pour que le nettoyage tourne aussi sur un signal) et la version lue dans `deploy.env`, qui doit être valide.
  - Copies laissées par un test interrompu : `tmp/restore-test-*` est supprimé d'abord.
  - Restauration : `restic_on offsite restore latest --tag daily --target $APPSPORT_ROOT/tmp/restore-test-<AAAAMMJJTHHMMSSZ> --include $APPSPORT_ROOT/data/snapshots`. Dossiers créés en umask 077.
  - Copie : le `daily-*.db` le plus récent (fichier ordinaire, jamais un lien) est copié en `data/appsport.db`, avec la sentinelle, puis `chown -R 1000:1000 …/data`.
  - Contrôles de la copie :
    - `docker run --rm --network none --read-only --user 1000 --pull never -v …/data:/data <image> node /app/server.mjs db:stats` ;
    - intégrité `ok`, sinon « intégrité KO sur la copie restaurée » ;
    - au moins 1 utilisateur, sinon « aucun utilisateur dans la copie restaurée ».
  - Base réelle : `app_cli db:stats`. L'écart de `lastWriteAt` doit être ≤ 172 800 s, sinon « retard de <h> h sur la base réelle ».
  - Conteneur jetable :
    - lancé par `docker rm -f` préventif, puis `docker run -d --name appsport-restore-test --network none --read-only --tmpfs /tmp --user 1000 --pull never -v …/data:/data -e APP_ORIGIN=https://restore-test.invalid ghcr.io/gnochance/appsport:<version>` ;
    - pas d'env_file, donc aucun secret ;
    - sondé par `docker exec … node -e "fetch(…,{signal:AbortSignal.timeout(5000)})…"` pendant au plus `HEALTH_TIMEOUT_S / HEALTH_POLL_S` essais, puis `docker rm -f` ;
    - sans 200 : « conteneur jetable : api/health sans 200 ».
  - `restic check --read-data-subset=5%` local puis offsite. Les échecs sont joints (par exemple « restic check offsite en échec »).
  - `fail` nettoie d'abord (`rm -f` du conteneur, puis `rm -rf` de la copie), puis écrit la section, puis envoie `/fail`.
  - Succès : nettoyage, puis `restoreTest {ok: true, detail: "daily-AAAAMMJJ.db ; écart <h> h"}`, puis ping.
- `appsport-alive` :
  - Volume non monté → « volume verrouillé : lancer appsport-unlock ».
  - Santé : `$CURL -sS --fail-with-body --max-time 10 "$APPSPORT_URL/api/health"`. Le corps est lu par jq quel que soit le statut.
  - `status` et `db` ne passent dans le motif que s'ils correspondent à `^[a-z_]{1,20}$` : aucune autre donnée ne peut atteindre Healthchecks.
  - Motifs : « appli KO : api/health injoignable » (aucun statut lisible) ou « appli KO : status=<s> db=<d> ».
- `appsport-check` :
  - Disques : `$DF --output=pcent` sur `/`, `$APPSPORT_ROOT` et `$BACKUP_ROOT`. Au-delà de 80 % → « disque <m> à <pct> % » ; 80 % pile passe.
  - SMART : `$SMARTCTL -H` sur chaque disque de `SMART_DEVICES`. Seule la sortie compte (`PASSED` ou `SMART Health Status: OK`), pas le code de sortie, qui est un masque de bits.
  - Fichier reboot-required → « redémarrage requis ».
  - Problèmes joints par ` ; `.
  - Section host : `{at, ok, detail?, disks, smartOk, rebootRequired}`, écrite seulement si `volume_ready`. Le ping part toujours. Le script ne prend pas le verrou.

### Fichiers de l'hôte
- `infra/systemd/appsport-{alive,backup,check,restore-test}.{service,timer}` :
  - services en `Type=oneshot`, `ExecStart=/usr/local/sbin/<nom>`, `After/Wants=network-online.target` ;
  - timers : `OnCalendar` exacts, `WantedBy=timers.target`, `Persistent=true` sauf pour alive.
- `infra/systemd/docker.service.d/appsport.conf` : `[Unit] RequiresMountsFor=/srv/appsport`.
- `infra/docker/daemon.json` : contenu de 08 §4, reformaté par biome (voir le concern 1).
- `infra/apt/52appsport-unattended` : `APT::Periodic::*` à `"1"`, plus `Unattended-Upgrade::Automatic-Reboot "false";`.
- `infra/tailscale-policy.hujson` : la ligne de commentaire du brief, puis la politique de 08 §5 mot pour mot.

### Harnais bats
- `defaults.bash`, étendu comme le prévoit le ruling :
  - `restic restore` recrée `<target><include>/` avec `daily-20261003/04/05.db` et `pre-v1.2.0.db` ; chaque fichier contient son nom ;
  - `restic-pass` enregistre le `RESTIC_PASSWORD_FILE` vu à chaque appel ;
  - `db:stats` : `$STATE/db-stats-live` pour exec et run (sinon une valeur par défaut) ;
  - `docker run` : `-d` affiche un identifiant ; `db:stats` exige `appsport.db` et `.appsport-volume` dans le dossier monté, enregistre la copie lue dans `db-stats-source`, puis affiche `db-stats-copy` (sinon une valeur par défaut) ;
  - `docker exec` et `docker rm` → 0 ;
  - `df` → 42 % ; `smartctl` → PASSED ;
  - le curl de santé couvre aussi `https://*/api/health`.
- `helpers.bash` (`wrap_windows_jq`, sous Windows seulement) : MSYS réécrivait en chemin Windows les valeurs `--arg` qui ressemblent à un chemin (`--arg m /` devenait `C:/Program Files/Git/`). L'enveloppe coupe cette conversion (`MSYS_NO_PATHCONV`, `MSYS2_ARG_CONV_EXCL='*'`) et ne convertit que les fichiers existants passés en argument (`cygpath -w`). Rien ne change sous Linux.

## 2. Tests et résultats

| Commande | Résultat |
|---|---|
| `pnpm --filter @appsport/server test ops/db-stats infra/host-config` | `Test Files 2 passed (2)`, `Tests 21 passed (21)` |
| `pnpm test:infra` (Git Bash, bats 1.13.0, jq 1.8.2) | `1..59`, 59 `ok`, 0 `not ok` : les 38 tests de T43 et les 21 nouveaux (backup 5, restore-test 6, alive 4, check 6). Les 2 tests de liens symboliques de T43 sont en `# skip` sous Windows, comme avant. |
| `shellcheck -x infra/host/appsport-* infra/host/lib/common.sh infra/host/test/stub.sh infra/test/image-contract.sh` (shellcheck 0.10.0, binaire officiel téléchargé dans le scratchpad, même commande que le job CI) | rc=0 (aussi propre sur `defaults.bash` et `helpers.bash`) |
| `pnpm lint` | `Checked 443 files … No fixes applied.` |
| `pnpm typecheck` | rc=0 |
| `pnpm test` | `Test Files 161 passed (161)`, `Tests 1912 passed \| 2 skipped (1914)`. Les 2 skips sont des tests SW de web antérieurs à cette tâche. Sortie propre. |

Les fichiers systemd, `daemon.json`, apt et Tailscale ne s'exécutent que sur l'hôte, en P1 (documenté par T45). Le job CI `infra` fait foi pour bats et shellcheck sous Linux.

## 3. Preuves TDD

**RED** : tests écrits d'abord, lancés séparément avant toute implémentation.

1. `pnpm --filter @appsport/server test ops/db-stats infra/host-config`
   ```
   FAIL |server| test/infra/host-config.test.ts
   Error: ENOENT: no such file or directory, open '…\appsport-ops\infra\tailscale-policy.hujson'
   FAIL |server| test/ops/db-stats.test.ts
   Error: Cannot find module '../../src/ops/db-stats' imported from …/test/ops/db-stats.test.ts
   Test Files  2 failed (2)
   ```
   Échec attendu : ni le module ni les fichiers de l'hôte n'existaient. Le premier fichier manquant lu à la collecte est la politique Tailscale, pas le timer cité par le brief ; la cause est la même.
2. `env LC_ALL=C.UTF-8 bats infra/host/test/{backup,restore-test,alive,check}.bats` (après extension de `defaults.bash`) :
   `1..21`, 21 `not ok`, chacun avec `BW01: run's command …/infra/host/appsport-<nom> exited with code 127, indicating 'Command not found'`. Échec attendu : les scripts n'existaient pas.

**GREEN** : les commandes de la section 2. Deux corrections de harnais ou de portabilité ont été faites en route, sur des tests restés rouges :
- `mkdir -m 0700` échoue sous MSYS (« cannot change permissions ») ; remplacé par `(umask 077 && mkdir …)`, équivalent sous Linux ;
- l'enveloppe jq de Windows (section 1).

Un motif glob de mon propre test (`-e APP_ORIGIN=… * $IMAGE`, qui exigeait deux espaces) a aussi été corrigé.

## 4. Fichiers modifiés (`git show --stat HEAD`, 28 fichiers, +1208 / −12)

- **Créés :**
  - `apps/server/src/ops/db-stats.ts`
  - `apps/server/test/ops/db-stats.test.ts`
  - `apps/server/test/infra/host-config.test.ts`
  - `infra/host/appsport-{alive,backup,check,restore-test}` (100755)
  - `infra/host/test/{alive,backup,check,restore-test}.bats`
  - `infra/systemd/appsport-{alive,backup,check,restore-test}.{service,timer}`
  - `infra/systemd/docker.service.d/appsport.conf`
  - `infra/docker/daemon.json`
  - `infra/apt/52appsport-unattended`
  - `infra/tailscale-policy.hujson`
- **Modifiés :**
  - `apps/server/src/cli.ts`
  - `apps/server/src/config.ts`
  - `infra/host/lib/common.sh`
  - `infra/host/test/defaults.bash`
  - `infra/host/test/helpers.bash`

`git status` est propre après le commit, et chaque changement décrit ici est bien dans `5316fd5`.

## 5. Ce que les tests vérifient (au-delà du brief)

- **backup :**
  - clés B2 vues seulement par les appels offsite ;
  - `RESTIC_PASSWORD_FILE` = `secrets/restic.pass` pour chaque appel restic ;
  - volume verrouillé : ni verrou, ni restic, ni docker, et `status.json` reste identique à l'octet près ;
  - modes de `data/ops` et de `status.json` (sous Linux).
- **restore-test :**
  - la copie lue est bien `daily-20261005` : le plus récent, alors que les fichiers sont créés dans le désordre et qu'un `pre-v` est présent ;
  - toute cible `--target` est sous `tmp/`, au nom horodaté `restore-test-AAAAMMJJTHHMMSSZ` ;
  - pas de `--env-file` ni d'`app.env` sur `docker run` ;
  - 48 h pile passent, 48 h et 1 s échouent (« retard de 48 h ») ;
  - 4 sondes avant d'abandonner (`HEALTH_TIMEOUT_S` 8, `HEALTH_POLL_S` 2) ;
  - `tmp/` vide dans tous les cas.
- **check :**
  - SMART en SAS (« SMART Health Status: OK » avec un code 4) accepté ;
  - jointure « disque … à 91 % ; redémarrage requis » ;
  - volume verrouillé : aucun `chown`, `status.json` intact.
- **host-config :**
  - le motif interdit (reboot, poweroff, halt, kexec, shutdown -r/-h) est absent de tout fichier sous `infra/systemd` et `infra/host` ;
  - le test vérifie d'abord que la liste parcourue contient bien les nouveaux fichiers.
- **db-stats :**
  - `lastWriteAt` vient de `security_event.at`, puis d'une table quelconque qui porte `updated_at` (`place`) ;
  - le CLI tourne avec un env sans `APP_ORIGIN` ;
  - migration cassante inconnue : sha256 de la base inchangé ;
  - corruption : intégrité ≠ `ok` et non vide, compteurs à 0, `lastWriteAt` null.

## 6. Auto-revue

- **Conforme aux rulings :**
  - C3 : pas de `loadConfig`, `readOnly`, pas de garde, pas de migration ;
  - verrou pris après le contrôle du volume (backup, restore-test) ;
  - `forget` seulement après une sauvegarde réussie du même dépôt ;
  - B2 seulement pour offsite ;
  - aucune donnée personnelle dans un motif ;
  - section sautée quand le volume n'est pas monté ;
  - timers et services mot pour mot ;
  - aucune commande de redémarrage.
- **YAGNI :**
  - l'état `container` que j'avais ajouté au stub n'était lu par aucun test : retiré avant le commit ;
  - les ajouts à `common.sh` servent tous à au moins deux scripts, sauf `restic_backup_on`, qui évite de dupliquer la liste des chemins de sauvegarde.
- **Robustesse ajoutée, petite et justifiée :**
  - `--pull never` sur les deux `docker run` : aucun accès réseau, l'image en place suffit ;
  - `docker rm -f` préventif avant `run -d` : un conteneur laissé par une coupure bloquerait sinon chaque test suivant (nom déjà pris) ;
  - purge des `tmp/restore-test-*` laissés par une coupure : données personnelles à ne pas garder au-delà de 30 jours ;
  - fetch borné à 5 s par essai ;
  - « SMART : aucun disque détecté » quand `SMART_DEVICES` est vide, plutôt qu'un succès silencieux.

## 7. Concerns

1. **`daemon.json` reformaté par biome.** Le contenu JSON est identique à 08 §4 (vérifié par `toEqual`), mais la mise en page n'est plus celle, compacte, de la spec : `pnpm lint` échouait sinon. Pour garder la mise en page d'origine, il faudrait exclure ce fichier dans `biome.json`.
2. **Instantané et db:stats réel passent par `app_cli` de T43.** Avec le service en marche, c'est `compose exec -T app …`, ce que les tests vérifient. Avec le service arrêté, c'est `compose run --rm --no-deps`, ce qui garde la sauvegarde de la nuit possible au lieu d'échouer. Le ruling écrit « exec -T » : à trancher si l'on veut un échec strict quand le service est arrêté.
3. **`helpers.bash` modifié (enveloppe jq, Windows seulement), alors que le ruling ne nommait que `defaults.bash`.** Sans ce changement, les tests de chemins (`.disks[].mount` qui vaut `/`) sont faux sous Git Bash. Aucun effet sous Linux ni sur le job CI.
4. **Choix de détail dans `52appsport-unattended`.** Le fichier ajoute `APT::Periodic::Update-Package-Lists` et `APT::Periodic::Unattended-Upgrade` à `"1"`, pour se suffire à lui-même (application quotidienne demandée par 08 §2). La ligne `Automatic-Reboot "false"` est bien celle exigée.

## Fix report, round 1 (integration of four parallel fix branches)

Integrated on `socle-ops` in `C:\Users\eliott.colin\appsport-ops`, from `5316fd5`. Each branch went in with `git cherry-pick 5316fd5..<branch>`, so history stays linear with no merge commits. Order: g1, g2, g3, g4.

**Status:** DONE. All 16 findings were fixed and integrated: T44-F2, F3, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19. Two cherry-picks conflicted (g3 and g4). In both, the two sides had added tests at the same place, and all of them were kept. The combined code needed no fix, so there is no integration commit (see "Integration check").

### Commits (5316fd5..HEAD)
- `c2293df fix(ops): restes du test de restauration purgés chaque nuit, sauvegarde en échec relancée par unlock` (g1: F17, F14, F6, F3; applied cleanly)
- `7a208b5 test(ops): contrat d'intégrité de dbStats fixé sur une base factice` (g2: F18)
- `16bda16 test(ops): filtre du corps de /api/health avant le motif Healthchecks` (g2: F13)
- `945fae2 fix(ops): TERM pendant le test de restauration signalé par /fail` (g2: F11; auto-merged on g1)
- `55785f2 fix(ops): services bornés, base réelle contrôlée, SMART sans fausse alarme, test de restauration rattrapé` (g3: F8, F7, F10, F9; conflicts 1 and 2)
- `cace270 test(ops): test de restauration, montage de la copie, sonde, verrous, date illisible et traps couverts` (g4: F19, F16, F15, F12, F2; conflicts 3 and 4)

Review package: `/c/Users/eliott.colin/appsport-ops/.superpowers/sdd/2026-10-06-socle/review-5316fd5..cace270.diff` (6 commits, 56709 bytes).

### Group 1: T44-F17, F14, F6, F3 (1 commit)
- **F14 (exact restic arguments, test only):**
  - `backup.bats` setup builds `PATHS_PAT=${PATHS//\*/\\\*}`, so the star in `appsport.db*` is literal in the glob patterns. The `\\*` form loses its backslash under bash 5.2+/5.3; `\\\*` behaves the same on 5.1 and on 5.2+.
  - Every backup line in `assert_calls_in_order` uses `PATHS_PAT`.
  - The nominal test also checks the exact local and offsite command lines with `grep -Fxq`.
  - RED by mutation:
    - removing the trailing star from the `--exclude` in common.sh fails nominal, offsite KO, local KO and purge locale KO;
    - adding `$APPSPORT_ROOT/data` as an extra path fails nominal;
    - the old `backup.bats` still passed nominal with the star removed, which confirms the weakness.
- **F17 (local failure, test only; the script was already correct):**
  - New test « local KO » (`on restic "-r $BACKUP_ROOT/restic backup *" 1`). It checks:
    - the order: local backup, offsite backup, offsite forget, then /fail « sauvegarde local en échec »;
    - no local forget;
    - no success ping;
    - `.backup.detail` is exactly the motif.
  - New test « purge locale KO » (local forget → 1): offsite is still backed up and purged, then /fail « purge local en échec ».
  - RED by mutation:
    - an unconditional local forget fails on `refute_call`;
    - calling `fail` right away on a local failure fails on `assert_calls_in_order`.
- **F6 (unlock and failed backups):** `backup_missed` reads `(.backup | select(.ok == true) | .at) // ""`. A failed backup (`ok` false, `at` fresh) now counts as missed, and unlock relaunches `appsport-backup.service`.
  - New unlock.bats case: `ok` false with `at` 30 min ago.
  - RED: « appel attendu absent : systemctl start --no-block appsport-backup.service ».
  - GREEN, and the existing cases still pass: `{}` relaunches, 25 h relaunches, 23 h with `ok` true does not.
- **F3 (leftovers from a crashed restore-test):** new `purge_restore_test_leftovers` in common.sh. It runs `docker rm -f appsport-restore-test || true`, refuses a symlinked `tmp/`, then runs `rm -rf -- $APPSPORT_ROOT/tmp/restore-test-*`.
  - appsport-restore-test calls it after `take_lock` and the `mkdir` of tmp/, so the container goes before the copy. A failure gives « dossier tmp du volume inutilisable ». The old pre-emptive `docker rm -f` in `check_container` is gone.
  - appsport-backup calls it every night right after `take_lock`. A failure adds « purge du test de restauration en échec » to the problems and does not stop the backup. Leftovers now last about one day instead of up to about 35 more.
  - New tests:
    - backup.bats « restes d'un test… après le verrou »: the copy is still there at `docker rm -f` (container first), and the order is flock, rm -f, snapshot, success ping;
    - restore-test.bats « restes d'un test interrompu… »: the same check before `restic restore`;
    - backup.bats « verrou occupé » now asserts that a restore-test copy survives when the lock is busy.
  - RED: backup fails `[ ! -e "$left" ]`; restore-test fails because the copy was already gone at the first `rm -f`. Both are GREEN after the fix.
- Group 1's own run: `pnpm test:infra` 1..64, 0 not ok; server ops/db-stats + infra/host-config 21 passed; shellcheck rc 0; lint and typecheck clean.

### Group 2: T44-F18, F13, F11 (3 commits)
- **F18 (`db-stats.test.ts`, test only):** `integrityStub` is a fake `DatabaseSync`. Only `PRAGMA integrity_check` answers; any other SQL throws and every `prepare` is recorded.
  - Rows `a`, `b` give `{integrity:'a\nb', users:0, syncCounter:0, lastWriteAt:null}`.
  - A `prepare` that throws `boom` gives `integrity:'boom'` with the same zeros.
  - In both cases, only the integrity check is prepared.
  - RED by mutation: a constant `'KO'` in the catch, and `String(rows[0]?.integrity_check)`. Each gives 1 failed out of 9.
- **F13 (`alive.bats`, test only):** a `fail_ping` helper requires exactly one /alive/fail call.
  - Case 5: a body with `alice@x` gives exactly `appli KO : api/health injoignable`, and no call contains `alice` or `@`.
  - Case 6: a 22-character `db` value gives exactly `appli KO : status=error db=?`.
  - RED by mutation: widening the filter `^[a-z_]{1,20}$` to `^.+$` fails cases 5 and 6 only.
- **F11 (`appsport-restore-test`):** the INT/TERM/HUP trap is now `trap 'fail "test de restauration interrompu"' INT TERM HUP`. `fail()` starts with `trap 'exit 1' INT TERM HUP`, so a second signal during `fail` just exits (the EXIT trap still cleans up) and the first motif is kept.
  - Test: the `docker run -d` stub sends TERM to the script. It asserts, in order, `run -d`, `rm -f`, then /fail « test de restauration interrompu ». It also asserts exactly one /fail, no success ping, no `restic check`, an empty tmp/, and restoreTest KO with that detail.
  - RED with the old `trap 'exit 1'`: cleanup ran but no /fail was sent.
- Group 2's own run: `pnpm test:infra` 1..62, 0 not ok; full server suite 576 passed / 2 skipped; lint and typecheck clean.

### Group 3: T44-F8, F7, F10, F9 (1 commit)
- **F8:** `TimeoutStartSec` on the four oneshot services: alive 2min, backup 4h, check 10min, restore-test 6h. Each has a comment saying why. host-config.test.ts checks them. RED: 4 failed (« expected undefined to deeply equal [ '4h' ] »).
- **F7 (live database in restore-test):** right after `live=$(app_cli db:stats)`, the script requires `integrity` = `ok`, otherwise it fails with « intégrité KO sur la base réelle ».
  - `lag_seconds` no longer clamps negative values.
  - A lag below `-MAX_AHEAD_S` (300 s) fails with « base réelle plus ancienne que la sauvegarde ». A negative lag within 300 s shows as « écart 0 h ».
  - Two new restore-test.bats cases: live integrity KO, and the 5 min / 5 min 1 s boundary.
  - RED: the integrity case reported « date de dernière écriture illisible »; the negative lag was clamped and passed.
- **F10 (false SMART and disk alarms, `appsport-check`):**
  - A missing `df` gives the single problem « df absent de l'hôte ».
  - A missing `smartctl` gives the single problem « smartctl absent de l'hôte », with `smartOk` false and no per-disk « SMART KO ».
  - In both cases the host ping still goes out.
  - The default `SMART_DEVICES` excludes `/dev/zram*` and `/dev/mmcblk*`.
  - Addition: an entry `<type>:<path>` (for example `sat:/dev/disk/by-id/usb-…`) calls `smartctl -H -d <type> <path>`. The type is parsed only when the entry does not start with `/`.
  - Four new check.bats cases. RED: all four failed.
- **F9 (restore-test missed at boot):** appsport-unlock also starts `appsport-restore-test.service --no-block` after the backup restart, when `restoreTest.at` is missing or older than the last past timer slot.
  - `last_restore_test_slot` computes the first Sunday at 05:00 local time of this month, or of the previous month if that slot has not come yet. A 35-day threshold would miss the common 28-day gap.
  - `appsport-restore-test.service` gets `After=appsport-backup.service`.
  - The new unlock.bats test uses `TZ=UTC` and `fake_now`. Its cases:
    - 28 days old: relaunched;
    - after today's slot: nothing relaunched;
    - before today's slot: nothing relaunched;
    - `{}`: backup first, then restore-test.
  - RED against the old unlock: the restore-test start was absent.
- Group 3's own run: `pnpm test:infra` 1..66, 0 not ok; full server suite 575 passed / 2 skipped; shellcheck rc 0; lint and typecheck clean.

### Group 4: T44-F19, F16, F15, F12, F2 (1 commit, `restore-test.bats` only; the script was already correct)
- **F2:** the nominal test asserts:
  - the `-d` run mounts `tmp/restore-test-*/data:/data`;
  - no `docker run` mounts `$APPSPORT_ROOT/data:/data`;
  - there are exactly 2 `docker run` calls;
  - every `-v` matches `<root>/tmp/restore-test-AAAAMMJJTHHMMSSZ/data:/data`.
- **F16:** the nominal test asserts the exact probe, `fetch('http://127.0.0.1:3000/api/health',*).then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))`.
- **F15:** two new tests.
  - Volume locked: code 1, start then /fail « volume verrouillé : lancer appsport-unlock », no flock, restic or docker call, status.json byte-identical, tmp/ not created.
  - Lock busy: code 1, `flock -n 9` then /fail « verrou occupé », no restic or docker call, tmp/ not created, restoreTest KO.
- **F19:** a copy with `lastWriteAt` null gives code 1, /fail « date de dernière écriture illisible », no « retard », no `docker run -d`, no success ping, an empty tmp/, and the restoreTest detail.
- **F12:** two new tests.
  - SIGTERM during the probe: status exactly 1, then `run -d`, `exec`, `rm -f` in order, no restic check, no success ping, an empty tmp/.
  - set -e abort (`SLEEP=false`, probe KO): status 1, the same `rm -f` order, exactly one exec, no success ping, an empty tmp/.
- RED by mutation of the script, run on the whole file each time:
  - the `-d` run mounting `data/` fails nominal;
  - a probe of `process.exit(0)`, port 3001 or `r.ok` fails nominal;
  - `take_lock` before `volume_ready`, or the volume check removed, fails « volume verrouillé »;
  - a `lag=${lag:-0}` fallback fails the lastWriteAt null test;
  - deleting the traps fails both trap tests;
  - deleting only the INT/TERM trap fails the SIGTERM test, on status 143.
- Group 4's own run: `pnpm test:infra` 1..64, 0 not ok; server ops/db-stats + infra/host-config 21 passed; lint and typecheck clean.

### Conflicts resolved
1. **g3 on g1+g2, `restore-test.bats`, same spot after « restic check offsite KO ».** HEAD had g2's TERM test, and g3 added its two live-database tests (« base réelle en intégrité KO », « base réelle plus ancienne que la sauvegarde »). All three are kept as separate tests.
2. **g3 on g1, `unlock.bats`, same spot after the missed-backup test.** HEAD had g1's « sauvegarde de la nuit en échec (ok false, at récent) » test. g3 added `write_status_at`, `fake_now` and its « test de restauration manqué » test. All are kept.
   - g1's test writes a status.json without `restoreTest`. With g3's F9, unlock now also relaunches restore-test there. g1's test asserts only that the backup is relaunched after the alive ping, so it still holds.
   - I did not add a fresh `restoreTest` to isolate it. With the real clock, `now − 30 min` would fall before the slot during the 30 minutes after a first-Sunday 05:00, which would make the test flaky.
   - g3's `write_status_at` writes `backup.ok: true`, so its cases mean the same thing under g1's F6 rule (only a successful backup counts).
3. **g4 on g1–g3, `restore-test.bats`, after the nominal test.** HEAD had g1's « restes d'un test interrompu » test, and g4 added « volume verrouillé » and « verrou occupé ». All three are kept.
   - g4's « verrou occupé » asserts no docker call and no tmp/. That still holds with g1's purge, which runs only after `take_lock` succeeds.
4. **g4 on g1–g3, `restore-test.bats`, end of file.** HEAD had g2's TERM test and g3's two tests, and g4 added « SIGTERM pendant la sonde » and « abandon par set -e ». All five are kept, with the three trap tests grouped first: g2 TERM at `run -d`, g4 TERM during the probe, g4 set -e. g3's two tests follow.
   - **g4's SIGTERM test was tightened to match g2's F11.** g4 only refuted the success ping, so that it would hold whether or not F11 landed. Now that F11 is in, a TERM during the probe also ends in `fail`. The test now asserts `curl *--data-raw test de restauration interrompu https://hc.test/restore-test/fail` after `rm -f`, plus exactly one /fail.
   - I also added the `# shellcheck disable=SC2016` comment that g2 uses for the same stub snippet.
   - RED for the tightened assertion: with g2's trap line reverted to `trap 'exit 1' INT TERM HUP`, `bats -f 'SIGTERM pendant la sonde'` fails with « appel attendu absent ou hors ordre : curl *--data-raw test de restauration interrompu https://hc.test/restore-test/fail ». The recorded calls end with `docker rm -f appsport-restore-test`. After `git checkout HEAD -- infra/host/appsport-restore-test` it is GREEN, and the script mode is still 100755.
   - Apart from these three lines, the resolved diff equals g4's own diff, checked with `diff` of the +/- lines.

The scripts auto-merged with no conflict:
- `appsport-restore-test`: g1's purge, g2's traps, g3's live checks;
- `appsport-unlock`: g1's `backup_missed`, g3's `restore_test_missed`;
- `common.sh`: g1's `purge_restore_test_leftovers`, g3's `SMART_DEVICES`.

### Integration check (no integration commit)
The combined code needed no fix; the checks below came out clean. Cross-group interactions checked:
- g3's `TimeoutStartSec=6h` sends SIGTERM to restore-test, which now goes through g2's trap. A timed-out test is reported in Healthchecks as /fail « test de restauration interrompu », and the container and copy are removed.
- When unlock relaunches restore-test (g3 F9), it starts with g1's leftover purge, under the lock. `After=appsport-backup.service` (g3) keeps it after the relaunched backup, which also purges under the lock (g1). Neither run can purge the other's live copy.
- g1 removed the pre-emptive `docker rm -f` from `check_container`. The g2 and g4 trap tests still find `rm -f` after `run -d` (from `remove_container`), and the purge's earlier `rm -f` does not break their in-order assertions.
- g3's live-database checks fail before `check_container`, so `refute_call "docker run -d *"` holds next to g1's purge `rm -f`.
- Scripts are still 100755, and the resolved .bats files are LF.

### Final checks (HEAD cace270)
- `pnpm test:infra` (Git Bash, bats 1.13.0, jq in `~/.local/bin`): `1..79`, 79 ok, 0 `not ok`, exit 0. Three tests are skipped: the Windows-only symlink tests 28, 29 and 56, which were skipped before too.
  - Per file: alive 6, backup 8, check 10, common 8, restore-test 15, unlock 9, update 23.
  - The total is the 59 earlier tests plus g1 5, g2 3, g3 7 and g4 5. **Expected in the CI infra job: 79 tests, 0 failures.**
  - restore-test.bats alone, after the last resolution: `1..15`, all ok.
- CI shellcheck (`shellcheck -x infra/host/appsport-* infra/host/lib/common.sh infra/host/test/stub.sh infra/test/image-contract.sh`, ShellCheck 0.10.0): silent, rc 0. The same on `helpers.bash` and `defaults.bash`: rc 0.
- `pnpm lint`: `Checked 443 files in 301ms. No fixes applied.`, exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm --filter @appsport/server test ops/db-stats infra/host-config`: `Test Files 2 passed (2)`, `Tests 24 passed (24)`. That is the base 21, plus g2's 2 db-stats cases and g3's 1 host-config case.
- `pnpm test` (full vitest):
  - Run 1, started while nothing else was running: `Test Files 1 failed | 160 passed (161)`, `Tests 1 failed | 1914 passed | 2 skipped (1917)`. The failure was `apps/web/test/profile/profile-page.test.tsx` « dialogue ouvert : une relecture du compte ne reprend pas le focus » (focus assertion), the same timing flake the T43 integration report recorded.
  - This round changes nothing that test reads. `git diff --name-only 5316fd5 HEAD` outside `infra/` lists only `apps/server/test/infra/host-config.test.ts` and `apps/server/test/ops/db-stats.test.ts`.
  - That file alone passed: `Test Files 1 passed (1)`, `Tests 33 passed (33)`.
  - Run 2 of the full suite passed: `Test Files 161 passed (161)`, `Tests 1915 passed | 2 skipped (1917)`, exit 0. No warning or stderr line was found in the log.
- `git status`: clean, branch ahead of `origin/socle-ops` by 6 commits (not pushed).
- `git show --stat HEAD`: `cace270`, `infra/host/test/restore-test.bats | 85 +++`. That is g4's +82 plus the 3 resolution lines from conflict 4.
- Range `5316fd5..HEAD`: 6 commits, 16 files, +495 −28. The six scripts are still 100755, and all 26 files under `infra/host` and `infra/systemd` are `i/lf w/lf`.
- Fix worktrees:
  - The four were removed with `git worktree remove --force`. All four were clean beforehand, at the heads the groups reported.
  - The branches `fix/T44-r1-g1..g4` were deleted (they were at 1f6b084, fa148f7, b8b24e1, 0b0b6c6).
  - `git worktree list` now shows appsport, appsport-infra, appsport-ops and appsport-pwa.
  - As in earlier rounds, the folders `C:\Users\eliott.colin\appsport-ops-fix-T44-r1-g1..g4` are still on disk. Each holds only `node_modules` (pnpm links, no file outside `node_modules`), which git does not remove. I did not delete them by hand.

### Notes for T45 (docs), merged from the groups
- New or changed motifs and messages:
  - « purge du test de restauration en échec » (backup) and « dossier tmp du volume inutilisable » (restore-test, which now also covers the purge);
  - « test de restauration interrompu » (restore-test /fail on INT, TERM or HUP, including a systemd timeout);
  - « intégrité KO sur la base réelle » and « base réelle plus ancienne que la sauvegarde » (restore-test);
  - « df absent de l'hôte » and « smartctl absent de l'hôte » (check);
  - unlock: « Test de restauration du mois manqué : relance de appsport-restore-test. » and « Avertissement : relance de appsport-restore-test impossible. ».
- `SMART_DEVICES` in healthchecks.env takes `<type>:<path>` entries (for example `sat:/dev/disk/by-id/usb-…`), which add `-d <type>`. By default, zram and mmcblk are excluded.
- Service limits: alive 2min, backup 4h, check 10min, restore-test 6h. restore-test runs after appsport-backup when both start together.
- unlock relaunches a failed backup (`ok` false), not only a missing or stale one. It relaunches restore-test when `restoreTest.at` is missing or older than the last first-Sunday 05:00.
