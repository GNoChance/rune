### Task 7: Drapeaux de relecteur et garde

**Files:**
- Create: `apps/server/src/admin/reviewer-flags.ts`, `apps/server/src/review/guard.ts`, `apps/server/test/admin/reviewer-flags.test.ts`
- Modify: `apps/server/src/auth/session.ts` (select + `SessionUser`), `apps/server/src/app-env.ts`, `apps/server/src/admin/routes.ts`, `apps/server/src/admin/members.ts` (`MemberSummary`), `apps/server/src/auth/me.ts` (`MeResponse`), `apps/server/src/auth/security-log.ts` (type `reviewer_flags_changed`), `packages/contracts/src/api/{admin,auth}.ts`, `docs/fiche-de-traitement.md` et `apps/web/src/features/public/privacy-content.ts` (drapeaux de relecteur : finalité, base légale = accord de la personne, visibilité ; commentaires et validations dans l'export ; exception à P-CAT-3), `apps/server/test/infra/docs.test.ts` (phrases vérifiées), et dans `docs/superpowers/specs/2026-10-06-appsport-design/` les lignes 02 R-ROLE-3 et 03 §5 et §13.4 (renvoi à la spec de la brique 2)

**Interfaces:**
- Produces : `SessionUser.catalogReviewer: boolean`, `SessionUser.healthProfessional: boolean` ; `requireReviewer` (middleware : 401 sans session, 403 si ni `catalogReviewer` ni admin) ; `POST /api/admin/members/:id/reviewer-flags` corps `SetReviewerFlagsRequest = {catalogReviewer: boolean; healthProfessional: boolean; password: string}` → 200 `MemberSummary` ; `MemberSummary` et `MeResponse` gagnent `catalogReviewer`, `healthProfessional`.

- [ ] **Step 1: Write the failing tests** — sans mot de passe valide : `invalid_credentials`, rien n'est écrit ; l'admin qui coche `healthProfessional` sur lui-même : 403 `self_health_flag` ; succès : `security_event` `reviewer_flags_changed` avec `details` avant/après ; retirer `catalogReviewer` coupe l'accès à `/api/review/*` dès la requête suivante ; `MeResponse` d'un membre porte ses propres drapeaux ; le `MemberSummary` d'un autre n'apparaît que dans `/api/admin/members`.
- [ ] **Step 2: Run** `pnpm --filter @rune/server test admin/reviewer-flags` — FAIL.
- [ ] **Step 3: Implement** sur le modèle de `POST /members/:id/role` (mot de passe vérifié hors transaction, puis transaction).
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(server): drapeaux de relecteur, garde de la relecture et journal`.
