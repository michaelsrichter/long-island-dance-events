// Post-build steps:
// 1. Compute CSP hashes for inline scripts and write the final Content-Security-Policy into
//    dist/staticwebapp.config.json.
// 2. Fail the build if HTML contains inline style attributes (blocked by the CSP).
// 3. With ASTRO_TARGET=server (the live server, decision P58), write the same rules for the server instead:
//    dist-server/server/site-rules.json (pages are made later, so the server adds each page's hashes).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspBuilders, inlineScriptHashes } from './lib/csp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverTarget = process.env.ASTRO_TARGET === 'server';
const dist = serverTarget ? join(root, 'dist-server', 'client') : join(root, 'dist');
const csp = cspBuilders(root);

function writeIndexNowKey() {
  const indexNowKey = (process.env.INDEXNOW_KEY || '').trim();
  if (!indexNowKey) return;
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(indexNowKey)) {
    console.error('[postbuild] INDEXNOW_KEY must be 8-128 letters, digits or dashes.');
    process.exit(1);
  }
  writeFileSync(join(dist, `${indexNowKey}.txt`), indexNowKey);
  console.log('[postbuild] wrote the IndexNow key file');
}

if (serverTarget) {
  const cfgPath = join(dist, 'staticwebapp.config.json');
  const swa = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const rules = {
    note: 'Made by scripts/postbuild.mjs from public/staticwebapp.config.json; used by server/src/rules.js.',
    csp: { __SITE_CSP__: csp.site(['__HASHES__']), __REVIEW_CSP__: csp.review(['__HASHES__']), __ADMIN_CSP__: csp.admin },
    globalHeaders: swa.globalHeaders,
    routes: swa.routes,
    responseOverrides: swa.responseOverrides,
    mimeTypes: swa.mimeTypes,
  };
  writeFileSync(join(root, 'dist-server', 'server', 'site-rules.json'), JSON.stringify(rules, null, 2) + '\n');
  // The old host hides this file; the server has no use for it.
  rmSync(cfgPath);
  console.log(`[postbuild] server rules: ${rules.routes.length} routes`);
  writeIndexNowKey();
  process.exit(0);
}
// ---------- CSP ----------
function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}
const hashes = new Set();
const reviewHashes = new Set();
const styleViolations = [];
for (const file of htmlFiles(dist)) {
  if (file.includes(join('dist', 'admin'))) continue;
  const html = readFileSync(file, 'utf8');
  const isReview = file.includes(join('dist', 'moderate'));
  for (const h of inlineScriptHashes(html, createHash)) {
    hashes.add(h);
    if (isReview) reviewHashes.add(h);
  }
  if (/\sstyle="/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, ''))) styleViolations.push(file.replace(dist, ''));
}

const siteCsp = csp.site(hashes);
// The review center (/moderate/) uses only its own script hashes (decision P51).
const reviewCsp = csp.review(reviewHashes);
const adminCsp = csp.admin;

const cfgPath = join(dist, 'staticwebapp.config.json');
const cfg = readFileSync(cfgPath, 'utf8').replace('__SITE_CSP__', siteCsp).replace('__ADMIN_CSP__', adminCsp).replace('__REVIEW_CSP__', reviewCsp);
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

// ---------- IndexNow key file (lets the deploy step announce changed pages to Bing and others) ----------
writeIndexNowKey();
