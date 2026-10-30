# Rédaction des brouillons par l'API Claude : notes

Notes de `pnpm exercises:draft` (04 §9 ; spec de la brique 2, §5). Les valeurs de l'API sont à revérifier avant le pilote et avant chaque lot (spec brique 2 §5, point 3), puis à reporter ici avec la date.

## Lancer le script

1. Créer `.env.local` à la racine du dépôt (ignoré par git par la règle `.env.*` de `.gitignore`) avec la clé d'un workspace Anthropic **de développement**, distinct de celui du coach :

   ```
   ANTHROPIC_API_KEY=<clé>
   ```

   La clé ne s'écrit nulle part ailleurs : ni fichier versionné, ni journal, ni rapport, ni message de commit. Le script ne l'affiche jamais. Sans `.env.local` (ou sans la ligne), il prend la variable d'environnement `ANTHROPIC_API_KEY` du poste, là où la procédure P5 (`docs/exploitation/P5-rotation-secrets.md`) range la clé de `rune-dev` ; `.env.local` passe en premier.
2. Les squelettes `data/exercises/<id>.json` existent au statut `draft` et passent `pnpm data:validate`.
3. `pnpm exercises:draft` rédige tous les `draft` dont aucun champ IA n'est rempli ; `pnpm exercises:draft --ids goblet-squat,lat-pulldown` rédige ces fiches-là (une fiche déjà rédigée est réécrite : ne jamais passer les ids des étalons, `push-up` et `dumbbell-romanian-deadlift`). Options : `--model <id>` (prix connu exigé), `--max-tokens <n>` (16 000 par défaut), `--dir <dossier data>`.
4. Le script affiche une ligne par fiche (rédigée, refusée, échec, non envoyée) avec son coût, le coût total, puis le résultat de `data:validate`. Sortie 0 si tout est rédigé et le catalogue valide, 1 sinon. Il refuse de tourner quand la variable `CI` est définie.
5. Relire le diff, lancer `pnpm data:validate`, ouvrir la PR (04 §8, étape 2).

## État au 2026-10-30 : étalons et squelettes prêts, pilote en attente

- **Prêts** (plan de la brique 2, tâche 18, étapes 1 à 3) : les 2 fiches étalons écrites à la main (`push-up`, `dumbbell-romanian-deadlift` ; `draft`, lot `A`, `drafting.origin` `human`) et 64 squelettes du lot A provisoire, listés dans `docs/catalog/lot-a-provisoire.md`. `pnpm data:validate` passe ; `pnpm data:validate --strict` échoue seulement sur R-EQ-5 (5 codes de matériel encore inutilisés, attendus au lot B). Le test « data/ du dépôt sur base vide » de `apps/server/test/catalog/routes.test.ts` vérifie que les 66 fiches sont amorcées en `draft`, visibles dans `GET /api/review/exercises` et absentes de `GET /api/catalog`.
- **Pilote en attente** (étape 4). Avant de le lancer, dans l'ordre :
  1. le propriétaire valide la liste du lot A (ids, noms, niveaux, chaînes ; questions en fin de `lot-a-provisoire.md`) ;
  2. l'admin et les relectrices relisent les deux étalons dans l'appli ; l'admin les passe en `reviewed`, exporte le catalogue puis lance `pnpm data:pull`. Le script ne montre au modèle que des étalons `reviewed` ou `published` : sans cette étape, le prompt dit « Aucune fiche étalon n'est encore relue » ;
  3. le propriétaire pose la clé dans `.env.local` ;
  4. revérifier le modèle et les prix (section suivante et `MODEL_PRICES`), avec la date.
- **Pilote proposé** (5 fiches variées, spec de la brique 2 §5, point 3) : `back-squat` (sensible, à la barre), `lat-pulldown` (machine), `front-plank` (sans matériel, chaîne, en durée), `incline-push-up` (chaîne, voisine de l'étalon `push-up`), `band-external-rotation` (élastique, unilatéral) :

  ```
  pnpm exercises:draft --ids back-squat,lat-pulldown,front-plank,incline-push-up,band-external-rotation
  ```

  Toujours passer `--ids` pendant le pilote : sans, le script rédigerait les 64 squelettes d'un coup.

## Valeurs vérifiées le 2026-10-30

Sources : documentation officielle d'Anthropic, consultée le 2026-10-30.

- Modèles : https://platform.claude.com/docs/en/about-claude/models/overview
- Prix : https://platform.claude.com/docs/en/about-claude/pricing
- Effort : https://platform.claude.com/docs/en/build-with-claude/effort
- Sortie structurée : https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Cache de prompt : https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Raisons d'arrêt : https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
- SDK TypeScript : `@anthropic-ai/sdk` 0.135.0 (types `OutputConfig`, `Usage`, `StopReason` lus dans le paquet installé).

### Modèle

- Identifiant `claude-opus-5-5` (Claude Opus 5.5) : modèle conseillé par défaut dans la documentation. Identifiant sans date = instantané figé. Contexte 1M jetons, sortie 128K au plus, retrait pas avant le 22 septembre 2027.
- Réflexion adaptative **toujours active** : `thinking: {type: "disabled"}` et `budget_tokens` donnent une erreur 400. Le client n'envoie donc pas de paramètre `thinking` ; l'effort règle la profondeur. La réflexion compte dans `max_tokens` et dans les jetons de sortie facturés.

### Effort

- `output_config.effort`, sans en-tête bêta, valeurs `low`, `medium`, `high`, `xhigh`, `max`.
- **Défaut de Claude Opus 5.5 : `medium`** (les autres modèles : `high`). Le script fixe `high` explicitement, comme le demande 04 §9.

### Sortie structurée

- `output_config.format = {type: "json_schema", schema}`, sans en-tête bêta (l'ancien `output_format` est déprécié). La réponse est un bloc `text` qui contient le JSON.
- Pris en charge : types de base, `enum`, `const`, `anyOf`, `allOf`, `$ref`/`$defs`, `required`, `additionalProperties: false` (obligatoire sur tout objet), `minItems` 0 ou 1, formats `date-time`, `date`, `uri`… Refusé (erreur 400) : `minimum`/`maximum`, `minLength`/`maxLength`, contraintes de tableau au-delà de `minItems` 0 ou 1 (donc `maxItems`), schémas récursifs.
- Limites : 24 propriétés facultatives et 16 unions au plus par requête ; première requête plus lente (compilation du schéma, gardé 24 h).
- `stop_reason` `max_tokens` ou `refusal` : la sortie peut ne pas suivre le schéma.
- Une propriété qui demande au modèle son raisonnement peut déclencher un refus `reasoning_extraction` : `review_notes` demande des « doutes » en quelques phrases courtes, pas un raisonnement.

### Cache de prompt

- `cache_control: {type: "ephemeral"}` sur un bloc du message système ; durée de vie 5 minutes, prolongée gratuitement à chaque lecture ; option `ttl: "1h"`. 4 points de cache au plus par requête.
- Préfixe minimal pour Claude Opus 5.5 : **512 jetons** (plus court : pas de cache, sans erreur).
- `usage.cache_creation_input_tokens` (détail `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`) et `usage.cache_read_input_tokens` ; `input_tokens` ne compte que le reste.
- Ordre du préfixe : `tools`, `system`, `messages`. Changer l'effort invalide le cache des messages ; la page ne dit rien du schéma de sortie, qui reste le même pour tout le lot.

### Raisons d'arrêt (`stop_reason`)

`end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal` (avec `stop_details.category`), `model_context_window_exceeded`. Le client n'accepte que `end_turn` : `max_tokens` → erreur « sortie coupée » (le script conseille `--max-tokens`) ; `refusal` → erreur avec la catégorie ; toute autre raison → erreur.

### Prix (API Claude, routage global, dollars par million de jetons)

| Modèle | Entrée | Écriture cache 5 min | Écriture cache 1 h | Lecture cache | Sortie |
|---|---|---|---|---|---|
| Claude Opus 5.5 | 4 | 5 | 8 | 0,20 | 20 |
| Claude Sonnet 5.5 | 2 | 2,50 | 4 | 0,10 | 10 |
| Claude Fable 5.1 | 10 | 12,50 | 20 | 0,25 | 50 |

- Lecture en cache sur Opus 5.5 : 0,05 × l'entrée (au lieu de 0,1 × sur la plupart des modèles).
- Contexte de 1M au prix standard ; API Batch à −50 % (non utilisée, 04 §9) ; `inference_geo: "us"` × 1,1 (non utilisé) ; mode rapide 8 $ / 40 $ (non utilisé).
- Ces prix sont dans `MODEL_PRICES` (`apps/server/src/ai/client.ts`) ; un modèle absent de la table est refusé.

## Écarts avec 04 §9 et choix

- **Aucun écart sur le modèle** (`claude-opus-5-5`) ni sur l'effort (`high`).
- **Sortie structurée « par le JSON Schema dérivé de Zod »** : le schéma `exerciseJsonSchema()` porte des bornes que l'API refuse (`maxItems`, `minLength`, `maxLength`). `toStructuredSchema` les déplace dans `description` (le modèle les lit) et garde `enum`/`const` comme contraintes ; l'aide du SDK (`jsonSchemaOutputFormat`) déplacerait aussi les `enum`, et les codes de muscles et d'articulations ne seraient plus imposés. Les bornes sont ensuite vérifiées par Zod.
- **Validation « par le même schéma que la CI »** : la fiche rédigée doit passer `ExerciseSheetSchema` (fiche complète, `illustrations` compté vide pour ce contrôle : c'est un champ admin), puis `validateCatalog` sur tout le catalogue (alias uniques, chaînes…) sans erreur nouvelle. Sinon, second essai avec la liste des problèmes ; après 2 essais, le fichier reste intact.
- **2 essais** : seulement pour une sortie invalide (JSON illisible, bornes, règles du catalogue). `max_tokens`, `refusal` et les erreurs d'API ne sont pas réessayés (même cause, même coût) ; les nouveaux essais réseau (429, 5xx) sont ceux du SDK (2 par défaut). Une erreur 4xx autre que 408/409/429 (clé refusée, requête invalide) arrête le lot : les fiches pas encore lancées ne partent pas.
- **Pas de modèle de repli** (paramètre bêta `fallbacks`) : `drafting.model` doit nommer le modèle qui a écrit, et le coût suit la table. Un refus est signalé ; relancer la fiche ou l'écrire à la main.
- **Appels non diffusés** (`messages.create`), `max_tokens` 16 000 par défaut : au-delà d'environ 21 000, le SDK exige le streaming.
- **Partie fixe en cache** : prompt, guide de style, glossaire, taxonomie (codes et libellés), fiches étalons relues (`push-up`, `dumbbell-romanian-deadlift`, au statut `reviewed` ou `published`) ; un point de cache sur le dernier bloc. Partie variable : squelette en liste blanche (ni `revision`, ni `batch`, ni dates, ni `reviewed_by`) et noms des voisines de chaîne. Les 4 premiers appels parallèles écrivent chacun le cache (environ 0,05 $ en tout par lancement).
- **Aucune donnée personnelle** : le script n'envoie que des champs de fiche en liste blanche ; aucun id de compte.
- **Dépendance** : `@anthropic-ai/sdk` 0.135.0 dans `apps/server`, publiée le 2026-10-15 (`npm view @anthropic-ai/sdk time`). Les versions 0.136.0 et suivantes, dont 1.x, avaient moins de deux semaines le 2026-10-30. Dépendances transitives résolues avec un âge minimal de 14 jours (`@opentelemetry/api` 1.9.1 au lieu de 1.10.0, publiée le 2026-10-20).

## Coût estimé

Partie fixe actuelle : environ 18 000 caractères (environ 7 000 jetons), 24 000 avec les deux étalons (environ 10 000 jetons). Par fiche : lecture du cache (environ 0,002 $), squelette et schéma (environ 0,005 $), sortie de 3 000 à 7 000 jetons réflexion comprise (0,06 à 0,14 $). Soit **0,07 à 0,15 $ par fiche**, 8 à 20 $ pour un cœur de 110 à 130 fiches, nouveaux essais compris à la marge : cohérent avec les 10 à 20 $ de 04 §9. La part de la réflexion à l'effort `high` est l'inconnue : la mesurer au pilote (coût affiché par fiche) et corriger cette estimation.

## Historique du prompt

- `prompt-v1.md` (2026-10-30) : première version, avant le pilote. Toute modification du prompt crée `prompt-v<n+1>.md` et augmente `PROMPT_VERSION` dans `draft.ts` (04 §9, pilote).
