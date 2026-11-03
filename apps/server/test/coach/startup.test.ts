import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COACH_CONFIG } from '@rune/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli';
import { createAppDeps } from '../../src/deps';
import { createLogger } from '../../src/logger';
import { type RunningServer, startServer } from '../../src/main';
import { createTestContext } from '../support';

let dir: string;
let env: Record<string, string>;
let running: RunningServer | undefined;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rune-coach-'));
  env = { APP_ORIGIN: 'http://localhost:3999', RUNE_DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0' };
  writeFileSync(join(dir, '.rune-volume'), '');
  const quiet = () => {};
  expect(await runCli(['init'], env, quiet, quiet)).toBe(0);
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const health = (r: RunningServer) => fetch(`http://127.0.0.1:${r.port}/api/health`);

describe('démarrage et coach', () => {
  it('sans clé : démarre, /health 200, coach not_configured no_key', async () => {
    const lines: string[] = [];
    running = await startServer(env, { logger: createLogger((l) => lines.push(l)) });
    expect((await health(running)).status).toBe(200);
    expect(running.deps.ai).toBeNull();
    expect(running.deps.coach.configured).toEqual({ ok: false, cause: 'no_key' });
    expect(lines.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'coach_not_configured',
        code: 'no_key',
      }),
    );
  });

  it('clé et COACH_MODEL sans prix : démarre quand même, model_not_allowed', async () => {
    const lines: string[] = [];
    running = await startServer(
      { ...env, ANTHROPIC_API_KEY: 'sk-ant-secret', COACH_MODEL: 'claude-inconnu' },
      { logger: createLogger((l) => lines.push(l)) },
    );
    expect((await health(running)).status).toBe(200);
    expect(running.deps.coach.configured).toEqual({ ok: false, cause: 'model_not_allowed' });
    expect(lines.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'coach_not_configured',
        code: 'model_not_allowed',
      }),
    );
    expect(lines.join('\n')).not.toContain('sk-ant-secret');
  });

  it('clé et modèle connu : client posé, liaison de réflexion drop_block', async () => {
    running = await startServer({ ...env, ANTHROPIC_API_KEY: 'sk-ant-secret' });
    expect(running.deps.ai?.model).toBe('claude-opus-5-5');
    expect(running.deps.coachThinkingBinding).toBe('drop_block');
    expect(running.deps.coach.configured).toEqual({ ok: false, cause: 'not_evaluated' });
  });

  it("la liaison passée à startServer l'emporte ; createTestContext passe error", async () => {
    running = await startServer(env, { thinkingBinding: 'error' });
    expect(running.deps.coachThinkingBinding).toBe('error');
    const ctx = await createTestContext();
    expect(ctx.deps.coachThinkingBinding).toBe('error');
    ctx.close();
  });

  it("l'arrêt aborte les échanges en cours avant de fermer", async () => {
    running = await startServer(env);
    const lease = running.deps.coach.exchanges.begin('u1');
    await running.close();
    running = undefined;
    expect(lease?.signal.reason).toBe('shutdown');
  });

  it("l'arrêt appelle abortAll avant la fermeture HTTP", async () => {
    running = await startServer(env);
    const { port, deps } = running;
    let healthDuringAbort: number | undefined;
    const original = deps.coach.exchanges.abortAll;
    deps.coach.exchanges.abortAll = async (reason) => {
      healthDuringAbort = (await fetch(`http://127.0.0.1:${port}/api/health`)).status;
      await original(reason);
    };
    await running.close();
    running = undefined;
    expect(healthDuringAbort).toBe(200);
  });

  it('createTestContext suit exchangeTimeoutMs de coachConfig', async () => {
    const ctx = await createTestContext({
      deps: { coachConfig: { ...COACH_CONFIG, limits: { ...COACH_CONFIG.limits, exchangeTimeoutMs: 50 } } },
    });
    const lease = ctx.deps.coach.exchanges.begin('u1');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(lease?.signal.reason).toBe('timeout');
    lease?.done();
    ctx.close();
  });

  it('createAppDeps seul : défauts de production', async () => {
    const ctx = await createTestContext();
    const deps = createAppDeps({ sqlite: ctx.deps.sqlite, db: ctx.deps.db, config: ctx.deps.config });
    expect(deps.ai).toBeNull();
    expect(deps.coachThinkingBinding).toBe('drop_block');
    expect(deps.coach.configured).toEqual({ ok: false, cause: 'no_key' });
    ctx.close();
  });
});
