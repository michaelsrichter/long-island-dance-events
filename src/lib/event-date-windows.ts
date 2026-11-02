import { addDays, dateInZone, DEFAULT_TZ, WEEKDAYS, weekdayOf } from './time';

export const EVENT_DATE_FILTERS = [
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'This week' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All upcoming' },
] as const;

export type EventDateFilter = (typeof EVENT_DATE_FILTERS)[number]['value'];

export interface EventDateRanges {
  today: string;
  thisWeekEnd: string;
  weekEnd: string;
  month: string;
  weekendFrom: string;
  weekendTo: string;
}

/** Date windows used by every event view, calculated in the site's timezone. */
export function eventDateRanges(now = new Date(), timeZone = DEFAULT_TZ): EventDateRanges {
  const today = dateInZone(now, timeZone);
  const day = WEEKDAYS.indexOf(weekdayOf(today));
  const friday = addDays(today, day === 0 ? -2 : day === 6 ? -1 : 5 - day);
  return {
    today,
    thisWeekEnd: addDays(today, (7 - day) % 7),
    weekEnd: addDays(today, 6),
    month: today.slice(0, 7),
    weekendFrom: day === 0 || day === 6 ? today : friday,
    weekendTo: addDays(friday, 2),
  };
}

export function matchesEventDate(date: string, filter: string, ranges: EventDateRanges): boolean {
  if (filter === 'today') return date === ranges.today;
  if (filter === 'this-week') return date >= ranges.today && date <= ranges.thisWeekEnd;
  if (filter === 'weekend') return date >= ranges.weekendFrom && date <= ranges.weekendTo;
  if (filter === 'week') return date >= ranges.today && date <= ranges.weekEnd;
  if (filter === 'month') return date.startsWith(ranges.month);
  return true;
}
