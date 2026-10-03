import { describe, expect, it } from 'vitest';
import { addDays, dateInZone, formatDateLong, formatTime, isoWithOffset, weekdayOf, zonedToUtc, normaliseLocalValue } from '../../src/lib/time';

describe('timezone conversion', () => {
  it('converts New York wall time to UTC in daylight time (EDT, UTC-4)', () => {
    expect(zonedToUtc('2026-10-06', '19:30').toISOString()).toBe('2026-10-06T23:30:00.000Z');
  });
  it('converts New York wall time to UTC in standard time (EST, UTC-5)', () => {
    expect(zonedToUtc('2026-11-03', '19:30').toISOString()).toBe('2026-11-04T00:30:00.000Z');
  });
  it('handles the spring-forward transition (March 8, 2026)', () => {
    expect(zonedToUtc('2026-03-08', '01:30').toISOString()).toBe('2026-03-08T06:30:00.000Z');
    expect(zonedToUtc('2026-03-08', '03:30').toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });
  it('handles the fall-back transition (November 1, 2026)', () => {
    expect(zonedToUtc('2026-11-01', '19:30').toISOString()).toBe('2026-11-02T00:30:00.000Z');
  });
  it('formats ISO 8601 with the correct offset', () => {
    expect(isoWithOffset(new Date('2026-10-06T23:30:00Z'))).toBe('2026-10-06T19:30:00-04:00');
    expect(isoWithOffset(new Date('2026-12-01T00:30:00Z'))).toBe('2026-11-30T19:30:00-05:00');
  });
  it('a late-evening event stays on the same New York calendar date even though UTC is the next day', () => {
    const start = zonedToUtc('2026-12-01', '22:00');
    expect(start.toISOString().slice(0, 10)).toBe('2026-12-02');
    expect(dateInZone(start)).toBe('2026-12-01');
  });
});

describe('date labels never shift days', () => {
  it('formats date-only strings independent of the runtime timezone', () => {
    expect(formatDateLong('2026-10-06')).toBe('Tuesday, October 6, 2026');
    expect(weekdayOf('2026-10-06')).toBe('tuesday');
    expect(weekdayOf('2026-03-08')).toBe('sunday');
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-29', 7)).toBe('2027-01-05');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('formats 24-hour times for people', () => {
    expect(formatTime('19:30')).toBe('7:30 PM');
    expect(formatTime('20:00', true)).toBe('8 PM');
    expect(formatTime('00:15')).toBe('12:15 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
  });
  it('normalises YAML Date objects back to local strings', () => {
    expect(normaliseLocalValue(new Date('2026-10-06T00:00:00Z'))).toBe('2026-10-06');
    expect(normaliseLocalValue(new Date('2026-10-06T19:30:00Z'))).toBe('2026-10-06T19:30');
    expect(normaliseLocalValue('2026-10-06')).toBe('2026-10-06');
  });
});
