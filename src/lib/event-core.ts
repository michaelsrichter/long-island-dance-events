/**
 * Pure event logic (no Astro imports) so it can be unit tested:
 * recurrence expansion, statuses, sorting and upcoming/past partitioning.
 */
import type { EventData, EventStatus } from './schemas';
import { DEFAULT_TZ, addDays, dateInZone, parseLocal, zonedToUtc } from './time';
import { describeRule, occurrenceDates, parseRRule } from './rrule';

export interface RawEvent {
  id: string;
  data: EventData;
}

export interface Occurrence {
  /** URL segment, e.g. "2026-10-06-swing-dance-long-island-tuesday". Stable for the life of the listing. */
  slug: string;
  eventId: string;
  title: string;
  /** Stored status, adjusted for time: active listings that have ended become "past". */
  status: EventStatus;
  date: string;
  timeTba: boolean;
  startLocal: string;
  endLocal: string;
  start: Date;
  end: Date;
  timezone: string;
  recurring: boolean;
  /** "Every Tuesday", "1st and 3rd Fridays", ... */
  cadence?: string | undefined;
  data: EventData;
}

interface Timing {
  date: string;
  timeTba: boolean;
  startLocal: string;
  endLocal: string;
  start: Date;
  end: Date;
}

const timeOf = (t: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);

/** Start/end instants for one date, using the event's start and end times. */
export function computeTiming(date: string, startTime: string | null, endLocal: string | undefined, tz: string): Timing {
  if (!startTime) {
    return { date, timeTba: true, startLocal: date, endLocal: date, start: zonedToUtc(date, '00:00', tz), end: zonedToUtc(addDays(date, 1), '00:00', tz) };
  }
  const start = zonedToUtc(date, startTime, tz);
  let end: Date;
  let endStr: string;
  const e = endLocal ? parseLocal(endLocal) : undefined;
  if (e?.time) {
    // A same-day end at or before the start (e.g. 8 PM to 12 AM) means the event runs past midnight.
    const eDate = e.time <= startTime ? addDays(date, 1) : date;
    endStr = `${eDate}T${e.time}`;
    end = zonedToUtc(eDate, e.time, tz);
  } else {
    end = new Date(start.getTime() + 3 * 3600 * 1000);
    endStr = `${dateInZone(end, tz)}T${timeOf(end, tz)}`;
  }
  return { date, timeTba: false, startLocal: `${date}T${startTime}`, endLocal: endStr, start, end };
}

export function effectiveStatus(status: EventStatus, end: Date, now: Date): EventStatus {
  if (status === 'active' && end.getTime() <= now.getTime()) return 'past';
  return status;
}

/** "2026-10-16-louis-del-prete" stays as is; "club-brumidi-wednesday-social" becomes "<date>-club-brumidi-wednesday-social". */
export function occurrenceSlug(eventId: string, date: string): string {
  return eventId.startsWith(`${date}-`) ? eventId : `${date}-${eventId.replace(/^\d{4}-\d{2}-\d{2}-/, '')}`;
}

export function cadenceOf(data: Pick<EventData, 'start' | 'recurrence' | 'cadence'>): string | undefined {
  if (data.cadence) return data.cadence;
  if (data.recurrence?.rrule) return describeRule(parseLocal(data.start).date, parseRRule(data.recurrence.rrule));
  return undefined;
}

export interface ResolveOptions {
  now: Date;
  /** How far ahead open-ended repeat rules are expanded. */
  horizonDays?: number;
  /** Include listings waiting for review (admin previews only). */
  includePending?: boolean;
}

/** Expand every event (one-time or repeating) into dated occurrences. */
export function resolveOccurrences(events: RawEvent[], opts: ResolveOptions): Occurrence[] {
  const { now } = opts;
  const horizon = addDays(dateInZone(now, DEFAULT_TZ), opts.horizonDays ?? 120);
  const out: Occurrence[] = [];
  for (const ev of events) {
    const d = ev.data;
    if (d.status === 'pending-review' && !opts.includePending) continue;
    const tz = d.timezone ?? DEFAULT_TZ;
    const s = parseLocal(d.start);
    const recurring = Boolean(d.recurrence);
    const dates = occurrenceDates(s.date, d.recurrence, recurring ? horizon : '9999-12-31');
    const multiDayEnd = !recurring && d.end && parseLocal(d.end).date > s.date;
    const cadence = cadenceOf(d);
    for (const date of dates) {
      const timing = multiDayEnd
        ? (() => {
            const e = parseLocal(d.end!);
            const start = s.time ? zonedToUtc(date, s.time, tz) : zonedToUtc(date, '00:00', tz);
            const end = e.time ? zonedToUtc(e.date, e.time, tz) : zonedToUtc(addDays(e.date, 1), '00:00', tz);
            return { date, timeTba: !s.time, startLocal: s.time ? `${date}T${s.time}` : date, endLocal: e.time ? `${e.date}T${e.time}` : e.date, start, end };
          })()
        : computeTiming(date, s.time, d.end, tz);
      const stored: EventStatus = d.status === 'past' ? 'past' : d.status;
      out.push({
        slug: occurrenceSlug(ev.id, date),
        eventId: ev.id,
        title: d.title,
        status: effectiveStatus(stored, timing.end, now),
        ...timing,
        timezone: tz,
        recurring,
        cadence,
        data: d,
      });
    }
  }
  const seen = new Map<string, Occurrence>();
  for (const o of out) {
    if (seen.has(o.slug)) throw new Error(`Duplicate event URL "/events/${o.slug}/" from "${seen.get(o.slug)!.eventId}" and "${o.eventId}".`);
    seen.set(o.slug, o);
  }
  return sortOccurrences(out);
}

export function sortOccurrences<T extends Pick<Occurrence, 'start' | 'title'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
}

/** Upcoming = not yet ended. Cancelled upcoming events stay visible (clearly marked). */
export function isUpcoming(o: Pick<Occurrence, 'end' | 'status'>, now: Date): boolean {
  return o.end.getTime() > now.getTime() && (o.status === 'active' || o.status === 'cancelled');
}

export function partition<T extends Occurrence>(list: T[], now: Date) {
  const upcoming = list.filter((o) => isUpcoming(o, now));
  const past = list.filter((o) => !isUpcoming(o, now) && o.status !== 'pending-review').reverse();
  return { upcoming, past };
}

export function formatPrice(n: number): string {
  return n === 0 ? 'Free' : `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

export interface PriceInfo {
  known: boolean;
  free: boolean;
  /** "$25", "$15 to $20", "Free" */
  label?: string | undefined;
  notes?: string | undefined;
}

export function priceOf(d: Pick<EventData, 'price' | 'priceMax' | 'isFree' | 'priceNotes'>): PriceInfo {
  if (d.isFree || d.price === 0) return { known: true, free: true, label: 'Free', notes: d.priceNotes };
  if (d.price === undefined) return { known: false, free: false, notes: d.priceNotes };
  const label = d.priceMax !== undefined && d.priceMax > d.price ? `${formatPrice(d.price)} to ${formatPrice(d.priceMax)}` : formatPrice(d.price);
  return { known: true, free: false, label, notes: d.priceNotes };
}

/** Plain-language price line, e.g. "$25 per person. Includes a light buffet." */
export function priceText(p: PriceInfo): string {
  if (!p.known) return p.notes ?? 'Price not listed. Ask the organizer.';
  if (p.free) return p.notes ? `Free. ${p.notes}` : 'Free';
  return p.notes ? `${p.label} per person. ${p.notes}` : `${p.label} per person`;
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  active: 'Listed',
  past: 'Past event',
  cancelled: 'Cancelled',
  'pending-review': 'Waiting for review',
};
