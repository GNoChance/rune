# Implementer rules (appsport socle) — read before starting

- Repo: `C:\Users\eliott.colin\appsport`, branch `socle` (checked out). Windows 11, Node 24.21, pnpm 10.34, Git Bash available, no Docker/Python locally.
- Your brief is your requirements, with exact values to use verbatim. Global constraints: `.superpowers/sdd/2026-10-06-socle/global-constraints.md`. The shared interfaces live in the plan header (`docs/superpowers/plans/2026-10-06-socle.md`, section "Interfaces partagées", lines ~105-900): read only the parts your brief's Interfaces block names. Never read the rest of the plan.
- Earlier tasks' code is in the repo: reuse it, match its style. Do not touch `docs/` or `.superpowers/` (except your report file).
- If unclear or contradictory, stop and report NEEDS_CONTEXT rather than guess. If stuck, BLOCKED with specifics.
- Implement exactly what the task says, TDD as the steps say (RED then GREEN, keep the evidence). Focused tests while iterating; run `pnpm lint`, `pnpm typecheck`, `pnpm test` once before committing — all must pass, output pristine.
- Commit on `socle` (do NOT push). Conventional message in French with the plan's scope, body ending with `Closes #<issue>` then a blank line and the Co-Authored-By trailer.
- Never dispatch subagents, never spawn a reviewer: review is scheduled by the controller.
- One responsibility per file, follow the plan's file structure; if something outgrows the plan's intent, report DONE_WITH_CONCERNS.
- Self-review your diff before reporting (completeness, YAGNI, tests verify behavior, pristine output).
- Write the full report to the report file given in your dispatch: what you implemented, tests and results, TDD evidence (RED command + failing output and why expected; GREEN command + passing output), files changed, self-review findings, concerns.
- Reply with ONLY (under 15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report path.
- If resumed with review findings: fix, re-run the covering tests, append a fix report (changes, tests, command, output) to the same report file, reply with the same short contract.
- TDD is mandatory and checked: write the test first, RUN it and capture the failing output (RED) BEFORE writing the implementation, then GREEN. A report without a separate RED run is a process finding.
- Before reporting, run `git show --stat HEAD` (and `git status`) and check every change you claim is in your commit. Claimed-but-absent changes have happened before.

## Secrets in reports (added 2026-10-08, T31-F23)
Reports, logs pasted into reports, and commit messages never contain invitation or reset codes, links with a `#` fragment, passwords, session cookies or tokens. Mask them (`invite#XXXX-XXXX-XXXX-XXXX`) and delete any temporary log that holds one.

- Shell safety (added 2026-10-12 after a T45 incident ran `sudo reboot` on the dev PC): never put Markdown text with backticks or `$(...)` inside a double-quoted shell string — the shell executes it. Edit documents with the file tools (Write/Edit), or use a single-quoted heredoc (<<'EOF'). Never run a command copied from a procedure document (reboot, mount, cryptsetup, systemctl, docker, restic) on this PC.
