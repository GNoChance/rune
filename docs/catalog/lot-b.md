# Lot B

**Liste tirée de la condition (c) de 04 §7 et de la règle R-EQ-5 : le propriétaire valide la liste et les ids avant toute rédaction.**

Le lot B réunit les fiches de la condition (c) de 04 §7 : celles qu'il faut pour que chaque slot des 6 modèles ait au moins 2 exercices utilisables (adulte, `maxLevel` du modèle) dans chaque profil de référence pertinent, et au moins 1 en profil prudent. S'y ajoutent les fiches qui utilisent les 5 codes de matériel encore sans fiche (R-EQ-5).

- **18 fiches**, toutes des squelettes au statut `draft`, au lot `B`, en `revision` 1 (créées d'un seul enregistrement). Le catalogue passe de 66 à **84 fiches** (plafond du code : 300 ; 04 §7 en annonce 110 à 120).
- **Muscles renseignés à la main, comme au lot A (décision R7 étendue au lot B) ; à relire comme le reste.** `substitutes` exige au moins un muscle principal commun (04 §6) : sans muscles, un squelette ne remplace rien et la condition (c) ne se calcule pas. Les 18 squelettes ont donc leurs `primary_muscles` et `secondary_muscles` (colonne « Muscles »), et aucun autre champ IA. `pnpm exercises:draft` les garde à la rédaction (décision R20, voir `lot-a.md`).
- **`pnpm data:validate --strict` passe** (84 fiches, 6 modèles) : les 5 codes de matériel sont maintenant utilisés. La CI le lance en strict, avec `--base origin/main` pour la règle 8 des modèles.
- **Aucun modèle ni aucune fiche du lot A ne change.** Les fiches du lot B n'entrent dans aucune liste de slot ni aucune chaîne : elles servent de remplaçants (`substitutes`). Le volume (règle 6) et la couverture (règle 4) des modèles, calculés sur les listes et les chaînes, sont donc inchangés.

**Les ids sont immuables** une fois chargés dans une base qui fait foi (04 §2) : c'est maintenant qu'on les corrige, avant le prochain déploiement.

## Le contrôle

`scripts/data/coverage.ts` calcule la condition (c) ; le test `scripts/test/data/coverage.test.ts` la vérifie sur `data/` à chaque `pnpm test`, donc en CI (04 §13, critère 5). Il échoue sur les 66 fiches du lot A seul et passe avec le lot B.

- **Profils** : `gym_reference` pour GD et GI, `home_bodyweight` et `home_small_equipment` pour MD et MI, les trois pour SD et SI (abréviations de `lot-a.md`). Soit 156 couples (slot, profil).
- **Slots à petit matériel exemptés sans matériel (décision R22).** 05 §5, règle 4 : les slots « comme le tirage vertical à la maison, peuvent exiger du petit matériel ; s'il manque, ils sont sautés sans pénalité ». Un slot dont aucun exercice de la liste ou de la chaîne n'est faisable avec `home_bodyweight` n'a donc pas `home_bodyweight` pour profil pertinent : sa ligne est calculée mais ne peut pas échouer. 8 couples sont exemptés : MD A5, MI H1-3, MI H1-5, MI H2-3, MI H2-5, SD A6, SI A2 et SI B6. Les autres profils ne sont jamais exemptés (SI B6 doit avoir sa rotation externe à la salle).
- **Exercices utilisables d'un slot**, comme le moteur les propose (05 §11) : les fiches utilisables de sa liste, ou les variantes utilisables de sa chaîne (`usableChainSteps`), puis les remplaçants (`substitutes`) du premier exercice de la liste. Pour une chaîne, la référence est la variante courante, qui peut être n'importe quel membre : le contrôle garde le pire des cas.
- **Fiches du lot A et du lot B comptées comme publiées** : elles doivent l'être avant la fin de la brique 3. Une fiche retirée ne compte jamais.
- **`maxLevel`** : 1 pour un modèle débutant, 2 pour un intermédiaire (`maxExerciseLevel`). Seuls les remplaçants y sont soumis ; une liste ou une chaîne peut citer un niveau plus haut.
- **Mesure** : seules comptent les fiches de la mesure du slot (répétitions ou durée), lue sur sa première série de travail comme le moteur. `substitutes` ne regarde pas la mesure et proposerait une planche latérale (durée) dans un slot de Pallof (répétitions) : le contrôle ne la compte pas (choix 1 ci-dessous).

### Bilan par modèle et par profil

« Exemptés » : slots à petit matériel dans `home_bodyweight` (décision R22). « Échecs » : autres slots sous 2 exercices pour un adulte ou sous 1 en prudent. « Min. » : le plus petit nombre d'exercices utilisables d'un slot non exempté, adulte puis prudent.

| Modèle | Profil | Slots | Exemptés | Échecs avant | Min. avant | Échecs après | Min. après |
|---|---|---|---|---|---|---|---|
| GD | salle | 10 | 0 | 0 | 2 · 2 | 0 | 2 · 2 |
| GI | salle | 23 | 0 | 5 | 1 · 1 | 0 | 2 · 2 |
| MD | sans matériel | 7 | 1 | 1 | 1 · 1 | 0 | 2 · 2 |
| MD | petit matériel | 7 | 0 | 0 | 2 · 2 | 0 | 2 · 2 |
| MI | sans matériel | 20 | 4 | 5 | 1 · 1 | 0 | 2 · 2 |
| MI | petit matériel | 20 | 0 | 3 | 1 · 1 | 0 | 2 · 2 |
| SD | salle | 10 | 0 | 2 | 1 · 1 | 0 | 2 · 2 |
| SD | sans matériel | 10 | 1 | 5 | 1 · 1 | 0 | 2 · 2 |
| SD | petit matériel | 10 | 0 | 3 | 1 · 1 | 0 | 2 · 2 |
| SI | salle | 13 | 0 | 2 | 0 · 0 | 0 | 2 · 2 |
| SI | sans matériel | 13 | 2 | 4 | 1 · 1 | 0 | 2 · 2 |
| SI | petit matériel | 13 | 0 | 2 | 1 · 1 | 0 | 2 · 2 |
| **Total** | | **156** | **8** | **32** | | **0** | |

Les 32 échecs, par type de mouvement : tirage horizontal sans matériel (6 slots : MD A3, MI H1-2 et H2-2, SD A4, SI A6 et B5, seul le rowing sous la table) ; charnière de hanche sans matériel (4 : MI B1-2 et B2-3, SD A2, SI B1, seul le soulevé de terre roumain unipodal) ; anti-rotation en durée (8 : MI B2-5, SD A10, SI A7, seule la planche latérale) ; Pallof de GI B2-6 à la salle (1) ; extension des triceps de MI H1-5 au petit matériel (1) ; élévations latérales (GI H2-5 à la salle, MI H2-5 au petit matériel) ; face pull de GI H2-6 (1) ; rotation externe de SI B6 à la salle et au petit matériel (2 : l'élastique n'est pas dans la salle de référence) ; curl de GI H1-5 (1) ; leg extension de GI B2-5 (1) ; poussée verticale de SD A5 sans matériel et au petit matériel (2 : le développé assis exige un banc inclinable) ; adducteurs de SD A8 dans les trois profils (3 : la Copenhague de niveau 2 dépasse le `maxLevel` d'un débutant).

Sans la règle de mesure, 6 de ces échecs (le Pallof de GI à la salle, les planches latérales de MI B2-5, SD A10 et SI A7 à la salle ou au petit matériel) tiendraient grâce à un exercice de l'autre mesure.

## Liste

Colonnes comme dans `lot-a.md` : **Niv.** (`level`), **Min.** (`not_for_minors`), **Sensible** (prévision : « oui » certain, « probable » et « ? » selon l'articulation entre parenthèses, « non »), **Muscles** (principaux ; secondaires). **Mes.** : `measure` (rép. ou durée). **Slots servis** : slots en échec que la fiche répare, avec le profil (salle, sans = `home_bodyweight`, petit = `home_small_equipment`). Aucune fiche n'est dans une chaîne.

### Condition (c) (14)

Chacune est nécessaire : la retirer seule fait échouer au moins un couple (vérifié fiche par fiche).

| id | Nom | Pattern | Niv. | Min. | Mes. | Matériel | Sensible | Muscles (principaux ; secondaires) | Slots servis |
|---|---|---|---|---|---|---|---|---|---|
| `barbell-curl` | Curl biceps à la barre | `elbow_flexion` | 1 | non | rép. | barre | non | biceps ; avant-bras | GI H1-5 (salle) |
| `reverse-nordic-curl` | Nordic inversé | `knee_extension` | 2 | non | rép. | aucun | oui (niveau 2) | quadriceps ; — | GI B2-5 (salle) |
| `bird-dog` | Bird dog | `core_anti_rotation` | 1 | non | rép. | aucun | non | abdominaux, obliques ; lombaires, fessiers | GI B2-6 (salle) |
| `cable-lateral-raise` | Élévation latérale à la poulie | `shoulder_isolation` | 1 | non | rép. | poulie | probable (épaules) | deltoïdes latéraux ; deltoïdes antérieurs, trapèzes | GI H2-5 (salle) |
| `dumbbell-reverse-fly` | Oiseau aux haltères | `shoulder_isolation` | 1 | non | rép. | haltères | ? (bas du dos) | deltoïdes postérieurs ; trapèzes, coiffe des rotateurs | GI H2-6 (salle) |
| `cable-external-rotation` | Rotation externe à la poulie | `shoulder_isolation` | 1 | non | rép. | poulie | ? (épaules) | coiffe des rotateurs ; deltoïdes postérieurs | SI B6 (salle) |
| `dumbbell-external-rotation` | Rotation externe à l'haltère allongé sur le côté | `shoulder_isolation` | 1 | non | rép. | haltères | ? (épaules) | coiffe des rotateurs ; deltoïdes postérieurs | SI B6 (salle, petit) |
| `band-lateral-raise` | Élévation latérale à l'élastique | `shoulder_isolation` | 1 | non | rép. | élastique | probable (épaules) | deltoïdes latéraux ; deltoïdes antérieurs, trapèzes | MI H2-5 (petit) |
| `bodyweight-triceps-extension` | Extension triceps au poids du corps | `elbow_extension` | 1 | non | rép. | table, chaise, banc plat ou box | non | triceps ; — | MI H1-5 (petit) |
| `adductor-squeeze` | Adduction isométrique allongé | `hip_adduction_abduction` | 1 | non | durée | aucun | non | adducteurs ; — | SD A8 (salle, sans, petit) |
| `door-frame-row` | Rowing à l'encadrement de porte | `horizontal_pull` | 1 | non | rép. | aucun | non | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | MD A3, MI H1-2 et H2-2, SD A4, SI A6 et B5 (sans) |
| `supported-single-leg-romanian-deadlift` | Soulevé de terre roumain unipodal avec appui | `hip_hinge` | 1 | non | rép. | aucun | ? (bas du dos) | ischio-jambiers, fessiers ; lombaires | MI B1-2 et B2-3, SD A2, SI B1 (sans) |
| `knee-side-plank` | Planche latérale sur les genoux | `core_anti_rotation` | 1 | non | durée | aucun | ? (épaules) | obliques ; abdominaux, fessiers | MI B2-5 (sans, petit), SD A10 et SI A7 (salle, sans, petit) |
| `kneeling-pike-push-up` | Pompe pike sur les genoux | `vertical_push` | 1 | non | rép. | aucun | probable (épaules) | deltoïdes antérieurs, triceps ; deltoïdes latéraux, pectoraux | SD A5 (sans, petit) |

### R-EQ-5 : les 5 codes de matériel restants (4)

| id | Nom | Pattern | Niv. | Min. | Mes. | Matériel | Sensible | Muscles (principaux ; secondaires) | Code couvert |
|---|---|---|---|---|---|---|---|---|---|
| `ez-bar-curl` | Curl biceps à la barre EZ | `elbow_flexion` | 1 | non | rép. | barre EZ | non | biceps ; avant-bras | `ez_bar` |
| `back-extension` | Hyperextension | `hip_hinge` | 1 | non | rép. | banc à lombaires | probable (bas du dos) | lombaires, fessiers, ischio-jambiers ; — | `back_extension_bench` |
| `parallel-bar-dip` | Dips aux barres parallèles | `horizontal_push` | 2 | **oui** | rép. | barres parallèles | oui (niveau 2, mineurs) | pectoraux, triceps ; deltoïdes antérieurs | `dip_station` |
| `inverted-row` | Rowing inversé | `horizontal_pull` | 1 | non | rép. | barre et cage, barre guidée, ou sangles | non | dorsaux, trapèzes ; deltoïdes postérieurs, biceps | `smith_machine`, `suspension_trainer` |

Le rowing inversé et les dips aux barres s'ajoutent aussi aux remplaçants de quelques slots de salle déjà couverts ; aucune de ces 4 fiches n'est nécessaire à la condition (c).

Bilan de la prévision de sensibilité : 2 fiches sensibles à coup sûr, 4 probables, 5 incertaines et 7 non sensibles.

### Retirées de la première liste (décision R22, réversible)

La première version du lot B lisait la condition (c) à la lettre, sans exemption, et ajoutait 6 fiches sans matériel pour les slots à petit matériel dans `home_bodyweight` : `towel-lat-pulldown` (Tirage vertical à la serviette), `prone-lat-pulldown` (Tirage vertical allongé au sol), `chair-dip` (Dips sur une chaise), `wall-lateral-raise` (Élévation latérale en appui au mur), `prone-y-raise` (Élévation en Y allongé) et `prone-w-raise` (Élévation en W allongé). La décision R22 exempte ces slots (05 §5, règle 4) ; aucune de ces fiches ne sert un couple non exempté, elles sont retirées. Elles n'ont jamais été chargées : leurs ids restent libres. Si le propriétaire préfère la lecture littérale, il faut retirer l'exemption du contrôle et remettre ces 6 fiches (ou d'autres) pour les 7 couples qu'elles réparaient : MD A5, MI H1-3, MI H1-5, MI H2-3, MI H2-5, SD A6, SI B6.

## Choix faits, à valider

1. **Mesure.** Le contrôle ne compte que les fiches de la mesure du slot, ce qui le rend plus strict que `substitutes` (qui ne regarde pas la mesure), jamais plus large. D'où `bird-dog` : sans lui, le Pallof de GI B2-6 à la salle n'a pour second exercice que des planches latérales en durée. `adductor-squeeze` et `knee-side-plank` sont en durée parce que leurs slots le sont.
2. **Chaînes : pire variante courante.** Pour un slot `chain`, les remplaçants dépendent de la variante courante ; le contrôle prend le cas le moins favorable.
3. **Aucune chaîne touchée.** `kneeling-pike-push-up`, `supported-single-leg-romanian-deadlift` et `knee-side-plank` sont les régressions naturelles de `pike-push-up` (chaîne `pike-push-up`), `single-leg-romanian-deadlift` et `side-plank`. Les mettre en chaîne changerait des fiches du lot A, le rang des variantes de MI et le premier exercice faisable d'une chaîne, donc le volume des modèles. Elles restent hors chaîne ; `substitutes` les trouve par le type de mouvement.
4. **Dips aux barres** : `horizontal_push`, pour être le remplaçant d'un développé couché (pectoraux et triceps) et pas d'un développé militaire ; une poussée verticale serait plus juste pour la direction du mouvement. Niveau 2.
5. **Niveaux et mineurs.** Nordic inversé et dips aux barres au niveau 2, tout le reste au niveau 1. **Dips aux barres déconseillés aux mineurs** : le repère de R-FIC-3 ne les vise pas (ni niveau 3, ni pliométrie, ni charge maximale), mais les épaules travaillent en extension sous tout le poids du corps, et le guide de style (§5) dit « dans le doute, mets vrai ». Ils ne servent à aucun slot en profil prudent. Le Nordic inversé reste permis aux mineurs, comme le Nordic du lot A (niveau 2, genoux) : à confirmer à la relecture santé, avec le même argument.
6. **Matériel.** Encadrement de porte et sol ne sont pas des codes : `[[]]`, comme les appuis du Nordic (lot A, choix 8). Le rowing inversé a 3 options (barre dans la cage, barre guidée, sangles), en mode `bodyweight` où le support peut varier ; il couvre `smith_machine` et `suspension_trainer`. Le curl à la barre EZ est une fiche à part : la barre EZ n'a pas le poids de la barre droite que règle le lieu (`barG`). La rotation externe allongé ne propose que des haltères (un kettlebell est trop lourd pour ce mouvement).
7. **Muscles.** Oiseau : deltoïdes postérieurs, la coiffe en secondaire ; hyperextension : lombaires, fessiers et ischio-jambiers en principaux ; Nordic inversé, adduction isométrique et extension des triceps sans secondaire. **Bird dog : abdominaux et obliques en principaux, choisis pour partager ses muscles avec le Pallof de GI B2-6** (sans muscle principal commun, `substitutes` ne le propose pas). Le bird dog sollicite aussi beaucoup les lombaires et les fessiers : ce choix est à vérifier à la rédaction et à la relecture ; si les muscles changent, le contrôle dira si le Pallof garde 2 exercices.
8. **Noms.** Anglais gardés car courants : Bird dog, Hyperextension, Nordic inversé, Pompe pike. « Dips » sans équivalent français courant.

## Exemples de 04 §7 laissés hors de la v1

Ils ne remplissent aucune des conditions (a) à (c) avec les 6 modèles actuels, donc la règle d'inclusion de 04 §7 les écarte : squat avant, fente latérale, swing, écarté, développé incliné à la barre, chin-up, tirage vertical prise serrée, les autres curls (marteau, poulie) et extensions des triceps, dips sur une chaise, dead bug, roue abdominale, crunch, relevés de jambes, marche du fermier, port unilatéral, pogo, bonds latéraux, box jump, abduction à l'élastique, écartement à l'élastique. Un nouveau modèle, ou un slot qui les cite, les ferait entrer.

## Questions pour le propriétaire

1. Valider la liste et les ids (18 fiches) ; corriger ids et noms avant le prochain déploiement.
2. **Exemption des slots à petit matériel sans matériel (décision R22).** Elle suit 05 §5, règle 4, et retire 6 fiches de la première liste. Pour revenir à la lecture littérale de la condition (c), voir « Retirées de la première liste ».
3. Relire les muscles (choix 7, surtout le bird dog) et les niveaux ; confirmer `not_for_minors` des dips aux barres (vrai) et du Nordic inversé (faux) ; trancher la classification des dips (choix 4).
4. Garder la règle de mesure du contrôle (choix 1) ; elle suppose que le moteur (tâche 6, `resolveSlot`) n'installe pas un exercice en durée dans un slot en répétitions.
