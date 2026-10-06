/**
 * Sitemap "last changed" dates in PostgreSQL (decision P59; table from migrations/003_sitemap_state.sql).
 *
 * src/lib/sitemap.ts calls `load()` for the dates it knew before and `save()` with the new list. A page keeps
 * its date while the facts it shows stay the same; it gets today's date when they change. The first time
 * (empty table) the dates come from the live site's /sitemap-state.json, so nothing looks changed.
 */
import { getPool } from './lib/db.js';
import { ensureMigrated } from './lib/migrate.js';

let last = null;

function seedUrl() {
  if (process.env.SITEMAP_SEED_URL) return process.env.SITEMAP_SEED_URL;
  return process.env.SITE_URL ? new URL('/sitemap-state.json', process.env.SITE_URL).toString() : '';
}

async function seed() {
  const url = seedUrl();
  if (!url || /example\.org/.test(url)) return {};
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const body = await res.json();
    console.log(`[sitemap] first dates from ${url}: ${Object.keys(body.urls ?? {}).length} addresses`);
    return body.urls ?? {};
  } catch (err) {
    console.warn(`[sitemap] could not read ${url}: ${err.message}`);
    return {};
  }
}

/** { address: [fingerprint, date] } as the site last saved it. */
export async function load() {
  try {
    await ensureMigrated();
    const rows = (await getPool().query('SELECT loc, hash, lastmod FROM sitemap_state')).rows;
    last = rows.length ? Object.fromEntries(rows.map((r) => [r.loc, [r.hash, r.lastmod]])) : await seed();
    return last;
  } catch (err) {
    // Database unreachable: the dates from the last time (in memory), or none.
    if (last) return last;
    throw err;
  }
}

/** Save the new list: changed and new addresses get their new date; addresses no longer listed go away. */
export async function save(state) {
  const locs = Object.keys(state);
  last = state;
  if (!locs.length) return;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const changed = await client.query(
      `INSERT INTO sitemap_state (loc, hash, lastmod)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
       ON CONFLICT (loc) DO UPDATE SET hash = EXCLUDED.hash, lastmod = EXCLUDED.lastmod, changed_at = now()
       WHERE sitemap_state.hash IS DISTINCT FROM EXCLUDED.hash OR sitemap_state.lastmod IS DISTINCT FROM EXCLUDED.lastmod`,
      [locs, locs.map((l) => state[l][0]), locs.map((l) => state[l][1])],
    );
    const gone = await client.query('DELETE FROM sitemap_state WHERE NOT (loc = ANY($1::text[]))', [locs]);
    await client.query('COMMIT');
    if (changed.rowCount || gone.rowCount) console.log(`[sitemap] ${changed.rowCount} addresses new or changed, ${gone.rowCount} no longer listed`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn(`[sitemap] could not save the dates: ${err.message}`);
  } finally {
    client.release();
  }
}

/** Give the site these two functions (only when the server has a database). */
export function installSitemapState() {
  if (!process.env.PGHOST && !process.env.DATABASE_URL) return false;
  globalThis.__liSitemapState = { load, save };
  return true;
}
