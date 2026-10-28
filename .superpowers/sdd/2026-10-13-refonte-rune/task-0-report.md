# Task 0 — Renommage complet appsport → rune : rapport

Branche `socle`, checkout principal `C:\Users\eliott.colin\appsport`, base 688e658. Issue #65.

## Ce qui a été fait

Tout ce qui est suivi par git hors `docs/superpowers/**` et `docs/research/**` (intouchés, historique) s'appelle désormais Rune.

**Paquets** : `rune` (racine), `@rune/contracts`, `@rune/domain`, `@rune/server`, `@rune/web` ; tous les imports et les `--filter` (scripts racine, CI) suivent ; `pnpm-lock.yaml` régénéré par `pnpm install` (aucune édition à la main : seuls les noms changent, et l'ordre alphabétique des importateurs).

**Identifiants (code)** — règle : un identifiant devient `rune` / `RUNE`, un texte lu par une personne devient « Rune » :
- en-têtes `X-Rune-Epoch`, `X-Rune-Protocol` (constantes `EPOCH_HEADER`, `PROTOCOL_HEADER` inchangées) ;
- variables `RUNE_*` (`RUNE_DATA_DIR`, `RUNE_PUBLIC_DIR`, `RUNE_CONTENT_DIR`, `RUNE_URL`, `RUNE_ROOT`, `RUNE_REPO`, `RUNE_VERSION`, …), sans repli sur les anciennes ;
- données : `/data/rune.db`, sentinelle `.rune-volume`, `EXPORT_FORMAT = 'rune-export/1'`, fichier `rune-export-AAAA-MM-JJ.json` ;
- navigateur : base Dexie `rune`, cache marqueur `rune-meta`, événement `rune:onboarding-completed`, préfixe de journal `[rune]`, global du service worker `__RUNE_PRECACHE__`, plugin Vite `rune-precache` ;
- bundle serveur : `__runeCreateRequire` ; dossiers temporaires des tests `rune-*`.

**R-MDP-3** : `validatePassword` (la fonction R-MDP-3 existante, `packages/domain/src/auth/password.ts`) refuse un mot de passe qui contient « rune » (insensible à la casse, après NFKC), code `contains_app_name`, message « Le mot de passe ne doit pas contenir « rune ». ».
**`RESERVED_USERNAMES`** : `['admin', 'rune', 'appsport', 'systeme']`.

**Textes visibles** : titre HTML, manifeste (`name`, `short_name`), marque de l'en-tête, page d'invitation (« Bienvenue sur Rune », « Rune est un outil… »), aide d'installation, confidentialité (« Rune ne peut pas… », « tout ce que Rune garde… »), âge minimum (« Rune est réservé aux 16 ans et plus »), CLI. Textes légaux : seule substitution du nom — consentement « J'accepte que Rune enregistre… » (version 1.0 inchangée), avertissement santé « Rune ne remplace pas un avis médical… » (toujours en « vous »).

**Hôte et infra** (`git mv`) : `infra/host/rune-{alive,backup,check,restore-test,unlock,update}` (mode 100755 conservé), `infra/systemd/rune-*.{service,timer}`, `infra/systemd/docker.service.d/rune.conf`, `infra/apt/52rune-unattended`, `docs/exploitation/installer-rune.md`. Contenus : `/srv/rune`, `/opt/rune`, projet compose `rune`, image `ghcr.io/gnochance/rune`, mapper LUKS `rune`, partlabel `rune-data`, verrou `/run/rune.lock`, `/etc/rune/healthchecks.env`, bucket `rune-backups`, machine Tailscale `rune`, `https://rune.<tailnet>.ts.net`, dépôt `GNoChance/rune`, image de CI `rune:ci`, shellcheck sur `infra/host/rune-*`. Messages des scripts : « OK : Rune répond (version …) », « Une autre opération Rune est en cours. … » ; `Description=Rune : …` des unités.

**Docs** : `docs/exploitation/**` (P1 à P9, fiche « Installer Rune », recette), `infra/RUNBOOK-reconstruction.md`, `docs/adr/0001`, `docs/fiche-de-traitement.md`, `docs/incidents.md`, `data/LICENSE` (« © les auteurs de Rune »), `README.md` (la note sur l'ancien nom de code est réécrite : tout s'appelle Rune, seuls `docs/superpowers/` et `docs/research/` gardent l'ancien nom). Les liens vers la spec principale gardent son nom de fichier historique `2026-10-06-appsport-design` (README, `docs.test.ts`).

## Méthode

1. `name.test.ts` écrit d'abord (voir TDD).
2. Phase 1, script Node (scratchpad, hors dépôt) : `@appsport/` → `@rune/` dans les fichiers texte suivis, nom du paquet racine ; `pnpm install`.
3. `git mv` des 17 fichiers dont le nom portait l'ancien nom.
4. Phase 2, script Node, règles ordonnées sur les fichiers listés par `git grep -l -i -I` (jamais de binaire, jamais l'historique ni le lockfile) : code `contains_app_name` ; formes élidées (`qu'… ` → « que Rune », `d'…` → « de Rune », `d'…-update` → « de rune-update ») ; textes lus par une personne → « Rune » (règles ciblées : « … est / ne / n'est / répond / garde / tourne / depuis », « Installer … », « Bienvenue sur … », entrées « … LUKS / restic / Unix / enveloppe » du gestionnaire, `Description=`, `<title>`, marque de l'en-tête, manifeste) ; puis tout le reste en identifiant (`APPSPORT` → `RUNE`, `Appsport` → `Rune`, `appsport` → `rune`).
5. Corrections à la main : `RESERVED_USERNAMES` et son test ; message R-MDP-3 en « rune » minuscule ; test du mot de passe (« mon RuNe adoré ») ; test des pseudos réservés (parcourt aussi `RESERVED_USERNAMES`, donc l'ancien nom sans l'écrire) ; liens vers la spec historique ; note du README.
6. Relecture : chaque ligne ajoutée contenant « Rune » (texte lu) puis chaque `rune` nu hors bloc de code (identifiant) passée en revue, y compris suivi d'une ponctuation. Quatre textes lus passés en « Rune » à la main : « Seul le trafic vers Rune » et « coupe l'autre pour utiliser Rune. » (fiche des proches), « **Démarrer Rune.** » (P1), « **Déverrouiller et démarrer Rune.** » (P2). Gardés en `rune` car ils nomment un identifiant : « ce n'est pas le volume rune. » (message de `rune-unlock`, le volume LUKS s'appelle `rune`), « base rune intacte » (base Dexie `rune`), l'invite systemd « (rune) ».
7. `biome check --write` : 9 fichiers reformatés (imports `@rune/…` plus courts, donc tenant sur une ligne, et ordre des imports).
8. Quatre attentes de tests du service worker comparaient une liste **triée** de caches écrite pour l'ancien nom (`appsport-meta` passait avant `autre` et `illustrations-v1`) : ordre attendu mis à jour, mêmes éléments (`test/sw/register.test.ts`, `test/sw/sw-handlers.test.ts`).

## TDD

`apps/server/test/infra/name.test.ts` : parcourt `git ls-files` (hors `docs/superpowers/`, `docs/research/`, fichiers binaires à octet nul) et échoue si un chemin ou un contenu contient l'ancien nom (insensible à la casse), sauf les deux exceptions exactes (le contenu de la liste `'admin', 'rune', '…', 'systeme'` de `RESERVED_USERNAMES` et le nom de fichier `2026-10-06-…-design`) ; vérifie que P1 contient `rune.<tailnet>.ts.net` et que `validatePassword('MaRune2026!!', …)` renvoie `contains_app_name`. L'ancien nom y est recomposé (`['app', 'sport'].join('')`) pour que le fichier ne se dénonce pas lui-même.

**RED 1** (test écrit, rien renommé) — `pnpm --filter @appsport/server test infra/name` :
```
 FAIL  |server| test/infra/name.test.ts [ apps/server/test/infra/name.test.ts ]
Error: Cannot find package '@rune/domain' imported from C:/Users/eliott.colin/appsport/apps/server/test/infra/name.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**RED 2** (paquets renommés seulement, comme le prévoit le brief) — `pnpm --filter @rune/server test infra/name` :
```
 FAIL  |server| test/infra/name.test.ts > tout s'appelle Rune > aucun chemin suivi ne porte l'ancien nom de code
AssertionError: expected [ …(17) ] to deeply equal []
 FAIL  |server| test/infra/name.test.ts > tout s'appelle Rune > aucun fichier texte suivi ne contient l'ancien nom de code
AssertionError: expected [ '.github/workflows/ci.yml', …(147) ] to deeply equal []
 FAIL  |server| test/infra/name.test.ts > tout s'appelle Rune > les procédures donnent l'adresse définitive rune.<tailnet>.ts.net
AssertionError: expected '# P1 Installation initiale\n\nQuand :…' to contain 'rune.<tailnet>.ts.net'
 FAIL  |server| test/infra/name.test.ts > tout s'appelle Rune > R-MDP-3 refuse un mot de passe qui contient « rune », sans tenir compte de la casse
AssertionError: expected { ok: true } to deeply equal { ok: false, …(1) }
 Test Files  1 failed (1)
      Tests  4 failed (4)
```

**GREEN** — `pnpm --filter @rune/server test infra/name` :
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

## Vérifications

| Commande | Résultat |
|---|---|
| `pnpm lint` | `Checked 449 files … No fixes applied.` (après `biome check --write`, voir Méthode 7) |
| `pnpm typecheck` | 4 paquets `@rune/*`, aucune erreur |
| `pnpm test` | `Test Files 163 passed (163)` · `Tests 2030 passed \| 2 skipped (2032)` ; sortie propre (les 2 sautés sont les `it.runIf` existants : pilote SQLite, jeu figé v1) |
| `pnpm --filter @rune/server test infra` (après les dernières retouches de docs) | `Test Files 6 passed (6)` · `Tests 156 passed (156)` |
| `pnpm --filter @rune/web test:e2e` (Chromium Pixel 7 et WebKit iPhone 14) | `12 passed (3.0m)`, exit 0 — arrival, epoch, kill-switch, offline, protocol, update, dans les deux navigateurs |
| `pnpm build` (web puis serveur) | web : `✓ built`, `dist/index.html` a `<title>Rune</title>`, `sw.js` pose `__RUNE_PRECACHE__` ; serveur : `node build.mjs` OK. L'avertissement Vite « chunk > 500 kB » existait déjà. L'ancien nom n'apparaît dans les deux bundles que dans `RESERVED_USERNAMES`. |
| bats (`LC_ALL=C.UTF-8 pnpm exec bats "$PWD/infra/host/test"`, Git Bash) | `1..79`, 79 `ok`, 0 `not ok`, exit 0 ; 3 `# skip` existants (liens symboliques non fiables sous Windows, vérifiés en CI : tests 28, 29, 56) |
| `pnpm test` + `pnpm lint` finaux (arbre commité) | `163 passed (163)` · `2030 passed \| 2 skipped` ; `No fixes applied.` |

Docker (`docker build` + `infra/test/image-contract.sh rune:ci`) et `shellcheck -x infra/host/rune-* …` restent réservés à la CI (ni Docker ni shellcheck sur ce PC) : non lancés ici, les commandes de `ci.yml` sont à jour.

## Fichiers

314 fichiers suivis modifiés ou renommés (+ `apps/server/test/infra/name.test.ts` créé) : `package.json` des 5 paquets, `pnpm-lock.yaml`, `apps/**`, `packages/**`, `infra/**`, `.github/workflows/{ci,release}.yml`, `docs/exploitation/**`, `docs/adr/0001-service-worker-maison.md`, `docs/fiche-de-traitement.md`, `docs/incidents.md`, `README.md`, `data/LICENSE`. Liste exacte : `git show --stat HEAD`.

## Commit

`f408800 refactor: l'appli et son code s'appellent Rune` (un seul commit, pour que chaque commit reste vert : `docs.test.ts` et `name.test.ts` lient code, infra et docs) ; corps terminé par `Closes #65` puis le trailer `Co-Authored-By`. Non poussé. `git show --stat HEAD` : 315 fichiers, dont `name.test.ts` créé et les 17 renommages ; `git status` propre ensuite. Paquet de revue : `.superpowers/sdd/2026-10-13-refonte-rune/review-688e658..f408800.diff`.

## Auto-relecture

- Plus aucune occurrence hors historique, sauf les deux exceptions (vérifié par le test et par `git grep -i`) ; les bundles de production ne contiennent l'ancien nom que dans `RESERVED_USERNAMES`.
- Aucune compatibilité ascendante : pas de lecture des anciennes clés, en-têtes, variables ou chemins, pas de paquet alias.
- `docs/superpowers/**` et `docs/research/**` intouchés (`git diff --stat 688e658 HEAD -- docs/superpowers docs/research` vide).
- Textes légaux : seule la substitution du nom ; version du consentement 1.0 ; avertissement santé en « vous ».
- Apostrophes droites dans les textes ajoutés.

## Remarques

- **Stashes de l'ancien run** (non touchés) : `stash@{1}` (« wip T1 », dépendances Fontsource dans `apps/web/package.json` + `pnpm-lock.yaml`) et `stash@{0}` (« wip T6 », tests coach) datent d'avant le renommage. Un `git stash pop` entrerait en conflit sur le lockfile et réintroduirait des imports `@appsport/…` (que `name.test.ts` refuse) : réajouter les polices par `pnpm --filter @rune/web add …` et reprendre les tests T6 avec `@rune/*`. NB : `pnpm install` a retiré de `node_modules` les 3 paquets Fontsource installés par ce WIP (« Packages: -3 »).
- **R-MDP-3 sur « rune »** refuse aussi des mots courants (« prune », « brune », « runes ») : c'est la règle décidée (P14, spec §3) ; le message l'explique.
- **bats sous Windows** : lancé par l'équivalent documenté dans le registre du socle (T43) `LC_ALL=C.UTF-8 pnpm exec bats "$PWD/infra/host/test"` depuis Git Bash (le registre note que `pnpm test:infra` passe par cmd et donne à bats un chemin relatif sous Windows ; un premier lancement par `pnpm test:infra`, enchaîné trois fois par erreur, a été arrêté pour cette raison) ; la CI lance `pnpm test:infra` tel quel.
- **Renommages et `git diff -M`** : les 17 fichiers sont déplacés par `git mv`, mais pour les petits fichiers très modifiés (unités systemd, drop-in) git affiche suppression + ajout (similarité < 50 %) ; `git log --follow -M30%` retrouve l'historique.
- `.e2e-data/` (ignoré) peut garder des fichiers aux anciens noms d'avant ; le harnais écrit les nouveaux et les E2E passent.

---

## Rapport de correctifs — tour 1 (intégration des trois groupes)

Intégration dans `socle` (copie principale `C:\Users\eliott.colin\appsport`), depuis `f408800`, par `git cherry-pick f408800..<branche>` dans l'ordre g1, g2, g3 : historique linéaire, aucun commit de fusion. Les 7 commits gardent leur message d'origine (« Refs #65 » puis le trailer `Co-Authored-By`). Aucun commit de réparation n'a été nécessaire.

| Commit sur `socle` | Origine | Constat |
|---|---|---|
| `0fea11b` test(web): les textes visibles « Rune » gardent leur majuscule | g1 `ce2494b` | T0-F7 |
| `e98bef5` test(server): P1 vérifie APP_ORIGIN, RUNE_URL et chaque machine du tailnet | g1 `2f75371` | T0-F6 |
| `c4b09ab` test(web): listes de caches attendues triées, comme les listes lues | g1 `70867af` | T0-F8 |
| `38aab0e` test(web): le message R-MDP-3 est vérifié mot pour mot | g2 `da97b07` | T0-F5 |
| `97085d2` docs(exploitation): repli si le nom de bucket rune-backups est déjà pris | g2 `f75c522` | T0-F4 |
| `96d16f7` refactor(server): un seul nom pour la base et la sentinelle | g3 `7a12cfc` | T0-F3 |
| `245c1ef` docs(exploitation): « de rune-update », sans élision | g3 `07c7dc5` (conflit résolu) | T0-F1 |

### Groupe 1 — T0-F7, T0-F6, T0-F8 (tests seulement, 6 fichiers de test)

- **T0-F7** (textes visibles « Rune ») : `apps/web/test/pwa/manifest.test.ts` exige `<title>Rune</title>` dans `index.html` ; `apps/web/test/auth/invite.test.tsx` exige le titre de niveau 1 « Bienvenue sur Rune » ; `apps/web/test/privacy/withdraw.test.tsx` exige « Un fichier JSON avec tout ce que Rune garde sur ton compte. ». RED (sources passées en « rune » minuscule) : `Tests 3 failed | 68 passed (71)`, les 3 nouvelles assertions. GREEN : `Tests 71 passed (71)`.
- **T0-F6** (`apps/server/test/infra/name.test.ts`) : le test par sous-chaîne est remplacé par deux contrôles ancrés `^\s*APP_ORIGIN=https://rune.<tailnet>.ts.net$` et `^\s*RUNE_URL=…$` (P1 en LF), plus « toute machine `<hôte>.<tailnet>.ts.net` nommée dans P1 est exactement `rune` » (au moins une). Trou montré d'abord (P1 avec `prune.` et `runes.` : ancien test vert, 4/4). RED avec le nouveau test sur 3 mutations (les deux coquilles, RUNE_URL seul, `nc -vz … runes.<tailnet>.ts.net 22`) : 1 échec chaque fois. GREEN : 4/4.
- **T0-F8** (`apps/web/test/sw/sw-handlers.test.ts` lignes 225, 343, 369, 749 ; `apps/web/test/sw/register.test.ts:611`) : chaque liste attendue écrite à la main est triée comme la liste lue (`[…].sort()`), mêmes éléments. RED (`LOCAL_DB_MARKER_CACHE` mis temporairement à `aaa-meta`) : `Tests 4 failed | 100 passed (104)`. GREEN : 104/104 avec `aaa-meta` et `zzz-meta` ; `test/sw` 159/159 avec `rune-meta`. Laissés tels quels à dessein : `kill-switch.test.ts:71/117` (ordre de création), `sw-handlers.test.ts:814/841` (même helper), `:751` (n'utilise pas le marqueur).
- Tests du groupe : lint 449 fichiers sans correction, typecheck 0, `pnpm test` 163/163 · 2030 passed | 2 skipped ; couverture web 71/71, `test/sw` 159/159, `infra/name` 4/4.

### Groupe 2 — T0-F5, T0-F4 (5 fichiers)

- **T0-F5** (`apps/web/test/auth/messages.test.ts`) : `PASSWORD_MESSAGES.contains_app_name` vérifié mot pour mot (« Le mot de passe ne doit pas contenir « rune ». »). Source déjà correcte. RED (source passée à « Rune ») : `Expected … « rune » … Received … « Rune »`. GREEN : 19/19.
- **T0-F4** (nom de bucket B2 déjà pris) : nouveau test dans `apps/server/test/infra/docs.test.ts` (P1 « Dépôts restic », P5 « Clé B2 », runbook étape 4). RED : `` AssertionError: `rune-backups` parce qu: expected … to contain … `` (1 failed). Correctif : `docs/exploitation/P1-installation.md` (étape 2, ligne « Sinon » : repli `rune-backups-<suffixe>`, nom noté dans le gestionnaire puis sur la feuille des secrets, repris par P1, P5 et le runbook), `docs/exploitation/P5-rotation-secrets.md` (phrase d'introduction de « Clé B2 »), `infra/RUNBOOK-reconstruction.md` (étape 4). `rune-backups` reste le nom par défaut ; scripts inchangés (ils ne lisent que `RESTIC_OFFSITE_REPOSITORY`). GREEN : `infra` 6 fichiers, 157 tests.
- Tests du groupe : `pnpm test` 163/163 · 2031 passed | 2 skipped ; lint et typecheck propres.

### Groupe 3 — T0-F3, T0-F1 (8 fichiers)

- **T0-F3** (un seul nom pour la base) : `apps/server/src/config.ts` exporte `DB_FILE = 'rune.db'` et `SENTINEL_FILE = '.rune-volume'` à côté de `dataDirFrom` ; `loadConfig`, `cli.ts` (`db:stats`) et `ops/restore.ts` les utilisent (pas de cycle d'import). Tests : `apps/server/test/config.test.ts` (constantes et chemins pour `RUNE_DATA_DIR=/srv/ailleurs`) ; `apps/server/test/ops/cli-ops.test.ts`, nouveau test restore puis `db:stats` avec seulement `RUNE_DATA_DIR`, sans nom de fichier en dur. RED : `expected undefined to be 'rune.db'` ; dérive démontrée par deux mutations jetables (`runes.db` dans `restore.ts` → `unable to open database file` ; dans `cli.ts` → `Base introuvable : …runes.db.`). GREEN : 154 tests couvrants.
- **T0-F1** (« de `rune-update` ») : 4 lignes de `docs/exploitation/P4-restaurer.md` (3, 13, 30, 53) et la ligne 71 de `docs/exploitation/P8-incident.md`. Nouveau test dans `name.test.ts` : la regex `/\p{L}['’]`?rune/iu` sur chaque fichier texte suivi hors historique, avec fichier:ligne. RED : `expected [ …(5) ] to deeply equal []` (les 5 lignes). GREEN : 5/5 tests de nom.
- Tests du groupe : `pnpm --filter @rune/server test` 75 fichiers, 695 passed | 2 skipped ; timeouts sporadiques sous charge (`release.test.ts`, `bundle.test.ts`) passant seuls.

### Conflit résolu

- **`apps/server/test/infra/name.test.ts`** au cherry-pick de `07c7dc5` (g3, T0-F1) : g1 (T0-F6) avait remplacé le test « les procédures donnent l'adresse définitive rune.<tailnet>.ts.net » (sous-chaîne) par le test ancré « P1 donne l'adresse définitive https://rune.<tailnet>.ts.net, à APP_ORIGIN et RUNE_URL compris » ; g3 ajoutait le test d'élision juste avant l'ancien test par sous-chaîne, qu'il gardait.
- Résolution : garder **les deux** nouveautés et supprimer l'ancien test par sous-chaîne, que T0-F6 remplace. Ordre final : chemins, contenu, élision (g3), P1 ancré (g1), R-MDP-3. Le test d'élision vérifie aussi les textes ajoutés par g2 (P1, P5, runbook) : aucun signalement.
- Vérification : `pnpm --filter @rune/server test infra/name infra/docs test/config.test.ts ops/cli-ops ops/restore ops/db-stats` → `Test Files 7 passed (7)` · `Tests 155 passed (155)` (154 de g3 + le test docs de g2). Côté web : `pnpm --filter @rune/web test test/pwa/manifest.test.ts test/auth/invite.test.tsx test/privacy/withdraw.test.tsx auth/messages test/sw` → `Test Files 12 passed (12)` · `Tests 249 passed (249)` (71 + 19 + 159).
- Après intégration, seul `name.test.ts` diffère du contenu de chaque branche (union attendue) ; tous les autres fichiers touchés sont identiques à leur branche.

### Vérifications finales (arbre `245c1ef`)

| Commande | Résultat |
|---|---|
| `pnpm lint` | `Checked 449 files in 257ms. No fixes applied.` exit 0 |
| `pnpm typecheck` | `@rune/contracts`, `@rune/domain`, `@rune/server`, `@rune/web` : `tsc --noEmit`, aucune erreur, exit 0 |
| `pnpm test` (3ᵉ lancement) | `Test Files 163 passed (163)` · `Tests 2034 passed \| 2 skipped (2036)`, exit 0, stderr vide (0 octet) |

Compte attendu : 2030 du socle renommé + 1 (docs g2) + 3 (config, cli-ops, élision g3) = 2034 ; les 2 sautés sont les `it.runIf` existants.

Les deux premiers lancements complets ont échoué uniquement par timeouts de 5 s, dans des fichiers qu'aucun groupe ne touche (`git diff --stat f408800 HEAD` vide pour eux) :
- lancement 1 : `test/pwa/precache-plugin.test.ts` › bundleServiceWorker (esbuild, 5261 ms) ; `1 failed | 2033 passed` ;
- lancement 2 : `test/infra/release.test.ts` (2 tests, 5057 et 8257 ms), `test/pwa/precache-plugin.test.ts` (5496 ms), `test/sync/scenarios.test.ts` › changement d'époque (5508 ms, puis `EPERM` au nettoyage du dossier temporaire) ; `4 failed | 2030 passed`.
- Seuls, ces fichiers passent : `infra/release` 16/16, `scenarios` + `precache-plugin` 19/19. Ce sont les tests qui lancent bash, esbuild ou un vrai serveur et ralentissent sous charge : point « tests qui échouent parfois » de la feuille de route. Le 3ᵉ lancement est vert et propre.

Non lancés : E2E, `pnpm test:infra` (bats), builds, Docker, shellcheck. Les correctifs ne touchent que des tests, trois procédures Markdown et trois modules serveur (`config.ts`, `cli.ts`, `ops/restore.ts`) couverts par les tests unitaires ci-dessus ; aucun script d'infra ni entrée de build modifié. Docker et shellcheck restent réservés à la CI.

### Nettoyage

- `git worktree remove --force` sur `appsport-fix-T0-r1-g1`, `-g2`, `-g3` : exit 0 chacun (worktrees propres avant suppression). Des coquilles vides restaient (0 fichier, 226 jonctions pnpm chacune, toutes pointant dans leur propre dossier) : supprimées par `rmdir /s /q`, qui ne suit pas les jonctions. Les dossiers T37/T39 d'anciens tours n'ont pas été touchés.
- Branches `fix/T0-r1-g1` (70867af), `fix/T0-r1-g2` (f75c522), `fix/T0-r1-g3` (07c7dc5) supprimées.
- `git status` : `nothing to commit, working tree clean`, `socle` en avance de 8 commits sur `origin/socle` (non poussé). `git show --stat HEAD` : `245c1ef`, 3 fichiers (`name.test.ts` +14, `P4-restaurer.md` 8 lignes, `P8-incident.md` 2 lignes).
- Paquet de revue : `.superpowers/sdd/2026-10-13-refonte-rune/review-f408800..245c1ef.diff` (7 commits, 45827 octets).

Constats traités et conservés après intégration : T0-F1, T0-F3, T0-F4, T0-F5, T0-F6, T0-F7, T0-F8. Aucun constat écarté.
