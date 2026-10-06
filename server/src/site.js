/**
 * The website (decision P58): files from the site build's client folder, every other address from the Astro
 * pages (server/site/server/entry.mjs, built with ASTRO_TARGET=server). It follows the old host's rules
 * (rules.js) and remembers finished pages, so most visits are answered from memory:
 *
 * - pages: kept until the data changes or a new day starts on Long Island (at most PAGE_CACHE_SECONDS, a day),
 *   already compressed (Brotli), so a visit costs no work; server/src/prepare.js fills the memory
 *   with every page in the sitemaps after each change. Browsers check again after 30 seconds, like on the
 *   old host;
 * - files: small text files (scripts, styles) kept in memory, compressed; pictures and fonts are read from
 *   disk each time (decision P62: the small B1 server has little memory to spare, and the system keeps
 *   busy files in its own cache anyway);
 * - resized photos (/_image/): made once, kept on disk (IMAGE_CACHE_DIR) and cached by browsers for a year.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRules } from './rules.js';

const SITE_DIR = process.env.SITE_DIR || fileURLToPath(new URL('../site/', import.meta.url));
const CLIENT_DIR = join(SITE_DIR, 'client');
const rules = loadRules(join(SITE_DIR, 'server', 'site-rules.json'));
/** The old host's rule for an address (staticwebapp.config.json), e.g. who may open it. */
export const routeRule = (pathname) => rules.route(pathname);
const CANONICAL = (process.env.CANONICAL_HOST || 'longisland.dance').toLowerCase();
// On App Service: /home/data/image-cache (kept between restarts). Locally: server/.image-cache (not in git).
const IMAGE_CACHE_DIR = process.env.IMAGE_CACHE_DIR || fileURLToPath(new URL('../.image-cache/', import.meta.url));
// Share pictures (src/lib/og.ts, P64): drawn ones are saved next to the resized photos (/home/data/og-cache);
// the static build's pictures of the same commit come with the package (og-seed, scripts/live/build-server.mjs).
process.env.OG_CACHE_DIR ||= join(IMAGE_CACHE_DIR, '..', 'og-cache');
if (!process.env.OG_SEED_DIR && existsSync(join(SITE_DIR, 'og-seed'))) process.env.OG_SEED_DIR = join(SITE_DIR, 'og-seed');
const PAGE_TTL_MS = Number(process.env.PAGE_CACHE_SECONDS || 86_400) * 1000;
const PAGE_CACHE_BYTES = Number(process.env.PAGE_CACHE_MB || 128) * 1024 * 1024;
const MAX_CACHED_PAGE = 8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2400;
/** Brotli level for pages (made again after every change, so quick) and for files (made once per start). */
const quality = (v, fallback) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 11 ? Number(v) : fallback);
const PAGE_BROTLI = quality(process.env.PAGE_BROTLI_QUALITY, 5);
const FILE_BROTLI = 9;
const BIG_TEXT_FILE = 512 * 1024;

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
/** The site build's server entry (server/astro-adapter/entry.mjs), loaded once. */
export async function astro() {
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

const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript|manifest\+json|rss\+xml|ld\+json)|image\/svg\+xml)/i;
const brotli = promisify(brotliCompress);

/**
 * A Brotli copy of a text answer, made once (in the background thread pool). Nearly every browser and search
 * engine takes Brotli; a gzip copy is made only when someone asks for one (bodyFor).
 */
async function compressed(stored, level = PAGE_BROTLI) {
  if (stored.body.length < 1024 || !COMPRESSIBLE.test(stored.headers.get('Content-Type') || '')) return stored;
  const br = await brotli(stored.body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: stored.body.length } });
  return { ...stored, variants: { br } };
}

/** The answer's body in the form the browser takes (`enc` from encodingFor). */
function bodyFor(stored, enc) {
  if (enc === 'br') return stored.variants.br;
  const plain = stored.body ?? brotliDecompressSync(stored.variants.br);
  if (enc !== 'gzip') return plain;
  if (!stored.variants.gzip) {
    stored.variants.gzip = gzipSync(plain, { level: 6 });
    grew(stored, stored.variants.gzip.length);
  }
  return stored.variants.gzip;
}

function encodingFor(request, stored) {
  if (!stored.variants) return null;
  const a = request.headers.get('accept-encoding') || '';
  if (/\bbr\b/.test(a)) return 'br';
  if (/\bgzip\b/.test(a)) return 'gzip';
  return null;
}

/** Sends a stored answer (compressed when the browser can take it); "not modified" when it already has it. */
function reply(request, stored, { status = stored.status, host } = {}) {
  const headers = new Headers(stored.headers);
  const enc = encodingFor(request, stored);
  // Each form of the answer has its own tag; any of them means the browser has this version.
  const etag = enc ? stored.etag.replace(/"$/, `-${enc === 'br' ? 'br' : 'gz'}"`) : stored.etag;
  headers.set('ETag', etag);
  if (stored.variants) headers.set('Vary', 'Accept-Encoding');
  if (host !== CANONICAL) headers.set('X-Robots-Tag', 'noindex, nofollow');
  const sent = (request.headers.get('if-none-match') || '').split(',').map((s) => s.trim().replace(/^W\//, '').replace(/-(br|gz)"$/, '"'));
  if (status === 200 && sent.includes(stored.etag)) {
    const keep = new Headers({ ETag: etag, 'Cache-Control': headers.get('Cache-Control') });
    if (stored.variants) keep.set('Vary', 'Accept-Encoding');
    if (host !== CANONICAL) keep.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(null, { status: 304, headers: keep });
  }
  if (stored.path) {
    // A picture or font: sent straight from disk.
    headers.set('Content-Length', String(stored.size));
    return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(stored.path)), { status, headers });
  }
  const body = bodyFor(stored, enc);
  if (enc) headers.set('Content-Encoding', enc);
  headers.set('Content-Length', String(body.length));
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

// ---------- files from the client folder ----------

const fileCache = new Map();
/** Text files up to this size are kept in memory (compressed); everything else is read from disk when sent. */
const MAX_TEXT_IN_MEMORY = 8 * 1024 * 1024;
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
  let handle;
  try {
    // One open file for both the check and the read.
    handle = await open(full, 'r');
    if ((await handle.stat()).isFile()) {
      const body = await handle.readFile();
      const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
      const stored = { status: 200, body, etag: etagOf(body), headers: headersFor(pathname, type, body) };
      if (COMPRESSIBLE.test(type) && body.length <= MAX_TEXT_IN_MEMORY) {
        // Level 9 for ordinary files; a big one (the 5 MB editor script) takes far too long at 9 on one core.
        file = await compressed(stored, body.length > BIG_TEXT_FILE ? PAGE_BROTLI : FILE_BROTLI);
        if (file.variants) file.body = null;
      } else {
        file = { ...stored, body: null, path: full, size: body.length };
      }
    }
  } catch {
    /* not a file */
  } finally {
    await handle?.close();
  }
  // The folder never changes while the server runs, so answers (also "no such file") can be remembered.
  if (fileCache.size < 20_000) fileCache.set(full, file);
  return file;
}

// ---------- pages ----------

const pageCache = new Map();
let pageCacheBytes = 0;
let pageCacheKey = '';
const inFlight = new Map();
const sizeOf = (s) => (s.body?.length ?? 0) + (s.variants ? s.variants.br.length + (s.variants.gzip?.length ?? 0) : 0);

/** A kept page got a gzip copy (bodyFor): count it. */
function grew(stored, bytes) {
  if (stored.cacheKey && pageCache.get(stored.cacheKey) === stored) pageCacheBytes += bytes;
}

/** Forget every finished page (after the data changes). */
export function clearPageCache() {
  pageCache.clear();
  pageCacheBytes = 0;
}

/** How many pages are ready in memory, and their size (for /api/health). */
export const pageCacheStatus = () => ({ pages: pageCache.size, mb: Math.round((pageCacheBytes / 1024 / 1024) * 10) / 10 });

/** Is this address already prepared for the current data and day? (server/src/prepare.js skips it then) */
export function isPrepared(pathname) {
  const hit = pageCache.get(`${freshness()}|${pathname}`);
  return Boolean(hit && hit.expires > Date.now());
}

function remember(key, stored) {
  if (stored.status !== 200 || stored.body.length > MAX_CACHED_PAGE || stored.noStore) return stored;
  // Pictures (share pictures) are not kept in memory: the page reads its saved copy from disk (src/lib/og.ts).
  if (!COMPRESSIBLE.test(stored.headers.get('Content-Type') || '')) return stored;
  // Text pages are kept compressed only (about a tenth of the size); the rare visitor without Brotli gets
  // a copy made on the spot.
  const kept = stored.variants ? { ...stored, body: null, cacheKey: key } : { ...stored, cacheKey: key };
  const old = pageCache.get(key);
  if (old) pageCacheBytes -= sizeOf(old);
  pageCache.set(key, kept);
  pageCacheBytes += sizeOf(kept);
  for (const [k, v] of pageCache) {
    if (pageCacheBytes <= PAGE_CACHE_BYTES) break;
    pageCache.delete(k);
    pageCacheBytes -= sizeOf(v);
  }
  return kept;
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
  const fresh = freshness();
  // New data or a new day: the old pages are no use any more, so free their memory at once.
  if (fresh !== pageCacheKey) {
    clearPageCache();
    pageCacheKey = fresh;
  }
  const key = `${fresh}|${url.pathname}`;
  const hit = pageCache.get(key);
  if (hit && hit.expires > Date.now()) {
    pageCache.delete(key);
    pageCache.set(key, hit);
    return hit;
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const p = render(url, request, clientAddress)
    .then(compressed)
    .then((stored) => remember(key, stored))
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

/** Deletes saved share pictures nobody asked for in `days` days (a picture gets a fresh date each time it is used). */
export async function pruneSavedPictures(days = 30) {
  const dir = process.env.OG_CACHE_DIR;
  if (!dir || dir === 'off') return 0;
  const cutoff = Date.now() - days * 86_400_000;
  let removed = 0;
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if ((await stat(p).catch(() => null))?.mtimeMs < cutoff) removed += await unlink(p).then(() => 1, () => 0);
    }
  };
  await walk(dir);
  return removed;
}

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
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(tmp, body, { flag: 'wx', mode: 0o600 });
        await writeFile(`${file}.type`, type, { mode: 0o600 });
        await rename(tmp, file);
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
 * `roles`: the visitor's roles (server/src/identity.js; anonymous when nobody is signed in). Formerly everyone was
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
