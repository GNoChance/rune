import { afterEach, describe, expect, it } from 'vitest';
import { runTool } from '../../../src/coach/tools';
import { fullMember, seedTarget } from '../../nutrition/fixtures';
import { createTestContext, createUserAndLogin, type TestContext } from '../../support';
import { toolContext } from '../../support/coach';

/*
 * `open_nutrition_screen` (spec brique 5 §11.2) : l'écran des réglages nutrition que le coach propose d'ouvrir, avec
 * une suggestion facultative. Refus `not_available` ; un seul écran par tentative ; rien n'est écrit en base.
 */

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(o: { member?: boolean; goal?: 'lose' | 'maintain' | 'gain'; birthDate?: string } = {}) {
  ctx = await createTestContext({ now: '2026-11-05T10:00:00.000Z' });
  const u = await createUserAndLogin(ctx, o.birthDate === undefined ? {} : { birthDate: o.birthDate });
  if (o.member !== false) await fullMember(ctx, u.id, { goal: o.goal ?? 'maintain' });
  return { u, tc: toolContext(ctx, u.id) };
}

const notAvailable = { isError: true, result: { error: 'not_available' } };

describe('open_nutrition_screen', () => {
  it('mode full : { shown, screen }, un écran dans l’état avec sa suggestion, aucune écriture', async () => {
    const { tc } = await setup();
    const before = ctx.deps.sqlite.prepare('SELECT sync_counter FROM server_meta').get();
    const outcome = await runTool('open_nutrition_screen', { screen: 'goal', suggestion: 'gain' }, tc);
    expect(outcome).toEqual({ isError: false, result: { shown: true, screen: 'goal' } });
    expect(tc.state.nutritionScreens).toEqual([{ screen: 'goal', suggestion: 'gain' }]);
    expect(ctx.deps.sqlite.prepare('SELECT sync_counter FROM server_meta').get()).toEqual(before);
  });

  it('sans suggestion, et pour chacun des trois écrans', async () => {
    const { tc } = await setup();
    expect((await runTool('open_nutrition_screen', { screen: 'activity', suggestion: 3 }, tc)).isError).toBe(
      false,
    );
    expect(tc.state.nutritionScreens).toEqual([{ screen: 'activity', suggestion: 3 }]);
    const other = await setup();
    expect((await runTool('open_nutrition_screen', { screen: 'mode' }, other.tc)).isError).toBe(false);
    expect(other.tc.state.nutritionScreens).toEqual([{ screen: 'mode' }]);
  });

  it('goal et activity hors mode effectif full : not_available ; mode reste possible', async () => {
    const { tc } = await setup({ member: false });
    expect(await runTool('open_nutrition_screen', { screen: 'goal' }, tc)).toEqual(notAvailable);
    expect(await runTool('open_nutrition_screen', { screen: 'activity', suggestion: 2 }, tc)).toEqual(
      notAvailable,
    );
    expect(tc.state.nutritionScreens).toEqual([]);
    expect(await runTool('open_nutrition_screen', { screen: 'mode', suggestion: 'qualitative' }, tc)).toEqual(
      {
        isError: false,
        result: { shown: true, screen: 'mode' },
      },
    );
  });

  it('mineur : seul l’écran mode', async () => {
    const { tc } = await setup({ member: false, birthDate: '2010-01-01' });
    expect(await runTool('open_nutrition_screen', { screen: 'goal', suggestion: 'maintain' }, tc)).toEqual(
      notAvailable,
    );
    expect(await runTool('open_nutrition_screen', { screen: 'activity' }, tc)).toEqual(notAvailable);
    expect(
      (await runTool('open_nutrition_screen', { screen: 'mode', suggestion: 'disabled' }, tc)).isError,
    ).toBe(false);
  });

  it('suggestion lose : refusée pendant la pause de sécurité', async () => {
    const { u, tc } = await setup();
    ctx.deps.sqlite.prepare('UPDATE nutrition_profile SET safety_pause = 1 WHERE owner_id = ?').run(u.id);
    expect(await runTool('open_nutrition_screen', { screen: 'goal', suggestion: 'lose' }, tc)).toEqual(
      notAvailable,
    );
    expect(
      (await runTool('open_nutrition_screen', { screen: 'goal', suggestion: 'maintain' }, tc)).isError,
    ).toBe(false);
  });

  it('suggestion lose : refusée quand l’objectif effectif est imposé maintain', async () => {
    const { u, tc } = await setup({ goal: 'lose' });
    const target = await seedTarget(ctx, u.id, { validFrom: '2026-11-01', goal: 'maintain' });
    ctx.deps.sqlite
      .prepare('UPDATE nutrition_target SET applied_rules = ? WHERE id = ?')
      .run('["no_deficit_low_bmi"]', (target as { id: string }).id);
    expect(await runTool('open_nutrition_screen', { screen: 'goal', suggestion: 'lose' }, tc)).toEqual(
      notAvailable,
    );
  });

  it('suggestion lose : acceptée sans pause ni objectif imposé', async () => {
    const { tc } = await setup();
    expect(await runTool('open_nutrition_screen', { screen: 'goal', suggestion: 'lose' }, tc)).toEqual({
      isError: false,
      result: { shown: true, screen: 'goal' },
    });
  });

  it('un seul écran par tentative : le 2e appel est refusé, l’état garde le 1er', async () => {
    const { tc } = await setup();
    await runTool('open_nutrition_screen', { screen: 'goal' }, tc);
    expect(await runTool('open_nutrition_screen', { screen: 'mode' }, tc)).toEqual({
      isError: true,
      result: { error: 'already_shown' },
    });
    expect(tc.state.nutritionScreens).toEqual([{ screen: 'goal' }]);
  });

  it('suggestion qui ne correspond pas à l’écran, ou hors domaine : invalid_input', async () => {
    const { tc } = await setup();
    for (const input of [
      { screen: 'goal', suggestion: 2 },
      { screen: 'activity', suggestion: 'gain' },
      { screen: 'activity', suggestion: 5 },
      { screen: 'mode', suggestion: 'full' },
      { screen: 'weight' },
    ]) {
      expect(await runTool('open_nutrition_screen', input, tc), JSON.stringify(input)).toMatchObject({
        isError: true,
        result: { error: 'invalid_input' },
      });
    }
    expect(tc.state.nutritionScreens).toEqual([]);
  });
});
