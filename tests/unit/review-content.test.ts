import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_ORDER, serialize } from '../../ingest/lib/store';
import { eventSchema, sourceSchema } from '../../src/lib/schemas';

// The review center's API is plain CommonJS (Azure Functions); it must write files exactly like the weekly run.
const require = createRequire(import.meta.url);
const files = require('../../api/src/lib/content-files.js');
const data = require('../../api/src/lib/review-data.js');

const dir = (c: string) => join(process.cwd(), 'src', 'content', c);
const read = (c: string) =>
  readdirSync(dir(c))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.slice(0, -5), text: readFileSync(join(dir(c), f), 'utf8') }));
const events = read('events');
const venueIds = new Set(read('venues').map((v) => v.id));
const performerIds = new Set(read('performers').map((v) => v.id));

describe('review center content files', () => {
  it('uses the same key order and layout as ingest/lib/store.ts for every event file', () => {
    expect(files.EVENT_ORDER).toEqual(EVENT_ORDER);
    for (const e of events) {
      const obj = JSON.parse(e.text);
      expect(files.serialize(obj, files.EVENT_ORDER), e.id).toBe(serialize(obj, EVENT_ORDER));
    }
  });

  it('every decision on every held listing still passes the event schema', () => {
    const held = events.map((e) => ({ id: e.id, data: JSON.parse(e.text) })).filter((e) => e.data.status === 'pending-review');
    const opts = { today: '2026-10-05', venueIds, performerIds };
    for (const e of held) {
      for (const d of [
        { action: 'publish' },
        { action: 'hide', note: 'A copy' },
        { action: 'cancel', note: 'Cancelled by the venue' },
        { action: 'fix', fields: { time: '20:00' } },
        ...(e.data.venueId ? [] : [{ action: 'fix', fields: { venueId: [...venueIds][0] } }]),
      ]) {
        const r = files.decideListing(e.data, d, opts);
        const parsed = eventSchema.safeParse(r.event);
        expect(parsed.success, `${e.id} ${d.action}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
        expect(r.event.lockedFields).toContain('status');
      }
    }
  });

  it('a source decision keeps the source valid', () => {
    for (const s of read('sources').slice(0, 40)) {
      const src = JSON.parse(s.text);
      const r = files.decideSource(src, src.enabled === false ? { action: 'enable' } : { action: 'disable', note: 'test' }, { today: '2026-10-05' });
      expect(sourceSchema.safeParse(r.source).success, s.id).toBe(true);
      const p = files.decideSource(src, { action: 'permission', status: 'requested', note: 'Emailed them' }, { today: '2026-10-05' });
      expect(sourceSchema.safeParse(p.source).success, s.id).toBe(true);
    }
  });

  it('understands every review note the weekly run writes', () => {
    const src = ['ingest/lib/merge.ts', 'ingest/lib/structured.ts', 'ingest/adapters/thedancecalendar.ts', 'ingest/adapters/iraslist.ts'].map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n');
    for (const phrase of ['own calendar now lists this (', 'Not found in the latest ', 'Start time looks wrong (', 'No start time found.', 'Venue not found in the listing.', 'Band or DJ not researched yet: ']) {
      expect(src, phrase).toContain(phrase);
    }
    const sample = (notes: string, extra = {}) => data.reasonsOf({ start: '2026-10-16T06:30', venueId: 'v', reviewNotes: notes, ...extra }).map((r: { code: string }) => r.code);
    expect(sample("The organizer's or band's own calendar now lists this (abc-saturdays), so that listing is shown instead of this copy.")).toEqual(['copy']);
    expect(sample('Not found in the latest iraslist run on 2026-10-04. Check whether it was cancelled or moved.')).toEqual(['gone']);
    expect(sample('Start time looks wrong (6:30 in the morning). Check the source.')).toEqual(['odd-time']);
    expect(sample('Band or DJ not researched yet: Dr. Rock & The Max. No start time found.')).toEqual(['no-time', 'new-act']);
    expect(data.reasonsOf({ start: '2026-10-16', reviewNotes: 'Band or DJ not researched yet: Dr. Rock & The Max. No start time found.' }).find((r: { code: string }) => r.code === 'new-act').name).toBe('Dr. Rock & The Max');
    expect(sample('Venue not found in the listing.', { venueId: undefined, town: 'Syosset' })).toEqual(['no-venue']);
    expect(sample('Held for review: the tour page lists Illinois.', { lockedFields: ['status'] })).toEqual(['held']);
    expect(data.eveningTime('2026-10-16T06:30')).toBe('18:30');
    expect(data.eveningTime('2026-10-16T20:00')).toBe('');
  });
});
