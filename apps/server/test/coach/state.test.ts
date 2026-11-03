import { COACH_CONFIG } from '@rune/domain';
import { describe, expect, it } from 'vitest';
import { createFakeAiClient } from '../../src/ai/fake';
import {
  catalogChangedSinceEvaluation,
  checkCoachConfig,
  readCoachState,
  refreshCoachConfig,
  resumeCoach,
  setCoachEnabled,
  suspendCoach,
} from '../../src/coach/state';
import type { AppDeps } from '../../src/deps';
import { createLogger, createTestContext, type TestContext } from '../support';
import { enableCoach } from '../support/coach';

const CATALOG = 'catalogue-v1';

const evaluatedEntry = (catalogVersion: string) => ({
  model: 'claude-opus-5-5',
  effort: COACH_CONFIG.effort,
  promptVersion: COACH_CONFIG.promptVersion,
  toolsVersion: COACH_CONFIG.toolsVersion,
  briefSchema: COACH_CONFIG.briefSchema,
  catalogVersion,
  report: 'rapport',
});

async function setup(
  o: { model?: string; ai?: boolean; evaluated?: string[]; dev?: boolean } = {},
): Promise<{ ctx: TestContext; lines: string[]; deps: AppDeps }> {
  const lines: string[] = [];
  const ctx = await createTestContext({
    config: {
      coachModel: o.model ?? 'claude-opus-5-5',
      coachDevAllowUnevaluated: o.dev ?? false,
    },
    deps: {
      logger: createLogger((line) => lines.push(line)),
      ai: o.ai === false ? null : createFakeAiClient([]),
      coachConfig: { ...COACH_CONFIG, evaluated: (o.evaluated ?? []).map((v) => evaluatedEntry(v)) },
    },
  });
  await ctx.deps.db.updateTable('serverMeta').set({ catalogVersion: CATALOG }).execute();
  return { ctx, lines, deps: ctx.deps };
}

describe('checkCoachConfig', () => {
  it('sans client IA : no_key', async () => {
    const { deps } = await setup({ ai: false });
    expect(checkCoachConfig(deps, CATALOG)).toEqual({ ok: false, cause: 'no_key' });
  });

  it('modèle hors allowedModels : model_not_allowed, avec ou sans clé', async () => {
    for (const ai of [true, false]) {
      const { deps } = await setup({ model: 'claude-fable-5-1', ai, evaluated: [CATALOG] });
      expect(checkCoachConfig(deps, CATALOG)).toEqual({ ok: false, cause: 'model_not_allowed' });
    }
  });

  it('modèle autorisé sans prix : model_not_allowed', async () => {
    const { deps } = await setup({ model: 'claude-inconnu' });
    deps.coachConfig = { ...deps.coachConfig, allowedModels: ['claude-inconnu'] };
    expect(checkCoachConfig(deps, CATALOG)).toEqual({ ok: false, cause: 'model_not_allowed' });
  });

  it('sans entrée évaluée : not_evaluated', async () => {
    const { deps } = await setup();
    expect(checkCoachConfig(deps, CATALOG)).toEqual({ ok: false, cause: 'not_evaluated' });
  });

  it('entrée à une autre catalogVersion : not_evaluated', async () => {
    const { deps } = await setup({ evaluated: ['autre'] });
    expect(checkCoachConfig(deps, CATALOG)).toEqual({ ok: false, cause: 'not_evaluated' });
  });

  it('entrée à la bonne catalogVersion : ok', async () => {
    const { deps } = await setup({ evaluated: [CATALOG] });
    expect(checkCoachConfig(deps, CATALOG)).toEqual({
      ok: true,
      devUnevaluated: false,
      catalogVersion: CATALOG,
    });
  });

  it('mode dev sans entrée : ok, devUnevaluated', async () => {
    const { deps } = await setup({ dev: true });
    expect(checkCoachConfig(deps, CATALOG)).toEqual({
      ok: true,
      devUnevaluated: true,
      catalogVersion: CATALOG,
    });
  });
});

describe('refreshCoachConfig et journal', () => {
  it('journalise coach_not_configured avec le seul code, sans clé ni modèle', async () => {
    const { deps, lines } = await setup({ model: 'claude-fable-5-1' });
    await refreshCoachConfig(deps);
    expect(deps.coach.configured).toEqual({ ok: false, cause: 'model_not_allowed' });
    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.msg === 'coach_not_configured');
    expect(entry).toMatchObject({ level: 'warn', msg: 'coach_not_configured', code: 'model_not_allowed' });
    expect(Object.keys(entry).sort()).toEqual(['code', 'level', 'msg', 'time']);
    expect(lines.join('\n')).not.toContain('claude-fable-5-1');
  });

  it('rien dans le journal quand le coach est configuré', async () => {
    const { deps, lines } = await setup({ evaluated: [CATALOG] });
    expect(await refreshCoachConfig(deps)).toMatchObject({ ok: true });
    expect(lines).toEqual([]);
  });
});

describe('état et catalogue', () => {
  it('catalogue publié en marche : configured reste ok, puis setCoachEnabled(true) → not_evaluated', async () => {
    const { deps } = await setup({ evaluated: [CATALOG] });
    await refreshCoachConfig(deps);
    expect(await catalogChangedSinceEvaluation(deps)).toBe(false);
    await deps.db.updateTable('serverMeta').set({ catalogVersion: 'catalogue-v2' }).execute();
    expect(deps.coach.configured).toMatchObject({ ok: true });
    expect(await catalogChangedSinceEvaluation(deps)).toBe(true);
    const check = await deps.db.transaction().execute((trx) => setCoachEnabled(trx, deps, true, 'admin-1'));
    expect(check).toEqual({ ok: false, cause: 'not_evaluated' });
    expect(deps.coach.configured).toEqual(check);
    expect((await readCoachState(deps.db)).enabled).toBe(true);
  });

  it('enableCoach met le coach en service', async () => {
    const { ctx } = await setup();
    await enableCoach(ctx, []);
    expect(ctx.deps.coach.configured).toMatchObject({ ok: true, devUnevaluated: false });
    expect((await readCoachState(ctx.deps.db)).enabled).toBe(true);
    expect(ctx.deps.coachThinkingBinding).toBe('error');
  });

  it('setCoachEnabled journalise coach_state_changed', async () => {
    const { deps } = await setup({ evaluated: [CATALOG] });
    await deps.db.transaction().execute((trx) => setCoachEnabled(trx, deps, true, 'admin-1'));
    await deps.db.transaction().execute((trx) => setCoachEnabled(trx, deps, false, 'admin-1'));
    const events = await deps.db
      .selectFrom('securityEvent')
      .selectAll()
      .where('type', '=', 'coach_state_changed')
      .orderBy('at')
      .orderBy('id')
      .execute();
    expect(events.map((e) => e.details)).toEqual(['{"enabled":true}', '{"enabled":false}']);
    expect(events[0]?.actorId).toBe('admin-1');
    expect((await readCoachState(deps.db)).enabled).toBe(false);
  });

  it('suspendCoach au 2026-10-31T23:30:00Z : suspended_until au 30 novembre 23:00Z, coach_suspended', async () => {
    const { deps } = await setup();
    await deps.db.transaction().execute((trx) => suspendCoach(trx, deps, new Date('2026-10-31T23:30:00Z')));
    expect((await readCoachState(deps.db)).suspendedUntil).toBe('2026-11-30T23:00:00.000Z');
    const events = await deps.db
      .selectFrom('securityEvent')
      .select('type')
      .where('type', '=', 'coach_suspended')
      .execute();
    expect(events).toHaveLength(1);
    const full = await deps.db
      .selectFrom('securityEvent')
      .selectAll()
      .where('type', '=', 'coach_suspended')
      .executeTakeFirstOrThrow();
    expect(full.details).toBe('{"until":"2026-11-30T23:00:00.000Z"}');
    expect(full.actorId).toBeNull();
    expect(full.outcome).toBe('success');
  });

  it('resumeCoach lève la suspension', async () => {
    const { deps } = await setup();
    await deps.db.transaction().execute((trx) => suspendCoach(trx, deps, new Date('2026-10-31T23:30:00Z')));
    await deps.db.transaction().execute((trx) => resumeCoach(trx, deps, 'admin-1'));
    expect((await readCoachState(deps.db)).suspendedUntil).toBeNull();
    const resumed = await deps.db
      .selectFrom('securityEvent')
      .selectAll()
      .where('type', '=', 'coach_state_changed')
      .executeTakeFirstOrThrow();
    expect(resumed.actorId).toBe('admin-1');
    expect(resumed.details).toBe('{"resumed":true}');
  });
});
