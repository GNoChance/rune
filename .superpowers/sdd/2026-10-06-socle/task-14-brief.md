### Task 14: Taxonomie du matériel, préréglages, réglages de charge, sports et textes versionnés

**Files:**
- Create: `packages/contracts/src/{taxonomy.ts, presets.ts, load-settings.ts, sports.ts, texts.ts}`, `packages/domain/src/text.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/domain/src/index.ts`
- Test: `packages/contracts/test/{taxonomy,load-settings,sports-texts}.test.ts`, `packages/domain/test/text.test.ts`

**Interfaces:**
- Consumes : `zod` ; squelette T1.
- Produces : Interfaces partagées §4 (`taxonomy.ts`, `presets.ts`, `load-settings.ts`, `sports.ts`, `texts.ts`, `domain/text.ts`).

**Spec:** 02 R-MAT-1, R-MAT-2, 04 R-EQ-1 à R-EQ-4, 04 §3.1 à §3.3, 02 §10.3 (R-CHG-1), 02 §8 E2, R-CST-1, 03 P-CST-1, 02 R-SAL-3, 02 §15 n°16.

- [ ] **Step 1: Write the failing test**

```ts
// taxonomy.test.ts — R-EQ-1 : codes, ordre et catégories figés
expect(EQUIPMENT).toEqual(Object.values(EQUIPMENT_CATEGORIES).flat());
expect(EQUIPMENT_CATEGORIES).toEqual({ household: ['chair','table'], small_equipment: ['resistance_band','dumbbells','kettlebell','pull_up_bar','suspension_trainer','box'],
  benches_racks: ['flat_bench','adjustable_bench','squat_rack','dip_station','back_extension_bench'], free_weights: ['barbell','ez_bar'],
  machines: ['cable_station','lat_pulldown','seated_row','leg_press','smith_machine','leg_extension','leg_curl','upper_body_machines'] });
expect(EQUIPMENT_CATEGORY_LABELS).toEqual({ household: 'Objets du quotidien', small_equipment: 'Petit matériel', benches_racks: 'Bancs et supports',
  free_weights: 'Charges libres', machines: 'Poulies et machines' });
expect(EQUIPMENT_LABELS.squat_rack).toBe('Cage ou supports à squat avec sécurités'); expect(EQUIPMENT_LABELS.chair).toBe('Chaise ou banc stable');
expect(EQUIPMENT_IMPLIES).toEqual({ adjustable_bench: ['flat_bench'] });   // R-EQ-2
// REFERENCE_PROFILES (04 §3.3) : home_bodyweight ['chair','table'] ; home_small_equipment = chair, table, pull_up_bar, resistance_band, dumbbells ;
//   gym_reference 14 codes, sans kettlebell, smith_machine, ez_bar, back_extension_bench, box, resistance_band, suspension_trainer
expect(EquipmentCodeSchema.safeParse('cardio').success).toBe(false);
// préréglages (R-MAT-2) : 7 ids ; gym_large = EQUIPMENT hors household ; home_none = home_bodyweight ; home_small = home_small_equipment ; HOME_DEFAULT_PRESET 'home_none'
// gym_small = dumbbells, barbell, ez_bar, flat_bench, adjustable_bench, squat_rack, cable_station, lat_pulldown, seated_row, leg_press, pull_up_bar, dip_station
// gym_crossfit = barbell, squat_rack, dumbbells, kettlebell, flat_bench, pull_up_bar, suspension_trainer, box, resistance_band
// home_gym = chair, table, pull_up_bar, resistance_band, dumbbells, kettlebell, barbell, squat_rack, flat_bench ; gym_other = []
// kind 'gym' pour gym_*, 'home' sinon ; aucun code household dans un préréglage de salle (R-EQ-3)
// load-settings.test.ts (02 §10.3)
expect(defaultLoadSettings('gym')).toEqual({ barG: 20000, smallestPlateG: 1250, dumbbellsG: Array.from({ length: 20 }, (_, i) => 2000 * (i + 1)), machineStepG: 5000 });
expect(defaultLoadSettings('home')).toEqual({ barG: 20000, smallestPlateG: 1250, dumbbellsG: [], machineStepG: 5000 });   // copie neuve à chaque appel
// refusés : barG 4999, 25001, 20000.5 ; smallestPlateG 249, 5001 ; machineStepG 499, 10001 ; dumbbellsG [4000, 2000], [2000, 2000], 61 valeurs, [400], [80500] ;
//   clé inconnue barKg ; champ manquant
// acceptés : 60 haltères de 500 à 30000 ; bornes barG 5000/25000, smallestPlateG 250/5000, machineStepG 500/10000, dumbbellsG [80000]
// sports-texts.test.ts
expect(SPORTS).toHaveLength(15); expect(SPORTS.map((s) => s.code)).toEqual([...SPORT_CODES]);
expect(SPORTS.find((s) => s.code === 'other')?.label).toBe('Autre'); expect(SPORTS.find((s) => s.code === 'running')?.label).toBe('Course à pied');
expect(SPORTS_LIST_VERSION).toBe(1); expect(SPORT_OTHER_LABEL_MAX).toBe(40); expect(SportCodeSchema.safeParse('golf').success).toBe(false);
expect(HEALTH_CONSENT_TEXT.version).toBe('1.0'); expect(HEALTH_CONSENT_TEXT.text).toMatch(/^J'accepte qu'appsport enregistre mes données de santé/);
expect(HEALTH_CONSENT_TEXT.text).toMatch(/elles seront alors supprimées\.$/);
expect(HEALTH_QUESTIONNAIRE.version).toBe('1.0'); expect(HEALTH_QUESTIONNAIRE.questions).toHaveLength(4);   // chacune finit par '?'
expect(majorOf('1.2')).toBe(1); expect(majorOf('12.0')).toBe(12); expect(() => majorOf('abc')).toThrow(); expect(() => majorOf('1')).toThrow();
// text.test.ts (R-SAL-3)
it.each([['Basic-Fit  Lyon Part-Dieu', 'basic fit lyon part dieu'], ['Salle Énergie', 'salle energie'],
  ["L'Orange Bleue — Saint-Étienne", 'l orange bleue saint etienne'], ['  Fitness   Park!! ', 'fitness park'], ['Crossfit 69', 'crossfit 69'], ['', '']])
  ('%s → %s', (i, o) => expect(normalize(i)).toBe(o));
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/contracts test taxonomy load-settings sports-texts` et `pnpm --filter @appsport/domain test text` → `Failed to resolve import "../src/taxonomy"` (de même `load-settings`, `sports`, `texts`, `text`).

- [ ] **Step 3: Implement**

Catégories et `EQUIPMENT_CATEGORY_LABELS` (`taxonomy.ts`) : valeurs du test. `gym_reference` = dumbbells, barbell, squat_rack, flat_bench, adjustable_bench, dip_station, pull_up_bar, cable_station, lat_pulldown, seated_row, leg_press, leg_extension, leg_curl, upper_body_machines.

Textes exacts :
- `EQUIPMENT_LABELS` : chair « Chaise ou banc stable » ; table « Table solide (rowing sous la table) » ; resistance_band « Élastiques (bandes, avec poignées ou mini-bandes) » ; dumbbells « Haltères fixes ou réglables » ; kettlebell « Kettlebell » ; pull_up_bar « Barre de traction » ; suspension_trainer « Sangles de suspension ou anneaux » ; box « Box ou step stable » ; flat_bench « Banc plat » ; adjustable_bench « Banc inclinable » ; squat_rack « Cage ou supports à squat avec sécurités » ; dip_station « Barres parallèles » ; back_extension_bench « Banc à lombaires (45° ou GHD) » ; barbell « Barre droite et disques » ; ez_bar « Barre EZ » ; cable_station « Poulie réglable ou vis-à-vis » ; lat_pulldown « Tirage vertical » ; seated_row « Tirage horizontal assis » ; leg_press « Presse à cuisses » ; smith_machine « Barre guidée (Smith) » ; leg_extension « Leg extension » ; leg_curl « Leg curl » ; upper_body_machines « Machines guidées du haut du corps (développé, pec deck, épaules) ».
- Préréglages : gym_large « Grande salle ou chaîne », gym_small « Petite salle de quartier », gym_crossfit « Box de cross-training », gym_other « Autre », home_none « Sans matériel », home_small « Petit matériel », home_gym « Home gym ».
- Sports : running « Course à pied », cycling « Vélo », swimming « Natation », football « Football », rugby « Rugby », basketball « Basket », handball « Handball », tennis « Tennis », padel « Padel », badminton « Badminton », combat_sports « Sports de combat », climbing « Escalade », skiing « Ski », dance « Danse », other « Autre ».
- `HEALTH_CONSENT_TEXT.text` : « J'accepte qu'appsport enregistre mes données de santé : limitations et zones sensibles, réponses de prudence, douleurs signalées pendant les séances, taille, poids, profil et suivi nutritionnels. Elles servent uniquement à adapter mes séances et mes repères. Elles restent sur le serveur du cercle et l'administrateur ne les consulte pas dans l'appli. Je peux retirer cet accord à tout moment : elles seront alors supprimées. »
- Questions v1.0 (à faire relire par l'admin avant la mise en service, ce qui changera la version) : « As-tu un problème cardiaque connu, ou pratiques-tu une activité physique sous surveillance médicale ? » ; « As-tu ressenti une douleur à la poitrine pendant un effort, ou perdu connaissance, au cours des 12 derniers mois ? » ; « As-tu une maladie ou un traitement qui limite ton activité physique ? » ; « As-tu un problème d'os, d'articulation ou de muscle qui s'aggrave à l'effort ? »

`LoadSettings` : `z.strictObject`, entiers bornés, `dumbbellsG` `.max(60)` et strictement croissant. `majorOf` accepte `/^\d+\.\d+$/`. `normalize` : minuscules → NFD sans `\p{M}` → suites hors `[\p{L}\p{N}]` remplacées par une espace → `trim`.

- [ ] **Step 4: Run test to verify it passes**

Mêmes commandes → `Test Files  3 passed` (contracts), `Test Files  1 passed` (domain) ; `pnpm typecheck` et `pnpm lint`.

- [ ] **Step 5: Commit**

`git commit -m "feat(profil): taxonomie du matériel, préréglages, réglages de charge et textes versionnés"`

---

