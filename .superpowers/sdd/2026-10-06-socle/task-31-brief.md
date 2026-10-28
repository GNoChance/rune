### Task 31: Onboarding en 8 écrans et choix du lieu (salle ou maison)

**Files:**
- Create: `apps/web/src/features/onboarding/{OnboardingFlow.tsx, GoalStep.tsx, SportStep.tsx, PlaceKindStep.tsx, PlaceStep.tsx, ExperienceStep.tsx, AvailabilityStep.tsx, HealthStep.tsx, ReadyStep.tsx, onboarding.module.css}`, `apps/web/src/features/places/{GymPicker.tsx, GymCreate.tsx, EquipmentChecklist.tsx, places.module.css}`, `apps/web/src/app-events.ts`
- Modify: `apps/web/src/App.tsx` (`/onboarding`, hors `AppShell`)
- Test: `apps/web/test/onboarding/{flow,steps,health-step,ready-step}.test.tsx`, `apps/web/test/places/gym-picker.test.tsx`

**Interfaces:**
- Consumes : T28 ; T29 (`useRepos`, `useReadiness`, `OfflineReadyIndicator`, `seedMirror`) ; domain (`firstIncompleteStep`) ; contracts (`ONBOARDING_STEPS`, `GOAL_LABELS`, `EXPERIENCE_LABELS`, `SPORTS`, `EQUIPMENT`, `EQUIPMENT_CATEGORIES`, `EQUIPMENT_CATEGORY_LABELS` (T14), `EQUIPMENT_LABELS`, `EQUIPMENT_PRESETS`, `HEALTH_CONSENT_TEXT`, `HEALTH_QUESTIONNAIRE`, `BODY_AREA_LABELS`, `LIMITATION_SIDE_LABELS`, `LIMITATION_SEVERITY_LABELS`).
- Produces : Interfaces partagées §6 (`ONBOARDING_COMPLETED_EVENT`, `StepProps`, `GoalStep`, `SportStep`, `ExperienceStep`, `AvailabilityStep`, `HealthConsentPanel`, `ScreeningQuestions`, `LimitationsEditor`, `CautiousModeToggle`, `EquipmentChecklist`, `GymPicker`) et, localement :
```ts
export function OnboardingFlow(): JSX.Element;   // « Étape n/8 » ; conteneur data-testid="onboarding-step" data-step=<OnboardingStep>
export function PlaceKindStep(p: StepProps & { value: 'gym' | 'home' | null; onChange(k: 'gym' | 'home'): void }): JSX.Element;
export function PlaceStep(p: StepProps & { kind: 'gym' | 'home' }): JSX.Element; export function HealthStep(p: StepProps): JSX.Element; export function ReadyStep(p: { onBack(): void }): JSX.Element;
export function sortEquipment(codes: Iterable<EquipmentCode>): EquipmentCode[];   // ordre de EQUIPMENT
export function SportStep(p: StepProps & { pendingGoal?: Goal /* édition : PATCH { goal, sportCode, sportOtherLabel } en un envoi */ }): JSX.Element;
export function GymCreate(p: { isPrimary: boolean; visibleAtGym: boolean; onDone(): void; onPickExisting(gymId: string): void }): JSX.Element;
```

**Spec:** 02 R-ONB-1 à R-ONB-3, §8 E1 à E8, R-CPT-2, §10.2 R-MAT-2, R-SAL-1 à R-SAL-3, R-VIS-3, §12 E7 (R-CST-2, R-CST-7), §15 n°11 ; 04 R-EQ-3 ; 03 P-MIN-6, P-CST-1, P-CST-2, §13.2 ; 01 R-SYN-33.

- [ ] **Step 1: Write the failing test**

```ts
// flow.test.tsx : départ 'goal' et « Étape 1/8 » ; reprise à firstIncompleteStep(…) ; « Prendre du muscle » + « Suivant » → PATCH { goal: 'muscle', onboardingStep: 'goal' },
//   data-step 'sport' et « Étape 2/8 » ; « Retour » → 'goal' avec la réponse cochée ; étape 'place' sans type connu → 'place_kind' ; hors ligne → alerte, reste sur 'goal'
// steps.test.tsx
// GoalStep mineur : pas de « Perdre du gras », 4 options ; adulte : « Prendre du muscle », « Gagner en force », « Perdre du gras », « Forme et santé », « Me renforcer pour mon sport » ;
//   « Suivant » désactivé sans choix ; mode edit → « Enregistrer » et PATCH { goal: 'strength' } sans onboardingStep ;
//   edit sans sport : « Me renforcer pour mon sport » + « Suivant » → SportStep ; « Course à pied » + « Enregistrer » →
//   un seul PATCH { goal: 'sport_support', sportCode: 'running', sportOtherLabel: null } ; avec sport → PATCH { goal: 'sport_support' }
// SportStep avec goal sport_support : « Non » désactivé, « Oui » coché, « Obligatoire avec l'objectif « Me renforcer pour mon sport ». » ;
//   « Autre » + 'Pétanque' → { sportCode: 'other', sportOtherLabel: 'Pétanque', onboardingStep: 'sport' }, maxLength 40, 15 libellés ; « Autre » sans libellé → « Suivant » désactivé ;
//   « Non » → { sportCode: null, sportOtherLabel: null, onboardingStep: 'sport' }
// PlaceKindStep : « Où t'entraîneras-tu le plus souvent ? », « À la salle », « À la maison » → { onboardingStep: 'place_kind' }
// PlaceStep maison : « Nom du lieu » 'Maison', préréglage home_none, « Objets du quotidien » avec chair et table cochés ; préréglage « Petit matériel » (radio) coche dumbbells ;
//   Suivant → POST /api/places { kind: 'home', name: 'Maison', equipment: EQUIPMENT.filter((c) => EQUIPMENT_PRESETS.home_small.codes.includes(c)), isPrimary: true } puis { onboardingStep: 'place' }
// PlaceStep salle : onDone de GymPicker → PATCH { onboardingStep: 'place' }, data-step 'experience' ; lieu principal existant → « Ton lieu principal : Basic Fit », aucun POST
// ExperienceStep : « Depuis combien de temps fais-tu de la musculation régulièrement (au moins une fois par semaine) ? » ; « 6 mois à 2 ans » → { experience: '6_to_24_months', onboardingStep: 'experience' }
// AvailabilityStep : « Séances par semaine » (« 2 », « 3 », « 4 ») et « Durée d'une séance » (« 30 min » à « 90 min ») ;
//   radio '3' (exact) et « 60 min » → { daysPerWeek: 3, sessionMinutes: 60, onboardingStep: 'availability' }
// gym-picker.test.tsx : « Basic Fit · Lyon · 2 membres visibles » ; « Rechercher une salle » 'bas' → GET /api/gyms?q=bas ; case « Apparaître dans « Qui va à cette salle » » cochée si defaultVisible,
//   sinon décochée avec « Désactivé par défaut pour les moins de 18 ans. » ; « Valider » → POST /api/places { kind: 'gym', gymId: 'g-1', isPrimary: true, visibleAtGym: false } puis onDone
// « Ma salle n'est pas dans la liste » : « Nom de la salle » 'Basic-Fit', « Ville » 'Lyon', « Continuer » → GET /api/gyms/similar?name=Basic-Fit&city=Lyon, « Ces salles existent peut-être déjà : »,
//   « C'est ma salle », « Non, créer ma salle » ; similar vide → préréglages directement ; groupe « Type de salle » : radios gym_large, gym_small, gym_crossfit, gym_other ;
//   « Petite salle de quartier » coche les 12 codes, pas d'« Objets du quotidien » ;
//   « Créer la salle » → POST /api/gyms { name: 'Basic-Fit', city: 'Lyon', equipment: sortEquipment(EQUIPMENT_PRESETS.gym_small.codes), isPrimary: true, visibleAtGym: true }
// 409 gym_duplicate → « Cette salle existe déjà. » + « Choisir cette salle » → POST /api/places gymId 'g-1' ; nom d'un caractère + « Continuer » → « 2 à 60 caractères. » sans requête
// EquipmentChecklist gym → 4 groupes ; home → 5 ; cocher « Kettlebell » → onChange trié avec kettlebell
// health-step.test.tsx : sans accord : HEALTH_CONSENT_TEXT.text, case décochée, « J'accepte et je renseigne » désactivé ; « Passer » → 4 questions et
//   « Si l'une de ces situations te concerne, demande l'avis d'un médecin avant de commencer », aucune requête (auto-vérification, P-CST-2) ;
//   « Je préfère une progression plus prudente » cochée puis « Suivant » → PATCH { cautiousMode: true, onboardingStep: 'health' } (aucun PATCH à la bascule) ;
//   « Suivant » sans changement → PATCH { onboardingStep: 'health' }
// avec accord : POST /api/me/consents { type: 'health', textVersion: '1.0' } ; Oui à Q1 + « Enregistrer mes réponses » → PUT { answers: [true,false,false,false], questionnaireVersion: '1.0' } ;
//   { caution: true } → « Nous te recommandons de consulter un médecin avant de commencer. » ; limitations : « aucun diagnostic n'est nécessaire », « Aucune »,
//   « Ajouter une limitation » → POST { bodyArea: 'knee', side: 'left', severity: 'mild', note: 'entorse ancienne' }, note maxLength 200
// mineur : interrupteur coché et désactivé, « Imposé jusqu'à 18 ans » ; HEALTH_WARNING_TEXT affiché ; « Suivant » actif sans réponse
// ready-step.test.tsx : tout prêt → récapitulatif « Prendre du muscle », « 3 séances de 45 min », « Basic Fit », « Jamais » ; offline-ready 'ready' ; « Commencer » actif ;
//   clic → POST /api/me/onboarding/complete, location '/', ONBOARDING_COMPLETED_EVENT émis une fois ; pull il y a 25 h → « Commencer » désactivé, « Réessayer » → triggers 'manual' ;
//   409 onboarding_incomplete → retour au premier écran incomplet
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test onboarding/ places/gym-picker` → modules introuvables.

- [ ] **Step 3: Implement**

`OnboardingFlow` : départ `firstIncompleteStep(await repos.profile.onboardingInput())` (`place` sans type connu → `place_kind`) ; chaque écran enregistre par `repos.profile.update({ …, onboardingStep })` en mode `onboarding`. Chaque question est une `ChoiceList` (radios nommées par leur libellé, préréglages compris ; durées `${n} min`). `GoalStep` en édition : `sport_support` sans sport enregistré → « Suivant » rend `<SportStep mode="edit" pendingGoal="sport_support">`. `PlaceStep` : salle → `<GymPicker isPrimary defaultVisible={me.ageBand !== 'minor'}>` sans « Suivant » ; maison → « Nom du lieu » (`maxLength` 30), préréglages `home_none`, `home_small`, `home_gym` (groupe « Ton matériel »), `EquipmentChecklist kind="home"` précochée (changer de préréglage recoche). `GymCreate` : nom et ville, `gyms.similar`, préréglage `gym_*`, liste précochée. `EquipmentChecklist` : un `<fieldset>` par catégorie, `household` exclu pour une salle. `HealthStep` : accord actif → `ScreeningQuestions record` et `LimitationsEditor` ; sinon `HealthConsentPanel` (« Passer » → `ScreeningQuestions record={false}`) ; toujours `CautiousModeToggle` (état local, enregistré au clic sur « Suivant », R-ONB-2), `HealthWarning`, « Suivant ». `ReadyStep` : « Commencer » désactivé tant que `!readiness.ready` ; succès → `window.dispatchEvent(new CustomEvent(ONBOARDING_COMPLETED_EVENT))` puis `navigate('/')` (T37 écoute l'événement pour `persist()`).

- [ ] **Step 4: Run test to verify it passes**

Même commande → vert.

- [ ] **Step 5: Commit**

`git commit -m "feat(web): onboarding en 8 écrans et choix de la salle ou de la maison"`

---

