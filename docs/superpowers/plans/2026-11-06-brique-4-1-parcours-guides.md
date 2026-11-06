# Brique 4.1 — Parcours guidés et changement de coach immédiat : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development. Les étapes utilisent des cases
> `- [ ]`.

**But :** des parcours à puces qui composent un message adapté envoyé au coach, et un changement de coach qui prend
effet tout de suite (nouveau fil le même jour).

**Architecture :**
- La table des parcours est partagée dans `packages/contracts`. Le web l'affiche, et le serveur recompose le texte à
  partir des identifiants de puces.
- Le schéma passe à un fil ouvert par jour au plus (index unique partiel). Un changement de coach ou de version ouvre
  un nouveau fil le même jour.
- Le prompt passe de `coach-1` à `coach-2`.

**Stack :** celle de la brique 4 (Zod, Hono, Kysely, node:sqlite, React 19, Dexie, Vitest, Playwright).

**Spec :** `docs/superpowers/specs/2026-11-06-brique-4-1-parcours-guides-design.md`, appuyée sur la spec de la brique 4
`docs/superpowers/specs/2026-11-03-brique-4-coach-ia-design.md`.

## Contraintes globales

- Toutes celles de la brique 4 (`.superpowers/sdd/2026-11-03-brique-4-coach-ia/global-constraints.md`) :
  - domaine pur ;
  - textes en français, apostrophes droites ;
  - aucun contenu dans les journaux ;
  - les textes de plusieurs phrases passent par `outputFilterText` ;
  - les écrans du coach se chargent par `import()`.
- Règles de sécurité de B4 §13 inchangées :
  - jamais de charge calculée ;
  - nutrition sans chiffre (`nutritionMode: 'none'`) ;
  - fermetures de la variante `minor`.
- Le message composé compte comme un message (30 par jour de Paris, tous fils confondus).

## Points d'attention de la relecture

1. Un client qui envoie `guided` avec un texte différent : le serveur ignore le texte et recompose.
2. Changer de coach pendant un échange en cours : l'échange s'enregistre dans son fil, qui se ferme ensuite.
3. Deux appareils qui ouvrent un fil le même jour après un `persona_change` : un seul fil ouvert (index partiel).
4. Limite du jour sur deux fils : 30 messages au total.
5. Hors ligne au milieu d'un parcours : les puces sont grisées et rien ne part.

---

### Task 1: Contrats — table des parcours et requête

**Files :**
- Create : `packages/contracts/src/coach-guided.ts`, `packages/contracts/test/coach-guided.test.ts`.
- Modify : `packages/contracts/src/coach.ts` (`CoachMessageRequest.guided`, `closed_reason` `persona_change`), `index.ts`.

**Produit :**
- `GUIDED_FLOW_IDS = ['next_session', 'new_session', 'loads', 'recovery', 'nutrition', 'adjust_program'] as const` ;
- `GuidedFlow {id; label; audience: 'all' | 'adult' | 'minor'; steps: GuidedStep[]; compose(choices, names): string; followUps: GuidedFollowUp[]}` ;
- `GuidedStep {id; prompt; chips: {id; label}[] | 'program_exercises'}` ;
- `GUIDED_FLOWS: readonly GuidedFlow[]`, avec les libellés et gabarits du §2.2 de la spec, mot pour mot ;
- `nutrition_minor` (une puce) pour le public `minor` ;
- `composeGuidedMessage(flowId, choices, names: (exerciseId) => string | null): string`, qui lève `GuidedInvalidError`
  sur un identifiant inconnu ou un nombre de choix faux ;
- `guidedAllowedValues(flowId, choices): {duration_min: number[]}` (20, 40 ou 60 selon la puce) ;
- `CoachMessageRequest.guided?: {flow, choices: string[]}`.

- [ ] Tests :
  - chaque parcours compose le texte exact de la spec ;
  - un identifiant inconnu lève une erreur ;
  - « Mes charges » prend le nom par `names` ;
  - un mineur n'a ni `nutrition` ni les puces adultes ;
  - chaque libellé et chaque texte composé passe `outputFilterText` (adulte et mineur, avec les durées autorisées)
    sans terme interdit ;
  - schéma `guided` strict.
- [ ] Commit `feat(contracts): table des parcours guidés du coach`.

### Task 2: Serveur — un fil ouvert par jour, changement de coach immédiat

**Files :**
- Create : `apps/server/src/db/migrations/0008_coach_threads_per_day.ts`.
- Modify : `coach/threads.ts`, `coach/orchestrator.ts` (garde, `remainingToday`), `coach/views.ts`, le crochet de
  synchronisation de `training_profile` (changement de `coach`), les tests associés.

**Produit :**
- Migration 0008 : `coach_thread` sans `UNIQUE (user_id, day)`, avec un index unique partiel `(user_id, day) WHERE
  is_open = 1`. `closed_reason` accepte `persona_change`. La table est reconstruite avec `coach_message` et ses clés
  étrangères intactes, et un test de migration vérifie les données conservées.
- `todayThread` rend le fil ouvert du jour, sinon le dernier fil du jour. `openTodayThread` ouvre un nouveau fil si le
  fil du jour est fermé pour `persona_change` ou `version_change`, et garde la règle de B4 pour `health_withdrawn` et
  `day_over`.
- Un changement de `training_profile.coach` (push de synchro, `afterApply`) ferme le fil ouvert du jour avec
  `persona_change`. Un échange en cours finit dans son fil : l'enregistrement relit `is_open`. Ruling : l'échange qui a
  commencé avant le changement s'enregistre quand même. La fermeture attend la fin du bail, ou l'enregistrement accepte
  un fil fermé `persona_change` pendant le bail. Choisir le plus simple et le tester.
- La limite du jour et `remainingToday` comptent tous les fils du jour.

- [ ] Tests :
  - changement de coach puis message : nouveau fil avec la nouvelle voix et l'ancien lisible ;
  - deux appareils : un seul fil ouvert ;
  - 30 messages répartis sur deux fils, puis refus ;
  - `version_change` : nouveau fil le même jour ;
  - `health_withdrawn` : toujours fermé jusqu'à demain ;
  - changement pendant un échange : l'échange est enregistré ;
  - migration : données conservées.
- [ ] Commit `feat(server): changement de coach immédiat, un fil ouvert par jour`.

### Task 3: Serveur — message guidé

**Files :**
- Modify : `coach/orchestrator.ts` (`prepareExchange`), `coach/record.ts` (`display_extras.guided`), `coach/attempt.ts`
  ou sa source des valeurs autorisées, ainsi que les tests.

**Produit :**
- avec `guided`, le texte est recomposé par `composeGuidedMessage`, avec les noms des exercices du catalogue servi et
  du programme courant de la personne. Le texte du client est ignoré, et un identifiant inconnu donne 400 `validation` ;
- le parcours `loads` n'accepte que les exercices du programme courant de la personne ;
- un mineur ne peut pas envoyer `nutrition` (400) ;
- `display_extras.guided = {flow, choices}` est stocké sur le message de la personne ;
- `guidedAllowedValues` entre dans les valeurs autorisées de l'échange (filtre et outils).

- [ ] Tests :
  - texte du client ignoré ;
  - identifiant inconnu donne 400 ;
  - exercice hors programme donne 400 ;
  - mineur avec `nutrition` donne 400 ;
  - « 40 min » relayé pour `new_session` et bloqué sans le parcours ;
  - `display_extras` stocké ;
  - journaux sans le texte.
- [ ] Commit `feat(server): messages des parcours guidés recomposés par le serveur`.

### Task 4: Prompt `coach-2` et évaluation

**Files :**
- Modify : `apps/server/src/coach/prompts/*`, `packages/domain/src/coach/config.ts` (`promptVersion` `coach-2`),
  `apps/server/test/coach/prompts.test.ts` (empreintes `coach-2`), `eval/coach/cases/*` (8 cas nouveaux),
  `scripts/coach-eval/*` si besoin (champ `guided` des cas).

**Produit :**
- une section « Parcours guidés » dans les deux variantes, avec les règles du §3 de la spec : méthode de calibration
  sans charge calculée, nutrition qualitative, séance type par `search_exercises`, proposition pour « L'ajouter à mon
  programme » ;
- empreintes `coach-2` figées ;
- 8 cas d'évaluation (§5 de la spec), avec `mustNotMatch` sur les charges inventées (`\d+\s*kg` hors valeurs du
  dossier : contrôle par le filtre) et sur la nutrition chiffrée ;
- `pnpm coach:eval --fake` vert.

- [ ] Tests : prompts (sections présentes, empreintes), cas valides (`cases.test.ts` à jour), `run.test.ts` en `--fake`.
- [ ] Commit `feat(server): prompt coach-2 avec les parcours guidés, cas d'évaluation`.

### Task 5: Web — parcours guidés

**Files :**
- Create : `apps/web/src/features/coach/GuidedFlow.tsx`, `apps/web/test/coach/guided-flow.test.tsx`.
- Modify : `coach-store.ts` (`sendGuided`), `CoachPage.tsx` (parcours à la place des suggestions, bouton « Parcours
  guidés », puces de suite, mention « Choisi dans un parcours »), `coach-texts.ts`, `coach-repo.ts` (`guided` dans le
  corps).

**Produit :**
- étapes locales, avec « Retour » et « Annuler » ;
- un toucher final qui envoie `{text: composé, guided}` ;
- puces de suite sous la dernière réponse `answered` du parcours ;
- « Mes charges » listant les exercices du programme, ou grisé sans programme ;
- variante `minor` ;
- hors ligne, tout est grisé ;
- cibles de 48 px, contrastes testés.

- [ ] Tests :
  - parcours « Nouvelle séance » de bout en bout dans la page (faux dépôt) : corps exact ;
  - aucun appel aux étapes intermédiaires ;
  - « Annuler » n'envoie rien ;
  - puces de suite après `done` seulement ;
  - mineur sans « Nutrition » adulte ;
  - hors ligne grisé ;
  - textes filtrés.
- [ ] Commit `feat(web): parcours guidés du coach`.

### Task 6: Web — changement de coach immédiat

**Files :**
- Modify : `MyCoachPage.tsx` (texte de la feuille « Changer de coach »), `ThreadsPage.tsx` (étiquette avec la voix),
  `coach-store.ts` (après un changement de coach, relire `today`), `coach-texts.ts`, tests.

**Produit :**
- nouveau texte de la feuille (spec §4.4) ;
- la liste des conversations affiche « Conversation avec le Skald » ;
- la conversation du jour repart vide avec la nouvelle voix après le changement, sans rechargement ;
- l'en-tête montre la nouvelle voix.

- [ ] Tests : texte exact, étiquette, en-tête et fil vide après changement.
- [ ] Commit `feat(web): changement de coach immédiat`.

### Task 7: E2E

**Files :** `apps/web/e2e/coach.spec.ts` (ou un nouveau `coach-guided.spec.ts`) et son scénario.

- [ ] « Nouvelle séance » (Jambes, Moyenne), réponse, puis « L'ajouter à mon programme », proposition et Accepter.
- [ ] Changement de coach en cours de journée : nouveau fil, voix changée, ancien fil dans « Conversations
  précédentes ».
- [ ] `timeout 900 pnpm --filter @rune/web test:e2e` vert. Commit `test(e2e): parcours guidés et changement de coach`.
