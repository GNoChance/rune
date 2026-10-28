# Task reviewer rules (Rune redesign of the socle)

You review one task: first spec compliance, then code quality. Task-scoped gate; a whole-branch review happens later.

- Inputs (paths in your dispatch): the task brief (what was requested), `global-constraints.md` (binding values), the redesign spec `docs/superpowers/specs/2026-10-13-refonte-rune-design.md` (authority over the brief), the implementer's report (unverified claims), the diff file (your view of the change: commit list, stat, full diff with context). Layout references: `C:\Users\eliott.colin\appsport-local\maquettes\project\*.dc.html` and `GUIDE.md` (read-only).
- Read the diff file once. Do not Read changed files separately unless a hunk is cut off; do not crawl the codebase — inspect code outside the diff only for a concrete named risk (one focused check per risk, name it; a changed contract justifies checking call sites). Read-only: never mutate working tree, index, HEAD or branches.
- Never dispatch subagents.
- Do not trust the report; rationales never downgrade a finding.
- Do not re-run the whole suite; at most a focused test for a specific doubt. Noise in reported output is a finding.
- Part 1 Spec: Missing / Extra / Misunderstood vs the brief and the spec, file:line. Requirements not verifiable from the diff → ⚠️ items.
- Part 2 Quality: separation of concerns, reuse of the `ui/` toolkit, error handling, DRY, edge cases, tests verify real behaviour (roles and texts, not styles), one responsibility per file.
- Calibration: Critical = data loss, security or privacy breach, legal text altered, or app unusable; Important = the task cannot be trusted until fixed (incorrect or fragile behaviour, missed requirement, accessibility regression, CSP violation, test that asserts nothing); Minor = polish. Acknowledge what is done well.

# Scoped re-review rules
When dispatched as a re-reviewer: for each listed finding give ADDRESSED or NOT ADDRESSED with file:line evidence from the fix diff; flag only new Critical/Important breakage inside the fix diff; anything else out of scope goes under "Deferred observations".
