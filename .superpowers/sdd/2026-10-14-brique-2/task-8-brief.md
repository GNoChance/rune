### Task 8: API de relecture (commentaires, validations, files)

**Files:**
- Create: `apps/server/src/review/routes.ts`, `packages/contracts/src/api/review.ts`, `apps/server/test/review/{comments,validations,list,access}.test.ts`
- Modify: `apps/server/src/routes.ts` (monte `/api/review`), `apps/server/src/privacy/export.ts`, `packages/contracts/src/api/export.ts` (`reviewComments`, `reviewValidations`), `apps/server/test/privacy/export.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7.
- Produces : routes du tableau §3.9 sous `/api/review` (liste avec `queue`, `batch`, `status` ; détail ; commentaire ; résolution ; validation). Contrats : `ReviewListItem`, `ReviewSheetResponse` (fiche selon le tableau de visibilité §3.1, `comments`, `greenLight: 'ok'|'missing'|'stale'`, `diff: string[] | null`, et `validations` nominatives pour l'admin seulement), `CreateCommentRequest {part, body, baseRevision}`, `ValidateRequest {baseRevision}`.

- [ ] **Step 1: Write the failing tests** —
  - `access.test.ts` : énumère toutes les routes de `ctx.app.routes` sous `/api/review/` et `/api/admin/` (reprendre `listRoutes` de `admin-isolation.test.ts`, déplacée dans `apps/server/test/support/routes.ts`) : membre → 403 sur les deux, relectrice → 403 sur `/api/admin/*` et non-403 sur `/api/review/*`, sans session → 401 ; plancher : au moins 5 routes de relecture ;
  - `comments.test.ts` : `part` hors liste → 400 ; `body` nettoyé (`\r\n` → `\n`, U+202E retiré), 1001 caractères → 400 ; commentaire sur révision dépassée accepté avec sa révision ; commenter une fiche `retired` → 409 `not_reviewable` ; « Traité » idempotent sans réécrire `resolved_at` ; relectrice qui résout le commentaire d'une autre → 403 ;
  - `validations.test.ts` : valider un `draft` → 409 `not_reviewable` ; `baseRevision` dépassée → 409 `revision_conflict` ; doublon → 200 et même id ; `health` copié = drapeau effectif ;
  - `list.test.ts` : chaque file rend exactement les fiches de son prédicat (fixture : un brouillon, une relue non sensible, une relue sensible sans feu vert, une publiée sensible modifiée) ; une relectrice ne reçoit jamais `drafting`, `reviewed_by`, ni l'auteur des feux verts ; tri `Intl.Collator('fr', {sensitivity:'base'})` puis `id` ;
  - `export.test.ts` : l'export d'une relectrice contient ses commentaires et validations, pas ceux des autres, pas les révisions.
- [ ] **Step 2: Run** `pnpm --filter @rune/server test review privacy/export` — FAIL.
- [ ] **Step 3: Implement** ; la liste appelle `reviewQueues` et `healthGreenLight` de la tâche 3, jamais une réimplémentation.
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): relecture à plusieurs, commentaires, validations et files`.
