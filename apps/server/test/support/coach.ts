import type { AiChatRequest } from '../../src/ai/chat';
import { createFakeAiClient, type FakeAiClient, type FakeChatTurn } from '../../src/ai/fake';
import { refreshCoachConfig } from '../../src/coach/state';
import type { TestContext } from './context';

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
