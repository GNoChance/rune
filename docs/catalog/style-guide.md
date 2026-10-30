# Guide de style des fiches d'exercices

Ce guide fixe la façon d'écrire les fiches de `data/exercises/`. Il sert à tous ceux qui rédigent ou relisent : le prompt de l'API Claude (`scripts/exercises/prompt-v<n>.md`), l'admin et les relectrices. On le lit avec le glossaire `data/glossary.json` et les deux fiches étalons écrites à la main, `push-up` et `dumbbell-romanian-deadlift`.

Sources : spec 04 §4 (schéma), §5 (chaînes), §8 étape 0 ; spec de la brique 2 §2, §3.2 et §5. En cas d'écart, les specs l'emportent. Les bornes chiffrées sont vérifiées par `pnpm data:validate` ; le reste l'est à la relecture.

## 1. Principes

- **Pour un débutant francophone**, qui lit la fiche avant ou pendant sa séance, parfois hors ligne, sur un téléphone.
- **Textes 100 % maison.** On peut consulter des faits bruts (nom, muscles travaillés), jamais recopier ni traduire une phrase d'un autre site, livre ou base d'exercices.
- **Aucun chiffre de charge** : ni kilos, ni pourcentage du maximum, ni « charge lourde ». La charge et les cibles viennent du moteur de programmes, jamais de la fiche.
- **Un doute se note dans `review_notes`**, jamais dans le texte servi. La relecture le tranche.
- **Une fiche = un exercice.** Si deux façons de faire changent le mode de charge ou la technique, on crée deux fiches.

## 2. Ton et forme

- **Tutoiement**, toujours : « Pose les pieds à plat », jamais « Posez » ni « On pose ».
- **Impératif** pour les consignes : « Descends », « Serre les omoplates ». Pas de « il faut », pas de conditionnel.
- **Phrases de 20 mots au plus.** Une idée par phrase.
- **Vocabulaire courant**, celui d'une salle française. Le glossaire donne le terme préféré ; ses variantes refusées n'apparaissent jamais dans le texte (le nom anglais courant peut aller dans `aliases`).
- **Unités métriques** et chiffres pour les mesures : « 30 cm », « 2 secondes », « à 1 m du mur ». Ni pouces, ni livres.
- **Aucune marque** : ni fabricant, ni salle, ni méthode déposée. On écrit « sangles de suspension », pas le nom commercial. Le matériel se nomme comme dans l'appli (libellés de `EQUIPMENT_LABELS`).
- **Aucune allégation médicale** : la fiche ne promet ni de soigner, ni de guérir, ni de prévenir une blessure, ni de « protéger le dos ».
- **Typographie** : apostrophe droite `'` (jamais `’`) ; guillemets « » ; une espace avant `:` `;` `?` `!` ; points de suspension en un seul caractère `…`. Pas d'émoji, pas de majuscules d'insistance, pas de point d'exclamation.
- **Exercice unilatéral** (`unilateral` vrai) : dis quand changer de côté (« Fais toutes tes répétitions, puis change de côté »).

## 3. Champ par champ

Les bornes viennent du schéma `ExerciseSheetSchema` ; un texte qui les dépasse est refusé.

| Champ | Bornes | Règle d'écriture | Exemple |
|---|---|---|---|
| `name` | 60 caractères | Nom courant dans les salles françaises, majuscule initiale seulement, sans article. | « Squat goblet », « Hip thrust » |
| `aliases` | 0 à 6, 60 caractères chacun | Autres noms courants, dont le nom anglais. Jamais le nom lui-même. Uniques dans tout le catalogue une fois casse, accents et ponctuation retirés. | « Goblet squat », « Squat avec haltère » |
| `primary_muscles` | 1 à 3 | Les muscles qui font le travail et limitent l'exercice. Ils comptent une série dans le volume. | `quadriceps`, `glutes` |
| `secondary_muscles` | 0 à 4 | Muscles qui aident, jamais déjà en principal. Ils comptent une demi-série. | `adductors`, `abs` |
| `stressed_joints` | 0 à 3 | Articulations fortement sollicitées seulement, pas toutes celles qui bougent. | `knees`, `hips` |
| `instructions` | 3 à 7 étapes, 160 caractères chacune | Impératif, une action par étape, dans l'ordre : installation, départ, mouvement, retour. | « Descends en poussant les hanches en arrière, le buste droit. » |
| `key_points` | 2 à 4, 120 caractères chacun | Ce qu'il faut garder en tête pendant toute la série. | « Garde les talons au sol pendant toute la descente. » |
| `mistakes` | 2 à 4 paires, 160 caractères chacune | `mistake` décrit ce qu'on voit, au présent ; `fix` dit quoi faire, à l'impératif. | « Les genoux rentrent vers l'intérieur. » / « Pousse les genoux dans l'axe des pieds. » |
| `safety` | 1 à 3, **120 caractères chacune** | Voir le §4. | « Arrête la série si tu sens une douleur vive au genou. » |
| `breathing` | 160 caractères | Quand inspirer, quand souffler, sans bloquer longtemps. | « Inspire en descendant, souffle en remontant. » |
| `setup` | facultatif, 240 caractères | Réglage du matériel : siège, banc, sécurités du rack, hauteur de poulie. | « Règle le siège pour que les poignées arrivent à hauteur de poitrine. » |
| `easier_tip`, `harder_tip` | facultatifs, 160 caractères | Un moyen simple de rendre l'exercice plus facile ou plus dur, même hors chaîne. Jamais « ajoute du poids » chiffré. | « Tiens-toi à un support devant toi. » |
| `review_notes` | facultatif | Doutes du rédacteur pour la relecture. Jamais servi aux membres. | « Profondeur à confirmer pour les chevilles raides. » |

## 4. Sécurité

Chaque entrée de `safety` :

- fait **120 caractères au plus** ;
- **dit quand s'arrêter** : « Arrête si… », « Arrête la série dès que… » ;
- décrit ce que la personne ressent, avec des mots de tous les jours : douleur vive, douleur qui descend dans la jambe, vertige, picotements dans les mains ;
- n'emploie **aucun vocabulaire médical** et ne pose **aucun diagnostic** : ni « hernie », « tendinite », « lésion », « inflammation », « pathologie », « contre-indiqué », ni nom de maladie ou de structure anatomique savante ;
- ne promet rien : pas de « sans risque », pas de « protège ».

Une fiche a 1 à 3 entrées. La première couvre le risque principal de l'exercice. On peut ajouter, comme les étalons, une entrée qui dit elle aussi quand s'arrêter : « Arrête et demande conseil à un professionnel de santé si une douleur revient à chaque séance. »

| Bon | Pourquoi |
|---|---|
| « Arrête la série si tu sens une douleur vive au genou ou dans le bas du dos. » | Dit quand s'arrêter, mots courants. |
| « Arrête si tu as la tête qui tourne en te relevant. » | Signe concret, consigne claire. |

| À éviter | Pourquoi |
|---|---|
| « Attention aux lombaires en cas de hernie discale. » | Vocabulaire médical, ne dit pas quand s'arrêter. |
| « Cet exercice protège ton dos des blessures. » | Allégation médicale. |
| « Ne force pas trop. » | Vague : ne dit ni quoi surveiller ni quand s'arrêter. |

## 5. Niveau, mineurs et fiches sensibles

- **Niveau** (`level`) : `1` débutant, apprenable seul avec la fiche, risque faible ; `2` intermédiaire, technique de base acquise ; `3` avancé (pistol, pompe archer, Nordic complet). Le niveau ne baisse jamais le long d'une chaîne.
- **Déconseillé aux mineurs** (`not_for_minors`), repère à confirmer à la relecture : vrai pour le niveau 3, pour la pliométrie à fort impact (box jump, sauts en contrebas) et pour les mouvements orientés vers la charge maximale. Dans le doute, mets vrai et explique-le dans `review_notes`.
- **Fiche sensible** : niveau 2 ou plus, ou déconseillée aux mineurs, ou articulation sollicitée parmi `lower_back`, `knees`, `shoulders`, `neck`. Elle ne se publie qu'avec le feu vert santé d'une relectrice professionnelle de santé. Ne baisse pas un niveau ni ne retire une articulation pour l'éviter.

## 6. Matériel, mode de charge et chaînes

- `equipment_options` liste les façons de faire l'exercice : une option est un ensemble de matériel à réunir, `[[]]` veut dire sans matériel. Pas d'option en double, ni d'option qui en contient une autre.
- **Un seul mode de charge par fiche** (`load_mode`). En `barbell`, `dumbbell`, `machine` ou `band`, chaque option contient le matériel qui porte la charge (barre, haltères ou kettlebell, machine ou poulie, élastique) ; sinon, crée une seconde fiche. En `bodyweight` et `weighted`, le support peut varier (table, barre fixe, élastique d'assistance).
- **Chaînes** : du plus facile au plus dur, mêmes muscles principaux (au moins un en commun à tous) et même groupe de mouvement ; `easier_id` et `harder_id` réciproques ; un seul chemin, sans boucle ni branche.

## 7. Avant la relecture

1. `pnpm data:validate` passe (bornes, codes, alias, chaînes, forme canonique).
2. Chaque consigne est à l'impératif, au tutoiement, en 20 mots au plus.
3. Aucun mot refusé du glossaire, aucune marque, aucun chiffre de charge.
4. Chaque entrée de sécurité dit quand s'arrêter, sans vocabulaire médical.
5. `not_for_minors` et le niveau suivent le §5 ; les doutes sont dans `review_notes`.
