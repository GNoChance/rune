import { describe, expect, it } from 'vitest';
import { preselectActivity, preselectGoal } from '../../src/nutrition';

describe('preselectGoal', () => {
  it('fat_loss', () => {
    expect(preselectGoal('fat_loss', 175, 80000)).toBe('lose');
    expect(preselectGoal('fat_loss', 160, 47000)).toBe('maintain');
  });
  it('muscle', () => expect(preselectGoal('muscle', 175, 80000)).toBe('gain'));
  it.each(['strength', 'fitness', 'sport_support', null] as const)('%s', (g) => {
    expect(preselectGoal(g, 175, 80000)).toBe('maintain');
  });
});

describe('preselectActivity', () => {
  it('selon le sport', () => {
    expect(preselectActivity('running')).toBe(3);
    expect(preselectActivity(null)).toBe(2);
  });
});
