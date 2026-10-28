# Task 1 report — Jetons, thèmes et polices (issue #49)

Branch `socle`, main checkout `C:\Users\eliott.colin\appsport`. Base 245c1ef.

## What I implemented

### `apps/web/src/ui/theme/tokens.css` (new): the single source for colours, radii and fonts
- Structure exactly as the brief: `:root` = clair (plus common tokens); `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { …sombre } }`; `:root[data-theme="clair"]`, `[data-theme="sombre"]`, `[data-theme="carnet"]`, `[data-theme="nuit"]`. The media query only targets `:root:not([data-theme])`, so a forced theme always wins over the phone setting. `color-scheme` is set per block (light / dark).
- Imposed tokens, all present: `--bg`, `--surface`, `--surface-strong`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-text`, `--accent-2`, `--danger`, `--success`, `--warning-text`, `--warning-bg`, `--field-bg`, `--field-border`, `--focus`, `--radius-card: 18px`, `--radius-control: 14px`, `--font-display` (Chakra Petch), `--font-body` (Barlow), `--font-title` (`var(--font-display)`, Newsreader in Carnet).
- Values:
  - clair / sombre: the GUIDE.md Tokens table, verbatim (fond, carte, texte, texte secondaire, accent, accent 2, danger, succès, avertissement, champ).
  - carnet: `Carnet.dc.html` (paper #F2ECDF, card #FBF8F1, ink #211B16, secondary #5C5044, pen blue #1F5F8B, borders #D3C5AD / #CDBFA6, card radius 4 px).
  - nuit: `Main.dc.html` (bg #05070D, card #0B1222, Système panel #08101F, text #F2FDFF, secondary #9FB0C6, neon #5ED8FF, violet #8C6BFF, borders #18243B / #1C2A44, card radius 12 px, chip radius 8 px).
- Values the mockups do not give, chosen by me (all pass the contrast test):
  - `--surface-strong` in sombre: #0F1A30, the top stop of the GUIDE gradient (the gradient itself belongs to the Système panel of Task 4).
  - `--border` in clair: #DCE2EA (control borders of the Réglages mockup; GUIDE cards use a shadow).
  - carnet: `--accent-2` #C45C48 (the red margin, full ink), `--danger` #A8322A, `--success` #2F6B3A, `--warning-text` #7A4E00 on `--warning-bg` #F6E3A8, `--radius-control` 4 px.
  - nuit: danger, success and warning are taken from sombre.
- Spacing (`--space-*`) and `--content-width` moved here from `ui.module.css` (one source), unchanged.
- **Bridge for screens not restyled yet:** every `--color-*` variable still read by `features/**` and `sw/UpdateBanner.module.css` is mapped to a new token in one `:root` block (`--color-bg: var(--bg)`, `--color-muted: var(--text-muted)`, `--color-primary: var(--accent)`, `--color-info-bg: color-mix(in srgb, var(--accent) 10%, var(--surface))`, …, `--radius: var(--radius-control)`). All screens therefore follow the 5 themes before their restyle. A test guarantees that no `var(--…)` in `src/**/*.css` is left undefined.

### `apps/web/src/ui/theme/fonts.css` (new; the brief named `fonts.ts`, see Deviations)
Six `@font-face` rules: Chakra Petch 600/700, Barlow 400/500/600, Newsreader 600. Each has `font-style: normal`, `font-display: swap` and a single `src: url("@fontsource/<pkg>/files/<pkg>-latin-<w>-normal.woff2") format("woff2")`. There is no external URL and no `@import`.

### `apps/web/src/ui/theme/theme.ts` (new)
- `type ThemeChoice = 'auto' | 'clair' | 'sombre' | 'carnet' | 'nuit'` and `THEME_CHOICES`.
- `readThemeChoice()`: reads localStorage key `rune.theme` inside try/catch. An unknown value or a blocked storage gives `'auto'`.
- `writeThemeChoice(c)`: try/catch. If storage refuses the write, the theme stays applied until the page reloads.
- `applyTheme(c, root = document.documentElement)`:
  - sets `data-theme` for a forced theme and removes it for Auto;
  - updates every `<meta name="theme-color">` and creates one if the page has none: #F1F3F7 clair, #070A12 sombre, and the `--bg` of carnet (#F2ECDF) and nuit (#05070D);
  - in Auto, follows `matchMedia('(prefers-color-scheme: dark)')` at call time and on `change`. The listener is removed when a forced theme is applied, and a second Auto call does not add another listener.
- `useThemeChoice()`: returns `[choice, set]` through `useSyncExternalStore`. The snapshot is the theme applied to `<html>`. `set` calls `writeThemeChoice` then `applyTheme`, and every subscribed component re-renders, so two screens showing the choice stay in sync.

### `apps/web/src/main.tsx`
Imports `tokens.css` and `fonts.css`, then calls `applyTheme(readThemeChoice())` right after the imports, before services and `createRoot`. There is no inline script (CSP). Auto colours come from the CSS media query only.

### `apps/web/src/ui/ui.module.css`
- The old `:root` token blocks (light and dark `--color-*`) are removed.
- Every rule now uses the new tokens:
  - body: `--bg` / `--text` / `--font-body`; `h1–h3`: `--font-title`; links: `--accent`;
  - buttons and fields: `--field-border`, `--field-bg`, `--radius-control`; primary: `--accent` / `--accent-text`; danger: `--danger`;
  - banners: info and error use `color-mix` of `--accent` / `--danger` with `--surface`, warning uses `--warning-bg`;
  - dialog: `--surface` / `--radius-card`.
- Added a global `:focus-visible` outline in `--focus`.

### `apps/web/package.json` and lockfile
`@fontsource/barlow`, `@fontsource/chakra-petch` and `@fontsource/newsreader` at exact version `5.3.0`. `npm view <pkg> time` gives 2026-07-19 for all three, which is more than two weeks before today, 2026-10-13. pnpm also re-sorted `@rune/server` among the devDependencies (alphabetical order, no version change).

## Tests (new)

**`apps/web/test/ui/theme.test.ts`: 26 tests**
- **Choice:**
  - `THEME_CHOICES` order;
  - `readThemeChoice` gives `'auto'` with no storage, when `localStorage.getItem` throws, and for an unknown value;
  - `writeThemeChoice` stores each choice under `rune.theme`, read back as is;
  - no throw when `setItem` throws.
- **applyTheme:**
  - sets `data-theme` for a forced theme and removes it for `auto`; the `root` parameter is honoured;
  - `theme-color` is #F1F3F7 in clair and #070A12 in sombre;
  - each forced theme's `theme-color` equals its `--bg` read from `tokens.css`;
  - every theme-color meta is updated, and one is created when none exists;
  - Auto follows the phone at call time and on each change;
  - a forced theme stops following the phone, and a second Auto adds no second listener.
- **useThemeChoice:**
  - defaults to `auto`;
  - the setter stores, applies and updates two subscribed hooks;
  - it reflects the theme applied at startup.
- **tokens.css:**
  - under `prefers-color-scheme: dark`, `:root:not([data-theme])` is the only rule;
  - one block per forced theme;
  - `:root` declares every imposed token, radii 18/14, the font stacks, and `--font-title: var(--font-display)`;
  - Auto-dark and forced sombre have identical colours;
  - carnet and nuit define every colour, and Carnet titles use Newsreader.
- **Stylesheets of src/:**
  - every `var(--x)` without a fallback is defined, in `tokens.css`, in the same file, or as a custom property set by a component;
  - no other stylesheet declares a variable on `:root` (single source).
- **Fonts:**
  - exactly Chakra Petch 600/700, Barlow 400/500/600 and Newsreader 600;
  - each one has a single latin woff2 `src` from its Fontsource package that resolves on disk, `font-display: swap` and `font-style: normal`.
- **main.tsx:** imports `tokens.css` and `fonts.css`, and `applyTheme(readThemeChoice());` comes before `createRoot(`.

**`apps/web/test/ui/contrast.test.ts`: 8 tests**
- **`contrastRatio` (WCAG 2.x)** is defined in the test and checked against known values: 21:1, 1:1, #777 = 4.48 and #767676 = 4.54.
- **The five colour sets must be present** (assertion on the 5 blocks): clair `:root`, Auto-dark media block, sombre, carnet and nuit. Each set must declare every checked token as hex, so the test cannot pass vacuously.
- **Every declared pair must reach its minimum in every set:**
  - text 4.5:1: text on bg, surface, surface-strong, field-bg and warning-bg; text-muted on bg, surface and surface-strong; accent-text on accent; accent on bg and surface (accent is also the link colour, so I used 4.5 rather than the brief's 3 for accent on bg); danger on bg and surface; warning-text on warning-bg;
  - UI 3:1: accent-2, success and focus, each on bg and surface.

Helper `apps/web/test/support/css-blocks.ts` is a small CSS rule reader. It handles top-level rules plus one `@media` level, merges same-selector rules, and does not split inside parentheses or strings.

**Mutation checks** (temporary edits, restored byte for byte and verified with `cmp` and `git diff --quiet`):

| Mutation | Tests that failed |
|---|---|
| `--focus` removed from carnet | 3 |
| media rule retargeted to `:root` | 4 |
| clair `--text-muted` set to #8A96A6 | 1 |
| `.woff` fallback added to a face | 1 |
| undefined `var(--color-info)` added to a feature module | 1 |
| nuit block renamed | 5 |

## TDD evidence

**RED:** `pnpm --filter @rune/web test theme contrast`, run after writing the tests and before any implementation:
```
 ❯ |web| test/ui/contrast.test.ts (0 test)
 ❯ |web| test/ui/theme.test.ts (0 test)
 FAIL  |web| test/ui/contrast.test.ts [ apps/web/test/ui/contrast.test.ts ]
Error: ENOENT: no such file or directory, open 'C:\Users\eliott.colin\appsport\apps\web\src\ui\theme\tokens.css'
 FAIL  |web| test/ui/theme.test.ts [ apps/web/test/ui/theme.test.ts ]
Error: Failed to resolve import "../../src/ui/theme/theme" from "test/ui/theme.test.ts". Does the file exist?
 Test Files  2 failed (2)
      Tests  no tests
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @rune/web@0.0.0 test: `vitest run --root ../.. --project web "theme" "contrast"`
Exit status 1
```
**GREEN:** same command after implementing:
```
 Test Files  2 passed (2)
      Tests  34 passed (34)
```

## Checks before commit
- `pnpm lint`: `Checked 455 files … No fixes applied.` Biome lowercased the hex values in `tokens.css`; the meta test compares without case.
- `pnpm typecheck`: all 4 packages pass with no output.
- `pnpm test`: final run `Test Files 165 passed (165)`, `Tests 2068 passed | 2 skipped (2070)`, with no stderr from the new tests. Earlier full runs, while the other lanes kept the CPU at 99 %, had environmental failures only:
  - `Test timed out in 5000ms` in process-spawning tests: `release.test.ts`, `release-ci-guard.test.ts`, `build/bundle.test.ts`, `e2e-harness/server.test.ts` and `precache-plugin` bundle. Each passed when rerun, apart from one more `release.test.ts` timeout under load.
  - The known flaky `profile-page.test.tsx` focus test (« Annuler » : le focus revient à « Se déconnecter »), listed in the socle ledger at about 1 run in 3 since T37 and owned by Task 15. It passed 3/3 alone.
- **Step 4 build** (`pnpm --filter @rune/web build`):
  - `dist/assets` has exactly 6 `.woff2` files (chakra-petch-latin-600/700, barlow-latin-400/500/600, newsreader-latin-600, 110 KB in all) and **0 `.woff`**;
  - the `sw.js` precache manifest (14 files) lists all 6 woff2;
  - the built CSS has 6 `@font-face` with `font-display:swap`, URLs `/assets/…woff2`, no `data:` font and no `http`;
  - the 4 `:root[data-theme=…]` blocks and `@media (prefers-color-scheme:dark){:root:not([data-theme])…}` are present.
  - The existing `precache-plugin.test.ts` is green in the final full run.
- **E2E** `pnpm --filter @rune/web test:e2e arrival offline update`: `6 passed (1.8m)` on Chromium (Pixel 7) and WebKit (iPhone 14). The fixture fails on any CSP console message, so the self-hosted fonts load under `default-src 'self'`.
- **Own visual check** (scratchpad, not committed): Playwright at 390 × 844 on the preview build, `/login` and `/privacy`, six runs each:
  - Auto on a light phone and Auto on a dark phone;
  - forced clair on a dark phone and forced sombre on a light phone;
  - carnet and nuit.

  The forced theme always beats the phone. `theme-color` was #F1F3F7, #070A12, #F2ECDF and #05070D as expected. Fonts load on use: Chakra Petch 700 for titles, Barlow 400/600, and Newsreader 600 only in Carnet. All screens stayed readable.

## Files changed (commit b1da823)
```
 apps/web/package.json               |   5 +-
 apps/web/src/main.tsx               |   6 +
 apps/web/src/ui/theme/fonts.css     |  55 ++++++
 apps/web/src/ui/theme/theme.ts      | 108 +++++++++++
 apps/web/src/ui/theme/tokens.css    | 155 +++++++++++++++
 apps/web/src/ui/ui.module.css       | 125 +++++-------
 apps/web/test/support/css-blocks.ts |  87 +++++++++
 apps/web/test/ui/contrast.test.ts   | 111 +++++++++++
 apps/web/test/ui/theme.test.ts      | 365 ++++++++++++++++++++++++++++++++++++
 pnpm-lock.yaml                      |  24 +++
```
`git status` is clean after the commit.

## Deviations from the brief (with reasons)
1. **`fonts.css` instead of `fonts.ts`.**
   - The Fontsource 5.3.0 entry sheets (`latin-600.css` and the others) declare `src: url(…woff2) format('woff2'), url(…woff) format('woff')`. Importing them would make Vite emit and precache the `.woff` fallbacks too, which goes against the ruling's goal that only latin woff2 files are emitted and precached.
   - So the six faces are declared once in CSS, pointing at the packages' `files/*.woff2`. This is declarative, CSP-safe, and gives a real `font-display: swap`.
   - A `fonts.ts` would only have been an empty indirection to that CSS. `main.tsx` imports `fonts.css` directly.
2. **Two test files plus one test helper.** `test/support/css-blocks.ts` is shared by both test files.
3. **Radii per theme.**
   - `:root` keeps 18 px and 14 px.
   - Carnet sets card and control radii to 4 px (its mockup cards are 4 px).
   - Nuit sets 12 px and 8 px (its mockup card and chip).
4. **Accent contrast threshold.** Accent on bg is checked at 4.5:1 (link text) rather than the brief's 3:1. This is stricter, and all themes pass.
5. **`writeThemeChoice('auto')` stores `'auto'`** rather than removing the key. Both read back as Auto.

## Self-review
- **Brief interfaces present with exact names:**
  - `ThemeChoice`, `THEME_CHOICES`, `readThemeChoice`, `writeThemeChoice`, `applyTheme(c, root?)`, `useThemeChoice`;
  - the localStorage key `rune.theme`;
  - every imposed CSS token;
  - the CSS structure, verbatim.
- **CSP:**
  - no inline script, style or external URL;
  - `static-rules.test.ts` (no third-party domain or `@import` in src CSS) is still green;
  - the E2E CSP watch is green.
- **Single source of tokens:** `ui.module.css` no longer declares any; a test enforces it. Every `--color-*` used by the screens is mapped, and none is undefined (tested).
- **No mention of the old name** in any changed file (checked with grep).
- **YAGNI:**
  - no theme labels and no cross-tab `storage` listener; Task 10 owns the Réglages screen;
  - no page decor (Carnet lines and margin, Nuit glow), which are not tokens.
- **Bundle:** about 2 KB JS and 3 KB CSS added, plus 110 KB of woff2 (precached). The pre-existing Vite warning about chunks over 500 kB was already there.

## Concerns / notes for the controller
1. **Field and card borders are below 3:1 in the GUIDE values.**
   - `--field-border` on `--field-bg` is 1.47:1 in clair (#CED6E0 on #FFFFFF) and about 1.5:1 in sombre (rgba .12). It is about 1.7:1 in carnet and 1.3:1 in nuit (`--field-border` #1C2A44).
   - The spec says the colour tokens are those of GUIDE.md (§4). The global constraints ask 3:1 for interface elements in all 5 themes, and WCAG 1.4.11 applies to field boundaries.
   - I kept the GUIDE and mockup values and did not declare that pair in the contrast test.
   - If the owner or controller wants WCAG 1.4.11 on field boundaries, `--field-border` needs about #8590A2 in clair and a matching value in each other theme. That is a one-line change per theme, plus a 3:1 pair in the test.
2. **`--success` in clair (#1E9E63) passes only the UI threshold:** 3.09 on bg and 3.43 on surface. It is fine for the « En ligne » dot and icons, but not for small text. Task 3's « Actif » badge should use `--text` on a success tint or border, not `--success` as text colour.
3. **No task explicitly owns the Carnet and Nuit page decor** (paper lines, red margin, radial glow, HUD corners outside the Système panel). These are not tokens; Task 4 covers the HUD corners of the Système panel only. Task 5 (shell) seems the natural owner of the page background.
4. **`index.html` still ships `theme-color` #0f766e** until Task 2 changes it. `applyTheme` corrects it at startup and updates every theme-color meta, so Task 2 can also use media-specific metas safely.
5. **Full-suite timeouts.** When the lanes run in parallel, the CPU sits at 99 %, and process-spawning tests time out at 5 s. Only these timeouts and the known profile flaky failed; the final full run is green.

---

## Fix report — round 1 (integration of fix/T1-r1-g1, g2, g3)

Integrated on `socle` by cherry-pick (linear history, no merge commit), in group order, onto b1da823. Result: 5 commits; no integration-fix commit was needed. HEAD = `ef8298d`.

| socle | from | group | message |
|---|---|---|---|
| 837d464 | 6b2e993 | g1 | fix(web): le thème suit les autres onglets ; un aperçu ne touche qu'à sa racine |
| 881126c | bc082b8 | g1 | fix(web): décors du Carnet et de la Salle de nuit, voile et contrôles natifs aux jetons |
| f8258ef | 62144fa | g1 | test(web): contrastes du Clair forcé, color-scheme de chaque thème, thèmes tirés de THEME_CHOICES |
| 0ea5075 | 0ced3b6 | g2 | fix(web): thèmes clairs forcés sans assombrissement, contrôles à 14 px, pont --color-* vérifié (conflicts resolved, see below) |
| ef8298d | 2a55609 | g3 | test(web): thème au démarrage et polices du build vérifiés en navigateur, stockage et matchMedia absents couverts |

### Group 1 — T1-F16, T1-F15, T1-F2, T1-F12, T1-F10, T1-F11
- **F10** (`theme.ts`): `applyTheme` sets or removes `data-theme` first, then returns at once when `root` is not the document root. A preview root never changes theme-color, never adds or removes the Auto listener, and never notifies subscribers. The `root?` parameter is kept.
- **F12** (`theme.ts`): one `storage` listener, installed lazily on the first `applyTheme` on the document root (the startup call in main.tsx; no import side effect, so node-environment imports stay clean). On key `rune.theme` or `null` (storage cleared) it re-applies `readThemeChoice()`; subscribed hooks follow.
- **F2** (`tokens.css`, `ui.module.css`): `:root` gets `--page-decor: none` and `--page-inset-start: var(--space-4)`. Carnet gets the Carnet.dc.html red margin (33–34 px) and 32 px paper lines, with `--page-inset-start: 46px`; Nuit gets the Main.dc.html radial glow. The body uses `background-color: var(--bg)` and `background-image: var(--page-decor)`; `.main` and `.footer` take `padding-inline-start: var(--page-inset-start)`. The header keeps its `--surface` background (Task 5 restyles it).
- **F15**: body `accent-color: var(--accent)`.
- **F16**: `--backdrop: rgb(0 0 0 / 0.55)` on `:root`; `.backdrop` uses it; a new test asserts ui.module.css holds no literal colour.
- **F11** (`contrast.test.ts`): forced palettes derived from `THEME_CHOICES` minus `auto`, with a test that the `:root[data-theme="…"]` blocks equal that list. Six renderings are checked as the cascade resolves them (`:root` merged with the block): Auto light, Auto dark, forced clair, sombre, carnet, nuit. Forced Clair is now contrast-checked, and `color-scheme` is asserted per rendering.
- Group's own tests: `pnpm --filter @rune/web test theme contrast base-styles` RED 14 failed / 46 passed, GREEN 3 files / 60 passed; full web suite 69 files / 980 passed. Mutations for F11 (accent added to clair, `color-scheme` removed from nuit, extra `fluo` block, `--focus` removed from carnet), F12 (once-only guard, key filter) and F2 (margin edge moved) each failed the new tests. Visual check at 390 × 844 on /login and /privacy in carnet, nuit and clair (not committed).

### Group 2 — T1-F20, T1-F9, T1-F7
- **F9** (`tokens.css`): forced `clair` and `carnet` declare `color-scheme: only light` (no browser auto-darkening); `:root` (Auto) keeps `light`, sombre and nuit keep `dark`. Test in theme.test.ts; RED `clair: expected 'light' to be 'only light'`.
- **F7** (`tokens.css`): the `--radius-control` overrides are removed from carnet (4 px) and nuit (8 px): fields and buttons keep the guide's 14 px in every theme; card radii stay 4 px and 12 px. Cascade-resolved test; RED `:root[data-theme="carnet"]: expected '4px' to be '14px'`. This supersedes deviation 3 above.
- **F20**: a contract table of the 11 `--color-*` / `--radius` bridge declarations on `:root`, and no other block may redeclare one (theme.test.ts). Contrast measured through the bridge (contrast.test.ts) with `resolveColor`, which follows `var()` chains and computes `color-mix(in srgb, …)`; `hexToRgb` is shared with `luminance`. BRIDGE_PAIRS are the pairs features/ and sw/ really read. RED by mutation (`--color-primary-text: var(--text)`, bg and surface swapped, `--color-muted` redeclared in nuit, info-bg at 90 %), each caught.
- Group's own tests: `pnpm --filter @rune/web test theme contrast` 2 files / 42 passed; full web suite 68 files / 962 passed.

### Group 3 — T1-F19, T1-F18, T1-F17, T1-F6
Test-only changes (`theme.test.ts`, new `e2e/theme.spec.ts`); the source already behaved correctly, so mutations stand in as RED.
- **F18**: `localStorage` access itself throwing (SecurityError getter) gives `auto`, no throw on write, and the hook setter still applies `nuit`; `matchMedia` undefined and a media query with only `addListener` (old Safari) apply without throwing.
- **F17**: the main.tsx call is anchored with `/^applyTheme\(readThemeChoice\(\)\);$/m` before `/^createRoot\(/m`. New E2E « apparence » on the production build: a forced theme beats the phone, Auto follows the media query live (`emulateMedia`), carnet and nuit backgrounds and theme-color.
- **F19**: only `ui/theme/fonts.css` cites `@fontsource` in src/ and index.html. New E2E « polices »: exactly 6 font files in dist, each latin woff2 once, the sw.js precache font list equals dist, and `document.fonts` holds exactly the 6 faces, loaded, with `swap`.
- **F6**: the « every var() is defined » test also reads `ui/motion.css` when it exists; `motion.css` may declare on `:root`, but no theme token.
- Group's own tests: theme 30 passed; full web suite 68 files / 958 passed; `test:e2e theme` 4 passed (Chromium Pixel 7, WebKit iPhone 14). Mutations: 6 Vitest and 3 E2E, each caught.

### Conflicts resolved (cherry-pick of 0ced3b6, group 2 onto group 1)
Groups 1 and 3 applied without conflict. Group 2 conflicted in two files; the resolution is part of commit 0ea5075.
1. **`apps/web/src/ui/theme/tokens.css`, nuit block.** g1 added the glow (`--page-decor: radial-gradient(…)`) right after `--radius-control: 8px`; g2 deleted that line (F7). Kept g1's glow and its comment, dropped `--radius-control: 8px`. The carnet block merged on its own (g2's removal of `--radius-control: 4px`, g1's decor and `--page-inset-start: 46px`). F7 and F2 both hold.
2. **`apps/web/test/ui/contrast.test.ts`, palette setup and bridge loop.** g1 replaced the 5-entry `PALETTES` with 6 renderings derived from `THEME_CHOICES` (`Palette` with `scheme` and `fromRoot`; `seen(p)` = `:root` merged with the block). g2 kept the old 5-entry list and added `BRIDGE_PAIRS`, `rgbToHex`, `resolveColor` and a bridge loop that redeclared `const root` in the scope where g1 already declares `root` (it would not compile). Resolution:
   - kept g2's `BRIDGE_PAIRS`, `rgbToHex` and `resolveColor` verbatim, and g1's `ForcedTheme`, `FORCED`, `Palette` and `PALETTES`;
   - **semantic merge:** g1 asserted `color-scheme: light` for forced clair and carnet, which g2's F9 turns into `only light`. `Scheme` is now `'light' | 'only light' | 'dark'` and `SCHEMES` gives `only light` to clair and carnet (Auto light stays `light`), so both test files assert the same F9 values;
   - the bridge check now sits inside each rendering's `describe` (« à travers le pont --color-* : chaque paire lue par les écrans atteint son minimum ») and reads `seen(p)`. It covers 6 renderings (forced Clair included) instead of 5; the g2 commit message still says « les 5 thèmes »;
   - the merged bridge test still bites: a temporary `--color-primary-text: var(--text)` failed it 6 times (one per rendering), then tokens.css was restored (`grep` shows `var(--accent-text)`, worktree clean).
3. **`theme.test.ts`** auto-merged for g2 and g3. No duplicate `it`/`describe` names across the three test files (checked with `uniq -d`).

### Integration checks (main checkout, HEAD ef8298d)
- `pnpm --filter @rune/web test theme contrast base-styles`: `Test Files 3 passed (3)`, `Tests 69 passed (69)` (g1's 60, g2's 3 theme tests, 6 bridge renderings; g3's theme tests are in the same file count).
- `pnpm lint`: `Checked 457 files in 257ms. No fixes applied.`
- `pnpm typecheck`: contracts, domain, server and web pass with no output.
- `pnpm test` (whole monorepo): exit 0, `Test Files 166 passed (166)`, `Tests 2107 passed | 2 skipped (2109)`, no stderr, no failure. The 2 skipped are the existing `|server| test/db/adapter.test.ts` cases, untouched here.
- `pnpm --filter @rune/web test:e2e theme`: `4 passed (11.1s)` (apparence and polices, Chromium and WebKit).
- Full web E2E (`pnpm --filter @rune/web test:e2e`), run because g1 changed the base sheet: exit 0, `16 passed (2.7m)`. That is arrival, epoch, kill-switch, offline, protocol, theme (2) and update, on Chromium (Pixel 7) and WebKit (iPhone 14), with the CSP watch fixture active.
- No integration breakage, so no extra commit. `.superpowers/sdd/` is git-ignored, so this report is not committed.

### Clean-up
- `git worktree remove --force` on `appsport-fix-T1-r1-g1`, `-g2` and `-g3`, then `git branch -D fix/T1-r1-g1 fix/T1-r1-g2 fix/T1-r1-g3` (was 62144fa, 0ced3b6 and 2a55609). `git worktree list` now shows only socle and the other lanes' worktrees.
- Git left the three folders behind, holding only pnpm `node_modules` junctions. They were deleted with `rmdir /s /q`, which does not follow junctions.
- The g1 folder was held open by an orphaned `vite preview --port 4791` from g1's visual check. It was started at 13:47:19 (g1's commits are at 13:48:04), and it answered 404 once its `dist` was gone. That process and its `sh.exe` parent were stopped, then the folder was removed. No other worktree was touched.
- Final state: `git status` reports `nothing to commit, working tree clean` on socle, 14 commits ahead of origin/socle (not pushed). `git show --stat HEAD` is ef8298d with `apps/web/e2e/theme.spec.ts | 118 +`, `apps/web/test/ui/theme.test.ts | 121 +-` and `2 files changed, 217 insertions(+), 22 deletions(-)`.
- Review package: `.superpowers/sdd/2026-10-13-refonte-rune/review-b1da823..ef8298d.diff` (5 commits, 51459 bytes).

### Findings
- Addressed and surviving integration: T1-F2, T1-F6, T1-F7, T1-F9, T1-F10, T1-F11, T1-F12, T1-F15, T1-F16, T1-F17, T1-F18, T1-F19, T1-F20.
- Not addressed: none.
