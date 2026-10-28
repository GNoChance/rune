### Task 23: Catalogue minimal servi par ETag

**Files:**
- Create: `packages/contracts/src/catalog.ts`, `apps/server/src/catalog/{loader.ts, routes.ts}`, `data/programs/.gitkeep`, `data/exercises/.gitkeep`, `data/illustrations/files/.gitkeep`, `data/illustrations/manifest.json` (exactement `[]` + saut de ligne), `data/LICENSE`
- Modify: `packages/contracts/src/index.ts`, `apps/server/src/startup.ts` (`CATALOG_STARTUP_TASK`), `apps/server/src/routes.ts` (`/api/catalog`)
- Test: `packages/contracts/test/catalog.test.ts`, `apps/server/test/catalog/{loader,routes}.test.ts`

**Interfaces:**
- Consumes : T6 (`AppConfig.contentDir`, `Logger`) ; T7 (`StartupTask`, `STARTUP_TASKS`) ; T9 (`requireUser`) ; T4a (`getServerMeta`).
- Produces : Interfaces partagées §5 (`catalog.ts`, `catalog/loader.ts`, `catalog/routes.ts`).

**Spec:** 01 R-SYN-32, R-VER-7 ; 04 §10 (réduit au manifeste et à `data/programs/*.json`), 04 §11 (ETag = `catalog_version`) ; 09 §0.6 (classe C).

- [ ] **Step 1: Write the failing test**

```ts
// catalog.test.ts
expect(IllustrationRef.safeParse({ id: 'squat', file: 'squat.0a1b2c3d.svg' }).success).toBe(true);
expect(IllustrationRef.safeParse({ id: 'squat', file: 'squat.svg' }).success).toBe(false);
// loader.test.ts — dossier data/ du dépôt :
expect(b).toMatchObject({ exercises: [], illustrations: [], programTemplates: [], adviceSheets: [] });
expect(b.version).toBe(createHash('sha256').update('{"adviceSheets":[],"exercises":[],"illustrations":[],"programTemplates":[]}').digest('hex'));
expect((await getServerMeta(ctx.deps.db)).catalogVersion).toBe(b.version);
// manifeste + programs/b.json, a.json → programTemplates ids ['a','b'] ; réordonner les clés de b.json ne change pas la version
// contenu modifié à '2026-10-07T08:00:00.000Z' → nouvelle version, catalogUpdatedAt '2026-10-07T08:00:00.000Z' ; contenu identique → aucune écriture
// manifeste { file: 'pas-bon' } ou JSON illisible → CatalogLoadError, server_meta inchangé
// CATALOG_STARTUP_TASK.run résout sans erreur et journalise 'catalog_invalid' ; STARTUP_TASKS le contient
// routes.test.ts : sans session → 401 ; avec session → 200, version = catalogVersion, ETag `"${version}"`, Cache-Control 'no-cache' ;
//   If-None-Match identique ou 'W/"<v>"' → 304 sans corps ; '"autre"' → 200 ; catalogue invalide jamais chargé → 500 { error: 'internal' }
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/contracts test catalog` et `pnpm --filter @appsport/server test catalog` → modules introuvables.

- [ ] **Step 3: Implement**

`loadCatalog` : manifeste (`z.array(IllustrationRef)`, absent → `[]`), `programs/*.json` triés par nom (contenu brut), `exercises` et `adviceSheets` vides ; version = sha256 hex de la sérialisation canonique (clés triées récursivement, sans espaces) de `{ adviceSheets, exercises, illustrations, programTemplates }` ; `server_meta` mis à jour seulement si la version change ; cache `WeakMap` par `deps`. `If-None-Match` découpé sur les virgules, préfixe `W/` retiré. `data/LICENSE` : « Textes du catalogue : © les auteurs d'appsport, usage privé. Illustrations : chaque fichier de `illustrations/files/` reste sous la licence indiquée dans `illustrations/manifest.json` (créateurs, source, licence, modifications). »

- [ ] **Step 4: Run test to verify it passes**

Mêmes commandes → `Test Files  1 passed` puis `Test Files  2 passed`.

- [ ] **Step 5: Commit**

`git commit -m "feat(synchro): catalogue minimal servi par ETag"`

---

