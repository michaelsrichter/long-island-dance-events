// Smoke tests for a deployed environment. Usage: node scripts/smoke.mjs https://<host>
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
if (!base) { console.error('Usage: node scripts/smoke.mjs https://your-site'); process.exit(1); }
const results = [];
const check = async (name, fn) => { try { results.push({ name, ok: true, detail: (await fn()) ?? '' }); } catch (e) { results.push({ name, ok: false, detail: e.message }); } };
const get = (path, opts = {}) => fetch(base + path, { redirect: 'manual', ...opts });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('Homepage loads with the next home dance', async () => {
  const r = await get('/'); assert(r.status === 200, `status ${r.status}`);
  const html = await r.text(); assert(html.includes('Next Riverbend dance'), 'missing next-dance card');
  return html.match(/<title>([^<]+)/)?.[1];
});
await check('Community page and community calendar feed', async () => {
  const r = await get('/community/'); assert(r.status === 200, `status ${r.status}`);
  const feed = await get('/events/community-events.ics'); assert(/text\/calendar/.test(feed.headers.get('content-type') || ''), 'feed content type');
  return `${((await feed.text()).match(/BEGIN:VEVENT/g) || []).length} community events in feed`;
});
await check('Security headers', async () => {
  const h = (await get('/')).headers;
  for (const k of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'strict-transport-security']) assert(h.get(k), `missing ${k}`);
  assert(/frame-ancestors 'none'/.test(h.get('content-security-policy')), 'CSP missing frame-ancestors');
});
for (const [from, to] of [['/index.php', '/'], ['/events.php', '/events/'], ['/contact.php', '/contact/']]) {
  await check(`301 ${from}`, async () => { const r = await get(from); assert(r.status === 301, `status ${r.status}`); const loc = new URL(r.headers.get('location'), base).pathname; assert(loc === to, `location ${loc}`); return `→ ${loc}`; });
}
await check('Custom 404', async () => { const r = await get('/no-such-page/'); assert(r.status === 404, `status ${r.status}`); assert((await r.text()).includes('Oops, we missed a step'), 'not custom page'); });
await check('Sitemap', async () => { const r = await get('/sitemap-index.xml'); assert(r.status === 200, `status ${r.status}`); const s = await (await get('/sitemap-0.xml')).text(); const n = (s.match(/<loc>/g) || []).length; assert(n > 20, `only ${n} URLs`); return `${n} URLs`; });
await check('robots.txt', async () => { const t = await (await get('/robots.txt')).text(); assert(/User-agent/.test(t), 'invalid'); });
await check('llms.txt', async () => { const t = await (await get('/llms.txt')).text(); assert(t.includes('(555) 010-0123'), 'missing hotline'); });
await check('Calendar feed and event .ics', async () => { const feed = await get('/events/club-events.ics'); assert(/text\/calendar/.test(feed.headers.get('content-type') || ''), 'feed content type'); const body = await feed.text(); assert(body.startsWith('BEGIN:VCALENDAR'), 'not iCalendar'); return `${(body.match(/BEGIN:VEVENT/g) || []).length} events in feed`; });
await check('Event structured data', async () => { const html = await (await get('/events/2026-10-17-saturday-stomp-live-band/')).text(); const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])); const ev = blocks.find((b) => b['@type'] === 'DanceEvent'); assert(ev && ev.startDate === '2026-10-17T19:30:00-04:00', 'DanceEvent missing or wrong date'); return ev.name; });
await check('CMS admin page', async () => { const r = await get('/admin/'); assert(r.status === 200, `status ${r.status}`); assert((await r.text()).includes('decap-cms.js'), 'bundle not referenced'); const cfg = await (await get('/admin/config.yml')).text(); assert(cfg.includes('example/community-site-starter'), 'config not found'); });
await check('CMS sign-in endpoint', async () => { const r = await get('/api/auth?provider=github&scope=public_repo'); if (r.status === 302) return `redirects to ${new URL(r.headers.get('location')).host}`; assert(r.status === 503, `status ${r.status}`); return '503: OAuth not configured yet'; });
await check('Telemetry endpoint rejects cross-origin posts', async () => { const r = await get('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' }); assert(r.status === 403, `status ${r.status}`); });

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} smoke checks passed against ${base}`);
process.exit(failed ? 1 : 0);
