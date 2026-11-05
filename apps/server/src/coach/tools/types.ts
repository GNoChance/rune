import type { AgeBand, CoachToolName, HelpResourceId, InstanceChangeOperation } from '@rune/contracts';
import type { AllowedValues } from '@rune/domain';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/schema';
import type { AppDeps } from '../../deps';

/*
 * Outils du coach (spec brique 4 §10, `tools-1`) : ce qu'un gestionnaire reçoit et rend. Les résultats sont des
 * données que le modèle lit ; rien de leur contenu n'entre dans les journaux (P-LOG-2).
 */

/**
 * Proposition validée par `propose_program_change` dans la tentative ; elle n'est écrite qu'à l'enregistrement de
 * l'échange (§12.1). `instanceId` : l'instance validée, que l'écriture relit (elle peut avoir changé entre-temps) ;
 * `operations` : références de slot déjà retraduites en identifiants réels. `model` : modèle de l'itération qui a
 * fait l'appel, posé par la tentative.
 */
export interface PendingProposal {
  id: string;
  instanceId: string;
  baseRevision: number;
  operations: InstanceChangeOperation[];
  reason: string;
  model: string | null;
}

/** État des outils d'une tentative, neuf à chaque tentative. */
export interface AttemptToolState {
  proposals: PendingProposal[];
  /**
   * Appels de `propose_program_change` refusés, au schéma (`runTool`) ou par le validateur (tâche 18) : un seul
   * compteur, celui de `corrections_exhausted` (P10).
   */
  invalidProposals: number;
  helpCards: HelpResourceId[];
}

export interface ToolContext {
  db: DbExecutor;
  deps: AppDeps;
  userId: string;
  thread: { id: string; audience: AgeBand; promptVersion: string };
  /** Instant de l'appel : accords et âge sont relus en base à cet instant. */
  now: Date;
  state: AttemptToolState;
  /**
   * Valeurs autorisées, construites comme pour le filtre (dossier, résultats d'outils du fil du jour et de la
   * tentative) ; la tentative les tient à jour (tâche 20, P11).
   */
  allowed: AllowedValues;
}

/** Résultat rendu au modèle dans un `tool_result` (`is_error` si `isError`). */
export interface ToolOutcome {
  result: unknown;
  isError: boolean;
}

export interface CoachTool {
  name: CoachToolName;
  /** En français ; dit les limites que le mode strict ne porte pas. */
  description: string;
  /** Schéma Zod complet de l'entrée : `runTool` revalide avec lui (le mode strict de l'API ne porte pas les bornes). */
  input: z.ZodType;
  /** Gestionnaire ; reçoit l'entrée déjà validée par `input`. */
  run(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Outil dont le gestionnaire reçoit l'entrée au type de son schéma, que `runTool` a déjà validée. */
export function defineTool<S extends z.ZodType>(tool: {
  name: CoachToolName;
  description: string;
  input: S;
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutcome>;
}): CoachTool {
  return {
    name: tool.name,
    description: tool.description,
    input: tool.input,
    run: (input, ctx) => tool.run(input as z.output<S>, ctx),
  };
}
