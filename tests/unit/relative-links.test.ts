import { describe, expect, it } from 'vitest';
import { relativeLabel } from '../../src/lib/relative';
import { displayHost, linksOf, primaryLink } from '../../src/lib/links';

const ny = (s: string) => new Date(s).getTime();

describe('friendly relative dates', () => {
  // Friday, October 2, 2026, 1 PM in New York.
  const now = ny('2026-10-02T13:00:00-04:00');
  const tue = (d: string, start = '19:30', end = '22:00') => [ny(`${d}T${start}:00-04:00`), ny(`${d}T${end}:00-04:00`)] as const;

  it('says "Tonight!" for an evening event later today, and "Happening now!" once it starts', () => {
    const [s, e] = tue('2026-10-02', '18:00', '23:00');
    expect(relativeLabel(s, e, now).text).toBe('Tonight!');
    expect(relativeLabel(s, e, ny('2026-10-02T19:00:00-04:00')).text).toBe('Happening now!');
  });
  it('says "Today!" for a daytime event and nothing once it has ended', () => {
    const [s, e] = tue('2026-10-02', '14:00', '17:00');
    expect(relativeLabel(s, e, now)).toMatchObject({ text: 'Today!', tone: 'today' });
    expect(relativeLabel(s, e, ny('2026-10-02T18:00:00-04:00'))).toMatchObject({ text: '', tone: 'past' });
  });
  it('says "Tomorrow night" for tomorrow evening', () => {
    const [s, e] = tue('2026-10-03', '19:00', '23:00');
    expect(relativeLabel(s, e, now).text).toBe('Tomorrow night');
  });
  it('counts calendar days in New York, with excitement for Riverbend dances', () => {
    const [s, e] = tue('2026-10-06');
    expect(relativeLabel(s, e, now, { excited: true }).text).toBe('This Tuesday · in 4 days!');
    expect(relativeLabel(s, e, now).text).toBe('This Tuesday · in 4 days');
    const [s2, e2] = tue('2026-10-13');
    expect(relativeLabel(s2, e2, now, { excited: true })).toMatchObject({ text: 'Next Tuesday · in 11 days!', tone: 'later' });
    const [s3, e3] = tue('2026-10-27');
    expect(relativeLabel(s3, e3, now).text).toBe('In 4 weeks');
  });
  it('does not shift days late at night or across the end of daylight saving time', () => {
    // 11:30 PM Monday in New York is already Tuesday in UTC; Tuesday's dance is still "Tomorrow night".
    const [s, e] = tue('2026-10-06');
    expect(relativeLabel(s, e, ny('2026-10-05T23:30:00-04:00')).text).toBe('Tomorrow night');
    // Clocks fall back on Sunday, November 1, 2026.
    const start = ny('2026-11-03T19:30:00-05:00');
    expect(relativeLabel(start, start + 9e6, ny('2026-10-31T12:00:00-04:00')).text).toBe('This Tuesday · in 3 days');
  });
  it('says "Today!" (not "Tonight!") when the time is not announced', () => {
    const s = ny('2026-10-02T00:00:00-04:00');
    expect(relativeLabel(s + 1, s + 86_400_000, now, { allDay: true }).text).toBe('Happening now!');
    const t = ny('2026-10-03T00:00:00-04:00');
    expect(relativeLabel(t, t + 86_400_000, now, { allDay: true }).text).toBe('Tomorrow');
  });
});

describe('website and social links', () => {
  it('lists the website first, then social pages, then extra links, without duplicates', () => {
    const links = linksOf({
      website: 'https://triplestepswing.com/',
      facebookUrl: 'https://www.facebook.com/x',
      instagramUrl: 'https://www.instagram.com/x/',
      moreLinks: [
        { label: 'Swing calendar', url: 'https://triplestepswing.com/calendar' },
        { label: 'Duplicate', url: 'https://triplestepswing.com' },
      ],
    });
    expect(links.map((l) => [l.kind, l.label])).toEqual([
      ['website', 'Website'],
      ['facebook', 'Facebook'],
      ['instagram', 'Instagram'],
      ['link', 'Swing calendar'],
    ]);
  });
  it('falls back to the first social page when there is no website', () => {
    expect(primaryLink({ facebookUrl: 'https://www.facebook.com/lonesharks' })?.kind).toBe('facebook');
    expect(primaryLink({})).toBeUndefined();
  });
  it('shows a short site name', () => {
    expect(displayHost('https://www.triplestepswing.com/calendar')).toBe('triplestepswing.com');
    expect(displayHost('not a url')).toBe('not a url');
  });
});
