/**
 * `pnpm coach:eval [--ids a,b] [--runs 3] [--model <id>] [--effort low|medium|high] [--catalog fixtures|repo]
 * [--fake]` : évaluation du coach (spec brique 4 §19.1, protocole dans NOTES.md).
 *
 * - L'appli réelle en processus : `createApp`, SQLite en mémoire, membre fictif (`eval/coach/fixtures/members`) et
 *   catalogue chargés par les services du serveur, `deps.coachThinkingBinding = 'error'`. Chaque passage d'un cas a
 *   sa base neuve. Les messages passent par `POST /api/coach/messages` (flux SSE relu ici).
 * - Vrai `AiClient` (clé `ANTHROPIC_API_KEY` de `.env.local`, workspace de développement) sauf avec `--fake`, où le
 *   faux client rejoue le script du cas (cas « fake ») ou une réponse type. Avec `--fake`, `.env.local` n'est jamais
 *   lu. La clé n'est jamais affichée ni écrite (ni rapport, ni journal).
 * - Refuse de tourner quand `CI` est défini. Avant tout appel réel : coût estimé et confirmation `o/N`.
 *
 * Sortie 0 si la campagne a tourné ; 1 si elle est refusée ou impossible ; 2 pour une option inconnue ou CI.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import {
  AI_COACH_CONSENT_TEXT,
  type CoachStreamEvent,
  CoachStreamEventSchema,
  CURRENT_CONSENT_TEXTS,
  PRIVACY_POLICY_VERSION,
} from '@rune/contracts';
import { COACH_CONFIG, estimateTokens } from '@rune/domain';
import type { FakeChatTurn } from '../../apps/server/src/ai/fake';
import {
  type AiChatFinal,
  type AiChatRequest,
  type AiClient,
  type AiEffort,
  buildChatParams,
  createAnthropicClient,
  createFakeAiClient,
  fakeFallbackText,
  fakeRefusal,
  fakeText,
  fakeToolUse,
  MODEL_PRICES,
} from '../../apps/server/src/ai/index';
import { createApp } from '../../apps/server/src/app';
import { createSession } from '../../apps/server/src/auth/session';
import { currentCatalog } from '../../apps/server/src/catalog/bundle';
import { CATALOG_STARTUP_TASK, loadCatalogFiles } from '../../apps/server/src/catalog/loader';
import { refreshCoachConfig } from '../../apps/server/src/coach/state';
import { loadConfig } from '../../apps/server/src/config';
import { migrate } from '../../apps/server/src/db/migrate';
import { MIGRATIONS } from '../../apps/server/src/db/migrations/index';
import { openDatabase } from '../../apps/server/src/db/open';
import { initServerMeta } from '../../apps/server/src/db/server-meta';
import { type AppDeps, createAppDeps, cryptoIds } from '../../apps/server/src/deps';
import { createLogger } from '../../apps/server/src/logger';
import { grantConsent } from '../../apps/server/src/privacy/consent';
import { insertInstance } from '../../apps/server/src/program/enroll';
import { insertFixtureRow } from '../../apps/server/test/support/factories';
import { DEFAULT_DATA_DIR } from '../data/validate';
import {
  CATALOG_FIXTURE_DIR,
  EVAL_NOW,
  type EvalCase,
  type FakeTurnSpec,
  loadCases,
  loadMembers,
  type MemberFixture,
  REPORTS_DIR,
} from './cases';
import {
  type CallTrace,
  type CaseRun,
  type CheckResult,
  proposalStats,
  runChecks,
  type ToolCallTrace,
} from './checks';
import { buildReport, type CaseRecord, type RunRecord, writeReport } from './report';

const USAGE =
  'Usage : pnpm coach:eval [--ids a,b] [--runs 3] [--model <id>] [--effort low|medium|high] ' +
  '[--catalog fixtures|repo] [--fake]';
const API_KEY_VAR = 'ANTHROPIC_API_KEY';
/** Fichier de la clé, à la racine du dépôt, ignoré par git. */
export const ENV_FILE = fileURLToPath(new URL('../../.env.local', import.meta.url));
const APP_ORIGIN = 'https://rune.eval.test';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const EFFORTS: readonly AiEffort[] = ['low', 'medium', 'high'];

// ---------------------------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------------------------

export interface Options {
  ids: string[] | undefined;
  runs: number;
  model: string;
  effort: AiEffort;
  catalog: 'fixtures' | 'repo';
  fake: boolean;
}

/** Options lues, ou le message d'erreur à afficher. */
function parseArgs(argv: readonly string[]): Options | string {
  const o: Options = {
    ids: undefined,
    runs: 3,
    model: COACH_CONFIG.defaultModel,
    effort: COACH_CONFIG.effort,
    catalog: 'fixtures',
    fake: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fake') {
      o.fake = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) return USAGE;
    i += 1;
    if (arg === '--ids')
      o.ids = value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
    else if (arg === '--runs' && /^[1-9][0-9]?$/.test(value)) o.runs = Number(value);
    else if (arg === '--model') o.model = value;
    else if (arg === '--effort' && (EFFORTS as readonly string[]).includes(value))
      o.effort = value as AiEffort;
    else if (arg === '--catalog' && (value === 'fixtures' || value === 'repo')) o.catalog = value;
    else return USAGE;
  }
  if (!(COACH_CONFIG.allowedModels as readonly string[]).includes(o.model)) {
    return `Modèle non admis : ${o.model} (admis : ${COACH_CONFIG.allowedModels.join(', ')}).`;
  }
  return o;
}

// ---------------------------------------------------------------------------------------------------------------
// Faux client
// ---------------------------------------------------------------------------------------------------------------

function toTurn(spec: FakeTurnSpec, id: string): FakeChatTurn {
  switch (spec.kind) {
    case 'text':
      return fakeText(spec.text);
    case 'tool':
      return fakeToolUse(id, spec.name, spec.input);
    case 'refusal':
      return fakeRefusal(spec.category);
    case 'fallback':
      return fakeFallbackText(spec.text, spec.from, spec.to);
  }
}

/**
 * Réponse type du faux pour un cas sans script : les outils attendus avec des entrées minimales (jamais de
 * proposition : il ne connaît pas le programme), la carte d'aide attendue, puis un texte français sans chiffre.
 */
export function defaultScript(c: EvalCase): FakeTurnSpec[] {
  const script: FakeTurnSpec[] = [];
  const tools = new Set(c.expect.tools ?? []);
  tools.delete('propose_program_change');
  if (c.expect.help !== undefined) tools.add('refer_to_help');
  for (const name of [...tools].sort()) {
    if (name === 'refer_to_help' && c.expect.help !== undefined) {
      script.push({ kind: 'tool', name, input: { resource: c.expect.help } });
    } else if (name === 'read_training') script.push({ kind: 'tool', name, input: { since_days: 7 } });
    else if (name === 'search_exercises') script.push({ kind: 'tool', name, input: {} });
  }
  const marks = [...(c.expect.mustContain ?? []), ...(c.expect.mustContainAny?.slice(0, 1) ?? [])];
  const keep = marks.length > 0 ? ` À retenir : ${marks.join(', ')}.` : '';
  const text = `Je suis là pour t'aider avec ton entraînement.${keep} Si tu as un doute, parles-en à un professionnel de santé.`;
  for (const _turn of c.turns) script.push({ kind: 'text', text });
  return script;
}

/** Les tours d'outils du premier message précèdent son texte ; les autres messages n'ont que leur texte. */
function scriptFor(c: EvalCase): { turns: FakeChatTurn[]; mode: CaseRun['mode'] } {
  const specs = c.fakeScript ?? defaultScript(c);
  return {
    turns: specs.map((spec, i) => toTurn(spec, `toolu_eval_${i + 1}`)),
    mode: c.fakeScript === undefined ? 'fake-default' : 'fake-script',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Enregistreur : requêtes sérialisées, finals, latences
// ---------------------------------------------------------------------------------------------------------------

interface Recorder {
  calls: CallTrace[];
  requests: AiChatRequest[];
  finals: AiChatFinal[];
  /** Texte streamé de chaque appel, final ou non. */
  texts: string[];
}

/** Enveloppe `inner` : garde la forme sérialisée de chaque requête (celle que le vrai client enverrait) et le final. */
function recording(inner: AiClient, rec: Recorder): AiClient {
  return {
    model: inner.model,
    complete: (req) => inner.complete(req),
    async chat(req, onEvent) {
      let requestJson = '';
      try {
        requestJson = JSON.stringify(buildChatParams(req));
      } catch {
        // Requête invalide : le client la refuse lui-même, sans l'envoyer.
      }
      const started = performance.now();
      let open = false;
      let streamed = '';
      let final: AiChatFinal;
      try {
        final = await inner.chat(req, (e) => {
          if (e.type === 'block_start') open = e.block === 'text';
          else if (e.type === 'block_stop') open = false;
          else if (open) streamed += e.text;
          onEvent(e);
        });
      } catch (error) {
        if (streamed.trim() !== '') rec.texts.push(streamed);
        throw error;
      }
      if (streamed.trim() !== '') rec.texts.push(streamed);
      rec.requests.push(req);
      rec.finals.push(final);
      rec.calls.push({
        requestJson,
        model: final.model,
        stopReason: final.stopReason,
        costUsd: final.costUsd,
        latencyMs: Math.round(performance.now() - started),
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        fallbackUsed: final.fallbackUsed,
      });
      return final;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Monde d'un passage : base neuve, catalogue, membre, appli
// ---------------------------------------------------------------------------------------------------------------

interface World {
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
  userId: string;
  cookie: string;
  close(): void;
}

/** Le chargeur n'a pas pu reconstruire le catalogue : rien à évaluer. */
function failNoCatalog(): never {
  throw new Error('Catalogue non chargé : catalog_version absente.');
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Membre fictif en base : compte, accords, profil, lieux, limitations, programme suivi, séances. */
async function loadMember(deps: AppDeps, m: MemberFixture, health: boolean): Promise<string> {
  const { db } = deps;
  const now = deps.clock.now().getTime();
  const user = await insertFixtureRow(db, 'user', {
    username: m.user.username,
    usernameKey: m.user.username.normalize('NFKC').toLowerCase(),
    birthDate: m.user.birthDate,
    termsVersion: PRIVACY_POLICY_VERSION,
    termsAcceptedAt: iso(now),
    onboardingStep: 'ready',
    onboardingCompletedAt: iso(now),
  });
  const userId = user.id as string;
  await grantConsent(db, deps, userId, 'ai_coach', AI_COACH_CONSENT_TEXT.version, null);
  if (health) await grantConsent(db, deps, userId, 'health', CURRENT_CONSENT_TEXTS.health.version, null);

  await insertFixtureRow(db, 'training_profile', {
    ownerId: userId,
    goal: m.profile.goal,
    experience: m.profile.experience,
    daysPerWeek: m.profile.daysPerWeek,
    sessionMinutes: m.profile.sessionMinutes,
    sportCode: m.profile.sportCode ?? null,
    cautiousMode: m.profile.cautiousMode === true ? 1 : 0,
    coach: m.profile.coach,
  });
  if (m.screening !== undefined) {
    await insertFixtureRow(db, 'health_screening', { ownerId: userId, caution: m.screening.caution ? 1 : 0 });
  }

  const placeIds = new Map<string, string>();
  for (const p of m.places) {
    let gymId: string | null = null;
    if (p.gym !== undefined) {
      const gym = await insertFixtureRow(db, 'gym', {
        name: p.gym.name,
        nameKey: p.gym.name.toLowerCase(),
        city: p.gym.city,
        cityKey: p.gym.city.toLowerCase(),
      });
      gymId = gym.id as string;
      for (const code of p.equipment) {
        await insertFixtureRow(db, 'gym_equipment', { id: `${gymId}:${code}`, gymId, equipmentCode: code });
      }
    }
    const place = await insertFixtureRow(db, 'place', {
      ownerId: userId,
      kind: p.kind,
      gymId,
      name: p.kind === 'home' ? 'Maison' : null,
      loadSettings: p.kind === 'home' ? '{}' : null,
      isPrimary: p.primary ? 1 : 0,
    });
    const placeId = place.id as string;
    placeIds.set(p.ref, placeId);
    if (p.kind === 'home') {
      for (const code of p.equipment) {
        await insertFixtureRow(db, 'home_equipment', {
          id: `${placeId}:${code}`,
          placeId,
          ownerId: userId,
          equipmentCode: code,
        });
      }
    }
  }
  for (const l of m.limitations) {
    await insertFixtureRow(db, 'limitation', {
      ownerId: userId,
      bodyArea: l.bodyArea,
      side: l.side,
      severity: l.severity,
      note: l.note ?? null,
      active: 1,
    });
  }

  let instanceId: string | null = null;
  if (m.program !== null) {
    const { programTemplates } = await currentCatalog(deps);
    const template = programTemplates.find(
      (t) => t.template.id === m.program?.templateId && t.available,
    )?.template;
    if (template === undefined)
      throw new Error(`Modèle indisponible dans ce catalogue : ${m.program.templateId}`);
    instanceId = (await insertInstance(db, deps, userId, template, m.program.daysPerWeek)).id;
  }

  const loadModes = new Map(
    (await db.selectFrom('exercise').select(['id', 'loadMode']).execute()).map((e) => [e.id, e.loadMode]),
  );
  const profile = m.profile.cautiousMode === true ? 'cautious' : 'adult';
  for (const s of m.sessions) {
    const startedAt = now - s.daysAgo * DAY_MS + 7 * HOUR_MS;
    const placeId = placeIds.get(s.place);
    if (placeId === undefined) throw new Error(`Lieu inconnu dans la fixture ${m.id} : ${s.place}`);
    const session = await insertFixtureRow(db, 'workout_session', {
      ownerId: userId,
      instanceId,
      workoutId: s.workoutId,
      placeId,
      startedAt: iso(startedAt),
      endedAt: iso(startedAt + HOUR_MS),
      status: 'completed',
      profile,
      templateVersion: instanceId === null ? null : 1,
      note: s.note ?? null,
    });
    for (const [i, e] of s.exercises.entries()) {
      const exercise = await insertFixtureRow(db, 'performed_exercise', {
        ownerId: userId,
        sessionId: session.id,
        slotId: e.slotId,
        plannedExerciseId: e.exerciseId,
        exerciseId: e.exerciseId,
        position: i + 1,
        painLevel: e.painLevel ?? null,
        note: e.note ?? null,
      });
      for (const [j, set] of e.sets.entries()) {
        await insertFixtureRow(db, 'performed_set', {
          ownerId: userId,
          performedExerciseId: exercise.id,
          position: j + 1,
          kind: 'work',
          loadMode: loadModes.get(e.exerciseId) ?? 'bodyweight',
          loadG: set.loadG,
          reps: set.reps,
          effort: set.effort ?? null,
          loggedAt: iso(startedAt + 10 * 60_000),
        });
      }
    }
  }
  return userId;
}

async function createWorld(o: {
  catalogDir: string;
  options: Options;
  ai: AiClient;
  member: MemberFixture;
  health: boolean;
}): Promise<World> {
  const clock = { now: () => new Date(EVAL_NOW) };
  const ids = cryptoIds();
  const { sqlite, db } = openDatabase(':memory:');
  try {
    await migrate(db, MIGRATIONS, clock);
    await initServerMeta(db, { ids, clock });
    const config = {
      ...loadConfig({ APP_ORIGIN, COACH_MODEL: o.options.model }),
      contentDir: o.catalogDir,
    };
    const deps = createAppDeps({
      sqlite,
      db,
      config,
      clock,
      ids,
      logger: createLogger(() => {}),
      ai: o.ai,
      coachThinkingBinding: 'error',
    });
    await CATALOG_STARTUP_TASK.run(deps);
    const meta = await db.selectFrom('serverMeta').select('catalogVersion').executeTakeFirstOrThrow();
    const base = deps.coachConfig;
    // Comme `enableCoach` des tests : la combinaison évaluée est celle de ce passage, le coach est en service.
    deps.coachConfig = {
      ...base,
      effort: o.options.effort,
      evaluated: [
        {
          model: o.options.model,
          effort: o.options.effort,
          promptVersion: base.promptVersion,
          toolsVersion: base.toolsVersion,
          briefSchema: base.briefSchema,
          catalogVersion: meta.catalogVersion ?? failNoCatalog(),
          report: 'eval',
        },
      ],
    };
    await db
      .updateTable('coachState')
      .set({ enabled: 1, updatedAt: iso(clock.now().getTime()) })
      .where('id', '=', 1)
      .execute();
    await refreshCoachConfig(deps);
    const userId = await loadMember(deps, o.member, o.health);
    const { token } = await createSession(db, deps, userId);
    return {
      deps,
      app: createApp(deps),
      userId,
      cookie: `${deps.config.sessionCookieName}=${token}`,
      close: () => {
        if (sqlite.isOpen) sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Un passage
// ---------------------------------------------------------------------------------------------------------------

/** Événements d'un flux SSE (`event: <type>` puis `data: <JSON>`), les commentaires `: ping` ignorés. */
export function parseSse(text: string): CoachStreamEvent[] {
  const events: CoachStreamEvent[] = [];
  for (const frame of text.split('\n\n')) {
    const type = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (type === undefined || data === undefined) continue;
    const parsed = CoachStreamEventSchema.safeParse({ type, ...JSON.parse(data) });
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

/** Texte d'un échange tel que la personne le lit : celui d'après le dernier `retry`, ou le message du refus. */
function replyOf(events: readonly CoachStreamEvent[]): string {
  let text = '';
  for (const e of events) {
    if (e.type === 'retry') text = '';
    else if (e.type === 'text') text += e.text;
    else if (e.type === 'refused') text = e.message;
  }
  return text;
}

interface ToolBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

/** Appels d'outils du modèle, avec le résultat que le serveur lui a rendu, retrouvé dans les requêtes suivantes. */
function toolTraces(rec: Recorder): ToolCallTrace[] {
  const results = new Map<string, { isError: boolean; result: unknown }>();
  for (const req of rec.requests) {
    for (const message of req.messages) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content as ToolBlock[]) {
        if (block.type !== 'tool_result' || block.tool_use_id === undefined) continue;
        let result: unknown = block.content;
        try {
          if (typeof block.content === 'string') result = JSON.parse(block.content);
        } catch {
          // Contenu non JSON : gardé tel quel.
        }
        results.set(block.tool_use_id, { isError: block.is_error === true, result });
      }
    }
  }
  const traces: ToolCallTrace[] = [];
  for (const final of rec.finals) {
    const lastFallback = final.blocks.findLastIndex((b) => b.type === 'fallback');
    for (const [i, block] of (final.blocks as ToolBlock[]).entries()) {
      if (block.type !== 'tool_use' || i < lastFallback || block.id === undefined) continue;
      const answered = results.get(block.id);
      traces.push({
        id: block.id,
        name: String(block.name),
        input: block.input,
        isError: answered?.isError ?? null,
        result: answered?.result ?? null,
      });
    }
  }
  return traces;
}

export interface RunResult {
  id: string;
  category: EvalCase['category'];
  audience: EvalCase['audience'];
  run: number;
  checks: CheckResult[];
  replies: string[];
}

/** Requête sérialisée d'un passage, pour les tests du lanceur. */
export interface RequestTrace {
  caseId: string;
  audience: EvalCase['audience'];
  requestJson: string;
}

async function runCase(
  c: EvalCase,
  member: MemberFixture,
  o: { catalogDir: string; options: Options; client: AiClient | null; scrub: (s: string) => string },
): Promise<{ record: RunRecord; result: RunResult; requests: RequestTrace[] }> {
  const rec: Recorder = { calls: [], requests: [], finals: [], texts: [] };
  let mode: CaseRun['mode'] = 'real';
  let inner = o.client;
  if (inner === null) {
    const script = scriptFor(c);
    mode = script.mode;
    inner = createFakeAiClient([], { model: o.options.model, chat: script.turns });
  }
  const problems: string[] = [];
  const events: CoachStreamEvent[] = [];
  const replies: string[] = [];
  let brief: unknown = {};
  let briefTokens = 0;
  const toolResults: unknown[] = [];
  const started = performance.now();
  let world: World | undefined;
  try {
    world = await createWorld({
      catalogDir: o.catalogDir,
      options: o.options,
      ai: recording(inner, rec),
      member,
      health: c.consents.health,
    });
    for (const text of c.turns) {
      const response = await world.app.request('/api/coach/messages', {
        method: 'POST',
        headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json', Cookie: world.cookie },
        body: JSON.stringify({ clientMessageId: world.deps.ids.uuidv7(), text }),
      });
      const body = await response.text();
      if (response.status !== 200) {
        problems.push(`HTTP ${response.status} : ${body.slice(0, 200)}`);
        replies.push('');
        break;
      }
      const turnEvents = parseSse(body);
      events.push(...turnEvents);
      replies.push(replyOf(turnEvents));
    }
    const thread = await world.deps.db
      .selectFrom('coachThread')
      .select(['brief'])
      .where('userId', '=', world.userId)
      .executeTakeFirst();
    if (thread?.brief) {
      brief = JSON.parse(thread.brief);
      briefTokens = estimateTokens(thread.brief);
    }
    const messages = await world.deps.db.selectFrom('coachMessage').select('blocks').execute();
    for (const row of messages) {
      if (row.blocks === null) continue;
      for (const block of JSON.parse(row.blocks) as ToolBlock[]) {
        if (block.type !== 'tool_result' || typeof block.content !== 'string') continue;
        try {
          toolResults.push(JSON.parse(block.content));
        } catch {
          // Illisible : ses valeurs ne sont pas autorisées.
        }
      }
    }
  } catch (error) {
    problems.push(o.scrub(error instanceof Error ? `${error.name} : ${error.message}` : String(error)));
  } finally {
    world?.close();
  }

  const run: CaseRun = {
    mode,
    replies,
    events,
    calls: rec.calls,
    tools: toolTraces(rec),
    brief,
    briefTokens,
    toolResults,
    canaries: member.canaries,
    latencyMs: Math.round(performance.now() - started),
    costUsd: rec.calls.reduce((s, call) => s + call.costUsd, 0),
    problems,
    // Textes streamés qui ne sont dans aucune réponse lue : les tentatives écartées par le filtre.
    blockedAttempts: events.some((e) => e.type === 'retry' || (e.type === 'done' && e.replaced))
      ? rec.texts.filter((text) => !replies.some((reply) => reply.includes(text.trim())))
      : [],
  };
  const checks = runChecks(c, run);
  const retries = events.filter((e) => e.type === 'retry').length;
  const replaced = events.some((e) => (e.type === 'done' && e.replaced) || e.type === 'refused');
  const record: RunRecord = {
    checks,
    tools: run.tools.map((t) => t.name),
    // Un second blocage (réponse type) ne laisse qu'un `retry` : la régénération a été bloquée aussi.
    blocks: retries + (events.some((e) => e.type === 'done' && e.replaced) ? 1 : 0),
    replaced,
    proposal: proposalStats(run),
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    briefTokens,
    inputTokens: rec.calls.reduce((s, call) => s + call.inputTokens, 0),
    outputTokens: rec.calls.reduce((s, call) => s + call.outputTokens, 0),
    replies,
  };
  return {
    record,
    result: { id: c.id, category: c.category, audience: c.audience, run: 0, checks, replies },
    requests: rec.calls.map((call) => ({
      caseId: c.id,
      audience: c.audience,
      requestJson: call.requestJson,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Campagne
// ---------------------------------------------------------------------------------------------------------------

export interface RunOutcome {
  results: RunResult[];
  requests: RequestTrace[];
  files: string[];
}

export type MainDeps = {
  /** Dossier des rapports ; `eval/coach/reports` à défaut. */
  reportsDir?: string;
  /** `ENV_FILE` à défaut. */
  envFile?: string;
  /** Lecture du fichier de la clé ; jamais appelée avec `--fake`. `readFile` à défaut. */
  readEnvFile?: (path: string) => Promise<string>;
  /** Variables d'environnement ; `process.env` à défaut. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Client réel à défaut (`createAnthropicClient`) ; jamais appelé avec `--fake`. */
  createClient?: (apiKey: string, model: string) => AiClient;
  /** Confirmation `o/N` avant tout appel réel ; lit l'entrée standard à défaut. */
  confirm?: (question: string) => Promise<boolean>;
  now?: () => Date;
  onOutcome?: (outcome: RunOutcome) => void;
};

/** Clé lue dans `envFile`, sinon dans l'environnement du poste ; jamais renvoyée dans un message. */
async function readApiKey(
  envFile: string,
  readEnvFile: (path: string) => Promise<string>,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  let text = '';
  try {
    text = await readEnvFile(envFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return parseEnv(text)[API_KEY_VAR]?.trim() || env[API_KEY_VAR]?.trim() || null;
}

/**
 * Coût estimé d'une campagne (haut, sans repli ni nouvelle tentative) : par appel, 2 500 jetons d'entrée neufs et
 * 1 000 de sortie (le prompt est en cache après le premier), 2 appels par échange. Les prix sont ceux de `MODEL_PRICES`.
 */
export function estimateCostUsd(model: string, exchanges: number): number {
  const prices = MODEL_PRICES[model];
  if (prices === undefined) return Number.NaN;
  const perCall = (2_500 * prices.input + 1_000 * prices.output) / 1_000_000;
  return perCall * 2 * exchanges;
}

const dollars = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;

/** Sans terminal (entrée non interactive ou fermée), refuse au lieu d'attendre. */
async function askConfirmation(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || process.stdin.destroyed) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^o(ui)?$/i.test((await rl.question(`${question} [o/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** Point d'entrée : rend le code de sortie. */
export async function main(
  argv: readonly string[],
  out: Pick<Console, 'log' | 'error'> = console,
  deps: MainDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  if (env.CI) {
    out.error('coach:eval se lance sur le poste de dev, jamais en CI (spec brique 4 §19.1).');
    return 2;
  }
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    out.error(parsed);
    return 2;
  }
  const options = parsed;

  const allCases = await loadCases();
  const members = new Map((await loadMembers()).map((m) => [m.id, m]));
  const unknown = (options.ids ?? []).filter((id) => !allCases.some((c) => c.id === id));
  if (unknown.length > 0) {
    out.error(`Cas inconnu(s) : ${unknown.join(', ')}.`);
    return 2;
  }
  const cases = options.ids === undefined ? allCases : allCases.filter((c) => options.ids?.includes(c.id));

  const catalogDir = options.catalog === 'repo' ? DEFAULT_DATA_DIR : CATALOG_FIXTURE_DIR;
  const loaded = await loadCatalogFiles({
    config: { ...loadConfig({ APP_ORIGIN }), contentDir: catalogDir },
  });
  if (!loaded.ok) {
    for (const e of loaded.errors) out.error(`${e.file} [${e.code}] ${e.message}`);
    out.error(`Catalogue ${options.catalog} invalide : ${loaded.errors.length} erreur(s).`);
    return 1;
  }

  // Clé : jamais lue avec --fake. Sans elle, aucun appel possible.
  let client: AiClient | null = null;
  let scrub = (s: string) => s;
  if (!options.fake) {
    const key = await readApiKey(
      deps.envFile ?? ENV_FILE,
      deps.readEnvFile ?? ((path) => readFile(path, 'utf8')),
      env,
    );
    if (key === null) {
      out.error(
        `Clé absente : ajoute ${API_KEY_VAR}=<clé du workspace de développement> dans .env.local (ignoré par git).`,
      );
      return 1;
    }
    scrub = (s) => s.replaceAll(key, '[clé]');
    const exchanges = cases.reduce((n, c) => n + c.turns.length, 0) * options.runs;
    const estimate = estimateCostUsd(options.model, exchanges);
    out.log(
      `Campagne réelle : ${cases.length} cas, ${options.runs} passage(s), ${exchanges} échange(s), modèle ${options.model}, ` +
        `effort ${options.effort}, catalogue ${options.catalog}. Coût estimé : environ ${dollars(estimate)}.`,
    );
    const confirmed = await (deps.confirm ?? askConfirmation)('Lancer les appels réels ?');
    if (!confirmed) {
      out.log('Annulé : aucun appel.');
      return 1;
    }
    try {
      client = (deps.createClient ?? ((apiKey, model) => createAnthropicClient({ apiKey, model })))(
        key,
        options.model,
      );
    } catch (error) {
      out.error(scrub((error as Error).message));
      return 1;
    }
  }

  out.log(
    `Évaluation du coach : ${cases.length} cas, ${options.runs} passage(s), modèle ${options.model}, effort ${options.effort}, ` +
      `catalogue ${options.catalog}${options.fake ? ', faux client' : ''}.`,
  );
  const records: CaseRecord[] = [];
  const results: RunResult[] = [];
  const requests: RequestTrace[] = [];
  for (const c of cases) {
    const member = members.get(c.fixture);
    if (member === undefined) {
      out.error(`${c.id} : fixture inconnue (${c.fixture}).`);
      return 1;
    }
    const runs: RunRecord[] = [];
    for (let i = 0; i < options.runs; i += 1) {
      const done = await runCase(c, member, { catalogDir, options, client, scrub });
      runs.push(done.record);
      results.push({ ...done.result, run: i });
      requests.push(...done.requests);
    }
    records.push({
      id: c.id,
      category: c.category,
      audience: c.audience,
      safety: c.expect.safety,
      turns: c.turns,
      runs,
    });
    const bad = runs.filter((r) => r.checks.some((k) => k.status === 'fail')).length;
    out.log(
      `${bad === 0 ? 'ok   ' : 'ÉCHEC'} ${c.id}${bad === 0 ? '' : ` (${bad}/${runs.length} passage(s))`}`,
    );
  }

  const version = await catalogVersionOf(catalogDir, options);
  const report = buildReport({
    date: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
    model: options.model,
    effort: options.effort,
    promptVersion: COACH_CONFIG.promptVersion,
    toolsVersion: COACH_CONFIG.toolsVersion,
    catalog: { name: options.catalog, version },
    fake: options.fake,
    runsPerCase: options.runs,
    complete: cases.length === allCases.length,
    cases: records,
  });
  const files = await writeReport(deps.reportsDir ?? REPORTS_DIR, report);
  for (const file of files) out.log(`Rapport : ${file}`);
  out.log(
    report.json.verdict.valid
      ? 'Verdict : valable pour la mise en service.'
      : `Verdict : non valable pour la mise en service (${report.json.verdict.reasons.join(' ; ')}).`,
  );
  out.log(`Coût réel : ${dollars(report.json.totals.costUsd)}.`);
  deps.onOutcome?.({ results, requests, files });
  return 0;
}

/** `catalog_version` calculée par le serveur (`rebuildCatalog` au démarrage) sur `catalogDir`. */
async function catalogVersionOf(catalogDir: string, options: Options): Promise<string> {
  const { sqlite, db } = openDatabase(':memory:');
  try {
    const clock = { now: () => new Date(EVAL_NOW) };
    const ids = cryptoIds();
    await migrate(db, MIGRATIONS, clock);
    await initServerMeta(db, { ids, clock });
    const deps = createAppDeps({
      sqlite,
      db,
      config: { ...loadConfig({ APP_ORIGIN, COACH_MODEL: options.model }), contentDir: catalogDir },
      clock,
      ids,
      logger: createLogger(() => {}),
    });
    await CATALOG_STARTUP_TASK.run(deps);
    const meta = await db.selectFrom('serverMeta').select('catalogVersion').executeTakeFirstOrThrow();
    return meta.catalogVersion ?? failNoCatalog();
  } finally {
    sqlite.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
