# Merge 1 report: socle-coach, socle-revue, socle-dev into socle

Date: 2026-10-14. Checkout: C:\Users\eliott.colin\appsport, branch socle. Start HEAD 39beba8. End HEAD **784835f**.

## Merges

| Commit | Branch (head) | Message | Conflicts |
|---|---|---|---|
| bf8f1cb | socle-coach (d480642, base 245c1ef) | merge: coach du profil (T6) dans le socle (Refs #54) | none |
| 574f6ee | socle-revue (2b08f85, base 245c1ef) | merge: revue finale (T14) dans le socle (Refs #62) | none |
| 29cd7ba | socle-dev (817732a, base 06aaa56) | merge: commande pnpm dev dans le socle (Refs #68) | none |

All three were `--no-ff`, each with the Co-Authored-By trailer. Git's ort strategy merged all three with no textual conflict. Nothing had to be resolved by hand.

- **Ruling P1 (privacy-content.ts):** checked after the merge. T0/T2's « Rune » wording is kept (« Rune est un outil de suivi entre proches… », « Rune est réservé aux 16 ans et plus… »). T14's rescue-envelope sentence is there too (« Une copie scellée des clés du serveur et des sauvegardes (l'enveloppe de secours) est confiée à une personne de confiance majeure… »), along with « au quotidien, seul … en détient les clés ». The envelope sentence names no brand, and no « appsport » remains in the file. No edit was needed.
- **socle-dev:** root package.json (adds the `dev` script), README.md (new « Lancer Rune en local » section with `pnpm dev`, the old procedure moved under « Comme en production ») and apps/server/{package.json,tsconfig.json} all merged cleanly. pnpm-lock.yaml was not touched by any branch: no dependency changed. `pnpm install --frozen-lockfile` reported « Lockfile is up to date », so no regeneration was needed.

## Ruling P3 (784835f)

`refactor(web): le type CoachId vient des contrats`: deleted apps/web/src/ui/art/coach-id.ts. The three files that imported it now use `import type { CoachId } from '@rune/contracts'`: apps/web/src/ui/CoachAvatar.tsx, apps/web/src/ui/CoachBubble.tsx and apps/web/test/ui/sheet-motion.test.tsx. Biome sorted the imports. Nothing else referenced the file: the art-folder test lists only the generated files.

## Checks (after the merges and P3)

- `pnpm install --frozen-lockfile`: up to date.
- `pnpm lint`: biome check, 524 files, no fixes, exit 0.
- `pnpm typecheck`: contracts, domain, server and web all pass, exit 0.
- `pnpm test`: 182 files, 2482 passed and 2 skipped, exit 0. The 2 skips existed before: two `runIf(node:sqlite)` cases in adapter.test.ts during the better-sqlite3 run. The IPv6 `::1` port test ran. Output is clean.
- `pnpm test:infra` (Git Bash, bats): 79 run, 0 failed, exit 0. 3 are skipped by design (« liens symboliques non fiables sous Windows : vérifié par le job infra »).
- `pnpm dev` from the merged socle, run as the README says, with RUNE_DATA_DIR set to a temporary folder in the scratchpad (absolute, outside the repo):
  - First launch: the base was initialised, the files `.rune-volume` and `.rune-dev` and `rune.db` were created, and the admin invitation link was printed (masked here).
  - `[web]` showed Vite 8.3.3 ready. `GET :3000/api/health` returned 200 with db ok. `GET :5173/` returned 200 with the title « Rune ». `GET :5173/api/health` (the Vite proxy) returned 200 with the same epoch.
  - Stop: `taskkill /T /F` on the pnpm process tree. This is the same method the dev-run tests use on Windows, since no console Ctrl+C can be sent from here. Afterwards no matching node process was left and nothing listened on 3000 or 5173.
  - The log holding the invitation link and the temporary data folder were deleted.
- No integration fix was needed: no extra commit.

## E2E: `pnpm --filter @rune/web test:e2e` (22 tests, Chromium and WebKit)

The run gave 6 passed and 16 failed. **All 16 failures are expected by P7/P15**, because complete now requires a coach. Each project has the same 8 failures:

| Spec | How it completes onboarding | Failure |
|---|---|---|
| arrival.spec.ts:47 | UI (`completeOnboardingViaUi`) | page shows « Certaines valeurs ne sont pas valides. » after « Commencer », then the 30 s wait for `e2eOnboardingCompleted` times out (flows.ts:81) |
| kill-switch.spec.ts:27 | UI via `setupOnboardedAdmin` | same |
| offline.spec.ts:12 | UI via `setupOnboardedAdmin` | same |
| protocol.spec.ts:11 | UI via `setupOnboardedAdmin` | same |
| shell.spec.ts:120 | UI via `setupOnboardedAdmin` | same |
| update.spec.ts:34 | UI via `setupOnboardedAdmin` | same |
| epoch.spec.ts:64 | raw API (`createAdminViaApi`) | `POST /api/me/onboarding/complete` returns 400 instead of 200 |
| sheet.spec.ts:38 | raw API (T3's spec) | `POST /api/me/onboarding/complete` returns 400 instead of 200 |

The UI failures all stop on the server's `invalid('coach')` (apps/server/src/profile/routes.ts, completeOnboarding). The page snapshots in test-results show the same alert every time. **Passing** in both projects: boot-splash.spec.ts:7, theme.spec.ts:29 and theme.spec.ts:90. **No other failure.**

T7 must fix e2e/support/flows.ts (choose a coach), epoch.spec.ts **and sheet.spec.ts**. sheet.spec.ts arrived with T3 after P15 was written, and it falls under « any other raw-API onboarding completion ».

## Worktrees and branches

- Created `C:/Users/eliott.colin/rune-ecrans` on the new branch `socle-ecrans` from 784835f, then ran `pnpm install --prefer-offline --frozen-lockfile` there. Its tree is clean.
- `git worktree remove` (no --force) worked for rune-coach, rune-revue and rune-dev. Each left a folder holding only `node_modules`, with no file outside it, which I deleted with `rmdir /s /q` (it does not follow junctions).
- `git branch -d` deleted socle-coach (was d480642), socle-revue (was 2b08f85) and socle-dev (was 817732a).
- Not touched: rune-local, rune-specs (brique-2-spec), remote branches origin/socle-coach and origin/socle-revue (no push was done).

## Note

T14 changed the content of the privacy page but `PRIVACY_POLICY_VERSION` is still '1.0'. Nothing has been released yet, so this is probably intended, but the final review should confirm it.
