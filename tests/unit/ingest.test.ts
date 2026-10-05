import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventSchema } from '../../src/lib/schemas';
import { addDays } from '../../src/lib/time';
import { extractRows, findDjNames, guessVenue, normalizeRows, python, statedCadence } from '../../ingest/adapters/thedancecalendar';
import { collapse, inferRecurrence } from '../../ingest/lib/collapse';
import { makeSummary, plainLabel, themeOf } from '../../ingest/lib/describe';
import { isAllowed, parseRobots } from '../../ingest/lib/fetch';
import { mergeDrafts } from '../../ingest/lib/merge';
import { parsePrices } from '../../ingest/lib/prices';
import { lookupPlace, Registry, ROOT } from '../../ingest/lib/registry';
import { cleanListingText, extractPhones, extractUrls, slugify } from '../../ingest/lib/text';
import { findLessonTime, parseSchedule, parseTimes } from '../../ingest/lib/times';

const real = Registry.load();
/** Registry with the real style taxonomy and small fictional venues and organizers. */
function fixtureRegistry() {
  return new Registry(
    new Map([['example-lodge', { name: 'Example Lodge', aliases: [], address: '12 Fictional Ave', town: 'Huntington', county: 'Suffolk' as const, state: 'NY' }]]),
    new Map([['dj-sample', { name: 'DJ Sample', type: 'dj' as const, aliases: [], genres: [] }]]),
    new Map(),
    new Map([['practice-studio', { name: 'Practice Studio', type: 'studio' as const, aliases: [], website: 'https://practicestudio.example', danceStyles: [], optOut: false }]]),
    real.styles,
    new Map(),
    new Map(),
  );
}

describe('time parsing', () => {
  const cases: [string, string | undefined, string | undefined, string | undefined][] = [
    ['Dance 7-11pm.', '19:00', '23:00', undefined],
    ['8pm-12am. Open bar.', '20:00', '00:00', undefined],
    ['12- 2pm Practice Social', '12:00', '14:00', undefined],
    ['Mangia, Music & Dancing 7 PM to 11 PM.', '19:00', '23:00', undefined],
    ['East Coast Swing Lesson at 7:30pm, DJ music at 8pm.', '19:30', undefined, '19:30'],
    ['7:30 PM to 8 PM group class followed by 8 PM to 10 PM dance party!', '19:30', '22:00', '19:30'],
    ['Complimentary Beginner Lesson at 6PM With Shah. Dance 7-11pm.', '18:00', '23:00', '18:00'],
    ['Doors open 6:30PM. Music starts 7PM. Coffee available at 10pm.', '19:00', undefined, undefined],
    ['Brunch dance 11-2pm', '11:00', '14:00', undefined],
    ['Call 631-476-3707 for details.', undefined, undefined, undefined],
    ['Advanced ticket sales close at 5PM the day of this event.', undefined, undefined, undefined],
    ['A decision will be made by 3 PM if we must cancel because of bad weather.', undefined, undefined, undefined],
    ['Dinner, followed by 8 PM to 11 PM dancing.', '20:00', '23:00', undefined],
  ];
  it.each(cases)('%s', (text, start, end, lesson) => {
    const t = parseTimes(text);
    expect(t.start).toBe(start);
    expect(t.end).toBe(end);
    expect(t.lessonTime).toBe(lesson);
  });
  it('reads class timetables in plain language', () => {
    const text = '4:45pm Int/ Adv WCS, 5:45pm Adv WCS, 6:45pm Ballroom Mix. Info: call.';
    expect(parseSchedule(text).map((s) => `${s.start} ${plainLabel(s.label)}`)).toEqual([
      '16:45 intermediate/advanced West Coast Swing',
      '17:45 advanced West Coast Swing',
      '18:45 Ballroom Mix',
    ]);
  });
  it('ignores private lessons when looking for a lesson time', () => {
    expect(findLessonTime('Private lessons also available. Dance 8pm.')).toBeUndefined();
  });
});

describe('price parsing', () => {
  it('reads per-person and per-couple prices', () => {
    expect(parsePrices('$18pp ($30 per couple).')).toEqual({ price: 18, priceMax: undefined, notes: ['$30 per couple'] });
  });
  it('keeps a range and notes', () => {
    const p = parsePrices('$15/person. Band nights $20. Discounts for members.');
    expect([p.price, p.priceMax]).toEqual([15, 20]);
    expect(p.notes).toContain('Members pay less');
  });
  it('does not treat a free first class as free admission', () => {
    const p = parsePrices('$35 per person. FIRST CLASS IS FREE for New Students Only!');
    expect(p.price).toBe(35);
    expect(p.isFree).toBeUndefined();
    expect(p.notes).toContain('First class free for new students');
  });
  it('detects free events without a price', () => {
    expect(parsePrices('Milonga 6-10pm. Free.').isFree).toBe(true);
    expect(parsePrices('Free Hustle lesson at 7pm.').isFree).toBeUndefined();
  });
});

describe('text helpers', () => {
  it('fixes split web and email addresses', () => {
    expect(cleanListingText('www. donnadesimone.us or info@ thestudio.com and site. com')).toBe('www.donnadesimone.us or info@thestudio.com and site.com');
  });
  it('extracts phones and urls but not email domains', () => {
    expect(extractPhones('Call 631.476.3707 or (516) 375-8498')).toEqual(['(631) 476-3707', '(516) 375-8498']);
    expect(extractUrls('www.SDLI.org or email info@example.com')).toEqual(['https://www.sdli.org']);
  });
  it('slugifies at word boundaries', () => {
    expect(slugify('2026-10-24 Halloween Long Island Country Music Association social', 50)).toBe('2026-10-24-halloween-long-island-country-music');
  });
});

describe('matching', () => {
  it('prefers longer style names', () => {
    expect(real.matchStyles('Hustle, WCS, Country Two step, Latin & Smooth')).toEqual(['hustle', 'west-coast-swing', 'country-two-step', 'latin-ballroom', 'ballroom']);
    expect(real.matchStyles('West Coast Swing night')).toEqual(['west-coast-swing']);
    expect(real.matchStyles('Latin Hustle group class')).toEqual(['hustle']);
  });
  it('reads a bare "tango" by context', () => {
    expect(real.matchStyles('Foxtrot, Waltz, Tango')).toEqual(['ballroom']);
    expect(real.matchStyles('Tango practica tonight')).toEqual(['argentine-tango']);
  });
  it('keeps only Nassau and Suffolk', () => {
    expect(lookupPlace('Bay Shore')?.county).toBe('Suffolk');
    expect(lookupPlace('Bayshore')?.name).toBe('Bay Shore');
    expect(lookupPlace('Great Neck')?.county).toBe('Nassau');
    expect(lookupPlace('Little Neck, Queens')).toBeUndefined();
    expect(lookupPlace('Brooklyn')).toBeUndefined();
  });
  it('matches venues by street address', () => {
    expect(real.matchVenue('Dance at 2075 Deer Park Ave. tonight', 'Deer Park')).toBe('brumidi-lodge');
  });
  it('finds DJs, stated repeat patterns, themes and unknown venues', () => {
    expect(findDjNames("Music by DJ Gene & Joanne. DJ Ray's party. DJ Neil Wrangler - DJ Only Night")).toEqual(['DJ Gene & Joanne', 'DJ Ray', 'DJ Neil Wrangler']);
    expect(statedCadence('Held on the first and third Friday of every month.')).toEqual({ cadence: '1st and 3rd Fridays of the month', ordinals: [1, 3] });
    expect(statedCadence('Dances held alternating Tuesdays.').note).toMatch(/every other tuesday/);
    expect(themeOf("DJ Ray's Hallloween Party!")).toBe('Halloween');
    expect(guessVenue('Social at the Example Grange, 45 Main Street. 7pm.')).toEqual({ name: 'Example Grange', address: '45 Main Street' });
  });
});

describe('robots.txt', () => {
  const rules = parseRobots('User-agent: *\nAllow: /\nDisallow: *?lightbox=\n\nUser-agent: PetalBot\nDisallow: /\n');
  it('honors wildcard rules for every bot', () => {
    expect(isAllowed(rules, '/dance-calendar')).toBe(true);
    expect(isAllowed(rules, '/gallery?lightbox=1')).toBe(false);
  });
  it('uses a group for this bot when there is one', () => {
    expect(isAllowed(parseRobots('User-agent: LongIslandDanceEventsBot\nDisallow: /private\n'), '/private/x')).toBe(false);
  });
});

describe('repeat rules from dates', () => {
  it('weekly', () => expect(inferRecurrence(['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'])).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028', rdates: [], exdates: [] }));
  it('weekly with one skipped week', () =>
    expect(inferRecurrence(['2026-10-05', '2026-10-12', '2026-10-26'])).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026', rdates: [], exdates: ['2026-10-19'] }));
  it('monthly only when the source states it', () => {
    expect(inferRecurrence(['2026-10-02', '2026-10-16'], [1, 3])).toEqual({ rrule: 'FREQ=MONTHLY;BYDAY=1FR,3FR;UNTIL=20261016', rdates: [], exdates: [] });
    expect(inferRecurrence(['2026-10-09', '2026-10-23'])).toEqual({ rdates: ['2026-10-23'], exdates: [] });
  });
});

describe('summaries', () => {
  it('uses the right article and plain words', () => {
    const s = makeSummary({ category: 'lesson-party', styles: ['east-coast-swing'], lessonStyles: ['east-coast-swing'], djs: [], liveActs: [], instructors: [], lessonTime: '19:30', schedule: [], skillLevel: 'all-levels', facts: 'open bar' });
    expect(s).toBe('An East Coast Swing group lesson at 7:30 PM, then open social dancing. There is an open bar.');
  });
});

const hasPython = spawnSync(python(), ['-c', 'import pymupdf'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!hasPython)('fixture PDF to events (golden file)', () => {
  const golden = join(ROOT, 'ingest', 'fixtures', 'tdc-sample.events.json');
  const run = () => {
    const reg = fixtureRegistry();
    const rows = extractRows(join(ROOT, 'ingest', 'fixtures', 'tdc-sample.pdf'), '2030-11');
    const result = normalizeRows(rows, { sourceId: 'thedancecalendar', sourceUrl: 'https://www.thedancecalendar.com/sample.pdf', issue: '2030-11', registry: reg });
    return { result, reg, drafts: collapse(result.candidates) };
  };
  it('matches the golden events', () => {
    const { result, drafts } = run();
    expect(result.outOfArea).toEqual([{ town: 'Little Neck, Queens', count: 1 }]);
    const actual = JSON.stringify(drafts, null, 2) + '\n';
    if (process.env.UPDATE_GOLDEN || !existsSync(golden)) writeFileSync(golden, actual);
    expect(actual).toBe(readFileSync(golden, 'utf8'));
  });
  it('writes our own words, not the source text', () => {
    const { drafts } = run();
    for (const d of drafts) {
      expect(d.data.summary).not.toMatch(/keeps going|must stay joined|Fictional Ave/);
      expect(() => eventSchema.parse({ ...d.data, firstSeen: '2030-11-01', lastSeen: '2030-11-01' })).not.toThrow();
    }
  });
  it('adds unknown venues for review and links known ones', () => {
    const { reg, drafts } = run();
    expect([...reg.created.venues]).toEqual(['practice-studio-bay-shore', 'sample-hall-riverhead']);
    expect(reg.venues.get('practice-studio-bay-shore')).toMatchObject({ name: 'Practice Studio', address: '99 Test St', county: 'Suffolk' });
    expect(drafts.find((d) => d.data.town === 'Huntington')?.data.venueId).toBe('example-lodge');
    expect(drafts.find((d) => d.data.town === 'Bay Shore')?.data.organizerId).toBe('practice-studio');
  });
  it('drops every listing from an organizer who opted out', () => {
    const reg = fixtureRegistry();
    reg.organizers.set('practice-studio', { ...reg.organizers.get('practice-studio')!, optOut: true });
    const rows = extractRows(join(ROOT, 'ingest', 'fixtures', 'tdc-sample.pdf'), '2030-11');
    const result = normalizeRows(rows, { sourceId: 'thedancecalendar', sourceUrl: 'https://www.thedancecalendar.com/sample.pdf', issue: '2030-11', registry: reg });
    expect(result.skipped.some((s) => /practice-studio opted out/.test(s.reason))).toBe(true);
    expect(result.candidates.some((c) => c.organizerId === 'practice-studio' || c.town === 'Bay Shore')).toBe(false);
  });
});

describe('merging runs', () => {
  const cand = {
    sourceId: 's', sourceUrl: 'https://example.org/a.pdf', sourceName: 'Example, October 2026', sourceRef: 'page 1', date: '2026-10-06', start: '19:30',
    category: 'social-dance', danceStyles: ['hustle'], town: 'Huntington', performerIds: [], instructorIds: [], skillLevel: 'all-levels',
    title: 'Hustle social dance', summary: 'An evening of Hustle social dancing.', seriesTitle: 'Hustle social dance', seriesSummary: 'An evening of Hustle social dancing.',
    confidence: 0.9, reviewNotes: [], seriesKey: 'k', oneOff: false,
  };
  const draft = (overrides: Record<string, unknown> = {}) => collapse([{ ...cand, ...overrides } as Parameters<typeof collapse>[0][number]]);
  it('is idempotent and keeps firstSeen', () => {
    const first = mergeDrafts(new Map(), draft(), { sourceId: 's', today: '2026-10-01' });
    const stored = new Map([...first.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    const second = mergeDrafts(stored, draft(), { sourceId: 's', today: '2026-10-03' });
    expect(second.stats).toMatchObject({ new: 0, unchanged: 1 });
    const e = [...second.events.values()][0]!;
    expect([e.firstSeen, e.lastSeen]).toEqual(['2026-10-01', '2026-10-03']);
  });
  it('never overwrites locked fields', () => {
    const first = mergeDrafts(new Map(), draft(), { sourceId: 's', today: '2026-10-01' });
    const [id, e] = [...first.events][0]!;
    const stored = new Map([[id, eventSchema.parse({ ...e, title: 'Edited by hand', lockedFields: ['title'] })]]);
    const next = mergeDrafts(stored, draft({ title: 'Scraped title' }), { sourceId: 's', today: '2026-10-02' });
    expect(next.events.get(id)!.title).toBe('Edited by hand');
  });
  it('keeps an editor note when the editor locked the status', () => {
    const first = mergeDrafts(new Map(), draft(), { sourceId: 's', today: '2026-10-01' });
    const [id, e] = [...first.events][0]!;
    const held = eventSchema.parse({ ...e, status: 'pending-review', lockedFields: ['status'], reviewNotes: 'Band is on tour that night.' });
    const next = mergeDrafts(new Map([[id, held]]), draft(), { sourceId: 's', today: '2026-10-02' });
    expect(next.events.get(id)).toMatchObject({ status: 'pending-review', reviewNotes: 'Band is on tour that night.' });
    expect(next.stats).toMatchObject({ updated: 0, unchanged: 1 });
  });
  it('keeps a listing an editor hid hidden, even when the source lists it again', () => {
    const first = mergeDrafts(new Map(), draft(), { sourceId: 's', today: '2026-10-01' });
    const [id, e] = [...first.events][0]!;
    const hidden = eventSchema.parse({ ...e, status: 'hidden', reviewNotes: 'Hidden by the owner: a copy of another listing.' });
    const next = mergeDrafts(new Map([[id, hidden]]), draft({ confidence: 1 }), { sourceId: 's', today: '2026-10-02' });
    expect(next.events.get(id)).toMatchObject({ status: 'hidden' });
    expect(next.review).toEqual([]);
  });
  it('marks ended events past and vanished ones for review, without deleting', () => {
    const first = mergeDrafts(new Map(), draft(), { sourceId: 's', today: '2026-10-01' });
    const stored = new Map([...first.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    const later = mergeDrafts(stored, [], { sourceId: 's', today: '2026-10-08' });
    expect([...later.events.values()][0]!.status).toBe('past');
    const missing = mergeDrafts(stored, [], { sourceId: 's', today: '2026-10-02', coverage: { from: '2026-10-01', to: '2026-10-31' } });
    expect([...missing.events.values()][0]!.status).toBe('pending-review');
    expect(missing.events.size).toBe(1);
  });
  it('sends low-confidence listings to review', () => {
    const r = mergeDrafts(new Map(), draft({ confidence: 0.4 }), { sourceId: 's', today: '2026-10-01' });
    expect([...r.events.values()][0]!.status).toBe('pending-review');
  });
  it('does not add the same evening twice when another source already lists it', () => {
    const atLodge = { venueId: 'example-lodge', sourceId: 'lodge-calendar', seriesKey: 'lodge' };
    const first = mergeDrafts(new Map(), draft(atLodge), { sourceId: 'lodge-calendar', today: '2026-10-01' });
    const stored = new Map([...first.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    const other = { venueId: 'example-lodge', sourceId: 'town-calendar', seriesKey: 'town' };
    // Same place and day, 15 minutes apart, same kind: already listed.
    const dup = mergeDrafts(stored, draft({ ...other, start: '19:45', category: 'lesson-party' }), { sourceId: 'town-calendar', today: '2026-10-02' });
    expect(dup.duplicates).toEqual([{ id: expect.any(String), of: [...stored.keys()][0] }]);
    expect(dup.stats).toMatchObject({ new: 0, duplicates: 1 });
    expect(dup.events.size).toBe(1);
    // A show two hours later, or a different kind of event (a concert, not a dance), is a different event.
    expect(mergeDrafts(stored, draft({ ...other, start: '21:30' }), { sourceId: 'town-calendar', today: '2026-10-02' }).stats.new).toBe(1);
    expect(mergeDrafts(stored, draft({ ...other, category: 'live-music' }), { sourceId: 'town-calendar', today: '2026-10-02' }).stats.new).toBe(1);
    // The venue's own source updating its own listing is never a duplicate.
    expect(mergeDrafts(stored, draft(atLodge), { sourceId: 'lodge-calendar', today: '2026-10-02' }).stats).toMatchObject({ unchanged: 1, duplicates: 0 });
  });
  it("lets the organizer's own calendar win over a calendar that lists everything, for repeating series too", () => {
    const mondays = (o: Record<string, unknown>) =>
      collapse(['2026-10-05', '2026-10-12', '2026-10-19'].map((date) => ({ ...cand, date, category: 'class-lesson', venueId: 'example-lodge', organizerId: 'practice-studio', ...o }) as Parameters<typeof collapse>[0][number]));
    const fromPdf = { sourceId: 'pdf-calendar', seriesKey: 'pdf', start: '19:00', title: 'Hustle classes', seriesTitle: 'Hustle classes' };
    const own = mergeDrafts(new Map(), mondays({ sourceId: 'org-calendar', seriesKey: 'own' }), { sourceId: 'org-calendar', today: '2026-10-01' });
    const pdf = mergeDrafts(new Map(), mondays(fromPdf), { sourceId: 'pdf-calendar', today: '2026-10-01' });
    const stored = new Map([...own.events, ...[...pdf.events].map(([id, e]) => [`${id}-pdf`, e] as const)].map(([id, e]) => [id, eventSchema.parse(e)]));
    expect(stored.size).toBe(2);
    const isOwnCalendar = (sid: string) => sid === 'org-calendar';
    const opts = { sourceId: 'pdf-calendar', today: '2026-10-02', allInOne: true, isOwnCalendar };
    // The older copy from the everything-calendar steps aside for review; it is not deleted.
    const pdfId = `${[...pdf.events.keys()][0]!}-pdf`;
    const again = mergeDrafts(stored, mondays(fromPdf), opts);
    expect(again.events.get(pdfId)).toMatchObject({ status: 'pending-review' });
    expect(again.events.get(pdfId)!.reviewNotes).toMatch(/own calendar/);
    expect(again.duplicates).toHaveLength(1);
    // A new copy is not added at all; another organizer's class at the same lodge is.
    const ownOnly = new Map([...own.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    expect(mergeDrafts(ownOnly, mondays(fromPdf), opts).stats).toMatchObject({ new: 0, duplicates: 1 });
    expect(mergeDrafts(ownOnly, mondays({ ...fromPdf, organizerId: 'other-studio' }), opts).stats.new).toBe(1);
  });
  it('keeps a 12-week class when the own calendar lists only one workshop that day, and drops only that date', () => {
    const weeks = Array.from({ length: 12 }, (_, i) => addDays('2026-10-05', i * 7));
    const cls = (o: Record<string, unknown>, dates: string[]) =>
      collapse(dates.map((date) => ({ ...cand, date, category: 'class-lesson', venueId: 'example-lodge', organizerId: 'practice-studio', ...o }) as Parameters<typeof collapse>[0][number]));
    const workshop = mergeDrafts(new Map(), cls({ sourceId: 'org-calendar', seriesKey: 'ws', oneOff: true, start: '19:00' }, ['2026-10-19']), { sourceId: 'org-calendar', today: '2026-10-01' });
    const stored = new Map([...workshop.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    const opts = { sourceId: 'pdf-calendar', today: '2026-10-01', allInOne: true, isOwnCalendar: (s: string) => s === 'org-calendar' };
    const r = mergeDrafts(stored, cls({ sourceId: 'pdf-calendar', seriesKey: 'pdf', start: '19:00' }, weeks), opts);
    expect(r.stats.new).toBe(1);
    const added = [...r.events.values()].find((e) => e.sourceId === 'pdf-calendar')!;
    expect(added.status).toBe('active');
    expect(added.recurrence?.exdates).toEqual(['2026-10-19']);
    // A 2 PM class and an 8 PM social by the same organizer on the same day are two events.
    const social = mergeDrafts(new Map(), cls({ sourceId: 'org-calendar', seriesKey: 'soc', category: 'social-dance', start: '20:00' }, weeks), { sourceId: 'org-calendar', today: '2026-10-01' });
    const socials = new Map([...social.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    expect(mergeDrafts(socials, cls({ sourceId: 'pdf-calendar', seriesKey: 'pdf', category: 'lesson-party', start: '14:00' }, weeks), opts).stats).toMatchObject({ new: 1, duplicates: 0 });
  });
  it('treats the same dance style at the same place and minute as one event, even under another organizer', () => {
    const one = (o: Record<string, unknown>) =>
      collapse([{ ...cand, oneOff: true, date: '2026-10-11', start: '14:00', venueId: 'example-lodge', danceStyles: ['west-coast-swing'], ...o } as Parameters<typeof collapse>[0][number]]);
    const own = mergeDrafts(new Map(), one({ sourceId: 'teacher-calendar', seriesKey: 'own', category: 'class-lesson', organizerId: 'practice-studio' }), { sourceId: 'teacher-calendar', today: '2026-10-01' });
    const stored = new Map([...own.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    const opts = { sourceId: 'pdf-calendar', today: '2026-10-02', allInOne: true, isOwnCalendar: (s: string) => s === 'teacher-calendar' };
    // The PDF guessed the venue's usual club as organizer and calls it a lesson and practice.
    const pdf = { sourceId: 'pdf-calendar', seriesKey: 'pdf', category: 'lesson-party', organizerId: 'other-club' };
    expect(mergeDrafts(stored, one(pdf), opts).stats).toMatchObject({ new: 0, duplicates: 1 });
    // An hour later, or another style, is another event.
    expect(mergeDrafts(stored, one({ ...pdf, start: '15:00' }), opts).stats.new).toBe(1);
    expect(mergeDrafts(stored, one({ ...pdf, danceStyles: ['hustle'] }), opts).stats.new).toBe(1);
  });
  it('trims, not hides, an older series when the own calendar covers only some of its dates', () => {
    const tuesdays = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
    const series = (o: Record<string, unknown>, dates: string[]) =>
      collapse(dates.map((date) => ({ ...cand, date, venueId: 'example-lodge', organizerId: 'practice-studio', ...o }) as Parameters<typeof collapse>[0][number]));
    const pdf = mergeDrafts(new Map(), series({ sourceId: 'pdf-calendar', seriesKey: 'pdf' }, tuesdays), { sourceId: 'pdf-calendar', today: '2026-10-01' });
    const own = mergeDrafts(new Map(), series({ sourceId: 'org-calendar', seriesKey: 'own', oneOff: true }, ['2026-10-13']), { sourceId: 'org-calendar', today: '2026-10-01' });
    const pdfId = [...pdf.events.keys()][0]!;
    const stored = new Map([...pdf.events, ...[...own.events].map(([id, e]) => [`${id}-own`, e] as const)].map(([id, e]) => [id, eventSchema.parse(e)]));
    const r = mergeDrafts(stored, series({ sourceId: 'pdf-calendar', seriesKey: 'pdf' }, tuesdays), { sourceId: 'pdf-calendar', today: '2026-10-02', allInOne: true, isOwnCalendar: (s) => s === 'org-calendar' });
    expect(r.events.get(pdfId)).toMatchObject({ status: 'active' });
    expect(r.events.get(pdfId)!.recurrence?.exdates).toEqual(['2026-10-13']);
  });
  it("lets a band's own calendar win over an older copy of the same gig from a calendar of everything", () => {
    const gig = { venueId: 'example-lodge', category: 'live-music', danceStyles: [], performerIds: ['the-fictionals'] };
    const ira = mergeDrafts(new Map(), draft({ ...gig, sourceId: 'everything', seriesKey: 'ira', start: '20:00' }), { sourceId: 'everything', today: '2026-10-01' });
    const band = mergeDrafts(new Map(), draft({ ...gig, sourceId: 'band-page', seriesKey: 'band', start: undefined }), { sourceId: 'band-page', today: '2026-10-01' });
    const iraId = [...ira.events.keys()][0]!;
    const stored = new Map([...[...ira.events].map(([id, e]) => [id, e] as const), ...[...band.events].map(([id, e]) => [`${id}-band`, e] as const)].map(([id, e]) => [id, eventSchema.parse(e)]));
    const again = mergeDrafts(stored, draft({ ...gig, sourceId: 'everything', seriesKey: 'ira', start: '20:00' }), { sourceId: 'everything', today: '2026-10-02', allInOne: true, isOwnCalendar: (s) => s === 'band-page' });
    expect(again.events.get(iraId)).toMatchObject({ status: 'pending-review' });
  });
  it('lists a double bill once when two bands name the same start time at the same place', () => {
    const show = { venueId: 'example-lodge', category: 'live-music', danceStyles: [], start: '14:00' };
    const first = mergeDrafts(new Map(), draft({ ...show, sourceId: 'band-a', seriesKey: 'a', performerIds: ['the-fictionals'] }), { sourceId: 'band-a', today: '2026-10-01' });
    const stored = new Map([...first.events].map(([id, e]) => [id, eventSchema.parse(e)]));
    expect(mergeDrafts(stored, draft({ ...show, sourceId: 'band-b', seriesKey: 'b', performerIds: ['midnight-fiction'] }), { sourceId: 'band-b', today: '2026-10-02' }).stats).toMatchObject({ new: 0, duplicates: 1 });
    // A different start time is a different show.
    expect(mergeDrafts(stored, draft({ ...show, start: '16:00', sourceId: 'band-b', seriesKey: 'b', performerIds: ['midnight-fiction'] }), { sourceId: 'band-b', today: '2026-10-02' }).stats.new).toBe(1);
  });
});
