import { describe, expect, it } from 'vitest';
import { eventDateRanges, matchesEventDate } from '../../src/lib/event-date-windows';

describe('event date windows', () => {
  it('uses New York dates and separates this week from the next seven days', () => {
    const ranges = eventDateRanges(new Date('2026-11-05T15:00:00Z'));
    expect(ranges).toEqual({
      today: '2026-11-05',
      thisWeekEnd: '2026-11-08',
      weekEnd: '2026-11-11',
      month: '2026-11',
      weekendFrom: '2026-11-06',
      weekendTo: '2026-11-08',
    });
    expect(matchesEventDate('2026-11-08', 'this-week', ranges)).toBe(true);
    expect(matchesEventDate('2026-11-09', 'this-week', ranges)).toBe(false);
    expect(matchesEventDate('2026-11-11', 'week', ranges)).toBe(true);
  });

  it('uses only the remaining weekend days on Saturday and Sunday', () => {
    const saturday = eventDateRanges(new Date('2026-11-07T15:00:00Z'));
    expect(saturday.weekendFrom).toBe('2026-11-07');
    expect(saturday.weekendTo).toBe('2026-11-08');

    const sunday = eventDateRanges(new Date('2026-11-08T15:00:00Z'));
    expect(sunday.thisWeekEnd).toBe('2026-11-08');
    expect(sunday.weekendFrom).toBe('2026-11-08');
    expect(sunday.weekendTo).toBe('2026-11-08');
  });

  it('moves the weekend window to the coming Friday after the weekend', () => {
    const monday = eventDateRanges(new Date('2026-11-09T15:00:00Z'));
    expect(monday.weekendFrom).toBe('2026-11-13');
    expect(monday.weekendTo).toBe('2026-11-15');
    expect(matchesEventDate('2026-11-12', 'weekend', monday)).toBe(false);
    expect(matchesEventDate('2026-11-14', 'weekend', monday)).toBe(true);
  });
});
