// Copies the self-hosted Decap CMS bundle into public/admin so /admin/ needs no third-party CDN.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  join(root, 'node_modules', 'decap-cms', 'dist', 'decap-cms.js'),
  join(root, 'node_modules', 'decap-cms-app', 'dist', 'decap-cms-app.js'),
];
const source = candidates.find((p) => existsSync(p));
const target = join(root, 'public', 'admin', 'decap-cms.js');

if (!source) {
  console.warn('[copy-cms] Decap CMS bundle not found; /admin/ will not load until dependencies are installed.');
  process.exit(0);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[copy-cms] Copied ${source.replace(root, '.')} -> public/admin/decap-cms.js`);
