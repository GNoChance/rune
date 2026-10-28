### Task 0: Renommage complet appsport → rune

**Files:**
- Modify: tout le dépôt sauf `docs/superpowers/**` et `docs/research/**` (historique) : `package.json` des 5 paquets et leurs imports, configs (tsconfig, vitest, biome, playwright), `pnpm-lock.yaml` (régénéré), `apps/**`, `packages/**`, `infra/**`, `.github/workflows/**`, `docs/exploitation/**`, `docs/adr/**`, `docs/fiche-de-traitement.md`, `docs/incidents.md`, `README.md`, `data/LICENSE`
- Rename (git mv) : `infra/host/appsport-*` → `infra/host/rune-*` ; `infra/systemd/appsport-*` → `infra/systemd/rune-*` ; les fichiers d'infra nommés `appsport` (drop-in Docker, fichier apt `52appsport-unattended`, etc.) ; `docs/exploitation/installer-appsport.md` → `installer-rune.md`
- Create: `apps/server/test/infra/name.test.ts`

**Interfaces:**
- Produces (noms que toutes les tâches suivantes utilisent) :
  - paquets `rune` (racine), `@rune/contracts`, `@rune/domain`, `@rune/server`, `@rune/web` ; commandes `pnpm --filter @rune/<paquet>` ;
  - en-têtes `X-Rune-Epoch`, `X-Rune-Protocol` (constantes `EPOCH_HEADER`, `PROTOCOL_HEADER` inchangées) ;
  - variables d'environnement `RUNE_*` à la place de chaque `APPSPORT_*` (`RUNE_DATA_DIR`, `RUNE_PUBLIC_DIR`, `RUNE_CONTENT_DIR`, `RUNE_URL`, `RUNE_ROOT`, `RUNE_REPO`, `RUNE_VERSION`, …) ;
  - données : `/data/rune.db`, sentinelle `/data/.rune-volume`, `EXPORT_FORMAT` = `rune-export/1`, fichier d'export `rune-export-AAAA-MM-JJ.json` ;
  - navigateur : bases Dexie, clés de stockage, noms d'événements et préfixe de journal en `rune` ;
  - hôte : `/srv/rune`, `/opt/rune`, projet compose `rune`, image `ghcr.io/gnochance/rune`, scripts `rune-unlock`, `rune-update`, `rune-backup`, `rune-restore-test`, `rune-alive`, `rune-check`, unités systemd `rune-*`, mapper LUKS `rune`, partlabel `rune-data`, verrou `/run/rune.lock`, bucket B2 `rune-backups`, machine Tailscale `rune`, adresse `https://rune.<tailnet>.ts.net`, dépôt `https://github.com/GNoChance/rune` ;
  - textes visibles : « Rune » (consentement « que Rune enregistre », version 1.0 inchangée ; avertissement santé « Rune ne remplace pas un avis médical… », en « vous ») ;
  - R-MDP-3 : refus d'un mot de passe qui contient « rune » (insensible à la casse), code `contains_app_name`, message « Le mot de passe ne doit pas contenir « rune ». » ;
  - `RESERVED_USERNAMES` : `admin`, `rune`, `appsport`, `systeme`.

- [ ] **Step 1: Test qui échoue** — `name.test.ts` : parcourt `git ls-files` (hors `docs/superpowers/`, `docs/research/`, fichiers binaires) et échoue si un chemin ou un contenu contient « appsport » (insensible à la casse), sauf deux exceptions exactes : l'entrée `'appsport'` de `RESERVED_USERNAMES` et le nom de fichier historique `2026-10-06-appsport-design` ; il vérifie aussi que `docs/exploitation/P1-installation.md` contient `rune.<tailnet>.ts.net` et que `isPasswordAcceptable` (ou la fonction R-MDP-3 existante) refuse « MaRune2026!! ».
- [ ] **Step 2: Lancer** `pnpm --filter @rune/server test infra/name` après le renommage des paquets (sinon par chemin) — FAIL.
- [ ] **Step 3: Renommer** : paquets et imports d'abord (`pnpm install` régénère le lockfile), puis identifiants, variables, chemins, scripts et unités (`git mv`), puis docs d'exploitation et textes visibles ; mettre à jour tous les tests (unitaires, bats, `docs.test.ts`, E2E).
- [ ] **Step 4: Lancer** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:infra` (Git Bash), `pnpm --filter @rune/web test:e2e` (Chromium et WebKit), le build de production du serveur et du web — tout vert.
- [ ] **Step 5: Commit** `refactor: l'appli et son code s'appellent Rune`.


