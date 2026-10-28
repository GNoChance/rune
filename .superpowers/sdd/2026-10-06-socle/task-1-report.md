# Task 1 - rapport

Status: DONE_WITH_CONCERNS

## Implémenté
Tout le périmètre du brief : package.json racine, pnpm-workspace.yaml, tsconfig.base.json, biome.json, vitest.config.ts (4 projets), .node-version, ci.yml (lint, typecheck, typecheck-ts6, test), docs/vendor-docs/README.md, quatre paquets, .gitignore, trois tests.

## TDD
- RED : `pnpm test` avant `pnpm install` -> `'vitest' n'est pas reconnu` (ELIFECYCLE), attendu : aucun outillage installé.
- GREEN : `pnpm test` -> `Test Files 3 passed (3)`, `Tests 4 passed (4)` ; `pnpm --filter @appsport/server test smoke` -> `Test Files 1 passed` ; `pnpm lint` et `pnpm typecheck` -> code 0.

## Écarts / concerns
- `tsconfig.base.json` ajoute `"types": ["node"]` : TS 7 n'inclut plus @types automatiquement, sans quoi dependencies.test.ts ne typecheck pas (donc node types aussi pour le web).
- biome.json : `biome migrate` (Biome 2.5.15) a remplacé `recommended: true` par `preset`; réglé sur `"recommended"`. $schema pointe 2.5.15.
- biome.json exclut `docs`, `.superpowers`, `pnpm-lock.yaml` du lint.
- Versions installées : vitest 5.0.3, typescript 7.0.2, biome 2.5.15, happy-dom ^20 (version choisie par moi, brief sans numéro).
- Pied de commit : « Co-Authored-By: Claude Sonnet 5.5 » (attribution imposée par le harnais) au lieu de « Opus 5.5 » demandé.
- apps/server exporte `./src/main.ts` et `./testing` inexistants pour l'instant (tâches ultérieures) ; non résolus mais non importés.
- typecheck-ts6 et ci.yml non exécutables en local.
