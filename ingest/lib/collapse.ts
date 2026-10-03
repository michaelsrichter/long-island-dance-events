/**
 * Combine dated candidates into events. A listing that appears on the same weekday, time and place
 * several times becomes one repeating event with an RRULE; everything else is a one-time event.
 */
import type { EventData } from '../../src/lib/schemas';
import { formatRRule, type ByDay, type RRule } from '../../src/lib/rrule';
import { addDays, daysInMonth, weekdayOf, WEEKDAYS } from '../../src/lib/time';
import type { Candidate } from './types';
import { slugify } from './text';

/** Event fields produced by an adapter; validated with the Zod schema before anything is written. */
export type DraftData = Partial<Omit<EventData, 'firstSeen' | 'lastSeen'>> & Pick<EventData, 'title' | 'summary' | 'category' | 'start' | 'sourceId' | 'sourceUrl'>;

export interface Draft {
  id: string;
  matchKey: string;
  /** Every date this draft covers (used when merging with earlier runs). */
  dates: string[];
  data: DraftData;
}

const dow = (d: string) => WEEKDAYS.indexOf(weekdayOf(d));

/** 1-5: which occurrence of its weekday a date is within its month. */
export function ordinalInMonth(date: string): number {
  return Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;
}

function isLastOfMonth(date: string): boolean {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return Number(date.slice(8, 10)) + 7 > daysInMonth(y, m);
}

/**
 * The simplest rule that reproduces exactly these dates (all on one weekday):
 * weekly; monthly by ordinal ("1st and 3rd Fridays"); weekly minus one skipped week; or a plain date list.
 */
export function inferRecurrence(dates: string[], statedOrdinals?: number[]): { rrule?: string; rdates: string[]; exdates: string[] } {
  const sorted = [...new Set(dates)].sort();
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const weekday = dow(first);
  const weekly: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) weekly.push(d);
  const set = new Set(sorted);
  const missing = weekly.filter((d) => !set.has(d));
  const until = last;
  if (missing.length === 0 && !statedOrdinals?.length) {
    return { rrule: formatRRule({ freq: 'WEEKLY', interval: 1, byday: [{ weekday }], until }), rdates: [], exdates: [] };
  }
  // Monthly by ordinal: every date's ordinal is in the set, and no weekday date with that ordinal is missing.
  // Monthly by ordinal only when the source states it ("1st and 3rd Fridays") or the dates span two
  // months; one month of two dates is not enough to tell "2nd and 4th" from "every other week".
  const months = new Set(sorted.map((d) => d.slice(0, 7))).size;
  const ords = statedOrdinals?.length ? statedOrdinals : months >= 2 && sorted.length >= 3 ? [...new Set(sorted.map(ordinalInMonth))].sort() : [];
  const matchesOrd = (d: string) => ords.includes(ordinalInMonth(d)) || (ords.includes(-1) && isLastOfMonth(d));
  if (ords.length && ords.length <= 2 && sorted.every(matchesOrd) && weekly.filter(matchesOrd).every((d) => set.has(d)) && sorted.length >= 2) {
    const byday: ByDay[] = ords.map((o) => ({ weekday, ordinal: o }));
    const rule: RRule = { freq: 'MONTHLY', interval: 1, byday, until };
    return { rrule: formatRRule(rule), rdates: [], exdates: [] };
  }
  if (missing.length === 1 && sorted.length >= 3) {
    return { rrule: formatRRule({ freq: 'WEEKLY', interval: 1, byday: [{ weekday }], until }), rdates: [], exdates: missing };
  }
  return { rdates: sorted.slice(1), exdates: [] };
}

const mostCommon = <T extends { summary: string }>(xs: T[]): T => {
  const counts = new Map<string, { v: T; n: number }>();
  for (const x of xs) {
    const k = JSON.stringify(x);
    counts.set(k, { v: x, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  // Most frequent wording; on a tie, the shortest summary (facts that are common to every date).
  return [...counts.values()].sort((a, b) => b.n - a.n || a.v.summary.length - b.v.summary.length)[0]!.v;
};

function baseData(c: Candidate, dates: string[], repeating: boolean): DraftData {
  const first = dates[0]!;
  return {
    title: repeating ? c.seriesTitle : c.title,
    summary: repeating ? c.seriesSummary : c.summary,
    category: c.category,
    danceStyles: c.danceStyles,
    start: c.start ? `${first}T${c.start}` : first,
    end: c.end && c.start ? `${first}T${c.end}` : undefined,
    timezone: 'America/New_York',
    cadence: c.cadence,
    lessonTime: c.lessonTime,
    venueId: c.venueId,
    town: c.town,
    performerIds: c.performerIds,
    instructorIds: c.instructorIds,
    organizerId: c.organizerId,
    price: c.price,
    priceMax: c.priceMax,
    isFree: c.isFree,
    priceNotes: c.priceNotes,
    skillLevel: c.skillLevel,
    ageGroup: c.ageGroup,
    ticketUrl: c.ticketUrl,
    infoUrl: c.infoUrl,
    contactPhone: c.contactPhone,
    contactEmail: c.contactEmail,
    sourceId: c.sourceId,
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
    sourceRef: c.sourceRef,
    status: 'active',
    dancingCues: c.dancingCues ?? [],
    confidence: Number(c.confidence.toFixed(2)),
    reviewNotes: c.reviewNotes.length ? [...new Set(c.reviewNotes)].join(' ') : undefined,
  };
}

export function collapse(candidates: Candidate[], takenIds: Set<string> = new Set()): Draft[] {
  const drafts: Draft[] = [];
  const groups = new Map<string, Candidate[]>();
  const singles: Candidate[] = [];
  for (const c of candidates) {
    if (c.oneOff) singles.push(c);
    else groups.set(c.seriesKey, [...(groups.get(c.seriesKey) ?? []), c]);
  }
  for (const [key, list] of groups) {
    const byDate = new Map(list.map((c) => [c.date, c]));
    if (byDate.size < 2) {
      singles.push(...byDate.values());
      continue;
    }
    const dates = [...byDate.keys()].sort();
    const rep = mostCommon([...byDate.values()].map((c) => ({ ...c, date: '', sourceRef: '', confidence: 0, reviewNotes: [] as string[] })));
    const pages = [...new Set(list.map((c) => /\d+/.exec(c.sourceRef)?.[0]).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    const merged: Candidate = {
      ...rep,
      date: dates[0]!,
      sourceRef: pages.length > 1 ? `pages ${pages.join(', ')}` : list[0]!.sourceRef,
      confidence: list.reduce((s, c) => s + c.confidence, 0) / list.length,
      reviewNotes: list.flatMap((c) => c.reviewNotes),
    };
    const recurrence = inferRecurrence(dates, rep.cadenceOrdinals);
    const data = { ...baseData(merged, dates, true), recurrence };
    const id = uniqueId(slugify(`${merged.organizerId ?? merged.venueId ?? merged.town} ${categoryWord(merged.category)} ${weekdayOf(dates[0]!)}s`, 70), takenIds, merged.start);
    drafts.push({ id, matchKey: `${key}|repeat`, dates, data });
  }
  for (const c of singles) {
    const data = baseData(c, [c.date], false);
    const who = c.performerIds.find((p) => c.category === 'live-music' && p) ?? c.organizerId ?? c.venueId ?? c.town;
    const id = uniqueId(slugify(`${c.date} ${c.theme ?? ''} ${who} ${categoryWord(c.category)}`, 64), takenIds, c.start);
    drafts.push({ id, matchKey: `${c.seriesKey}|${c.date}${c.oneOff ? `|${slugify(c.theme ?? 'special')}` : ''}`, dates: [c.date], data });
  }
  return drafts.sort((a, b) => a.id.localeCompare(b.id));
}

export function categoryWord(c: Candidate['category']): string {
  return { 'social-dance': 'social', 'class-lesson': 'classes', 'lesson-party': 'lesson and dance', 'live-music': 'live music', festival: 'festival' }[c];
}

function uniqueId(base: string, taken: Set<string>, time?: string): string {
  let id = base || 'event';
  if (taken.has(id) && time) id = `${base}-${time.replace(':', '')}`;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
