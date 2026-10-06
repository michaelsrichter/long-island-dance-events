#!/usr/bin/env node
/**
 * "A change shows in seconds" check for the live server (decision P59):
 *
 *   DATABASE_URL=postgres://... node scripts/live/change-check.mjs --base http://127.0.0.1:8080 [--venue <id>] [--limit 10]
 *
 * Changes one venue's name in the database (as an editor would), raises the data version, and measures how
 * long until the venue's page shows the new name. Then puts the old name back and checks again. Use it only
 * on a test database: for a few seconds the venue has "(live check)" in its name.
 */
import { parseArgs } from 'node:util';
import { closePool, getPool } from '../../server/src/lib/db.js';

const { values: opt } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:8080' },
    host: { type: 'string', default: 'longisland.dance' },
    venue: { type: 'string' },
    limit: { type: 'string', default: '10' },
  },
});
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must point at a test database.');
  process.exit(2);
}

const pool = getPool();
const limitMs = Number(opt.limit) * 1000;

async function page(path) {
  const res = await fetch(opt.base + path, { headers: { 'x-forwarded-host': opt.host, 'x-forwarded-proto': 'https' } });
  return res.status === 200 ? res.text() : '';
}
const pageShows = async (path, text) => (await page(path)).includes(text);

async function setVenue(id, raw) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE venues SET raw = $2, doc = $3::jsonb, version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1', [id, raw, raw, 'change-check']);
    await c.query('UPDATE site_state SET data_version = data_version + 1 WHERE id = 1');
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** Milliseconds until the page passes `test`, or null after the limit. */
async function waitFor(path, test) {
  const started = Date.now();
  while (Date.now() - started < limitMs) {
    if (test(await page(path))) return Date.now() - started;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// A venue with a page and a plain name (no characters that HTML writes differently, like & or ').
const candidates = (await pool.query(opt.venue ? 'SELECT id, raw FROM venues WHERE id = $1' : 'SELECT id, raw FROM venues ORDER BY id', opt.venue ? [opt.venue] : [])).rows;
let row;
for (const r of candidates) {
  const n = String(JSON.parse(r.raw).name ?? '');
  if (/^[A-Za-z0-9 ,.-]+$/.test(n) && (await pageShows(`/venues/${r.id}/`, `${n}<`))) {
    row = r;
    break;
  }
}
if (!row) throw new Error('No venue page to change.');
const path = `/venues/${row.id}/`;
const before = JSON.parse(row.raw);
const name = String(before.name);

const marked = `${name} (live check)`;
let failed = false;
try {
  await setVenue(row.id, JSON.stringify({ ...before, name: marked }, null, 2) + '\n');
  const shown = await waitFor(path, (html) => html.includes(marked));
  console.log(shown === null ? `[change-check] FAILED: ${path} did not show the new name within ${opt.limit} s` : `[change-check] new name on ${path} after ${(shown / 1000).toFixed(1)} s`);
  failed = shown === null;
} finally {
  await setVenue(row.id, row.raw);
}
const back = await waitFor(path, (html) => html.includes(`${name}<`) && !html.includes(marked));
console.log(back === null ? `[change-check] FAILED: the old name did not come back` : `[change-check] old name back after ${(back / 1000).toFixed(1)} s`);
await closePool();
process.exit(failed || back === null ? 1 : 0);
