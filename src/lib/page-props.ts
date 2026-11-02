/**
 * Props for a page with a dynamic address, in both kinds of build (decision P58).
 *
 * Static build (today's site): Astro already passes the props from getStaticPaths().
 * Live server: the page runs when someone asks for it, so it calls the same getStaticPaths() once, keeps
 * the answer in memory, and finds the entry whose params match the address. The list is made again when
 * the data changes or a new day starts (src/lib/freshness.ts). The pages and their getStaticPaths() stay
 * exactly as they are.
 */
import type { GetStaticPathsItem } from 'astro';
import { freshnessKey } from './freshness';

type Params = Record<string, string | number | undefined>;
type Paths = GetStaticPathsItem[] | Promise<GetStaticPathsItem[]>;
interface PageContext {
  params: Params;
  props: Record<string, unknown>;
  isPrerendered: boolean;
}

const keyOf = (params: Params) =>
  JSON.stringify(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k] === undefined ? '' : String(params[k])]),
  );

const cache = new WeakMap<object, { version: string; map: Promise<Map<string, Record<string, unknown>>> }>();

/** The page's props, or undefined when no entry has these params (show the 404 page). */
export async function pageProps<P extends Record<string, unknown> = Record<string, unknown>>(
  ctx: PageContext,
  getStaticPaths: (...args: never[]) => Paths,
): Promise<P | undefined> {
  if (ctx.isPrerendered) return ctx.props as P;
  const version = freshnessKey();
  let entry = cache.get(getStaticPaths);
  if (!entry || entry.version !== version) {
    const map = (async () => {
      const m = new Map<string, Record<string, unknown>>();
      for (const p of await getStaticPaths()) m.set(keyOf(p.params as Params), (p.props ?? {}) as Record<string, unknown>);
      return m;
    })();
    entry = { version, map };
    cache.set(getStaticPaths, entry);
    map.catch(() => cache.delete(getStaticPaths));
  }
  return (await entry.map).get(keyOf(ctx.params)) as P | undefined;
}
