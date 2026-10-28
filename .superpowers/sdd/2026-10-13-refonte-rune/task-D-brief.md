### Task D: Commande `pnpm dev` (issue #68)

Demande du propriétaire du 2026-10-14 : « On fait ça alors ! » (une commande qui lance tout en local avec rechargement auto).

**But :** depuis la racine du dépôt, sous Windows 11 (PowerShell ou Git Bash), `pnpm dev` démarre en une fois :
- le serveur `@rune/server` en mode surveillance (relancé à chaque modification de `apps/server/src`, `packages/contracts/src` ou `packages/domain/src`), sur `http://localhost:3000` avec `APP_ORIGIN=http://localhost:5173`, `HOST=127.0.0.1` ;
- le web Vite `@rune/web` en mode dev sur `http://localhost:5173` (rechargement à chaud ; le proxy `/api` et `/illustrations` de `apps/web/vite.config.ts` existe déjà et vise le port 3000).

Docker n'est jamais utilisé pour développer.

**Files (indicatif) :**
- Create : `scripts/dev.mjs` (Node pur, aucun shell) ou un équivalent sous `apps/server/scripts/` ; son test sous `apps/server/test/` ou `apps/web/test/` (le projet vitest qui convient).
- Modify : `package.json` racine (script `dev`), `apps/server/package.json` et `apps/web/package.json` si un script `dev` par paquet est plus propre, `README.md` (section « Lancer Rune en local »), `.gitignore` si besoin.

**Exigences :**
1. **Données de dev hors du dépôt** : dossier par défaut `<home>/rune-data-dev` (`os.homedir()`), surchargeable par `RUNE_DATA_DIR`. Au premier lancement, le script crée le dossier et la sentinelle `.rune-volume`, puis lance `init` (CLI existante de `apps/server/src/main.ts` / `cli.ts`) une seule fois. Si la base existe, il ne refait rien.
2. **Premier admin** : si aucun compte n'existe encore, le script lance `admin:bootstrap` avec une date de naissance factice adulte (paramétrable par `RUNE_DEV_BIRTH_DATE`, défaut `1990-01-01`) et affiche le lien d'invitation **une seule fois dans la console** (jamais écrit dans un fichier, jamais dans un rapport ni un message de commit ; règle « pas de code ni de lien à # » des rapports). Lire `cli.ts` pour savoir comment détecter qu'un admin existe (code de sortie ou commande dédiée) ; ne pas lire la base en SQL brut depuis le script si la CLI suffit. Le lien doit pointer sur l'origine du web (5173), pas sur le port du serveur : vérifier que `APP_ORIGIN` y suffit.
3. **Variables** : `RUNE_PUBLIC_DIR` vers `apps/web/dist` s'il existe (sinon un dossier vide créé dans le dossier de données de dev : le serveur ne doit pas planter sans build web) ; `RUNE_CONTENT_DIR` vers `data/` du dépôt. Toute variable déjà définie dans l'environnement gagne sur la valeur par défaut.
4. **Processus** : les deux enfants sont lancés sans `shell: true` (sous Windows, `pnpm` est un `.cmd` : passer par `process.execPath` + le chemin de `vite`/`tsx` résolu, ou par `corepack`/`npm_execpath`, au choix, mais sans interpolation de chaîne dans un shell). Sorties préfixées `[serveur]` et `[web]`. Ctrl+C arrête les deux (et leurs sous-processus : sous Windows, `taskkill /pid <pid> /T /F` en dernier recours) ; si l'un des deux s'arrête en erreur, l'autre est arrêté et le code de sortie est non nul. Aucune dépendance nouvelle sauf si elle est indispensable ; dans ce cas, version exacte publiée depuis au moins deux semaines (`npm view <pkg> time`). La surveillance du serveur passe par `node --watch` ou `tsx watch` (déjà présent ?).
5. **Ports occupés** : si 3000 ou 5173 est déjà pris, message clair en français et sortie non nulle (Vite a déjà `strictPort`).
6. **Le service worker** : en dev, le précache n'existe pas (plugin au build seulement) ; vérifier qu'aucun SW d'un ancien build ne reste servi sur 5173, sinon le dire dans le README.
7. **README** : la section « Lancer Rune en local (sans Docker) » commence par `pnpm install` puis `pnpm dev`, explique où sont les données de dev, comment repartir de zéro (supprimer le dossier `rune-data-dev`), où trouver le lien d'invitation, et garde la procédure « comme en production » (build + `node --import tsx src/main.ts`) en dessous pour tester l'appli installable. Ton du README actuel : phrases courtes, français, tutoiement absent du README (il dit « il faut »).
8. **Tests** : la logique pure (calcul des variables et des chemins, décision init/bootstrap, analyse de la sortie de la CLI) est extraite dans des fonctions testées (RED d'abord). Un test d'intégration léger peut lancer le script sur un dossier temporaire et des ports libres, attendre que `GET /api/health` (ou la route de santé existante) réponde, puis l'arrêter et vérifier qu'aucun processus ni fichier hors du dossier temporaire ne reste ; s'il est trop lent ou fragile sous Windows, le dire dans le rapport plutôt que d'ajouter un test instable.
9. **Le test de nom** (`apps/server/test/infra/name.test.ts`) et `docs.test.ts` restent verts (aucun « appsport » ; si docs.test vérifie la section du README, l'adapter).
10. Lancer `pnpm lint`, `pnpm typecheck`, `pnpm test`, puis lancer réellement `pnpm dev` sur un dossier de données temporaire (`RUNE_DATA_DIR`), vérifier que `http://localhost:5173` répond, que `/api` passe par le proxy, qu'une modification d'un fichier serveur relance le serveur, puis arrêter avec Ctrl+C (ou en tuant l'arbre) et vérifier qu'aucun processus `node` lancé par le test ne reste. Supprimer ce dossier temporaire.

**Commit** : `feat(dev): pnpm dev lance le serveur et le web en local, base et premier admin créés au premier lancement` avec `Closes #68` et le trailer Co-Authored-By.
