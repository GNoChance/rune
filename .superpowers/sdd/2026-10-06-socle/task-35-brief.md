### Task 35: ADR du service worker, manifeste de précache, manifeste PWA et service statique

**Files:**
- Create: `docs/adr/0001-service-worker-maison.md`, `apps/web/src/sw/precache-manifest.ts`, `apps/web/src/sw/sw.ts` (amorce `export {};`), `apps/web/vite-plugin-precache.ts`, `apps/web/public/manifest.webmanifest`, `apps/web/scripts/make-icons.mjs`, `apps/web/public/icons/{icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon-180.png}` (générées puis versionnées), `apps/server/src/static.ts`
- Modify: `apps/web/vite.config.ts` (`precachePlugin()`), `apps/web/index.html` (manifeste, icône Apple, `theme-color`), `apps/web/package.json` (`build: "vite build"`, dev `esbuild`), `package.json` racine (`build: "pnpm --filter @appsport/web build"`), `apps/server/src/routes.ts` (`mountWebApp(app, deps)` en dernier), `apps/server/src/http/security-headers.ts` (ne remplace pas une CSP déjà posée)
- Test: `apps/web/test/pwa/{precache-plugin,manifest}.test.ts`, `apps/server/test/static/static.test.ts`

**Interfaces:**
- Consumes : T6 (`createTestContext`, `AppConfig.publicDir`, `AppConfig.contentDir`, `httpError`, `mountRoutes`, `securityHeaders`) ; T23 (`ILLUSTRATION_FILE_RE`) ; T25 (`LOCAL_DB_VERSION`, test seulement) ; T28 (`apps/web/vite.config.ts`, `index.html`, modifiés ici).
- Produces : Interfaces partagées §7 (`PrecacheManifest` avec `localDbVersion`, `PRECACHE_GLOBAL`, `SHELL_CACHE_PREFIX`, `ILLUSTRATIONS_CACHE`, `precachePlugin`, `mountWebApp`) et :
```ts
// apps/web/vite-plugin-precache.ts
export function computeBuildHash(files: readonly { path: string; content: Uint8Array }[]): string;   // 12 hex
export async function listPrecacheFiles(distDir: string): Promise<{ path: string; content: Uint8Array }[]>;   // sans /sw.js ni *.map, triés
export async function readLocalDbVersion(dbModulePath: string): Promise<number>;   // motif /export const LOCAL_DB_VERSION = (\d+);/, absent → Error
export async function generateServiceWorker(o: { distDir: string; swCode: string; localDbVersion: number }): Promise<PrecacheManifest>;   // écrit distDir/sw.js
export async function bundleServiceWorker(entry: string): Promise<string>;   // esbuild iife, es2022, minifié, write:false
// apps/server/src/static.ts
export const ILLUSTRATION_CSP = "default-src 'none'; style-src 'unsafe-inline'";
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export function cacheControlFor(pathname: string): string;   // '/assets/…' → IMMUTABLE_CACHE ; sinon 'no-cache'
```

**Spec:** 01 R-PWA-1, R-PWA-2, R-DEP-4, §2 (service worker), §10.3 (ADR avant le SW) ; 04 §12 « Import et service » ; 03 P-LOG-4 ; 02 §3.1, R-ARR-1 ; Global Constraints « En-têtes HTTP » et « PWA ».

- [ ] **Step 1: Write the failing test**

```ts
// precache-plugin.test.ts (// @vitest-environment node) — dist factice : index.html, assets/index-abc123.js(+.map), manifest.webmanifest, icons/icon-192.png, ancien sw.js
expect(m.files).toEqual(['/assets/index-abc123.js', '/icons/icon-192.png', '/index.html', '/manifest.webmanifest']); expect(m.buildHash).toMatch(/^[0-9a-f]{12}$/);
expect(m.localDbVersion).toBe(1);   // appel avec localDbVersion: 1
expect(sw.split('\n')[0]).toBe(`self.__APPSPORT_PRECACHE__ = ${JSON.stringify(m)};`);   // suivi du code du SW
expect(await readLocalDbVersion(DB_TS /* apps/web/src/local-db/db.ts */)).toBe(LOCAL_DB_VERSION);   // fichier sans le motif → rejette
expect([SHELL_CACHE_PREFIX, ILLUSTRATIONS_CACHE]).toEqual(['shell-', 'illustrations-v1']);
// régénération → même buildHash ; un octet changé → buildHash différent ; computeBuildHash indépendant de l'ordre ;
// [('/a','ab'),('/b','')] ≠ [('/a','a'),('/b','b')] ; bundleServiceWorker → contient 'MARQUEUR_SW', sans /\bexport\b/ ; precachePlugin() { name: 'appsport-precache', apply: 'build' }
// manifest.test.ts
expect(m).toMatchObject({ name: 'appsport', short_name: 'appsport', display: 'standalone', start_url: '/', scope: '/', lang: 'fr' });
// icônes : /icons/icon-192.png 192x192 any, /icons/icon-512.png 512x512 any, /icons/icon-maskable-512.png 512x512 maskable ; les 4 PNG ont la bonne taille (IHDR)
// index.html contient '<link rel="manifest" href="/manifest.webmanifest">' et '<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">'
// static.test.ts (publicDir et contentDir temporaires, illustration contentDir/illustrations/files/squat-start.svg > 1 Kio, HASH8 = sha256(contenu)[0..8])
// '/' et '/index.html' : 200, 'text/html; charset=utf-8', 'no-cache', CSP globale de T6
// '/sw.js' : 'text/javascript; charset=utf-8', 'no-cache' ; '/manifest.webmanifest' : 'application/manifest+json', 'no-cache'
// '/assets/index-abc123.js' : IMMUTABLE_CACHE
// `/illustrations/squat-start.${HASH8}.svg` : 'image/svg+xml', IMMUTABLE_CACHE, nosniff, CSP ILLUSTRATION_CSP ; gzip si Accept-Encoding: gzip
// 404 : '/illustrations/squat-start.00000000.svg', '/illustrations/absent.12345678.svg', '/illustrations/..%2f..%2fsecret.svg', '/illustrations/squat-start.svg',
//   '/assets/missing-zzz.js', '/..%2f..%2fpackage.json'
// repli SPA (200, no-cache, index.html) : '/profile/places/abc', '/invite', '/admin/members' ; /api/nope en GET et POST → 404 { error: 'not_found' } ; /api/health → 200 JSON
// publicDir sans index.html : '/profile' → 404
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test precache-plugin manifest` et `pnpm --filter @appsport/server test static` → `Failed to resolve import "../../vite-plugin-precache"`, `ENOENT … manifest.webmanifest`, `Failed to resolve import "../../src/static"`.

- [ ] **Step 3: Implement**

- ADR (« Acceptée », 2026-10-06) : vite-plugin-pwa gelé et Workbox implicite (skipWaiting, navigation preload) contraires à R-PWA-2 à R-PWA-6 → SW maison (~150 lignes) + mini-plugin Vite ; repli : `injectManifest` de vite-plugin-pwa en gardant `sw.ts`, si un défaut de précache n'est pas corrigé en une demi-journée ou si Background Sync devient nécessaire. **[décision plan]** Navigation **cache d'abord** depuis `shell-<buildHash>`, réseau seulement si `index.html` manque (la page ne change de build qu'au clic, relance hors ligne immédiate) ; un SW en attente de `localDbVersion` inférieur à celui de la page n'est jamais activé (retour arrière « image seule » après un changement de schéma Dexie, R-DEP-4).
- `precachePlugin` : `readLocalDbVersion('<root>/src/local-db/db.ts')`. Constantes de cache dans `precache-manifest.ts` (la page n'embarque pas le SW).
- Hachage du build :
```ts
const h = createHash('sha256');
for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
  h.update(f.path); h.update('\0'); h.update(String(f.content.byteLength)); h.update('\0'); h.update(f.content); }
return h.digest('hex').slice(0, 12);
```
- `manifest.webmanifest` : `description` « Suivi de musculation entre proches », `dir` « ltr », `orientation` « portrait », **[décision plan]** `background_color` `#ffffff`, `theme_color` `#0f766e` ; `make-icons.mjs` (Node seul, PNG par `node:zlib`) : fond `#0f766e`, haltère blanc de trois rectangles, zone sûre de 80 % pour l'icône maskable. `index.html` : `<meta name="theme-color" content="#0f766e">`.
- `mountWebApp`, dans l'ordre : `app.all('/api/*')` → `not_found` ; `/illustrations/:file` (compression, `ILLUSTRATION_FILE_RE`, lecture de `contentDir/illustrations/files/<id>.<ext>`, empreinte comparée au `hash8` demandé, empreintes en mémoire) ; puis `publicDir` lu par `fs/promises` (chemin résolu restant sous `publicDir`, `'/'` → `index.html`, `cacheControlFor`, types MIME usuels ; fichier absent sans extension → `index.html` en `no-cache`, sinon 404).

- [ ] **Step 4: Run test to verify it passes**

Mêmes commandes → `Test Files 2 passed` et `1 passed` ; `pnpm build` → la première ligne de `apps/web/dist/sw.js` commence par `self.__APPSPORT_PRECACHE__ = {"buildHash":"` et contient `"localDbVersion":1` ; `node -e "const h=require('fs').readFileSync('apps/web/dist/index.html','utf8'); if(/<script(?![^>]*\ssrc=)[^>]*>|https?:\/\//.test(h)) process.exit(1)"` → code 0 (P-LOG-4 sur le build) ; `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(pwa): manifeste de précache, manifeste PWA, service statique et ADR du service worker"`

---

