/**
 * The round-trip check of the nightly database sync (decision P56): the database's export must give back
 * every file in src/content/ exactly, byte for byte, with nothing missing and nothing extra.
 *
 *   npx tsx scripts/db/compare-export.ts --export export.json
 *
 * Writes a short report to the GitHub step summary when it runs in Actions. Exit code 1 on any difference.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { listContentFiles } from './content-files';

export interface ExportFile {
  path: string;
  raw: string;
}

export function compareExport(root: string, files: ExportFile[]) {
  const git = new Map(listContentFiles(root).map((f) => [f.path, f.bytes]));
  const db = new Map(files.map((f) => [f.path, Buffer.from(f.raw, 'utf8')]));
  const missing = [...git.keys()].filter((p) => !db.has(p));
  const extra = [...db.keys()].filter((p) => !git.has(p));
  const different = [...git.entries()].filter(([p, bytes]) => db.has(p) && !db.get(p)!.equals(bytes)).map(([p]) => p);
  return { ok: !missing.length && !extra.length && !different.length, files: git.size, missing, extra, different };
}

function main() {
  const args = process.argv.slice(2);
  const file = args[args.indexOf('--export') + 1];
  if (!args.includes('--export') || !file) {
    console.error('Usage: tsx scripts/db/compare-export.ts --export export.json');
    process.exit(2);
  }
  const buf = readFileSync(file);
  const body = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')) as { files: ExportFile[]; dataVersion?: number };
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const r = compareExport(root, body.files);
  const list = (title: string, items: string[]) => (items.length ? `\n**${title} (${items.length}):** ${items.slice(0, 20).map((p) => `\`${p}\``).join(', ')}${items.length > 20 ? ' ...' : ''}\n` : '');
  const report =
    `### Database round trip: ${r.ok ? 'identical' : 'DIFFERENT'}\n\n` +
    `${r.files} files in git; the database gave back ${body.files.length} (data version ${body.dataVersion ?? '?'}).\n` +
    list('In git but not in the database', r.missing) +
    list('In the database but not in git', r.extra) +
    list('Different text', r.different);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
