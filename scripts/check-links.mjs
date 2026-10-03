// Checks every internal link, image and #fragment in the built site (dist/).
// Usage: node scripts/check-links.mjs [--external]   (--external also checks outbound links; slower, network)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const checkExternal = process.argv.includes('--external');
const SITE = (process.env.SITE_URL || 'https://example.org').replace(/\/$/, '');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (name.endsWith('.html')) yield p;
  }
}
const idCache = new Map();
const idsOf = (file) => {
  if (!idCache.has(file)) idCache.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return idCache.get(file);
};
const resolveFile = (pathname) => {
  const clean = decodeURIComponent(pathname);
  const direct = join(dist, clean);
  if (clean.endsWith('/')) return existsSync(join(direct, 'index.html')) ? join(direct, 'index.html') : null;
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  if (existsSync(join(direct, 'index.html'))) return join(direct, 'index.html');
  return null;
};

const broken = [];
const external = new Map();
let checked = 0;
for (const file of files(dist)) {
  const rel = '/' + relative(dist, file).replace(/\\/g, '/').replace(/index\.html$/, '');
  if (rel.startsWith('/index.php/')) continue; // legacy redirect pages are verified by unit tests
  const html = readFileSync(file, 'utf8');
  const refs = [
    ...[...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<(?:img|source|script|link)\b[^>]*\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+/)[0])),
  ];
  for (const raw of refs) {
    const href = raw.replace(/&amp;/g, '&');
    if (/^(mailto:|tel:|sms:|data:|javascript:)/.test(href)) continue;
    const own = href.startsWith(SITE + '/') ? href.slice(SITE.length) : null;
    if (/^https?:\/\//.test(href) && own === null) {
      if (!external.has(href)) external.set(href, rel);
      continue;
    }
    checked++;
    const url = new URL(own ?? href, `https://site.local${rel}`);
    if (url.pathname.startsWith('/api/')) continue;
    const target = resolveFile(url.pathname);
    if (!target) {
      broken.push(`${rel} -> ${href} (missing page)`);
      continue;
    }
    if (url.hash && target.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1));
      if (id && !idsOf(target).has(id)) broken.push(`${rel} -> ${href} (missing #${id})`);
    }
  }
}

if (checkExternal) {
  const skip = /(google\.com\/maps|maps\.apple\.com|calendar\.google\.com|outlook\.(live|office)\.com|facebook\.com\/sharer)/;
  for (const [href, from] of external) {
    if (skip.test(href)) continue;
    try {
      const res = await fetch(href, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'Riverbend link checker' }, signal: AbortSignal.timeout(15000) });
      if (res.status >= 400 && res.status !== 403 && res.status !== 429) broken.push(`${from} -> ${href} (HTTP ${res.status})`);
    } catch (e) {
      broken.push(`${from} -> ${href} (${e.name})`);
    }
  }
}

console.log(`[links] checked ${checked} internal references${checkExternal ? ` and ${external.size} external links` : ` (${external.size} external links not checked)`}.`);
if (broken.length) {
  console.error(`[links] ${broken.length} broken:\n  ${[...new Set(broken)].slice(0, 100).join('\n  ')}`);
  process.exit(1);
}
console.log('[links] no broken links.');
