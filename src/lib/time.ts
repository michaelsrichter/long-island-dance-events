/**
 * Timezone-safe date helpers.
 *
 * Event times are stored as local wall-clock strings ("2026-10-06T19:30") plus an IANA
 * timezone. All conversion happens at build time with Intl, so visitors' devices never
 * parse dates and events cannot shift to the wrong day.
 */

export const DEFAULT_TZ = 'America/New_York';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const LOCAL_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})(?:T(([01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?)?$/;

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `timeZone` from UTC at the given instant, in minutes (e.g. -240 for EDT). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Split "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" into components. */
export function parseLocal(local: string): { date: string; time: string | null } {
  const m = LOCAL_DATETIME_RE.exec(local);
  if (!m) throw new Error(`Invalid local date/time "${local}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm.`);
  return { date: m[1]!, time: m[2] ?? null };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. Handles DST transitions. */
export function zonedToUtc(date: string, time: string, timeZone: string = DEFAULT_TZ): Date {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date "${date}"`);
  if (!TIME_RE.test(time)) throw new Error(`Invalid time "${time}"`);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(new Date(guess), timeZone);
  let result = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(result), timeZone);
  if (off2 !== off1) result = guess - off2 * 60000;
  return new Date(result);
}

/** "2026-10-06T19:30:00-04:00" — ISO 8601 with the zone's offset at that instant. */
export function isoWithOffset(instant: Date, timeZone: string = DEFAULT_TZ): string {
  const p = parts(instant, timeZone);
  const off = tzOffsetMinutes(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  const abs = Math.abs(off);
  const sign = off < 0 ? '-' : '+';
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Calendar date ("YYYY-MM-DD") of an instant in a timezone. */
export function dateInZone(instant: Date, timeZone: string = DEFAULT_TZ): string {
  const p = parts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Date-only arithmetic on "YYYY-MM-DD" strings (timezone independent). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]!;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function noonUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Tuesday, October 6, 2026" */
export function formatDateLong(date: string): string {
  return noonUtc(date).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Tue, Oct 6" (optionally with year) */
export function formatDateShort(date: string, withYear = false): string {
  return noonUtc(date).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function dateParts(date: string) {
  const d = noonUtc(date);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
  return {
    weekdayShort: f({ weekday: 'short' }),
    weekdayLong: f({ weekday: 'long' }),
    monthShort: f({ month: 'short' }),
    monthLong: f({ month: 'long' }),
    day: String(d.getUTCDate()),
    year: String(d.getUTCFullYear()),
  };
}

/** "19:30" -> "7:30 PM"; compact drops ":00". */
export function formatTime(time: string, compact = false): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (compact && m === 0) return `${h12} ${suffix}`;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatTimeRange(start: string, end?: string | null): string {
  if (!end) return formatTime(start);
  return `${formatTime(start)} to ${formatTime(end)}`;
}

/** "October 2026" for a "YYYY-MM" key. */
export function formatMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
}

/** Normalise YAML-parsed values (which may be Date objects) back to local strings. */
export function normaliseLocalValue(v: unknown): unknown {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16);
  }
  return v;
}

/**
 * YAML 1.1 parsers read an unquoted 19:30 as the base-60 number 1170.
 * Convert such numbers back to "HH:mm" so either YAML flavour works.
 */
export function normaliseTimeValue(v: unknown): unknown {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24 * 60) {
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  }
  return normaliseLocalValue(v);
}
