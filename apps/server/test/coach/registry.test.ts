import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExchangeRegistry } from '../../src/coach/registry';
import { FakeClock } from '../support';

afterEach(() => {
  vi.useRealTimers();
});

const make = (timeoutMs = 180_000) => createExchangeRegistry(new FakeClock(), timeoutMs);

describe('registre des échanges', () => {
  it("un second begin du même membre rend null, celui d'un autre un bail", () => {
    const registry = make();
    const first = registry.begin('a');
    expect(first).not.toBeNull();
    expect(registry.begin('a')).toBeNull();
    expect(registry.begin('b')).not.toBeNull();
    expect(registry.inProgress('a')).toBe(true);
  });

  it('done libère le membre', () => {
    const registry = make();
    registry.begin('a')?.done();
    expect(registry.inProgress('a')).toBe(false);
    expect(registry.begin('a')).not.toBeNull();
  });

  it('abortFor aborte avec consent_withdrawn', () => {
    const registry = make();
    const lease = registry.begin('a');
    registry.abortFor('a', 'consent_withdrawn');
    expect(lease?.signal.aborted).toBe(true);
    expect(lease?.signal.reason).toBe('consent_withdrawn');
  });

  it('le délai de 180 000 ms aborte avec timeout', () => {
    vi.useFakeTimers();
    const registry = make(180_000);
    const lease = registry.begin('a');
    vi.advanceTimersByTime(179_999);
    expect(lease?.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(lease?.signal.reason).toBe('timeout');
  });

  it('abortAll aborte avec shutdown et attend un done différé de 500 ms', async () => {
    vi.useFakeTimers();
    const registry = make();
    const lease = registry.begin('a');
    let settled = false;
    const all = registry.abortAll('shutdown').then(() => {
      settled = true;
    });
    expect(lease?.signal.reason).toBe('shutdown');
    setTimeout(() => lease?.done(), 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await all;
    expect(settled).toBe(true);
    expect(registry.inProgress('a')).toBe(false);
  });

  it('abortAll rend la main à 2 s au plus sans done', async () => {
    vi.useFakeTimers();
    const registry = make();
    registry.begin('a');
    let settled = false;
    const all = registry.abortAll('shutdown').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await all;
    expect(settled).toBe(true);
  });

  it('abortAll sans échange rend la main aussitôt', async () => {
    await make().abortAll('shutdown');
  });

  it("begin pendant l'attente d'abortAll rend un bail déjà aborté shutdown, jamais null", async () => {
    vi.useFakeTimers();
    const registry = make();
    registry.begin('a');
    const all = registry.abortAll('shutdown');
    const late = registry.begin('b');
    expect(late?.signal.aborted).toBe(true);
    expect(late?.signal.reason).toBe('shutdown');
    late?.done();
    expect(registry.begin('a')?.signal.reason).toBe('shutdown');
    await vi.advanceTimersByTimeAsync(2000);
    await all;
  });

  it('begin après abortAll rend un bail déjà aborté shutdown, sans occuper le membre', async () => {
    const registry = make();
    await registry.abortAll('shutdown');
    const lease = registry.begin('a');
    expect(lease?.signal.reason).toBe('shutdown');
    expect(registry.inProgress('a')).toBe(false);
    expect(registry.begin('a')?.signal.reason).toBe('shutdown');
  });

  it("le bail reste en cours jusqu'au done, même après un délai dépassé ou un abortFor", () => {
    vi.useFakeTimers();
    const registry = make(1000);
    const first = registry.begin('a');
    vi.advanceTimersByTime(1000);
    expect(first?.signal.reason).toBe('timeout');
    expect(registry.inProgress('a')).toBe(true);
    expect(registry.begin('a')).toBeNull();
    first?.done();
    const second = registry.begin('a');
    registry.abortFor('a', 'consent_withdrawn');
    expect(registry.inProgress('a')).toBe(true);
    second?.done();
    expect(registry.inProgress('a')).toBe(false);
  });

  it('done efface le minuteur', () => {
    vi.useFakeTimers();
    const registry = make();
    registry.begin('a')?.done();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un double done est sans effet sur le bail suivant', () => {
    const registry = make();
    const first = registry.begin('a');
    first?.done();
    const second = registry.begin('a');
    first?.done();
    expect(registry.inProgress('a')).toBe(true);
    second?.done();
  });

  it('un second abortAll ne réattend pas les entrées déjà avortées', async () => {
    vi.useFakeTimers();
    const registry = make();
    registry.begin('a');
    const first = registry.abortAll('shutdown');
    await vi.advanceTimersByTimeAsync(2000);
    await first;
    let settled = false;
    const second = registry.abortAll('shutdown').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    await second;
  });

  it('abortFor puis abortAll attend le done différé de 500 ms', async () => {
    vi.useFakeTimers();
    const registry = make();
    const lease = registry.begin('a');
    registry.abortFor('a', 'consent_withdrawn');
    let settled = false;
    const all = registry.abortAll('shutdown').then(() => {
      settled = true;
    });
    setTimeout(() => lease?.done(), 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await all;
    expect(settled).toBe(true);
    expect(lease?.signal.reason).toBe('consent_withdrawn');
  });

  it('délai dépassé puis abortAll attend le done différé', async () => {
    vi.useFakeTimers();
    const registry = make(1000);
    const lease = registry.begin('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(lease?.signal.reason).toBe('timeout');
    let settled = false;
    const all = registry.abortAll('shutdown').then(() => {
      settled = true;
    });
    setTimeout(() => lease?.done(), 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await all;
    expect(settled).toBe(true);
  });

  it('un abortAll concurrent rend la même promesse et ne finit pas avant le premier', async () => {
    vi.useFakeTimers();
    const registry = make();
    const lease = registry.begin('a');
    const first = registry.abortAll('shutdown');
    const second = registry.abortAll('shutdown');
    expect(second).toBe(first);
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    lease?.done();
    await first;
    expect(settled).toBe(true);
  });

  it('après abortAll, plus aucun minuteur actif', async () => {
    vi.useFakeTimers();
    const registry = make();
    registry.begin('a');
    registry.begin('b')?.done();
    const all = registry.abortAll('shutdown');
    await vi.advanceTimersByTimeAsync(2000);
    await all;
    expect(vi.getTimerCount()).toBe(0);
  });
});
