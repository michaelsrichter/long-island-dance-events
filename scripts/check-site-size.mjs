// Fails when the built site gets close to the Azure Static Web Apps limits
// (Standard plan: 15,000 files and 500 MB per environment). We stop well before them so
// pull-request previews and the nightly rebuild never hit the wall.
//   node scripts/check-site-size.mjs [dist] [--max-files=12000] [--max-mb=400]
import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const dist = args.find((a) => !a.startsWith('--')) ?? 'dist';
const opt = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const maxFiles = opt('max-files', 12000);
const maxMb = opt('max-mb', 400);

let files = 0;
let bytes = 0;
const byExt = new Map();
const byDir = new Map();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      files++;
      bytes += s.size;
      const ext = extname(name) || '(none)';
      const top = relative(dist, p).split(sep)[0];
      const e = byExt.get(ext) ?? [0, 0];
      byExt.set(ext, [e[0] + 1, e[1] + s.size]);
      const d = byDir.get(top) ?? [0, 0];
      byDir.set(top, [d[0] + 1, d[1] + s.size]);
    }
  }
};
walk(dist);

const mb = (b) => (b / 1024 / 1024).toFixed(1);
const table = (m) =>
  [...m]
    .sort((a, b) => b[1][1] - a[1][1])
    .slice(0, 10)
    .map(([k, [n, b]]) => `  ${k.padEnd(18)} ${String(n).padStart(6)} files ${mb(b).padStart(7)} MB`)
    .join('\n');
console.log(`[site-size] ${files} files, ${mb(bytes)} MB (limits we enforce: ${maxFiles} files, ${maxMb} MB; Azure allows 15000 and 500)`);
console.log(`By type:\n${table(byExt)}\nBy folder:\n${table(byDir)}`);
if (files > maxFiles || bytes > maxMb * 1024 * 1024) {
  console.error(`[site-size] The site is too big for comfort. See docs/how-weekly-updates-work.md ("How big the website can get").`);
  process.exit(1);
}
