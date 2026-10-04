#!/usr/bin/env node
// Weekly maintenance for community data (run by .github/workflows/community-maintenance.yml).
//
//   1. Back up every community table to the private "backups" container (kept 5 weeks by a lifecycle rule).
//   2. Delete rejected notes and photos older than 90 days (the decision stays in the ModLog).
//   3. Delete moderation-log months older than 2 years.
//   4. Delete rate-limit counters older than 2 days.
//
// Needs COMMUNITY_STORAGE (the Storage connection string). Uses the SDKs installed in api/ (npm ci --prefix api).
//   node scripts/community-maintenance.mjs [--dry-run]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'api', 'package.json'));
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

const conn = process.env.COMMUNITY_STORAGE;
if (!conn) {
  console.error('COMMUNITY_STORAGE is not set.');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const DAY = 86400000;
const now = Date.now();
const TABLES = ['Users', 'Comments', 'Photos', 'Likes', 'LikeCounts', 'UserItems', 'Flags', 'ModQueue', 'ModLog', 'Limits'];
const blobs = BlobServiceClient.fromConnectionString(conn);
const table = (name) => TableClient.fromConnectionString(conn, name);
const stamp = new Date(now).toISOString().slice(0, 10);
const counts = { backedUp: 0, rejectedRemoved: 0, logRemoved: 0, limitsRemoved: 0 };

async function remove(t, e) {
  if (!dryRun) await t.deleteEntity(e.partitionKey, e.rowKey);
}

// 1. Backups
for (const name of TABLES) {
  const rows = [];
  for await (const e of table(name).listEntities()) rows.push(e);
  counts.backedUp += rows.length;
  if (!dryRun) {
    const body = Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n'));
    await blobs.getContainerClient('backups').getBlockBlobClient(`${stamp}/${name}.jsonl`).uploadData(body, { blobHTTPHeaders: { blobContentType: 'application/x-ndjson' } });
  }
}

// 2. Rejected notes and photos older than 90 days
const photoSizes = [480, 1024, 2048];
for (const name of ['Comments', 'Photos']) {
  const t = table(name);
  for await (const e of t.listEntities({ queryOptions: { filter: "status eq 'rejected'" } })) {
    if (now - Date.parse(e.createdAt || 0) < 90 * DAY) continue;
    if (name === 'Photos' && !dryRun) {
      const [type, id] = e.partitionKey.split(':');
      for (const px of photoSizes) await blobs.getContainerClient('pending').getBlockBlobClient(`${type}/${id}/${e.photoId}-${px}.webp`).deleteIfExists();
    }
    await remove(t, e);
    if (!dryRun && e.userId) {
      const kind = name === 'Photos' ? 'photo' : 'comment';
      await table('UserItems').deleteEntity(e.userId, `${kind}~${e.partitionKey}~${e.rowKey}`).catch(() => {});
    }
    counts.rejectedRemoved++;
  }
}

// 3. Moderation log older than 2 years (partitions are "YYYY-MM")
const cutoff = new Date(now);
cutoff.setUTCMonth(cutoff.getUTCMonth() - 24);
const oldestKept = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}`;
const log = table('ModLog');
for await (const e of log.listEntities({ queryOptions: { filter: `PartitionKey lt '${oldestKept}'` } })) {
  await remove(log, e);
  counts.logRemoved++;
}

// 4. Rate-limit counters older than 2 days (RowKey "<action>~YYYYMMDDHH")
const limits = table('Limits');
const keep = new Date(now - 2 * DAY).toISOString().slice(0, 10).replace(/-/g, '');
for await (const e of limits.listEntities()) {
  const day = String(e.rowKey).split('~')[1]?.slice(0, 8) || '';
  if (day && day < keep) {
    await remove(limits, e);
    counts.limitsRemoved++;
  }
}

console.log(`${dryRun ? '[dry run] ' : ''}backed up ${counts.backedUp} rows to backups/${stamp}/; removed ${counts.rejectedRemoved} old rejected posts, ${counts.logRemoved} old log rows, ${counts.limitsRemoved} old rate-limit rows.`);
