### Task 18: Fiches étalons, squelettes du lot A et pilote

**Files:**
- Create: `data/exercises/*.json` (2 étalons + squelettes du lot A provisoire), `docs/catalog/lot-a-provisoire.md`
- Modify: `docs/catalog/style-guide.md` (si les étalons le précisent), `scripts/exercises/NOTES.md`

**Interfaces:**
- Consumes: Tasks 4, 6, 10, 11.

- [ ] **Step 1: Write** deux fiches étalons à la main (une sans matériel en chaîne, `push-up` ; une sensible de salle, `dumbbell-romanian-deadlift`), statut `draft`, `batch` `A`, validées par `pnpm data:validate`.
- [ ] **Step 2: Write** `docs/catalog/lot-a-provisoire.md` : la liste provisoire du lot A tirée du tableau de 04 §7 (id, nom, pattern, chaîne, sensible oui/non), puis un squelette `draft` par ligne. **Arrêt : le propriétaire valide cette liste avant toute rédaction.**
- [ ] **Step 3: Run** `pnpm data:validate` — PASS ; un démarrage local (`pnpm dev`) charge les brouillons, visibles dans la relecture et absents de `GET /api/catalog`.
- [ ] **Step 4: Pilote** — le propriétaire pose la clé API dans `.env.local` ; `pnpm exercises:draft --ids <5 ids variés : une sensible, une sans matériel, une machine, une à chaîne>` ; les relecteurs relisent dans l'appli ; on ajuste `prompt-v2.md` et le glossaire, `prompt_version` + 1 ; coût réel noté dans `NOTES.md`.
- [ ] **Step 5: Commit** `feat(data): fiches étalons, squelettes du lot A et pilote de rédaction`.
