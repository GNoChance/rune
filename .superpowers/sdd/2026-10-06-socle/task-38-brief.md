### Task 38: E2E Playwright : harnais, arrivée et hors ligne (Chromium et WebKit)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/support/{server.ts, fixtures.ts, pwa.ts, flows.ts, global-setup.ts}`, `apps/web/e2e/{arrival,offline}.spec.ts`
- Modify: `apps/web/package.json` (`test:e2e: "playwright test"`, dev `@playwright/test` 1.6x), `.github/workflows/ci.yml` (job `e2e`)

**Interfaces:**
- Consumes : CLI `init` et `admin:bootstrap` (T7, T11) ; `POST /api/admin/invitations` (T11) ; `SwStatus` (T29) ; `OutboxOp`, `LOCAL_DB_VERSION` (T25) ; `SYNC_PROTOCOL` (T2) ; `bootApp` → `SyncEngine.start()` (T28, T26) ; `data-testid` de §6 et libellés exacts des composants de T30 à T34 (§6) ; T35 (build `precachePlugin`, `mountWebApp`), T36 (SW), T37 (`bootServiceWorker`, `installPersistOnOnboarding`, `persistGranted`).
- Produces : Interfaces partagées §7 (`E2EFault`, `E2EServer` avec `close()`, `startE2EServer`, `bootstrapAdmin`) et :
```ts
export const REPO_ROOT: string; export const DEFAULT_PUBLIC_DIR: string;   // apps/web/dist
export const test: TestType<{ serverOptions: Parameters<typeof startE2EServer>[0]; server: E2EServer }, {}>; export { expect } from '@playwright/test';
// pwa.ts
export async function emulateStandalone(context: BrowserContext): Promise<void>; export async function requireServiceWorker(page: Page): Promise<void>;
export async function waitForController(page: Page): Promise<void>; export async function swStatus(page: Page): Promise<SwStatus | null>;
export async function waitForWaitingWorker(page: Page): Promise<void>; export async function registrationCount(page: Page): Promise<number>;
export async function cacheNames(page: Page): Promise<string[]>; export async function idbGetAll<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]>;
export async function idbPut(page: Page, store: string, value: unknown): Promise<void>; export async function idbVersion(page: Page): Promise<number>;
export async function metaValue(page: Page, key: string): Promise<unknown>; export async function triggerForeground(page: Page): Promise<void>;
export function fakeOutboxOp(userId: string, n?: number): OutboxOp;   // patch sync_rejection { dismissedAt: '2026-10-06T10:00:00.000Z' } valide pour SyncOp
// flows.ts
export const E2E_PASSWORD = 'cheval agrafe batterie correcte';
export async function createAccountViaUi(page: Page, username: string): Promise<void>;
export async function completeOnboardingViaUi(page: Page, o: { place: { kind: 'gym'; name: string; city: string } | { kind: 'home' } }): Promise<void>;
export async function setupOnboardedAdmin(server: E2EServer, context: BrowserContext, username?: string /* 'camille' */): Promise<Page>;
export async function loginViaUi(page: Page, username: string): Promise<void>;
```

**Spec:** 01 §9.1.6 scénarios 1 et 2 (sans séance, brique 3), R-SYN-30, R-SYN-31, R-SYN-33, R-TST-1 ; 02 §1 principe 4, §8 E8, R-ARR-1, R-INV-4, R-INV-5, R-AUTH-6, R-CPT-2 ; Review Focus 5.

- [ ] **Step 1: Write the failing test**

```ts
// arrival.spec.ts
// étape 1 (mode installé) : bootstrapAdmin(server) → page.goto(link) → requireServiceWorker → createAccountViaUi('camille') → data-step 'goal' →
//   completeOnboardingViaUi({ place: { kind: 'gym', name: 'Fitness Park Nation', city: 'Paris' } }) → URL `${server.url}/` ;
//   waitForController ; swStatus.shellCached true ; typeof metaValue('persistGranted') === 'boolean'
// étape 2 (Review Focus 5) : cookie 'dev-session' { httpOnly: true, secure: false, sameSite: 'Lax', path: '/' }, aucun '__Host-session' ;
//   page.evaluate(fetch PATCH /api/me { username: 'camille' }) → 200 (Origin du navigateur) ;
//   page.request.patch(`${server.url}/api/me`, { headers: { Origin: 'http://evil.example' }, data: { username: 'camille' } }) → 403 { error: 'origin_mismatch' }
// étape 3 : invitation membre créée par l'admin ; second contexte installé, /invite affiche 'hébergé chez Alex' ; « Lien ou code d'invitation » = code
//   en minuscules avec espaces (R-INV-5), « Suivant », createAccountViaUi('lea'), onboarding maison → URL `${server.url}/`
// offline.spec.ts
// context.setOffline(true) + reload → connection-status 'offline' en 5 s ; /profile lisible ('camille') ; « Enregistrer le pseudo » → 'Nécessite le réseau' ;
//   setOffline(false) → 'online' en 15 s
// setFault({ kind: 'blackhole' }) + reload (coquille du cache) → 'offline' en 5 s au plus après l'attachement de connection-status,
//   alors que navigator.onLine === true ; /profile lisible ; setFault(null) + triggerForeground → 'online'
// second contexte (§9.1.6 scénario 2) : loginViaUi('camille') → '/' ; premier contexte : « Pseudo » 'camille2' + « Enregistrer le pseudo » ;
//   second : triggerForeground → idbGetAll('user') a username 'camille2' en 15 s
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test:e2e arrival offline` → `Missing script: test:e2e`, puis `Cannot find module './support/fixtures'`.

- [ ] **Step 3: Implement**

- `playwright.config.ts` : `testDir: './e2e'`, `globalSetup`, `workers: 1`, `fullyParallel: false`, `timeout: 120_000`, `expect.timeout: 10_000`, `retries: CI ? 1 : 0`, `use: { serviceWorkers: 'allow', locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure' }`, projets `chromium` (Pixel 7) et `webkit` (iPhone 14).
- `global-setup.ts` : build Vite (API JS) vers `apps/web/dist` avec `process.env.VITE_OWNER_FIRST_NAME = 'Alex'`, création de `.e2e-data/`. `fixtures.ts` : la fixture `server` appelle `close()` en fin de test ; un message `console` contenant « Content Security Policy » fait échouer le test.
- `startE2EServer` : deux ports libres (proxy, backend) ; `dataDir = <REPO_ROOT>/.e2e-data/<horodatage>-<aléa>` avec `.appsport-volume` ; env `APP_ORIGIN=http://localhost:<proxyPort>`, `PORT=<backendPort>`, `HOST=127.0.0.1`, `APPSPORT_DATA_DIR`, `APPSPORT_PUBLIC_DIR` (`opts.publicDir ?? DEFAULT_PUBLIC_DIR`), `APPSPORT_CONTENT_DIR=<REPO_ROOT>/data`, `APP_VERSION=e2e` ; `cli(['init'])` puis `node --import tsx src/main.ts` (cwd `apps/server`) ; santé attendue 30 s au plus. Proxy `node:http` qui relaie tout (`Host`, `Origin`, `Cookie`) : `blackhole` garde la requête ouverte, `status` répond le JSON donné pour un préfixe, backend arrêté → 502 ; `setFault(null)` détruit les sockets retenues ; `stop()` arrête le backend seul (proxy maintenu) et garde `dataDir` ; `restart(env)` relance le backend en fusionnant `env` (`''` supprime), même URL ; `close()` arrête backend et proxy.
- `bootstrapAdmin` lit les lignes `Lien : ` et `Code : ` ; code de sortie non nul → erreur avec stderr.
- `requireServiceWorker`, si `'serviceWorker' in navigator` est faux : en CI (`process.env.CI`) lève une erreur (R-TST-1) ; ailleurs `test.skip` (« WebKit sous Windows : la CI Linux fait foi »). `emulateStandalone` : `matchMedia('(display-mode: standalone)')` vrai et `navigator.standalone = true`. `idbVersion` lit `db.version` (Dexie stocke `LOCAL_DB_VERSION * 10`).
- `flows.ts` (libellés de T30 et T31, `exact: true`) : compte « Pseudo », « Mot de passe », « Confirmation », case « J'ai lu la page Confidentialité et règles », « Créer mon compte » ; onboarding : radio puis « Suivant » pour « Prendre du muscle », « Non », « À la salle » ou « À la maison » ; salle « Ma salle n'est pas dans la liste », « Nom de la salle », « Ville », « Continuer », radio « Petite salle de quartier », « Créer la salle » (sans « Suivant ») ; maison « Suivant » (« Nom du lieu » prérempli) ; « Jamais », « Suivant » ; radios « 3 » et « 45 min », « Suivant » ; santé « Suivant » ; `offline-ready` `ready` en 30 s puis « Commencer » ; connexion « Pseudo », « Mot de passe », « Se connecter ».
- Job CI `e2e` (bloquant, R-TST-1) : `ubuntu-latest`, 30 min, `pnpm install --frozen-lockfile`, `pnpm --filter @appsport/web exec playwright install --with-deps chromium webkit`, `pnpm --filter @appsport/web test:e2e`, rapport `playwright-report` et `test-results` publiés en cas d'échec.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/web exec playwright install chromium webkit` puis `pnpm --filter @appsport/web test:e2e arrival offline` → `4 passed` (CI Linux) ; sous Windows sans SW WebKit : `2 passed, 2 skipped`.

- [ ] **Step 5: Commit**

`git commit -m "test(pwa): harnais E2E, arrivée et hors ligne sous Chromium et WebKit"`

---

