/**
 * GET /api/health: is the server up, can it reach the database, which design version and data version.
 * Public on purpose (used by the deploy workflow, monitoring and people); it shows only counts.
 */
import { app } from '@azure/functions';
import { getPool } from '../lib/db.js';
import { ensureMigrated } from '../lib/migrate.js';
import { KINDS } from '../lib/kinds.js';
import { appVersion, json } from '../lib/http.js';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    const v = appVersion();
    try {
      const pool = getPool();
      await ensureMigrated(pool);
      const state = (await pool.query('SELECT data_version, last_sync_commit, last_sync_at FROM site_state WHERE id = 1')).rows[0];
      const counts = (
        await pool.query(
          `SELECT ${[...KINDS, 'event_dates', 'places', 'history'].map((t) => `(SELECT count(*) FROM ${t})::int AS ${t}`).join(', ')}`,
        )
      ).rows[0];
      const migrations = (await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map((r) => r.version);
      return json(request, 200, {
        ok: true,
        version: v.commit,
        deployedAt: v.deployedAt,
        database: 'ok',
        migrations,
        dataVersion: Number(state.data_version),
        lastSync: { commit: state.last_sync_commit, at: state.last_sync_at },
        counts,
      });
    } catch (err) {
      context.error(`health: ${err.message}`);
      return json(request, 503, { ok: false, version: v.commit, database: 'unreachable' });
    }
  },
});
