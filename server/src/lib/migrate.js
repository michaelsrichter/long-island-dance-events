/**
 * Database design changes are plain SQL files in server/migrations/, applied in name order, once each.
 * Applied files are recorded in schema_migrations; an advisory lock keeps two copies of the app from
 * applying the same file at the same time.
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getPool } from './db.js';

const DIR = new URL('../../migrations/', import.meta.url);
const LOCK_ID = 4_242_001;

export async function migrationFiles() {
  const names = (await readdir(DIR)).filter((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, DIR), 'utf8');
      return { version: name.replace(/\.sql$/, ''), sql, sha: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/** Apply every migration that has not run yet. Returns the versions applied now. */
export async function migrate(client) {
  // Messages from the SQL files (RAISE NOTICE / WARNING) go to the server log; routine "..., skipping" notes don't.
  const notice = (n) => {
    if (!/, skipping$/.test(n.message)) console.log(`[migrate] ${n.severity || 'NOTICE'}: ${n.message}`);
  };
  client.on('notice', notice);
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, sha text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Map((await client.query('SELECT version, sha FROM schema_migrations')).rows.map((r) => [r.version, r.sha]));
    const applied = [];
    for (const m of await migrationFiles()) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.sha) console.warn(`[migrate] ${m.version} changed after it ran; add a new migration instead`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, sha) VALUES ($1, $2)', [m.version, m.sha]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${m.version} failed: ${err.message}`);
      }
      applied.push(m.version);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.off('notice', notice);
  }
}

let ready;
/** Migrate once per copy of the app (retried on the next call if it failed). */
export function ensureMigrated(pool = getPool()) {
  ready ??= (async () => {
    const client = await pool.connect();
    try {
      return await migrate(client);
    } finally {
      client.release();
    }
  })().catch((err) => {
    ready = undefined;
    throw err;
  });
  return ready;
}

/** Create every table in another schema (the restore drill), inside the caller's transaction. */
export async function createSchemaCopy(client, schema) {
  if (!/^drill_[a-z0-9_]{1,40}$/.test(schema)) throw new Error('bad schema name');
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET LOCAL search_path TO ${schema}, public`);
  for (const m of await migrationFiles()) await client.query(m.sql);
}
