### Task 28: Coquille de l'appli web, client API et pages publiques

**Files:**
- Create: `packages/contracts/src/help-resources.ts` ; Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/package.json` (`react@19`, `react-dom@19`, `wouter@3`, `zod@4`, `dexie@4`, `@appsport/contracts`, `@appsport/domain` ; dev `vite@8`, `@vitejs/plugin-react`, `@testing-library/react`, `happy-dom`, `fake-indexeddb@6`, `@types/react`, `@types/react-dom`, `@appsport/server`), `vitest.config.ts` (projet web : `setupFiles: ['apps/web/test/setup.ts']`)
- Create: `apps/web/{index.html, vite.config.ts}`, `apps/web/src/{vite-env.d.ts, main.tsx, boot.ts, App.tsx, app-services.tsx, api/client.ts}`
- Create: `apps/web/src/ui/{index.ts, AppShell.tsx, Page.tsx, Button.tsx, Field.tsx, Banner.tsx, Dialog.tsx, ChoiceList.tsx, CopyButton.tsx, HealthWarning.tsx, ui.module.css, format.ts, errors.ts, use-action.ts}`
- Create: `apps/web/src/features/public/{PrivacyPage.tsx, privacy-content.ts, CreditsPage.tsx, HelpPage.tsx, NotFound.tsx, public.module.css}`, `apps/web/src/features/home/{HomePage.tsx, home.module.css}`
- Create: `apps/web/test/{setup.ts, support/fake-api.ts, support/render.tsx}`
- Test: `packages/contracts/test/help-resources.test.ts`, `apps/web/test/app/{api-client,boot,static-rules,ui-format}.test.ts`, `apps/web/test/app/{guard,public-pages,ui}.test.tsx`

**Interfaces:**
- Consumes : T25 (`createAppDb`, `AppDb`, `getMeta`, `setMeta`, `wipeUserData`, `createTestLocalDb`) ; T26 (`SyncTransport`, `browserTransport`, `fetchWithTimeout`, `OfflineError`, `createSyncEngine`, `SyncEngine`, `SyncState`, `SyncTrigger`, `ConnectionState`) ; contracts (`ApiErrorCode`, `ApiErrorBody`, `MeResponse`, `PRIVACY_POLICY_VERSION`, `SYNC_PROTOCOL`, `SYNC_TIMEOUT_MS`) ; domain (`createMonotonicUuidV7`).
- Produces : Interfaces partagées §6 (`help-resources.ts`, `api/client.ts`, `app-services.tsx`, `App.tsx`, `ui/*`, support `createFakeApi`, `createFakeSyncEngine`, `renderApp`, `renderWithServices`, `makeMe`). Pages : `PrivacyPage`, `CreditsPage`, `HelpPage`, `NotFound`, `HomePage` ; `OWNER_FIRST_NAME` (`import.meta.env.VITE_OWNER_FIRST_NAME ?? "l'administrateur"`). Support local :
```ts
export function bootApp(s: AppServices): () => void;   // boot.ts : s.sync.start() (déclencheurs puis 'launch', T26) ; rend () => s.sync.stop()
export interface FakeRequest { method: string; path: string; query: URLSearchParams; body: unknown; headers: Headers; init: RequestInit }
export type FakeReply = { status: number; body?: unknown; headers?: Record<string, string> };
export interface FakeApi { transport: SyncTransport; calls: FakeRequest[]; on(method: string, pattern: string /* '/api/gyms/:id' */, h: ((r: FakeRequest) => FakeReply | Promise<FakeReply>) | FakeReply): FakeApi;
  setOffline(mode: false | 'reject' | 'hang'): void }   // route inconnue → 404 { error: 'not_found' }
export type FakeSyncEngine = SyncEngine & { set(p: Partial<SyncState>): void; triggers: SyncTrigger[]; pullCount: number; started: boolean };   // défaut online, pending 0, rejected 0
export interface RenderAppOptions { path?: string; me?: MeResponse | null; api?: FakeApi; sync?: FakeSyncEngine; db?: AppDb; now?: number }
export interface RenderAppResult extends RenderResult { services: AppServices; api: FakeApi; sync: FakeSyncEngine; db: AppDb; location(): string }
// makeMe : id 'u-1', username 'lea', member, active, birthDate '1990-01-01', adult, onboardé le '2026-10-01T10:00:00.000Z', consentements inactifs, termsVersion '1.0'
// now par défaut Date.parse('2026-10-06T12:00:00.000Z') ; routeur memoryLocation de wouter
```

**Spec:** 03 P-LOG-4, §13.1, §13.5 à §13.7, §17 n°15, P-DRT-4 ; 01 R-PWA-7, R-SYN-29 (lancement), §2 (CSS Modules, wouter) ; 02 §11, R-ROLE-1, R-MDP-1 ; 07 §5.11 (HELP_RESOURCES, ancien numéro TCA absent).

- [ ] **Step 1: Write the failing test**

```ts
// help-resources.test.ts
expect(HELP_RESOURCES.map((r) => r.id)).toEqual(['emergency', 'pain', 'eating_disorder', 'doping', 'pregnancy', 'distress']);
// phone : emergency '15 / 112', eating_disorder '09 69 325 900', doping '0 800 15 2000', distress '3114', pain et pregnancy null ;
// verifiedOn '2026-10-06' partout ; seul distress a hours ; l'ancien numéro TCA ['0810','037','037'].join(' ') n'apparaît dans aucun fichier de apps/, packages/, data/
//   (parcours sans node_modules, dist, .e2e-data)
// api-client.test.ts
// send('POST', …) : Content-Type application/json, X-Appsport-Protocol '1', pas d'en-tête Origin, credentials 'same-origin' ; sans corps → {} ;
// réponse hors schéma → rejet ; 409 { error: 'username_taken' } → ApiError { status: 409, code: 'username_taken' } ;
// transport muet : rien à 3999 ms, NetworkRequiredError('Nécessite le réseau') à 4000 ms ; transport en échec → NetworkRequiredError ;
// 410 account_deleted → onAccountDeleted une fois ; 410 watermark_expired → non ; 401 { error: 'unauthenticated' } → onUnauthenticated une fois ;
// 401 { error: 'invalid_credentials' } → ApiError(401, 'invalid_credentials'), aucun hook
// boot.test.ts : bootApp avec le faux moteur → started true, puis false via la fonction rendue ; moteur réel (createSyncEngine sur api.transport,
//   meta.userId 'u-1', X-Appsport-Epoch 'E1') → 1er appel 'GET /api/health' (lancement), puis un second après visibilitychange visible (R-SYN-29)
// ui.test.tsx : Field → getByLabelText(label) rend l'enfant (useId, htmlFor) ; Dialog → role 'dialog', aria-modal, nommé par title ; Banner error → role 'alert', sinon 'status'
// guard.test.tsx — resolveGuard({ path, loaded, me, connection })
```

| Chemin, chargé, me, connexion | Résultat |
|---|---|
| `/privacy`, non, null, online ; `/help`, oui, null, offline ; `/invite`, oui, me, online ; `/login`, oui, me, unauthenticated | `render` |
| `/profile`, non, null, unknown | `wait` |
| `/profile`, oui, null, online ; `/profile`, oui, me, unauthenticated ou account_deleted | `redirect /login` |
| `/`, oui, non onboardé ; `/admin/members`, oui, admin non onboardé ; `/onboarding`, oui, onboardé | `redirect /onboarding` ; `redirect /onboarding` ; `redirect /` |
| `/onboarding`, oui, non onboardé ; `/profile`, oui, me avec `mustChangePassword`, online | `render` |
| `/` avec `mustChangePassword` ; `/login`, oui, me, online | `redirect /profile` ; `redirect /` |
| `/admin/members` membre ; admin | `not_found` ; `render` |

```ts
// App : /privacy sans session → h1 'Confidentialité et règles' ; /profile sans session → location '/login' ; non onboardé sur / → '/onboarding' ;
//   lien 'Administration' (href '/admin/members') pour un admin seulement ; rappel admin passwordReminderDue → /Pense à changer ton mot de passe/
// public-pages.test.tsx : /privacy contient 'Version 1.0', 'peut techniquement lire la base', "aucune requête manuelle sur les données d'une personne sans son accord",
//   "l'adresse de ton compte Tailscale", '90 jours sans usage', '365 jours au maximum', '12 mois', '30 jours au plus', '7 jours', '24 h', '90 jours',
//   'ne remplace pas un avis médical', 'serveur à domicile en France', 'États-Unis', 'sauvegardes chiffrées hors du domicile' ; titres 'Règles pour les 16-17 ans' et 'Coach et mineurs'
// /help : liens tel: ['tel:15','tel:112','tel:0969325900','tel:0800152000','tel:3114'], 'Numéros vérifiés le 06/10/2026', un seul 'Horaires :'
// /credits : h1 'Crédits', 'Aucune illustration pour le moment.', api.calls vide ; route inconnue → 'Page introuvable'
// static-rules.test.ts : index.html sans script en ligne (chaque <script> a src et un corps vide), sans http(s)://, sans style=, avec lang="fr" ;
//   aucune CSS de src/ ne charge un domaine tiers ; aucun fichier de src/ ne contient /ts\.net|localhost:\d+/ (R-PWA-7)
// ui-format.test.ts (now '2026-10-06T12:00:00.000Z')
expect(formatDate('2008-03-01')).toBe('01/03/2008'); expect(formatDate('2026-10-05T23:30:00.000Z')).toBe('06/10/2026');
expect(formatDateTime('2026-10-06T12:05:00.000Z')).toBe('06/10/2026 à 14:05');
// formatAge : −30 s "à l'instant", −3 min 'il y a 3 min', −5 h 'il y a 5 h', −2 j 'il y a 2 j'
expect(errorMessage(new NetworkRequiredError())).toBe('Nécessite le réseau'); expect(errorMessage(new ApiError(409, 'username_taken', {}))).toBe('Ce pseudo est déjà pris.');
expect(errorMessage(new ApiError(409, 'last_place', {}), { last_place: 'X' })).toBe('X'); expect(errorMessage(new Error('boom'))).toBe('Une erreur inattendue est survenue.');
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/contracts test help-resources` et `pnpm --filter @appsport/web test app/` → modules introuvables.

- [ ] **Step 3: Implement**

- `HELP_RESOURCES`, dans l'ordre : emergency « Urgence vitale (SAMU 15, numéro européen 112) » `'15 / 112'` ; pain « Douleur : consulte un médecin ou un kinésithérapeute » ; eating_disorder « Anorexie Boulimie Info Écoute (FFAB), appel non surtaxé » `'09 69 325 900'` `https://www.ffab.fr/500-ligne-tca-nouveau-numero` ; doping « Écoute Dopage » `'0 800 15 2000'` `https://lannuaire.service-public.gouv.fr/centres-contact/R20697` ; pregnancy « Grossesse ou allaitement : demande conseil à ton médecin ou à une sage-femme » ; distress « Prévention du suicide » `'3114'` hours `'24 h/24, gratuit'` `https://3114.fr/`.
- `resolveGuard`, dans l'ordre : chemin public (`/login` avec session valide → `/`) ; `!loaded` → `wait` ; pas de `me` ou connexion `unauthenticated`/`account_deleted` → `/login` ; `mustChangePassword` → `/profile` ; onboarding non terminé → `/onboarding` (et `/onboarding` terminé → `/`) ; `/admin*` sans rôle admin → `not_found`. Écrans connectés dans `<AppShell>`, pages publiques sans.
- `main.tsx` : `createSyncEngine({ onAccountDeleted: () => navigate('/login?reason=account_deleted') })` ; `createApiClient(transport, { onUnauthenticated: () => void sync.syncNow('manual'), onAccountDeleted: () => void handleAccountDeleted(db, navigate) })` ; `bootApp(services)` avant le rendu. `vite.config.ts` : proxy `/api` et `/illustrations` vers `http://localhost:3000`, port 5173 (`APP_ORIGIN=http://localhost:5173` noté en commentaire, hors de `src/`).
- `ERROR_MESSAGES` (un par code), dont `invalid_credentials` « Pseudo ou mot de passe incorrect », `account_disabled` « Compte désactivé, contacte l'administrateur », `under_min_age` « appsport est réservé aux 16 ans et plus », `last_admin` « Il doit rester au moins un administrateur actif. », `health_consent_required` « Cette action demande ton accord santé. », `rate_limited` « Trop d'essais. Réessaie plus tard. », `internal` « Le serveur a rencontré une erreur. ».
- `HEALTH_WARNING_TEXT` : « appsport ne remplace pas un avis médical. Consultez un médecin avant de reprendre une activité si vous avez un problème de santé, et arrêtez en cas de douleur. »
- `CreditsPage` statique, sans requête : la brique 2 ajoute la licence des illustrations et une source publique (`/api/catalog` exige une session).
- Page « Confidentialité et règles » (`Version ${PRIVACY_POLICY_VERSION}`) : contenu de 03 §13.5, sections « Qui est responsable », « Données collectées et pourquoi », « Où sont les données » (« serveur à domicile en France », « États-Unis pour le coach (brique 4) », « sauvegardes chiffrées hors du domicile »), « Durées de conservation », « Ce que l'administrateur voit et ne voit pas » (dont P-ADM-3 : « L'administrateur a la main sur le serveur et peut techniquement lire la base. Il s'engage à ne faire aucune requête manuelle sur les données d'une personne sans son accord. » et « L'administrateur voit l'adresse de ton compte Tailscale, une information gérée par Tailscale. »), « Tes droits et comment les exercer », « Règles pour les 16-17 ans », « Pas un avis médical », « Coach et mineurs ».
- `HomePage` : « Bonjour <pseudo> » et, si `passwordReminderDue`, `Banner` « Pense à changer ton mot de passe (rappel annuel). » Styles par CSS Modules uniquement.

- [ ] **Step 4: Run test to verify it passes**

Mêmes commandes → vert ; `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(web): coquille de l'appli, client API et pages publiques"`

---

