/**
 * Connection to PostgreSQL.
 *
 * In Azure the Function App signs in with its managed identity (Microsoft Entra; the server accepts no
 * passwords): PGHOST, PGDATABASE and PGUSER (the app's name) come from app settings, and a fresh access
 * token is fetched whenever a new connection opens. Tests and local runs set DATABASE_URL instead.
 */
import pg from 'pg';
import { DefaultAzureCredential } from '@azure/identity';

const ENTRA_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';
let credential;

export const usesEntra = () => !process.env.DATABASE_URL;

async function entraToken() {
  credential ??= new DefaultAzureCredential();
  const t = await credential.getToken(ENTRA_SCOPE);
  if (!t?.token) throw new Error('No Microsoft Entra token for PostgreSQL');
  return t.token;
}

/** Settings for one connection; `host` lets the restore drill reach a restored copy of the server. */
export function connectionConfig({ host } = {}) {
  if (!usesEntra()) return { connectionString: process.env.DATABASE_URL };
  return {
    host: host ?? process.env.PGHOST,
    database: process.env.PGDATABASE || 'lidance',
    user: process.env.PGUSER,
    port: Number(process.env.PGPORT || 5432),
    password: entraToken,
    ssl: { rejectUnauthorized: true },
  };
}

let pool;
export function getPool() {
  if (pool) return pool;
  pool = new pg.Pool({
    ...connectionConfig(),
    // B1ms allows 35 connections; at most 3 copies of the app run, 5 each (decision P56).
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
  });
  // An idle connection that breaks (server restart, maintenance) must not crash the app.
  pool.on('error', (err) => console.warn(`[db] idle connection error: ${err.message}`));
  return pool;
}

export async function closePool() {
  const p = pool;
  pool = undefined;
  if (p) await p.end();
}

/** Run fn(client) inside one transaction; everything is undone if it throws. */
export async function inTransaction(fn, { pool: p = getPool() } = {}) {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
