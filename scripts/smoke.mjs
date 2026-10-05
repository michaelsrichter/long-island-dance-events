// Smoke tests for a deployed environment. Usage: node scripts/smoke.mjs https://<host>
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
if (!base) { console.error('Usage: node scripts/smoke.mjs https://your-site'); process.exit(1); }
const results = [];
const check = async (name, fn) => { try { results.push({ name, ok: true, detail: (await fn()) ?? '' }); } catch (e) { results.push({ name, ok: false, detail: e.message }); } };
const get = (path, opts = {}) => fetch(base + path, { redirect: 'manual', ...opts });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const EVENT_TYPES = new Set(['Event', 'DanceEvent', 'MusicEvent', 'EducationEvent', 'Festival', 'SocialEvent']);
let firstEvent = '';

await check('Homepage loads with search and quick links', async () => {
  const r = await get('/'); assert(r.status === 200, `status ${r.status}`);
  const html = await r.text(); assert(/<h1 id="hero-title"[^>]*>[^<]*Dance and/.test(html), 'missing hero heading');
  assert(html.includes('data-quick-links') || html.includes('quick-links'), 'missing quick links');
  return html.match(/<title>([^<]+)/)?.[1];
});
await check('Events list has listings', async () => {
  const r = await get('/events/'); assert(r.status === 200, `status ${r.status}`);
  const html = await r.text(); const links = [...html.matchAll(/href="(\/events\/\d{4}-\d{2}-\d{2}-[^"/]+\/)"/g)].map((m) => m[1]);
  assert(links.length > 5, `only ${links.length} event links`); firstEvent = links[0];
  return `${new Set(links).size} event links`;
});
for (const path of ['/events/calendar/', '/events/map/', '/venues/', '/organizers/', '/instructors/', '/performers/', '/styles/', '/sources/', '/faq/', '/about/']) {
  await check(`Page ${path}`, async () => { const r = await get(path); assert(r.status === 200, `status ${r.status}`); });
}
await check('Security headers', async () => {
  const h = (await get('/')).headers;
  for (const k of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'strict-transport-security']) assert(h.get(k), `missing ${k}`);
  assert(/frame-ancestors 'none'/.test(h.get('content-security-policy')), 'CSP missing frame-ancestors');
});
await check('Custom 404', async () => { const r = await get('/no-such-page/'); assert(r.status === 404, `status ${r.status}`); assert((await r.text()).includes('Oops, we missed a step'), 'not custom page'); });
await check('Sitemap', async () => { const r = await get('/sitemap-index.xml'); assert(r.status === 200, `status ${r.status}`); const idx = await r.text(); const maps = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname); assert(maps.length >= 5, `only ${maps.length} sitemaps`); let n = 0; for (const m of maps) { const s = await (await get(m)).text(); n += (s.match(/<loc>/g) || []).length; assert(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(s), `no lastmod in ${m}`); } assert(n > 20, `only ${n} URLs`); return `${maps.length} sitemaps, ${n} URLs`; });
await check('llms-full.txt and upcoming.json', async () => { const t = await (await get('/llms-full.txt')).text(); assert(t.includes('http'), 'empty'); const j = await (await get('/events/upcoming.json')).json(); assert(Array.isArray(j.events), 'no events'); return `${j.events.length} events`; });
await check('robots.txt', async () => { const t = await (await get('/robots.txt')).text(); assert(/User-agent/.test(t), 'invalid'); });
await check('llms.txt', async () => { const t = await (await get('/llms.txt')).text(); assert(t.includes('Nassau and Suffolk'), 'missing area'); });
await check('Calendar feed', async () => { const feed = await get('/events/all.ics'); assert(/text\/calendar/.test(feed.headers.get('content-type') || ''), 'feed content type'); const body = await feed.text(); assert(body.startsWith('BEGIN:VCALENDAR'), 'not iCalendar'); return `${(body.match(/BEGIN:VEVENT/g) || []).length} events in feed`; });
await check('RSS feed', async () => { const r = await get('/events/rss.xml'); assert(r.status === 200, `status ${r.status}`); assert((await r.text()).includes('<rss'), 'not RSS'); });
await check('Event structured data', async () => {
  assert(firstEvent, 'no event link found on /events/');
  const html = await (await get(firstEvent)).text();
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const j = JSON.parse(m[1]); return j['@graph'] || [j]; });
  const ev = blocks.find((b) => EVENT_TYPES.has(b['@type']));
  // A date alone is valid schema.org when the start time is not known.
  assert(ev && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/.test(ev.startDate), 'event JSON-LD missing or bad startDate');
  return `${ev['@type']}: ${ev.name}`;
});
await check('CMS admin page', async () => { const r = await get('/admin/'); assert(r.status === 200, `status ${r.status}`); assert((await r.text()).includes('decap-cms.js'), 'bundle not referenced'); const cfg = await (await get('/admin/config.yml')).text(); assert(cfg.includes('long-island-dance-events'), 'config not found'); });
await check('CMS sign-in endpoint', async () => { const r = await get('/api/auth?provider=github&scope=public_repo'); if (r.status === 302) return `redirects to ${new URL(r.headers.get('location')).host}`; assert(r.status === 503, `status ${r.status}`); return '503: OAuth not configured yet'; });
await check('Telemetry endpoint rejects cross-origin posts', async () => { const r = await get('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' }); assert(r.status === 403, `status ${r.status}`); });

// ---------- Community: sign-in, API protection, public data ----------
const COMMUNITY_KEY = 'venue:huntington-moose-lodge';
let blobBase = '';
await check('Visitor sign-in goes to Entra External ID', async () => {
  // SWA first redirects to itself (adding a nonce and a cookie), then to the identity provider.
  let url = `${base}/.auth/login/extid`;
  const jar = new Map();
  for (let hop = 0; hop < 4; hop++) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i).trim(), pair.slice(i + 1)); }
    assert(r.status === 302, `hop ${hop}: status ${r.status}`);
    const next = new URL(r.headers.get('location'), url);
    if (next.host !== new URL(base).host) {
      assert(next.host.endsWith('.ciamlogin.com'), `redirects to ${next.host}`);
      return `redirects to ${next.host}`;
    }
    url = next.toString();
  }
  throw new Error('too many redirects');
});
await check('Signed-out visitors are anonymous', async () => {
  const me = await (await get('/.auth/me')).json();
  assert(me.clientPrincipal === null, 'expected no signed-in user');
  const api = await (await get('/api/me')).json();
  assert(api.signedIn === false, 'api/me should say signed out');
});
await check('Community pages list', async () => {
  const r = await get('/community-pages.json'); assert(r.status === 200, `status ${r.status}`);
  const data = await r.json(); assert(data.keys.includes(COMMUNITY_KEY), `missing ${COMMUNITY_KEY}`);
  return `${data.keys.length} pages`;
});
await check('Likes and notes need sign-in and our own pages', async () => {
  const body = JSON.stringify({ key: COMMUNITY_KEY, like: true });
  const anon = await get('/api/likes', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body });
  assert(anon.status === 401, `signed-out like: status ${anon.status}`);
  const cross = await get('/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ key: COMMUNITY_KEY, text: 'hi' }) });
  assert(cross.status === 403, `cross-site note: status ${cross.status}`);
});
await check('Moderator API is locked', async () => { const r = await get('/api/moderation/queue'); assert(r.status === 401 || r.status === 403, `status ${r.status}`); return `status ${r.status}`; });
await check('Venue page has the community panel and CSP allows its data', async () => {
  const r = await get('/venues/huntington-moose-lodge/');
  const html = await r.text();
  const m = html.match(/data-src="(https:\/\/[^"]+\/community\/venue\/huntington-moose-lodge\.json)"/);
  assert(m, 'panel missing');
  blobBase = new URL(m[1]).origin;
  const csp = r.headers.get('content-security-policy') || '';
  assert(csp.includes(blobBase), 'CSP does not allow the community data host');
  return blobBase;
});
await check('Community data allows our site (CORS)', async () => {
  assert(blobBase, 'no data host');
  const origin = new URL(base).origin;
  const r = await fetch(`${blobBase}/community/counts/venue.json`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } });
  assert(r.status === 200, `preflight status ${r.status}`);
  assert(r.headers.get('access-control-allow-origin') === origin || r.headers.get('access-control-allow-origin') === '*', 'origin not allowed');
});
await check('Account and rules pages', async () => {
  for (const p of ['/account/', '/community-rules/']) { const r = await get(p); assert(r.status === 200, `${p} status ${r.status}`); }
});
await check('Review center is for editors only', async () => {
  // Signed-out visitors get the route rule's 401, shown as our "You're signed out" page with a Sign in button.
  const page = await get('/moderate/');
  assert(page.status === 401, `/moderate/ status ${page.status}`);
  assert(!(await page.text()).includes('data-review-app'), '/moderate/ served the review center to a signed-out visitor');
  for (const p of ['/api/review/status', '/api/review/listings', '/api/moderation/queue']) {
    const r = await get(p);
    assert(r.status === 401 || r.status === 403, `${p} status ${r.status}`);
  }
  return 'sign-in required';
});

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} smoke checks passed against ${base}`);
process.exit(failed ? 1 : 0);
