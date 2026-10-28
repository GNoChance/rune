# Task 41 report: server bundle, Dockerfile, compose and image contract

- **Status:** DONE_WITH_CONCERNS (only because the Dockerfile and the image contract can run in CI only; see "CI-only" and Concerns)
- **Worktree / branch:** `C:\Users\eliott.colin\appsport-infra`, `socle-infra` (not pushed)
- **Commit:** `a57b757` feat(infra): bundle server.mjs, image node:24-slim, compose et contrat d'image, `Closes #42`
- **Review package:** `/c/Users/eliott.colin/appsport-infra/.superpowers/sdd/2026-10-06-socle/review-6101b64..a57b757.diff`

## Resume (2026-10-09)

The previous implementer was cut off on 2026-10-08. Its uncommitted work (also on `origin/wip/T41`) was checked file by file against the brief, the controller rulings and the spec (01 §2-§3, R-DEP-2, R-DEP-5, R-OPS-3, R-TST-1, 08 §4, §13.1).

Kept as is (correct): `apps/server/build.mjs`, `infra/Dockerfile`, `infra/compose.yaml`, `.dockerignore`, `infra/test/image-contract.sh`, the `build`/`build:server` scripts, the esbuild `^0.28.2` and yaml `^2.9.1` dev dependencies and the lockfile.

Fixed or finished:
1. **`apps/server/test/build/bundle.test.ts` was gitignored.** The root `.gitignore` rule `build/` matched `apps/server/test/build/`, so the test file was missing from `git status`, from the `wip/T41` backup and from `pnpm lint` (Biome uses the ignore file). I added `!apps/*/test/build/` right after `build/`. The file is now tracked and linted. `.gitignore` is not in the brief's file list; this one line is required for the brief's test path.
2. **The brief's regex was missing from bundle.test.** The previous implementer had replaced it with an esbuild metafile check because esbuild keeps the dependencies' JSDoc in the bundle (`import { Hono } from 'hono'`, `import { sql } from 'kysely'` in examples): the regex on the raw file gives about 80 false positives. The test now applies the brief's regex verbatim to the bundle with its comments removed (esbuild minifies, which drops comments, then prints again with normal spacing; a minified-only print turns `"from" in x` into `"from"in x`, which the regex would match). The metafile check stays: it also catches side-effect imports (`import "x"`) and `require()`, which the regex does not see.
3. **The test asserts "no node_modules":** no `node_modules` in the temp dir or any parent.
4. **CI job `image` was missing.** Added to `ci.yml` (blocking: no `continue-on-error`), with a test in `compose.test.ts`.
5. **Lint:** two `noTemplateCurlyInString` warnings (the compose `${APPSPORT_VERSION:?…}` and the Dockerfile `${VERSION}` strings), each fixed with a `biome-ignore` that gives the reason. Two formatting fixes.
6. **Healthcheck test:** the check on the `/api/health` URL now reads the compose file, not the test's own constant.

## What is in the commit

- `apps/server/build.mjs`: exactly the brief's `build({...})` (entryPoints `['src/main.ts']`, bundle, platform `node`, format `esm`, target `node24`, outfile `dist/server.mjs`, the `createRequire` banner, `legalComments: 'eof'`, no `.txt` loader).
- `apps/server/package.json`: `build: "node build.mjs"`; dev `esbuild ^0.28.2` (same line as apps/web) and `yaml ^2.9.1`.
- Root `package.json`: `build: "pnpm --filter @appsport/web build && pnpm build:server"`, `build:server: "pnpm --filter @appsport/server build"`.
- `infra/Dockerfile` (`# syntax=docker/dockerfile:1`, context = repo root):
  - build stage `FROM node:24 AS build`: `corepack enable`, `COPY . .`, `pnpm install --frozen-lockfile`, `ARG VITE_OWNER_FIRST_NAME`, `pnpm build`;
  - final stage `FROM node:24-slim`: `ARG VERSION=dev`, then the ENV line verbatim, the three `COPY --from=build` lines verbatim (no node_modules), `USER 1000`, `EXPOSE 3000`, the brief's `HEALTHCHECK` (Node's `fetch`: node:24-slim has no curl), `CMD ["node","/app/server.mjs"]`.
- `.dockerignore`: the 7 patterns from the brief.
- `infra/compose.yaml`: `name: appsport`, a single service `app` with the ruling's values verbatim. Port on `127.0.0.1` only (Docker bypasses ufw). Same healthcheck as the image. No `privileged`, `network_mode`, `cap_add`, `build` or `expose`.
- `infra/test/image-contract.sh <image> <version>` (mode 100755 in `git ls-files -s`, LF): `set -euo pipefail`; `fail` exits 1 and prints the last 50 log lines of the container; `trap cleanup EXIT` removes the containers and the temp dir and keeps the exit code; `chmod 0777` on the `mktemp -d` mounted at `/data`. The 9 checks run in the brief's order:
  1. `docker image inspect`: `User` 1000, `3000/tcp` the only exposed port, `APP_VERSION=<version>`, healthcheck on `/api/health`;
  2. no `/app/node_modules`; `server.mjs`, `public/index.html` and `data/` present;
  3. start refused with no sentinel, then with a sentinel and no database. Each run uses `--read-only --tmpfs /tmp` and a 60 s `timeout`. The script checks the exit code (not 0, not 124), the T7 message and that no `appsport.db` was created;
  4. `node /app/server.mjs init` returns 0 and creates the database;
  5. container on `127.0.0.1:3300`; `/api/health` within 60 s, `jq -e '.status == "ok" and .db == "ok" and .version == $v'`;
  6. `touch /app/x` fails; `/tmp/x` and `/data/x` succeed;
  7. `0BB8` is the only LISTEN port in `/proc/net/tcp*`;
  8. stdout is not empty and every line passes `jq -e .`;
  9. `docker stop -t 15` in under 10 s with exit code 0.

  Last line: « Contrat d'image respecté (9 contrôles). »
- `.github/workflows/ci.yml`, blocking job `image` (`ubuntu-latest`): `actions/checkout@v4`, then `docker build -f infra/Dockerfile --build-arg VERSION=v0.0.0-ci -t appsport:ci .`, then `bash infra/test/image-contract.sh appsport:ci v0.0.0-ci`.
- `.gitignore`: the re-include line (Resume, point 1).

## Tests

- `apps/server/test/build/bundle.test.ts` (2 tests):
  - `node build.mjs` returns 0 and `dist/` holds `server.mjs` only. With comments removed, the file starts an `export {` (ESM) and does not match the brief's regex. esbuild's parser finds a single input and only `node:*` imports, `node:sqlite` among them.
  - `server.mjs` is copied alone into an OS temp dir outside the repo, with no `node_modules` in the dir or its parents. The dir also gets `data/.appsport-volume`, `public/index.html` and a copy of the repo's `data/` as `content/`. `init` returns 0 and creates `data/appsport.db`; `db:check` returns 0. The launched server answers `/api/health` with `{ status: 'ok', version: 'v9.9.9-test', db: 'ok', protocol: 1, minProtocol: 1, swKill: false }` and serves `public/index.html` on `/`. A `finally` block stops the process (waiting for its exit, because Windows locks the database until then) and removes the temp dir.
- `apps/server/test/infra/compose.test.ts` (10 tests): every compose value from the ruling, the exact healthcheck, the forbidden keys; the Dockerfile (syntax line, `pnpm install --frozen-lockfile`, `ARG VITE_OWNER_FIRST_NAME` between `FROM node:24 AS build` and `pnpm build`, a final stage with one `FROM node:24-slim` and exactly the 3 COPY lines, no node_modules, `ARG VERSION=dev` before the ENV line, `USER 1000`, `EXPOSE 3000`, the exact HEALTHCHECK, the CMD); `.dockerignore` exactly; job `image` (checkout plus the 2 commands, no `continue-on-error`).

### TDD evidence

**RED (separate run).** I moved the implementation files (`apps/server/build.mjs`, `infra/Dockerfile`, `infra/compose.yaml`, `infra/test/image-contract.sh`, `.dockerignore`) to the scratchpad and deleted `apps/server/dist`. The tests and the dev dependencies they import (esbuild, yaml) stayed.

```
pnpm --filter @appsport/server test build/bundle infra/compose
 ❯ |server| test/infra/compose.test.ts (0 test)
 ❯ |server| test/build/bundle.test.ts (2 tests | 2 failed)
 FAIL  |server| test/infra/compose.test.ts
Error: ENOENT: no such file or directory, open 'C:\Users\eliott.colin\appsport-infra\infra\compose.yaml'
 FAIL  |server| test/build/bundle.test.ts > node build.mjs produit un seul server.mjs ESM, sans import hors node:*
Error: Cannot find module 'C:\Users\eliott.colin\appsport-infra\apps\server\build.mjs'
: expected 1 to be +0
 FAIL  |server| test/build/bundle.test.ts > server.mjs seul, hors du dépôt et sans node_modules : init, db:check puis /api/health
Error: Cannot find module '…\apps\server\build.mjs'
```
This is the failure the brief expects (`Cannot find module '…/build.mjs'`, `ENOENT … infra/compose.yaml`).

**RED for the CI job test** (implementation files restored, `ci.yml` not yet changed):
```
pnpm --filter @appsport/server test infra/compose
 × job CI image > bloquant : construit l'image depuis la racine puis vérifie son contrat
AssertionError: expected undefined to match object { 'runs-on': 'ubuntu-latest' }
 Tests  1 failed | 9 passed (10)
```

**GREEN** (job `image` added):
```
pnpm --filter @appsport/server test build/bundle infra/compose --reporter=verbose
 ✓ … 10 compose.test.ts tests
 ✓ |server| test/build/bundle.test.ts > node build.mjs produit un seul server.mjs ESM, sans import hors node:* 205ms
 ✓ |server| test/build/bundle.test.ts > server.mjs seul, hors du dépôt et sans node_modules : init, db:check puis /api/health 591ms
 Test Files  2 passed (2)
      Tests  12 passed (12)
```

**Mutation check.** I added `packages: 'external'` to build.mjs for one run, then restored it. Both bundle tests failed: the regex matched `from "hono"`-style imports, and `server.mjs` outside the repo failed with ERR_MODULE_NOT_FOUND.

### Full checks before the commit

- `pnpm lint`: `Checked 407 files … No fixes applied.`
- `pnpm typecheck`: server and web clean.
- `pnpm test`: `Test Files 146 passed (146)`, `Tests 1736 passed | 2 skipped (1738)` in 7 of 8 full runs. The first run had 1 failure in another file: its code frame pointed at line 284, and neither T41 test file is that long (bundle.test 169 lines, compose.test 129). I could not identify the file because only the tail of that run was captured. It did not happen again in the 7 later runs; possibly a pre-existing flaky test under load.
- `pnpm install --frozen-lockfile --offline`: the lockfile matches the manifests.

## CI-only (no Docker on this PC)

The Dockerfile and `image-contract.sh` are verified only by the blocking CI job `image`:
```
docker build -f infra/Dockerfile --build-arg VERSION=v0.0.0-ci -t appsport:ci .
bash infra/test/image-contract.sh appsport:ci v0.0.0-ci
```
Expected CI output, ending with the required last line:
```
OK 1 : utilisateur 1000, port 3000/tcp seul, APP_VERSION=v0.0.0-ci, santé sur /api/health
OK 2 : server.mjs, public/index.html et data/ présents, pas de node_modules
OK 3 : démarrage refusé sans sentinelle puis sans base, aucune base créée
OK 4 : init crée /data/appsport.db
OK 5 : /api/health : status ok, db ok, version v0.0.0-ci
OK 6 : /app en lecture seule, /tmp et /data inscriptibles
OK 7 : seul le port 3000 (0BB8) est en écoute
OK 8 : <n> ligne(s) de stdout, toutes en JSON
OK 9 : arrêt sur SIGTERM en <ms> ms, code 0
Contrat d'image respecté (9 contrôles).
```
shellcheck of `infra/test/image-contract.sh` runs in T43's `infra` job (`shellcheck -x … infra/test/image-contract.sh`). shellcheck is not installed here, so it has not run yet. `bash -n` passes.

### What I could verify locally without Docker (not committed)

- **Contract script against a fake `docker`** (scratchpad). The fake runs the real `dist/server.mjs` for `run` (guard, `init`, `-d` on 127.0.0.1:3300) and `logs`, and returns canned answers for `image inspect`, `exec` and `stop`. The nominal run printed the 9 OK lines, then « Contrat d'image respecté (9 contrôles). », exit 0. Checks 3, 4, 5 and 8 used the real server: the T7 refusal messages, the database created on the mounted dir, the health JSON matched with jq, and 3 JSON stdout lines. Each failure case exits 1 with the right message: user not 1000 (check 1), wrong APP_VERSION (1), node_modules present (2), `/app` writable (6, with the container logs), extra LISTEN port `1F90` (7). Every run removed its temp dir, and the trap stopped every container.
- **Contract 9 (SIGTERM as PID 1), simulated.** Windows has no real SIGTERM, so a `--import` preload calls `process.emit('SIGTERM')` once `/api/health` returns 200. The bundle exited with code 0, 6 ms after the signal. All 3 stdout lines were JSON (`auth purge`, `sync purge`, `request`).

## Files changed

`.dockerignore` (new), `.github/workflows/ci.yml`, `.gitignore`, `apps/server/build.mjs` (new), `apps/server/package.json`, `apps/server/test/build/bundle.test.ts` (new), `apps/server/test/infra/compose.test.ts` (new), `infra/Dockerfile` (new), `infra/compose.yaml` (new), `infra/test/image-contract.sh` (new, 100755), `package.json`, `pnpm-lock.yaml`.

## Self-review

- Completeness: every brief and ruling item is in the commit. `git show --stat HEAD` lists the 12 files, and `git ls-files -s` shows `100755` for the contract script.
- Spec: 08 §4 compose (the spec writes `${APPSPORT_VERSION}`; the ruling's `:?` form is stricter and refuses an empty version) and contract items 1-7. R-DEP-2: multi-stage build, node:24-slim with server.mjs + public/ + data/ and no node_modules, version in the image and returned by `/api/health`. R-DEP-5 and R-OPS-3: contract check 3. R-TST-1: blocking image job. §13.1: port 3000 published on 127.0.0.1 only.
- Risks from the dispatch:
  - (a) The bundle is self-contained: run outside the repo with no node_modules, the main-module guard works once bundled, and the server reads no path from `import.meta.url`.
  - (b) SIGTERM and JSON stdout: simulated locally; CI proves them.
  - (c) Image content: tested statically and by contract check 2.
  - (d) Runner uid and read-only root: `chmod 0777` and checks 6 and 7. Docker's embedded DNS listener is absent because `docker run` uses the default bridge.
  - (e) bundle.test cleanup is in `finally`. The test waits for the process to exit before `rmSync` (maxRetries 5), and no server was left listening afterwards.
- YAGNI: compose has no extra hardening keys beyond the spec. The fake-docker harness stays in the scratchpad.

## Concerns

1. **The Dockerfile and the contract have never run against real Docker.** The first proof is the CI job `image`. Two risks remain. Corepack in `node:24` must fetch `pnpm@10.34.0` (signature keys). The build stage installs `better-sqlite3` without building it (`ignoredBuiltDependencies`), as on this PC.
2. **`.dockerignore` patterns are root-level, as written in the ruling.** `test-results` and `playwright-report` only match at the repo root, but Playwright (T38) writes them under `apps/web/`. If they exist locally, they enter the build context. They only reach the build stage, never the final image, so this is harmless. `**/test-results` would be cleaner, but I kept the ruling's text.
3. **`.gitignore` is changed** (one re-include line). The brief does not list it, but without it the brief's test path is neither committed nor linted. Note: `origin/wip/T41` never contained `bundle.test.ts`.
4. **bundle.test does not use the brief's regex on the raw file** (about 80 JSDoc false positives). It uses the regex verbatim on the comment-free code, plus esbuild's parser.
5. **One unidentified flaky failure** in 1 of 8 full `pnpm test` runs, outside T41's files (see Full checks). 7 later runs passed.

# Fix round 1 (T41-F1 to F16), integration on `socle-infra`

The four fix branches were cherry-picked onto `socle-infra` (base `a57b757`) in order, keeping history linear. Each one is a single commit:

| Group | Findings | Branch head | Commit on `socle-infra` |
|---|---|---|---|
| 1 | T41-F2 | `4699856` | `a1fa187` fix(server): écouteurs SIGTERM et SIGINT posés avant le démarrage (PID 1) |
| 2 | T41-F13, F5, F1 | `c80dd66` | `bcf33b2` test(infra): bundle.test isolé de l'environnement, borné dans le temps, relevé des require |
| 3 | T41-F14, F12, F9, F8, F7, F6, F4, F3 | `1b2413c` | `fff5465` fix(infra): contrat d'image renforcé (sonde, PWA, racine, secret, arrêt) et job image borné |
| 4 | T41-F16, F10 | `9674922` | `8f67748` test(infra): clés de compose fermées, Dockerfile et job CI image ancrés ligne à ligne |

No integration commit was needed: lint, typecheck and the full test suite pass on `8f67748`.

## Changes per group

### Group 1: T41-F2 (signals while the server is PID 1)
Files: `apps/server/src/main.ts`, `apps/server/test/startup.test.ts`.
- `main()` takes an optional second parameter `start` (default `startServer`). This is a test seam; the entry point still calls `main(argv)`.
- On the server path, the SIGTERM and SIGINT handlers are registered **before** `await start(process.env)`. On the first signal, the handler removes both listeners, arms the 9 s watchdog (`process.exit(1)`, unref) and resolves a stop promise (`Promise.withResolvers`). Once startup completes, main awaits that promise, then runs `close()`. A signal that arrives during startup therefore triggers `close()` as soon as the server is ready. If `close()` rejects, the exit code is 1. If it succeeds, the watchdog is cleared and main resolves 0.
- If startup throws, both listeners are removed and the error is rethrown (exit code 1, as before).
- Side fixes: before, the other signal's `once` listener was never removed, so a second signal of the other kind called `close()` again. Also, the watchdog was never cleared after a clean close.
- The CLI path is unchanged.
- Tests: new describe block « main : signaux pendant le démarrage (PID 1 du conteneur) », 4 cases: SIGTERM and SIGINT during a pending start (it.each), a signal after startup, a startup failure.
- RED (only the `start` parameter added): `pnpm --filter @appsport/server test startup` gave 4 failed and 7 passed. The 3 during-startup and failure cases failed with `expected +0 to be 1` (no listener during startup). The after-startup case failed with `expected 1 to be +0` (SIGINT listener left behind). GREEN: 11 passed.
- Residual, out of scope: a CLI run as PID 1 (`docker compose run app init`) still has no JS signal handler.

### Group 2: T41-F13, T41-F5, T41-F1 (bundle.test)
File: `apps/server/test/build/bundle.test.ts`.
- F13, plus the env half of F1: `childEnv(own)` builds an explicit environment. It keeps only PATH, SYSTEMROOT, TEMP, TMP, TMPDIR, HOME and USERPROFILE, matched case-insensitively, plus the test's own variables. init and db:check use `cliEnv` (APP_ORIGIN `http://127.0.0.1`, no PORT). The server uses `serverEnv(port)`. Assertions check that no key outside the allowlist is present, and that NODE_PATH, NODE_OPTIONS, ANTHROPIC_API_KEY, COACH_MODEL and SW_KILL_SWITCH are absent.
- F1, require scan: `requiredModules(src)` runs `/\b(?:__)?require\s*\(\s*['"]([^'"]+)['"]/g` on the comment-free bundle. Every specifier must satisfy `isBuiltin()`. `withoutComments` no longer passes `format: 'esm'`, because esbuild renamed the banner's `require` to `require2` and the scan missed it.
- F5: `SYNC_LIMITS = { timeout: 30_000, killSignal: 'SIGKILL' }` applies to the build, init and db:check calls. `expectSuccess()` checks `error`, `signal` and `status`. `stop()` waits for exit for up to 10 s, then sends SIGKILL and waits up to 5 s more. The `finally` block stops every child, then runs `rmSync` with `force` and `maxRetries: 5`; on failure it only warns. `freePort()` runs right before spawn, with one retry on EADDRINUSE.
- RED/mutations, all reverted:
  - env with the old `...process.env`: `expected [...] to deeply equal []`, with NODE_PATH, VSCODE_* and others leaking.
  - mutation A (lazy `require('zod')`): HEAD passed. Fixed test: `expected [ 'zod' ] to deeply equal []`.
  - mutation B (eager `require('zod')`): HEAD passed, because NODE_PATH leaked. Fixed test: both tests fail, one of them with `Cannot find module 'zod'`.
  - mutation C (hanging init): HEAD hung for 96 s until an external kill. Fixed test: fails cleanly after 30 s with `spawnSync ... ETIMEDOUT`.
- GREEN: 2 files, 12 tests passed.
- **Correction to this report's "Resume" item 2 above.** That item says the metafile check « also catches ... `require()` ». It does not: the banner's `require` and esbuild's `__require` are local bindings, invisible to the metafile. `require` loads are now covered by the separate `requiredModules` scan with `isBuiltin`, and NODE_PATH and NODE_OPTIONS are removed from the child env.

### Group 3: T41-F14, F12, F9, F8, F7, F6, F4, F3 (image contract and CI job)
Files: `infra/test/image-contract.sh` (mode still 100755), `.github/workflows/ci.yml` (one line), `apps/server/test/infra/compose.test.ts` (one assertion).
- F14: check 5 reads the probe from the image's `.Healthcheck.Test` with jq. It accepts both `CMD` and `CMD-SHELL` (run as `sh -c`). The argv is split on NUL bytes, then run with `timeout -k 5 30 docker exec "$NAME" "${probe[@]}"`. The probe must exit 0.
- F3: check 5 also requires `curl -fsS --max-time 5 http://127.0.0.1:3300/` to succeed, with a body that contains `<!doctype html>` (case-insensitive).
- F4: new `write_refused` helper. Writes to /app must be refused (`Read-only file system|Permission denied`). Writes to /home/node and /var/tmp must be refused with `Read-only file system`. Any other error fails the check.
- F12: `ANTHROPIC_API_KEY=contrat-canari-$$` is passed to the container. Check 8 fails if `docker logs` contains it. The search uses a here-string and `grep -qF`, with no pipe, so SIGPIPE under pipefail cannot hide a leak.
- F7: the log assertions moved into `assert_json_logs <check> <when>`. They run in check 8 and again after check 9's exit code (« à l'arrêt »), and the canary is checked again after the stop.
- F6: check 3 runs under `timeout -k 10 60`, and exit 137 now counts as a failure. Check 4 runs `timeout -k 10 60 docker run --rm --name "$NAME-init"`, and `$NAME-init` is in the cleanup. The `image` job in `ci.yml` has `timeout-minutes: 20`, asserted in compose.test.
- F8: on failure, `guard_refuses` prints the exit code, the expected message and the last 20 lines of the guard container's output.
- F9: the header states the script is Linux-only (GNU coreutils) and needs docker, curl, jq and timeout. At startup the script checks for them and for `date +%3N`, and fails with « ÉCHEC : prérequis absent : … » if one is missing.
- RED/GREEN:
  - compose.test with `timeout-minutes: 20` added to the assertion: 1 failed | 9 passed. After the ci.yml change: GREEN.
  - image-contract.sh, scratchpad harness with a fake docker and curl (not committed). The baseline passes with both versions. Each of the 8 mutations (probe, leak, date, guard, shutdown, writable, nopwa, hang) passes or misbehaves with the original script and fails with the expected ÉCHEC message with the new one. For example, hang: the original was stuck for more than 5 min; the new script exits 1 after 1 min 13 s with « 4. init en échec ou au-delà de 60 s ».
- Expected CI output, updated (OK lines 1 to 4 and 7 unchanged):
  - `OK 5 : /api/health : status ok, db ok, version v0.0.0-ci ; / sert index.html ; sonde HEALTHCHECK réussie`
  - `OK 6 : /app, /home/node et /var/tmp en lecture seule, /tmp et /data inscriptibles`
  - `OK 8 : N ligne(s) de stdout, toutes en JSON, sans le secret canari`
  - `OK 9 : arrêt sur SIGTERM en N ms, code 0, journaux d'arrêt en JSON`
  - last line: `Contrat d'image respecté (9 contrôles).`
- Assumption: `node:24-slim` keeps /home/node owned by uid 1000 and /var/tmp at mode 1777, as the official image does.

### Group 4: T41-F16, T41-F10 (compose.test anchored)
File: `apps/server/test/infra/compose.test.ts` only. The Dockerfile, compose and ci.yml already followed the rulings.
- F10: the compose `app` service must have exactly these keys: `env_file, healthcheck, image, mem_limit, ports, read_only, restart, stop_grace_period, tmpfs, user, volumes`. The denylist and the value assertions are kept.
- F16, Dockerfile: the file is split on `/\r?\n/` and lines are matched exactly: `FROM node:24 AS build`, `RUN pnpm install --frozen-lockfile`, `ARG VITE_OWNER_FIRST_NAME`, `RUN pnpm build`, `FROM node:24-slim`. Their order is checked. ENV and HEALTHCHECK are exact lines. There must be no `ENTRYPOINT`, and the only `CMD` must be `CMD ["node","/app/server.mjs"]` (both checks case-insensitive).
- F16, CI job: closed key set, `runs-on: ubuntu-latest`, and `workflow.on` contains `pull_request`.
- RED by mutation, with the HEAD test kept next to the new one as a temporary file:
  - Mutations: non-frozen install, `pnpm build:server`, an added ENTRYPOINT, `pid: host`, `if:` on the image job.
  - The old test passed every mutation. The new test failed 4 of 4.
  - A second round (`build:server`, plus a second CMD) failed 2 of 2.
- GREEN: 2 files, 12 tests passed.

## Conflict resolved

**`apps/server/test/infra/compose.test.ts`, describe « job CI image » (groups 3 and 4).** This was a textual conflict and a semantic one:
- Group 3 asserted `toMatchObject({ 'runs-on': 'ubuntu-latest', 'timeout-minutes': 20 })`.
- Group 4 asserted that the job keys are exactly `['runs-on', 'steps']`. Group 4 was written before group 3's `timeout-minutes: 20` existed, so keeping it as is would have failed against the merged ci.yml.

Resolution, kept in commit `8f67748`: group 4's closed key set, extended with group 3's key and value.

```ts
expect(Object.keys(job).sort()).toEqual(['runs-on', 'steps', 'timeout-minutes']);
expect(job['runs-on']).toBe('ubuntu-latest');
expect(job['timeout-minutes']).toBe(20);
expect(Object.keys(workflow.on)).toContain('pull_request');
```

Group 3's `not.toHaveProperty('continue-on-error')` is covered by the closed key set.

Mutation check of the merged assertion against ci.yml (reverted afterwards):
- With `timeout-minutes` removed: `expected [ 'runs-on', 'steps' ] to deeply equal [ 'runs-on', 'steps', …(1) ]`, 1 failed | 9 passed.
- With `if: github.event_name == 'push'` added: `expected [ 'if', 'runs-on', 'steps', …(1) ] to deeply equal [ 'runs-on', 'steps', …(1) ]`, 1 failed | 9 passed.

There were no other conflicts. Groups 1, 2 and 3 touch different files. Group 2's bundle.test rebuilds `dist/server.mjs` with group 1's new `main()` and still passes.

## Final verification (HEAD `8f67748`)
- `pnpm --filter @appsport/server test build/bundle infra/compose startup`: Test Files 3 passed (3), Tests 23 passed (23).
- `pnpm lint`: `Checked 407 files in 454ms. No fixes applied.` (exit 0).
- `pnpm typecheck`: server and web `tsc --noEmit` both exit 0.
- `pnpm test`: `Test Files 146 passed (146)`, `Tests 1740 passed | 2 skipped (1742)`, exit 0. There was no stderr noise, and no `appsport-bundle-*` temp dir was left behind.
- `bash -n infra/test/image-contract.sh`: syntax OK. `git ls-files -s` shows mode 100755.
- CI-only, because this PC has no Docker: the blocking `image` job (timeout 20 min) runs `docker build -f infra/Dockerfile --build-arg VERSION=v0.0.0-ci -t appsport:ci .`, then `bash infra/test/image-contract.sh appsport:ci v0.0.0-ci`. The expected last line is « Contrat d'image respecté (9 contrôles). ». shellcheck runs in T43's infra job.
- Fix worktrees `appsport-infra-fix-T41-r1-g1` to `g4` were removed, and branches `fix/T41-r1-g1` to `g4` were deleted.

## Concerns
- Neither the hardened contract nor the PID 1 signal fix has run against a real container yet. The first real proof is the CI `image` job.
- Residual from group 1: CLI commands run as PID 1 (`docker compose run app init`) still ignore Ctrl-C.
- The body of commit `8f67748` (group 4's message, kept verbatim) still says the image job has only runs-on and steps. Since the conflict resolution, the test also requires `timeout-minutes: 20`; the code is correct and only the message is stale.
