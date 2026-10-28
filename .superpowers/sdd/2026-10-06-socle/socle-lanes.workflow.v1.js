export const meta = {
  name: 'socle-lanes',
  description: 'Continue the socle plan in parallel lanes (implement, multi-lens review, adversarial verify, fix loop) with at most 5 agents running at once',
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

const MAX = args.maxAgents || 5
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

async function runTask(A) {
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

  const implPrompt = WHERE + 'You are implementing Task ' + T + ' (' + A.title + ') of appsport\'s socle, a private French strength-training PWA (pnpm TS monorepo), on branch ' + BRANCH + ' in ' + REPO + '.\n'
    + 'Context: ' + (A.context || '') + '\n'
    + '1. Read first: ' + COMMON_IMPL + ' (rules: mandatory separate RED run; check git show --stat HEAD before reporting; never dispatch subagents).\n'
    + '2. Your requirements, with exact values and texts to use verbatim: ' + BRIEF + '\n'
    + '3. Issue to close: #' + A.issue + '.\n'
    + '4. Write your full report to: ' + REPORT + '\n'
    + '5. Controller rulings (they win over the brief where they differ):\n' + A.rulings + '\n'
    + '6. After your final commit run `' + PKG + ' ' + A.base + ' HEAD` from ' + REPO + ' and return the path it prints as diffPath.\n'
    + 'Your final answer is the structured result.'
  const reviewPrompt = (lens, diffPath, head) => WHERE + 'Review Task ' + T + ' (' + A.title + ') of appsport\'s socle through ONE lens only.\n'
    + 'Lens: ' + LENS_TEXT[lens] + '\n'
    + 'Rules: ' + COMMON_REV + ' (read-only: never modify files, git state or the working tree; never dispatch subagents).\n'
    + 'Inputs: brief ' + BRIEF + '; global constraints ' + GC + '; implementer report ' + REPORT + '; diff ' + diffPath + ' (base ' + A.base + ', head ' + head + '); spec ' + SPEC + '.\n'
    + 'Controller rulings already decided (do not report them as defects; do report code that does not follow them):\n' + A.rulings + '\n'
    + 'Named risks to examine with this lens where relevant:\n' + (A.risks || '(none)') + '\n'
    + 'Report only findings within your lens, each with file and line, a concrete failure scenario and a fix. Severity: Critical = data loss, security or privacy breach, or app unusable; Important = the task cannot be trusted (incorrect or fragile behaviour, missed requirement, test that asserts nothing); Minor = polish. Your final answer is the structured result.'
  const triagePrompt = all => 'You merge code-review findings for Task ' + T + ' of appsport\'s socle. Below are findings from several reviewers, each tagged with its lens (JSON). Merge duplicates (same root cause gives one finding; keep the highest severity; list all lenses), give each an id T' + T + '-F1, T' + T + '-F2, and so on, and keep file, line, problem and fix precise. For each Minor set minorAction to fix_now if it is cheap (under about 20 lines), low-risk and improves correctness, robustness or test strength for later tasks, else defer. Critical and Important get minorAction n/a. Do not invent findings. Do not read files; work only from this list.\nFindings:\n' + JSON.stringify(all)
  const verifyPrompt = (f, k, head) => {
    const angle = k === 0 ? 'Reproduce the failure: trace the exact code path at HEAD.'
      : k === 1 ? 'Look for an existing guard elsewhere (callers, server side, other modules, tests) that already prevents the failure.'
      : 'Check the brief and the spec: is the flagged behaviour actually required, allowed, or out of scope for this task?'
    return WHERE + 'Adversarially verify one code-review finding on appsport\'s socle (branch ' + BRANCH + ', ' + REPO + ', HEAD ' + head + '). Try hard to REFUTE it. ' + angle + ' Read-only: do not modify files or git state; never dispatch subagents.\n'
      + 'Finding ' + f.id + ' [' + f.severity + '] ' + f.file + ':' + f.line + ' - ' + f.title + '\n'
      + 'Problem: ' + f.problem + '\nProposed fix: ' + f.fix + '\nSpec ref: ' + f.specRef + '\n'
      + 'Brief: ' + BRIEF + '; spec: ' + SPEC + '.\nController rulings:\n' + A.rulings + '\n'
      + 'Answer real=true only if a concrete failure scenario exists at HEAD. If real, give the severity you would assign and planConflict: none if the fix does not contradict the brief; spec_wins if the brief mandates the defect but the spec supports the fix; product_choice if neither the brief nor the spec decides it and it is a product decision for the owner. If you cannot confirm a concrete failure, answer real=false. Your final answer is the structured result.'
  }
  const fixPrompt = (items, round, head) => WHERE + 'Fix round ' + round + ' for Task ' + T + ' (' + A.title + ') of appsport\'s socle, branch ' + BRANCH + ', ' + REPO + ', current HEAD ' + head + '.\n'
    + 'Read ' + COMMON_IMPL + ' (rules) and ' + REPORT + ' (what was built). Brief: ' + BRIEF + '.\nController rulings:\n' + A.rulings + '\n'
    + 'Fix each finding below in new commit(s) whose message ends with "Refs #' + A.issue + '" and the Co-Authored-By trailer. For each, write or adjust the covering test first and see it fail when that is meaningful (RED), then fix (GREEN). Run the covering tests, then pnpm lint, pnpm typecheck and pnpm test; check git show --stat HEAD and git status. Append a fix report (changes, tests, commands, output) to ' + REPORT + '. If a finding turns out to be wrong after checking the code and spec, do not apply it and explain why in notAddressed. Never dispatch subagents. ' + DETAILS + '\n'
    + 'Findings (JSON):\n' + JSON.stringify(items) + '\n'
    + 'After your final commit run `' + PKG + ' ' + head + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'
  const rereviewPrompt = (items, fixDiff, fromHead, head) => WHERE + 'Scoped re-review of a fix round for Task ' + T + ' of appsport\'s socle. Rules: ' + COMMON_REV + ', section "Scoped re-review rules" (read-only; never dispatch subagents). Inputs: brief ' + BRIEF + '; report ' + REPORT + ' (fix report at the end); fix diff ' + fixDiff + ' (' + fromHead + '..' + head + ').\n'
    + 'For each finding below, say whether the fix diff addresses it, with file:line evidence; when a covering test was needed, check it exists and would fail without the fix. Then list only NEW Critical or Important breakage introduced by the fix diff (Minor new issues may be listed with severity Minor). ' + DETAILS + ' Findings (JSON):\n' + JSON.stringify(items) + '\nYour final answer is the structured result.'

  let head = A.head
  let diffPath = A.diffPath
  let impl = null
  if (!head) {
    impl = await lim(implPrompt, { phase: 'Implement', label: 'T' + T + ' implement', schema: IMPL_SCHEMA, model: A.implModel })
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
      lim(reviewPrompt(l, diffPath, head), { phase: 'Review', label: 'T' + T + ' review:' + l, schema: REVIEW_SCHEMA })
        .then(r => (r ? { lens: l, verdict: r.verdict, findings: r.findings, checks: r.checks } : null))))
    reviews = reviewsRaw.filter(Boolean)
    const raw = reviews.flatMap(r => r.findings.map(f => Object.assign({}, f, { lens: r.lens })))
    log('T' + T + ': ' + raw.length + ' raw findings from ' + reviews.length + '/' + lenses.length + ' reviewers')
    let merged = []
    if (raw.length) {
      const tri = await lim(triagePrompt(raw), { phase: 'Triage', label: 'T' + T + ' triage', schema: TRIAGE_SCHEMA, model: 'sonnet', effort: 'low' })
      merged = (tri && tri.findings) || raw.map((f, i) => Object.assign({}, f, { id: 'T' + T + '-F' + (i + 1), lenses: [f.lens], minorAction: f.severity === 'Minor' ? 'defer' : 'n/a' }))
    }
    const serious = merged.filter(f => f.severity !== 'Minor')
    minorsNow = merged.filter(f => f.severity === 'Minor' && f.minorAction === 'fix_now')
    deferred = merged.filter(f => f.severity === 'Minor' && f.minorAction !== 'fix_now')
    let verified = []
    if (serious.length) {
      verified = (await parallel(serious.map(f => () =>
        parallel([0, 1, 2].map(k => () =>
          lim(verifyPrompt(f, k, head), { phase: 'Verify', label: 'T' + T + ' verify ' + f.id + ' #' + (k + 1), schema: VERDICT_SCHEMA, effort: 'high' })))
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
    const fix = await lim(fixPrompt(open, round, head), { phase: 'Fix', label: 'T' + T + ' fix round ' + round, schema: FIX_SCHEMA, model: A.implModel })
    if (!fix) { rounds.push({ round, error: 'fixer returned nothing' }); break }
    const fromHead = head
    head = fix.head
    const rr = await lim(rereviewPrompt(open, fix.fixDiffPath, fromHead, head), { phase: 'Re-review', label: 'T' + T + ' re-review ' + round, schema: REREVIEW_SCHEMA })
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

const lanes = await parallel(args.lanes.map(L => () => runLane(L)))
return { lanes }
