/** Calendar exports: RFC 5545 .ics files and "add to calendar" links. */

export interface CalendarEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  url: string;
  start: Date;
  end: Date;
  /** Date-only events (time to be announced) become all-day entries. */
  allDayDate?: string | undefined;
  timezone: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  latitude?: number | undefined;
  longitude?: number | undefined;
  lastModified?: Date | undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 20261006T233000Z */
export function icsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const compactDate = (date: string) => date.replaceAll('-', '');
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
}

/** Escape TEXT values per RFC 5545 section 3.3.11. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold content lines longer than 75 octets (RFC 5545 section 3.1). */
export function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (currentBytes + len > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += len;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildIcs(events: CalendarEvent[], opts: { name: string; now?: Date }): string {
  const stamp = icsUtc(opts.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Community Site Starter//example.org//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    'X-WR-TIMEZONE:America/New_York',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.allDayDate) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.allDayDate)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(e.allDayDate))}`);
    } else {
      lines.push(`DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(e.end)}`);
    }
    lines.push(
      `SUMMARY:${icsEscape(e.status === 'CANCELLED' ? `CANCELLED: ${e.title}` : e.title)}`,
      `DESCRIPTION:${icsEscape(e.description)}`,
      `LOCATION:${icsEscape(e.location)}`,
      `URL:${e.url}`,
      `STATUS:${e.status}`,
    );
    if (e.latitude !== undefined && e.longitude !== undefined) lines.push(`GEO:${e.latitude};${e.longitude}`);
    if (e.lastModified) lines.push(`LAST-MODIFIED:${icsUtc(e.lastModified)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(e: CalendarEvent): string {
  const dates = e.allDayDate
    ? `${compactDate(e.allDayDate)}/${compactDate(nextDay(e.allDayDate))}`
    : `${icsUtc(e.start)}/${icsUtc(e.end)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates,
    details: `${e.description}\n\n${e.url}`,
    location: e.location,
    ctz: e.timezone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook on the web. `account` selects personal (outlook.com) or work/school (Microsoft 365). */
export function outlookCalendarUrl(e: CalendarEvent, account: 'personal' | 'work' = 'personal'): string {
  const host = account === 'work' ? 'https://outlook.office.com' : 'https://outlook.live.com';
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: e.allDayDate ?? e.start.toISOString(),
    enddt: e.allDayDate ? nextDay(e.allDayDate) : e.end.toISOString(),
    body: `${e.description}\n\n${e.url}`,
    location: e.location,
    allday: e.allDayDate ? 'true' : 'false',
  });
  return `${host}/calendar/0/action/compose?${params.toString()}`;
}
