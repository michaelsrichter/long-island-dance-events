/**
 * GET /api/live: the server process answers (App Service health check; never touches the database).
 * GET /api/health: is the server up, can it reach the database, which design version and data version.
 * Both are public on purpose; they show only versions and counts.
 */
import { getPool } from '../lib/db.js';
import { ensureMigrated } from '../lib/migrate.js';
import { KINDS } from '../lib/kinds.js';
import { appVersion, json } from '../lib/http.js';
import { liveDataStatus } from '../live-data.js';

export async function live(request) {
  return json(request, 200, { ok: true, version: appVersion().commit });
}

export async function health(request) {
  const v = appVersion();
  try {
    const pool = getPool();
    await ensureMigrated(pool);
    const state = (await pool.query('SELECT data_version, last_sync_commit, last_sync_at FROM site_state WHERE id = 1')).rows[0];
    const counts = (
      await pool.query(`SELECT ${[...KINDS, 'event_dates', 'places', 'history'].map((t) => `(SELECT count(*) FROM ${t})::int AS ${t}`).join(', ')}`)
    ).rows[0];
    const migrations = (await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map((r) => r.version);
    return json(request, 200, {
      ok: true,
      version: v.commit,
      deployedAt: v.deployedAt,
      database: 'ok',
      migrations,
      dataVersion: Number(state.data_version),
      // What the pages show right now (the server checks the database every 2 seconds).
      pages: (({ version, loadedAt, records, problems, lastError }) => ({ dataVersion: version === null ? 'build' : Number(version), loadedAt, records, problems, lastError }))(liveDataStatus()),
      lastSync: { commit: state.last_sync_commit, at: state.last_sync_at },
      counts,
    });
  } catch (err) {
    console.error(`[health] ${err.message}`);
    return json(request, 503, { ok: false, version: v.commit, database: 'unreachable' });
  }
}
