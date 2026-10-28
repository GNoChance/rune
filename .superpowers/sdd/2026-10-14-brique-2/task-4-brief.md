### Task 4: Validateur du catalogue, style et glossaire

**Files:**
- Create: `packages/domain/src/catalog/validate.ts`, `packages/domain/test/catalog/validate.test.ts`, `scripts/data/validate.ts`, `scripts/tsconfig.json`, `docs/catalog/style-guide.md`, `data/glossary.json`
- Modify: `package.json` (scripts `data:validate`), `vitest.config.ts` (projet `scripts`, environnement node), `.github/workflows/ci.yml` (étape `pnpm data:validate`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces : `validateCatalog(input: {sheets: {file: string; json: unknown}[]; manifest: IllustrationEntry[]; templates: unknown[]}): {ok: boolean; errors: {file: string; code: string; message: string}[]}` ; CLI `pnpm data:validate` (lit `data/`, sortie non nulle et une ligne par erreur si invalide).

- [ ] **Step 1: Write the failing tests** — un cas par refus de 04 §13 critère 1 (code hors taxonomie, `id` ≠ nom de fichier, alias en double après `normalize`, option de matériel en double ou incluse, modes de charge mélangés, pointeurs non réciproques, chaîne cyclique, ramifiée ou discontinue, membres sans muscle commun ou de groupes différents, niveau qui baisse, `reviewed`/`published` incomplète, illustration absente du manifeste ou d'empreinte différente, code de matériel inutilisé), plus : 301 fiches non retirées refusées et 300 acceptées ; une nouvelle fiche au statut autre que `draft` n'est pas refusée ici (c'est le chargeur qui décide, tâche 6) ; fichier non canonique refusé (`not_canonical`).
- [ ] **Step 2: Run** `pnpm vitest run --project domain catalog/validate` — FAIL.
- [ ] **Step 3: Implement** `validateCatalog` et le script ; écrire le guide de style (04 §8 étape 0, plus « une entrée de sécurité = 120 caractères au plus, dit quand s'arrêter, aucun vocabulaire médical ») et le glossaire (terme préféré, variantes refusées, équivalent anglais ; au moins : développé couché, charnière de hanche, dos neutre, RIR).
- [ ] **Step 4: Run** `pnpm data:validate` sur `data/` vide — sortie 0 ; R-EQ-5 (code inutilisé) n'est exigé qu'à partir de la première fiche publiée (`--strict` en CI une fois le lot A publié ; noter la règle dans le script).
- [ ] **Step 5: Commit** `feat(data): validateur du catalogue, guide de style et glossaire`.
