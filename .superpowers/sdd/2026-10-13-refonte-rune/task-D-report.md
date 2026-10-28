# Task D report: `pnpm dev` command (issue #68)

Worktree `C:\Users\eliott.colin\rune-dev`, branch `socle-dev`, base 06aaa56, commit **b6bd9b4**: `feat(dev): pnpm dev lance le serveur et le web en local, base et premier admin créés au premier lancement` (body ends with `Closes #68` and the Co-Authored-By trailer). Not pushed.

## What was implemented

From the repo root, `pnpm dev` runs `pnpm --filter @rune/server dev`, which runs `node --import tsx scripts/dev/main.ts`. The script:

1. **Settings** (`plan.ts`, pure): the data dir defaults to `os.homedir()/rune-data-dev` and `RUNE_DATA_DIR` overrides it. Server env: `APP_ORIGIN=http://localhost:<web port>`, `HOST=127.0.0.1`, `PORT=3000`, `RUNE_PUBLIC_DIR` set to `apps/web/dist` if that folder exists, otherwise to `<data>/public-vide` (created empty). `RUNE_CONTENT_DIR` is `<repo>/data`. Any variable already set wins, and an empty value counts as unset, like `config.ts`. Two extra variables: `RUNE_DEV_BIRTH_DATE` (default `1990-01-01`) and `RUNE_DEV_WEB_PORT` (default 5173, needed so the integration test can use free ports). An invalid port is refused with a French message.
2. **Busy ports**: 3000 and 5173 are probed first (connect on 127.0.0.1 and ::1, because Vite listens on `localhost`). If one is taken, the script prints `Le port N (serveur|web) est déjà pris : arrête le programme qui l'utilise (un autre pnpm dev ?), puis relance.` and exits 1 before creating anything.
3. **First launch** (`planDataDir`): it creates the folder and the `.rune-volume` sentinel, then runs `init` once. If the database already exists, nothing is redone. A database without a sentinel is refused, with no writes.
4. **First admin**: account detection uses the existing read-only CLI command `db:stats` (JSON, `users` field), with no raw SQL in the script. If `users === 0`, the script runs `admin:bootstrap --birth-date <date>`. Its output is captured, not echoed, and only the `Lien : …` line is extracted (`invitationLinkFrom`) and printed once in the console on `[dev]` lines. It is never written to a file. The link uses `APP_ORIGIN` (`invitationLink` = `${appOrigin}/invite#…`), so it points at 5173, which was checked in the real run. Until an account exists, each launch issues a new link: `bootstrapAdminInvitation` revokes the previous one. The README says so.
5. **Processes** (`processes.ts`, `supervisor.ts`): there is never a shell. Everything goes through `process.execPath` with resolved script paths: `tsx/cli` resolved from `apps/server`, and `vite/bin/vite.js` resolved from `apps/web`'s `vite/package.json`.
   - Server: `tsx watch --clear-screen=false src/main.ts`. tsx is already a dependency, so no new dependency was added.
   - Web: `vite --configLoader runner --port <p> --strictPort`.
   - Output is split into lines and prefixed `[serveur]` / `[web]` (`output.ts`).
   - **Stop on request** (SIGINT, SIGTERM or SIGHUP): on Windows, Ctrl+C already reaches every process in the console. On POSIX, children run in their own process group and get SIGINT. After 5 s, anything still running is killed with its whole tree (`taskkill /pid N /T /F` on Windows, `kill(-pgid, SIGKILL)` on POSIX). Exit code 0.
   - **One child exits**: the other is killed with its tree. The exit code is the child's code, or 1 if it exited with 0 or by a signal. The script never hangs if a child survives the kill.
6. **Service worker**: `main.tsx` registers the SW only when `import.meta.env.PROD`, and the precache plugin runs at build only. The dev server on 5173 therefore serves no SW. The "comme en production" procedure uses origin 3100, so no SW can be left behind on 5173 by our own procedures. The README covers the remaining case: a build served on 5173 (unregister it in DevTools).
7. **README**: the section « Lancer Rune en local (sans Docker) » now starts with `pnpm install` then `pnpm dev`, and covers:
   - where the dev data lives;
   - the invitation link (console only, and a new one on each launch until the account exists);
   - how to start over (delete `rune-data-dev`);
   - ports, overriding variables and the SW.

   The subsection « Comme en production » keeps the build plus `node --import tsx src/main.ts` procedure for testing the installable app. The tone stays impersonal (« il faut »).

**Docker**: not used.

## Files

- New `apps/server/scripts/dev/`, one responsibility per file:
  - `plan.ts`: pure logic;
  - `output.ts`: line prefixer;
  - `ports.ts`: port probe;
  - `processes.ts`: spawn, capture and tree kill;
  - `supervisor.ts`: stop policy;
  - `main.ts`: orchestration.
- New `apps/server/test/dev/`: `plan.test.ts`, `output.test.ts`, `ports.test.ts`, `supervisor.test.ts`, `dev-run.test.ts`.
- Modified:
  - root `package.json`: `dev` script;
  - `apps/server/package.json`: `dev` script;
  - `apps/server/tsconfig.json`: `include` += `scripts`, so the dev scripts are typechecked;
  - `README.md`.

## Tests and TDD evidence

**RED** (tests written first; run before any implementation file existed):

```
npx vitest run --project server test/dev
 FAIL  |server| test/dev/dev-run.test.ts   Error: Cannot find module '../../scripts/dev/ports'
 FAIL  |server| test/dev/output.test.ts    Error: Cannot find module '../../scripts/dev/output'
 FAIL  |server| test/dev/plan.test.ts      Error: Cannot find module '../../scripts/dev/plan'
 FAIL  |server| test/dev/ports.test.ts     Error: Cannot find module '../../scripts/dev/ports'
 FAIL  |server| test/dev/supervisor.test.ts Error: Cannot find module '../../scripts/dev/supervisor'
 Test Files  5 failed (5)
```

**GREEN**:

```
npx vitest run --project server test/dev/plan.test.ts test/dev/output.test.ts test/dev/supervisor.test.ts test/dev/ports.test.ts
 Test Files  4 passed (4)   Tests  28 passed (28)
npx vitest run --project server test/dev/dev-run.test.ts
 Test Files  1 passed (1)   Tests  2 passed (2)   Duration 8.28s
```

The first integration run failed for a bug in the test, not in the script. Its `waitFor('ports libérés')` threw because the script had exited, which was the expected outcome. I added a `scriptAlive: false` option, and the second run was green.

**Integration test** (`dev-run.test.ts`, about 8 s on Windows, stable across 3 runs). It runs the real script on a temp dir with free ports, and checks:
- `/api/health` answers 200 and the web root serves `id="root"`;
- the sentinel and database exist;
- `[serveur]` and `[web]` prefixes are present;
- the invitation link targets the web port. This is asserted as a boolean only: the failure output masks `#…` and `Code : …`.

Teardown kills the whole tree (`taskkill /T /F` on Windows, process group on POSIX) even on failure. It then checks both ports are free and `git status` is unchanged, and removes the temp dir with retries. A second case occupies the server port and checks the French message, a non-zero exit and that no data dir was created. Vitest variables and `NODE_ENV` are removed from the child env.

**Full suite**:
- `pnpm lint`: clean (479 files).
- `pnpm typecheck`: green, 4 packages.
- `pnpm test`: **173 files, 2177 passed, 2 skipped**. The output is pristine (only the usual happy-dom performance hint, present before this task).
- `name.test.ts` and `docs.test.ts` are green. docs.test does not check the README section.

No E2E spec is named in the brief, and none touches this.

## Real run (brief item 10)

A driver script in my scratchpad started the real `pnpm dev` (through pnpm's `pnpm.cjs` and `process.execPath`, without a shell) with `RUNE_DATA_DIR` set to a new temp dir and the default ports 3000/5173, both checked free first. Output was masked before printing, so the link never reached a file.

```
4.7s OK server health :3000
4.8s OK web :5173
4.8s proxy /api/health via 5173 -> 200 {"status":"ok","db":"ok",...,"version":"dev",...}
link line points at 5173: true
db: true sentinel: true public-vide: true          (no apps/web/dist in this worktree)
9.1s OK server restarted after edit of apps/server/src        ([tsx] change in ./src\health\routes.ts Restarting...)
12.1s OK server restarted after edit of packages/contracts/src
14.9s OK server restarted after edit of packages/domain/src     (Vite also logged "page reload" for the package files)
node processes under rune-dev after kill: 0
port 3000 busy after kill: false
port 5173 busy after kill: false
temp removed: true
```

Each edited file was restored byte for byte, and `git status` showed only my changes. The console showed `[dev]` lines with the database, the folder, the URLs and the masked link `http://localhost:5173/invite#XXXX`.

## Self-review and concerns

- **Ctrl+C itself was not tested by keystroke.** No tool here can send a console Ctrl+C on Windows. The stop was done by killing the tree, which is the last-resort path. The graceful stop policy is covered by `supervisor.test.ts` with fake children: interrupt, then wait the grace delay, then tree kill. A manual Ctrl+C by the owner on the first use would close this gap.
- **The proxy port is fixed at 3000** in `apps/web/vite.config.ts`, which is outside my file list. If `PORT` is overridden, the script prints a warning that `/api` through Vite will not reach the server. The README says the proxy always targets 3000.
- **tsx watch needs about 1 to 3 s after the server starts** before it reacts to edits. An edit made in the very first second after start was not seen in my first attempt. This only matters for scripted checks.
- When `pnpm` is the parent, a Ctrl+C may return the prompt while the script finishes its cleanup (up to 5 s). This is pnpm's behaviour, not changed here.
- Vite writes its normal dependency cache in `apps/web/node_modules/.vite` (git-ignored). The integration test checks that `git status` is unchanged.
- The `review-package` command wrote its diff under `rune-dev/.superpowers/sdd/…`, which is git-ignored by `.superpowers/sdd/.gitignore`.
- **Secrets**: no code, link or password appears in this report, the commit message or the test snapshots. The temp logs were masked and are deleted with the temp dirs.


---

# Fix report, round 1 (integration of fix/TD-r1-g1, g2, g3 into socle-dev)

Base b6bd9b4. Each branch was cherry-picked in order (`git cherry-pick b6bd9b4..<branch>`), linear history, no merge commits:

- dec692f (from 710973f, group 1): fix(dev): un serveur qui ne démarre pas arrête pnpm dev ; relances éprouvées
- d59008c (from f2e3c16, group 2): fix(dev): pnpm dev refuse les variables et la base de la procédure « Comme en production », tue tout sur un second Ctrl+C, tests d'arrêt réels
- 90cf9c4 (from 5fdcf33, group 3): test(dev): test ::1 sauté sans boucle locale IPv6, bornes de port 1 et 65535 acceptées

No extra integration commit was needed: lint, typecheck and the full suite were green after the three picks.

## Group 1: TD-F2, TD-F5

- **TD-F2 (a server crash never stopped pnpm dev).** The server now runs under tsx watch through a new entry, `apps/server/scripts/dev/server-entry.ts`. It sets an 'exit' hook, then dynamically imports `src/main.ts`, so load-time errors are also caught. It writes a ready status line, plus an exit line when the exit code is not 0.
  - New pure module `server-status.ts` formats and parses those lines. `createServerWatch` tells apart failed-at-start, crashed, restarted and started.
  - `output.ts` and `processes.ts` filter the status lines out of the console.
  - If the server fails at start, `main.ts` prints « Le serveur n'a pas pu démarrer : il faut corriger l'erreur ci-dessus, puis relancer pnpm dev. », kills the tsx tree and exits non-zero.
  - Judgment call: a crash after a successful start keeps Vite up. The script logs that the server stopped with an error, then « Le serveur est reparti. » after the next edit. This keeps the auto-reload loop working. To stop on every crash instead, `main.ts` would also resolve on 'crashed'. The README describes the current behaviour.
  - RED: the integration case with HOST=192.0.2.1 (EADDRNOTAVAIL) was still running after 60 s at the base. `server-status.test.ts` and the output filter case also failed first. Then GREEN.
- **TD-F5 (second launch untested).** New integration case with three launches on one data dir. Launch 1 initialises the base. Launch 2 runs no init, keeps the same rune.db inode and birthtime, prints a new link and accepts the invitation (201). Launch 3 prints no link and runs no init. Assertions are booleans on masked output.
  - Mutants `users >= 0` and « init regardless of plan » both fail this case.
- Group tests: test/dev gave 6 files and 37 passed. Lint and typecheck were clean. A real run showed that a crash after start keeps the web up, the server recovers after the next edit, and ports and processes are freed.

## Group 2: TD-F1, TD-F3, TD-F4, TD-F6, TD-F7, TD-F8, TD-F10, TD-F12, TD-F13

- **TD-F3.** `devSettings` refuses `PORT` ≠ 3000 (`PROXY_PORT`, exported) unless `RUNE_DEV_ANY_PORT=1`. It also refuses `RUNE_DATA_DIR` = `<home>/rune-data`.
  - `planDataDir` refuses a base that has the sentinel but no `.rune-dev` marker. `main.ts` writes `.rune-dev` together with the sentinel before init.
  - README: run pnpm dev in a new terminal after « Comme en production ».
  - Consequence: a dev folder created by b6bd9b4 must get an empty `.rune-dev` file, or be deleted.
- **TD-F1.** A second signal resolves a `force` promise. `supervise()` then skips the grace wait and tree-kills everything (new supervisor test).
  - The script prints `[dev] Processus : serveur N, web M`.
  - Test teardown: on POSIX it walks descendants with `ps` and SIGKILLs them; on Windows it runs `taskkill /T /F`. The first case checks that both child PIDs are dead. The POSIX path will run on CI.
- **TD-F4.** New `processes.test.ts` runs the real `killTree` on a child whose grandchild listens on a port. On Windows the grandchild is detached to leave Node's job object, which makes a mutant without `/T` fail.
  - New integration case that kills only Vite: the script exits non-zero, logs « Le web s'est arrêté », never logs « ne répond pas à l'arrêt », and frees the ports and the server PID itself.
- **TD-F13:** `freePorts(n)` returns distinct ports.
- **TD-F12:** exactly one `invite#` in the output and no `Code : ` line.
- **TD-F10:** `setEncoding('utf8')` in `runCapture` and `spawnPrefixed`, with a test where `é` is split across two writes.
- **TD-F8:** `devEnv` drops `VITEST*`, `NODE_ENV`, `APP_ORIGIN`, `HOST`, `PORT` and `RUNE_*`.
- **TD-F7:** prefix assertions run on `masked()`.
- **TD-F6:** the README documents `RUNE_DEV_WEB_PORT` and `RUNE_DATA_DIR`.
- Group tests: RED gave 10 failed and 28 passed, then GREEN gave 6 files and 38 passed. Mutation checks: no `/T`, killTree as a no-op, link printed twice, and the old devEnv all fail. Real run: the refusals exit 1 in French, the link is printed once, killing only Vite gives exit 1, and ports and processes are freed.

## Group 3: TD-F14

- `ports.test.ts`: a top-level-await probe for the `::1` loopback, with `it.skipIf(!hasIpv6Loopback)`.
- `plan.test.ts`: `it.each([1, 65535])` accepts both bounds, and 65536 was added to the rejected values.
- RED: the mutant `port > 1 && port < 65535` fails both bound cases. The skip path was checked with 2001:db8::1. Then GREEN.

## Conflicts resolved

1. **`apps/server/test/dev/dev-run.test.ts`** (g2 onto g1). Group 2 rewrote the file's helpers: it removed `freePort()` and the local `killTree`, and added `freePorts(n)`, `interrupt`, `killAll`, `childPids`, `isAlive` and `portsFree`. Group 1 added two cases that used the old helpers, at the same place as group 2's new « web stops » case.
   - Resolution: all three cases are kept.
   - Group 1's two cases now use `freePorts(2)`.
   - They pass `RUNE_DEV_ANY_PORT: '1'`, because group 2's devSettings refuses PORT ≠ 3000 otherwise.
   - In the relaunch case, `stop()` uses `interrupt(child)`, then waits for free ports and for the printed child PIDs to be dead.
   - Both cases wait for ports with `portsFree`.
   - The relaunch case still passes with group 2's `.rune-dev` marker, since launch 1 writes it.
2. **`apps/server/test/dev/plan.test.ts`** (g3 onto g2). Group 2 added the port and rune-data refusal cases before the invalid-port `it.each`. Group 3 added the bounds case and 65536 there.
   - Resolution: group 2's cases are kept, followed by group 3's bounds case and invalid list (with 65536).
   - The bounds case now also passes `RUNE_DEV_ANY_PORT: '1'`, since PORT=1 or 65535 would otherwise be refused by the proxy-port rule.
   - `parsePort` runs before the proxy-port refusal, so the invalid-value cases still test validation.
3. `README.md`, `main.ts` and `processes.ts` merged automatically. I checked `main.ts`: it uses the server-entry status watch (g1) together with the `.rune-dev` marker, the `force` promise and the PID line (g2). `spawnPrefixed` keeps both the utf8 decoding (g2) and the stdout `keepOut` filter (g1).

## Final command outputs (HEAD 90cf9c4)

```
pnpm lint       -> biome check . : Checked 483 files in 468ms. No fixes applied.
pnpm typecheck  -> exit 0 (all packages)
npx vitest run test/dev (apps/server) -> Test Files 7 passed (7) · Tests 48 passed (48) · 31.70s
pnpm test       -> exit 0 · Test Files 175 passed (175) · Tests 2195 passed | 2 skipped (2197)
git status      -> clean
```

This time the release.test.ts « garde CI » timeout that groups 1 and 2 saw under load did not occur. No invitation link or code appears in this report. The test log has 0 occurrences of `invite#`.

Fix worktrees `rune-dev-fix-TD-r1-g1`, `-g2` and `-g3` were removed, and branches `fix/TD-r1-g1`, `-g2` and `-g3` were deleted.

# Fix report, review findings TD-F4 to TD-F20 (integration of the second fix/TD-r1-g1, g2, g3 into socle-dev)

All three groups branched from socle-dev HEAD 90cf9c4, not from b6bd9b4: the findings point at code that only exists after the first integration. So I cherry-picked `90cf9c4..fix/TD-r1-gN` in order. Using `b6bd9b4..` would have re-applied dec692f, d59008c and 90cf9c4. History stays linear with no merge commits:

```
817732a test(dev): dossier personnel isolé, lien jamais sur disque, port du web occupé, nouveau lien à la relance   (g3, a382667)
c696e1f fix(dev): RUNE_DATA_DIR absolu et hors du dépôt, casse ignorée sous Windows ; README des variables, du PORT et de la CSP   (g2, 21db695)
d60167a fix(dev): une sortie anormale de pnpm dev arrête le serveur et le web, le message de port pris dit qui le tient   (g1, 89892f9)
2799141 test(dev): refus d'une base qui n'est pas de dev éprouvé sur le vrai script, variantes du dossier rune-data   (g1, a87edf2)
```

No integration commit was needed: lint, typecheck and the tests were green after the cherry-picks.

## Group 1: TD-F4, TD-F9, TD-F12, TD-F17

- **TD-F4** (dev-run.test.ts): a new `it.each` with two cases, both on a real base created by the server CLI `init` with the .rune-volume sentinel. Case 1 has no .rune-dev marker. Case 2 also has the sentinel removed.
  - The script must exit non-zero within 20 s and print the reason.
  - It must print no `invite#` and no [serveur] or [web] line.
  - rune.db keeps its mtime and size, and the folder listing is unchanged.
  - RED: the mutant `devMarkerExists: existsSync(sentinel)` fails case 1, and removing the `refused` throw fails both cases.
- **TD-F17** (plan.test.ts): the tautological `join(prod, '')` is replaced by three variants that must throw DevError:
  - a trailing separator;
  - forward slashes with a trailing `/`;
  - a detour through `x/..`.
  - RED: the mutant using plain string equality fails it (1 failed / 23 passed).
- **TD-F9**: already fixed at 90cf9c4 by `setEncoding('utf8')`, so no change was needed. Removing those lines makes the two split-« é » tests fail.
- **TD-F12**:
  - supervisor.ts adds `createEmergencyStop(killTreeSync)`, which keeps the set of live children. Its `killAll()` kills each child once, synchronously, and carries on past a kill that throws.
  - processes.ts adds `killTreeSync`, which runs `taskkill /T /F` without a shell on Windows and `kill(-pid, SIGKILL)` on POSIX.
  - main.ts adds `crash()`, which runs at most once: it calls killAll, prints « [dev] Arrêt imprévu : … », then exits with 1. It is wired to uncaughtException, to EPIPE on stdout and stderr, and to the final rejection branch. `process.on('exit')` also calls killAll.
  - plan.ts: `portBusyMessage(port, role, platform)` now adds the command that finds the process holding the port: PowerShell `Get-NetTCPConnection` on win32, `lsof` elsewhere.
  - Tests: 3 unit tests for createEmergencyStop, the real tree-kill test run for both killTree and killTreeSync, 2 portBusyMessage tests, and a dev-run EPIPE case (stdout closed, then /api/health).
  - RED: 6 unit tests failed before the implementation, and the EPIPE case had no « Arrêt imprévu » line.
  - Group 1's observation: on Windows, Node's job object already kills the children when the script dies, so the orphan risk is real on POSIX. A hard kill of the script itself cannot run any handler: on Windows the job object still covers it, on POSIX it remains a limit.

## Group 2: TD-F7, TD-F11, TD-F13, TD-F16

- **TD-F11** (plan.ts):
  - devSettings takes `ctx.platform` and uses path.win32 or path.posix accordingly, so win32 compares without case.
  - A relative RUNE_DATA_DIR is refused.
  - A RUNE_DATA_DIR that is the repo or inside it is refused, through `isWithin`.
  - The rune-data guard now uses `paths.relative(...) === ''`.
  - The test paths are now absolute on every platform (`resolve('/...')`).
  - New cases: relative paths, paths in the repo, `REPO/..essai` (refused), paths beside the repo (accepted), win32 case variants, and Linux being case-sensitive.
  - RED: 3 failed / 24 passed. GREEN: 27 passed. These mutants are killed: posix forced on win32, `startsWith('..')` without sep, and dropping `rel !== '..'`.
- **TD-F13** (README): PORT is taken out of the variables that win. It must stay 3000 because of the Vite proxy, and pnpm dev refuses any other value.
- **TD-F7** (README): a new bullet lists the variables specific to pnpm dev: RUNE_DATA_DIR and RUNE_DEV_BIRTH_DATE, plus RUNE_DEV_WEB_PORT and RUNE_DEV_ANY_PORT, which are for tests.
- **TD-F16** (README): the CSP and the service worker are checked only with « Comme en production » or the E2E suite. On 5173, Vite serves pages without the server's CSP header.
- Real run by group 2: the three refusals exit 1 with their message, and a normal start works (proxy 200, one link, ports free afterwards).

## Group 3: TD-F10, TD-F18, TD-F19, TD-F20 (tests only, dev-run.test.ts)

- **TD-F20**:
  - devEnv points HOME and USERPROFILE at `tmp/home`.
  - afterEach asserts that nothing was written there, after a cleanup that runs in a `finally` block.
  - RED: a mutant that writes into homedir() fails.
- **TD-F19**: after the stop, `filesContaining(code)` searches every file under tmp except rune.db*, and the list must be empty. The code is never printed.
  - RED: a mutant that writes bootstrap.log fails.
- **TD-F18**: the busy-port case becomes an `it.each` over the role. The server port is occupied on 127.0.0.1, and the web port on ::1 with a fallback to 127.0.0.1 (helper `occupy`).
  - RED: a mutant that probes only the first port fails the web case.
- **TD-F10**: `freePorts` was already fixed at 90cf9c4. The relaunch case is strengthened:
  - launches 1 and 2 must each print exactly one link;
  - launch 2's code must differ from launch 1's.
  - RED: three mutants fail.

## Conflicts resolved

1. **`apps/server/test/dev/plan.test.ts`** (g2 onto g1), import line only. g1 imports `{ join, sep }` for its rune-data variants, and g2 imports `{ join, resolve }` for its absolute test paths. Resolution: `import { join, resolve, sep } from 'node:path'`.
   - g1's variants still throw on g2's code:
     - a trailing separator, forward slashes and `x/..` are all handled by `paths.relative(...) === ''`;
     - on Windows, `path.win32` accepts the forward-slash form.
   - plan.ts merged automatically: g1's `portBusyMessage(platform)` sits alongside g2's `pathsOf`, `isWithin` and the new refusals.
2. **`apps/server/test/dev/dev-run.test.ts`** (g3 onto g1), three hunks.
   - **Imports**: the fs import now unites both sides. g1 needed `mkdirSync` and `writeFileSync`, and g3 needed `readFileSync`. Biome reformatted it onto several lines.
   - **The case block**: all of these are kept, in this order:
     - g1's EPIPE case;
     - g3's busy-port `it.each` over the role, which replaces the old single busy-port case that g1 had left unchanged;
     - g1's base-refused `it.each`.
   - g1's refused-base case runs `init` through `devEnv(...)`, so it now also inherits g3's isolated HOME. g3's afterEach checks that this init writes nothing under the home folder, and it passes.

## Final command outputs (HEAD 817732a)

```
pnpm lint       -> biome check . : Checked 483 files in 506ms. No fixes applied.
pnpm typecheck  -> exit 0 (all packages)
npx vitest run test/dev (apps/server) -> Test Files 7 passed (7) · Tests 60 passed (60) · 36.89s
pnpm test (1st) -> exit 1 · 1 failed | 2206 passed | 2 skipped: test/infra/release.test.ts « garde CI » "Test timed out in 5000ms"
                   (the known load flake; alone: npx vitest run test/infra/release.test.ts -> 10 passed in 1.40s)
pnpm test (2nd) -> exit 0 · Test Files 175 passed (175) · Tests 2207 passed | 2 skipped (2209)
git status      -> clean
```

The test logs had 0 occurrences of `invite#` and were deleted. No invitation link or code appears in this report.

All 12 findings survive integration: TD-F4, TD-F7, TD-F9, TD-F10, TD-F11, TD-F12, TD-F13, TD-F16, TD-F17, TD-F18, TD-F19, TD-F20. TD-F9 and the freePorts part of TD-F10 were already fixed at 90cf9c4.

Fix worktrees `rune-dev-fix-TD-r1-g1`, `-g2` and `-g3` were removed, and branches `fix/TD-r1-g1`, `-g2` and `-g3` were deleted.
