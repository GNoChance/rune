# Lot A provisoire

**Liste provisoire : le propriétaire la valide avant toute rédaction.**

Le lot A réunit les fiches des conditions (a) et (b) de 04 §7 : celles qu'un des 6 modèles de programmes met dans un slot, et les membres des chaînes que ces modèles utilisent (spec de la brique 2, §2 et D11). Les modèles ne sont pas encore écrits (brique 3) : cette liste est déduite du tableau de 04 §7 et des contenus de modèles de 05 §3. Elle sera revue quand les modèles existeront.

- **66 fiches**, toutes au statut `draft` et au lot `A`, une par fichier `data/exercises/<id>.json`.
- **2 fiches étalons** rédigées à la main (04 §8, étape 0) : `push-up` et `dumbbell-romanian-deadlift`. Elles attendent la relecture de l'admin et des relectrices.
- **64 squelettes** : seulement les champs « squelette » de 04 §4 et `batch` (ni champ IA, ni illustration, ni `drafting`). `pnpm exercises:draft` les rédigera après validation.
- `pnpm data:validate` passe. `pnpm data:validate --strict` échoue sur R-EQ-5 seulement (voir plus bas), ce qui est attendu avant le lot B.

**Les ids sont immuables** une fois chargés dans une base qui fait foi (04 §2) : c'est maintenant qu'on les corrige, avant le prochain déploiement.

## Liste

Colonnes :

- **Chaîne** : `chain_id` et rang de la fiche, du plus facile (1) au plus dur.
- **Niv.** : niveau (`level`) ; **Min.** : `not_for_minors`.
- **Sensible** : prévision, car `stressed_joints` sera rempli à la rédaction ; la valeur définitive est calculée (`isSensitive` : niveau 2 ou plus, déconseillée aux mineurs, ou articulation parmi bas du dos, genoux, épaules, nuque). « oui » : certain (niveau, mineurs, ou étalon déjà rédigé) ; « probable » et « ? » : selon l'articulation entre parenthèses ; « non » : aucune articulation sensible attendue.
- **Modèles** : modèles qui devraient l'utiliser. GD `gym-beginner-full-body-ab`, GI `gym-intermediate-upper-lower`, MD `home-beginner-full-body`, MI `home-intermediate-upper-lower`, SD `sport-beginner-complement`, SI `sport-intermediate-strength-prevention`. « chaîne » : condition (b) seulement.

### Squat et fente (11)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Modèles |
|---|---|---|---|---|---|---|---|
| `chair-squat` | Squat sur chaise | `squat` | `bodyweight-squat` (1/5) | 1 | non | probable (genoux) | MD, chaîne |
| `bodyweight-squat` | Squat au poids du corps | `squat` | `bodyweight-squat` (2/5) | 1 | non | probable (genoux) | GD, MD, SD |
| `reverse-lunge` | Fente arrière | `lunge` | `bodyweight-squat` (3/5) | 1 | non | probable (genoux) | GD, MD, SD |
| `bulgarian-split-squat` | Fente bulgare | `lunge` | `bodyweight-squat` (4/5) | 2 | non | oui (niveau 2) | GI, MD, MI |
| `assisted-pistol-squat` | Squat sur une jambe assisté | `lunge` | `bodyweight-squat` (5/5) | 2 | non | oui (niveau 2) | MI |
| `goblet-squat` | Squat goblet | `squat` | — | 1 | non | probable (genoux) | GD, MD, SD |
| `back-squat` | Squat barre | `squat` | — | 2 | non | oui (niveau 2) | GD, GI, SI |
| `leg-press` | Presse à cuisses | `squat` | — | 1 | non | probable (genoux) | GD, GI |
| `dumbbell-reverse-lunge` | Fente arrière aux haltères | `lunge` | — | 1 | non | probable (genoux) | GD |
| `dumbbell-step-up` | Step-up aux haltères | `lunge` | — | 1 | non | probable (genoux) | SI |
| `step-up` | Step-up | `lunge` | — | 1 | non | probable (genoux) | SI |

### Hanche, ischios, mollets, adducteurs (17)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Modèles |
|---|---|---|---|---|---|---|---|
| `dumbbell-romanian-deadlift` | Soulevé de terre roumain aux haltères | `hip_hinge` | — | 1 | non | oui (bas du dos), **étalon** | GD, MD, SD |
| `romanian-deadlift` | Soulevé de terre roumain | `hip_hinge` | — | 2 | non | oui (niveau 2) | GD, GI |
| `deadlift` | Soulevé de terre | `hip_hinge` | — | 2 | non | oui (niveau 2) | GI, SI |
| `single-leg-romanian-deadlift` | Soulevé de terre roumain unipodal | `hip_hinge` | — | 2 | non | oui (niveau 2) | MI |
| `glute-bridge` | Pont fessier | `glute_bridge` | `glute-bridge` (1/3) | 1 | non | non | MD, SD |
| `single-leg-glute-bridge` | Pont fessier unipodal | `glute_bridge` | `glute-bridge` (2/3) | 1 | non | non | MD |
| `hip-thrust` | Hip thrust | `glute_bridge` | `glute-bridge` (3/3) | 1 | non | ? (bas du dos) | GI |
| `assisted-nordic-curl` | Nordic assisté | `knee_flexion` | `nordic-curl` (1/2) | 1 | non | probable (genoux) | SD, MI, SI |
| `nordic-curl` | Nordic | `knee_flexion` | `nordic-curl` (2/2) | 2 | non | oui (niveau 2) | MI, SI |
| `leg-curl` | Leg curl | `knee_flexion` | — | 1 | non | ? (genoux) | GI |
| `leg-extension` | Leg extension | `knee_extension` | — | 1 | non | probable (genoux) | GI |
| `standing-calf-raise` | Mollets debout | `calf_raise` | `standing-calf-raise` (1/2) | 1 | non | non | SD |
| `single-leg-calf-raise` | Mollets debout sur une jambe | `calf_raise` | `standing-calf-raise` (2/2) | 1 | non | non | SI |
| `leg-press-calf-raise` | Mollets à la presse | `calf_raise` | — | 1 | non | non | GI |
| `copenhagen-plank-short-lever` | Planche de Copenhague genou en appui | `hip_adduction_abduction` | `copenhagen-plank` (1/3) | 1 | non | ? (genoux) | SD |
| `copenhagen-plank` | Planche de Copenhague | `hip_adduction_abduction` | `copenhagen-plank` (2/3) | 2 | non | oui (niveau 2) | SI |
| `copenhagen-plank-leg-raise` | Planche de Copenhague avec levée de jambe | `hip_adduction_abduction` | `copenhagen-plank` (3/3) | 3 | oui | oui (niveau 3, mineurs) | SI |

### Poussées (13)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Modèles |
|---|---|---|---|---|---|---|---|
| `wall-push-up` | Pompe murale | `horizontal_push` | `push-up` (1/5) | 1 | non | ? (épaules) | MD |
| `incline-push-up` | Pompe inclinée | `horizontal_push` | `push-up` (2/5) | 1 | non | probable (épaules) | MD, SD |
| `push-up` | Pompe | `horizontal_push` | `push-up` (3/5) | 1 | non | oui (épaules), **étalon** | MD, SD |
| `decline-push-up` | Pompe pieds surélevés | `horizontal_push` | `push-up` (4/5) | 2 | non | oui (niveau 2) | MD, MI |
| `archer-push-up` | Pompe archer | `horizontal_push` | `push-up` (5/5) | 3 | oui | oui (niveau 3, mineurs) | MI |
| `bench-press` | Développé couché | `horizontal_push` | — | 2 | non | oui (niveau 2) | GD, GI |
| `dumbbell-bench-press` | Développé couché aux haltères | `horizontal_push` | — | 1 | non | probable (épaules) | GD, GI, SD |
| `incline-dumbbell-bench-press` | Développé incliné aux haltères | `horizontal_push` | — | 1 | non | probable (épaules) | GI |
| `machine-chest-press` | Développé couché à la machine | `horizontal_push` | — | 1 | non | probable (épaules) | GD |
| `overhead-press` | Développé militaire | `vertical_push` | — | 2 | non | oui (niveau 2) | GD, GI |
| `seated-dumbbell-shoulder-press` | Développé épaules assis aux haltères | `vertical_push` | — | 1 | non | probable (épaules) | GD, GI, SD |
| `pike-push-up` | Pompe pike | `vertical_push` | `pike-push-up` (1/2) | 1 | non | probable (épaules) | MI, SD |
| `elevated-pike-push-up` | Pompe pike pieds surélevés | `vertical_push` | `pike-push-up` (2/2) | 2 | non | oui (niveau 2) | MI |

### Tirages (11)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Modèles |
|---|---|---|---|---|---|---|---|
| `barbell-row` | Rowing barre | `horizontal_pull` | — | 2 | non | oui (niveau 2) | GI |
| `one-arm-dumbbell-row` | Rowing haltère à un bras | `horizontal_pull` | — | 1 | non | ? (bas du dos) | GD, MD, SD |
| `seated-cable-row` | Tirage horizontal | `horizontal_pull` | — | 1 | non | ? (bas du dos) | GD, GI, SD |
| `table-row` | Rowing sous la table | `horizontal_pull` | — | 1 | non | non | MD, SD |
| `band-row` | Rowing à l'élastique | `horizontal_pull` | — | 1 | non | non | MD, SD |
| `lat-pulldown` | Tirage vertical | `vertical_pull` | — | 1 | non | probable (épaules) | GD, GI, SD |
| `band-lat-pulldown` | Tirage vertical à l'élastique | `vertical_pull` | — | 1 | non | ? (épaules) | MD, SD |
| `negative-pull-up` | Traction négative | `vertical_pull` | `pull-up` (1/4) | 1 | non | probable (épaules) | MD, chaîne |
| `band-assisted-pull-up` | Traction assistée à l'élastique | `vertical_pull` | `pull-up` (2/4) | 1 | non | probable (épaules) | MD, SD |
| `pull-up` | Traction | `vertical_pull` | `pull-up` (3/4) | 2 | non | oui (niveau 2) | GI, MD, MI |
| `weighted-pull-up` | Traction lestée | `vertical_pull` | `pull-up` (4/4) | 3 | oui | oui (niveau 3, mineurs) | GI, chaîne |

### Isolation des bras et des épaules (6)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Modèles |
|---|---|---|---|---|---|---|---|
| `dumbbell-lateral-raise` | Élévation latérale aux haltères | `shoulder_isolation` | — | 1 | non | probable (épaules) | GD, GI |
| `face-pull` | Face pull | `shoulder_isolation` | — | 1 | non | probable (épaules) | GD, GI |
| `band-external-rotation` | Rotation externe à l'élastique | `shoulder_isolation` | — | 1 | non | probable (épaules) | SI |
| `dumbbell-curl` | Curl biceps aux haltères | `elbow_flexion` | — | 1 | non | non | GD, GI |
| `cable-triceps-pushdown` | Extension triceps à la poulie | `elbow_extension` | — | 1 | non | non | GI |
| `overhead-dumbbell-triceps-extension` | Extension triceps au-dessus de la tête | `elbow_extension` | — | 1 | non | probable (épaules) | GI, MI |

### Tronc et pliométrie (8)

| id | Nom | Pattern | Chaîne | Niv. | Min. | Sensible | Modèles |
|---|---|---|---|---|---|---|---|
| `knee-plank` | Planche sur les genoux | `core_anti_extension` | `front-plank` (1/3) | 1 | non | non | GD, MD |
| `front-plank` | Planche | `core_anti_extension` | `front-plank` (2/3) | 1 | non | ? (bas du dos) | GD, MD |
| `hollow-body-hold` | Hollow body | `core_anti_extension` | `front-plank` (3/3) | 1 | non | ? (bas du dos) | MD |
| `side-plank` | Planche latérale | `core_anti_rotation` | — | 1 | non | ? (épaules) | SD, SI |
| `band-pallof-press` | Pallof press à l'élastique | `core_anti_rotation` | — | 1 | non | non | SD, SI |
| `cable-pallof-press` | Pallof press à la poulie | `core_anti_rotation` | — | 1 | non | non | SD, SI |
| `jump-landing` | Réception de saut | `plyometrics` | `jump-landing` (1/2) | 1 | non | probable (genoux) | SI |
| `squat-jump` | Squat sauté | `plyometrics` | `jump-landing` (2/2) | 1 | non | probable (genoux) | SI |

Bilan de la prévision : 19 fiches sensibles à coup sûr, 25 probables, 10 incertaines et 12 non sensibles. Environ 45 à 55 des 66 fiches passeront donc par le feu vert santé.

## Choix faits, à valider

1. **Contenu des modèles supposé.** Les slots viennent des contenus de 05 §3 (et de l'extrait de 05 §4 : `back-squat`, `goblet-squat`, `leg-press`, `bodyweight-squat`, chaîne `front-plank`). Pour chaque slot, on garde les premiers choix plausibles par profil de référence ; les remplaçants qui ne servent qu'à la condition (c) vont au lot B.
2. **Dix chaînes**, chacune nommée d'après un de ses membres : `push-up` et `bodyweight-squat` (5 membres, 04 §7 et 05) ; `pull-up` (4) ; `glute-bridge`, `front-plank`, `copenhagen-plank` (3) ; `pike-push-up`, `nordic-curl`, `standing-calf-raise`, `jump-landing` (2). Les quatre dernières ne figurent pas telles quelles dans 04 §7 : elles portent les progressions de 05 (« mollets » puis « mollets unipodaux », « réceptions de sauts », Nordic en excentrique, pike).
3. **Une chaîne garde la même mesure** (répétitions ou durée) : un slot `chain` n'a qu'un type de séries (05 §4, `durationS` pour `front-plank`). D'où la chaîne de gainage tout en durée (planche sur les genoux → planche → hollow body), le dead bug (en répétitions) laissé hors chaîne au lot B, et les trois niveaux de Copenhague en durée.
4. **Niveaux.** Les mouvements à la barre sont au niveau 2 (sauf le hip thrust, 1) : ils sont sensibles et ne sont pas proposés comme remplaçants automatiques à un débutant ; un modèle débutant peut toujours les citer dans ses slots. Niveau 3 et déconseillées aux mineurs (R-FIC-3) : pompe archer, traction lestée, Copenhague avec levée de jambe. Le « Nordic complet » de 04 §3.5 (niveau 3) n'est pas créé : la chaîne s'arrête au Nordic en excentrique (05, `home-intermediate-upper-lower`).
5. **Tractions** : l'ordre de 04 §7 est gardé (négatives, puis assistées à l'élastique, puis traction, puis lestée). Beaucoup de progressions mettent l'assistance avant les négatives.
6. **Copenhague en 3 niveaux** (05 cite Harøy 2019 sans détailler les niveaux) : genou en appui (niveau 1), pied en appui (2), pied en appui avec la jambe du dessous levée (3). Découpage à confirmer par la relectrice santé.
7. **Matériel.** Un exercice à deux charges (une par main) ne propose que `dumbbells` : le code `kettlebell` ne dit pas combien on en a. Un exercice à une seule charge (squat goblet, rowing à un bras, extension au-dessus de la tête) propose `dumbbells` ou `kettlebell`. Le développé couché et le développé militaire exigent `squat_rack` (sécurités, appui de la barre). Les supports (chaise, banc, box) sont au choix. Le Nordic et le squat sur une jambe assisté sont `[[]]` : talons calés sous un meuble lourd ou tenus par un partenaire, appui à un montant de porte ; ces appuis ne sont pas des codes de matériel.
8. **Noms.** La version à la barre garde le nom court quand c'est l'usage (« Développé couché », « Développé militaire », « Soulevé de terre roumain ») ; « Squat barre » et « Rowing barre » reprennent 04 §7 ; sinon le matériel est dans le nom (« aux haltères », « à la poulie », « à l'élastique », « à la machine »). « Pompe pike » parce que le glossaire refuse « push-up » dans le texte. Noms anglais gardés car courants en salle : Hip thrust, Leg curl, Leg extension, Step-up, Face pull, Pallof press, Hollow body.
9. **`mechanics`** : pont fessier et hip thrust en `compound` (mouvements principaux de la charnière) ; planches, Pallof, Copenhague, mollets et isolations en `isolation`. **`unilateral`** vrai pour toutes les fentes, le step-up, le squat sur une jambe, les ponts et soulevés de terre unipodaux, le rowing à un bras, la pompe archer, la rotation externe, la planche latérale, Pallof et Copenhague (saisie par côté).

## Laissées hors du lot A (lot B probable)

Exemples de 04 §7 que les modèles ne demandent pas directement : squat avant, fente latérale, swing, hyperextension, abduction à l'élastique, écarté, dips (barres et chaise), rowing inversé, chin-up, élévation latérale à la poulie, oiseau, écartement à l'élastique, les autres curls et extensions des triceps, dead bug, roue abdominale (aucun code de matériel ne la décrit), bird dog, crunch, relevés de jambes, marche du fermier, port unilatéral, pogo, bonds latéraux, box jump. S'y ajouteront les remplaçants exigés par la condition (c) une fois les modèles écrits.

**R-EQ-5** (`pnpm data:validate --strict`) : 5 codes de matériel ne sont encore utilisés par aucune fiche, `back_extension_bench`, `dip_station`, `ez_bar`, `smith_machine` et `suspension_trainer`. Le lot B les couvrira (hyperextension, dips, curl à la barre EZ, rowing inversé aux sangles, variantes à la barre guidée).

## Questions pour le propriétaire

1. Valider, ajouter ou retirer des fiches ; corriger ids et noms avant le prochain déploiement.
2. Trancher les choix 2 à 8, surtout : niveaux des mouvements à la barre, ordre des tractions, découpage de Copenhague, chaînes ajoutées (pike, Nordic, mollets, sauts).
3. Abréviations courantes (« RDL », « DC »…) : le glossaire les refuse, donc elles ne sont pas dans les alias et la recherche ne les trouve pas. Les admettre dans `aliases` seulement ?
