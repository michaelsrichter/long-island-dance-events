/**
 * Golden tests for the generic adapters (JSON-LD, iCal, HTML lists). Fixtures are fictional pages
 * and feeds in ingest/fixtures/. Update the golden files after an intended change with:
 *   UPDATE_GOLDEN=1 npx vitest run tests/unit/adapters-generic.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventSchema } from '../../src/lib/schemas';
import { adapter as htmllist, actName, dateBlocks, findDates, inferDate, meaningfulLine } from '../../ingest/adapters/htmllist';
import { adapter as ical, foundFromIcs, icsTimeToLocal, parseIcs, splitLocation } from '../../ingest/adapters/ical';
import { adapter as jsonld, eventNodes, jsonLdBlocks, sitemapLinks } from '../../ingest/adapters/jsonld';
import { collapse } from '../../ingest/lib/collapse';
import { Registry, ROOT } from '../../ingest/lib/registry';
import { displayActOk, entityNameFromSource, findPlaceInText, findVenue, htmlToLines, isoToLocal, performerNameOk } from '../../ingest/lib/structured';
import type { Adapter, AdapterContext, FetchedDocument } from '../../ingest/lib/types';

const TODAY = '2026-10-03';
const FIX = join(ROOT, 'ingest', 'fixtures');
const real = Registry.load();

function fixtureRegistry() {
  return new Registry(
    // Fictional researched venues, as if they were files in src/content/venues/.
    new Map([
      ['example-lodge', { name: 'Example Lodge', aliases: [], address: '12 Fictional Ave', town: 'Huntington', county: 'Suffolk' as const, state: 'NY' }],
      ['sample-pub', { name: 'Sample Pub', aliases: ['Sample Pub Babylon'], address: '5 Pretend Lane', town: 'Babylon', county: 'Suffolk' as const, state: 'NY' }],
      ['sample-tavern', { name: 'Sample Tavern', aliases: [], address: '77 Pretend Rd', town: 'Bay Shore', county: 'Suffolk' as const, state: 'NY' }],
    ]),
    new Map([['dj-sample', { name: 'DJ Sample', type: 'dj' as const, aliases: [], genres: [] }]]),
    new Map(),
    new Map(),
    real.styles,
    new Map(),
    new Map(),
  );
}

function context(source: Record<string, unknown>, registry = fixtureRegistry()): AdapterContext {
  return {
    source: { id: 'test-source', name: 'Test source', url: 'https://example.test/', type: 'html', adapter: 'htmllist', cadence: 'weekly', enabled: true, attribution: 'Test', rateLimitSeconds: 3, lastStatus: 'never', ...source } as unknown as AdapterContext['source'],
    registry,
    fetcher: undefined as unknown as AdapterContext['fetcher'],
    today: TODAY,
    offline: true,
    log: () => {},
  };
}

const doc = (file: string, url: string): FetchedDocument => ({ url, file: join(FIX, file), contentType: 'text/html', meta: {} });

async function runGolden(name: string, a: Adapter, file: string, url: string, source: Record<string, unknown>) {
  const ctx = context(source);
  const result = await a.normalize([doc(file, url)], ctx);
  const drafts = collapse(result.candidates);
  const golden = join(FIX, `${name}.events.json`);
  const actual = JSON.stringify({ outOfArea: result.outOfArea, skipped: result.skipped, created: { venues: [...ctx.registry.created.venues], performers: [...ctx.registry.created.performers] }, drafts }, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN || !existsSync(golden)) writeFileSync(golden, actual);
  expect(actual).toBe(readFileSync(golden, 'utf8'));
  for (const d of drafts) expect(() => eventSchema.parse({ ...d.data, firstSeen: TODAY, lastSeen: TODAY })).not.toThrow();
  return { result, drafts, ctx };
}

describe('shared helpers', () => {
  it('converts feed times to New York local time', () => {
    expect(isoToLocal('2026-10-18T18:00:00Z')).toBe('2026-10-18T14:00');
    expect(isoToLocal('2026-12-18T18:00:00Z')).toBe('2026-12-18T13:00');
    expect(isoToLocal('2026-10-16T21:00:00-04:00')).toBe('2026-10-16T21:00');
    expect(isoToLocal('2026-10-31T19:30:00')).toBe('2026-10-31T19:30');
    expect(isoToLocal('2026-11-07')).toBe('2026-11-07');
    expect(isoToLocal('next Friday')).toBeUndefined();
  });
  it('finds Long Island towns in free text, but not look-alikes in other states', () => {
    expect(findPlaceInText('Sample Pub, Babylon NY 9pm')?.name).toBe('Babylon');
    expect(findPlaceInText('Somewhere Tavern, Hoboken NJ')).toBeUndefined();
    expect(findPlaceInText('Live at the Huntington Moose Lodge')?.name).toBe('Huntington');
    expect(findPlaceInText('Woodbury, NJ - Elks Lodge')).toBeUndefined();
    expect(findPlaceInText('Dinner with Shirley and friends')).toBeUndefined();
  });
  it('names a venue or band from the source name', () => {
    expect(entityNameFromSource("Daisy's (Miller Place) - live music calendar")).toBe("Daisy's");
    expect(entityNameFromSource('The Pretend Band - shows')).toBe('The Pretend Band');
  });
  it('keeps line breaks at blocks and drops scripts, navigation and footers', () => {
    const lines = htmlToLines(readFileSync(join(FIX, 'htmllist-venue.html'), 'utf8'));
    expect(lines.join(' ')).not.toMatch(/tracking|specials|Pretend Lane/);
    expect(lines).toContain('Fri, Oct 9');
  });
});

describe('names and venues are checked before anything new is created', () => {
  it('only adds bands and DJs with clean names', () => {
    for (const bad of ['-10:30pmLive Music: 4 Shades of GreySaturday', 'Ann Wilson: The Voice of Heart & Tripsitter', 'AMH', 'John vs Paul — Matinee', 'Show No Mercy, Damage Inc., & Chaotica', 'Halloween Party w/ Hello Brooklyn', 'COLUMBUS DAY STREET FAIR & CARNIVAL'])
      expect(performerNameOk(bad), bad).toBe(false);
    for (const good of ['The Fictionals', 'Gene Casey & the Lone Sharks', 'DJ Sample', '4 Shades of Grey', '10 Cent Redemption', 'Smells Like Nirvana'])
      expect(performerNameOk(good), good).toBe(true);
    expect(displayActOk('Ann Wilson: The Voice of Heart & Tripsitter')).toBe(true);
    expect(displayActOk('-10:30pmLive Music: RevivalFriday')).toBe(false);
  });
  it('matches existing venues by name, alias or street address in the same town', () => {
    const reg = fixtureRegistry();
    expect(findVenue(reg, 'SAMPLE PUB', undefined, 'Babylon')).toBe('sample-pub');
    expect(findVenue(reg, 'Sample Pub Babylon', undefined, 'Babylon')).toBe('sample-pub');
    expect(findVenue(reg, 'The Pub on Pretend Lane', '5 Pretend Ln', 'Babylon')).toBe('sample-pub');
    expect(findVenue(reg, 'Sample Pub', undefined, 'Riverhead')).toBeUndefined();
    expect(findVenue(reg, 'Somewhere New', undefined, 'Babylon')).toBeUndefined();
  });
  it('never invents a venue without a street address', async () => {
    const ctx = context({ adapter: 'jsonld', type: 'jsonld', focus: 'music' });
    const { toCandidates } = await import('../../ingest/lib/structured');
    const r = toCandidates([{ title: 'The Fictionals', start: '2026-10-20T20:00', locationName: 'New Place', locality: 'Babylon', pageUrl: 'https://example.test/e' }], ctx, { structured: true });
    expect(r.candidates).toHaveLength(0);
    expect(r.skipped).toEqual([{ reason: 'venue not researched yet', ref: 'listing 2026-10-20 New Place (Babylon)' }]);
    expect([...ctx.registry.created.venues]).toEqual([]);
  });
});

describe('JSON-LD adapter', () => {
  it('reads every Event node and skips broken blocks', () => {
    const nodes = eventNodes(jsonLdBlocks(readFileSync(join(FIX, 'jsonld-sample.html'), 'utf8')));
    expect(nodes.map((n) => n.name)).toHaveLength(5);
  });
  it('reads sitemaps newest first', () => {
    const xml = '<urlset><url><loc>https://x.test/event-details/a</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://x.test/event-details/b</loc><lastmod>2026-09-01</lastmod></url></urlset>';
    expect(sitemapLinks(xml)).toEqual(['https://x.test/event-details/b', 'https://x.test/event-details/a']);
  });
  it('matches the golden events', async () => {
    const { result, drafts, ctx } = await runGolden('jsonld-sample', jsonld, 'jsonld-sample.html', 'https://example-bar.example/events/', { adapter: 'jsonld', type: 'jsonld', focus: 'music' });
    expect(result.outOfArea).toEqual([{ town: 'Hoboken', count: 1 }]);
    expect(result.skipped.map((s) => s.reason)).toContain('cancelled by the source');
    expect([...ctx.registry.created.venues]).toEqual(['example-bar-and-grill-babylon']);
    const rock = drafts.find((d) => d.data.town === 'Babylon')!.data;
    expect(rock).toMatchObject({ category: 'live-music', start: '2026-10-16T21:00', price: 10, venueId: 'example-bar-and-grill-babylon' });
    expect(rock.performerIds).toEqual(['the-example-rockers']);
    const wcs = drafts.find((d) => d.data.venueId === 'example-lodge')!.data;
    expect(wcs).toMatchObject({ category: 'lesson-party', isFree: true, danceStyles: ['west-coast-swing'], start: '2026-10-31T19:30' });
    expect(wcs.title).toMatch(/^Halloween/);
  });
});

describe('iCal adapter', () => {
  const raw = readFileSync(join(FIX, 'ical-sample.ics'), 'utf8');
  it('unfolds lines, unescapes text and skips alarms', () => {
    const events = parseIcs(raw);
    expect(events).toHaveLength(7);
    expect(events[0]!.get('DESCRIPTION')![0]!.value).toContain('$15 at the door');
    expect(events[0]!.get('ACTION')).toBeUndefined();
  });
  it('converts UTC, time zones and all-day dates', () => {
    expect(icsTimeToLocal('20261018T180000Z', {})).toBe('2026-10-18T14:00');
    expect(icsTimeToLocal('20261006T193000', { TZID: 'America/New_York' })).toBe('2026-10-06T19:30');
    expect(icsTimeToLocal('20261006T193000', { TZID: 'America/Chicago' })).toBe('2026-10-06T20:30');
    expect(icsTimeToLocal('20261107', { VALUE: 'DATE' })).toBe('2026-11-07');
  });
  it('splits a location into name, street and town', () => {
    expect(splitLocation('Example Lodge, 12 Fictional Ave, Huntington, NY 11743')).toEqual({ locationName: 'Example Lodge', address: '12 Fictional Ave', locality: 'Huntington' });
    expect(splitLocation('Studio Q, 5 Test Blvd, Astoria, NY 11102').locality).toBe('Astoria');
  });
  it('expands repeat rules, drops skipped dates and uses moved dates', () => {
    const found = foundFromIcs(raw, 'https://example-lodge.example/feed.ics', TODAY);
    const swing = found.filter((f) => /Tuesday East Coast Swing/.test(f.title)).map((f) => f.start);
    expect(swing).toEqual(['2026-10-06T19:30', '2026-10-20T19:30', '2026-11-03T19:30']);
    expect(found.find((f) => /Halloween/.test(f.title))?.start).toBe('2026-10-27T20:00');
    expect(found.find((f) => /boot camp/.test(f.title))?.notes?.[0]).toMatch(/not supported/);
  });
  it('matches the golden events', async () => {
    const { result, drafts } = await runGolden('ical-sample', ical, 'ical-sample.ics', 'https://example-lodge.example/feed.ics', { adapter: 'ical', type: 'ical', focus: 'dance' });
    expect(result.outOfArea).toEqual([{ town: 'Astoria', count: 1 }]);
    const tuesday = drafts.find((d) => d.data.venueId === 'example-lodge' && d.data.category === 'lesson-party');
    expect(tuesday?.data).toMatchObject({ danceStyles: ['east-coast-swing'], lessonTime: '19:30', price: 15, start: '2026-10-06T19:30' });
    expect(tuesday?.data.recurrence?.rrule).toBeDefined();
    expect(drafts.find((d) => d.data.town === 'Smithtown')?.data.start).toBe('2026-10-18T14:00');
    // "Sample Hall, Riverhead, NY" has no street address and is not a known venue: skipped, never invented.
    expect(result.skipped.filter((s) => s.reason === 'venue not researched yet').map((s) => s.ref).sort()).toEqual([
      'calendar feed 2026-10-05 Sample Hall (Riverhead)',
      'calendar feed 2026-11-07 Sample Hall (Riverhead)',
    ]);
    expect(drafts.some((d) => d.data.town === 'Riverhead')).toBe(false);
  });
});

describe('HTML list adapter', () => {
  it('reads dates in many shapes and guesses the year', () => {
    expect(findDates('Fri, Oct 9 and Friday, October 23, 2026', TODAY).map((h) => h.date)).toEqual(['2026-10-09', '2026-10-23']);
    expect(findDates('Sat 10/24 8pm', TODAY).map((h) => h.date)).toEqual(['2026-10-24']);
    expect(findDates('Call 10/24 for tickets', TODAY)).toEqual([]);
    expect(findDates('Jan 9', TODAY).map((h) => h.date)).toEqual(['2027-01-09']);
    expect(inferDate({ mo: 2, d: 30 }, TODAY)).toBeUndefined();
  });
  it('keeps one listing when the same date appears twice in a row', () => {
    const blocks = dateBlocks(['Oct 2', '6:00 PM HAPPY HOUR BAND: ONE NITE BAND', 'Friday, October 2, 2026 6:00 PM 10:00 PM'], '2026-10-01');
    expect(blocks).toHaveLength(1);
  });
  it('finds the act in a venue listing', () => {
    expect(actName('Happy Hour Band: The Fictionals · 6-10pm')).toBe('The Fictionals');
    expect(actName('Trivia Night 8pm')).toBeUndefined();
    expect(actName('Live music 9pm')).toBeUndefined();
    expect(actName('Read more')).toBeUndefined();
    expect(actName('Tuesday')).toBeUndefined();
    expect(actName('Start date')).toBeUndefined();
    expect(actName('Miles To Go Presents')).toBeUndefined();
  });
  it('skips button labels, lone times and calendar cells when naming a listing', () => {
    expect(meaningfulLine('Read more', TODAY)).toBe(false);
    expect(meaningfulLine('Book', TODAY)).toBe(false);
    expect(meaningfulLine('9:00 PM / 21:00', TODAY)).toBe(false);
    expect(meaningfulLine('0 events on Saturday October 3 2026', TODAY)).toBe(false);
    expect(meaningfulLine('Live Music: 4 Shades of Fiction', TODAY)).toBe(true);
    const lines = ['Sat, Oct 10', 'Book', 'Sun, Oct 11', 'Read more', '07:00 PM - 10:00 PM', 'Live Music: The Fictionals'];
    expect(dateBlocks(lines, TODAY).map((b) => b.lines.find((l) => meaningfulLine(l, TODAY)))).toEqual([undefined, 'Live Music: The Fictionals']);
  });
  it('reads Squarespace event lists from their markup', async () => {
    const { drafts, ctx } = await runGolden('htmllist-squarespace', htmllist, 'htmllist-squarespace.html', 'https://sample-tavern.example/music', {
      name: 'Sample Tavern (Bay Shore) - music calendar',
      focus: 'music',
      defaults: { venueId: 'sample-tavern', town: 'Bay Shore' },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.data).toMatchObject({ start: '2026-10-16T21:00', venueId: 'sample-tavern', performerIds: ['the-fictionals'], infoUrl: 'https://sample-tavern.example/music/2026/10/16/the-fictionals' });
    expect([...ctx.registry.created.venues]).toEqual([]);
  });
  it("matches the golden events for a venue's own page", async () => {
    const { drafts, ctx, result } = await runGolden('htmllist-venue', htmllist, 'htmllist-venue.html', 'https://sample-pub.example/music', {
      name: 'Sample Pub (Babylon) - live music',
      focus: 'music',
      defaults: { venueId: 'sample-pub', town: 'Babylon' },
    });
    expect([...ctx.registry.created.venues]).toEqual([]);
    expect(drafts.every((d) => d.data.venueId === 'sample-pub')).toBe(true);
    expect(result.skipped.map((s) => s.reason)).toContain('not a dance or live-music listing');
    expect(drafts.map((d) => d.data.start).sort()).toEqual(['2026-10-09T18:00', '2026-10-10T21:00', '2026-10-23T21:00']);
    expect(drafts.find((d) => d.data.start === '2026-10-10T21:00')?.data.performerIds).toEqual(['dj-sample']);
  });
  it('keeps text from neighbouring elements apart (no glued band names)', async () => {
    const { drafts, ctx } = await runGolden('htmllist-glued', htmllist, 'htmllist-glued.html', 'https://sample-pub.example/calendar', {
      name: 'Sample Pub (Babylon) - live music',
      focus: 'music',
      defaults: { venueId: 'sample-pub', town: 'Babylon' },
    });
    const names = [...ctx.registry.performers.values()].map((p) => p.name);
    for (const n of names) expect(n).not.toMatch(/\d(am|pm)|[a-z](Saturday|Sunday)|^-|Live Music/);
    expect([...ctx.registry.created.performers].sort()).toEqual(['4-shades-of-fiction', 'revival-fictional']);
    const oct16 = drafts.find((d) => d.data.start === '2026-10-16T21:00')!.data;
    // Two acts joined with a colon: shown in the title, not added as a band.
    expect(oct16.title).toContain('Ann Example: The Voice of Fiction & Pretendsitter');
    expect(oct16.performerIds).toEqual([]);
    expect(drafts.find((d) => d.data.start === '2026-10-17T14:00')?.data.performerIds).toEqual([]);
  });
  it("matches the golden events for a band's own page", async () => {
    const { drafts, result } = await runGolden('htmllist-band', htmllist, 'htmllist-band.html', 'https://pretend-band.example/shows', {
      name: 'The Pretend Band - shows',
      focus: 'music',
      defaults: { performerIds: ['the-pretend-band'] },
    });
    expect(result.outOfArea).toEqual([{ town: 'town not stated', count: 1 }]);
    expect(drafts.map((d) => d.data.town).sort()).toEqual(['Babylon', 'Huntington']);
    expect(drafts.find((d) => d.data.town === 'Babylon')?.data.venueId).toBe('sample-pub');
    expect(result.skipped.map((s) => s.reason)).toContain('venue not researched yet');
    expect(drafts.every((d) => d.data.performerIds?.includes('the-pretend-band'))).toBe(true);
    expect(drafts.find((d) => d.data.town === 'Huntington')?.data).toMatchObject({ venueId: 'example-lodge', start: '2026-10-24T20:00', end: '2026-10-24T23:00' });
  });
});
