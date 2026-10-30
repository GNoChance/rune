/*
 * 04 §13 critère 3 : la suite de `substitutes` tourne sous Node (projet domain) et dans l'environnement du
 * navigateur. L'import rejoue ici les mêmes tableaux de cas et propriétés, sous happy-dom (projet web).
 */
import { describe, expect, it } from 'vitest';
import '../../../packages/domain/test/catalog/substitutes.test';

describe('parité de packages/domain sous happy-dom', () => {
  it("tourne bien dans l'environnement du navigateur", () => {
    expect(typeof window).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });
});
