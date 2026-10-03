/**
 * A small, dependency-free subset of RFC 5545 recurrence rules, enough for dance listings:
 * FREQ=WEEKLY|MONTHLY, INTERVAL, BYDAY (with 1..4 / -1 ordinals for monthly), UNTIL, COUNT.
 * Everything works on local calendar dates ("YYYY-MM-DD"); times and time zones are applied later.
 */
import { addDays, daysInMonth, weekdayOf, WEEKDAYS } from './time';

export const RRULE_ERROR =
  'Use a repeat rule such as FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027 or FREQ=MONTHLY;BYDAY=1FR,3FR. Supported parts: FREQ (WEEKLY or MONTHLY), INTERVAL, BYDAY, UNTIL, COUNT.';

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
type DayCode = (typeof DAY_CODES)[number];

export interface ByDay {
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  /** 1-4 or -1 (last), monthly rules only */
  ordinal?: number | undefined;
}

export interface RRule {
  freq: 'WEEKLY' | 'MONTHLY';
  interval: number;
  byday: ByDay[];
  /** Inclusive last date, YYYY-MM-DD */
  until?: string | undefined;
  count?: number | undefined;
}

export interface Recurrence {
  rrule?: string | undefined;
  rdates?: string[] | undefined;
  exdates?: string[] | undefined;
}

export function parseRRule(input: string): RRule {
  const text = input.trim().replace(/^RRULE:/i, '');
  if (!text) throw new Error(RRULE_ERROR);
  const parts = new Map<string, string>();
  for (const piece of text.split(';')) {
    const [k, v] = piece.split('=');
    if (!k || v === undefined || v === '') throw new Error(RRULE_ERROR);
    parts.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = parts.get('FREQ');
  if (freq !== 'WEEKLY' && freq !== 'MONTHLY') throw new Error(RRULE_ERROR);
  for (const k of parts.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST'].includes(k)) throw new Error(RRULE_ERROR);
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) throw new Error(RRULE_ERROR);
  const byday: ByDay[] = [];
  for (const d of (parts.get('BYDAY') ?? '').split(',').filter(Boolean)) {
    const m = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d);
    if (!m) throw new Error(RRULE_ERROR);
    const ordinal = m[1] ? Number(m[1]) : undefined;
    if (ordinal !== undefined && (freq !== 'MONTHLY' || ![1, 2, 3, 4, -1].includes(ordinal))) throw new Error(RRULE_ERROR);
    byday.push({ weekday: DAY_CODES.indexOf(m[2] as DayCode), ordinal });
  }
  let until: string | undefined;
  if (parts.has('UNTIL')) {
    const m = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(parts.get('UNTIL')!);
    if (!m) throw new Error(RRULE_ERROR);
    until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  let count: number | undefined;
  if (parts.has('COUNT')) {
    count = Number(parts.get('COUNT'));
    if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error(RRULE_ERROR);
  }
  if (until && count) throw new Error(RRULE_ERROR);
  return { freq, interval, byday, until, count };
}

export function validateRRule(input: string): string | null {
  try {
    parseRRule(input);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function formatRRule(r: RRule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval !== 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byday.length) parts.push(`BYDAY=${r.byday.map((b) => `${b.ordinal ?? ''}${DAY_CODES[b.weekday]}`).join(',')}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  return parts.join(';');
}

const dow = (date: string) => WEEKDAYS.indexOf(weekdayOf(date));
const pad = (n: number) => String(n).padStart(2, '0');

function nthWeekday(year: number, month: number, weekday: number, nth: number): string | null {
  const last = daysInMonth(year, month);
  if (nth === -1) {
    for (let d = last; d > last - 7; d--) if (dow(`${year}-${pad(month)}-${pad(d)}`) === weekday) return `${year}-${pad(month)}-${pad(d)}`;
    return null;
  }
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    if (dow(date) === weekday && ++n === nth) return date;
  }
  return null;
}

/** Dates produced by the rule from `start` (inclusive) up to `horizon` (inclusive). */
export function expandRule(start: string, rule: RRule, horizon: string): string[] {
  const end = rule.until && rule.until < horizon ? rule.until : horizon;
  const out: string[] = [];
  const limit = rule.count ?? Infinity;
  if (rule.freq === 'WEEKLY') {
    const days = rule.byday.length ? [...new Set(rule.byday.map((b) => b.weekday))].sort() : [dow(start)];
    // Weeks start on Monday (RFC 5545 default WKST=MO).
    let weekStart = addDays(start, -((dow(start) + 6) % 7));
    for (let guard = 0; guard < 1000 && weekStart <= end && out.length < limit; guard++) {
      const inWeek = days.map((d) => addDays(weekStart, (d + 6) % 7)).sort();
      for (const date of inWeek) {
        if (date >= start && date <= end && out.length < limit) out.push(date);
      }
      weekStart = addDays(weekStart, 7 * rule.interval);
    }
  } else {
    let [y, m] = start.split('-').map(Number) as [number, number];
    const startDay = Number(start.slice(8, 10));
    for (let guard = 0; guard < 600 && `${y}-${pad(m)}-01` <= end && out.length < limit; guard++) {
      const dates: string[] = [];
      if (rule.byday.length === 0) {
        if (startDay <= daysInMonth(y, m)) dates.push(`${y}-${pad(m)}-${pad(startDay)}`);
      } else {
        for (const b of rule.byday) {
          if (b.ordinal !== undefined) {
            const d = nthWeekday(y, m, b.weekday, b.ordinal);
            if (d) dates.push(d);
          } else {
            for (let d = 1; d <= daysInMonth(y, m); d++) {
              const date = `${y}-${pad(m)}-${pad(d)}`;
              if (dow(date) === b.weekday) dates.push(date);
            }
          }
        }
      }
      for (const date of [...new Set(dates)].sort()) {
        if (date >= start && date <= end && out.length < limit) out.push(date);
      }
      m += rule.interval;
      while (m > 12) {
        m -= 12;
        y += 1;
      }
    }
  }
  return out;
}

/** All occurrence dates of an event: the start date, the rule, extra dates, minus removed dates. */
export function occurrenceDates(start: string, recurrence: Recurrence | undefined, horizon: string): string[] {
  if (!recurrence || (!recurrence.rrule && !(recurrence.rdates ?? []).length)) return start <= horizon ? [start] : [];
  const set = new Set<string>([start]);
  if (recurrence.rrule) for (const d of expandRule(start, parseRRule(recurrence.rrule), horizon)) set.add(d);
  for (const d of recurrence.rdates ?? []) if (d <= horizon) set.add(d);
  for (const d of recurrence.exdates ?? []) set.delete(d);
  return [...set].filter((d) => d <= horizon).sort();
}

/** Last date the recurrence can produce, or undefined when it never ends. */
export function lastDate(start: string, recurrence: Recurrence | undefined): string | undefined {
  if (!recurrence) return start;
  const extras = (recurrence.rdates ?? []).filter((d) => !(recurrence.exdates ?? []).includes(d));
  if (!recurrence.rrule) return [start, ...extras].sort().at(-1);
  const rule = parseRRule(recurrence.rrule);
  if (rule.until) return [start, rule.until, ...extras].sort().at(-1);
  if (rule.count) return [...expandRule(start, rule, '2999-12-31'), ...extras].sort().at(-1);
  return undefined;
}

const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'last' };
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** "Every Tuesday", "Every other Friday", "1st and 3rd Fridays", "Last Saturday of the month". */
export function describeRule(start: string, rule: RRule): string {
  const days = rule.byday.length ? rule.byday : [{ weekday: dow(start) }];
  if (rule.freq === 'WEEKLY') {
    const names = joinAnd([...new Set(days.map((d) => d.weekday))].sort().map((d) => NAMES[d]!));
    if (rule.interval === 2) return `Every other ${names}`;
    if (rule.interval > 2) return `Every ${rule.interval} weeks on ${names}`;
    return `Every ${names}`;
  }
  const withOrd = days.filter((d) => d.ordinal !== undefined);
  if (withOrd.length && new Set(withOrd.map((d) => d.weekday)).size === 1) {
    const ords = withOrd.map((d) => ORD[d.ordinal!]!);
    const day = NAMES[withOrd[0]!.weekday]!;
    if (ords.length === 1 && ords[0] === 'last') return `Last ${day} of the month`;
    return `${joinAnd(ords)} ${day}${ords.length > 1 ? 's' : ''} of the month`;
  }
  return 'Once a month';
}
