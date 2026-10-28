// Builds parts/engine.js from the refonte script engine (schemas, groupFindings, runTask, runLane), adapted to brick 2.
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '..', '..', '2026-10-13-refonte-rune', 'refonte-rune-suite3.workflow.js'), 'utf8').split('\n')
const L = (a, b) => src.slice(a - 1, b)
const schemas = L(148, 204).join('\n')
const group = L(245, 262).join('\n')
const run = L(285, 458)
const BS = String.fromCharCode(92)

function replaceLine(lines, needle, replacement) {
  const i = lines.findIndex((l) => l.includes(needle))
  if (i < 0) throw new Error('line not found: ' + needle)
  lines[i] = replacement
}
function replaceAll(lines, a, b) {
  let n = 0
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(a)) { lines[i] = lines[i].split(a).join(b); n++ }
  if (!n) throw new Error('text not found: ' + a)
}

replaceLine(run, 'const SPEC = REPO +',
  "  const SPEC = REPO + '" + BS + BS + "' + SPEC_B2 + ' and ' + REPO + '" + BS + BS + "' + SPEC_04 + ' (authority), plus ' + REPO + '" + BS + BS + "' + SPEC_UI + ' for the look'\n  const REF = A.issue ? 'Refs #' + A.issue : 'Brique 2, tâche ' + T")
replaceLine(run, "+ '1. Read first: '",
  "    + '1. Read first: ' + COMMON_IMPL + ' (rules: mandatory separate RED run; check git show --stat HEAD before reporting; never dispatch subagents), then the brick 2 spec ' + REPO + '" + BS + BS + "' + SPEC_B2 + ' and ' + REPO + '" + BS + BS + "' + SPEC_04 + ' entirely' + (A.kind === 'web' ? ' (and the redesign spec ' + REPO + '" + BS + BS + "' + SPEC_UI + ' for tokens, toolkit and motion)' : '') + '.' + String.fromCharCode(10)")
replaceLine(run, "+ '3. Issue to close: #'",
  "    + (A.issue ? '3. Issue to close: #' + A.issue + '.' : '3. No GitHub issue: end the commit body with « Brique 2, tâche ' + T + ' » instead of Closes.') + String.fromCharCode(10)")
replaceAll(run, "Refs #' + A.issue + '", "' + REF + '")
replaceAll(run, 'of the Rune redesign', 'of Rune brick 2 (Exercices)')
replaceAll(run, 'on the Rune redesign', 'on Rune brick 2 (Exercices)')
replaceLine(run, 'review and verification reused from the journal', "    log('T' + T + ': review and verification reused from an earlier run')")

const out = [schemas, '', group, '',
  '// Minors deferred by the tasks and findings that need an owner ruling, collected for the final review and the report.',
  'const allDeferred = []', 'const allRulingsNeeded = []', '', run.join('\n')].join('\n')
fs.writeFileSync(path.join(__dirname, 'engine.js'), out)
const left = (out.match(/redesign|refonte|wf_4/g) || [])
console.log('engine.js', out.split('\n').length, 'lines; leftovers:', left.join(', ') || 'none')
