# Implementer rules (Rune, brick 2 Exercices) — read before starting

- Where you work: the repo path and branch named in your dispatch (the main checkout `C:\Users\eliott.colin\appsport` on branch `brique-2`, or a git worktree on its own branch). Windows 11, Node 24, pnpm 10, Git Bash available, no Docker or Python locally. jq and bats are installed (`pnpm test:infra` from Git Bash).
- Requirements: your brief, with exact values and texts to use verbatim. The binding authority is the brick 2 spec `docs/superpowers/specs/2026-10-14-brique-2-exercices-design.md` and the section it completes, `docs/superpowers/specs/2026-10-06-appsport-design/04-exercices.md` (read both entirely; the brick 2 spec wins over 04 where its §1 table says so, and both win over the brief). The redesign spec `docs/superpowers/specs/2026-10-13-refonte-rune-design.md` stays the authority for the look (tokens, toolkit, motion, voice). Global constraints: `global-constraints.md` in this workspace (`C:\Users\eliott.colin\appsport\.superpowers\sdd\2026-10-14-brique-2\`). Controller rulings in your dispatch win over the brief. Never read the plan file.
- Layout authority for screens (read-only): the validated mockups `C:\Users\eliott.colin\appsport\.superpowers\brainstorm\2679-1791963547\content\{exercices-liste,exercices-fiche,relecture}.html` (choices B, B, and the review screen as is). Mockups decide layout and look; the specs decide behaviour and texts. Mockup sample data (names, numbers) is never copied into the app.
- Earlier tasks' code is in the repo: reuse it (`apps/web/src/ui/` toolkit, tokens, motion, `repos/`, `packages/domain` catalog functions), match its style. Never re-create a component or a domain function that exists; the server, the scripts and the web call the SAME domain functions.
- Do not touch `docs/` or `.superpowers/` (except your report file and the exceptions your brief or rulings name). Never touch another worktree, `C:\Users\eliott.colin\rune-local` (the owner's install) or `C:\Users\eliott.colin\rune-specs`.
- If unclear or contradictory, stop and report NEEDS_CONTEXT rather than guess. If stuck, BLOCKED with specifics.
- TDD is mandatory and checked: write the test first, RUN it and capture the failing output (RED) BEFORE writing the implementation, then GREEN. A report without a separate RED run is a process finding.
- Before committing run `pnpm lint`, `pnpm typecheck`, `pnpm test` — all green, output pristine. Run the E2E specs your brief names (`pnpm --filter @rune/web test:e2e <spec>`, Chromium and WebKit); E2E servers pick free ports and use this checkout's own `.e2e-data`.
- Never call the real Claude API: tests use the fake client, and no test may reach the network. No API key in any file, log, report or commit; `.env.local` is git-ignored and only the owner fills it.
- Commit on your branch (do NOT push). Conventional message in French (`feat(server): …`), body ending with `Closes #<issue>` when an issue number is given (otherwise `Brique 2, tâche <n>`), then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never dispatch subagents, never spawn a reviewer: review is scheduled by the controller.
- One responsibility per file; if something outgrows the brief, report DONE_WITH_CONCERNS.
- You may take Playwright screenshots for your own visual check (390 × 844, light and dark); never commit them.
- Self-review your diff before reporting (completeness, YAGNI, tests verify behaviour, pristine output). Run `git show --stat HEAD` and `git status`: every change you claim must be in your commits.
- Write the full report to the report file named in your dispatch: what you implemented, tests and results, TDD evidence (RED command + failing output; GREEN command + passing output), files changed, self-review, concerns. If resumed with findings: fix, re-run the covering tests, append a fix report (changes, tests, command, output) to the same file.

## Secrets in reports
Reports, logs pasted into reports and commit messages never contain invitation or reset codes, links with a `#` fragment, passwords, session cookies, tokens or API keys. Mask them (`invite#XXXX-XXXX-XXXX-XXXX`) and delete any temporary log that holds one.

## Shell safety
Never put Markdown text with backticks or `$(...)` inside a double-quoted shell string — the shell executes it. Edit files with the file tools (Write/Edit) or a single-quoted heredoc (`<<'EOF'`). Never run a command copied from a procedure document (reboot, mount, cryptsetup, systemctl, docker, restic) on this PC. Canonical JSON files end with LF only, even on Windows (check `.gitattributes` and write with explicit `\n`).

## Never use git stash
The stash list is shared by every worktree of the repository, and other lanes work at the same time: a `git stash pop` can apply another lane's work to your tree (it happened on 2026-10-15). Never run `git stash` in any form. For RED evidence with code already written: copy your changed files to your scratchpad, put back the HEAD versions with `git show HEAD:<path> > <path>` (move new files aside), run the tests, copy your files back and check with `git diff` that nothing was lost.
