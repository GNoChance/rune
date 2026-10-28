# Task 17 - rapport

Statut : DONE.

## Implémenté
- `packages/contracts/src/api/places.ts` : GymEquipmentCode (sans household), GymHistoryAction, GymSummary, GymDetail, CreateGymRequest/Response, UpdateGymRequest (exporté par index.ts).
- `apps/server/src/places/place-rows.ts` : demotePrimaries, insertGymPlace.
- `apps/server/src/places/gyms.ts` : recherche, similar, détail, createGym (doublon 409, réactivation), updateGym, matériel, deleteGymAsAdmin.
- `apps/server/src/places/gym-routes.ts` (`/similar` avant `/:id`), montage `/api/gyms`, `DELETE /api/admin/gyms/:id`.
- Rulings : réactivation (201, deleted_at NULL, nouveau rev, create, réglages gardés, matériel remplacé) ; salle supprimée/inconnue -> 404 (insertGymPlace, PATCH, PUT/DELETE matériel) ; réglages modifiés -> `update_load_settings { from, to }` ; toutes écritures via writeStamp.
- Les mineurs ne sont jamais comptés comme visibles, même avec visible_at_gym = 1.
- PATCH/PUT/DELETE : 404 puis 403 avant validation du corps ou du code.

## TDD
- RED : `pnpm --filter @appsport/server test gyms` -> `Cannot find module '../../src/places/place-rows'` (test d'import ; aucune route n'existait), 0 test exécuté. Attendu : le code n'existait pas.
- GREEN : même commande -> `Test Files 1 passed`, `Tests 23 passed (23)`.
- Un premier GREEN avait 6 échecs (415) : les PUT sans corps JSON sont refusés par origin-guard ; le test envoie `{}` pour PUT.
- Complet : `pnpm lint`, `pnpm typecheck` propres ; `pnpm test` 62 fichiers, 702 passed, 2 skipped (existants).

## Ordre de l'historique
`ORDER BY at DESC, id DESC`. Test matériel : horloge figée, ordre fixé par `id DESC` (UUIDv7 monotones). Test des 12 PATCH : horloge avancée d'1 s par PATCH, ordre `at DESC`, donc le dernier PATCH en premier.

## Concerns
- Le test de PUT simultanés passe sur node:sqlite synchrone (transactions sérialisées), il ne prouve pas de vraie concurrence.
- PATCH vers la clé d'une salle supprimée renvoie 409 gym_duplicate (contrainte UNIQUE) : choix non spécifié.

## Fix round 1
1. visibleRowsByGym : filtre d'âge retiré, `visible_at_gym = 1` + compte actif + lieu actif ; tests : mineur à 0 non listé, mineur à 1 listé.
2. Historique : `authorUsername` rendu seulement pour un admin ou un membre visible à la salle, sinon null (auteur supprimé : null). Test : admin, visible, invisible, a.
3. Test R-VIS-5 : compte désactivé et compte supprimé (deleteAccount) non listés.
4. Réglages de charge comparés par `isDeepStrictEqual`.
5. `uniqueAsDuplicate` : erreur SQLite `errcode & 0xff === 19` sur l'insertion de salle (createGym) et la mise à jour (updateGym) -> 409 gym_duplicate. Non couvert par un test : le contrôle préalable intercepte tous les cas hors course.
Paramètre `deps` inutilisé retiré des fonctions de lecture. Vérification : `pnpm lint`, `pnpm typecheck` propres ; `pnpm test` 62 fichiers, 703 passed, 2 skipped.
