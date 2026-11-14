# Fiches exercices : à trancher avant relecture

> **Tranché le 14 novembre 2026** : le propriétaire a tout relu et valide tous les choix tels que rédigés dans les fiches. Aucune fiche n'est corrigée à la suite de ce document. Les points du §7 restent à voir avec la relectrice santé lors du feu vert santé, avant publication.

Les 84 fiches de `data/exercises/` sont en `draft` : les 2 étalons écrits à la main et les 82 brouillons du commit `81ca630` (lots A et B), rédigés dans Claude Code selon `prompt-v1.md`. Chaque `review_notes` liste les doutes de sa fiche. Ce document les regroupe par question, pour trancher une fois ce qui revient sur plusieurs fiches, avant de passer fiche par fiche dans `/admin/exercises`.

Rappels :

- **Volume des modèles.** Plusieurs groupes sont pile sur une borne (`lot-a.md`, choix 2) : fessiers, quadriceps, dorsaux. Toute correction de `primary_muscles` ou `secondary_muscles` se vérifie avec `pnpm data:validate`.
- **Chaînes.** Le lot B a déjà décidé de laisser ses régressions hors chaîne (`lot-b.md`, choix 3). Les questions de chaîne ci-dessous ne rouvrent ce choix que si le propriétaire le veut.
- `draft` → `reviewed` exige la case « consignes et sécurité vérifiées » et `not_for_minors` confirmé (04 §8).

## 1. Matériel implicite, absent des options

Le plus fréquent. La fiche suppose un objet qui n'est pas un code de la taxonomie, ou qui l'est mais n'est pas dans `equipment_options`. **À décider une fois** : ajouter des codes (par exemple un point d'ancrage pour l'élastique ou un support pour monter), ajouter des options, ou garder la règle du lot A (choix 8) : l'appui n'est pas un code, la mise en place le dit.

| Objet manquant | Fiches |
|---|---|
| Point d'ancrage pour l'élastique (porte, poteau) | `band-external-rotation`, `band-lat-pulldown` (en hauteur), `band-pallof-press` (hauteur de poitrine). `band-row` a été écrit sans ancrage (assis, élastique sous les pieds) pour cette raison |
| Chaise ou banc pour monter à la barre | `band-assisted-pull-up`, `negative-pull-up`, `weighted-pull-up` |
| Banc ou chaise d'appui | `one-arm-dumbbell-row` (appui sur la cuisse proposé en repli ; ajouter `flat_bench` / `chair` aux options ?), `overhead-dumbbell-triceps-extension` (option assise), `seated-cable-row` (assise à la poulie réglable), `supported-single-leg-romanian-deadlift` (mur ; ajouter une chaise ?) |
| Meuble lourd ou partenaire pour caler les chevilles | `nordic-curl`, `assisted-nordic-curl` |
| Montant de porte | `assisted-pistol-squat`, `door-frame-row` (la porte n'est pas dans la taxonomie) |
| Supports de la cage à mi-cuisse | `barbell-row`, `romanian-deadlift` : seule la barre est listée ; garder la mention ou la retirer |
| Box citée dans les conseils | `back-squat` (conseil plus facile), `parallel-bar-dip` |
| Accessoires | `face-pull` (corde, supposée fournie avec la poulie), `hip-thrust` (mousse de barre, serviette proposée), `weighted-pull-up` (ceinture de lest : la fiche tient la charge entre les pieds, moins stable), `adductor-squeeze` (coussin ou ballon, poings en repli), `reverse-nordic-curl` (tapis conseillé), `band-lat-pulldown` (tapis à genoux), `lat-pulldown` (le boudin de cuisses manque souvent sur une poulie réglable) |
| En option seulement, cohérent | `standing-calf-raise` (marche d'escalier) |

## 2. Articulations sollicitées (`stressed_joints`)

Une articulation listée rend la fiche sensible. **Règle à fixer** : une version allégée reprend-elle les articulations de sa chaîne, ou seulement celles qu'elle charge vraiment ?

- **Reprises de la version complète, sans doute trop pour une version légère** : `wall-push-up`, `incline-push-up` (épaules et poignets de la pompe), `chair-squat` (genoux et hanches), `knee-side-plank` (épaule d'appui), `band-row` (épaules, par cohérence avec les rowings).
- **Épaules sur les rowings** : `door-frame-row`, `inverted-row`, `seated-cable-row`, `table-row`, `band-row`. Même choix pour tous.
- **Aucune articulation retenue** : `adductor-squeeze`, `band-pallof-press`, `cable-pallof-press`, `bird-dog`, `front-plank`, `knee-plank`, `hollow-body-hold`. Le bas du dos se discute pour les planches et le hollow body si le dos se creuse ou décolle.
- **Bas du dos** :
  - ajouté pour `hip-thrust` (dos qui se creuse en haut) et `leg-press` (bassin qui décolle) ;
  - non retenu pour `glute-bridge`, `dumbbell-reverse-fly` (buste penché), `one-arm-dumbbell-row` (appui) et `single-leg-romanian-deadlift` (sans charge).
- **Épaule d'appui** : retenue pour `side-plank` et `knee-side-plank`, pas pour `copenhagen-plank` ni `copenhagen-plank-short-lever`. Même choix pour les quatre.
- **Au cas par cas** :
  - `deadlift` : genoux ajoutés.
  - `assisted-pistol-squat` : chevilles ajoutées (grande flexion).
  - `single-leg-romanian-deadlift` : chevilles (équilibre).
  - `parallel-bar-dip` : poignets en 3e articulation ?
  - Curls : poignets retenus pour `barbell-curl` (prise droite), pas pour `dumbbell-curl` ni `ez-bar-curl`.
  - `elevated-pike-push-up` : la nuque (tête en bas) n'existe pas dans la taxonomie.

## 3. Niveaux et mineurs

- **`nordic-curl`** : le guide de style (§5) cite le Nordic complet comme exemple de niveau 3. La fiche est la version excentrique (`lot-a.md`, choix 5), au niveau 2 et permise aux mineurs. Confirmer, et se demander si le nom « Nordic » doit dire « excentrique ».
- **`not_for_minors` à confirmer** :
  - `deadlift` (faux, alors que le mouvement est associé à la charge maximale) ;
  - `reverse-nordic-curl` (faux, forte tension à l'avant du genou) ;
  - `parallel-bar-dip` (vrai, `lot-b.md` choix 5) ;
  - `squat-jump` (faux, impact modéré).
- **Niveau 1 discutable** :
  - `hollow-body-hold` (position complète exigeante) ;
  - `bodyweight-triceps-extension` (coudes très chargés sur un appui bas) ;
  - `hip-thrust` (mise en place de la barre délicate pour un débutant) ;
  - `copenhagen-plank-short-lever` (la jambe du dessous décolle) ;
  - `back-extension` (avec les lombaires en principal).
- **Niveau 2 discutable** : `assisted-pistol-squat` (juste selon le rédacteur), `single-leg-romanian-deadlift` (sans charge).
- **Cohérents** : `archer-push-up`, `weighted-pull-up` et `copenhagen-plank-leg-raise` au niveau 3, déconseillés aux mineurs. `jump-landing` au niveau 1, ouvert aux mineurs.

## 4. Muscles

- **`bench-press`** : triceps en principal, en secondaire sur `dumbbell-bench-press` et `machine-chest-press`. À harmoniser, en vérifiant le volume.
- **Mollets en secondaire** sur `nordic-curl`, `assisted-nordic-curl` et `leg-curl` : rôle faible.
- **`back-extension`** : lombaires, fessiers et ischio-jambiers tous en principaux.
- **`bird-dog`** : voir `lot-b.md`, choix 7.

## 5. Chaînes et progressions

- **Régressions hors chaîne** (décision du lot B, à maintenir ou non) :
  - `knee-side-plank` → `side-plank` ;
  - `kneeling-pike-push-up` → `pike-push-up` ;
  - `supported-single-leg-romanian-deadlift` → `single-leg-romanian-deadlift`.
- **Lot A, non tranché** : `dumbbell-reverse-lunge` avec `reverse-lunge`, et `dumbbell-step-up` avec `step-up`. Chaînes à créer ?
- **Sauts de progression** :
  - `decline-push-up` renvoie à la pompe archer, faite pieds au sol ;
  - la chaîne `glute-bridge` passe de `single-leg-glute-bridge` à `hip-thrust`, ce qui ajoute à la fois de la difficulté et du matériel.

## 6. Choix de rédaction à valider

- **Version décrite** :
  - `copenhagen-plank-leg-raise` : maintien statique. Si la version voulue est dynamique, la mesure passe en répétitions et la chaîne Copenhague, tout en durée, est touchée.
  - `archer-push-up` : un côté puis l'autre, ou en alternance ?
  - `back-extension` : une seule fiche pour le banc à 45° et le GHD ?
  - `leg-press` : écrite pour une presse inclinée à sécurités.
  - `leg-curl` : reste générale (assis ou allongé).
  - `pull-up` : prise en pronation.
- **Chiffres** :
  - `barbell-row` : inclinaison « à mi-chemin », sans angle.
  - `incline-dumbbell-bench-press` : 30°.
  - `step-up` et `dumbbell-step-up` : « à hauteur de genou au plus » ; une chaise peut dépasser pour une petite taille.
  - `squat-jump` : profondeur non chiffrée.
- **Alias** :
  - `dumbbell-romanian-deadlift` : les abréviations refusées par le glossaire, donc introuvables à la recherche.
  - `leg-extension` : nom anglais = nom de la fiche.
  - `bird-dog` : « Superman à quatre pattes » à valider.
- **`ez-bar-curl`** : mode de charge `barbell` avec la barre EZ.

## 7. Sécurité, pour la relectrice santé

- **Chute ou bascule** :
  - `table-row` : la table bascule sur la personne ;
  - `door-frame-row` : prise du bout des doigts, glissade et chute en arrière ;
  - `inverted-row` : la barre posée sur les supports roule si on tire de travers ;
  - `weighted-pull-up` : la charge tombe sur les pieds ;
  - `overhead-dumbbell-triceps-extension` : la charge passe au-dessus de la tête.
- **Consignes précises** :
  - `overhead-press` : en développé debout, les sécurités ne rattrapent pas une barre bloquée en haut, d'où la consigne de la ramener ;
  - `leg-press-calf-raise` : ne pas verrouiller les genoux ;
  - `bodyweight-triceps-extension` : le front s'approche du bord ;
  - `band-lateral-raise` : garder les épaules basses quand la tension monte ;
  - `dumbbell-external-rotation` : l'appui sur l'épaule du dessous peut gêner.
- **Courbatures fortes les premières fois** : `negative-pull-up`, `assisted-nordic-curl`.
- **À trancher** : `elevated-pike-push-up` (nuque) et `dumbbell-romanian-deadlift` (étalon : niveau 1, articulations).

## 8. Sans doute particulier

`bodyweight-squat`, `bulgarian-split-squat`, `cable-external-rotation`, `cable-lateral-raise`, `cable-triceps-pushdown`, `dumbbell-bench-press`, `dumbbell-lateral-raise`, `goblet-squat`, `machine-chest-press`, `pike-push-up`, `reverse-lunge`, `seated-dumbbell-shoulder-press`, `single-leg-calf-raise`. Relecture ordinaire des consignes et de la sécurité. `push-up` (étalon) n'a que le point des articulations (§2).
