import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanAct, cuesFor, dateFor, htmlLines, normalizeIraRows, normalizeTime, parseEntry, parseWeeklyList, rowsFromIcs, splitEntry, styleLabel } from '../../ingest/adapters/iraslist';
import { isPublishedCalendarFeed } from '../../ingest/lib/fetch';
import { Registry, ROOT } from '../../ingest/lib/registry';
import { assessDancing, type DancingInput } from '../../src/lib/dancing';
import { eventSchema, performerSchema, styleSchema, venueSchema } from '../../src/lib/schemas';

const real = Registry.load();

/** Registry with the real styles and small fictional venues and bands (Example Pub has a dance floor; Example Playhouse is seated). */
function fixtureRegistry() {
  return new Registry(
    new Map([
      ['example-pub', venueSchema.parse({ name: 'Example Pub', address: '1 Fictional Ave', town: 'Farmingdale', county: 'Nassau', kind: 'bar', dancing: { floor: 'dance-floor', kinds: ['freestyle'], confidence: 'high' } })],
      ['example-playhouse', venueSchema.parse({ name: 'Example Playhouse', address: '2 Fictional Ave', town: 'Patchogue', county: 'Suffolk', kind: 'theater', dancing: { floor: 'seated', confidence: 'high' } })],
      ['far-away-hall', venueSchema.parse({ name: 'Far Away Hall', address: '3 Elsewhere St', town: 'Astoria', county: 'Nassau' })],
    ]),
    new Map([
      ['sample-party-band', performerSchema.parse({ name: 'Sample Party Band', type: 'band', dancing: { rating: 'party', kinds: ['freestyle'], styles: ['freestyle'], confidence: 'medium' } })],
      ['quiet-tribute-show', performerSchema.parse({ name: 'Quiet Tribute Show', type: 'band', dancing: { rating: 'listening', confidence: 'medium' } })],
      ['dj-example', performerSchema.parse({ name: 'DJ Example', type: 'dj' })],
    ]),
    new Map(),
    new Map(),
    real.styles,
    new Map(),
    new Map(),
  );
}

describe("Ira's List weekly list", () => {
  const html = readFileSync(join(ROOT, 'ingest', 'fixtures', 'iraslist-sample.html'), 'utf8');
  const rows = parseWeeklyList(html, '2030-12-30');

  it('reads days, sponsors, acts, venues and times, and stops at the footer', () => {
    expect(rows.map((r) => r.date)).toEqual(['2030-12-31', ...Array(8).fill('2031-01-01')]);
    expect(rows[1]).toMatchObject({ act: 'Sample Party Band', venue: 'Example Pub', sponsor: true });
    expect(rows[2]).toMatchObject({ act: 'Quiet Tribute Show', venue: 'Example Playhouse', time: '7pm', sponsor: true });
    expect(rows.find((r) => r.act === 'Unknown Act')).toMatchObject({ venue: 'Mystery Bar', time: '1-5pm', sponsor: false });
    expect(rows.find((r) => r.act.startsWith('Byrne'))).toMatchObject({ time: '3pm', timeUnsure: true });
    expect(rows.some((r) => r.act === 'Not A Gig')).toBe(false);
  });
  it('keeps only plain text, even from tricky markup', () => {
    expect(htmlLines('<p>A <<b>script>alert(1)<</b>/script> &lt;img src=x&gt; Band</p>')).toEqual(['A alert(1) img src=x Band']);
  });
  it('drops a gig listed twice on the same day', () => {
    expect(rows.filter((r) => r.date === '2031-01-01' && r.act === 'Sample Party Band')).toHaveLength(1);
  });
  it('reads short day headings ("MON 10/5", "THUR 10/8") and skips one whose weekday does not match', () => {
    const list = '<p>SUNDAY 10/4</p><p>-Sample Party Band-Example Pub 7p</p><p>MON 10/5</p><p>OTHERS</p><p>-Open Jam-Example Pub</p><p>THUR 10/8</p><p>-Quiet Tribute Show-Example Playhouse 7p</p><p>FRI 10/10</p><p>-Wrong Day Band-Example Pub</p><p>© 2026 Example</p>';
    const r = parseWeeklyList(list, '2026-10-03');
    expect(r.map((x) => [x.date, x.act])).toEqual([
      ['2026-10-04', 'Sample Party Band'],
      ['2026-10-05', 'Open Jam'],
      ['2026-10-08', 'Quiet Tribute Show'],
    ]);
  });
  it('splits act and venue, and normalizes times', () => {
    expect(splitEntry('Club 40+ Party @ Example Pub')).toEqual({ act: 'Club 40+ Party', venue: 'Example Pub' });
    expect(splitEntry('Leonid & Friends Tribute To Chicago - Boulton Center')).toEqual({ act: 'Leonid & Friends Tribute To Chicago', venue: 'Boulton Center' });
    expect(parseEntry('-📌Vinyl Revival- Malverne Fall Festival 2-4p (Ira\';s List Sponsor)')).toMatchObject({ act: 'Vinyl Revival', venue: 'Malverne Fall Festival', time: '2-4pm', sponsor: true });
    expect(normalizeTime('11a')).toBe('11am');
    expect(normalizeTime('1 – 5')).toBe('1-5pm');
    expect(dateFor(1, 2, '2030-12-30')).toBe('2031-01-02');
  });
  it('spots dancing cues: DJ, dance party, theater, library, afternoon', () => {
    expect(cuesFor({ act: 'DJ Jolie', venue: 'Revel', text: '', time: undefined })).toEqual(['dj']);
    expect(cuesFor({ act: 'Club 30+ New York', venue: 'Stereo Garden', text: '', time: '5pm' })).toEqual(['dance-party']);
    expect(cuesFor({ act: 'Nitework', venue: 'Cooperage Inn', text: '', time: '1-5pm' })).toEqual(['afternoon']);
    expect(cuesFor({ act: 'Ann Wilson', venue: 'Patchogue Theater', text: '', time: '7pm' })).toEqual(['theater']);
    expect(cuesFor({ act: 'Almost Elton', venue: 'Half Hollow Hills Library', text: '', time: '2pm' })).toEqual(['afternoon', 'library', 'tribute']);
  });
  it('publishes gigs at researched Long Island venues and reports the rest', () => {
    const reg = fixtureRegistry();
    const r = normalizeIraRows(rows, { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: reg, outsideVenues: [] });
    expect(r.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(['not live music for dancing (theater, comedy or drag show)', 'venue not researched yet']));
    expect(r.unresearched.venues).toContain('Mystery Bar');
    expect(r.outOfArea).toEqual([{ town: 'Astoria', count: 1 }]);
    const dj = r.candidates.find((c) => c.performerIds.includes('dj-example'))!;
    expect(dj).toMatchObject({ category: 'social-dance', danceStyles: ['freestyle'], dancingCues: ['dj'] });
    const band = r.candidates.find((c) => c.date === '2031-01-01' && c.performerIds.includes('sample-party-band'))!;
    expect(band).toMatchObject({ category: 'live-music', danceStyles: ['freestyle'], venueId: 'example-pub' });
    expect(band.summary).not.toMatch(/Sponsored/);
    expect(parseEntry('Sample Party Band @ Example Pub 3pm?')).toMatchObject({ time: '3pm', timeUnsure: true });
    const unsure = normalizeIraRows([{ date: '2031-01-02', ...parseEntry('Sample Party Band @ Example Pub 3pm?')! }], { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: reg, outsideVenues: [] }).candidates[0]!;
    expect(unsure).toMatchObject({ start: undefined, end: undefined, reviewNotes: [expect.stringMatching(/not sure of the time \(3pm\?\)/)] });
    for (const c of r.candidates) expect(() => eventSchema.parse({ ...c, reviewNotes: c.reviewNotes.join(' ') || undefined, start: c.date, firstSeen: c.date, lastSeen: c.date })).not.toThrow();
  });
  it('does not call the venue its own act ("Example Pub - See Venue for Details")', () => {
    const reg = fixtureRegistry();
    const r = normalizeIraRows([{ date: '2031-01-02', ...parseEntry('-Example Pub- See Venue for Details.')! }], { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: reg, outsideVenues: [] });
    expect(r.candidates[0]).toMatchObject({ venueId: 'example-pub', title: 'Live music at Example Pub' });
    expect(r.unresearched.acts).not.toContain('Example Pub');
  });
});

const base: DancingInput = { category: 'live-music', sourceFocus: 'music', styles: [], cues: [], performers: [] };
const venue = (floor: 'dance-floor' | 'open-space' | 'small' | 'seated' | 'unknown', kinds: ('partner' | 'line' | 'freestyle')[] = []) => ({ name: 'Venue', dancing: { floor, policy: 'unknown' as const, kinds, evidence: [], confidence: 'medium' as const } });
const band = (rating: 'dance-band' | 'party' | 'mixed' | 'listening' | 'unknown', kinds: ('partner' | 'line' | 'freestyle')[] = []) => ({ name: 'Band', type: 'band' as const, dancing: { rating, kinds, evidence: [], confidence: 'medium' as const } });

describe('dancing score', () => {
  it('treats classes and dance-calendar events as dance events, with the styles\' kind of dancing', () => {
    const c = assessDancing({ ...base, category: 'class-lesson', sourceFocus: 'dance', styles: [{ id: 'line-dancing', name: 'Line Dancing', danceType: 'line' }] });
    expect(c).toMatchObject({ level: 'dance-event', score: 1, kinds: ['line'], label: 'Line dancing' });
    const ballroom = assessDancing({ ...base, sourceFocus: 'dance', sourceName: 'The Dance Calendar', styles: [{ id: 'ballroom', name: 'Ballroom', danceType: 'partner' }] });
    expect(ballroom).toMatchObject({ level: 'dance-event', kinds: ['partner'] });
  });
  it('rates a party band at a bar with a dance floor as likely party dancing', () => {
    const a = assessDancing({ ...base, venue: venue('dance-floor', ['freestyle', 'line']), performers: [band('party', ['freestyle'])] });
    expect(a.level).toBe('likely');
    expect(a.kinds).toEqual(['line', 'freestyle']);
    expect(a.outOf10).toBeGreaterThanOrEqual(7);
  });
  it('rates a seated theater or a listening act as mostly listening', () => {
    expect(assessDancing({ ...base, cues: ['theater'], venue: venue('seated'), performers: [band('party', ['freestyle'])] }).level).toBe('unlikely');
    expect(assessDancing({ ...base, venue: venue('open-space'), performers: [band('listening')] }).level).toBe('unlikely');
    expect(assessDancing({ ...base, cues: ['library', 'afternoon'], performers: [band('mixed')] }).label).toBe('Mostly listening');
  });
  it('lets a standing concert hall beat the "theater" hint', () => {
    expect(assessDancing({ ...base, cues: ['theater'], venue: venue('open-space', ['freestyle']), performers: [band('party', ['freestyle'])] }).level).toBe('likely');
  });
  it('says when it is only a rough guess, and a dance party is always likely', () => {
    const guess = assessDancing({ ...base });
    expect(guess.level).toBe('some');
    expect(guess.reasons.join(' ')).toMatch(/rough guess/);
    expect(assessDancing({ ...base, category: 'social-dance', cues: ['dance-party'] })).toMatchObject({ level: 'likely', kinds: ['freestyle'] });
  });
  it("uses an editor's answer over everything else", () => {
    const a = assessDancing({ ...base, venue: venue('seated'), override: { likelihood: 0.9, kinds: ['partner'], notes: 'The venue clears the floor for a swing set.' } });
    expect(a).toMatchObject({ level: 'likely', kinds: ['partner'], basis: 'editor', reasons: ['The venue clears the floor for a swing set.'] });
  });
});

describe('dance styles', () => {
  it('every style says whether it is partner, line or party dancing', () => {
    for (const [id, s] of real.styles) expect(['partner', 'line', 'freestyle'], id).toContain(styleSchema.parse(s).danceType);
    expect(real.styles.get('line-dancing')!.danceType).toBe('line');
    expect(real.styles.get('freestyle')!.danceType).toBe('freestyle');
  });
});

describe("Ira's List calendar feed", () => {
  const ics = readFileSync(join(ROOT, 'ingest', 'fixtures', 'iraslist-calendar.ics'), 'utf8');
  const feedUrl = 'https://calendar.google.com/calendar/ical/fictional-list%40example.com/public/basic.ics';

  it('only public Google Calendar iCal feeds skip the robots.txt check', () => {
    expect(isPublishedCalendarFeed('https://calendar.google.com/calendar/ical/iraslistli%40gmail.com/public/basic.ics')).toBe(true);
    expect(isPublishedCalendarFeed('https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/public/basic.ics')).toBe(true);
    expect(isPublishedCalendarFeed('https://calendar.google.com/calendar/ical/iraslistli%40gmail.com/private-abc/basic.ics')).toBe(false);
    expect(isPublishedCalendarFeed('https://calendar.google.com/calendar/u/0/r?cid=iraslistli@gmail.com')).toBe(false);
    expect(isPublishedCalendarFeed('https://calendar.google.com/calendar/embed?src=iraslistli%40gmail.com')).toBe(false);
    expect(isPublishedCalendarFeed('https://calendar.google.com.evil.example/calendar/ical/a%40b.com/public/basic.ics')).toBe(false);
    expect(isPublishedCalendarFeed('http://calendar.google.com/calendar/ical/a%40b.com/public/basic.ics')).toBe(false);
  });

  it('cleans act names that carry dates, themes or ticket notes', () => {
    expect(cleanAct('American Ride: A Tribute to Toby Keith on Saturday, Oct. 17th')).toBe('American Ride: A Tribute to Toby Keith');
    expect(cleanAct('Half Step Halloween Costume Contest and Dance Party!')).toBe('Half Step');
    expect(cleanAct('Disco Unlimited Ticketed Event')).toBe('Disco Unlimited');
    expect(cleanAct('Pretend Rockers, Sat. Jan. 4th')).toBe('Pretend Rockers');
    expect(cleanAct('Sir Duke')).toBe('Sir Duke');
  });

  it('reads times and locations from the feed, and builds clean listings', () => {
    const rows = rowsFromIcs(ics, '2031-01-01', feedUrl, 30);
    expect(rows[0]).toMatchObject({ date: '2031-01-03', start: '2031-01-03T20:00', end: '2031-01-03T23:00', sponsor: true, act: 'Sample Party Band', locationName: 'Example Pub', address: '1 Fictional Ave', locality: 'Farmingdale' });
    const reg = fixtureRegistry();
    const r = normalizeIraRows(rows, { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: reg, outsideVenues: [] });
    const titles = r.candidates.map((c) => `${c.date} ${c.start ?? ''} ${c.title}`);
    expect(titles).toContain('2031-01-03 20:00 Sample Party Band at Example Pub');
    expect(r.candidates.filter((c) => c.date === '2031-01-03'), 'the same gig listed twice with a typo is kept once').toHaveLength(1);
    expect(r.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(['listed twice in the calendar', 'venue not researched yet', 'not live music for dancing (theater, comedy or drag show)']));
    // A new venue only with a street address in a Long Island town, named after the place (never a house number).
    const tavern = r.candidates.find((c) => c.date === '2031-01-04')!;
    expect(tavern).toMatchObject({ title: 'Pretend Rockers at The Fictional Tavern', town: 'Huntington', start: '19:00' });
    expect(reg.created.venues.has(tavern.venueId!)).toBe(true);
    expect(reg.venues.get(tavern.venueId!)).toMatchObject({ name: 'The Fictional Tavern', address: '77 Imaginary Rd', county: 'Suffolk' });
    expect([...reg.created.venues].some((id) => /^\d/.test(id)), 'no venue named after a house number').toBe(false);
    // "WCS at Example Pub": on Ira's List "WCS" is a band (Worst Case Scenario), not West Coast Swing, and the
    // venue's name is not an act.
    const wcs = r.candidates.find((c) => c.date === '2031-01-05')!;
    expect(wcs).toMatchObject({ title: 'WCS at Example Pub', venueId: 'example-pub' });
    expect(wcs.danceStyles).not.toContain('west-coast-swing');
    expect(r.outOfArea).toEqual([{ town: 'Astoria', count: 1 }]);
    for (const c of r.candidates) expect(() => eventSchema.parse({ ...c, reviewNotes: c.reviewNotes.join(' ') || undefined, start: c.start ? `${c.date}T${c.start}` : c.date, end: undefined, firstSeen: c.date, lastSeen: c.date })).not.toThrow();
  });
  it('keeps a band whose name has a dance or "doors" word as the act, and names no style for it', () => {
    const reg = fixtureRegistry();
    const opts = { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: reg, outsideVenues: [] };
    const one = (line: string) => normalizeIraRows([{ date: '2031-01-02', ...parseEntry(line)! }], opts).candidates[0]!;
    const swing = one('Swing 26 Jazz Band - Example Pub');
    expect(swing.title).toBe('Swing 26 Jazz Band at Example Pub');
    expect(swing.danceStyles).not.toContain('east-coast-swing');
    expect(one('The Rhythm Kings - Example Pub')).toMatchObject({ title: 'The Rhythm Kings at Example Pub', danceStyles: [] });
    expect(one('Magical Mystery Doors - Example Pub').title).toBe('Magical Mystery Doors at Example Pub');
    // A dance named on its own, or before "with", is still a style.
    const named = one('Swing Dance with The Flipped Fedoras - Example Pub');
    expect(named.title).toBe('The Flipped Fedoras at Example Pub');
    expect(named.danceStyles).toContain('east-coast-swing');
    expect(one('Salsa Night - Example Pub')).toMatchObject({ title: 'Salsa dance with live music at Example Pub', danceStyles: ['salsa'] });
    expect(styleLabel(reg, 'Salsa Night w')).toEqual(['salsa']);
    expect(styleLabel(reg, 'Hustle Wednesdays')).toEqual(['hustle']);
    // An event's own name keeps its words.
    // Initials are a band's name on a music calendar ("WCS" is Worst Case Scenario); a spelled-out dance still counts.
    const wcs = one('WCS Unplugged - Example Pub');
    expect(wcs.title).toBe('WCS Unplugged at Example Pub');
    expect(wcs.danceStyles).not.toContain('west-coast-swing');
    expect(one('WCS - Example Pub').title).toBe('WCS at Example Pub');
    expect(styleLabel(reg, 'WCS')).toEqual([]);
    expect(one('West Coast Swing Night - Example Pub')).toMatchObject({ title: 'West Coast Swing dance with live music at Example Pub', danceStyles: ['west-coast-swing'] });
    const hustle = one('\u{1F483}\u{1F3FB}\u{1F57A} Not Just Hustle Wednesdays- Example Pub');
    expect(hustle.title).toBe('Not Just Hustle Wednesdays at Example Pub');
    expect(hustle.danceStyles).toContain('hustle');
    expect(one("DJ Friday's - Example Pub").title).toBe('Dance party at Example Pub');
    expect(one('Spooky Bash ft/ DJ Nobody - Example Pub').title).toBe('Dance party with Spooky Bash and DJ Nobody at Example Pub');
    expect(styleLabel(reg, 'Smooth Operators')).toEqual([]);
  });
  it('skips a gig whose calendar title says it is cancelled or postponed', () => {
    const ev = (uid: string, summary: string) => `BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20310110T170000\r\nDTEND;TZID=America/New_York:20310110T200000\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nLOCATION:Example Pub\\, 1 Fictional Ave\\, Farmingdale\\, NY 11735\\, USA\r\nEND:VEVENT\r\n`;
    const cal = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev('c1', 'CANCELLED Sample Party Band-Example Pub')}${ev('c2', '❌ Postponed: DJ Example-Example Pub')}${ev('c3', 'Quiet Tribute Show-Example Pub')}END:VCALENDAR\r\n`;
    const rows = rowsFromIcs(cal, '2031-01-01', feedUrl, 30);
    expect(rows.map((r) => r.act)).toEqual(['Quiet Tribute Show']);
    const r = normalizeIraRows([{ date: '2031-01-10', ...parseEntry('CANCELLED Sample Party Band - Example Pub')! }], { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: fixtureRegistry(), outsideVenues: [] });
    expect(r.candidates).toHaveLength(0);
    expect(r.skipped.map((s) => s.reason)).toEqual(['cancelled by the source']);
  });
  it('keeps the most recently edited copy of a gig listed twice, whatever order the feed sends', () => {
    const ev = (uid: string, summary: string, modified: string) => `BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20310111T130000\r\nDTEND;TZID=America/New_York:20310111T170000\r\nUID:${uid}\r\nLAST-MODIFIED:${modified}\r\nSUMMARY:${summary}\r\nLOCATION:Example Pub\\, 1 Fictional Ave\\, Farmingdale\\, NY 11735\\, USA\r\nEND:VEVENT\r\n`;
    const typo = ev('t1', 'Comon Ground-Example Pub', '20300828T012528Z');
    const fixed = ev('t2', 'Common Ground-Example Pub', '20300912T161134Z');
    const opts = { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: fixtureRegistry(), outsideVenues: [] };
    for (const order of [typo + fixed, fixed + typo]) {
      const r = normalizeIraRows(rowsFromIcs(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${order}END:VCALENDAR\r\n`, '2031-01-01', feedUrl, 30), opts);
      expect(r.candidates.map((c) => c.title)).toEqual(['Common Ground at Example Pub']);
    }
    expect(cleanAct('Acoustic Groove returns to the Example Pub in Farmingdale!')).toBe('Acoustic Groove');
  });
  it('adds new venues before matching gigs, so a gig listed without an address earlier still finds its venue', () => {
    const ev = (uid: string, day: string, summary: string, location: string) => `BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:203101${day}T190000\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nLOCATION:${location}\r\nEND:VEVENT\r\n`;
    const cal = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev('n1', '12', 'Pretend Rockers-Brand New Taproom', 'Brand New Taproom')}${ev('n2', '13', 'Sample Party Band-Brand New Taproom', 'Brand New Taproom\\, 9 Imaginary Rd\\, Huntington\\, NY 11743\\, USA')}END:VCALENDAR\r\n`;
    const reg = fixtureRegistry();
    const r = normalizeIraRows(rowsFromIcs(cal, '2031-01-01', feedUrl, 30), { sourceId: 'iraslist', sourceUrl: 'https://example.org/', registry: reg, outsideVenues: [] });
    expect(r.candidates.map((c) => `${c.date} ${c.title}`)).toEqual(['2031-01-12 Pretend Rockers at Brand New Taproom', '2031-01-13 Sample Party Band at Brand New Taproom']);
    expect(r.candidates.every((c) => c.reviewNotes.some((n) => /New venue was added automatically/.test(n)))).toBe(true);
  });
});
