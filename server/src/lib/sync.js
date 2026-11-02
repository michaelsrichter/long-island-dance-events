/**
 * Phase 1 sync: git is still the master copy, and the database is a faithful mirror of src/content/**.
 *
 *   importSnapshot  makes the tables match a snapshot of git (adds, changes and removes rows), writing a
 *                   history row for every change, and rebuilds event_dates and places.
 *   exportSnapshot  gives back every record as its file path and exact file text.
 *   drill           a restore test: copies the live data into an empty set of tables, exports that copy
 *                   and checks it is identical; everything is undone afterwards.
 *
 * All SQL is set-based (one statement per kind), so a full sync of ~1,400 records is a few dozen queries.
 */
import { createHash } from 'node:crypto';
import { KINDS, ID_RE, pathRe } from './kinds.js';
import { createSchemaCopy } from './migrate.js';

export class SnapshotError extends Error {}

const MAX_RAW = 512 * 1024;

/** Check the snapshot's shape before anything touches the database. */
export function checkSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.collections !== 'object' || !snapshot.collections) {
    throw new SnapshotError('snapshot.collections is missing');
  }
  for (const key of Object.keys(snapshot.collections)) if (!KINDS.includes(key)) throw new SnapshotError(`unknown kind "${key}"`);
  for (const kind of KINDS) {
    const rows = snapshot.collections[kind] ?? [];
    if (!Array.isArray(rows)) throw new SnapshotError(`${kind} must be a list`);
    const ids = new Set();
    const re = pathRe(kind);
    for (const r of rows) {
      if (!r || typeof r !== 'object') throw new SnapshotError(`${kind}: bad row`);
      if (typeof r.id !== 'string' || !ID_RE.test(r.id)) throw new SnapshotError(`${kind}: bad id ${JSON.stringify(r.id)}`);
      if (ids.has(r.id)) throw new SnapshotError(`${kind}: id "${r.id}" appears twice`);
      ids.add(r.id);
      if (typeof r.path !== 'string' || !re.test(r.path)) throw new SnapshotError(`${kind}/${r.id}: bad path`);
      if (typeof r.raw !== 'string' || r.raw.length > MAX_RAW) throw new SnapshotError(`${kind}/${r.id}: raw text missing or too long`);
      if (!r.doc || typeof r.doc !== 'object' || Array.isArray(r.doc)) throw new SnapshotError(`${kind}/${r.id}: doc must be an object`);
    }
  }
  for (const key of ['eventDates', 'places']) {
    if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) throw new SnapshotError(`${key} must be a list`);
  }
}

/**
 * Make the tables match the snapshot. Run inside a transaction. `who` is written to history
 * ("git 1a2b3c4"). Refuses to remove more than half of any kind unless allowShrink is set, so a broken
 * snapshot can never empty the database.
 */
export async function importSnapshot(client, snapshot, { who, allowShrink = false } = {}) {
  checkSnapshot(snapshot);
  if (typeof who !== 'string' || !who) throw new SnapshotError('who is required');
  const summary = { created: 0, updated: 0, deleted: 0, unchanged: 0, kinds: {} };

  for (const kind of KINDS) {
    const rows = snapshot.collections[kind] ?? [];
    const existing = Number((await client.query(`SELECT count(*)::int AS n FROM ${kind}`)).rows[0].n);
    const keep = new Set(rows.map((r) => r.id));
    if (!allowShrink && existing >= 4) {
      const kept = Number((await client.query(`SELECT count(*)::int AS n FROM ${kind} WHERE id = ANY($1::text[])`, [[...keep]])).rows[0].n);
      if (kept < existing / 2) throw new SnapshotError(`${kind}: the snapshot would remove ${existing - kept} of ${existing} records; refusing`);
    }
    const json = JSON.stringify(rows.map(({ id, path, raw, doc }) => ({ id, path, raw, doc })));

    const deleted = await client.query(
      `WITH del AS (
         DELETE FROM ${kind} t WHERE NOT (t.id = ANY($1::text[]))
         RETURNING t.id, t.version, t.doc)
       INSERT INTO history (kind, record_id, action, version, who, before)
       SELECT $2, id, 'delete', version, $3, doc FROM del`,
      [[...keep], kind, who],
    );
    const updated = await client.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text, path text, raw text, doc jsonb)),
       old AS (
         SELECT t.id, t.doc AS before FROM ${kind} t JOIN incoming i ON i.id = t.id
         WHERE t.raw IS DISTINCT FROM i.raw OR t.path IS DISTINCT FROM i.path),
       upd AS (
         UPDATE ${kind} t SET raw = i.raw, path = i.path, doc = i.doc, version = t.version + 1, updated_at = now(), updated_by = $3
         FROM incoming i
         WHERE i.id = t.id AND (t.raw IS DISTINCT FROM i.raw OR t.path IS DISTINCT FROM i.path)
         RETURNING t.id, t.version, t.doc)
       INSERT INTO history (kind, record_id, action, version, who, before, after)
       SELECT $2, upd.id, 'update', upd.version, $3, old.before, upd.doc FROM upd JOIN old USING (id)`,
      [json, kind, who],
    );
    const created = await client.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text, path text, raw text, doc jsonb)),
       ins AS (
         INSERT INTO ${kind} (id, path, raw, doc, updated_by)
         SELECT i.id, i.path, i.raw, i.doc, $3 FROM incoming i
         WHERE NOT EXISTS (SELECT 1 FROM ${kind} t WHERE t.id = i.id)
         RETURNING id, version, doc)
       INSERT INTO history (kind, record_id, action, version, who, after)
       SELECT $2, id, 'create', version, $3, doc FROM ins`,
      [json, kind, who],
    );
    const k = { created: created.rowCount, updated: updated.rowCount, deleted: deleted.rowCount };
    k.unchanged = rows.length - k.created - k.updated;
    summary.kinds[kind] = k;
    for (const f of ['created', 'updated', 'deleted', 'unchanged']) summary[f] += k[f];
  }

  if (snapshot.eventDates) {
    await client.query('DELETE FROM event_dates');
    const r = await client.query(
      `INSERT INTO event_dates (event_id, day, slug, start_local, end_local, starts_at, ends_at, time_tba)
       SELECT d.event_id, d.day, d.slug, d.start_local, d.end_local, d.starts_at, d.ends_at, coalesce(d.time_tba, false)
       FROM jsonb_to_recordset($1::jsonb) AS d(event_id text, day date, slug text, start_local text, end_local text,
                                               starts_at timestamptz, ends_at timestamptz, time_tba boolean)
       WHERE EXISTS (SELECT 1 FROM events e WHERE e.id = d.event_id)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(snapshot.eventDates)],
    );
    summary.eventDates = r.rowCount;
  }
  if (snapshot.places) {
    await client.query('DELETE FROM places');
    const r = await client.query(
      `INSERT INTO places (name, county, aliases)
       SELECT p.name, p.county, coalesce(p.aliases, '{}')
       FROM jsonb_to_recordset($1::jsonb) AS p(name text, county text, aliases text[])
       ON CONFLICT (name) DO NOTHING`,
      [JSON.stringify(snapshot.places)],
    );
    summary.places = r.rowCount;
  }

  const changed = summary.created + summary.updated + summary.deleted;
  const state = await client.query(
    `UPDATE site_state SET data_version = data_version + $1, last_sync_commit = $2, last_sync_at = now(), last_sync_summary = $3
     RETURNING data_version`,
    [changed > 0 ? 1 : 0, typeof snapshot.commit === 'string' ? snapshot.commit.slice(0, 40) : null, JSON.stringify(summary)],
  );
  summary.dataVersion = Number(state.rows[0].data_version);
  return summary;
}

/** Every record as { kind, id, path, raw } (and doc when asked), sorted by path. */
export async function exportSnapshot(client, { withDocs = false } = {}) {
  const files = [];
  const collections = {};
  for (const kind of KINDS) {
    const rows = (await client.query(`SELECT id, path, raw${withDocs ? ', doc' : ''} FROM ${kind} ORDER BY path`)).rows;
    collections[kind] = rows;
    for (const r of rows) files.push({ kind, id: r.id, path: r.path, raw: r.raw });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, collections, checksum: checksumOf(files) };
}

/** One fingerprint for a whole set of files: same files, same text, same fingerprint. */
export function checksumOf(files) {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) h.update(f.path).update('\0').update(f.raw).update('\0');
  return h.digest('hex');
}

/** Counts and a fingerprint per kind, worked out by the database itself (also used on a restored server). */
export async function stats(client) {
  const out = {};
  for (const kind of KINDS) {
    const r = await client.query(
      `SELECT count(*)::int AS n,
              encode(sha256(convert_to(coalesce(string_agg(path || E'\\n' || raw, E'\\n' ORDER BY path), ''), 'UTF8')), 'hex') AS sha
       FROM ${kind}`,
    );
    out[kind] = { count: r.rows[0].n, sha: r.rows[0].sha };
  }
  const h = await client.query('SELECT count(*)::int AS n, max(at) AS last FROM history');
  out.history = { count: h.rows[0].n, last: h.rows[0].last };
  return out;
}

/**
 * Restore drill: copy everything into empty tables in a scratch schema, export the copy and compare.
 * Runs in one transaction that is always rolled back, so nothing is left behind.
 */
export async function drill(pool) {
  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query('BEGIN');
    const live = await exportSnapshot(client, { withDocs: true });
    const schema = `drill_${started}`;
    await createSchemaCopy(client, schema);
    const imported = await importSnapshot(client, { collections: live.collections, commit: 'restore-drill' }, { who: 'restore drill', allowShrink: true });
    const copy = await exportSnapshot(client);
    const copied = new Set(copy.files.map((c) => c.path));
    const missing = live.files.filter((f) => !copied.has(f.path)).map((f) => f.path);
    const identical = copy.checksum === live.checksum && copy.files.length === live.files.length;
    return { ok: identical, records: live.files.length, created: imported.created, checksum: live.checksum, copyChecksum: copy.checksum, missing: missing.slice(0, 20), ms: Date.now() - started };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
