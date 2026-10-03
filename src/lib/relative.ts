/**
 * Friendly relative date labels ("Tonight!", "Tomorrow night", "In 4 days").
 *
 * Runs in the browser on every page view so labels are right even between nightly builds.
 * It compares instants (UTC milliseconds) and asks Intl for New York calendar dates, so a
 * visitor's own timezone never shifts an event to the wrong day.
 */

const TZ = 'America/New_York';
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' });

/** Day number (days since 1970-01-01) of an instant's calendar date in New York. */
function nyDayNumber(ms: number): number {
  const [y, m, d] = ymd.format(new Date(ms)).split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export type RelativeTone = 'now' | 'today' | 'soon' | 'later' | 'past';

export interface RelativeLabel {
  text: string;
  tone: RelativeTone;
  /** Whole calendar days from today (New York), 0 = today. */
  days: number;
}

/**
 * @param startMs event start (UTC ms)
 * @param endMs event end (UTC ms)
 * @param nowMs current time (UTC ms)
 * @param opts.excited add "!" to "In N days" (used for Riverbend's own events)
 * @param opts.allDay date known but time to be announced
 */
export function relativeLabel(startMs: number, endMs: number, nowMs: number, opts: { excited?: boolean; allDay?: boolean } = {}): RelativeLabel {
  const days = nyDayNumber(startMs) - nyDayNumber(nowMs);
  if (endMs <= nowMs) return { text: '', tone: 'past', days };
  if (startMs <= nowMs) return { text: 'Happening now!', tone: 'now', days: 0 };
  const evening = !opts.allDay && Number(hourFmt.format(new Date(startMs))) >= 17;
  const bang = opts.excited ? '!' : '';
  if (days <= 0) return { text: evening ? 'Tonight!' : 'Today!', tone: 'today', days: 0 };
  if (days === 1) return { text: evening ? 'Tomorrow night' : 'Tomorrow', tone: 'soon', days };
  if (days < 7) return { text: `This ${weekdayFmt.format(new Date(startMs))} · in ${days} days${bang}`, tone: 'soon', days };
  if (days < 14) return { text: `Next ${weekdayFmt.format(new Date(startMs))} · in ${days} days${bang}`, tone: 'later', days };
  const weeks = Math.round(days / 7);
  return { text: `In ${weeks} weeks`, tone: 'later', days };
}
