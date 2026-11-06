import { AI_COACH_CONSENT_TEXT } from '@rune/contracts';
import { buildCoachBrief } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBriefInput } from '../../src/coach/brief-input';
import { openTodayThread } from '../../src/coach/threads';
import { coachBrief } from '../../src/coach/views';
import { seedOrMergeAdviceSheets } from '../../src/nutrition/advice-loader';
import { grantConsent } from '../../src/privacy/consent';
import { adviceFile } from '../nutrition/advice-fixtures';
import { fullMember, seedTarget, seedWeighIns } from '../nutrition/fixtures';
import { createTestContext, createUserAndLogin, insertFixtureRow, type TestContext } from '../support';

/*
 * Bloc `nutrition` du dossier `coach-brief/2` rassemblé par le serveur (brique 5 §11.1) : mode effectif, fiches
 * servies, repères et bilans en mode `full` seulement, rien de C2 sans accord santé, relecture d'un fil `coach-brief/1`.
 */

// Lundi 9 novembre 2026, Paris.
const NOW = '2026-11-09T09:00:00.000Z';
let ctx: TestContext;
afterEach(() => ctx?.close());

const FILES = [
  adviceFile('tous', { audience: 'all' }),
  adviceFile('adulte', { audience: 'adults', visible_modes: ['full', 'qualitative'] }),
  adviceFile('mineur', { audience: 'minors', visible_modes: ['qualitative'] }),
  adviceFile('complet', { audience: 'adults', visible_modes: ['full'] }),
];

async function boot() {
  ctx = await createTestContext({ now: NOW });
  await ctx.deps.db.transaction().execute((trx) => seedOrMergeAdviceSheets(trx, FILES, NOW));
  await ctx.deps.db.updateTable('adviceSheet').set({ status: 'published', publishedAt: NOW }).execute();
}

const grantCoach = (userId: string) =>
  grantConsent(ctx.deps.db, ctx.deps, userId, 'ai_coach', AI_COACH_CONSENT_TEXT.version, null);
const nutritionOf = async (userId: string) =>
  buildCoachBrief(await loadBriefInput(ctx.deps.db, ctx.deps, userId, ctx.clock.now())).brief.nutrition;
const adult = () => createUserAndLogin(ctx, { birthDate: '1990-01-01' });

describe('dossier coach-brief/2 : nutrition côté serveur', () => {
  it('sans profil nutrition : mode disabled, aucune fiche', async () => {
    await boot();
    const u = await adult();
    expect(await nutritionOf(u.id)).toEqual({
      mode: 'disabled',
      directives: ['no_deficit', 'no_numbers'],
      sheets: [],
    });
  });

  it('mode full : fiches du filtre de /sheets, cible, 4 dernières semaines comptées, dernier bilan', async () => {
    await boot();
    const u = await adult();
    await grantCoach(u.id);
    await fullMember(ctx, u.id, { goal: 'lose' });
    await seedTarget(ctx, u.id, { validFrom: '2026-11-06', goal: 'lose' });
    await seedWeighIns(ctx, u.id, [['2026-10-12', 82_000]]);
    const weeks = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];
    for (const [i, weekStart] of weeks.entries()) {
      await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
        ownerId: u.id,
        weekStart,
        weighInCount: weekStart === '2026-10-19' ? 0 : 3,
        meanWeightG: 82_000,
        changePct: i === 1 ? null : -0.5 - i / 10,
        representative: 1,
        decision: i === 5 ? 'proposal' : 'in_band',
        proposedDeltaKcal: i === 5 ? -100 : null,
        response: i === 5 ? 'declined' : null,
      });
    }
    const n = await nutritionOf(u.id);
    expect(n.mode).toBe('full');
    expect(n.directives).toEqual([]);
    expect(n.sheets.map((s) => s.id)).toEqual(['adulte', 'complet', 'tous']);
    expect(n.target).toMatchObject({
      energy_kcal: 2200,
      protein_min_g: 130,
      fat_min_g: 50,
      effective_goal: 'lose',
      days_ago: 3,
    });
    // Semaine du 19 octobre sans pesée : non comptée ; la plus ancienne (28 septembre) sort des 4 dernières.
    expect(n.weekly_change).toEqual([
      { weeks_ago: 1, change_pct: -1 },
      { weeks_ago: 2, change_pct: -0.9 },
      { weeks_ago: 4, change_pct: -0.7 },
      { weeks_ago: 5, change_pct: null },
    ]);
    expect(n.last_checkin).toEqual({
      weeks_ago: 1,
      decision: 'proposal',
      proposed_delta_kcal: -100,
      response: 'declined',
    });
  });

  it('accord coach sans accord santé : mode effectif non full, donc ni cible ni bilan', async () => {
    await boot();
    const u = await adult();
    await grantCoach(u.id);
    await insertFixtureRow(ctx.deps.db, 'nutrition_state', { fullOpen: 1 });
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', {
      ownerId: u.id,
      mode: 'full',
      modeReason: 'choice',
      safetyScreenVersion: 1,
      safetyScreenAt: NOW,
    });
    await seedTarget(ctx, u.id, { validFrom: '2026-11-06' });
    const n = await nutritionOf(u.id);
    expect(n.mode).not.toBe('full');
    expect(n).not.toHaveProperty('target');
    expect(n).not.toHaveProperty('weekly_change');
    expect(n).not.toHaveProperty('last_checkin');
    expect(n.directives).toContain('no_numbers');
  });

  it('safety_pause : no_deficit même avec un objectif lose', async () => {
    await boot();
    const u = await adult();
    await grantCoach(u.id);
    await fullMember(ctx, u.id, { goal: 'lose' });
    await seedTarget(ctx, u.id, { validFrom: '2026-11-06', goal: 'lose' });
    await ctx.deps.db.updateTable('nutritionProfile').set({ safetyPause: 1 }).execute();
    expect((await nutritionOf(u.id)).directives).toEqual(['no_deficit']);
  });

  it('mineur : les trois directives, fiches des mineurs, aucun repère', async () => {
    await boot();
    const u = await createUserAndLogin(ctx, { birthDate: '2010-03-01' });
    await grantCoach(u.id);
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', {
      ownerId: u.id,
      mode: 'qualitative',
      modeReason: 'choice',
    });
    const n = await nutritionOf(u.id);
    expect(n.directives).toEqual(['minor_profile', 'no_deficit', 'no_numbers']);
    expect(n.sheets.map((s) => s.id)).toEqual(['mineur', 'tous']);
    expect(n).not.toHaveProperty('target');
  });

  it('le dossier du fil ne contient jamais pesée, taille, sexe, mode_reason, bmr ni tdee', async () => {
    await boot();
    const u = await adult();
    await grantCoach(u.id);
    await fullMember(ctx, u.id, { goal: 'lose' });
    await seedTarget(ctx, u.id, { validFrom: '2026-11-06', goal: 'lose', refWeightG: 81_200 });
    await seedWeighIns(ctx, u.id, [['2026-11-02', 81_200]]);
    const thread = await openTodayThread(ctx.deps, u.id, ctx.clock.now());
    const json = thread.brief ?? '';
    expect(json).toContain('"energy_kcal"');
    for (const banned of [
      'weight_g',
      'height_cm',
      'sex_for_calc',
      'mode_reason',
      'bmr_kcal',
      'tdee_kcal',
      '81200',
      '1780',
      '2759',
    ]) {
      expect(json, banned).not.toContain(banned);
    }
  });

  it('un fil coach-brief/1 déjà stocké (nutrition: null) se relit sans erreur', async () => {
    await boot();
    const u = await adult();
    const v2 = JSON.parse(
      buildCoachBrief(await loadBriefInput(ctx.deps.db, ctx.deps, u.id, ctx.clock.now())).json,
    ) as Record<string, unknown>;
    const stored = JSON.stringify({ ...v2, schema: 'coach-brief/1', nutrition: null });
    await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: u.id,
      day: '2026-11-09',
      persona: 'scribe',
      briefSchema: 'coach-brief/1',
      brief: stored,
    });
    const response = await coachBrief(ctx.deps.db, ctx.deps, u.id, ctx.clock.now());
    expect(response.preview).toBe(false);
    expect(response.brief).toMatchObject({ schema: 'coach-brief/1', nutrition: null });
  });
});
