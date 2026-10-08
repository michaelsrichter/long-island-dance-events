#!/usr/bin/env node
/**
 * Fill a database with a content snapshot (decision P59), for local runs and the CI comparison:
 *
 *   npx tsx scripts/db/build-payload.ts --out payload.json.gz
 *   DATABASE_URL=postgres://... node scripts/live/load-db.mjs payload.json.gz
 *
 * Applies the database design (server/migrations/) and makes the tables match the snapshot, exactly like
 * the nightly sync does on Azure. Never point it at the live database by accident: it needs DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { closePool, getPool, inTransaction } from '../../server/src/lib/db.js';
import { ensureMigrated } from '../../server/src/lib/migrate.js';
import { importSnapshot } from '../../server/src/lib/sync.js';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error('Usage: DATABASE_URL=postgres://... node scripts/live/load-db.mjs <payload.json.gz>');
  process.exit(2);
}
const buf = readFileSync(file);
const snapshot = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8'));
try {
  await ensureMigrated(getPool());
  const summary = await inTransaction((client) => importSnapshot(client, snapshot, { who: `load-db ${String(snapshot.commit || '').slice(0, 7)}`, allowShrink: true }));
  console.log(`[load-db] +${summary.created} ~${summary.updated} -${summary.deleted} =${summary.unchanged}, data version ${summary.dataVersion}`);
} finally {
  await closePool();
}
