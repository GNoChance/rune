import { describe, expect, it } from 'vitest';
import { ApiError, NetworkRequiredError } from '../../src/api/client';
import { createAppDb } from '../../src/local-db/db';
import { getMeta, setMeta } from '../../src/local-db/meta';
import { localNutritionMode, recordDescent } from '../../src/local-db/nutrition';
import { wipeUserData } from '../../src/local-db/wipe';
import { nutritionRepoFor } from '../../src/repos/nutrition-repo';
import { WeighInError, weighInRepoFor } from '../../src/repos/weigh-in-repo';
import { createTestServices, makeMe } from '../support/render';
import { seedMirror } from '../support/seed';
import { seedHealthConsent } from '../support/workout';

const base = { ownerId: 'u-1', serverRevSeen: 1, deletedAt: null, updatedAt: '2026-10-01T10:00:00.000Z' };

const STATE_QUALITATIVE = {
  effective_mode: 'qualitative',
  cause: 'stored',
  stored_mode: 'qualitative',
  full_open: true,
  screen_version_current: 1,
  needs: null,
  mode_reason: 'choice',
};

async function services(opts: Parameters<typeof createTestServices>[0] = {}) {
  const me = makeMe({
    consents: {
      health: { active: true, textVersion: 'v1', at: null },
      aiCoach: { active: false, textVersion: null, at: null },
    },
  });
  const t = await createTestServices({ me, ...opts });
  await seedHealthConsent(t.db);
  await setMeta(t.db, 'nutritionEffectiveMode', 'full');
  return t;
}

async function seedFull(db: Awaited<ReturnType<typeof services>>['db']): Promise<void> {
  await setMeta(db, 'nutritionEffectiveMode', 'full');
  await seedMirror(db, 'weigh_in', [{ id: 'w1', ...base, date: '2026-10-01', weightG: 70000 }]);
  await seedMirror(db, 'nutrition_target', [
    { id: 't1', ...base, validFrom: '2026-10-01', kcalTarget: 2200 },
  ]);
  await db.table('nutritionSheets').put({ id: 'sleep' });
}

describe('nutritionRepo.setMode (descente hors ligne, D11)', () => {
  it('purge tout de suite, garde l’intention après une réouverture de la base', async () => {
    const name = `nutrition-${crypto.randomUUID()}`;
    const { services: s, db, api } = await services({ db: createAppDb(name) });
    await seedFull(db);
    api.setOffline('reject');
    await nutritionRepoFor(s).setMode('qualitative');
    expect(await db.mirror('weigh_in').count()).toBe(0);
    expect(await db.mirror('nutrition_target').count()).toBe(0);
    expect(await db.table('nutritionSheets').count()).toBe(0);
    expect(await localNutritionMode(db)).toBe('qualitative');
    db.close();
    const again = createAppDb(name);
    try {
      expect(await getMeta(again, 'nutritionPendingMode')).toMatchObject({ mode: 'qualitative' });
      expect(await localNutritionMode(again)).toBe('qualitative');
    } finally {
      await again.delete();
    }
  });

  it('en ligne aussi : effet local d’abord, puis un cycle de synchro', async () => {
    const { services: s, sync } = await services();
    await nutritionRepoFor(s).setMode('disabled');
    expect(sync.triggers).toContain('manual');
  });

  it('seule la plus restrictive compte : disabled l’emporte, la montée n’écrase pas l’intention', async () => {
    const { services: s, db, api } = await services();
    const repo = nutritionRepoFor(s);
    await repo.setMode('qualitative');
    await repo.setMode('disabled');
    expect(await getMeta(db, 'nutritionPendingMode')).toMatchObject({ mode: 'disabled' });
    // Remonter à qualitative n'est plus une descente : elle exige le réseau et ne remplace pas l'intention.
    api.setOffline('reject');
    await expect(repo.setMode('qualitative')).rejects.toBeDefined();
    expect(await getMeta(db, 'nutritionPendingMode')).toMatchObject({ mode: 'disabled' });
  });
});

describe('nutritionRepo.setMode : montée sans écran', () => {
  it('disabled vers qualitative, en ligne : le PUT part tout de suite, le mode local suit, aucune intention', async () => {
    const { services: s, db, api } = await services();
    await setMeta(db, 'nutritionEffectiveMode', 'disabled');
    api.on('PUT', '/api/nutrition/mode', { status: 200, body: STATE_QUALITATIVE });
    await nutritionRepoFor(s).setMode('qualitative');
    expect(api.calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ mode: 'qualitative' }]);
    expect(await localNutritionMode(db)).toBe('qualitative');
    expect(await getMeta(db, 'nutritionPendingMode')).toBeUndefined();
  });

  it('hors ligne : NetworkRequiredError, aucune intention écrite', async () => {
    const { services: s, db, api } = await services();
    await setMeta(db, 'nutritionEffectiveMode', 'disabled');
    api.setOffline('reject');
    await expect(nutritionRepoFor(s).setMode('qualitative')).rejects.toBeInstanceOf(NetworkRequiredError);
    expect(await getMeta(db, 'nutritionPendingMode')).toBeUndefined();
    expect(await localNutritionMode(db)).toBe('disabled');
  });
});

describe('purge : rien de C2 ne reste', () => {
  it('une descente vide l’outbox et la deadletter des pesées', async () => {
    const { services: s, db } = await services();
    const id = await weighInRepoFor(s).save({ date: '2026-10-05', weightG: 80000 });
    await db.deadletter.put({
      opId: 'dl-1',
      userId: 'u-1',
      entity: 'weigh_in',
      id,
      code: 'forbidden',
      detail: { kind: 'create', fieldNames: ['date', 'weightG'] },
      receivedAt: '2026-10-06T10:00:00.000Z',
    });
    await db.deadletter.put({
      opId: 'dl-2',
      userId: 'u-1',
      entity: 'gym',
      id: 'g',
      code: 'forbidden',
      detail: {},
      receivedAt: '2026-10-06T10:00:00.000Z',
    });
    await nutritionRepoFor(s).setMode('qualitative');
    const ops = await db.table('outbox').toArray();
    expect(ops.filter((o) => o.entity === 'weigh_in')).toEqual([]);
    expect(JSON.stringify(ops)).not.toContain('weightG');
    expect((await db.deadletter.toArray()).map((d) => d.opId)).toEqual(['dl-2']);
  });

  it('wipeUserData vide nutritionSheets et son ETag', async () => {
    const { db } = await services();
    await db.table('nutritionSheets').put({ id: 'sleep' });
    await setMeta(db, 'nutritionSheetsEtag', '"x"');
    await wipeUserData(db, { keepOutbox: false });
    expect(await db.table('nutritionSheets').count()).toBe(0);
    expect(await getMeta(db, 'nutritionSheetsEtag')).toBeUndefined();
  });

  it('sheets : une réponse arrivée après une purge ne recache rien', async () => {
    const { services: s, api, db } = await services();
    await setMeta(db, 'nutritionEffectiveMode', 'qualitative');
    const body = [
      {
        id: 'sleep',
        title: 't',
        body_md: 'x',
        audience: 'all',
        visible_modes: ['qualitative', 'full'],
        tags: [],
        sources: [],
        version: 1,
        reviewed_at: null,
      },
    ];
    api.on('GET', '/api/nutrition/sheets', async () => {
      await recordDescent(db, 'disabled', '2026-10-06T12:00:00.000Z');
      return { status: 200, body, headers: { ETag: '"e"' } };
    });
    expect(await nutritionRepoFor(s).sheets()).toEqual([]);
    expect(await db.table('nutritionSheets').count()).toBe(0);
    expect(await getMeta(db, 'nutritionSheetsEtag')).toBeUndefined();
  });
});

describe('nutritionRepo (en ligne)', () => {
  it('open : flushBefore puis POST /open', async () => {
    const { services: s, api, sync } = await services();
    api.on('POST', '/api/nutrition/open', { status: 200, body: STATE_QUALITATIVE });
    const state = await nutritionRepoFor(s).open();
    expect(state.effective_mode).toBe('qualitative');
    expect(sync.triggers).toContain('coach');
    expect(api.calls.map((c) => c.path)).toContain('/api/nutrition/open');
  });

  it('open hors ligne : NetworkRequiredError', async () => {
    const { services: s, api } = await services();
    api.setOffline('reject');
    await expect(nutritionRepoFor(s).open()).rejects.toBeInstanceOf(NetworkRequiredError);
  });

  it('screen : l’intention en attente part avant l’écran, la pesée de mise en place n’est pas écrite', async () => {
    const { services: s, api, db } = await services();
    await setMeta(db, 'nutritionPendingMode', { mode: 'qualitative', at: '2026-10-06T11:00:00.000Z' });
    api.on('PUT', '/api/nutrition/mode', { status: 200, body: STATE_QUALITATIVE });
    api.on('POST', '/api/nutrition/screen', { status: 200, body: STATE_QUALITATIVE });
    await nutritionRepoFor(s).screen({
      answers: { pregnancy: 'no', eating_disorder: 'no', medical: 'no' },
      mode: 'full',
      setup: {
        sex_for_calc: 'male',
        height_cm: 180,
        activity_level: 2,
        goal: 'maintain',
        weigh_in: { id: 'w-setup', date: '2026-10-06', weight_g: 80000 },
      },
    });
    const paths = api.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.indexOf('PUT /api/nutrition/mode')).toBeLessThan(
      paths.indexOf('POST /api/nutrition/screen'),
    );
    expect(await getMeta(db, 'nutritionPendingMode')).toBeUndefined();
    expect(await db.mirror('weigh_in').count()).toBe(0);
    expect(await db.table('outbox').count()).toBe(0);
  });

  it('screen : une erreur du socle reste une ApiError', async () => {
    const { services: s, api } = await services();
    api.on('POST', '/api/nutrition/screen', { status: 422, body: { error: 'mode_not_allowed' } });
    const error = await nutritionRepoFor(s)
      .screen({ answers: { pregnancy: 'no', eating_disorder: 'no', medical: 'no' }, mode: 'full' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'mode_not_allowed' });
  });

  it('saveSettings, preview, respond, markNonRepresentative, deleteData : bonnes routes', async () => {
    const { services: s, api } = await services();
    const repo = nutritionRepoFor(s);
    api.on('PUT', '/api/nutrition/settings', { status: 200, body: STATE_QUALITATIVE });
    api.on('POST', '/api/nutrition/checkins/:w/respond', { status: 200, body: STATE_QUALITATIVE });
    api.on('POST', '/api/nutrition/checkins/:w/non-representative', { status: 200, body: STATE_QUALITATIVE });
    api.on('DELETE', '/api/nutrition/data', { status: 200, body: STATE_QUALITATIVE });
    await repo.saveSettings({ goal: 'maintain' });
    await repo.respond('2026-09-28', 'accepted');
    await repo.markNonRepresentative('2026-09-28');
    await repo.deleteData();
    const calls = api.calls.filter((c) => c.path.startsWith('/api/nutrition'));
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['PUT', '/api/nutrition/settings', { goal: 'maintain' }],
      ['POST', '/api/nutrition/checkins/2026-09-28/respond', { response: 'accepted' }],
      ['POST', '/api/nutrition/checkins/2026-09-28/non-representative', {}],
      ['DELETE', '/api/nutrition/data', {}],
    ]);
  });

  it('preview : rend la cible de l’aperçu', async () => {
    const { services: s, api } = await services();
    const target = {
      bmr_kcal: 1700,
      tdee_kcal: 2300,
      kcal_target: 2200,
      kcal_min: 2100,
      kcal_max: 2300,
      protein_g_min: 130,
      protein_g_max: 175,
      fat_g_min: 50,
      carbs_g: 310,
      fiber_g: 30,
      water_ml: 2500,
      effective_goal: 'maintain',
      applied_rules: [],
      algo_version: 'nutri-1.0.0',
    };
    api.on('POST', '/api/nutrition/settings/preview', { status: 200, body: { target } });
    expect(await nutritionRepoFor(s).preview({ goal: 'maintain' })).toEqual(target);
    expect(api.calls.at(-1)?.body).toEqual({ changes: { goal: 'maintain' } });
  });
});

describe('nutritionRepo.sheets', () => {
  const sheet = (id: string, modes: string[]) => ({
    id,
    title: id,
    body_md: 'x',
    audience: 'all',
    visible_modes: modes,
    tags: [],
    sources: [],
    version: 1,
    reviewed_at: null,
  });

  it('200 : copie locale + ETag ; 304 : la copie ; hors ligne : la copie', async () => {
    const { services: s, api, db } = await services();
    await setMeta(db, 'nutritionEffectiveMode', 'qualitative');
    const list = [sheet('sleep', ['qualitative', 'full']), sheet('macros', ['full'])];
    api.on('GET', '/api/nutrition/sheets', {
      status: 200,
      body: list,
      headers: { ETag: '"v1-adults-qualitative"' },
    });
    const repo = nutritionRepoFor(s);
    expect((await repo.sheets()).map((x) => x.id)).toEqual(['sleep']);
    expect(await db.table('nutritionSheets').count()).toBe(1);
    api.on('GET', '/api/nutrition/sheets', { status: 304 });
    expect((await repo.sheets()).map((x) => x.id)).toEqual(['sleep']);
    expect(api.calls.at(-1)?.headers.get('If-None-Match')).toBe('"v1-adults-qualitative"');
    api.setOffline('reject');
    expect((await repo.sheets()).map((x) => x.id)).toEqual(['sleep']);
  });
});

describe('weighInRepo', () => {
  it('save : une pesée vivante par date, l’ancienne passe en tombstone avec une op delete', async () => {
    const { services: s, db } = await services();
    const repo = weighInRepoFor(s);
    const first = await repo.save({ date: '2026-10-05', weightG: 80000 });
    const second = await repo.save({ date: '2026-10-05', weightG: 79500 });
    expect(second).not.toBe(first);
    const live = (await db.mirror('weigh_in').toArray()).filter((r) => r.deletedAt == null);
    expect(live.map((r) => r.id)).toEqual([second]);
    const ops = await db.table('outbox').toArray();
    expect(ops.map((o) => `${o.kind}:${o.id}`).sort()).toEqual(
      [`create:${first}`, `create:${second}`, `delete:${first}`].sort(),
    );
    expect(ops.find((o) => o.id === second)?.fields).toEqual({ date: '2026-10-05', weightG: 79500 });
  });

  it('correct : un patch de weightG seul ; remove : un delete', async () => {
    const { services: s, db } = await services();
    const repo = weighInRepoFor(s);
    const id = await repo.save({ date: '2026-10-05', weightG: 80000 });
    await repo.correct(id, 80300);
    expect(await db.mirror('weigh_in').get(id)).toMatchObject({ weightG: 80300 });
    const patch = (await db.table('outbox').toArray()).find((o) => o.kind === 'patch');
    expect(patch?.fields).toEqual({ weightG: 80300 });
    await repo.remove(id);
    expect((await db.mirror('weigh_in').get(id))?.deletedAt).not.toBeNull();
    await expect(repo.correct(id, 80000)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('save : poids hors domaine, pas au pas de 100 g, date future ou impossible → WeighInError', async () => {
    const { services: s } = await services();
    const repo = weighInRepoFor(s);
    await expect(repo.save({ date: '2026-10-05', weightG: 29900 })).rejects.toBeInstanceOf(WeighInError);
    await expect(repo.save({ date: '2026-10-05', weightG: 80050 })).rejects.toMatchObject({ code: 'weight' });
    await expect(repo.save({ date: '2026-10-07', weightG: 80000 })).rejects.toMatchObject({ code: 'date' });
    await expect(repo.save({ date: '2026-02-30', weightG: 80000 })).rejects.toMatchObject({ code: 'date' });
  });

  it('hors du mode complet : save, correct et remove refusés (mode)', async () => {
    const { services: s, db } = await services();
    const repo = weighInRepoFor(s);
    const id = await repo.save({ date: '2026-10-05', weightG: 80000 });
    await setMeta(db, 'nutritionEffectiveMode', 'qualitative');
    await expect(repo.save({ date: '2026-10-04', weightG: 80000 })).rejects.toMatchObject({ code: 'mode' });
    await expect(repo.correct(id, 80100)).rejects.toMatchObject({ code: 'mode' });
    await expect(repo.remove(id)).rejects.toMatchObject({ code: 'mode' });
  });

  it('useWeighIns lit les pesées vivantes, la plus récente d’abord', async () => {
    const { services: s } = await services();
    const repo = weighInRepoFor(s);
    await repo.save({ date: '2026-10-03', weightG: 80000 });
    await repo.save({ date: '2026-10-05', weightG: 79000 });
    expect((await repo.list()).map((w) => w.date)).toEqual(['2026-10-05', '2026-10-03']);
  });
});
