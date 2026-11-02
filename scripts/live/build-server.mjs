#!/usr/bin/env node
/**
 * Builds the site for the live server (decision P58) and installs it in server/site:
 *   server/site/client  scripts, styles, fonts, photos and other files
 *   server/site/server  the pages (entry.mjs) and the old host's rules (site-rules.json)
 *
 *   npm run build:server                             pages only; photos are resized when first asked
 *   npm run build:server -- --static-images dist     also bring the resized photos of a static build of the
 *                                                    same commit (photos keep their static-site addresses),
 *                                                    and its share pictures as a read-only seed for the
 *                                                    server's picture store (server/site/og-seed, P64): a
 *                                                    share picture takes about 1.4 s of processor time on the
 *                                                    server, so it is drawn there only when its card changed
 *   --og-cache <dir>                                 where the static build saved its pictures (default
 *                                                    OG_CACHE_DIR or .cache/og)
 *
 * The same environment variables as the static build apply (SITE_URL, PUBLIC_*, INDEXNOW_KEY ...).
 * Then: npm start --prefix server
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values: opt } = parseArgs({ options: { 'static-images': { type: 'string' }, 'og-cache': { type: 'string' } } });
const env = { ...process.env, ASTRO_TARGET: 'server' };

function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const started = Date.now();
rmSync(join(root, 'dist-server'), { recursive: true, force: true });
run([join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build']);
run([join(root, 'scripts', 'postbuild.mjs')]);
for (const part of ['client', 'server']) {
  if (!existsSync(join(root, 'dist-server', part))) {
    console.error(`[build-server] dist-server/${part} is missing`);
    process.exit(1);
  }
}
const site = join(root, 'server', 'site');
rmSync(site, { recursive: true, force: true });
cpSync(join(root, 'dist-server', 'client'), join(site, 'client'), { recursive: true });
cpSync(join(root, 'dist-server', 'server'), join(site, 'server'), { recursive: true });

if (opt['static-images']) {
  // The resized photos in /_astro/ that the server build does not have. The comparison
  // (scripts/live/parity.mjs) shows they are the same bytes the server would make.
  const from = resolve(root, opt['static-images']);
  const to = join(site, 'client');
  const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])) : []);
  const isPicture = (rel) => /\.(webp|avif|jpe?g|png|gif)$/i.test(rel);
  let photos = 0;
  const share = new Set();
  for (const file of walk(from)) {
    const rel = relative(from, file);
    if (!isPicture(rel) || existsSync(join(to, rel))) continue;
    if (!rel.startsWith('_astro')) {
      share.add(createHash('sha256').update(readFileSync(file)).digest('hex'));
      continue;
    }
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    copyFileSync(file, join(to, rel));
    photos++;
  }
  // Share pictures are made by the pages on the server, so they always show the current details. The seed is the
  // static build's saved pictures (src/lib/og.ts): the ones it used (last-build.txt), or else the ones that are
  // exactly this build's share pictures plus every cropped photo and logo plate. The server finds them under the
  // same fingerprint.
  const store = resolve(root, opt['og-cache'] || process.env.OG_CACHE_DIR || join('.cache', 'og'));
  const seed = join(site, 'og-seed');
  const seeded = { pictures: 0, parts: 0 };
  const listFile = join(store, 'last-build.txt');
  const listed = existsSync(listFile) ? readFileSync(listFile, 'utf8').split('\n').filter((l) => /^[0-9a-f]{2}\/[0-9a-f]{64}\.(png|jpg|panel|logo)$/.test(l)) : null;
  const candidates = listed ? listed.map((l) => join(store, l)).filter((f) => existsSync(f)) : walk(store);
  const covered = new Set();
  for (const file of candidates) {
    const kind = file.slice(file.lastIndexOf('.') + 1);
    const part = kind === 'panel' || kind === 'logo';
    if (!part && kind !== 'png' && kind !== 'jpg') continue;
    if (!part) {
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (!listed && !share.has(hash)) continue;
      covered.add(hash);
    }
    const dest = join(seed, basename(dirname(file)), basename(file));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    seeded[part ? 'parts' : 'pictures']++;
  }
  const missing = [...share].filter((h) => !covered.has(h)).length;
  console.log(`[build-server] brought ${photos} resized photos from ${opt['static-images']}`);
  console.log(
    `[build-server] share pictures: ${seeded.pictures} ready in server/site/og-seed (+${seeded.parts} photo crops and logo plates) from ${relative(root, store) || store}${listed ? ' (last-build.txt)' : ''}; ${missing} of the build's ${share.size} not found there`,
  );
  // The seed only matches when the server draws with the same code, fonts and libraries as the static build.
  const req = (dir) => createRequire(join(dir, 'package.json'));
  for (const name of ['satori', 'sharp', '@fontsource/inter']) {
    const version = (dir) => {
      try {
        return JSON.parse(readFileSync(req(dir).resolve(`${name}/package.json`), 'utf8')).version;
      } catch {
        return undefined;
      }
    };
    const [a, b] = [version(root), version(join(root, 'server'))];
    if (b && a !== b) console.warn(`[build-server] WARNING: ${name} ${a} (site) and ${b} (server) differ: the server will draw share pictures again`);
  }
}
console.log(`[build-server] installed in server/site (${((Date.now() - started) / 1000).toFixed(0)} s)`);