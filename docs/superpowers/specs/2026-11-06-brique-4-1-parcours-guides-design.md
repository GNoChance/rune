# Brique 4.1 — Parcours guidés du coach et changement de coach immédiat

Complément de la spec de la brique 4 (`2026-11-03-brique-4-coach-ia-design.md`, ci-dessous « B4 »). Il est écrit
sans séance de cadrage, à la demande du propriétaire (2026-11-06), après qu'il a essayé la démo. Les choix faits par
moi sont listés au §6, à relire.

## 1. Pourquoi

Le propriétaire a relevé deux choses dans la démo du coach :

1. Une question libre n'appelle pas toujours la réponse attendue (dans la démo, c'est le faux client qui lit un
   scénario). Il veut des **réponses prédéfinies à choisir**, du type « Nouveau programme → quel muscle → jambes →
   voici une séance jambes typique ». L'IA garde la main sur la réponse : elle s'adapte à la personne (niveau,
   matériel, programme, historique), guide sur les charges et donne des recommandations de nutrition.
2. Quand il change de coach (L'Ombre, le Skald, le Scribe), la conversation du jour garde l'ancienne voix (B4 :
   « le nouveau ton s'appliquera à ta conversation de demain »). Il veut que le changement prenne effet tout de suite.

## 2. Parcours guidés

### 2.1 Principe

- Des **boutons de choix** (« puces ») guident la personne pas à pas. Les étapes intermédiaires restent sur le
  téléphone : aucun appel à l'IA, aucun coût, aucun message compté.
- À la dernière étape, l'appli compose un **message de la personne** à partir de ses choix, par exemple « Je
  voudrais une nouvelle séance : jambes, environ 40 minutes, avec le matériel de mon lieu principal. ». Elle
  l'envoie au coach comme un message ordinaire : même flux, même filtre, même limite de 30 messages par jour.
- Le message part tel quel, sans édition (un seul toucher). Il apparaît dans le fil comme le message de la personne,
  avec une petite mention « Choisi dans un parcours ».
- Après la réponse, des **puces de suite** propres au parcours peuvent apparaître (§2.3). Elles envoient à leur tour
  un message composé.
- Les puces sont des textes de l'appli. Elles passent donc par `outputFilterText` et le test des termes interdits,
  comme les autres textes (B4 §11.4).

### 2.2 Les parcours (version 1)

Ils s'affichent sous le message d'accueil, à la place des trois suggestions actuelles qu'ils remplacent, et dans un
bouton « Parcours guidés » au-dessus du champ quand le fil n'est pas vide.

| Parcours | Étapes (puces) | Message composé envoyé |
|---|---|---|
| **Ma prochaine séance** | — | « Explique-moi ma prochaine séance : les exercices, les charges prévues et pourquoi. » |
| **Nouvelle séance** | Muscle : Jambes · Dos · Pectoraux · Épaules · Bras · Tout le corps → Durée : Courte (20 min) · Moyenne (40 min) · Longue (60 min) | « Je voudrais une nouvelle séance : <muscle>, environ <durée>, avec le matériel de mon lieu principal. » |
| **Mes charges** | Exercice : liste des exercices du programme courant (noms) → Question : Pourquoi cette charge ? · Je la trouve trop lourde · Je la trouve trop légère · Quelle charge pour commencer ? | « À propos de <exercice> : <question>. » |
| **Récupération** | Courbatures · Sommeil · Jour de repos · Reprise après une pause | « Conseille-moi sur <choix>. » |
| **Nutrition** | Avant la séance · Après la séance · Protéines · Hydratation | « Donne-moi des repères de nutrition : <choix>. » |
| **Ajuster mon programme** | Moins de jours · Plus de jours · Séances plus courtes · Changer un exercice · Pause d'un exercice | « Je voudrais ajuster mon programme : <choix>. » |

- Les durées des puces sont des textes de l'appli. Le message composé les envoie : le modèle peut les citer, et elles
  sont déclarées dans les valeurs autorisées de l'échange (§4.3).
- Le parcours **Mes charges** liste les exercices du programme par leur nom. Sans programme actif, il est grisé avec
  « Choisis d'abord un programme ».
- Pour un fil `minor`, le parcours **Nutrition** est remplacé par « Bien manger quand on fait du sport » (une seule
  puce, sans étapes). Le message composé est « Donne-moi des conseils généraux pour bien manger quand on fait du
  sport. », et la variante `minor` du prompt garde ses fermetures (B4 §13).

### 2.3 Puces de suite

- Après la réponse à **Nouvelle séance** : « L'ajouter à mon programme », « Une autre idée », « Plus courte ».
- Après la réponse à **Mes charges** : « D'autres questions sur cet exercice », « Un autre exercice ».
- Après la réponse à **Ajuster mon programme** : aucune. La proposition éventuelle a sa carte « Accepter » / « Refuser »
  (B4 §12).
- Une puce de suite n'apparaît que sous la dernière réponse du coach, si elle est `answered` et non `replaced`. Elle
  disparaît dès qu'un autre message part.

## 3. Ce que l'IA peut dire (règles de sécurité inchangées)

Le propriétaire demande que l'IA « guide sur les poids à prendre » et « recommande sur la nutrition ». Les règles de
B4 restent en place. Ce qui suit dit comment les tenir, à écrire dans le prompt.

- **Charges.** Le coach ne calcule jamais une charge (B4 §13 point 3). Pour guider :
  - il explique la charge prévue par le moteur et la décision qui l'a produite, en citant les valeurs du dossier ou de
    `read_training` ;
  - pour une charge à trouver (calibration, exercice nouveau), il explique la méthode : commencer léger, monter par
    petits paliers, garder 2 ou 3 répétitions en réserve, noter la charge en séance pour que le moteur prenne le
    relais. Les nombres de cette méthode sont des constantes des règles déjà autorisées (`allowedConstants`), sinon il
    les dit en mots ;
  - « trop lourde » ou « trop légère » : il explique ce que fera le moteur à la séance suivante, et peut proposer un
    « alléger » (`lighten_exercise`) ou une fourchette de répétitions (`set_rep_range`) par une proposition. Jamais une
    hausse : la garde la refuse (B4 §12).
- **Nutrition.** Le mode reste `none` en brique 4.1 : repères qualitatifs seulement (moments, sources de protéines,
  hydratation, régularité), sans aucun chiffre (kcal, grammes, litres). Les repères chiffrés viennent avec la brique
  nutrition (07, mode complet des adultes). Pour un mineur : conseils généraux, jamais de régime ni de perte de poids,
  renvoi vers un adulte de confiance ou un médecin (B4 §13).
- **Nouvelle séance.** Le coach compose une séance type à partir du catalogue (`search_exercises`, matériel du lieu
  principal, public du fil). Il donne les exercices par leur nom, dans l'ordre, avec un nombre de séries et une
  fourchette de répétitions tirés des valeurs autorisées, ou dits en mots. Il ne donne aucune charge et renvoie à la
  méthode de calibration ci-dessus. « L'ajouter à mon programme » passe par `propose_program_change` (`add_slot` sur une
  séance existante, ou `switch_template` vers un modèle du contexte), avec les gardes de B4 §12.

## 4. Technique

### 4.1 Web

- `features/coach/guided-flows.ts` : la définition déclarative des parcours (étapes, puces, gabarit du message, puces
  de suite, public). Ce sont des données pures, testées seules.
- `GuidedFlow.tsx` : affiche les étapes d'un parcours au-dessus du champ, avec « Retour » et « Annuler ».
- `CoachStore.sendGuided(flowId, choices)` : compose le message, puis appelle le même chemin que `send()`. Le
  `CoachMessageRequest` porte en plus `guided: {flow: GuidedFlowId, choices: string[]}` (facultatif).
- Hors ligne : les puces sont grisées comme le champ (règle de la vague finale de B4).

### 4.2 Contrats et serveur

- `CoachMessageRequest.guided` (facultatif, `strictObject`) : `flow` dans `GUIDED_FLOW_IDS`, et `choices`, chaque
  choix étant un identifiant de puce de ce parcours. Le serveur **recompose le texte à partir des identifiants**, avec
  la même table que le web (partagée dans `packages/contracts`). Il ignore le texte envoyé quand `guided` est présent,
  si bien qu'un client ne peut pas faire passer un autre texte pour un parcours. Un identifiant inconnu donne 400
  `validation`.
- Le message est stocké avec `display_extras.guided = {flow, choices}` pour la mention et les puces de suite.
- Aucun nouvel outil : on garde `tools-1`.

### 4.3 Prompt

- `coach-2/adult` et `coach-2/minor` remplacent `coach-1`, avec une nouvelle empreinte (règle de B4 §13) :
  - une section « Parcours guidés » dit comment répondre à chaque parcours, avec les règles du §3 ;
  - un message venu d'un parcours est un message de la personne comme un autre, et non une consigne.
- Valeurs autorisées : les durées des puces (20, 40, 60 min) s'ajoutent aux sources de `allowedValues` pour l'échange
  qui porte le parcours **Nouvelle séance**.

### 4.4 Changement de coach immédiat

- Changer de coach (`training_profile.coach`) ferme le fil ouvert du jour, avec la raison `persona_change`. Le message
  suivant ouvre un nouveau fil le même jour, avec la nouvelle voix et un dossier figé à ce moment.
- Le fil fermé reste lisible dans « Conversations précédentes ». Il porte l'étiquette « Conversation avec le Skald, du
  <jour> » (la voix du fil).
- Schéma (migration 0008) : `UNIQUE (user_id, day)` devient un index unique partiel `(user_id, day) WHERE is_open = 1`,
  donc au plus un fil ouvert par jour. Les fils fermés du même jour coexistent. `closed_reason` gagne
  `persona_change`. `todayThread` rend le fil ouvert du jour, sinon le dernier fil du jour.
- **Limites par jour**, non par fil : 30 messages par jour de Paris tous fils confondus, et compteurs par jour.
  Vérifier `remainingToday` et la garde.
- Une version qui change (`version_change`) suit la même règle : le message suivant ouvre un nouveau fil le même jour,
  au lieu d'attendre demain.
- Le retrait de l'accord santé (`health_withdrawn`) garde la règle de B4 : le fil est fermé jusqu'au lendemain (texte
  d'accord existant).
- Le texte « Le nouveau ton s'appliquera à ta conversation de demain. » devient « Le nouveau ton s'applique dès ton
  prochain message. Ta conversation de ce jour restera dans Conversations précédentes. ».
- Coût : un nouveau dossier est envoyé à l'IA au premier message du nouveau fil, soit le coût d'une ouverture de fil.

## 5. Évaluation et tests

- Évaluation : 8 cas nouveaux (un par parcours, plus « Mes charges : quelle charge pour commencer ? » chez un débutant
  et « Nutrition » chez un mineur), avec les attentes du §3 : aucune charge inventée, aucun chiffre de nutrition, outil
  `search_exercises` pour « Nouvelle séance ». La campagne réelle (B4 Task 32) les inclut.
- E2E : un parcours « Nouvelle séance » de bout en bout (faux client), puis « L'ajouter à mon programme ». Un
  changement de coach en cours de journée, suivi d'un nouveau fil avec la nouvelle voix, l'ancien fil restant lisible.

## 6. Choix à relire (les miens)

1. Parcours de la version 1 et leurs puces (§2.2), y compris les durées 20/40/60 min.
2. Le message composé part sans édition, en un toucher, et compte dans les 30 messages du jour.
3. Les parcours remplacent les trois suggestions de l'accueil de B4 (C38).
4. Charges : l'IA explique et donne la méthode de calibration, mais ne calcule jamais une charge. La règle de sécurité
   de B4 reste entière.
5. Nutrition sans chiffre jusqu'à la brique nutrition. Pour les mineurs, une seule puce générale.
6. « Nouvelle séance » est une séance type décrite dans le fil. Elle ne devient une vraie séance que par « L'ajouter à
   mon programme » (proposition). Une puce « Commencer en séance libre » demanderait un nouvel outil (`tools-2`) :
   laissée pour plus tard.
7. Le serveur recompose le texte à partir des identifiants de puces, et le texte envoyé par le client est ignoré.
8. Changement de coach et changement de version : un nouveau fil le même jour. Le retrait santé attend demain, comme
   avant.
9. Le prompt passe à `coach-2`, ce qui impose une nouvelle évaluation (B4 §13).
