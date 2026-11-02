/**
 * How long remembered lists stay valid (decision P58).
 *
 * Static build: for the whole build, as before.
 * Live server (server/astro-adapter/entry.mjs sets `__liLive`): until the data changes (`__liDataVersion`)
 * or a new day starts on Long Island, so "upcoming" and repeating dates move on even if the server runs
 * for weeks.
 *
 * One "now" per period (decision P62): on the live server every page made for the same data and day uses the
 * moment that period began, like every page of a static build uses one build time. A page made at 9 PM then
 * agrees with one made at 1 AM (which events are still upcoming, how many days until a date), and the daily
 * parity check can build the static site with exactly that time (`/api/health` → `pagesNow`).
 */
import { dateInZone } from './time';

interface LiveGlobals {
  __liLive?: boolean;
  __liDataVersion?: string | number;
  __liPagesNow?: string;
}

export function freshnessKey(): string {
  const g = globalThis as LiveGlobals;
  if (!g.__liLive) return 'build';
  const now = process.env.BUILD_NOW ? new Date(process.env.BUILD_NOW) : new Date();
  return `${g.__liDataVersion ?? 'build'}|${dateInZone(now)}`;
}

let period: { key: string; at: Date } | undefined;

/** "Now" for the pages: BUILD_NOW when set; on the live server, when the current period began; else the time. */
export function pagesNow(): Date {
  if (process.env.BUILD_NOW) return new Date(process.env.BUILD_NOW);
  const g = globalThis as LiveGlobals;
  if (!g.__liLive) return new Date();
  const key = freshnessKey();
  if (period?.key !== key) {
    period = { key, at: new Date() };
    g.__liPagesNow = period.at.toISOString();
  }
  return new Date(period.at);
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
