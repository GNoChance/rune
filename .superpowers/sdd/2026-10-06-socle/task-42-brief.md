### Task 42: Release et Dependabot

**Files:**
- Create: `.github/workflows/release.yml`, `.github/dependabot.yml`
- Modify: `.github/workflows/ci.yml` (`on: { pull_request: {}, push: { branches: [main] } }`)
- Test: `apps/server/test/infra/release.test.ts`

**Interfaces:**
- Consumes : T41 (`infra/Dockerfile`, `ARG VERSION`, `ARG VITE_OWNER_FIRST_NAME`) ; T1 (`ci.yml`).
- Produces : image privée `ghcr.io/gnochance/appsport:vX.Y.Z` (`linux/amd64`), publiée seulement pour un tag `vX.Y.Z` d'un commit de `main` dont `ci.yml` est vert.

**Spec:** R-DEP-1, R-DEP-2, R-TST-3, R-OPS-13, 08 §2, §8 ; 01 §4 et 03 §10.9 (aucune clé Anthropic en CI) ; 03 §13.1.

- [ ] **Step 1: Write the failing test**

```ts
expect(release.on).toEqual({ push: { tags: ['v*.*.*'] } });
expect(release.permissions).toEqual({ contents: 'read', packages: 'write', actions: 'read' });
expect(runText).toContain('^v[0-9]+\\.[0-9]+\\.[0-9]+$'); expect(runText).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
expect(runText).toContain('gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}&status=success"');
// les trois gardes précèdent docker/build-push-action
expect(steps[bpIndex]!.with).toMatchObject({ context: '.', file: 'infra/Dockerfile', platforms: 'linux/amd64', push: true,
  tags: 'ghcr.io/gnochance/appsport:${{ github.ref_name }}' });
expect(steps[bpIndex]!.with['build-args'].split('\n').filter(Boolean)).toEqual(['VERSION=${{ github.ref_name }}', 'VITE_OWNER_FIRST_NAME=${{ vars.VITE_OWNER_FIRST_NAME }}']);
// pas de ':latest' ; aucun /anthropic/i dans release.yml ni ci.yml ; ci.yml tourne sur main
// dependabot : version 2 ; npm ('/', weekly, groups), docker ('/infra', weekly), github-actions ('/', weekly)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test infra/release` → `ENOENT … release.yml`.

- [ ] **Step 3: Implement**

Job `publish` (`ubuntu-latest`), dans l'ordre : `checkout@v4` (`fetch-depth: 0`) ; garde du tag (`Tag invalide : $GITHUB_REF_NAME`) ; `git fetch origin main` puis garde de `main` (« Le commit n'est pas sur main : publication refusée. ») ; garde CI avec `GH_TOKEN: ${{ github.token }}`, `--jq '.total_count'` ≥ 1, sinon « La CI du commit ${GITHUB_SHA} n'est pas verte : publication refusée. Relancer ce job quand la CI de main sera verte. » ; `docker/setup-buildx-action@v3` ; `docker/login-action@v3` (ghcr.io, `github.actor`, `github.token`) ; `docker/build-push-action@v6`. Dependabot npm : `groups: { npm-minor-patch: { patterns: ['*'], update-types: ['minor', 'patch'] } }`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test infra/release` → `Tests  10 passed`.

- [ ] **Step 5: Commit**

`git commit -m "ci(ci): release GHCR sur tag d'un commit vert de main et Dependabot"`

---

