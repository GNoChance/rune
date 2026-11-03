import { describe, expect, it } from 'vitest';
import { ageBandOn, ageOn, coachAgeBand, parisDate } from '../src/age';

describe('ageOn', () => {
  it('années révolues', () => {
    expect(ageOn('2000-06-15', '2018-06-14')).toBe(17);
    expect(ageOn('2000-06-15', '2018-06-15')).toBe(18);
    expect(ageOn('2010-10-07', '2026-10-06')).toBe(15);
  });

  it('29 février : anniversaire le 01/03 les années non bissextiles', () => {
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
  });

  it('dates invalides : RangeError', () => {
    expect(() => ageOn('2008-02-30', '2026-01-01')).toThrow(RangeError);
    expect(() => ageOn('2008-2-3', '2026-01-01')).toThrow(RangeError);
  });
});

describe('parisDate', () => {
  it("date civile à l'heure de Paris", () => {
    expect(parisDate(new Date('2026-03-31T22:30:00Z'))).toBe('2026-04-01');
    expect(parisDate(new Date('2026-03-31T21:30:00Z'))).toBe('2026-03-31');
    expect(parisDate(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
  });
});

describe('ageBandOn', () => {
  it('minor / adult à 18 ans', () => {
    expect(ageBandOn('2008-04-01', '2026-03-31')).toBe('minor');
    expect(ageBandOn('2008-04-01', '2026-04-01')).toBe('adult');
    expect(ageBandOn('2010-10-06', '2026-10-06')).toBe('minor');
  });
});

describe('public du coach', () => {
  it('né le 2008-11-04 : majeur le jour des 18 ans', () => {
    expect(ageBandOn('2008-11-04', '2026-11-03')).toBe('minor');
    expect(ageBandOn('2008-11-04', '2026-11-04')).toBe('adult');
  });
  it('né le 2008-02-29 : majeur le 01/03 en année non bissextile', () => {
    expect(ageBandOn('2008-02-29', '2026-02-28')).toBe('minor');
    expect(ageBandOn('2008-02-29', '2026-03-01')).toBe('adult');
  });
});

describe('tranche du coach', () => {
  it.each([
    ['2009-06-15', '17 ans', '16-17'],
    ['2008-11-04', 'la veille des 18 ans', '16-17'],
    ['2008-11-03', 'le jour des 18 ans', '18-29'],
    ['1996-11-04', '29 ans', '18-29'],
    ['1996-11-03', '30 ans', '30-39'],
    ['1986-11-03', '40 ans', '40-49'],
    ['1976-11-03', '50 ans', '50-59'],
    ['1966-11-04', '59 ans', '50-59'],
    ['1966-11-03', '60 ans', '60+'],
    ['1940-01-01', '86 ans', '60+'],
  ] as const)('né le %s (%s le 2026-11-03) : %s', (birth, _age, band) => {
    expect(coachAgeBand(birth, '2026-11-03')).toBe(band);
  });

  it('29 février : 18 ans le 01/03 en année non bissextile', () => {
    expect(coachAgeBand('2008-02-29', '2026-02-28')).toBe('16-17');
    expect(coachAgeBand('2008-02-29', '2026-03-01')).toBe('18-29');
  });
});
