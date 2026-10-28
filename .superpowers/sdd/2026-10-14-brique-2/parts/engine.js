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