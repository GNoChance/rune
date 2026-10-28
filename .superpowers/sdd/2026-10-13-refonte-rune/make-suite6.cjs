// Builds refonte-rune-suite6.workflow.js from suite5 + the result and journal of run wf_7dfe1429-be9 (cut by the usage limit
// on 2026-10-15 during fix round 1 of T8, T10 and T12). Each task restarts exactly where it stopped (no resume).
const fs = require('fs')
const path = require('path')
const dir = __dirname
const [outFile, journalFile] = process.argv.slice(2)
const run = JSON.parse(fs.readFileSync(outFile, 'utf8'))
const result = typeof run.result === 'string' ? JSON.parse(run.result) : run.result
const journal = fs.readFileSync(journalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const byId = new Map()
for (const o of journal) {
  if (o.type === 'started') byId.set(o.agentId, { label: o.label })
  if (o.type === 'result' && byId.get(o.agentId)) { let r = o.result; try { r = JSON.parse(r) } catch { /* text */ } byId.get(o.agentId).r = r }
}
const results = [...byId.values()]
const find = (label) => results.find((a) => a.label === label)
const task = (id) => result.lanes.flatMap((l) => (l && l.results) || []).find((t) => t.task === id)

function presetFor(id, carry) {
  const t = task(id)
  const impl = find('Castor · T' + id + ' implement').r
  return { head: impl.head, diffPath: impl.diffPath, preVerified: { confirmed: t.remainingOpen, minorsNow: [], deferred: [] }, carry }
}
const part = (id, k) => {
  const r = find('Fourmi ' + k + ' · T' + id + ' fix round 1').r
  return Object.assign({ group: k, ids: r.addressed.concat(r.notAddressed.map((n) => n.id)) }, r)
}
// T8: groups 1 and 2 done (branches fix/T8-r1-g1, g2); group 3 died with partial uncommitted work (refs/wip/T8-r1-g3): redo it as group 4.
const t8open = task('8').remainingOpen.map((f) => f.id)
const t8parts = [part('8', 1), part('8', 2)]
const t8done = new Set(t8parts.flatMap((p) => p.ids))
const t8redo = t8open.filter((id) => !t8done.has(id))
const presets = {
  '8': presetFor('8', { round: 1, parts: t8parts, redoIds: t8redo, redoGroup: 4, redoNote: 'An earlier fixer of these findings was cut by a usage limit; its uncommitted partial work is in C:/Users/eliott.colin/appsport-fix-T8-r1-g3 (snapshot refs/wip/T8-r1-g3): you may read it for ideas, never modify that folder.' }),
  // T10: the 3 groups are committed on fix/T10-r1-g1..g3; only the integration is missing.
  '10': presetFor('10', { round: 1, parts: [part('10', 1), part('10', 2), part('10', 3)] }),
  // T12: the integrator cherry-picked the 6 fix commits of the 3 groups and one integration fix (9de24a6..24e8357), removed the fix
  // worktrees and branches, then died before the full checks and the report.
  '12': presetFor('12', { round: 1, parts: [part('12', 1), part('12', 2), part('12', 3)], integrated: { from: '9de24a6', head: '24e8357' } }),
}

let s = fs.readFileSync(path.join(dir, 'refonte-rune-suite5.workflow.js'), 'utf8')
const rep = (a, b) => { if (!s.includes(a)) throw new Error('not found: ' + a.slice(0, 70)); s = s.replace(a, b) }

// 1. Engine: a task can carry a fix round already in progress.
rep("  let head = A.head\n  let diffPath = A.diffPath\n", [
  '  const finishPrompt = (c, round) => you(\'a senior engineer who integrates parallel fix branches cleanly\') + WHERE',
  "    + 'Finish the integration of fix round ' + round + ' for Task ' + T + ' (' + A.title + ') on branch ' + BRANCH + ' in ' + REPO + '. An earlier integrator was cut by a usage limit after cherry-picking the parallel fix branches (they and their worktrees are gone): the branch went from ' + c.integrated.from + ' to ' + c.integrated.head + '.\\n'",
  "    + 'Groups (JSON with each group\\'s fix head SHA, finding ids and notes):\\n' + JSON.stringify(c.parts) + '\\n'",
  "    + '1. Check that every group\\'s commits are present on ' + BRANCH + ' (compare subjects with git log ' + c.integrated.from + '..<group head SHA>, the SHAs still exist as objects); cherry-pick any missing one.\\n'",
  "    + '2. Run pnpm lint, pnpm typecheck and the full pnpm test; fix any integration breakage in a new commit ending \"Refs #' + A.issue + '\" with the Co-Authored-By trailer.\\n'",
  "    + '3. Append ONE fix report for this round to ' + REPORT + ' (each group\\'s changes and tests from its notes, the integration fix commit(s), the final command outputs). Check git status and git show --stat HEAD. Read ' + COMMON_IMPL + ' for the rules; never use git stash; never dispatch subagents.\\n'",
  "    + 'addressed = the finding ids the groups fixed that survive integration; notAddressed = the others with the reason. After your final commit run `' + PKG + ' ' + c.integrated.from + ' HEAD` from ' + REPO + ' and return its printed path as fixDiffPath. Your final answer is the structured result.'",
  '  async function carryFix(c, round) {',
  '    if (c.integrated) return lim(finishPrompt(c, round), { phase: \'Fix\', label: \'Castor · T\' + T + \' integrate round \' + round, schema: FIX_SCHEMA, model: \'opus\' })',
  '    const parts = c.parts.slice()',
  '    if (c.redoIds && c.redoIds.length) {',
  '      const redo = open.filter(f => c.redoIds.includes(f.id))',
  '      const r = await lim(pfixPrompt(redo, c.redoGroup, c.redoGroup, round, head) + (c.redoNote ? String.fromCharCode(10) + c.redoNote : \'\'), { phase: \'Fix\', label: \'Fourmi \' + c.redoGroup + \' · T\' + T + \' fix round \' + round, schema: PFIX_SCHEMA, model: \'opus\' })',
  '      if (r) parts.push(Object.assign({ group: c.redoGroup, ids: redo.map(f => f.id) }, r))',
  '    }',
  '    return lim(integratePrompt(parts, round, head), { phase: \'Fix\', label: \'Castor · T\' + T + \' integrate round \' + round, schema: FIX_SCHEMA, model: \'opus\' })',
  '  }',
  '  let head = A.head',
  '  let diffPath = A.diffPath',
  '',
].join('\n'))
rep('  let open = confirmed.concat(minorsNow)\n', '  let open = confirmed.concat(minorsNow)\n  let carry = A.carry || null\n')
rep('    const groups = groupFindings(open, 3)\n    let fix = null\n    if (groups.length >= 2) {',
  "    const groups = carry ? [] : groupFindings(open, 3)\n    let fix = null\n    if (carry) {\n      log('T' + T + ' round ' + round + ': continuing the cut fix round')\n      fix = await carryFix(carry, round)\n      if (carry.integrated && fix) fix.from = carry.integrated.from\n      carry = null\n    } else if (groups.length >= 2) {")
// The re-review of a finished integration starts from the integration base.
rep('    const fromHead = head\n', '    const fromHead = fix && fix.from ? fix.from : head\n')
// Never git stash in fixer prompts either (shared stash list).
s = s.split('remove it (`git worktree remove --force`, `git branch -D`)').join('remove it (`git worktree remove --force`, `git branch -D`; never git stash)')

// 2. Orchestration: same heads as suite5, with the presets.
rep("const P = { '8': { context: TASKS['8'].context + WIP_NOTE('8') }, '10': { context: TASKS['10'].context + WIP_NOTE('10') }, '12': { context: TASKS['12'].context + WIP_NOTE('12') } }",
  '// Presets from run wf_7dfe1429-be9: implementation, review and verification done; fix round 1 continues where it stopped.\nconst P = ' + JSON.stringify(presets))
rep("// Continuation written 2026-10-15 after the usage limit cut run wf_c5fdbec3-21f (no resume: parallel lanes).",
  '// Continuation written 2026-10-16 morning after the usage limit cut run wf_7dfe1429-be9 in fix round 1 of T8, T10 and T12 (no resume).')

// 3. Deferred minors: everything collected so far.
const iDef = s.indexOf('const allDeferred = ')
const iEnd = s.indexOf('\n', iDef)
s = s.slice(0, iDef) + 'const allDeferred = ' + JSON.stringify(result.deferred || []) + s.slice(iEnd)
s = s.replace("name: 'refonte-rune-g',", "name: 'refonte-rune-h',").replace("description: 'Rune redesign continuation: T8-T9, T10, T12-T13 from explicit heads (WIP kept), merge 2, T15, T16, final review',", "description: 'Rune redesign continuation: fix round 1 of T8, T10, T12 resumed in place, then T9, T13, merge 2, T15, T16, final review',")
fs.writeFileSync(path.join(dir, 'refonte-rune-suite6.workflow.js'), s)
console.log('suite6 written. T8 redo:', t8redo.join(','), '| T10 parts:', presets['10'].carry.parts.length, '| T12 integrated', presets['12'].carry.integrated.head, '| deferred', (result.deferred || []).length)
