### Task 18: Lieux de l'utilisateur (salle et maison, lieu principal, suppression)

**Files:**
- Modify: `packages/contracts/src/api/places.ts` (lieux), `apps/server/src/routes.ts` (`/api/places`)
- Create: `apps/server/src/places/{places.ts, place-routes.ts}`
- Test: `apps/server/test/places/places.test.ts` ; Modify: `apps/server/test/privacy/admin-isolation.test.ts` (T13)

**Interfaces:**
- Consumes : tout ce que consomme T17, plus `insertGymPlace`, `demotePrimaries` (T17), `completeOnboarding` (T16) ; T13 (`admin-isolation.test.ts`, constante `MIN_ID_ROUTES`).
- Produces : Interfaces partagées §4 (`HOME_PLACE_DEFAULT_NAME`, `CreatePlaceRequest`, `CreatePlaceResponse`, `UpdatePlaceRequest`, `DeletePlaceRequest`, `placeRoutes`) et routes `/api/places*`.

**Spec:** 02 R-LIEU-1 à R-LIEU-5, R-VIS-3, R-CHG-1, R-CHG-3, R-EQ-3, R-EQ-4, §8 E3/E4, 03 P-ADM-2, 02 §15 n°14 et n°16.

- [ ] **Step 1: Write the failing test**

```ts
// places.test.ts
// maison (R-LIEU-3) : POST { kind: 'home', equipment: ['chair','table','dumbbells','dumbbells'], isPrimary: true } → 201 ;
//   place { kind: 'home', name: 'Maison', gymId: null, isPrimary: 1 } ; loadSettings = defaultLoadSettings('home') ;
//   home_equipment [[`${id}:chair`,u.id,null],[`${id}:dumbbells`,u.id,null],[`${id}:table`,u.id,null]]
// nom de 31 caractères → 400 ; plusieurs maisons possibles
// matériel maison idempotent (PUT kettlebell ×2, DELETE chair ×2 → actifs ['kettlebell','table']) ; PUT sur un lieu salle → 400
// salle (R-LIEU-2) : second lieu actif sur la même salle → 409 place_exists ; salle inconnue ou supprimée (deletedAt posé) → 404
// visibilité : mineur → 0, PATCH { visibleAtGym: true } → 204 et 1 ; visibleAtGym sur une maison → 400 (R-VIS-3)
// lieu salle : loadSettings ou name → 400 (R-CHG-3) ; maison : loadSettings { ...defaultLoadSettings('home'), dumbbellsG: [2000, 4000] } → 204,
//   { ...defaultLoadSettings('home'), barG: 4999 } → 400, name 'Appart' → 204
// principal (R-LIEU-4) : premier lieu principal d'office ; isPrimary true sur un autre → il devient le seul ; { isPrimary: false } → 400
// suppression (R-LIEU-1, R-LIEU-5) : dernier lieu après l'onboarding → 409 last_place ; principal sans newPrimaryId → 409 primary_required ;
//   newPrimaryId = lui-même → 400 ; valide → 204, { deletedAt: '2026-10-06T10:00:00.000Z', isPrimary: 0 }, rev augmenté, nouveau principal ; seconde suppression → 404
// avant la fin de l'onboarding, le seul lieu peut être supprimé ; un lieu salle supprimé libère la salle (nouveau POST → 201)
// lieu d'un autre, admin compris (P-ADM-2) : PATCH, DELETE, PUT et DELETE matériel → 404 { error: 'not_found' }, même avec le corps {} (404 avant 400), rien ne change
// admin-isolation.test.ts (T13) : MIN_ID_ROUTES = 4 (PATCH, DELETE /api/places/:id ; PUT, DELETE …/equipment/:code)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test places.test` → `POST /api/places` renvoie 404.

- [ ] **Step 3: Implement**

Ordre par route `:id` : `requireUser` → lieu chargé par `id`, `owner_id = user.id`, `deleted_at IS NULL`, sinon `not_found` (aucune exception admin) → `parseJson` → écriture ; gardes par route. Maison : `name ?? HOME_PLACE_DEFAULT_NAME`, `visibleAtGym 0`, réglages maison par défaut, matériel household admis (R-EQ-4). DELETE : autres lieux actifs vides et onboarding terminé → `last_place` ; principal avec d'autres lieux : `newPrimaryId` absent → `primary_required`, hors des autres lieux → `validation { field: 'newPrimaryId' }` ; le lieu supprimé reçoit `deleted_at`, `is_primary = 0`, un nouveau rev, et garde son matériel.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test places.test gyms admin-isolation` → `Test Files  3 passed` ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(salles): lieux salle et maison, lieu principal"`

---

