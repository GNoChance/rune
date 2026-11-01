# Lot B

**Liste tirée de la condition (c) de 04 §7 et de la règle R-EQ-5 : le propriétaire valide la liste et les ids avant toute rédaction.**

Le lot B réunit les fiches de la condition (c) de 04 §7 : celles qu'il faut pour que chaque slot des 6 modèles ait au moins 2 exercices utilisables (adulte, `maxLevel` du modèle) dans chaque profil de référence pertinent, et au moins 1 en profil prudent. S'y ajoutent les fiches qui utilisent les 5 codes de matériel encore sans fiche (R-EQ-5).

- **24 fiches**, toutes des squelettes au statut `draft`, au lot `B`, en `revision` 1 (créées d'un seul enregistrement). Le catalogue passe de 66 à **90 fiches** (plafond du code : 300 ; 04 §7 en annonce 110 à 120).
- **Muscles renseignés à la main, comme au lot A (décision R7 étendue au lot B) ; à relire comme le reste.** `substitutes` exige au moins un muscle principal commun (04 §6) : sans muscles, un squelette ne remplace rien et la condition (c) ne se calcule pas. Les 24 squelettes ont donc leurs `primary_muscles` et `secondary_muscles` (colonne « Muscles »), et aucun autre champ IA. `pnpm exercises:draft` les garde à la rédaction (décision R20, voir `lot-a.md`).
- **`pnpm data:validate --strict` passe** (90 fiches, 6 modèles) : les 5 codes de matériel sont maintenant utilisés. La CI le lance en strict, avec `--base origin/main` pour la règle 8 des modèles.
- **Aucun modèle ni aucune fiche du lot A ne change.** Les fiches du lot B n'entrent dans aucune liste de slot ni aucune chaîne : elles servent de remplaçants (`substitutes`). Le volume (règle 6) et la couverture (règle 4) des modèles, calculés sur les listes et les chaînes, sont donc inchangés.

**Les ids sont immuables** une fois chargés dans une base qui fait foi (04 §2) : c'est maintenant qu'on les corrige, avant le prochain déploiement.

## Le contrôle

`scripts/data/coverage.ts` calcule la condition (c) ; le test `scripts/test/data/coverage.test.ts` la vérifie sur `data/` à chaque `pnpm test`, donc en CI (04 §13, critère 5). Il échoue sur les 66 fiches du lot A seul et passe avec le lot B.

- **Profils** : `gym_reference` pour GD et GI, `home_bodyweight` et `home_small_equipment` pour MD et MI, les trois pour SD et SI (abréviations de `lot-a.md`). Soit 156 couples (slot, profil).
- **Exercices utilisables d'un slot**, comme le moteur les propose (05 §11) : les fiches utilisables de sa liste, ou les variantes utilisables de sa chaîne (`usableChainSteps`), puis les remplaçants (`substitutes`) du premier exercice de la liste. Pour une chaîne, la référence est la variante courante, qui peut être n'importe quel membre : le contrôle garde le pire des cas.
- **Fiches du lot A et du lot B comptées comme publiées** : elles doivent l'être avant la fin de la brique 3. Une fiche retirée ne compte jamais.
- **`maxLevel`** : 1 pour un modèle débutant, 2 pour un intermédiaire (`maxExerciseLevel`). Seuls les remplaçants y sont soumis ; une liste ou une chaîne peut citer un niveau plus haut.
- **Mesure** : seules comptent les fiches de la mesure du slot (répétitions ou durée), lue sur sa première série de travail comme le moteur. `substitutes` ne regarde pas la mesure et proposerait une planche latérale (durée) dans un slot de Pallof (répétitions) : le contrôle ne la compte pas (choix 2 ci-dessous).

### Bilan par modèle et par profil

« Échecs » : slots sous 2 exercices pour un adulte ou sous 1 en prudent. « Min. » : le plus petit nombre d'exercices utilisables d'un slot, adulte puis prudent.

| Modèle | Profil | Slots | Échecs avant | Min. avant | Échecs après | Min. après |
|---|---|---|---|---|---|---|
| GD | salle | 10 | 0 | 2 · 2 | 0 | 2 · 2 |
| GI | salle | 23 | 5 | 1 · 1 | 0 | 2 · 2 |
| MD | sans matériel | 7 | 2 | 0 · 0 | 0 | 2 · 2 |
| MD | petit matériel | 7 | 0 | 2 · 2 | 0 | 2 · 2 |
| MI | sans matériel | 20 | 9 | 0 · 0 | 0 | 2 · 2 |
| MI | petit matériel | 20 | 3 | 1 · 1 | 0 | 2 · 2 |
| SD | salle | 10 | 2 | 1 · 1 | 0 | 2 · 2 |
| SD | sans matériel | 10 | 6 | 0 · 0 | 0 | 2 · 2 |
| SD | petit matériel | 10 | 3 | 1 · 1 | 0 | 2 · 2 |
| SI | salle | 13 | 2 | 0 · 0 | 0 | 2 · 2 |
| SI | sans matériel | 13 | 5 | 0 · 0 | 0 | 2 · 2 |
| SI | petit matériel | 13 | 2 | 1 · 1 | 0 | 2 · 2 |
| **Total** | | **156** | **39** | | **0** | |

Sans la règle de mesure, le lot A seul aurait 33 échecs : les 6 autres (Pallof de GI B2-6 à la salle, planches latérales de MI B2-5, SD A10 et SI A7 à la salle ou au petit matériel) ne tenaient que par un exercice de l'autre mesure.

Les 39 échecs, par type de mouvement : tirage horizontal sans matériel (6 slots : MD A3, MI H1-2 et H2-2, SD A4, SI A6 et B5, seul le rowing sous la table) ; tirage vertical sans matériel (4 : MD A5, MI H1-3 et H2-3, SD A6, aucun exercice) ; charnière de hanche sans matériel (4 : MI B1-2 et B2-3, SD A2, SI B1, seul le soulevé de terre roumain unipodal) ; anti-rotation en durée (8 : MI B2-5, SD A10, SI A7, seule la planche latérale) ; Pallof à la salle (GI B2-6) ; extension des triceps (MI H1-5, sans matériel et petit matériel) ; élévations latérales (GI H2-5 à la salle, MI H2-5 sans matériel et petit matériel) ; face pull (GI H2-6) ; rotation externe (SI B6 dans les trois profils : l'élastique n'est pas dans la salle de référence) ; curl (GI H1-5) ; leg extension (GI B2-5) ; poussée verticale (SD A5 sans matériel et petit matériel : le développé assis exige un banc inclinable) ; adducteurs (SD A8 dans les trois profils : la Copenhague de niveau 2 dépasse le `maxLevel` d'un débutant).

## Liste

Colonnes comme dans `lot-a.md` : **Niv.** (`level`), **Min.** (`not_for_minors`), **Sensible** (prévision : « oui » certain, « probable » et « ? » selon l'articulation entre parenthèses, « non »), **Muscles** (principaux ; secondaires). **Mes.** : `measure` (rép. ou durée). **Slots servis** : slots en échec que la fiche répare, avec le profil (salle, sans = `home_bodyweight`, petit = `home_small_equipment`). Aucune fiche n'est dans une chaîne.

### Nécessaires, quel que soit le reste de la liste (9)

Retirer une seule de ces fiches fait échouer au moins un slot.

| id | Nom | Pattern | Niv. | Min. | Mes. | Matériel | Sensible | Muscles (principaux ; secondaires) | Slots servis |
|---|---|---|---|---|---|---|---|---|---|
| `barbell-curl` | Curl biceps à la barre | `elbow_flexion` | 1 | non | rép. | barre | non | biceps ; avant-bras | GI H1-5 (salle) |
| `reverse-nordic-curl` | Nordic inversé | `knee_extension` | 2 | non | rép. | aucun | oui (niveau 2) | quadriceps ; — | GI B2-5 (salle) |
| `bird-dog` | Bird dog | `core_anti_rotation` | 1 | non | rép. | aucun | non | abdominaux, obliques ; lombaires, fessiers | GI B2-6 (salle) |
| `adductor-squeeze` | Adduction isométrique allongé | `hip_adduction_abduction` | 1 | non | durée | aucun | non | adducteurs ; — | SD A8 (salle, sans, petit) |
| `door-frame-row` | Rowing à l'encadrement de porte | `horizontal_pull` | 1 | non | rép. | aucun | non | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | MD A3, MI H1-2 et H2-2, SD A4, SI A6 et B5 (sans) |
| `supported-single-leg-romanian-deadlift` | Soulevé de terre roumain unipodal avec appui | `hip_hinge` | 1 | non | rép. | aucun | ? (bas du dos) | ischio-jambiers, fessiers ; lombaires | MI B1-2 et B2-3, SD A2, SI B1 (sans) |
| `knee-side-plank` | Planche latérale sur les genoux | `core_anti_rotation` | 1 | non | durée | aucun | ? (épaules) | obliques ; abdominaux, fessiers | MI B2-5 (sans, petit), SD A10 et SI A7 (salle, sans, petit) |
| `kneeling-pike-push-up` | Pompe pike sur les genoux | `vertical_push` | 1 | non | rép. | aucun | probable (épaules) | deltoïdes antérieurs, triceps ; deltoïdes latéraux, pectoraux | SD A5 (sans, petit) |
| `bodyweight-triceps-extension` | Extension triceps au poids du corps | `elbow_extension` | 1 | non | rép. | table, chaise, banc plat ou box | non | triceps ; — | MI H1-5 (sans, petit) |

### Salle et petit matériel : l'exercice naturel du profil (5)

Chacune répare un slot de salle ou de petit matériel. Avec les 6 fiches contestées de la section suivante, qui sont sans matériel donc faisables partout, ces 5 fiches deviennent redondantes au sens strict ; sans elles, chacune redevient nécessaire (vérifié fiche par fiche). Je les garde : à la salle, un adulte doit se voir proposer une rotation externe à la poulie avant une élévation en W allongé, et la liste reste valable si le propriétaire écarte les fiches contestées.

| id | Nom | Pattern | Niv. | Min. | Mes. | Matériel | Sensible | Muscles (principaux ; secondaires) | Slots servis |
|---|---|---|---|---|---|---|---|---|---|
| `cable-lateral-raise` | Élévation latérale à la poulie | `shoulder_isolation` | 1 | non | rép. | poulie | probable (épaules) | deltoïdes latéraux ; deltoïdes antérieurs, trapèzes | GI H2-5 (salle) |
| `dumbbell-reverse-fly` | Oiseau aux haltères | `shoulder_isolation` | 1 | non | rép. | haltères | ? (bas du dos) | deltoïdes postérieurs ; trapèzes, coiffe des rotateurs | GI H2-6 (salle) |
| `cable-external-rotation` | Rotation externe à la poulie | `shoulder_isolation` | 1 | non | rép. | poulie | ? (épaules) | coiffe des rotateurs ; deltoïdes postérieurs | SI B6 (salle) |
| `dumbbell-external-rotation` | Rotation externe à l'haltère allongé sur le côté | `shoulder_isolation` | 1 | non | rép. | haltères | ? (épaules) | coiffe des rotateurs ; deltoïdes postérieurs | SI B6 (salle, petit) |
| `band-lateral-raise` | Élévation latérale à l'élastique | `shoulder_isolation` | 1 | non | rép. | élastique | probable (épaules) | deltoïdes latéraux ; deltoïdes antérieurs, trapèzes | MI H2-5 (petit) |

### Sans matériel, pour des slots à petit matériel : à trancher (6)

Ces fiches ne réparent que des slots que leur modèle a écrits pour du petit matériel (tirages verticaux, élévations latérales, extension des triceps, rotation externe) dans le profil `home_bodyweight`. 05 §5, règle 4, dit que ces slots « peuvent exiger du petit matériel ; s'il manque, ils sont sautés sans pénalité » ; la condition (c), lue à la lettre, leur demande quand même 2 exercices sans matériel. Les exercices qui existent sont modestes (tirages verticaux sans barre, isolation de l'épaule sans charge). Voir la question 2.

| id | Nom | Pattern | Niv. | Min. | Mes. | Matériel | Sensible | Muscles (principaux ; secondaires) | Slots servis |
|---|---|---|---|---|---|---|---|---|---|
| `towel-lat-pulldown` | Tirage vertical à la serviette | `vertical_pull` | 1 | non | rép. | aucun | ? (épaules) | dorsaux ; biceps, trapèzes | MD A5, MI H1-3 et H2-3, SD A6 (sans) |
| `prone-lat-pulldown` | Tirage vertical allongé au sol | `vertical_pull` | 1 | non | rép. | aucun | ? (épaules) | dorsaux, trapèzes ; deltoïdes postérieurs | MD A5, MI H1-3 et H2-3, SD A6 (sans) |
| `chair-dip` | Dips sur une chaise | `elbow_extension` | 2 | non | rép. | chaise, banc plat ou box | oui (niveau 2) | triceps ; pectoraux, deltoïdes antérieurs | MI H1-5 (sans) |
| `wall-lateral-raise` | Élévation latérale en appui au mur | `shoulder_isolation` | 1 | non | rép. | aucun | probable (épaules) | deltoïdes latéraux ; trapèzes | MI H2-5 (sans) |
| `prone-y-raise` | Élévation en Y allongé | `shoulder_isolation` | 1 | non | rép. | aucun | probable (épaules) | trapèzes, deltoïdes latéraux, coiffe des rotateurs ; deltoïdes postérieurs | MI H2-5, SI B6 (sans) |
| `prone-w-raise` | Élévation en W allongé | `shoulder_isolation` | 1 | non | rép. | aucun | probable (épaules) | coiffe des rotateurs, deltoïdes postérieurs ; trapèzes | SI B6 (sans) |

Sans ces 6 fiches, 7 couples (slot, profil) restent en échec, tous sans matériel : MD A5, MI H1-3, MI H1-5 (1 exercice), MI H2-3, MI H2-5, SD A6, SI B6.

Technique visée, pour la rédaction et la relecture : tirage à la serviette tendue au-dessus de la tête, ramenée vers la poitrine en l'écartant ; tirage allongé sur le ventre, bras devant, coudes ramenés vers les côtes ; élévation latérale de côté contre un mur, avant-bras en appui, le corps repoussé par l'épaule ; Y et W allongés sur le ventre, bras levés en Y ou coudes pliés en W, omoplates serrées.

### R-EQ-5 : les 5 codes de matériel restants (4)

| id | Nom | Pattern | Niv. | Min. | Mes. | Matériel | Sensible | Muscles (principaux ; secondaires) | Code couvert |
|---|---|---|---|---|---|---|---|---|---|
| `ez-bar-curl` | Curl biceps à la barre EZ | `elbow_flexion` | 1 | non | rép. | barre EZ | non | biceps ; avant-bras | `ez_bar` |
| `back-extension` | Hyperextension | `hip_hinge` | 1 | non | rép. | banc à lombaires | probable (bas du dos) | lombaires, fessiers, ischio-jambiers ; — | `back_extension_bench` |
| `parallel-bar-dip` | Dips aux barres parallèles | `horizontal_push` | 2 | non | rép. | barres parallèles | oui (niveau 2) | pectoraux, triceps ; deltoïdes antérieurs | `dip_station` |
| `inverted-row` | Rowing inversé | `horizontal_pull` | 1 | non | rép. | barre et cage, barre guidée, ou sangles | non | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | `smith_machine`, `suspension_trainer` |

Le rowing inversé et les dips aux barres s'ajoutent aussi aux remplaçants de quelques slots de salle déjà couverts ; aucune de ces 4 fiches n'est nécessaire à la condition (c).

Bilan de la prévision de sensibilité : 3 fiches sensibles à coup sûr, 7 probables, 7 incertaines et 7 non sensibles.

## Choix faits, à valider

1. **Condition (c) lue à la lettre**, y compris pour les slots à petit matériel dans `home_bodyweight` (section « à trancher »). Le contrôle n'a pas d'exception ; écarter les 6 fiches demande d'en écrire une (question 2).
2. **Mesure.** Le contrôle ne compte que les fiches de la mesure du slot, ce qui le rend plus strict que `substitutes` (qui ne regarde pas la mesure), jamais plus large. D'où `bird-dog` : sans lui, le Pallof de GI B2-6 à la salle n'a pour second exercice que des planches latérales en durée. `adductor-squeeze` et `knee-side-plank` sont en durée parce que leurs slots le sont.
3. **Chaînes : pire variante courante.** Pour un slot `chain`, les remplaçants dépendent de la variante courante ; le contrôle prend le cas le moins favorable.
4. **Aucune chaîne touchée.** `kneeling-pike-push-up`, `supported-single-leg-romanian-deadlift` et `knee-side-plank` sont les régressions naturelles de `pike-push-up` (chaîne `pike-push-up`), `single-leg-romanian-deadlift` et `side-plank`. Les mettre en chaîne changerait des fiches du lot A, le rang des variantes de MI et le premier exercice faisable d'une chaîne, donc le volume des modèles. Elles restent hors chaîne ; `substitutes` les trouve par le type de mouvement.
5. **Dips.** Sur une chaise : `elbow_extension` (le triceps fait le travail ; c'est le second exercice sans matériel de MI H1-5), niveau 2 (épaules en extension sous le poids du corps). Aux barres parallèles : `horizontal_push`, pour être le remplaçant d'un développé couché (pectoraux et triceps) et pas d'un développé militaire ; une poussée verticale serait plus juste pour la direction du mouvement. Niveau 2.
6. **Niveaux.** Nordic inversé niveau 2 (genoux, contrôle excentrique) ; tout le reste niveau 1 sauf les dips. Aucune fiche déconseillée aux mineurs : rien de niveau 3, ni pliométrie, ni charge maximale.
7. **Matériel.** Encadrement de porte, serviette, mur et sol ne sont pas des codes : `[[]]`, comme les appuis du Nordic (lot A, choix 8). Le rowing inversé a 3 options (barre dans la cage, barre guidée, sangles), en mode `bodyweight` où le support peut varier ; il couvre `smith_machine` et `suspension_trainer`. Le curl à la barre EZ est une fiche à part : la barre EZ n'a pas le poids de la barre droite que règle le lieu (`barG`). La rotation externe allongé ne propose que des haltères (un kettlebell est trop lourd pour ce mouvement).
8. **Muscles.** Élévation en Y : 3 muscles principaux (trapèzes, deltoïdes latéraux, coiffe des rotateurs), ce qui la fait compter pour les élévations latérales et la rotation externe ; élévation en W : coiffe des rotateurs et deltoïdes postérieurs ; oiseau : deltoïdes postérieurs, la coiffe en secondaire ; hyperextension : lombaires, fessiers et ischio-jambiers en principaux ; Nordic inversé, adduction isométrique et extension des triceps sans secondaire ; bird dog : abdominaux et obliques en principaux (il partage ainsi ses muscles avec le Pallof).
9. **Noms.** Anglais gardés car courants : Bird dog, Hyperextension, Nordic inversé, Pompe pike. « Dips » sans équivalent français courant.

## Exemples de 04 §7 laissés hors de la v1

Ils ne remplissent aucune des conditions (a) à (c) avec les 6 modèles actuels, donc la règle d'inclusion de 04 §7 les écarte : squat avant, fente latérale, swing, écarté, développé incliné à la barre, chin-up, tirage vertical prise serrée, les autres curls (marteau, poulie) et extensions des triceps, dead bug, roue abdominale, crunch, relevés de jambes, marche du fermier, port unilatéral, pogo, bonds latéraux, box jump, abduction à l'élastique, écartement à l'élastique. Un nouveau modèle, ou un slot qui les cite, les ferait entrer.

## Questions pour le propriétaire

1. Valider la liste et les ids (24 fiches) ; corriger ids et noms avant le prochain déploiement.
2. **Trancher les 6 fiches sans matériel pour des slots à petit matériel.** Soit on les garde (condition (c) à la lettre), soit on les écarte et le contrôle exempte, dans `home_bodyweight`, les slots dont aucun exercice de la liste ou de la chaîne n'est faisable sans matériel (05 §5, règle 4 : sautés sans pénalité). Les 5 fiches de salle et de petit matériel restent nécessaires dans les deux cas.
3. Relire les muscles (choix 8) et les niveaux (choix 6) ; trancher la classification des dips (choix 5).
4. Garder la règle de mesure du contrôle (choix 2) ; elle suppose que le moteur (tâche 6, `resolveSlot`) n'installe pas un exercice en durée dans un slot en répétitions.
