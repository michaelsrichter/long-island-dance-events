/**
 * Ira's List (iraslistli.com): a weekly list of live bands and DJs at Long Island bars, restaurants, parks
 * and theaters, published as plain text on the home page ("THIS WEEK"), one line per gig:
 *   SATURDAY 10/3
 *   SPONSORS
 *   -📌Faces for Radio-Nutty Irishman 🇮🇪 (Ira'sList Sponsored Venue)
 *   OTHERS
 *   -Nitework-Cooperage Inn 1-5p
 *
 * Since October 2026 Ira's List also publishes its listings as a public Google Calendar, which has exact
 * times and street addresses for weeks ahead. We read its public iCal feed (see isPublishedCalendarFeed in
 * ingest/lib/fetch.ts) and fall back to the home-page list if the feed cannot be read.
 *
 * fetch():     the public calendar feed (feedUrl), else the home page (robots.txt allows it; cached).
 * normalize(): split each line into act, venue and time; match venues and bands we have researched; keep
 *              Nassau/Suffolk venues only. Gigs at venues nobody has researched yet are reported, not
 *              published, so a person can look the venue up first. Theater shows, comedy and drag brunches
 *              are skipped: they are not live music for dancing.
 * The "live calendar" widget on the home page loads from a third-party host that blocks robots; we do not use it.
 */
import type { EventCategory } from '../../src/lib/schemas';
import { formatDateLong, weekdayOf } from '../../src/lib/time';
import { lookupPlace, type Registry } from '../lib/registry';
import { normalizeText, slugify } from '../lib/text';
import { cuesFor } from '../lib/cues';
import { stripTags } from '../lib/html';
import { parseTimes } from '../lib/times';
import { CANCELLED_TITLE, cleanVenueName, compactName, findPlaceInText, findVenue, hasStreetAddress, idFrom, titleActOk, tidyTitleAct } from '../lib/structured';
import { styleTitle } from '../lib/describe';
import { foundFromIcs } from './ical';
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
  /** From the calendar feed: start and end as local New York times ('YYYY-MM-DDTHH:mm'). */
  start?: string | undefined;
  end?: string | undefined;
  /** From the calendar feed: the event's location (name, street address, town). */
  locationName?: string | undefined;
  address?: string | undefined;
  locality?: string | undefined;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', zwj: '', zwnj: '', shy: '', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export { stripTags };

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

const DAY_RE = /^(MON|TUES?|WED(?:NES|S)?|THU(?:RS?)?|FRI|SAT(?:UR)?|SUN)(?:DAY)?\.?,?\s+(\d{1,2})\s*\/\s*(\d{1,2})\b/i;
const WEEKDAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}]/gu;
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
      // "MON 10/5" must be a Monday; a heading that does not match its date is skipped, not guessed.
      if (WEEKDAY_ABBR[new Date(`${date}T12:00:00Z`).getUTCDay()] !== d[1]!.slice(0, 3).toLowerCase()) date = undefined;
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

/** Days ahead read from the calendar feed (the home-page list only covers one week). */
export const FEED_DAYS = 60;

/** Gigs from Ira's List's public calendar feed: exact times and, for most gigs, the venue's street address. */
export function rowsFromIcs(raw: string, today: string, feedUrl: string, days = FEED_DAYS): IraRow[] {
  const rows: IraRow[] = [];
  const seen = new Set<string>();
  for (const f of foundFromIcs(raw, feedUrl, today, days)) {
    if (f.cancelled) continue;
    const e = parseEntry(f.title);
    if (!e) continue;
    const date = f.start.slice(0, 10);
    const key = `${date}|${normalizeText(e.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hasTime = f.start.length > 10;
    rows.push({
      ...e,
      date,
      // The feed's own start time is better than one written in the title.
      time: hasTime ? undefined : e.time,
      timeUnsure: hasTime ? undefined : e.timeUnsure,
      start: hasTime ? f.start : undefined,
      end: hasTime && f.end && f.end.length > 10 ? f.end : undefined,
      locationName: f.locationName?.replace(/^[\s\-–—|]+/, '').trim() || undefined,
      address: f.address,
      locality: f.locality,
    });
  }
  return rows.sort((a, b) => (a.start ?? a.date).localeCompare(b.start ?? b.date));
}
/** Shows that are not live music for dancing (theater, comedy, drag brunch, trivia). */
const NOT_MUSIC_RE = /\b(the musical|musical\b|comedy|comedian|stand[- ]up|magician|magic show|drag (brunch|show)|trivia|bingo|kara[- ]?ok[ei]{1,2}|karoake|karoke|paint (and|&) sip|book (talk|signing)|picture show|movie night|film screening)\b/i;

export { cuesFor };

export interface IraNormalizeOptions {
  sourceId: string;
  sourceUrl: string;
  registry: Registry;
  /** Venue names (as written on Ira's List) that research found outside Nassau and Suffolk. */
  outsideVenues?: string[] | undefined;
}

// "DJ Friday's" is a weekly DJ night, not a DJ's name.
const GENERIC_ACTS = /^(dj|live music|live band|band|tba|tbd|music|entertainment|dj (?:mon|tues|wednes|thurs|fri|satur|sun)day'?s?)$/i;

/**
 * Act names as the calendar writes them can carry dates and extras: "American Ride: A Tribute to Toby Keith
 * on Saturday, Oct. 17th", "Half Step Halloween Costume Contest and Dance Party!", "Disco Unlimited Ticketed Event".
 * Keep the act's own name.
 */
export function cleanAct(s: string): string {
  const out = s
    .replace(/\s+on\s+(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b.*$/i, '')
    .replace(/[,\s]+(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\.?,?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d.*$/i, '')
    .replace(/\s+(?:ticketed event|tickets? (?:on sale|required|available)|sold out)\b.*$/i, '')
    .replace(/\s+(?:halloween|christmas|holiday|new year'?s(?: eve)?|thanksgiving)\s+(?:costume contest|party|bash|show|spectacular|spooktacular)\b.*$/i, '')
    .replace(/[\s!.,;:-]+$/, '')
    .trim();
  return out.length >= 2 ? out : s.trim();
}

/** Words that turn a style's name into a dance night: "Salsa Night", "Line Dancing", "Hustle Wednesdays", "Salsa Night w/". */
const DANCE_WORDS = /\b(dance|dances|dancing|night|nights|nite|party|social|lessons?|class(?:es)?|workshop|weekly|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|and|the|w|with)\b/g;

/**
 * Short all-caps style aliases ("WCS", "ECS"). Ira's List is a live-music calendar, where these are band
 * names: "WCS" is the cover band Worst Case Scenario, not West Coast Swing. Only spelled-out names count here.
 */
const ABBREVIATION = /^[A-Z0-9]{2,4}$/;

/** A band written as its initials ("WCS" for Worst Case Scenario); the shared title check rejects all-caps words. */
const BAND_INITIALS = /^(?!(?:DJ|DJS|TBA|TBD|LIVE|FREE|OPEN|NEW|SOLD|BAND|NYE|BBQ|RSVP|VIP|LI|NY|NYC)$)[A-Z][A-Z0-9]{1,4}$/;

/** Style words that are also everyday words in band names ("Swing 26 Jazz Band", "The Rhythm Kings", "Smooth Operators"). */
const LOOSE_STYLE_WORDS = new Set(['swing', 'rhythm', 'smooth', 'standard', 'standards', 'latin', 'blues', 'fusion', 'west coast', 'jive', 'samba', 'mambo', 'bolero', 'lindy', 'waltz', 'kiz']);

/** A style's spelled-out names (no abbreviations), optionally without everyday band-name words. */
function spelledAliases(reg: Registry, skipLoose: boolean): { id: string; a: string }[] {
  return [...reg.styles]
    .flatMap(([id, s]) => [s.name, ...s.aliases].filter((a) => !ABBREVIATION.test(a.trim())).map((a) => ({ id, a: normalizeText(a) })))
    .filter((x) => x.a && !(skipLoose && LOOSE_STYLE_WORDS.has(x.a)))
    .sort((x, y) => y.a.length - x.a.length);
}

/** Styles the text names with a spelled-out name ("West Coast Swing", "Salsa"), never by initials alone. */
function stylesIn(reg: Registry, text: string, skipLoose: boolean): string[] {
  const norm = ` ${normalizeText(text)} `;
  const named = new Set(spelledAliases(reg, skipLoose).filter((x) => norm.includes(` ${x.a} `)).map((x) => x.id));
  return reg.matchStyles(text).filter((id) => named.has(id) || ((id === 'argentine-tango' || id === 'ballroom') && / tango /.test(norm)));
}

/**
 * Styles that a piece of act text names on its own ("Salsa Night", "Swing Dance", "West Coast Swing"). A band
 * whose name contains a style word ("Swing 26 Jazz Band", "The Rhythm Kings") or is a set of initials ("WCS")
 * names no style: the band is the act.
 */
export function styleLabel(reg: Registry, text: string): string[] {
  const styles = stylesIn(reg, text, false);
  if (!styles.length) return [];
  let rest = ` ${normalizeText(text)} `;
  for (const { a } of spelledAliases(reg, false)) rest = rest.split(` ${a} `).join('  ');
  return /[a-z0-9]/.test(rest.replace(DANCE_WORDS, ' ')) ? [] : styles;
}

/** Styles in a band's or event's own name, counting only words that mean a dance ("Salsa Kings", "Hustle Wednesdays"). */
function styleHints(reg: Registry, text: string): string[] {
  return stylesIn(reg, text, true);
}

/**
 * Act text -> the styles it names, the act pieces, and styles hinted by an act's own name. "Salsa Night" is a
 * style; "Swing Dance with The Flipped Fedoras" is a style and an act; "Swing 26 Jazz Band" and "WCS Unplugged"
 * are only acts.
 */
function splitStylesAndActs(reg: Registry, actText: string): { named: string[]; parts: string[]; hinted: string[] } {
  const named: string[] = [];
  const parts: string[] = [];
  for (const raw of actText.split(/\s*\/\s*/)) {
    // "Halloween bash ft/ DJ Rez" splits into "Halloween bash ft" and "DJ Rez".
    const p = raw.trim().replace(/\s+(?:with|w|featuring|feat\.?|ft\.?|and|&)$/i, '');
    const whole = styleLabel(reg, p);
    if (whole.length) {
      named.push(...whole);
      continue;
    }
    const m = /^(.+?)\s+(?:with|featuring|feat\.?|ft\.?)\s+(.+)$/i.exec(p);
    const head = m ? styleLabel(reg, m[1]!) : [];
    if (head.length) {
      named.push(...head);
      parts.push(m![2]!);
      continue;
    }
    parts.push(p);
  }
  return { named: [...new Set(named)], parts, hinted: [...new Set(parts.flatMap((p) => styleHints(reg, p)))] };
}

/** Similar names ("Mackenzie Reilly" / "Makenzie Reilly"): Dice coefficient on letter pairs. */
function similar(a: string, b: string): boolean {
  const x = compactName(a);
  const y = compactName(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const pairs = (s: string) => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  const px = pairs(x);
  const py = pairs(y);
  let hits = 0;
  const pool = [...py];
  for (const p of px) {
    const i = pool.indexOf(p);
    if (i >= 0) {
      hits++;
      pool.splice(i, 1);
    }
  }
  return (2 * hits) / (px.length + py.length) >= 0.75;
}

/** Gig rows -> candidates. Unknown venues are not published (see reason "venue not researched"). */
export function normalizeIraRows(rows: IraRow[], opts: IraNormalizeOptions): NormalizeResult & { unresearched: { venues: string[]; acts: string[] } } {
  const reg = opts.registry;
  const candidates: Candidate[] = [];
  const skipped: NormalizeResult['skipped'] = [];
  const outOfArea = new Map<string, number>();
  const unVenues = new Set<string>();
  const unActs = new Set<string>();
  const outside = new Set((opts.outsideVenues ?? []).map(normalizeText));
  /** Gigs already kept, per date + venue + start time (the calendar sometimes lists one gig twice with a typo). */
  const placed = new Map<string, string[]>();
  const dates = rows.map((r) => r.date).sort();
  const fromFeed = rows.some((r) => r.start || r.locationName || r.address);
  const sourceName = fromFeed ? "Ira's List calendar" : dates.length ? `Ira's List, week of ${formatDateLong(dates[0]!).replace(/^\w+, /, '')}` : "Ira's List";
  for (const row of rows) {
    const ref = fromFeed ? 'calendar' : `${weekdayOf(row.date)} list`;
    const label = `${row.date} ${row.act} @ ${row.venue || '?'}`;
    if (CANCELLED_TITLE.test(row.text)) {
      skipped.push({ reason: 'cancelled by the source', ref: label });
      continue;
    }
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
    // The calendar feed gives the location: a town outside Nassau/Suffolk is out of area.
    const feedPlace = row.locality ? lookupPlace(row.locality) : row.address ? findPlaceInText(row.address) : undefined;
    if (row.locality && !feedPlace) {
      outOfArea.set(row.locality, (outOfArea.get(row.locality) ?? 0) + 1);
      continue;
    }
    // A place name, not a house number ("3490") or an address.
    const okName = (n: string | undefined) => (n && /[A-Za-z]{3}/.test(n) && !/^\d+\b/.test(n) ? n : undefined);
    const locName = okName(cleanVenueName(row.locationName));
    let venueId = locName || row.address ? findVenue(reg, locName ?? row.venue, row.address, feedPlace?.name) : undefined;
    venueId ??= (row.venue && reg.matchVenue(row.venue)) || reg.matchVenue(row.text);
    let newVenue = false;
    // A venue we have no file for is added only when the feed gives its street address in a Long Island
    // town (never invented); it gets a review note. Without an address the gig is reported, not published.
    const name = locName ?? okName(cleanVenueName(row.venue));
    if (!venueId && name && name.length <= 80 && hasStreetAddress(row.address) && feedPlace) {
      const id = idFrom(`${name} ${feedPlace.name}`);
      if (!reg.venues.has(id)) {
        reg.venues.set(id, {
          name,
          aliases: [],
          address: row.address.split(',')[0]!.trim(),
          town: feedPlace.name,
          county: feedPlace.county,
          state: 'NY',
          reviewNotes: "Added automatically from Ira's List's calendar. Check the name and address; research the dance floor.",
        } as never);
        reg.created.venues.add(id);
      }
      venueId = id;
      newVenue = true;
    }
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
    const performerIds = reg.matchPerformers(cleanAct(row.act).replace(/\s+(?:at|@)\s+.+$/i, '')).filter((id) => !(venue && reg.performers.get(id)?.name === venue.name));
    // "89 North - See Venue for Details": the venue's own name is not an act.
    // "WCS at Johnny McGoreys": drop the venue's name from the act text.
    const venueNames = [venue.name, ...((venue as { aliases?: string[] }).aliases ?? []), row.venue, row.locationName ?? ''].map(compactName).filter((n) => n.length >= 4);
    const actText = cleanAct(row.act).replace(/\s+(?:at|@)\s+(.+)$/i, (m, place: string) => (venueNames.some((n) => compactName(place).startsWith(n.slice(0, 8)) || n.startsWith(compactName(place).slice(0, 8))) ? '' : m));
    const { named: namedStyles, parts, hinted } = splitStylesAndActs(reg, actText);
    const pieces = parts.map((p) => tidyTitleAct(p.trim())).filter((p) => p.length >= 2 && !GENERIC_ACTS.test(p) && reg.matchVenue(p) !== venueId && (titleActOk(p) || BAND_INITIALS.test(p)));
    for (const p of pieces) if (!reg.matchPerformers(p).length && !reg.matchOrganizer(p)) unActs.add(p);
    const organizerId = reg.matchOrganizer(row.act);
    const cues = cuesFor(row);
    const acts = performerIds.map((id) => reg.performers.get(id)!);
    const onlyDjs = acts.length > 0 && acts.every((a) => a.type === 'dj');
    const category: EventCategory = cues.includes('dance-party') || (cues.includes('dj') && !acts.some((a) => a.type !== 'dj')) || onlyDjs ? 'social-dance' : 'live-music';
    const styles = new Set<string>();
    for (const a of acts) for (const s of a.dancing?.styles ?? []) styles.add(s);
    // Styles named in the act text ("Salsa Night", "Hustle Wednesdays"), never by the venue's name, an everyday
    // word in a band's name ("Swing 26 Jazz Band") or initials ("WCS" is a band on Ira's List).
    for (const s of [...namedStyles, ...hinted]) styles.add(s);
    if (category === 'social-dance' && !styles.size) styles.add('freestyle');
    // A time marked "?" is a guess, so we show "time not listed" instead of a time that may be wrong.
    const times = row.start
      ? { start: row.start.slice(11, 16), end: row.end ? row.end.slice(11, 16) : undefined }
      : row.time && !row.timeUnsure ? parseTimes(row.time) : { start: undefined, end: undefined };
    let confidence = 0.75;
    const notes: string[] = [];
    if (!performerIds.length && !organizerId && pieces.length) {
      confidence -= 0.05;
      notes.push(`Band or DJ not researched yet: ${pieces.join(', ')}.`);
    }
    if (newVenue) notes.push('New venue was added automatically. Check it.');
    if (row.timeUnsure) notes.push(`Ira's List was not sure of the time (${row.time}?), so no time is shown.`);
    const actNames = acts.length ? acts.map((a) => a.name) : pieces.length ? pieces : [];
    const who = actNames.length ? listWords(actNames) : cues.includes('dj') ? 'a DJ' : 'live music';
    const where = venue.name;
    const styleName = namedStyles.length ? styleTitle(namedStyles) : '';
    const actSaysParty = actNames.some((a) => /\b(dance )?party\b/i.test(a));
    const title = category === 'social-dance' && actSaysParty ? `${listWords(actNames)} at ${where}` : category === 'social-dance' ? `${styleName ? `${styleName} dance party` : 'Dance party'}${actNames.length ? ` with ${listWords(actNames)}` : ''} at ${where}` : actNames.length ? `${listWords(actNames)} at ${where}` : styleName ? `${styleName} dance with live music at ${where}` : `Live music at ${where}`;
    const kind = category === 'social-dance' ? `A dance party${actNames.length ? ` with ${who}` : ''}` : `Live music by ${who}`;
    const summary = `${kind} at ${where} in ${venue.town}. Listed on Ira's List. Times and lineups change, so check with the venue before you go.`;
    const slot = `${row.date}|${venueId}|${times.start ?? ''}`;
    const actKey = actNames.join(' ') || row.act;
    if ((placed.get(slot) ?? []).some((a) => similar(a, actKey))) {
      skipped.push({ reason: 'listed twice in the calendar', ref: label });
      continue;
    }
    placed.set(slot, [...(placed.get(slot) ?? []), actKey]);
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
    const feedUrl = (ctx.source as { feedUrl?: string }).feedUrl;
    if (feedUrl) {
      try {
        const r = await ctx.fetcher.get(feedUrl, ctx.source.rateLimitSeconds);
        const { readFileSync } = await import('node:fs');
        if (/BEGIN:VCALENDAR/i.test(readFileSync(r.file, 'utf8').slice(0, 2000))) return [{ url: feedUrl, file: r.file, contentType: r.contentType, meta: { kind: 'calendar' } }];
        ctx.log(`${feedUrl} is not a calendar feed; using the home-page list instead.`);
      } catch (e) {
        ctx.log(`Calendar feed could not be read (${(e as Error).message}); using the home-page list instead.`);
      }
    }
    const r = await ctx.fetcher.get(ctx.source.url, ctx.source.rateLimitSeconds);
    return [{ url: ctx.source.url, file: r.file, contentType: r.contentType, meta: {} }];
  },
  async normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult> {
    const { readFileSync } = await import('node:fs');
    const doc = docs[0]!;
    const raw = readFileSync(doc.file, 'utf8');
    const fromFeed = doc.meta.kind === 'calendar';
    const rows = fromFeed ? rowsFromIcs(raw, ctx.today, doc.url) : parseWeeklyList(raw, ctx.today);
    if (!rows.length) throw new Error(fromFeed ? 'The calendar feed has no gigs in the next weeks. It may have stopped being updated.' : 'No gigs found in the "THIS WEEK" list. The page layout may have changed.');
    const outside = (await import('../data/outside-venues.json', { with: { type: 'json' } })).default as { iraslist: string[] };
    const r = normalizeIraRows(rows, { sourceId: ctx.source.id, sourceUrl: fromFeed ? ctx.source.url : ctx.source.url, registry: ctx.registry, outsideVenues: outside.iraslist });
    ctx.log(`${rows.length} gigs listed (${fromFeed ? 'calendar feed' : 'home-page list'}); ${r.candidates.length} at Nassau/Suffolk venues`);
    if (r.unresearched.venues.length) ctx.log(`Venues to research: ${r.unresearched.venues.join('; ')}`);
    if (r.unresearched.acts.length) ctx.log(`Bands/DJs to research: ${r.unresearched.acts.join('; ')}`);
    return r;
  },
};