/**
 * How long remembered lists stay valid (decision P58).
 *
 * Static build: for the whole build, as before.
 * Live server (server/astro-adapter/entry.mjs sets `__liLive`): until the data changes (`__liDataVersion`)
 * or a new day starts on Long Island, so "upcoming" and repeating dates move on even if the server runs
 * for weeks.
 */
import { dateInZone } from './time';

interface LiveGlobals {
  __liLive?: boolean;
  __liDataVersion?: string | number;
}

export function freshnessKey(): string {
  const g = globalThis as LiveGlobals;
  if (!g.__liLive) return 'build';
  const now = process.env.BUILD_NOW ? new Date(process.env.BUILD_NOW) : new Date();
  return `${g.__liDataVersion ?? 'build'}|${dateInZone(now)}`;
}

/** `make()` once per freshness key; a failed attempt is tried again next time. */
export function remember<T>(make: () => Promise<T>): () => Promise<T> {
  let key: string | undefined;
  let value: Promise<T> | undefined;
  return () => {
    const k = freshnessKey();
    if (!value || k !== key) {
      key = k;
      const v = make();
      value = v;
      v.catch(() => {
        if (value === v) value = undefined;
      });
    }
    return value;
  };
}
