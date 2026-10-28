export const meta = {
  name: 'brique-2-exercices',
  description: 'Rune brick 2 Exercices: 18 tasks in three lanes (server, tooling, web), merge, review screens, reference sheets, final review',
  whenToUse: 'Execute docs/superpowers/plans/2026-10-14-brique-2-exercices.md once the redesign is merged into socle',
  phases: [
    { title: 'Setup', detail: 'branch brique-2 and lane worktrees' },
    { title: 'Implement', detail: 'implementer writes the task with TDD and commits' },
    { title: 'Review', detail: 'one reviewer per lens' },
    { title: 'Triage', detail: 'merge duplicate findings, classify minors' },
    { title: 'Verify', detail: '3 skeptics try to refute each Critical/Important finding' },
    { title: 'Fix', detail: 'fixers apply confirmed findings and cheap minors' },
    { title: 'Re-review', detail: 'scoped re-review of each fix diff' },
    { title: 'Merge', detail: 'integrate lane branches into brique-2' },
    { title: 'Final review', detail: 'whole-range review, one fix wave, one re-review' },
  ],
}

// Owner: many agents, each an expert; at most 3 heavy ones (implement, fix, integrate, merge, setup) on the 16 GB laptop.
const MAX = 8
const MAX_HEAVY = 3
const HEAVY = /implement|fix round|fix wave|integrate|merge|setup|worktree/
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
const WS = ROOT + '\\.superpowers\\sdd\\2026-10-14-brique-2'
const PLAN = 'docs/superpowers/plans/2026-10-14-brique-2-exercices.md'
const PKG = 'bash C:/Users/eliott.colin/.claude/skills/subagent-driven-development/scripts/review-package ' + PLAN
const MQ = ROOT + '\\.superpowers\\brainstorm\\2679-1791963547\\content\\'
const HOME = 'C:\\Users\\eliott.colin\\'
// args.start = socle HEAD once the redesign is merged (required); args.issues = { '1': 70, ... } when the GitHub issues exist.
const START = args && args.start
// GitHub issues #69 (task 1) to #86 (task 18), milestone « Brique 2 · Exercices ».
const ISSUES = (args && args.issues) || { 1: 69, 2: 70, 3: 71, 4: 72, 5: 73, 6: 74, 7: 75, 8: 76, 9: 77, 10: 78, 11: 79, 12: 80, 13: 81, 14: 82, 15: 83, 16: 84, 17: 85, 18: 86 }
const LANES = {
  A: { repo: ROOT, branch: 'brique-2' },
  B: { repo: HOME + 'rune-outils', branch: 'brique-2-outils' },
  C: { repo: HOME + 'rune-web', branch: 'brique-2-web' },
}
const COMMON_IMPL = WS + '\\implementer-common.md'
const COMMON_REV = WS + '\\reviewer-common.md'
const GC = WS + '\\global-constraints.md'
const LEDGER = WS + '\\progress.md'
const SPEC_B2 = 'docs\\superpowers\\specs\\2026-10-14-brique-2-exercices-design.md'
const SPEC_04 = 'docs\\superpowers\\specs\\2026-10-06-appsport-design\\04-exercices.md'
const SPEC_UI = 'docs\\superpowers\\specs\\2026-10-13-refonte-rune-design.md'
const PROJECT = 'Rune is a private French strength-training PWA for a small invited circle: pnpm TypeScript monorepo with packages/contracts (Zod, constants, entityRules), packages/domain (pure functions shared by server, scripts and web), apps/server (Hono, Kysely on node:sqlite, STRICT tables, migrations), apps/web (React 19, CSS Modules, wouter, Dexie through repos/ only, Vite, Vitest + Testing Library + happy-dom, Playwright E2E on Chromium and WebKit). The socle (accounts, onboarding, places, privacy, admin, sync, PWA, ops) and the Rune redesign (tokens, toolkit, shell, screens) are done. Brick 2 delivers the exercise catalogue: taxonomy and sheets, shared domain functions, database and loader, multi-reviewer review with a health green light, drafting and illustration tooling, the Exercises tab and the tabbed sheet, then reference sheets.'
const COMMON_RULINGS = '- The brick 2 spec ' + SPEC_B2 + ' and the section it completes ' + SPEC_04 + ' are the binding authority (brick 2 wins over 04 where its §1 table says so); the redesign spec ' + SPEC_UI + ' stays the authority for the look. Preflight rulings are in ' + LEDGER + ' (section Rulings): the ones quoted below apply to this task.\n- Reports and commit messages never contain invitation or reset codes, links with a # fragment, passwords, tokens or API keys. No test reaches the network or the real Claude API.\n- Never write « appsport » in a tracked file outside docs/superpowers and docs/research (apps/server/test/infra/name.test.ts fails on it).'

const LENS_TEXT = {
  spec: 'SPEC COMPLIANCE: compare the diff with the brief, the controller rulings, the brick 2 spec and 04-exercices (values fixed by the spec, transition and visibility tables, queues, blockers order, exact French texts). Missing / Extra / Misunderstood requirements; a domain rule re-implemented instead of calling the shared packages/domain function.',
  correctness: 'CORRECTNESS: bugs, edge cases, error handling, races and ordering (revision checks, BEGIN IMMEDIATE, two admin tabs), boundary values (120-character safety entries, 1000-character comments, 300 sheets), deterministic ordering (French collation then id), state across navigation, interaction with code from earlier tasks. For every finding give a concrete input or state that produces the wrong result.',
  tests: 'TEST STRENGTH: would the new tests fail on plausible wrong implementations? Vacuous or tautological assertions, fast-check properties that cannot fail, missing cases the brief lists, non-determinism (timers, liveQuery, ordering, Promise.all races asserted in one order), tests passing for the wrong reason, network access in tests, noisy output. You may run focused tests but must NOT modify any file; reason about mutations instead.',
  security: 'SECURITY AND PRIVACY: reviewer flags and health-professional status never visible to members or other reviewers; comments, validations and revisions never leaking authors where the spec hides them; export and account deletion (SET NULL, own data only); 403/401/404 isolation on /api/review/* and /api/admin/*; no personal data and no API key in prompts, files, logs or reports; SVG sanitising (scripts, on* attributes, external links); CSP (no inline script, no style elements, no dangerouslySetInnerHTML, no external resource); minors (cautious profile) never seeing a not_for_minors sheet on any surface.',
  ux: 'UI, COPY AND ACCESSIBILITY: French texts exactly as the brief or spec fix them (straight apostrophe, tutoiement), labels tied to inputs, roles and accessible names, the ARIA tabs pattern (arrows, Home, End, one focusable tab, aria-controls), focus order and visible focus, sheets (Escape, focus trap and return), screen-reader prefixes, 44 px targets, offline states and « Nécessite le réseau », no Dexie access from screens, no navigator.onLine.',
  design: 'VISUAL DESIGN: compare with the validated mockups named for this task (read their HTML source) and the redesign tokens and toolkit: tokens only (no hard-coded colours or fonts), coherent in all 5 themes, the safety box readable (4.5:1) and visible on every tab, 52 px buttons, 44 px targets, 16 px fields, spacing and hierarchy as in the mockup, rank stones and toolkit components reused, motion with the single curve and nothing hidden under prefers-reduced-motion, no fake data.',
  ops: 'OPERATIONS AND PORTABILITY: scripts runnable on the Windows 11 dev machine (PowerShell or Git Bash, Node 24, no Docker or Python), CI steps matching the scripts, canonical JSON with LF, exact dependency versions at least two weeks old, .env.local git-ignored and read only where the brief says, data safety on failure paths (a failed draft or import leaves files intact), scripts that clean up after themselves.',
  content: 'EXERCISE CONTENT AND SAFETY: read each sheet as a physiotherapist and strength coach would for a beginner: instructions correct and in a safe order, safety entries (at most 120 characters) say when to stop, no medical vocabulary or diagnosis, common mistakes paired with corrections, muscles, joints, level and load mode coherent with the movement, glossary terms used, French clear and in tutoiement, the style guide followed.',
}
const EXPERT_BY_KIND = {
  domain: 'a senior TypeScript engineer expert in Zod schemas, pure domain functions and property-based testing with fast-check',
  server: 'a senior Node.js back-end engineer expert in Hono, Kysely on SQLite, transactional migrations and privacy-by-design APIs',
  tooling: 'a senior build and tooling engineer expert in Node scripts, Vitest projects, GitHub Actions CI, SVG sanitising and the Anthropic TypeScript SDK',
  web: 'a senior React and TypeScript front-end engineer who ships accessible, offline-first PWAs on a design system',
  data: 'a strength coach and technical writer who writes clear, safe exercise sheets for beginners, fluent in French and in the catalogue schema',
}
const EXPERT_LENS = {
  spec: 'a meticulous requirements analyst who checks every rule of the brief and the specs',
  correctness: 'a principal engineer known for finding race conditions, state bugs and edge cases',
  tests: 'a test architect who thinks in mutations and hunts vacuous assertions',
  security: 'an application security and GDPR privacy specialist',
  ux: 'a UX writer and WCAG accessibility specialist, native French speaker',
  design: 'a senior product designer and design-systems engineer who reads CSS and React fluently',
  ops: 'a site reliability and tooling engineer for Windows dev machines and CI',
  content: 'a physiotherapist and strength coach who reviews exercise instructions for beginners',
}
const EXPERT_VERIFY = [
  'a skeptical debugger who reproduces failures by tracing the exact code path',
  'a code archaeologist who finds existing guards elsewhere in the codebase',
  'a spec lawyer who checks what the brief and the specs actually require',
]
const NICK_LENS = { spec: 'Lynx', correctness: 'Renard', ux: 'Colibri', security: 'Chouette', tests: 'Pic', design: 'Paon', ops: 'Marmotte', content: 'Cerf' }
const you = s => 'You are ' + s + '. '

function whereText(laneKey) {
  const L = LANES[laneKey]
  if (laneKey === 'A') return 'IMPORTANT: you work ONLY in the main checkout ' + ROOT + ' on branch brique-2. Other teams may work at the same time in the git worktrees ' + LANES.B.repo + ' and ' + LANES.C.repo + ': never read, run commands in, or modify them. Never touch ' + HOME + 'rune-local (the owner\'s own local install) or ' + HOME + 'rune-specs.\n'
  return 'IMPORTANT: you work ONLY in ' + L.repo + ', a git worktree on branch ' + L.branch + '. Wherever the rules files say ' + ROOT + ' or branch brique-2, use ' + L.repo + ' and branch ' + L.branch + '. Never run commands in or modify ' + ROOT + ' or any other worktree (other teams work there); the only exception: read the briefs, rules and mockups under ' + ROOT + '\\.superpowers and write only your report file in ' + WS + '.\n'
}

// Ruling P25: lane B forks from the task 4 head, lane C from the task 6 head.
const B_FORK_DEFAULT = '4'
const C_FORK_DEFAULT = '6'
const R = ids => '- Apply the preflight rulings ' + ids.join(', ') + ' exactly as written in ' + LEDGER + ' (section Rulings: read each one in full before starting; they win over the brief).'

const TASKS = {
  '1': { title: 'Taxonomie complète et schéma de fiche', kind: 'domain', lenses: ['spec', 'correctness', 'tests'], mockups: '',
    context: 'Lane A, first task of brick 2 on branch brique-2: constants, sheet schemas and error codes in packages/contracts, consumed by every later task.',
    rulings: R(['P1', 'P2', 'P3']) + '\n- Task 1 does not change CatalogBundle (task 6 does); it only adds schemas and constants, and the 4 web error messages so the web typecheck stays green.',
    risks: '(a) Key order of ExerciseSheetSchema not equal to 04 §4 (with batch after status): the canonical form of every later file depends on it. (b) Bounds from 04 §4 and the global constraints wrong (safety 120, comments 1000, batch regex). (c) ExerciseSheet typed as the complete published shape, so drafts with empty AI fields cannot be typed. (d) A web or server typecheck broken by the new error codes. (e) MUSCLE_GROUPS order or labels different from spec §4.3.' },
  '2': { title: 'Fonctions partagées du catalogue', kind: 'domain', lenses: ['spec', 'correctness', 'tests'], mockups: '',
    context: 'Lane A: pure catalogue functions in packages/domain/src/catalog (feasibility, chains, substitutes, canonical form, normalize), shared by server, scripts and web.',
    rulings: R(['P1', 'P4', 'P5', 'P6']),
    risks: '(a) substitutes not stable across input order, or ties not broken by binary id order. (b) Chain functions looping or throwing on cycles, branches or dangling pointers. (c) canonicalJson not byte-stable (key order, 2 spaces, final LF). (d) fast-check properties that cannot fail. (e) Date.now or I/O inside src/catalog (purity test).' },
  '3': { title: 'Fonctions de la relecture', kind: 'domain', lenses: ['spec', 'correctness', 'security', 'tests'], mockups: '',
    context: 'Lane A: sensitivity, health green light, content diff, transition blockers, review queues and batch progress as pure functions; tasks 8 and 9 must call them, never re-implement them.',
    rulings: R(['P1', 'P5', 'P7']),
    risks: '(a) A green light granted by a plain validation, by the author of the last content change, by an admin, or by a reviewer whose flag was removed. (b) Blockers in the wrong order or missing a code. (c) contentDiff counting status or system fields. (d) Queues overlapping wrongly (a draft in to_review). (e) catalog_full off by one (300 vs 299).' },
  '4': { title: 'Validateur du catalogue, style et glossaire', kind: 'tooling', lenses: ['spec', 'correctness', 'ops', 'tests'], mockups: '',
    context: 'Lane A: catalogue validator (domain), the @rune/scripts workspace package with the data:validate CLI, the shared file reader in the server, the CI step, the style guide and the glossary.',
    rulings: R(['P4', 'P5', 'P8', 'P9', 'P10']) + '\n- Exception to implementer-common: this task creates docs/catalog/style-guide.md and data/glossary.json and edits pnpm-workspace.yaml, vitest.config.ts and .github/workflows/ci.yml.',
    risks: '(a) Validator cases from 04 §13 criterion 1 missing or passing vacuously. (b) The loader mode rejecting the whole catalogue (R-EQ-5 or canonical form enforced at load). (c) scripts not resolvable or not typechecked by both typecheck jobs. (d) Windows: CRLF or path separators in error lines. (e) data:validate failing on the current empty data/ tree.' },
  '5': { title: 'Migration du catalogue et registre', kind: 'server', lenses: ['spec', 'correctness', 'security', 'tests'], mockups: '',
    context: 'Lane A: migration 0003_catalog (exercise, illustration, exercise_comment, exercise_validation, exercise_revision, user flags), entityRules registry, factories and schema snapshots.',
    rulings: R(['P11']),
    risks: '(a) A chain of two sheets cannot be inserted (immediate self-referencing FK). (b) Deleting an account blocked by a FK or leaving its id in a cell. (c) The flags missing from entityRules or COLUMN_CODECS (sync breaks). (d) Migration flagged breaking or not transactional, or an existing v1/v2 base losing rows. (e) enum-consistency, codecs, migrate or coach tests left red.' },
  '6': { title: 'Chargeur, bloc servi et version du catalogue', kind: 'server', lenses: ['spec', 'correctness', 'security', 'tests'], mockups: '',
    context: 'Lane A: files loaded into the database by merge rules, the served bundle rebuilt from the database, catalog_version, the new CatalogBundle shape and its web parse.',
    rulings: R(['P1', 'P8', 'P12']),
    risks: '(a) A file overwriting a sheet already in the database outside the narrow draft exception. (b) Editorial columns, drafts, reviewed sheets or batch served by GET /api/catalog. (c) The in-memory bundle swapped before commit, or templates lost on rebuild (version change, phones lose templates). (d) Invalid files writing partially. (e) ETag and 304 behaviour regressing; the web catalog sync test broken.' },
  '7': { title: 'Drapeaux de relecteur et garde', kind: 'server', lenses: ['spec', 'correctness', 'security', 'tests'], mockups: '',
    context: 'Lane A: catalog_reviewer and health_professional flags (admin route with password, security log), the requireReviewer guard, MeResponse and MemberSummary fields, privacy texts and processing record.',
    rulings: R(['P13', 'P27']) + '\n- Exception to implementer-common: this task edits docs/fiche-de-traitement.md, apps/web/src/features/public/privacy-content.ts and, in docs/superpowers/specs/2026-10-06-appsport-design/, only the lines 02 R-ROLE-3 and 03 §5 and §13.4 (pointer to the brick 2 spec).',
    risks: '(a) An admin able to set the health flag on himself. (b) Flags changed without a valid password, or written before the password check. (c) Another member\'s flags visible outside /api/admin/members. (d) The flag change not bumping rev (mirror stale). (e) Privacy text changed without the version bump, or docs.test phrases not updated.' },
  '8': { title: 'API de relecture (commentaires, validations, files)', kind: 'server', lenses: ['spec', 'correctness', 'security', 'tests'], mockups: '',
    context: 'Lane A: /api/review routes (list with queues and counts, detail, comments, resolve, validate), review contracts, personal export of comments and validations.',
    rulings: R(['P7', 'P13', 'P14']),
    risks: '(a) A reviewer receiving drafting, reviewed_by, the author of green lights or another reviewer\'s health flag (including in a 409 body). (b) Queues or counts re-implemented instead of calling task 3. (c) Comment body not sanitised or over 1000 characters accepted. (d) A reviewer resolving another reviewer\'s comment. (e) Export leaking other people\'s comments or resolved_by.' },
  '9': { title: 'Édition admin, transitions, révisions et export du catalogue', kind: 'server', lenses: ['spec', 'correctness', 'security', 'tests'], mockups: '',
    context: 'Lane A: admin PUT with revision control, transitions with blockers, revision rows, catalogue rebuild, catalogue export and data:pull, review isolation test.',
    rulings: R(['P2', 'P7', 'P8', 'P15']),
    risks: '(a) Two PUTs from the same revision both succeeding, or the loser losing its 409 details. (b) A PUT changing status or system fields, or a sensitive sheet published without a fresh green light. (c) Blockers checked outside the write transaction. (d) The export not byte-identical after the round trip, or carrying account ids. (e) catalog_version not changing on publish or on an edit of a published sheet, or changing on a draft edit or a comment.' },
  '10': { title: 'Client IA et rédaction des brouillons', kind: 'tooling', lenses: ['spec', 'correctness', 'security', 'ops', 'tests'], mockups: '',
    context: 'Lane B (worktree): AiClient in apps/server/src/ai (real and fake), the exercises:draft script and prompt v1, NOTES.md. The real API is never called by tests or by agents.',
    rulings: R(['P9', 'P16']) + '\n- Exception to implementer-common: this task creates scripts/exercises/NOTES.md and edits .dockerignore.',
    risks: '(a) A test reaching the network, or the key read from the inherited environment or written anywhere. (b) Skeleton fields modified by the draft script, or the file corrupted after a failed attempt. (c) stop_reason max_tokens or refusal not handled. (d) Personal data, account ids or editorial fields sent in the prompt. (e) The SDK reachable from the server bundle (main.ts).' },
  '11': { title: 'Illustrations, nettoyage des SVG et Crédits', kind: 'tooling', lenses: ['spec', 'correctness', 'security', 'ux', 'tests'], mockups: '',
    context: 'Lane B (worktree): SVG sanitiser and size check, illustrations importer and manifest, the Crédits page generated at build time from the manifest (public, offline, signed out).',
    rulings: R(['P1', 'P8', 'P10', 'P17']) + '\n- Exception to implementer-common: this task edits .gitattributes and .github/workflows/ci.yml.',
    risks: '(a) A trapped SVG (script, on*, external href, entities, style url) coming out unsanitised. (b) Hashes computed on bytes different from the committed file (CRLF), so served URLs 404. (c) Crédits empty when signed out or offline, or making a request. (d) Source URLs not pinned to a commit, or replace_before_public wrong. (e) A new dependency added.' },
  '12': { title: 'Dépôt du catalogue côté web et composant d\'onglets', kind: 'web', lenses: ['spec', 'correctness', 'ux', 'security', 'tests'], mockups: 'exercices-fiche.html (tabs), exercices-liste.html',
    context: 'Lane C (worktree, from the task 6 head): catalogue hooks in apps/web/src/repos/catalog-repo.ts over Dexie and the accessible Tabs component in ui/.',
    rulings: R(['P1', 'P4', 'P19']),
    risks: '(a) A not_for_minors sheet reachable in cautious mode through groups, search, variants, chains or counts. (b) cautious computed less strictly than the server (minor with cautious_mode off, me null). (c) Dexie accessed outside repos/ (architecture test). (d) Tabs not following the ARIA APG pattern (arrows, Home, End, roving tabindex, aria-controls). (e) The empty and missing states confused.' },
  '13': { title: 'Fiche d\'un exercice', kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'security', 'tests'], mockups: 'exercices-fiche.html (choice B)',
    context: 'Lane C: the tabbed exercise sheet with the safety box visible on every tab, the reusable ExerciseSheetView for the review screen, credits under illustrations.',
    rulings: R(['P19', 'P20']),
    risks: '(a) Safety box missing from a tab or failing contrast in a theme. (b) Content of an unusable or not_for_minors sheet rendered when opened by URL in cautious mode. (c) ?tab pushing history entries instead of replacing. (d) Screen-reader prefixes « Erreur : » and « Correction : » missing. (e) A second sheet renderer instead of ExerciseSheetView.' },
  '14': { title: 'Onglet Exercices, liste d\'un groupe et lien depuis Progression', kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'tests'], mockups: 'exercices-liste.html (choice B, then the list of A)',
    context: 'Lane C: Exercises tab replacing Salles in the tab bar (places move under Profil › Mes lieux), muscle tiles with rank stones, group list, search, states, Progression link, E2E offline sheet.',
    rulings: R(['P19', 'P21']),
    risks: '(a) Nine tiles at 0 when the catalogue is missing or empty. (b) Tab bar highlight, side nav or screen transitions wrong after the Salles to Exercices change, or /places left as a tab root. (c) Search and scroll not restored on Retour. (d) Cautious mode leaking through counts or search. (e) E2E depending on the real data/ instead of the fixture.' },
  '15': { title: 'Dépôt de relecture et arrivée des relectrices', kind: 'web', lenses: ['spec', 'correctness', 'ux', 'security', 'tests'], mockups: 'relecture.html',
    context: 'Phase 2 on brique-2: review repo (online only, class H), home card, Profile row, /review guard, lost-access handling, « Comment relire », comment drafts in localStorage with cleanup.',
    rulings: R(['P14', 'P22']),
    risks: '(a) The home card shown from a cache or counting a sheet twice. (b) Any 403 treated as lost access (self_health_flag, account_disabled…). (c) A redirect loop after losing access, or the Profile row staying visible. (d) Comment drafts surviving logout, deletion or a user switch. (e) /review reachable by a member.' },
  '16': { title: 'Écran de relecture (liste, fiche, commentaires, validation)', kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'security', 'tests'], mockups: 'relecture.html',
    context: 'Phase 2: review list with filters and counts, review sheet reusing ExerciseSheetView, comment sheet, validation sheet, next sheet.',
    rulings: R(['P14', 'P20', 'P23']),
    risks: '(a) A comment rendered as HTML, or a role shown next to an author. (b) A reviewer seeing « Modifier la fiche » or « Publier ». (c) The validation sheet not stating the version. (d) The changed-since block without before and after values. (e) Plurals and exact strings drifting from the spec.' },
  '17': { title: 'Outils de l\'admin et parcours de bout en bout', kind: 'web', lenses: ['spec', 'correctness', 'ux', 'design', 'security', 'tests'], mockups: 'relecture.html',
    context: 'Phase 2: admin edit form, publish with blockers, 409 handling with the current version next to the user\'s input, admin filters and export, reviewer flags sheet on the Members page, full review E2E.',
    rulings: R(['P2', 'P14', 'P23', 'P24', 'P27']),
    risks: '(a) The 409 losing the admin\'s input. (b) « Publier » enabled while the server would block. (c) The health switch shown on an admin. (d) Nested sheets breaking the focus trap. (e) The E2E depending on real data or on fixed sleeps.' },
  '18': { title: 'Fiches étalons et squelettes du lot A (sans le pilote)', kind: 'data', lenses: ['spec', 'correctness', 'content'], mockups: '',
    context: 'Phase 3: two reference sheets, the provisional lot A list and its draft skeletons. The pilot drafting (step 4 of the plan) needs the owner and is not part of this run.',
    rulings: R(['P18', 'P26']) + '\n- Exception to implementer-common: this task creates data/exercises/*.json and docs/catalog/lot-a-provisoire.md and may edit docs/catalog/style-guide.md and scripts/exercises/NOTES.md.',
    risks: '(a) Unsafe or wrong instructions, safety entries over 120 characters or with medical vocabulary. (b) Chain members missing so data:validate fails. (c) A sheet not in draft status, or a published sheet in data/. (d) The real API called or .env.local read. (e) The lot A list not following 04 §7.' },
}
for (const id of Object.keys(TASKS)) TASKS[id].issue = ISSUES[id] || null
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

// Minors deferred by the tasks and findings that need an owner ruling, collected for the final review and the report.
const allDeferred = []
const allRulingsNeeded = []

async function runTask(A) {
  const EXP = EXPERT_BY_KIND[A.kind] || EXPERT_BY_KIND.web
  const REPO = LANES[A.lane].repo
  const BRANCH = LANES[A.lane].branch
  const WHERE = whereText(A.lane)
  const T = A.task
  const BRIEF = WS + '\\task-' + T + '-brief.md'
  const REPORT = WS + '\\task-' + T + '-report.md'
  const SPEC = REPO + '\\' + SPEC_B2 + ' and ' + REPO + '\\' + SPEC_04 + ' (authority), plus ' + REPO + '\\' + SPEC_UI + ' for the look'
  const REF = A.issue ? 'Refs #' + A.issue : 'Brique 2, tâche ' + T
  const RUL = COMMON_RULINGS + '\n' + A.rulings
  const MOCK = A.mockups ? ('Mockups for this task (folder ' + MQ + '): ' + A.mockups + '.\n') : ''

  const implPrompt = you(EXP) + WHERE + 'You are implementing Task ' + T + ' (' + A.title + ') of Rune brick 2 (Exercices), on branch ' + BRANCH + ' in ' + REPO + '.\n'
    + 'Project: ' + PROJECT + '\nContext: ' + A.context + '\n' + MOCK
    + '1. Read first: ' + COMMON_IMPL + ' (rules: mandatory separate RED run; check git show --stat HEAD before reporting; never dispatch subagents), then the brick 2 spec ' + REPO + '\\' + SPEC_B2 + ' and ' + REPO + '\\' + SPEC_04 + ' entirely' + (A.kind === 'web' ? ' (and the redesign spec ' + REPO + '\\' + SPEC_UI + ' for tokens, toolkit and motion)' : '') + '.' + String.fromCharCode(10)
    + '2. Your requirements, with exact values and texts to use verbatim: ' + BRIEF + ' (global constraints: ' + GC + ').\n'
    + (A.issue ? '3. Issue to close: #' + A.issue + '.' : '3. No GitHub issue: end the commit body with « Brique 2, tâche ' + T + ' » instead of Closes.') + String.fromCharCode(10)
    + '4. Write your full report to: ' + REPORT + '\n'
    + '5. Controller rulings (they win over the brief where they differ):\n' + RUL + '\n'
    + '6. After your final commit run `' + PKG + ' ' + A.base + ' HEAD` from ' + REPO + ' and return the path it prints as diffPath.\n'
    + 'Your final answer is the structured result.'
  const reviewPrompt = (lens, diffPath, head) => you(EXPERT_LENS[lens]) + WHERE + 'Review Task ' + T + ' (' + A.title + ') of Rune brick 2 (Exercices) through ONE lens only.\n'
    + 'Project: ' + PROJECT + '\nLens: ' + LENS_TEXT[lens] + '\n' + MOCK
    + 'Rules: ' + COMMON_REV + ' (read-only: never modify files, git state or the working tree; never dispatch subagents).\n'
    + 'Inputs: brief ' + BRIEF + '; global constraints ' + GC + '; implementer report ' + REPORT + '; diff ' + diffPath + ' (base ' + A.base + ', head ' + head + ', branch ' + BRANCH + ' in ' + REPO + '); spec ' + SPEC + '.\n'
    + 'Controller rulings already decided (do not report them as defects; do report code that does not follow them):\n' + RUL + '\n'
    + 'Named risks to examine with this lens where relevant:\n' + (A.risks || '(none)') + '\n'
    + 'Report only findings within your lens, each with file and line, a concrete failure scenario and a fix. Severity: Critical = data loss, security or privacy breach, legal text altered, or app unusable; Important = the task cannot be trusted (incorrect or fragile behaviour, missed requirement, accessibility regression, CSP violation, test that asserts nothing); Minor = polish. Your final answer is the structured result.'
  const triagePrompt = all => you('an engineering lead') + 'You merge code-review findings for Task ' + T + ' of Rune brick 2 (Exercices). Below are findings from several reviewers, each tagged with its lens (JSON). Merge duplicates (same root cause gives one finding; keep the highest severity; list all lenses), give each an id T' + T + '-F1, T' + T + '-F2, and so on, and keep file, line, problem and fix precise. For each Minor set minorAction to fix_now if it is cheap (under about 20 lines), low-risk and improves correctness, accessibility, robustness or test strength, else defer. Critical and Important get minorAction n/a. Do not invent findings. Do not read files; work only from this list.\nFindings:\n' + JSON.stringify(all)
  const verifyPrompt = (f, k, head) => {
    const angle = k === 0 ? 'Reproduce the failure: trace the exact code path at HEAD.'
      : k === 1 ? 'Look for an existing guard elsewhere (callers, server side, other modules, tests) that already prevents the failure.'
      : 'Check the brief, the rulings and the spec: is the flagged behaviour actually required, allowed, or out of scope for this task?'
    return you(EXPERT_VERIFY[k]) + WHERE + 'Adversarially verify one code-review finding on Rune brick 2 (Exercices) (branch ' + BRANCH + ', ' + REPO + ', HEAD ' + head + '). Try hard to REFUTE it. ' + angle + ' Read-only: do not modify files or git state; never dispatch subagents.\n'
      + 'Finding ' + f.id + ' [' + f.severity + '] ' + f.file + ':' + f.line + ' - ' + f.title + '\n'
      + 'Problem: ' + f.problem + '\nProposed fix: ' + f.fix + '\nSpec ref: ' + f.specRef + '\n'
      + 'Brief: ' + BRIEF + '; spec: ' + SPEC + '.\n' + MOCK + 'Controller rulings:\n' + RUL + '\n'
      + 'Answer real=true only if a concrete failure scenario exists at HEAD. If real, give the severity you would assign and planConflict: none if the fix does not contradict the brief; spec_wins if the brief mandates the defect but the spec supports the fix; product_choice if neither the brief nor the spec decides it and it is a product decision for the owner. If you cannot confirm a concrete failure, answer real=false. Your final answer is the structured result.'
  }
  const fixPrompt = (items, round, head) => you(EXP) + WHERE + 'Fix round ' + round + ' for Task ' + T + ' (' + A.title + ') of Rune brick 2 (Exercices), branch ' + BRANCH + ', ' + REPO + ', current HEAD ' + head + '.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\n' + MOCK + 'Controller rulings:\n' + RUL + '\n'
    + 'Fix each finding below in new commit(s) whose message ends with "' + REF + '" and the Co-Authored-By trailer. For each, write or adjust the covering test first and see it fail when that is meaningful (RED), then fix (GREEN). Run the covering tests, then pnpm lint, pnpm typecheck and pnpm test (and the E2E specs touched); check git show --stat HEAD and git status. Append a fix report (changes, tests, commands, output) to ' + REPORT + '. If a finding turns out to be wrong after checking the code and spec, do not apply it and explain why in notAddressed. Never dispatch subagents.\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\n'
    + 'After your final commit run `' + PKG + ' ' + head + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'
  const rereviewPrompt = (items, fixDiff, fromHead, head) => you('a senior reviewer who checks fixes precisely and spots regressions') + WHERE + 'Scoped re-review of a fix round for Task ' + T + ' of Rune brick 2 (Exercices). Rules: ' + COMMON_REV + ', section "Scoped re-review rules" (read-only; never dispatch subagents). Inputs: brief ' + BRIEF + '; report ' + REPORT + ' (fix report at the end); fix diff ' + fixDiff + ' (' + fromHead + '..' + head + ').\n'
    + 'For each finding below, say whether the fix diff addresses it, with file:line evidence; when a covering test was needed, check it exists and would fail without the fix. Then list only NEW Critical or Important breakage introduced by the fix diff (Minor new issues may be listed with severity Minor). Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'
  const fixWt = (round, k) => REPO.replace(/\\/g, '/') + '-fix-T' + T + '-r' + round + '-g' + k
  const fixBr = (round, k) => 'fix/T' + T + '-r' + round + '-g' + k
  const pfixPrompt = (items, k, n, round, head) => you(EXP) + WHERE
    + 'Exception to any rule above about where you work: you create and work in your OWN fix worktree ' + fixWt(round, k) + ' (branch ' + fixBr(round, k) + '), and nowhere else.\n'
    + 'Parallel fix group ' + k + ' of ' + n + ', round ' + round + ', for Task ' + T + ' (' + A.title + ') of Rune brick 2 (Exercices). Other experts fix the other findings at the same time in their own worktrees: fix ONLY the findings below and touch as few files as possible.\n'
    + 'Setup, from ' + REPO + ': if ' + fixWt(round, k) + ' or branch ' + fixBr(round, k) + ' exists from an earlier attempt, remove it (`git worktree remove --force`, `git branch -D`). Then `git worktree add ' + fixWt(round, k) + ' -b ' + fixBr(round, k) + ' ' + head + '`, cd there for EVERY later command, and run `pnpm install --prefer-offline --frozen-lockfile`. Never modify ' + REPO + ' itself, its branch ' + BRANCH + ', or any other worktree.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\n' + MOCK + 'Controller rulings:\n' + RUL + '\n'
    + 'For each finding, write or adjust the covering test first and see it fail when meaningful (RED), then fix (GREEN). Run the covering tests, pnpm lint, pnpm typecheck and the tests of the package(s) you touched. Commit on ' + fixBr(round, k) + ' with messages ending "' + REF + '" and the Co-Authored-By trailer. Leave the worktree in place (the integrator removes it). Do NOT write to the report file: put your fix notes (changes, tests, RED/GREEN evidence) in `notes`. Never dispatch subagents.\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'
  const integratePrompt = (parts, round, head) => you('a senior engineer who integrates parallel fix branches cleanly') + WHERE
    + 'Integrate the parallel fix branches of round ' + round + ' for Task ' + T + ' (' + A.title + ') into branch ' + BRANCH + ' in ' + REPO + ' (current HEAD ' + head + ').\n'
    + 'Branches, in order (JSON with each group\'s branch, worktree, findings and notes):\n' + JSON.stringify(parts) + '\n'
    + 'For each branch: `git cherry-pick ' + head + '..<branch>` (keep history linear, no merge commits). On a conflict, resolve it so that BOTH fixes keep working, and record how. Then run pnpm lint, pnpm typecheck and the full pnpm test; fix any integration breakage in a new commit ending "' + REF + '" with the Co-Authored-By trailer. Append ONE fix report for this round to ' + REPORT + ' (each group\'s changes and tests from its notes, the conflicts you resolved, the final command outputs). Then remove every fix worktree (`git worktree remove --force <path>`) and delete the fix branches. Check git status and git show --stat HEAD. Read ' + COMMON_IMPL + ' for the rules; never dispatch subagents.\n'
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
    log('T' + T + ': review and verification reused from an earlier run')
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
// ---------------------------------------------------------------------------
// Orchestration. Restartable without resume: args.done = { '1': '<sha>', ... } marks closed tasks (their head is reused),
// args.presets = { '<id>': { head, diffPath, preVerified } } restarts a task after its implementation,
// args.merge1Head skips phases 1 and 2, args.phase3Head skips up to the end of phase 3, args.t18Head skips phase 4.
// ---------------------------------------------------------------------------
if (!START) return { stoppedAt: 'start', error: 'args.start missing: socle HEAD once the redesign is merged' }
const DONE = (args && args.done) || {}
const PRESETS = (args && args.presets) || {}
const A_TASKS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const B_TASKS = ['10', '11']
const C_TASKS = ['12', '13', '14']
const B_FORK = (args && args.bFork) || B_FORK_DEFAULT
const C_FORK = (args && args.cFork) || C_FORK_DEFAULT

const setupPrompt = you('a careful build engineer') + 'Prepare brick 2 in ' + ROOT + '. The redesign is merged into socle at ' + START + '.\n'
  + '1. `git status` must be clean (ignore untracked files under .superpowers/). If not clean, stop with ok=false and the list in notes.\n'
  + '2. If branch brique-2 does not exist: `git switch -c brique-2 ' + START + '`. If it exists: it must contain ' + START + ' (`git merge-base --is-ancestor ' + START + ' brique-2`); switch to it; never reset or rewrite it; report its HEAD.\n'
  + '3. `pnpm install --frozen-lockfile`, then `pnpm typecheck` (must pass).\n'
  + 'Never modify any other branch or worktree; never push; never dispatch subagents. ok=true when the checkout is on brique-2 with dependencies installed and typecheck green; head = HEAD short SHA; tests = command summary; conflicts = []. Your final answer is the structured result.'

const worktreePrompt = (laneKey, head) => {
  const L = LANES[laneKey]
  const path = L.repo.replace(/\\/g, '/')
  return you('a careful build engineer') + 'In ' + ROOT + ': make sure the git worktree ' + path + ' exists on branch ' + L.branch + ' at exactly ' + head + ' (a commit of branch brique-2).\n'
    + '- If it is registered, clean and at ' + head + ', keep it. If ' + L.branch + ' has commits beyond ' + head + ', do NOT touch it: ok=false with the commits in notes.\n'
    + '- If it is registered with no commit beyond ' + head + ': `git worktree remove ' + path + '` (never --force; it fails on a dirty tree: then ok=false), `git branch -d ' + L.branch + '` (or -D only when the branch has no commit beyond ' + head + ').\n'
    + '- If the folder exists but is not a registered worktree (leftover empty folders or pnpm links), rename it to ' + path + '.restes-' + head + ' instead of deleting it.\n'
    + '- Create: `git worktree add ' + path + ' -b ' + L.branch + ' ' + head + '`, then run `pnpm install --prefer-offline --frozen-lockfile` in it.\n'
    + 'Never modify ' + ROOT + ' itself or any other worktree; never push; never dispatch subagents. ok=true when the worktree exists at ' + head + ' with dependencies installed; head = ' + head + '; tests = install summary; conflicts = []. Your final answer is the structured result.'
}

async function runSeq(laneKey, ids, startHead, onReach) {
  let head = startHead
  const results = []
  for (const id of ids) {
    if (DONE[id]) { head = DONE[id]; results.push({ task: id, head, note: 'closed earlier' }); if (onReach) onReach(id, head); continue }
    const r = await runLane(laneKey, [id], head, PRESETS)
    results.push(...(r.results || []))
    if (!r.ok) return { lane: laneKey, ok: false, head: r.head, results }
    head = r.head
    if (onReach) onReach(id, head)
  }
  return { lane: laneKey, ok: true, head, results }
}

let m1 = null, l2 = null, l3 = null
const lanes = []
if (args && args.merge1Head) {
  m1 = { ok: true, head: args.merge1Head, note: 'given in args' }
} else {
  phase('Setup')
  if (!DONE['1']) {
    const st = await lim(setupPrompt, { phase: 'Setup', label: 'Castor · setup brique-2', schema: MERGE_SCHEMA, model: 'sonnet' })
    if (!st || !st.ok) return { stoppedAt: 'setup', setup: st }
  }

  // Phase 1: lane A (contracts, domain, server) on brique-2; lane B (tooling) forks from the T{B_FORK} head; lane C (web) from the T{C_FORK} head.
  log('Phase 1: lane A T1-T9; lane B T10-T11 after T' + B_FORK + '; lane C T12-T14 after T' + C_FORK)
  const reach = {}
  const reached = {}
  for (const id of A_TASKS) reached[id] = new Promise(r => { reach[id] = r })
  const laneA = runSeq('A', A_TASKS, START, (id, head) => reach[id](head)).then(r => { A_TASKS.forEach(id => reach[id](null)); return r })
  const fork = async (laneKey, forkId, ids) => {
    const h = await reached[forkId]
    if (!h) return { lane: laneKey, ok: false, error: 'lane A stopped before T' + forkId, results: [] }
    if (ids.every(id => DONE[id])) return runSeq(laneKey, ids, h)
    const wt = await lim(worktreePrompt(laneKey, h), { phase: 'Setup', label: 'Castor · worktree ' + laneKey, schema: MERGE_SCHEMA, model: 'sonnet' })
    if (!wt || !wt.ok) return { lane: laneKey, ok: false, error: 'worktree ' + laneKey, worktree: wt, results: [] }
    return runSeq(laneKey, ids, h)
  }
  const [la, lb, lc] = await parallel([() => laneA, () => fork('B', B_FORK, B_TASKS), () => fork('C', C_FORK, C_TASKS)])
  lanes.push(la, lb, lc)
  if (!la || !la.ok || !lb || !lb.ok || !lc || !lc.ok) return { stoppedAt: 'phase 1', lanes, deferred: allDeferred, needsRuling: allRulingsNeeded }

  const merge1Prompt = you('a senior engineer who integrates branches cleanly and keeps every suite green') + whereText('A')
    + 'Exception: you may read the branches brique-2-outils and brique-2-web and at the end remove their worktrees, as described below.\n'
    + 'Integrate lanes B and C into brique-2 in ' + ROOT + ' (current HEAD ' + la.head + '; brique-2-outils at ' + lb.head + '; brique-2-web at ' + lc.head + '). Project: ' + PROJECT + '\n'
    + '0. `git merge --no-ff brique-2-outils` with message « merge: client IA, rédaction et illustrations (tâches 10 et 11) dans la brique 2 » (body: the Refs line(s) of tasks 10 and 11 if issues exist, blank line, Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>).\n'
    + '1. `git merge --no-ff brique-2-web` with message « merge: dépôt du catalogue, fiche et onglet Exercices (tâches 12 à 14) dans la brique 2 » (same body rule). Resolve conflicts so every task keeps its behaviour (package.json scripts, vitest config, CI steps, App.tsx routes, contracts index exports); record each conflict.\n'
    + '2. pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test, pnpm data:validate, pnpm svg:check, pnpm test:infra (Git Bash), and the whole E2E suite `pnpm --filter @rune/web test:e2e` (Chromium and WebKit): ALL green; fix integration breakage in new commits with the trailer.\n'
    + '3. Remove the worktrees with `git worktree remove C:/Users/eliott.colin/rune-outils` and `git worktree remove C:/Users/eliott.colin/rune-web` (never --force; only if clean), then `git branch -d brique-2-outils brique-2-web`. If a folder stays behind with only empty folders or pnpm links, rename it to <name>.restes instead of deleting it.\n'
    + 'Write a short merge report to ' + WS + '\\merge-1-report.md. Rules: ' + COMMON_IMPL + '. Never push; never dispatch subagents. ok=true only when every suite is green. Your final answer is the structured result.'
  log('Merge 1: brique-2-outils and brique-2-web into brique-2')
  m1 = await lim(merge1Prompt, { phase: 'Merge', label: 'Castor · merge 1', schema: MERGE_SCHEMA, model: 'opus' })
  if (!m1 || !m1.ok) return { stoppedAt: 'merge 1', lanes, merge1: m1, deferred: allDeferred, needsRuling: allRulingsNeeded }
}

// Phase 2: review screens and admin tools on brique-2.
if (args && args.phase3Head) {
  l2 = { lane: 'A', ok: true, head: args.phase3Head, results: [], note: 'given in args' }
} else {
  log('Phase 2: T15-T17 on brique-2 from ' + m1.head)
  l2 = await runSeq('A', ['15', '16', '17'], m1.head)
  lanes.push(l2)
  if (!l2.ok) return { stoppedAt: 'phase 2', lanes, merge1: m1, deferred: allDeferred, needsRuling: allRulingsNeeded }
}

// Phase 3: reference sheets and lot A skeletons (the pilot needs the owner: it is not run here).
if (args && args.t18Head) {
  l3 = { lane: 'A', ok: true, head: args.t18Head, results: [], note: 'given in args' }
} else {
  l3 = await runSeq('A', ['18'], l2.head)
  lanes.push(l3)
  if (!l3.ok) return { stoppedAt: 'phase 3', lanes, merge1: m1, deferred: allDeferred, needsRuling: allRulingsNeeded }
}

// Phase 4: final whole-range review of START..HEAD.
const FR_AREAS = [
  { key: 'back', nick: 'Aigle 1', focus: 'contracts, domain and server: packages/contracts, packages/domain, apps/server. One shared domain function per rule (no re-implementation in server, scripts or web), migration 0003 and entityRules, loader merge rules, served bundle contents and catalog_version, revision control and concurrency, transitions and blockers in the spec order, review API visibility (reviewers never see what the §3.1 table hides), health green light rules, export and account deletion, admin isolation, error codes.' },
  { key: 'front', nick: 'Aigle 2', focus: 'the web as one product: apps/web/src, apps/web/test, apps/web/e2e. Exercises tab, group list, tabbed sheet with the safety box on every tab, cautious profile on every surface (search, variants, chains, substitutes, direct URL, Progression link), missing catalogue online and offline, review screens and admin tools, lost reviewer access, comment draft cleanup, tab bar and navigation after Salles became Exercices, accessibility, the 5 themes, CSP.' },
  { key: 'outils', nick: 'Aigle 3', focus: 'tooling, data and docs: scripts/, data/, docs/catalog, docs/fiche-de-traitement.md, privacy texts, CI, package.json scripts. Validator rules (04 §13 criterion 1), canonical JSON with LF, export to data:pull round trip, AI client (no network in tests, no key in files, stop_reason handling, only AI fields touched), SVG sanitising and size checks, Crédits generated from the manifest, reference sheets and lot A skeletons quality and safety, the style guide and glossary.' },
  { key: 'tests', nick: 'Aigle 4', focus: 'test strength across the range: every brick 2 §7 and 04 §13 criterion and the five Review Focus scenarios of the plan have a test that would fail on a plausible bug; flaky patterns; and triage of the deferred minors listed below (report as findings the ones that must be fixed before the brick is called done).' },
]
const FR_SCHEMA = REVIEW_SCHEMA
const frHead = l3.head
const frPrompt = a => you('a principal engineer doing the final whole-branch review of a feature brick before it is called done') + whereText('A')
  + 'Final review of Rune brick 2, range ' + START + '..HEAD on branch brique-2 in ' + ROOT + ' (HEAD ' + frHead + '). Project: ' + PROJECT + '\n'
  + 'Your area: ' + a.focus + '\n'
  + 'Read the brick 2 spec ' + SPEC_B2 + ', ' + SPEC_04 + ', the global constraints ' + GC + ', and the ledger ' + LEDGER + ' (rulings). Use read-only git commands (git diff ' + START + '..HEAD -- <paths>, git log, git show) and file reads; never modify files or git state; never dispatch subagents. Mockups for visual intent: ' + MQ + '.\n'
  + 'Deferred minors collected during the tasks (JSON):\n' + JSON.stringify(allDeferred) + '\n'
  + 'Report only real defects in your area, each with file and line, a concrete failure scenario and a fix. Severity: Critical = data loss, security or privacy breach, a minor seeing a not_for_minors sheet, app unusable; Important = must be fixed before the brick is done (incorrect or fragile behaviour, missed spec requirement, accessibility regression, test that asserts nothing); Minor = can wait. Your final answer is the structured result.'
log('Phase 4: final review of ' + START + '..' + frHead)
const frRaw = (await parallel(FR_AREAS.map(a => () =>
  lim(frPrompt(a), { phase: 'Final review', label: a.nick + ' · final review:' + a.key, schema: FR_SCHEMA, effort: 'high' })
    .then(r => (r ? r.findings.map(f => Object.assign({}, f, { lens: a.key })) : []))))).flat()
let frMerged = []
if (frRaw.length) {
  const tri = await lim(you('an engineering lead') + 'Merge these final-review findings of Rune brick 2: merge duplicates (keep the highest severity, list all lenses), ids FR-1, FR-2, …, keep file, line, problem and fix precise; Minor findings get minorAction fix_now when cheap and low-risk, else defer; Critical and Important get n/a. Do not read files.\nFindings:\n' + JSON.stringify(frRaw), { phase: 'Final review', label: 'Écureuil · final triage', schema: TRIAGE_SCHEMA, model: 'sonnet', effort: 'low' })
  frMerged = (tri && tri.findings) || frRaw.map((f, i) => Object.assign({}, f, { id: 'FR-' + (i + 1), lenses: [f.lens], minorAction: f.severity === 'Minor' ? 'defer' : 'n/a' }))
}
const frSerious = frMerged.filter(f => f.severity !== 'Minor')
const frVerified = (await parallel(frSerious.map(f => () =>
  parallel([0, 1, 2].map(k => () =>
    lim(you(EXPERT_VERIFY[k]) + whereText('A') + 'Adversarially verify one final-review finding on Rune brick 2 (branch brique-2, ' + ROOT + ', HEAD ' + frHead + '). Try hard to REFUTE it. Read-only; never dispatch subagents.\nFinding ' + f.id + ' [' + f.severity + '] ' + f.file + ':' + f.line + ' - ' + f.title + '\nProblem: ' + f.problem + '\nProposed fix: ' + f.fix + '\nSpecs: ' + SPEC_B2 + ', ' + SPEC_04 + '; rulings in ' + LEDGER + '.\nAnswer real=true only if a concrete failure scenario exists at HEAD; planConflict product_choice if it is a product decision for the owner. Your final answer is the structured result.', { phase: 'Final review', label: 'Corbeau ' + (k + 1) + ' · verify ' + f.id, schema: VERDICT_SCHEMA, effort: 'high' })))
    .then(vs => { const v = vs.filter(Boolean); const yes = v.filter(x => x.real); return Object.assign({}, f, { real: yes.length >= 2, product: yes.filter(x => x.planConflict === 'product_choice').length >= 2 }) })))).filter(Boolean)
const frConfirmed = frVerified.filter(f => f.real && !f.product)
const frProduct = frVerified.filter(f => f.real && f.product)
const frFixNow = frConfirmed.concat(frMerged.filter(f => f.severity === 'Minor' && f.minorAction === 'fix_now'))
log('Final review: ' + frRaw.length + ' raw, ' + frConfirmed.length + ' confirmed, ' + frProduct.length + ' product choices, ' + frFixNow.length + ' to fix')
let frFix = null, frRe = null
if (frFixNow.length) {
  const REPORT = WS + '\\final-fix-report.md'
  frFix = await lim(you(EXPERT_BY_KIND.web + ', also at ease with the Node server, the domain package and the scripts') + whereText('A') + 'One fix wave for the final review of Rune brick 2, branch brique-2, ' + ROOT + ', HEAD ' + frHead + '. Read ' + COMMON_IMPL + ' (rules). For each finding below: covering test first (RED when meaningful), fix (GREEN), commits in French ending with the Co-Authored-By trailer. Then pnpm lint, pnpm typecheck, pnpm test, pnpm data:validate, pnpm svg:check, pnpm test:infra (Git Bash) and the whole E2E suite: all green. Write the report to ' + REPORT + '. If a finding is wrong after checking, explain in notAddressed. Never dispatch subagents.\nFindings (JSON):\n' + JSON.stringify(frFixNow) + '\nAfter your final commit run `' + PKG + ' ' + frHead + ' HEAD` from ' + ROOT + ' and return its printed path as fixDiffPath. Your final answer is the structured result.', { phase: 'Final review', label: 'Castor · final fix wave', schema: FIX_SCHEMA, model: 'opus' })
  if (frFix) frRe = await lim(you('a senior reviewer who checks fixes precisely and spots regressions') + whereText('A') + 'Scoped re-review of the final fix wave of Rune brick 2. Rules: ' + COMMON_REV + ', section "Scoped re-review rules" (read-only; never dispatch subagents). Fix report ' + WS + '\\final-fix-report.md; fix diff ' + frFix.fixDiffPath + ' (' + frHead + '..' + frFix.head + '). For each finding say whether the fix addresses it with file:line evidence, then list only NEW breakage. Findings (JSON):\n' + JSON.stringify(frFixNow) + '\nYour final answer is the structured result.', { phase: 'Final review', label: 'Hibou · final re-review', schema: REREVIEW_SCHEMA })
}
const residual = frRe ? frFixNow.filter(f => { const r = frRe.results.find(x => x.id === f.id); return !r || !r.addressed }).map(f => ({ id: f.id, severity: f.severity, title: f.title, file: f.file })) : frFixNow.map(f => ({ id: f.id, severity: f.severity, title: f.title }))

return {
  done: true,
  lanes,
  merge1: m1,
  finalHead: frFix ? frFix.head : frHead,
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
  pilot: 'Task 18 step 4 (pilot drafting with the Claude API) needs the owner: API key in .env.local and the lot A list validated.',
}
