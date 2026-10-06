import { afterEach, describe, expect, it } from 'vitest';
import { freshnessKey, remember } from '../../src/lib/freshness';

const g = globalThis as { __liLive?: boolean; __liDataVersion?: string | number };

afterEach(() => {
  delete g.__liLive;
  delete g.__liDataVersion;
  delete process.env.BUILD_NOW;
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
});
