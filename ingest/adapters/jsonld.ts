/**
 * Generic adapter for pages with schema.org Event data built in (JSON-LD), e.g. WordPress "The
 * Events Calendar", Wix Events, Squarespace and many venue sites.
 *
 * fetch():     read the listing page (source.url) and any extra pages (pageUrls). When feedUrl is a
 *              sitemap (.xml), read the event pages it lists (newest first). When a listing page has
 *              no event data, follow its event links on the same site. Always through PoliteFetcher
 *              (robots.txt, delay, cache, our own User-Agent). At most MAX_PAGES pages per run.
 * normalize(): find every Event (and subtypes such as MusicEvent, DanceEvent) in the JSON-LD blocks,
 *              read name, dates, place, price, performers and link, then hand them to toCandidates().
 */
import { readFileSync } from 'node:fs';
import type { Adapter, AdapterContext, FetchedDocument, NormalizeResult } from '../lib/types';
import { decodeEntities, isoToLocal, plainText, settingsOf, toCandidates, type FoundEvent } from '../lib/structured';

export const MAX_PAGES = 30;
const EVENT_TYPES = new Set(['event', 'musicevent', 'danceevent', 'socialevent', 'festival', 'educationevent', 'theaterevent', 'comedyevent', 'childrensevent', 'exhibitionevent', 'sportsevent', 'businessevent', 'foodevent', 'literaryevent', 'publicationevent', 'saleevent', 'screeningevent', 'visualartsevent', 'courseinstance']);
const EVENT_LINK = /\/(?:event-details|events?|shows?|gigs?|calendar)\/[^"'#?\s]+/i;

type Json = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | undefined => {
  if (typeof v === 'string') return plainText(decodeEntities(v).replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, ' ')) || undefined;
  if (typeof v === 'number') return String(v);
  return undefined;
};

/** All JSON-LD blocks of a page, parsed (broken blocks are skipped). */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1]!.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try {
      out.push(JSON.parse(raw));
    } catch {
      try {
        out.push(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')));
      } catch {
        /* skip a broken block */
      }
    }
  }
  return out;
}

/** Every Event node in the parsed JSON-LD (walks @graph, arrays and nested objects). */
export function eventNodes(blocks: unknown[]): Json[] {
  const out: Json[] = [];
  const walk = (n: unknown, depth: number) => {
    if (depth > 8 || n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    const node = n as Json;
    const types = asArray(node['@type'] as string | string[]).map((t) => String(t).toLowerCase());
    if (types.some((t) => EVENT_TYPES.has(t)) && node.startDate) {
      out.push(node);
      return;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  blocks.forEach((b) => walk(b, 0));
  return out;
}

function placeOf(loc: unknown): Pick<FoundEvent, 'locationName' | 'address' | 'locality'> {
  const l = asArray(loc as Json | Json[]).find((x) => x && typeof x === 'object' && !String((x as Json)['@type'] ?? '').toLowerCase().includes('virtual')) as Json | undefined;
  if (!l) return typeof loc === 'string' ? { locationName: text(loc) } : {};
  const a = l.address;
  if (typeof a === 'string') return { locationName: text(l.name), address: text(a) };
  const addr = (a ?? {}) as Json;
  return { locationName: text(l.name), address: text(addr.streetAddress), locality: text(addr.addressLocality) };
}

function offersOf(offers: unknown, free: unknown): Pick<FoundEvent, 'price' | 'priceMax' | 'isFree'> {
  const prices: number[] = [];
  for (const o of asArray(offers as Json | Json[])) {
    if (!o || typeof o !== 'object') continue;
    for (const k of ['price', 'lowPrice', 'highPrice']) {
      const v = Number(String((o as Json)[k] ?? '').replace(/[^0-9.]/g, ''));
      if (String((o as Json)[k] ?? '') !== '' && Number.isFinite(v)) prices.push(v);
    }
  }
  if (free === true || (prices.length && prices.every((p) => p === 0))) return { isFree: true };
  const paid = prices.filter((p) => p > 0);
  if (!paid.length) return {};
  return { price: Math.min(...paid), priceMax: Math.max(...paid) > Math.min(...paid) ? Math.max(...paid) : undefined };
}

const names = (v: unknown): string[] =>
  asArray(v as Json | Json[] | string)
    .map((p) => (typeof p === 'string' ? text(p) : text((p as Json)?.name)))
    .filter((x): x is string => Boolean(x));

/** Turn one JSON-LD Event node into a FoundEvent. */
export function foundFromNode(node: Json, pageUrl: string): FoundEvent | undefined {
  const start = isoToLocal(text(node.startDate));
  const title = text(node.name);
  if (!start || !title) return undefined;
  const status = String(node.eventStatus ?? '').toLowerCase();
  const url = text(node.url) ?? (typeof node['@id'] === 'string' && /^https?:/.test(node['@id']) ? node['@id'] : undefined);
  return {
    title,
    description: text(node.description)?.slice(0, 1500),
    start,
    end: isoToLocal(text(node.endDate)),
    ...placeOf(node.location),
    url,
    ...offersOf(node.offers, node.isAccessibleForFree),
    performers: names(node.performer),
    organizerName: names(node.organizer)[0],
    cancelled: status.includes('cancelled'),
    ref: 'event data on the page',
    pageUrl: url ?? pageUrl,
  };
}

/** Event page links from a sitemap (newest first when the sitemap has dates). */
export function sitemapLinks(xml: string): string[] {
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((m) => ({
    loc: /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(m[1]!)?.[1],
    mod: /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(m[1]!)?.[1] ?? '',
  }));
  const list = entries.length ? entries : [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => ({ loc: m[1], mod: '' }));
  return list
    .filter((e): e is { loc: string; mod: string } => Boolean(e.loc))
    .sort((a, b) => b.mod.localeCompare(a.mod))
    .map((e) => decodeEntities(e.loc));
}

export const adapter: Adapter = {
  id: 'jsonld',
  async fetch(ctx: AdapterContext): Promise<FetchedDocument[]> {
    const src = settingsOf(ctx);
    const delay = src.rateLimitSeconds;
    const docs: FetchedDocument[] = [];
    const queue = [src.url, ...(src.pageUrls ?? [])];
    if (src.feedUrl && /\.xml(\?|$)/i.test(src.feedUrl)) {
      const xml = await ctx.fetcher.text(src.feedUrl, delay);
      queue.push(...sitemapLinks(xml).slice(0, MAX_PAGES));
    } else if (src.feedUrl) queue.push(src.feedUrl);
    const done = new Set<string>();
    while (queue.length && docs.length < MAX_PAGES) {
      const url = queue.shift()!;
      if (done.has(url)) continue;
      done.add(url);
      const r = await ctx.fetcher.get(url, delay);
      docs.push({ url, file: r.file, contentType: r.contentType, meta: {} });
      if (docs.length === 1 || url === src.url) {
        const html = readFileSync(r.file, 'utf8');
        if (!eventNodes(jsonLdBlocks(html)).length) {
          // A list page without event data: follow its event links on the same site.
          const origin = new URL(url).origin;
          for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
            let link: URL;
            try {
              link = new URL(decodeEntities(m[1]!), url);
            } catch {
              continue;
            }
            if (link.origin === origin && EVENT_LINK.test(link.pathname) && link.href !== url) queue.push(link.href.replace(/#.*$/, ''));
          }
        }
      }
    }
    ctx.log(`${docs.length} pages read`);
    return docs;
  },
  async normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult> {
    const found: FoundEvent[] = [];
    for (const d of docs) {
      const html = readFileSync(d.file, 'utf8');
      for (const node of eventNodes(jsonLdBlocks(html))) {
        const f = foundFromNode(node, d.url);
        if (f) found.push(f);
      }
    }
    return toCandidates(found, ctx, { structured: true });
  },
};
