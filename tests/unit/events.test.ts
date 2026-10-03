import { describe, expect, it } from 'vitest';
import { admissionOf, admissionText, hostOf, isUpcoming, nextConfirmed, partition, resolveOccurrences, homeFirst, sortOccurrences } from '../../src/lib/event-core';
import { ev, tuesdaySeries } from './helpers';

const NOW = new Date('2026-10-01T22:00:00-04:00');

describe('series occurrences and overrides', () => {
  const series = tuesdaySeries();
  const overrides = [
    ev('2026-10-13-band-night.md', {
      title: 'Band Night: Playing Favorites',
      series: 'thursday-night-swing',
      occurrenceDate: '2026-10-13',
      bandName: 'moonlight-jump-band',
      admissionMember: 15,
      admissionStudent: 10,
      admissionNonMember: 20,
      eventTypes: ['weekly-dance', 'live-band'],
    }),
    ev('2026-10-20-cancelled.md', {
      title: 'Thursday Night Swing',
      series: 'thursday-night-swing',
      occurrenceDate: '2026-10-20',
      status: 'cancelled',
      cancelledMessage: 'Cancelled because of a storm.',
    }),
  ];
  const all = resolveOccurrences(overrides, [series], { now: NOW });

  it('creates one stable URL per occurrence', () => {
    expect(all.map((o) => o.slug)).toEqual([
      '2026-10-06-thursday-night-swing',
      '2026-10-13-thursday-night-swing',
      '2026-10-20-thursday-night-swing',
      '2026-10-27-thursday-night-swing',
    ]);
  });
  it('lets an override change the title, band and prices while inheriting the rest', () => {
    const o = all[1]!;
    expect(o.title).toBe('Band Night: Playing Favorites');
    expect(o.details.bandName).toBe('moonlight-jump-band');
    expect(o.details.admissionNonMember).toBe(20);
    expect(o.details.venue).toBe('riverbend-community-hall');
    expect(o.details.lessonStartTime).toBe('19:30');
    expect(o.source.kind).toBe('series-override');
  });
  it('keeps a cancelled occurrence visible and marked as cancelled', () => {
    const o = all[2]!;
    expect(o.status).toBe('cancelled');
    expect(o.cancelledMessage).toMatch(/storm/);
    expect(partition(all, NOW).upcoming.map((x) => x.slug)).toContain(o.slug);
  });
  it('skips cancelled dances when choosing the next confirmed dance', () => {
    const later = new Date('2026-10-14T12:00:00-04:00');
    expect(nextConfirmed(all, later)?.slug).toBe('2026-10-27-thursday-night-swing');
  });
  it('computes timezone-correct start and end instants', () => {
    expect(all[0]!.start.toISOString()).toBe('2026-10-06T23:30:00.000Z');
    expect(all[0]!.end.toISOString()).toBe('2026-10-07T02:00:00.000Z');
  });
});

describe('upcoming versus past', () => {
  const events = [
    ev('a.md', { title: 'Past dance', startDateTime: '2026-09-29T19:30', endDateTime: '2026-09-29T22:00' }),
    ev('b.md', { title: 'Tonight', startDateTime: '2026-10-01T19:30', endDateTime: '2026-10-01T23:00' }),
    ev('c.md', { title: 'Future dance', startDateTime: '2026-10-06T19:30' }),
    ev('d.md', { title: 'Draft dance', startDateTime: '2026-10-08T19:30', status: 'draft' }),
    ev('e.md', { title: 'Hidden dance', startDateTime: '2026-10-09T19:30', published: false }),
    ev('f.md', { title: 'Time TBA', startDateTime: '2026-10-10' }),
  ];
  const all = resolveOccurrences(events, [], { now: NOW });

  it('never lists an event that has ended as upcoming', () => {
    const { upcoming, past } = partition(all, NOW);
    expect(upcoming.map((o) => o.title)).toEqual(['Tonight', 'Future dance', 'Time TBA']);
    expect(past.map((o) => o.title)).toEqual(['Past dance']);
    expect(past[0]!.effectiveStatus).toBe('completed');
  });
  it('an event in progress is still upcoming until it ends', () => {
    expect(isUpcoming(all.find((o) => o.title === 'Tonight')!, NOW)).toBe(true);
    expect(isUpcoming(all.find((o) => o.title === 'Tonight')!, new Date('2026-10-01T23:00:01-04:00'))).toBe(false);
  });
  it('excludes drafts and unpublished events', () => {
    expect(all.some((o) => o.title === 'Draft dance' || o.title === 'Hidden dance')).toBe(false);
  });
  it('defaults to a 3-hour event when no end is given, and all-day when the time is TBA', () => {
    const f = all.find((o) => o.title === 'Future dance')!;
    expect((f.end.getTime() - f.start.getTime()) / 3600000).toBe(3);
    const tba = all.find((o) => o.title === 'Time TBA')!;
    expect(tba.timeTba).toBe(true);
    expect(tba.start.toISOString()).toBe('2026-10-10T04:00:00.000Z');
  });
  it('returns an empty upcoming list when everything is in the past (empty state)', () => {
    expect(partition(all, new Date('2027-01-01T00:00:00Z')).upcoming).toEqual([]);
    expect(nextConfirmed(all, new Date('2027-01-01T00:00:00Z'))).toBeUndefined();
  });
  it('sorts by start time, then title', () => {
    const sorted = sortOccurrences([
      { title: 'B', start: new Date(2) },
      { title: 'A', start: new Date(2) },
      { title: 'C', start: new Date(1) },
    ]);
    expect(sorted.map((s) => s.title)).toEqual(['C', 'A', 'B']);
  });
});

describe('Riverbend events first, community events after', () => {
  const community = (id: string, data: Record<string, unknown>) => ev(id, { host: 'community', organizer: 'dj-scott', ...data });
  const events = [
    community('2026-10-02-dj-scott.md', { title: 'Friday Social', startDateTime: '2026-10-02T18:00', endDateTime: '2026-10-02T23:00' }),
    ev('2026-10-06-pizza.md', { title: 'Pizza Night', startDateTime: '2026-10-06T19:30', endDateTime: '2026-10-06T22:00' }),
    community('2026-10-03-waterfalls.md', { title: 'Saturday Ballroom', startDateTime: '2026-10-03T19:00', endDateTime: '2026-10-03T23:00' }),
    ev('2026-10-13-dj.md', { title: 'DJ Night', startDateTime: '2026-10-13T19:30', endDateTime: '2026-10-13T22:00', status: 'cancelled' }),
    ev('2026-10-20-band.md', { title: 'Band Night', startDateTime: '2026-10-20T19:30', endDateTime: '2026-10-20T22:00' }),
  ];
  const all = resolveOccurrences(events, [], { now: NOW });

  it('treats events without a host as Riverbend events', () => {
    expect(all.map((o) => hostOf(o))).toEqual(['community', 'community', 'home', 'home', 'home']);
  });
  it('the "next dance" is always the next confirmed Riverbend dance, even when a community event is sooner', () => {
    expect(nextConfirmed(all, NOW)?.title).toBe('Pizza Night');
    expect(nextConfirmed(all, NOW, 'any')?.title).toBe('Friday Social');
    expect(nextConfirmed(all, new Date('2026-10-07T00:00:00-04:00'))?.title).toBe('Band Night');
  });
  it('lists Riverbend events first, each group in date order', () => {
    expect(homeFirst(all).map((o) => o.title)).toEqual(['Pizza Night', 'DJ Night', 'Band Night', 'Friday Social', 'Saturday Ballroom']);
  });
});

describe('events that run past midnight', () => {
  it('a series ending at 12 AM ends the next day', () => {
    const fri = tuesdaySeries({ title: 'Friday Dance', slug: 'friday-dance', recurrence: { frequency: 'weekly', weekday: 'friday', startDate: '2026-10-02', endDate: '2026-10-09' }, startTime: '20:00', endTime: '00:00', danceStartTime: '20:00', danceEndTime: '00:00', lessonStartTime: undefined });
    const [first] = resolveOccurrences([], [fri], { now: NOW });
    expect(first!.endLocal).toBe('2026-10-03T00:00');
    expect((first!.end.getTime() - first!.start.getTime()) / 3600000).toBe(4);
    expect(isUpcoming(first!, new Date('2026-10-02T23:30:00-04:00'))).toBe(true);
  });
});

describe('content integrity errors', () => {
  it('rejects two entries with the same URL', () => {
    const a = ev('2026-10-06-dance.md', { title: 'Dance', startDateTime: '2026-10-06T19:30' });
    const b = ev('dance.md', { title: 'Dance', startDateTime: '2026-10-06T20:00' });
    expect(() => resolveOccurrences([a, b], [], { now: NOW })).toThrow(/Duplicate event URL/);
  });
  it('rejects an override that points to an unknown series', () => {
    const o = ev('x.md', { title: 'Override', series: 'nope', occurrenceDate: '2026-10-06' });
    expect(() => resolveOccurrences([o], [], { now: NOW })).toThrow(/unknown series/);
  });
});

describe('admission summary', () => {
  it('describes prices in plain language', () => {
    expect(admissionText(admissionOf({ admissionMember: 10, admissionStudent: 5, admissionNonMember: 15 }))).toBe('$15 non-members, $10 members, $5 students');
    expect(admissionText(admissionOf({ admissionNonMember: 0 }))).toBe('Free');
    expect(admissionText(admissionOf({}))).toBe('Admission details to be announced');
  });
});

