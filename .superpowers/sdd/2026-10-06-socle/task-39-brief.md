### Task 39: E2E : mise à jour A → B, interrupteur d'urgence et 426

**Files:**
- Create: `apps/web/e2e/support/builds.ts`, `apps/web/e2e/{update,kill-switch,protocol}.spec.ts`
- Modify: `apps/web/e2e/support/global-setup.ts` (`await buildTwice()`)

**Interfaces:**
- Consumes : Task 38 (fixtures, `E2EServer.restart`/`setFault`, `setupOnboardedAdmin`, aides de `pwa.ts`) ; T25 (`LOCAL_DB_VERSION`) ; T35 (`precachePlugin`) ; T36 (coquille cache d'abord) ; T37 (`UpdateBanner` « Mettre à jour » / « Plus tard », interrupteur côté page) ; T34 (`connection-status`, `pending-counter`, `rejected-counter`).
- Produces :
```ts
export interface E2EBuild { label: 'A' | 'B'; dir: string; buildHash: string }
export const BUILD_DIRS: { A: string; B: string };   // <REPO_ROOT>/.e2e-data/builds/{A,B}
export async function readBuildHash(dir: string): Promise<string>;   // première ligne de sw.js
export async function buildTwice(): Promise<{ a: E2EBuild; b: E2EBuild }>;   // écrit .e2e-data/builds/builds.json ; lève si les buildHash sont égaux
export async function loadBuilds(): Promise<{ a: E2EBuild; b: E2EBuild }>;   // builds.json absent → « lancer la suite via playwright test : global-setup construit A et B »
export async function shellLabel(page: Page): Promise<string | null>;   // <meta name="e2e-build"> de la coquille affichée
```

**Spec:** 01 §9.1.6 scénarios 4 à 6, R-PWA-2 à R-PWA-6, R-VER-2, R-VER-4 ; Review Focus 5.

- [ ] **Step 1: Write the failing test**

```ts
// update.spec.ts (serverOptions.publicDir = BUILD_DIRS.A)
// a.buildHash ≠ b.buildHash ; admin onboardé, shellLabel 'A' ; setFault({ kind: 'status', pathPrefix: '/api/sync/push', status: 503, body: { error: 'internal' } })
//   PUIS outbox += fakeOutboxOp(userId) ; meta.activeSessionId posé
// restart({ APPSPORT_PUBLIC_DIR: b.dir }) + reload + waitForWaitingWorker → shellLabel 'A' ; update-banner absent à 0 s et à 3 s (séance, R-PWA-3)
// Review Focus 5 : setOffline(true) + reload → shellLabel 'A' ; setOffline(false)
// activeSessionId null + reload → shellLabel 'A', update-banner visible, data-dismissible 'true' ; « Mettre à jour » → rechargement
// shellLabel 'B' et swStatus.buildHash = b en 20 s ; l'op est toujours dans l'outbox (R-VER-4) ; Dexie non effacé : idbVersion = LOCAL_DB_VERSION * 10,
//   meta.userId inchangé (même schéma en A et B : R-VER-5 relève de T25) ; caches shell-* = [`shell-${b.buildHash}`] ; plus de bandeau
// protocol.spec.ts : setFault 426 { error: 'protocol_unsupported', serverProtocol: 1, minProtocol: 1 } sur '/api/sync/' PUIS op en file ; restart vers B ; triggerForeground →
//   connection-status 'protocol_unsupported', op toujours en file (R-VER-2) ; bandeau visible en 30 s, data-dismissible 'false', pas de « Plus tard » ;
//   « Mettre à jour » → shellLabel 'B' ; setFault(null) + triggerForeground → 'online', outbox vide en 15 s,
//   pending-counter '0', rejected-counter = taille de la deadletter
// kill-switch.spec.ts : push en 503 PUIS op en file ; caches contiennent illustrations-v1 et shell-<12 hex> ; restart({ SW_KILL_SWITCH: '1' }) + reload →
//   registrationCount 0, aucun cache shell-* ni illustrations-* en 15 s, page affichée, aucun rechargement supplémentaire sur 3 s (pas de boucle) ;
//   op et meta.userId intacts (IndexedDB jamais touché) ; restart({ SW_KILL_SWITCH: '' }) + reload → registrationCount 1 et contrôleur
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test:e2e update protocol kill-switch` → `Cannot find module './support/builds'`.

- [ ] **Step 3: Implement**

`buildTwice`, pour A puis B : build Vite (API JS, `VITE_OWNER_FIRST_NAME = 'Alex'`) avec `build: { outDir: BUILD_DIRS[L], emptyOutDir: true }` et un plugin de test dont `transformIndexHtml` ajoute `<meta name="e2e-build" content="<L>">` (seule différence entre A et B), puis `readBuildHash`. **[décision plan]** Aucune spec n'utilise `page.route` ni `context.route` : les pannes passent par le proxy (`setFault`), identique sous Chromium et WebKit, avec ou sans SW.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/web test:e2e` → `10 passed` en CI Linux (5 specs × 2 projets ; specs WebKit dépendantes du SW `skipped` sous Windows) ; `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "test(pwa): E2E mise à jour A vers B, interrupteur d'urgence et 426"`

---

## Partie 7 — Exploitation

