import {
  AI_COACH_CONSENT_TEXT,
  type CoachStreamEvent,
  CoachStreamEventSchema,
  CURRENT_CONSENT_TEXTS,
  type GuidedRequest,
} from '@rune/contracts';
import { COACH_CONFIG, type CoachConfig } from '@rune/domain';
import type { AiChatRequest } from '../../src/ai/chat';
import { createFakeAiClient, type FakeAiClient, type FakeChatTurn } from '../../src/ai/fake';
import { type PreparedExchange, prepareExchange, runExchange } from '../../src/coach/orchestrator';
import { refreshCoachConfig } from '../../src/coach/state';
import type { ToolContext } from '../../src/coach/tools/types';
import { createLogger } from '../../src/logger';
import { grantConsent } from '../../src/privacy/consent';
import { createTestContext, type TestContext } from './context';
import {
  dayAt,
  enroll,
  programTemplate,
  type SessionSpec,
  type SetSpec,
  seedProgramCatalog,
} from './program';
import { createUser, type TestUser } from './users';

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
    allowed: { mass: new Set(), percent: new Set(), nutrition: new Set(), volume: new Set() },
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

/** Tout ce qu'un échange de test a rendu : événements du flux (relus par leur schéma) et échange préparé. */
export interface Asked {
  events: CoachStreamEvent[];
  x: PreparedExchange;
}

export interface ExchangeKit {
  ctx: TestContext;
  user: TestUser;
  fake: FakeAiClient;
  /** Lignes du journal technique. */
  lines: string[];
  /** Identifiant de l'instance du programme, avec `program: true`. */
  instanceId: string | undefined;
  /** Prépare puis joue un échange jusqu'à son événement final. */
  ask(text?: string, o?: { clientMessageId?: string; guided?: GuidedRequest }): Promise<Asked>;
  /** Comme `ask`, sans attendre la fin : l'échange est prêt (bail pris) quand la promesse rend. */
  begin(
    text?: string,
    guided?: GuidedRequest,
  ): Promise<{ events: CoachStreamEvent[]; finished: Promise<void>; x: PreparedExchange }>;
  rows(sql: string, ...params: (string | number)[]): Record<string, unknown>[];
}

/**
 * Banc d'un échange du coach : contexte, membre avec les accords `ai_coach` (et `health` sauf `health: false`), faux
 * client scripté, coach en service. `birthDate` : 2010 pour un mineur. `program` : catalogue et inscription (outil
 * `propose_program_change`). `coachConfig` : réglages à remplacer (budget, par exemple).
 */
export async function exchangeKit(o: {
  chat: readonly FakeChatTurn[] | ((req: AiChatRequest, call: number) => FakeChatTurn);
  now?: string;
  birthDate?: string;
  health?: boolean;
  program?: boolean;
  coachConfig?: (config: CoachConfig) => CoachConfig;
}): Promise<ExchangeKit> {
  const lines: string[] = [];
  const ctx = await createTestContext({
    now: o.now ?? '2026-11-05T10:00:00.000Z',
    deps: {
      logger: createLogger((l) => lines.push(l)),
      ...(o.coachConfig === undefined ? {} : { coachConfig: o.coachConfig(COACH_CONFIG) }),
    },
  });
  const user = await createUser(ctx, o.birthDate === undefined ? {} : { birthDate: o.birthDate });
  await grantConsent(ctx.deps.db, ctx.deps, user.id, 'ai_coach', AI_COACH_CONSENT_TEXT.version, null);
  if (o.health !== false) {
    await grantConsent(ctx.deps.db, ctx.deps, user.id, 'health', CURRENT_CONSENT_TEXTS.health.version, null);
  }
  let instanceId: string | undefined;
  if (o.program === true) {
    const template = programTemplate();
    await seedProgramCatalog(ctx, [template]);
    instanceId = await enroll(ctx, user.id, template);
  }
  const fake = await enableCoach(ctx, o.chat);
  const begin = async (text = 'Comment était ma séance ?', guided?: GuidedRequest) => {
    const events: CoachStreamEvent[] = [];
    const x = await prepareExchange(
      ctx.deps,
      user.id,
      { clientMessageId: ctx.deps.ids.uuidv7(), text, ...(guided === undefined ? {} : { guided }) },
      ctx.clock.now(),
    );
    const finished = runExchange(ctx.deps, x, (e) => events.push(CoachStreamEventSchema.parse(e)));
    return { events, finished, x };
  };
  return {
    ctx,
    user,
    fake,
    lines,
    instanceId,
    begin,
    async ask(text = 'Comment était ma séance ?', ask = {}) {
      const events: CoachStreamEvent[] = [];
      const x = await prepareExchange(
        ctx.deps,
        user.id,
        {
          clientMessageId: ask.clientMessageId ?? ctx.deps.ids.uuidv7(),
          text,
          ...(ask.guided === undefined ? {} : { guided: ask.guided }),
        },
        ctx.clock.now(),
      );
      await runExchange(ctx.deps, x, (e) => events.push(CoachStreamEventSchema.parse(e)));
      return { events, x };
    },
    rows: (sql, ...params) => ctx.deps.sqlite.prepare(sql).all(...params) as Record<string, unknown>[],
  };
}
