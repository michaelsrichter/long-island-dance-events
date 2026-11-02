#!/usr/bin/env node
/**
 * Page-for-page comparison of the live server with the static build (decision P58, migration plan step
 * "parallel site"): every file in the static build is fetched from the server and compared.
 *
 *   node scripts/live/parity.mjs --static dist --base http://127.0.0.1:8080 [--host longisland.dance] [--only events/] [--show 10]
 *
 * Known harmless differences are ignored: times of the build or the request, calendar stamps, the random id
 * of the logo gradient and the release id (the commit a page was built from). Pictures whose bytes differ
 * (for example made on another operating system) are compared by their pixels: same size, and at most
 * 0.5% of the pixels visibly different. Exit code 1 when anything else differs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

// The picture library comes with the server (server/package.json).
const sharp = createRequire(new URL('../../server/package.json', import.meta.url))('sharp');

const { values: opt } = parseArgs({
  options: {
    static: { type: 'string', default: 'dist' },
    base: { type: 'string', default: 'http://127.0.0.1:8080' },
    host: { type: 'string', default: 'longisland.dance' },
    only: { type: 'string', default: '' },
    show: { type: 'string', default: '10' },
    concurrency: { type: 'string', default: '8' },
  },
});

/** Files the old host makes itself, or that only exist in one of the two builds on purpose. */
const SKIP = [/^staticwebapp\.config\.json$/, /^[a-zA-Z0-9-]{8,128}\.txt$/ /* IndexNow key */];
/** Addresses that answer differently on purpose, on both hosts: moderator pages ask signed-out visitors to sign in. */
const STATUS = { '404.html': 404, 'moderate/index.html': 401 };

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

export function normalize(text) {
  return text
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)/g, '<time>')
    .replace(/DTSTAMP:\d{8}T\d{6}Z/g, 'DTSTAMP:<time>')
    .replace(/logo-g-[a-z0-9]+/g, 'logo-g-<id>')
    .replace(/data-release="[^"]*"/g, 'data-release="<release>"');
}

const PICTURE = /\.(png|jpe?g|webp|avif|gif)$/i;

/** Same picture? Compares decoded pixels; a channel counts as different when it is off by more than 24 of 255. */
export async function samePicture(a, b) {
  const [x, y] = await Promise.all([a, b].map((buf) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) return { same: false, why: `size ${x.info.width}x${x.info.height} vs ${y.info.width}x${y.info.height}` };
  let off = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (Math.abs(x.data[i] - y.data[i]) > 24 || Math.abs(x.data[i + 1] - y.data[i + 1]) > 24 || Math.abs(x.data[i + 2] - y.data[i + 2]) > 24) off++;
  }
  const share = off / (x.info.width * x.info.height);
  return { same: share <= 0.005, why: `${(share * 100).toFixed(2)}% of pixels differ` };
}

function urlFor(file) {
  if (file === 'index.html') return '/';
  if (file === '404.html') return '/404/';
  if (file.endsWith('/index.html')) return '/' + file.slice(0, -'index.html'.length);
  return '/' + file;
}

const TEXT = /\.(html|xml|json|txt|ics|yml|css|js|mjs|svg|webmanifest)$/;

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const from = Math.max(0, i - 80);
  return { static: a.slice(from, Math.min(a.length - j + 40, from + 400)), server: b.slice(from, Math.min(b.length - j + 40, from + 400)) };
}

async function main() {
  const root = opt.static;
  const files = walk(root)
    .map((f) => relative(root, f).replaceAll('\\', '/'))
    .filter((f) => !SKIP.some((re) => re.test(f)) && f.startsWith(opt.only))
    .sort();
  const results = { same: 0, pixelSame: 0, differ: [], missing: [], failed: [] };
  const queue = [...files];
  const started = performance.now();
  const times = [];
  async function worker() {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
      const url = urlFor(f);
      const want = STATUS[f] ?? 200;
      const t = performance.now();
      let res;
      try {
        res = await fetch(opt.base + url, { headers: { 'x-forwarded-host': opt.host, 'x-forwarded-proto': 'https' }, redirect: 'manual' });
      } catch (err) {
        results.failed.push({ f, error: err.message });
        continue;
      }
      const body = Buffer.from(await res.arrayBuffer());
      times.push(performance.now() - t);
      if (res.status !== want) {
        results.missing.push({ f, url, status: res.status });
        continue;
      }
      if (want === 401) {
        results.same++;
        continue;
      }
      const local = readFileSync(join(root, f));
      if (local.equals(body) || (TEXT.test(f) && normalize(local.toString('utf8')) === normalize(body.toString('utf8')))) {
        results.same++;
        continue;
      }
      if (PICTURE.test(f)) {
        const p = await samePicture(local, body).catch((err) => ({ same: false, why: err.message }));
        if (p.same) {
          results.same++;
          results.pixelSame++;
          continue;
        }
        results.differ.push({ f, url, sizes: [local.length, body.length], why: p.why });
        continue;
      }
      results.differ.push({
        f,
        url,
        sizes: [local.length, body.length],
        ...(TEXT.test(f) ? firstDifference(normalize(local.toString('utf8')), normalize(body.toString('utf8'))) : {}),
      });
    }
  }
  await Promise.all(Array.from({ length: Number(opt.concurrency) }, worker));
  times.sort((a, b) => a - b);
  const pct = (p) => (times.length ? times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))].toFixed(0) : '-');
  const show = Number(opt.show);
  const byExt = (list) => list.reduce((m, x) => ((m[x.f.split('.').pop()] = (m[x.f.split('.').pop()] || 0) + 1), m), {});
  console.log(`[parity] ${files.length} files: ${results.same} identical${results.pixelSame ? ` (${results.pixelSame} pictures by their pixels)` : ''}, ${results.differ.length} different, ${results.missing.length} missing, ${results.failed.length} failed`);
  console.log(`[parity] answer times: median ${pct(50)} ms, 95% ${pct(95)} ms, slowest ${pct(100)} ms; total ${((performance.now() - started) / 1000).toFixed(1)} s`);
  if (results.missing.length) {
    console.log('[parity] missing by type', byExt(results.missing));
    for (const m of results.missing.slice(0, show)) console.log(`  ${m.status} ${m.url}`);
  }
  if (results.differ.length) {
    console.log('[parity] different by type', byExt(results.differ));
    for (const d of results.differ.slice(0, show)) {
      console.log(`  ${d.url} (${d.sizes.join(' vs ')} bytes)${d.why ? `: ${d.why}` : ''}`);
      if (d.static !== undefined) {
        console.log(`    static: ${JSON.stringify(d.static)}`);
        console.log(`    server: ${JSON.stringify(d.server)}`);
      }
    }
  }
  for (const x of results.failed.slice(0, show)) console.log(`  failed ${x.f}: ${x.error}`);
  process.exit(results.differ.length || results.missing.length || results.failed.length ? 1 : 0);
}

await main();
