/**
 * Polite HTTP for scraping (brief §5): descriptive User-Agent, robots.txt honored, one request at a
 * time per host with a delay, and a disk cache with conditional requests (ETag / Last-Modified) so an
 * unchanged file is not downloaded again. Cached copies live in .cache/ingest and are never committed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const USER_AGENT = 'LongIslandDanceEventsBot/1.0 (+https://github.com/michaelsrichter/long-island-dance-events; weekly, polite)';
const BOT_TOKEN = 'longislanddanceeventsbot';

interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelay?: number | undefined;
}

/** Parse robots.txt and return the rules that apply to this bot (its own group, else "*"). */
export function parseRobots(text: string): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' && value) current.rules.allow.push(value);
    if (key === 'disallow' && value) current.rules.disallow.push(value);
    if (key === 'crawl-delay' && Number(value) > 0) current.rules.crawlDelay = Number(value);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && BOT_TOKEN.includes(a)));
  return (mine ?? groups.find((g) => g.agents.includes('*')))?.rules ?? { allow: [], disallow: [] };
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching rule wins; Allow wins ties (Google's documented behavior). */
export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } = { len: -1, allow: true };
  for (const [list, allow] of [[rules.allow, true], [rules.disallow, false]] as const) {
    for (const p of list) {
      if (patternToRegex(p).test(pathAndQuery) && (p.length > best.len || (p.length === best.len && allow))) best = { len: p.length, allow };
    }
  }
  return best.allow;
}

export interface FetchResult {
  url: string;
  status: number;
  file: string;
  contentType: string;
  fromCache: boolean;
}

export class PoliteFetcher {
  private robots = new Map<string, RobotsRules>();
  private lastRequest = new Map<string, number>();

  constructor(
    readonly cacheDir: string,
    readonly opts: { delaySeconds?: number; offline?: boolean; log?: (m: string) => void } = {},
  ) {
    mkdirSync(cacheDir, { recursive: true });
  }

  private key(url: string) {
    return createHash('sha1').update(url).digest('hex').slice(0, 20);
  }

  private async wait(host: string, delaySeconds: number) {
    const last = this.lastRequest.get(host) ?? 0;
    const ms = last + delaySeconds * 1000 - Date.now();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    this.lastRequest.set(host, Date.now());
  }

  private async rules(origin: string, delay: number): Promise<RobotsRules> {
    if (this.robots.has(origin)) return this.robots.get(origin)!;
    let rules: RobotsRules = { allow: [], disallow: [] };
    try {
      await this.wait(new URL(origin).host, delay);
      const res = await fetch(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (res.ok) rules = parseRobots(await res.text());
      else if (res.status === 401 || res.status === 403) rules = { allow: [], disallow: ['/'] };
    } catch {
      // No robots.txt reachable: treat as allowed, but stay slow.
    }
    this.robots.set(origin, rules);
    return rules;
  }

  /** GET a URL into the cache. Returns the cached file when the server says it has not changed. */
  async get(url: string, delaySeconds = this.opts.delaySeconds ?? 3): Promise<FetchResult> {
    const k = this.key(url);
    const file = join(this.cacheDir, k);
    const metaFile = `${file}.json`;
    const meta = existsSync(metaFile) ? (JSON.parse(readFileSync(metaFile, 'utf8')) as { etag?: string; lastModified?: string; contentType?: string }) : undefined;
    if (this.opts.offline) {
      if (!existsSync(file)) throw new Error(`Offline and not cached: ${url}`);
      return { url, status: 200, file, contentType: meta?.contentType ?? '', fromCache: true };
    }
    const u = new URL(url);
    const rules = await this.rules(u.origin, delaySeconds);
    if (!isAllowed(rules, u.pathname + u.search)) throw new Error(`robots.txt does not allow ${url}`);
    await this.wait(u.host, Math.max(delaySeconds, rules.crawlDelay ?? 0));
    const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: '*/*' };
    if (meta?.etag && existsSync(file)) headers['if-none-match'] = meta.etag;
    if (meta?.lastModified && existsSync(file)) headers['if-modified-since'] = meta.lastModified;
    let res: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(90000) });
        if (res.status < 500) break;
      } catch (e) {
        if (attempt === 1) throw e;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!res) throw new Error(`No response from ${url}`);
    if (res.status === 304) {
      this.opts.log?.(`not changed: ${url}`);
      return { url, status: 304, file, contentType: meta?.contentType ?? '', fromCache: true };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
    const contentType = res.headers.get('content-type') ?? '';
    writeFileSync(metaFile, JSON.stringify({ url, etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined, contentType, fetchedAt: new Date().toISOString(), bytes: buf.length }, null, 1));
    this.opts.log?.(`downloaded ${buf.length} bytes: ${url}`);
    return { url, status: res.status, file, contentType, fromCache: false };
  }

  async text(url: string, delaySeconds?: number): Promise<string> {
    const r = await this.get(url, delaySeconds);
    return readFileSync(r.file, 'utf8');
  }
}
