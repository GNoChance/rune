
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
