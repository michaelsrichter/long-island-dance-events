import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import YAML from 'yaml';
import {
  announcementSchema,
  eventSchema,
  faqSchema,
  gallerySchema,
  organizerSchema,
  pageSchema,
  personSchema,
  seriesSchema,
  settingsSchema,
  styleSchema,
  venueSchema,
} from '../../src/lib/schemas';
import { parseEvent } from './helpers';

const img = () => z.string();
const root = join(__dirname, '..', '..');
const frontmatter = (text: string) => YAML.parse(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!, { schema: 'yaml-1.1' });

describe('event schema rejects invalid CMS content', () => {
  const valid = { title: 'Band Night', startDateTime: '2026-10-06T19:30' };
  it('accepts a minimal valid event', () => {
    expect(parseEvent(valid).status).toBe('scheduled');
  });
  const cases: [string, Record<string, unknown>][] = [
    ['date in the wrong format', { ...valid, startDateTime: '10/06/2026 7:30 PM' }],
    ['a timezone offset in a local time', { ...valid, startDateTime: '2026-10-06T19:30-04:00' }],
    ['end before start', { ...valid, endDateTime: '2026-10-06T18:00' }],
    ['a photo without alt text', { ...valid, featuredImage: 'x.jpg' }],
    ['a series change without a date', { title: 'X', series: 'thursday-night-swing' }],
    ['a one-time event without a start date', { title: 'X' }],
    ['a negative price', { ...valid, admissionMember: -5 }],
    ['an unknown status', { ...valid, status: 'maybe' }],
    ['an invalid timezone', { ...valid, timezone: 'Riverbend Valley/Riverbend' }],
    ['an invalid web address name', { ...valid, slug: 'Band Night!' }],
    ['a lesson after open dancing starts', { ...valid, lessonStartTime: '21:00', danceStartTime: '20:00' }],
    ['a malformed link', { ...valid, registrationUrl: 'not a url' }],
    ['a 24-hour time out of range', { ...valid, lessonStartTime: '25:00' }],
  ];
  for (const [name, data] of cases) {
    it(`rejects ${name}`, () => {
      expect(eventSchema(img).safeParse(data).success).toBe(false);
    });
  }
  it('accepts times written as YAML 1.1 base-60 numbers', () => {
    expect(parseEvent({ ...valid, lessonStartTime: 1170 }).lessonStartTime).toBe('19:30');
  });
  it('treats empty CMS fields as not provided', () => {
    const e = parseEvent({ ...valid, admissionMember: '', registrationUrl: '', summary: null });
    expect(e.admissionMember).toBeUndefined();
    expect(e.registrationUrl).toBeUndefined();
  });
});

describe('all real content in the repository is valid', () => {
  const md = (dir: string, schema: z.ZodType) => {
    const folder = join(root, 'src', 'content', dir);
    for (const f of readdirSync(folder).filter((x) => x.endsWith('.md'))) {
      const result = schema.safeParse(frontmatter(readFileSync(join(folder, f), 'utf8')));
      expect(result.success, `${dir}/${f}: ${result.success ? '' : JSON.stringify(result.error.issues)}`).toBe(true);
    }
  };
  const yml = (dir: string, schema: z.ZodType) => {
    const folder = join(root, 'src', 'content', dir);
    for (const f of readdirSync(folder).filter((x) => x.endsWith('.yml'))) {
      const result = schema.safeParse(YAML.parse(readFileSync(join(folder, f), 'utf8'), { schema: 'yaml-1.1' }));
      expect(result.success, `${dir}/${f}: ${result.success ? '' : JSON.stringify(result.error.issues)}`).toBe(true);
    }
  };
  it('events', () => md('events', eventSchema(img)));
  it('series', () => md('series', seriesSchema(img)));
  it('venues', () => md('venues', venueSchema(img)));
  it('instructors and performers', () => {
    md('instructors', personSchema(img));
    md('performers', personSchema(img));
  });
  it('pages', () => md('pages', pageSchema(img)));
  it('styles, FAQs, announcements, gallery and settings', () => {
    yml('styles', styleSchema);
    yml('faqs', faqSchema);
    yml('announcements', announcementSchema);
    yml('gallery', gallerySchema(img));
    yml('settings', settingsSchema(img));
  });
  it('every event, series, FAQ, album and announcement has an explicit "published" flag (so the CMS toggle shows the real state)', () => {
    for (const dir of ['events', 'series']) {
      for (const f of readdirSync(join(root, 'src', 'content', dir)).filter((x) => x.endsWith('.md'))) {
        expect(Object.hasOwn(frontmatter(readFileSync(join(root, 'src', 'content', dir, f), 'utf8')), 'published'), `${dir}/${f}`).toBe(true);
      }
    }
    for (const dir of ['faqs', 'gallery', 'announcements']) {
      for (const f of readdirSync(join(root, 'src', 'content', dir)).filter((x) => x.endsWith('.yml'))) {
        expect(Object.hasOwn(YAML.parse(readFileSync(join(root, 'src', 'content', dir, f), 'utf8')), 'published'), `${dir}/${f}`).toBe(true);
      }
    }
  });
  it('every event references existing venues, people and styles', () => {
    const ids = (dir: string) => new Set(readdirSync(join(root, 'src', 'content', dir)).map((f) => f.replace(/\.(md|yml)$/, '')));
    const venues = ids('venues');
    const people = new Set([...ids('instructors'), ...ids('performers')]);
    const styles = ids('styles');
    for (const f of readdirSync(join(root, 'src', 'content', 'events'))) {
      const d = frontmatter(readFileSync(join(root, 'src', 'content', 'events', f), 'utf8'));
      if (d.venue) expect(venues.has(d.venue), `${f} venue ${d.venue}`).toBe(true);
      for (const p of [...(d.instructorNames ?? []), ...(d.djNames ?? []), ...(d.bandName ? [d.bandName] : [])]) expect(people.has(p), `${f} person ${p}`).toBe(true);
      for (const s of d.danceStyles ?? []) expect(styles.has(s), `${f} style ${s}`).toBe(true);
    }
  });
  it('organizers are valid, and everything they reference exists', () => {
    md('organizers', organizerSchema);
    const ids = (dir: string) => new Set(readdirSync(join(root, 'src', 'content', dir)).map((f) => f.replace(/\.(md|yml)$/, '')));
    const venues = ids('venues');
    const styles = ids('styles');
    const organizers = ids('organizers');
    for (const f of readdirSync(join(root, 'src', 'content', 'organizers'))) {
      const d = frontmatter(readFileSync(join(root, 'src', 'content', 'organizers', f), 'utf8'));
      if (d.venue) expect(venues.has(d.venue), `${f} venue ${d.venue}`).toBe(true);
      for (const s of d.danceStyles ?? []) expect(styles.has(s), `${f} style ${s}`).toBe(true);
    }
    for (const dir of ['instructors', 'performers']) {
      for (const f of readdirSync(join(root, 'src', 'content', dir))) {
        const d = frontmatter(readFileSync(join(root, 'src', 'content', dir, f), 'utf8'));
        if (d.organizer) expect(organizers.has(d.organizer), `${dir}/${f} organizer ${d.organizer}`).toBe(true);
      }
    }
  });
  it('every community event says who runs it, how to reach them and where the listing came from', () => {
    const organizers = new Set(readdirSync(join(root, 'src', 'content', 'organizers')).map((f) => f.replace(/\.md$/, '')));
    const people = new Set([...readdirSync(join(root, 'src', 'content', 'instructors')), ...readdirSync(join(root, 'src', 'content', 'performers'))].map((f) => f.replace(/\.md$/, '')));
    let count = 0;
    for (const dir of ['events', 'series']) {
      for (const f of readdirSync(join(root, 'src', 'content', dir))) {
        const d = frontmatter(readFileSync(join(root, 'src', 'content', dir, f), 'utf8'));
        if (d.host !== 'community') continue;
        count++;
        expect(d.organizer, `${dir}/${f} organizer`).toBeTruthy();
        expect(organizers.has(d.organizer), `${dir}/${f} organizer ${d.organizer}`).toBe(true);
        expect(d.sourceName, `${dir}/${f} sourceName`).toBeTruthy();
        for (const p of [...(d.instructorNames ?? []), ...(d.djNames ?? []), ...(d.bandName ? [d.bandName] : [])]) expect(people.has(p), `${dir}/${f} person ${p}`).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(0);
  });
  it('sample teachers with a website carry it, and profile links use example domains', () => {
    const maya = frontmatter(readFileSync(join(root, 'src', 'content', 'instructors', 'maya-rivera.md'), 'utf8'));
    expect(maya.website).toBe('https://example.com/teachers/maya-rivera');
    for (const dir of ['instructors', 'performers', 'organizers', 'venues']) {
      for (const f of readdirSync(join(root, 'src', 'content', dir))) {
        const d = frontmatter(readFileSync(join(root, 'src', 'content', dir, f), 'utf8'));
        const urls = [d.website, d.facebookUrl, d.instagramUrl, d.youtubeUrl, ...(d.moreLinks ?? []).map((l: { url: string }) => l.url)].filter(Boolean);
        for (const u of urls) expect(u, `${dir}/${f}`).toMatch(/^https:\/\/(example\.org|example\.com|www\.facebook\.com|www\.google\.com)\b/);
      }
    }
  });
});


