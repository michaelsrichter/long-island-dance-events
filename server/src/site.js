/**
 * The website (decision P58): files from the site build's client folder, every other address from the Astro
 * pages (server/site/server/entry.mjs, built with ASTRO_TARGET=server). It follows the old host's rules
 * (rules.js) and remembers finished pages, so most visits are answered from memory:
 *
 * - pages: kept for PAGE_CACHE_SECONDS (15 minutes) or until the data changes or a new day starts on Long
 *   Island; browsers check again after 30 seconds, like on the old host;
 * - resized photos (/_image/): made once, kept on disk (IMAGE_CACHE_DIR) and cached by browsers for a year.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRules } from './rules.js';

const SITE_DIR = process.env.SITE_DIR || fileURLToPath(new URL('../site/', import.meta.url));
const CLIENT_DIR = join(SITE_DIR, 'client');
const rules = loadRules(join(SITE_DIR, 'server', 'site-rules.json'));
const CANONICAL = (process.env.CANONICAL_HOST || 'longisland.dance').toLowerCase();
const IMAGE_CACHE_DIR = process.env.IMAGE_CACHE_DIR || join(tmpdir(), 'li-image-cache');
const PAGE_TTL_MS = Number(process.env.PAGE_CACHE_SECONDS || 900) * 1000;
const PAGE_CACHE_BYTES = Number(process.env.PAGE_CACHE_MB || 128) * 1024 * 1024;
const MAX_CACHED_PAGE = 8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2400;

/** What the old host sends when nothing else is set: browsers may reuse the answer for 30 seconds. */
const DEFAULT_CACHE = 'public, must-revalidate, max-age=30';
const IMMUTABLE = 'public, max-age=31536000, immutable';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
  ...rules.mimeTypes,
};

let entry;
async function astro() {
  entry ??= import(pathToFileURL(join(SITE_DIR, 'server', 'entry.mjs')).href)
    .then(async (m) => {
      await m.init?.({ clientDir: pathToFileURL(CLIENT_DIR + sep) });
      return m;
    })
    .catch((err) => {
      entry = undefined;
      throw err;
    });
  return entry;
}

const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Same rule as src/lib/freshness.ts: the data version and the date on Long Island. */
const freshness = () => `${globalThis.__liDataVersion ?? 'build'}|${nyDate.format(new Date())}`;

const etagOf = (body) => `"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`;
const isHtml = (type) => /^text\/html/i.test(type || '');

function text(status, message, extra = {}) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}

/** Final headers: what the page set, then the old host's rules, then the default cache time. */
function headersFor(pathname, type, body, own = []) {
  const h = new Headers(own);
  for (const [k, v] of Object.entries(rules.headers(pathname, isHtml(type) ? body.toString('utf8') : null))) h.set(k, v);
  if (type) h.set('Content-Type', type);
  if (!h.has('Cache-Control')) h.set('Cache-Control', pathname.startsWith('/_astro/') ? IMMUTABLE : DEFAULT_CACHE);
  return h;
}

/** Sends a stored answer; "not modified" when the browser already has it. */
function reply(request, stored, { status = stored.status, host } = {}) {
  const headers = new Headers(stored.headers);
  headers.set('ETag', stored.etag);
  if (host !== CANONICAL) headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (status === 200 && request.headers.get('if-none-match') === stored.etag) {
    const keep = new Headers({ ETag: stored.etag, 'Cache-Control': headers.get('Cache-Control') });
    if (host !== CANONICAL) keep.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(null, { status: 304, headers: keep });
  }
  headers.set('Content-Length', String(stored.body.length));
  return new Response(request.method === 'HEAD' ? null : stored.body, { status, headers });
}

// ---------- files from the client folder ----------

const fileCache = new Map();
async function staticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = normalize(join(CLIENT_DIR, decoded.endsWith('/') ? decoded + 'index.html' : decoded));
  if (!full.startsWith(CLIENT_DIR + sep)) return null;
  if (fileCache.has(full)) return fileCache.get(full);
  let file = null;
  try {
    const s = await stat(full);
    if (s.isFile()) {
      const body = await readFile(full);
      const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
      file = { status: 200, body, etag: etagOf(body), headers: headersFor(pathname, type, body) };
    }
  } catch {
    /* not a file */
  }
  // The folder never changes while the server runs, so answers (also "no such file") can be remembered.
  if (fileCache.size < 20_000 && (!file || file.body.length < 1024 * 1024)) fileCache.set(full, file);
  return file;
}

// ---------- pages ----------

const pageCache = new Map();
let pageCacheBytes = 0;
const inFlight = new Map();

/** Forget every finished page (after the data changes). */
export function clearPageCache() {
  pageCache.clear();
  pageCacheBytes = 0;
}

function remember(key, stored) {
  if (stored.status !== 200 || stored.body.length > MAX_CACHED_PAGE || stored.noStore) return;
  const old = pageCache.get(key);
  if (old) pageCacheBytes -= old.body.length;
  pageCache.set(key, stored);
  pageCacheBytes += stored.body.length;
  for (const [k, v] of pageCache) {
    if (pageCacheBytes <= PAGE_CACHE_BYTES) break;
    pageCache.delete(k);
    pageCacheBytes -= v.body.length;
  }
}

/** Renders an address with Astro and stores the whole answer (pages are small; this allows ETags and caching). */
async function render(url, request, clientAddress, pathname = url.pathname) {
  const app = await astro();
  // Like the static site, pages never see the query string (it is only for scripts in the browser).
  const req = new Request(new URL(url.pathname, url), { method: 'GET', headers: request.headers });
  const res = (await app.handle(req, { clientAddress })) ?? (await app.notFound(req));
  const body = Buffer.from(await res.arrayBuffer());
  const own = [...res.headers].filter(([k]) => k !== 'content-length' && k !== 'content-type');
  return {
    status: res.status,
    body,
    etag: etagOf(body),
    headers: headersFor(pathname, res.headers.get('content-type'), body, own),
    noStore: res.headers.has('set-cookie'),
    expires: Date.now() + PAGE_TTL_MS,
  };
}

async function page(request, url, clientAddress) {
  const key = `${freshness()}|${url.pathname}`;
  const hit = pageCache.get(key);
  if (hit && hit.expires > Date.now()) {
    pageCache.delete(key);
    pageCache.set(key, hit);
    return hit;
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const p = render(url, request, clientAddress)
    .then((stored) => {
      remember(key, stored);
      return stored;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** The old host's error pages (401 signed out, 403 not allowed), with the original address's rules. */
async function override(status, request, url, clientAddress) {
  const target = rules.responseOverrides[status]?.rewrite?.replace(/index\.html$/, '');
  if (!target) return text(status, status === 401 ? 'Please sign in.' : 'Not allowed.');
  const stored = await render(new URL(target, url), request, clientAddress, url.pathname);
  stored.headers.set('Cache-Control', 'no-store');
  return reply(request, stored, { status, host: url.hostname.toLowerCase() });
}

// ---------- resized photos ----------

const imagesInFlight = new Map();
async function image(request, url) {
  for (const p of ['w', 'h']) {
    const v = url.searchParams.get(p);
    if (v !== null && !(Number(v) > 0 && Number(v) <= MAX_IMAGE_SIDE)) return text(400, 'Invalid image size.');
  }
  const key = createHash('sha256').update(url.search).digest('hex');
  const file = join(IMAGE_CACHE_DIR, key.slice(0, 2), key);
  const host = url.hostname.toLowerCase();
  const answer = (body, type) => reply(request, { status: 200, body, etag: `"${key.slice(0, 22)}"`, headers: headersFor('/_image/', type, body, [['Cache-Control', IMMUTABLE]]) }, { host });
  try {
    const [body, type] = await Promise.all([readFile(file), readFile(`${file}.type`, 'utf8')]);
    return answer(body, type);
  } catch {
    /* not made yet */
  }
  if (!imagesInFlight.has(key)) {
    const made = (async () => {
      const app = await astro();
      const res = await app.handle(new Request(url, { headers: request.headers }), {});
      if (!res || res.status !== 200) return { status: res?.status ?? 404, body: Buffer.from(res ? await res.arrayBuffer() : '') };
      const body = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || 'application/octet-stream';
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, body);
        await writeFile(`${file}.type`, type);
        await rename(`${file}.tmp`, file);
      } catch (err) {
        console.warn(`[site] could not keep a resized photo: ${err.message}`);
      }
      return { status: 200, body, type };
    })().finally(() => imagesInFlight.delete(key));
    imagesInFlight.set(key, made);
  }
  const made = await imagesInFlight.get(key);
  if (made.status !== 200) return text(made.status, made.body.toString('utf8') || 'Not found.');
  return answer(made.body, made.type);
}

// ---------- the website ----------

/**
 * `roles`: the visitor's roles; until sign-in moves to this server (a later Phase 2 step), everyone is
 * anonymous, so addresses for moderators answer "please sign in" (401) like the old host does.
 */
export async function site(request, { clientAddress, roles = ['anonymous'] } = {}) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host === `www.${CANONICAL}`) return new Response(null, { status: 301, headers: { Location: `https://${CANONICAL}${url.pathname}${url.search}` } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed.', { Allow: 'GET, HEAD' });

  const route = rules.route(url.pathname);
  if (route?.allowedRoles?.length && !route.allowedRoles.some((r) => roles.includes(r))) {
    return override(roles.includes('authenticated') ? 403 : 401, request, url, clientAddress);
  }

  let app;
  try {
    if (url.pathname === '/_image' || url.pathname === '/_image/') return await image(request, url);
    const file = route?.statusCode ? null : await staticFile(url.pathname);
    if (file) return reply(request, file, { host });
    app = await astro();
  } catch (err) {
    console.error(`[site] ${err.stack || err.message}`);
    return text(503, 'The website is not installed on this server yet.');
  }

  // Like the old host: /events -> /events/ when that page exists.
  const last = url.pathname.split('/').pop();
  if (!route?.statusCode && last && !last.includes('.')) {
    const withSlash = new URL(`${url.pathname}/`, url);
    if (app.matches(new Request(withSlash)) || (await staticFile(withSlash.pathname))) {
      return new Response(null, { status: 301, headers: { Location: `${withSlash.pathname}${url.search}` } });
    }
  }

  if (route?.statusCode) {
    const res = await app.notFound(new Request(url, { headers: request.headers }));
    const body = Buffer.from(await res.arrayBuffer());
    const stored = { status: route.statusCode, body, etag: etagOf(body), headers: headersFor(url.pathname, res.headers.get('content-type'), body) };
    return reply(request, stored, { host });
  }
  return reply(request, await page(request, url, clientAddress), { host });
}
