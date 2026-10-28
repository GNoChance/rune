export const meta = {
  name: 'refonte-rune-g',
  description: 'Rune redesign continuation: T8-T9, T10, T12-T13 from explicit heads (WIP kept), merge 2, T15, T16, final review',
  whenToUse: 'Execute docs/superpowers/plans/2026-10-13-refonte-rune.md',
  phases: [
    { title: 'Implement', detail: 'implementer writes the task with TDD and commits' },
    { title: 'Review', detail: 'one reviewer per lens' },
    { title: 'Triage', detail: 'merge duplicate findings, classify minors' },
    { title: 'Verify', detail: '3 skeptics try to refute each Critical/Important finding' },
    { title: 'Fix', detail: 'fixers apply confirmed findings and cheap minors' },
    { title: 'Re-review', detail: 'scoped re-review of each fix diff' },
    { title: 'Merge', detail: 'integrate lane branches into socle' },
    { title: 'Final review', detail: 'whole-range review, one fix wave, one re-review' },
  ],
}

// Owner 2026-10-14: more agents. Readers (review, triage, verify) are light; agents that run test suites
// or browsers (implement, fix, integrate, merge, worktree setup) are heavy for a 16 GB laptop, so at most 3 of them.
const MAX = 8
const MAX_HEAVY = 3
const HEAVY = /implement|fix round|fix wave|integrate|merge|worktree/
let active = 0
let heavy = 0
const waiting = []
async function lim(prompt, opts) {
  const isHeavy = HEAVY.test((opts && opts.label) || '')
  while (active >= MAX || (isHeavy && heavy >= MAX_HEAVY)) await new Promise(r => waiting.push(r))
  active++
  if (isHeavy) heavy++
  try { return await agent(prompt, opts) } finally {
    active--
    if (isHeavy) heavy--
    waiting.splice(0).forEach(w => w())
  }
}

const ROOT = 'C:\\Users\\eliott.colin\\appsport'
const WS = ROOT + '\\.superpowers\\sdd\\2026-10-13-refonte-rune'
const PLAN = 'docs/superpowers/plans/2026-10-13-refonte-rune.md'
const PKG = 'bash C:/Users/eliott.colin/.claude/skills/subagent-driven-development/scripts/review-package ' + PLAN
const MQ = 'C:\\Users\\eliott.colin\\appsport-local\\maquettes\\project\\'
const START = '688e658'
const HOME = 'C:\\Users\\eliott.colin\\'
const LANES = {
  A: { repo: ROOT, branch: 'socle' },
  S: { repo: HOME + 'rune-coach', branch: 'socle-coach' },
  R: { repo: HOME + 'rune-revue', branch: 'socle-revue' },
  B: { repo: HOME + 'rune-ecrans', branch: 'socle-ecrans' },
  D: { repo: HOME + 'rune-dev', branch: 'socle-dev' },
  C: { repo: HOME + 'rune-profil', branch: 'socle-profil' },
}
const COMMON_IMPL = WS + '\\implementer-common.md'
const COMMON_REV = WS + '\\reviewer-common.md'
const GC = WS + '\\global-constraints.md'
const LEDGER = WS + '\\progress.md'
const PROJECT = 'Rune (formerly code-named appsport; Task 0 renames everything to rune) is a private French strength-training PWA for a small circle of relatives: pnpm TypeScript monorepo with apps/web (React 19, CSS Modules, wouter, Dexie, Vite 8, Vitest + Testing Library + happy-dom, Playwright E2E on Chromium and WebKit), apps/server (Hono, Kysely on node:sqlite, STRICT tables), packages/contracts (Zod, constants, entityRules), packages/domain. The socle (accounts, onboarding, profile, places and gyms, health consent, privacy, admin, sync, PWA, ops) is complete and reviewed; this plan gives it the Rune look and life, and finishes the final review, so one PR socle -> main is ready for production.'
const COMMON_RULINGS = '- The redesign spec docs/superpowers/specs/2026-10-13-refonte-rune-design.md is the binding authority over the brief for the front; the main spec docs/superpowers/specs/2026-10-06-appsport-design.md (and its folder) stays the authority elsewhere. Preflight rulings P1 to P14 are in ' + LEDGER + ' (section Rulings): the ones quoted below apply to this task.\n- Reports and commit messages never contain invitation or reset codes, links with a # fragment, passwords or tokens.\n- Never write « appsport » in a tracked file (from Task 0 on, apps/server/test/infra/name.test.ts fails on it); docs/superpowers and docs/research keep it as history.'

const TASKS = {
  '0': {"title":"Renommage complet appsport → rune","issue":65,"kind":"rename","lenses":["spec","correctness","ops","security","tests"],"mockups":"","context":"The owner decided on 2026-10-13 that nothing is called appsport any more (the GitHub repo is already GNoChance/rune, remote updated). Nothing is installed anywhere yet, so every identifier can change without migration or compatibility layer. This task runs alone before every other redesign task.","rulings":"- Exact names: the brief's Interfaces block (packages @rune/*, X-Rune-* headers, RUNE_* env vars, rune.db and .rune-volume, rune-export/1, rune-* scripts and units, /srv/rune, /opt/rune, compose project rune, image ghcr.io/gnochance/rune, bucket rune-backups, Tailscale machine rune and https://rune.<tailnet>.ts.net, repo https://github.com/GNoChance/rune, R-MDP-3 on « rune » with code contains_app_name, RESERVED_USERNAMES admin, rune, appsport, systeme).\n- Exception to implementer-common: this task edits every tracked file outside docs/superpowers/** and docs/research/** (which stay untouched as history), including docs/exploitation, docs/adr, docs/fiche-de-traitement.md, docs/incidents.md, README.md, data/LICENSE and .github/workflows. Rename files with git mv.\n- No backward compatibility: no fallback that reads old keys, headers, env vars or paths; no alias package.\n- Legal texts change only by appsport -> Rune (consent « que Rune enregistre », version 1.0 unchanged; health warning keeps « vous »).\n- Mass edits: select text files with git grep -l -i appsport (never binaries, never docs/superpowers or docs/research), handle every case variant (appsport, Appsport, APPSPORT), regenerate pnpm-lock.yaml with pnpm install (never hand-edit it). Shell safety: no Markdown inside double-quoted shell strings; prefer a small Node script file for the replacements.\n- Run pnpm lint, typecheck, test, pnpm test:infra (Git Bash), the whole E2E suite (Chromium and WebKit) and the production builds of web and server; all green. Docker image and shellcheck stay CI-only: say so.\n- Several commits are fine (packages, server and web identifiers, infra, docs); the last ends with Closes #65.","risks":"Reviewers: the diff is large and mechanical; check pairs with git grep instead of reading every hunk. (a) A renamed identifier whose writer and reader disagree (header renamed on the server but not the client, env var renamed in code but not in compose, Dockerfile, CI or host scripts, storage key renamed in one place) — only caught on the host. (b) Mass replace touching binaries, the lockfile by hand, or docs/superpowers and docs/research. (c) Host scripts, systemd units (ExecStart paths, unit names in timers), symlink instructions and bats stubs out of sync after git mv. (d) Case variants missed, or the name test with exclusions wider than the two exact exceptions. (e) Legal texts changed beyond the substitution, or the consent version bumped."},
  '1': { title: 'Jetons, thèmes et polices', issue: 49, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'],
    mockups: 'GUIDE.md (Tokens table, one level up from project), Carnet.dc.html, Main.dc.html, MixClair.dc.html, MixSombre.dc.html, Calme.dc.html',
    context: 'First task of the redesign: the token layer every later task builds on. Today apps/web/src/ui/ui.module.css and the feature CSS modules use --color-* variables.',
    rulings: '- Exact names and values: brief (ThemeChoice, THEME_CHOICES, readThemeChoice / writeThemeChoice / applyTheme / useThemeChoice, localStorage key rune.theme, theme-color #F1F3F7 clair and #070A12 sombre; for carnet and nuit use their --bg). CSS structure exactly as the brief: :root = clair; @media (prefers-color-scheme: dark) { :root:not([data-theme]) { sombre } }; :root[data-theme=clair|sombre|carnet|nuit]. A forced theme always beats the phone setting.\n- Every --color-* variable used anywhere in apps/web/src (ui and feature CSS modules) is mapped to the new tokens in this task, so every existing screen stays readable in all 5 themes before it is restyled (grep them all; none left undefined).\n- Fonts: Fontsource packages @fontsource/chakra-petch, @fontsource/barlow, @fontsource/newsreader at exact versions published at least two weeks ago (check with npm view <pkg> time); import only the latin subset files for the weights of the brief (e.g. the latin-600.css entry points), so only latin woff2 files are emitted and precached; font-display swap. No external URL.\n- applyTheme(readThemeChoice()) runs in main.tsx before createRoot (no inline script in index.html: CSP). Auto relies on the CSS media query only (no JS listener needed for colours); applyTheme also updates meta theme-color (for auto: follow matchMedia at call time and on change).\n- contrast.test.ts must fail if a theme block or one of the checked tokens is missing (assert the 5 blocks were found), not pass vacuously.',
    risks: '(a) Forced theme vs phone dark mode: dark tokens leaking into a forced light theme, or a component reading prefers-color-scheme directly. (b) Old --color-* variables left undefined in some feature CSS (invisible text, transparent buttons). (c) Fonts not precached, full unicode ranges shipped, or an external URL. (d) The contrast test parsing CSS loosely and passing vacuously. (e) localStorage throwing (private mode) breaking boot.' },
  '2': { title: 'Marque Rune, icônes et logo', issue: 50, kind: 'web', lenses: ['spec', 'correctness', 'design', 'tests'],
    mockups: 'MixSombre.dc.html, MixClair.dc.html, A01-Connexion-Sombre.dc.html (logo and wordmark use); art in docs/brand/',
    context: 'Rename the visible app to Rune and ship the « Rang brisé » logo and the PWA icons. T1 delivered the tokens (apps/web/src/ui/theme/).',
    rulings: "- Task 0 already renamed every text and identifier; this task only adds the logo components, the PWA icons and the manifest values of the brief.\n- render-icons.mjs uses the Playwright Chromium already installed for E2E and reads docs/brand/rune-icon.svg; maskable 512 has 10 % padding on #070A12; manifest icons keep their purpose fields; run it and commit the PNGs.\n- RuneMark is inline SVG with currentColor (no dangerouslySetInnerHTML), ids prefixed per instance (useId sanitised to [A-Za-z0-9_-]) when glow adds gradients.",
    risks: "(a) Icons with wrong sizes, a cropped maskable icon, or a missing purpose. (b) Duplicate SVG ids when several marks render. (c) The manifest test not updated. (d) The logo not following the theme (currentColor) or failing contrast. (e) A script path outside the repo." },
  '3': { title: 'Composants de base', issue: 51, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'],
    mockups: 'GUIDE.md (Components), MixSombre.dc.html, MixClair.dc.html, B01-Objectif-Sombre.dc.html, B06-Disponibilite-Clair.dc.html, C01-ProfilHub-Sombre.dc.html',
    context: 'The base toolkit in apps/web/src/ui/ used by every screen task. T1 delivered tokens and themes, T2 the logo.',
    rulings: '- Signatures exactly as the brief. ChoiceList keeps its current signature and becomes an adapter over ChoiceCard: every existing screen keeps its roles and accessible names (run the whole web suite).\n- Real inputs: ChoiceCard and Chips are native input + label; Switch is a button or input with role=switch and aria-checked, toggled by Space and Enter. Selection is never shown by colour only (coche).\n- Buttons 52 px high and full width on phone when block; targets at least 44 px; fields 16 px text; focus visible with --focus. Tokens only, no hard-coded colours.\n- Tests assert roles, names and states, not class names (the 44 px check may read the CSS module rule).',
    risks: '(a) Existing screens losing roles or names through the ChoiceList adapter. (b) Switch not keyboard operable or aria-checked stale. (c) Field aria-describedby overwriting an existing help id instead of joining ids. (d) Selection shown by colour only. (e) Tests coupled to styling.' },
  '4': { title: 'Feuilles du bas, Système, coach, rangs, art et mouvement', issue: 52, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'security', 'tests'],
    mockups: 'F01-Skald-Embleme.dc.html, F02-Skald-Personnage.dc.html, F03-Skald-Systeme.dc.html, G03-Rangs-Pierre.dc.html, C06-Deconnexion-Sombre.dc.html (sheet), B08-Pret-Sombre.dc.html (Système window); prototype C:\\Users\\eliott.colin\\appsport-local\\prototype\\src.html (idle animations)',
    context: 'Sheets, the Système window, coach bubbles and avatars, rank stones, motion. T1 to T3 delivered tokens, logo and base components. Coach ids: the server task T6 runs in parallel on another branch; declare CoachId locally in apps/web/src/ui/art/coach-id.ts as the brief says (the merge will swap it for the contracts import, ruling P3).',
    rulings: '- Ruling P13: first copy the source SVGs into the repo (docs/brand/coachs/{ombre,skald,scribe}/ and docs/brand/rangs/ with mini/), then svg-to-tsx.mjs reads only from there (no path outside the repo in any script).\n- Ruling P4: svg-to-tsx.mjs never emits style elements or style strings (React style objects only), no event attributes, no dangerouslySetInnerHTML; add a test that the generated art contains no style element. Sources: Ombre = skald\\systeme, Skald = skald\\personnage, Scribe = skald\\embleme (each with -light and -nutrition variants), ranks rangs\\pierre\\rank-*.svg and mini\\.\n- idPrefix from useId() sanitised to [A-Za-z0-9_-] (React ids contain colons, which break url(#…) references); two avatars on a page never share an id.\n- Idle animations (breathing, blink, visor) live in CSS modules using motion.css variables, are neutralised under prefers-reduced-motion, and never hide content: an element animated in from opacity 0 must be visible when animations are disabled.\n- Dialog keeps its API; on phone it renders a BottomSheet, on wide screens it may stay centred. BottomSheet: handle, dimmed backdrop, focus trapped, Escape closes, focus returns to the trigger, background inert through the existing inert-outside.ts, inert removed on close and on unmount.\n- RankBadge role=img with aria-label « Rang X »; locked variant visible but muted.',
    risks: '(a) Duplicate SVG ids across instances (wrong gradients). (b) Generated art with style elements or attributes blocked by the CSP. (c) inert left on the app after close or unmount (whole app dead), or focus trap leaking. (d) Reduced motion: content left at opacity 0 or delayed. (e) Existing dialog tests broken by the Dialog change.' },
  '5': { title: 'Coquille, navigation et état de connexion', issue: 53, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'],
    mockups: 'MixSombre.dc.html, MixClair.dc.html, ProgressionSombre.dc.html (tab bar), E06-MiseAJour-Sombre.dc.html (update banner position)',
    context: 'The app shell: header, floating tab bar, side navigation, connection pill, boot splash, screen transitions. T1 to T4 delivered tokens, logo, components, sheets and motion.',
    rulings: '- Ruling P5: create apps/web/src/features/progression/ProgressionPage.tsx as a minimal page (heading « Progression », no data); T9 replaces it.\n- Ruling P6: every place route moves under /places (list, detail, add, home place…), and any /profile/places… URL redirects to the same path under /places (no redirect loop); update E2E URLs and selectors accordingly.\n- TAB_ITEMS exactly as the brief; aria-current=page by URL prefix (/places/… -> Salles, /profile/… -> Profil, / only for exact home); the Administration tab disappears (admin is reached from Profil, T10 adds the row; until then keep /admin routes working).\n- ConnectionPill reads useSyncState().connection, the same source as the « Nécessite le réseau » screens; offline -> « Hors ligne », never « En ligne ». Header counters removed (they move to Réglages in T10; keep the data source).\n- UpdateBanner sits under the header and keeps its rules (never during onboarding or an active session).\n- BootSplash never blocks interaction (pointer-events none, removed after its animation) and renders nothing under reduced motion.\n- Navigation changed for many E2E specs: run the whole suite pnpm --filter @rune/web test:e2e (Chromium and WebKit) and make it green.',
    risks: '(a) aria-current wrong for nested routes or two tabs current. (b) The pill disagreeing with screens (navigator.onLine or a second source). (c) BootSplash covering content or never removed. (d) Redirect loops between /profile/places and /places. (e) Tab bar covering the bottom of pages (safe-area padding) or breaking focus order.' },
  '6': { title: 'Coach du profil (contrats, migration, API, dépôt web)', issue: 54, kind: 'server', lenses: ['spec', 'correctness', 'security', 'tests'],
    mockups: '',
    context: 'Lane S: the only new server data of the redesign, training_profile.coach. You start from socle right after Task 0 (everything already renamed to rune; before the front tasks). The front (T4, T7) will consume COACH_IDS, CoachId and repos.profile.setCoach.',
    rulings: '- Ruling P7: complete now refuses without a coach, so update every existing server test and helper that completes onboarding (apps/server/test/profile/onboarding-complete.test.ts, apps/server/test/support/onboarding.ts, others found by grep) to set a coach first, and add the refusal test. Web unit tests that mock the API keep passing. E2E onboarding flows will be fixed by T7 (do not edit apps/web/e2e).\n- Ruling P8: coach follows exactly the path of the other training_profile columns (GET and PATCH /api/training-profile, the profile in /api/auth/me if it is there, the JSON export, deletion with the account). training_profile is syncClass E (online API, not pulled): replace the brief\'s « pull de synchro renvoie coach » assertion by « another user cannot read or patch it (404) and the sync pull does not carry training_profile, as before ».\n- Migration 0002_coach: breaking false, ALTER TABLE training_profile ADD COLUMN coach TEXT CHECK (coach IN (\'ombre\',\'skald\',\'scribe\')), inside the migration transaction; an existing 0001 database migrates without loss (test with rows). Server ONBOARDING_STEPS unchanged. completeOnboarding raises httpError(\'validation\', { field: \'coach\' }) before any write when coach is null. entityRules training_profile.columns gains coach (C1); the schema test and the column-leak tests stay green. coach never appears in /api/admin/* responses.\n- Web repo: expose coach on the training profile hook and setCoach(coach: CoachId): Promise<void> through the existing API client (class E: offline -> the existing « Nécessite le réseau » error path).',
    risks: '(a) Migration flagged breaking, not transactional, or losing rows. (b) PATCH accepting null, unknown values, or another user\'s profile. (c) The complete check after a side effect (partial completion). (d) coach leaking to admin routes or other users. (e) Existing onboarding tests edited in a way that hides a regression.' },
  '7': { title: 'Choix du coach, présentation et textes des coachs', issue: 55, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'],
    mockups: 'B01-Objectif-Sombre.dc.html, B01-Objectif-Clair.dc.html (layout); prototype C:\\Users\\eliott.colin\\appsport-local\\prototype\\src.html, screens « coach » and « intro » (behaviour)',
    context: 'Onboarding step 1 of 9 « Choisis ton coach » and the presentation bubble. Available: tokens, toolkit (ChoiceCard, SegmentedProgress, Button), CoachAvatar, CoachBubble, BottomSheet, motion (T1-T5); COACH_IDS, CoachId and repos.profile.setCoach from T6 (merged).',
    rulings: '- Coach texts verbatim from the brief\'s table (straight apostrophes, {pseudo} and {jours} replaced). coachLine daily index = Paris civil day number (days since 1970-01-01 in Europe/Paris) modulo daily.length; never UTC.\n- Presentation: the bubble may reveal its text progressively, but the full text is in the accessible tree from the start (the animated copy is aria-hidden), there is never a typing indicator, and under reduced motion the full text and « C\'est parti » show at once. Label « Message d\'accueil ». The nutrition demo switches once to mode nutrition with the nutri line, then back; an « Entraînement / Nutrition » switch replays it.\n- setCoach failure (offline or server error) keeps the user on the step with the error shown; the flow never advances without a stored coach.\n- Resume: profile coach null -> coach step first, then the saved onboardingStep; coach set -> unchanged resume. Numbering « Étape n sur 9 » for every step (update existing tests).\n- Ruling P7: update the E2E helpers (apps/web/e2e/support/flows.ts) so onboarding chooses a coach, and run the onboarding E2E specs (Chromium and WebKit) green.\n- Ruling P15 (from T6-F2, confirmed by the verifiers and handed to this task): apps/web/e2e/epoch.spec.ts completes onboarding through raw API calls (createAdminViaApi: PATCH /api/me/training-profile without coach, then POST /api/me/onboarding/complete expecting 200), so it fails since T6. Add coach (e.g. \'skald\') to that PATCH, and grep apps/web/e2e for any other direct call to /api/me/onboarding/complete or training-profile PATCH without coach and fix them the same way. Then run the WHOLE E2E suite (Chromium and WebKit): from this task on, it must be green.',
    risks: '(a) Resume logic wrong for old accounts (coach null with a saved step). (b) Animated text hidden from screen readers or delaying the button under reduced motion. (c) setCoach failure ignored, complete failing at the end. (d) Daily line computed in UTC. (e) Texts drifting from the table or containing a number followed by kcal, g, kg or %.' },
  '8': { title: 'Onboarding rhabillé et « Éveil terminé »', issue: 56, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'],
    mockups: 'B01 to B08 (Clair and Sombre) .dc.html; prototype src.html, screen « Éveil terminé »',
    context: 'Restyle the 8 other onboarding steps and the ready screen as the « Éveil terminé » celebration. T7 delivered the coach step, COACHES and coachLine.',
    rulings: '- Health step: legal texts verbatim, no Système voice, HealthWarning style only (keeps « vous »).\n- « Suivant » -> « Continuer » everywhere in onboarding, tests and E2E.\n- Quêtes d\'éveil reflect real states only (profile completed, main place chosen, offline-ready from the existing offline-ready source); not reached -> unchecked and 2/3.\n- Celebration timing 600 to 1200 ms with the single curve; under reduced motion everything including « Commencer » is present on first render.\n- Ruling P9: add apps/web/e2e/coach-onboarding.spec.ts: choose a coach -> presentation -> the 8 other steps -> « Éveil terminé » -> « Commencer » lands on the home. Run the whole E2E suite (Chromium and WebKit) green; wait on roles and states, never on fixed sleeps.',
    risks: '(a) Legal texts altered. (b) Quests shown done when they are not. (c) « Commencer » delayed or hidden under reduced motion. (d) Place step search and « Créer une salle » regressions. (e) E2E flakiness from animations.' },
  '9': { title: 'Accueil et Progression', issue: 57, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'],
    mockups: 'MixSombre.dc.html, MixClair.dc.html, ProgressionSombre.dc.html, ProgressionClair.dc.html',
    context: 'Home with the coach bubble, quests and tiles; the Progression teaser tab (T5 created a placeholder ProgressionPage you replace).',
    rulings: '- Greeting by Europe/Paris hour: « Bonjour, {pseudo} » from 05:00 to 17:59, « Bonsoir, {pseudo} » otherwise (inject the clock in tests).\n- No fake data: counters 0, « Rang E », « 0 / 100 XP », 9 RankBadge « Rang E » with MUSCLE_GROUPS_LABELS; Système window text verbatim « Aucune séance gravée. Ta première séance débloque tes rangs. ». CountUp shows the final value immediately under reduced motion.\n- Existing home banners (18 ans, yearly password reminder, anything else the current home shows conditionally) keep their conditions and texts.',
    risks: '(a) Paris time computed with the device timezone. (b) Quests shown done when not. (c) An existing conditional banner lost. (d) Values delayed by CountUp. (e) The teaser implying real data.' },
  '10': { title: 'Espace Profil, réglages, coach, santé, confidentialité, déconnexion', issue: 58, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'security', 'tests'],
    mockups: 'C01 to C06 (Clair and Sombre) .dc.html',
    context: 'The Profile hub replaces « Plus »; Mon coach, appearance, sync counters, health consent withdrawal moved to Santé, privacy, logout sheet.',
    rulings: '- Hub groups and rows exactly as the spec §5 (Entraînement: Mon profil, Mon coach, Mes lieux -> /places, Santé; Compte et appli: Confidentialité et données, Réglages with a badge when sync refusals exist, Aide; Cercle: Administration for admins only; « Se déconnecter » apart at the bottom).\n- Routes: /profile hub, /profile/edit Mon profil, /profile/coach; keep existing deep links (/profile/health and others) working.\n- Mon coach shows both avatars (training and nutrition), says the real conversation comes later, « Changer de coach » opens a BottomSheet with the 3 choices; confirming calls setCoach; failure keeps the sheet with the error.\n- Réglages › Apparence: 5 radios (Auto checked by default) with a preview; choosing writes and applies immediately (writeThemeChoice + applyTheme). Réglages › Synchronisation: connection, pending, refused, storage (moved from the old header).\n- Health withdrawal moves to Santé with its texts, confirmations and password re-entry unchanged; Confidentialité shows the consent state with a link to Santé, keeps export, account deletion isolated at the bottom.\n- Logout: one row; the sheet offers « Cet appareil » and « Tous mes appareils »; the unsent-data warning stays. Mon profil hides password fields until « Changer le mot de passe »; cautious mode only in Mon profil.',
    risks: '(a) Withdrawal flow changed while moving (confirmation, re-auth P-AUT-5, texts). (b) Logout defaulting to all devices or losing the unsent-data warning. (c) Admin row visible to a non-admin. (d) Theme choice not persisted or not applied. (e) Existing tests deleted instead of updated.' },
  '11': { title: 'Salles et lieux', issue: 59, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'],
    mockups: 'D01 to D05 (Clair and Sombre) .dc.html',
    context: 'Lane B (worktree): places and gyms. T5 moved place routes under /places.',
    rulings: '- Equipment edits are a draft: nothing is sent until « Enregistrer »; leaving the sheet sends nothing and the server state shows again on return; « Annuler » resets. Save sends exactly the added and removed calls; on a failure (offline, server error, partial success) the draft stays, the error shows, and the server state is re-read so the screen never lies.\n- EQUIPMENT_SHORT_LABELS is a Record over every EquipmentCode (type-checked exhaustive): label up to the parenthesis, except « Barre guidée (Smith) » kept whole and any other hand-written exceptions the brief allows.\n- Touching a gym in Mes lieux opens its sheet directly; « Qui va à cette salle » carries the user\'s own visibility switch (same API and semantics as today); actions (lieu principal, supprimer) at the bottom; the « Lieu principal » switch is disabled and checked on the current main place.',
    risks: '(a) Abandoned draft sending calls or losing server state. (b) Partial save failure leaving the screen inconsistent with the server. (c) Short labels missing a code. (d) Visibility semantics changed. (e) Offline handling of the save.' },
  '12': { title: 'Administration', issue: 60, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'security', 'tests'],
    mockups: 'E01 to E05 (Clair and Sombre) .dc.html',
    context: 'Lane B (worktree): admin screens as cards, actions in a sheet.',
    rulings: '- One article card per member with role, status and consent badges and relative last login (Europe/Paris, injected clock); « Actions pour <pseudo> » opens a BottomSheet; « Désactiver » and « Supprimer le compte » in a group « Actions sensibles » placed last, each keeping its existing confirmation; a disabled member keeps « Réactiver ».\n- Sub-navigation « Membres · Invitations · Salles · Serveur ». Invitations: the code shows only at creation and is never shown again or kept in the page state after leaving.\n- État du serveur: badges per section and « Dernier contrôle de l\'hôte »; a failed deploy (deploy section ok false, written by the ops scripts) is shown as a failure with the version.\n- No C1 to C3 field of another member is displayed (admin API returns none; do not add any).',
    risks: '(a) Personal data of others displayed. (b) A destructive action without confirmation or placed next to a primary. (c) Invitation code persisted or re-shown. (d) Relative time computed in the wrong timezone. (e) Roles and names lost in tests.' },
  '13': { title: 'Accès, pages publiques, 404, hors ligne et mise à jour', issue: 61, kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'security', 'tests'],
    mockups: 'A01 to A06 and E06 (Clair and Sombre) .dc.html',
    context: 'Lane B (worktree): login, invitation, account creation, reset, help, credits, privacy page, 404, offline and the update banner.',
    rulings: '- Ruling P10: Aide shows the Crédits section; /credits stays reachable (it may render the same content).\n- Aide order: emergency box (15, 112) first, then « Installer Rune » (install-help.ts content), then useful numbers, then Crédits. Help, Privacy and Credits stay readable offline.\n- 404: « Page introuvable » and « Zone inconnue. » with a link to the home. Slogan « Grave ta progression. ». Password errors attached to their field (aria-describedby).\n- Update banner: the forced variant (426) has no « Plus tard »; banner rules unchanged (never during onboarding or a session).\n- Auth flows keep their behaviour, routes and limits (code entry tolerant input, reset); only look and texts per the mockups.',
    risks: '(a) Auth flows broken (code entry, reset, create account). (b) Emergency numbers wrong or moved below the fold. (c) Update banner showing during onboarding or a session, or « Plus tard » in the 426 variant. (d) Errors not associated with fields. (e) Public pages not readable offline.' },
  '14': { title: 'Décisions de confidentialité et déploiements ratés', issue: 62, kind: 'infra', lenses: ['spec', 'correctness', 'ops', 'security', 'tests'],
    mockups: '',
    context: 'Lane R (worktree from the Task 0 head): final socle review points decided by the owner on 2026-10-12 and 2026-10-13 (spec §11.1, §11.6; the rune address of §11.2 was done by Task 0). Docs: docs/fiche-de-traitement.md, docs/exploitation/P9-admin-indisponible.md, checked by apps/server/test/infra/docs.test.ts. Host scripts infra/host/* with bats tests (pnpm test:infra from Git Bash).',
    rulings: '- Exception to implementer-common: this task may edit docs/fiche-de-traitement.md, docs/exploitation/*, infra/RUNBOOK-reconstruction.md (never docs/superpowers, docs/research, docs/adr).\n- T45-F32: the processing record and the Privacy page (apps/web/src/features/public/privacy-content.ts) say that a sealed rescue envelope (enveloppe de secours) exists (the test looks for « copie scellée »); any visible text you add says « Rune », never appsport (ruling P1).\n- T45-F42: P9 deletes the B2 and local backups after a last export for each member (export first, confirmed, then deletion).\n- T45-F51: admin:reset on a disabled admin reactivates it and gives the reset link; a non-admin or deleted account is refused as today; CLI test.\n- T43-F14 (owner default yes): in infra/host/rune-update, pull-failed and backup-failed also write .deploy in status.json with ok false and the version still running, through the existing status_merge; bats tests; shellcheck clean.\n- Shell safety: edit Markdown with the file tools only; never run a procedure command (reboot, mount, cryptsetup, systemctl, docker, restic) on this PC.',
    risks: '(a) admin:reset reactivating a non-admin or deleted account. (b) .deploy written with the new version, or ok true, on a failed pull or backup. (c) docs assertions passing vacuously (global indexOf). (d) P9 deleting backups before the exports are done. (e) A real tailnet name, secret or personal name in docs.' },
  '15': { title: 'Points reportés, tests instables et journaux de CI', issue: 63, kind: 'web', lenses: ['spec', 'correctness', 'security', 'tests'],
    mockups: '',
    context: 'After the screens are merged: sweep the deferred minors of the socle (T30 to T45), make flaky tests deterministic, mask invitation links in E2E logs and traces (T38-F3).',
    rulings: '- Ruling P11: read the socle ledger C:\\Users\\eliott.colin\\appsport\\.superpowers\\sdd\\2026-10-06-socle\\progress.md read-only (deferred lines, new minors, deferred observations from T30 to T45) and write the sweep to docs/superpowers/plans/2026-10-13-refonte-rune-points-reportes.md (exception to « do not touch docs/ » for that one file), each point marked « corrigé » (with its test), « rendu caduc par la refonte » (say which change) or « fermé : <raison> ».\n- Flaky tests (profile-page, withdraw, places-page): deterministic by awaiting the liveQuery results explicitly, never by longer timeouts; the web suite passes 5 times in a row.\n- T38-F3: the E2E harness masks invitation and reset codes and links with a # fragment in its logs, test titles, console capture and attachments; a harness test proves it.\n- Each fix is minimal and does not change redesign behaviour.',
    risks: '(a) A « fix » changing behaviour beyond the minor. (b) Flaky tests hidden by timeouts or retries. (c) Masking missing a code format (dashes, lowercase, spaces). (d) Points closed without a reason. (e) Redesign screens broken by a sweep fix.' },
  '16': { title: 'Vérification complète et captures de relecture', issue: 64, kind: 'ops', lenses: ['spec', 'ops', 'tests'],
    mockups: 'all screens in the mockup folder (for the owner\'s comparison)',
    context: 'Close the plan: full suites, review screenshots for the owner, bundle size check.',
    rulings: '- screenshots.mjs starts a throwaway demo server (own temp data dir, free port, created with the server CLI like the E2E harness), seeds a demo admin and member with neutral demo names, walks every screen in light and dark at 390 x 844, writes PNGs outside the repo (folder given by --out, default a new folder under os.tmpdir() printed at the end; ruling P13: no path outside the repo hard-coded), and always stops the server and deletes its data. No real code or link appears in a screenshot or log.\n- Ruling P12: measure the initial bundle baseline by building the Task 0 head (recorded in the ledger) in a throwaway worktree (removed afterwards); report before and after gzip sizes of dist/assets/index-*.js, excluding fonts; increase at most 25 %.\n- Run pnpm lint, typecheck, test, pnpm test:infra (Git Bash) and the whole E2E suite (Chromium and WebKit); all green.',
    risks: '(a) The script leaving server processes or data behind. (b) Screenshots exposing codes. (c) Bundle measured on the wrong files. (d) A suite claimed but not run. (e) Screens missing from the capture list.' },
  'D': { title: 'Commande pnpm dev', issue: 68, kind: 'ops', lenses: ['spec', 'correctness', 'ops', 'security', 'tests'],
    mockups: '',
    context: 'Lane D (worktree ' + HOME + 'rune-dev, branch socle-dev, from 06aaa56): the owner asked on 2026-10-14 for one command that starts everything locally with auto reload. Today the README asks for a web build, six env vars and three manual server commands. apps/web/vite.config.ts already proxies /api and /illustrations to http://localhost:3000 and expects APP_ORIGIN=http://localhost:5173. Not part of the redesign plan file: the brief is the only requirement source, there is no plan section and no spec section for it.',
    rulings: '- Exception to implementer-common: this task may edit README.md (section « Lancer Rune en local ») and the root package.json; it never touches the front screens, the redesign files or docs/superpowers.\n- The invitation link of admin:bootstrap is printed to the console only; it never appears in a file, the report, a test snapshot or a commit message.\n- No shell: true and no command string built for a shell; Windows .cmd shims resolved explicitly. Children are always stopped (Ctrl+C, error of the other child, test teardown); a test that spawns processes kills the whole tree and removes its temp dir even on failure.\n- Real run required before reporting (brief item 10), on a temp data dir, with the result in the report.',
    risks: '(a) Orphan node processes or ports left busy after Ctrl+C or a crash on Windows. (b) The bootstrap link written to disk or logs, or bootstrap run twice. (c) Dev data written inside the repo or into the owner\'s ~/rune-data used by the production-like procedure. (d) A flaky integration test that spawns servers. (e) README instructions that do not match the script.' },
}

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
const PFIX_SCHEMA = { type: 'object', properties: {
  branch: { type: 'string' }, worktree: { type: 'string' }, head: { type: 'string' },
  tests: { type: 'string' }, notes: { type: 'string' },
  addressed: { type: 'array', items: { type: 'string' } },
  notAddressed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
}, required: ['branch', 'worktree', 'head', 'tests', 'notes', 'addressed', 'notAddressed'] }
const MERGE_SCHEMA = { type: 'object', properties: {
  ok: { type: 'boolean', description: 'true when merged and every required suite is green' },
  head: { type: 'string' }, tests: { type: 'string' },
  conflicts: { type: 'array', items: { type: 'string' } },
  notes: { type: 'string' },
}, required: ['ok', 'head', 'tests', 'conflicts', 'notes'] }

const LENS_TEXT = {
  spec: 'SPEC COMPLIANCE: compare the diff with the brief, the controller rulings and the redesign spec (and the main spec rules it relies on). Missing / Extra / Misunderstood requirements; values or texts that differ from the brief or the spec; legal texts changed beyond appsport -> Rune.',
  correctness: 'CORRECTNESS: bugs, edge cases, error and offline handling, races and ordering, state across navigation, boundary values, interaction with code from earlier tasks. For every finding give a concrete input or state that produces the wrong result.',
  tests: 'TEST STRENGTH: would the new tests fail on plausible wrong implementations? Vacuous or tautological assertions, assertions on styling instead of behaviour, missing edge cases the brief lists, non-determinism (timers, animations, liveQuery, ordering), tests passing for the wrong reason, noisy output. You may run focused tests but must NOT modify any file; reason about mutations instead.',
  security: 'SECURITY AND PRIVACY: CSP (no inline script, no style elements, no dangerouslySetInnerHTML, no external resource), secrets, codes, tokens and passwords never logged, stored or shown beyond the brief; health (C2) and personal (C1) data never leaked to other users, the admin, logs or URLs; user isolation (404 for others); destructive actions confirmed.',
  ux: 'UI, COPY AND ACCESSIBILITY: French texts exactly as the brief or spec fix them (straight apostrophe, tutoiement, legal texts verbatim except appsport -> Rune), labels tied to inputs, roles and accessible names kept, focus order and visible focus, keyboard use (sheets: Escape, focus trap and return), screen-reader output of animated content, 44 px targets, offline states and « Nécessite le réseau », no Dexie access from screens, no navigator.onLine.',
  design: 'VISUAL DESIGN AND MOTION: compare with the mockups named for this task (read their HTML source) and GUIDE.md: tokens only (no hard-coded colours or fonts outside tokens.css), coherent in all 5 themes (a forced theme beats the phone dark mode; Carnet lines and Salle de nuit HUD corners), 52 px buttons, 44 px targets, 16 px fields, spacing and hierarchy as in the mockup, a dangerous action isolated at the bottom, motion durations (150-250 / 300-450 / 600-1200 ms) with the single curve cubic-bezier(.2,.8,.2,1), nothing hidden or delayed under prefers-reduced-motion, no fake data, Système voice only at key moments (never on the health screen).',
  ops: 'OPERATIONS AND PORTABILITY: commands runnable on the Windows 11 dev machine (PowerShell or Git Bash, no Docker or Python) or explicitly CI/host-only; bash strictness; data safety on failure paths; documents matching the shipped scripts and CLI; secrets in files and logs; scripts that clean up after themselves.',
}
const EXPERT_BY_KIND = {
  rename: 'a senior full-stack TypeScript and DevOps engineer expert in large, safe mechanical renames across monorepos, bash host scripts and CI',
  web: 'a senior React and TypeScript front-end engineer and design-systems specialist who ships accessible, animated, offline-first PWAs',
  server: 'a senior Node.js back-end engineer expert in Hono, SQLite migrations and privacy-by-design APIs',
  infra: 'a senior DevOps engineer and technical writer expert in bash, bats, small self-hosted servers and GDPR processing records',
  ops: 'a senior build and release engineer expert in Vite, Playwright and CI',
}
const EXPERT_LENS = {
  spec: 'a meticulous requirements analyst who checks every rule of the brief and the spec',
  correctness: 'a principal engineer known for finding race conditions, state bugs and edge cases',
  tests: 'a test architect who thinks in mutations and hunts vacuous assertions',
  security: 'an application security and GDPR privacy specialist',
  ux: 'a UX writer and WCAG accessibility specialist, native French speaker',
  design: 'a senior product designer and design-systems engineer who reads CSS and React fluently',
  ops: 'a site reliability engineer for small self-hosted servers and Windows dev machines',
}
const EXPERT_VERIFY = [
  'a skeptical debugger who reproduces failures by tracing the exact code path',
  'a code archaeologist who finds existing guards elsewhere in the codebase',
  'a spec lawyer who checks what the brief and the spec actually require',
]
const NICK_LENS = { spec: 'Lynx', correctness: 'Renard', ux: 'Colibri', security: 'Chouette', tests: 'Pic', design: 'Paon', ops: 'Marmotte' }
const you = s => 'You are ' + s + '. '

function whereText(laneKey) {
  const L = LANES[laneKey]
  if (laneKey === 'A') return 'IMPORTANT: you work ONLY in the main checkout ' + ROOT + ' on branch socle. Other teams may work at the same time in the git worktrees ' + LANES.S.repo + ', ' + LANES.R.repo + ', ' + LANES.B.repo + ', ' + LANES.D.repo + ' and ' + LANES.C.repo + ': never read, run commands in, or modify them. Never touch ' + HOME + 'rune-local (the owner\'s own local install).\n'
  return 'IMPORTANT: you work ONLY in ' + L.repo + ', a git worktree on branch ' + L.branch + '. Wherever the rules files say ' + ROOT + ' or branch socle, use ' + L.repo + ' and branch ' + L.branch + '. Never run commands in or modify ' + ROOT + ' or any other worktree (other teams work there); the only exception: read the briefs and rules under ' + WS + ' and write only your report file there.\n'
}

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

// Minors deferred by the first run (wf_5a957f90-431) for T0, T1, T2, T6 and T14, copied from its journal.
// Minors deferred so far (first run, T0-T6, T14, D, then T7 and T11 in wf_c5fdbec3-21f), copied from its result.
const allDeferred = ["T0-F2 apps/server/test/infra/name.test.ts: The two exact exceptions apply in every file and every path","T1-F8 apps/web/src/ui/theme/fonts.css: File list deviation: fonts.css and test/support/css-blocks.ts instead of fonts.ts","T1-F13 apps/web/src/ui/ui.module.css: Tinted banner backgrounds (color-mix) are not contrast-tested","T1-F14 apps/web/src/ui/theme/tokens.css: Clair --success and Carnet --accent-2 are used as small text but only reach 3:1","T6 re-review 1 minor: `known` can be true while the mirror is empty","T14-F5 docs/exploitation/P9-admin-indisponible.md: No-export branches keep the backups forever with no later deletion and no disclosure; step 1 contradicts step 3","T14-F6 docs/exploitation/P9-admin-indisponible.md: Erasure steps need long hand-typed sudo bash -c and rm -rf lines, with no typo recovery","T14-F10 apps/server/src/auth/admin-reset.ts: Reactivation takes effect before the reset link is used; the old password works again immediately","T1 re-review 1 minor: Footer inset makes its centred links sit off-centre in Carnet","T1 re-review 1 minor: Reported focused test count (69) does not match HEAD (73)","T2-F3 apps/web/src/ui/Logo.tsx: Mono frame stroke is 24 while light, Carnet and Calme mockups use 28","T2-F4 apps/web/src/ui/Logo.tsx: Per-theme logo choice left to consumers, glow fails contrast on light themes","T2-F7 apps/web/public/icons/icon-512.png: Icons grew from about 6 KB to about 370 KB, re-downloaded on every service worker update","T2-F8 apps/web/test/pwa/manifest.test.ts: Icon pixel tests sample only corners and centre","T14 re-review 1 minor: The commitment made for the trusted person is missing from P9, the page they actually read","T14 re-review 1 minor: Step 6 Sinon: « does not exist » overlaps the « unable to open config file » branch and skips removing b2.env","T3-F11 apps/web/src/ui/ui.module.css: Segmented progress declares a fill transition that never runs","T3-F12 apps/web/src/ui/ui.module.css: Error outline relies on a 0.5 px inset shadow","T3-F13 apps/web/src/ui/ChoiceCard.tsx: Only one legend style; onboarding choice screens need the lead style","T3-F14 apps/web/src/ui/ui.module.css: Check spring plays on mount, not only when the user makes a choice","T4-F10 apps/web/src/ui/ui.module.css: Task touches files outside its brief list","T4-F12 apps/web/src/ui/BottomSheet.tsx: Escape closes both sheets when a sheet is nested in another sheet content","T4-F19 apps/web/src/ui/voice.module.css: Salle de nuit gets the plain Sombre panel instead of its HUD frame","T4-F20 apps/web/src/ui/voice.module.css: Système window body spacing and colour differ from B08","T4-F21 apps/web/src/ui/BottomSheet.tsx: Sheet unmounts instantly on close, with no exit motion","T4-F22 apps/web/src/ui/art.module.css: All avatars on a page breathe and blink in lockstep","T4-F23 apps/web/src/ui/CountUp.tsx: CountUp uses a cubic ease-out, not the single motion curve","T4-F27 apps/web/test/ui/sheet-motion.test.tsx: CountUp tests do not prove counting or retargeting","T3 duplicate: a cache-broken resume re-applied T3 round-1 fixes as c7fca9d, d9eb726, ec386f9 on top of T5; check they are harmless and not redundant","T7-F8 apps/web/src/features/coach/CoachStep.tsx: Presentation replays typing and nutrition demo on each remount; no tap-to-skip; Retour from Objectif lands on the choice","T7-F10 apps/web/src/features/coach/CoachStep.tsx: Coach cards duplicate the toolkit ChoiceCard","T7-F12 apps/web/src/features/onboarding/OnboardingFlow.tsx: afterCoach freezes at a value computed from an empty or lagging mirror once a card is touched","T7-F13 apps/web/src/features/coach/CoachIntro.tsx: Presentation bubble shows a second 40 px avatar next to the 184 px stage avatar","T7-F15 apps/web/src/features/coach/CoachStep.tsx: French guillemets and colons use plain spaces and can wrap alone on a line","T7-F19 apps/web/test/coach/coach-step.test.tsx: The no-typing-indicator assertion targets markup nobody uses and misses the prototype caret","T11-F11 apps/web/src/features/places/EquipmentDraft.tsx: useEquipmentDraft signature differs from the brief's interface","T11-F13 C:\\Users\\eliott.colin\\appsport\\.superpowers\\sdd\\2026-10-13-refonte-rune\\task-11-report.md: Review captures are not attached to the report","T11-F17 apps/web/src/features/places/PlaceActions.tsx: Switches become disabled while focused; « Lieu principal » success is silent","T11-F19 apps/web/src/features/places/SubScreen.tsx: Sub-screens are not in history: system back skips the sheet and silently drops the draft","T11-F20 apps/web/src/features/places/PlaceDetail.tsx: A home's equipment editor gives no offline hint until « Enregistrer »","T11-F25 apps/web/src/features/places/PlaceDetail.tsx: Deleting a home can briefly show a false « Lieu introuvable. » screen","T11-F30 apps/web/test/places/draft.test.tsx: The offline save test does not cover a network drop in the middle of a save","T7 re-review 1 minor: Retour from the presentation then Continuer resends the PATCH, and fails offline although the coach is stored","T7 re-review 1 minor: Frozen cards look interactive during the PATCH (hover highlight and pointer cursor)","T7 re-review 1 minor: revealMs duplicates TypedText's timing loop","T11 re-review 1 minor: Retour is silently ignored while busy, with no disabled or aria-disabled state","T11 re-review 1 minor: role=\"status\" sits on a summary that mounts together with the bar, so the first count is often not announced"]
const allRulingsNeeded = []

async function runTask(A) {
  const EXP = EXPERT_BY_KIND[A.kind] || EXPERT_BY_KIND.web
  const REPO = LANES[A.lane].repo
  const BRANCH = LANES[A.lane].branch
  const WHERE = whereText(A.lane)
  const T = A.task
  const BRIEF = WS + '\\task-' + T + '-brief.md'
  const REPORT = WS + '\\task-' + T + '-report.md'
  const SPEC = REPO + '\\docs\\superpowers\\specs\\2026-10-13-refonte-rune-design.md (redesign, authority for the front) and the main spec ' + REPO + '\\docs\\superpowers\\specs\\2026-10-06-appsport-design.md with its folder'
  const RUL = COMMON_RULINGS + '\n' + A.rulings
  const MOCK = A.mockups ? ('Mockups for this task (folder ' + MQ + '): ' + A.mockups + '.\n') : ''

  const implPrompt = you(EXP) + WHERE + 'You are implementing Task ' + T + ' (' + A.title + ') of the Rune redesign, on branch ' + BRANCH + ' in ' + REPO + '.\n'
    + 'Project: ' + PROJECT + '\nContext: ' + A.context + '\n' + MOCK
    + '1. Read first: ' + COMMON_IMPL + ' (rules: mandatory separate RED run; check git show --stat HEAD before reporting; never dispatch subagents), then the redesign spec ' + REPO + '\\docs\\superpowers\\specs\\2026-10-13-refonte-rune-design.md entirely.\n'
    + '2. Your requirements, with exact values and texts to use verbatim: ' + BRIEF + ' (global constraints: ' + GC + ').\n'
    + '3. Issue to close: #' + A.issue + '.\n'
    + '4. Write your full report to: ' + REPORT + '\n'
    + '5. Controller rulings (they win over the brief where they differ):\n' + RUL + '\n'
    + '6. After your final commit run `' + PKG + ' ' + A.base + ' HEAD` from ' + REPO + ' and return the path it prints as diffPath.\n'
    + 'Your final answer is the structured result.'
  const reviewPrompt = (lens, diffPath, head) => you(EXPERT_LENS[lens]) + WHERE + 'Review Task ' + T + ' (' + A.title + ') of the Rune redesign through ONE lens only.\n'
    + 'Project: ' + PROJECT + '\nLens: ' + LENS_TEXT[lens] + '\n' + MOCK
    + 'Rules: ' + COMMON_REV + ' (read-only: never modify files, git state or the working tree; never dispatch subagents).\n'
    + 'Inputs: brief ' + BRIEF + '; global constraints ' + GC + '; implementer report ' + REPORT + '; diff ' + diffPath + ' (base ' + A.base + ', head ' + head + ', branch ' + BRANCH + ' in ' + REPO + '); spec ' + SPEC + '.\n'
    + 'Controller rulings already decided (do not report them as defects; do report code that does not follow them):\n' + RUL + '\n'
    + 'Named risks to examine with this lens where relevant:\n' + (A.risks || '(none)') + '\n'
    + 'Report only findings within your lens, each with file and line, a concrete failure scenario and a fix. Severity: Critical = data loss, security or privacy breach, legal text altered, or app unusable; Important = the task cannot be trusted (incorrect or fragile behaviour, missed requirement, accessibility regression, CSP violation, test that asserts nothing); Minor = polish. Your final answer is the structured result.'
  const triagePrompt = all => you('an engineering lead') + 'You merge code-review findings for Task ' + T + ' of the Rune redesign. Below are findings from several reviewers, each tagged with its lens (JSON). Merge duplicates (same root cause gives one finding; keep the highest severity; list all lenses), give each an id T' + T + '-F1, T' + T + '-F2, and so on, and keep file, line, problem and fix precise. For each Minor set minorAction to fix_now if it is cheap (under about 20 lines), low-risk and improves correctness, accessibility, robustness or test strength, else defer. Critical and Important get minorAction n/a. Do not invent findings. Do not read files; work only from this list.\nFindings:\n' + JSON.stringify(all)
  const verifyPrompt = (f, k, head) => {
    const angle = k === 0 ? 'Reproduce the failure: trace the exact code path at HEAD.'
      : k === 1 ? 'Look for an existing guard elsewhere (callers, server side, other modules, tests) that already prevents the failure.'
      : 'Check the brief, the rulings and the spec: is the flagged behaviour actually required, allowed, or out of scope for this task?'
    return you(EXPERT_VERIFY[k]) + WHERE + 'Adversarially verify one code-review finding on the Rune redesign (branch ' + BRANCH + ', ' + REPO + ', HEAD ' + head + '). Try hard to REFUTE it. ' + angle + ' Read-only: do not modify files or git state; never dispatch subagents.\n'
      + 'Finding ' + f.id + ' [' + f.severity + '] ' + f.file + ':' + f.line + ' - ' + f.title + '\n'
      + 'Problem: ' + f.problem + '\nProposed fix: ' + f.fix + '\nSpec ref: ' + f.specRef + '\n'
      + 'Brief: ' + BRIEF + '; spec: ' + SPEC + '.\n' + MOCK + 'Controller rulings:\n' + RUL + '\n'
      + 'Answer real=true only if a concrete failure scenario exists at HEAD. If real, give the severity you would assign and planConflict: none if the fix does not contradict the brief; spec_wins if the brief mandates the defect but the spec supports the fix; product_choice if neither the brief nor the spec decides it and it is a product decision for the owner. If you cannot confirm a concrete failure, answer real=false. Your final answer is the structured result.'
  }
  const fixPrompt = (items, round, head) => you(EXP) + WHERE + 'Fix round ' + round + ' for Task ' + T + ' (' + A.title + ') of the Rune redesign, branch ' + BRANCH + ', ' + REPO + ', current HEAD ' + head + '.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\n' + MOCK + 'Controller rulings:\n' + RUL + '\n'
    + 'Fix each finding below in new commit(s) whose message ends with "Refs #' + A.issue + '" and the Co-Authored-By trailer. For each, write or adjust the covering test first and see it fail when that is meaningful (RED), then fix (GREEN). Run the covering tests, then pnpm lint, pnpm typecheck and pnpm test (and the E2E specs touched); check git show --stat HEAD and git status. Append a fix report (changes, tests, commands, output) to ' + REPORT + '. If a finding turns out to be wrong after checking the code and spec, do not apply it and explain why in notAddressed. Never dispatch subagents.\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\n'
    + 'After your final commit run `' + PKG + ' ' + head + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'
  const rereviewPrompt = (items, fixDiff, fromHead, head) => you('a senior reviewer who checks fixes precisely and spots regressions') + WHERE + 'Scoped re-review of a fix round for Task ' + T + ' of the Rune redesign. Rules: ' + COMMON_REV + ', section "Scoped re-review rules" (read-only; never dispatch subagents). Inputs: brief ' + BRIEF + '; report ' + REPORT + ' (fix report at the end); fix diff ' + fixDiff + ' (' + fromHead + '..' + head + ').\n'
    + 'For each finding below, say whether the fix diff addresses it, with file:line evidence; when a covering test was needed, check it exists and would fail without the fix. Then list only NEW Critical or Important breakage introduced by the fix diff (Minor new issues may be listed with severity Minor). Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'
  const fixWt = (round, k) => REPO.replace(/\\/g, '/') + '-fix-T' + T + '-r' + round + '-g' + k
  const fixBr = (round, k) => 'fix/T' + T + '-r' + round + '-g' + k
  const pfixPrompt = (items, k, n, round, head) => you(EXP) + WHERE
    + 'Exception to any rule above about where you work: you create and work in your OWN fix worktree ' + fixWt(round, k) + ' (branch ' + fixBr(round, k) + '), and nowhere else.\n'
    + 'Parallel fix group ' + k + ' of ' + n + ', round ' + round + ', for Task ' + T + ' (' + A.title + ') of the Rune redesign. Other experts fix the other findings at the same time in their own worktrees: fix ONLY the findings below and touch as few files as possible.\n'
    + 'Setup, from ' + REPO + ': if ' + fixWt(round, k) + ' or branch ' + fixBr(round, k) + ' exists from an earlier attempt, remove it (`git worktree remove --force`, `git branch -D`). Then `git worktree add ' + fixWt(round, k) + ' -b ' + fixBr(round, k) + ' ' + head + '`, cd there for EVERY later command, and run `pnpm install --prefer-offline --frozen-lockfile`. Never modify ' + REPO + ' itself, its branch ' + BRANCH + ', or any other worktree.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\n' + MOCK + 'Controller rulings:\n' + RUL + '\n'
    + 'For each finding, write or adjust the covering test first and see it fail when meaningful (RED), then fix (GREEN). Run the covering tests, pnpm lint, pnpm typecheck and the tests of the package(s) you touched. Commit on ' + fixBr(round, k) + ' with messages ending "Refs #' + A.issue + '" and the Co-Authored-By trailer. Leave the worktree in place (the integrator removes it). Do NOT write to the report file: put your fix notes (changes, tests, RED/GREEN evidence) in `notes`. Never dispatch subagents.\n'
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
    impl = await lim(implPrompt, { phase: 'Implement', label: 'Castor · T' + T + ' implement', schema: IMPL_SCHEMA, model: 'opus' })
    if (!impl) return { task: T, stage: 'implement', error: 'implementer returned nothing' }
    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') return { task: T, stage: 'implement', error: impl.status, impl }
    head = impl.head
    diffPath = impl.diffPath
    log('T' + T + ' implemented at ' + head + ': ' + impl.tests)
  }

  let reviews = [], minorsNow = [], deferred = [], confirmed = [], needsRuling = [], refuted = []
  if (A.preVerified) {
    confirmed = A.preVerified.confirmed; minorsNow = A.preVerified.minorsNow; deferred = A.preVerified.deferred
    log("T" + T + ": review and verification reused from the journal of wf_489bcc80-941")
  } else {
  const lenses = A.lenses
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
        lim(verifyPrompt(f, k, head), { phase: 'Verify', label: 'Corbeau ' + (k + 1) + ' · T' + T + ' verify ' + f.id, schema: VERDICT_SCHEMA, effort: 'high' })))
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
  }
  log('T' + T + ': ' + confirmed.length + ' confirmed, ' + refuted.length + ' refuted, ' + needsRuling.length + ' need a ruling, ' + minorsNow.length + ' minors to fix now, ' + deferred.length + ' deferred')
  deferred.forEach(f => allDeferred.push(f.id + ' ' + (f.file || '') + ': ' + f.title))
  needsRuling.forEach(f => allRulingsNeeded.push({ id: f.id, title: f.title, problem: f.problem, fix: f.fix }))

  let open = confirmed.concat(minorsNow)
  const rounds = []
  let round = 0
  const maxRounds = 3
  while (open.length && round < maxRounds) {
    round++
    const groups = groupFindings(open, 3)
    let fix = null
    if (groups.length >= 2) {
      log('T' + T + ' round ' + round + ': ' + open.length + ' findings split across ' + groups.length + ' parallel fixers')
      const parts = (await parallel(groups.map((g, k) => () =>
        lim(pfixPrompt(g, k + 1, groups.length, round, head), { phase: 'Fix', label: 'Fourmi ' + (k + 1) + ' · T' + T + ' fix round ' + round, schema: PFIX_SCHEMA, model: 'opus' })
          .then(r => (r ? Object.assign({ group: k + 1, ids: g.map(f => f.id) }, r) : null))))).filter(Boolean)
      if (parts.length) fix = await lim(integratePrompt(parts, round, head), { phase: 'Fix', label: 'Castor · T' + T + ' integrate round ' + round, schema: FIX_SCHEMA, model: 'opus' })
    } else {
      fix = await lim(fixPrompt(open, round, head), { phase: 'Fix', label: 'Fourmi · T' + T + ' fix round ' + round, schema: FIX_SCHEMA, model: 'opus' })
    }
    if (!fix) { rounds.push({ round, error: 'fixer returned nothing' }); break }
    const fromHead = head
    head = fix.head
    const rr = await lim(rereviewPrompt(open, fix.fixDiffPath, fromHead, head), { phase: 'Re-review', label: 'Hibou · T' + T + ' re-review ' + round, schema: REREVIEW_SCHEMA })
    const stillOpen = rr ? open.filter(f => { const r = rr.results.find(x => x.id === f.id); return !r || !r.addressed }) : open
    const fresh = rr ? rr.newBreakage.filter(b => b.severity !== 'Minor').map((b, i) => Object.assign({}, b, { id: 'T' + T + '-R' + round + '-' + (i + 1), lenses: ['re-review'], minorAction: 'n/a' })) : []
    const refusedIds = new Set(fix.notAddressed.map(n => n.id))
    const newMinor = rr ? rr.newBreakage.filter(b => b.severity === 'Minor').map(b => b.title) : []
    newMinor.forEach(t => allDeferred.push('T' + T + ' re-review ' + round + ' minor: ' + t))
    rounds.push({ round, from: fromHead, head, tests: fix.tests, notAddressed: fix.notAddressed, stillOpen: stillOpen.map(f => f.id), newBreakage: fresh.map(f => f.id + ' ' + f.title), newMinor })
    open = stillOpen.filter(f => !refusedIds.has(f.id)).concat(fresh)
    if (!rr) { rounds[rounds.length - 1].error = 're-review returned nothing'; break }
    log('T' + T + ' round ' + round + ': head ' + head + ', ' + open.length + ' still open')
  }

  return {
    task: T, lane: A.lane, base: A.base, head, implStatus: impl ? impl.status : null, implConcerns: impl ? impl.concerns : [],
    reviewers: reviews.map(r => r.lens + ':' + r.verdict + ':' + r.findings.length).join(' '),
    confirmed: confirmed.map(f => f.id + ' [' + f.severity + '] ' + f.title),
    minorsFixedNow: minorsNow.map(f => f.id + ' ' + f.title),
    deferred: deferred.map(f => f.id + ' ' + (f.file || '') + ': ' + f.title),
    refuted: refuted.map(f => f.id + ' ' + f.title),
    needsRuling: needsRuling.map(f => ({ id: f.id, title: f.title, problem: f.problem, fix: f.fix })),
    rounds,
    remainingOpen: open.map(f => ({ id: f.id, severity: f.severity, title: f.title, file: f.file, problem: f.problem, fix: f.fix })),
    error: rounds.some(r => r.error) ? 'fix round error' : null,
  }
}

async function runLane(laneKey, taskIds, startHead, presets) {
  let head = startHead
  const results = []
  for (const id of taskIds) {
    const A = Object.assign({ task: id, lane: laneKey, base: head }, TASKS[id], (presets && presets[id]) || {})
    log('Lane ' + laneKey + ': starting T' + id + ' from ' + head)
    const r = await runTask(A)
    results.push(r)
    if (!r || r.error) { log('Lane ' + laneKey + ': T' + id + ' stopped (' + (r ? r.error : 'null') + ')'); return { lane: laneKey, ok: false, head, results } }
    head = r.head
    if (r.remainingOpen.length) { log('Lane ' + laneKey + ': T' + id + ' still has ' + r.remainingOpen.length + ' open findings after 3 rounds; stopping the lane'); return { lane: laneKey, ok: false, head, results } }
    log('Lane ' + laneKey + ': T' + id + ' done at ' + head)
  }
  return { lane: laneKey, ok: true, head, results }
}

// Continuation written 2026-10-15 after the usage limit cut run wf_c5fdbec3-21f (no resume: parallel lanes).
// Closed in that run: T7 on socle (e18a259), T11 on socle-ecrans (b1bb6ef), both reviewed, fixed and green.
// T8 (socle), T10 (socle-profil in rune-profil) and T12 (socle-ecrans) were cut while implementing: their uncommitted
// work stays in the working trees, snapshots in refs/wip/T8, refs/wip/T10, refs/wip/T12.
const WIP_NOTE = id => ' RESUME NOTE: an earlier implementer of this same task was cut off by a usage limit before committing. Its uncommitted work is in your working tree (git status, git diff; snapshots: refs/wip/T' + id + '-2 is the latest, refs/wip/T' + id + ' is from this morning). Careful: by mistake two copies of that implementer edited this tree at the same time for a few minutes, so look for duplicated or half-finished edits (for example two similar new tests in the same file) and keep one coherent version. Review it critically against the brief and the rulings, keep what is right, fix or drop the rest, then finish the task. TDD evidence: for tests already present, show RED by copying your changed source files to your scratchpad, putting back the HEAD versions with git show HEAD:<path> > <path>, running the tests, then copying your files back (never git stash: the stash list is shared by every worktree). Never git reset, git checkout -- or git clean the work in progress away.'
const P = { '8': { context: TASKS['8'].context + WIP_NOTE('8') }, '10': { context: TASKS['10'].context + WIP_NOTE('10') }, '12': { context: TASKS['12'].context + WIP_NOTE('12') } }
const A7 = (args && args.a7Head) || 'e18a259'
const B11 = (args && args.b11Head) || 'b1bb6ef'
const done7 = { task: '7', head: A7, note: 'closed in run wf_c5fdbec3-21f' }
const done11 = { task: '11', head: B11, note: 'closed in run wf_c5fdbec3-21f' }
const p1 = []
const m1 = { ok: true, head: '35d89f5' }
log('Phase 3 (continuation): lane A T8-T9 from ' + A7 + ', lane C T10 in rune-profil from ' + A7 + ', lane B T12-T13 in rune-ecrans from ' + B11)
const p3raw = await parallel([
  () => runLane('A', ['8', '9'], A7, P),
  () => runLane('C', ['10'], A7, P),
  () => runLane('B', ['12', '13'], B11, P),
])
const la2 = p3raw[0] ? Object.assign({}, p3raw[0], { results: [done7].concat(p3raw[0].results || []) }) : null
const lc = p3raw[1]
const lb = p3raw[2] ? Object.assign({}, p3raw[2], { results: [done11].concat(p3raw[2].results || []) }) : null
const p3 = [la2, lc, lb]
if (!la2 || !la2.ok || !lc || !lc.ok || !lb || !lb.ok) return { stoppedAt: 'phase 3', lanes: p3, deferred: allDeferred, needsRuling: allRulingsNeeded }

const merge2Prompt = you('a senior engineer who integrates branches cleanly and keeps every suite green') + whereText('A')
  + 'Exception: you may read the branches socle-profil and socle-ecrans and at the end remove their worktrees, as described below.\n'
  + 'Integrate lanes C and B into socle in ' + ROOT + ' (current HEAD ' + la2.head + '; socle-profil at ' + lc.head + '; socle-ecrans at ' + lb.head + '). Project: ' + PROJECT + '\n'
  + '0. `git merge --no-ff socle-profil` with message « merge: espace Profil, réglages, coach, santé et déconnexion (T10) dans le socle » (body: Refs #58, blank line, Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>). T10 started from the T7 head while T8 and T9 went on in lane A: resolve App.tsx, onboarding, home and profile conflicts so T8, T9 and T10 all keep their behaviour; record each conflict.\n'
  + '1. `git merge --no-ff socle-ecrans` with message « merge: salles, administration et accès Rune (T11 à T13) dans le socle » (body: Refs #59, #60, #61, blank line, Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>). Ruling P10: resolve App.tsx, auth and shared CSS conflicts so both lanes keep their behaviour (Profile hub and Mon coach routes from T10; Aide with Crédits, /credits reachable, auth pages from T13; places from T11); record each conflict.\n'
  + '2. pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test, pnpm test:infra (Git Bash), and the whole E2E suite `pnpm --filter @rune/web test:e2e` (Chromium and WebKit): ALL green; fix integration breakage in new commits with the trailer.\n'
  + '3. Remove the worktrees with `git worktree remove C:/Users/eliott.colin/rune-profil` and `git worktree remove C:/Users/eliott.colin/rune-ecrans` (only if clean), then `git branch -d socle-profil socle-ecrans`.\n'
  + 'Write a short merge report to ' + WS + '\\merge-2-report.md. Rules: ' + COMMON_IMPL + '. Never dispatch subagents. ok=true only when every suite is green. Your final answer is the structured result.'
log('Phase 4: merging socle-profil and socle-ecrans into socle')
const m2 = await lim(merge2Prompt, { phase: 'Merge', label: 'Castor · merge 2', schema: MERGE_SCHEMA, model: 'opus' })
if (!m2 || !m2.ok) return { stoppedAt: 'merge 2', lanes: p1.concat(p3), merge1: m1, merge2: m2, deferred: allDeferred, needsRuling: allRulingsNeeded }

// Phase 5: sweep and closing on socle
const l5 = await runLane('A', ['15', '16'], m2.head)
if (!l5.ok) return { stoppedAt: 'phase 5', lanes: p1.concat(p3, [l5]), merge1: m1, merge2: m2, deferred: allDeferred, needsRuling: allRulingsNeeded }

// Phase 6: final whole-range review
const FR_AREAS = [
  { key: 'front', nick: 'Aigle 1', focus: 'the front as ONE product: apps/web/src, apps/web/test, apps/web/e2e, apps/web/scripts. Consistency across screens (toolkit used everywhere, no leftover old styles or --color-* variables, no duplicated component), the 5 themes, navigation (tabs, side nav, back buttons, deep links and redirects), motion and reduced motion, accessibility (roles, names, focus, sheets), offline and error states, the spec §5 to §10 behaviours, CSP (no style elements, no dangerouslySetInnerHTML), legal texts verbatim except appsport -> Rune, no fake data, coach guardrails.' },
  { key: 'back', nick: 'Aigle 2', focus: 'server, contracts, ops and docs: packages/, apps/server, infra/, docs/, .github/. The appsport -> rune rename (every writer and reader of a renamed identifier agree: headers, env vars in code, compose, Dockerfile, CI and host scripts, systemd units, paths), the coach column (migration, API, export, deletion, admin isolation, onboarding completion), admin:reset reactivation, status.json .deploy on failed deploys, the rune address in procedures, the processing record and Privacy page consistency, the deferred-points sweep fixes, CI log masking, security and privacy regressions, and the pnpm dev script (no orphan process, no bootstrap link written to disk, README in step with it).' },
  { key: 'tests', nick: 'Aigle 3', focus: 'test strength and coverage across the whole range: the new tests the spec §12 lists (theme choice and application, tab bar aria-current and keyboard, coach step and onboarding resume, coach migration, equipment draft, token contrasts, reduced motion, bottom sheet focus trap and Escape, the coach-to-Éveil E2E) exist and would fail on plausible bugs; flaky patterns (timers, animations, liveQuery); and triage of the deferred minors listed below: say which must be fixed before merging to main (report them as findings) and which can wait.' },
]
const FR_SCHEMA = REVIEW_SCHEMA
const frPrompt = a => you('a principal engineer doing the final whole-branch review before a production release') + whereText('A')
  + 'Final review of the Rune redesign range ' + START + '..HEAD on branch socle in ' + ROOT + ' (HEAD ' + l5.head + '). Project: ' + PROJECT + '\n'
  + 'Your area: ' + a.focus + '\n'
  + 'Read the redesign spec docs/superpowers/specs/2026-10-13-refonte-rune-design.md, the global constraints ' + GC + ', and the ledger ' + LEDGER + ' (rulings). Use read-only git commands (git diff ' + START + '..HEAD -- <paths>, git log, git show) and file reads; never modify files or git state; never dispatch subagents. Mockups for visual intent: ' + MQ + '.\n'
  + 'Deferred minors collected during the tasks (JSON):\n' + JSON.stringify(allDeferred) + '\n'
  + 'Report only real defects in your area, each with file and line, a concrete failure scenario and a fix. Severity: Critical = data loss, security or privacy breach, legal text altered, app unusable; Important = must be fixed before production (incorrect or fragile behaviour, missed spec requirement, accessibility regression, test that asserts nothing); Minor = can wait. Your final answer is the structured result.'
log('Phase 6: final review of ' + START + '..' + l5.head)
const frRaw = (await parallel(FR_AREAS.map(a => () =>
  lim(frPrompt(a), { phase: 'Final review', label: a.nick + ' · final review:' + a.key, schema: FR_SCHEMA, effort: 'high' })
    .then(r => (r ? r.findings.map(f => Object.assign({}, f, { lens: a.key })) : []))))).flat()
let frMerged = []
if (frRaw.length) {
  const tri = await lim(you('an engineering lead') + 'Merge these final-review findings of the Rune redesign: merge duplicates (keep the highest severity, list all lenses), ids FR-1, FR-2, …, keep file, line, problem and fix precise; Minor findings get minorAction fix_now when cheap and low-risk, else defer; Critical and Important get n/a. Do not read files.\nFindings:\n' + JSON.stringify(frRaw), { phase: 'Final review', label: 'Écureuil · final triage', schema: TRIAGE_SCHEMA, model: 'sonnet', effort: 'low' })
  frMerged = (tri && tri.findings) || frRaw.map((f, i) => Object.assign({}, f, { id: 'FR-' + (i + 1), lenses: [f.lens], minorAction: f.severity === 'Minor' ? 'defer' : 'n/a' }))
}
const frSerious = frMerged.filter(f => f.severity !== 'Minor')
const frVerified = (await parallel(frSerious.map(f => () =>
  parallel([0, 1, 2].map(k => () =>
    lim(you(EXPERT_VERIFY[k]) + whereText('A') + 'Adversarially verify one final-review finding on the Rune redesign (branch socle, ' + ROOT + ', HEAD ' + l5.head + '). Try hard to REFUTE it. Read-only; never dispatch subagents.\nFinding ' + f.id + ' [' + f.severity + '] ' + f.file + ':' + f.line + ' - ' + f.title + '\nProblem: ' + f.problem + '\nProposed fix: ' + f.fix + '\nSpec: docs/superpowers/specs/2026-10-13-refonte-rune-design.md; rulings in ' + LEDGER + '.\nAnswer real=true only if a concrete failure scenario exists at HEAD; planConflict product_choice if it is a product decision for the owner. Your final answer is the structured result.', { phase: 'Final review', label: 'Corbeau ' + (k + 1) + ' · verify ' + f.id, schema: VERDICT_SCHEMA, effort: 'high' })))
    .then(vs => { const v = vs.filter(Boolean); const yes = v.filter(x => x.real); return Object.assign({}, f, { real: yes.length >= 2, product: yes.filter(x => x.planConflict === 'product_choice').length >= 2 }) })))).filter(Boolean)
const frConfirmed = frVerified.filter(f => f.real && !f.product)
const frProduct = frVerified.filter(f => f.real && f.product)
const frFixNow = frConfirmed.concat(frMerged.filter(f => f.severity === 'Minor' && f.minorAction === 'fix_now'))
log('Final review: ' + frRaw.length + ' raw, ' + frConfirmed.length + ' confirmed, ' + frProduct.length + ' product choices, ' + frFixNow.length + ' to fix')
let frFix = null, frRe = null
if (frFixNow.length) {
  const REPORT = WS + '\\final-fix-report.md'
  frFix = await lim(you(EXPERT_BY_KIND.web + ', also at ease with the Node server and the ops scripts') + whereText('A') + 'One fix wave for the final review of the Rune redesign, branch socle, ' + ROOT + ', HEAD ' + l5.head + '. Read ' + COMMON_IMPL + ' (rules). For each finding below: covering test first (RED when meaningful), fix (GREEN), commits in French ending with the Co-Authored-By trailer. Then pnpm lint, pnpm typecheck, pnpm test, pnpm test:infra (Git Bash) and the whole E2E suite: all green. Write the report to ' + REPORT + '. If a finding is wrong after checking, explain in notAddressed. Never dispatch subagents.\nFindings (JSON):\n' + JSON.stringify(frFixNow) + '\nAfter your final commit run `' + PKG + ' ' + l5.head + ' HEAD` from ' + ROOT + ' and return its printed path as fixDiffPath. Your final answer is the structured result.', { phase: 'Final review', label: 'Castor · final fix wave', schema: FIX_SCHEMA, model: 'opus' })
  if (frFix) frRe = await lim(you('a senior reviewer who checks fixes precisely and spots regressions') + whereText('A') + 'Scoped re-review of the final fix wave of the Rune redesign. Rules: ' + COMMON_REV + ', section "Scoped re-review rules" (read-only; never dispatch subagents). Fix report ' + WS + '\\final-fix-report.md; fix diff ' + frFix.fixDiffPath + ' (' + l5.head + '..' + frFix.head + '). For each finding say whether the fix addresses it with file:line evidence, then list only NEW breakage. Findings (JSON):\n' + JSON.stringify(frFixNow) + '\nYour final answer is the structured result.', { phase: 'Final review', label: 'Hibou · final re-review', schema: REREVIEW_SCHEMA })
}
const residual = frRe ? frFixNow.filter(f => { const r = frRe.results.find(x => x.id === f.id); return !r || !r.addressed }).map(f => ({ id: f.id, severity: f.severity, title: f.title, file: f.file })) : frFixNow.map(f => ({ id: f.id, severity: f.severity, title: f.title }))

return {
  done: true,
  lanes: p1.concat(p3, [l5]),
  merge1: m1, merge2: m2,
  finalHead: frFix ? frFix.head : l5.head,
  final: {
    confirmed: frConfirmed.map(f => f.id + ' [' + f.severity + '] ' + f.title),
    productChoices: frProduct.map(f => ({ id: f.id, title: f.title, problem: f.problem, fix: f.fix })),
    deferredMinors: frMerged.filter(f => f.severity === 'Minor' && f.minorAction !== 'fix_now').map(f => f.id + ' ' + f.title),
    fixTests: frFix ? frFix.tests : null,
    notAddressed: frFix ? frFix.notAddressed : [],
    newBreakage: frRe ? frRe.newBreakage : [],
    residual,
  },
  deferred: allDeferred,
  needsRuling: allRulingsNeeded,
}
