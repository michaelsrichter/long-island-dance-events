import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPayload } from '../../scripts/db/build-payload';
import { compareExport } from '../../scripts/db/compare-export';
import { KINDS, listContentFiles, parseMarkdown } from '../../scripts/db/content-files';
import { KINDS as SERVER_KINDS, ID_RE, pathRe } from '../../server/src/lib/kinds.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('database snapshot (decision P56)', () => {
  const files = listContentFiles(root);
  const { snapshot, errors } = buildPayload(root, new Date('2026-10-05T12:00:00Z'));

  it('uses the same kinds of records as the server', () => {
    expect([...KINDS]).toEqual([...SERVER_KINDS]);
  });

  it('takes every content file, valid, with its exact text', () => {
    expect(errors).toEqual([]);
    const rows = KINDS.flatMap((k) => snapshot.collections[k]);
    expect(rows.length).toBe(files.length);
    for (const k of ['events', 'venues', 'performers', 'sources', 'styles', 'faqs', 'pages'] as const) expect(snapshot.collections[k].length, k).toBeGreaterThan(0);
    for (const f of files) {
      const row = snapshot.collections[f.kind].find((r) => r.id === f.id)!;
      expect(Buffer.from(row.raw, 'utf8').equals(f.bytes), f.path).toBe(true);
      expect(row.path).toBe(f.path);
      expect(ID_RE.test(row.id), row.id).toBe(true);
      expect(pathRe(f.kind).test(row.path), row.path).toBe(true);
    }
  }, 120_000);

  it('lists every date of the events with unique page addresses', () => {
    expect(snapshot.eventDates.length).toBeGreaterThan(0);
    expect(new Set(snapshot.eventDates.map((d) => d.slug)).size).toBe(snapshot.eventDates.length);
    const ids = new Set(snapshot.collections.events.map((e) => e.id));
    for (const d of snapshot.eventDates) expect(ids.has(d.event_id)).toBe(true);
  });

  it('includes the Long Island places with their other names', () => {
    const file = JSON.parse(readFileSync(new URL('../../src/data/long-island-places.json', import.meta.url), 'utf8'));
    expect(snapshot.places.length).toBe(file.places.length);
    expect(snapshot.places.some((p) => p.aliases.length > 0)).toBe(true);
  });

  it('reads Markdown front matter and body', () => {
    expect(parseMarkdown('---\ntitle: About\n---\nHello\n')).toEqual({ title: 'About', body: 'Hello\n' });
  });

  it('the round-trip check finds a changed, missing or extra file', () => {
    const exact = files.map((f) => ({ path: f.path, raw: f.bytes.toString('utf8') }));
    expect(compareExport(root, exact).ok).toBe(true);
    const changed = exact.map((f, i) => (i === 0 ? { ...f, raw: `${f.raw} ` } : f));
    expect(compareExport(root, changed).different).toEqual([exact[0]!.path]);
    expect(compareExport(root, exact.slice(1)).missing).toEqual([exact[0]!.path]);
    expect(compareExport(root, [...exact, { path: 'src/content/events/zzz.json', raw: '{}' }]).extra).toEqual(['src/content/events/zzz.json']);
  });
});
