/**
 * Generic adapter for tidy web pages that list dated events as text: band "shows" pages, venue
 * music calendars, club schedules. It needs no AI and no browser.
 *
 * fetch():     read source.url and any pageUrls through PoliteFetcher (robots.txt, delay, cache,
 *              our own User-Agent).
 * normalize(): turn the page into lines, find every date ("Sat, Oct 10", "October 10, 2026",
 *              "10/10/26", "2026-10-10"), and treat the text from one date to the next as one
 *              listing. A venue's own page (defaults.venueId) names the band or DJ in each listing;
 *              a band's own page (defaults.performerIds) names the venue and town. toCandidates()
 *              then matches venues, towns, bands and styles and writes our own title and summary.
 *
 * Listings without a clear Long Island town or venue, or that look like trivia/karaoke/closed
 * notices, are skipped. Anything unsure goes to the review queue through its confidence score.
 */
import { readFileSync } from 'node:fs';
import { addDays } from '../../src/lib/time';
import { findTimes } from '../lib/times';
import { actName, decodeEntities, htmlToLines, settingsOf, toCandidates, type FoundEvent } from '../lib/structured';
import type { Adapter, AdapterContext, FetchedDocument, NormalizeResult } from '../lib/types';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WD = String.raw`(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+`;
const MON = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const DATE_PATTERNS: { re: RegExp; read: (m: RegExpExecArray, line: string) => { y?: number; mo: number; d: number } | undefined }[] = [
  {
    // "Sat, Oct 10", "October 10, 2026", "Oct. 10th 2026"
    re: new RegExp(String.raw`\b(?:${WD})?${MON}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d\d))?`, 'gi'),
    read: (m) => ({ mo: MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1, d: Number(m[2]), y: m[3] ? Number(m[3]) : undefined }),
  },
  {
    // "Saturday 10 October 2026"
    re: new RegExp(String.raw`\b(?:${WD})?(\d{1,2})(?:st|nd|rd|th)?\s+${MON}(?:,?\s+(20\d\d))?\b`, 'gi'),
    read: (m) => ({ d: Number(m[1]), mo: MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1, y: m[3] ? Number(m[3]) : undefined }),
  },
  {
    // "10/10/2026", "Sat 10/24", or "10/3 Judi Silvano ..." (a numeric date needs a year, a weekday in
    // front, or a capitalized name right after it, so "1/2 price" is not read as a date)
    re: new RegExp(String.raw`(?:\b(${WD.slice(0, -1)})?)(\b\d{1,2})/(\d{1,2})(?:/(20\d\d|\d\d))?\b`, 'gi'),
    read: (m, line) =>
      m[4] || m[1] || NAME_AFTER.test(line.slice(m.index + m[0].length))
        ? { mo: Number(m[2]), d: Number(m[3]), y: m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : undefined }
        : undefined,
  },
  // "10-10-2026", "10.15.26"
  { re: /\b(\d{1,2})[-.](\d{1,2})[-.](20\d\d|\d\d)\b/g, read: (m) => ({ mo: Number(m[1]), d: Number(m[2]), y: m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]) }) },
  { re: /\b(20\d\d)-(\d{2})-(\d{2})\b/g, read: (m) => ({ y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }) },
];

/** A capitalized name right after a bare m/d date (case-sensitive on purpose). */
const NAME_AFTER = /^\s+(?:&\s*\d{1,2}\/\d{1,2}\s+)?[A-Z(]/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Year for a month/day without one: this year, or next year when it is long past. */
export function inferDate(parts: { y?: number; mo: number; d: number }, today: string): string | undefined {
  const { mo, d } = parts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  let y = parts.y ?? Number(today.slice(0, 4));
  let iso = `${y}-${pad(mo)}-${pad(d)}`;
  if (!parts.y && iso < addDays(today, -45)) {
    y += 1;
    iso = `${y}-${pad(mo)}-${pad(d)}`;
  }
  const check = new Date(`${iso}T12:00:00Z`);
  return check.getUTCMonth() + 1 === mo && check.getUTCDate() === d ? iso : undefined;
}

export interface DateHit {
  index: number;
  length: number;
  date: string;
}

/** Every date mentioned in a line, left to right (overlapping matches removed). */
export function findDates(line: string, today: string): DateHit[] {
  const hits: DateHit[] = [];
  for (const p of DATE_PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of line.matchAll(p.re)) {
      const parts = p.read(m as RegExpExecArray, line);
      const date = parts && inferDate(parts, today);
      if (!date) continue;
      const index = m.index!;
      if (hits.some((h) => index < h.index + h.length && h.index < index + m[0].length)) continue;
      hits.push({ index, length: m[0].length, date });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

interface Block {
  date: string;
  lines: string[];
  /** Line just above the date, used only when nothing follows the date. */
  before?: string | undefined;
}

const MONTH_ONLY = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?$/i;
const WEEKDAY_ONLY = /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?$/i;

/** Card layouts put "OCT", "10" and "2026" (or "SAT") in separate elements: join them back up. */
export function joinDateParts(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i]!;
    if (WEEKDAY_ONLY.test(l) && lines[i + 1] && MONTH_ONLY.test(lines[i + 1]!)) l = `${l} ${lines[++i]}`;
    if (MONTH_ONLY.test(l.split(' ').at(-1)!) && /^\d{1,2}(?:st|nd|rd|th)?$/.test(lines[i + 1] ?? '')) {
      l = `${l} ${lines[++i]}`;
      if (/^20\d\d$/.test(lines[i + 1] ?? '')) l = `${l}, ${lines[++i]}`;
    } else if (/^\d{1,2}$/.test(l) && MONTH_ONLY.test(lines[i + 1] ?? '')) {
      l = `${lines[++i]} ${l}`;
    }
    out.push(l);
  }
  return out;
}

/**
 * Split page lines into one block per dated listing. In "list" mode (event calendars that name
 * several events under one date) each following line with its own start time becomes its own
 * listing on the same date.
 */
export function dateBlocks(lines: string[], today: string, maxLines = 4, splitTimedLines = false): Block[] {
  const blocks: Block[] = [];
  let cur: Block | undefined;
  let prevPlain: string | undefined;
  for (const line of joinDateParts(lines)) {
    const hits = findDates(line, today);
    if (!hits.length) {
      if (cur && splitTimedLines && findTimes(line).length && cur.lines.some((l) => findTimes(l).length)) {
        cur = { date: cur.date, lines: [line] };
        blocks.push(cur);
      } else if (cur && cur.lines.length < maxLines && line.length < 300) cur.lines.push(line);
      else prevPlain = line.length < 120 ? line : undefined;
      continue;
    }
    hits.forEach((h, i) => {
      const rest = line.slice(h.index + h.length, hits[i + 1]?.index ?? line.length).replace(/^[\s,:|•·–—-]+/, '').trim();
      const before = i === 0 ? line.slice(0, h.index).replace(/[\s,:|•·–—-]+$/, '').trim() : '';
      // Same date again right away (e.g. "Oct 2 ... Friday, October 2, 2026"): one listing, not two.
      if (cur && cur.date === h.date && cur.lines.length <= 2) {
        if (rest) cur.lines.push(rest);
        return;
      }
      const head = [before, rest].filter(Boolean).join(' ');
      cur = { date: h.date, lines: head ? [head] : [], before: i === 0 ? prevPlain : undefined };
      blocks.push(cur);
    });
    prevPlain = undefined;
  }
  for (const b of blocks) if (!b.lines.length && b.before) b.lines.push(b.before);
  return blocks.filter((b) => b.lines.join(' ').trim().length >= 3);
}

export { actName };

/** Venue part of a band's gig line ("Salt Shack, Babylon 8pm" or "@ The Nutty Irishman"). */
function venueName(text: string): string | undefined {
  const at = /(?:@|\bat\b)\s+([A-Z][^,|•·\n]{2,60})/.exec(text);
  const raw = at ? at[1]! : text.split(/\s+[|•·]\s+|\s+[-–—]\s+|,\s*/)[0]!;
  let s = raw;
  for (const t of findTimes(s).sort((a, b) => b.index - a.index)) s = s.slice(0, t.index) + s.slice(t.index + t.length);
  s = s.replace(/[,.;:!\s]+$/, '').trim();
  return s.length >= 3 && s.length <= 60 && !/^(private|tba|tbd)\b/i.test(s) ? s : undefined;
}

const JUNK_LINE =
  /^(?:read more|view event|view details|event details|details(?: to come)?|more info|learn more|book(?: now)?|buy tickets?|tickets?|get tickets|rsvp|register|\(map\)|map|google calendar|ics|add to calendar|to|starting on|(?:monthly|weekly) on\b.*|call for reservations.*|free parking.*|no cover|sold out|\d+ events? (?:on|found)\b.*|no events?\b.*|(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|[^A-Za-z]*)$/i;

/** A line that can name an event (not just a time, a date, a button label or punctuation). */
export function meaningfulLine(line: string, today: string): boolean {
  let s = line;
  for (const t of findTimes(s).sort((a, b) => b.index - a.index)) s = s.slice(0, t.index) + s.slice(t.index + t.length);
  for (const d of findDates(s, today).sort((a, b) => b.index - a.index)) s = s.slice(0, d.index) + s.slice(d.index + d.length);
  s = s.replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(/[→←|•·–—\-:,.!()]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /[A-Za-z]{3}/.test(s) && !JUNK_LINE.test(s);
}

/** Squarespace event lists (class "eventlist-event") have tidy markup: read it directly. */
export function squarespaceEvents(html: string, pageUrl: string): FoundEvent[] {
  const out: FoundEvent[] = [];
  for (const m of html.matchAll(/<article class="eventlist-event[\s\S]*?<\/article>/g)) {
    const a = m[0];
    const title = decodeEntities(/class="eventlist-title-link"[^>]*>([\s\S]*?)<\/a>/.exec(a)?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const date = /<time class="event-date" datetime="(\d{4}-\d{2}-\d{2})"/.exec(a)?.[1];
    if (!title || !date) continue;
    const t24 = /<span class="event-time-24hr">([\s\S]*?)<\/span>\s*<\/li>/.exec(a)?.[1] ?? '';
    const times = [...t24.matchAll(/>(\d{1,2}:\d{2})</g)].map((x) => x[1]!.padStart(5, '0'));
    const addr = /class="eventlist-meta-item eventlist-meta-address[^"]*">([\s\S]*?)<a[^>]*href="[^"]*[?&]q=([^"&]*)"/.exec(a);
    const href = /class="eventlist-title-link" href="([^"]+)"|href="([^"]+)" class="eventlist-title-link"/.exec(a);
    const link = href ? new URL(decodeEntities(href[1] ?? href[2]!), pageUrl).href : undefined;
    const excerpt = /class="eventlist-excerpt"[^>]*>([\s\S]*?)<\/div>/.exec(a)?.[1];
    out.push({
      title,
      description: excerpt ? decodeEntities(excerpt.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 600) : undefined,
      start: times[0] ? `${date}T${times[0]}` : date,
      end: times[1] ? `${date}T${times[1]}` : undefined,
      locationName: addr ? decodeEntities(addr[1]!.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() || undefined : undefined,
      address: addr ? decodeURIComponent(addr[2]!.replace(/\+/g, ' ')).replace(/\s+United States$/i, '') : undefined,
      url: link,
      ref: 'events page',
      pageUrl: link ?? pageUrl,
    });
  }
  return out;
}

export function foundFromHtml(html: string, pageUrl: string, today: string, mode: 'venue' | 'band' | 'list'): FoundEvent[] {
  if (/<article class="eventlist-event/.test(html)) return squarespaceEvents(html, pageUrl);
  const out: FoundEvent[] = [];
  for (const b of dateBlocks(htmlToLines(html), today, 4, mode === 'list')) {
    // The name is the first real line after the date, or the line just above it.
    const title = b.lines.find((l) => meaningfulLine(l, today)) ?? (b.before && meaningfulLine(b.before, today) ? b.before : undefined);
    if (!title) continue; // a calendar cell, a "Book" button or a lone end time
    const text = b.lines.join(' · ').replace(/\s+/g, ' ').trim();
    const f: FoundEvent = { title: title.slice(0, 140), description: text.slice(0, 600), start: b.date, ref: 'events page', pageUrl };
    if (mode === 'band') f.locationName = venueName(text);
    out.push(f);
  }
  return out;
}
export const adapter: Adapter = {
  id: 'htmllist',
  async fetch(ctx: AdapterContext): Promise<FetchedDocument[]> {
    const src = settingsOf(ctx);
    const docs: FetchedDocument[] = [];
    for (const url of [...new Set([src.url, ...(src.pageUrls ?? [])])]) {
      const r = await ctx.fetcher.get(url, src.rateLimitSeconds);
      docs.push({ url, file: r.file, contentType: r.contentType, meta: {} });
    }
    return docs;
  },
  async normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult> {
    const src = settingsOf(ctx);
    const mode = src.defaults?.venueId ? 'venue' : src.defaults?.performerIds?.length ? 'band' : 'list';
    const found = docs.flatMap((d) => foundFromHtml(readFileSync(d.file, 'utf8'), d.url, ctx.today, mode));
    return toCandidates(found, ctx, { structured: false, horizonDays: 180 });
  },
};
