/**
 * Merge this run's drafts into the existing event files. Idempotent and incremental:
 *  - the same listing (same matchKey) updates its file instead of creating a new one;
 *  - firstSeen never changes; lastSeen becomes today;
 *  - fields listed in lockedFields (fixed by an editor) are never overwritten;
 *  - nothing is deleted: ended events become "past"; listings that vanished from a source that still
 *    covers their dates go to "pending-review" so a person can check whether they were cancelled.
 */
import type { EventData, EventStatus } from '../../src/lib/schemas';

/** An event record in progress: the schema's output shape, with every field optional until it is validated. */
export type EventRecord = Partial<EventData> & Pick<EventData, 'title' | 'summary' | 'category' | 'start' | 'sourceId' | 'sourceUrl'>;
import { lastDate, occurrenceDates, parseRRule } from '../../src/lib/rrule';
import { parseLocal } from '../../src/lib/time';
import { inferRecurrence, type Draft } from './collapse';

export const REVIEW_THRESHOLD = 0.6;

export interface MergeStats {
  new: number;
  updated: number;
  unchanged: number;
  needsReview: number;
  expired: number;
  missing: number;
}

export interface MergeResult {
  events: Map<string, EventRecord>;
  /** Ids whose file content changed. */
  changed: Set<string>;
  stats: MergeStats;
  /** Ids now waiting for review, with the reason. */
  review: { id: string; reason: string }[];
}

type Stored = EventRecord;

const LOCKABLE = [
  'title', 'summary', 'category', 'danceStyles', 'start', 'end', 'timezone', 'recurrence', 'cadence', 'lessonTime', 'venueId', 'town',
  'organizerId', 'performerIds', 'instructorIds', 'price', 'priceMax', 'isFree', 'priceNotes', 'skillLevel', 'ageGroup', 'ticketUrl',
  'infoUrl', 'contactPhone', 'contactEmail', 'sourceUrl', 'sourceName', 'sourceRef', 'dancingCues', 'confidence', 'reviewNotes',
] as const;

function datesOf(e: Pick<EventRecord, 'start' | 'recurrence'>): string[] {
  const start = parseLocal(String(e.start)).date;
  const until = lastDate(start, e.recurrence) ?? start;
  return occurrenceDates(start, e.recurrence, until);
}

const comparable = (e: EventRecord) => JSON.stringify({ ...e, lastSeen: undefined });

export function mergeDrafts(
  existing: Map<string, EventData>,
  drafts: Draft[],
  opts: { sourceId: string; today: string; coverage?: { from: string; to: string } | undefined; threshold?: number },
): MergeResult {
  const threshold = opts.threshold ?? REVIEW_THRESHOLD;
  const events = new Map<string, EventRecord>([...existing].map(([id, e]) => [id, { ...e }]));
  const before = new Map([...events].map(([id, e]) => [id, comparable(e)]));
  const byKey = new Map<string, string>();
  for (const [id, e] of existing) if (e.matchKey && e.sourceId === opts.sourceId) byKey.set(e.matchKey, id);
  const stats: MergeStats = { new: 0, updated: 0, unchanged: 0, needsReview: 0, expired: 0, missing: 0 };
  const review: MergeResult['review'] = [];
  const seen = new Set<string>();

  const statusFor = (confidence: number, dates: string[], prev?: Stored): EventStatus => {
    if (prev && (prev.lockedFields ?? []).includes('status')) return prev.status as EventStatus;
    if (prev?.status === 'cancelled') return 'cancelled';
    if (confidence < threshold) return 'pending-review';
    return dates.every((d) => d < opts.today) ? 'past' : 'active';
  };

  for (const d of drafts) {
    const id = byKey.get(d.matchKey);
    if (!id) {
      const status = statusFor(d.data.confidence ?? 1, d.dates);
      events.set(d.id, { ...d.data, matchKey: d.matchKey, firstSeen: opts.today, lastSeen: opts.today, status });
      seen.add(d.id);
      stats.new++;
      if (status === 'pending-review') review.push({ id: d.id, reason: String(d.data.reviewNotes ?? 'Low confidence') });
      continue;
    }
    seen.add(id);
    const prev = events.get(id) as Stored;
    const locked = new Set(prev.lockedFields ?? []);
    // An editor who holds or publishes a listing by hand owns its notes too.
    if (locked.has('status')) locked.add('reviewNotes');
    const next: Record<string, unknown> = { ...prev };
    for (const k of LOCKABLE) if (!locked.has(k)) next[k] = (d.data as Record<string, unknown>)[k];
    let dates = d.dates;
    if (d.data.recurrence && prev.recurrence && !locked.has('recurrence') && !locked.has('start')) {
      dates = [...new Set([...datesOf(prev), ...d.dates])].sort();
      const rule = d.data.recurrence.rrule ? parseRRule(d.data.recurrence.rrule) : undefined;
      const ords = rule?.freq === 'MONTHLY' ? rule.byday.map((b) => b.ordinal!).filter((o) => o !== undefined) : undefined;
      next.recurrence = inferRecurrence(dates, ords);
      const time = parseLocal(String(d.data.start)).time;
      next.start = time ? `${dates[0]}T${time}` : dates[0];
      const endTime = d.data.end ? parseLocal(String(d.data.end)).time : undefined;
      next.end = endTime ? `${dates[0]}T${endTime}` : undefined;
    }
    next.lastSeen = opts.today;
    next.status = statusFor(Number(next.confidence ?? 1), dates, prev);
    if (next.status === 'pending-review') review.push({ id, reason: String(next.reviewNotes ?? 'Low confidence') });
    events.set(id, next as EventRecord);
  }

  for (const [id, e] of events) {
    if (seen.has(id)) continue;
    const dates = datesOf(e);
    const last = dates.at(-1) ?? parseLocal(String(e.start)).date;
    if (e.status === 'active' && last < opts.today) {
      events.set(id, { ...e, status: 'past' });
      stats.expired++;
      continue;
    }
    const cov = opts.coverage;
    if (e.sourceId === opts.sourceId && cov && e.status === 'active' && !(e.lockedFields ?? []).includes('status')) {
      const from = opts.today > cov.from ? opts.today : cov.from;
      if (dates.some((x) => x >= from && x <= cov.to)) {
        const note = `Not found in the latest ${opts.sourceId} run on ${opts.today}. Check whether it was cancelled or moved.`;
        events.set(id, { ...e, status: 'pending-review', reviewNotes: [e.reviewNotes, note].filter(Boolean).join(' ') });
        stats.missing++;
        review.push({ id, reason: note });
      }
    }
  }

  const changed = new Set<string>();
  for (const [id, e] of events) {
    const was = before.get(id);
    if (was === undefined) {
      changed.add(id);
      continue;
    }
    if (was !== comparable(e)) {
      changed.add(id);
      if (seen.has(id) && byKey.has(e.matchKey ?? '')) stats.updated++;
    } else if (seen.has(id)) {
      stats.unchanged++;
      if (JSON.stringify(existing.get(id)) !== JSON.stringify(e)) changed.add(id);
    }
  }
  stats.needsReview = [...events.values()].filter((e) => e.status === 'pending-review').length;
  return { events, changed, stats, review };
}
