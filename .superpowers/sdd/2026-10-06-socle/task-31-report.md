# Task 31 — Onboarding en 8 écrans et choix du lieu (salle ou maison) — rapport

Statut : DONE_WITH_CONCERNS (écarts mineurs au brief, listés plus bas ; un correctif nécessaire dans `useLive`, fichier de T28).
Commit : `ce5e596 feat(web): onboarding en 8 écrans et choix de la salle ou de la maison` (Closes #32), sur `socle`, non poussé.
Paquet de revue : `.superpowers/sdd/2026-10-06-socle/review-e957b9a..ce5e596.diff`.

## Ce qui a été fait
- `app-events.ts` : `ONBOARDING_COMPLETED_EVENT = 'appsport:onboarding-completed'`.
- `features/onboarding/StepActions.tsx` (fichier en plus du plan, voir écarts) : `StepProps`, `saveLabel(mode)` (« Suivant » ou « Enregistrer »), `useSaveStep(p, step)` (PATCH du profil avec `onboardingStep` en mode onboarding ; en édition, rien n'est envoyé si le patch est vide ; puis `onNext`), `StepActions` (alerte, « Retour », bouton principal).
- `OnboardingFlow.tsx` : `Page` « Prise en main », « Étape n/8 », conteneur `data-testid="onboarding-step" data-step=<étape>` (clé = étape, chaque écran se remonte et relit ses réponses). Départ = `firstIncompleteStep(await repos.profile.onboardingInput())`, type de lieu = celui du lieu principal s'il existe ; `place` sans type connu → `place_kind`. La reprise est recalculée à chaque pull réussi (`useSyncState().lastPullOkAt`) tant que l'utilisateur n'a ni changé d'écran ni choisi un type de lieu (nouvel appareil, où les miroirs arrivent après l'ouverture). 409 `onboarding_incomplete` de « Commencer » → écran indiqué par le serveur (`step` du corps), sinon recalcul local.
- `GoalStep` : `availableGoals(ageBand)` (pas de « Perdre du gras » pour un mineur), libellés `GOAL_LABELS`. Édition : « Enregistrer » → PATCH `{ goal }` ; objectif sportif sans sport enregistré → « Suivant » → `<SportStep mode="edit" pendingGoal="sport_support">` → un seul PATCH `{ goal, sportCode, sportOtherLabel }`.
- `SportStep` : « Pratiques-tu un autre sport régulièrement ? » Non/Oui ; objectif sportif → « Oui » coché, « Non » désactivé, « Obligatoire avec l'objectif « Me renforcer pour mon sport ». » ; 15 sports (`SPORTS`) ; « Autre » → champ « Ton sport » (`maxLength` 40, « Suivant » désactivé tant qu'il est vide après `trim`). « Non » préchoisi seulement si l'écran a déjà été validé (`me.onboardingStep` ≥ `sport`) ou en édition.
- `PlaceKindStep` : « Où t'entraîneras-tu le plus souvent ? » « À la salle » / « À la maison » → PATCH `{ onboardingStep: 'place_kind' }`.
- `PlaceStep` : lieu principal existant → « Ton lieu principal : <nom> », « Suivant » → PATCH seul (aucun POST). Salle → `GymPicker isPrimary defaultVisible={ageBand !== 'minor'}` sans « Suivant », `onDone` → PATCH `{ onboardingStep: 'place' }`. Maison → « Nom du lieu » (« Maison », `maxLength` 30), groupe « Ton matériel » (`home_none` par défaut, `home_small`, `home_gym` ; changer de préréglage recoche), `EquipmentChecklist kind="home"` ; « Suivant » → POST `/api/places { kind: 'home', name, equipment (ordre EQUIPMENT), isPrimary: true }` puis PATCH. Si le PATCH échoue après la création, l'écran passe en « Ton lieu principal est enregistré. » et un nouvel essai n'envoie que l'étape (pas de second lieu).
- `ExperienceStep`, `AvailabilityStep` (radios « 2 », « 3 », « 4 » et « 30 min » … « 90 min »).
- `HealthStep.tsx` : `HealthConsentPanel` (explication E7.1, `HEALTH_CONSENT_TEXT.text` comme libellé de la case jamais pré-cochée, « J'accepte et je renseigne » actif seulement case cochée → POST `/api/me/consents`, « Passer »), `ScreeningQuestions` (`record` : 4 questions Oui/Non, « Enregistrer mes réponses » quand les 4 ont une réponse → PUT, `caution` → « Nous te recommandons de consulter un médecin avant de commencer. » ; sans accord : texte « Si l'une de ces situations te concerne, demande l'avis d'un médecin avant de commencer. » et la liste des questions, aucune requête), `LimitationsEditor` (« … aucun diagnostic n'est nécessaire. », « Aucune », Zone et Côté en `select`, Gêne en radios, Note `maxLength` 200, « Ajouter une limitation », « Supprimer »), `CautiousModeToggle` (case `role="switch"` « Je préfère une progression plus prudente » ; mineur : cochée, désactivée, « Imposé jusqu'à 18 ans »), `HealthStep` (mode prudent en état local, envoyé au clic sur « Suivant » : `{ cautiousMode, onboardingStep: 'health' }` s'il a changé, sinon `{ onboardingStep: 'health' }` ; `HealthWarning` toujours affiché ; « Suivant » toujours actif).
- `ReadyStep` : récapitulatif (Objectif, Sport, Lieu principal, Niveau, « 3 séances de 45 min »), `OfflineReadyIndicator readiness={…}` (un seul `useReadiness`), « Réessayer » si pas prêt (`retry` → synchro `manual` puis catalogue), « Commencer » désactivé tant que `!loaded || !ready` → POST `/api/me/onboarding/complete`, puis `window.dispatchEvent(new CustomEvent(ONBOARDING_COMPLETED_EVENT))` puis `navigate('/')` ; « Retour » → santé.
- `features/places/` : `EquipmentChecklist` (+ `sortEquipment`) : un `fieldset` par catégorie (`EQUIPMENT_CATEGORY_LABELS`), `household` exclu pour une salle, `onChange` trié. `GymPicker` : « Rechercher une salle » (GET `/api/gyms?q=` au montage puis à chaque saisie, la dernière réponse l'emporte), salles en radios « Basic Fit · Lyon · 2 membres visibles », « Ma salle n'est pas dans la liste », case « Apparaître dans « Qui va à cette salle » » (cochée si `defaultVisible`, sinon décochée avec « Désactivé par défaut pour les moins de 18 ans. »), « Valider » → POST `/api/places { kind: 'gym', gymId, isPrimary, visibleAtGym }` puis `onDone` ; une salle choisie puis masquée par la recherche n'est plus validable ; « Revenir à la liste » en création. `GymCreate` : « Nom de la salle », « Ville » (2 à 60 après `trim`, sinon « 2 à 60 caractères. » sans requête), « Continuer » → GET `/api/gyms/similar?name=…&city=…` ; résultats → « Ces salles existent peut-être déjà : » avec « C'est ma salle » par salle (`onPickExisting`) et « Non, créer ma salle » ; aucun résultat → préréglages directement ; groupe « Type de salle » (gym_large, gym_small, gym_crossfit, gym_other), liste pré-cochée, « Créer la salle » → POST `/api/gyms { name, city, equipment, isPrimary, visibleAtGym }` ; 409 `gym_duplicate` → « Cette salle existe déjà. » + « Choisir cette salle » (`onPickExisting(body.gymId)`) ; modifier le nom ou la ville ramène à « Continuer ».
- `App.tsx` : `/onboarding` rendu dans `PublicShell` (hors `AppShell` : ni navigation de compte ni, plus tard, bandeau de mise à jour). Commentaire de `PublicShell` complété.
- `app-services.tsx` : `useLive` passe `async () => query()` à `liveQuery` (voir écarts, point 1).

## Tests
Fichiers : `test/onboarding/{flow,steps,health-step,ready-step}.test.tsx`, `test/places/gym-picker.test.tsx`, `test/app/use-live.test.tsx`, aide `test/support/onboarding.ts` (`newcomer`, `seedProfile`, `seedPrimaryGym`, `serveProfile` : faux serveur du PATCH qui écrit les champs dans le miroir comme le pull qui suit, `writes`, sélecteurs).
Couverture du brief : tous les cas de l'étape 1, plus : sortie hors `AppShell`, reprise à `ready`, retour depuis le niveau sans recréer de lieu, reprise recalculée au premier pull (nouvel appareil) et pas après un changement d'écran, échec du PATCH après la création de la maison (pas de second POST), changer de préréglage recoche, édition de la disponibilité, suppression d'une limitation, « Retour » de « C'est prêt », « Revenir à la liste », `sortEquipment`.

### TDD
RED 1 (avant tout code) : `pnpm --filter @appsport/web test onboarding/ places/gym-picker`
```
 FAIL  |web| test/places/gym-picker.test.tsx  Error: Failed to resolve import "../../src/features/places/GymPicker" …
 FAIL  |web| test/onboarding/health-step.test.tsx  Error: Failed to resolve import "../../src/features/onboarding/HealthStep" …
 FAIL  |web| test/onboarding/ready-step.test.tsx  Error: Failed to resolve import "../../src/app-events" …
 FAIL  |web| test/onboarding/steps.test.tsx  Error: Failed to resolve import "../../src/features/onboarding/SportStep" …
 FAIL  |web| test/onboarding/flow.test.tsx > … départ 'goal', « Étape 1/8 » …  Error: until: condition jamais remplie   (×7 : /onboarding rendait « Page introuvable »)
 Test Files  5 failed (5)   Tests  7 failed (7)
```
Échec attendu : modules absents, route `/onboarding` encore sur NotFound.

RED 2 (`useLive`, découvert en écrivant `LimitationsEditor` : la liste ne se mettait pas à jour après l'ajout). Test écrit, puis lancé contre `app-services.tsx` d'origine (`git stash` du seul fichier) : `pnpm --filter @appsport/web test app/use-live`
```
 × une écriture de miroir après un await natif relance la requête du dépôt 1057ms
TestingLibraryElementError: Unable to find an element with the text: 1 1 muscle.
 Tests  1 failed (1)
```
Cause : `liveQuery` de Dexie 4.4.6 n'active le suivi à travers les `await` natifs (`incrementExpectedAwaits`) que si la fonction passée est elle-même `async` (`isAsyncFunction(querier)`, dexie.mjs l. 6262). `() => repos.x.y()` ne l'est pas : les lectures faites après le premier `await` natif d'un dépôt (`currentUserId` puis le miroir) n'étaient pas observées.

RED 3 (reprise au premier pull) : `pnpm --filter @appsport/web test onboarding/flow`
```
 × nouvel appareil : la reprise est recalculée quand la première synchro arrive 28ms
Error: until: condition jamais remplie
 Tests  1 failed | 8 passed (9)
```
Vérification par mutation du garde « l'utilisateur a bougé » : sans lui, `écran déjà changé par l'utilisateur : une synchro ne le déplace plus` échoue (`Tests 1 failed | 8 passed`), puis fichier restauré.

GREEN : `pnpm --filter @appsport/web test onboarding/ places/gym-picker app/use-live` → `Test Files 6 passed (6)`, `Tests 53 passed (53)`.
Avant le commit : `pnpm lint` (Checked 350 files, aucune erreur), `pnpm typecheck` (4 paquets, code 0), `pnpm test` → `Test Files 126 passed (126)`, `Tests 1331 passed | 2 skipped (1333)` (les 2 skipped existaient). Sortie sans stderr ni avertissement.

## Jalon 3 vérifié sur le PC
Commandes PowerShell, depuis `C:\Users\eliott.colin\appsport`. Terminal 1 (base neuve, invitation, serveur) :
```powershell
$env:APPSPORT_DATA_DIR = "$env:USERPROFILE\appsport-dev-data"
New-Item -ItemType Directory -Force $env:APPSPORT_DATA_DIR | Out-Null
if (-not (Test-Path "$env:APPSPORT_DATA_DIR\.appsport-volume")) { New-Item -ItemType File "$env:APPSPORT_DATA_DIR\.appsport-volume" | Out-Null }
$env:APP_ORIGIN = 'http://localhost:5173'
$env:APPSPORT_CONTENT_DIR = "$PWD\data"
$env:HOST = '127.0.0.1'
pnpm --filter @appsport/server exec tsx src/main.ts init                                   # première fois seulement
pnpm --filter @appsport/server exec tsx src/main.ts admin:bootstrap --birth-date 1990-01-01  # affiche Lien et Code
pnpm --filter @appsport/server exec tsx src/main.ts
```
Terminal 2 (Vite, voyant « Prêt hors ligne » simulé en développement) :
```powershell
pnpm --filter @appsport/web exec vite
```
Puis ouvrir le lien affiché (`http://localhost:5173/invite#XXXX-XXXX-XXXX-XXXX`) → « Continuer dans ce navigateur » → pseudo, mot de passe de 14 caractères au moins (admin), confirmation, case Confidentialité → « Créer mon compte » → les 8 écrans → « Commencer » → accueil.

Fait une fois (base dans le scratchpad de la session, `init` puis `admin:bootstrap` : « Lien : http://localhost:5173/invite#XXXX-XXXX-XXXX-XXXX », code masqué). Parcours piloté dans Edge sans interface par CDP (`--remote-debugging-port`, script Node dans le scratchpad : clics sur les boutons et libellés, saisie avec l'événement `input` de React) :
```
écran goal | /onboarding | goal | Étape 1/8
écran sport | /onboarding | sport | Étape 2/8          (Oui, Course à pied)
écran place_kind | /onboarding | place_kind | Étape 3/8 (À la maison)
écran place | /onboarding | place | Étape 4/8          (Petit matériel)
écran experience | /onboarding | experience | Étape 5/8 (Moins de 6 mois)
écran availability | /onboarding | availability | Étape 6/8 (3, 45 min)
écran health | /onboarding | health | Étape 7/8        (accord, 4 × Non, genou gauche légère, mode prudent)
écran ready | /onboarding | ready | Étape 8/8          (voyant vert, récapitulatif : Prendre du muscle, Course à pied, Maison, Moins de 6 mois, 3 séances de 45 min)
accueil | / | « Bonjour porteur », « Prêt hors ligne », lien « Administration »
```
Base du serveur ensuite : `user` porteur/admin, `onboarding_completed_at` posé ; `training_profile` muscle, running, lt_6_months, 3, 45, cautious_mode 1 ; `place` home « Maison » principal ; `home_equipment` chair, table, resistance_band, dumbbells, pull_up_bar ; `consent_event` health grant 1.0 ; `health_screening` caution 0, version 1.0 ; `limitation` knee/left/mild. Serveurs et Edge arrêtés ensuite. Le parcours salle (GymPicker, GymCreate) n'a été vérifié que par les tests (aucun second compte sans les écrans d'administration de T33).

## Fichiers
- Créés : `apps/web/src/app-events.ts` ; `apps/web/src/features/onboarding/{OnboardingFlow,GoalStep,SportStep,PlaceKindStep,PlaceStep,ExperienceStep,AvailabilityStep,HealthStep,ReadyStep,StepActions}.tsx`, `onboarding.module.css` ; `apps/web/src/features/places/{GymPicker,GymCreate,EquipmentChecklist}.tsx`, `places.module.css` ; `apps/web/test/onboarding/{flow,steps,health-step,ready-step}.test.tsx`, `apps/web/test/places/gym-picker.test.tsx`, `apps/web/test/app/use-live.test.tsx`, `apps/web/test/support/onboarding.ts`.
- Modifiés : `apps/web/src/App.tsx`, `apps/web/src/app-services.tsx` (`useLive`), `apps/web/src/ui/AppShell.tsx` (commentaire de `PublicShell`).

## Écarts au brief et points d'attention
1. **`useLive` (T28) corrigé** : `liveQuery(async () => query())`. Sans cela, aucune requête de dépôt observée ne se relançait après un pull (liste des limitations, lieux, profil) ; l'accueil (`adultNotice`) marchait par chance (une seule table lue). Effet sur tous les écrans qui utilisent `useLive` ; test dédié `test/app/use-live.test.tsx`. À signaler aux autres tâches web (T32–T34).
2. `ReadyStep` reçoit `onIncomplete(step: OnboardingStep | null)` en plus de `onBack` : le brief demande « 409 onboarding_incomplete → retour au premier écran incomplet », impossible avec la seule signature `{ onBack(): void }` (seul consommateur : `OnboardingFlow`).
3. Le brief cite `EQUIPMENT_PRESETS.home_small.codes` ; le dépôt (T14) expose `PRESETS.home_small.equipment` : utilisé tel quel.
4. Fichier en plus du plan : `features/onboarding/StepActions.tsx` (`StepProps`, `useSaveStep`, `StepActions`, `saveLabel`), partagé par les 8 écrans ; le mettre dans `OnboardingFlow.tsx` aurait créé un import circulaire. `gymLabel` vit dans `GymCreate.tsx` (utilisé aussi par `GymPicker`, qui importe déjà `GymCreate`).
5. Questionnaire d'alerte : aucune réponse pré-cochée, « Enregistrer mes réponses » exige les 4 réponses (questionnaire de santé, pas de « Non » présumé). Le cas du brief « Oui à Q1 + Enregistrer → [true,false,false,false] » est testé en répondant Oui à Q1 et Non aux trois autres.
6. `/onboarding` est rendu dans `PublicShell` (en-tête de marque et liens Confidentialité/Aide/Crédits) plutôt que sans aucun cadre.
7. Reprise recalculée au premier pull (au-delà du brief) : sur un nouvel appareil (cas iOS, où l'appli installée a son propre stockage, R-ARR-2), les miroirs arrivent après l'ouverture et l'onboarding serait reparti de l'objectif. Le recalcul s'arrête dès que l'utilisateur change d'écran ou choisit un type de lieu.
8. Ajouts mineurs non demandés : « Supprimer » sur une limitation (sinon une erreur de saisie reste jusqu'à T34), « Revenir à la liste » dans la création de salle, message « Donne un nom à ce lieu. » si le nom de la maison est vidé, phrase « Tu pourras ajouter ou changer de lieu dans Profil › Lieux. ».
9. `PlaceStep` en mode édition n'a pas d'usage prévu (Profil › Lieux est un autre écran, T32) ; il se comporte comme l'onboarding sans envoyer l'étape.
10. `HealthStep.tsx` regroupe 5 composants (~290 lignes), comme le prévoit la liste de fichiers du plan.

## Revue personnelle
- Interfaces §6 respectées (noms, props) ; écarts locaux listés ci-dessus.
- Écrans sans Dexie ni `local-db` (test d'architecture vert), aucune lecture de `onLine` ; écritures de classe E hors ligne → « Nécessite le réseau » (testé sur l'objectif et la maison).
- Libellés d'E2E exacts : « Suivant », « Commencer », « Réessayer », « Ma salle n'est pas dans la liste », « Nom de la salle », « Ville », « Continuer », « Créer la salle », radios « 2 », « 3 », « 4 », « 30 min » … « 90 min » ; préréglage « Petit matériel » en radio ; apostrophe droite dans toute l'interface (seuls des titres de tests ont `’`, comme les tests existants).
- Libellés d'objectif, de niveau, de sport, de matériel, de catégories et de limitations importés de `@appsport/contracts`.
- Chaque écran ne s'enregistre qu'au clic (aucune requête à la bascule du mode prudent ni au choix d'une réponse).


---

## Correctifs, tour 1 (revue de `ce5e596`)

Statut : DONE. Quatre commits sur `socle`, non poussés, chacun terminé par `Refs #32` et le trailer Co-Authored-By :
- `a5e072f fix(web): écran Santé enregistré au clic sur « Suivant », conseil médical dès un « oui »` (F1, F22, F24)
- `50647e8 fix(web): focus sur le titre à chaque écran, raison d'un retour imposé, marque sans lien` (F2, F17, F21, F26, F27)
- `0c2fee5 fix(web): visibilité avant les boutons de création, réponse périmée ignorée, « Réessayer » la recherche` (F3, F4, F5, F13, F14, F29)
- `731b945 fix(web): raison du « Non » désactivé liée au bouton, réponses de sport enregistrées testées` (F6, F20)

F23 est traité hors commit, car ce rapport est ignoré par git.

### Ce qui a changé, par point

- **T31-F1 (écran Santé)**
  - Les réponses du questionnaire et la limitation en cours de saisie sont maintenant tenues par `HealthStep`, avec deux nouveaux hooks : `useScreening` et `useLimitationDraft`.
  - Au clic sur « Suivant », dans cet ordre :
    1. Des réponses complètes pas encore envoyées partent en PUT `/api/me/health-screening`.
    2. Une limitation complète part en POST `/api/me/limitations`.
    3. Le PATCH `{ [cautiousMode,] onboardingStep: 'health' }` suit.
  - Une saisie à moitié faite arrête « Suivant », avec une alerte :
    - questionnaire : « Réponds aux 4 questions ou efface tes réponses avant de continuer. » ;
    - limitation : « Termine ou efface la limitation en cours avant de continuer. »
  - Deux boutons permettent de vider la saisie. « Effacer mes réponses » apparaît quand des réponses n'ont pas été envoyées. « Effacer la saisie » apparaît quand la limitation n'est pas vide.
  - La recommandation « Nous te recommandons de consulter un médecin avant de commencer. » s'affiche dès qu'une réponse vaut « Oui », avant tout envoi, hors ligne compris (E7.2).
  - « Réponses enregistrées. » s'affiche quand les réponses à l'écran sont celles déjà envoyées, y compris avec un « Oui ».
  - Réessayer après un PATCH en échec ne renvoie ni le PUT ni le POST. Les réponses sont notées comme envoyées et la saisie de limitation est vidée après son POST, donc il n'y a pas de limitation en double.
  - `ScreeningQuestions` et `LimitationsEditor` gardent leur signature §6. Les props `screening` et `draft` sont facultatives : sans elles, l'usage autonome (Profil › Santé, T34) garde son propre état et ses boutons, comme avant.
- **T31-F22 (texte de l'accord)**
  - Le texte de l'accord commence maintenant par « Tes réponses au questionnaire et tes limitations sont des données de santé. ».
  - Sous l'interrupteur, `CautiousModeToggle` affiche « Réglage d'entraînement, pas une donnée de santé : enregistré même sans accord. », relié par `aria-describedby`. Pour un mineur, la mention « Imposé jusqu'à 18 ans » est reliée aussi.
- **T31-F24** : tests ajoutés pour un mode prudent enregistré (interrupteur coché, puis décoché, ce qui envoie PATCH `{ cautiousMode: false, onboardingStep: 'health' }`) et pour un niveau enregistré (« 6 mois à 2 ans » coché, « Suivant » actif).
- **T31-F2 (focus)**
  - Nouveau fichier `features/onboarding/StepTitle.tsx`.
  - Dans le flux, le h2 de chaque écran a `tabIndex={-1}` et `aria-labelledby="<id de « Étape n/8 »> <id du titre>"`. Son nom accessible est donc « Étape 2/8 Autre sport ».
  - Le titre prend le focus dès qu'il est rendu après « Suivant », « Retour » ou un 409, par une ref de rappel et un drapeau `focusNext` posé par `goTo`. Il ne le prend pas au premier affichage, ni lors d'une reprise recalculée après un pull.
  - Hors du flux (Profil), `StepTitle` rend un simple `<h2>`. Les 8 écrans utilisent `StepTitle`.
- **T31-F17** : après un 409 `onboarding_incomplete`, `ERROR_MESSAGES.onboarding_incomplete` (« Termine d'abord ta prise en main. ») s'affiche dans un `Banner` de ton warning (`role="status"`) sur l'écran visé. Il disparaît au changement d'écran suivant. Les deux branches sont couvertes : étape fournie par le serveur, et recalcul local.
- **T31-F21** : `PublicShell` reçoit une prop `homeLink?: boolean`. `/onboarding` la passe à `false`, et la marque « appsport » devient un simple texte.
- **T31-F26** : `shownStep` est exporté et testé (`place`/`null` → `place_kind`, `place`/`gym` → `place`). Le test de flux est renommé d'après ce qu'il vérifie : « reprise sans lieu principal : 'place_kind', aucun type coché ». La règle est gardée, car seul un 409 du serveur peut mener à `place` (commentaire ajouté).
- **T31-F27** : test du 409 sans `step`. Le profil local perd `daysPerWeek` sans nouveau pull, puis « Commencer » mène à `data-step="availability"`, avec le message et sans événement.
- **T31-F3** : `GymCreate` reçoit une prop facultative `visibility?: ReactNode`, rendue juste après « Ville ». La case de visibilité arrive donc avant « Continuer », « C'est ma salle » et « Créer la salle ». `GymPicker` la passe en mode création. Un test le vérifie avec `compareDocumentPosition`.
- **T31-F13** : `GymCreate` compte les modifications du nom et de la ville (`useRef`). Une réponse de `/api/gyms/similar` arrivée après une modification est ignorée.
- **T31-F14**
  - Une recherche en échec affiche le bouton « Réessayer », qui incrémente un compteur `reload` inclus dans les dépendances de l'effet de recherche.
  - Le texte « 1 salle trouvée. », « n salles trouvées. » ou « Aucune salle trouvée. » est rendu dans un `<p role="status">`.
- **T31-F4, T31-F5, T31-F29 (tests seulement, le code de `ce5e596` était correct)**
  - Dans PlaceStep, un mineur voit la case décochée avec « Désactivé par défaut pour les moins de 18 ans. », et « Valider » envoie `visibleAtGym: false`.
  - Un adulte qui décoche, puis clique « Valider », envoie `false`.
  - `it.each` sur 3 cas (mineur sans clic, mineur qui coche, majeur qui décoche) pour « Créer la salle » (POST `/api/gyms`) et pour un 409 suivi de « Choisir cette salle » (POST `/api/places`).
  - Les ids sont distincts : `g-1` dans la recherche, `g-2` dans les salles proches, `g-9` dans le 409.
- **T31-F6** : tests de SportStep avec une réponse enregistrée : « Non » validé (`onboardingStep: 'sport'`, aucun sport), sport enregistré (« Oui » et « Course à pied »), « Autre » avec « Pétanque » dans « Ton sport ». S'y ajoutent deux tests de flux : « Non », puis « Retour » depuis le lieu, garde « Non » coché ; un sport, puis « Retour », le garde coché.
- **T31-F20** : `ChoiceList` (§6) reçoit une prop facultative `describedBy` par option, sans effet sur les usages existants. SportStep y relie l'id du texte « Obligatoire avec l'objectif « Me renforcer pour mon sport ». » au « Non » désactivé.
- **T31-F23** : le lien de bootstrap de la section « Jalon 3 » plus haut est masqué en `invite#XXXX-XXXX-XXXX-XXXX`, et aucune autre copie n'existe sous `.superpowers/sdd/`. Pour la vérification de ce tour, le journal de `admin:bootstrap` est écrit dans un fichier du scratchpad, lu par le script de pilotage sans affichage, puis supprimé. **Reste à faire par le contrôleur** : ajouter la règle « un rapport ne contient jamais de code, de lien avec fragment, de mot de passe ni de jeton » aux règles des relecteurs et des implémenteurs. Ces fichiers sont sous `.superpowers/`, que je n'ai pas le droit de modifier (règle « Do not touch docs/ or .superpowers/ (except your report file) »).

### Points d'attention

1. **F1, limitation complète.** La correction proposée bloquait sur toute limitation remplie. J'envoie plutôt une limitation **complète** au clic sur « Suivant », pour appliquer R-ONB-2 (« chaque écran est enregistré au clic sur « Suivant » »). Seule une saisie incomplète bloque. Si tu préfères bloquer aussi les saisies complètes, il suffit de changer une ligne dans `HealthStep`.
2. **F1, pas de second arrêt quand la recommandation est due.** La correction suggérait de rester sur l'écran pour montrer la recommandation. Comme elle s'affiche dès le « Oui », l'utilisateur l'a déjà vue avant de cliquer : « Suivant » enchaîne directement PUT puis PATCH, comme le demande le test de la correction.
3. `HealthStep.tsx` passe à environ 395 lignes : 5 composants et 2 hooks, toujours selon la liste de fichiers du plan.
4. Le h2 focalisable a `tabIndex={-1}` : il reçoit le focus par script mais n'entre pas dans la tabulation.

### Tests et TDD
RED, mutations et GREEN, dans l'ordre :
```
RED F1/F22 : pnpm --filter @appsport/web test onboarding/health-step onboarding/steps
 × texte de l'accord … (texte « Tes réponses au questionnaire et tes limitations… » introuvable)
 × mode prudent : présenté comme un réglage enregistré même sans accord (P-CST-2)
 × Oui à la 1re question : PUT des réponses … (« Réponses enregistrées. » absent quand caution = true)
 × un seul « Oui » affiche tout de suite la recommandation, sans requête (E7.2)
 × réponses non enregistrées : « Suivant » envoie le PUT puis le PATCH -> expected [ 'PATCH /api/me/training-profile' ] to deeply equal [ Array(2) ]
 × hors ligne : le « Oui » affiche la recommandation …
 × réponses incomplètes : … -> Unable to find role="alert"
 × limitation remplie sans « Ajouter » … -> expected [ 'PATCH /api/me/training-profile' ] to deeply equal [ 'POST /api/me/limitations', …(1) ]
 × limitation incomplète : … -> Unable to find role="alert"
 Tests  9 failed | 28 passed (37)
GREEN : pnpm --filter @appsport/web test onboarding/ -> Test Files 4 passed (4), Tests 50 passed (50)
MUTATIONS F24 (code de HEAD correct) :
 a) HealthStep value={cautious ?? false} + ExperienceStep value = choice -> 2 failed | 35 passed
    × niveau enregistré : coché, « Suivant » actif ; × mode prudent enregistré : interrupteur coché …
 b) next.run(changed ? { cautiousMode: true } : {}) -> expected [ { cautiousMode: true, …(1) } ] to deeply equal [ { cautiousMode: false, …(1) } ]

RED F2/F17/F21/F26/F27 : pnpm --filter @appsport/web test onboarding/flow onboarding/ready-step
 × 409 onboarding_incomplete : … avec la raison -> Unable to find an element with the text: Termine d'abord ta prise en main.
 × 409 sans étape lisible : … -> idem (message absent)
 × départ 'goal' … -> AssertionError: expected <a href="/" class="_brand_a2e1a1"></a> to be null
 × changement d'écran : le titre … reçoit le focus -> Unable to find role="heading" and name "Étape 1/8 Objectif"
 × shownStep : … -> TypeError: shownStep is not a function
 Tests  5 failed | 11 passed (16)
GREEN : pnpm --filter @appsport/web test onboarding/ -> Test Files 4 passed (4), Tests 53 passed (53)
MUTATION F27 : ReadyStep `if (step.success) p.onIncomplete(step.data);` (branche null supprimée)
 × 409 sans étape lisible : écran recalculé depuis la base locale -> Error: until: condition jamais remplie

RED F3/F13/F14 : pnpm --filter @appsport/web test places/gym-picker onboarding/steps
 × hors ligne : « Nécessite le réseau » et « Réessayer » … -> Unable to find … role "button" and name "Réessayer"
 × nombre de salles trouvées … (role status) -> Unable to find … text: 1 salle trouvée.
 × la case de visibilité précède « C'est ma salle » et « Créer la salle » -> expected false to be true
 × nom modifié pendant la recherche des salles proches … -> expected <fieldset …(1)>…(5)</fieldset> to be null
 Tests  4 failed | 39 passed (43)
MUTATIONS F4/F5/F29 (code de HEAD correct ; fichier restauré après chaque run) :
 a) PlaceStep `defaultVisible` (toujours vrai) -> × salle, mineur : … visibleAtGym: false (P-MIN-6) : expected true to be false
 b) GymCreate `visibleAtGym: true` en dur -> × mineur, case laissée décochée : « Créer la salle » … ; × majeur qui décoche … « Créer la salle »
 c) GymPicker `p.defaultVisible` au lieu de `visible` (l. 52 et 80) -> 5 échecs : « Valider » (majeur qui décoche), « Créer la salle » ×2, 409 « Choisir cette salle » ×2
 d) GymPicker `pick.run(gyms?.[0]?.id ?? gymId)` -> × « C'est ma salle » : gymId 'g-1' au lieu de 'g-2' ; × 409 : 'g-1' au lieu de 'g-9' (+ 3 cas it.each)
GREEN : pnpm --filter @appsport/web test places/gym-picker onboarding/ -> Test Files 5 passed (5), Tests 77 passed (77)

RED F20 : pnpm --filter @appsport/web test onboarding/steps onboarding/flow
 × objectif sport : … la raison liée au bouton -> AssertionError: expected null to be 'Obligatoire avec l'objectif « Me ren…'
 Tests  1 failed | 35 passed (36)
MUTATIONS F6 (code de HEAD correct ; fichier restauré après chaque run) :
 a) answered = p.mode === 'edit' -> × « Non » au sport enregistré, puis « Retour » … ; × « Non » déjà validé …
 b) branche savedSport supprimée -> × sport enregistré, puis « Retour » … ; × sport enregistré … ; × « Autre » enregistré …
 c) sportValue = sport -> mêmes 3 échecs que b)
 d) « Ton sport » sans profile.sportOtherLabel -> × « Autre » enregistré … : expected '' to be 'Pétanque'
GREEN : pnpm --filter @appsport/web test -> Test Files 43 passed (43), Tests 478 passed (478)
```

### Commandes finales
- `pnpm lint` : `Checked 351 files in 206ms. No fixes applied.`, code de sortie 0.
- `pnpm typecheck` : 4 paquets, code de sortie 0.
- `pnpm test` : `Test Files 126 passed (126)`, `Tests 1361 passed | 2 skipped (1363)`, code de sortie 0, sans stderr ni avertissement. Les 2 tests ignorés existaient déjà.
- `git show --stat` des 4 commits :
  - `a5e072f` : HealthStep.tsx, StepActions.tsx, health-step.test.tsx, steps.test.tsx.
  - `50647e8` : App.tsx, les 8 écrans (StepTitle), OnboardingFlow.tsx, StepTitle.tsx (nouveau), AppShell.tsx, flow.test.tsx, ready-step.test.tsx.
  - `0c2fee5` : GymCreate.tsx, GymPicker.tsx, steps.test.tsx, gym-picker.test.tsx.
  - `731b945` : SportStep.tsx, ChoiceList.tsx, flow.test.tsx, steps.test.tsx.
- `git status` : arbre propre.

### Jalon 3 revérifié sur le PC (après les correctifs)
Commandes PowerShell, depuis `C:\Users\eliott.colin\appsport`. Pour ce tour, `APPSPORT_DATA_DIR` pointait vers un dossier neuf du scratchpad (`m3b-data`) ; pour un essai à la main, garde le dossier ci-dessous.

Terminal 1 :
```powershell
$env:APPSPORT_DATA_DIR = "$env:USERPROFILE\appsport-dev-data"
New-Item -ItemType Directory -Force $env:APPSPORT_DATA_DIR | Out-Null
if (-not (Test-Path "$env:APPSPORT_DATA_DIR\.appsport-volume")) { New-Item -ItemType File "$env:APPSPORT_DATA_DIR\.appsport-volume" | Out-Null }
$env:APP_ORIGIN = 'http://localhost:5173'
$env:APPSPORT_CONTENT_DIR = "$PWD\data"
$env:HOST = '127.0.0.1'
pnpm --filter @appsport/server exec tsx src/main.ts init                                   # première fois seulement
pnpm --filter @appsport/server exec tsx src/main.ts admin:bootstrap --birth-date 1990-01-01  # affiche Lien et Code
pnpm --filter @appsport/server exec tsx src/main.ts
```

Terminal 2 :
```powershell
pnpm --filter @appsport/web exec vite
```

Ensuite :
1. Ouvre le lien affiché (`http://localhost:5173/invite#XXXX-XXXX-XXXX-XXXX`).
2. Clique « Continuer dans ce navigateur ».
3. Crée le compte : pseudo, mot de passe, confirmation, case Confidentialité.
4. Fais les 8 écrans.
5. Clique « Commencer » : tu arrives à l'accueil.

Lancé une fois dans Edge sans interface (`msedge.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<scratchpad>\m3b-edge`), piloté par CDP avec `scratchpad\m3b-drive.mjs`. Ce tour couvre le parcours **salle**, que le premier tour n'avait vérifié qu'en tests, et le nouvel écran Santé :
```
écran goal | /onboarding | goal | Étape 1/8 | focus : BODY
  OK  marque « appsport » en texte, sans lien (F21)
écran sport | /onboarding | sport | Étape 2/8 | focus : h2 « Étape 2/8 Autre sport »
  OK  focus sur le titre « Étape 2/8 Autre sport » (F2)
écran place_kind | /onboarding | place_kind | Étape 3/8 | focus : h2 « Étape 3/8 Lieu principal »
écran sport | /onboarding | sport | Étape 2/8 | focus : h2 « Étape 2/8 Autre sport »
  OK  « Non » toujours coché après « Retour » (F6)
écran place_kind | /onboarding | place_kind | Étape 3/8 | focus : h2 « Étape 3/8 Lieu principal »
écran place | /onboarding | place | Étape 4/8 | focus : h2 « Étape 4/8 Ma salle »
  OK  « Aucune salle trouvée. » en role="status" (F14)
  OK  case de visibilité avant « Continuer » (F3)
  OK  case de visibilité avant « Créer la salle » (F3)
écran experience | /onboarding | experience | Étape 5/8 | focus : h2 « Étape 5/8 Niveau »
écran availability | /onboarding | availability | Étape 6/8 | focus : h2 « Étape 6/8 Disponibilité »
écran health | /onboarding | health | Étape 7/8 | focus : h2 « Étape 7/8 Santé et prudence »
  OK  texte de l'accord limité au questionnaire et aux limitations (F22)
  OK  recommandation de consulter dès le « Oui », avant tout envoi (F1)
écran ready | /onboarding | ready | Étape 8/8 | focus : h2 « Étape 8/8 C'est prêt »
récapitulatif : Prendre du muscle · Salle du Parc · Moins de 6 mois · 3 séances de 45 min
accueil | / | « Bonjour porteur », liens Accueil, Profil, Administration
```

À l'écran Santé, le parcours a donné l'accord, répondu Oui à Q1 et Non à Q2-Q4, puis rempli Genou, Gauche et Légère, **sans** cliquer « Enregistrer mes réponses » ni « Ajouter une limitation ». Un seul clic sur « Suivant » a ensuite produit, dans le journal du serveur : `PUT /api/me/health-screening 200`, `POST /api/me/limitations 201`, `PATCH /api/me/training-profile 200`. Puis « Commencer » a envoyé `POST /api/me/onboarding/complete 200`.

Base du serveur ensuite, lue en lecture seule avec `node:sqlite` :
- `user` : porteur/admin, `onboarding_completed_at` posé.
- `training_profile` : muscle, sans sport, `lt_6_months`, 3, 45, `cautious_mode` 0.
- `gym` : « Salle du Parc », Lyon, avec les 12 codes de `gym_small`.
- `place` : gym principal, `visible_at_gym` 1 (adulte, case laissée cochée).
- `consent_event` : health 1.0.
- `health_screening` : `caution` 1, version 1.0.
- `limitation` : knee/left/mild, note null.

Vérifié avant l'arrêt : les processus des ports 3000, 5173 et 9333 étaient les miens (chemins sous `appsport\`, profil Edge du scratchpad). Je les ai arrêtés, ainsi que Edge. Le journal de bootstrap est supprimé, et aucun code ne reste dans les journaux du scratchpad.
