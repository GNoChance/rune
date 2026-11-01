import { describe, expect, it } from 'vitest';
import { RANKS } from '../../src/progress/rules';
import { sessionXp } from '../../src/progress/xp';
import { ex, session, sets, wset } from './helpers';

describe('sessionXp', () => {
  it('15 séries de travail, 6 exercices avec effort : 200 XP', () => {
    const exs = [
      ...Array.from({ length: 5 }, (_, i) => ex(`x${i}`, sets(2, { effort: 'ok' }))),
      ex('x5', sets(5, { effort: 'hard' })),
    ];
    expect(sessionXp(session(exs))).toBe(200);
  });
  it('40 séries : plafond à 300', () => {
    expect(sessionXp(session([ex('a', sets(40))]))).toBe(300);
  });
  it('séance abandonnée : 0', () => {
    expect(sessionXp(session([ex('a', sets(10))], { status: 'abandoned' }))).toBe(0);
  });
  it('échauffements et séries non faites ignorés', () => {
    const s = session([ex('a', [wset({ kind: 'warmup' }), wset({ loggedAt: null }), wset()])]);
    expect(sessionXp(s)).toBe(10 + 20);
  });
  it('paire unilatérale = 1 série', () => {
    const s = session([ex('a', [wset({ side: 'left' }), wset({ side: 'right' })])]);
    expect(sessionXp(s)).toBe(10 + 20);
  });
  it('5 XP seulement si la dernière série de travail porte un effort', () => {
    const s = session([ex('a', [wset({ effort: 'ok' }), wset()])]);
    expect(sessionXp(s)).toBe(20 + 20);
  });
  it('RANKS', () => expect(RANKS).toEqual(['E', 'D', 'C', 'B', 'A', 'S']));
});
