/**
 * Shared step for the generic adapters (JSON-LD, iCal, HTML lists): turn neutral "found events"
 * into dated Candidates the pipeline understands. It reuses the registry matching, the plain-language
 * title/summary writer (describe.ts) and the time and price parsers, so every adapter writes the
 * same kind of record in our own words.
 *
 * Settings come from the source registry file (src/content/sources/<id>.json):
 *   focus     'dance' (dance calendars, clubs, studios) or 'music' (bars, venues, bands)
 *   defaults  facts used when a listing does not say them: venueId, town, organizerId,
 *             performerIds, danceStyles, category. A defaults.venueId or performer id that is not
 *             in the registry yet is added automatically (named after the source) for an editor to check.
 *   include / exclude  case-insensitive regular expressions on the listing text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventCategory, SkillLevel } from '../../src/lib/schemas';
import { addDays, weekdayOf } from '../../src/lib/time';
import { cuesFor, stripTags } from '../adapters/iraslist';
import { makeSummary, makeTitle, themeOf, type DescribeInput } from './describe';
import { parsePrices } from './prices';
import { lookupPlace, ROOT, type Place, type Registry } from './registry';
import { cleanListingText, normalizeText, slugify } from './text';
import { findTimes, parseTimes } from './times';
import type { AdapterContext, Candidate, NormalizeResult } from './types';

/** One event as a source describes it, before we match it to our registries. */
export interface FoundEvent {
  title: string;
  description?: string | undefined;
  /** Local New York time: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
  start: string;
  end?: string | undefined;
  locationName?: string | undefined;
  /** Street address, if the source gives one. */
  address?: string | undefined;
  /** Town, village or hamlet. */
  locality?: string | undefined;
  /** Event page (used as the "more info" link). */
  url?: string | undefined;
  price?: number | undefined;
  priceMax?: number | undefined;
  isFree?: boolean | undefined;
  priceText?: string | undefined;
  performers?: string[] | undefined;
  organizerName?: string | undefined;
  cancelled?: boolean | undefined;
  /** Where in the source, e.g. "feed item", "event page". */
  ref?: string | undefined;
  /** Page or feed the event came from (attribution link). */
  pageUrl: string;
  notes?: string[] | undefined;
}

export interface SourceDefaults {
  venueId?: string | undefined;
  town?: string | undefined;
  organizerId?: string | undefined;
  performerIds?: string[] | undefined;
  danceStyles?: string[] | undefined;
  category?: EventCategory | undefined;
}

/** Registry fields the generic adapters read (added to the source schema for these adapters). */
export type SourceSettings = AdapterContext['source'] & {
  focus?: 'dance' | 'music' | undefined;
  feedUrl?: string | undefined;
  pageUrls?: string[] | undefined;
  defaults?: SourceDefaults | undefined;
  include?: string | undefined;
  exclude?: string | undefined;
};

export const settingsOf = (ctx: AdapterContext): SourceSettings => ctx.source as SourceSettings;

export interface ToCandidatesOptions {
  /** Days ahead to keep (default 180). */
  horizonDays?: number;
  /** True for feeds and built-in event data (higher starting confidence). */
  structured?: boolean;
}

const placesFile = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'long-island-places.json'), 'utf8')) as {
  places: { name: string; county: string }[];
  aliases: Record<string, string>;
};
/** Long Island place names, longest first, for spotting a town inside free text. */
const PLACE_NAMES = [...placesFile.places.map((p) => p.name), ...Object.keys(placesFile.aliases)]
  .filter((n) => n.length >= 4)
  .sort((a, b) => b.length - a.length);
/** Place names that are also common words or first names: only trusted when followed by "NY". */
const AMBIGUOUS = new Set(['oak beach', 'shirley', 'ridge', 'springs', 'orient', 'riverside', 'lawrence', 'baldwin', 'elwood', 'inwood', 'flanders', 'medford', 'centre', 'center', 'south']);
const OTHER_STATE = /^ (nj|ct|pa|ca|tn|fl|ma|me|vt|nh|ri|de|md|va|nc|sc|ga|tx|oh|mi|il|new jersey|connecticut|pennsylvania)\b/;

/** Find the first Long Island town named in the text ("... Salt Shack, Babylon NY"). */
export function findPlaceInText(text: string): Place | undefined {
  const norm = ` ${normalizeText(text)} `;
  let best: { place: Place; index: number } | undefined;
  for (const name of PLACE_NAMES) {
    const n = normalizeText(name);
    let i = norm.indexOf(` ${n} `);
    while (i >= 0) {
      const after = norm.slice(i + n.length + 1);
      const ok = !OTHER_STATE.test(after) && (!AMBIGUOUS.has(n) || /^ (ny|new york)\b/.test(after));
      if (ok) {
        const place = lookupPlace(name);
        if (place && (!best || i < best.index)) best = { place, index: i };
        break;
      }
      i = norm.indexOf(` ${n} `, i + 1);
    }
  }
  return best?.place;
}

/** "Daisy's (Miller Place) - live music calendar" -> "Daisy's". */
export function entityNameFromSource(name: string): string {
  return name.split(/\s+[-–—|]\s+/)[0]!.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

const NON_EVENT = /\b(closed|private (?:party|event)|trivia|bingo|karaoke|comedy|paint (?:and|&) sip|yoga|gift cards?|holiday hours|now hiring)\b/i;
const FESTIVAL = /\b(festival|fest\b|dance weekend|congress|dance camp|marathon)\b/i;
const CLASS = /\b(class(?:es)?|lessons?|workshops?|boot ?camp|instruction)\b/i;
const SOCIAL = /\b(social|dance party|dance night|milonga|practica|open dancing|dancing to)\b/i;
const LIVE = /\b(live (?:music|band|entertainment)|band\b|concert|tribute|orchestra|in concert|acoustic|performs|on stage)\b/i;

function categoryOf(text: string, focus: 'dance' | 'music', liveActs: number, djs: number, fallback?: EventCategory): EventCategory {
  if (fallback) return fallback;
  if (focus === 'music' && liveActs > 0 && !CLASS.test(text)) return 'live-music';
  if (FESTIVAL.test(text)) return 'festival';
  const classy = CLASS.test(text.replace(/private lessons?/gi, ''));
  if (classy && SOCIAL.test(text)) return 'lesson-party';
  if (classy) return 'class-lesson';
  if (liveActs > 0 || LIVE.test(text)) return 'live-music';
  if (djs > 0) return 'social-dance';
  return focus === 'music' ? 'live-music' : 'social-dance';
}

function skillOf(text: string, category: EventCategory): SkillLevel {
  if (category !== 'class-lesson') return 'all-levels';
  const t = text.toLowerCase();
  const levels = new Set<string>();
  if (/\b(beginners?|newcomers?|novice|basic)\b/.test(t)) levels.add('beginner');
  if (/\bintermediate\b/.test(t)) levels.add('intermediate');
  if (/\badvanced\b/.test(t)) levels.add('advanced');
  if (levels.size === 1) return [...levels][0] as SkillLevel;
  return levels.size > 1 ? 'mixed' : 'all-levels';
}

const timeOf = (local: string | undefined) => (local && local.length >= 16 ? local.slice(11, 16) : undefined);

const ACT_PREFIX = /^(?:live (?:music|band|entertainment)(?: with| by| featuring)?|(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day |happy hour |live |house )?band|featuring|presents?|tonight|appearing|on stage|music by)\s*[:\-–—]?\s*/i;
const NOT_AN_ACT =
  /\b(closed|private|trivia|bingo|karaoke|comedy|brunch|happy hour$|specials?|menu|tickets?|sold out|doors|free|admission|reservations?|open mic|open jam|jam session|dinner|buffet|cover charge|21\+|all ages|read more|more info|learn more|details|info|view|rsvp|book now|register|register now|just announced|coming soon|starting|start date|end date|date|time|location|venue|price|cost|tba|tbd|to be announced|presents|night|nights|festival|fest|fair|carnival|party|club|noche|social|bash|celebration|parade|market|halloween|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;
const CALENDAR_WORD = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$|^(?:today|tomorrow|tonight|weekly|daily|book|event|events|show|shows|music|live music|dance|dancing|party|dj|band|night)$/i;

/** Band or DJ name in a venue listing ("Happy Hour Band: Calm Coast 6-10pm" -> "Calm Coast"). */
export function actName(text: string): string | undefined {
  let s = text;
  for (const t of findTimes(s).sort((a, b) => b.index - a.index)) s = s.slice(0, t.index) + s.slice(t.index + t.length);
  s = s.replace(/\$\s?\d+(?:\.\d{2})?/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  s = s.split(/\s+[|@•·]\s+|\s+[-–—]\s+|\s+at\s+(?=[A-Z])/)[0]!;
  const withAct = /\b(?:with|featuring|feat\.?|ft\.?)\s+([A-Z0-9].*)$/.exec(s);
  if (withAct) s = withAct[1]!;
  s = s.replace(/^[\s,.;:!"“”]+/, '').replace(ACT_PREFIX, '').replace(/[,.;:!?"“”\s]+$/, '').replace(/^[,.;:!"“”\s]+/, '').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 50 || !/[A-Za-z]{2}/.test(s) || NOT_AN_ACT.test(s) || CALENDAR_WORD.test(s)) return undefined;
  if (s.split(' ').length > 7 || /[!?]/.test(s)) return undefined;
  return s;
}

function findPerformer(reg: Registry, name: string): string | undefined {
  const n = normalizeText(name);
  for (const [id, p] of reg.performers) if ([p.name, ...p.aliases].some((a) => normalizeText(a) === n)) return id;
  return undefined;
}

/** "LEGENDARY MURPHYS" -> "Legendary Murphys" (short tokens such as DJ, EDM, AC/DC stay as they are). */
export function tidyName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean !== clean.toUpperCase() || !/[A-Z]{4}/.test(clean)) return clean;
  return clean
    .split(' ')
    .map((w) => (w.length <= 3 && /^[A-Z0-9&/+.'-]+$/.test(w) && !/^(THE|AND|OF|AT|ON|IN|BY)$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Match a band/DJ name, or add it to the registry for an editor to check. */
export function ensurePerformer(reg: Registry, name: string, sourceName: string, id = slugify(name, 60)): string | undefined {
  const clean = tidyName(name);
  if (clean.length < 2 || clean.length > 60) return undefined;
  const known = reg.performers.has(id) ? id : findPerformer(reg, clean);
  if (known) return known;
  reg.performers.set(id, {
    name: clean,
    type: /^dj\b/i.test(clean) ? 'dj' : 'band',
    aliases: [],
    genres: [],
    reviewNotes: `Added automatically from ${sourceName}. Check the name and add a website or social page.`,
  });
  reg.created.performers.add(id);
  return id;
}

/** The source's own venue (defaults.venueId): use it, or add it named after the source. */
function ensureDefaultVenue(reg: Registry, id: string, sourceName: string, town: Place | undefined): string | undefined {
  if (reg.venues.has(id)) return id;
  if (!town) return undefined;
  reg.venues.set(id, {
    name: entityNameFromSource(sourceName),
    aliases: [],
    address: '',
    town: town.name,
    county: town.county,
    state: 'NY',
    reviewNotes: `Added automatically for the source "${sourceName}". Add the street address, then geocode.`,
  });
  reg.created.venues.add(id);
  return id;
}

function townOfVenue(reg: Registry, venueId: string | undefined): Place | undefined {
  const v = venueId ? reg.venues.get(venueId) : undefined;
  return v ? lookupPlace(v.town) : undefined;
}

function regexOrUndefined(s: string | undefined): RegExp | undefined {
  if (!s) return undefined;
  try {
    return new RegExp(s, 'i');
  } catch {
    return undefined;
  }
}

/** Convert found events into dated candidates for the merge step. */
export function toCandidates(found: FoundEvent[], ctx: AdapterContext, opts: ToCandidatesOptions = {}): NormalizeResult {
  const reg = ctx.registry;
  const src = settingsOf(ctx);
  const focus = src.focus ?? 'dance';
  const defaults: SourceDefaults = src.defaults ?? {};
  const include = regexOrUndefined(src.include);
  const exclude = regexOrUndefined(src.exclude);
  const horizon = addDays(ctx.today, opts.horizonDays ?? 180);
  const candidates: Candidate[] = [];
  const outOfArea = new Map<string, number>();
  const skipped: NormalizeResult['skipped'] = [];
  const seen = new Set<string>();
  let last = ctx.today;

  const defaultTown = lookupPlace(defaults.town) ?? townOfVenue(reg, defaults.venueId);
  const defaultVenue = defaults.venueId ? ensureDefaultVenue(reg, defaults.venueId, src.name, defaultTown) : undefined;
  const defaultPerformers = (defaults.performerIds ?? [])
    .map((pid) => (reg.performers.has(pid) ? pid : ensurePerformer(reg, entityNameFromSource(src.name), src.name, pid)))
    .filter((x): x is string => Boolean(x));

  for (const f of found) {
    const date = f.start.slice(0, 10);
    const ref = `${f.ref ?? 'listing'} ${date}`;
    const text = cleanListingText([f.title, f.description, f.locationName, f.address, f.locality].filter(Boolean).join('. '));
    const key = `${normalizeText(f.title)}|${f.start}|${normalizeText(f.locationName ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (f.cancelled) {
      skipped.push({ reason: 'cancelled by the source', ref });
      continue;
    }
    if (date < ctx.today || date > horizon) continue;
    if ((include && !include.test(text)) || (exclude && exclude.test(text)) || (!include && NON_EVENT.test(f.title))) {
      skipped.push({ reason: 'not a dance or live-music listing', ref });
      continue;
    }
    const optedOut = reg.isOptedOut(text);
    if (optedOut) {
      skipped.push({ reason: `organizer ${optedOut} opted out`, ref });
      continue;
    }
    const notes = [...(f.notes ?? [])];
    let confidence = opts.structured ? 0.6 : 0.5;

    // Where: the listing's own place first, then the source's default venue or town.
    const ownPlace = lookupPlace(f.locality) ?? (f.address || f.locationName ? findPlaceInText(`${f.locationName ?? ''} ${f.address ?? ''}`) : undefined);
    let venueId: string | undefined;
    let place: Place | undefined = ownPlace;
    if (!ownPlace && f.locality) {
      outOfArea.set(f.locality, (outOfArea.get(f.locality) ?? 0) + 1);
      continue;
    }
    const venueText = [f.locationName, f.address].filter(Boolean).join(' ');
    if (venueText) venueId = reg.matchVenue(venueText, place?.name);
    if (!venueId && defaultVenue && (!ownPlace || ownPlace.name === defaultTown?.name)) {
      venueId = defaultVenue;
      place = defaultTown;
    }
    // A venue we just added for this source has no street address yet: take it from its own page.
    const dv = venueId && venueId === defaultVenue ? reg.venues.get(venueId) : undefined;
    if (dv && !dv.address && f.address && reg.created.venues.has(defaultVenue!)) {
      const town = dv.town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      dv.address = f.address.replace(new RegExp(`\\s*,?\\s*${town}\\b.*$`, 'i'), '').trim() || f.address;
    }
    // Feeds and built-in event data name their venues reliably, so add them even without a street address.
    if (!venueId && f.locationName && (f.address || opts.structured) && place && f.locationName.length <= 80 && !/^(tba|tbd|online|virtual)$/i.test(f.locationName)) {
      const id = slugify(`${f.locationName} ${place.name}`, 60);
      if (!reg.venues.has(id)) {
        reg.venues.set(id, {
          name: f.locationName,
          aliases: [],
          address: f.address ?? '',
          town: place.name,
          county: place.county,
          state: 'NY',
          reviewNotes: `Added automatically from ${src.name}. Check the name${f.address ? ' and address' : ', add the street address'}, then geocode.`,
        });
        reg.created.venues.add(id);
      }
      venueId = id;
      notes.push('New venue was added automatically. Check it.');
    }
    if (!place) place = (venueId ? townOfVenue(reg, venueId) : undefined) ?? findPlaceInText(text) ?? defaultTown;
    if (!place) {
      outOfArea.set('town not stated', (outOfArea.get('town not stated') ?? 0) + 1);
      continue;
    }
    if (venueId) confidence += 0.15;
    else notes.push(f.locationName ? `Venue "${f.locationName.slice(0, 60)}" is not in the registry yet.` : 'Venue not found in the listing.');

    // Who
    const performerIds = [...defaultPerformers];
    const named = f.performers?.length ? f.performers : defaults.venueId && focus === 'music' ? [actName(f.title)].filter((x): x is string => Boolean(x)) : [];
    for (const name of named) {
      if (f.locationName && normalizeText(name) === normalizeText(f.locationName)) continue;
      if (defaultVenue && normalizeText(name) === normalizeText(reg.venues.get(defaultVenue)?.name ?? '')) continue;
      const id = ensurePerformer(reg, name, src.name);
      if (id && !performerIds.includes(id)) performerIds.push(id);
    }
    for (const id of reg.matchPerformers(text)) if (!performerIds.includes(id)) performerIds.push(id);
    const organizerId =
      (defaults.organizerId && reg.organizers.has(defaults.organizerId) ? defaults.organizerId : undefined) ??
      reg.matchOrganizer(text) ??
      (() => {
        const homes = [...reg.organizers].filter(([, o]) => venueId && o.homeVenueId === venueId && !o.optOut);
        return homes.length === 1 ? homes[0]![0] : undefined;
      })();
    const djs = performerIds.filter((id) => reg.performers.get(id)?.type === 'dj');
    const liveActs = performerIds.filter((id) => reg.performers.get(id)?.type !== 'dj');
    let danceStyles = reg.matchStyles(text);
    if (!danceStyles.length && defaults.danceStyles?.length) danceStyles = defaults.danceStyles.filter((s) => reg.styles.has(s));
    if (!danceStyles.length && organizerId && focus === 'dance') danceStyles = reg.organizers.get(organizerId)?.danceStyles ?? [];
    if (danceStyles.length || performerIds.length) confidence += 0.05;

    // What and when
    const category = categoryOf(text, focus, liveActs.length, djs.length, defaults.category);
    const parsed = parseTimes(`${f.title}. ${f.description ?? ''}`);
    const start = timeOf(f.start) ?? parsed.start;
    let end = timeOf(f.end) ?? (timeOf(f.start) ? undefined : parsed.end);
    if (end && f.end && f.end.slice(0, 10) > addDays(date, 1)) end = undefined;
    if (start) confidence += 0.1;
    else {
      confidence -= 0.1;
      notes.push('No start time found.');
    }
    const prices = f.price !== undefined || f.isFree ? { price: f.price, priceMax: f.priceMax, isFree: f.isFree, notes: [] as string[] } : parsePrices(f.priceText ?? f.description ?? '');
    const skillLevel = skillOf(text, category);
    const theme = themeOf(f.title);
    const name = (id: string, m: Map<string, { name: string }>) => m.get(id)?.name ?? id;
    const describe: DescribeInput = {
      category,
      styles: danceStyles,
      theme,
      venueName: venueId ? reg.venues.get(venueId)?.name : undefined,
      djs: djs.map((id) => name(id, reg.performers)),
      liveActs: liveActs.map((id) => name(id, reg.performers)),
      instructors: [],
      lessonTime: parsed.lessonTime,
      schedule: [],
      skillLevel,
      facts: text.toLowerCase(),
    };
    const plain = { ...describe, theme: undefined };
    const venueKey = venueId ?? slugify(place.name);
    // The same listing often appears twice on a page (a list and a calendar grid).
    const dupKey = [date, start ?? '', venueKey, [...performerIds].sort().join('+'), category].join('|');
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    if (date > last) last = date;
    candidates.push({
      sourceId: src.id,
      sourceUrl: f.pageUrl,
      sourceName: src.name,
      sourceRef: ref.slice(0, 120),
      date,
      start,
      end,
      lessonTime: parsed.lessonTime,
      category,
      danceStyles,
      venueId,
      town: place.name,
      organizerId,
      performerIds,
      instructorIds: [],
      price: prices.price,
      priceMax: prices.priceMax,
      isFree: prices.isFree,
      priceNotes: prices.notes.length ? prices.notes.join('. ').slice(0, 160) : undefined,
      skillLevel,
      title: makeTitle(describe),
      summary: makeSummary(describe),
      seriesTitle: makeTitle(plain),
      seriesSummary: makeSummary(plain),
      theme,
      infoUrl: f.url && /^https?:\/\//.test(f.url) ? f.url : undefined,
      dancingCues: cuesFor({
        act: [...liveActs, ...djs].map((id) => name(id, reg.performers)).join(' ') || f.title,
        venue: (venueId ? reg.venues.get(venueId)?.name : f.locationName) ?? '',
        text,
        time: start ? `${Number(start.slice(0, 2)) % 12 || 12}:${start.slice(3, 5)}${Number(start.slice(0, 2)) < 12 ? 'am' : 'pm'}` : undefined,
      }),
      confidence: Math.max(0, Math.min(1, confidence)),
      reviewNotes: notes,
      seriesKey: [src.id, venueKey, organizerId ?? '', weekdayOf(date), start ?? 'tba', category, [...performerIds].sort().join('+'), [...danceStyles].sort().join('+')].join('|'),
      oneOff: Boolean(theme),
    });
  }
  return {
    candidates,
    found: found.length,
    outOfArea: [...outOfArea].map(([town, count]) => ({ town, count })).sort((a, b) => b.count - a.count),
    skipped,
    coverage: candidates.length ? { from: ctx.today, to: last } : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Small helpers shared by the adapters

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', middot: '·', bull: '•', ensp: ' ', emsp: ' ', thinsp: ' ' };

/** Decode HTML entities (&amp; &#39; &#x2019; &nbsp; ...). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Page text with line breaks kept at block elements. Scripts, styles and navigation are dropped. */
export function htmlToLines(html: string): string[] {
  const body = html
    .replace(/<!--[\s\S]*?--!?>/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|select)\b[\s\S]*?<\/\1\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|tr|td|th|h[1-6]|section|article|ul|ol|table|dt|dd|time)\b[^>]*>/gi, '\n');
  // Strip tags until none are left, then drop any angle brackets that decoding produced (as in iraslist.ts).
  return decodeEntities(stripTags(body))
    .replace(/[<>]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean);
}

/** Plain text from an HTML fragment (tags removed completely, entities decoded). */
export function plainText(fragment: string): string {
  return decodeEntities(stripTags(fragment)).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Local New York date-time 'YYYY-MM-DDTHH:mm' for an instant. */
export function toNewYork(instant: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** ISO 8601 from a feed ('2026-10-18', '2026-10-18T19:00:00', '...-04:00', '...Z') -> local New York. */
export function isoToLocal(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!m) return undefined;
  if (!m[4]) return `${m[1]}T${m[2]}:${m[3]}`;
  const d = new Date(v.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? undefined : toNewYork(d);
}
