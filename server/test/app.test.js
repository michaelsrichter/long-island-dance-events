// The live server's router and HTTP layer (decision P58), without a database or the real site build:
// a tiny stand-in site (a client folder, an entry.mjs and the old host's rules) is written to a temporary folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { inlineScriptHashes as postbuildHashes } from '../../scripts/lib/csp.mjs';

const dir = mkdtempSync(join(tmpdir(), 'li-site-'));
const imageCache = join(dir, 'image-cache');
mkdirSync(join(dir, 'client', '_astro'), { recursive: true });
mkdirSync(join(dir, 'client', 'admin'), { recursive: true });
mkdirSync(join(dir, 'server'), { recursive: true });
writeFileSync(join(dir, 'client', 'robots.txt'), 'User-agent: *\n');
writeFileSync(join(dir, 'client', 'feed.ics'), 'BEGIN:VCALENDAR\n');
writeFileSync(join(dir, 'client', 'admin', 'index.html'), '<!doctype html><title>Admin</title>');
writeFileSync(join(dir, 'client', '_astro', 'app.abc123.js'), 'console.log(1);\n'.repeat(200));
writeFileSync(join(dir, 'secret.txt'), 'outside the client folder');
const THEME = 'document.documentElement.dataset.js = "1";';
writeFileSync(
  join(dir, 'server', 'site-rules.json'),
  JSON.stringify({
    csp: {
      __SITE_CSP__: "default-src 'self'; script-src 'self' __HASHES__ https://www.googletagmanager.com; form-action 'self'",
      __REVIEW_CSP__: "default-src 'self'; script-src 'self' __HASHES__ https://www.googletagmanager.com; form-action 'self' https://github.com",
      __ADMIN_CSP__: "default-src 'self'; script-src 'self' 'unsafe-eval'",
    },
    globalHeaders: { 'Content-Security-Policy': '__SITE_CSP__', 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' },
    routes: [
      { route: '/_astro/*', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
      { route: '/admin/*', headers: { 'Content-Security-Policy': '__ADMIN_CSP__', 'Cache-Control': 'no-cache' } },
      { route: '/*.ics', headers: { 'Cache-Control': 'public, max-age=900' } },
      { route: '/.auth/login/github', statusCode: 404 },
      { route: '/moderate/*', allowedRoles: ['admin'], headers: { 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex', 'Content-Security-Policy': '__REVIEW_CSP__' } },
      { route: '/events/upcoming.json', headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=600' } },
    ],
    responseOverrides: { 401: { rewrite: '/signed-out/index.html', statusCode: 401 }, 404: { rewrite: '/404.html', statusCode: 404 } },
    mimeTypes: { '.ics': 'text/calendar; charset=utf-8', '.txt': 'text/plain; charset=utf-8' },
  }),
);
writeFileSync(
  join(dir, 'server', 'entry.mjs'),
  `globalThis.renders = 0;
globalThis.imageRenders = 0;
const PAGES = new Set(['/', '/events/', '/who/', '/cookies/', '/signed-out/', '/events/upcoming.json']);
export function matches(request) { return PAGES.has(new URL(request.url).pathname); }
export async function handle(request, { clientAddress } = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/_image/') {
    globalThis.imageRenders++;
    if (url.searchParams.get('href') === '/missing.png') return new Response('Not Found', { status: 404 });
    return new Response('IMG' + url.search, { headers: { 'content-type': 'image/webp' } });
  }
  if (!matches(request)) return null;
  globalThis.renders++;
  if (url.pathname === '/') return new Response('<!doctype html><script>${THEME}</script><p>' + 'home '.repeat(300) + url.search + '</p>', { headers: { 'content-type': 'text/html' } });
  if (url.pathname === '/events/') return new Response('<!doctype html><p>events ' + globalThis.renders + '</p>', { headers: { 'content-type': 'text/html' } });
  if (url.pathname === '/signed-out/') return new Response('<!doctype html><p>Please sign in</p>', { headers: { 'content-type': 'text/html' } });
  if (url.pathname === '/events/upcoming.json') return new Response('{"events":[]}', { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/who/') return new Response(JSON.stringify({ clientAddress, url: request.url }), { headers: { 'content-type': 'application/json' } });
  const h = new Headers({ 'content-type': 'text/plain' });
  h.append('set-cookie', 'a=1; Path=/');
  h.append('set-cookie', 'b=2; Path=/');
  return new Response('ok', { headers: h });
}
export async function notFound() {
  return new Response('<!doctype html><p>Page not found</p>', { status: 404, headers: { 'content-type': 'text/html' } });
}
`,
);
process.env.SITE_DIR = dir;
process.env.IMAGE_CACHE_DIR = imageCache;
const { route } = await import('../src/app.js');
const { clearPageCache } = await import('../src/site.js');
const { inlineScriptHashes } = await import('../src/rules.js');
const { clientAddress, sendResponse, toRequest } = await import('../src/lib/node-http.js');

let server;
let base;
before(async () => {
  server = http.createServer(async (req, res) => sendResponse(req, res, await route(toRequest(req), { clientAddress: clientAddress(req) }), { startedAt: performance.now() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const SITE = { 'X-Forwarded-Host': 'longisland.dance', 'X-Forwarded-Proto': 'https' };
/** Raw request without automatic decompression or redirects, so the test sees what was sent. */
function get(path, headers = SITE, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('/api/live answers without the database', async () => {
  const r = await get('/api/live');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('unknown /api addresses are 404 and wrong methods 405, never the website', async () => {
  assert.equal((await get('/api/nothing-here')).status, 404);
  assert.equal((await get('/api/sync/import')).status, 405);
});

test('sync endpoints refuse callers without a GitHub token (before touching the database)', async () => {
  const r = await fetch(`${base}/api/sync/import`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${base}/api/sync/export`)).status, 401);
});

test('files: the old host rules decide cache times and headers', async () => {
  const js = await get('/_astro/app.abc123.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.match(js.headers['content-type'], /^text\/javascript/);
  assert.equal(js.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  const robots = await get('/robots.txt');
  assert.equal(robots.body.toString(), 'User-agent: *\n');
  assert.equal(robots.headers['cache-control'], 'public, must-revalidate, max-age=30');
  assert.equal(robots.headers['content-type'], 'text/plain; charset=utf-8');
  const again = await get('/robots.txt', { ...SITE, 'If-None-Match': robots.headers.etag });
  assert.equal(again.status, 304);
  const ics = await get('/feed.ics');
  assert.equal(ics.headers['cache-control'], 'public, max-age=900');
  assert.equal(ics.headers['content-type'], 'text/calendar; charset=utf-8');
  const admin = await get('/admin/');
  assert.equal(admin.status, 200);
  assert.equal(admin.headers['content-security-policy'], "default-src 'self'; script-src 'self' 'unsafe-eval'");
  assert.equal(admin.headers['cache-control'], 'no-cache');
});

test('files outside the client folder are never served', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/_astro/..%2f..%2fsecret.txt', '/%00', '/..%5c..%5csecret.txt']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body.toString(), /outside the client folder/, p);
  }
});

test('pages: compressed, security policy with the page script hashes, old-host cache time', async () => {
  const br = await get('/', { ...SITE, 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  assert.equal(br.headers['cache-control'], 'public, must-revalidate, max-age=30');
  assert.match(br.headers['server-timing'], /^app;dur=/);
  const html = brotliDecompressSync(br.body).toString();
  assert.match(html, /^<!doctype html><script>/);
  const [hash] = postbuildHashes(html, createHash);
  assert.deepEqual(inlineScriptHashes(html), [hash]);
  assert.equal(br.headers['content-security-policy'], `default-src 'self'; script-src 'self' ${hash} https://www.googletagmanager.com; form-action 'self'`);
  assert.equal(br.headers['x-robots-tag'], undefined);
  const gz = await get('/', { ...SITE, 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.match(gunzipSync(gz.body).toString(), /home/);
  const plain = await get('/');
  assert.equal(plain.headers['content-encoding'], undefined);
  const head = await get('/', SITE, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  const json = await get('/events/upcoming.json');
  assert.equal(json.headers['cache-control'], 'public, max-age=600');
  assert.equal(json.headers['x-robots-tag'], 'noindex');
});

test('pages are remembered, and browsers that have a page get "not modified"', async () => {
  clearPageCache();
  const before = globalThis.renders;
  const all = await Promise.all(Array.from({ length: 20 }, () => get('/events/')));
  assert.ok(all.every((r) => r.status === 200));
  assert.equal(globalThis.renders - before, 1, 'twenty visitors at once, one render');
  const again = await get('/events/', { ...SITE, 'If-None-Match': all[0].headers.etag });
  assert.equal(again.status, 304);
  assert.equal(globalThis.renders - before, 1);
  clearPageCache();
  await get('/events/');
  assert.equal(globalThis.renders - before, 2, 'made again after the data changes');
});

test('pages never see the query string, like on the static site', async () => {
  const r = await get('/?utm_source=newsletter&x=%3Cscript%3E');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body.toString(), /utm_source|<script>alert/);
});

test('www and missing slashes are sent to the right address with 301, like the old host', async () => {
  const www = await get('/events/?q=1', { 'X-Forwarded-Host': 'www.longisland.dance', 'X-Forwarded-Proto': 'https' });
  assert.equal(www.status, 301);
  assert.equal(www.headers.location, 'https://longisland.dance/events/?q=1');
  const slash = await get('/events?style=salsa');
  assert.equal(slash.status, 301);
  assert.equal(slash.headers.location, '/events/?style=salsa');
  const admin = await get('/admin');
  assert.equal(admin.status, 301);
  assert.equal(admin.headers.location, '/admin/');
  assert.equal((await get('/no-such-page')).status, 404);
});

test('unknown pages get the site 404 page; blocked addresses too', async () => {
  const r = await get('/no/such/page/');
  assert.equal(r.status, 404);
  assert.match(r.body.toString(), /Page not found/);
  assert.equal((await get('/.auth/login/github')).status, 404);
});

test('moderator pages ask anonymous visitors to sign in (401) with the review-center rules', async () => {
  const r = await get('/moderate/');
  assert.equal(r.status, 401);
  assert.match(r.body.toString(), /Please sign in/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-robots-tag'], 'noindex');
  assert.match(r.headers['content-security-policy'], /form-action 'self' https:\/\/github\.com/);
});

test('any other host name (the test address) is never indexed', async () => {
  const r = await get('/', { 'X-Forwarded-Host': 'app-li-dance-events.azurewebsites.net', 'X-Forwarded-Proto': 'https' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
});

test('resized photos are made once, kept on disk and cached by browsers for a year', async () => {
  const before = globalThis.imageRenders;
  const url = '/_image/?href=%2F_astro%2Fa.jpg&w=320&h=320&f=webp';
  const [a, b] = await Promise.all([get(url), get(url)]);
  assert.equal(a.status, 200);
  assert.equal(a.headers['content-type'], 'image/webp');
  assert.equal(a.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(a.body.toString(), b.body.toString());
  assert.equal(globalThis.imageRenders - before, 1);
  const c = await get(url);
  assert.equal(c.body.toString(), a.body.toString());
  assert.equal(globalThis.imageRenders - before, 1, 'the second visit comes from disk');
  assert.ok(readdirSync(imageCache).length > 0);
  assert.equal((await get('/_image/?href=%2F_astro%2Fa.jpg&w=99999')).status, 400);
  assert.equal((await get('/_image/?href=/missing.png&w=10')).status, 404);
});

test('the visitor address and https address come from App Service forwarding headers', async () => {
  const r = await get('/who/', { 'X-Forwarded-For': '203.0.113.5:51234, 10.0.0.1', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'longisland.dance' });
  const who = JSON.parse(r.body);
  assert.equal(who.clientAddress, '203.0.113.5');
  assert.equal(who.url, 'https://longisland.dance/who/');
  clearPageCache(); // pages are the same for everyone; this stand-in page is not
  const v6 = JSON.parse((await get('/who/', { ...SITE, 'X-Forwarded-For': '[2001:db8::1]:443' })).body);
  assert.equal(v6.clientAddress, '2001:db8::1');
});

test('pages that set cookies are sent with every cookie and never remembered', async () => {
  const before = globalThis.renders;
  const r = await get('/cookies/');
  assert.deepEqual(r.headers['set-cookie'], ['a=1; Path=/', 'b=2; Path=/']);
  await get('/cookies/');
  assert.equal(globalThis.renders - before, 2);
});

test('the website only answers GET and HEAD', async () => {
  const r = await fetch(`${base}/`, { method: 'POST', body: 'x', headers: SITE });
  assert.equal(r.status, 405);
});
