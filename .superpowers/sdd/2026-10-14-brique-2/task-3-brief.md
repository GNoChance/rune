### Task 3: Fonctions de la relecture

**Files:**
- Create: `packages/domain/src/catalog/{review,blockers,queues}.ts`, `packages/domain/test/catalog/{review,blockers,queues}.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces :
  - `contentOf(sheet): Record<string, unknown>` (sans `CONTENT_EXCLUDED_KEYS`) ; `contentDiff(a, b): string[]` (clés triées) ;
  - `isSensitive(sheet): boolean` ;
  - `type ReviewerState = {id: string; role: 'admin'|'member'; catalogReviewer: boolean; healthProfessional: boolean}` ; `isReviewer(u)`, `isHealthReviewer(u)` (spec §3.1 : santé = drapeau ∧ `catalogReviewer` ∧ `member`) ;
  - `type Validation = {reviewerId: string|null; revision: number; health: boolean}` ; `type RevisionRow = {revision: number; content: Record<string, unknown>; savedBy: string|null}` ;
  - `healthGreenLight(sheet, revisions: RevisionRow[], validations: Validation[], users: Map<string, ReviewerState>): boolean` (spec §3.2, conditions 1 à 3) ;
  - `transitionBlockers(input: {sheet; to; comments: {resolvedAt: string|null}[]; greenLight: boolean; reviewChecked: boolean; minorsConfirmed: boolean; manifestIds: Set<string>; templateRefs: Set<string>; catalog: ExerciseSheet[]}): PublishBlocker[]` (ordre fixe, tableau §3.6) ;
  - `reviewQueues(...)` qui rend les prédicats du §3.8 (`to_review`, `drafts`, `health_pending`, `revalidate`, `mine`, `readyToPublish`) et `progressByBatch(catalog): {batch: string; published: number; total: number}[]`.

- [ ] **Step 1: Write the failing tests** — `isSensitive` : niveau 2, niveau 3, `not_for_minors`, chacune des 4 articulations, une fiche non sensible ; `healthGreenLight` : validation sur N puis transitions sans changement de contenu → vrai ; contenu modifié → faux ; validation par l'auteur de la dernière modification de contenu → faux ; auteur au drapeau retiré → faux ; auteur supprimé (`reviewerId: null`) → faux ; admin au drapeau coché → faux ; `contentDiff` : `[]` sans changement, changement de `status` seul → `[]` ; `transitionBlockers` : un test par code, plus l'ordre quand plusieurs s'appliquent ; `catalog_full` à 300 fiches non retirées et pas à 299 ; files : une fiche publiée passée du niveau 1 au niveau 2 entre dans `revalidate` ; un `draft` n'est jamais dans `to_review`.
- [ ] **Step 2: Run** `pnpm --filter @rune/domain test catalog` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(domain): sensibilité, feu vert santé, blocages et files de relecture`.
