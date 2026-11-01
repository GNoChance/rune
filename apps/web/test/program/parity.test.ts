/*
 * 05 §17.4 : le téléphone et le serveur rejouent le même historique avec la même fonction. Le résultat sous Node
 * (projet domain, `scenarios.test.ts`) est l'instantané `parity-history.replay.json` ; ici, le même rejeu sous
 * happy-dom doit lui être égal, valeur pour valeur.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARITY_SNAPSHOT, replayParityHistory } from '../../../../packages/domain/test/support/parity';

describe('parité du rejeu sous happy-dom', () => {
  it("tourne bien dans l'environnement du navigateur", () => {
    expect(typeof window).toBe('object');
  });

  it("donne exactement l'instantané du rejeu sous Node", () => {
    const expected: unknown = JSON.parse(readFileSync(PARITY_SNAPSHOT, 'utf8'));
    expect(replayParityHistory()).toEqual(expected);
  });
});
