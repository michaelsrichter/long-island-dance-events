import { describe, expect, it } from 'vitest';
import { eventSchema, type EventData } from '../../src/lib/schemas';
import { isUpcoming, occurrenceSlug, partition, priceOf, priceText, resolveOccurrences, type RawEvent } from '../../src/lib/event-core';
import { describeRule, expandRule, lastDate, occurrenceDates, parseRRule, validateRRule } from '../../src/lib/rrule';

const base = {
  summary: 'An evening of Hustle social dancing.',
  category: 'social-dance',
  sourceId: 'thedancecalendar',
  sourceUrl: 'https://www.thedancecalendar.com/issue.pdf',
  firstSeen: '2026-10-01',
  lastSeen: '2026-10-01',
  town: 'Huntington',
};
const ev = (id: string, data: Record<string, unknown>): RawEvent => ({ id, data: eventSchema.parse({ ...base, ...data }) as EventData });
const NOW = new Date('2026-10-03T04:00:00Z'); // Saturday, October 3, 2026 at midnight in New York

describe('repeat rules (RRULE subset)', () => {
  it('parses and validates the supported parts', () => {
    expect(parseRRule('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027')).toEqual({ freq: 'WEEKLY', interval: 1, byday: [{ weekday: 2, ordinal: undefined }], until: '2026-10-27', count: undefined });
    expect(validateRRule('FREQ=MONTHLY;BYDAY=1FR,3FR')).toBeNull();
    expect(validateRRule('FREQ=DAILY')).not.toBeNull();
    expect(validateRRule('FREQ=WEEKLY;BYDAY=1TU')).not.toBeNull(); // ordinals only make sense monthly
    expect(validateRRule('FREQ=WEEKLY;UNTIL=20261027;COUNT=3')).not.toBeNull();
  });
  it('expands weekly, every-other-week and monthly ordinal rules', () => {
    expect(expandRule('2026-10-06', parseRRule('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027'), '2027-01-01')).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
    expect(expandRule('2026-10-06', parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'), '2026-11-10')).toEqual(['2026-10-06', '2026-10-20', '2026-11-03']);
    expect(expandRule('2026-10-02', parseRRule('FREQ=MONTHLY;BYDAY=1FR,3FR'), '2026-11-30')).toEqual(['2026-10-02', '2026-10-16', '2026-11-06', '2026-11-20']);
    expect(expandRule('2026-10-31', parseRRule('FREQ=MONTHLY;BYDAY=-1SA;COUNT=2'), '2027-12-31')).toEqual(['2026-10-31', '2026-11-28']);
  });
  it('adds extra dates and removes skipped ones', () => {
    expect(occurrenceDates('2026-10-05', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026', exdates: ['2026-10-19'], rdates: ['2026-10-30'] }, '2026-12-31')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-26',
      '2026-10-30',
    ]);
    expect(occurrenceDates('2026-10-09', { rdates: ['2026-10-23'] }, '2026-12-31')).toEqual(['2026-10-09', '2026-10-23']);
    expect(lastDate('2026-10-05', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026' })).toBe('2026-10-26');
    expect(lastDate('2026-10-05', { rrule: 'FREQ=WEEKLY;BYDAY=MO' })).toBeUndefined();
  });
  it('describes rules in plain words', () => {
    expect(describeRule('2026-10-06', parseRRule('FREQ=WEEKLY;BYDAY=TU'))).toBe('Every Tuesday');
    expect(describeRule('2026-10-06', parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'))).toBe('Every other Tuesday');
    expect(describeRule('2026-10-02', parseRRule('FREQ=MONTHLY;BYDAY=1FR,3FR'))).toBe('1st and 3rd Fridays of the month');
    expect(describeRule('2026-10-31', parseRRule('FREQ=MONTHLY;BYDAY=-1SA'))).toBe('Last Saturday of the month');
  });
});

describe('occurrences', () => {
  const weekly = ev('swing-dance-long-island-lesson-and-dance-tuesdays', { title: 'East Coast Swing lesson and social dance', start: '2026-10-06T19:30', end: '2026-10-06T22:00', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020' } });
  const once = ev('2026-10-02-dominick-paradise-live-music', { title: 'Live music night', category: 'live-music', start: '2026-10-02T19:00', end: '2026-10-02T23:00' });
  const lateNight = ev('2026-10-09-dj-ray', { title: 'DJ night', start: '2026-10-09T20:00', end: '2026-10-09T00:00' });
  const hidden = ev('2026-10-10-unchecked', { title: 'Unchecked listing', start: '2026-10-10T19:00', status: 'pending-review' });
  const list = resolveOccurrences([weekly, once, lateNight, hidden], { now: NOW });

  it('expands repeating events into dated pages with stable URLs', () => {
    expect(list.filter((o) => o.eventId === weekly.id).map((o) => o.slug)).toEqual([
      '2026-10-06-swing-dance-long-island-lesson-and-dance-tuesdays',
      '2026-10-13-swing-dance-long-island-lesson-and-dance-tuesdays',
      '2026-10-20-swing-dance-long-island-lesson-and-dance-tuesdays',
    ]);
    expect(occurrenceSlug('2026-10-02-dominick-paradise-live-music', '2026-10-02')).toBe('2026-10-02-dominick-paradise-live-music');
    expect(list.find((o) => o.eventId === weekly.id)!.cadence).toBe('Every Tuesday');
  });
  it('uses New York time, including events that end after midnight', () => {
    const o = list.find((x) => x.eventId === lateNight.id)!;
    expect(o.start.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(o.end.toISOString()).toBe('2026-10-10T04:00:00.000Z');
  });
  it('marks ended events as past and hides listings waiting for review', () => {
    expect(list.find((o) => o.eventId === once.id)!.status).toBe('past');
    expect(list.some((o) => o.eventId === hidden.id)).toBe(false);
    const { upcoming, past } = partition(list, NOW);
    expect(past.map((o) => o.eventId)).toEqual([once.id]);
    expect(upcoming.every((o) => isUpcoming(o, NOW))).toBe(true);
  });
  it('keeps cancelled events visible and clearly marked', () => {
    const c = resolveOccurrences([ev('2026-10-17-x', { title: 'Cancelled night', start: '2026-10-17T19:00', status: 'cancelled' })], { now: NOW });
    expect(c[0]!.status).toBe('cancelled');
    expect(isUpcoming(c[0]!, NOW)).toBe(true);
  });
  it('never shows a listing an editor hid, not even in admin previews', () => {
    const gone = ev('2026-10-18-copy', { title: 'A copy of another listing', start: '2026-10-18T19:00', status: 'hidden' });
    expect(resolveOccurrences([gone], { now: NOW })).toEqual([]);
    expect(resolveOccurrences([gone], { now: NOW, includePending: true })).toEqual([]);
  });
  it('refuses two events with the same URL', () => {
    expect(() => resolveOccurrences([once, { ...once }], { now: NOW })).toThrow(/Duplicate event URL/);
  });
});

describe('prices in plain words', () => {
  it('handles free, single, range and unknown prices', () => {
    expect(priceText(priceOf({ isFree: true }))).toBe('Free');
    expect(priceText(priceOf({ price: 25 }))).toBe('$25 per person');
    expect(priceText(priceOf({ price: 15, priceMax: 20, priceNotes: 'Members pay less' }))).toBe('$15 to $20 per person. Members pay less');
    expect(priceText(priceOf({}))).toBe('Price not listed. Ask the organizer.');
  });
});

describe('event schema rules', () => {
  it('needs a venue or at least a town', () => {
    expect(() => eventSchema.parse({ ...base, town: undefined, title: 'No place', start: '2026-10-06T19:30' })).toThrow(/venue/i);
  });
  it('rejects a bad repeat rule and a free event with a price', () => {
    expect(() => eventSchema.parse({ ...base, title: 'Bad rule', start: '2026-10-06T19:30', recurrence: { rrule: 'FREQ=YEARLY' } })).toThrow(/repeat rule/i);
    expect(() => eventSchema.parse({ ...base, title: 'Free?', start: '2026-10-06T19:30', isFree: true, price: 10 })).toThrow(/free/i);
  });
  it('keeps times as text even if YAML turned them into numbers', () => {
    expect(eventSchema.parse({ ...base, title: 'Lesson', start: '2026-10-06T19:30', lessonTime: 1170 }).lessonTime).toBe('19:30');
  });
});
