# Task 2 report: Marque Rune, icônes et logo (issue #50)

Status: DONE_WITH_CONCERNS (concerns are notes for later tasks, nothing blocking).
Commit: a8151f3 `feat(web): logo Rang brisé et icônes de l'appli installée` (on `socle`, base ef8298d, not pushed).

## What I implemented

- `apps/web/src/ui/Logo.tsx`
  - `RuneMark({ size?, glow?, title? })`: inline JSX SVG, no `dangerouslySetInnerHTML`.
    - Without `glow`: the exact paths and values of `docs/brand/rune-mark-mono.svg`, in `currentColor`.
    - With `glow`: the exact gradients, blur filter and glow layer of `docs/brand/rune-mark.svg`.
    - Ids are prefixed per instance: `rune-mark-<useId reduced to [A-Za-z0-9_-]>-{title,rune,frame,glow}`. Two marks on one page share no title or gradient.
    - With a `title`: `role="img"`, `aria-labelledby` pointing to its `<title>`. Without a title: decorative, `aria-hidden="true"` and no id at all. This matches the mockups, where the mark sits next to the word RUNE with `alt=""`.
    - `size` defaults to 28 (the header of MixSombre and MixClair).
    - Addition beyond the brief, default unchanged: without glow, the frame and side ticks sit in a `<g style={{ color: 'var(--rune-mark-frame, currentColor)' }}>`. A parent that sets `--rune-mark-frame: var(--accent)` gets the two-tone light logo of MixClair and GUIDE.md (frame and ticks in accent, rune in ink). With no variable set, everything is `currentColor` as the brief says. Without this, the light header of the mockups could not be built from RuneMark.
  - `RuneWordmark()`: `<span>RUNE</span>` in `var(--font-display)`, weight 700, `letter-spacing: 0.22em`, plus `margin-inline-end: -0.22em`. The negative margin removes the spacing after the final E, so the word centers on its letters (A01 does the same with `padding-left`).
  - Styles use React `style` objects (CSSOM, allowed by the CSP), so no new CSS file outside the list.
- `apps/web/scripts/render-icons.mjs` (replaces `make-icons.mjs`, which is deleted: it drew the old teal dumbbell and would overwrite the new icons if run).
  - Reads `docs/brand/rune-icon.svg` relative to the script, with no path outside the repo.
  - Renders with the Playwright Chromium already installed for E2E: an `<img>` of the SVG, `deviceScaleFactor` 1, screenshot clipped to the size.
  - `icon-192.png` and `icon-512.png` (purpose any) and `favicon-32.png`: the badge as is, rounded corners transparent.
  - `icon-maskable-512.png`: badge at 80 %, centered, 10 % padding on `#070A12`, opaque.
  - `apple-touch-icon-180.png`: badge on `#070A12`, opaque (iOS turns transparency black, then rounds the corners itself).
  - I ran it and committed the 5 PNGs. A second run gives byte-identical files (sha256 checked).
  - Usage: `node apps/web/scripts/render-icons.mjs`.
- `apps/web/public/manifest.webmanifest`: `theme_color` and `background_color` are `#070A12`. `name` and `short_name` were already `Rune` (Task 0). The icons and their `purpose` fields are unchanged.
- `apps/web/index.html`
  - The tab icon is now `<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">`. It is precached like the rest of `dist`, so there is still no `/favicon.ico` request.
  - `theme-color` is now two tags: `media="(prefers-color-scheme: light)"` `#F1F3F7` and `media="(prefers-color-scheme: dark)"` `#070A12`. Before the script runs, the browser bar follows the phone like Auto (the default theme) instead of a fixed teal. `applyTheme` (T1) then writes the kept theme into every tag, which is already covered by `theme.test.ts`, « met à jour chaque balise theme-color ».
- `apps/web/test/ui/theme.test.ts`: comment only. The `resetDocument` comment said index.html has one theme-color tag; it now says one tag per color scheme.

## Tests

- `apps/web/test/app/brand.test.ts` (new, 10 tests)
  - (a) Manifest: `name` and `short_name` are `Rune`, `theme_color` and `background_color` are `#070A12`. Icons are declared as `192x192 any`, `512x512 any` and `512x512 maskable`, and each file exists.
  - (b) RuneMark accessibility:
    - with a title: an `svg` with `role="img"` named by that title;
    - without a title: decorative, `aria-hidden`, no role, no id.
  - (b) RuneMark size: 28 by default, the given size otherwise, `viewBox` 0 0 512 512.
  - (b) Fidelity to the art: the drawing is compared with the files in `docs/brand`, normalized (attribute names lowercased, ids dropped, each `url(#…)` replaced by the rank of its target):
    - mono against `rune-mark-mono.svg`, with no gradient or filter;
    - glow against `rune-mark.svg`.
  - (b) Two glow marks:
    - 8 ids, no duplicate, all matching `[A-Za-z0-9_-]`;
    - every `url(#…)` points inside its own svg.
  - (b) The `--rune-mark-frame` hook covers the frame and ticks; the rune is in `currentColor`.
  - (b) `Logo.tsx` contains no `dangerouslySetInnerHTML`.
  - RuneWordmark: text `RUNE`, `var(--font-display)`, 700, `0.22em`, `margin-inline-end: -0.22em`.
  - Mutation check, done by hand and then reverted: changing one gradient stop or one glow color, or adding an attribute to a mono path, fails the fidelity tests. Swapping the frame stroke to the rune gradient alone also fails the glow test.
- `apps/web/test/pwa/manifest.test.ts` (updated)
  - `readPng` now decodes 8-bit RGB and RGBA PNGs with all 5 PNG filters, because Chromium uses filters 1 to 4. The old reader only accepted unfiltered RGB.
  - Colors are `#070A12`. The 5 PNGs have the right size (`favicon-32` added).
  - any 192/512 and the 32 tab icon: transparent corners and an opaque center. For 192, 512, 180 and maskable, the center is the ice-blue rune, measured at (114, 221, 255).
  - Maskable: every pixel is opaque, and every pixel in the 10 % band is exactly `#070A12`.
  - Apple: every pixel is opaque, and the corners are `#070A12`.
  - index.html: the favicon-32 link, the apple-touch link and both theme-color tags, compared exactly.

### TDD evidence

RED, run before any implementation:

```
pnpm vitest run --project web apps/web/test/app/brand.test.ts apps/web/test/pwa/manifest.test.ts

 ❯ |web| test/app/brand.test.ts (0 test)
 ❯ |web| test/pwa/manifest.test.ts (6 tests | 6 failed) 255ms
     × identité, affichage, portée et couleurs
     × icônes 192 et 512 « any », 512 « maskable » ; les 5 PNG ont la bonne taille (IHDR)
     × « any » et onglet : le badge de rune-icon.svg, coins arrondis transparents, rune glacée au centre
     × maskable : opaque, badge au centre, marge de 10 % en #070A12 tout autour
     × Apple : opaque (iOS noircit la transparence), coins sur #070A12, rune glacée au centre
     × index.html : titre « Rune », manifeste, icône de l’onglet, icône Apple et couleur du thème
 FAIL  |web| test/app/brand.test.ts
Error: Failed to resolve import "../../src/ui/Logo" from "apps/web/test/app/brand.test.ts". Does the file exist?
 FAIL … identité, affichage, portée et couleurs
AssertionError: expected { id: '/', name: 'Rune', …(10) } to match object { …(4) }
 FAIL … les 5 PNG ont la bonne taille (IHDR)
Error: ENOENT: no such file or directory, open '…\apps\web\public\icons\favicon-32.png'
 FAIL … « any » et onglet …  AssertionError: icon-192.png: expected [ 255, 255, 255, 255 ] to deeply equal [ +0, +0, +0, +0 ]
 FAIL … maskable …  AssertionError: expected { notOpaque: +0, bandNotNight: 94044 } to deeply equal { notOpaque: +0, bandNotNight: +0 }
 FAIL … Apple …  AssertionError: expected [ 15, 118, 110, 255 ] to deeply equal [ 7, 10, 18, 255 ]
 FAIL … index.html …  expected '<!doctype html>…' to contain '<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">'
 Test Files  2 failed (2)
      Tests  6 failed (6)
```

Intermediate run, after `Logo.tsx` and before the manifest and icons: 9 RuneMark and Wordmark tests pass. Test (a) fails for the right reason:

```
 FAIL … manifeste : « Rune », fond nuit du logo, icônes 192, 512 et maskable 512 présentes
-   "background_color": "#070A12",  +   "background_color": "#ffffff",
-   "theme_color": "#070A12",        +   "theme_color": "#0f766e",
      Tests  1 failed | 9 passed (10)
```

GREEN:

```
pnpm vitest run --project web apps/web/test/app/brand.test.ts apps/web/test/pwa/manifest.test.ts
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

### Full checks, before the commit

- `pnpm lint`: `Checked 459 files … No fixes applied.`
- `pnpm typecheck`: all 4 packages clean.
- `pnpm test`: `Test Files 167 passed (167)`, `Tests 2119 passed | 2 skipped (2121)`, output pristine (only vitest's own performance hints).
  - The first full run had one failure: `precache-plugin.test.ts › bundleServiceWorker` timed out at 5 s under load. I did not touch that file. Alone it passes in 0.7 s, and the second full run was entirely green. See concerns.
- Name test on the tracked files after the commit: `apps/server/test/infra/name.test.ts` passes (5 tests).
- E2E, which the brief does not name. I ran them because `index.html` (theme-color, icon) changed:
  - command: `pnpm --filter @rune/web test:e2e theme.spec.ts offline.spec.ts`;
  - result: 6 passed on Chromium and WebKit (theme follows Auto and the forced themes through `theme-color`, fonts, offline shell from the cache), with no CSP console message.
- Visual check, not committed:
  - setup: the components rendered with `react-dom/server`, then a Chromium screenshot at 390 px;
  - dark: the glowing mark plus RUNE matches MixSombre;
  - light: with `--rune-mark-frame` set to the accent, the two-tone mark matches MixClair;
  - the 92 px mark and the wordmark centered as in A01;
  - I also looked at the 5 PNGs.

## Files changed (git show --stat HEAD)

```
 apps/web/index.html                            |   5 +-
 apps/web/public/icons/apple-touch-icon-180.png | Bin 479 -> 28255 bytes
 apps/web/public/icons/favicon-32.png           | Bin 0 -> 2021 bytes
 apps/web/public/icons/icon-192.png             | Bin 527 -> 35419 bytes
 apps/web/public/icons/icon-512.png             | Bin 2571 -> 187835 bytes
 apps/web/public/icons/icon-maskable-512.png    | Bin 2343 -> 117608 bytes
 apps/web/public/manifest.webmanifest           |   4 +-
 apps/web/scripts/make-icons.mjs                |  68 ----------
 apps/web/scripts/render-icons.mjs              |  60 +++++++++
 apps/web/src/ui/Logo.tsx                       | 102 ++++++++++++++
 apps/web/test/app/brand.test.ts                | 176 +++++++++++++++++++++++++
 apps/web/test/pwa/manifest.test.ts             | 140 ++++++++++++++------
 apps/web/test/ui/theme.test.ts                 |   2 +-
 13 files changed, 444 insertions(+), 113 deletions(-)
```

`git status` after the commit: clean.

## Self-review

- Brief compliance:
  - every file in the list is created or modified;
  - interfaces are exactly `RuneMark { size?, glow?, title? }` and `RuneWordmark`;
  - manifest values are verbatim;
  - render-icons uses Playwright Chromium and `rune-icon.svg`, produces 192, 512, maskable 512 with 10 % on `#070A12`, apple 180 and favicon 32, and the PNGs are committed;
  - the purpose fields are kept.
- Outside the list:
  - `make-icons.mjs` deleted (replaced; keeping it would let someone regenerate the old icons);
  - one comment line in `theme.test.ts`, made stale by the index.html change.
- No « appsport » in any tracked file I touched, and no path outside the repo in the script.
- CSP: no inline style in `index.html` (`static-rules.test.ts` is still green), and React `style` objects only in `Logo.tsx`.
- `Logo.tsx` is not exported from `ui/index.ts`: that file is not in my list. Consumers import `../ui/Logo`. Adding `export * from './Logo'` there is one line if wanted.

## Concerns, notes for later tasks

1. **Light themes and Auto (T5 header, T13 login, BootSplash).** In the mockups, dark uses the glowing mark and light uses the two-tone mono mark. `glow` is a prop, so a consumer cannot switch it by the CSS media query of Auto. Suggested pattern:
   - render the mono mark with `--rune-mark-frame: var(--accent)` and `color: var(--text)` in light themes;
   - render `glow` in dark themes;
   - switch between the two marks with the same `:root:not([data-theme])` media query and `[data-theme]` selectors as `tokens.css`.

   The glow colors are fixed, as in `rune-mark.svg`. On `#F1F3F7` the top of the rune (`#F2FDFF`) almost disappears, so glow must not be used in Clair or Carnet.
2. **The logo draw-in animation (spec §7) is not done.** It belongs to whoever builds BootSplash (T5). That task may add a class or an animation prop to RuneMark. The paths are in a fixed order (frame, ticks, rune), and the frame is a stroke, which suits `stroke-dasharray`.
3. **Icon weight.** The PNGs go from about 6 KB to about 370 KB in total (the 512 alone is 188 KB).
   - Cause: Chromium dithers the dark radial gradient (which avoids banding), and dithering compresses poorly.
   - Cost: the service worker re-fetches every precached file at each install (`cache: 'reload'`).
   - The spec's budget (T16) covers the initial JS bundle excluding fonts, so icons are outside it. I kept the quality. Lossy quantization would need a new tool.
4. **Possible flaky test.** `precache-plugin.test.ts › bundleServiceWorker` timed out once under full-suite load: the esbuild bundle took more than 5 s, then the temp directory was removed. It passed alone and in the next full run. It is not in the §11.4 list, so I flag it for the flaky-tests task.
5. **Maskable padding.** As ruled, the whole rounded badge is drawn at 80 % on `#070A12`. With a square or squircle launcher mask, the badge's faint edge (cyan stroke at 14 % opacity) shows inside the night field. With the minimum circle mask it is cropped.

---

# Fix report, round 1 (integration of fix/T2-r1-g1, g2, g3)

Integrated on `socle` in the main checkout, base `a8151f3`, by `git cherry-pick a8151f3..<branch>` in group order. History is linear, with no merge commits. Each commit keeps its message, ending with `Refs #50` and the Co-Authored-By trailer. Nothing is pushed.

| Group | Findings | Branch head | Commits on socle |
|---|---|---|---|
| 1 | T2-F5, T2-F2 | 6f899cb | 1296f64 (T2-F5), 963eba4 (T2-F2) |
| 2 | T2-F6 | 6b00de7 | 130953d |
| 3 | T2-F10, T2-F9, T2-F1 | da5105f | f664ed2 |

## Group 1: T2-F5 and T2-F2

**T2-F5, commit 1296f64.** The maskable and Apple icons no longer have the rim, and their corners are square.
- `apps/web/scripts/render-icons.mjs`:
  - New `forOsMask(svg)`. It removes the rim rect (the one with `fill="none"`) and sets rx/ry to 0 on the background rect.
  - It throws if `rune-icon.svg` no longer has exactly one background rect and one rim rect. A change to the art then fails loudly instead of quietly bringing the rim back.
  - It applies only to icons flagged `osMask: true` (maskable 512 and apple 180). The data URI is now built per icon.
- PNGs regenerated:
  - Only `icon-maskable-512.png` and `apple-touch-icon-180.png` changed.
  - icon-192, icon-512 and favicon-32 are byte-identical.
  - A second run gives the same sha256 for all 5 PNGs.
- `apps/web/test/pwa/manifest.test.ts`:
  - New helper `offNight()`. It counts pixels more than 8 away from #070A12 on any channel. The badge corner #04060B is 7 away in blue; a rim pixel is about 30 away.
  - Maskable: every pixel on or outside the 0.4 × width circle stays near #070A12. The pixel just inside each corner of the 80 % badge is #04060B.
  - Apple: the outer 5 % band stays near night, and all 4 corners are #04060B (full bleed, iOS rounds it).
  - The exact-#070A12 10 % band test is unchanged.
- RED, on the old PNGs:
  - maskable `{ count: 2591, first: ['(137, 52) 9,17,28,255', ...] }`, expected 0;
  - Apple `{ count: 828, first: ['(39, 0) 9,17,28,255', ...] }`, expected 0.
  - The corners read [7,10,18,255] where [4,6,11,255] is expected. This was checked with a separate probe, because the run stops before reaching those assertions.
- GREEN: 7 of 7 manifest tests pass.
- Residual design note: under a large squircle mask, the edge of the maskable's 80 % square is a nearly invisible step from #04060B to #070A12, with no cyan. Removing it would need a band colour other than #070A12, which the ruling forbids.

**T2-F2, commit 963eba4.** The RuneWordmark tracking can now be overridden.
- `apps/web/src/ui/Logo.tsx`:
  - `TRACKING = 'var(--rune-wordmark-tracking, 0.22em)'`.
  - `letterSpacing` uses TRACKING, and `marginInlineEnd` is `calc(-1 * ${TRACKING})`.
  - These are still React style objects (CSSOM), which the CSP allows.
- `apps/web/test/app/brand.test.ts`:
  - The word is now rendered inside a 10 px parent, and the tests read computed styles.
  - Default: letterSpacing `2.2px` and marginInlineEnd `calc(-1 * 0.22em)`.
  - New test: a parent with `--rune-wordmark-tracking: 0.3em` gives `3px` and `calc(-1 * 0.3em)`.
- RED:
  - "expected '2.2px' to be '3px'" (the override was ignored);
  - the default test gave "expected '-0.22em' to be 'calc(-1 * 0.22em)'", a change in how the value is written, not a behaviour bug.
- GREEN: 11 of 11.
- Consumer usage for the A01 hero: set `--rune-wordmark-tracking: 0.3em` on the parent, through a CSS module.

## Group 2: T2-F6, commit 130953d

- Changes only `apps/web/e2e/theme.spec.ts` (+9/-2). No app code changed: `setThemeColor` already updates every theme-color tag.
- `look()` now reads the tag the browser actually uses: the first `meta[name="theme-color"]` that has no media attribute, or whose media query matches.
- RED: theme.ts was temporarily broken to update only the first tag.
  - The old spec still passed, 2 of 2.
  - The new spec failed on Chromium and WebKit at « téléphone sombre, Clair forcé : la page est claire », with expected "#F1F3F7" and received "#070A12".
- GREEN after the revert: theme.spec.ts, 4 of 4 passed.

## Group 3: T2-F1, T2-F9, T2-F10, commit f664ed2

Only `apps/web/test/app/brand.test.ts` changed. Logo.tsx was already correct.
- **T2-F1:**
  - `normalized()` now starts each entry with its place in the tree (`svg>defs>lineargradient stop ...`).
  - It keeps `style` and drops only `id`.
  - Only the exact colour wrapper is skipped: a `g` whose only attribute is `style="color: var(--rune-mark-frame, currentColor)"`. Its regex is shared as `FRAME_COLOR_STYLE`.
- **T2-F9:**
  - The duplicate-id test is now `it.each` over 3 cases: untitled, same title, different titles.
  - A new helper `expectOwnIds(container, perMark)` checks the count (3 or 4 per mark), uniqueness and the charset. It also checks that every `url(#…)` and `aria-labelledby` points inside the same svg. References are read from attributes.
  - The tautological `not.toBe` is gone.
- **T2-F10:**
  - New test with `createRoot(host, { identifierPrefix: 'p:«»' })`, wrapped in RTL's `act`.
  - A Probe component asserts that the raw useId breaks the charset, so the test cannot become vacuous.
  - Two glow marks with the same title then pass `expectOwnIds(host, 4)` and both are named "Rune".
- RED by mutation, because Logo.tsx is correct. The old tests let 5 mutants of Logo.tsx through, and the new tests catch them all:
  - M1: crisp paths inside the blur group;
  - M2: `style={{fill:'red'}}`;
  - M3: stops moved out of their gradient;
  - M4: sanitiser removed;
  - M5: prefix taken from the title.
  - For example, M4 fails with "expected 'rune-mark-_p:«»r_d_-title' to match /^[A-Za-z0-9_-]+$/", and M5 with "expected 3 to be 6".
- GREEN: 13 of 13.

## Conflicts

None. Groups 1 and 3 both edit `apps/web/test/app/brand.test.ts`, and git merged it automatically:
- group 1 changes only the `describe('RuneWordmark')` block, adding `wordIn()` and the tracking test;
- group 3 changes the imports, the shared helpers at the top and the `describe('RuneMark')` block.

Both fixes still work together:
- Group 1 changes Logo.tsx only in `WORDMARK`. It does not touch the marks that group 3's stricter fidelity comparison checks, now that `style` is compared.
- The merged file has 14 brand tests: the 10 base tests, +1 from group 1, and +3 from group 3 (`it.each` turns 1 test into 3, plus 1 for useId). All 14 pass.
- No integration commit was needed.

## Final commands (on f664ed2)

- `pnpm vitest run --project web apps/web/test/app/brand.test.ts apps/web/test/pwa/manifest.test.ts`: `Test Files 2 passed (2)`, `Tests 21 passed (21)` (14 brand + 7 manifest). No stderr.
- `pnpm lint`: `Checked 459 files in 519ms. No fixes applied.` (exit 0).
- `pnpm typecheck`: domain, server and web each ran `tsc --noEmit` with no error (exit 0).
- `pnpm test`: `Test Files 167 passed (167)`, `Tests 2124 passed | 2 skipped (2126)` (exit 0). No FAIL and no stderr in the log.
- `pnpm --filter @rune/web test`: `Test Files 70 passed (70)`, `Tests 1010 passed (1010)`. That is 1005 at base, +2 from group 1 and +3 from group 3.
- `pnpm --filter @rune/web test:e2e theme.spec.ts`: `4 passed (13.2s)`, which is apparence and polices on both Chromium and WebKit.
- `apps/server/test/infra/name.test.ts`: 5 passed. The old project name appears 0 times in `git diff a8151f3 HEAD`.

## git show --stat HEAD

```
f664ed2 test(web): logo comparé à docs/brand avec sa structure et ses styles, ids éprouvés par un useId à caractères interdits
 apps/web/test/app/brand.test.ts | 143 +++++++++++++++++++++++++++++-----------
 1 file changed, 105 insertions(+), 38 deletions(-)
```

Whole round (`git diff --stat a8151f3 HEAD`): 7 files changed, 222 insertions(+), 55 deletions(-). The files are theme.spec.ts, the two PNGs, render-icons.mjs, Logo.tsx, brand.test.ts and manifest.test.ts.

## Cleanup

The worktrees `appsport-fix-T2-r1-g1`, `-g2` and `-g3` are removed (`git worktree remove --force`), and the branches `fix/T2-r1-g1`, `-g2` and `-g3` are deleted. `git status` on socle: clean. This file is git-ignored (`.superpowers/sdd/.gitignore`) and is not committed.

Findings addressed: T2-F5, T2-F2, T2-F6, T2-F1, T2-F9, T2-F10. None is left unaddressed.
