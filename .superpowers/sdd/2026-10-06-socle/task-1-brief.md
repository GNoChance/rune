### Task 1: Monorepo, outillage et CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `.node-version`, `.github/workflows/ci.yml`, `docs/vendor-docs/README.md`
- Create: `packages/contracts/{package.json, tsconfig.json, src/index.ts, src/constants.ts}`, `packages/domain/{package.json, tsconfig.json, src/index.ts}`, `apps/server/{package.json, tsconfig.json}`, `apps/web/{package.json, tsconfig.json}`
- Modify: `.gitignore` (+ `.e2e-data/`, `apps/*/dist/`, `test-results/`, `playwright-report/`)
- Test: `apps/server/test/smoke.test.ts`, `apps/web/test/smoke.test.ts`, `apps/server/test/repo/dependencies.test.ts`

**Interfaces:**
- Consumes : rien.
- Produces : paquets `@appsport/contracts`, `@appsport/domain`, `@appsport/server`, `@appsport/web` ; `constants.ts` minimal (`export const MIN_AGE = 16;`) ; projets Vitest `contracts`, `domain`, `server`, `web` ; scripts racine `lint`, `typecheck`, `test`, `test:e2e`.

**Spec:** 01 §2 (stack et versions), 01 §4 (dépôt), R-TST-1, R-TST-2.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/smoke.test.ts
it('résout @appsport/contracts depuis le serveur', () => { expect(MIN_AGE).toBe(16); });
// apps/web/test/smoke.test.ts : même assertion + expect(typeof document.createElement).toBe('function') (happy-dom)
// apps/server/test/repo/dependencies.test.ts : clés @appsport/* des quatre package.json
expect(appsportDeps('packages/contracts')).toEqual([]);
expect(appsportDeps('packages/domain')).toEqual(['@appsport/contracts']);
expect(appsportDeps('apps/server')).toEqual(['@appsport/contracts', '@appsport/domain']);
expect(appsportDeps('apps/web', 'dependencies')).toEqual(['@appsport/contracts', '@appsport/domain']);
expect(appsportDeps('apps/web', 'devDependencies')).toEqual(['@appsport/server']);
expect(rootPkg.packageManager.startsWith('pnpm@10.')).toBe(true); expect(rootPkg.engines.node).toBe('>=24.7');
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm test` → échec (« No projects matched » ou `ERR_PNPM_NO_SCRIPT`, puis « Failed to resolve import "@appsport/contracts" »).

- [ ] **Step 3: Implement**

- Scripts racine : `lint: "biome check ."`, `typecheck: "pnpm -r --workspace-concurrency=1 typecheck"`, `test: "vitest run"`, `test:e2e: "pnpm --filter @appsport/web test:e2e"`. Scripts de paquet : `typecheck: "tsc --noEmit -p tsconfig.json"`, `test: "vitest run --root ../.. --project <nom>"`. `pnpm-workspace.yaml` : `packages: ['packages/*', 'apps/*']`, `onlyBuiltDependencies: [better-sqlite3, esbuild]`.
- `tsconfig.base.json` : options des Global Constraints + `target`/`lib` `ES2024`, `isolatedModules`, `resolveJsonModule`, `skipLibCheck` ; web ajoute `DOM`, `DOM.Iterable`, `jsx: "react-jsx"`, `include` `e2e` et `*.ts`. Exports : contracts et domain `"."` → `./src/index.ts` ; server : Interfaces partagées §0.
- devDependencies racine : `vitest@^5`, `typescript@^7`, `@biomejs/biome@^2`, `@types/node@^24.7` (types de `crypto.argon2`) ; web : `happy-dom`.
- `biome.json` : 2 espaces, LF, `lineWidth: 110`, quotes simples, `recommended`. `vitest.config.ts` : `passWithNoTests`, 4 projets sans globals ; web en `happy-dom`, `include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}']`, `exclude: ['e2e/**']`.
- `ci.yml` : `push` sur `main` et `pull_request` ; jobs `lint`, `typecheck`, `typecheck-ts6` (`continue-on-error: true`, `pnpm -r --workspace-concurrency=1 exec pnpm dlx --package=typescript@^6 tsc --noEmit -p tsconfig.json`), `test` ; chaque job : `pnpm/action-setup@v4` **avant** `actions/setup-node@v4` (`node-version-file: .node-version`, `cache: pnpm`), puis `pnpm install --frozen-lockfile`.
- `docs/vendor-docs/README.md` (01 §4) : une ligne par bibliothèque (`node:sqlite`, Hono, Kysely, Dexie) : version, date, source des extraits figés.

- [ ] **Step 4: Run test to verify it passes**

`pnpm install` crée `pnpm-lock.yaml` ; `pnpm test` → `Test Files  3 passed` ; `pnpm --filter @appsport/server test smoke` → `Test Files  1 passed` ; `pnpm lint` et `pnpm typecheck` → code 0.

- [ ] **Step 5: Commit**

`git commit -m "chore(ci): monorepo pnpm, outillage TypeScript/Biome/Vitest et CI"`

---

