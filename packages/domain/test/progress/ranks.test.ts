import { describe, expect, it } from 'vitest';
import { progressSummary, rankUps } from '../../src/progress/ranks';
import { ex, session, sets, sheet, wset } from './helpers';

const catalog = [
  sheet('bench', ['chest'], ['triceps']),
  sheet('dip', ['triceps'], ['chest', 'front_delts']),
  sheet('curl', ['biceps', 'forearms']),
];
/** Séances de bench dont l'XP totale vaut exactement `xp` (multiple de 10). */
const xpSessions = (xp: number) => {
  const full = Math.floor(xp / 300);
  const out = Array.from({ length: full }, () => session([ex('bench', sets(28))]));
  const rest = xp - full * 300;
  if (rest > 0) out.push(session([ex('bench', sets((rest - 20) / 10))]));
  return out;
};

describe('rang global', () => {
  it('990 XP : E ; 1 000 : D, suivant C à 5 000', () => {
    const a = progressSummary(xpSessions(990), catalog);
    expect(a.xp).toBe(990);
    expect(a.rank).toBe('E');
    const b = progressSummary(xpSessions(1000), catalog);
    expect(b.xp).toBe(1000);
    expect(b.rank).toBe('D');
    expect(b.nextRank).toBe('C');
    expect(b.nextRankXp).toBe(5000);
  });
  it('rang S : pas de suivant', () => {
    const s = progressSummary(xpSessions(60000), catalog);
    expect(s.rank).toBe('S');
    expect(s.nextRank).toBeNull();
    expect(s.nextRankXp).toBeNull();
  });
});

describe('groupes', () => {
  it('principal 1, secondaire seul 0,5, au plus 1 par groupe', () => {
    const s = progressSummary([session([ex('bench', sets(2)), ex('dip', sets(2))])], catalog);
    // bench : chest 1, arms 0,5 ; dip : arms 1, chest 0,5, shoulders 0,5
    expect(s.groups.chest.sets).toBe(2 + 1);
    expect(s.groups.arms.sets).toBe(1 + 2);
    expect(s.groups.shoulders.sets).toBe(1);
    expect(s.groups.back.sets).toBe(0);
  });
  it('principal et secondaire dans le même groupe : 1', () => {
    const c = [sheet('x', ['biceps'], ['triceps'])];
    expect(progressSummary([session([ex('x', sets(1))])], c).groups.arms.sets).toBe(1);
  });
  it('19,5 séries : E ; 20 : D', () => {
    const c = [sheet('x', [], ['chest'])];
    const g = (n: number) => progressSummary([session([ex('x', sets(n))])], c).groups.chest;
    expect(g(39)).toEqual({ sets: 19.5, rank: 'E' });
    expect(g(40)).toEqual({ sets: 20, rank: 'D' });
  });
  it('paire unilatérale = 1 série ; échauffements et exercice inconnu ignorés', () => {
    const h = [
      session([
        ex('bench', [wset({ side: 'left' }), wset({ side: 'right' }), wset({ kind: 'warmup' })]),
        ex('inconnu', sets(3)),
      ]),
    ];
    expect(progressSummary(h, catalog).groups.chest.sets).toBe(1);
  });
});

describe('compteurs', () => {
  it('tonnage 60 kg x 6 x 3 = 1 080 000 g', () => {
    const h = [session([ex('bench', sets(3, { loadG: 60000, reps: 6 }))])];
    expect(progressSummary(h, catalog).tonnageG).toBe(1_080_000);
  });
  it('séances terminées seulement', () => {
    const h = [session([ex('bench', sets(1))]), session([ex('bench', sets(1))], { status: 'abandoned' })];
    const s = progressSummary(h, catalog);
    expect(s.sessions).toBe(1);
    expect(s.xp).toBe(30);
  });
  it('assiduité : dimanche 23 h 30 et lundi 0 h 30 (Paris) = 2 semaines', () => {
    // 2026-01-04 est un dimanche ; 22:30Z = 23:30 Paris ; 23:30Z = 00:30 le lundi
    const h = [
      session([], { startedAt: Date.UTC(2026, 0, 4, 22, 30) }),
      session([], { startedAt: Date.UTC(2026, 0, 4, 23, 30) }),
    ];
    expect(progressSummary(h, catalog).assiduityWeeks).toBe(2);
  });
  it('même semaine = 1', () => {
    const h = [
      session([], { startedAt: Date.UTC(2026, 0, 5, 10) }),
      session([], { startedAt: Date.UTC(2026, 0, 9, 10) }),
    ];
    expect(progressSummary(h, catalog).assiduityWeeks).toBe(1);
  });
});

describe('rankUps', () => {
  it('détecte les montées', () => {
    const before = progressSummary(xpSessions(990), catalog);
    const after = progressSummary(xpSessions(1000), catalog);
    const up = rankUps(before, after);
    expect(up.global).toBe('D');
    expect(rankUps(after, after)).toEqual({ global: null, groups: [] });
  });
  it('rang de groupe', () => {
    const c = [sheet('x', ['chest'])];
    const a = progressSummary([session([ex('x', sets(19))])], c);
    const b = progressSummary([session([ex('x', sets(20))])], c);
    expect(rankUps(a, b).groups).toEqual(['chest']);
  });
});
