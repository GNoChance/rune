import { describe, expect, it } from 'vitest';
import { screenOutcome } from '../../src/nutrition';

const no = { pregnancy: 'no', eating_disorder: 'no', medical: 'no' } as const;

describe('screenOutcome', () => {
  it('trois non', () => {
    expect(screenOutcome(no)).toEqual({
      allowedModes: ['full', 'qualitative', 'disabled'],
      reason: 'choice',
      orientations: [],
    });
  });
  it('Q1 oui', () => {
    expect(screenOutcome({ ...no, pregnancy: 'yes' })).toEqual({
      allowedModes: ['qualitative', 'disabled'],
      reason: 'safety',
      orientations: ['midwife', 'doctor'],
    });
  });
  it('Q2 oui', () => {
    expect(screenOutcome({ ...no, eating_disorder: 'yes' })).toEqual({
      allowedModes: ['qualitative', 'disabled'],
      reason: 'safety',
      orientations: ['eating_disorder_line'],
    });
  });
  it('Q3 oui', () => {
    expect(screenOutcome({ ...no, medical: 'yes' })).toEqual({
      allowedModes: ['qualitative', 'disabled'],
      reason: 'safety',
      orientations: ['doctor', 'dietitian'],
    });
  });
  it.each(['pregnancy', 'eating_disorder', 'medical'] as const)('prefer_not sur %s', (k) => {
    expect(screenOutcome({ ...no, [k]: 'prefer_not' })).toEqual({
      allowedModes: ['qualitative', 'disabled'],
      reason: 'safety',
      orientations: [],
    });
  });
  it('orientations réunies sans doublon', () => {
    expect(screenOutcome({ pregnancy: 'yes', eating_disorder: 'yes', medical: 'no' }).orientations).toEqual([
      'midwife',
      'doctor',
      'eating_disorder_line',
    ]);
    expect(screenOutcome({ pregnancy: 'yes', eating_disorder: 'no', medical: 'yes' }).orientations).toEqual([
      'midwife',
      'doctor',
      'dietitian',
    ]);
  });
});
