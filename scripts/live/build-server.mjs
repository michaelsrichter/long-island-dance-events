#!/usr/bin/env node
/**
 * Builds the site for the live server (decision P58) and installs it in server/site:
 *   server/site/client  scripts, styles, fonts, photos and other files
 *   server/site/server  the pages (entry.mjs) and the old host's rules (site-rules.json)
 *
 *   npm run build:server                             pages only; photos are resized when first asked
 *   npm run build:server -- --static-images dist     also bring the resized photos and share pictures of a
 *                                                    static build of the same commit: photos keep their
 *                                                    static-site addresses, and share pictures (about 1.4 s
 *                                                    of processor time each on the server) are ready-made
 *
 * The same environment variables as the static build apply (SITE_URL, PUBLIC_*, INDEXNOW_KEY ...).
 * Then: npm start --prefix server
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values: opt } = parseArgs({ options: { 'static-images': { type: 'string' } } });
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
  // Every picture of the static build that the server build does not have: resized photos in /_astro/ and
  // the share pictures (/og/..., /events/<date>/social.png). The comparison (scripts/live/parity.mjs) shows
  // they are the same bytes the server would make.
  const from = resolve(root, opt['static-images']);
  const to = join(site, 'client');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const copied = { photos: 0, share: 0 };
  for (const file of walk(from)) {
    const rel = relative(from, file);
    if (!/\.(webp|avif|jpe?g|png|gif)$/i.test(rel) || existsSync(join(to, rel))) continue;
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    copyFileSync(file, join(to, rel));
    copied[rel.startsWith('_astro') ? 'photos' : 'share']++;
  }
  console.log(`[build-server] brought ${copied.photos} resized photos and ${copied.share} share pictures from ${opt['static-images']}`);
}
console.log(`[build-server] installed in server/site (${((Date.now() - started) / 1000).toFixed(0)} s)`);