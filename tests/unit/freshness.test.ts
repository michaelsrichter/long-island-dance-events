import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshnessKey, pagesNow, remember } from '../../src/lib/freshness';

const g = globalThis as { __liLive?: boolean; __liDataVersion?: string | number; __liPagesNow?: string };

afterEach(() => {
  delete g.__liLive;
  delete g.__liDataVersion;
  delete g.__liPagesNow;
  delete process.env.BUILD_NOW;
  vi.useRealTimers();
});

describe('freshness (live server caches, decision P58)', () => {
  it('lasts for the whole static build', async () => {
    let made = 0;
    const get = remember(async () => ++made);
    process.env.BUILD_NOW = '2026-10-05T12:00:00Z';
    expect(await get()).toBe(1);
    process.env.BUILD_NOW = '2026-10-09T12:00:00Z';
    expect(await get()).toBe(1);
    expect(freshnessKey()).toBe('build');
  });

  it('on the live server, starts again when a new day starts on Long Island or the data changes', async () => {
    g.__liLive = true;
    let made = 0;
    const get = remember(async () => ++made);
    process.env.BUILD_NOW = '2026-10-06T03:30:00Z'; // 11:30 PM Oct 5 in New York
    expect(await get()).toBe(1);
    process.env.BUILD_NOW = '2026-10-06T03:59:00Z';
    expect(await get()).toBe(1);
    process.env.BUILD_NOW = '2026-10-06T04:01:00Z'; // just after midnight in New York
    expect(await get()).toBe(2);
    g.__liDataVersion = 7;
    expect(await get()).toBe(3);
    expect(freshnessKey()).toBe('7|2026-10-06');
  });

  it('tries again after a failure', async () => {
    let calls = 0;
    const get = remember(async () => {
      calls++;
      if (calls === 1) throw new Error('database busy');
      return 'ok';
    });
    await expect(get()).rejects.toThrow('database busy');
    expect(await get()).toBe('ok');
  });
  it('gives every page of the same data and day one "now": when that period began (P62)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T20:22:00Z')); // 4:22 PM in New York
    g.__liLive = true;
    g.__liDataVersion = 3;
    const first = pagesNow();
    expect(first.toISOString()).toBe('2026-10-06T20:22:00.000Z');
    expect(g.__liPagesNow).toBe('2026-10-06T20:22:00.000Z');
    vi.setSystemTime(new Date('2026-10-07T01:00:00Z')); // 9 PM, same day in New York
    expect(pagesNow().toISOString()).toBe(first.toISOString());
    g.__liDataVersion = 4; // an edit: a new period
    expect(pagesNow().toISOString()).toBe('2026-10-07T01:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-07T04:00:30Z')); // just after midnight in New York
    expect(pagesNow().toISOString()).toBe('2026-10-07T04:00:30.000Z');
    process.env.BUILD_NOW = '2026-10-05T12:00:00Z'; // tests and parity builds pin it
    expect(pagesNow().toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });

  it('the static build keeps using the clock (or BUILD_NOW)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    expect(pagesNow().toISOString()).toBe('2026-10-06T12:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-06T12:00:05Z'));
    expect(pagesNow().toISOString()).toBe('2026-10-06T12:00:05.000Z');
    expect(g.__liPagesNow).toBeUndefined();
  });
});
