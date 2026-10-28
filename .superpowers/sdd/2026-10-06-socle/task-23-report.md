# Task 23 report

Implemented: contracts/catalog.ts (ILLUSTRATION_FILE_RE with [a-z0-9-], IllustrationRef, CatalogBundle), server catalog/loader.ts (loadCatalog, getLoadedCatalog WeakMap cache, CatalogLoadError, CATALOG_STARTUP_TASK registered in STARTUP_TASKS), catalog/routes.ts (GET /api/catalog, requireUser, ETag, no-cache, 304 on If-None-Match list / W/), data/ tree (.gitkeep, manifest `[]\n`, LICENSE).

TDD: RED run (before any implementation) `pnpm --filter @appsport/contracts test catalog` -> 1 file failed, no tests (module ../src/catalog not found); `pnpm --filter @appsport/server test catalog` -> 2 files failed, 5 failed (modules/route missing, 404). GREEN: contracts 1 file / 4 tests passed; server 2 files / 16 tests passed.
Full: pnpm lint (after biome --write import ordering), typecheck, test (81 files passed) all green.

Tests: loader (repo data/ empty catalog + exact sha, server_meta, manifest/programs sorted, key order stable, change -> new version + catalogUpdatedAt, identical -> no write, invalid -> CatalogLoadError & meta unchanged, startup task log 'catalog_invalid', STARTUP_TASKS toContain, data/LICENSE exists); routes (401, 200 headers, 304 variants, 200 on other etag, 500 internal).
Concerns: none. scheduler.test.ts untouched.
