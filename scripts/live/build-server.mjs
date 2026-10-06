#!/usr/bin/env node
/**
 * Builds the site for the live server (decision P58) and installs it in server/site:
 *   server/site/client  scripts, styles, fonts, photos and other files
 *   server/site/server  the pages (entry.mjs) and the old host's rules (site-rules.json)
 *
 *   npm run build:server                             pages only; photos are resized when first asked
 *   npm run build:server -- --static-images dist     also bring the resized photos of a static build of the
 *                                                    same commit, so photos keep their static-site addresses
 *
 * The same environment variables as the static build apply (SITE_URL, PUBLIC_*, INDEXNOW_KEY ...).
 * Then: npm start --prefix server
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  const from = join(resolve(root, opt['static-images']), '_astro');
  const to = join(site, 'client', '_astro');
  let copied = 0;
  for (const name of readdirSync(from)) {
    if (!/\.(webp|avif|jpe?g|png|gif)$/i.test(name) || existsSync(join(to, name))) continue;
    copyFileSync(join(from, name), join(to, name));
    copied++;
  }
  console.log(`[build-server] brought ${copied} resized photos from ${opt['static-images']}`);
}
console.log(`[build-server] installed in server/site (${((Date.now() - started) / 1000).toFixed(0)} s)`);