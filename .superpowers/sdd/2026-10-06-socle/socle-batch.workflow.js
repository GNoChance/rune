export const meta = {
  name: 'socle-batch',
  description: 'Chain several socle tasks, each through the per-task workflow, stopping on blockers',
  whenToUse: 'Run a sequence of socle plan tasks on one branch',
  phases: [{ title: 'Tasks', detail: 'one per-task workflow after another' }],
}
const A = args
let head = A.startHead
const results = []
for (const t of A.tasks) {
  phase('Tasks')
  const taskArgs = Object.assign({}, t)
  if (!taskArgs.head) taskArgs.base = head
  if (A.repo) { taskArgs.repo = A.repo; taskArgs.branch = A.branch }
  log('Lane ' + (A.lane || '') + ': starting T' + t.task + (taskArgs.head ? ' (review of existing ' + taskArgs.head + ')' : ' from ' + head))
  let r = null
  try {
    r = await workflow({ scriptPath: A.socleScript }, taskArgs)
  } catch (e) {
    results.push({ task: t.task, error: String(e) })
    break
  }
  results.push(r)
  if (!r || r.stage === 'implement') { log('T' + t.task + ' stopped at implement'); break }
  head = r.head
  if (r.remainingOpen && r.remainingOpen.length) { log('T' + t.task + ' still has open findings after the fix rounds; stopping the lane'); break }
  log('T' + t.task + ' done at ' + head + ': ' + (r.confirmed || []).length + ' confirmed and fixed, ' + (r.needsRuling || []).length + ' need a ruling, ' + (r.deferred || []).length + ' deferred')
}
return { lane: A.lane, head, results }
