import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeText } from '../../src/ai';
import { openTodayThread, todayThread } from '../../src/coach/threads';
import { coachStatus, coachThread, coachThreads, coachToday } from '../../src/coach/views';
import { insertFixtureRow } from '../support';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/*
 * Un seul fil ouvert par jour (spec brique 4.1 §4.4) : un changement de coach ferme le fil du jour (`persona_change`)
 * au premier regard qui suit, le message suivant en ouvre un autre le même jour ; un échange en cours finit dans son
 * fil. La limite du jour compte tous les fils.
 */

const FINE = 'Garde ton rythme actuel.';
let kit: ExchangeKit;
afterEach(() => kit?.ctx.close());

const threads = () =>
  kit.rows('SELECT id, persona, is_open, closed_reason FROM coach_thread ORDER BY created_at, id');
const now = () => kit.ctx.clock.now();
const today = () => coachToday(kit.ctx.deps.db, kit.ctx.deps, kit.user.id, now());

/** Choisit la voix `coach` dans le profil d'entraînement de la personne (crée le profil au besoin). */
async function pickCoach(coach: 'ombre' | 'skald' | 'scribe'): Promise<void> {
  const { sqlite, db } = kit.ctx.deps;
  const has = sqlite.prepare('SELECT 1 FROM training_profile WHERE owner_id = ?').get(kit.user.id);
  if (has === undefined) await insertFixtureRow(db, 'training_profile', { ownerId: kit.user.id, coach });
  else sqlite.prepare('UPDATE training_profile SET coach = ? WHERE owner_id = ?').run(coach, kit.user.id);
}

describe('changement de coach', () => {
  it("le message qui suit ouvre un nouveau fil à la nouvelle voix ; l'ancien reste lisible", async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE), fakeText(FINE)] });
    await kit.ask('Salut.');
    await pickCoach('skald');
    const { events } = await kit.ask('Encore moi.');

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const [first, second] = threads();
    expect(first).toMatchObject({ persona: 'scribe', is_open: 0, closed_reason: 'persona_change' });
    expect(second).toMatchObject({ persona: 'skald', is_open: 1, closed_reason: null });
    const view = await today();
    expect(view.thread).toMatchObject({ id: second?.id, persona: 'skald', open: true });
    expect(view.messages.map((m) => m.text)).toEqual(['Encore moi.', FINE]);
    const old = await coachThread(kit.ctx.deps.db, kit.user.id, first?.id as string);
    expect(old.messages.map((m) => m.text)).toEqual(['Salut.', FINE]);
    expect((await coachThreads(kit.ctx.deps.db, kit.ctx.deps, kit.user.id, now())).threads).toHaveLength(2);
  });

  it('GET du jour : ferme le fil périmé sans en ouvrir un autre', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('Salut.');
    await pickCoach('ombre');
    const view = await today();
    expect(view.thread).toMatchObject({ open: false, closedReason: 'persona_change', persona: 'scribe' });
    expect(view.messages).toHaveLength(2);
    expect(threads()).toHaveLength(1);
    // Une seconde lecture ne change rien.
    expect((await today()).thread?.closedReason).toBe('persona_change');
    const status = await coachStatus(kit.ctx.deps.db, kit.ctx.deps, kit.user.id, now());
    expect(status.today.open).toBe(true);
  });

  it('sans changement de voix, le fil reste ouvert', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('Salut.');
    expect((await today()).thread?.open).toBe(true);
    expect(threads()).toHaveLength(1);
  });

  it('deux appareils : un seul fil ouvert', async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('Salut.');
    await pickCoach('skald');
    const [a, b] = await Promise.all([
      openTodayThread(kit.ctx.deps, kit.user.id, now()),
      openTodayThread(kit.ctx.deps, kit.user.id, now()),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.persona).toBe('skald');
    expect(threads().filter((t) => t.is_open === 1)).toHaveLength(1);
    expect(threads()).toHaveLength(2);
    expect((await todayThread(kit.ctx.deps.db, kit.user.id, '2026-11-05'))?.id).toBe(a.id);
  });

  it("pendant un échange : le fil reste ouvert, l'échange s'enregistre, le suivant ouvre le nouveau fil", async () => {
    const gate = Promise.withResolvers<void>();
    kit = await exchangeKit({ chat: [fakeText(FINE, { gate: gate.promise }), fakeText(FINE)] });
    const run = await kit.begin('Salut.');
    await vi.waitFor(() => expect(kit.fake.chatCalls.length).toBe(1));
    await pickCoach('skald');

    const during = await today();
    expect(during.inProgress).toBe(true);
    expect(during.thread).toMatchObject({ open: true, closedReason: null });
    gate.resolve();
    await run.finished;

    expect(run.events.at(-1)).toMatchObject({ type: 'done' });
    expect(kit.rows('SELECT role FROM coach_message ORDER BY seq')).toEqual([
      { role: 'user' },
      { role: 'assistant' },
    ]);
    expect(threads()).toHaveLength(1);
    expect((await today()).thread).toMatchObject({ open: false, closedReason: 'persona_change' });

    await kit.ask('Et maintenant ?');
    expect(threads().map((t) => [t.persona, t.is_open])).toEqual([
      ['scribe', 0],
      ['skald', 1],
    ]);
  });

  it("fermé par persona_change juste après le bail : l'échange commencé avant s'enregistre quand même", async () => {
    const gate = Promise.withResolvers<void>();
    kit = await exchangeKit({ chat: [fakeText(FINE, { gate: gate.promise })] });
    const run = await kit.begin('Salut.');
    await vi.waitFor(() => expect(kit.fake.chatCalls.length).toBe(1));
    kit.ctx.deps.sqlite.exec("UPDATE coach_thread SET is_open = 0, closed_reason = 'persona_change'");
    gate.resolve();
    await run.finished;
    expect(run.events.at(-1)).toMatchObject({ type: 'done' });
    expect(kit.rows('SELECT role FROM coach_message')).toHaveLength(2);
  });
});

describe('autres fermetures', () => {
  it("version_change : un nouveau fil s'ouvre le même jour, un doublon reste refusé", async () => {
    kit = await exchangeKit({ chat: [fakeText(FINE), fakeText(FINE)] });
    const id = '019a5e00-0000-7000-8000-0000000000f1';
    await kit.ask('Salut.', { clientMessageId: id });
    kit.ctx.deps.coachConfig = { ...kit.ctx.deps.coachConfig, toolsVersion: 'tools-2' };
    await expect(kit.ask('Salut.', { clientMessageId: id })).rejects.toMatchObject({
      code: 'duplicate_message',
      extra: { seq: 1 },
    });
    await kit.ask('Autre.');
    expect(threads().map((t) => [t.is_open, t.closed_reason])).toEqual([
      [0, 'version_change'],
      [1, null],
    ]);
  });

  it.each(['health_withdrawn', 'day_over'])("%s : fermé jusqu'à demain", async (reason) => {
    kit = await exchangeKit({ chat: [fakeText(FINE)] });
    await kit.ask('Salut.');
    kit.ctx.deps.sqlite.exec(`UPDATE coach_thread SET is_open = 0, closed_reason = '${reason}'`);
    await pickCoach('skald');
    await expect(kit.ask('Encore.')).rejects.toMatchObject({ code: 'thread_closed', extra: { reason } });
    expect(threads()).toHaveLength(1);
    expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false);
    expect((await today()).thread).toMatchObject({ open: false, closedReason: reason });
  });
});

describe('limite du jour', () => {
  it('compte les messages de tous les fils du jour', async () => {
    kit = await exchangeKit({
      chat: [fakeText(FINE), fakeText(FINE), fakeText(FINE), fakeText(FINE)],
      coachConfig: (c) => ({ ...c, limits: { ...c.limits, messagesPerDay: 3 } }),
    });
    await kit.ask('Un.');
    await pickCoach('skald');
    const second = await kit.ask('Deux.');
    expect(second.events.at(-1)).toMatchObject({ type: 'done', remainingToday: 1 });
    await pickCoach('ombre');
    const third = await kit.ask('Trois.');
    expect(third.events.at(-1)).toMatchObject({ type: 'done', remainingToday: 0 });
    expect(threads()).toHaveLength(3);
    await expect(kit.ask('Quatre.')).rejects.toMatchObject({ code: 'daily_limit_reached' });
    const status = await coachStatus(kit.ctx.deps.db, kit.ctx.deps, kit.user.id, now());
    expect(status.today.remaining).toBe(0);
  });
});
