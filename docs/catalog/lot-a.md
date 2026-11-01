# Lot A

**Liste définitive tirée des 6 modèles : le propriétaire valide la liste et les ids avant toute rédaction.**

Le lot A réunit les fiches des conditions (a) et (b) de 04 §7 : celles qu'un des 6 modèles de `data/programs/` met dans la liste d'un slot (a), et les membres des chaînes que ces modèles utilisent (b). Cette liste remplace `lot-a-provisoire.md` (brique 2), qui la déduisait des contenus de 05 §3 avant que les modèles existent ; elle est maintenant tirée des 6 fichiers écrits par la brique 3 (tâche 8).

- **66 fiches, sans changement de périmètre** : aucune fiche ajoutée, aucune retirée. Chacune des 66 fiches provisoires est citée par au moins un modèle, dans un slot ou par sa chaîne. Toutes restent au statut `draft` et au lot `A`.
- **2 fiches étalons** rédigées à la main (`push-up`, `dumbbell-romanian-deadlift`) et **64 squelettes**.
- **Muscles renseignés à la main pour le calcul du volume ; à relire comme le reste.** La règle 6 du validateur des modèles (05 §5, volume par groupe) lit `primary_muscles` et `secondary_muscles`, des champs IA qu'un squelette n'a pas encore. Les 64 squelettes les ont donc reçus à la main (colonne « Muscles » ci-dessous), et seulement eux : aucun autre champ IA n'est rempli. Leur `revision` passe à 2 (04 §4 : +1 à chaque enregistrement).
- **Conséquence pour `pnpm exercises:draft`** : sans `--ids`, le script ne rédige que les `draft` dont aucun champ IA n'est rempli ; il saute donc désormais ces 64 squelettes. Il faut les nommer avec `--ids` (voir `scripts/exercises/NOTES.md`). Le prompt n'envoie pas les muscles au modèle ; la rédaction les réécrit, et la relecture compare alors la proposition de l'IA à celle-ci.
- `pnpm data:validate` passe (66 fiches, 6 modèles). `pnpm data:validate --strict` échoue seulement sur R-EQ-5, comme avant : c'est le lot B qui couvrira les 5 codes de matériel restants.

**Les ids sont immuables** une fois chargés dans une base qui fait foi (04 §2) : c'est maintenant qu'on les corrige, avant le prochain déploiement.

## Les 6 modèles

Abréviations des colonnes « (a) » et « (b) » : GD `gym-beginner-full-body-ab`, GI `gym-intermediate-upper-lower`, MD `home-beginner-full-body`, MI `home-intermediate-upper-lower`, SD `sport-beginner-complement`, SI `sport-intermediate-strength-prevention`.

| Modèle | Séances | Jours (défaut) | Chaînes utilisées | Volume par semaine de programme (quadriceps · ischio-jambiers · fessiers · pectoraux · dorsaux · deltoïdes) | Fourchette |
|---|---|---|---|---|---|
| GD | A (5 slots), B (5 slots) | 2–3 (3) | `front-plank` | 7,5 · 7,5 · 12 · 7,5 · 9 · 10,5 | 6 à 12 |
| GI | Haut 1, Bas 1, Haut 2, Bas 2 (6, 5, 6, 6 slots) | 3–4 (4) | `front-plank` | 13,5 · 12 · 16 · 12 · 13 · 17,5 | 10 à 20 |
| MD | une séance (7 slots) | 2–3 (3) | `bodyweight-squat`, `push-up`, `glute-bridge`, `nordic-curl`, `front-plank` | 6 · 9 · 12 · 9 · 9 · 9 | 6 à 12 |
| MI | Haut 1, Bas 1, Haut 2, Bas 2 (5 slots chacune) | 3–4 (4) | `push-up`, `pull-up`, `pike-push-up`, `bodyweight-squat`, `nordic-curl`, `standing-calf-raise`, `front-plank` | 11 · 11 · 18,5 · 11 · 10 · 15 | 10 à 20 |
| SD | une séance (10 slots) | 2 (2) | `nordic-curl`, `standing-calf-raise` | 4 · 8 · 10 · 6 · 4 · 8 | 4 à 10 |
| SI | A (7 slots), B (6 slots) | 2 (2) | `jump-landing`, `nordic-curl`, `copenhagen-plank`, `standing-calf-raise` | 6 · 7,5 · 10 · 5 · 5 · 5 | 4 à 10 |

Volume calculé comme le validateur (05 §5, règle 6) : premier exercice faisable de chaque slot dans le profil de référence du contexte (`gym_reference` à la salle, `home_bodyweight` à la maison et pour le sport), au nombre de jours par défaut, muscle principal 1 série, secondaire 0,5. À la maison et pour le sport, les slots qui exigent du petit matériel (tirages verticaux, élévations latérales, extension des triceps, rotation externe) ne comptent donc pas. Plusieurs groupes sont pile sur une borne (fessiers de GD et MD à 12, de SD et SI à 10 ; quadriceps de MD à 6 et de SD à 4 ; dorsaux de MI à 10 et de SD à 4) : toute correction de muscles à la relecture peut faire échouer `pnpm data:validate`, ce qui est voulu, et un changement d'instance qui baisse (ou monte) un de ces groupes sera refusé (`volume_out_of_range`).

## Liste

Colonnes :

- **Chaîne** : `chain_id` et rang de la fiche, du plus facile (1) au plus dur.
- **Niv.** : niveau (`level`) ; **Min.** : `not_for_minors`.
- **Sensible** : prévision reprise de la liste provisoire, car `stressed_joints` sera rempli à la rédaction ; la valeur définitive est calculée (`isSensitive` : niveau 2 ou plus, déconseillée aux mineurs, ou articulation parmi bas du dos, genoux, épaules, nuque). « oui » : certain (niveau, mineurs, ou étalon déjà rédigé) ; « probable » et « ? » : selon l'articulation entre parenthèses ; « non » : aucune articulation sensible attendue.
- **Muscles** : `primary_muscles` ; `secondary_muscles` (libellés de `MUSCLE_LABELS`). Ceux des deux étalons viennent de leur rédaction ; les autres sont renseignés à la main (voir plus haut).
- **(a) slots** : modèles qui citent la fiche dans la liste d'un slot. **(b) chaînes** : modèles qui utilisent sa chaîne.

### Squat et fente (11)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Muscles (principaux ; secondaires) | (a) slots | (b) chaînes |
|---|---|---|---|---|---|---|---|---|---|
| `chair-squat` | Squat sur chaise | `squat` | `bodyweight-squat` (1/5) | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | — | MD, MI |
| `bodyweight-squat` | Squat au poids du corps | `squat` | `bodyweight-squat` (2/5) | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | GD, GI, SD | MD, MI |
| `reverse-lunge` | Fente arrière | `lunge` | `bodyweight-squat` (3/5) | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | GD, GI | MD, MI |
| `bulgarian-split-squat` | Fente bulgare | `lunge` | `bodyweight-squat` (4/5) | 2 | non | oui (niveau 2) | quadriceps, fessiers ; adducteurs | GI | MD, MI |
| `assisted-pistol-squat` | Squat sur une jambe assisté | `lunge` | `bodyweight-squat` (5/5) | 2 | non | oui (niveau 2) | quadriceps, fessiers ; adducteurs | — | MD, MI |
| `goblet-squat` | Squat goblet | `squat` | — | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | GD, GI, SD, SI | — |
| `back-squat` | Squat barre | `squat` | — | 2 | non | oui (niveau 2) | quadriceps, fessiers ; adducteurs, lombaires | GD, GI, SI | — |
| `leg-press` | Presse à cuisses | `squat` | — | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | GD, GI, SI | — |
| `dumbbell-reverse-lunge` | Fente arrière aux haltères | `lunge` | — | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | GD, GI | — |
| `dumbbell-step-up` | Step-up aux haltères | `lunge` | — | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | MI, SI | — |
| `step-up` | Step-up | `lunge` | — | 1 | non | probable (genoux) | quadriceps, fessiers ; adducteurs | MI, SI | — |

### Hanche, ischios, mollets, adducteurs (17)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Muscles (principaux ; secondaires) | (a) slots | (b) chaînes |
|---|---|---|---|---|---|---|---|---|---|
| `dumbbell-romanian-deadlift` | Soulevé de terre roumain aux haltères | `hip_hinge` | — | 1 | non | oui (bas du dos), **étalon** | fessiers, ischio-jambiers ; lombaires, avant-bras | GD, GI, MI, SD, SI | — |
| `romanian-deadlift` | Soulevé de terre roumain | `hip_hinge` | — | 2 | non | oui (niveau 2) | ischio-jambiers, fessiers ; lombaires, avant-bras | GD, GI, SI | — |
| `deadlift` | Soulevé de terre | `hip_hinge` | — | 2 | non | oui (niveau 2) | fessiers, ischio-jambiers, lombaires ; quadriceps, trapèzes, avant-bras | GI, SI | — |
| `single-leg-romanian-deadlift` | Soulevé de terre roumain unipodal | `hip_hinge` | — | 2 | non | oui (niveau 2) | ischio-jambiers, fessiers ; lombaires | MI, SD, SI | — |
| `glute-bridge` | Pont fessier | `glute_bridge` | `glute-bridge` (1/3) | 1 | non | non | fessiers ; ischio-jambiers | — | MD |
| `single-leg-glute-bridge` | Pont fessier unipodal | `glute_bridge` | `glute-bridge` (2/3) | 1 | non | non | fessiers ; ischio-jambiers | — | MD |
| `hip-thrust` | Hip thrust | `glute_bridge` | `glute-bridge` (3/3) | 1 | non | ? (bas du dos) | fessiers ; ischio-jambiers | — | MD |
| `assisted-nordic-curl` | Nordic assisté | `knee_flexion` | `nordic-curl` (1/2) | 1 | non | probable (genoux) | ischio-jambiers ; mollets | GD, GI | MD, MI, SD, SI |
| `nordic-curl` | Nordic | `knee_flexion` | `nordic-curl` (2/2) | 2 | non | oui (niveau 2) | ischio-jambiers ; mollets | — | MD, MI, SD, SI |
| `leg-curl` | Leg curl | `knee_flexion` | — | 1 | non | ? (genoux) | ischio-jambiers ; mollets | GD, GI | — |
| `leg-extension` | Leg extension | `knee_extension` | — | 1 | non | probable (genoux) | quadriceps ; — | GI | — |
| `standing-calf-raise` | Mollets debout | `calf_raise` | `standing-calf-raise` (1/2) | 1 | non | non | mollets ; — | GI | MI, SD, SI |
| `single-leg-calf-raise` | Mollets debout sur une jambe | `calf_raise` | `standing-calf-raise` (2/2) | 1 | non | non | mollets ; — | — | MI, SD, SI |
| `leg-press-calf-raise` | Mollets à la presse | `calf_raise` | — | 1 | non | non | mollets ; — | GI | — |
| `copenhagen-plank-short-lever` | Planche de Copenhague genou en appui | `hip_adduction_abduction` | `copenhagen-plank` (1/3) | 1 | non | ? (genoux) | adducteurs ; obliques, abdominaux | SD | SI |
| `copenhagen-plank` | Planche de Copenhague | `hip_adduction_abduction` | `copenhagen-plank` (2/3) | 2 | non | oui (niveau 2) | adducteurs ; obliques, abdominaux | — | SI |
| `copenhagen-plank-leg-raise` | Planche de Copenhague avec levée de jambe | `hip_adduction_abduction` | `copenhagen-plank` (3/3) | 3 | oui | oui (niveau 3, mineurs) | adducteurs ; obliques, abdominaux | — | SI |

### Poussées (13)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Muscles (principaux ; secondaires) | (a) slots | (b) chaînes |
|---|---|---|---|---|---|---|---|---|---|
| `wall-push-up` | Pompe murale | `horizontal_push` | `push-up` (1/5) | 1 | non | ? (épaules) | pectoraux, triceps ; deltoïdes antérieurs | — | MD, MI |
| `incline-push-up` | Pompe inclinée | `horizontal_push` | `push-up` (2/5) | 1 | non | probable (épaules) | pectoraux, triceps ; deltoïdes antérieurs, abdominaux | — | MD, MI |
| `push-up` | Pompe | `horizontal_push` | `push-up` (3/5) | 1 | non | oui (épaules), **étalon** | pectoraux, triceps ; deltoïdes antérieurs, abdominaux | GD, GI, SD, SI | MD, MI |
| `decline-push-up` | Pompe pieds surélevés | `horizontal_push` | `push-up` (4/5) | 2 | non | oui (niveau 2) | pectoraux, triceps ; deltoïdes antérieurs, abdominaux | — | MD, MI |
| `archer-push-up` | Pompe archer | `horizontal_push` | `push-up` (5/5) | 3 | oui | oui (niveau 3, mineurs) | pectoraux, triceps ; deltoïdes antérieurs, abdominaux | — | MD, MI |
| `bench-press` | Développé couché | `horizontal_push` | — | 2 | non | oui (niveau 2) | pectoraux, triceps ; deltoïdes antérieurs | GD, GI, SI | — |
| `dumbbell-bench-press` | Développé couché aux haltères | `horizontal_push` | — | 1 | non | probable (épaules) | pectoraux ; deltoïdes antérieurs, triceps | GD, GI, SD, SI | — |
| `incline-dumbbell-bench-press` | Développé incliné aux haltères | `horizontal_push` | — | 1 | non | probable (épaules) | pectoraux ; deltoïdes antérieurs, triceps | GI | — |
| `machine-chest-press` | Développé couché à la machine | `horizontal_push` | — | 1 | non | probable (épaules) | pectoraux ; deltoïdes antérieurs, triceps | GD, GI | — |
| `overhead-press` | Développé militaire | `vertical_push` | — | 2 | non | oui (niveau 2) | deltoïdes antérieurs, triceps ; deltoïdes latéraux, trapèzes, abdominaux | GD, GI | — |
| `seated-dumbbell-shoulder-press` | Développé épaules assis aux haltères | `vertical_push` | — | 1 | non | probable (épaules) | deltoïdes antérieurs, triceps ; deltoïdes latéraux, trapèzes | GD, GI, SD | — |
| `pike-push-up` | Pompe pike | `vertical_push` | `pike-push-up` (1/2) | 1 | non | probable (épaules) | deltoïdes antérieurs, triceps ; deltoïdes latéraux, pectoraux | GD, GI, SD | MI |
| `elevated-pike-push-up` | Pompe pike pieds surélevés | `vertical_push` | `pike-push-up` (2/2) | 2 | non | oui (niveau 2) | deltoïdes antérieurs, triceps ; deltoïdes latéraux, trapèzes | — | MI |

### Tirages (11)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Muscles (principaux ; secondaires) | (a) slots | (b) chaînes |
|---|---|---|---|---|---|---|---|---|---|
| `barbell-row` | Rowing barre | `horizontal_pull` | — | 2 | non | oui (niveau 2) | dorsaux, trapèzes ; deltoïdes postérieurs, biceps, lombaires | GI | — |
| `one-arm-dumbbell-row` | Rowing haltère à un bras | `horizontal_pull` | — | 1 | non | ? (bas du dos) | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | GD, GI, MD, MI, SD, SI | — |
| `seated-cable-row` | Tirage horizontal | `horizontal_pull` | — | 1 | non | ? (bas du dos) | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | GD, GI, SD, SI | — |
| `table-row` | Rowing sous la table | `horizontal_pull` | — | 1 | non | non | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | GD, GI, MD, MI, SD, SI | — |
| `band-row` | Rowing à l'élastique | `horizontal_pull` | — | 1 | non | non | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | MD, MI, SD, SI | — |
| `lat-pulldown` | Tirage vertical | `vertical_pull` | — | 1 | non | probable (épaules) | dorsaux ; biceps, trapèzes | GD, GI, SD | — |
| `band-lat-pulldown` | Tirage vertical à l'élastique | `vertical_pull` | — | 1 | non | ? (épaules) | dorsaux ; biceps, trapèzes | MD, MI, SD | — |
| `negative-pull-up` | Traction négative | `vertical_pull` | `pull-up` (1/4) | 1 | non | probable (épaules) | dorsaux ; biceps, trapèzes | GD, MD | MI |
| `band-assisted-pull-up` | Traction assistée à l'élastique | `vertical_pull` | `pull-up` (2/4) | 1 | non | probable (épaules) | dorsaux ; biceps, trapèzes | GD, GI, MD, MI, SD | MI |
| `pull-up` | Traction | `vertical_pull` | `pull-up` (3/4) | 2 | non | oui (niveau 2) | dorsaux ; biceps, trapèzes | GI | MI |
| `weighted-pull-up` | Traction lestée | `vertical_pull` | `pull-up` (4/4) | 3 | oui | oui (niveau 3, mineurs) | dorsaux ; biceps, trapèzes | — | MI |

### Isolation des bras et des épaules (6)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Muscles (principaux ; secondaires) | (a) slots | (b) chaînes |
|---|---|---|---|---|---|---|---|---|---|
| `dumbbell-lateral-raise` | Élévation latérale aux haltères | `shoulder_isolation` | — | 1 | non | probable (épaules) | deltoïdes latéraux ; deltoïdes antérieurs, trapèzes | GI, MI | — |
| `face-pull` | Face pull | `shoulder_isolation` | — | 1 | non | probable (épaules) | deltoïdes postérieurs ; coiffe des rotateurs, trapèzes | GI | — |
| `band-external-rotation` | Rotation externe à l'élastique | `shoulder_isolation` | — | 1 | non | probable (épaules) | coiffe des rotateurs ; deltoïdes postérieurs | SI | — |
| `dumbbell-curl` | Curl biceps aux haltères | `elbow_flexion` | — | 1 | non | non | biceps ; avant-bras | GI | — |
| `cable-triceps-pushdown` | Extension triceps à la poulie | `elbow_extension` | — | 1 | non | non | triceps ; — | GI | — |
| `overhead-dumbbell-triceps-extension` | Extension triceps au-dessus de la tête | `elbow_extension` | — | 1 | non | probable (épaules) | triceps ; — | GI, MI | — |

### Tronc et pliométrie (8)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Muscles (principaux ; secondaires) | (a) slots | (b) chaînes |
|---|---|---|---|---|---|---|---|---|---|
| `knee-plank` | Planche sur les genoux | `core_anti_extension` | `front-plank` (1/3) | 1 | non | non | abdominaux ; obliques | — | GD, GI, MD, MI |
| `front-plank` | Planche | `core_anti_extension` | `front-plank` (2/3) | 1 | non | ? (bas du dos) | abdominaux ; obliques | — | GD, GI, MD, MI |
| `hollow-body-hold` | Hollow body | `core_anti_extension` | `front-plank` (3/3) | 1 | non | ? (bas du dos) | abdominaux ; obliques | — | GD, GI, MD, MI |
| `side-plank` | Planche latérale | `core_anti_rotation` | — | 1 | non | ? (épaules) | obliques ; abdominaux, fessiers | MI, SD, SI | — |
| `band-pallof-press` | Pallof press à l'élastique | `core_anti_rotation` | — | 1 | non | non | obliques, abdominaux ; — | GI | — |
| `cable-pallof-press` | Pallof press à la poulie | `core_anti_rotation` | — | 1 | non | non | obliques, abdominaux ; — | GI | — |
| `jump-landing` | Réception de saut | `plyometrics` | `jump-landing` (1/2) | 1 | non | probable (genoux) | quadriceps, fessiers ; ischio-jambiers, mollets | — | SI |
| `squat-jump` | Squat sauté | `plyometrics` | `jump-landing` (2/2) | 1 | non | probable (genoux) | quadriceps, fessiers ; ischio-jambiers, mollets | — | SI |

Bilan de la prévision (inchangé) : 19 fiches sensibles à coup sûr, 25 probables, 10 incertaines et 12 non sensibles. Environ 45 à 55 des 66 fiches passeront donc par le feu vert santé.

## Écarts à la liste provisoire

**Aucune fiche ajoutée ni retirée.** Les écarts portent sur les modèles qui citent chaque fiche (ancienne colonne « Modèles ») :

- **Fiches qu'un modèle prévu ne cite plus, mais qui restent au lot A par un autre modèle** :
  - `hip-thrust` n'est plus dans GI (le bas du corps de GI a déjà son volume de fessiers) : il reste au lot A comme 3e membre de la chaîne `glute-bridge` de MD, où il n'est utilisable qu'avec barre et banc ;
  - `weighted-pull-up` n'est plus dans GI (les tirages verticaux de GI sont à la poulie, donc chargeables) : il reste comme 4e membre de la chaîne `pull-up` de MI ;
  - `dumbbell-lateral-raise`, `face-pull` et `dumbbell-curl` ne sont plus dans GD, dont le volume de deltoïdes est déjà proche du plafond (10,5 sur 12) : ils restent par GI (et MI pour les élévations latérales) ;
  - `glute-bridge`, `incline-push-up` et `reverse-lunge` ne sont plus dans SD, dont chaque slot va du plus chargé au poids du corps avec un seul exercice au poids du corps (05 §3) ; `goblet-squat`, `dumbbell-romanian-deadlift` et `pull-up` ne sont plus dans MD, fait de chaînes ;
  - `band-pallof-press` et `cable-pallof-press` ne sont plus dans SD ni SI : l'anti-rotation des modèles sport doit être faisable sans matériel (règle 4), c'est donc la planche latérale ; les deux Pallof passent dans GI (Bas 2).
- **Fiches citées par plus de modèles que prévu** : `table-row` et `one-arm-dumbbell-row` (les 6 modèles), `assisted-nordic-curl` (repli du leg curl dans GD et GI, et chaîne `nordic-curl` dans MD, MI, SD, SI), `single-leg-romanian-deadlift` (MI, SD, SI : seule charnière de hanche au poids du corps), `side-plank` (MI, SD, SI), `pike-push-up` (repli au poids du corps du développé militaire dans GD et GI), `leg-curl` (GD), `deadlift`, `bench-press`, `leg-press`, `romanian-deadlift` et `seated-cable-row` (SI), `dumbbell-step-up` et `step-up` (MI), `standing-calf-raise` (GI, et chaîne de MI, SD, SI).

## Choix faits, à valider

1. **Contenu des modèles.** Chaque modèle reprend sa ligne de 05 §3 ; les écarts imposés par le validateur sont détaillés dans le rapport de la tâche 8 et rappelés ici quand ils touchent la liste : une poussée horizontale en accessoire dans la séance B de GD (le développé couché seul donnait 4,5 séries de pectoraux par semaine, sous le minimum de 6) ; un leg curl dans la séance A de GD (le soulevé de terre roumain seul donnait 4,5 séries d'ischio-jambiers) ; un Nordic assisté dans MD (sans matériel, le pont fessier ne compte les ischio-jambiers qu'en secondaire) ; des poussées et des tirages dans SI (05 §3 ne les cite pas, mais la règle 4 exige les groupes poussée et tirage chaque semaine).
2. **Muscles, choix à relire** : le squat, la fente, le step-up, la presse et les sauts ont les fessiers en principal ; les fentes n'ont pas les ischio-jambiers ; les rowings ont les deltoïdes postérieurs en secondaire, les tirages verticaux et les tractions non ; la pompe pike a les pectoraux en secondaire (poussée inclinée), pas sa variante pieds surélevés ; le soulevé de terre a les lombaires en principal ; la planche latérale a les fessiers (moyen fessier) en secondaire ; les Nordic et le leg curl ont les mollets (jumeaux) en secondaire. Chaque chaîne garde au moins un muscle principal commun (R-CH-3).
3. **Dix chaînes**, chacune nommée d'après un de ses membres : `push-up` et `bodyweight-squat` (5 membres, 04 §7 et 05) ; `pull-up` (4) ; `glute-bridge`, `front-plank`, `copenhagen-plank` (3) ; `pike-push-up`, `nordic-curl`, `standing-calf-raise`, `jump-landing` (2). Les quatre dernières ne figurent pas telles quelles dans 04 §7 : elles portent les progressions de 05 (« mollets » puis « mollets unipodaux », « réceptions de sauts », Nordic en excentrique, pike). Les 10 sont utilisées par au moins un modèle.
4. **Une chaîne garde la même mesure** (répétitions ou durée) : un slot `chain` n'a qu'un type de séries (05 §4, `durationS` pour `front-plank`). D'où la chaîne de gainage tout en durée (planche sur les genoux → planche → hollow body), le dead bug (en répétitions) laissé hors chaîne au lot B, et les trois niveaux de Copenhague en durée. Pour la même raison, une liste de slot ne mêle jamais répétitions et durée (Pallof et planche latérale sont dans des slots distincts).
5. **Niveaux.** Les mouvements à la barre sont au niveau 2 (sauf le hip thrust, 1) : ils sont sensibles et ne sont pas proposés comme remplaçants automatiques à un débutant ; un modèle débutant peut toujours les citer dans ses slots (GD le fait). Niveau 3 et déconseillées aux mineurs (R-FIC-3) : pompe archer, traction lestée, Copenhague avec levée de jambe. Le « Nordic complet » de 04 §3.5 (niveau 3) n'est pas créé : la chaîne s'arrête au Nordic en excentrique (05, `home-intermediate-upper-lower`). Le soulevé de terre roumain unipodal (niveau 2) est le repli au poids du corps de la charnière dans SD, un modèle débutant.
6. **Tractions** : l'ordre de 04 §7 est gardé (négatives, puis assistées à l'élastique, puis traction, puis lestée). Beaucoup de progressions mettent l'assistance avant les négatives ; les listes de GD et MD mettent d'ailleurs la traction assistée avant la négative.
7. **Copenhague en 3 niveaux** (05 cite Harøy 2019 sans détailler les niveaux) : genou en appui (niveau 1), pied en appui (2), pied en appui avec la jambe du dessous levée (3). SD ne prend que le niveau 1 (une liste, pas la chaîne) ; SI prend la chaîne. Découpage à confirmer par la relectrice santé.
8. **Matériel.** Un exercice à deux charges (une par main) ne propose que `dumbbells` : le code `kettlebell` ne dit pas combien on en a. Un exercice à une seule charge (squat goblet, rowing à un bras, extension au-dessus de la tête) propose `dumbbells` ou `kettlebell`. Le développé couché et le développé militaire exigent `squat_rack` (sécurités, appui de la barre). Les supports (chaise, banc, box) sont au choix. Le Nordic et le squat sur une jambe assisté sont `[[]]` : talons calés sous un meuble lourd ou tenus par un partenaire, appui à un montant de porte ; ces appuis ne sont pas des codes de matériel.
9. **Noms.** La version à la barre garde le nom court quand c'est l'usage (« Développé couché », « Développé militaire », « Soulevé de terre roumain ») ; « Squat barre » et « Rowing barre » reprennent 04 §7 ; sinon le matériel est dans le nom (« aux haltères », « à la poulie », « à l'élastique », « à la machine »). « Pompe pike » parce que le glossaire refuse « push-up » dans le texte. Noms anglais gardés car courants en salle : Hip thrust, Leg curl, Leg extension, Step-up, Face pull, Pallof press, Hollow body.
10. **`mechanics`** : pont fessier et hip thrust en `compound` (mouvements principaux de la charnière) ; planches, Pallof, Copenhague, mollets et isolations en `isolation`. **`unilateral`** vrai pour toutes les fentes, le step-up, le squat sur une jambe, les ponts et soulevés de terre unipodaux, le rowing à un bras, la pompe archer, la rotation externe, la planche latérale, Pallof et Copenhague (saisie par côté).

## Laissées hors du lot A (lot B probable)

Exemples de 04 §7 que les modèles ne demandent pas directement : squat avant, fente latérale, swing, hyperextension, abduction à l'élastique, écarté, dips (barres et chaise), rowing inversé, chin-up, élévation latérale à la poulie, oiseau, écartement à l'élastique, les autres curls et extensions des triceps, dead bug, roue abdominale (aucun code de matériel ne la décrit), bird dog, crunch, relevés de jambes, marche du fermier, port unilatéral, pogo, bonds latéraux, box jump. S'y ajoutent les remplaçants exigés par la condition (c) pour les slots des 6 modèles (tâche 9, `docs/catalog/lot-b.md`).

**R-EQ-5** (`pnpm data:validate --strict`) : 5 codes de matériel ne sont encore utilisés par aucune fiche, `back_extension_bench`, `dip_station`, `ez_bar`, `smith_machine` et `suspension_trainer`. Le lot B les couvrira (hyperextension, dips, curl à la barre EZ, rowing inversé aux sangles, variantes à la barre guidée).

## Questions pour le propriétaire

1. Valider la liste et les ids (66 fiches, inchangée) ; corriger ids et noms avant le prochain déploiement.
2. Relire les muscles (colonne « Muscles », choix 2) : ce sont eux qui font passer ou échouer la règle de volume des modèles.
3. Trancher les choix 3 à 9, surtout : niveaux des mouvements à la barre, ordre des tractions, découpage de Copenhague, chaînes ajoutées (pike, Nordic, mollets, sauts).
4. Abréviations courantes (« RDL », « DC »…) : le glossaire les refuse, donc elles ne sont pas dans les alias et la recherche ne les trouve pas. Les admettre dans `aliases` seulement ?
