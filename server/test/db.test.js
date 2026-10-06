/**
 * Database tests against a real PostgreSQL (CI: a postgres:17 service; locally: any empty database).
 *   DATABASE_URL=postgres://postgres@localhost:5432/lidance_test SERVER_TEST_RESET=1 npm test
 * SERVER_TEST_RESET=1 empties the database first (never point it at a real one).
 * PAYLOAD_FILE=<snapshot from scripts/db/build-payload.ts> adds the full round trip with the real content.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const DB = process.env.DATABASE_URL;
const skip = DB ? false : 'DATABASE_URL is not set';

const { closePool, getPool, inTransaction } = await import('../src/lib/db.js');
const { ensureMigrated, migrate } = await import('../src/lib/migrate.js');
const { SnapshotError, checkSnapshot, drill, exportSnapshot, importSnapshot, stats } = await import('../src/lib/sync.js');

const ev = (id, title, extra = {}) => {
  const doc = { title, category: 'social-dance', start: '2030-03-05T19:30', venueId: 'hall', status: 'active', ...extra };
  return { id, path: `src/content/events/${id}.json`, raw: `${JSON.stringify(doc, null, 2)}\n`, doc };
};
const venue = { id: 'hall', path: 'src/content/venues/hall.json', raw: '{\n  "name": "The Hall",\n  "town": "Huntington"\n}\n', doc: { name: 'The Hall', town: 'Huntington' } };
const style = { id: 'swing', path: 'src/content/styles/swing.yml', raw: 'name: Swing\nfamily: swing\n', doc: { name: 'Swing', family: 'swing' } };
const page = { id: 'about', path: 'src/content/pages/about.md', raw: '---\ntitle: About\n---\nHello.\n', doc: { title: 'About', body: 'Hello.\n' } };
const source = { id: 'feed', path: 'src/content/sources/feed.json', raw: '{"name":"Feed","adapter":"ical"}\n', doc: { name: 'Feed', adapter: 'ical' } };

function snapshot(events, extra = {}) {
  const day = (i) => new Date(Date.UTC(2030, 2, 5 + i)).toISOString().slice(0, 10);
  return {
    commit: 'abc1234000000000000000000000000000000000',
    collections: { events, venues: [venue], styles: [style], pages: [page], sources: [source] },
    eventDates: events.map((e, i) => ({
      event_id: e.id,
      day: day(i),
      slug: `${day(i)}-${e.id}`,
      start_local: `${day(i)}T19:30`,
      end_local: `${day(i)}T22:30`,
      starts_at: `${day(i)}T23:30:00Z`,
      ends_at: `${day(i + 1)}T02:30:00Z`,
      time_tba: false,
    })),
    places: [{ name: 'Huntington', county: 'Suffolk', aliases: ['Huntington Village'] }],
    ...extra,
  };
}
const sync = (snap, opts = {}) => inTransaction((c) => importSnapshot(c, snap, { who: 'git abc1234', ...opts }));
const q = async (sql, params) => (await getPool().query(sql, params)).rows;

describe('database', { skip }, () => {
  before(async () => {
    if (process.env.SERVER_TEST_RESET === '1') {
      await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
  });
  after(async () => closePool());

  test('the design is applied once, and again does nothing', async () => {
    assert.deepEqual(await ensureMigrated(), ['001_initial']);
    const c = await getPool().connect();
    try {
      assert.deepEqual(await migrate(c), []);
    } finally {
      c.release();
    }
    assert.equal((await q('SELECT count(*)::int AS n FROM schema_migrations'))[0].n, 1);
  });

  test('a first sync adds every record, its dates, the places and history', async () => {
    const s = await sync(snapshot([ev('swing-night', 'Swing Night'), ev('salsa', 'Salsa Social', { status: 'pending-review' })]));
    assert.equal(s.created, 6);
    assert.equal(s.updated + s.deleted, 0);
    assert.equal(s.eventDates, 2);
    assert.equal(s.places, 1);
    assert.equal(s.dataVersion, 1);
    const [e] = await q("SELECT title, status, venue_id, start_local, version, updated_by FROM events WHERE id = 'swing-night'");
    assert.deepEqual(e, { title: 'Swing Night', status: 'active', venue_id: 'hall', start_local: '2030-03-05T19:30', version: 1, updated_by: 'git abc1234' });
    assert.equal((await q("SELECT town FROM venues WHERE id = 'hall'"))[0].town, 'Huntington');
    assert.equal((await q("SELECT enabled FROM sources WHERE id = 'feed'"))[0].enabled, true);
    assert.equal((await q("SELECT count(*)::int AS n FROM history WHERE action = 'create'"))[0].n, 6);
    assert.deepEqual((await q('SELECT aliases FROM places'))[0].aliases, ['Huntington Village']);
    const found = await q("SELECT id FROM events WHERE search @@ plainto_tsquery('english', 'swing')");
    assert.deepEqual(found.map((r) => r.id), ['swing-night']);
  });

  test('the same snapshot again changes nothing (and the data version stays)', async () => {
    const s = await sync(snapshot([ev('swing-night', 'Swing Night'), ev('salsa', 'Salsa Social', { status: 'pending-review' })]));
    assert.deepEqual([s.created, s.updated, s.deleted, s.unchanged], [0, 0, 0, 6]);
    assert.equal(s.dataVersion, 1);
  });

  test('a changed file updates the row, raises its version and keeps the old version in history', async () => {
    const s = await sync(snapshot([ev('swing-night', 'Swing Night', { start: '2030-03-05T20:00' }), ev('salsa', 'Salsa Social', { status: 'pending-review' })]));
    assert.equal(s.updated, 1);
    assert.equal(s.dataVersion, 2);
    const [row] = await q("SELECT version, start_local FROM events WHERE id = 'swing-night'");
    assert.deepEqual(row, { version: 2, start_local: '2030-03-05T20:00' });
    const [h] = await q("SELECT action, version, before->>'start' AS b, after->>'start' AS a FROM history WHERE record_id = 'swing-night' ORDER BY id DESC LIMIT 1");
    assert.deepEqual(h, { action: 'update', version: 2, b: '2030-03-05T19:30', a: '2030-03-05T20:00' });
  });

  test('a file removed from git is removed here too, with its dates, and history keeps it', async () => {
    const s = await sync(snapshot([ev('swing-night', 'Swing Night', { start: '2030-03-05T20:00' })]));
    assert.equal(s.deleted, 1);
    assert.equal((await q("SELECT count(*)::int AS n FROM events WHERE id = 'salsa'"))[0].n, 0);
    assert.equal((await q("SELECT count(*)::int AS n FROM event_dates WHERE event_id = 'salsa'"))[0].n, 0);
    const [h] = await q("SELECT action, before->>'title' AS t FROM history WHERE record_id = 'salsa' ORDER BY id DESC LIMIT 1");
    assert.deepEqual(h, { action: 'delete', t: 'Salsa Social' });
  });

  test('history can never be changed or deleted', async () => {
    await assert.rejects(getPool().query("UPDATE history SET who = 'me'"), /cannot be changed/);
    await assert.rejects(getPool().query('DELETE FROM history'), /cannot be changed/);
    await assert.rejects(getPool().query('TRUNCATE history'), /cannot be changed/);
  });

  test('a snapshot that would remove most records is refused, and nothing changes', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ev(`e${i}`, `Event ${i}`));
    await sync(snapshot(many));
    const before = await q('SELECT count(*)::int AS n FROM events');
    await assert.rejects(sync(snapshot([ev('e0', 'Event 0')])), SnapshotError);
    assert.deepEqual(await q('SELECT count(*)::int AS n FROM events'), before);
  });

  test('bad snapshots are refused before touching the database', () => {
    assert.throws(() => checkSnapshot({}), SnapshotError);
    assert.throws(() => checkSnapshot({ collections: { robots: [] } }), SnapshotError);
    assert.throws(() => checkSnapshot({ collections: { events: [{ ...ev('x', 'X'), path: 'src/content/venues/x.json' }] } }), SnapshotError);
    assert.throws(() => checkSnapshot({ collections: { events: [{ ...ev('x', 'X'), id: '../x' }] } }), SnapshotError);
    assert.throws(() => checkSnapshot({ collections: { events: [ev('x', 'X'), ev('x', 'X')] } }), SnapshotError);
  });

  test('the export gives back every file exactly', async () => {
    const snap = snapshot([ev('swing-night', 'Swing Night'), ev('waltz', 'Wältz Évening ✨')]);
    await sync(snap, { allowShrink: true });
    const c = await getPool().connect();
    try {
      const out = await exportSnapshot(c);
      const want = Object.values(snap.collections).flat().map((r) => [r.path, r.raw]).sort();
      assert.deepEqual(out.files.map((f) => [f.path, f.raw]), want);
    } finally {
      c.release();
    }
  });

  test('the restore drill copies everything into empty tables, finds it identical and leaves nothing behind', async () => {
    const r = await drill(getPool());
    assert.equal(r.ok, true);
    assert.equal(r.records, 6);
    assert.deepEqual(r.missing, []);
    assert.equal((await q("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name LIKE 'drill_%'"))[0].n, 0);
    const c = await getPool().connect();
    try {
      const s = await stats(c);
      assert.equal(s.events.count, 2);
      assert.match(s.events.sha, /^[0-9a-f]{64}$/);
    } finally {
      c.release();
    }
  });

  test('the full round trip with the real content (PAYLOAD_FILE)', { skip: process.env.PAYLOAD_FILE ? false : 'PAYLOAD_FILE is not set' }, async () => {
    const buf = readFileSync(process.env.PAYLOAD_FILE);
    const snap = JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString('utf8'));
    const s = await sync(snap, { allowShrink: true });
    const total = Object.values(snap.collections).reduce((n, rows) => n + rows.length, 0);
    assert.equal(s.created + s.updated + s.unchanged, total);
    assert.equal(s.eventDates, new Set(snap.eventDates.map((d) => `${d.event_id} ${d.day}`)).size);
    const again = await sync(snap);
    assert.equal(again.unchanged, total);
    const c = await getPool().connect();
    try {
      const out = await exportSnapshot(c);
      const want = new Map(Object.values(snap.collections).flat().map((r) => [r.path, r.raw]));
      assert.equal(out.files.length, want.size);
      for (const f of out.files) assert.equal(f.raw, want.get(f.path), f.path);
    } finally {
      c.release();
    }
    const upcoming = await q('SELECT count(*)::int AS n FROM v_upcoming');
    assert.ok(upcoming[0].n >= 0);
    const r = await drill(getPool());
    assert.equal(r.ok, true);
    assert.equal(r.records, total);
  });
});
