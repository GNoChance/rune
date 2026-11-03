# Brique 3 · Programmes et séances : spec de conception

> **Statut :** version 2 du 2026-11-01, rédigée par Claude sans séance de cadrage, à la demande du propriétaire (« ok continue »), puis relue par un relecteur « constructeur » (10 questions, toutes tranchées ici). Les choix qu'aucune spec ne tranchait sont listés au §13 pour la relecture du propriétaire.
> **Base :** la section [05-programmes](2026-10-06-appsport-design/05-programmes.md) de la spec principale reste l'autorité pour tout ce que ce document ne remplace pas explicitement : principes, modèles, primitives, évaluation, allègement, choix de l'exercice, arrondi, douleur, profil prudent, `InstanceChange`. Le [modèle de données consolidé](2026-10-06-appsport-design/09-modele-de-donnees.md) (§3) fait foi pour les types, sauf les ajouts du §5. La [synchro](2026-10-06-appsport-design/01-architecture.md) (§5) s'applique telle quelle aux nouvelles tables.
> **Écrans :** ils suivent la [spec de la refonte](2026-10-13-refonte-rune-design.md) (jetons, 5 thèmes, boîte à outils, feuilles du bas, mouvement, voix du Système) et réutilisent les composants de la [brique 2](2026-10-14-brique-2-exercices-design.md) (fiche, `SheetContent`, `CatalogMissing`).

## 1. But

Remplacer le carnet à chaque séance. Un membre ouvre Rune à la salle ou chez lui, sans réseau s'il le faut, voit sa séance du jour avec des charges qui ont un sens, la fait en quelques taps par série, et sait en sortant ce qui l'attend la prochaine fois et pourquoi. Progression montre enfin de vrais rangs.

Réussi = critères 1 et 3 de la spec principale (§1) : chaque proche saisit ses séances dans Rune, y compris hors ligne, sans perte ni doublon ; la progression est proposée automatiquement et s'explique en une phrase.

**Hors brique 3 :** coach IA (brique 4 ; la brique 3 lui prépare `InstanceChange`), pesées et nutrition (brique 5), et la liste « Plus tard » du §12.

## 2. Décisions et remplacements

| # | Sujet | Décision | Remplace ou précise |
|---|---|---|---|
| D1 | Navigation | Bouton central **Séance** dans la barre : **Accueil · Exercices · Séance · Progression · Profil**. Sur PC, « Séance » est une entrée de la navigation latérale, juste sous Accueil. | Refonte §5 (« un bouton central s'ajoute ») ; brique 2 D5 renvoyait le bouton à cette spec. La place de Nutrition reste à trancher par la brique 5. |
| D2 | Plan figé | À « Commencer », le téléphone crée la séance, ses exercices et **toutes les séries prévues** avec leurs cibles (`target_*`). Une série est **faite** quand `logged_at` est renseigné ; les séries jamais faites sont supprimées logiquement à la fin de la séance. | Précise R-SYN-8 et 09 §3 (`performed_set.logged_at` devient nullable). |
| D3 | Profil de la séance | Nouvelle colonne `workout_session.profile` (`adult` \| `cautious`), écrite à la création. Le serveur la passe à `cautious` s'il calcule un profil prudent ; il ne la baisse jamais. Le rejeu lit cette colonne, jamais l'état courant du compte. | Ajout à 09 §3 ; rend déterministe le rejeu de 05 §6.4 quand le mode prudent change. |
| D4 | Statuts | « Terminer » donne `completed` s'il y a au moins une série de travail faite, sinon `abandoned`. « Supprimer la séance » est une suppression logique (R-SYN-6), comme si elle n'avait pas eu lieu. Seules les séances `completed` font avancer la rotation et la semaine de programme. | Précise 05 §4 (« séance abandonnée sans aucune série de travail »). |
| D5 | Programme effectif | `snapshot` est la copie du **fichier complet** du modèle au moment de l'inscription, jamais réécrite. Le programme effectif = `snapshot` + les `InstanceChange` acceptées, appliquées dans l'ordre de `decided_at` puis `id` (fonction pure). La disponibilité des fiches se calcule à chaque séance, si bien qu'une fiche publiée plus tard devient utilisable sans nouvelle inscription. | Précise 05 §6.1 et §6.3. |
| D6 | Rejeu et propositions | Le serveur rejoue l'instance entière (§4.4) dans la transaction du push, d'une acceptation de changement et d'une correction du pas de machine. Seul le serveur écrit les propositions et les suspensions du moteur, avec un identifiant déterministe. Le téléphone rejoue lui aussi, sur son miroir, pour préparer ses séances et afficher des cibles provisoires ; il n'écrit jamais de changement. | Précise R-SYN-19 et 05 §9, §10, §13.7. |
| D7 | Séance libre | Une séance libre (sans programme) n'a **aucune** `engine_decision`. La relation `performed_exercise` → `engine_decision` devient 0-1. Ses séries comptent pour l'historique, les records, l'XP et la suggestion de calibration (« dernière charge utilisée »). | Remplace « 1-1 » de 05 (modèle de données) et 09 §3. |
| D8 | XP et rangs | L'XP récompense **la régularité et la saisie, jamais la charge, l'échec ni un record**. Rang global par XP cumulée ; rang de chacun des 9 groupes (`MUSCLE_GROUPS`) par séries de travail cumulées. Tout se recalcule sur le téléphone à partir de l'historique ; rien n'est stocké (§8). | Refonte §9 : « le calcul réel arrive avec la brique 3 ». |
| D9 | Records | Calculés à partir de l'historique, jamais stockés. Le 1RM estimé n'est jamais affiché à un mineur. | Précise 05 §13.1. |
| D10 | Contenu | La brique 3 écrit les 6 modèles, en déduit le lot A définitif et ajuste les squelettes. La rédaction, la relecture et la publication restent le parcours du propriétaire et des relectrices (brique 2 §5). Le code de la brique 3 se termine et se teste avec du contenu de test ; **sa recette exige le lot A publié** (04 §7). | Précise brique 2 D11. |
| D11 | Quêtes | Les quêtes réelles ne sont pas dans la brique 3. La carte « Quêtes d'éveil » de l'accueil disparaît dès que ses 3 quêtes sont faites. | Refonte §2 (« quêtes réelles » renvoyées aux briques suivantes). |
| D12 | Séance oubliée | Une séance `in_progress` sans activité depuis 6 h est clôturée par l'appareil qui la tient, à l'ouverture suivante ; depuis 24 h, par n'importe quel appareil du compte. | Nouveau. |
| D13 | CSV des séries | Produit par le serveur, comme l'export JSON (réseau nécessaire, journalisé sans contenu). | Précise 03 §9 (« le CSV des séries relève de la brique 3 »). |
| D14 | Minuteur | Pas de notification push en v1. Le minuteur tient une heure de fin absolue ; un son court à la fin si l'appli est au premier plan ; écran gardé allumé pendant la séance (Wake Lock). Son et écran se règlent sur l'appareil. | Recherche UX §3 ; pas de serveur de push. |
| D15 | Inscription à l'onboarding | E8 montre le programme recommandé, avec une case « Commencer avec ce programme » cochée par défaut. | Précise 02 §8, E8. |
| D16 | Limitations | La brique 3 ne filtre ni ne signale les exercices selon les limitations déclarées (zones) ; le coach (brique 4) les lit. | Précise 04 §6 (« relève des briques 3 et 4 »). |
| D17 | Références des séances | `workout_session.instance_id` et `place_id` sans clé étrangère, pour qu'une séance renvoyée après une restauration ne soit jamais rejetée (§5.1). | 09 §3 (`REFERENCES program_instance`, `REFERENCES place`). |
| D18 | Changer de programme | `switch_template {templateId, daysPerWeek?}`, admis vers une version plus récente du même modèle. | 05 §15 (`switch_template {templateId}`). |
| D19 | Règles par version | Le moteur garde les constantes de chaque `RULES_VERSION` et évalue chaque séance avec les siennes, même lors d'un rejeu complet (§4.1). | Précise 05 §6.4. |

## 3. Contenu : les 6 modèles et le lot A

1. **Écriture des modèles.** Six fichiers `data/programs/<id>.json`, un par ligne du tableau de 05 §3, au format de 05 §4, avec les identifiants de 05 §3 (déjà utilisés par les fausses données de `recommendTemplate`). Les slugs viennent du lot A provisoire (`docs/catalog/lot-a-provisoire.md`). Règles d'écriture en plus du validateur :
   - modèle `gym` : le premier exercice de chaque slot est faisable avec `gym_reference` ; la liste descend ensuite vers les haltères, la machine, puis le poids du corps ;
   - modèles `home` et `sport` : un slot par groupe de couverture au moins dont un exercice est faisable avec `home_bodyweight` ; les slots à petit matériel (tirage à l'élastique, haltères) viennent en tête quand le matériel est coché ;
   - échauffement (`pctWorkLoad`) seulement sur les slots `main` à la barre ;
   - noms et descriptions en français, maison, sans nom déposé (05 §1.7).
2. **Validateur des modèles** (05 §5) dans `packages/domain/src/program/` ; il tourne dans `pnpm data:validate` (la CI) sur l'export du catalogue présent dans le dépôt, y compris les fiches `draft` : la règle 5 vérifie l'existence et le type de mouvement, pas le statut.
3. **Lot A définitif.** Une fois les modèles écrits, `docs/catalog/lot-a-provisoire.md` devient `lot-a.md` : fiches ajoutées ou retirées selon les slugs réellement utilisés et les membres de leurs chaînes, squelettes ajustés. Le propriétaire valide la liste (les ids sont immuables).
4. **Lot B** (04 §7, condition c) : le plan en tire la liste (`docs/catalog/lot-b.md`) et les squelettes au lot `B`, dont les fiches qui couvrent `back_extension_bench`, `dip_station`, `ez_bar`, `smith_machine` et `suspension_trainer`. Dès que ces squelettes existent, `data:validate --strict` passe et la CI l'exécute en mode strict. La rédaction et la publication du lot B suivent le même parcours que le lot A et doivent être finies avant la fin de la brique 3.
5. **Publication.** Rédaction par `pnpm exercises:draft` (clé API du propriétaire), relecture dans l'appli, feu vert santé, publication, export : c'est le parcours de la brique 2, hors du code de la brique 3.
6. **Disponibilité au chargement** (05 §5) : un modèle est `available` si chacun de ses slots a au moins un exercice publié (pour un slot `chain`, un membre publié). Le chargeur ne retire aucun slug des fichiers servis : c'est `isUsable` qui écarte les fiches non publiées à chaque séance (D5). `CatalogBundle.programTemplates` devient une liste de `{template, available}` ; un fichier qui ne passe pas `ProgramTemplateSchema` n'est pas servi et le chargeur l'écrit au journal technique (la CI l'aurait refusé avant).
7. **Contenu de test.** Les tests serveur passent leurs modèles par `DataDirSpec.templates` ; l'E2E ajoute à son dossier de contenu (`e2e/support/content.ts`) un modèle de test et les fiches publiées qu'il référence.

## 4. Moteur (`packages/domain/src/program/`)

### 4.1 Règles versionnées

Fichier `packages/domain/src/program/rules.ts` : `RULES_VERSION = '1'` et `RULES_BY_VERSION`, qui associe à chaque version publiée toutes les constantes chiffrées de 05 (échelle d'effort, `LIGHTEN_PCT`, seuils de stagnation et de reprise, bornes prudentes, plafonds de 05 §15) et de cette spec (§8, D12). Le moteur reste pur : la date, `profile` et les réglages lui sont passés (le test de pureté existant s'applique au nouveau dossier).

- **Pas de rejeu rétroactif** (05 §6.4) : chaque séance est évaluée avec les règles de **sa** `rules_version`, même lors d'un rejeu complet. Changer une valeur ajoute une entrée à `RULES_BY_VERSION` sans toucher aux précédentes ; un changement de logique se branche sur la version. Une migration explicite reste possible, par décision écrite.
- `engine_decision.rules_version` = celle de la séance évaluée ; `slot_state.rules_version` = celle de la dernière séance qui l'a modifié.
- Les nouvelles séances prennent la `RULES_VERSION` courante de l'appli qui les démarre.
- Les barèmes du §8 (XP, rangs) ne touchent pas au moteur : ils ont leur propre `PROGRESS_RULES_VERSION` et se recalculent toujours avec la version courante.

### 4.2 Fonctions

Toutes pures, testées une seule fois, appelées à l'identique par le téléphone et le serveur.

| Fonction | Rôle |
|---|---|
| `ProgramTemplateSchema` (contracts) | schéma Zod du fichier (05 §4) ; `CatalogBundle.programTemplates` passe de `unknown[]` à ce schéma |
| `validateTemplate(template, catalog)` | règles 1 à 8 de 05 §5, chaque erreur avec un code |
| `validateProgram(program, ctx)` | règles de cohérence, de couverture et de volume appliquées au programme effectif (acceptation d'un changement, 05 §15.3) |
| `effectiveProgram(snapshot, changes)` | D5 |
| `loadGrid(loadMode, settings, overrideStepG?)`, `roundDown`, `next`, `platesPerSide` | 05 §12 ; disques de la série standard 25 / 20 / 15 / 10 / 5 / 2,5 / 1,25 / 0,5 / 0,25 kg, limitée à ceux ≥ `smallestPlateG` |
| `resolveSlot(slot, state, ctx)` | exercice du jour selon 05 §11, avec la raison (`planned`, `replaced_not_feasible`, `not_feasible_here`, `suspended`) |
| `planWorkout(input)` | séance prévue : exercices résolus, séries d'échauffement et de travail avec leurs cibles, disques, avis (reprise, semaine allégée, calibration, messages aux mineurs) |
| `nextWorkoutId(program, sessions)` | rotation (05 §4) |
| `evaluateExercise(input)` | une décision selon l'ordre strict de 05 §9 |
| `replayInstance(input)` | §4.4 |
| `records(history)`, `sessionStats`, `xp`, `ranks` | §8 |

### 4.3 Précisions au moteur

Ces points ne sont pas tranchés par 05 ; ils le sont ici.

1. **Séries prises en compte.** Seules les séries de travail faites (D2) comptent. Si moins de séries que prévu ont été faites et qu'aucune n'est sous `reps.min` : `HOLD`, code `SETS_MISSING`, jamais un échec. Une série ajoutée en cours de séance compte comme les autres.
2. **Charge réalisée** : la plus petite charge des séries de travail faites. Les cibles suivantes partent de cette charge, même si elle diffère de la cible.
3. **Unilatéral** (`unilateral = true`) : une série est une paire de lignes de même `position` (`side` = `left` puis `right`). Les répétitions de la série sont le minimum des deux côtés ; l'effort peut être noté sur l'une ou l'autre ligne.
4. **Effort** : `rirEval` de 05 §7, calculé sur toutes les lignes de travail faites de l'exercice.
5. **Calibration** : un `slot_state` naît avec `calibration_left = 3`. La première séance d'un exercice dans un slot propose la dernière charge faite sur cet exercice (toutes séances, libres et anciennes instances comprises) ; à défaut, le champ est vide et l'écran dit comment choisir (§7.3). Cette suggestion ne sert qu'à préparer la séance : l'évaluation lit la charge réellement faite. Le rejeu d'une instance ne dépend donc d'aucune donnée hors de l'instance.
6. **Chaînes** : pour un slot `chain`, l'état est tenu par (slot, chaîne) : `slot_state.exercise_id` vaut le `chain_id` et `variant_rank` porte la variante. Si la variante courante n'est pas utilisable dans le lieu, on prend la plus difficile des variantes utilisables de rang inférieur, sinon `substitutes` ; un remplaçant hors chaîne a son propre état (slot, exercice).
7. **Semaine de programme** : un compteur passe à la semaine suivante dès que le nombre de séances `completed` depuis le début de la semaine atteint `days_per_week` en vigueur à ce moment. Semaine allégée planifiée : 5e semaine de chaque bloc de 5. Un allègement accepté (réactif ou demandé par l'utilisateur) rend allégées les `days_per_week` séances suivantes, puis le bloc repart à sa semaine 1.
8. **Type de semaine figé.** `week_type` est calculé par `planWorkout` et figé dans la séance (D2). L'évaluation lit la valeur figée.
9. **Reprise après absence** (05 §10.4) : l'écart se mesure en jours civils à Paris entre le début de la séance et celui de la dernière séance `completed` de l'instance. La séance de reprise se reconnaît par ce même écart au rejeu : aucune colonne en plus.
10. **Lieu différent.** Une cible calculée pour un lieu est ramenée par `roundDown` à la grille du lieu du jour. Si aucune charge de la grille n'est en dessous, on prend la plus légère disponible avec l'avis « Charge la plus légère disponible ici ».
11. **Record du moteur** (« après un record », 05 §9.6) : propre à l'état (slot, exercice) et aux séances de l'instance, distinct des records de l'écran (§8.3). C'est un record quand, par rapport à toutes les séances déjà évaluées pour cet état : la charge réalisée est plus haute ; ou, à charge égale à la plus haute, le total de répétitions de travail est plus haut ; ou la variante est plus difficile ; ou, à variante égale à la plus difficile, la durée totale est plus longue.
12. **Après la dernière marche de stagnation** (05 §9.6, case « – ») : `stall_rank` reste à sa valeur maximale, `no_progress_count` repart à 0. Chaque nouvelle stagnation applique, pour `linear` et `double`, l'allègement standard. Le moteur ne propose le remplacement qu'**une fois par état (slot, exercice ou chaîne) et par niveau** (ruling R32) : le niveau est celui du meilleur total qui sert au compteur de stagnation (charge réalisée, variante et, en durée, durée visée). Une nouvelle stagnation au même niveau ne refait pas la proposition et la décision porte `STALL_ALREADY_PROPOSED` ; après un changement de niveau, une stagnation peut proposer de nouveau, avec la séance déclenchante comme nouvelle clé (§4.4.4). Sans remplaçant utilisable, rien n'est proposé et la décision porte `STALL_NO_REPLACEMENT` (ruling R26). Cette mémoire est tirée de l'historique seul par le rejeu, jamais des propositions stockées.
13. **Codes raison** : chaque code a une phrase en français dans `packages/contracts` (`REASON_TEXTS`). Liste initiale, que le plan fige : `NO_DATA`, `NOT_FEASIBLE_HERE`, `SLOT_SUSPENDED`, `DELOAD_WEEK`, `USER_HOLD`, `USER_LIGHTEN`, `PAIN_HOLD`, `PAIN_LIGHTEN`, `CALIBRATION_UP`, `CALIBRATION_DONE`, `CALIBRATION_HOLD`, `CALIBRATION_DOWN`, `CALIBRATION_END`, `LOAD_UP`, `REPS_UP`, `REPS_MAX_REACHED`, `SUM_LOAD_UP`, `CHAIN_NEXT`, `CHAIN_BACK`, `DURATION_UP`, `EFFORT_MISSING`, `EFFORT_NOT_VALIDATED`, `SETS_MISSING`, `NO_PROGRESS`, `REPS_UNDER_MIN`, `DURATION_UNDER`, `LINEAR_TO_DOUBLE`, `STALL_1_LIGHTEN`, `STALL_2_DOUBLE`, `STALL_RESET_MIN`, `STALL_REPLACE_PROPOSED`, `RESUME_14`, `RESUME_28`, plus `STALL_NO_REPLACEMENT` (ruling R26) et `STALL_ALREADY_PROPOSED` (ruling R32). Pour les changements : `USER_CHANGE`, `ENGINE_STALL_REPLACE`, `ENGINE_REACTIVE_DELOAD`, `PAIN_SUSPEND`. Au retrait du consentement santé, `PAIN_HOLD` → `USER_HOLD`, `PAIN_LIGHTEN` → `USER_LIGHTEN`, `PAIN_SUSPEND` → `USER_SUSPEND` (05 §13.9).

### 4.4 Rejeu

`replayInstance({instance, sessions, changes, catalog, places})` rend les `slot_state`, les `engine_decision`, l'**état du programme** (semaine de programme, place dans le bloc, séances allégées restantes, prochaine séance de la rotation) et les événements du moteur.

1. **Ordre** : séances `completed` de l'instance, triées par `started_at` puis `id` ; changements acceptés insérés à leur `decided_at` (à égalité, le changement passe avant la séance). Une séance `in_progress` ou `abandoned` n'est pas évaluée.
2. **Entrées figées** : cibles, `week_type`, `profile` et `rules_version` de chaque séance ; `machine_step_g_override` des `slot_state` existants est repris.
3. **Douleur** : `pain_level` n'est lu que s'il est stocké (consentement actif au moment de la saisie). Les ajustements viennent de `next_adjustment`, neutre et toujours stocké : le rejeu donne donc le même état avant et après un retrait du consentement, hors colonnes C2.
4. **Événements du moteur** : propositions de remplacement (stagnation), proposition d'allègement réactif, suspension pour douleur. Le domaine rend pour chacun une clé `engine|instance|code|slot|exercice|séance déclenchante` ; le serveur en tire l'identifiant (UUID dérivé du SHA-256 de la clé) et n'écrit que les événements absents : rejouer ne les duplique pas.
   - Une **proposition** naît `proposed` ; une fois décidée, elle n'est jamais recréée ni modifiée. Acceptée, elle devient une entrée du rejeu à son `decided_at`, comme un changement de l'utilisateur.
   - Une **suspension pour douleur** naît acceptée, avec `decided_at` = fin de la séance déclenchante (`ended_at`), quelle que soit l'heure d'arrivée du push. Le rejeu qui la détecte l'applique aussitôt après cette séance ; les rejeux suivants la lisent comme une entrée, à ce même `decided_at`, et ne la redétectent pas. Elle reste donc même si une correction ou un retrait du consentement efface sa cause ; seul l'utilisateur la lève (`resume_slot`). Elle compte comme un changement accepté : `revision` + 1, ce qui périme les propositions en attente (05 §15.4).
5. **Écriture minimale** : le serveur n'écrit (nouveau `rev`) que les lignes dont le contenu change. Il supprime logiquement celles que le rejeu ne produit plus (séance supprimée), sauf un `slot_state` qui porte un `machine_step_g_override`.
6. **Expiration** (05 §15.4) : avant chaque rejeu, chaque appel de l'API du programme et chaque pull de l'utilisateur, le serveur passe à `expired` les propositions dont `expires_at` est passé ou dont `base_revision` n'est plus la révision courante.
7. **État du programme non stocké.** Ni colonne ni table en plus : le téléphone et le serveur le recalculent par `replayInstance`, comme les rangs.
8. **Côté téléphone.** `planWorkout` part du rejeu local : séances du miroir (celles des autres appareils déjà reçues, plus celles de cet appareil pas encore envoyées), changements acceptés reçus, `machine_step_g_override` reçus. Sur les mêmes données, ce rejeu est identique à celui du serveur (parité, §10.4). Les décisions et cibles de fin de séance sont gardées comme copies `provisional` dans Dexie et remplacées par le pull. Le téléphone ne crée jamais de ligne `instance_change`. S'il trouve dans son miroir une séance dont il ne connaît pas la `rules_version` (faite sur un appareil plus à jour), il planifie à partir des `slot_state` reçus du serveur, sans rejeu local, et propose la mise à jour de l'appli.

## 5. Données et synchronisation

### 5.1 Tables

Migration `0004_program` (non cassante) : les 7 tables de 09 §3, STRICT, avec `+SYNC` et les index de 09, plus :

- `workout_session.profile TEXT NOT NULL CHECK (profile IN ('adult','cautious'))` (D3) ;
- `performed_set.logged_at` nullable (D2) ;
- `program_instance` : unique partiel `(owner_id) WHERE status='active' AND deleted_at IS NULL` (09) ;
- `slot_state.exercise_id` peut porter un `chain_id` (§4.3.6), donc sans clé étrangère vers `exercise`.
- **Pas de clé étrangère** de `workout_session.instance_id` vers `program_instance`, ni de `workout_session.place_id` vers `place` (écart à 09 §3). Après une restauration, les lignes de classe E écrites depuis la sauvegarde sont perdues (R-SYN-28), mais les séances de moins de 60 jours reviennent (R-SYN-26) : elles ne doivent pas être rejetées, puis entraîner le rejet de leurs exercices et séries (`parent_rejected`). Une séance dont l'instance n'existe plus est gardée hors programme : elle apparaît dans l'historique et compte pour l'XP et les records, mais n'est pas rejouée. Une séance dont le lieu n'existe plus affiche « Lieu inconnu ».

La table `workout_session` reprend les colonnes que lit déjà `listActiveWorkoutSessions` (garde de mise à jour R-DEP-3) ; son test passe sur la vraie migration.

### 5.2 Registre (`entityRules`)

| Table | Cat. | Classe | `clientWritable` | C2 | Export | Suppression du compte |
|---|---|---|---|---|---|---|
| `program_instance` | C1 | E | — (API en ligne) | — | oui | cascade |
| `instance_change` | C1 | E | — (API en ligne) | `reason` | oui | cascade |
| `slot_state` | C1 | D | — | `pain_streak` | oui | cascade |
| `engine_decision` | C1 | D | — | — | oui | cascade |
| `workout_session` | C1 | J | `instance_id`, `workout_id`, `place_id`, `device_id`, `started_at`, `ended_at`, `status`, `week_type`, `template_version`, `rules_version`, `app_version`, `profile`, `note` | — | oui | cascade |
| `performed_exercise` | C1 | J | `session_id`, `slot_id`, `planned_exercise_id`, `exercise_id`, `swap_reason`, `position`, `pain_level`, `next_adjustment`, `note` | `pain_level` ; `swap_reason` quand il vaut `pain` (`c2Values`) | oui | cascade |
| `performed_set` | C1 | J | toutes sauf `+SYNC` | — | oui | cascade |

- `parent` : `performed_exercise` → `workout_session.session_id` ; `performed_set` → `performed_exercise.performed_exercise_id` (R-SYN-17).
- L'aide `rule()` du registre s'élargit pour accepter `c2Columns`, `c2Values` et `parent`. Les tests du registre (« 18 tables du socle et 5 du catalogue », absence de `parent` sur les tables de base) sont mis à jour, ainsi que `COLUMN_CODECS`.

### 5.3 Contrôles du serveur au push (`SYNC_HOOKS`)

`beforeApply` de chaque table J, en plus des règles génériques :

- `workout_session` : si la ligne visée par `instance_id` ou `place_id` existe, elle appartient à l'appelant (sinon `forbidden_reference`) ; un identifiant inconnu est admis (§5.1, restauration) ; un lieu supprimé reste admis ; `profile` est durci (D3) à la création et ignoré ensuite ; `status` ne revient jamais à `in_progress` depuis `completed` ou `abandoned`, et ne passe jamais de `completed` à `abandoned` (`invalid_transition`, ruling R33) ; `abandoned` → `completed` reste admis (l'appareil qui tenait une séance close comme oubliée la termine, D12) ; `started_at` et `instance_id` ne sont pas modifiables après création ; `place_id` reste modifiable.
- `performed_exercise` : `exercise_id` existe au catalogue, publié ou retiré après publication (`unknown_exercise` sinon) ; `session_id` n'est pas modifiable après création.
- `performed_set` : bornes `load_g` 0 à 500 000, `reps` 0 à 200, `duration_s` 0 à 7 200, `position` 1 à 99 (`out_of_range`) ; `performed_exercise_id` n'est pas modifiable après création.
- Rattachements immuables : un patch qui porte `instance_id`, `session_id` ou `performed_exercise_id` (comme `profile` et `started_at`) les ignore, sans rejet, et s'applique pour le reste. Une séance, un exercice ou une série ne changent donc jamais d'instance, de séance ou d'exercice.
- Colonnes C2 sans consentement : R-SYN-9 (`applied_partial`).
- Suppressions gardées (`keepOnDelete`, rulings R49 et R54) : le `delete` d'une série que le serveur sait faite, ou d'un exercice qui porte une telle série vivante (échauffement compris), d'une séance vivante est acquitté `applied` sans rien supprimer ; la ligne prend un rev neuf et revient au pull. Hors « Supprimer la séance », dont la suppression de la séance suit dans l'outbox, seul un miroir en retard sur l'autre appareil en envoie un, après un « Continuer ici » pas encore tiré (« Terminer », « Changer de lieu », « Changer d'exercice », « Retirer une série »). « Supprimer la séance » est le seul chemin qui supprime des séries que le serveur sait faites : la suppression de la séance emporte ses exercices et ses séries. Limite connue, reportée à la brique 4 : une série faite hors ligne dont la suppression par l'autre appareil arrive au serveur avant elle est perdue (son patch sur la ligne supprimée est acquitté sans effet).
- D4 tenue par le serveur (ruling R51) : une séance touchée par le lot, vivante et `abandoned`, qui a une série de travail faite vivante sous un exercice vivant passe `completed` avant le rejeu ; sa fin devient la dernière série faite si elle est plus tardive (une série datée à plus de 10 min dans le futur compte pour maintenant, ruling R24 bis).
- `afterBatch` : rejeu des instances touchées (§4.4), une fois par instance et par lot. Une instance que le lot ne touche que par des séances `in_progress` vivantes n'est pas rejouée (elles ne sont jamais évaluées) ; une instance `ended` garde ses états et ses décisions à jour mais ne reçoit plus d'événement du moteur.

`SYNC_PROTOCOL` ne change pas : les opérations gardent leur format, seules de nouvelles entités apparaissent.

### 5.4 Téléphone

- Dexie passe à la version 2 (`version(2)` avec les 7 nouvelles tables et la marque `provisional` des copies D) ; les jeux figés de la version 1 relisent outbox et miroir (R-VER-5).
- Les écritures de séance passent par `writeLocal` (ligne et opération dans la même transaction). La séance en cours est notée dans `meta.activeSessionId`, qui bloque déjà les mises à jour de l'appli.
- Synchro 2 s après chaque série validée (R-SYN-29) ; compteur « N en attente » visible sur l'écran de séance (R-SYN-34).
- Les modèles de programmes sont lus dans le magasin `programTemplates` existant, validés par `ProgramTemplateSchema` (un modèle invalide est ignoré).

### 5.5 Retrait du consentement santé

`HEALTH_WITHDRAW_HOOKS` reçoit, en une transaction : `performed_exercise.pain_level` à NULL, `swap_reason = 'pain'` à NULL, `slot_state.pain_streak` à NULL, `instance_change.reason` à NULL, réécriture des codes `PAIN_*` (§4.3.12) dans `instance_change.reason_code` et `engine_decision.reason_code`. Nouveaux `rev`, pas de rejeu (05 §13.9). Le téléphone purge ses copies et les opérations en attente qui portent ces champs.

### 5.6 Export et suppression

- Export JSON : les 7 tables y entrent par le registre.
- **CSV des séries** : `GET /api/me/export/sets.csv`, réseau nécessaire, même garde `Sec-Fetch-Site` que l'export du catalogue, journalisé sans contenu. Une ligne par série faite : date et heure (Paris), séance (nom ou « Séance libre »), lieu, exercice (nom et id), position, côté, type, charge en kg (virgule décimale), répétitions, durée, effort, cibles ; la colonne douleur seulement si le consentement santé est actif. Séparateur `;`, UTF-8 avec BOM (ouverture directe dans un tableur français).
- Suppression du compte : cascade ; `delete.test` et `pull-leak.test` couvrent les 7 tables.
- Une session admin reçoit 404 sur les instances, changements et séances des autres (05 §17.8).

## 6. API en ligne

Toutes sous `/api/program/`, session exigée, contrôle de l'`Origin` (P-AUT-4). Hors ligne, les écrans grisent l'action avec « Nécessite le réseau ».

| Route | Corps | Réponses |
|---|---|---|
| `POST /api/program/enroll` | `{templateId, daysPerWeek}` | 201 `{instance}` ; 409 `already_enrolled` (une instance active existe : passer par `switch_template`) ; 422 `template_unavailable`, `days_out_of_range` |
| `POST /api/program/changes` | `{baseRevision, operations[1..5]}` | 201 `{change, instance}` (auteur `user`, accepté d'emblée) ; 409 `stale_revision` ; 409 `session_in_progress` pour `switch_template` pendant une séance ; 422 `{errors: [{op, code}]}` |
| `POST /api/program/changes/:id/accept` | `{baseRevision}` | 200 `{change, instance}` ; 409 `expired` (date limite passée) ou `stale_revision` (`base_revision` de la proposition périmée) : la proposition passe à `expired` ; 409 `stale_revision` si seul le `baseRevision` du client est périmé : la proposition reste `proposed` (ruling R37) ; 409 `not_proposed` ; 422 `{errors}` |
| `POST /api/program/changes/:id/reject` | `{}` | 200 `{change}` ; 409 `not_proposed` |
| `PUT /api/program/slot-states/:id/machine-step` | `{stepG}` ou `{stepG: null}` | 200 `{slotState}` ; 404 si l'`id` déterministe ne désigne pas un slot de l'instance active de l'appelant ; 400 `validation` hors bornes (500 à 10 000, entier ; ruling R36). Si la ligne n'existe pas encore (exercice en calibration), elle est créée avec l'état initial. |
| `GET /api/me/export/sets.csv` | — | 200 `text/csv` ; 403 `origin_mismatch` |

- `switch_template` accepté : l'ancienne instance passe à `ended` et une nouvelle naît dans la même transaction (05 §6.2). L'opération devient `switch_template {templateId, daysPerWeek?}` : sans `daysPerWeek`, les jours courants sont ramenés dans [min, max] du nouveau modèle. Le même `templateId` est admis quand le fichier servi a une `version` plus haute que `template_version` : c'est le passage à la nouvelle version (05 §6.2).
- `program_instance.days_per_week` garde les jours de l'inscription, jamais réécrits : c'est l'entrée du rejeu. Les jours en vigueur sont ceux du programme effectif (`set_days_per_week` acceptés compris), que lisent les écrans et `switch_template` (ruling R35).
- Le pas de machine est tenu par (slot, exercice), comme le prévoit 05 §12 : la même machine dans un autre slot a son propre réglage.
- Le schéma des opérations vient de `packages/contracts` et sera réutilisé par l'outil du coach (brique 4). `lighten_exercise` porteur d'un pourcentage est refusé par le schéma.
- Les réglages de charge passent par les routes existantes `PATCH /api/places/:id` (maison) et `PATCH /api/gyms/:id` (salle, avec l'historique).

## 7. Écrans

Routes nouvelles : `/workout`, `/workout/:id`, `/workout/:id/summary`, `/history`, `/history/:id`, `/program`, `/program/choose`, `/progression/exercises/:id`, `/places/:id/load`, `/gyms/:id/load`. L'onglet Séance est actif sur `/workout…` et `/program…` ; Progression sur `/history…` et `/progression…`.

### 7.1 Bouton Séance

- Il ouvre la séance en cours de cet appareil (`/workout/:id`) s'il y en a une, sinon `/workout`. Un point animé (fixe en mouvement réduit) et le nom accessible « Séance, en cours » signalent une séance en cours.
- Séance en cours sur un autre appareil (R-SYN-7) : `/workout` affiche « Séance en cours sur un autre appareil » avec « Continuer ici » (réécrit `device_id`), « La terminer » et « La supprimer ». L'appareil qui perd la séance la montre en lecture seule : « Cette séance continue sur un autre appareil. »

### 7.2 Séance du jour (`/workout`)

- **En-tête** : nom du programme, « Semaine n · Séance B », pastille « Semaine allégée » s'il y a lieu.
- **Lieu du jour** : pastilles des lieux actifs, le principal présélectionné (R-LIEU-4).
- **Séance** : celle de la rotation, avec « Changer » (feuille listant les séances du modèle ; le choix est enregistré dans la séance).
- **Liste des exercices** (`planWorkout`), un par slot : nom, cible résumée (« 3 × 6 · 60 kg », « 3 × 8–12 · 14 kg par main », « 3 × 30 s », « Calibration : tu choisis ta charge ») et, s'il y a lieu, « Remplace <exercice> (pas faisable ici) », « Pas faisable ici : sauté », « Suspendu ». Toucher un exercice ouvre sa fiche en feuille du bas, hors ligne.
- **Avis** au-dessus de la liste : reprise (« 16 jours depuis ta dernière séance : charges −10 % »), messages aux mineurs pour la barre (05 §14), écart de 3 h avec le sport (modèles `sport`), proposition en attente (lien vers Mon programme).
- **Actions** : « Commencer » (principal, hors ligne compris), « Séance libre », lien « Mon programme ». Durée estimée.
- **Sans programme** : carte « Choisis ton programme » vers `/program/choose`, et « Séance libre ». Catalogue absent : `CatalogMissing`.
- **Modèle devenu indisponible** (05 §5) : l'instance en cours continue sur son `snapshot`. Un slot sans exercice utilisable passe par les remplaçants, ou il est sauté (« Pas faisable ici : sauté »). Si toute la séance est sautée : « Aucun exercice de cette séance n'est disponible pour l'instant. », avec « Séance libre » et « Changer de programme ». L'indisponibilité d'un modèle ne compte que pour une nouvelle inscription (`/program/choose`, E8).

### 7.3 Séance en cours (`/workout/:id`)

- **En-tête collant** : nom de la séance, durée écoulée, « N en attente », menu « ⋯ » : Note de séance, Changer de lieu (tant qu'aucune série n'est faite : le plan est refait), Supprimer la séance (confirmation).
- **Cartes d'exercice**, dans l'ordre, l'exercice en cours ouvert et les autres repliés avec « 2 / 3 » :
  - nom (vers la fiche), cible, disques par côté pour la barre (« Par côté : 20 + 5 + 1,25 »), messages aux mineurs ;
  - lignes d'échauffement marquées « Échauffement », puis lignes de travail : **Série · Préc. · kg · Reps · ✓**. « Préc. » montre la série de même position de la dernière fois sur cet exercice ; la toucher la recopie. Champs pré-remplis avec la cible, clavier décimal (virgule ou point acceptés), boutons − / + au pas réalisable du lieu pour la charge et de 1 pour les répétitions ;
  - exercice en durée : champ « Secondes » et chronomètre qui remplit le champ à l'arrêt ;
  - unilatéral : deux lignes par série, « Gauche » et « Droite » ;
  - menu de la carte : Changer d'exercice (candidats de 05 §11 et raison : matériel, occupé, douleur, préférence), Douleur ou gêne, « La prochaine fois : ne pas augmenter » ou « alléger », Note, Pas de cette machine (machines seulement, en ligne), Ajouter une série, Retirer une série non faite.
- **Valider (✓)** : écrit la série (charge, répétitions ou durée, `logged_at`), lance le minuteur de repos du slot pour une série de travail, et déclenche la synchro. Toucher une série faite la rouvre pour correction.
- **Effort** : après la dernière série de travail d'un exercice, une feuille du bas propose les 4 boutons de 05 §7 avec leurs libellés, plus « Plus tard ». Sur les autres séries, une pastille « Effort » facultative.
- **Douleur ou gêne** (05 §13) : feuille « Gêne » / « Douleur ». Avec le consentement santé, `pain_level` est stocké. Sans, seul `next_adjustment` est écrit, sans aucune trace de douleur. « Douleur » affiche le conseil de sécurité mot pour mot (05 §13.6) et propose aussitôt un autre exercice du même type de mouvement ; pour un mineur, « parles-en à un parent ».
- **Minuteur de repos** : barre au-dessus du bouton du bas, « Repos 1:45 », −15 s, +15 s, « Passer » ; heure de fin absolue ; à zéro, la barre l'annonce (texte et `aria-live`) et joue un son court si l'appli est au premier plan et que le son est activé.
- **Terminer** : bouton du bas, secondaire tant qu'il reste des séries prévues, principal ensuite. S'il manque un effort, une feuille liste les exercices concernés (« Effort non noté : la charge n'augmentera pas ») avec « Noter maintenant » et « Terminer quand même ».
- Cibles tactiles d'au moins 48 × 48 px pour ✓, − et +, les actions en bas d'écran, écran gardé allumé (D14).

### 7.4 Fin de séance (`/workout/:id/summary`)

- Fenêtre du Système : « Séance gravée. », durée, séries de travail, kg soulevés.
- XP gagnée et barre du rang qui se remplit ; passage de rang (global ou d'un groupe) : la pierre se grave, comme « Éveil terminé » (refonte §7), en fondu sous mouvement réduit.
- Records battus (« Nouveau record : 62,5 kg × 6 ») ; un premier passage sur un exercice n'est pas un record.
- « La prochaine fois » : une ligne par exercice, cible et phrase du code raison, marquée « provisoire » tant que le serveur n'a pas répondu.
- Bulle du coach : nouveau moment `session_end` dans `coach-lines.ts`, textes écrits à l'avance par coach (refonte §8), relus par le propriétaire.
- « Terminé » ramène à l'accueil.

### 7.5 Séance libre

Depuis la séance du jour : on ajoute des exercices par recherche dans le catalogue (filtre « Faisable : <lieu> » de la brique 2), puis des séries sans cible. L'effort reste facultatif ; pas de décision du moteur (D7). Même écran de saisie et même fin de séance, sans « La prochaine fois ».

### 7.6 Historique (`/history`, `/history/:id`)

- Liste par mois : date (« mar. 28 oct. »), nom de la séance ou « Séance libre », lieu, durée, séries, kg soulevés. Accès depuis Progression.
- Détail : exercices, séries, efforts, décision du moteur en une phrase, notes ; douleur affichée seulement si elle est stockée. « Modifier » rouvre les séries faites (corrections champ par champ, puis rejeu par le serveur). « Supprimer la séance » avec confirmation.

### 7.7 Mon programme (`/program`)

- En-tête : nom, « Semaine n » (et « bloc k / 5 » pour un modèle planifié), jours par semaine, date de début.
- Si le modèle servi a une `version` plus haute que celle de l'instance : bandeau « Une nouvelle version de ton programme existe. » avec « Passer à la nouvelle version » (`switch_template` sur le même modèle, avec le même avertissement de calibration qu'au §7.8). Jamais de bascule automatique.
- **Propositions en attente** en tête : auteur (« Proposition de Rune » pour le moteur), avant / après calculé par le domaine, date limite, « Accepter » / « Refuser ».
- **Séances du modèle** : slots avec l'exercice résolu au lieu principal, séries × répétitions, repos, état (charge, variante, « Suspendu »).
- **Toucher un slot** : feuille avec les changements de 05 §15 ouverts à l'utilisateur : remplacer l'exercice, séries −1 / +1, fourchette de répétitions, repos, effort visé (sous « Réglages avancés »), alléger la prochaine fois, suspendre ou reprendre, retirer de la séance. En profil prudent, les bornes prudentes s'appliquent et les hausses interdites n'apparaissent pas.
- Par séance : « Ajouter un exercice » (`add_slot`), absent en profil prudent avec une phrase d'explication. Pour le programme : jours par semaine, « Commencer une semaine allégée », « Changer de programme ».
- **Journal** : les changements, du plus récent au plus ancien (date, « Toi » / « Rune » / « Coach IA », résumé, statut).
- Une erreur 422 s'affiche sous l'action, avec un message par code.

### 7.8 Choisir un programme (`/program/choose`)

- Les 6 modèles en cartes : nom, description, jours, durée estimée ; « Recommandé pour toi » avec les raisons de `recommendTemplate` en phrases ; un modèle indisponible est grisé avec « Pas encore disponible ».
- Choisir ouvre une feuille : jours par semaine (dans [min, max], préréglés sur le profil) et « Commencer ce programme ». Avec un programme actif, la feuille prévient : « Ton programme actuel s'arrête. Chaque exercice repart en calibration, avec ta dernière charge comme point de départ. »
- **E8** (D15) : carte du programme recommandé et case cochée « Commencer avec ce programme » ; « Commencer » inscrit puis termine l'onboarding. Sans modèle disponible : « Pas encore de programme disponible : tu pourras faire des séances libres. »
- **Profil** (R-REC-7) : quand le modèle recommandé change, un bandeau propose « Un autre programme te correspond mieux » vers `/program/choose`, sans rien changer seul.

### 7.9 Accueil

Ordre des cartes : séance en cours (« Reprendre ») ; séance du jour (nom, nombre d'exercices, durée, lieu principal, « Commencer ») ou « Choisis ton programme » ; propositions en attente ; Quêtes d'éveil tant qu'elles ne sont pas faites ; bulle du coach ; tuiles existantes. Le texte « Tes programmes et tes séances arriveront ici. » disparaît. Au passage à 18 ans, un bandeau unique annonce la fin du profil prudent imposé (05 §14), une fois par appareil.

### 7.10 Progression

- Rang global (pierre), « Rang D · 1 240 / 5 000 XP », prochain rang ; compteurs réels (séances, kg soulevés, semaines d'assiduité) ; les 9 groupes avec leur rang, liens inchangés vers `/exercises/group/:code`.
- « Records récents » (5 derniers), « Historique des séances », « Mes exercices » vers `/progression/exercises/:id` : courbe de la meilleure série par séance (charge, ou répétitions, ou secondes selon l'exercice), records de l'exercice, 1RM estimé avec la mention de 05 §13.1, absent pour un mineur.
- Sans séance : la fenêtre du Système actuelle reste.

### 7.11 Réglages de charge (`/places/:id/load`, `/gyms/:id/load`)

Depuis la fiche d'un lieu maison ou d'une salle : poids de la barre, plus petit disque, pas des machines, haltères disponibles (grille de 0,5 à 80 kg à cocher, préréglages « Aucun », « 2 à 40 kg par 2 kg »). Brouillon enregistré d'un coup, comme le matériel (refonte §10.3). Sur une salle, droits et historique de 02 §10.4. Réseau nécessaire.

### 7.12 Réglages

Section « Séance » : « Garder l'écran allumé pendant la séance » (activé par défaut) et « Son à la fin du repos » (activé par défaut), stockés sur l'appareil. « Télécharger mes séries (CSV) » dans Confidentialité et données.

### 7.13 Textes

Les textes de l'interface sont écrits dans le plan et relus par le propriétaire. Voix du Système pour les titres de fin de séance et les rangs ; conseils de sécurité mot pour mot ; vocabulaire « repère », « estimation », jamais « prescription ».

## 8. XP, rangs, compteurs et records

Fonctions pures de `packages/domain/src/program/progress.ts`, constantes dans `rules.ts`. Tout se recalcule depuis l'historique local ; une correction ou une suppression de séance change donc l'XP.

### 8.1 XP

Pour chaque séance `completed` (séances libres comprises) :
- 10 XP par série de travail faite (une paire unilatérale compte pour une) ;
- 5 XP par exercice dont la dernière série de travail porte un effort ;
- 20 XP pour la séance terminée ;
- plafond de 300 XP par séance.

Rien pour la charge, l'échec, un record ou une séance `abandoned`.

| Rang | E | D | C | B | A | S |
|---|---|---|---|---|---|---|
| XP cumulée | 0 | 1 000 | 5 000 | 12 000 | 30 000 | 60 000 |

Repère : 3 séances de 15 séries par semaine donnent environ 600 XP, soit le rang D en 2 semaines, C en 2 mois, B en 5 mois, A en un an, S en deux ans.

### 8.2 Rangs des groupes

Chaque série de travail faite crédite chaque groupe de `MUSCLE_GROUPS` dont un muscle est principal (1) ou, à défaut, secondaire (0,5) ; au plus 1 par groupe et par série.

| Rang | E | D | C | B | A | S |
|---|---|---|---|---|---|---|
| Séries cumulées | 0 | 20 | 100 | 250 | 600 | 1 200 |

### 8.3 Compteurs et records

- **Séances** : séances `completed`. **kg soulevés** : somme de charge × répétitions des séries de travail faites, charge telle que saisie (par main pour les haltères) ; affichée en tonnes au-delà de 10 000 kg. **Semaines d'assiduité** : semaines civiles (lundi à dimanche, Paris) avec au moins une séance `completed`.
- **Records par exercice**, sur les séries de travail faites des séances non supprimées : meilleure charge (à au moins 1 répétition), et à égalité plus de répétitions ; plus de répétitions en une série (sans charge) ; plus longue durée ; meilleur volume en une séance ; 1RM estimé (Epley, seulement si répétitions + RIR retenu ≤ 12, charge externe ; RIR 0 sans effort noté). Un record est nouveau s'il dépasse strictement toutes les séances précédentes.

## 9. Vie privée

- Nouvelles colonnes C2 (`pain_level`, `swap_reason = pain`, `pain_streak`, `instance_change.reason`) déjà prévues par 03 ; la fiche de traitement et la page Confidentialité ajoutent les séances, les séries, les programmes et le CSV.
- **`profile` (`adult` | `cautious`) reste C1**, sur `workout_session` (D3) comme sur `engine_decision`, où 09 §3 le range déjà en C1. Le profil prudent mêle trois sources (âge, mode prudent manuel, indicateur de prudence) et ne dit pas laquelle. Au retrait du consentement santé, il n'est pas effacé : les cibles et décisions passées le reflètent de toute façon, et 05 §13.9 exclut tout recalcul rétroactif. La fiche de traitement le mentionne.
- Notes de séance et d'exercice : 500 caractères au plus, avec le rappel « N'écris pas d'informations sur ton identité ni sur ta santé. » (06 §5).
- Aucune donnée de séance d'un membre n'est visible d'un autre membre ni de l'admin dans l'appli ; la liste « qui va à cette salle » ne gagne ni horaire ni fréquence (R-VIS-1).

## 10. Critères d'acceptation

1. **Moteur, par tableaux de cas** (05 §17.1) : chaque primitive, chaque étape de 05 §9, chaque précision du §4.3, avec `FakeClock` et des dates explicites.
2. **Propriétés** (fast-check, 05 §17.2) : jamais de hausse avec un ajustement, une douleur ou un effort manquant ; jamais au-delà du plafond ; jamais hors des bornes prudentes avec `profile = cautious` ; même entrée, même sortie ; rejeu = calcul incrémental, y compris après le retrait du consentement santé ; rejouer deux fois ne crée aucun événement en plus.
3. **Scénarios de référence** : chaque modèle, 12 semaines, 5 profils scriptés (05 §5.9), comparés à un instantané.
4. **Parité** : la suite du moteur tourne sous Node (serveur) et sous happy-dom (web) ; un test compare le rejeu du téléphone et celui du serveur sur le même historique.
   - **Versions de règles** : avec une seconde version de règles de test, une séance ancienne garde sa décision au rejeu, une nouvelle prend les nouvelles règles. Suspension pour douleur : même place dans le rejeu, que les séances arrivent en un ou plusieurs pushs, et toujours là après le retrait du consentement santé. Pas de machine fixé pendant une calibration : gardé après le rejeu et après la suppression de la séance.
5. **Validateur** : modèles et changements invalides, chacun avec son code (05 §17.5), dont `baseRevision` périmée, proposition de plus de 7 jours, `lighten_exercise` avec pourcentage, `add_slot` en profil prudent, `remove_slot` qui vide un groupe de couverture. Les 6 modèles du dépôt passent `data:validate`.
6. **Synchro** : création idempotente ; parent rejeté → enfants rejetés ; transitions de statut interdites ; colonnes C2 sans consentement → `applied_partial` sans trace (05 §17.7) ; deux séances hors ligne sur deux appareils rejouées dans l'ordre des débuts ; nouvelle époque : les séances de moins de 60 jours sont renvoyées (R-SYN-26) et acceptées même si leur instance ou leur lieu a disparu avec la restauration (D17) ; une référence à l'instance ou au lieu d'un autre membre est refusée (`forbidden_reference`).
7. **Isolation** : `pull-leak.test` et la 404 admin couvrent les 7 tables ; aucune ligne d'un autre membre.
8. **Retrait santé** : colonnes C2 vidées, codes réécrits, pas de rejeu, téléphone purgé ; la séance suivante reste allégée par `next_adjustment`.
9. **Dexie** : la version 2 relit l'outbox et le miroir de la version 1.
10. **Écrans** : tests de rôles et de textes pour chaque écran du §7 ; cibles de 48 px sur la saisie ; minuteur juste après un passage en arrière-plan simulé ; mouvement réduit ; contraste des nouvelles paires dans les 5 thèmes.
11. **De bout en bout** (Playwright, Chromium et WebKit) : inscription au programme à E8 ; séance complète **hors ligne** (validation des séries, effort, minuteur, douleur sans consentement) ; retour du réseau, synchro, cibles du serveur affichées ; séance reprise après rechargement de la page ; « Continuer ici » sur un second contexte ; acceptation d'une proposition du moteur ; CSV téléchargé.
12. **Performance** : le bundle initial reste dans le budget existant ; les écrans de la brique 3 sont chargés à la demande et précachés (la séance s'ouvre hors ligne dès la première fois).
13. **Recette sur téléphones** (`docs/exploitation/recette-telephones.md`) : les contrôles 2, 4 et 5 cessent d'être « sans objet » ; s'y ajoutent l'écran allumé et le minuteur après verrouillage du téléphone.

## 11. Risques

- **Contenu en retard** : sans lot A publié, aucun modèle n'est disponible et seule la séance libre fonctionne. Parade : code testé avec du contenu de test ; recette reportée jusqu'à la publication.
- **Seuils de 05 et barèmes du §8 non éprouvés** : fichier de règles versionné, revue après 8 à 12 semaines de vraies séances.
- **Horloge du téléphone** : l'ordre du rejeu dépend de `started_at` posé par le téléphone. Parade : rejeu par le serveur, qui fait foi ; écart rare entre deux appareils.
- **Saisie d'effort négligée** : rappel à la fin de la séance, un seul tap.
- **Minuteur sans notification** sur iPhone verrouillé : heure de fin absolue et son au retour ; push envisagé plus tard.
- **Séance oubliée** clôturée trop tôt (D12) : 6 h laissent une marge large ; les séries restent, seule la séance est close.
- **Gamification** qui pousserait à forcer : l'XP ignore la charge et l'échec (D8).
- Les risques de 05 restent valables.

## 12. Plus tard

Quêtes réelles ; notification push de fin de repos ; supersets ; édition libre de programmes ; filtrage ou signalement selon les limitations dans l'écran de séance ; carte de partage ; graphiques de volume par muscle ; import Strong ou Hevy ; reprise de l'état des slots au changement de version d'un modèle ; et la liste « Plus tard » de 05 §2.

## 13. Choix faits sans le propriétaire

À vérifier en priorité :

1. **Barre à 5 entrées** avec Séance au centre (D1).
2. **Barèmes d'XP et de rangs** (§8) : régularité et volume, jamais la charge.
3. **E8 inscrit au programme recommandé**, case cochée par défaut (D15).
4. **Quêtes réelles reportées** (D11).
5. **Clôture automatique** d'une séance oubliée après 6 h, ou 24 h depuis un autre appareil (D12).
6. **1RM estimé caché aux mineurs** (D9) ; affiché aux adultes, y compris en mode prudent.
7. **Pas de filtrage par limitations** dans la brique 3 (D16).
8. **CSV** en `;` avec BOM, produit par le serveur (D13).
9. **Série manquée ≠ échec** (`SETS_MISSING`, §4.3.1) et **charge réalisée = la plus petite** (§4.3.2).
10. **`profile` en C1**, non effacé au retrait du consentement santé (§9), dans la ligne de 09 §3.
11. **Séances sans clé étrangère** vers l'instance et le lieu (D17), pour survivre à une restauration.
12. **Après la dernière marche de stagnation** : allègement standard à chaque stagnation (`linear`, `double`), mais une seule proposition de remplacement par état et par niveau (§4.3.12, ruling R32).
13. **Textes** : tous ceux de l'interface et le nouveau moment de coach `session_end` seront écrits dans le plan et sont à relire.
