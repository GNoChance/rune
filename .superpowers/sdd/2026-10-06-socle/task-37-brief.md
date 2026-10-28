### Task 37: Mises à jour en mode prompt, interrupteur d'urgence côté page, stockage persistant et 426

**Files:**
- Create: `apps/web/src/sw/{register.ts, kill-switch.ts, persist.ts, UpdateBanner.tsx, UpdateBanner.module.css}`, `apps/web/test/support/fake-sw-container.ts`
- Modify: `apps/web/src/main.tsx` (`bootServiceWorker({ …, status: repos.status })` en production sans bloquer le rendu ; `installPersistOnOnboarding(repos.status)`), `apps/web/src/ui/AppShell.tsx` (`<UpdateBanner />` en premier), `apps/web/src/features/auth/CreateAccountForm.tsx` (succès et `isStandalone()` → `void repos.status.requestPersistentStorage()`)
- Test: `apps/web/test/sw/{update-banner-rules,register,kill-switch}.test.ts`, `apps/web/test/sw/{UpdateBanner,persist}.test.tsx`

**Interfaces:**
- Consumes : T25 (`AppDb`, `getMeta`, `setMeta`, `LOCAL_DB_VERSION`, `createTestLocalDb`) ; T26 (`SyncEngine`, `browserTransport`, `fetchWithTimeout`, `PageToSw`) ; T6 (`HealthResponse`) ; T28 (`useServices`, `useMe`, `useLive`) ; T29 (`useRepos`, `StatusRepo.activeSessionId`/`illustrationFiles`/`requestPersistentStorage`, `SwStatus`) ; T30 (`isStandalone`, `CreateAccountForm`) ; T31 (`ONBOARDING_COMPLETED_EVENT`) ; T35 (`SHELL_CACHE_PREFIX`, `ILLUSTRATIONS_CACHE`) ; T36 (`createFakeCacheStorage`).
- Produces : Interfaces partagées §7 (`UpdateState`, `SwController`, `registerServiceWorker`, `shouldShowUpdateBanner`, `applyKillSwitchIfNeeded`) et :
```ts
export interface SwWorkerLike { state: string; postMessage(m: PageToSw, transfer?: Transferable[]): void; addEventListener(t: 'statechange', fn: () => void): void }
export interface SwRegistrationLike { waiting: SwWorkerLike | null; installing: SwWorkerLike | null; update(): Promise<unknown>; addEventListener(t: 'updatefound', fn: () => void): void }
export interface SwContainerLike { readonly controller: { postMessage(m: PageToSw): void } | null; register(url: string, o: { scope: string; updateViaCache: 'none' }): Promise<SwRegistrationLike>;
  getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]>; addEventListener(t: 'controllerchange', fn: () => void): void }
export const swControllerStore: { get(): SwController | null; set(c: SwController | null): void; subscribe(fn: () => void): () => void };
export async function bootServiceWorker(o: { db: AppDb; status: Pick<StatusRepo, 'illustrationFiles'>; sync: SyncEngine; fetchHealth: () => Promise<HealthResponse | null>; container?: SwContainerLike; killEnv?: KillSwitchEnv }): Promise<void>;
export interface KillSwitchEnv { serviceWorker?: Pick<SwContainerLike, 'getRegistrations'>; caches?: CacheStorage; reload?: () => void }
export function UpdateBannerView(p: { show: boolean; dismissible: boolean; onUpdate(): void; onDismiss(): void }): JSX.Element | null;
export function UpdateBanner(): JSX.Element | null;
// persist.ts
export function installPersistOnOnboarding(status: Pick<StatusRepo, 'requestPersistentStorage'>, env?: { win?: Window; standalone?: () => boolean /* isStandalone */ }): () => void;
// test/support/fake-sw-container.ts
export interface FakeSwContainer { container: SwContainerLike; registration: SwRegistrationLike & { updateCalls: number }; setController(on: boolean): void; controllerMessages: PageToSw[];
  installUpdate(o?: { localDbVersion?: number /* LOCAL_DB_VERSION */; silent?: boolean /* muet */ }): SwWorkerLike & { messages: PageToSw[] };
  fireControllerChange(): void; unregisterCalls: number }
export function createFakeSwContainer(o?: { controller?: boolean; waiting?: boolean; registrations?: number /* 1 */ }): FakeSwContainer;
```

**Spec:** 01 R-PWA-2 à R-PWA-6, R-VER-2, R-SYN-31, R-SYN-32, R-DEP-4 ; 02 R-CPT-2 ; Review Focus 5.

- [ ] **Step 1: Write the failing test**

| `available`, `forced`, `activeSessionId`, onboarding | `shouldShowUpdateBanner` → `{ show, dismissible }` |
|---|---|
| false, false, null, false ; false, true, null, false | `{ false, true }` ; `{ false, false }` |
| true, false, null, false ; true, true, null, false | `{ true, true }` ; `{ true, false }` |
| true, false, 's1', false ; true, true, 's1', false | `{ false, true }` ; `{ false, false }` |
| true, false, null, true ; true, true, null, true | `{ false, true }` ; `{ false, false }` |

```ts
// register.test.ts (fake timers, createFakeSwContainer, faux SyncEngine, faux doc)
expect(registerSpy).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' }); expect(f.registration.updateCalls).toBe(1);   // lancement
// premier plan (visible) → 2 ; passage en arrière-plan → inchangé ; +3 600 000 ms visible → +1, masqué → inchangé (R-PWA-2)
// available : SW en attente avec contrôleur → true ; première installation (sans contrôleur) → false ; installUpdate() → { available: true, forced: false }
// R-DEP-4 : installUpdate({ localDbVersion: LOCAL_DB_VERSION - 1 }) → available false, applyUpdate n'envoie pas SKIP_WAITING ; installUpdate({ silent: true }) → false après 1 s
// applyUpdate → un seul { type: 'SKIP_WAITING' } dans worker.messages, reload seulement au controllerchange, une seule fois même si l'événement se répète ;
//   controllerchange sans applyUpdate → pas de reload ; meta.activeSessionId posé → applyUpdate n'envoie rien (R-PWA-3)
// SyncState protocol_unsupported → forced true et nouvelle recherche (R-PWA-5, R-VER-2) ; sans service worker → contrôleur inerte { available: false, forced: false }
// bootServiceWorker : swKill vrai → aucun enregistrement, swControllerStore.get() null ; sonde null ou swKill faux → enregistrement, contrôleur publié ;
//   status.illustrationFiles() ['a.11111111.svg'] et contrôleur → controllerMessages [{ type: 'SYNC_ILLUSTRATIONS', files: ['a.11111111.svg'] }],
//   renvoyé à chaque controllerchange ; sans contrôleur → rien (R-SYN-32)
// kill-switch.test.ts : swKill faux → false, rien ; swKill vrai → unregisterCalls 1, caches ['autre'] (shell-* et illustrations-v1 supprimés), reload une fois, meta.userId 'u1' intact ;
//   swKill vrai sans rien à nettoyer → false, pas de reload (pas de boucle)
// persist.test.tsx : ONBOARDING_COMPLETED_EVENT, standalone vrai → requestPersistentStorage 1 fois ; faux → 0 (R-SYN-31) ; après la fonction rendue → 0 ;
//   CreateAccountForm réussi : installé → 1 appel, navigateur → 0 (R-CPT-2)
// UpdateBanner.test.tsx : show false → rien ; fermable → data-dismissible 'true', 'Nouvelle version disponible', « Mettre à jour » et « Plus tard » ;
//   forcé → data-dismissible 'false', pas de « Plus tard », "Mets à jour l'appli pour reprendre la synchronisation." ;
//   UpdateBanner, SW en attente : activeSessionId 's1' (repos) → rien ; onboarding en cours → rien
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test update-banner-rules register kill-switch persist UpdateBanner` → `Failed to resolve import "../../src/sw/register"`.

- [ ] **Step 3: Implement**

`shouldShowUpdateBanner` : `show = available && activeSessionId === null && !onboardingInProgress`, `dismissible = !forced`. `available` exige un SW en attente, un contrôleur et, du SW en attente (`GET_STATUS` par `MessageChannel`, 1 s), `localDbVersion ≥ LOCAL_DB_VERSION` (ADR). `applyUpdate` pose un indicateur `reloading` avant `SKIP_WAITING` ; `controllerchange` ne recharge que s'il est posé. `bootServiceWorker` : `h?.swKill` → `applyKillSwitchIfNeeded` et arrêt **sans** enregistrer ; sinon enregistrement puis `SYNC_ILLUSTRATIONS`. `applyKillSwitchIfNeeded` ne recharge que si un désenregistrement ou une suppression a eu lieu, et ne touche jamais `indexedDB`. `UpdateBanner` : `onboardingInProgress = me !== null && me.onboardingCompletedAt === null` ; `activeSessionId` par `useLive(() => repos.status.activeSessionId(), [])` ; état local `dismissed` ignoré si `forced`. `main.tsx` : `if (import.meta.env.PROD) void bootServiceWorker({ …, fetchHealth })`, la sonde lisant le JSON même sur un 503.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files 5 passed` ; `pnpm --filter @appsport/web test` (T28 à T34 verts, `architecture.test` compris) ; `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(pwa): mises à jour en mode prompt, interrupteur d'urgence et stockage persistant"`

---

