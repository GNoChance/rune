
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
