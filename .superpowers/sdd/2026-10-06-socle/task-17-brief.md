### Task 17: Salles partagées (création, doublons, droits, matériel, historique, visibilité, suppression)

**Files:**
- Create: `packages/contracts/src/api/places.ts` (salles), `apps/server/src/places/{place-rows.ts, gyms.ts, gym-routes.ts}`
- Modify: `packages/contracts/src/index.ts`, `apps/server/src/admin/routes.ts` (`DELETE /gyms/:id`), `apps/server/src/routes.ts` (`/api/gyms`)
- Test: `apps/server/test/places/gyms.test.ts`

**Interfaces:**
- Consumes : T6 (`httpError`, `parseJson`, `parseQuery`, `clientIp`) ; T4a (`writeStamp`, `DbExecutor`) ; T9 (`requireUser`, `requireAdmin`, `logSecurityEvent`) ; T12 (`adminRoutes`) ; T14 (`normalize`, `EquipmentCodeSchema`, `EQUIPMENT`, `EQUIPMENT_CATEGORIES`, `LoadSettings`, `defaultLoadSettings`) ; T2 (`ageBandOn`, `parisDate`).
- Produces : Interfaces partagées §4 (`GymEquipmentCode`, `GymHistoryAction`, `GymSummary`, `GymDetail`, `CreateGymRequest`, `CreateGymResponse`, `UpdateGymRequest`, `demotePrimaries`, `insertGymPlace`, `deleteGymAsAdmin`, `gymRoutes`) et routes `/api/gyms*`, `DELETE /api/admin/gyms/:id`.

**Spec:** 02 R-SAL-1 à R-SAL-7, R-CHG-1, R-CHG-3, R-VIS-1 à R-VIS-5, R-EQ-3, 03 P-MIN-6, 01 R-SYN-3, R-SYN-21, 02 §15 n°15 à n°17.

- [ ] **Step 1: Write the failing test**

```ts
// gyms.test.ts — createGym(a) = POST /api/gyms { name: 'Basic-Fit Part-Dieu', city: 'Lyon', equipment: ['barbell', 'squat_rack'], isPrimary: true }
// création (R-SAL-2, R-SAL-3, R-CHG-1) : 201 { gymId, placeId } ;
expect(gym).toMatchObject({ name: 'Basic-Fit Part-Dieu', nameKey: 'basic fit part dieu', city: 'Lyon', cityKey: 'lyon', createdBy: a.id, deletedAt: null });
expect(JSON.parse(gym.loadSettings)).toEqual(defaultLoadSettings('gym'));
// gym_equipment [[`${id}:barbell`,'barbell',a.id,null],[`${id}:squat_rack`,'squat_rack',a.id,null]] ; place { kind: 'gym', isPrimary: 1, visibleAtGym: 1, loadSettings: null, name: null } ;
// un gym_history { action: 'create', authorId: a.id }
// doublon { name: 'BASIC FIT  part-dieu', city: ' lyon ' } → 409 { error: 'gym_duplicate', gymId: id }
// household refusé à la création (['chair']) et en PUT ('table') ; code 'cardio' → 400 ; nom 'X' ou ville de 61 caractères → 400 (R-EQ-3)
// mineur : lieu visibleAtGym 0 par défaut, 1 s'il le demande (P-MIN-6)
// recherche (R-SAL-1) : /api/gyms → [id] ; ?q=PART → [id] ; ?q=marseille → [] ; /similar?name=basic fit&city=Villeurbanne → [id] ;
//   /similar?name=Fitness Park&city=LYON → [id] ; /similar?name=Keep Cool&city=Paris → []
// droits (R-SAL-4, 02 §15 n°15) : membre sans lieu actif à la salle → PATCH et PUT 403 forbidden ; admin → 204 ; canEdit false pour b, true pour a ; salle inconnue → 404
// matériel (R-SAL-5) : PUT ×2 → même rev ; DELETE → tombstone, rev augmenté ; DELETE ×2 → même rev ; PUT → deletedAt null ;
//   detail.equipment ['dumbbells','squat_rack','barbell'] (ordre de EQUIPMENT) ;
//   detail.history.map((h) => h.action) → ['add_equipment','remove_equipment','add_equipment','create'] (plus récent d'abord)
// deux PUT simultanés (leg_press, lat_pulldown) → 204, 204 et l'union ['lat_pulldown','leg_press']
// modification (R-SAL-6, R-CHG-3) : name 'Basic Fit Gerland' → nameKey 'basic fit gerland' ; 'KEEP-COOL' (autre salle) → 409 ; {} → 400 ;
//   avec D = defaultLoadSettings('gym') : loadSettings { ...D, barG: 30000 } → 400 ; { ...D, barG: 15000 } → 204,
//   history[0] { action: 'update_load_settings', detail: { from: D, to: { ...D, barG: 15000 } } }
// 12 PATCH alternés puis suppression du compte de b → history de 10 lignes, h[0] { action: 'update_info', detail: { city: { from: 'Lyon 10', to: 'Lyon 11' } } }, h[1].authorUsername null
// visibilité (R-VIS-1 à R-VIS-5, 02 §15 n°17) : mineur invisible, invisible, désactivé et supprimé ne comptent pas → visibleMembers ['lea'], visibleMemberCount 1
// suppression admin (R-SAL-7) : membre → 403 ; lieu actif → 409 gym_in_use ; sans lieu actif → 204, deletedAt '2026-10-06T10:00:00.000Z', rev augmenté,
//   gym_deleted { actorId: admin.id, targetId: id } ; liste vide ; détail avec deletedAt ; PATCH, PUT matériel et seconde suppression → 404
// réactivation : POST { name: g.name.toUpperCase(), city: g.city, equipment: ['leg_press'], isPrimary: true } sur la salle supprimée g → 201 { gymId: id, placeId } ;
//   gym { name: g.name.toUpperCase(), deletedAt: null }, rev augmenté ; seul matériel actif ['leg_press'], les autres codes en tombstone ; history[0].action 'create'
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test gyms` → `POST /api/gyms` renvoie 404.

- [ ] **Step 3: Implement**

- Une transaction par écriture, un `writeStamp` par ligne écrite ; `/similar` déclaré avant `/:id`.
- Recherche : salles non supprimées triées par `name_key` ; `q` normalisé inclus dans `name_key` ou `city_key`. `/similar` : critère de moins de 2 caractères ignoré ; correspondance si l'une des clés contient l'autre (nom **ou** ville).
- Écritures `:id` : `requireUser` → salle chargée (absente ou `deleted_at` non nul → 404, de même dans `insertGymPlace`) → droits (403) → `parseJson` → écriture ; GET `/:id` rend aussi une salle supprimée.
- Doublon contrôlé avant insertion contre les salles non supprimées (409). Clé d'une salle supprimée → réactivation : `deleted_at` NULL, nom et ville envoyés, réglages gardés **[décision plan]**, nouveau rev, `gym_history create`, matériel remplacé par la liste envoyée (absents → tombstone), lieu par `insertGymPlace`, 201 avec l'id existant.
- Historique : `create { name, city, equipment }` ; `update_info { name?: {from,to}, city?: {from,to} }` ; `update_load_settings { from, to }` ; `add_equipment` / `remove_equipment { code }` seulement s'il y a écriture ; détail = 10 dernières lignes `ORDER BY at DESC, id DESC`, auteur par `LEFT JOIN user`.
- `insertGymPlace` : `place_exists` si un lieu actif renvoie à la salle ; `visibleAtGym` par défaut majeur 1, mineur 0 ; aucun lieu actif → principal d'office ; `isPrimary` → `demotePrimaries` avant insertion.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test gyms` → `Test Files  1 passed` ; `pnpm typecheck`, `pnpm lint`.

- [ ] **Step 5: Commit**

`git commit -m "feat(salles): salles partagées, matériel, historique et visibilité"`

---

