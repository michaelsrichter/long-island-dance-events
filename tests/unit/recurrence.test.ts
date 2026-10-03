import { describe, expect, it } from 'vitest';
import { expandRecurrence } from '../../src/lib/event-core';
import { parseSeries } from './helpers';

const rule = (r: Record<string, unknown>) =>
  parseSeries({ title: 'Series', slug: 's', recurrence: r, startTime: '19:30', endTime: '22:00' }).recurrence;

describe('recurring-event expansion', () => {
  it('generates every Tuesday from the start date', () => {
    expect(expandRecurrence(rule({ frequency: 'weekly', weekday: 'tuesday', startDate: '2026-10-01' }), '2026-10-31')).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
  });
  it('respects the interval, end date and skipped dates', () => {
    const r = rule({ frequency: 'weekly', interval: 2, weekday: 'tuesday', startDate: '2026-10-06', endDate: '2026-12-01', exceptDates: ['2026-11-03'] });
    expect(expandRecurrence(r, '2027-01-31')).toEqual(['2026-10-06', '2026-10-20', '2026-11-17', '2026-12-01']);
  });
  it('supports monthly "nth weekday" rules', () => {
    const r = rule({ frequency: 'monthly', weekday: 'saturday', weekOfMonth: 2, startDate: '2026-10-01' });
    expect(expandRecurrence(r, '2027-01-31')).toEqual(['2026-10-10', '2026-11-14', '2026-12-12', '2027-01-09']);
  });
  it('supports "last weekday of the month"', () => {
    const r = rule({ frequency: 'monthly', weekday: 'friday', weekOfMonth: -1, startDate: '2026-10-01' });
    expect(expandRecurrence(r, '2026-12-31')).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
  });
  it('rejects a monthly series without a week of the month', () => {
    expect(() => rule({ frequency: 'monthly', weekday: 'friday', startDate: '2026-10-01' })).toThrow();
  });
});
