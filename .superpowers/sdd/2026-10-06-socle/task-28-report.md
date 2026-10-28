# Task 28 — Coquille de l'appli web, client API et pages publiques

Status: DONE_WITH_CONCERNS (concerns mineurs, voir fin)
Commit: `0121496 feat(web): coquille de l'appli, client API et pages publiques` (Closes #29), sur `socle`, non poussé.

## Implémenté
- `packages/contracts/src/help-resources.ts` (+ index) : `HELP_RESOURCES` dans l'ordre et avec les textes du brief, `verifiedOn '2026-10-06'`.
- `apps/web/src/api/client.ts` : `ApiError`, `NetworkRequiredError('Nécessite le réseau')`, `createApiClient` sur `fetchJsonWithTimeout` (échéance sur le corps). En-têtes `X-Appsport-Protocol: 1`, `credentials: 'same-origin'`, pas d'Origin ; `send` met toujours `Content-Type: application/json` et `{}` sans corps (DELETE compris). Décision prise sur le code `error` : `unauthenticated` → onUnauthenticated, `account_deleted` → onAccountDeleted ; `invalid_credentials` et `watermark_expired` → ApiError seule. Un corps d'erreur illisible donne `ApiError(status, 'internal', {})`. Réponse hors schéma → rejet (ZodError).
- `app-services.tsx` : `AppServices` (sans `swStatus`, ajouté par T29), `ServicesProvider`, `useServices`, `useSyncState` (useSyncExternalStore), `useLive` (Dexie liveQuery), `useMeState`/`useMe` (lisent `meta.me` ; `loaded` passe à vrai à la première réponse de la base), `handleAccountDeleted` (wipe avec la file, puis `/login?reason=account_deleted`).
- `boot.ts` : `bootApp` → `sync.start()`, rend `() => sync.stop()`. `main.tsx` câble db, transport, moteur, client API et `bootApp`, puis le rendu dans `<Router>` (navigateur).
- `App.tsx` : `PUBLIC_PATHS`, `resolveGuard` dans l'ordre du brief, `App` (pages publiques dans `PublicShell`, écrans connectés et not_found dans `AppShell`, `<Redirect replace>`).
- `ui/*` : AppShell (+ PublicShell, PublicLinks), Page, Button, Field (useId/htmlFor, aria-describedby, aria-invalid), Banner (alert/status), Dialog (role dialog, aria-modal, aria-labelledby, Échap), ChoiceList, CopyButton, HealthWarning/HEALTH_WARNING_TEXT, format (Europe/Paris), errors (ERROR_MESSAGES pour les 33 codes), use-action. Styles par CSS Modules seulement, polices système.
- Pages : PrivacyPage (+ `privacy-content.ts`, 9 sections, P-ADM-3 et Tailscale mot pour mot, `OWNER_FIRST_NAME` → « hébergé chez <prénom> », sinon « l'administrateur »), HelpPage (liens tel:, « Horaires : », « Numéros vérifiés le 06/10/2026 »), CreditsPage statique sans requête, NotFound, HomePage (« Bonjour <pseudo> », bandeau de rappel annuel).
- `index.html` (lang="fr", un script externe), `vite.config.ts` (port 5173, proxy `/api` et `/illustrations` vers `http://localhost:3000`, APP_ORIGIN noté en commentaire), `vite-env.d.ts`.
- Support de test : `test/setup.ts` (fake-indexeddb, nettoyage RTL), `support/fake-api.ts` (`createFakeApi`, `createFakeSyncEngine`), `support/render.tsx` (`makeMe`, `renderApp`, `renderWithServices`, memoryLocation, `DEFAULT_NOW`).
- Dépendances : react/react-dom 19, wouter 3 ; dev : vite 8, @vitejs/plugin-react, @testing-library/react, @types/react(-dom). zod, dexie, fake-indexeddb, happy-dom et @appsport/server étaient déjà là.

## TDD
RED (tests écrits avant tout code source) :
- `pnpm --filter @appsport/contracts test help-resources` → `Error: Cannot find module '../src/help-resources'`, 1 fichier en échec, aucun test.
- `pnpm --filter @appsport/web test app/` → 7 fichiers en échec : `Failed to resolve import "../../src/api/client"` (api-client, boot, public-pages via render.tsx), `"../../src/App"` (guard), `"../../src/ui/errors"` (ui-format), `"../../src/ui"` (ui), `ENOENT ... apps\web\index.html` (static-rules). Échec attendu : modules absents.
  (Un premier essai avait échoué plus tôt sur `setupFiles: ['apps/web/test/setup.ts']` : chemin résolu depuis la racine du projet web, donc `apps/web/apps/web/...` ; corrigé en `'test/setup.ts'`.)

GREEN :
- `pnpm --filter @appsport/contracts test help-resources` → `Tests 3 passed (3)`.
- `pnpm --filter @appsport/web test app/` → `Test Files 7 passed (7)`, `Tests 51 passed (51)`.
- Avant le commit : `pnpm lint` (Checked 283 files, aucune erreur), `pnpm typecheck` (4 paquets, sans erreur), `pnpm test` → `Test Files 104 passed (104)`, `Tests 1058 passed | 2 skipped (1060)` (les 2 skipped existaient déjà). Sortie sans avertissement ni stderr.

Tests ajoutés : help-resources (ordre, numéros, horaires, scan de l'ancien numéro TCA dans apps/, packages/, data/ sans node_modules, dist, .e2e-data, .superpowers), api-client (9), boot (faux moteur ; moteur réel : `GET /api/health` au lancement, puis un second après `visibilitychange`), static-rules, ui-format, ui (Field, Dialog, Banner, HealthWarning), guard (les 17 lignes du tableau + 6 tests App, dont « connexion unauthenticated → /login »), public-pages (4).

## Jalon 2 : vérification pour le porteur
Commandes PowerShell, depuis `C:\Users\eliott.colin\appsport`. Terminal 1, serveur (première fois : dossier, sentinelle et `init`) :
```powershell
$env:APPSPORT_DATA_DIR = "$env:USERPROFILE\appsport-dev-data"
New-Item -ItemType Directory -Force $env:APPSPORT_DATA_DIR | Out-Null
if (-not (Test-Path "$env:APPSPORT_DATA_DIR\.appsport-volume")) { New-Item -ItemType File "$env:APPSPORT_DATA_DIR\.appsport-volume" | Out-Null }
$env:APP_ORIGIN = 'http://localhost:5173'
$env:APPSPORT_CONTENT_DIR = "$PWD\data"
$env:HOST = '127.0.0.1'
pnpm --filter @appsport/server exec tsx src/main.ts init   # première fois seulement
pnpm --filter @appsport/server exec tsx src/main.ts
```
Terminal 2, Vite :
```powershell
pnpm --filter @appsport/web exec vite
```
(facultatif : `$env:VITE_OWNER_FIRST_NAME = 'Prénom'` avant de lancer Vite.) Puis ouvrir http://localhost:5173/privacy, /help et /credits.

Vérifié une fois (données dans `%TEMP%\claude\appsport-m2-data`) : `init` OK ; `GET http://localhost:5173/api/health` via le proxy → 200 avec les en-têtes de sécurité et `x-appsport-epoch`. Pages rendues dans Edge sans interface, piloté par CDP (lecture de `document.body.innerText` après 3 s) : `/privacy` → « Confidentialité et règles Version 1.0 Qui est responsable … hébergé chez l'administrateur … » ; `/help` → les 5 numéros, « Horaires : 24 h/24, gratuit », « Numéros vérifiés le 06/10/2026 » ; `/credits` → « Crédits Aucune illustration pour le moment. » ; `/` sans session → redirigé vers `/login`, qui affiche « Page introuvable » jusqu'à T30. Serveurs arrêtés ensuite. Remarque : `msedge --dump-dom --virtual-time-budget` n'attend pas IndexedDB et montre `/` vide ; c'est un artefact de l'outil, et un vrai chargement (CDP) se comporte bien.

## Revue personnelle
- Les interfaces partagées du §6 sont respectées (noms et signatures). `swStatus` est laissé de côté dans `AppServices` (noté « mod. T29 »).
- `renderApp` : sans `me`, c'est `makeMe()` ; `me: null` veut dire aucune session. Ce défaut n'est pas fixé par le brief : il est documenté dans le fichier.
- `plural(n, one, many)` renvoie seulement le mot (singulier pour 0 et 1), sans le nombre. Le brief ne le précisait pas.
- Apostrophe droite dans tout le texte (des tests vérifient l'absence de `’` dans les messages d'erreur et la page Confidentialité).
- Les écrans ne touchent pas à Dexie : seuls `app-services` (useMeState) et `handleAccountDeleted` lisent ou effacent la base.

## Points d'attention
1. `vitest.config.ts` : le brief dit `setupFiles: ['apps/web/test/setup.ts']`, mais Vitest résout ce chemin depuis la racine du projet (`apps/web`). La valeur qui fonctionne est `'test/setup.ts'` (même fichier).
2. `PublicShell` et `PublicLinks` ont été ajoutés dans `ui/AppShell.tsx` : ce sont le cadre des pages publiques et les liens de pied de page.
3. Les routes `/login`, `/onboarding` et `/profile` affichent « Page introuvable » jusqu'à T30, T31 et T32. Les redirections de la garde sont correctes.
4. Le contenu de la page Confidentialité est rédigé à partir de 03 §4, §5, §7, §10, §12 et §13. Il est à relire par le porteur, comme le dit la spec.

## Fix round 1 (commit 2db68ca, Refs #29)
Changes:
1. `privacy-content.ts`: added `ownerFirstName(raw)` and `buildPrivacySections(rawOwner)`. "Le responsable des données est <prénom|le porteur du projet>", a new contact line "Pour toute question ou demande, adresse-toi directement à <prénom>" (fallback "au porteur du projet"), and "seul <prénom|le porteur du projet> en détient les clés". "Pour toute autre demande" points to the same contact. "hébergé chez <prénom>" keeps the fallback "l'administrateur". The P-ADM-3 and Tailscale sentences are unchanged, word for word.
2. Wording: "jusqu'à la déconnexion (si la file d'envoi est vide)"; "Il gère les invitations et les salles, et consulte le journal de sécurité"; "ton adresse IP" added to "Jamais envoyés"; "gratuits et confidentiels" removed from HelpPage.
3. TCA scan: files are compacted (spaces, dots, dashes, non-breaking spaces removed) before searching for the digits only. A one-off check confirmed it catches `08 10 03 70 37` (apps/) and `tel:` + digits (data/); the probe files were then deleted. My first version had the number written in a comment and the scan flagged it; the comment was rewritten.
4. `handleAccountDeleted`: `try/catch/finally`. Navigation always happens and the promise no longer rejects.
5. Tests for the fallbacks (undefined, '', '   ') and for a given first name (' Bastien ').
6. `normalizePath` (trailing slash removed, `/` kept) used by `resolveGuard` and by the shell choice in `App`.

Tests:
- RED (before the fixes for 4 and 6): `pnpm --filter @appsport/web test app/` → 6 failed: handleAccountDeleted "promise rejected 'Error: base inaccessible' instead of resolving"; guard `/privacy/`, `/help/`, `/login/`, `/onboarding/` (e.g. `expected { kind: 'wait' } to deeply equal { kind: 'render' }`); App `/privacy/` heading not found.
- GREEN: `pnpm --filter @appsport/web test app/` → 62 passed; `pnpm --filter @appsport/contracts test help-resources` → 3 passed; `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test` → 105 files, 1069 passed | 2 skipped.
- `git show --stat HEAD`: 8 files (App.tsx, app-services.tsx, HelpPage.tsx, privacy-content.ts, app-services.test.ts (new), guard.test.tsx, public-pages.test.tsx, help-resources.test.ts). Working tree clean.
