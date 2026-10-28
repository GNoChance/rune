### Task 41: Bundle serveur, Dockerfile, compose et contrat d'image

**Files:**
- Create: `apps/server/build.mjs`, `infra/Dockerfile`, `.dockerignore`, `infra/compose.yaml`, `infra/test/image-contract.sh`
- Modify: `apps/server/package.json` (`build: "node build.mjs"`, dev `esbuild`, `yaml` 2.x), `package.json` racine (`build:server`, `build` = web puis serveur), `.github/workflows/ci.yml` (job `image`)
- Test: `apps/server/test/build/bundle.test.ts`, `apps/server/test/infra/compose.test.ts`

**Interfaces:**
- Consumes : T7 (`main`, `init`, `db:check`) ; T6 (`/api/health`) ; T35 (`APPSPORT_PUBLIC_DIR`) ; T23 (`APPSPORT_CONTENT_DIR`).
- Produces : `apps/server/dist/server.mjs` (un fichier ESM, aucun import hors `node:*`) ; image `/app/server.mjs`, `/app/public/`, `/app/data/` avec `ENV NODE_ENV=production APP_VERSION=${VERSION} PORT=3000 HOST=0.0.0.0 APPSPORT_DATA_DIR=/data APPSPORT_PUBLIC_DIR=/app/public APPSPORT_CONTENT_DIR=/app/data` ; `infra/compose.yaml` (projet `appsport`, service `app`) ; `infra/test/image-contract.sh <image> <version>` (code 0 si conforme).

**Spec:** R-DEP-2, R-DEP-5, R-OPS-3, R-TST-1, 08 §4 (compose, contrat 1 à 7), §13.1, 01 §2 et §3.

- [ ] **Step 1: Write the failing test**

```ts
// bundle.test.ts : node build.mjs → 0 ; server.mjs copié dans un dossier temporaire HORS du dépôt (aucun node_modules), avec data/.appsport-volume,
//   public/index.html et une copie de data/ du dépôt
// node server.mjs init → 0 et data/appsport.db créé ; db:check → 0
// serveur lancé → /api/health { status: 'ok', version: 'v9.9.9-test', db: 'ok', protocol: 1, minProtocol: 1, swKill: false }
expect(src).not.toMatch(/(?:from|import\()\s*['"](?!node:)[a-z@][^'"]*['"]/);
// compose.test.ts (yaml)
expect(Object.keys(compose.services)).toEqual(['app']);
expect(app.image).toBe('ghcr.io/gnochance/appsport:${APPSPORT_VERSION:?APPSPORT_VERSION absent de deploy.env}');
expect(app.ports).toEqual(['127.0.0.1:3000:3000']); expect(app.volumes).toEqual(['/srv/appsport/data:/data']);
expect(app.env_file).toBe('/srv/appsport/secrets/app.env');
expect(app).toMatchObject({ read_only: true, tmpfs: ['/tmp'], user: '1000', mem_limit: '512m', restart: 'unless-stopped', stop_grace_period: '10s' });
// healthcheck vers http://127.0.0.1:3000/api/health ; ni privileged, network_mode, cap_add, build, expose
// Dockerfile : 'pnpm install --frozen-lockfile' ; étape finale `FROM node:24-slim` sans node_modules, avec
//   'COPY --from=build /src/apps/server/dist/server.mjs /app/server.mjs', 'COPY --from=build /src/apps/web/dist /app/public', 'COPY --from=build /src/data /app/data' ;
//   /^ARG VERSION=dev$/m APRÈS le dernier 'FROM node:24-slim' ; /^ARG VITE_OWNER_FIRST_NAME$/m entre
//   'FROM node:24 AS build' et 'pnpm build' ; APP_VERSION=${VERSION}, /^USER 1000$/m, /^EXPOSE 3000$/m, HEALTHCHECK sur /api/health, 'CMD ["node","/app/server.mjs"]'
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test build/bundle infra/compose` → `Cannot find module '…/build.mjs'`, `ENOENT … infra/compose.yaml`.

- [ ] **Step 3: Implement**

- `build.mjs` : `build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: 'dist/server.mjs', banner: { js: "import { createRequire as __appsportCreateRequire } from 'node:module'; const require = __appsportCreateRequire(import.meta.url);" }, legalComments: 'eof' })` (sans loader `.txt` : la liste des mots de passe courants est un module TS, Task 8).
- Dockerfile (`# syntax=docker/dockerfile:1`, contexte = racine) : `FROM node:24 AS build` (`corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`) puis `FROM node:24-slim` ; `HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"]`. `.dockerignore` : `**/node_modules`, `.git`, `**/dist`, `.e2e-data`, `test-results`, `playwright-report`, `docs`. Compose : `name: appsport`, même healthcheck.
- `image-contract.sh` (`set -euo pipefail`, `fail` → exit 1, `trap` de nettoyage ; `chmod 0777` du `mktemp -d` monté en `/data`, le runner tournant en uid 1001), contrôles dans l'ordre :
  1. `docker image inspect` : `User` `1000`, seul port `3000/tcp`, `APP_VERSION=<version>`, healthcheck sur `/api/health` ;
  2. `/app/node_modules` absent, `server.mjs`, `public/index.html` et `data/` présents ;
  3. démarrage sans sentinelle, puis avec sentinelle sans base → code ≠ 0 (`--read-only --tmpfs /tmp`) ;
  4. `node /app/server.mjs init` → 0, base créée ;
  5. conteneur sur `127.0.0.1:3300` → `/api/health` en 60 s, `jq -e '.status=="ok" and .db=="ok" and .version=="<version>"'` ;
  6. `touch /app/x` échoue, `/tmp/x` et `/data/x` réussissent ;
  7. seul port en écoute `0BB8` (`/proc/net/tcp*`) ;
  8. chaque ligne de stdout passe `jq -e .` ;
  9. `docker stop -t 15` en moins de 10 s, code de sortie 0 ; puis `Contrat d'image respecté (9 contrôles).`
- Job CI `image` (bloquant) : `docker build -f infra/Dockerfile --build-arg VERSION=v0.0.0-ci -t appsport:ci .` puis `bash infra/test/image-contract.sh appsport:ci v0.0.0-ci`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test build/bundle infra/compose` → `Test Files  2 passed` ; contrat d'image en CI seulement : job `image` vert, dernière ligne `Contrat d'image respecté (9 contrôles).`

- [ ] **Step 5: Commit**

`git commit -m "feat(infra): bundle server.mjs, image node:24-slim, compose et contrat d'image"` (avec `git add --chmod=+x infra/test/image-contract.sh`)

---

