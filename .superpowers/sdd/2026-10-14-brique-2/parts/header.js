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
