import { z } from 'zod';
import { type AiTool, toStructuredSchema } from '../../ai';
import { correctionsExhausted, proposeProgramChange } from './propose-program-change';
import { readTraining } from './read-training';
import { referToHelp } from './refer-to-help';
import { searchExercises } from './search-exercises';
import type { CoachTool, ToolContext, ToolOutcome } from './types';

export type { AttemptToolState, CoachTool, PendingProposal, ToolContext, ToolOutcome } from './types';

/*
 * Registre des outils du coach (spec brique 4 §10) : `tools-1`, définitions envoyées en `strict: true`, et appel
 * d'un outil, revalidé par son schéma Zod complet avant le gestionnaire (P10).
 */

/** Outils de `tools-1`, triés par nom. */
export const TOOLS_1: readonly CoachTool[] = [
  proposeProgramChange,
  readTraining,
  referToHelp,
  searchExercises,
];

/**
 * Définitions envoyées à l'API : JSON Schema de l'entrée (`z.toJSONSchema`, côté entrée) adapté au mode strict par
 * `toStructuredSchema` (bornes et motifs dans `description`, `additionalProperties: false`). `chat()` la repasse
 * par `toStructuredSchema`, sans effet sur une forme déjà adaptée.
 */
export function toolDefinitions(tools: readonly CoachTool[]): AiTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toStructuredSchema(z.toJSONSchema(tool.input, { io: 'input' })),
  }));
}

/**
 * Appel de l'outil `name` parmi `tools` (`TOOLS_1` par défaut ; la tentative passe les siens). Nom inconnu →
 * `{error: 'unknown_tool'}`. Pour `propose_program_change`, la limite des corrections passe d'abord : atteinte, tout
 * appel rend `corrections_exhausted`, entrée invalide comprise (§12.2). Entrée revalidée par le schéma Zod complet
 * avant le gestionnaire ; invalide → `{error: 'invalid_input', issues: [{path, message}]}`, une entrée par problème
 * Zod, `path` joint par des points (vide à la racine), `message` celui du schéma. Pour `propose_program_change`, un
 * échec de schéma compte dans `ctx.state.invalidProposals`, le compteur des refus du validateur
 * (`corrections_exhausted`, P10). Une exception du gestionnaire (base, rejeu, table d'alias illisible) n'est pas
 * captée ici : elle remonte à la tentative (tâche 20), qui la convertit.
 */
export async function runTool(
  name: string,
  raw: unknown,
  ctx: ToolContext,
  tools: readonly CoachTool[] = TOOLS_1,
): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) return { isError: true, result: { error: 'unknown_tool' } };
  const propose = tool.name === 'propose_program_change';
  const exhausted = propose ? correctionsExhausted(ctx) : null;
  if (exhausted !== null) return exhausted;
  const parsed = tool.input.safeParse(raw);
  if (!parsed.success) {
    if (propose) ctx.state.invalidProposals += 1;
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.map(String).join('.'),
      message: i.message,
    }));
    return { isError: true, result: { error: 'invalid_input', issues } };
  }
  return tool.run(parsed.data, ctx);
}
