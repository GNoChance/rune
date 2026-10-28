# Task 35 report — service worker ADR, precache manifest, PWA manifest, static serving

Worktree `C:\Users\eliott.colin\appsport-pwa`, branch `socle-pwa`.

## What c1ef404 built (reconstructed from the diff; the implementer was cut off before writing a report)

Commit `c1ef404 feat(pwa): manifeste de précache, manifeste PWA, service statique et ADR du service worker` (Closes #36), 22 files, +909/−6.

- `docs/adr/0001-service-worker-maison.md`: ADR « Acceptée » (2026-10-06). Custom SW plus a Vite mini-plugin instead of the frozen vite-plugin-pwa; `injectManifest` as the fallback; cache-first navigation from `shell-<buildHash>`; `localDbVersion` in the manifest; static serving rules.
- `apps/web/src/sw/precache-manifest.ts`: `PrecacheManifest {buildHash, files, localDbVersion}`, `PRECACHE_GLOBAL`, `SHELL_CACHE_PREFIX = 'shell-'`, `ILLUSTRATIONS_CACHE = 'illustrations-v1'`. They live here so the page bundle never pulls in SW code.
- `apps/web/src/sw/sw.ts`: stub (`export {}`), to be replaced by T36.
- `apps/web/vite-plugin-precache.ts`:
  - `computeBuildHash`: sha256 over path, `\0`, size, `\0`, bytes; first 12 hex characters.
  - `listPrecacheFiles`: lists dist without `/sw.js` or `*.map`, sorted.
  - `readLocalDbVersion`: regex over `src/local-db/db.ts`.
  - `bundleServiceWorker`: esbuild iife, es2022, minified, `write:false`.
  - `generateServiceWorker`: writes `dist/sw.js` with the manifest as its first line.
  - `precachePlugin`: build only, runs on `writeBundle` post.
- `apps/web/public/manifest.webmanifest` (French name, `#0f766e` theme, white background, standalone, portrait). `scripts/make-icons.mjs` writes the 4 PNGs (white dumbbell on teal, maskable 80 % safe zone) with Node only (`node:zlib`). `index.html` gets the manifest, Apple icon and theme-color links.
- `apps/server/src/static.ts`: `ILLUSTRATION_CSP`, `IMMUTABLE_CACHE`, `cacheControlFor`, `mountWebApp`.
  - Illustrations: `<id>.<hash8>.<ext>` checked with the contracts `ILLUSTRATION_FILE_RE`, hash8 compared and kept in memory, compressed, immutable, own CSP.
  - publicDir: read with `fs/promises` under the root; `/` serves `index.html`; no-cache or immutable.
  - SPA fallback for paths without an extension; `/api/*` falls through to the app's `not_found`.
  - `routes.ts` mounts it last. `securityHeaders` keeps a CSP already set by the route.
- Build scripts: root `build` and web `build: vite build`.
- Tests: `apps/web/test/pwa/{precache-plugin,manifest}.test.ts`, `apps/server/test/static/static.test.ts`, plus `security-headers.test.ts` (route CSP kept).

### Deliberate deviation recorded (T35-F7)

Brief Step 3 says `mountWebApp` opens with `app.all('/api/*')` returning `not_found`. The code does not register that route. Instead, `app.get('*')` calls `next()` for `/api` and `/api/*` (`isApi`, static.ts), and the T6 app-level `notFound` answers `404 {"error":"not_found"}`.

The behaviour is the same, and the deviation is needed. An `app.all('/api/*')` registered inside `mountRoutes` would shadow routes that tests add to `ctx.app` after `createTestContext`, such as `/api/test/boom` and `/api/test/csp` in `security-headers.test.ts`. `static.test.ts` checks that GET and POST `/api/nope` both return 404 `not_found` and that `/api/health` still answers. **Do not "restore" the brief's route.**

---

## Fix round 1 (HEAD c1ef404 → 3f0cbaf)

### Commits

- `68e2e0d fix(pwa): chemins statiques résolus par resolveUnder, barre finale refusée et 404 sans cache`. Covers T35-F3, F4, F6, F12.
- `0b56f5b fix(pwa): sw.js garde le mode strict sous la ligne du manifeste`. Covers T35-F5, F13, F14.
- `4dc7e85 fix(pwa): icône d'onglet, id du manifeste et chargeur de configuration Vite`. Covers T35-F11, F15, F16.
- `3f0cbaf docs(pwa): ADR 0001, R-PWA-9 gardé à l'installation du SW et activation à la fermeture`. Covers T35-F1, F8, F9, F10.

T35-F7 needed no code change; it is recorded in the section above.

All four commits end with `Refs #36` followed by the Co-Authored-By trailer.

### Changes per finding

- **F1 (ADR)**:
  - Decision 5 now enforces R-PWA-9 in the SW as well as in the page:
    - A marker in Cache Storage holds the highest local DB version the device has seen: cache `appsport-meta`, entry `/__sw/local-db-version`, a synthetic response whose body is the integer. It is never lowered. The page writes it after opening Dexie, and the SW writes it in `activate`. The SW never opens IndexedDB. `cachesToDelete` and the kill switch leave the marker alone.
    - Before any fetch, `install` reads the marker and rejects when `manifest.localDbVersion` is lower. Such a SW becomes redundant and never reaches waiting.
    - The page never offers or activates such a SW.
  - The ADR now states that Dexie 4.4.6 reopens a newer database on `VersionError` instead of failing (verified at `dexie.mjs:4594-4598`).
  - New decision 7, marked **[à confirmer par le propriétaire]**: the browser activates a waiting SW once the app is fully closed. A full close counts as consent for a newer build.
    - Still guaranteed: no other build runs while a window is open; R-PWA-3 banner rules hold; no older-schema build activates.
    - No longer guaranteed: R-PWA-8 « ne tourne qu'après le clic » becomes « après le clic ou une fermeture complète ». The intent of R-PWA-3 (no version change during a session) holds only while the app stays open. No data is lost, by R-VER-4 and R-VER-5.
    - The rejected alternative (keep serving the previous shell until the click) is written down with the reasons it was rejected.
  - Decision 4's reasons were refined accordingly.
- **F8**: the « Exigences » line adds 02 R-ARR-1, R-EXP-1, 04 §12 (Import et service), and R-VER-4, R-VER-5.
- **F9**: decision 4 now covers « toute navigation de même origine hors `/api/*` ». It lists what goes to the network: `/api/*` including navigations (`GET /api/me/export`, R-EXP-1), other origins, and non-GET requests.
- **F10**: decision 5 now reads « ne propose jamais d'activer (pas de bandeau) … ne lui envoie jamais `SKIP_WAITING` ». The JSDoc in `precache-manifest.ts` now says « jamais proposé ni activé ».
- **F3**: added the 404 URLs `/illustrations/..%2f..%2fsecret.${HASH8}.svg` and `..%5c..%5c` (hashless URL from the brief kept). Added an assertion that the `secret.svg` fixture hashes to HASH8.
- **F4**:
  - New exported pure function `resolveUnder(root, pathname, path = {resolve, sep})`. It rejects a NUL byte, a trailing `/`, and anything outside `root + sep`. `readUnder` now uses it.
  - Unit tests run it with `posix` (`/../package.json`, sibling `/../public-evil/x.js`, `/a\0b.js`, trailing slashes) and with `win32` (`/..\..\x`, `/..\package.json`, `/..\public-evil\x.js`, NUL).
  - Added the 404 URLs `/a%00.js`, `/index.html/x.js` and `/${'a'.repeat(300)}.js`. The `%2f` case is relabelled as a non-decoding check (Hono's `decodeURI` keeps `%2F`).
- **F5**: `generateServiceWorker` now writes `${header}\n(()=>{"use strict";${swCode without its leading "use strict";, trimmed}\n})();\n`. The first line is unchanged. A new test runs the generated `sw.js` in `node:vm` and checks strict mode is on (`this === undefined`) and that the manifest is set.
- **F6**: a URL ending in `/` never designates a file. `/index.html/` and `/assets/index-abc123.js/` now return 404 (they used to return 200 `application/octet-stream`). `/admin/members/` still gets the SPA fallback.
- **F12**: `expectNotFound` asserts `Cache-Control` is `null`.
- **F13**: the bundle test now asserts:
  - the iife shape (regex `^(?:"use strict";)?\(\(\)=>\{…\}\)\(\);\n?$`);
  - no `module.exports` or `require(`;
  - a single line (minified);
  - `?.` and `??` kept (target ≥ es2020).
- **F14**: added a known-answer vector (`[{'/a','b'}]` → `1de646e4bbe5`) and two collision vectors (`'x/b\0y'` and `'x/b\0\0y'` against `[('/a','x'),('/b','y')]`).
- **F11**: added `<link rel="icon" type="image/png" href="/icons/icon-192.png">` to `index.html`, with an assertion in `manifest.test.ts`.
- **F15**: the web `build` script is now `vite build --configLoader runner`.
- **F16**: added `"id": "/"` to the manifest and asserted it.

### TDD evidence

RED runs, before each fix:

- `pnpm --filter @appsport/server test static` → `Tests 3 failed | 12 passed (15)`:
  - `/index.html/: expected 200 to be 404` (F6);
  - `TypeError: resolveUnder is not a function` twice (F4).
- `pnpm --filter @appsport/web test precache-plugin` → `Tests 2 failed | 12 passed (14)`:
  - remainder `expected '(()=>{self.addEventListener…' to be '(()=>{"use strict";(()=>{…'`;
  - strict test `expected false to be true` (F5).
- `pnpm --filter @appsport/web test manifest` → `Tests 2 failed | 2 passed (4)`:
  - `expected undefined to be '/'` (F16);
  - `expected '<!doctype html>…' to contain '<link rel="icon" type="image/png" hre…'` (F11).
- F15, before the change: `pnpm build` printed `(!) Your Vite config uses features that are unsupported by configLoader: 'native' … import "./vite-plugin-precache" without a file extension … import "./src/sw/precache-manifest" without a file extension`.

GREEN runs, after each fix:

- static → `Tests 15 passed (15)`
- precache-plugin → `Tests 14 passed (14)`
- manifest → `Tests 4 passed (4)`
- `pnpm build` → no warning, exit 0.

F3, F4, F12, F13 and F14 harden tests on code that was already correct, so a RED run against the current code means nothing. Each one was checked with mutants instead: the mutant was applied to a copy, the suite run, and the file restored. Every mutant was killed:

| Mutant | Result |
|---|---|
| Loose illustration regex `/^(.+).([0-9a-f]{8}).(svg\|png\|webp\|jpg)$/` in static.ts | `/illustrations/..%2f..%2fsecret.f4b52a6f.svg: expected 200 to be 404` |
| `full.startsWith(root)` (sep dropped) | `/../public-evil/x.js: expected '/srv/public-evil/x.js' to be null` and the win32 equivalent |
| NUL guard removed | `/a%00.js: expected 500 to be 404`, plus both resolveUnder cases |
| `c.header('Cache-Control', cacheControlFor(c.req.path))` at the top of the `*` handler | `/assets/missing-zzz.js: expected 'public, max-age=31536000, immutable' to be null`, plus `/api/nope` and `/profile` |
| esbuild `format: 'cjs'` / `'esm'` / `minify: false` | shape regex fails |
| esbuild `target: 'es2015'` | `expected … to contain '?.'` |
| size line dropped from computeBuildHash | collision vector and known answer both fail (`97f2effb4970` ≠ `1de646e4bbe5`) |
| size line and its `\0` dropped | collision vector and known answer both fail (`c0e6dd647daf`) |

Not mutation-checkable on this Windows machine: removing `ENOTDIR` or `ENAMETOOLONG` from `MISSING`. Windows returns ENOENT for both, so the new 404 cases for `/index.html/x.js` and the 300-character name only catch that regression on Linux CI.

### Commands and output (final state, HEAD 3f0cbaf)

- `pnpm --filter @appsport/web test precache-plugin manifest` → `Test Files 2 passed (2)`, `Tests 18 passed (18)`
- `pnpm --filter @appsport/server test static security-headers` → `Test Files 2 passed (2)`, `Tests 20 passed (20)`
- `pnpm lint` → `Checked 334 files … No fixes applied.`
- `pnpm typecheck` → exit 0 (contracts, domain, server, web)
- `pnpm test` → `Test Files 123 passed (123)`, `Tests 1277 passed | 2 skipped (1279)`, exit 0. The only note is Vitest's usual happy-dom performance hint.
- `pnpm build` (run twice) → exit 0 and no config-loader warning. Both runs give `buildHash 7f785bfa0f35`, so the build is deterministic. It differs from `c198375e7807` because `index.html`, the manifest and `sw.js` changed.
  - Line 1 of `dist/sw.js` starts with `self.__APPSPORT_PRECACHE__ = {"buildHash":"` and contains `"localDbVersion":1`.
  - Line 2 is `(()=>{"use strict";(()=>{})();`.
- The P-LOG-4 check on `dist/index.html` (no inline `<script>`, no `http(s)://`) → exit 0.
- `git status` → clean.
- `git show --stat` for the 4 commits:
  - 68e2e0d: static.ts, static.test.ts
  - 0b56f5b: vite-plugin-precache.ts, precache-plugin.test.ts
  - 4dc7e85: index.html, package.json, manifest.webmanifest, manifest.test.ts
  - 3f0cbaf: precache-manifest.ts, ADR

### Concerns for the controller

1. **F1 needs the T36 and T37 briefs amended.** The ADR now records the SW-side guard, but the plan's T36 and T37 do not implement it yet:
   - **T36**: `install` reads `appsport-meta` / `/__sw/local-db-version` before any fetch and rejects when `manifest.localDbVersion` is lower. `activate` writes max(marker, own `localDbVersion`) before the purge and the claim. Tests needed: install rejects under a higher marker; activate raises the marker and never lowers it; the kill switch and `cachesToDelete` keep `appsport-meta`.
   - **T37**: after Dexie opens, the page writes max(marker, `LOCAL_DB_VERSION`).
   - The cache name and key could become constants in `precache-manifest.ts`, next to `SHELL_CACHE_PREFIX`. I did not add them here, because no current task consumes them.
2. **F1 decision 7 is a product choice for the owner.** It accepts that a full close of the app counts as consent to run a newer build, which the standard SW lifecycle cannot prevent. It also proposes amending R-PWA-8 (01 §7). The rejected alternative (pinning the previous shell until the click) is costed in the ADR.
3. **The third cache `appsport-meta` goes beyond R-PWA-1's list of two caches.** It holds metadata only and is recorded in the ADR's Consequences.
