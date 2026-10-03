import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { z } from 'astro/zod';
import {
  eventSchema,
  faqSchema,
  instructorSchema,
  organizerSchema,
  pageSchema,
  performerSchema,
  settingsSchema,
  sourceSchema,
  styleSchema,
  venueSchema,
} from '../../src/lib/schemas';
import { lookupPlace } from '../../ingest/lib/registry';
import { resolveOccurrences } from '../../src/lib/event-core';

const root = join(__dirname, '..', '..');
const content = join(root, 'src', 'content');
const load = (dir: string, ext: string) =>
  readdirSync(join(content, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ id: f.slice(0, -ext.length), raw: readFileSync(join(content, dir, f), 'utf8') }))
    .map((x) => ({ id: x.id, data: ext === '.json' ? JSON.parse(x.raw) : YAML.parse(x.raw) }));

const img = () => z.string();
const collections = {
  events: { ext: '.json', schema: eventSchema },
  venues: { ext: '.json', schema: venueSchema },
  performers: { ext: '.json', schema: performerSchema },
  instructors: { ext: '.json', schema: instructorSchema },
  organizers: { ext: '.json', schema: organizerSchema },
  sources: { ext: '.json', schema: sourceSchema },
  styles: { ext: '.yml', schema: styleSchema },
  faqs: { ext: '.yml', schema: faqSchema },
} as const;

describe('every content file is valid', () => {
  for (const [dir, { ext, schema }] of Object.entries(collections)) {
    it(`${dir} (${ext})`, () => {
      const items = load(dir, ext);
      expect(items.length, `${dir} should not be empty`).toBeGreaterThan(0);
      for (const item of items) {
        const r = (schema as z.ZodType).safeParse(item.data);
        expect(r.success, `${dir}/${item.id}${ext}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`).toBe(true);
        expect(item.id, `${dir}/${item.id} file names must be lowercase-hyphen ids`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      }
    });
  }
  it('settings and pages', () => {
    expect(settingsSchema(img).safeParse(YAML.parse(readFileSync(join(content, 'settings', 'site.yml'), 'utf8'))).success).toBe(true);
    for (const f of readdirSync(join(content, 'pages'))) {
      const fm = readFileSync(join(content, 'pages', f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!;
      expect(pageSchema(img).safeParse(YAML.parse(fm)).success, f).toBe(true);
    }
  });
});

describe('links between entities', () => {
  const ids = (dir: string) => new Set(readdirSync(join(content, dir)).map((f) => f.replace(/\.(json|yml)$/, '')));
  const venues = ids('venues');
  const organizers = ids('organizers');
  const performers = ids('performers');
  const instructors = ids('instructors');
  const styles = ids('styles');
  const sources = ids('sources');
  const events = load('events', '.json');
  it('every event points at records that exist', () => {
    for (const { id, data } of events) {
      if (data.venueId) expect(venues.has(data.venueId), `${id} venue ${data.venueId}`).toBe(true);
      if (data.organizerId) expect(organizers.has(data.organizerId), `${id} organizer ${data.organizerId}`).toBe(true);
      for (const p of data.performerIds ?? []) expect(performers.has(p), `${id} performer ${p}`).toBe(true);
      for (const p of data.instructorIds ?? []) expect(instructors.has(p), `${id} instructor ${p}`).toBe(true);
      for (const s of data.danceStyles ?? []) expect(styles.has(s), `${id} style ${s}`).toBe(true);
      expect(sources.has(data.sourceId), `${id} source ${data.sourceId}`).toBe(true);
    }
  });
  it('organizers, teachers and styles point at records that exist', () => {
    for (const { id, data } of load('organizers', '.json')) {
      if (data.homeVenueId) expect(venues.has(data.homeVenueId), id).toBe(true);
      for (const s of data.danceStyles ?? []) expect(styles.has(s), `${id} style ${s}`).toBe(true);
    }
    for (const { id, data } of load('instructors', '.json')) {
      for (const o of data.affiliatedOrganizerIds ?? []) expect(organizers.has(o), `${id} organizer ${o}`).toBe(true);
      for (const s of data.styles ?? []) expect(styles.has(s), `${id} style ${s}`).toBe(true);
    }
  });
  it('every venue is in Nassau or Suffolk, in the county that matches its town', () => {
    for (const { id, data } of load('venues', '.json')) {
      const place = lookupPlace(data.town);
      expect(place, `${id}: ${data.town} is not a Nassau or Suffolk place`).toBeDefined();
      expect(place!.county, id).toBe(data.county);
    }
  });
  it('every event is attributed to its source and written in our own words', () => {
    for (const { id, data } of events) {
      expect(data.sourceUrl, id).toMatch(/^https:\/\//);
      expect(data.summary.length, id).toBeLessThanOrEqual(320);
      expect(data.summary, `${id} should not contain the source's phone-book style text`).not.toMatch(/Ad pg|Info:|For more information call/i);
    }
  });
  it('all events expand to unique URLs', () => {
    const raw = events.map((e) => ({ id: e.id, data: eventSchema.parse(e.data) }));
    expect(() => resolveOccurrences(raw, { now: new Date('2026-10-03T12:00:00Z') })).not.toThrow();
  });
  it('sample photos keep their credits', () => {
    expect(existsSync(join(content, 'gallery'))).toBe(true);
    for (const { data } of load('gallery', '.yml')) for (const i of data.images) expect(i.credit, i.alt).toBeTruthy();
  });
});
