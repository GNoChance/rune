### Task 10: Client IA et rédaction des brouillons

**Files:**
- Create: `apps/server/src/ai/{client,fake,index}.ts`, `apps/server/test/ai/client.test.ts`, `scripts/exercises/{draft.ts,prompt-v1.md,NOTES.md}`, `scripts/exercises/draft.test.ts`
- Modify: `apps/server/package.json` (dépendance `@anthropic-ai/sdk`, version exacte), `package.json` (script `exercises:draft`), `.gitignore` (`.env.local` s'il n'y est pas)

**Interfaces:**
- Produces : `interface AiClient { complete<T>(req: {model: string; effort: 'low'|'medium'|'high'; system: CachedBlock[]; user: string; schema: object}): Promise<{value: T; stopReason: string; costUsd: number}> }` ; `createAnthropicClient({apiKey, model})` ; `createFakeAiClient(responses)` (déterministe) ; `pnpm exercises:draft [--ids a,b]` (04 §9 : seulement des `draft` aux champs IA vides ou les ids donnés, 4 appels en parallèle au plus, 2 essais, ne touche qu'aux champs IA, renseigne `drafting`, `revision` + 1, statut laissé à `draft`, écrit en forme canonique).

- [ ] **Step 1: Write the failing tests** — avec le faux client : refuse une fiche qui n'est pas `draft` ; ne modifie que les champs IA (les champs squelette sont octet pour octet identiques) ; rejette une sortie invalide après 2 essais et laisse le fichier intact ; lit `stop_reason` (`max_tokens` → erreur claire) ; aucun appel réseau en CI (le test échoue si `fetch` est appelé).
- [ ] **Step 2: Run** `pnpm vitest run --project scripts exercises` — FAIL.
- [ ] **Step 3: Implement** ; avant d'écrire le client, vérifier sur la documentation officielle d'Anthropic le modèle par défaut (`claude-opus-5-5` dans 04 §9), l'effort, la sortie structurée, le cache et les prix ; noter les valeurs et la date dans `scripts/exercises/NOTES.md`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(scripts): client IA et rédaction des brouillons de fiches`.
