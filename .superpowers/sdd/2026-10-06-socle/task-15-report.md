# Task 15 — rapport d'implémentation

Status: DONE — commit 8a5face « feat(profil): recommendTemplate et reprise de l'onboarding » (Closes #16), branche socle, non poussé.

## Implémenté
- `packages/contracts/src/api/profile.ts` : GOALS/Goal, EXPERIENCES/Experience (z.enum + type inféré), GOAL_LABELS, EXPERIENCE_LABELS (libellés verbatim) ; exporté par `contracts/src/index.ts`.
- `packages/domain/src/recommend-template.ts` : types de §4, `levelFromExperience` (R-REC-2), `recommendTemplate` dans l'ordre R-REC-1 (sport si sport_support et `sportCode?.trim()`), R-REC-2, R-REC-3 (min du premier descripteur intermédiaire du contexte, même indisponible), R-REC-4 (autre niveau, sinon null + niveau de l'expérience + jours demandés + NO_TEMPLATE_AVAILABLE), R-REC-5 (bornage, DAYS_ADJUSTED si changement), level = celui du modèle retenu ; pas d'âge ni de prudence (R-REC-6). Sélection : premier descripteur disponible du (contexte, niveau) dans l'ordre du tableau.
- `packages/domain/src/onboarding.ts` : `availableGoals` (mineur sans fat_loss), `firstIncompleteStep` (règles du brief, `validated(s)` par index dans ONBOARDING_STEPS). Types Goal/Experience/OnboardingStep/ONBOARDING_STEPS importés de @appsport/contracts uniquement.
- `packages/domain/test/fixtures/templates.ts` : FAKE_TEMPLATES (6 modèles), `withUnavailable` (copie profonde, n'altère pas l'original).

## Tests
- recommend-template.test.ts : 240 cas contre un oracle écrit à la main (table contexte × niveau × jours), R-REC-2, R-REC-1 (null, '', '   '), 4 cas ciblés du brief, non-mutation de la fixture, 3 propriétés fast-check (bornes/disponibilité/DAYS_ADJUSTED ⇔ jours changés ou null + NO_TEMPLATE_AVAILABLE ; contexte sport ⇔ sport_support et sportCode non vide ; déterminisme), avec sous-ensembles aléatoires de modèles indisponibles.
- onboarding.test.ts : ordre ONBOARDING_STEPS, 13 cas firstIncompleteStep (entrées complètes), availableGoals minor/adult.

## TDD
RED : `pnpm --filter @appsport/domain test recommend-template onboarding` (avant toute implémentation, contracts/profile.ts inclus) :
```
 FAIL  |domain| test/onboarding.test.ts
Error: Cannot find module '../src/onboarding' imported from .../packages/domain/test/onboarding.test.ts
 FAIL  |domain| test/recommend-template.test.ts
Error: Cannot find module '../src/recommend-template' imported from .../packages/domain/test/recommend-template.test.ts
 Test Files  2 failed (2)
      Tests  no tests
```
Attendu : les modules n'existaient pas (Vitest 5 formule « Cannot find module » au lieu de « Failed to resolve import »).

GREEN : même commande :
```
 Test Files  2 passed (2)
      Tests  268 passed (268)
```
Puis `pnpm lint` (156 fichiers, aucune erreur après formatage biome des deux tests), `pnpm typecheck` (4 paquets OK), `pnpm test` : 59 fichiers, 658 passés, 2 ignorés (préexistants), sortie sans avertissement. Test de pureté du domaine vert (nouveaux fichiers sans Date.now/Math.random/birth date).

## Fichiers
packages/contracts/src/api/profile.ts (nouveau), packages/contracts/src/index.ts, packages/domain/src/index.ts, packages/domain/src/onboarding.ts (nouveau), packages/domain/src/recommend-template.ts (nouveau), packages/domain/test/fixtures/templates.ts (nouveau), packages/domain/test/onboarding.test.ts (nouveau), packages/domain/test/recommend-template.test.ts (nouveau). Vérifié par `git show --stat HEAD` (8 fichiers, 492 insertions), `git status` propre.

## Auto-revue / points d'attention
- Les types Goal et Experience sont aussi exportés comme types (`z.infer`), nécessaires pour `Record<Goal, string>` de §4.
- Si un contexte n'a aucun descripteur intermédiaire, R-REC-3 ne s'applique pas (pas de min de référence) — non spécifié, choix minimal.
- Aucune préoccupation bloquante.
