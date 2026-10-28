### Task 36: Service worker maison (coquille, illustrations, messages, interrupteur côté SW)

**Files:**
- Create: `apps/web/test/support/fake-sw-scope.ts`
- Modify: `apps/web/src/sw/sw.ts` (amorce de T35)
- Test: `apps/web/test/sw/{sw-pure,sw-handlers}.test.ts`

**Interfaces:**
- Consumes : T35 (`PrecacheManifest`, `PRECACHE_GLOBAL`, `SHELL_CACHE_PREFIX`, `ILLUSTRATIONS_CACHE`) ; `sw/protocol.ts` (`PageToSw` T26, `SwStatus` T29, import de type).
- Produces :
```ts
export const REFERENCED_ILLUSTRATIONS_KEY = '/__sw/illustrations-referenced.json';   // entrée de ILLUSTRATIONS_CACHE, hors planIllustrationSync
export type SwRequest = { url: string; method: string; mode: string };
export interface SwWindowClient { url: string; navigate(url: string): Promise<unknown> }
export interface SwScope { origin: string; caches: CacheStorage; fetch(input: SwRequest | string, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>; claimClients(): Promise<void>; unregister(): Promise<boolean>; windowClients(): Promise<readonly SwWindowClient[]> }
export interface SwHandlers { install(): Promise<void>; activate(): Promise<void>; handleFetch(r: SwRequest): Promise<Response> | null /* null = pas de respondWith */;
  handleMessage(msg: PageToSw, port: MessagePort | null): Promise<void>; status(): Promise<SwStatus>; syncIllustrations(files: readonly string[]): Promise<void>; checkKillSwitch(): Promise<boolean> }
export function cachesToDelete(names: readonly string[], buildHash: string): string[];
export function planIllustrationSync(referenced: readonly string[], cached: readonly string[]): { toFetch: string[]; toDelete: string[] };
export function createSwHandlers(scope: SwScope, manifest: PrecacheManifest): SwHandlers;
export interface SwEvent { waitUntil(p: Promise<unknown>): void }
export interface SwFetchEvent extends SwEvent { request: SwRequest; respondWith(r: Promise<Response>): void }
export interface SwMessageEvent extends SwEvent { data: unknown; ports: readonly MessagePort[] }
export interface SwGlobalLike { caches: CacheStorage; fetch: SwScope['fetch']; skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(o: { type: 'window' }): Promise<readonly SwWindowClient[]> }; registration: { unregister(): Promise<boolean> };
  location: { origin: string }; [PRECACHE_GLOBAL]?: PrecacheManifest;
  addEventListener(t: 'install' | 'activate', fn: (e: SwEvent) => void): void; addEventListener(t: 'fetch', fn: (e: SwFetchEvent) => void): void;
  addEventListener(t: 'message', fn: (e: SwMessageEvent) => void): void }
export function installServiceWorker(g: SwGlobalLike, manifest: PrecacheManifest): void;
// test/support/fake-sw-scope.ts
export function createFakeCacheStorage(): CacheStorage;
export interface FakeSwScope extends SwScope { setNetwork(fn: (url: string, init?: RequestInit) => Promise<Response>): void; fetchLog: string[];
  skipWaitingCalls: number; claimCalls: number; unregistered: boolean; navigations: string[] }
export function createFakeSwScope(o?: { origin?: string /* 'https://appsport.test' */; caches?: CacheStorage; clientUrls?: string[] }): FakeSwScope;
export function staticNetwork(files: Record<string, string>): (url: string) => Promise<Response>;   // pathname → 200, sinon 404
```

**Spec:** 01 R-PWA-1, R-PWA-2, R-PWA-4, R-PWA-6 (étapes 1 à 3 côté SW), R-SYN-32, R-SYN-33 (conditions 1 et 3) ; 04 §11 ; Review Focus 5.

- [ ] **Step 1: Write the failing test**

```ts
// sw-pure.test.ts
expect(cachesToDelete(['shell-aaaaaaaaaaaa', 'shell-bbbbbbbbbbbb', 'illustrations-v1', 'autre'], 'bbbbbbbbbbbb')).toEqual(['shell-aaaaaaaaaaaa']);
// planIllustrationSync : (['a','b','b'], ['b','c']) → { toFetch: ['a'], toDelete: ['c'] } ; ([], ['c']) → { [], ['c'] } ; (['a'], []) → { ['a'], [] } ; ([], []) → vides
// sw-handlers.test.ts (fake-indexeddb ; A = { buildHash: 'aaaaaaaaaaaa', files: ['/assets/app-1.js', '/index.html'], localDbVersion: 1 }, B idem 'bbbbbbbbbbbb', '/assets/app-2.js')
// install : shell-aaaaaaaaaaaa contient 'A-index' et 'A-app', skipWaitingCalls 0 ; un fichier en 404 → install rejette
// activate : caches ['illustrations-v1','shell-aaaaaaaaaaaa'] (shell-old000000000 purgé), claimCalls 1, meta.userId 'u1' de la base 'appsport' intact
// navigation : 'A-index' servi depuis shell-aaaaaaaaaaaa sans appel réseau (fetchLog vide) ; index.html retiré du cache → réseau ('net-index')
// Review Focus 5 : caches partagés, A installé et activé, B installé sans activate, réseau servant B (staticNetwork) puis coupé →
//   hA sert 'A-index' et 'A-app' dans les deux cas ; caches ['illustrations-v1','shell-aaaaaaaaaaaa','shell-bbbbbbbbbbbb']
// fichier du manifeste servi du cache sans réseau ; non interceptés : /api/me, /api/sync/pull, navigation /api/me/export, POST, autre origine, '/inconnu.txt'
// illustration : cache d'abord, mise en cache seulement si 200
// SKIP_WAITING → skipWaitingCalls 1 ; GET_STATUS par MessageChannel → { type: 'STATUS', buildHash: 'aaaaaaaaaaaa', shellCached: true, illustrationsMissing: 0, localDbVersion: 1 } ;
//   fichier du manifeste retiré → shellCached false
// SYNC_ILLUSTRATIONS ['a.11111111.svg','b.22222222.svg'] avec c en cache → cache = a et b, illustrationsMissing 0 ;
//   b en 500 → 1 manquante, retentée en tâche de fond au GET_STATUS suivant (b demandé deux fois) → 0 ;
//   liste référencée (REFERENCED_ILLUSTRATIONS_KEY dans illustrations-v1) relue après redémarrage du SW, jamais supprimée (même par SYNC_ILLUSTRATIONS [])
// checkKillSwitch : health swKill true → unregistered, caches ['autre'], navigations [ORIGIN + '/profile'], IndexedDB intact ;
//   swKill false, 503 avec swKill false, réseau en échec → false, rien ne change
// installServiceWorker : fetch de navigation → respondWith une fois et waitUntil (vérification '/api/health' non bloquante) ; install → waitUntil ; message SKIP_WAITING → skipWaitingCalls 1
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test sw-pure sw-handlers` → `Failed to resolve import "../support/fake-sw-scope"` (sw-handlers) et `TypeError: … is not a function` (sw-pure, amorce vide).

- [ ] **Step 3: Implement**

Lib DOM seulement (pas WebWorker). Amorçage sans effet de bord à l'import : `if (typeof g.skipWaiting === 'function' && 'registration' in g && g[PRECACHE_GLOBAL]) installServiceWorker(g, g[PRECACHE_GLOBAL])`. `install` : `fetch(file, { cache: 'reload' })` par fichier, non `ok` → erreur, pas de `skipWaiting`. `activate` : `cachesToDelete`, ouverture d'`ILLUSTRATIONS_CACHE`, `claimClients()` ; aucune référence à `indexedDB` dans le fichier. `handleFetch` dans l'ordre : non GET, autre origine ou `/api/*` → `null` ; navigation → `index.html` de `shell-<buildHash>` (ADR), sinon `scope.fetch(r)` ; `/illustrations/*` → cache d'abord ; fichier du manifeste → shell d'abord ; sinon `null`. `syncIllustrations` sérialisé, liste persistée sous `REFERENCED_ILLUSTRATIONS_KEY` dans `ILLUSTRATIONS_CACHE` ; `planIllustrationSync` ne reçoit que les entrées `/illustrations/*` ; 4 téléchargements en parallèle au plus, échecs ignorés. `checkKillSwitch` : `/api/health` (`no-store`, 4 s), JSON lu quel que soit le statut, seul `json.swKill === true` compte (pas de Zod dans le SW) ; si vrai : `unregister`, suppression des caches `shell-*` et `illustrations-*`, `navigate(client.url)` pour chaque fenêtre.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files 2 passed` ; `pnpm build` puis `node -e "const s=require('fs').readFileSync('apps/web/dist/sw.js','utf8'); if(/\bexport\b|^import /m.test(s)) process.exit(1)"` → code 0 ; `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(pwa): service worker maison (coquille, illustrations, messages, interrupteur d'urgence)"`

---

