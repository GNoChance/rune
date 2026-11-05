import type { AiChatRequest } from '../../src/ai/chat';
import { createFakeAiClient, type FakeAiClient, type FakeChatTurn } from '../../src/ai/fake';
import { refreshCoachConfig } from '../../src/coach/state';
import type { ToolContext } from '../../src/coach/tools/types';
import type { TestContext } from './context';
import { dayAt, type SessionSpec, type SetSpec } from './program';

/** Trois séries de travail faites à `loadG`, effort « correct » sur la dernière : la calibration finit à cette charge. */
export const setsAt = (loadG: number): SetSpec[] => [{ loadG }, { loadG }, { loadG, effort: 'ok' }];

/**
 * Séances de l'instance pour la garde de hausse (spec brique 4 §12.2, étape 6) : A1 fait une fois à la presse à
 * cuisses à 60 kg (« Changer d'exercice »), puis au goblet squat, son exercice, à 40 kg. Remplacer A1 par la presse
 * ferait passer sa charge prévue de 40 à 60 kg.
 */
export const pressThenGoblet = (instanceId: string): SessionSpec[] => [
  { instanceId, startedAt: dayAt(60), exercises: [{ exerciseId: 'leg-press', sets: setsAt(60_000) }] },
  { instanceId, startedAt: dayAt(62), exercises: [{ sets: setsAt(40_000) }] },
];

/**
 * Contexte d'appel d'un outil du coach pour `userId` : état de tentative neuf, aucune valeur autorisée, instant de
 * l'horloge ; fil `thread` (par défaut un fil adulte sans ligne en base, donc sans table d'alias figée).
 */
export function toolContext(
  ctx: TestContext,
  userId: string,
  o: { thread?: Partial<ToolContext['thread']>; now?: Date } = {},
): ToolContext {
  return {
    db: ctx.deps.db,
    deps: ctx.deps,
    userId,
    thread: { id: 'thread-absent', audience: 'adult', promptVersion: 'coach-1/adult', ...o.thread },
    now: o.now ?? ctx.clock.now(),
    state: { proposals: [], invalidProposals: 0, helpCards: [] },
    allowed: { mass: new Set(), percent: new Set(), nutrition: new Set() },
  };
}

/**
 * Met le coach en service dans un contexte de test : faux client IA, combinaison courante déclarée évaluée pour
 * le catalogue publié, coach activé. Seul un point d'entrée de test injecte le faux client (jamais `server.mjs`).
 */
export async function enableCoach(
  ctx: TestContext,
  chat: readonly FakeChatTurn[] | ((req: AiChatRequest, call: number) => FakeChatTurn),
): Promise<FakeAiClient> {
  const { deps } = ctx;
  const ai = createFakeAiClient([], { model: deps.config.coachModel, chat });
  const meta = await deps.db.selectFrom('serverMeta').select('catalogVersion').executeTakeFirst();
  const config = deps.coachConfig;
  deps.ai = ai;
  deps.coachThinkingBinding = 'error';
  deps.coachConfig = {
    ...config,
    evaluated: [
      ...config.evaluated,
      {
        model: deps.config.coachModel,
        effort: config.effort,
        promptVersion: config.promptVersion,
        toolsVersion: config.toolsVersion,
        briefSchema: config.briefSchema,
        catalogVersion: meta?.catalogVersion ?? '',
        report: 'test',
      },
    ],
  };
  await deps.db
    .updateTable('coachState')
    .set({ enabled: 1, updatedAt: deps.clock.now().toISOString() })
    .where('id', '=', 1)
    .execute();
  await refreshCoachConfig(deps);
  return ai;
}
