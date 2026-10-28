// Watches a Rune workflow run and writes the live/etat document of the roadmap page.
// Usage: node watch-live.js <runDir> <outFile> <configFile>
// Prints one line per meaningful change (the Monitor turns each line into a notification).
'use strict'
const fs = require('fs')
const path = require('path')

const [runDir, outFile, configFile] = process.argv.slice(2)
const JOURNAL = path.join(runDir, 'journal.jsonl')

const TASK_TITLES = {
  7: 'Choix du coach', 8: 'Onboarding et Éveil terminé', 9: 'Accueil et Progression', 10: 'Espace Profil',
  11: 'Salles et lieux', 12: 'Administration', 13: "Pages d'accès", 15: 'Points mis de côté', 16: 'Vérification et captures',
}
const TASK_DOC = { 7: 'refonte-08', 8: 'refonte-15', 9: 'refonte-16', 10: 'refonte-17', 11: 'refonte-18', 12: 'refonte-18', 13: 'refonte-18', 15: 'revue-03', 16: 'refonte-19' }
const LANES = [
  { id: 'A', titre: 'File A', taches: [7, 8, 9, 15, 16] },
  { id: 'C', titre: 'File C', taches: [10] },
  { id: 'B', titre: 'File B', taches: [11, 12, 13] },
]
const LANE_OF = {}
for (const l of LANES) for (const t of l.taches) LANE_OF[t] = l.id
const LENS = { spec: 'conformité', correctness: 'justesse', ux: 'textes et accessibilité', design: 'design', security: 'sécurité', tests: 'tests', ops: 'exploitation' }
const STAGES = ['Code', 'Relecture', 'Vérification', 'Corrections', 'Contrôle']
const STAGE_OF = { implement: 0, review: 1, triage: 2, verify: 2, fix: 3, integrate: 3, rereview: 4 }

function parseLabel(label) {
  const m = /^(.+?) · (.+)$/.exec(label || '')
  const nick = m ? m[1] : 'Agent'
  const rest = m ? m[2] : (label || '')
  let r
  if ((r = /^T(\d+) implement$/.exec(rest))) return { nick, task: +r[1], kind: 'implement' }
  if ((r = /^T(\d+) review:(\S+)$/.exec(rest))) return { nick, task: +r[1], kind: 'review', lens: r[2] }
  if ((r = /^T(\d+) triage$/.exec(rest))) return { nick, task: +r[1], kind: 'triage' }
  if ((r = /^T(\d+) verify (\S+)$/.exec(rest))) return { nick, task: +r[1], kind: 'verify', fid: r[2] }
  if ((r = /^T(\d+) fix round (\d+)$/.exec(rest))) return { nick, task: +r[1], kind: 'fix', round: +r[2] }
  if ((r = /^T(\d+) integrate round (\d+)$/.exec(rest))) return { nick, task: +r[1], kind: 'integrate', round: +r[2] }
  if ((r = /^T(\d+) re-review (\d+)$/.exec(rest))) return { nick, task: +r[1], kind: 'rereview', round: +r[2] }
  if ((r = /^worktree (\S+)$/.exec(rest))) return { nick, task: 'commun', kind: 'worktree', what: r[1] }
  if (rest === 'merge 2') return { nick, task: 'commun', kind: 'merge' }
  if ((r = /^final review:(\S+)$/.exec(rest))) return { nick, task: 'final', kind: 'review', lens: r[1] }
  if (rest === 'final triage') return { nick, task: 'final', kind: 'triage' }
  if ((r = /^verify (\S+)$/.exec(rest))) return { nick, task: 'final', kind: 'verify', fid: r[1] }
  if (rest === 'final fix wave') return { nick, task: 'final', kind: 'fix', round: 1 }
  if (rest === 'final re-review') return { nick, task: 'final', kind: 'rereview', round: 1 }
  return { nick, task: 'commun', kind: 'autre', raw: rest }
}

function readHead(file, bytes) {
  try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(bytes); const n = fs.readSync(fd, b, 0, bytes, 0); fs.closeSync(fd); return b.slice(0, n).toString('utf8') } catch { return '' }
}
function readTail(file, bytes) {
  try {
    const st = fs.statSync(file); const start = Math.max(0, st.size - bytes)
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(st.size - start); fs.readSync(fd, b, 0, b.length, start); fs.closeSync(fd)
    const s = b.toString('utf8'); return start > 0 ? s.slice(s.indexOf('\n') + 1) : s
  } catch { return '' }
}
const firstTs = {}
function startTs(id) {
  if (firstTs[id]) return firstTs[id]
  const m = /"timestamp":"([^"]+)"/.exec(readHead(path.join(runDir, 'agent-' + id + '.jsonl'), 16384))
  if (m) firstTs[id] = m[1]
  return m ? m[1] : null
}
const lastTsCache = {}
function endTs(id) {
  if (lastTsCache[id]) return lastTsCache[id]
  const all = [...readTail(path.join(runDir, 'agent-' + id + '.jsonl'), 65536).matchAll(/"timestamp":"([^"]+)"/g)]
  if (all.length) lastTsCache[id] = all[all.length - 1][1]
  return lastTsCache[id] || null
}

const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''
function describeCommand(cmd) {
  const c = String(cmd || '')
  if (/test:e2e|playwright/.test(c)) return 'lance les tests E2E'
  if (/test:infra|bats/.test(c)) return 'lance les tests des scripts du serveur'
  if (/cherry-pick/.test(c)) return 'intègre des corrections'
  if (/git commit/.test(c)) return 'enregistre un commit'
  if (/review-package/.test(c)) return 'prépare le paquet de relecture'
  if (/worktree (add|remove)/.test(c)) return 'prépare un dossier de travail'
  if (/pnpm (install|i\b)/.test(c)) return 'installe les dépendances'
  if (/\blint\b|eslint/.test(c)) return 'vérifie le lint'
  if (/typecheck|tsc\b/.test(c)) return 'vérifie les types'
  if (/vitest|pnpm( --filter \S+)? test|\btest\b/.test(c)) return 'lance les tests'
  if (/\bbuild\b/.test(c)) return "construit l'appli"
  if (/render-icons|screenshots/.test(c)) return 'prend des captures'
  if (/git (diff|show|log|status|blame)/.test(c)) return "regarde l'historique git"
  if (/\b(rg|grep|find)\b/.test(c)) return 'cherche dans le code'
  if (/\b(cat|sed|head|tail|less)\b/.test(c)) return 'lit des fichiers'
  return 'lance une commande'
}
function describeTool(t) {
  const i = t.input || {}
  switch (t.name) {
    case 'Bash': case 'PowerShell': return describeCommand(i.command)
    case 'Read': return 'lit ' + base(i.file_path)
    case 'Edit': return 'modifie ' + base(i.file_path)
    case 'Write': return 'écrit ' + base(i.file_path)
    case 'Grep': case 'Glob': return 'cherche dans le code'
    case 'Skill': return 'consulte une méthode'
    case 'TodoWrite': return 'organise son travail'
    case 'StructuredOutput': return 'rédige son rapport'
    default: return 'travaille'
  }
}
function activity(id) {
  const lines = readTail(path.join(runDir, 'agent-' + id + '.jsonl'), 262144).split('\n')
  for (let k = lines.length - 1; k >= 0; k--) {
    if (!lines[k].includes('"tool_use"')) continue
    try {
      const o = JSON.parse(lines[k])
      const tools = ((o.message && o.message.content) || []).filter((c) => c.type === 'tool_use')
      if (tools.length) return { texte: describeTool(tools[tools.length - 1]), depuis: o.timestamp || null }
    } catch { /* partial line */ }
  }
  return { texte: 'lit ses consignes', depuis: startTs(id) }
}

function parseResult(s) { try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null } }
function taskName(t) {
  if (t === 'final') return 'Relecture finale'
  if (t === 'commun') return 'Commun'
  return 'T' + t + ' · ' + (TASK_TITLES[t] || '')
}
function resultText(p, r) {
  const T = p.task === 'final' ? 'Relecture finale' : p.task === 'commun' ? '' : 'T' + p.task
  const pre = T ? T + ' · ' : ''
  if (!r) return pre + p.nick + ' a fini sans réponse'
  switch (p.kind) {
    case 'implement': return r.status === 'BLOCKED' || r.status === 'NEEDS_CONTEXT' ? pre + 'code bloqué (' + r.status + ')' : pre + 'code écrit et testé' + (r.head ? ' (' + String(r.head).slice(0, 7) + ')' : '')
    case 'review': { const n = (r.findings || []).length; const g = (r.findings || []).filter((f) => f.severity !== 'Minor').length; return pre + p.nick + ' (' + (LENS[p.lens] || p.lens) + ') : ' + (n ? n + ' remarque' + (n > 1 ? 's' : '') + (g ? ', dont ' + g + ' sérieuse' + (g > 1 ? 's' : '') : '') : 'rien à redire') }
    case 'triage': { const f = r.findings || []; const g = f.filter((x) => x.severity !== 'Minor').length; return pre + 'tri : ' + f.length + ' remarque' + (f.length > 1 ? 's' : '') + ' uniques, ' + g + ' à contre-vérifier' }
    case 'verify': return pre + p.nick + (r.real ? ' confirme ' : ' écarte ') + p.fid
    case 'fix': return pre + p.nick + ' : ' + (r.addressed || []).length + ' correction' + ((r.addressed || []).length > 1 ? 's' : '') + ' faites' + (p.round > 1 ? ' (tour ' + p.round + ')' : '')
    case 'integrate': return pre + 'corrections intégrées' + (p.round > 1 ? ' (tour ' + p.round + ')' : '')
    case 'rereview': { const open = (r.results || []).filter((x) => !x.addressed).length + (r.newBreakage || []).length; return pre + 'contrôle des corrections : ' + (open ? open + ' point' + (open > 1 ? 's' : '') + ' encore ouvert' + (open > 1 ? 's' : '') : 'tout est réglé') }
    case 'worktree': return 'Dossier de travail « ' + p.what + ' » ' + (r.ok ? 'prêt' : 'en échec')
    case 'merge': return 'Fusion 2 ' + (r.ok ? 'réussie' + (r.head ? ' (' + String(r.head).slice(0, 7) + ')' : '') : 'en échec')
    default: return p.nick + ' a fini'
  }
}
function startText(group) {
  const p = group[0].p
  const pre = p.task === 'final' ? 'Relecture finale · ' : p.task === 'commun' ? '' : 'T' + p.task + ' · '
  switch (p.kind) {
    case 'implement': return pre + p.nick + ' commence le code'
    case 'review': return pre + group.length + ' relecteur' + (group.length > 1 ? 's' : '') + ' lancé' + (group.length > 1 ? 's' : '') + ' (' + group.map((g) => LENS[g.p.lens] || g.p.lens).join(', ') + ')'
    case 'triage': return pre + 'tri des remarques'
    case 'verify': return pre + group.length + ' contre-vérification' + (group.length > 1 ? 's' : '') + ' lancée' + (group.length > 1 ? 's' : '')
    case 'fix': return pre + group.length + ' correcteur' + (group.length > 1 ? 's' : '') + ' au travail' + (p.round > 1 ? ' (tour ' + p.round + ')' : '')
    case 'integrate': return pre + 'intégration des corrections'
    case 'rereview': return pre + 'contrôle des corrections'
    case 'worktree': return 'Préparation du dossier « ' + p.what + ' »'
    case 'merge': return 'Fusion 2 lancée'
    default: return p.nick + ' démarre'
  }
}
const hm = (iso) => { const d = new Date(iso || Date.now()); return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) }

function build() {
  let lines = []
  try { lines = fs.readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean) } catch { return null }
  const agents = new Map()
  const order = []
  const other = []
  for (const l of lines) {
    let o; try { o = JSON.parse(l) } catch { continue }
    if (o.type === 'started') { agents.set(o.agentId, { id: o.agentId, label: o.label, p: parseLabel(o.label), done: false }); order.push(o.agentId) }
    else if (o.type === 'result') { const a = agents.get(o.agentId); if (a) { a.done = true; a.r = parseResult(o.result) } }
    else if (o.type !== 'launched') other.push(o.type)
  }
  const now = Date.now()
  const all = order.map((id) => agents.get(id))
  for (const a of all) { a.start = startTs(a.id); if (a.done) a.end = endTs(a.id) }
  const active = all.filter((a) => !a.done)
  for (const a of active) a.act = activity(a.id)

  // Task states
  const state = {}
  const byTask = (t) => all.filter((a) => a.p.task === t)
  for (const lane of LANES) {
    lane.taches.forEach((t, k) => {
      const mine = byTask(t)
      if (!mine.length) { state[t] = 'todo'; return }
      const later = lane.taches.slice(k + 1).some((u) => byTask(u).length) || (t === 16 && byTask('final').length)
      const act = mine.filter((a) => !a.done)
      const last = mine[mine.length - 1]
      const idleFor = last.end ? now - Date.parse(last.end) : 0
      const closedNow = !act.length && ['rereview', 'triage'].includes(last.p.kind) && idleFor > 60000
      state[t] = later || closedNow ? 'fermee' : 'encours'
    })
  }

  const files = LANES.map((lane) => {
    const cur = lane.taches.find((t) => state[t] === 'encours')
    const chips = lane.taches.map((t) => ({ t: 'T' + t, etat: state[t] }))
    if (!cur) {
      const allDone = lane.taches.filter((t) => state[t] === 'fermee')
      const waiting = lane.id === 'C' && state[10] === 'todo' ? 'En attente de la fin de T7' : allDone.length ? 'Tâches finies, en attente de la suite' : 'Pas encore commencée'
      return { id: lane.id, titre: lane.titre, chips, tache: null, attente: waiting }
    }
    const mine = byTask(cur)
    const act = mine.filter((a) => !a.done)
    const ref = act.length ? act : [mine[mine.length - 1]]
    const stageIdx = Math.max(...ref.map((a) => STAGE_OF[a.p.kind] != null ? STAGE_OF[a.p.kind] : 0))
    const round = Math.max(1, ...ref.map((a) => a.p.round || 1))
    const since = act.length ? act.map((a) => a.start).filter(Boolean).sort()[0] : ref[0].end
    return {
      id: lane.id, titre: lane.titre, chips, tache: taskName(cur), etape: stageIdx, etapes: STAGES,
      etapeTexte: STAGES[stageIdx] + (round > 1 ? ' (tour ' + round + ')' : '') + (act.length > 1 ? ' · ' + act.length + ' agents en parallèle' : ''),
      depuis: since || null,
      agents: act.map((a) => ({ qui: a.p.nick + (a.p.lens ? ' (' + (LENS[a.p.lens] || a.p.lens) + ')' : ''), fait: a.act.texte, depuis: a.act.depuis })),
      attente: act.length ? null : 'Entre deux étapes',
    }
  })
  const commun = active.filter((a) => a.p.task === 'commun' || a.p.task === 'final')
  if (commun.length) {
    const p = commun[0].p
    files.push({ id: 'X', titre: p.task === 'final' ? 'Relecture finale' : 'Commun', chips: [], tache: p.task === 'final' ? 'Relecture de toute la refonte' : startText([{ p }]),
      etape: p.task === 'final' ? (STAGE_OF[p.kind] || 1) : null, etapes: p.task === 'final' ? STAGES : null,
      etapeTexte: commun.length > 1 ? commun.length + ' agents en parallèle' : '', depuis: commun.map((a) => a.start).filter(Boolean).sort()[0] || null,
      agents: commun.map((a) => ({ qui: a.p.nick + (a.p.lens ? ' (' + (LENS[a.p.lens] || a.p.lens) + ')' : ''), fait: a.act.texte, depuis: a.act.depuis })), attente: null })
  }

  // Feed: group starts of the same task and kind that began within 2 minutes, newest first
  const ev = []
  for (const a of all) {
    if (a.start) ev.push({ ts: a.start, kind: 'start', a })
    if (a.done) ev.push({ ts: a.end || a.start, kind: 'end', a })
  }
  ev.sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts))
  const feed = []
  for (const e of ev) {
    if (e.kind === 'start') {
      const prev = feed[feed.length - 1]
      if (prev && prev.kind === 'start' && prev.group[0].p.task === e.a.p.task && prev.group[0].p.kind === e.a.p.kind && Date.parse(e.ts) - Date.parse(prev.ts) < 120000) { prev.group.push(e.a); continue }
      feed.push({ ts: e.ts, kind: 'start', group: [e.a] })
    } else feed.push({ ts: e.ts, kind: 'end', a: e.a })
  }
  const fil = feed.slice(-14).reverse().map((f) => ({ h: hm(f.ts), t: f.kind === 'start' ? startText(f.group.map((a) => ({ p: a.p }))) : resultText(f.a.p, f.a.r), ok: f.kind === 'end' }))

  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')) } catch { /* optional */ }
  const enCours = Object.keys(state).filter((t) => state[t] === 'encours')
  const faites = Object.keys(state).filter((t) => state[t] === 'fermee')
  const detail = files.filter((f) => f.tache).map((f) => f.tache.split(' · ')[0] + ' : ' + (f.etape != null && f.etapes ? f.etapes[f.etape].toLowerCase() : 'en cours')).join(' · ')
  const doc = {
    etape: commun.some((a) => a.p.task === 'final') ? 'Relecture finale de la refonte' : commun.some((a) => a.p.kind === 'merge') ? 'Fusion 2 en cours' : 'Refonte en cours : ' + enCours.length + ' tâche' + (enCours.length > 1 ? 's' : '') + ' en parallèle',
    detail: detail || (cfg.detail || ''),
    fin: cfg.fin || '',
    maj: new Date(now).toISOString(),
    tache: enCours.length ? TASK_DOC[enCours[0]] : null,
    taches: [...new Set(enCours.map((t) => TASK_DOC[t]))],
    files, fil,
    agentsActifs: active.length, agentsFaits: all.filter((a) => a.done).length,
    run: cfg.run || '',
  }
  return { doc, sig: active.map((a) => a.id).join(',') + '|' + all.filter((a) => a.done).length + '|' + faites.join(','), actSig: active.map((a) => a.act.texte).join('|'), faites, other, fil }
}

let seq = Math.floor(Date.now() / 1000) % 100000
const snaps = []
let lastEmit = 0
let lastSig = ''
let lastActSig = ''
let lastFaites = new Set()
let lastFilTop = ''
let lastOther = 0
function tick() {
  let b
  try { b = build() } catch (e) { console.log('ERREUR ' + (e && e.message)); return }
  if (!b) return
  const now = Date.now()
  const sigChanged = b.sig !== lastSig
  const actChanged = b.actSig !== lastActSig
  const due = (sigChanged && now - lastEmit >= 20000) || (actChanged && now - lastEmit >= 90000) || now - lastEmit >= 480000
  if (b.other.length > lastOther) { console.log('EVENEMENT journal : ' + b.other.slice(lastOther).join(', ')); lastOther = b.other.length }
  if (!due) return
  // One immutable snapshot per update (the ArtifactData write refuses a file changed after approval); keep the last 40.
  seq++
  const snap = outFile.replace(/\.json$/, '') + '-' + String(seq).padStart(4, '0') + '.json'
  fs.writeFileSync(snap, JSON.stringify(b.doc))
  snaps.push(snap)
  while (snaps.length > 40) { try { fs.unlinkSync(snaps.shift()) } catch { /* already gone */ } }
  const newly = b.faites.filter((t) => !lastFaites.has(t))
  const top = b.fil.length ? b.fil[0].h + ' ' + b.fil[0].t : ''
  const what = sigChanged ? (top !== lastFilTop ? top : 'changement') : actChanged ? 'activité' : 'battement'
  console.log('MAJ ' + path.basename(snap) + ' · ' + b.doc.agentsActifs + ' actifs, ' + b.doc.agentsFaits + ' finis · ' + what + (newly.length ? ' · FERMEE ' + newly.map((t) => 'T' + t).join(',') : ''))
  lastEmit = now; lastSig = b.sig; lastActSig = b.actSig; lastFilTop = top
  for (const t of b.faites) lastFaites.add(t)
}
// On start, tasks already closed are not reported again.
try { const b0 = build(); if (b0) lastFaites = new Set(b0.faites) } catch { /* first tick reports */ }
tick()
setInterval(tick, 5000)
