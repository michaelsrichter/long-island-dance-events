// Post-build steps:
// 1. Compute CSP hashes for inline scripts and write the final Content-Security-Policy into
//    dist/staticwebapp.config.json.
// 2. Fail the build if HTML contains inline style attributes (blocked by the CSP).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// ---------- CSP ----------
function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}
const hashes = new Set();
const styleViolations = [];
for (const file of htmlFiles(dist)) {
  if (file.includes(join('dist', 'admin'))) continue;
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim()) hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  if (/\sstyle="/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, ''))) styleViolations.push(file.replace(dist, ''));
}

const thirdPartyScripts = ['https://www.googletagmanager.com', 'https://www.clarity.ms', 'https://*.clarity.ms'];
const thirdPartyConnect = [
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
  'https://*.clarity.ms',
  'https://c.bing.com',
];
const thirdPartyImg = ['https://*.google-analytics.com', 'https://*.googletagmanager.com', 'https://*.clarity.ms', 'https://c.bing.com', 'https://tile.openstreetmap.org'];
const siteCsp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')} ${thirdPartyScripts.join(' ')}`.replace(/\s+/g, ' ').trim(),
  "style-src 'self'",
  `img-src 'self' data: ${thirdPartyImg.join(' ')}`,
  "font-src 'self'",
  "media-src 'self'",
  `connect-src 'self' ${thirdPartyConnect.join(' ')}`,
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');
const adminCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.githubusercontent.com https://github.com",
  "media-src 'self' blob: https://*.githubusercontent.com",
  "connect-src 'self' https://api.github.com https://*.githubusercontent.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

const cfgPath = join(dist, 'staticwebapp.config.json');
const cfg = readFileSync(cfgPath, 'utf8').replace('__SITE_CSP__', siteCsp).replace('__ADMIN_CSP__', adminCsp);
JSON.parse(cfg);
writeFileSync(cfgPath, cfg);
const size = Buffer.byteLength(cfg);
console.log(`[postbuild] inline script hashes: ${hashes.size}; staticwebapp.config.json: ${size} bytes`);
if (size > 20 * 1024) {
  console.error('[postbuild] staticwebapp.config.json exceeds the 20 KB Azure Static Web Apps limit.');
  process.exit(1);
}
if (styleViolations.length) {
  console.error(`[postbuild] Inline style attributes found (blocked by CSP):\n  ${styleViolations.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
