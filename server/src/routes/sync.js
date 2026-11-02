/**
 * Phase 1 sync endpoints, callable only by named GitHub Actions workflows on main (see lib/oidc.js):
 *
 *   POST /api/sync/import   body: snapshot of src/content/** (gzip JSON) -> make the database match it
 *   GET  /api/sync/export   every record as { path, raw } -> the workflow compares it with git, byte for byte
 *   POST /api/sync/drill    restore drill; body { server } compares with a restored copy of the server instead
 */
import pg from 'pg';
import { connectionConfig, getPool, inTransaction } from '../lib/db.js';
import { ensureMigrated } from '../lib/migrate.js';
import { AuthError, verifyGithubRequest } from '../lib/oidc.js';
import { SnapshotError, drill, exportSnapshot, importSnapshot, stats } from '../lib/sync.js';
import { json, readJson } from '../lib/http.js';

async function authorize(request) {
  try {
    const claims = await verifyGithubRequest(request.headers.get('authorization'));
    console.log(`[sync] ${claims.job_workflow_ref} run ${claims.run_id} (${claims.event_name})`);
    return claims;
  } catch (err) {
    if (err instanceof AuthError) {
      console.warn(`[sync] refused (${err.message})`);
      return null;
    }
    throw err;
  }
}

const denied = (request) => json(request, 401, { ok: false, error: 'Only the database sync workflow on main may call this.' });

function failed(request, where, err) {
  if (err instanceof SnapshotError) return json(request, 400, { ok: false, error: err.message });
  console.error(`[sync] ${where}: ${err.stack || err.message}`);
  return json(request, 500, { ok: false, error: `${where} failed: ${err.message}` });
}

export async function syncImport(request) {
  const claims = await authorize(request);
  if (!claims) return denied(request);
  let snapshot;
  try {
    snapshot = await readJson(request);
  } catch (err) {
    return json(request, 400, { ok: false, error: `Body is not a snapshot: ${err.message}` });
  }
  try {
    await ensureMigrated();
    const commit = String(snapshot.commit || claims.sha || '').slice(0, 7) || 'unknown';
    const summary = await inTransaction((client) => importSnapshot(client, snapshot, { who: `git ${commit}` }));
    console.log(`[sync] imported ${commit}: +${summary.created} ~${summary.updated} -${summary.deleted}, data version ${summary.dataVersion}`);
    return json(request, 200, { ok: true, summary });
  } catch (err) {
    return failed(request, 'import', err);
  }
}

export async function syncExport(request) {
  if (!(await authorize(request))) return denied(request);
  try {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      // One consistent picture of every table.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const out = await exportSnapshot(client);
      const state = (await client.query('SELECT data_version, last_sync_commit FROM site_state WHERE id = 1')).rows[0];
      await client.query('COMMIT');
      // Large; the server compresses it (lib/node-http.js).
      return json(request, 200, {
        ok: true,
        dataVersion: Number(state.data_version),
        commit: state.last_sync_commit,
        checksum: out.checksum,
        count: out.files.length,
        files: out.files.map(({ path, raw }) => ({ path, raw })),
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return failed(request, 'export', err);
  }
}

export async function syncDrill(request) {
  if (!(await authorize(request))) return denied(request);
  let body = {};
  try {
    body = (await readJson(request)) ?? {};
  } catch {
    /* no body: the copy-and-compare drill */
  }
  try {
    await ensureMigrated();
    if (!body.server) {
      const result = await drill(getPool());
      console.log(`[drill] ${result.ok ? 'passed' : 'FAILED'} (${result.records} records, ${result.ms} ms)`);
      return json(request, result.ok ? 200 : 500, { ok: result.ok, kind: 'copy', result });
    }
    // A server restored from Azure's backups (point-in-time restore): compare it with the live one.
    const prefix = process.env.DRILL_SERVER_PREFIX || '';
    const name = String(body.server);
    if (!prefix || !name.startsWith(prefix) || !/^[a-z0-9-]{3,63}$/.test(name)) {
      return json(request, 400, { ok: false, error: `server must be a restored copy named ${prefix}...` });
    }
    const c = await getPool().connect();
    let live;
    try {
      live = await stats(c);
    } finally {
      c.release();
    }
    const remote = new pg.Client({ ...connectionConfig({ host: `${name}.postgres.database.azure.com` }), connectionTimeoutMillis: 30_000 });
    await remote.connect();
    let restored;
    try {
      restored = await stats(remote);
    } finally {
      await remote.end().catch(() => {});
    }
    const kinds = Object.keys(live).filter((k) => k !== 'history');
    const same = kinds.filter((k) => live[k].sha === restored[k]?.sha);
    const ok = same.length === kinds.length;
    console.log(`[drill] restored server ${name}: ${same.length}/${kinds.length} kinds identical`);
    return json(request, 200, { ok, kind: 'restored-server', server: name, identicalKinds: same.length, kinds: kinds.length, live, restored });
  } catch (err) {
    return failed(request, 'drill', err);
  }
}
