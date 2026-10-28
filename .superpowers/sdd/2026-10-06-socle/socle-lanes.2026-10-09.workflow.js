export const meta = {
  name: 'socle-lanes',
  description: 'Continue the socle plan in parallel lanes (implement, multi-lens review, adversarial verify, fix loop) under a global agent cap (12 on 2026-10-09)',
  whenToUse: 'Continue docs/superpowers/plans/2026-10-06-socle.md on several branches under a global agent cap',
  phases: [
    { title: 'Implement', detail: 'implementer writes the task with TDD and commits' },
    { title: 'Review', detail: 'one reviewer per lens' },
    { title: 'Triage', detail: 'merge duplicate findings, classify minors' },
    { title: 'Verify', detail: '3 skeptics try to refute each Critical/Important finding' },
    { title: 'Fix', detail: 'one fixer applies confirmed findings and cheap minors' },
    { title: 'Re-review', detail: 'scoped re-review of each fix diff' },
  ],
}

const ARGS = {
 "maxAgents": 12,
 "lanes": [
  {
   "lane": "W",
   "startHead": "6101b64",
   "tasks": [
    {
     "task": "37",
     "title": "prompt-mode updates, page-side kill switch, persistent storage and 426",
     "issue": 38,
     "kind": "pwa",
     "implModel": "opus",
     "context": "Tasks 1-36 are done on socle once socle-pwa is merged: the custom SW (T36: SKIP_WAITING, GET_STATUS with localDbVersion and illustrationsReferenced, SYNC_ILLUSTRATIONS, SW-side kill switch, local-DB marker cache), cache constants in sw/precache-manifest.ts (T35; manifest without orientation lock since 823a3a8), sw-client getSwStatus/postToSw, StatusRepo (activeSessionId, illustrationFiles, requestPersistentStorage writing meta.persistGranted), AppShell/PublicShell (the onboarding renders in PublicShell), CreateAccountForm (T30) and ReadyStep emitting ONBOARDING_COMPLETED_EVENT (T31). main.tsx registers no service worker yet: this task adds the whole page side.\nRESUME (2026-10-09): a previous implementer was cut off mid-task on 2026-10-08. The working tree holds its uncommitted, unreviewed work (also backed up on origin wip/T37). Inspect it, keep what is right, fix what is wrong and finish the task. For the mandatory separate RED run, stash the implementation files (keep the tests), run the tests and see them fail, then restore the implementation.",
     "rulings": "- Spec is the binding authority over the brief. Straight apostrophe ' in all UI copy. Screens never touch Dexie (only repos); never use navigator.onLine.\n- Exact UI contract used by T39's E2E: UpdateBanner renders nothing when show is false; otherwise a root with data-testid=\"update-banner\" and data-dismissible=\"true|false\", the text « Nouvelle version disponible », buttons « Mettre à jour » and « Plus tard » (the latter only when dismissible); forced: no « Plus tard » and the sentence « Mets à jour l'appli pour reprendre la synchronisation. ». AppShell renders <UpdateBanner /> first; PublicShell (onboarding, public pages) has none.\n- shouldShowUpdateBanner: show = available && activeSessionId === null && !onboardingInProgress; dismissible = !forced (the brief's 8-row table). UpdateBanner: onboardingInProgress = me !== null && me.onboardingCompletedAt === null; activeSessionId from useLive(() => repos.status.activeSessionId(), []); the local dismissed state is ignored once forced (R-PWA-3, R-PWA-5).\n- available needs a waiting worker, a controller, and the WAITING worker's own GET_STATUS answer (MessageChannel, 1 s) with localDbVersion >= LOCAL_DB_VERSION (R-PWA-9, ADR 0001 decision 5). A silent waiting SW or a lower version is never offered and never gets SKIP_WAITING (R-DEP-4 image-only rollback). First install (no controller) → available false.\n- Update checks (R-PWA-2): register('/sw.js', { scope: '/', updateViaCache: 'none' }), registration.update() at launch, when the page becomes visible again, and every 3 600 000 ms only while visible.\n- applyUpdate (R-PWA-4): sets a reloading flag, posts exactly one { type: 'SKIP_WAITING' } to the waiting worker, reloads only on controllerchange while the flag is set, once even if the event repeats; controllerchange without applyUpdate never reloads; with meta.activeSessionId set it sends nothing (R-PWA-3).\n- 426 (R-VER-2, R-PWA-5): SyncState connection 'protocol_unsupported' → markForced() and a new update check; the outbox is untouched. No service worker support → inert controller { available: false, forced: false }.\n- bootServiceWorker: production only (import.meta.env.PROD), started with void so it never delays the first render. Health probe through fetchWithTimeout (T26), JSON read even on a 503 (T9 ruling: degraded health keeps swKill). swKill true → applyKillSwitchIfNeeded and stop WITHOUT registering (swControllerStore stays null); probe null or swKill false → register and publish the controller; then post SYNC_ILLUSTRATIONS with status.illustrationFiles() when a controller exists, and again on every controllerchange (R-SYN-32; T36 counts illustrations against the last list received, so a dropped post keeps « Prêt hors ligne » red).\n- Carry (ledger 2026-10-08, ADR 0001 decision 5, T35-F1 and T36 reports): after Dexie opens, the page raises the local-DB marker: Cache Storage LOCAL_DB_MARKER_CACHE ('appsport-meta'), key LOCAL_DB_MARKER_KEY ('/__sw/local-db-version'), synthetic Response whose body is max(current marker, LOCAL_DB_VERSION); never lowered; constants imported from sw/precache-manifest.ts (never from sw.ts, so the page never bundles SW code); a write failure never blocks boot. Not in the brief's file list: put it in register.ts (called by bootServiceWorker) and test it with createFakeCacheStorage, which now takes an options object { origin?, failPut?, failDelete? } (T36).\n- Page kill switch (R-PWA-6): unregister every registration, delete the caches named shell-* and illustrations-* (by prefix, as T36 does), keep 'appsport-meta' and any other cache (the brief's expected ['autre'] becomes ['appsport-meta','autre'] when the marker is seeded), never touch indexedDB (meta.userId intact); reload once and only if something was unregistered or deleted — nothing to clean → false, no reload (the T36 SW-side switch may already have cleaned up and navigated).\n- Persistent storage (R-SYN-31, R-CPT-2, ledger « Carry to T37 »): installPersistOnOnboarding(repos.status) in main.tsx listens to ONBOARDING_COMPLETED_EVENT (dispatched by ReadyStep) and calls requestPersistentStorage only if isStandalone() (features/auth/install-help.ts); the returned function removes the listener. CreateAccountForm on success and isStandalone() → void repos.status.requestPersistentStorage(); no direct call in ReadyStep (the event covers it). StatusRepo writes meta.persistGranted (T38 asserts it is a boolean in installed mode; SettingsPage displays it).\n- Known deferred minors (ledger 2026-10-08), not for this task: kill-switch reload vs the older-schema guarantee (ADR, R-PWA-6), illustration list after a failed write, same-size catalog update window.\n- Tests: apps/web/test/sw/{update-banner-rules,register,kill-switch}.test.ts and {UpdateBanner,persist}.test.tsx with test/support/fake-sw-container.ts; RED = « Failed to resolve import \"../../src/sw/register\" »; GREEN = Test Files 5 passed, then the whole web suite (architecture.test included), pnpm lint, pnpm typecheck.\n- OWNER RULING (2026-10-08), ADR 0001 decision 7 confirmed: a full close of the app counts as consent to activate a newer waiting build; while any app window is open nothing activates without the « Mettre à jour » click; an older-schema build never reaches waiting (decision 5).\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) Reload loops or double reloads: a controllerchange caused by T36's clients.claim on first install must not reload; the page kill switch must not reload when the SW-side switch already cleaned up, nor register a SW when swKill is true. (b) A waiting SW with a lower localDbVersion, or one that never answers GET_STATUS within 1 s, gets offered or activated — GET_STATUS must go to registration.waiting, not to the controller (R-PWA-9, R-DEP-4). (c) bootServiceWorker delaying the first render, running in dev or in tests, or treating a 503 health body as « no answer » (kill switch lost during an outage). (d) SYNC_ILLUSTRATIONS not re-posted when a controller appears or changes, leaving readiness red. (e) Banner rules: visible during onboarding or with activeSessionId set, still closable after a 426, or a « Plus tard » dismissal surviving a later 426. (f) main.tsx has no Repos today (useRepos caches one set per AppServices in a WeakMap): wiring repos.status there must not create a second divergent repos set; persist never requested in a browser tab, nor twice for one event.",
     "dependsOn": [
      "35",
      "36"
     ],
     "parallelOk": "Can run alongside T41 and T42 (apps/server build, infra/, .github: disjoint files). Not alongside T38/T39 (they consume its banner and bootServiceWorker and edit apps/web)."
    },
    {
     "task": "38",
     "title": "Playwright E2E harness, arrival and offline (Chromium and WebKit)",
     "issue": 39,
     "kind": "pwa",
     "implModel": "opus",
     "context": "Tasks 1-37 are done: CLI init and admin:bootstrap (prints « Lien : » and « Code : »), all access, onboarding, profile and privacy screens with stable testids (Interfaces §6), the precached build and custom SW (T35/T36) and, in production builds, T37's bootServiceWorker and installPersistOnOnboarding. No Playwright harness exists; the root test:e2e script already delegates to the web package (T1) and vitest's web project excludes e2e/**.",
     "rulings": "- Spec is the binding authority over the brief. Straight apostrophe ' in every UI string the flows type or match. Never use navigator.onLine as truth (the offline spec asserts 'offline' while navigator.onLine === true).\n- Owner ruling 2026-10-08 (WCAG 2.1 SC 1.3.4): the manifest no longer locks orientation (823a3a8) and screens must stay usable in landscape — add ONE landscape check, e.g. a key screen at the project device's viewport with width and height swapped keeps its main action visible and clickable without horizontal scrolling. Prefer a step inside an existing spec so the brief's counts hold (4 passed on CI Linux; 2 passed + 2 skipped on Windows); a separate test must report the new counts (T39's « 10 passed » and T40's totals shift too).\n- Labels queried with exact: true, as in the brief and confirmed by the T30/T31 reports: « Lien ou code d'invitation », « Suivant », « Pseudo », « Mot de passe », « Confirmation », « J'ai lu la page Confidentialité et règles », « Créer mon compte », « Se connecter », « Ma salle n'est pas dans la liste », « Nom de la salle », « Ville », « Continuer », « Créer la salle », radios « 3 » and « 45 min », « Commencer »; « Prendre du muscle », « Jamais » and « Petite salle de quartier » come from contracts labels. State is read from attributes, never from French text: connection-status data-state, pending-counter / rejected-counter data-count, offline-ready data-state 'ready', onboarding-step data-step.\n- [décision plan] (T39 brief, applies to every spec): no page.route or context.route; faults go through the proxy (setFault, stop, restart), identical under Chromium and WebKit with or without SW. Offline = context.setOffline(true) AND a blackhole (01 §9.1.6: rely on the 4 s SYNC_TIMEOUT_MS, not on a DNS error).\n- playwright.config verbatim: testDir './e2e', globalSetup, workers 1, fullyParallel false, timeout 120_000, expect.timeout 10_000, retries CI ? 1 : 0, use { serviceWorkers: 'allow', locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure' }, projects chromium (Pixel 7) and webkit (iPhone 14).\n- global-setup: Vite JS API build into apps/web/dist with VITE_OWNER_FIRST_NAME='Alex' (the invite page must show 'hébergé chez Alex'), using the same config loader as the web build script (vite build --configLoader runner, T35-F15); creates .e2e-data/ (gitignored, like test-results/ and playwright-report/). The server fixture calls close() after each test; any console message containing « Content Security Policy » fails the test (P-LOG-4).\n- startE2EServer per brief: two free ports; dataDir <REPO_ROOT>/.e2e-data/<stamp>-<random> with .appsport-volume; env APP_ORIGIN=http://localhost:<proxyPort>, PORT=<backendPort>, HOST=127.0.0.1, APPSPORT_DATA_DIR, APPSPORT_PUBLIC_DIR (opts.publicDir ?? DEFAULT_PUBLIC_DIR), APPSPORT_CONTENT_DIR=<REPO_ROOT>/data, APP_VERSION=e2e; cli(['init']) then node --import tsx src/main.ts (cwd apps/server); health within 30 s. node:http proxy relaying everything (Host, Origin, Cookie): blackhole holds the request open, status answers the given JSON for a path prefix, backend down → 502, setFault(null) destroys held sockets; stop() stops the backend only (proxy kept, dataDir kept); restart(env) merges env ('' deletes a key) on the same URL; close() stops both. The browser always uses server.url (localhost), never 127.0.0.1.\n- bootstrapAdmin passes --birth-date (default '1990-01-01'), reads the « Lien : » and « Code : » lines, non-zero exit → error carrying stderr. Reports and pasted logs never contain codes or links with a # fragment (implementer-common.md, T31-F23): mask them.\n- Review Focus 5: cookie 'dev-session' { httpOnly: true, secure: false, sameSite: 'Lax', path: '/' } and no '__Host-session'; same-origin fetch PATCH /api/me → 200; page.request with Origin http://evil.example → 403 { error: 'origin_mismatch' }. Legitimate page.request calls (e.g. the member invitation through POST /api/admin/invitations) must send Origin = server.url and a JSON body (CSRF rules of the global constraints).\n- R-INV-5: the member code is typed in lowercase with spaces. idbVersion reads db.version (Dexie stores LOCAL_DB_VERSION * 10); Dexie DB 'appsport', stores meta (key), outbox, deadletter, user, …; fakeOutboxOp(userId, n) builds a sync_rejection patch { dismissedAt: '2026-10-06T10:00:00.000Z' } valid for SyncOp (T39 relies on it).\n- E2E_PASSWORD 'cheval agrafe batterie correcte' (31 code points, >= 14) keeps the admin out of the forced password change (R-MDP-1); if a flow ever lands there, that screen offers only the change form and « Se déconnecter » (owner ruling 2026-10-08).\n- R-TST-1: requireServiceWorker throws in CI (process.env.CI) when 'serviceWorker' in navigator is false, otherwise test.skip with « WebKit sous Windows : la CI Linux fait foi ». Local run: pnpm --filter @appsport/web exec playwright install chromium webkit, then pnpm --filter @appsport/web test:e2e arrival offline (no -- with pnpm 10) → 2 passed, 2 skipped on Windows. CI job e2e (blocking: ubuntu-latest, 30 min, pnpm install --frozen-lockfile, playwright install --with-deps chromium webkit, test:e2e, playwright-report and test-results uploaded on failure) → 4 passed. Report both.\n- OWNER RULING (2026-10-08), ADR 0001 decision 7 confirmed: a full close of the app counts as consent to activate a newer waiting build; while any app window is open nothing activates without the « Mettre à jour » click; an older-schema build never reaches waiting (decision 5).\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) Proxy fidelity: Host, Origin or Cookie rewritten or dropped (origin_mismatch, lost session), held blackhole sockets not destroyed by setFault(null), restart() resolving before health answers through the proxy. (b) Flaky timing: fixed sleeps instead of expect.poll / toHaveAttribute with timeouts; the 5 s offline budget measured from the attachment of connection-status; triggerForeground must dispatch the visibilitychange the engine actually listens to. (c) emulateStandalone must apply before any app script runs (addInitScript: matchMedia('(display-mode: standalone)') true and navigator.standalone = true), otherwise isStandalone() stays false and persistGranted is never written. (d) The account checkbox label contains a link to the privacy page: check it by role (getByRole('checkbox', …).check()); clicking the label text may navigate away. (e) Leftover backend processes or ports on Windows (tsx child tree not killed by close()), .e2e-data growing without bound. (f) A WebKit SW gap silently skipped in CI instead of failing (R-TST-1).",
     "dependsOn": [
      "35",
      "36",
      "37"
     ],
     "parallelOk": "Can run alongside T41 and T42, but T38 and T41 both add a ci.yml job and dev deps (pnpm-lock.yaml): expect a merge, then re-run pnpm install. Not alongside T37 (consumes it) nor T39/T40 (they consume its harness)."
    },
    {
     "task": "39",
     "title": "E2E: update A to B, kill switch and 426",
     "issue": 40,
     "kind": "pwa",
     "implModel": "opus",
     "context": "T38 delivered the Playwright harness (proxy-backed E2EServer with setFault, stop and restart; fixtures; pwa.ts helpers; flows; global-setup building apps/web/dist) and the arrival and offline specs; T37 the prompt-mode banner, page kill switch and 426 handling; T36 the cache-first SW and the SW-side kill switch. This task builds two shells A and B and covers 01 §9.1.6 scenarios 4 to 6.",
     "rulings": "- Spec is the binding authority over the brief. [décision plan] no page.route or context.route in any spec: every fault goes through the proxy (setFault), identical under Chromium and WebKit, with or without SW.\n- buildTwice: A then B with Vite's JS API (VITE_OWNER_FIRST_NAME='Alex', same config loader as the web build script), build.outDir BUILD_DIRS[L] = <REPO_ROOT>/.e2e-data/builds/{A,B}, emptyOutDir true, plus a test plugin whose transformIndexHtml adds <meta name=\"e2e-build\" content=\"<L>\"> — the ONLY difference between A and B; readBuildHash reads the first line of sw.js; builds.json written; throws if the two buildHash are equal. loadBuilds without builds.json → « lancer la suite via playwright test : global-setup construit A et B ». global-setup keeps T38's build, then awaits buildTwice().\n- Ordering exactly as written: setFault on the push (503) or on '/api/sync/' (426) FIRST, then enqueue fakeOutboxOp — otherwise the engine pushes the op before the fault.\n- update.spec (serverOptions.publicDir = BUILD_DIRS.A): shell A while B waits, after a reload online and after setOffline(true) + reload (Review Focus 5); update-banner absent at 0 s and at 3 s while meta.activeSessionId is set (R-PWA-3); once cleared and reloaded: visible with data-dismissible 'true'; « Mettre à jour » → shellLabel 'B' and swStatus.buildHash = b within 20 s; the op is still in the outbox (R-VER-4); idbVersion = LOCAL_DB_VERSION * 10 and meta.userId unchanged (R-PWA-4; same schema in A and B, R-VER-5 belongs to T25); shell-* caches = ['shell-<b.buildHash>'] (assert on shell-* only: illustrations-v1 and the 'appsport-meta' marker of ADR decision 5 stay); no banner afterwards.\n- protocol.spec: 426 { error: 'protocol_unsupported', serverProtocol: 1, minProtocol: 1 } on '/api/sync/' → connection-status data-state 'protocol_unsupported', op kept (R-VER-2); after restart to B and triggerForeground, banner within 30 s with data-dismissible 'false' and no « Plus tard » (R-PWA-5); « Mettre à jour » → shellLabel 'B'; setFault(null) + triggerForeground → 'online', outbox empty within 15 s, pending-counter data-count '0', rejected-counter data-count = deadletter size (the fake op is rejected by the server).\n- kill-switch.spec: caches hold illustrations-v1 and shell-<12 hex>; restart({ SW_KILL_SWITCH: '1' }) + reload → registrationCount 0, no shell-* nor illustrations-* cache within 15 s, page displayed, no extra reload over 3 s (no loop); op and meta.userId intact (IndexedDB never touched, R-PWA-6); restart({ SW_KILL_SWITCH: '' }) + reload → one registration and a controller.\n- Expected: pnpm --filter @appsport/web test:e2e → 10 passed on CI Linux (5 specs × 2 projects, plus any separate landscape test T38 added); on Windows the SW-dependent WebKit specs are skipped by requireServiceWorker (report the exact local counts and say the CI job e2e is authoritative); pnpm lint && pnpm typecheck. Reports never contain invitation codes or links with a fragment.\n- OWNER RULING (2026-10-08), ADR 0001 decision 7 confirmed: a full close of the app counts as consent to activate a newer waiting build; while any app window is open nothing activates without the « Mettre à jour » click; an older-schema build never reaches waiting (decision 5).\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) ADR 0001 decision 7 (still [à confirmer par le propriétaire]): the browser activates a waiting SW once every client is closed — closing the last page or context between steps activates B without a click and makes the « A while B waits » assertions meaningless; keep one page open from B's install to the click. (b) Vacuous waits: checking « banner absent » before waitForWaitingWorker, or starting the 3 s no-reload window before the cleanup finished. (c) Kill-switch double reload or loop: T36's SW-side navigate plus T37's page reload, or the page registering again because its probe saw a proxy 502 while restart() was in progress. (d) A and B differing by more than the meta tag (non-deterministic build) or equal hashes; three builds in global-setup must fit the 30 min CI job. (e) idbGetAll on the wrong store names (outbox, deadletter, meta) returning empty arrays that make « outbox empty » pass vacuously.",
     "dependsOn": [
      "35",
      "36",
      "37",
      "38"
     ],
     "parallelOk": "Can run alongside T40 (T40 only adds e2e/epoch.spec.ts on the web side plus server ops files: disjoint from builds.ts, global-setup and these specs) and T41-T43; two E2E suites on one machine need separate worktrees (free ports, own .e2e-data). Not alongside T38."
    }
   ]
  },
  {
   "lane": "I",
   "repo": "C:\\Users\\eliott.colin\\appsport-infra",
   "branch": "socle-infra",
   "startHead": "6101b64",
   "tasks": [
    {
     "task": "41",
     "title": "server bundle, Dockerfile, compose and image contract",
     "issue": 42,
     "kind": "infra",
     "implModel": "opus",
     "context": "The server runs under tsx in dev and E2E; the web build (T35) writes apps/web/dist; static serving reads APPSPORT_PUBLIC_DIR and the catalog APPSPORT_CONTENT_DIR (T23); /api/health returns { status, version, db, protocol, minProtocol, epoch, swKill } (T6); runtime dependencies are pure JS plus node:sqlite (better-sqlite3 is test-only, T3 ruling). No bundle, Dockerfile, compose file or image job exists yet; ci.yml has lint, typecheck, typecheck-ts6 and test jobs (plus e2e once T38 is merged).\nRESUME (2026-10-09): a previous implementer was cut off mid-task on 2026-10-08. The working tree holds its uncommitted, unreviewed work (also backed up on origin wip/T41). Inspect it, keep what is right, fix what is wrong and finish the task. For the mandatory separate RED run, stash the implementation files (keep the tests), run the tests and see them fail, then restore the implementation. jq 1.8.2 and bats 1.13.0 are now installed locally (Git Bash and PowerShell), so shell tests can run locally; Docker may still be absent, in which case the image contract runs in CI only.",
     "rulings": "- Spec is the binding authority over the brief. Rules: 01 §2-§3, R-DEP-2, R-DEP-5, R-OPS-3, R-TST-1, 08 §4 compose and contract 1-7, §13.1.\n- build.mjs exactly as the brief: esbuild entryPoints ['src/main.ts'], bundle, platform 'node', format 'esm', target 'node24', outfile 'dist/server.mjs', the createRequire banner, legalComments 'eof', no .txt loader (the common-password list is a TS module, T8). dist/server.mjs is one ESM file with no import outside node:* (bundle.test regex). Scripts: apps/server build = \"node build.mjs\"; root build:server; root build = web then server. Dev deps: esbuild (same ^0.28 line as apps/web) and yaml 2.x (T42's test reuses it).\n- bundle.test: server.mjs copied into a temp dir OUTSIDE the repo (no node_modules) with data/.appsport-volume, public/index.html and a copy of the repo's data/; node server.mjs init → 0 and data/appsport.db created; db:check → 0; launched server → /api/health { status: 'ok', version: 'v9.9.9-test', db: 'ok', protocol: 1, minProtocol: 1, swKill: false }.\n- compose.yaml values verbatim: name appsport, services exactly ['app'], image 'ghcr.io/gnochance/appsport:${APPSPORT_VERSION:?APPSPORT_VERSION absent de deploy.env}', ports ['127.0.0.1:3000:3000'] only (Docker bypasses ufw), volumes ['/srv/appsport/data:/data'], env_file /srv/appsport/secrets/app.env, read_only true, tmpfs ['/tmp'], user '1000', mem_limit '512m', restart unless-stopped, stop_grace_period '10s', healthcheck on http://127.0.0.1:3000/api/health; no privileged, network_mode, cap_add, build nor expose.\n- Dockerfile (# syntax=docker/dockerfile:1, context = repo root): FROM node:24 AS build with corepack enable, pnpm install --frozen-lockfile, ARG VITE_OWNER_FIRST_NAME before pnpm build; final FROM node:24-slim without node_modules, ARG VERSION=dev after the last FROM, ENV NODE_ENV=production APP_VERSION=${VERSION} PORT=3000 HOST=0.0.0.0 APPSPORT_DATA_DIR=/data APPSPORT_PUBLIC_DIR=/app/public APPSPORT_CONTENT_DIR=/app/data, the three COPY --from=build lines verbatim, USER 1000, EXPOSE 3000, HEALTHCHECK with node's fetch (node:24-slim has no curl), CMD [\"node\",\"/app/server.mjs\"]. .dockerignore: **/node_modules, .git, **/dist, .e2e-data, test-results, playwright-report, docs.\n- infra/test/image-contract.sh <image> <version>: set -euo pipefail, fail → exit 1, cleanup trap, chmod 0777 on the mktemp -d mounted at /data (the runner is uid 1001), the 9 checks in the brief's order, last line « Contrat d'image respecté (9 contrôles). »; committed with git add --chmod=+x (mode 100755 in git ls-files -s; LF endings come from .gitattributes).\n- Host-only / CI-only: no Docker on this PC. Locally: pnpm --filter @appsport/server test build/bundle infra/compose → Test Files 2 passed. The Dockerfile and the contract are verified only by the blocking CI job image: docker build -f infra/Dockerfile --build-arg VERSION=v0.0.0-ci -t appsport:ci . then bash infra/test/image-contract.sh appsport:ci v0.0.0-ci, expected last line « Contrat d'image respecté (9 contrôles). ». shellcheck of image-contract.sh runs in T43's infra job. State this, with the expected CI output, in the report.\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) Bundle not self-contained: a package left external or required dynamically, a path built from import.meta.url / __dirname that resolves into the source tree (static serving, catalog, migrations), or the main-module guard failing once bundled (preflight T7/T41) — bundle.test must run server.mjs from a directory without node_modules. (b) SIGTERM as PID 1: docker stop -t 15 must finish in under 10 s with exit code 0 (contract 9), and every stdout line must be JSON (contract 8). (c) Image content: node_modules absent, public/ from apps/web/dist, data/ copied, VITE_OWNER_FIRST_NAME reaching the Vite build stage, APP_VERSION from the final-stage ARG VERSION. (d) Contract robustness on the runner: uid 1000 writing to the mounted mktemp dir, read-only root with tmpfs /tmp, only 0BB8 listening in /proc/net/tcp*, cleanup trap on failure. (e) bundle.test leaving a server process, a port or a temp dir behind on Windows.",
     "dependsOn": [
      "35"
     ],
     "parallelOk": "Can start at once, alongside T37 (disjoint files). Alongside T38 both add a ci.yml job and dev deps (pnpm-lock.yaml): expect a merge, then re-run pnpm install. T42 needs it; T43 consumes compose.yaml.",
     "repo": "C:\\Users\\eliott.colin\\appsport-infra",
     "branch": "socle-infra"
    },
    {
     "task": "42",
     "title": "release workflow to GHCR and Dependabot",
     "issue": 43,
     "kind": "infra",
     "implModel": "opus",
     "context": "T41 created infra/Dockerfile with ARG VERSION and ARG VITE_OWNER_FIRST_NAME and added yaml to the server dev deps; ci.yml has run on pull_request and on push to main since T1. This task adds the tag-triggered release workflow, Dependabot and their YAML test.",
     "rulings": "- Spec is the binding authority over the brief. Rules: R-DEP-1, R-DEP-2, R-TST-3; R-OPS-13: GitHub never reaches the server and nothing deploys automatically — the release only publishes the image; 01 §4 and 03 §10.9: no Anthropic key or mention in CI, no /anthropic/i in release.yml nor ci.yml.\n- release.yml: on { push: { tags: ['v*.*.*'] } } only; workflow permissions exactly { contents: read, packages: write, actions: read }; job publish (ubuntu-latest), steps in order: actions/checkout@v4 with fetch-depth 0; tag guard ^v[0-9]+\\.[0-9]+\\.[0-9]+$ (« Tag invalide : $GITHUB_REF_NAME »); git fetch origin main then git merge-base --is-ancestor \"$GITHUB_SHA\" origin/main (« Le commit n'est pas sur main : publication refusée. »); CI guard with GH_TOKEN: ${{ github.token }}, gh api \"repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}&status=success\" --jq '.total_count' ≥ 1, else « La CI du commit ${GITHUB_SHA} n'est pas verte : publication refusée. Relancer ce job quand la CI de main sera verte. »; docker/setup-buildx-action@v3; docker/login-action@v3 (ghcr.io, github.actor, github.token); docker/build-push-action@v6 with context '.', file infra/Dockerfile, platforms linux/amd64, push true, tags ghcr.io/gnochance/appsport:${{ github.ref_name }}, build-args exactly the two lines VERSION=${{ github.ref_name }} and VITE_OWNER_FIRST_NAME=${{ vars.VITE_OWNER_FIRST_NAME }}; no ':latest'.\n- dependabot.yml: version 2; npm on '/' weekly with groups { npm-minor-patch: { patterns: ['*'], update-types: ['minor', 'patch'] } }; docker on '/infra' weekly; github-actions on '/' weekly (08 §8: base image, npm and actions).\n- Preflight D7, accepted: ci.yml already has on: { pull_request: {}, push: { branches: [main] } } since T1, so the « ci.yml runs on main » assertion is green before any code — treat it as a verification and do not churn ci.yml; the RED run is the ENOENT on release.yml.\n- Host-only: the workflow only runs on GitHub when a vX.Y.Z tag is pushed. Locally: pnpm --filter @appsport/server test infra/release → Tests 10 passed. The owner must define the repository variable VITE_OWNER_FIRST_NAME (otherwise the image shows « l'administrateur », T28 fallback); the first real publish is checked during P3.\n- Reports never contain codes, links with a fragment, passwords or tokens.",
     "risks": "(a) A guard placed after build-push-action, or a guard step that prints but does not exit 1. (b) merge-base run without fetching origin/main (tag checkout), so every release is refused or the check silently passes. (c) gh api query wrong (workflow file, missing actions: read, status filter) → always refused or always accepted. (d) Extra pushed tags (:latest), other platforms, or build-args not exactly the two newline-separated lines. (e) The test checking the order with string contains instead of step indexes, so a reordered job still passes.",
     "dependsOn": [
      "41"
     ],
     "parallelOk": "Only .github/ files and one server test: can run alongside T37-T40 and T43 (T43 adds an infra job to ci.yml; T42 should leave ci.yml untouched, D7).",
     "repo": "C:\\Users\\eliott.colin\\appsport-infra",
     "branch": "socle-infra"
    }
   ]
  }
 ]
}

const MAX = ARGS.maxAgents || 5
let active = 0
const waiting = []
async function lim(prompt, opts) {
  while (active >= MAX) await new Promise(r => waiting.push(r))
  active++
  try { return await agent(prompt, opts) } finally { active--; const w = waiting.shift(); if (w) w() }
}

const WS = 'C:\\Users\\eliott.colin\\appsport\\.superpowers\\sdd\\2026-10-06-socle'
const PKG = 'bash C:/Users/eliott.colin/.claude/skills/subagent-driven-development/scripts/review-package docs/superpowers/plans/2026-10-06-socle.md'

const IMPL_SCHEMA = { type: 'object', properties: {
  status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
  head: { type: 'string', description: 'short SHA of HEAD after your commit(s)' },
  commits: { type: 'string' },
  tests: { type: 'string', description: 'one-line summary of RED/GREEN, lint, typecheck, full test results' },
  diffPath: { type: 'string', description: 'path printed by the review-package command' },
  concerns: { type: 'array', items: { type: 'string' } },
}, required: ['status', 'head', 'commits', 'tests', 'diffPath', 'concerns'] }
const FINDING = { type: 'object', properties: {
  severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
  file: { type: 'string' }, line: { type: 'string' },
  title: { type: 'string', description: 'one line' },
  problem: { type: 'string', description: 'what is wrong and the concrete failure scenario' },
  fix: { type: 'string' },
  specRef: { type: 'string', description: 'spec/plan/brief reference, or empty' },
}, required: ['severity', 'file', 'line', 'title', 'problem', 'fix', 'specRef'] }
const REVIEW_SCHEMA = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['approved', 'needs_fixes'] },
  findings: { type: 'array', items: FINDING },
  checks: { type: 'array', items: { type: 'string' } },
}, required: ['verdict', 'findings', 'checks'] }
const TRIAGE_SCHEMA = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
    lenses: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' }, line: { type: 'string' }, title: { type: 'string' },
    problem: { type: 'string' }, fix: { type: 'string' }, specRef: { type: 'string' },
    minorAction: { type: 'string', enum: ['fix_now', 'defer', 'n/a'] },
  }, required: ['id', 'severity', 'lenses', 'file', 'line', 'title', 'problem', 'fix', 'specRef', 'minorAction'] } },
}, required: ['findings'] }
const VERDICT_SCHEMA = { type: 'object', properties: {
  real: { type: 'boolean' },
  severity: { type: 'string', enum: ['Critical', 'Important', 'Minor', 'None'] },
  planConflict: { type: 'string', enum: ['none', 'spec_wins', 'product_choice'] },
  evidence: { type: 'string' },
}, required: ['real', 'severity', 'planConflict', 'evidence'] }
const FIX_SCHEMA = { type: 'object', properties: {
  head: { type: 'string' }, fixDiffPath: { type: 'string' }, tests: { type: 'string' },
  addressed: { type: 'array', items: { type: 'string' } },
  notAddressed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
}, required: ['head', 'fixDiffPath', 'tests', 'addressed', 'notAddressed'] }
const REREVIEW_SCHEMA = { type: 'object', properties: {
  results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, addressed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['id', 'addressed', 'evidence'] } },
  newBreakage: { type: 'array', items: FINDING },
}, required: ['results', 'newBreakage'] }

const LENS_TEXT = {
  spec: 'SPEC COMPLIANCE: compare the diff with the brief, the controller rulings and the spec rules the brief cites (grep the spec). Missing / Extra / Misunderstood requirements; values or texts that differ from the brief or the spec.',
  correctness: 'CORRECTNESS: bugs, edge cases, error handling, races and ordering, state machines, boundary values, interaction with code from earlier tasks. For every finding give a concrete input or state that produces the wrong result.',
  tests: 'TEST STRENGTH: would the new tests fail on plausible wrong implementations? Vacuous or tautological assertions, missing edge cases the brief lists, non-determinism (timers, randomness, ordering), tests passing for the wrong reason, noisy output. You may run focused tests but must NOT modify any file (no mutation edits); reason about mutations instead.',
  security: 'SECURITY AND PRIVACY: secrets, codes, tokens and passwords never logged, stored or returned beyond the brief; health (C2) data never written without consent and never leaked to logs, other users or the admin; user isolation (another user resource gives 404); CSRF, Origin and JSON rules; injection; sensitive data in client storage, URLs or browser history.',
  ux: 'UI, COPY AND ACCESSIBILITY: French texts exactly as the brief or spec fix them (straight apostrophe only), glossary vocabulary, labels associated to inputs, roles and accessible names the tests rely on, focus and keyboard use, offline states and the « Nécessite le réseau » message, no Dexie access from screens (only repos), no navigator.onLine, no inline script or dangerouslySetInnerHTML, no confusing transient screens or redirect flicker.',
  ops: 'OPERATIONS AND PORTABILITY: commands runnable on the Windows 11 dev machine (PowerShell or Git Bash, no Docker or Python) or explicitly CI/host-only with the expected output; bash strictness and portability; systemd, Docker and restic correctness; data safety on failure paths; idempotency of scripts; secrets in files and logs.',
}
const LENSES_BY_KIND = {
  server: ['spec', 'correctness', 'security', 'tests'],
  sync: ['spec', 'correctness', 'security', 'tests'],
  web: ['spec', 'correctness', 'ux', 'security', 'tests'],
  pwa: ['spec', 'correctness', 'ux', 'tests', 'ops'],
  infra: ['spec', 'correctness', 'ops', 'security', 'tests'],
  docs: ['spec', 'ops', 'tests'],
}


const EXPERT_BY_KIND = {
  web: "a senior React and TypeScript front-end engineer who ships accessible, offline-first PWAs",
  pwa: "a senior web platform engineer expert in service workers, Cache Storage, Vite builds and HTTP caching",
  server: "a senior Node.js back-end engineer expert in Hono, SQLite and secure session handling",
  sync: "a distributed-systems engineer expert in offline-first sync, idempotency and conflict handling",
  infra: "a senior DevOps and SRE engineer expert in Docker, systemd, restic, bash and GitHub Actions",
  docs: "a senior technical writer for operations runbooks and privacy registers",
}
const EXPERT_LENS = {
  spec: "a meticulous requirements analyst who checks every rule of the brief and the spec",
  correctness: "a principal engineer known for finding race conditions, ordering bugs and edge cases",
  tests: "a test architect who thinks in mutations and hunts vacuous assertions",
  security: "an application security and GDPR privacy specialist",
  ux: "a UX writer and WCAG accessibility specialist, native French speaker",
  ops: "a site reliability engineer for small self-hosted servers on Windows dev machines and Linux hosts",
}
const EXPERT_VERIFY = [
  "a skeptical debugger who reproduces failures by tracing the exact code path",
  "a code archaeologist who finds existing guards elsewhere in the codebase",
  "a spec lawyer who checks what the brief and the spec actually require",
]
const NICK_LENS = { spec: "Lynx", correctness: "Renard", ux: "Colibri", security: "Chouette", tests: "Pic", ops: "Marmotte" }
const you = s => "You are " + s + ". "

const PFIX_SCHEMA = { type: 'object', properties: {
  branch: { type: 'string' }, worktree: { type: 'string' }, head: { type: 'string' },
  tests: { type: 'string' }, notes: { type: 'string' },
  addressed: { type: 'array', items: { type: 'string' } },
  notAddressed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
}, required: ['branch', 'worktree', 'head', 'tests', 'notes', 'addressed', 'notAddressed'] }

// Split findings into groups that touch disjoint files, so parallel fixers rarely conflict.
function groupFindings(items, maxGroups) {
  if (items.length < 3) return [items]
  const filesOf = f => String(f.file || '').split(/[\s,;()]+/).map(x => x.replace(/:.*$/, '').replace(/^.*?(apps|packages|infra|docs|scripts)\//, '$1/')).filter(x => /\.[a-z]+$/i.test(x))
  let groups = []
  for (const f of items) {
    const fs = filesOf(f)
    const hit = groups.filter(g => fs.some(x => g.files.has(x)))
    const g = { files: new Set(fs), items: [f] }
    for (const h of hit) { h.files.forEach(x => g.files.add(x)); g.items.push(...h.items) }
    groups = groups.filter(x => !hit.includes(x)).concat([g])
  }
  while (groups.length > maxGroups) {
    groups.sort((a, b) => a.items.length - b.items.length)
    const a = groups.shift()
    a.files.forEach(x => groups[0].files.add(x)); groups[0].items.push(...a.items)
  }
  return groups.map(g => g.items)
}

async function runTask(A) {
  const EXP = EXPERT_BY_KIND[A.kind] || EXPERT_BY_KIND.server
  const REPO = A.repo || 'C:\\Users\\eliott.colin\\appsport'
  const BRANCH = A.branch || 'socle'
  const WHERE = A.repo
    ? ('IMPORTANT: you work ONLY in ' + REPO + ', a git worktree on branch ' + BRANCH + '. Wherever the rules files say C:\\Users\\eliott.colin\\appsport or branch socle, read ' + REPO + ' and branch ' + BRANCH + '. Never read, run commands in, or modify C:\\Users\\eliott.colin\\appsport (another team is working there); briefs, reports and rules files under .superpowers\\sdd of that repo are the only exception (read them; write only your report file).\n')
    : 'IMPORTANT: another team works in parallel in the separate worktree C:\\Users\\eliott.colin\\appsport-pwa (branch socle-pwa); never read, run commands in, or modify it.\n'
  const T = A.task
  const BRIEF = WS + '\\task-' + T + '-brief.md'
  const REPORT = WS + '\\task-' + T + '-report.md'
  const COMMON_IMPL = WS + '\\implementer-common.md'
  const COMMON_REV = WS + '\\reviewer-common.md'
  const GC = WS + '\\global-constraints.md'
  const SPEC = REPO + '\\docs\\superpowers\\specs\\2026-10-06-appsport-design.md and its sections in ' + REPO + '\\docs\\superpowers\\specs\\2026-10-06-appsport-design\\'
  const DETAILS = 'When an item carries detailsIn, read its full text (file, line, problem, fix, specRef) under the same id in that JSON file.'

  const implPrompt = you(EXP) + WHERE + 'You are implementing Task ' + T + ' (' + A.title + ') of appsport\'s socle, a private French strength-training PWA (pnpm TS monorepo), on branch ' + BRANCH + ' in ' + REPO + '.\n'
    + 'Context: ' + (A.context || '') + '\n'
    + '1. Read first: ' + COMMON_IMPL + ' (rules: mandatory separate RED run; check git show --stat HEAD before reporting; never dispatch subagents).\n'
    + '2. Your requirements, with exact values and texts to use verbatim: ' + BRIEF + '\n'
    + '3. Issue to close: #' + A.issue + '.\n'
    + '4. Write your full report to: ' + REPORT + '\n'
    + '5. Controller rulings (they win over the brief where they differ):\n' + A.rulings + '\n'
    + '6. After your final commit run `' + PKG + ' ' + A.base + ' HEAD` from ' + REPO + ' and return the path it prints as diffPath.\n'
    + 'Your final answer is the structured result.'
  const reviewPrompt = (lens, diffPath, head) => you(EXPERT_LENS[lens]) + WHERE + 'Review Task ' + T + ' (' + A.title + ') of appsport\'s socle through ONE lens only.\n'
    + 'Lens: ' + LENS_TEXT[lens] + '\n'
    + 'Rules: ' + COMMON_REV + ' (read-only: never modify files, git state or the working tree; never dispatch subagents).\n'
    + 'Inputs: brief ' + BRIEF + '; global constraints ' + GC + '; implementer report ' + REPORT + '; diff ' + diffPath + ' (base ' + A.base + ', head ' + head + '); spec ' + SPEC + '.\n'
    + 'Controller rulings already decided (do not report them as defects; do report code that does not follow them):\n' + A.rulings + '\n'
    + 'Named risks to examine with this lens where relevant:\n' + (A.risks || '(none)') + '\n'
    + 'Report only findings within your lens, each with file and line, a concrete failure scenario and a fix. Severity: Critical = data loss, security or privacy breach, or app unusable; Important = the task cannot be trusted (incorrect or fragile behaviour, missed requirement, test that asserts nothing); Minor = polish. Your final answer is the structured result.'
  const triagePrompt = all => you("an engineering lead") + 'You merge code-review findings for Task ' + T + ' of appsport\'s socle. Below are findings from several reviewers, each tagged with its lens (JSON). Merge duplicates (same root cause gives one finding; keep the highest severity; list all lenses), give each an id T' + T + '-F1, T' + T + '-F2, and so on, and keep file, line, problem and fix precise. For each Minor set minorAction to fix_now if it is cheap (under about 20 lines), low-risk and improves correctness, robustness or test strength for later tasks, else defer. Critical and Important get minorAction n/a. Do not invent findings. Do not read files; work only from this list.\nFindings:\n' + JSON.stringify(all)
  const verifyPrompt = (f, k, head) => {
    const angle = k === 0 ? 'Reproduce the failure: trace the exact code path at HEAD.'
      : k === 1 ? 'Look for an existing guard elsewhere (callers, server side, other modules, tests) that already prevents the failure.'
      : 'Check the brief and the spec: is the flagged behaviour actually required, allowed, or out of scope for this task?'
    return you(EXPERT_VERIFY[k]) + WHERE + 'Adversarially verify one code-review finding on appsport\'s socle (branch ' + BRANCH + ', ' + REPO + ', HEAD ' + head + '). Try hard to REFUTE it. ' + angle + ' Read-only: do not modify files or git state; never dispatch subagents.\n'
      + 'Finding ' + f.id + ' [' + f.severity + '] ' + f.file + ':' + f.line + ' - ' + f.title + '\n'
      + 'Problem: ' + f.problem + '\nProposed fix: ' + f.fix + '\nSpec ref: ' + f.specRef + '\n'
      + 'Brief: ' + BRIEF + '; spec: ' + SPEC + '.\nController rulings:\n' + A.rulings + '\n'
      + 'Answer real=true only if a concrete failure scenario exists at HEAD. If real, give the severity you would assign and planConflict: none if the fix does not contradict the brief; spec_wins if the brief mandates the defect but the spec supports the fix; product_choice if neither the brief nor the spec decides it and it is a product decision for the owner. If you cannot confirm a concrete failure, answer real=false. Your final answer is the structured result.'
  }
  const fixPrompt = (items, round, head) => you(EXP) + WHERE + 'Fix round ' + round + ' for Task ' + T + ' (' + A.title + ') of appsport\'s socle, branch ' + BRANCH + ', ' + REPO + ', current HEAD ' + head + '.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\nController rulings:\n' + A.rulings + '\n'
    + 'Fix each finding below in new commit(s) whose message ends with "Refs #' + A.issue + '" and the Co-Authored-By trailer. For each, write or adjust the covering test first and see it fail when that is meaningful (RED), then fix (GREEN). Run the covering tests, then pnpm lint, pnpm typecheck and pnpm test; check git show --stat HEAD and git status. Append a fix report (changes, tests, commands, output) to ' + REPORT + '. If a finding turns out to be wrong after checking the code and spec, do not apply it and explain why in notAddressed. Never dispatch subagents. ' + DETAILS + '\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\n'
    + 'After your final commit run `' + PKG + ' ' + head + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'
  const rereviewPrompt = (items, fixDiff, fromHead, head) => you("a senior reviewer who checks fixes precisely and spots regressions") + WHERE + 'Scoped re-review of a fix round for Task ' + T + ' of appsport\'s socle. Rules: ' + COMMON_REV + ', section "Scoped re-review rules" (read-only; never dispatch subagents). Inputs: brief ' + BRIEF + '; report ' + REPORT + ' (fix report at the end); fix diff ' + fixDiff + ' (' + fromHead + '..' + head + ').\n'
    + 'For each finding below, say whether the fix diff addresses it, with file:line evidence; when a covering test was needed, check it exists and would fail without the fix. Then list only NEW Critical or Important breakage introduced by the fix diff (Minor new issues may be listed with severity Minor). ' + DETAILS + ' Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'

  const fixWt = (round, k) => REPO.replace(/\\/g, '/') + '-fix-T' + T + '-r' + round + '-g' + k
  const fixBr = (round, k) => 'fix/T' + T + '-r' + round + '-g' + k
  const pfixPrompt = (items, k, n, round, head) => you(EXP) + WHERE
    + 'Exception to any rule above about where you work: you create and work in your OWN fix worktree ' + fixWt(round, k) + ' (branch ' + fixBr(round, k) + '), and nowhere else.\n'
    + 'Parallel fix group ' + k + ' of ' + n + ', round ' + round + ', for Task ' + T + ' (' + A.title + ') of appsport\'s socle. Other experts fix the other findings at the same time in their own worktrees: fix ONLY the findings below and touch as few files as possible.\n'
    + 'Setup, from ' + REPO + ': if ' + fixWt(round, k) + ' or branch ' + fixBr(round, k) + ' exists from an earlier attempt, remove it (`git worktree remove --force`, `git branch -D`). Then `git worktree add ' + fixWt(round, k) + ' -b ' + fixBr(round, k) + ' ' + head + '`, cd there for EVERY later command, and run `pnpm install --prefer-offline --frozen-lockfile`. Never modify ' + REPO + ' itself, its branch ' + BRANCH + ', or any other worktree.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\nController rulings:\n' + A.rulings + '\n'
    + 'For each finding, write or adjust the covering test first and see it fail when meaningful (RED), then fix (GREEN). Run the covering tests, pnpm lint, pnpm typecheck and the tests of the package(s) you touched. Commit on ' + fixBr(round, k) + ' with messages ending "Refs #' + A.issue + '" and the Co-Authored-By trailer. Leave the worktree in place (the integrator removes it). Do NOT write to the report file: put your fix notes (changes, tests, RED/GREEN evidence) in `notes`. Never dispatch subagents. ' + DETAILS + '\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'
  const integratePrompt = (parts, round, head) => you('a senior engineer who integrates parallel fix branches cleanly') + WHERE
    + 'Integrate the parallel fix branches of round ' + round + ' for Task ' + T + ' (' + A.title + ') into branch ' + BRANCH + ' in ' + REPO + ' (current HEAD ' + head + ').\n'
    + 'Branches, in order (JSON with each group\'s branch, worktree, findings and notes):\n' + JSON.stringify(parts) + '\n'
    + 'For each branch: `git cherry-pick ' + head + '..<branch>` (keep history linear, no merge commits). On a conflict, resolve it so that BOTH fixes keep working, and record how. Then run pnpm lint, pnpm typecheck and the full pnpm test; fix any integration breakage in a new commit ending "Refs #' + A.issue + '" with the Co-Authored-By trailer. Append ONE fix report for this round to ' + REPORT + ' (each group\'s changes and tests from its notes, the conflicts you resolved, the final command outputs). Then remove every fix worktree (`git worktree remove --force <path>`) and delete the fix branches. Check git status and git show --stat HEAD. Read ' + COMMON_IMPL + ' for the rules; never dispatch subagents.\n'
    + 'addressed = the finding ids the groups fixed that survive integration; notAddressed = the others with the reason. After your final commit run `' + PKG + ' ' + head + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'

  let head = A.head
  let diffPath = A.diffPath
  let impl = null
  if (!head) {
    impl = await lim(implPrompt, { phase: 'Implement', label: 'Castor · T' + T + ' implement', schema: IMPL_SCHEMA, model: A.implModel })
    if (!impl) return { task: T, stage: 'implement', error: 'implementer returned nothing' }
    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') return { task: T, stage: 'implement', impl }
    head = impl.head
    diffPath = impl.diffPath
    log('T' + T + ' implemented at ' + head + ': ' + impl.tests)
  }

  let reviews = []
  let confirmed = [], minorsNow = [], deferred = [], refuted = [], needsRuling = []
  if (A.preTriaged) {
    const P = A.preTriaged
    const tag = x => Object.assign({}, x, { detailsIn: P.file })
    confirmed = P.confirmed.map(tag)
    minorsNow = P.minorsNow.map(tag)
    deferred = P.deferred.map(tag)
    log('T' + T + ': resuming from the saved review (' + confirmed.length + ' confirmed, ' + minorsNow.length + ' minors to fix now)')
  } else {
    const lenses = A.lenses || LENSES_BY_KIND[A.kind] || LENSES_BY_KIND.server
    const reviewsRaw = await parallel(lenses.map(l => () =>
      lim(reviewPrompt(l, diffPath, head), { phase: 'Review', label: (NICK_LENS[l] || 'Relecteur') + ' · T' + T + ' review:' + l, schema: REVIEW_SCHEMA })
        .then(r => (r ? { lens: l, verdict: r.verdict, findings: r.findings, checks: r.checks } : null))))
    reviews = reviewsRaw.filter(Boolean)
    const raw = reviews.flatMap(r => r.findings.map(f => Object.assign({}, f, { lens: r.lens })))
    log('T' + T + ': ' + raw.length + ' raw findings from ' + reviews.length + '/' + lenses.length + ' reviewers')
    let merged = []
    if (raw.length) {
      const tri = await lim(triagePrompt(raw), { phase: 'Triage', label: 'Écureuil · T' + T + ' triage', schema: TRIAGE_SCHEMA, model: 'sonnet', effort: 'low' })
      merged = (tri && tri.findings) || raw.map((f, i) => Object.assign({}, f, { id: 'T' + T + '-F' + (i + 1), lenses: [f.lens], minorAction: f.severity === 'Minor' ? 'defer' : 'n/a' }))
    }
    const serious = merged.filter(f => f.severity !== 'Minor')
    minorsNow = merged.filter(f => f.severity === 'Minor' && f.minorAction === 'fix_now')
    deferred = merged.filter(f => f.severity === 'Minor' && f.minorAction !== 'fix_now')
    let verified = []
    if (serious.length) {
      verified = (await parallel(serious.map(f => () =>
        parallel([0, 1, 2].map(k => () =>
          lim(verifyPrompt(f, k, head), { phase: 'Verify', label: 'Corbeau ' + (k + 1) + ' · T' + T + ' verify ' + f.id + ' #' + (k + 1), schema: VERDICT_SCHEMA, effort: 'high' })))
          .then(vs => {
            const v = vs.filter(Boolean)
            const yes = v.filter(x => x.real)
            const product = yes.filter(x => x.planConflict === 'product_choice').length >= 2
            return Object.assign({}, f, { real: yes.length >= 2, product, votes: v.map(x => ({ real: x.real, severity: x.severity, planConflict: x.planConflict, evidence: x.evidence })) })
          })))).filter(Boolean)
    }
    confirmed = verified.filter(f => f.real && !f.product)
    needsRuling = verified.filter(f => f.real && f.product)
    refuted = verified.filter(f => !f.real)
    log('T' + T + ': ' + confirmed.length + ' confirmed, ' + refuted.length + ' refuted, ' + needsRuling.length + ' need a ruling, ' + minorsNow.length + ' minors to fix now, ' + deferred.length + ' deferred')
  }

  let open = confirmed.concat(minorsNow)
  const rounds = []
  let round = 0
  const maxRounds = A.maxRounds || 3
  while (open.length && round < maxRounds) {
    round++
    const groups = groupFindings(open, A.maxFixers || 4)
    let fix = null
    if (groups.length >= 2) {
      log('T' + T + ' round ' + round + ': ' + open.length + ' findings split across ' + groups.length + ' parallel fixers')
      const parts = (await parallel(groups.map((g, k) => () =>
        lim(pfixPrompt(g, k + 1, groups.length, round, head), { phase: 'Fix', label: 'Fourmi ' + (k + 1) + ' · T' + T + ' fix round ' + round, schema: PFIX_SCHEMA, model: A.implModel })
          .then(r => (r ? Object.assign({ group: k + 1, ids: g.map(f => f.id) }, r) : null))))).filter(Boolean)
      if (parts.length) fix = await lim(integratePrompt(parts, round, head), { phase: 'Fix', label: 'Castor · T' + T + ' integrate round ' + round, schema: FIX_SCHEMA, model: A.implModel })
    } else {
      fix = await lim(fixPrompt(open, round, head), { phase: 'Fix', label: 'Fourmi · T' + T + ' fix round ' + round, schema: FIX_SCHEMA, model: A.implModel })
    }
    if (!fix) { rounds.push({ round, error: 'fixer returned nothing' }); break }
    const fromHead = head
    head = fix.head
    const rr = await lim(rereviewPrompt(open, fix.fixDiffPath, fromHead, head), { phase: 'Re-review', label: 'Hibou · T' + T + ' re-review ' + round, schema: REREVIEW_SCHEMA })
    const stillOpen = rr ? open.filter(f => { const r = rr.results.find(x => x.id === f.id); return !r || !r.addressed }) : open
    const fresh = rr ? rr.newBreakage.filter(b => b.severity !== 'Minor').map((b, i) => Object.assign({}, b, { id: 'T' + T + '-R' + round + '-' + (i + 1), lenses: ['re-review'], minorAction: 'n/a' })) : []
    const refusedIds = new Set(fix.notAddressed.map(n => n.id))
    rounds.push({ round, from: fromHead, head, tests: fix.tests, notAddressed: fix.notAddressed, stillOpen: stillOpen.map(f => f.id), newBreakage: fresh.map(f => f.id + ' ' + f.title), newMinor: rr ? rr.newBreakage.filter(b => b.severity === 'Minor').map(b => b.title) : [] })
    open = stillOpen.filter(f => !refusedIds.has(f.id)).concat(fresh)
    log('T' + T + ' round ' + round + ': head ' + head + ', ' + open.length + ' still open')
  }

  return {
    task: T, base: A.base, head, implemented: impl,
    reviewers: reviews.map(r => ({ lens: r.lens, verdict: r.verdict, findings: r.findings.length })),
    confirmed: confirmed.map(f => ({ id: f.id, severity: f.severity, title: f.title, file: f.file })),
    minorsFixedNow: minorsNow.map(f => f.id + ' ' + f.title),
    deferred: deferred.map(f => f.id + ' ' + (f.file || '') + ': ' + f.title),
    refuted: refuted.map(f => f.id + ' ' + f.title),
    needsRuling: needsRuling.map(f => ({ id: f.id, title: f.title, problem: f.problem, fix: f.fix, votes: f.votes })),
    rounds,
    remainingOpen: open.map(f => ({ id: f.id, severity: f.severity, title: f.title })),
  }
}

async function runLane(L) {
  let head = L.startHead
  const results = []
  for (const t of L.tasks) {
    const A = Object.assign({}, t)
    if (L.repo) { A.repo = L.repo; A.branch = L.branch }
    if (!A.head) A.base = head
    log('Lane ' + L.lane + ': starting T' + A.task + (A.head ? ' (fixes on existing ' + A.head + ')' : ' from ' + head))
    const r = await runTask(A)
    results.push(r)
    if (!r || r.stage === 'implement') { log('Lane ' + L.lane + ': T' + A.task + ' stopped at implement'); break }
    head = r.head
    if (r.remainingOpen && r.remainingOpen.length) { log('Lane ' + L.lane + ': T' + A.task + ' still has open findings after the fix rounds; stopping the lane'); break }
    log('Lane ' + L.lane + ': T' + A.task + ' done at ' + head + ' (' + r.confirmed.length + ' confirmed fixed, ' + r.needsRuling.length + ' need a ruling, ' + r.deferred.length + ' deferred)')
  }
  return { lane: L.lane, head, results }
}

const lanes = await parallel(ARGS.lanes.map(L => () => runLane(L)))
return { lanes }
