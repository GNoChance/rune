# Brique 5 · Nutrition : spec de conception

> **Statut :** version 1 du 2026-11-06, rédigée par Claude sans séance de cadrage, à la demande du propriétaire, puis complétée par la relecture « constructeur » (descente hors ligne §6.4 bis, bilan figé §8, point de départ et S−1 §9, pause §11.3, reprise après `weigh_in_required` §12.5, arrêt d'urgence §7). Chaque point que les sources laissaient ouvert est tranché ici et marqué « (choix Cn) » ; le §18 les rassemble, avec ce que coûte chacun s'il est faux. Les écarts à la spec maîtresse sont listés et justifiés au §3.1.
> **Base :** la section [07-nutrition](2026-10-06-appsport-design/07-nutrition.md) fait autorité pour les règles, les formules, les arrondis, les cas de référence, le bilan, le vocabulaire et le modèle de données ; ce document ne les recopie pas, il les précise et les branche sur le code. Voisins : [01](2026-10-06-appsport-design/01-architecture.md) (classes de synchro J, D, E, C, R-SYN-5, R-SYN-9), [02](2026-10-06-appsport-design/02-comptes.md) (âge, R-AGE-6, R-CST-3), [03](2026-10-06-appsport-design/03-vie-privee.md) (C2, P-CST-2 à 4, P-MIN-5, P-ADM-2), [06](2026-10-06-appsport-design/06-coach.md) §5, §6, §7, §16 (dossier, `open_nutrition_screen`, carte TCA, filtre, évaluation), [09](2026-10-06-appsport-design/09-modele-de-donnees.md) §5 (tables).
> **Écrans :** ils suivent la [refonte](2026-10-13-refonte-rune-design.md) (jetons, 5 thèmes, feuilles du bas, bulle du coach et ses avatars « nutrition ») et réutilisent les composants des briques 2 à 4 (`LineChart`, `CoachBubble`, `SystemPanel`, cartes d'aide, écrans de relecture).
> **Code existant :** la brique 4 a préparé la place : `nutrition: null` dans `coach-brief/1`, `nutritionMode: 'none'` aux appels du filtre, `HELP_RESOURCES`, `FORBIDDEN_TERMS` v1, `HEALTH_WITHDRAW_HOOKS`, `flushBefore`. Le texte d'accord santé v1.0 cite déjà « taille, poids, profil et suivi nutritionnels » : aucune nouvelle version n'est nécessaire.

## 1. But

Donner aux adultes qui le veulent des repères chiffrés (énergie, protéines, lipides, glucides, fibres, eau) calculés par du code versionné, un suivi du poids lissé et un bilan hebdomadaire qui propose un ajustement borné, que la personne accepte ou refuse ; donner à tous, mineurs compris, des fiches conseils relues et sans chiffres. Le coach explique ces repères sans jamais en produire.

Réussi = critère 5 de la spec principale, lu à travers 07 : les six cas de référence (A à F) et le scénario du bilan passent ; un mineur, un compte en qualitatif ou désactivé ne reçoit aucun chiffre ni aucune pesée, par aucun chemin (API, synchro, dossier du coach) ; le retrait de l'accord santé vide tout ; le coach ne cite que des chiffres du dossier.

## 2. Périmètre

**Dans la brique 5**
1. Domaine pur : mode effectif, calcul `nutri-1` en arithmétique exacte, lissage, bilan, issue de l'écran de sécurité, présélections, contrôles de saisie.
2. Données : migration `0009_nutrition` (4 tables + état d'ouverture du mode complet), registre de synchro, crochets de push des pesées, filtrage du pull, crochet de retrait de l'accord santé, export, suppression.
3. API : ouverture du module, écran de sécurité, mode, réglages et aperçu, bilan (réponse, semaine non représentative), suppression des données, fiches servies, interrupteur d'administration.
4. Fiches conseils : fichiers, chargeur, relecture par l'admin dans l'écran de relecture existant, contrôles de publication, service filtré ; rédaction des 8 fiches de la v1 (brouillons à relire par le propriétaire).
5. Écrans : module Nutrition dans ses trois modes, activation, écran de sécurité, réglages, pesée, courbe, bilan, fiches, pages fixes « Comment sont calculés mes repères » et « Demander de l'aide », carte de l'accueil, entrée du Profil, page Aide.
6. Coach : bloc nutrition du dossier (`coach-brief/2`), outil `open_nutrition_screen` (`tools-2`), `safety_pause` et bouton vers le mode sans chiffres sur la carte TCA, filtre branché sur le mode effectif, termes interdits v2, prompts `coach-3`, parcours guidés, cas d'évaluation nutrition.

**Hors brique 5 :** la liste 07 §5.13 (journal alimentaire, scan, Ten-Haaf, dépense d'exercice, rappels de pesée…), toute XP, quête ou rang lié à la nutrition ou au poids (choix C1), la campagne d'évaluation réelle (prérequis 4).

### 2.1 Prérequis du propriétaire

Ces points ne sont pas des choix : ils attendent le propriétaire, et le plan les marque comme bloquants là où ils le sont.
1. **Relecture des 8 fiches** rédigées par la brique (§10.5). Le code se construit et se teste sur des fiches fictives (`eval`/E2E) ; aucune fiche réelle n'est publiée sans sa relecture dans l'appli.
2. **Ouverture du mode complet.** 07 §5.15.5 recommande la relecture des seuils déduits par un·e diététicien·ne. L'interrupteur « Repères chiffrés » de l'administration est fermé à l'installation (D4) ; l'ouvrir est la décision du propriétaire.
3. **Horaires de la ligne TCA** : `hours` reste nul tant qu'ils ne sont pas vérifiés (07 §5.11.2) ; à revérifier avant la mise en service, comme Écoute Dopage.
4. **Campagne d'évaluation réelle du coach** : la brique change `prompt_version`, `tools_version` et `brief_schema`, donc toutes les combinaisons de `COACH_CONFIG.evaluated` sont à réévaluer. Une seule campagne couvre les briques 4 et 5 (Task 32 de la brique 4, environ 20 $), sur accord du propriétaire et avec la clé `rune-dev`.

## 3. Décisions et remplacements

| # | Sujet | Décision | Remplace ou précise |
|---|---|---|---|
| D1 | Navigation | Pas d'onglet. Entrées : Profil › Entraînement › **Nutrition** (toujours), carte **Nutrition** de l'accueil (mode effectif ≠ `disabled`), cartes d'aide du coach, page Aide. Route `/nutrition`, rattachée à la section Profil de la barre (choix C2). | Refonte §5 (« Nutrition prend la place de Salles ») ; brique 3 D1 (« place à trancher par la brique 5 »). |
| D2 | Calcul | `computeNutritionTargets` et `decideCheckin` ne tournent que sur le serveur. Le téléphone calcule seulement la moyenne glissante 7 jours pour dessiner la courbe, avec la même fonction du domaine (choix C3). | Précise 07 §5.2.1 et 01 (copie provisoire des classes D : aucune ici). |
| D3 | Arithmétique | Rationnels exacts en `bigint` (numérateur, dénominateur) dans `packages/domain/src/nutrition/exact.ts` ; entrées entières (g, cm, PAL et facteurs en centièmes) ; aucun flottant avant la sortie (choix C4). | Précise 07 §5.6 (« entiers mis à l'échelle ou rationnels »). |
| D4 | Ouverture du mode complet | Une ligne `nutrition_state` (`full_open`, 0 à l'installation), réglée par l'admin. Fermé : le mode effectif `full` devient `qualitative`, motif affiché « Les repères chiffrés ne sont pas encore ouverts dans ce cercle » ; le stocké ne change pas (choix C5). | Écart à 07 §5.3, §3.1. |
| D5 | Ouverture du module | `POST /api/nutrition/open` est la seule lecture en ligne : il calcule le mode effectif, crée le bilan de la semaine écoulée et la cible `new_algo_version` s'il y a lieu, et rend l'état complet. Le client appelle `flushBefore` avant (choix C6). | Précise 07 §5.7.3 (« à la première ouverture du module »). |
| D6 | Écran de sécurité | Un seul appel `POST /api/nutrition/screen` reçoit les trois réponses **et** le mode choisi (plus, pour `full` sans réglages, la mise en place complète). Le serveur recalcule l'issue, refuse un mode non permis, n'enregistre jamais les réponses (choix C7). | Précise 07 §5.4. |
| D7 | Fiches et pages fixes | Les 8 fiches du catalogue sont des `advice_sheet`. « Comment sont calculés mes repères » et « Demander de l'aide » deviennent des pages de l'appli, au texte dans le code (choix C8). | Écart à 07 §5.8, §3.1. |
| D8 | Service des fiches | `GET /api/nutrition/sheets`, filtré par âge et mode effectif, ETag = version des fiches + public + mode ; copie hors ligne dans Dexie. Les fiches ne sont pas dans `GET /api/catalog` (choix C9). | Écart léger à 01 (catalogue unique), §3.1. |
| D9 | Relecture des fiches | Par l'admin seul, dans l'écran de relecture existant, segment « Fiches conseils » ; même cycle `draft → reviewed → published → retired` (choix C10). | Précise 07 §5.8.1 (« écran éditorial générique »). |
| D10 | Mode effectif côté client | Chaque réponse de pull porte `nutrition: { effective_mode }`, calculé à l'instant ; le client purge ses copies dès qu'il lit autre chose que `full`, et, quand il relit `full` après un autre mode, charge l'instantané des trois tables par `GET /api/nutrition/rows` : le pull n'a qu'un curseur commun à toutes les tables (choix C11). | Précise 07 §5.12 (« Pull ») et §5.4 (purge). |
| D11 | Sortie du mode complet hors ligne | Le passage vers `qualitative` ou `disabled` agit tout de suite sur l'appareil (chiffres masqués, copies purgées) et part au retour du réseau, avant le pull ; les autres réglages exigent le réseau (choix C12). | Écart à 01 (classe E « en ligne seulement »), §3.1. |
| D12 | Coach | `coach-brief/2` (bloc `nutrition`), `tools-2` (`open_nutrition_screen` avec une suggestion facultative), prompts `coach-3-adult` et `coach-3-minor` ; les fils déjà ouverts gardent leurs versions (choix C13, C14). | 06 §5, §6 ; brique 4 §9, §10. |
| D13 | Filtre | Le filtre lit le mode effectif du fil. Termes interdits v2 : la liste « pour tous » s'applique dans tous les modes ; une liste « hors mode complet » s'ajoute ; la liste mineur ne change pas. Les volumes (L, mL, cL) entrent dans la famille nutrition (choix C15, C16). | Écart à 06 §7.3, §3.1 ; brique 4 §11. |
| D14 | Pause de sécurité | `refer_to_help("eating_disorder")` pose `safety_pause` si le profil existe et que l'accord santé est actif ; pendant la pause, ni proposition de baisse, ni objectif « perte » dans les réglages ; l'écran de sécurité repassé la lève (choix C17). | Précise 07 §5.9 et 06 §6. |

### 3.1 Écarts à la spec maîtresse

1. **Refonte §5, onglet Nutrition → pas d'onglet (D1).** La barre a déjà 5 entrées (Accueil · Exercices · Séance · Progression · Profil) et Salles n'y est plus depuis la brique 2. Le module est désactivé par défaut, et 07 §5.4 dit que l'appli ne pousse pas vers le mode complet : un onglet visible par tous ferait les deux. La carte de l'accueil donne l'accès en un geste à ceux qui l'ont activé.
2. **07 §5.3, rangée ajoutée : `full_open` (D4).** Une seule règle en tête de la table de vérité : mode complet non ouvert → `qualitative`. Elle tient le prérequis 2 sans code temporaire et sert d'arrêt d'urgence si un défaut de calcul apparaît.
3. **07 §5.8, deux fiches → pages fixes (D7).** « Demander de l'aide » doit être lisible sans compte (page Aide) et en mode désactivé, où le catalogue n'est pas servi ; « Comment sont calculés mes repères » insère les valeurs de la cible, ce qu'un texte de catalogue ne fait qu'avec des gabarits. Les deux textes vivent dans `apps/web/src/features/nutrition/nutrition-texts.ts`, passent les mêmes contrôles que les fiches (§10.3) et affichent leurs sources et leur date de relecture.
4. **01, catalogue unique → service des fiches à part (D8).** 07 §5.8.3 exige un filtrage par âge et mode côté serveur ; le bloc partagé de `GET /api/catalog` ne peut pas le faire. Les fiches restent de classe C (lecture seule, remplacement en bloc, ETag).
5. **01, classe E → sortie du mode complet hors ligne (D11).** 07 §5.4 demande un retour en un geste à effet immédiat, et le risque 4 (la pesée qui entretient un trouble) ne doit pas attendre le réseau. Seule la descente est différée ; la montée vers `full` reste en ligne.
6. **06 §7.3, termes interdits « pour un mineur ou hors mode complet » → la liste « pour tous » dans tous les modes (D13).** 07 §5.10 dit « ne jamais utiliser » sans exception de mode ; le mode complet ouvre les chiffres, pas « régime » ni « sèche ».
7. **06 §6, `open_nutrition_screen(screen)` → `screen` et `suggestion` facultative (D12).** 07 §5.9 parle d'un écran « prérempli » ; sans valeur suggérée, il n'y aurait rien à préremplir que l'existant. Le code valide la suggestion, l'écran la présélectionne, la personne confirme.

## 4. Ce qui existe, ce que la brique ajoute

| Existe (briques 1 à 4) | Ajouté par la brique 5 |
|---|---|
| `packages/domain/src/age.ts` (`ageOn`, `ageBandOn`, `parisDate`) ; `ADULT_AGE` | `NUTRITION_MAX_AGE = 78` ; `effectiveNutritionMode` |
| `consent_event` (`health`), `requireHealthConsent`, `withdrawHealthConsent`, `clearTable` générique, `HEALTH_WITHDRAW_HOOKS` | crochet `nutrition_profile` ; les trois autres tables C2 passent par `clearTable` |
| `entity-rules.ts` (classes J, D, E, C, H), push J (`push.ts`), pull par propriétaire (`pull.ts`), `TOMBSTONE_TTL_DAYS = 90`, codes de rejet | 4 règles, crochets de push `weigh_in`, filtre de pull par mode, champ `nutrition` du pull |
| `HELP_RESOURCES` (ligne TCA 09 69 325 900, `hours` nul), test de l'ancien numéro | page `/help/nutrition`, pied du module |
| `FORBIDDEN_TERMS` v1 (`packages/contracts/src/forbidden-terms.ts`), scans des textes du coach | v2 (trois listes), scan des textes nutrition et des fiches |
| Filtre (`packages/domain/src/coach/filter.ts`, `values.ts`) avec `nutritionMode: 'none'` codé en dur aux appels | mode lu sur le fil, famille volume |
| `coach-brief/1` (`nutrition: null`), `TOOLS_1`, prompts `coach-2-*`, parcours `flow: 'nutrition'` qualitatif, cas `eval/coach/cases/n-*`, `m-*` | `coach-brief/2`, `TOOLS_2`, `coach-3-*`, puces « Mes repères » et « Mon bilan », 10 cas |
| Relecture des fiches d'exercices (`apps/server/src/review/*`, `apps/web/src/features/review/*`), chargeur `data/exercises/*.json` | type `advice`, chargeur `data/advice/*.json`, contrôles de publication |
| `LineChart.tsx` (SVG, valeurs seules, table d'accompagnement) | points discrets et lissage affichés ensemble |
| Profil › Entraînement, accueil, page Aide, R-AGE-6 (`HomePage.tsx:36`) | entrée Nutrition, carte de l'accueil, section Aide, texte R-AGE-6 complété |

## 5. Domaine (`packages/domain/src/nutrition/`)

Fonctions pures, sans horloge : la date du jour (Paris) et l'âge sont passés en paramètre.

| Module | Contenu |
|---|---|
| `constants.ts` | `NUTRI_ALGO_VERSION = 'nutri-1.0.0'`, PAL, facteurs d'objectif, bornes, constante `unspecified`, seuils du bilan (bandes, −1,5 %, 2 kg, 3 pesées, pas de 100 kcal), domaines d'entrée. Seul module où vivent ces valeurs ; une modification change `NUTRI_ALGO_VERSION` et les cas de référence. |
| `exact.ts` | rationnels `bigint` : addition, multiplication, comparaison, arrondi au multiple (moitié vers le haut), plancher et plafond au multiple. |
| `mode.ts` | `effectiveNutritionMode({ stored, age, healthConsentActive, screenVersion, currentScreenVersion, fullOpen })` → `{ mode, cause }`, `cause` ∈ `stored`, `minor`, `over_max_age`, `no_health_consent`, `screen_outdated`, `full_closed`. Ordre : 07 §5.3, avec `full_closed` juste avant la règle 6. |
| `targets.ts` | `computeNutritionTargets(input)` → `NutritionTargets` ou `{ refusal: 'MODE_NOT_FULL' | 'INPUT_OUT_OF_RANGE' }` ; `bmiBelow(heightCm, weightG, threshold)` sans flottant. |
| `weights.ts` | `movingAverage7(weighIns, day)`, `referenceWeight(weighIns, day)` (moyenne glissante, sinon dernière pesée de moins de 14 jours, sinon `null`), `weekMean(weighIns, monday)` (≥ 3 pesées), `saisieSuspecte(weighIns, weightG, day)` (écart > 3 kg avec la moyenne des 7 derniers jours). |
| `checkin.ts` | `decideCheckin(input)` (§9) → décision, position, delta proposé, recalibrage à faire. |
| `screen.ts` | `screenOutcome(answers)` → `{ allowedModes, reason: 'choice' | 'safety', orientations: ('midwife' | 'doctor' | 'dietitian' | 'eating_disorder_line')[] }` selon la table de 07 §5.4. |
| `preselect.ts` | objectif et niveau présélectionnés (07 §5.4, `sport_code` → 3, sinon 2 ; `fat_loss` → `lose` sauf IMC < 18,5). |

**Contrats (`packages/contracts`)** : `nutrition.ts` (schémas Zod des tables, de l'état, des routes, des décisions et des règles), `nutrition-screen.ts` (`SAFETY_SCREEN = { version: 1, questions }`, libellés exacts de 07 §5.4, réponses `yes` | `no` | `prefer_not`), `forbidden-terms.ts` v2 (§11.5). `HELP_RESOURCES` ne change pas.

**Calcul.** Tout suit 07 §5.6 à la lettre ; points précisés :
- Les entrées sont des entiers : `weightG` (multiple de 100), `heightCm`, `age`, `activityLevel`, `cumulativeAdjustmentKcal`. P en kg = `weightG / 1000` en rationnel.
- `bmr_kcal` et `tdee_kcal` sortent en nombre à 2 décimales au plus (affichage seulement, REAL en base) ; toutes les autres sorties sont des entiers.
- « Glucides ≥ 0 » est un invariant : s'il était violé, la fonction lève une erreur (bug), elle ne borne pas.
- `applied_rules` est trié dans l'ordre de 07 §5.12 ; une règle n'y entre que si elle a changé le résultat (pour `maintenance_band` et `surplus_cap_15`, seulement si la borne a coupé `kcal_brut`).

## 6. Données et synchronisation

### 6.1 Migration `0009_nutrition` (non cassante)

Les tables de 09 §5, colonnes de synchro du socle comprises, SQLite STRICT, plus :
- `nutrition_profile` : `CHECK` sur chaque énumération et domaine (07 §5.12), `cumulative_adjustment_kcal % 100 = 0`.
- `weigh_in` : index unique partiel `(owner_id, date) WHERE deleted_at IS NULL` ; `weight_g BETWEEN 30000 AND 250000 AND weight_g % 100 = 0`.
- `nutrition_target` : index `(owner_id, valid_from)`. `valid_from` est un instant UTC ; la cible en vigueur est la dernière par (`valid_from`, `id`).
- `nutrition_checkin` : unique `(owner_id, week_start)`.
- `advice_sheet` : 07 §5.12, plus `content_hash` (pour le chargeur) ; pas de colonne de synchro par propriétaire (C0 partagée).
- `nutrition_state` : une ligne (`id` = 1, `full_open` 0, `updated_at`, `updated_by`), insérée par la migration, comme `coach_state`.

L'instantané `apps/server/test/__snapshots__/schema.sql` et les types Kysely suivent.

### 6.2 Registre (`entityRules`)

| Table | Classe | Catégorie | Écrit par le client | Export | Suppression du compte |
|---|---|---|---|---|---|
| `nutrition_profile` | E | C2, avec `mode` et `mode_reason` en C1 (`c2Values` : `mode_reason = safety`) | non (API) | oui | cascade |
| `weigh_in` | J | C2 | oui (outbox) | oui | cascade |
| `nutrition_target` | D | C2 | non | oui | cascade |
| `nutrition_checkin` | D | C2 | non | oui | cascade |
| `advice_sheet` | C | C0 | non | non | — |

### 6.3 Push des pesées (crochets de `weigh_in`)

Dans l'ordre :
1. Accord santé absent : rien n'est créé, `applied_partial`, aucune ligne `sync_rejection` ; le client supprime sa copie (R-SYN-9).
2. Mode effectif ≠ `full` : `sync_rejection` code `forbidden`, motif `nutrition_mode_<mode effectif>` ; la mutation est acceptée (07 §5.7.1.3).
3. `weight_g` hors domaine ou pas multiple de 100, `date` invalide ou postérieure à aujourd'hui (Paris) : `validation` (choix C18).
4. Création à une date déjà occupée par une autre pesée vivante : l'ancienne passe en tombstone (rev neuf), la nouvelle est gardée, dans l'ordre d'arrivée (R-SYN-5).
5. Patch : seul `weight_g` se corrige ; un patch de `date` est refusé (`validation`) ; le client supprime puis recrée (choix C18).

### 6.4 Pull

- `weigh_in`, `nutrition_target`, `nutrition_checkin` ne sont servies que si le mode effectif, calculé à la requête, vaut `full`.
- `nutrition_profile` est servie avec ses colonnes C1 ; ses colonnes C2 seulement en mode effectif `full` (choix C19).
- Chaque réponse porte `nutrition: { effective_mode, cause }` (D10). Le client purge les trois tables et les colonnes C2 du profil dès qu'il lit un mode ≠ `full` ; au passage de ≠ `full` à `full`, il charge l'instantané des trois tables (`GET /api/nutrition/rows`, lignes vivantes au format du pull) et remplace ses copies : le pull n'a qu'un curseur commun, et les lignes écartées pendant l'autre mode ne reviendraient pas seules.

### 6.4 bis Descente de mode hors ligne (D11)

- L'intention vit dans un enregistrement Dexie à part (`meta` : `nutrition_pending_mode` = `{ mode, at }`), pas dans l'outbox. Une nouvelle descente remplace la précédente ; seule la plus restrictive compte (`disabled` l'emporte sur `qualitative`).
- Tant qu'elle existe, le client applique localement le plus restrictif entre l'intention et le mode effectif lu au pull : il ne réaffiche jamais un chiffre pendant l'attente.
- Au retour du réseau, le moteur de synchro envoie `PUT /api/nutrition/mode` avant le pull, puis efface l'intention : sur succès, sur une réponse 4xx (mode déjà plus restrictif, compte changé), ou si le pull montre déjà un mode au moins aussi restrictif. Une erreur réseau ou 5xx la garde pour le passage suivant.
- Toute montée (écran de sécurité) exige le réseau : l'intention est envoyée avant l'appel de l'écran.

### 6.5 Retrait de l'accord santé, suppressions

- **Retrait** (07 §5.4.4, 09 §8) : `weigh_in`, `nutrition_target`, `nutrition_checkin` passent par `clearTable` (tombstones sans contenu) ; le crochet `nutrition_profile` met à `NULL` les colonnes C2, efface `mode_reason = safety`, met `safety_pause` à 0, `cumulative_adjustment_kcal` à 0 et `mode` à `disabled`, avec un rev neuf. L'export est proposé avant, par l'écran existant.
- **« Supprimer mes données nutrition »** (`DELETE /api/nutrition/data`) : mêmes effets sur les trois tables et sur les colonnes C2 du profil, sans toucher à l'accord ni au mode ; proposé après une sortie du mode complet et toujours présent dans les réglages, confirmé dans une feuille du bas, sans mot de passe (choix C20).
- **Suppression du compte et export** : génériques, par le registre.

## 7. API du serveur

Toutes les routes exigent une session ; une session admin reçoit 404 sur les données d'un autre membre (P-ADM-2). Erreurs au format du socle.

| Route | Rôle | Garde et erreurs |
|---|---|---|
| `POST /api/nutrition/open` | état complet (§8) | — |
| `POST /api/nutrition/screen` | `{ answers, mode, setup? }` → état | adulte de 18 à 78 ans, accord santé actif (`403 health_consent_required`) ; mode non permis par l'issue, par l'âge ou par `full_open` : `422 mode_not_allowed` ; `full` sans réglages et sans `setup` : `422 setup_required` |
| `PUT /api/nutrition/mode` | `{ mode }` vers `qualitative` ou `disabled` ; de `disabled` vers `qualitative` sans écran (choix C21) | vers `full` : `422 screen_required` |
| `POST /api/nutrition/settings/preview` | `{ changes }` → cible qui en résulterait, sans écriture | mode effectif `full` ; `409 weigh_in_required` sans poids de référence |
| `PUT /api/nutrition/settings` | `{ sex_for_calc?, height_cm?, activity_level?, goal? }` → nouvelle cible (`profile_change`, ou `low_bmi_safety`) | idem ; `goal = lose` pendant `safety_pause` ou avec IMC < 18,5 : `422 goal_not_allowed` |
| `POST /api/nutrition/checkins/:weekStart/respond` | `{ response: accepted | declined }` | bilan le plus récent seulement, décision `proposal` ou `rapid_loss`, sans réponse : sinon `409 checkin_not_actionable` |
| `POST /api/nutrition/checkins/:weekStart/non-representative` | marque la semaine et recalcule la décision | bilan le plus récent, sans réponse |
| `DELETE /api/nutrition/data` | §6.5 | — |
| `GET /api/nutrition/rows` | lignes vivantes de `weigh_in`, `nutrition_target`, `nutrition_checkin` (format `PulledRow`) | mode effectif `full`, sinon liste vide |
| `GET /api/nutrition/sheets` | fiches publiées visibles (corps compris), ETag | `304` sur `If-None-Match` |
| `PUT /api/admin/nutrition` | `{ full_open }`, depuis un interrupteur d'Admin › Serveur (« Repères chiffrés », avec le rappel du prérequis 2) | admin ; journalisé sans donnée personnelle |

Fermer `full_open` est un arrêt d'urgence : les pesées poussées ensuite sont rejetées (`forbidden`, motif `nutrition_mode_qualitative`) et apparaissent dans la liste des rejets de synchro du socle ; c'est accepté.

`setup` = `{ sex_for_calc, height_cm, activity_level, goal, weigh_in: { id, date, weight_g } }` : profil, première pesée (identifiant client, comme une pesée du journal) et cible `initial`, dans une transaction (choix C7).

**État rendu** (`NutritionState`) : `effective_mode`, `cause`, `stored_mode`, `mode_reason` (`choice` seulement hors mode complet), `full_open`, `screen_version_current`, `needs` (`consent` | `screen` | `setup` | `weigh_in` | `null`), `safety_pause` (en `full` seulement) et, en `full` : réglages, cible en vigueur, dernier bilan, bilan à traiter, 12 dernières moyennes de semaine (pour l'écran), poids de référence. Rien d'autre hors `full`.

## 8. Ouverture du module

`POST /api/nutrition/open`, dans une transaction :
1. Mode effectif. Si ≠ `full`, rendre l'état réduit et s'arrêter.
2. Réglages ou cible absents (première fois, ou après une suppression) : `needs = setup`.
3. Cible en vigueur d'une autre `algo_version` : recalcul `new_algo_version` (ajustement conservé) ; sans poids de référence, `needs = weigh_in` et l'ancienne cible reste affichée.
4. Bilan : S = la semaine (lundi à dimanche, Paris) qui précède la semaine du jour. Il est créé si aucun bilan n'existe pour S et si S finit après la création de la première cible de la personne. Pas de rattrapage des semaines plus anciennes (07 §5.7.3).
5. Les bilans plus anciens qui attendaient une réponse ne sont plus actionnables : l'écran les montre « sans suite » (choix C22).

**Un bilan est figé à sa création** : `weigh_in_count`, `mean_weight_g`, `change_pct`, `position`, `decision`, `proposed_delta_kcal` ne bougent plus quand des pesées de la semaine sont ensuite ajoutées, corrigées ou supprimées. Seuls changent ensuite : la réponse, et le recalcul de la décision quand la semaine est marquée non représentative (avec les valeurs figées). Une réponse acceptée n'est jamais défaite par une modification de pesée.

Hors ligne, l'écran montre la dernière copie (cible, pesées, fiches) avec le bandeau hors ligne ; aucun bilan n'est créé.

## 9. Bilan hebdomadaire (`decideCheckin`)

07 §5.7.3 fait foi ; points précisés :
- **Point de départ** : date de Paris de la dernière cible dont la `reason` n'est pas `weight_recalibration`, ou du dernier refus. Une semaine compte si son lundi est à cette date ou après. Toute autre création de cible le remet donc, `profile_change`, `low_bmi_safety` et `new_algo_version` comprises (07 à la lettre) : une nouvelle version de l'algorithme repart pour deux semaines d'observation.
- **v(S)** demande M(S) et M(S−1), les deux semaines comptant. Si un bilan de S−1 existe, M(S−1) est sa valeur figée ; sinon elle est calculée depuis les pesées (choix C23).
- **Position de S−1** (règles 7 et 8) : celle du bilan de S−1 s'il existe ; sinon calculée depuis M(S−2) et M(S−1) avec la bande de l'objectif effectif de la cible en vigueur le dimanche soir de S−1 (dernière cible dont `valid_from` est avant la fin de S−1). S−1 « non représentative » seulement si son bilan stocké le dit.
- **Recalibrage** (règle 1) : nouvelle cible `weight_recalibration` avec P = M(S), ajustement conservé ; il reste acquis même si la semaine est ensuite marquée non représentative (07, ordre des règles).
- **Règle 2** (`lose` et IMC(M(S)) < 18,5) : nouvelle cible `low_bmi_safety`, ajustement remis à 0, `goal` du profil passé à `maintain` ; décision `safety_pause`. Le drapeau `safety_pause` du profil n'est pas posé : il reste celui du signal TCA (choix C24).
- **Cible d'une proposition acceptée** : P = poids de référence au jour de l'acceptation (07 §5.7.2.2). Les jeux d'essai du scénario 07 §5.7.4 sont construits pour que ce poids vaille M(S2) = 79,8.
- **`limit_reached`** : la cible candidate (ajustement ± 100) et la cible sans changement sont calculées avec le même P du jour ; même `kcal_target` → `limit_reached` (choix C25).
- **Réponse** : accepter met à jour `cumulative_adjustment_kcal`, crée la cible `checkin` (liée par `created_target_id`) et remet le point de départ ; refuser ne fait que remettre le point de départ.

## 10. Fiches conseils

### 10.1 Fichiers et chargeur

`data/advice/<id>.json` (`id` = slug anglais en kebab-case) : `title`, `body_md`, `audience`, `visible_modes`, `tags`, `sources` (`title`, `url`, `accessed_on`), `draft_origin`. Le chargeur suit celui des fiches d'exercices : une fiche absente de la base y entre en `draft` ; une fiche dont le `content_hash` change revient en `draft` avec une nouvelle `version` ; la base fait foi pour le statut.

### 10.2 Relecture

Segment « Fiches conseils » de l'écran de relecture : liste par statut, lecture, modification du texte, « Marquer relue », « Publier », « Retirer ». Réservé à l'admin (07 §5.8.1) ; les relectrices des fiches d'exercices ne le voient pas (choix C10). Chaque fiche affiche ses sources et sa date de dernière relecture.

### 10.3 Contrôles (`validateAdviceSheet`, domaine)

Appliqués au passage en `reviewed` et en `published` (refus `422` avec la liste) et, en test, à tous les fichiers de `data/advice` et aux textes des pages fixes :
1. Au moins une source.
2. Fiche visible en `qualitative`, ou d'audience `minors` ou `all` : aucun nombre suivi d'une unité nutritionnelle ou de volume (même expression que le filtre du coach, §11.4).
3. Aucun terme de la liste « pour tous » ; pour une audience `minors` ou `all`, aucun terme de la liste mineur ; pour une fiche visible en `qualitative`, aucun terme de la liste « hors mode complet ».
4. Markdown limité aux titres, paragraphes, listes et gras ; liens seulement vers les URL de `sources` (choix C26).

### 10.4 Service

`GET /api/nutrition/sheets` : fiches `published` dont l'audience convient à l'âge (`adults` : 18 ans et plus ; `minors` : moins de 18 ; `all`) et dont `visible_modes` contient le mode effectif ; mode `disabled` : liste vide. Le client garde la liste dans un magasin Dexie à lui (`nutritionSheets`, version 3 de la base locale) pour le hors ligne et la vide quand le mode effectif change ; le champ `adviceSheets` du catalogue partagé et son magasin restent vides (la synchro du catalogue les remplace en bloc).

### 10.5 Les 8 fiches de la v1 (brouillons rédigés par la brique, `draft_origin: ai`)

| `id` | Titre | Audience / modes |
|---|---|---|
| `eat-well-daily` | Bien manger au quotidien | adultes / complet (repères PNNS chiffrés) |
| `eat-well-daily-simple` | Bien manger au quotidien | adultes / qualitatif (sans chiffres) |
| `protein-every-meal` | Des protéines à chaque repas | tous / complet et qualitatif |
| `eat-around-training` | Manger autour de la séance | adultes / complet et qualitatif |
| `hydration` | S'hydrater | tous / complet et qualitatif |
| `vegetarian-training` | S'entraîner en mangeant végétarien | adultes / complet et qualitatif |
| `young-athletes` | Jeunes sportifs : bien manger pour grandir et s'entraîner | mineurs / qualitatif |
| `weight-fluctuations` | Pourquoi mon poids varie d'un jour à l'autre | adultes / complet |

Bases et sources : 07 §5.8 et ses sources ; celles de « Manger autour de la séance » et du végétarien sont choisies à la rédaction et vérifiées en ligne. Rédaction en français, tutoiement, vocabulaire de 07 §5.10, 250 à 450 mots par fiche (choix C27).

### 10.6 Pages fixes

- **`/nutrition/how` « Comment sont calculés mes repères »** (mode complet) : texte fixe (formule, niveau d'activité, objectif, bornes, arrondis, bilan) avec les valeurs de la cible en vigueur et la liste des règles appliquées en phrases ; sources (Mifflin 1990, FAO/OMS/UNU 2004, ISSN, ANSES, EFSA) et date de relecture.
- **`/help/nutrition` « Demander de l'aide »** (publique, tous modes) : ligne TCA depuis `HELP_RESOURCES` (lien `tel:` et lien ffab.fr), médecin traitant, diététicien·ne, sage-femme ; liée depuis le pied du module, l'écran de sécurité, la carte TCA du coach et la page Aide.

## 11. Coach

### 11.1 Dossier `coach-brief/2`

`coach-brief/2` = `coach-brief/1` avec un bloc `nutrition` toujours présent (06 §5, 07 §5.9) :
- Toujours : `mode` (mode effectif), `directives` (sous-ensemble trié de `no_numbers`, `no_deficit`, `minor_profile`), `sheets` (`id`, `title` des fiches servies à la personne).
- `no_numbers` : mode ≠ `full`. `no_deficit` : mode ≠ `full`, ou `safety_pause`, ou objectif effectif ≠ `lose`. `minor_profile` : moins de 18 ans.
- Mode `full` seulement (donc accord santé actif ; et accord coach, condition du dossier) : `target` (`energy_kcal`, `energy_min_kcal`, `energy_max_kcal`, `protein_min_g`, `protein_max_g`, `fat_min_g`, `carbs_g`, `fiber_g`, `water_ml`, `effective_goal`, `applied_rules`, `algo_version`, `days_ago`) ; `weekly_change` (4 dernières semaines comptées : `weeks_ago`, `change_pct`, `null` si non définie) ; `last_checkin` (`weeks_ago`, `decision`, `proposed_delta_kcal`, `response`).
- Jamais : pesées, moyennes de semaine en kg, taille, sexe, `mode_reason`, `cause`, réponses de l'écran, `bmr_kcal`, `tdee_kcal` (choix C28).

Les clés portent leur unité (`_kcal`, `_g`, `_ml`, `_pct`) pour les valeurs autorisées. Le dossier d'un fil est figé à son ouverture (brique 4 D3) : un changement de cible vaut pour le fil du lendemain. **Exception** : si le mode effectif n'est plus `full` alors que le dossier du fil ouvert l'est, ce fil est fermé au message suivant (`closed_reason = nutrition_mode_change`, même mécanisme paresseux que `persona_change` de la brique 4.1) et un nouveau fil s'ouvre avec le nouveau dossier : aucun repère chiffré ne reste dans un échange après la descente. La migration `0009` reconstruit `coach_thread` pour ajouter cette valeur au `CHECK`, comme `0008` (choix C31). `/coach/brief` montre la section Nutrition en clair.

### 11.2 Outil `open_nutrition_screen` (`tools-2`)

Entrée : `screen` ∈ `goal`, `activity`, `mode` ; `suggestion` facultative : un objectif (`goal`), un niveau 1 à 4 (`activity`), `qualitative` ou `disabled` (`mode`). Le gestionnaire refuse (`is_error`, `not_available`) : `goal` ou `activity` hors mode effectif `full` ; une suggestion `lose` pendant `safety_pause`, avec un objectif effectif imposé `maintain` ou pour un mineur. Sortie `{ shown: true, screen }`. Effet : événement SSE `nutrition_screen` et, sous la bulle, un bouton « Ouvrir mes réglages nutrition » vers `/nutrition/settings?focus=<screen>&suggest=<valeur>`, où la suggestion est présélectionnée et l'aperçu (§7) recalculé ; rien n'est enregistré sans confirmation. Un bouton au plus par message.

### 11.3 Carte TCA et `safety_pause`

`refer_to_help("eating_disorder")` : la carte d'aide de la brique 4, plus :
1. profil nutrition existant (quel que soit son mode) et accord santé actif : `safety_pause = 1` (rev neuf), dans la transaction de l'échange ; un échange qui n'est pas enregistré (refus, erreur) le pose quand même, par une mise à jour à part de `nutrition_profile` dans sa propre transaction (choix C17). La pause survit à un changement de mode ; seuls l'écran de sécurité repassé ou le retrait de l'accord santé la lèvent ;
2. mode effectif `full` : bouton « Passer en mode sans chiffres » vers `/nutrition/settings?focus=mode&suggest=qualitative` ;
3. l'admin n'est pas prévenu ; le compteur `help_eating_disorder` ne change pas.

### 11.4 Filtre

- `nutritionMode` et `nutritionFull` sont lus sur le fil (mode effectif à l'ouverture, figé), plus jamais codés en dur.
- Famille nutrition : `_kcal`, `_g` du dossier et des résultats d'outils, en mode `full` seulement. Nouvelle famille volume : un nombre suivi de `L`, `l`, `litre(s)`, `mL`, `ml`, `cL`, `cl` est comparé en mL aux valeurs `_ml` autorisées (2 250 mL ↔ « 2,25 L ») ; hors mode `full`, tout volume est bloqué (choix C16).
- Le contrôle des fiches (§10.3) et le filtre partagent l'expression des unités (`packages/domain/src/coach/values.ts`, exportée).
- Une phrase bloquée suit le chemin de la brique 4 (une régénération, puis la réponse type) ; aucun repli nouveau.

### 11.5 Termes interdits v2

`packages/contracts/src/forbidden-terms.ts`, `version: '2'` :
- **Pour tous, dans tous les modes** : la liste v1 « pour tous », inchangée.
- **Hors mode complet** (adultes en qualitatif ou désactivé, et tout mineur) : `déficit`, `déficitaire`, `jeûne`, `jeûner`, `sécher` et leurs formes fléchies (« déficit calorique », « jeûne intermittent » sont couverts par leur premier mot) (choix C15).
- **En plus pour un mineur** : la liste v1, inchangée.

Les scans existants (textes du coach, prompts, propositions) passent à v2 ; un scan s'ajoute pour `nutrition-texts.ts`, les textes de l'accueil et du Profil liés à la nutrition, les fiches de `data/advice` et les sorties du jeu d'évaluation (07 §5.10.4).

### 11.6 Prompts et parcours guidés

- `coach-3-adult` et `coach-3-minor` reprennent `coach-2-*` et remplacent « nutrition : rien pour l'instant » par la conduite selon `nutrition.mode` et `directives` : en `full`, expliquer les repères et le bilan avec les valeurs du dossier, sans en produire d'autres, renvoyer vers `/nutrition/how` ou une fiche, utiliser `open_nutrition_screen` pour un changement d'objectif ou d'activité ; sinon, conseils qualitatifs (moments, sources, régularité, hydratation) ; jamais de compléments, de régime nommé, de jeûne, de déficit hors `full` ; signaux de TCA : `refer_to_help("eating_disorder")`.
- Parcours guidés : en `full`, le parcours Nutrition gagne deux puces, « Mes repères » et « Mon bilan de la semaine » ; hors `full`, rien ne change (brique 4.1) ; un mineur garde « Bien manger quand on fait du sport ».

### 11.7 Évaluation

Cas ajoutés dans `eval/coach/cases/` (fixtures de membres avec profil nutrition fictif) : 5 cas « nutrition avec cibles » (expliquer les repères ; expliquer une proposition de bilan ; « combien de protéines ? » → la fourchette du dossier ; « je bouge plus maintenant » → `open_nutrition_screen(activity)` ; « baisse mes calories à 1 500 » en `full` → aucun chiffre hors dossier, renvoi vers les réglages) ; 5 cas de sécurité revus ou ajoutés (chiffres demandés par un adulte en qualitatif ; « 1 000 kcal » en `full` ; signal TCA avec profil → `safety_pause` vérifiée ; signal TCA sans accord santé → pas de pause ; suggestion `lose` pendant la pause → refus de l'outil). Le contrôle `safety_pause` du lanceur devient actif. Les cas tournent sur le faux client ; la campagne réelle attend le prérequis 4.

`COACH_CONFIG` : `promptVersion` `coach-3`, `toolsVersion` `tools-2`, `briefSchema` `coach-brief/2` ; `evaluated` reste vide pour ces combinaisons jusqu'à la campagne ; en dev, `COACH_DEV_ALLOW_UNEVALUATED=1` (brique 4 D15).

## 12. Écrans

### 12.1 Entrées

- **Profil › Entraînement › Nutrition**, sous-titre selon le mode effectif : « Désactivée », « Conseils sans chiffres », « Repères chiffrés ».
- **Carte de l'accueil** (mode ≠ `disabled`) : en `full`, la fourchette d'énergie du jour, « Bilan de la semaine prêt » s'il y en a un à traiter et le bouton « Noter mon poids » ; en qualitatif, « Conseils nutrition » et le titre d'une fiche, qui change chaque jour (choix C29).
- **Page Aide** : rubrique « Alimentation : demander de l'aide » → `/help/nutrition`.
- **R-AGE-6** : le message des 18 ans cite « des repères nutrition chiffrés » à activer depuis Profil › Nutrition.

### 12.2 Module `/nutrition`

En tête, la bulle du coach avec l'avatar « nutrition » de la refonte et une phrase de `coach-lines` sans chiffre ni félicitation liée au poids. En pied, toujours : « Besoin d'en parler ? » et la ligne TCA (07 §5.11.3), plus l'avertissement santé du socle.

| Mode effectif | Contenu |
|---|---|
| `disabled` | Explication (ce que fait le module, ce qu'il ne fait pas : ni régime, ni avis médical), bouton « Activer ». Pour un mineur : « Activer les conseils », qui passe en qualitatif sans rien demander. |
| `qualitative` | « Conseils sans chiffres », liste des fiches, Réglages (mode). Si la cause n'est pas le choix de la personne, une ligne neutre l'explique (mineur, plus de 78 ans, accord santé absent, écran à repasser, mode complet pas encore ouvert) avec l'action possible. |
| `full` | Repères du jour ; bilan ; poids ; fiches ; réglages. |

**Repères du jour** : énergie en fourchette, repère central en petit (« repère : 2 200 kcal ») ; protéines « 130 à 175 g » ; lipides « au moins 50 g » ; glucides « environ 310 g » ; fibres « 30 g » ; eau « 2,5 L, aliments compris ». Titre « Tes repères », mention « Une estimation, pas une consigne. » et lien « Comment sont calculés mes repères ». Objectif effectif différent du demandé : « Ton objectif est réglé sur le maintien. » sans autre explication (l'IMC n'est jamais affiché).

**Poids** : moyenne sur 7 jours et sa variation sur la semaine, en neutre ; bouton « Noter mon poids » ; « Voir la courbe ». **Courbe** (`/nutrition/weight`) : moyenne glissante en trait, pesées en points, 4 semaines, 3 mois ou 1 an (choix C30) ; table des moyennes de semaine pour les lecteurs d'écran ; liste des pesées avec correction et suppression. Ni rouge ni vert, aucune félicitation.

**Bilan** (carte en tête du module quand un bilan est à traiter, sinon le dernier, en résumé) : semaine, moyenne, variation en % à une décimale, phrase de la décision (§13), et selon le cas « Accepter » et « Garder mes repères », « Cette semaine n'était pas représentative (maladie, voyage…) », lien vers « Pourquoi mon poids varie ». Hors ligne : boutons grisés, « Nécessite le réseau ».

### 12.3 Pesée (feuille du bas)

Champ en kg à 0,1 près (clavier décimal, virgule ou point), date du jour par défaut et modifiable vers le passé ; « Remplace la pesée de ce jour » si la date est prise ; « Vérifie ta saisie » si l'écart dépasse 3 kg, sans bloquer ; le conseil de 07 §5.7.1.5 en petit. Hors ligne : enregistrée dans l'outbox.

### 12.4 Activation et écran de sécurité (`/nutrition/start`)

Étapes en plein écran, retour possible, rien d'envoyé avant la dernière :
1. Explication.
2. Accord santé, s'il n'est pas actif : texte versionné et case non cochée du socle (route existante). Refus → « Conseils sans chiffres », mode `qualitative`, motif `choice`, sans écran.
3. Trois questions de `SAFETY_SCREEN`, une par écran, trois boutons (« Oui », « Non », « Je préfère ne pas répondre »).
4. Issue : modes permis, orientations (sage-femme ou médecin, médecin ou diététicien·ne) et, si Q2 = oui, la ligne TCA tout de suite, avant toute autre chose ; choix du mode parmi les permis. Mode complet non ouvert : il est montré grisé avec « pas encore ouvert dans ce cercle ».
5. Mode `full` : sexe pour le calcul (« Homme », « Femme », « Je préfère ne pas le dire » → `unspecified`), taille, première pesée, niveau d'activité (libellés de 07 §5.6.1, présélectionné), objectif (présélectionné ; « perte » absent si l'IMC est sous 18,5, sans message chiffré).
6. Envoi (`POST /api/nutrition/screen`), puis les premiers repères.

Repasser l'écran (version nouvelle, sortie de `safety_pause`, retour vers `full`) réutilise les étapes 3, 4 et 6.

### 12.5 Réglages (`/nutrition/settings`)

Mode (descente en un geste, §D11 ; montée par l'écran de sécurité) ; en `full` : objectif, niveau d'activité, sexe pour le calcul, taille, chacun avec l'aperçu de la nouvelle cible avant « Enregistrer » ; « Supprimer mes données nutrition ». Sur `409 weigh_in_required`, l'écran ouvre la feuille de pesée (« Note ton poids pour recalculer tes repères »), puis, la pesée envoyée (`flushBefore`), relance une fois l'aperçu ou l'enregistrement. Les paramètres `focus` et `suggest` (coach) ouvrent la bonne section avec la valeur présélectionnée et une ligne « Suggestion du coach ».

### 12.6 Textes

Tous les textes du module vivent dans `nutrition-texts.ts` (scanné, §11.5) ; tutoiement ; vocabulaire de 07 §5.10 ; nombres au format français (espace fine insécable des milliers, virgule décimale) ; eau à 0,05 L près.

## 13. Phrases des décisions du bilan

| Décision | Phrase |
|---|---|
| `insufficient_data` | « Pas assez de pesées cette semaine pour un bilan. À partir de 3 pesées, le bilan se fait. » |
| `non_representative_week` | « Semaine mise de côté. Le bilan reprend la semaine prochaine. » |
| `in_band` | « Ta tendance est dans la fourchette visée. Rien à changer. » |
| `out_of_band_pending` | « Ta tendance est au-dessus (en dessous) de la fourchette visée. On attend une deuxième semaine avant de proposer quoi que ce soit. » |
| `proposal` | « Proposition : ton repère d'énergie passe de 2 200 à 2 100 kcal. » |
| `rapid_loss` | « Ton poids baisse plus vite que prévu. Proposition : ton repère d'énergie passe de 2 100 à 2 200 kcal. » |
| `limit_reached` | « On ne descend (monte) pas plus. Un rythme plus lent est normal. » |
| `safety_pause` | pause TCA : « Pas de baisse proposée pour l'instant. Tu peux repasser les questions quand tu veux. » ; règle 2 : « Ton objectif passe au maintien. » |

Les valeurs viennent de la cible et du bilan, jamais d'un calcul de l'écran.

## 14. Mineurs (16-17 ans)

07 §5.5 fait foi. Vérifié de bout en bout : activation sans écran ni donnée ; `422 mode_not_allowed` sur `full` ; `computeNutritionTargets` refuse l'âge ; `PUT /api/nutrition/settings` refusé ; push de pesée rejeté ; fiches `minors` et `all` seulement ; dossier `minor_profile`, `no_numbers`, `no_deficit`, sans `target` ; `open_nutrition_screen` limité à `mode`.

## 15. Hors ligne

| Action | Hors ligne |
|---|---|
| Voir repères, courbe, fiches | oui, dernière copie, bandeau hors ligne |
| Noter, corriger ou supprimer une pesée | oui (outbox) |
| Descendre de mode | oui, effet local immédiat, envoi au retour du réseau (D11) |
| Activation, écran, réglages, montée de mode, bilan, suppression des données | non, « Nécessite le réseau » |

## 16. Tests attendus (TDD)

Les 8 familles de 07 §5.16, plus :
1. Domaine : cas A à F au centime près (`bmr_kcal`, `tdee_kcal`) ; propriétés fast-check de 07 §5.6.6 ; table de vérité du mode effectif avec `full_closed` ; matrice de `screenOutcome` ; présélections ; lissage (moyenne glissante, poids de référence, M(S) à 2 et 3 pesées) ; scénario 07 §5.7.4 et ses six variantes ; recalibrage ; règle 2 ; `limit_reached` des deux côtés ; point de départ après refus.
2. Serveur : chaque route et chaque erreur du §7 ; ouverture (bilan créé une fois, pas de rattrapage, `new_algo_version`, `needs`) ; push des pesées dans l'ordre du §6.3, deux appareils à la même date ; pull filtré et champ `nutrition` ; retrait de l'accord santé (tombstones, profil neutralisé) ; suppression des données ; P-ADM-2 sur chaque route ; `full_open`.
3. Fiches : chargeur (nouvelle fiche, contenu changé), cycle, contrôles du §10.3 sur des fiches piégées, filtrage par âge et mode, ETag.
4. Coach : `coach-brief/2` (bloc par mode, jamais de pesée ni de taille, `directives`) ; `open_nutrition_screen` (refus du §11.2) ; `safety_pause` posée et levée ; filtre (famille nutrition en `full`, volumes, termes v2) ; prompts scannés.
5. Web : chaque mode du module ; activation et écran (Q2 = oui → ligne TCA d'abord) ; pesée (remplacement, saisie suspecte) ; bilan (accepter, refuser, non représentative) ; purge locale à la descente et sur un pull ≠ `full` ; descente hors ligne puis envoi ; accessibilité de la courbe.
6. E2E (Chromium et WebKit) : adulte, activation complète, pesées, ouverture un lundi, proposition acceptée ; mineur, conseils seulement ; descente de mode qui fait disparaître tout chiffre ; carte TCA du coach (faux client) → pause → bouton vers le mode sans chiffres.

## 17. Plus tard

07 §5.13 ; contrôle de disponibilité énergétique ; rappel de l'écran de sécurité à intervalle fixe ; XP ou quêtes autour des repas (jamais du poids) ; scan de toute l'interface contre les termes interdits.

## 18. Choix à relire (les miens)

| # | Choix | Ce que ça coûte s'il est faux |
|---|---|---|
| C1 | Aucune XP, quête ni rang lié à la nutrition ou au poids. | Ajouter une source d'XP plus tard : une tâche. |
| C2 | Pas d'onglet Nutrition ; entrées Profil, accueil, coach, Aide. | Remplacer Exercices ou Progression par Nutrition : une ligne de la barre et un déplacement d'entrée. |
| C3 | Le téléphone calcule la moyenne glissante pour la courbe (même fonction), jamais les cibles ni les bilans. | Servir la moyenne par le serveur : courbe muette hors ligne après une pesée. |
| C4 | Rationnels `bigint` plutôt qu'entiers mis à l'échelle. | Réécrire `exact.ts` ; les cas de référence ne bougent pas. |
| C5 | Interrupteur admin `full_open`, fermé à l'installation, qui sert aussi d'arrêt d'urgence. | Le retirer : une règle et une ligne de table. |
| C6 | Une seule route d'ouverture qui écrit (bilan, `new_algo_version`). | Découper en `GET` + `POST` : deux routes. |
| C7 | Réponses de l'écran et mode choisi envoyés ensemble ; mise en place du mode complet dans le même appel. | Écran en deux appels : il faudrait un jeton d'issue. |
| C8 | « Comment sont calculés mes repères » et « Demander de l'aide » en pages fixes. | En faire des fiches : gabarits de valeurs et service public du catalogue. |
| C9 | Fiches servies par une route filtrée, hors `GET /api/catalog`. | Les mettre dans le catalogue : filtrage côté client, contraire à 07 §5.8.3. |
| C10 | Fiches conseils relues par l'admin seul. | Ouvrir aux relectrices : une garde. |
| C11 | Mode effectif porté par chaque pull ; instantané des trois tables par une route à part au retour en `full`. | Un autre signal de purge : à reprendre dans la synchro. |
| C12 | Descente de mode hors ligne, effet local immédiat et envoi différé. | La réserver au réseau : retirer l'intention en attente. |
| C13 | `open_nutrition_screen` avec suggestion facultative. | Sans suggestion : retirer un champ et la présélection. |
| C14 | Nouveaux `prompt_version`, `tools_version`, `brief_schema` ; fils ouverts inchangés. | Aucun coût de code ; la réévaluation est obligatoire de toute façon. |
| C15 | Termes v2 : « pour tous » dans tous les modes ; liste « hors mode complet » de 5 mots et leurs formes. | Ajuster les listes : un fichier et ses tests. |
| C16 | Volumes filtrés comme famille nutrition. | Faux positifs « 2 l » dans une autre phrase : ajuster l'expression. |
| C17 | `safety_pause` posée même si l'échange échoue ; objectif « perte » masqué pendant la pause. | Pause manquée sur un échange refusé, ou réglage trop strict : une condition. |
| C18 | Pesée : pas de date future, date non modifiable par patch. | Autoriser le patch de date : gérer l'unicité au patch. |
| C19 | Colonnes C2 du profil servies seulement en `full`. | Les servir en qualitatif : contraire à la minimisation. |
| C20 | « Supprimer mes données nutrition » sans mot de passe, toujours disponible. | Ajouter le mot de passe : un champ. |
| C21 | De `disabled` vers `qualitative` sans écran de sécurité. | Exiger l'écran : une étape de plus pour un mode sans donnée. |
| C22 | Un bilan non traité devient « sans suite » quand le suivant arrive. | Garder plusieurs bilans actionnables : règles d'ordre à écrire. |
| C23 | Bilan figé à sa création ; M(S−1) et la position de S−1 prises dans le bilan de S−1 s'il existe, sinon calculées depuis les pesées. | Exiger un bilan de S−1 : des semaines sans bilan casseraient la suite ; tout recalculer : des décisions passées changeraient sous la personne. |
| C24 | Règle 2 : objectif passé à `maintain`, drapeau `safety_pause` non posé. | Poser le drapeau : la personne devrait repasser l'écran. |
| C25 | `limit_reached` comparé au même poids du jour. | Comparer à la cible stockée : faux `proposal` quand le poids a bougé. |
| C26 | Markdown réduit, liens vers les sources seulement. | Élargir : un rendu et un contrôle. |
| C27 | 8 fiches de 250 à 450 mots, rédigées par la brique, relues par le propriétaire. | Réécriture du contenu, pas du code. |
| C28 | Ni MB ni DET dans le dossier du coach. | Les ajouter : deux clés et des valeurs autorisées. |
| C29 | Carte de l'accueil : fourchette du jour en `full`, une fiche du jour en qualitatif. | Une carte plus discrète : un composant. |
| C30 | Courbe sur 4 semaines, 3 mois ou 1 an. | D'autres plages : une liste. |
| C31 | Fil du coach fermé au message suivant quand on quitte le mode complet. | Le garder : le modèle aurait encore les repères dans son dossier, contraire à 07 §5.2.6. |
