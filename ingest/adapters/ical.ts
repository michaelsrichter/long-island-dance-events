/**
 * Generic adapter for calendar feeds (.ics): WordPress "The Events Calendar" (?ical=1), Squarespace
 * (?format=ical), LibCal, public Google Calendar links, and any other iCalendar feed.
 *
 * fetch():     download feedUrl (or the source url when it is the feed) plus any extra feeds in
 *              pageUrls, through PoliteFetcher (robots.txt, delay, cache, our own User-Agent).
 * normalize(): read every VEVENT: SUMMARY, DESCRIPTION, LOCATION, URL, DTSTART/DTEND (time zones,
 *              UTC and all-day), STATUS, RRULE + EXDATE (expanded to dates), RECURRENCE-ID overrides.
 */
import { readFileSync } from 'node:fs';
import { occurrenceDates, validateRRule } from '../../src/lib/rrule';
import { addDays, zonedToUtc } from '../../src/lib/time';
import { lookupPlace } from '../lib/registry';
import { settingsOf, toCandidates, toNewYork, type FoundEvent } from '../lib/structured';
import type { Adapter, AdapterContext, FetchedDocument, NormalizeResult } from '../lib/types';

export interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}
export type IcsEvent = Map<string, IcsProp[]>;

/** Unfold lines and split the feed into VEVENT property maps. */
export function parseIcs(raw: string): IcsEvent[] {
  const lines = raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events: IcsEvent[] = [];
  let cur: IcsEvent | undefined;
  let depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) {
      cur = new Map();
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:VEVENT/i.test(line)) {
      events.push(cur);
      cur = undefined;
      continue;
    } else if (/^END:/i.test(line)) depth--;
    if (depth > 0) continue; // skip VALARM and other nested blocks
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const p of m[2]!.split(';').filter(Boolean)) {
      const [k, ...v] = p.split('=');
      params[k!.toUpperCase()] = v.join('=').replace(/^"|"$/g, '');
    }
    const name = m[1]!.toUpperCase();
    cur.set(name, [...(cur.get(name) ?? []), { name, params, value: m[3]! }]);
  }
  return events;
}

/** Undo iCalendar text escaping. */
export const unescapeIcs = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/** DTSTART/DTEND/EXDATE value -> local New York 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
export function icsTimeToLocal(value: string, params: Record<string, string>): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || params.VALUE === 'DATE') return date;
  const time = `${m[4]}:${m[5]}`;
  if (m[7]) return toNewYork(new Date(`${date}T${time}:${m[6] ?? '00'}Z`));
  const tz = params.TZID;
  if (tz && tz !== 'America/New_York') {
    try {
      return toNewYork(zonedToUtc(date, time, tz));
    } catch {
      return `${date}T${time}`;
    }
  }
  return `${date}T${time}`;
}

/** "Brush Barn, 211 E Main St, Smithtown, NY 11787" -> name, street and town. */
export function splitLocation(loc: string | undefined): Pick<FoundEvent, 'locationName' | 'address' | 'locality'> {
  if (!loc) return {};
  const parts = loc.split(/\s*,\s*/).filter(Boolean);
  const out: Pick<FoundEvent, 'locationName' | 'address' | 'locality'> = {};
  for (const [i, p] of parts.entries()) {
    if (!out.address && /^\d{1,6}\s+\S/.test(p)) out.address = p;
    else if (!out.locality && lookupPlace(p)) out.locality = p;
    else if (i === 0 && !/^\d/.test(p)) out.locationName = p;
  }
  // A town that is not on Long Island still counts as the stated town (it is then out of area).
  if (!out.locality && parts.length >= 3) {
    const before = parts.findIndex((p) => /^(NY|New York)\b/i.test(p) || /^[A-Z]{2}\s+\d{5}/.test(p));
    if (before > 0) out.locality = parts[before - 1];
  }
  if (!out.locationName && !out.address && parts.length === 1) out.locationName = parts[0];
  return out;
}

const first = (e: IcsEvent, name: string) => e.get(name)?.[0];

/** Expand feed events into dated FoundEvents (rules, extra dates, skipped dates, overrides). */
export function foundFromIcs(raw: string, feedUrl: string, today: string, horizonDays = 120): FoundEvent[] {
  const events = parseIcs(raw);
  const horizon = addDays(today, horizonDays);
  const overrides = new Set<string>();
  for (const e of events) {
    const rid = first(e, 'RECURRENCE-ID');
    const uid = first(e, 'UID')?.value;
    if (rid && uid) overrides.add(`${uid}|${(icsTimeToLocal(rid.value, rid.params) ?? '').slice(0, 10)}`);
  }
  const out: FoundEvent[] = [];
  for (const e of events) {
    const ds = first(e, 'DTSTART');
    const summary = first(e, 'SUMMARY');
    if (!ds || !summary) continue;
    const start = icsTimeToLocal(ds.value, ds.params);
    if (!start) continue;
    const de = first(e, 'DTEND');
    let end = de ? icsTimeToLocal(de.value, de.params) : undefined;
    // All-day events end the next day in iCalendar; keep them single-day.
    if (end && end.length === 10 && start.length === 10) end = undefined;
    const uid = first(e, 'UID')?.value ?? '';
    const loc = splitLocation(first(e, 'LOCATION') ? unescapeIcs(first(e, 'LOCATION')!.value) : undefined);
    const urlProp = first(e, 'URL')?.value;
    const notes: string[] = [];
    const base: Omit<FoundEvent, 'start' | 'end'> = {
      title: unescapeIcs(summary.value),
      description: first(e, 'DESCRIPTION') ? unescapeIcs(first(e, 'DESCRIPTION')!.value).slice(0, 1500) : undefined,
      ...loc,
      url: urlProp && /^https?:\/\//i.test(urlProp) ? urlProp : undefined,
      cancelled: /CANCELLED/i.test(first(e, 'STATUS')?.value ?? ''),
      ref: 'calendar feed',
      pageUrl: urlProp && /^https?:\/\//i.test(urlProp) ? urlProp : feedUrl,
      notes,
    };
    const startDate = start.slice(0, 10);
    const timePart = start.slice(10);
    const endOffset = end ? Math.round((Date.parse(`${end.slice(0, 10)}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) : 0;
    const endPart = end ? end.slice(10) : '';
    let dates = [startDate];
    const rr = first(e, 'RRULE');
    if (rr && !first(e, 'RECURRENCE-ID')) {
      const rule = rr.value
        .split(';')
        .filter((p) => !/^(WKST|BYSETPOS=)/i.test(p))
        .map((p) => (/^UNTIL=/i.test(p) ? `UNTIL=${p.slice(6, 14)}` : p))
        .join(';');
      const exdates = (e.get('EXDATE') ?? []).flatMap((x) => x.value.split(',').map((v) => (icsTimeToLocal(v, x.params) ?? '').slice(0, 10))).filter(Boolean);
      const rdates = (e.get('RDATE') ?? []).flatMap((x) => x.value.split(',').map((v) => (icsTimeToLocal(v, x.params) ?? '').slice(0, 10))).filter(Boolean);
      if (validateRRule(rule) === null) dates = occurrenceDates(startDate, { rrule: rule, rdates, exdates }, horizon);
      else notes.push(`Repeat rule "${rr.value}" is not supported; only the first date was kept.`);
    }
    for (const d of dates) {
      if (d < today || d > horizon) continue;
      if (rr && uid && overrides.has(`${uid}|${d}`)) continue;
      out.push({ ...base, start: `${d}${timePart}`, end: end ? `${addDays(d, endOffset)}${endPart}` : undefined });
    }
  }
  return out;
}

export const adapter: Adapter = {
  id: 'ical',
  async fetch(ctx: AdapterContext): Promise<FetchedDocument[]> {
    const src = settingsOf(ctx);
    const feeds = [src.feedUrl ?? src.url, ...(src.pageUrls ?? [])];
    const docs: FetchedDocument[] = [];
    for (const url of [...new Set(feeds)]) {
      const r = await ctx.fetcher.get(url, src.rateLimitSeconds);
      const head = readFileSync(r.file, 'utf8').slice(0, 2000);
      if (!/BEGIN:VCALENDAR/i.test(head)) throw new Error(`${url} is not a calendar feed (no BEGIN:VCALENDAR). The site may have moved its feed.`);
      docs.push({ url, file: r.file, contentType: r.contentType, meta: {} });
    }
    return docs;
  },
  async normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult> {
    const found = docs.flatMap((d) => foundFromIcs(readFileSync(d.file, 'utf8'), d.url, ctx.today));
    return toCandidates(found, ctx, { structured: true, horizonDays: 120 });
  },
};
