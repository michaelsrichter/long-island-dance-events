/**
 * Pages from the live database (decision P59).
 *
 * Every 2 seconds the server asks PostgreSQL for the data version (one tiny query). When it changed, the
 * server reads every record's file text in one consistent read and hands it to the site
 * (src/lib/live-store.ts). The new version makes every remembered list and page start again, so the next
 * visitor sees the change; the busiest pages are prepared again right away.
 *
 * If the database can't be reached, the site keeps the records it has (at start: the ones it was built
 * with) and tries again on the next round.
 */
import { getPool } from './lib/db.js';
import { ensureMigrated } from './lib/migrate.js';
import { exportSnapshot } from './lib/sync.js';
import { astro } from './site.js';

const INTERVAL_MS = Number(process.env.LIVE_DATA_INTERVAL_MS || 2000);

const state = { version: null, loadedAt: null, records: 0, lastError: null, lastErrorAt: null, problems: [], ms: 0 };

/** For /api/health: which data version the pages show. */
export function liveDataStatus() {
  return { ...state, problems: state.problems.slice(0, 20) };
}

async function readAll() {
  const client = await getPool().connect();
  try {
    // One consistent picture: the records and the version number that goes with them.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const version = String((await client.query('SELECT data_version FROM site_state WHERE id = 1')).rows[0].data_version);
    const { collections } = await exportSnapshot(client);
    await client.query('COMMIT');
    return { version, collections };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let busy = false;
let warnedAt = 0;

/** One round: load the records when the version changed. Returns true when new records were loaded. */
export async function checkLiveData({ onLoaded } = {}) {
  if (busy) return false;
  busy = true;
  try {
    await ensureMigrated();
    const current = String((await getPool().query('SELECT data_version FROM site_state WHERE id = 1')).rows[0].data_version);
    if (current === state.version) return false;
    const { version, collections } = await readAll();
    const site = await astro();
    const result = await site.loadLiveRecords(collections, version);
    Object.assign(state, { version, loadedAt: new Date().toISOString(), records: result.records, problems: result.problems, ms: result.ms, lastError: null });
    console.log(`[live] data version ${version}: ${result.records} records (${result.parsed} read again) in ${result.ms} ms${result.problems.length ? `, ${result.problems.length} problems` : ''}`);
    // Preparing the pages runs on its own (it takes minutes); the 2-second check goes on meanwhile.
    Promise.resolve(onLoaded?.()).catch((err) => console.warn(`[live] after loading: ${err.message}`));
    return true;
  } catch (err) {
    state.lastError = err.message;
    state.lastErrorAt = new Date().toISOString();
    // Once a minute at most, so a database outage doesn't fill the log.
    if (Date.now() - warnedAt > 60_000) {
      warnedAt = Date.now();
      console.warn(`[live] could not read the database (pages keep the records they have): ${err.message}`);
    }
    return false;
  } finally {
    busy = false;
  }
}

/** Start the 2-second check. `onLoaded` runs after new records arrive (prepare the busiest pages). */
export function startLiveData({ onLoaded } = {}) {
  if (!process.env.PGHOST && !process.env.DATABASE_URL) {
    console.log('[live] no database settings: pages use the records the site was built with');
    return { first: Promise.resolve(false), stop: () => {} };
  }
  const first = checkLiveData({ onLoaded });
  const timer = setInterval(() => checkLiveData({ onLoaded }), INTERVAL_MS);
  timer.unref();
  return { first, stop: () => clearInterval(timer) };
}
