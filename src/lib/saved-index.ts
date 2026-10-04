/**
 * Small index of upcoming dates for every event series, used by the Saved events page (/saved/)
 * to show the next date, time and place of each saved event without loading every event page.
 */
import type { ResolvedEvent } from './content';

export interface SavedIndexDate {
  /** Date (YYYY-MM-DD, Long Island time). */
  d: string;
  /** Page for this date. */
  u: string;
  /** Time, e.g. "7:30 PM to 11:00 PM" (missing when the time is not listed). */
  l?: string;
  /** Start and end (milliseconds since 1970), so the page can drop dates that have ended. */
  s: number;
  e: number;
  /** Cancelled. */
  x?: 1;
}

export interface SavedIndexEntry {
  /** Title. */
  t: string;
  /** Place, e.g. "Brumidi Lodge, Deer Park". */
  p: string;
  /** Kind of event, e.g. "Social dance". */
  c: string;
  /** How often it repeats, e.g. "Every Wednesday". */
  r?: string;
  o: SavedIndexDate[];
}

export interface SavedIndex {
  v: 1;
  events: Record<string, SavedIndexEntry>;
}

/** Next `perEvent` dates of each series that has not ended by `now`, in date order. */
export function buildSavedIndex(occurrences: ResolvedEvent[], now: Date, perEvent = 8): SavedIndex {
  const events: Record<string, SavedIndexEntry> = {};
  const nowMs = now.getTime();
  const sorted = occurrences.filter((o) => o.end.getTime() > nowMs).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const o of sorted) {
    const entry = (events[o.eventId] ??= {
      t: o.title,
      p: o.location.name ? `${o.location.name}${o.location.town ? `, ${o.location.town}` : ''}` : (o.location.town ?? ''),
      c: o.categoryLabel,
      ...(o.cadence ? { r: o.cadence } : {}),
      o: [],
    });
    if (!entry.r && o.cadence) entry.r = o.cadence;
    if (entry.o.length >= perEvent) continue;
    entry.o.push({ d: o.date, u: o.url, ...(o.timeLabel ? { l: o.timeLabel } : {}), s: o.start.getTime(), e: o.end.getTime(), ...(o.status === 'cancelled' ? { x: 1 as const } : {}) });
  }
  return { v: 1, events };
}
