/**
 * Ira's List (iraslistli.com): a weekly list of live bands and DJs at Long Island bars, restaurants, parks
 * and theaters, published as plain text on the home page ("THIS WEEK"), one line per gig:
 *   SATURDAY 10/3
 *   SPONSORS
 *   -📌Faces for Radio-Nutty Irishman 🇮🇪 (Ira'sList Sponsored Venue)
 *   OTHERS
 *   -Nitework-Cooperage Inn 1-5p
 *
 * fetch():     download the home page politely (robots.txt allows it; cached).
 * normalize(): split each line into act, venue and time; match venues and bands we have researched; keep
 *              Nassau/Suffolk venues only. Gigs at venues nobody has researched yet are reported, not
 *              published, so a person can look the venue up first. Theater shows, comedy and drag brunches
 *              are skipped: they are not live music for dancing.
 * The "live calendar" on that page is a third-party widget whose data host blocks robots, so we do not use it.
 */
import type { DancingCue, EventCategory } from '../../src/lib/schemas';
import { formatDateLong, weekdayOf } from '../../src/lib/time';
import { lookupPlace, type Registry } from '../lib/registry';
import { normalizeText, slugify } from '../lib/text';
import { parseTimes } from '../lib/times';
import type { Adapter, AdapterContext, Candidate, FetchedDocument, NormalizeResult } from '../lib/types';

export interface IraRow {
  date: string;
  sponsor: boolean;
  /** The line as published, without emoji and sponsor tags. */
  text: string;
  act: string;
  venue: string;
  /** Time as written, normalized to "5pm" / "1-5pm" style, if any. */
  time?: string | undefined;
  /** Ira's List marked the time with "?". */
  timeUnsure?: boolean | undefined;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', zwj: '', zwnj: '', shy: '', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripTags(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^<>]*>/g, '');
  } while (s !== prev);
  return s;
}

/** Text of every paragraph in the page, one entry per line, in order. */
export function htmlLines(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    // Facts are plain text: strip tags until none are left, then drop any angle brackets that decoding produced.
    const text = decodeHtml(stripTags(m[1]!.replace(/<br\s*\/?>/gi, '\n')))
      .replace(/[<>]/g, ' ')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
    for (const line of text.split('\n')) {
      const t = line.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
  }
  return out;
}

const DAY_RE = /^(MON|TUES|WEDNES|THURS|FRI|SATUR|SUN)DAY\s+(\d{1,2})\s*\/\s*(\d{1,2})\b/i;
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]/gu;
const SPONSOR_RE = /\(\s*Ira[^)]*?Sponsor[^)]*\)/i;
const TIME_WORD = String.raw`\d{1,2}(?::\d{2})?\s*(?:a|p)\.?m?\.?`;
const TRAILING_TIME_RE = new RegExp(String.raw`(?:^|\s|-)((?:\d{1,2}(?::\d{2})?\s*(?:(?:a|p)\.?m?\.?)?\s*[-–]\s*${TIME_WORD})|${TIME_WORD}|\d{1,2}\s*[-–]\s*\d{1,2})\s*(\?)?\s*$`, 'i');
const TIME_ONLY_RE = new RegExp(String.raw`^((?:\d{1,2}(?::\d{2})?\s*(?:(?:a|p)\.?m?\.?)?\s*[-–]\s*${TIME_WORD})|${TIME_WORD}|\d{1,2}\s*[-–]\s*\d{1,2})\s*(\?)?$`, 'i');

/** "5p" -> "5pm", "11a" -> "11am", "1-5" -> "1-5pm", "1 – 5pm" -> "1-5pm". Bare numbers mean afternoon or evening. */
export function normalizeTime(t: string): string {
  let s = t.toLowerCase().replace(/\s+/g, '').replace(/–/g, '-').replace(/\./g, '');
  s = s.replace(/(\d)([ap])(?!m)/g, '$1$2m');
  if (!/[ap]m/.test(s)) s += 'pm';
  return s;
}

/** Year for a "10/3" heading: the one closest to today (lists cross New Year's). */
export function dateFor(month: number, day: number, today: string): string {
  const y = Number(today.slice(0, 4));
  const t = Date.parse(`${today}T12:00:00Z`);
  const best = [y - 1, y, y + 1]
    .map((yy) => `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    .sort((a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - t) - Math.abs(Date.parse(`${b}T12:00:00Z`) - t));
  return best[0]!;
}

/** Split "Faces for Radio-Nutty Irishman" into act and venue. The venue is matched against our list later. */
export function splitEntry(s: string): { act: string; venue: string } {
  const dash = /\s*[-–—]\s*/g;
  for (const m of s.matchAll(dash)) {
    const left = s.slice(0, m.index).trim();
    const right = s.slice(m.index! + m[0].length).trim();
    if (left.length >= 2 && right.length >= 2) return { act: left, venue: right };
  }
  const at = /\s@\s?|@\s/.exec(s);
  if (at) return { act: s.slice(0, at.index).trim(), venue: s.slice(at.index + at[0].length).trim() };
  const atWord = /\s+at\s+(?:the\s+)?(?=[A-Z0-9])/g;
  let last: RegExpExecArray | undefined;
  for (const m of s.matchAll(atWord)) last = m;
  if (last) return { act: s.slice(0, last.index).trim(), venue: s.slice(last.index! + last[0].length).trim() };
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(s);
  if (paren) return { act: paren[1]!.trim(), venue: paren[2]!.trim() };
  const presents = /^(.+?)\s+presents?\s*:\s*(.+)$/i.exec(s);
  if (presents) return { act: presents[2]!.trim(), venue: presents[1]!.trim() };
  return { act: s.trim(), venue: '' };
}

/** One listing line -> act, venue, time, sponsor flag. Returns undefined for lines that are not gigs. */
export function parseEntry(line: string): Omit<IraRow, 'date'> | undefined {
  let s = line;
  const sponsor = SPONSOR_RE.test(s);
  s = s.replace(SPONSOR_RE, ' ').replace(EMOJI_RE, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s\-–—•*~]+/, '').trim();
  if (s.length < 3) return undefined;
  let time: string | undefined;
  let timeUnsure = false;
  const tm = TRAILING_TIME_RE.exec(s);
  if (tm && tm.index > 0) {
    time = normalizeTime(tm[1]!);
    timeUnsure = Boolean(tm[2]);
    s = s.slice(0, tm.index).replace(/[\s\-–—,]+$/, '').trim();
  }
  const { act, venue } = splitEntry(s);
  const clean = (x: string) => x.replace(/^[\s\-–—,:;]+|[\s\-–—,:;]+$/g, '').replace(/\s+/g, ' ').trim();
  return { sponsor, text: s, act: clean(act), venue: clean(venue).replace(/\s*[-–—]\s*/g, ' '), time, timeUnsure: timeUnsure || undefined };
}

/** All gigs in the "THIS WEEK" list, with dates. */
export function parseWeeklyList(html: string, today: string): IraRow[] {
  const rows: IraRow[] = [];
  let date: string | undefined;
  let sponsor = false;
  for (const line of htmlLines(html)) {
    const d = DAY_RE.exec(line);
    if (d) {
      date = dateFor(Number(d[2]), Number(d[3]), today);
      sponsor = false;
      continue;
    }
    if (!date) continue;
    if (/^SPONSORS?\b/i.test(line)) {
      sponsor = true;
      continue;
    }
    if (/^OTHERS?\b/i.test(line)) {
      sponsor = false;
      continue;
    }
    if (/all rights reserved|©|\(c\)\s*\d{4}/i.test(line)) break;
    if (/\b(verify|please|cancellations|calendar above)\b/i.test(line)) continue;
    // Any other all-capitals heading ("HALLOWEEN WEEKEND") ends the day's list.
    if (!/[a-z]/.test(line) && !/[-–@]/.test(line) && /^[A-Z0-9 '&!.,:]+$/.test(line.replace(EMOJI_RE, '').trim())) {
      date = undefined;
      continue;
    }
    const prev = rows.at(-1);
    const timeOnly = TIME_ONLY_RE.exec(line.replace(EMOJI_RE, '').trim());
    if (timeOnly) {
      if (prev && prev.date === date && !prev.time) prev.time = normalizeTime(timeOnly[1]!);
      continue;
    }
    const e = parseEntry(line);
    if (!e) continue;
    // The same gig is sometimes listed twice on one day.
    if (rows.some((r) => r.date === date && normalizeText(r.text) === normalizeText(e.text))) continue;
    rows.push({ date, ...e, sponsor: sponsor || e.sponsor });
  }
  return rows;
}

/** Shows that are not live music for dancing (theater, comedy, drag brunch, trivia). */
const NOT_MUSIC_RE = /\b(the musical|musical\b|comedy|comedian|stand[- ]up|magician|magic show|drag (brunch|show)|trivia|bingo|paint (and|&) sip|book (talk|signing))\b/i;

export function cuesFor(row: Pick<IraRow, 'act' | 'venue' | 'text' | 'time'>): DancingCue[] {
  const t = `${row.act} ${row.venue}`;
  const cues = new Set<DancingCue>();
  if (/(^|\W)dj\b/i.test(row.act)) cues.add('dj');
  if (/\b(dance party|dance night|disco|club night|silent disco)\b|club \d\d\+/i.test(t)) cues.add('dance-party');
  if (/\b(theat(er|re)|playhouse|performing arts|showplace|center for the arts|cmpac|boulton|paramount|flagstar|bandshell|amphitheat(er|re))\b/i.test(t)) cues.add('theater');
  if (/\blibrary\b/i.test(t)) cues.add('library');
  if (/\bbrunch\b/i.test(t)) cues.add('brunch');
  if (/\b(fest(ival)?|oktoberfest|octoberfest|fair|car show|block party|street fair)\b/i.test(t)) cues.add('festival');
  if (/\b(beach|park|pk\b|marina|boardwalk|bandshell|lawn)\b/i.test(t)) cues.add('outdoor');
  if (/\btribute\b|\bthe music of\b|\bexperience\b|\b(almost|alter|spirit of)\b/i.test(t)) cues.add('tribute');
  if (/\b(acoustic|unplugged|duo|solo)\b/i.test(row.act)) cues.add('acoustic');
  if (/\bjam\b/i.test(row.act)) cues.add('jam');
  const start = row.time ? parseTimes(row.time).start : undefined;
  if (start && Number(start.slice(0, 2)) < 17) cues.add('afternoon');
  return [...cues].sort();
}

export interface IraNormalizeOptions {
  sourceId: string;
  sourceUrl: string;
  registry: Registry;
  /** Venue names (as written on Ira's List) that research found outside Nassau and Suffolk. */
  outsideVenues?: string[] | undefined;
}

const GENERIC_ACTS = /^(dj|live music|live band|band|tba|tbd|music|entertainment)$/i;

/** Gig rows -> candidates. Unknown venues are not published (see reason "venue not researched"). */
export function normalizeIraRows(rows: IraRow[], opts: IraNormalizeOptions): NormalizeResult & { unresearched: { venues: string[]; acts: string[] } } {
  const reg = opts.registry;
  const candidates: Candidate[] = [];
  const skipped: NormalizeResult['skipped'] = [];
  const outOfArea = new Map<string, number>();
  const unVenues = new Set<string>();
  const unActs = new Set<string>();
  const outside = new Set((opts.outsideVenues ?? []).map(normalizeText));
  const dates = rows.map((r) => r.date).sort();
  const sourceName = dates.length ? `Ira's List, week of ${formatDateLong(dates[0]!).replace(/^\w+, /, '')}` : "Ira's List";
  for (const row of rows) {
    const ref = `${weekdayOf(row.date)} list`;
    const label = `${row.date} ${row.act} @ ${row.venue || '?'}`;
    if (NOT_MUSIC_RE.test(row.text)) {
      skipped.push({ reason: 'not live music for dancing (theater, comedy or drag show)', ref: label });
      continue;
    }
    const optedOut = reg.isOptedOut(row.text);
    if (optedOut) {
      skipped.push({ reason: `organizer ${optedOut} opted out`, ref: label });
      continue;
    }
    if (outside.has(normalizeText(row.venue))) {
      outOfArea.set(row.venue, (outOfArea.get(row.venue) ?? 0) + 1);
      continue;
    }
    const venueId = (row.venue && reg.matchVenue(row.venue)) || reg.matchVenue(row.text);
    const venue = venueId ? reg.venues.get(venueId) : undefined;
    if (!venue) {
      unVenues.add(row.venue || row.text);
      skipped.push({ reason: 'venue not researched yet', ref: label });
      continue;
    }
    if (!lookupPlace(venue.town)) {
      outOfArea.set(venue.town, (outOfArea.get(venue.town) ?? 0) + 1);
      continue;
    }
    const performerIds = reg.matchPerformers(row.act).filter((id) => !(venue && reg.performers.get(id)?.name === venue.name));
    const pieces = row.act.split(/\s*\/\s*/).map((p) => p.trim()).filter((p) => p.length >= 2 && !GENERIC_ACTS.test(p));
    for (const p of pieces) if (!reg.matchPerformers(p).length && !reg.matchOrganizer(p)) unActs.add(p);
    const organizerId = reg.matchOrganizer(row.act);
    const cues = cuesFor(row);
    const acts = performerIds.map((id) => reg.performers.get(id)!);
    const onlyDjs = acts.length > 0 && acts.every((a) => a.type === 'dj');
    const category: EventCategory = cues.includes('dance-party') || (cues.includes('dj') && !acts.some((a) => a.type !== 'dj')) || onlyDjs ? 'social-dance' : 'live-music';
    const styles = new Set<string>();
    for (const a of acts) for (const s of a.dancing?.styles ?? []) styles.add(s);
    if (category === 'social-dance' && !styles.size) styles.add('freestyle');
    // A time marked "?" is a guess, so we show "time not listed" instead of a time that may be wrong.
    const times = row.time && !row.timeUnsure ? parseTimes(row.time) : { start: undefined, end: undefined };
    let confidence = 0.75;
    const notes: string[] = [];
    if (!performerIds.length && !organizerId && pieces.length) {
      confidence -= 0.05;
      notes.push(`Band or DJ not researched yet: ${pieces.join(', ')}.`);
    }
    if (row.timeUnsure) notes.push(`Ira's List was not sure of the time (${row.time}?), so no time is shown.`);
    const actNames = acts.length ? acts.map((a) => a.name) : pieces.length ? pieces : [];
    const who = actNames.length ? listWords(actNames) : cues.includes('dj') ? 'a DJ' : 'live music';
    const where = venue.name;
    const title = category === 'social-dance' ? `Dance party${actNames.length ? ` with ${listWords(actNames)}` : ''} at ${where}` : `${actNames.length ? listWords(actNames) : 'Live music'} at ${where}`;
    const kind = category === 'social-dance' ? `A dance party${actNames.length ? ` with ${who}` : ''}` : `Live music by ${who}`;
    const summary = `${kind} at ${where} in ${venue.town}. Listed on Ira's List. Times and lineups change, so check with the venue before you go.`;
    const key = [opts.sourceId, row.date, venueId, slugify(row.act || 'music', 40)].join('|');
    candidates.push({
      sourceId: opts.sourceId,
      sourceUrl: opts.sourceUrl,
      sourceName,
      sourceRef: ref,
      date: row.date,
      start: times.start,
      end: times.end,
      category,
      danceStyles: [...styles].sort(),
      venueId,
      town: venue.town,
      organizerId,
      performerIds,
      instructorIds: [],
      skillLevel: 'all-levels',
      title: title.slice(0, 120),
      summary: summary.length > 320 ? `${kind} at ${where}. Check with the venue before you go.`.slice(0, 320) : summary,
      seriesTitle: title.slice(0, 120),
      seriesSummary: summary.slice(0, 320),
      dancingCues: cues,
      confidence,
      reviewNotes: notes,
      seriesKey: key,
      oneOff: true,
    });
  }
  return {
    candidates,
    found: rows.length,
    outOfArea: [...outOfArea].map(([town, count]) => ({ town, count })).sort((a, b) => b.count - a.count),
    skipped,
    coverage: dates.length ? { from: dates[0]!, to: dates.at(-1)! } : undefined,
    unresearched: { venues: [...unVenues].sort(), acts: [...unActs].sort() },
  };
}

function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

export const adapter: Adapter = {
  id: 'iraslist',
  async fetch(ctx: AdapterContext): Promise<FetchedDocument[]> {
    const r = await ctx.fetcher.get(ctx.source.url, ctx.source.rateLimitSeconds);
    return [{ url: ctx.source.url, file: r.file, contentType: r.contentType, meta: {} }];
  },
  async normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult> {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(docs[0]!.file, 'utf8');
    const rows = parseWeeklyList(html, ctx.today);
    if (!rows.length) throw new Error('No gigs found in the "THIS WEEK" list. The page layout may have changed.');
    const outside = (await import('../data/outside-venues.json', { with: { type: 'json' } })).default as { iraslist: string[] };
    const r = normalizeIraRows(rows, { sourceId: ctx.source.id, sourceUrl: ctx.source.url, registry: ctx.registry, outsideVenues: outside.iraslist });
    ctx.log(`${rows.length} gigs listed; ${r.candidates.length} at researched Nassau/Suffolk venues`);
    if (r.unresearched.venues.length) ctx.log(`Venues to research: ${r.unresearched.venues.join('; ')}`);
    if (r.unresearched.acts.length) ctx.log(`Bands/DJs to research: ${r.unresearched.acts.join('; ')}`);
    return r;
  },
};
