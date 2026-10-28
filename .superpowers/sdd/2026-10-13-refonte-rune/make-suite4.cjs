// Builds refonte-rune-suite4.workflow.js from suite3: continuation of 2026-10-15 afternoon from explicit heads.
const fs = require('fs')
const path = require('path')
const dir = __dirname
const src = fs.readFileSync(path.join(dir, 'refonte-rune-suite3.workflow.js'), 'utf8').split('\n')
const outFile = process.argv[2]
const run = JSON.parse(fs.readFileSync(outFile, 'utf8'))
const result = typeof run.result === 'string' ? JSON.parse(run.result) : run.result

const iDefStart = src.findIndex((l) => l.startsWith('const allDeferred = ['))
const iDefEnd = src.findIndex((l, i) => i > iDefStart && l.startsWith('const allRulingsNeeded'))
const iCont = src.findIndex((l) => l.startsWith('// Done by the first run wf_5a957f90-431'))
const iMerge2 = src.findIndex((l) => l.startsWith('const merge2Prompt'))
if ([iDefStart, iDefEnd, iCont, iMerge2].some((i) => i < 0)) throw new Error('anchor not found')

const deferred = result.deferred || []
const newCont = [
  '// Continuation written 2026-10-15 after the usage limit cut run wf_c5fdbec3-21f (no resume: parallel lanes).',
  '// Closed in that run: T7 on socle (e18a259), T11 on socle-ecrans (b1bb6ef), both reviewed, fixed and green.',
  '// T8 (socle), T10 (socle-profil in rune-profil) and T12 (socle-ecrans) were cut while implementing: their uncommitted',
  '// work stays in the working trees, snapshots in refs/wip/T8, refs/wip/T10, refs/wip/T12.',
  "const WIP_NOTE = id => ' RESUME NOTE: an earlier implementer of this same task was cut off by a usage limit before committing. Its uncommitted work is in your working tree (git status, git diff; a snapshot is saved as ref refs/wip/T' + id + '). Review it critically against the brief and the rulings, keep what is right, fix or drop the rest, then finish the task. TDD evidence: for tests already present, show RED by copying your changed source files to your scratchpad, putting back the HEAD versions with git show HEAD:<path> > <path>, running the tests, then copying your files back (never git stash: the stash list is shared by every worktree). Never git reset, git checkout -- or git clean the work in progress away.'",
  "const P = { '8': { context: TASKS['8'].context + WIP_NOTE('8') }, '10': { context: TASKS['10'].context + WIP_NOTE('10') }, '12': { context: TASKS['12'].context + WIP_NOTE('12') } }",
  "const A7 = (args && args.a7Head) || 'e18a259'",
  "const B11 = (args && args.b11Head) || 'b1bb6ef'",
  "const done7 = { task: '7', head: A7, note: 'closed in run wf_c5fdbec3-21f' }",
  "const done11 = { task: '11', head: B11, note: 'closed in run wf_c5fdbec3-21f' }",
  'const p1 = []',
  "const m1 = { ok: true, head: '35d89f5' }",
  "log('Phase 3 (continuation): lane A T8-T9 from ' + A7 + ', lane C T10 in rune-profil from ' + A7 + ', lane B T12-T13 in rune-ecrans from ' + B11)",
  'const p3raw = await parallel([',
  "  () => runLane('A', ['8', '9'], A7, P),",
  "  () => runLane('C', ['10'], A7, P),",
  "  () => runLane('B', ['12', '13'], B11, P),",
  '])',
  'const la2 = p3raw[0] ? Object.assign({}, p3raw[0], { results: [done7].concat(p3raw[0].results || []) }) : null',
  'const lc = p3raw[1]',
  'const lb = p3raw[2] ? Object.assign({}, p3raw[2], { results: [done11].concat(p3raw[2].results || []) }) : null',
  'const p3 = [la2, lc, lb]',
  "if (!la2 || !la2.ok || !lc || !lc.ok || !lb || !lb.ok) return { stoppedAt: 'phase 3', lanes: p3, deferred: allDeferred, needsRuling: allRulingsNeeded }",
  '',
]
const out = [].concat(
  src.slice(0, iDefStart),
  ['// Minors deferred so far (first run, T0-T6, T14, D, then T7 and T11 in wf_c5fdbec3-21f), copied from its result.', 'const allDeferred = ' + JSON.stringify(deferred, null, 0)],
  src.slice(iDefEnd, iCont),
  newCont,
  src.slice(iMerge2),
).join('\n')
  .replace("name: 'refonte-rune-e',", "name: 'refonte-rune-f',")
  .replace("description: 'Rune redesign from merge 1 on: screens T7-T13 in three lanes, merge 2, sweep T15, check T16, final whole-range review',", "description: 'Rune redesign continuation: T8-T9, T10, T12-T13 from explicit heads (WIP kept), merge 2, T15, T16, final review',")
fs.writeFileSync(path.join(dir, 'refonte-rune-suite4.workflow.js'), out)
console.log('suite4 written,', out.split('\n').length, 'lines,', deferred.length, 'deferred minors')
