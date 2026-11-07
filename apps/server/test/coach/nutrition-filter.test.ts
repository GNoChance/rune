import { afterEach, describe, expect, it } from 'vitest';
import { fakeText, fakeToolUse } from '../../src/ai';
import { nutritionModeOf } from '../../src/coach/nutrition-mode';
import { openTodayThread } from '../../src/coach/threads';
import { deleteNutritionData } from '../../src/nutrition/settings';
import { fullMember, seedTarget } from '../nutrition/fixtures';
import { insertFixtureRow } from '../support';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/*
 * Filtre et fil selon le mode nutrition (spec brique 5 §11.1 exception, §11.4) : `nutritionMode` et `nutritionFull`
 * sont lus sur le dossier du fil, jamais codés en dur ; la descente du mode ferme le fil au message suivant.
 */

let kit: ExchangeKit;
afterEach(() => kit?.ctx.close());

const IN_RANGE = 'Vise entre 2 100 et 2 300 kcal par jour.';
const OUT_OF_RANGE = 'Vise plutôt 1 800 kcal par jour.';
const FINE = 'Garde ton rythme actuel.';

async function fullKit(chat: Parameters<typeof exchangeKit>[0]['chat']) {
  kit = await exchangeKit({ chat });
  await fullMember(kit.ctx, kit.user.id);
  await seedTarget(kit.ctx, kit.user.id, { validFrom: '2026-11-01' });
  return kit;
}

const threads = () =>
  kit.rows('SELECT id, is_open, closed_reason, brief FROM coach_thread ORDER BY created_at, id');

describe('filtre selon le mode du fil', () => {
  it('full : « entre 2 100 et 2 300 kcal » passe, la valeur du dossier', async () => {
    await fullKit([fakeText(IN_RANGE)]);
    const { events } = await kit.ask('Combien dois-je manger ?');
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', replaced: false });
    expect(nutritionModeOf(threads()[0] as { brief: string })).toBe('full');
  });

  it('full : « 1 800 kcal », hors dossier, est bloqué puis remplacé par la réponse type', async () => {
    await fullKit([fakeText(OUT_OF_RANGE), fakeText(OUT_OF_RANGE)]);
    const { events } = await kit.ask('Combien dois-je manger ?');
    expect(events.map((e) => e.type)).toEqual(['retry', 'text', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', replaced: true });
  });

  it('hors full (aucun profil) : les kcal sont bloquées même au chiffre du dossier d’un autre jour', async () => {
    kit = await exchangeKit({ chat: [fakeText(IN_RANGE), fakeText(IN_RANGE)] });
    const { events } = await kit.ask('Combien dois-je manger ?');
    expect(events.at(-1)).toMatchObject({ type: 'done', replaced: true });
    expect(nutritionModeOf(threads()[0] as { brief: string })).toBe('disabled');
  });

  it('un dossier coach-brief/1 ou absent vaut disabled', () => {
    expect(nutritionModeOf({ brief: null })).toBe('disabled');
    expect(nutritionModeOf({ brief: 'pas du JSON' })).toBe('disabled');
    expect(nutritionModeOf({ brief: '{}' })).toBe('disabled');
  });
});

describe('descente du mode nutrition', () => {
  it('le message suivant ouvre un nouveau fil ; l’ancien est clos nutrition_mode_change', async () => {
    await fullKit([fakeText(FINE), fakeText(FINE)]);
    await kit.ask('Salut');
    const [first] = threads();
    expect(first).toMatchObject({ is_open: 1, closed_reason: null });
    kit.ctx.deps.sqlite.prepare("UPDATE nutrition_profile SET mode = 'qualitative'").run();

    await kit.ask('Et maintenant ?');
    const all = threads();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: first?.id, is_open: 0, closed_reason: 'nutrition_mode_change' });
    expect(all[1]).toMatchObject({ is_open: 1, closed_reason: null });
    expect(nutritionModeOf(all[1] as { brief: string })).toBe('qualitative');
  });

  it('un fil full dont le mode reste full n’est pas fermé', async () => {
    await fullKit([fakeText(FINE), fakeText(FINE)]);
    await kit.ask('Salut');
    await kit.ask('Encore');
    expect(threads()).toHaveLength(1);
    expect(threads()[0]).toMatchObject({ is_open: 1, closed_reason: null });
  });

  it('« Supprimer mes données nutrition » ferme le fil full du jour et retire les repères des dossiers stockés', async () => {
    await fullKit([fakeText(FINE), fakeText(FINE)]);
    await insertFixtureRow(kit.ctx.deps.db, 'nutrition_checkin', {
      ownerId: kit.user.id,
      weekStart: '2026-10-27',
      weighInCount: 3,
      meanWeightG: 80_000,
      changePct: -0.3,
      decision: 'in_band',
    });
    await kit.ask('Salut');
    const [first] = threads();
    const before = JSON.parse(String(first?.brief)) as { nutrition: Record<string, unknown> };
    expect(Object.keys(before.nutrition)).toEqual(
      expect.arrayContaining(['target', 'weekly_change', 'last_checkin']),
    );
    // Un fil d'un autre jour, clos, garde aussi son dossier : ses repères partent de même.
    await insertFixtureRow(kit.ctx.deps.db, 'coach_thread', {
      userId: kit.user.id,
      day: '2026-11-04',
      isOpen: 0,
      closedReason: 'day_over',
      briefSchema: 'coach-brief/2',
      brief: first?.brief,
    });

    await deleteNutritionData(kit.ctx.deps, kit.user);

    const all = threads();
    const closed = all.find((t) => t.id === first?.id);
    expect(closed).toMatchObject({ is_open: 0, closed_reason: 'nutrition_mode_change' });
    for (const t of all) {
      const { nutrition } = JSON.parse(String(t.brief)) as { nutrition: Record<string, unknown> };
      expect(nutrition).toEqual({
        mode: 'full',
        directives: before.nutrition.directives,
        sheets: before.nutrition.sheets,
      });
    }
    // Les messages déjà écrits restent (« Supprimer mes conversations » existe).
    expect(kit.rows('SELECT id FROM coach_message WHERE thread_id = ?', String(first?.id))).toHaveLength(2);

    await kit.ask('Et maintenant ?');
    const reopened = threads().find((t) => t.is_open === 1);
    expect(reopened?.id).not.toBe(first?.id);
    expect(JSON.parse(String(reopened?.brief)).nutrition.target).toBeUndefined();
  });

  it('un fil non full n’est pas fermé par une montée en full', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE), fakeText(FINE)] });
    await kit.ask('Salut');
    await fullMember(kit.ctx, kit.user.id);
    await openTodayThread(kit.ctx.deps, kit.user.id, kit.ctx.clock.now());
    expect(threads()).toHaveLength(1);
    expect(threads()[0]).toMatchObject({ is_open: 1, closed_reason: null });
  });
});

describe('bouton des réglages nutrition', () => {
  const OPEN = fakeToolUse('t1', 'open_nutrition_screen', { screen: 'goal', suggestion: 'maintain' });

  it('l’événement nutrition_screen part une fois, après le texte, avec une réponse enregistrée', async () => {
    await fullKit([OPEN, fakeText(FINE)]);
    const { events } = await kit.ask('Je voudrais changer d’objectif.');
    expect(events.map((e) => e.type)).toEqual(['tool_running', 'text', 'nutrition_screen', 'done']);
    expect(events.find((e) => e.type === 'tool_running')).toEqual({
      type: 'tool_running',
      tool: 'open_nutrition_screen',
    });
    expect(events.find((e) => e.type === 'nutrition_screen')).toEqual({
      type: 'nutrition_screen',
      screen: 'goal',
      suggestion: 'maintain',
    });
  });

  it('réponse remplacée après deux blocages : aucun bouton', async () => {
    await fullKit([OPEN, fakeText(OUT_OF_RANGE), OPEN, fakeText(OUT_OF_RANGE)]);
    const { events } = await kit.ask('Je voudrais changer d’objectif.');
    expect(events.some((e) => e.type === 'nutrition_screen')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done', replaced: true });
  });

  it('outil refusé (hors full) : résultat not_available, aucun bouton', async () => {
    kit = await exchangeKit({ chat: [OPEN, fakeText(FINE)] });
    const { events } = await kit.ask('Je voudrais changer d’objectif.');
    expect(events.some((e) => e.type === 'nutrition_screen')).toBe(false);
    expect(JSON.stringify(kit.fake.chatCalls[1]?.messages.at(-1))).toContain('not_available');
  });
});
