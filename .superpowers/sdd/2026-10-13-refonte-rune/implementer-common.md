# Implementer rules (Rune redesign of the socle) — read before starting

- Where you work: the repo path and branch named in your dispatch (the main checkout `C:\Users\eliott.colin\appsport` on branch `socle`, or a git worktree on its own branch). Windows 11, Node 24, pnpm 10, Git Bash available, no Docker or Python locally. jq and bats are installed (`pnpm test:infra` from Git Bash).
- Requirements: your brief, with exact values and texts to use verbatim. The binding authority is the redesign spec `docs/superpowers/specs/2026-10-13-refonte-rune-design.md` (read it entirely; it wins over the brief). Outside the front, the main spec `docs/superpowers/specs/2026-10-06-appsport-design.md` and its folder stay the authority. Global constraints: `global-constraints.md` in this workspace (`C:\Users\eliott.colin\appsport\.superpowers\sdd\2026-10-13-refonte-rune\`). Never read the plan file.
- Layout authority (read-only, never modify anything under `C:\Users\eliott.colin\appsport-local`): mockups `C:\Users\eliott.colin\appsport-local\maquettes\project\*.dc.html` (readable HTML) and their guide `C:\Users\eliott.colin\appsport-local\maquettes\GUIDE.md` (tokens, components); animated prototype `C:\Users\eliott.colin\appsport-local\prototype\src.html`; art in `docs/brand/` and `C:\Users\eliott.colin\appsport-local\brand\{skald,rangs}\`. Mockups decide layout and look; the spec decides behaviour and texts. Mockup sample data (names, numbers) is never copied into the app.
- Earlier tasks' code is in the repo: reuse it (`apps/web/src/ui/` toolkit, tokens, motion), match its style. Never re-create a component that exists.
- Do not touch `docs/` or `.superpowers/` (except your report file and the exceptions your rulings name). Never touch another worktree.
- If unclear or contradictory, stop and report NEEDS_CONTEXT rather than guess. If stuck, BLOCKED with specifics.
- TDD is mandatory and checked: write the test first, RUN it and capture the failing output (RED) BEFORE writing the implementation, then GREEN. A report without a separate RED run is a process finding.
- Before committing run `pnpm lint`, `pnpm typecheck`, `pnpm test` — all green, output pristine. Run the E2E specs your brief names (`pnpm --filter @rune/web test:e2e <spec>` (`@appsport/web` before Task 0 lands), Chromium and WebKit); E2E servers pick free ports and use this checkout's own `.e2e-data`.
- Commit on your branch (do NOT push). Conventional message in French (`feat(web): …`), body ending with `Closes #<issue>` then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never dispatch subagents, never spawn a reviewer: review is scheduled by the controller.
- One responsibility per file; if something outgrows the brief, report DONE_WITH_CONCERNS.
- You may take Playwright screenshots for your own visual check (390 × 844, light and dark); never commit them.
- Self-review your diff before reporting (completeness, YAGNI, tests verify behaviour, pristine output). Run `git show --stat HEAD` and `git status`: every change you claim must be in your commits.
- Write the full report to the report file named in your dispatch: what you implemented, tests and results, TDD evidence (RED command + failing output; GREEN command + passing output), files changed, self-review, concerns. If resumed with findings: fix, re-run the covering tests, append a fix report (changes, tests, command, output) to the same file.

## Secrets in reports
Reports, logs pasted into reports and commit messages never contain invitation or reset codes, links with a `#` fragment, passwords, session cookies or tokens. Mask them (`invite#XXXX-XXXX-XXXX-XXXX`) and delete any temporary log that holds one.

## Shell safety
Never put Markdown text with backticks or `$(...)` inside a double-quoted shell string — the shell executes it. Edit files with the file tools (Write/Edit) or a single-quoted heredoc (`<<'EOF'`). Never run a command copied from a procedure document (reboot, mount, cryptsetup, systemctl, docker, restic) on this PC.

## Never use git stash
The stash list is shared by every worktree of the repository, and other lanes work at the same time: a `git stash pop` can apply another lane's work to your tree (it happened on 2026-10-15). Never run `git stash` in any form. For RED evidence with code already written: copy your changed files to your scratchpad, put back the HEAD versions with `git show HEAD:<path> > <path>` (move new files aside), run the tests, copy your files back and check with `git diff` that nothing was lost.
