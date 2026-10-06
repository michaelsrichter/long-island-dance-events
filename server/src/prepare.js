/**
 * Every page ready before anyone asks (decision P61).
 *
 * After the records change (and at start, and when a new day starts on Long Island) the server prepares every
 * address in its sitemaps, plus the busiest pages and machine-read files, one at a time with a short pause, so
 * visitors and search engines never wait for a page to be made. Prepared pages stay in memory, compressed,
 * until the data or the day changes (server/src/site.js). A newer change stops the round and starts again.
 */
import { route } from './app.js';
import { isPrepared } from './site.js';

const HOST = process.env.CANONICAL_HOST || 'longisland.dance';
const PAUSE_MS = Number(process.env.PREPARE_PAUSE_MS || 25);
/** Read first: the busiest pages, then files that programs read. */
const FIRST = ['/', '/events/', '/events/calendar/', '/events/map/', '/venues/', '/sitemap-index.xml', '/llms.txt', '/events/upcoming.json', '/robots.txt'];
const LAST = ['/llms-full.txt', '/community-pages.json', '/saved-events.json'];

let round = 0;
const status = { round: 0, running: false, startedAt: null, finishedAt: null, prepared: 0, skipped: 0, failed: 0, ms: 0 };

/** For /api/health. */
export const prepareStatus = () => ({ ...status });

async function get(path) {
  const res = await route(new Request(`https://${HOST}${path}`, { headers: { 'accept-encoding': 'br, gzip' } }), {});
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body, encoding: res.headers.get('content-encoding') };
}

/** Every address in the sitemaps, in sitemap order (pages, events, venues, people, styles, towns). */
async function sitemapPaths() {
  const { gunzipSync, brotliDecompressSync } = await import('node:zlib');
  const text = ({ body, encoding }) => (encoding === 'br' ? brotliDecompressSync(body) : encoding === 'gzip' ? gunzipSync(body) : body).toString('utf8');
  const index = await get('/sitemap-index.xml');
  if (index.status !== 200) return [];
  const paths = [];
  for (const m of text(index).matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const sitemap = await get(new URL(m[1]).pathname);
    if (sitemap.status !== 200) continue;
    for (const u of text(sitemap).matchAll(/<url><loc>([^<]+)<\/loc>/g)) paths.push(new URL(u[1].replace(/&amp;/g, '&')).pathname);
  }
  return paths;
}

const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

/** Prepare every page; returns when done or when a newer round took over. */
export async function prepareAll(reason = 'change') {
  const mine = ++round;
  Object.assign(status, { round: mine, running: true, startedAt: new Date().toISOString(), prepared: 0, skipped: 0, failed: 0 });
  const started = performance.now();
  try {
    const seen = new Set();
    const one = async (path) => {
      if (seen.has(path)) return;
      seen.add(path);
      if (isPrepared(path)) {
        status.skipped++;
        return;
      }
      try {
        const r = await get(path);
        if (r.status >= 500) status.failed++;
        else status.prepared++;
      } catch (err) {
        status.failed++;
        console.warn(`[prepare] ${path}: ${err.message}`);
      }
      await pause();
    };
    for (const p of FIRST) {
      if (mine !== round) return;
      await one(p);
    }
    for (const p of await sitemapPaths()) {
      if (mine !== round) return;
      await one(p);
    }
    for (const p of LAST) {
      if (mine !== round) return;
      await one(p);
    }
    status.ms = Math.round(performance.now() - started);
    console.log(`[prepare] ${reason}: ${status.prepared} pages prepared, ${status.skipped} already ready, ${status.failed} failed, in ${(status.ms / 1000).toFixed(0)} s`);
  } finally {
    if (mine === round) Object.assign(status, { running: false, finishedAt: new Date().toISOString() });
  }
}
