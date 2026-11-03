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
});
