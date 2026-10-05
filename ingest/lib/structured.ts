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
import { cuesFor } from './cues';
import { stripTags } from './html';
import { makeSummary, makeTitle, themeOf, type DescribeInput } from './describe';
import { parsePrices } from './prices';
import { lookupPlace, normalizeAddress, ROOT, type Place, type Registry } from './registry';
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
  /** When the source last changed this listing (iCal LAST-MODIFIED, e.g. '20260912T161134Z'). */
  modified?: string | undefined;
  /** Where in the source, e.g. "feed item", "event page". */
  ref?: string | undefined;
  /** Page or feed the event came from (attribution link). */
  pageUrl: string;
  notes?: string[] | undefined;
  /** A heading right above the listing on the page (often its name, e.g. "Dinner Dance"). */
  heading?: string | undefined;
  /** The page itself is about dancing (its title or main heading names a dance), so each listing on it is one. */
  pageNamesDance?: boolean | undefined;
  /** What the source's own data calls it (schema.org MusicEvent or DanceEvent). */
  kind?: 'music' | 'dance' | undefined;
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

const NON_EVENT = /\b(closed|private (?:party|event)|trivia|bingo|kara[- ]?ok[ei]{1,2}|karoake|karoke|mundy-oke|comedy|comedian|stand-?up|paint (?:and|&) sip|yoga|gift cards?|holiday hours|now hiring|drag (?:brunch|show|bingo|queen)|picture show|screening|film|movie|circus|game show|psychic|medium)\b/i;
/** A title that starts by saying the event is off ("CANCELLED Byrne Unit-Salt Shack", "Postponed: ..."). */
export const CANCELLED_TITLE = /^[^A-Za-z0-9]*(?:cancell?ed|postponed|rained out)\b/i;
/** Food and drink specials: listed only when they also name a band, DJ, live music or dancing. */
const FOOD_OR_DRINK = /\b(happy hour|brunch|prix fixe|supper|prime rib|steak night|wing night|wings|tacos?|lobster|clam ?bake|buffet|dinner special|drink specials?|wine tasting|beer tasting|tasting menu)\b/i;
// Never a dance or live-music listing, even when an aggregator's text mentions "music".
const NEVER_EVENT = /\b(street fair|carnival|craft fair|farmer['’]?s market|flea market|yard sale|car show|vintage pop[- ]?up|pop[- ]?up (?:shop|market)|football|soccer|baseball|hockey|golf outing)\b/i;
const FESTIVAL = /\b(festival|fest\b|dance weekend|congress|dance camp|marathon)\b/i;
// "world-class musicians", "a class act" and leftover HTML (class="...") are not classes.
const CLASS = /(?<!-)\b(class(?:es)?(?![-\w]|\s+act\b|\s*=)|lessons?|workshops?|boot ?camp|instruction)\b/i;
const SOCIAL = /\b(social|dance party|dance night|milonga|practica|open dancing|dancing to|dancing until|dancing (?:from|begins|starts)|dj'?d music|dj music|music (?:&|and) dancing)\b|\d\s*(?:pm)?\s*\/\s*music\b/i;
const LIVE = /\b(live (?:music|band|entertainment)|band\b|concert|tribute|orchestra|in concert|acoustic|performs|on stage)\b/i;

/**
 * Words that say a listing is a dance. Style names that are also music words ("standards",
 * "smooth", "rhythm", "latin", "country") are left out on purpose; "swing" counts unless it is a
 * kind of band or music.
 */
export const DANCE_TEXT =
  /(?<![-\w])(danc(?:e|es|ing|ers?)|ballroom|milongas?|practicas?|sock hop|hoedown|two[- ]?step|2[- ]step|cotillion|tango|bachata|salsa|merengue|hustle|waltz|fox ?trot|quickstep|cha[- ]?cha|rumba|samba|paso doble|kizomba|zouk|lindy(?: hop)?|jitterbug|polka|swing(?!\s+(?:band|music|orchestra|era|jazz)))(?![-\w])/i;
/**
 * Abbreviations that mean a dance only on a dance calendar: "WCS" is West Coast Swing to a dance
 * teacher, but on bar and band calendars it is often the band Worst Case Scenario.
 */
const DANCE_CALENDAR_ABBR = /(?<![-\w])(wcs|ecs)(?![-\w])/i;
/** Words that say a listing has live music or a DJ. */
export const MUSIC_TEXT =
  /(?<![-\w])(live (?:music|band|entertainment|performance)|music by|musicians?|concerts?|bands?|dj|djs|dj_\w+|disc jockey|sings?|singers?|songwriters?|acoustic|jazz|blues|rock|tribute|orchestra|symphony|quartet|trio|duo|ensemble|motown|doo[- ]?wop|bluegrass|reggae|hip[- ]?hop|r&b|funk|accordion|guitar|piano|fiddle|mariachi|polka|open jam|jam session|performs?|performing)(?![-\w])/i;
/** Plain "music" counts on a venue's or band's own calendar, not on calendars of everything ("Halloween music" at a haunted walk). */
const ANY_MUSIC = /(?<![-\w])(music|musical)(?![-\w])/i;

/** Does the text name a dance? A class or lesson counts too, except on calendars that list everything (pottery class). */
export function namesDance(text: string, lessonsCount = true, danceCalendar = false): boolean {
  return DANCE_TEXT.test(text) || (danceCalendar && DANCE_CALENDAR_ABBR.test(text)) || (lessonsCount && CLASS.test(text.replace(/private lessons?/gi, '')));
}

/** Does the text name live music, a DJ, or a band or DJ we know? */
export function namesMusic(text: string, reg: Registry, plainMusicCounts = true): boolean {
  return MUSIC_TEXT.test(text) || (plainMusicCounts && ANY_MUSIC.test(text)) || reg.matchPerformers(text).length > 0;
}

/**
 * Text that says the listing happens somewhere off Long Island ("5th Avenue Manhattan", "in
 * Brooklyn"). Band names like "Manhattan Transfer" do not count: a place word must follow
 * "in", "at", "on" or "down", or be a street in Manhattan.
 */
const OFF_ISLAND =
  /\b(?:in|at|on|down|to)\s+(?:the\s+)?(?:manhattan|brooklyn|queens|the bronx|bronx|staten island|new york city|nyc|westchester|new jersey|connecticut)\b|\b(?:5th|fifth)\s+ave(?:nue)?\.?,?\s+(?:in\s+)?(?:manhattan|new york city|nyc)\b|\bmanhattan,?\s+ny\b/i;

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
  if (/\b(intermediate|int)\b/.test(t)) levels.add('intermediate');
  if (/\b(advanced|adv)\b/.test(t)) levels.add('advanced');
  if (levels.size === 1) return [...levels][0] as SkillLevel;
  return levels.size > 1 ? 'mixed' : 'all-levels';
}

const timeOf = (local: string | undefined) => (local && local.length >= 16 ? local.slice(11, 16) : undefined);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const shiftLocal = (local: string, minutes: number) => new Date(Date.parse(`${local.slice(0, 16)}:00Z`) + minutes * 60000).toISOString().slice(0, 16);

/**
 * Some WordPress feeds treat the venue's clock time as UTC and convert it, so every time comes out
 * 4 or 5 hours early (Huntington Matters: "8:30 AM" in the text, 04:30 in the data). When the time
 * written in the listing is exactly that much later than the feed time, the written time wins.
 */
export function fixShiftedClock(f: FoundEvent): FoundEvent {
  const feed = timeOf(f.start);
  const written = feed ? parseTimes(`${f.title}. ${f.description ?? ''}`).start : undefined;
  if (!feed || !written) return f;
  const diff = (minutesOf(written) - minutesOf(feed) + 1440) % 1440;
  if (diff !== 240 && diff !== 300) return f;
  return { ...f, start: shiftLocal(f.start, diff), end: f.end && f.end.length >= 16 ? shiftLocal(f.end, diff) : f.end };
}

const ACT_PREFIX = /^(?:live (?:music|band|entertainment)(?: with| by| featuring)?|(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day |happy hour |live |house )?band|featuring|presents?|tonight|appearing|on stage|music by)\s*[:\-–—]?\s*/i;
const NOT_AN_ACT =
  /\b(closed|private|trivia|bingo|karaoke|comedy|brunch|happy hour$|specials?|menu|tickets?|sold out|doors|free|admission|reservations?|open mic|open jam|jam session|dinner|buffet|cover charge|21\+|all ages|read more|more info|learn more|details|info|view|rsvp|book now|register|register now|just announced|coming soon|starting|start date|end date|date|time|location|venue|price|cost|tba|tbd|to be announced|presents|night|nights|festival|fest|fair|carnival|party|club|noche|social|bash|celebration|parade|market|halloween|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;
/** "... & food by Rogue Dinner Co.", "with food from Chef Clemente": the caterer, not the act. */
const FOOD_BY = /\s*(?:,|&|\+|\band\b|\bwith\b)?\s*\b(?:food|eats|bites|bbq|barbecue|tacos|pizza|catering)\s+(?:by|from)\s+.*$/i;
const CALENDAR_WORD = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$|^(?:today|tomorrow|tonight|weekly|daily|book|event|events|show|shows|music|live music|dance|dancing|party|dj|band|night)$/i;

/** Band or DJ name in a venue listing ("Happy Hour Band: Calm Coast 6-10pm" -> "Calm Coast"). */
export function actName(text: string): string | undefined {
  let s = text;
  for (const t of findTimes(s).sort((a, b) => b.index - a.index)) if (/\d/.test(s.slice(t.index, t.index + t.length))) s = s.slice(0, t.index) + s.slice(t.index + t.length); // keep words like "Midnight"
  s = s.replace(/\$\s?\d+(?:\.\d{2})?/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  s = s.split(/\s+[|@•·]\s+|\s+[-–—]\s+|\s+at\s+(?=[A-Z])/)[0]!;
  // "HOG Halloween with musical guests Groney & Friends & food by Crossroads Que" -> "Groney & Friends"
  s = s.replace(FOOD_BY, '');
  const withAct = /\b(?:with|featuring|feat\.?|ft\.?)\s+(?:(?:musical|special)\s+guests?\s+|(?:live\s+)?music\s+by\s+)?([A-Z0-9].*)$/.exec(s);
  if (withAct) s = withAct[1]!;
  s = s.replace(/^[\s,.;:!"“”]+/, '').replace(ACT_PREFIX, '').replace(/[,.;:!?"“”\s]+$/, '').replace(/^[,.;:!"“”\s]+/, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+live$/i, ''); // "The Mystic live" -> "The Mystic"
  if (s.length < 3 || s.length > 50 || !/[A-Za-z]{2}/.test(s) || NOT_AN_ACT.test(s) || CALENDAR_WORD.test(s)) return undefined;
  if (s.split(' ').length > 10 || /[!?]/.test(s)) return undefined;
  return s;
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

/** Same name once case, punctuation, spaces and a leading "The" are ignored ("Beer Nutz" = "BEERNUTZ"). */
export const compactName = (s: string) => normalizeText(s).replace(/^the /, '').replace(/[^a-z0-9]+/g, '');

const TIME_GLUE = /\d\s*(?:am|pm)\b|\d(?:am|pm)[A-Za-z]|\b\d{1,2}:\d{2}\b/i;
/** Case-sensitive on purpose: "10:30pmLive", "GreySaturday", "RevivalFriday". */
const WORD_GLUE = /(?:am|pm|AM|PM)(?=[A-Z][a-z])|[a-z](?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b|[a-z](?:Live|Music|Read|More)\b/;

/**
 * Is this text safe to show as an act name in a title? Rejects text glued together from page
 * elements ("-10:30pmLive Music: 4 Shades of GreySaturday"), times, and leftover punctuation.
 */
export function displayActOk(name: string): boolean {
  const s = name.trim();
  return s.length >= 2 && s.length <= 80 && /^[A-Za-z0-9"“'‘(]/.test(s) && !TIME_GLUE.test(s) && !WORD_GLUE.test(s) && /[A-Za-z]{2}/.test(s);
}

const JOINED_ACTS = /[:;|/+@#!?()[\]]|,|\s[-–—]\s|\b(?:vs\.?|versus|w\/|with|featuring|feat\.?|ft\.?|presents|plus|tribute to|the music of|matinee|tour|edition|anniversary|night|party|festival|fest|show|live at)\b/i;
const EVENT_WORDS =
  /\b(grammy|nominated|award|winning|edm|pop[- ]?up|supper|prix fixe|showcase|holidays|reunion|pipes|drums and|package|special|series|benefit|fundraiser|acoustics|in the garden|concerts?|recital|(?:irish|oktober|october|summer|fall|autumn|spring|winter|beer|wine|music|jazz|blues|rock|apple|food|street|harvest|block|pumpkin)fest|closed|private|trivia|bingo|karaoke|comedy|brunch|specials?|menu|tickets?|sold out|doors|free|admission|reservations?|open mic|open jam|jam session|jam|dinner|buffet|cover|read more|more info|details|rsvp|register|coming soon|tba|tbd|to be announced|fair|carnival|club|social|bash|celebration|parade|market|halloween|thanksgiving|christmas|holiday|new year|(?:mon|tues|wednes|thurs|fri|satur|sun)day|january|february|march|april|june|july|august|september|october|november|december)\b/i;

/**
 * Strict check before adding a band or DJ to the registry. A name that fails (two acts joined,
 * an abbreviation such as "AMH", an event description) stays in the title only.
 */
const GENERIC_ONE_WORD = /^(country|rock|jazz|blues|swing|salsa|latin|disco|karaoke|acoustic|music|live|band|dj|wing|wings|tacos?|brunch|trivia|bingo|comedy|open|special|guest|tba|tbd|various|artists?)$/i;

export function performerNameOk(name: string): boolean {
  const s = name.replace(/\s+/g, ' ').trim();
  if (!displayActOk(s) || s.length < 3 || s.length > 50) return false;
  if (!/^[A-Z0-9]/.test(s) || /["“”«»]/.test(s)) return false; // "s-Giving", unbalanced quotes
  if ((s.match(/&| and /gi) ?? []).length > 1) return false; // "Ernie & The Band & Dysfunktone"
  // One "&" is a single act only in forms like "Joe Louis & The Groove", "Annabelle and Friends" or
  // "Rose & Co". "Foreign Journey & AeroZep" is two bands on one bill, so it stays in the title.
  if (/\s(?:&|and)\s/i.test(s) && !/\s(?:&|and)\s+(?:the|his|her|their|friends|co\.?|company)\b/i.test(s)) return false;
  if (!s.includes(' ') && (GENERIC_ONE_WORD.test(s) || s.length < 4)) return false;
  if (JOINED_ACTS.test(s) || EVENT_WORDS.test(s)) return false;
  if (!s.includes(' ') && s === s.toUpperCase() && s.replace(/[^A-Z]/g, '').length <= 4) return false; // "AMH", "LHT"
  if (s.split(' ').length > 6) return false;
  return true;
}

const noBand = (s: string) => s.replace(/band$/, '');

// "Doors 7pm" and "Doors open at 6" are not acts; "Magical Mystery Doors" (a Doors tribute) is.
const TITLE_JUNK = /\b(happy hour|live music by|grammy|nominated|award|showcase|pop[- ]?up|brunch|special|secret|tickets?|doors(?=\s*(?:open|at\b|@|:|\d))|sold out|read more|more info|rsvp|tba|tbd)\b/i;
const DATE_BITS = /\b\d{1,2}\/\d{0,2}(?!\d)|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+\d/i;

/** "JEFF REID “Me and My Guitar" -> "JEFF REID"; "John vs Paul (Postponed from 9/27)" -> "John vs Paul". */
export function tidyTitleAct(name: string): string {
  let s = name.replace(/\s*\((?:postponed|rescheduled|moved|new date|sold out|cancel)[^)]*\)/gi, '').trim();
  if ((s.match(/["“”]/g) ?? []).length % 2 === 1) s = s.slice(0, s.search(/["“”]/)).trim();
  // "Band-Maid World Tour 2026", "Mitchell Tenpenny: Speed of Light Tour 2026" -> the act's name.
  s = s.replace(/\s*[:–—-]\s+[^:–—-]*\btour\b[^:–—-]*$/i, '').replace(/\s+(?:world\s+|\d{4}\s+|north american\s+|farewell\s+)*tour(?:\s+\d{4})?$/i, '').trim();
  return s;
}

/**
 * Can this act text go in an event title even though it is not a researched band? Drops event
 * wording ("Happy Hour with live music by …", "Grammy Nominated"), dates ("Sat 11/"), lowercase
 * fragments ("s-Giving") and bare abbreviations ("AMH", "FDNY").
 */
export function titleActOk(name: string): boolean {
  const s = name.trim();
  if (!displayActOk(s) || !/^[A-Z0-9]/.test(s) || TITLE_JUNK.test(s) || DATE_BITS.test(s)) return false;
  return !(/^[A-Z]{2,5}$/.test(s));
}

/** Drop act texts that repeat one already shown ("Skillet" and "Skillet: Comatose 20 Years Tour"). */
function distinctActs(shown: string[], acts: string[]): string[] {
  const out: string[] = [];
  const prefix = (a: string, b: string) => {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return i;
  };
  for (const a of acts) {
    const c = compactName(a);
    const dup = [...shown, ...out].some((b) => {
      const d = compactName(b);
      return (d.length >= 5 && c.startsWith(d)) || (c.length >= 5 && d.startsWith(c)) || prefix(c, d) >= 12;
    });
    if (c && !dup) out.push(a);
  }
  return out;
}

export function findPerformer(reg: Registry, name: string): string | undefined {
  const n = compactName(name);
  if (!n) return undefined;
  for (const [id, p] of reg.performers) if ([p.name, ...p.aliases].some((a) => compactName(a) === n)) return id;
  if (n.length >= 6) for (const [id, p] of reg.performers) if ([p.name, ...p.aliases].some((a) => noBand(compactName(a)) === noBand(n))) return id;
  // "Classic Stones" in a listing is the band on file as "Classic Stones Live".
  const noLive = (s: string) => s.replace(/live$/, '');
  if (noLive(n).length >= 6) for (const [id, p] of reg.performers) if ([p.name, ...p.aliases].some((a) => noLive(compactName(a)) === noLive(n))) return id;
  return undefined;
}

/** File id from a name: apostrophes dropped first ("Flanagan's Pub" -> "flanagans-pub"). */
export const idFrom = (s: string, max = 60) => slugify(s.replace(/['’‘`]/g, ''), max);

const ACT_SUFFIX = /\b(?:band|trio|duo|quartet|quintet|orchestra|ensemble|revue|project|experience|\d{1,2})$/i;

/**
 * A band's own gig list sometimes names a side project instead of the band ("The Heavy Traffic Band
 * @ Stephen Talkhouse" on the Hoodoo Loungers' page, "LIVERPOOL 2 at La Famiglia" on The Liverpool
 * Shuffle's). Returns that act's name, or undefined when the listing is the band itself or no act
 * name is clear ("Fund Raiser for the firemen at Sylvester Manor").
 */
export function sideAct(reg: Registry, bandIds: string[], lines: (string | undefined)[]): string | undefined {
  const names = bandIds.flatMap((id) => {
    const p = reg.performers.get(id);
    return p ? [p.name, ...p.aliases] : [id.replace(/-/g, ' ')];
  });
  const core = (s: string) => noBand(compactName(s).replace(/live$/, ''));
  const bands = names.map(core).filter((b) => b.length >= 3);
  for (const line of lines) {
    const m = /^(.{2,50}?)\s+(?:@|at)\s+[A-Z0-9]/.exec(line?.trim() ?? '');
    if (!m) continue;
    const act = tidyName(m[1]!.trim());
    const c = core(act);
    if (!c || bands.some((b) => c.includes(b) || b.includes(c))) return undefined;
    if (!performerNameOk(act)) return undefined;
    return findPerformer(reg, act) || ACT_SUFFIX.test(act) ? act : undefined;
  }
  return undefined;
}

/**
 * Match a band/DJ name to the registry. Only when `create` is true and the name passes the strict
 * check is a new band/DJ added (with a review note); otherwise undefined.
 */
export function ensurePerformer(reg: Registry, name: string, sourceName: string, id = idFrom(name), create = true): string | undefined {
  const clean = tidyName(name);
  const known = reg.performers.has(id) ? id : findPerformer(reg, clean);
  if (known) return known;
  if (!create || !performerNameOk(name) || !performerNameOk(clean)) return undefined;
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

/** A street address: a house number followed by a street name ("345 Deer Park Ave"). */
export const hasStreetAddress = (s: string | undefined): s is string => Boolean(s && /\b\d{1,6}[A-Za-z]?\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+)*/.test(s) && /[A-Za-z]{3}/.test(s));

/** "185 Glen Cove Ave, Suite A" and "185 Glen Cove Ave Suite A" -> "185 glen cove ave". */
const streetOf = (address: string) => normalizeAddress(address.split(',')[0]!.replace(/\s+(?:suite|ste|unit|#)\s*\w+$/i, ''));

/** "First and South (Greenport NY)" -> "First and South"; "Montauk, NY" -> "" (just a town). */
export function cleanVenueName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const s = name.replace(/\s*\([^)]*\)\s*$/, '').replace(/(?:,\s*|\s+)(?:NY|N\.Y\.|New York)\.?$/, '').replace(/[\s,/-]+$/, '').trim();
  if (!s || lookupPlace(s)) return undefined;
  return s;
}

/**
 * An existing venue with this name or alias (or this street address) in the same town.
 * Checked before anything new is created, so the same place never gets two files.
 */
export function findVenue(reg: Registry, name: string | undefined, address: string | undefined, town: string | undefined): string | undefined {
  const sameTown = (v: { town: string }) => !town || normalizeText(v.town) === normalizeText(town);
  const n = name ? compactName(name) : '';
  if (n.length >= 3) {
    for (const [id, v] of reg.venues) if (sameTown(v) && [v.name, ...v.aliases].some((a) => compactName(a) === n)) return id;
  }
  if (hasStreetAddress(address)) {
    const a = streetOf(address);
    for (const [id, v] of reg.venues) if (sameTown(v) && v.address && streetOf(v.address) === a) return id;
    // Same street address and the same name, but the town is written differently.
    if (n.length >= 3)
      for (const [id, v] of reg.venues)
        if (v.address && streetOf(v.address) === a && [v.name, ...v.aliases].some((x) => { const cx = compactName(x); return cx === n || cx.startsWith(n) || n.startsWith(cx); })) return id;
  }
  const text = [name, address].filter(Boolean).join(' ');
  const id = text ? reg.matchVenue(text, town) : undefined;
  return id && sameTown(reg.venues.get(id)!) ? id : undefined;
}

/** The source's own venue (defaults.venueId), or an existing venue with the source's name in that town. Never invented. */
function defaultVenueId(reg: Registry, id: string, sourceName: string, town: Place | undefined, log: (m: string) => void): string | undefined {
  if (reg.venues.has(id)) return id;
  const found = findVenue(reg, entityNameFromSource(sourceName), undefined, town?.name);
  if (found) return found;
  log(`Default venue "${id}" is not in src/content/venues yet, so listings without their own venue are skipped.`);
  return undefined;
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
  const sourceFocus = src.focus ?? 'dance';
  const defaults: SourceDefaults = src.defaults ?? {};
  // A calendar that lists everything in an area (no default venue, organizer or band).
  const allInOneCalendar = !defaults.venueId && !defaults.organizerId && !defaults.performerIds?.length;
  const include = regexOrUndefined(src.include);
  const exclude = regexOrUndefined(src.exclude);
  const horizon = addDays(ctx.today, opts.horizonDays ?? 180);
  const candidates: Candidate[] = [];
  const outOfArea = new Map<string, number>();
  const skipped: NormalizeResult['skipped'] = [];
  const seen = new Set<string>();
  let last = ctx.today;

  const defaultTown = lookupPlace(defaults.town) ?? townOfVenue(reg, defaults.venueId);
  const defaultVenue = defaults.venueId ? defaultVenueId(reg, defaults.venueId, src.name, defaultTown, ctx.log) : undefined;
  // A band's own gig list: the band itself (an existing file, or one named after the source).
  const defaultPerformers = (defaults.performerIds ?? [])
    .map((pid) => (reg.performers.has(pid) ? pid : ensurePerformer(reg, entityNameFromSource(src.name), src.name, pid)))
    .filter((x): x is string => Boolean(x));
  const unresearched = new Set<string>();
  const unresearchedActs = new Set<string>();

  for (const listing of found) {
    const f = fixShiftedClock(listing);
    const date = f.start.slice(0, 10);
    const ref = `${f.ref ?? 'listing'} ${date}`;
    const text = cleanListingText([f.heading, f.title, f.description, f.locationName, f.address, f.locality].filter(Boolean).join('. '));
    const key = `${normalizeText(f.title)}|${f.start}|${normalizeText(f.locationName ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (f.cancelled || CANCELLED_TITLE.test(f.title)) {
      skipped.push({ reason: 'cancelled by the source', ref });
      continue;
    }
    if (date < ctx.today || date > horizon) continue;
    // Trivia, bingo, comedy and film nights are skipped on every calendar, even when a source's
    // "include" pattern matches ("Rocky Horror" contains "rock"), unless the title names a dance.
    const nonEvent = NON_EVENT.test(f.title) && !DANCE_TEXT.test(f.title);
    // A happy hour or food special counts only when it names a band, DJ, live music or dancing
    // ("Happy Hour Band: ...", "Jazz Brunch", "Dinner Dance"), not "Prime Rib Night".
    const listingWords = `${f.title} ${f.description ?? ''}`;
    const plainHappyHour = FOOD_OR_DRINK.test(f.title) && !MUSIC_TEXT.test(listingWords) && !DANCE_TEXT.test(listingWords) && !reg.matchPerformers(listingWords).length;
    if ((include && !include.test(text)) || (exclude && exclude.test(text)) || nonEvent || plainHappyHour || NEVER_EVENT.test(f.title)) {
      skipped.push({ reason: 'not a dance or live-music listing', ref: `${ref} ${f.title}`.slice(0, 160) });
      continue;
    }
    const optedOut = reg.isOptedOut(text);
    if (optedOut) {
      skipped.push({ reason: `organizer ${optedOut} opted out`, ref });
      continue;
    }
    // The listing's own words decide what it is, not the source's settings: a lodge calendar also
    // lists hockey nights and bingo, and a town calendar lists pumpkin picking.
    const own = cleanListingText([f.heading, f.title, f.description].filter(Boolean).join('. '));
    const ownDance = f.kind === 'dance' || f.pageNamesDance || namesDance(own, !allInOneCalendar, sourceFocus === 'dance' && !allInOneCalendar);
    const ownMusic = f.kind === 'music' || namesMusic(own, reg, !allInOneCalendar);
    let focus = sourceFocus;
    if (sourceFocus === 'dance' && !ownDance) {
      if (allInOneCalendar && ownMusic) focus = 'music';
      else {
        skipped.push({ reason: 'no dance named in the listing', ref: `${ref} ${f.title}`.slice(0, 160) });
        continue;
      }
    } else if (sourceFocus === 'music' && allInOneCalendar && !ownDance && !ownMusic) {
      skipped.push({ reason: 'no live music or dancing named in the listing', ref: `${ref} ${f.title}`.slice(0, 160) });
      continue;
    }
    if (OFF_ISLAND.test(own)) {
      outOfArea.set('outside Nassau and Suffolk', (outOfArea.get('outside Nassau and Suffolk') ?? 0) + 1);
      continue;
    }
    const notes = [...(f.notes ?? [])];
    let confidence = opts.structured ? 0.6 : 0.5;

    // Where: the listing's own place first, then the source's default venue or town.
    const ownPlace = lookupPlace(f.locality) ?? (f.address || f.locationName ? findPlaceInText(`${f.locationName ?? ''} ${f.address ?? ''}`) : undefined);
    const locName = cleanVenueName(f.locationName);
    let venueId: string | undefined;
    let place: Place | undefined = ownPlace;
    if (!ownPlace && f.locality) {
      outOfArea.set(f.locality, (outOfArea.get(f.locality) ?? 0) + 1);
      continue;
    }
    if (locName || f.address) venueId = findVenue(reg, locName, f.address, place?.name);
    if (!venueId && defaultVenue && (!ownPlace || ownPlace.name === townOfVenue(reg, defaultVenue)?.name)) venueId = defaultVenue;
    // One feed for two locations ("Saved by the Band takes over Daisy's Patchogue" in the Daisy's
    // Miller Place feed): a sister location named in the listing wins over the default.
    if (venueId && venueId === defaultVenue) {
      const named = reg.matchVenue(own);
      const brand = (id: string) => normalizeText((reg.venues.get(id)?.name ?? '').replace(/\s*\([^)]*\)\s*$/, ''));
      if (named && named !== defaultVenue && brand(named) === brand(defaultVenue)) venueId = named;
    }
    // A new venue only with a street address (never invented); it gets a review note.
    if (!venueId && locName && hasStreetAddress(f.address) && place && locName.length <= 80) {
      const id = idFrom(`${locName} ${place.name}`);
      if (!reg.venues.has(id)) {
        reg.venues.set(id, {
          name: locName,
          aliases: [],
          address: f.address.split(',')[0]!.trim(),
          town: place.name,
          county: place.county,
          state: 'NY',
          reviewNotes: `Added automatically from ${src.name}. Check the name and address; research the dance floor.`,
        });
        reg.created.venues.add(id);
      }
      venueId = id;
      notes.push('New venue was added automatically. Check it.');
    }
    if (venueId) place = townOfVenue(reg, venueId) ?? place;
    // Unknown venue: not published until someone researches it (as for Ira's List). Dance calendars
    // that only give a town are kept with the town; live-music listings need a venue for the dancing score.
    if (!place) place = findPlaceInText(text) ?? defaultTown;
    if (!place) {
      // No Long Island town anywhere in the listing (often another state).
      outOfArea.set('town not stated', (outOfArea.get('town not stated') ?? 0) + 1);
      continue;
    }
    if (!venueId && (locName || focus === 'music')) {
      const label = `${locName ?? 'venue not named'} (${place.name})`;
      unresearched.add(label);
      skipped.push({ reason: 'venue not researched yet', ref: `${ref} ${label}`.slice(0, 160) });
      continue;
    }
    if (venueId) confidence += 0.15;
    else {
      // Only a town: a person adds the venue before it is shown (the dancing score needs one).
      confidence -= 0.1;
      notes.push('Venue not found in the listing.');
    }

    // Who: researched bands/DJs, plus new ones only when the name passes a strict check.
    // Other act names stay in the title only.
    const performerIds = [...defaultPerformers];
    const listedActs: string[] = [];
    // A band's own page listing a side project: that act plays, not the band.
    const otherAct = defaultPerformers.length && !defaults.venueId ? sideAct(reg, defaultPerformers, [f.heading, f.title]) : undefined;
    if (otherAct) performerIds.length = 0;
    // Act text for the title only: tidied, and dropped when it is event wording or an abbreviation.
    const addTitleAct = (text: string, rawText = text) => {
      unresearchedActs.add(text);
      const t = tidyTitleAct(text);
      if (titleActOk(t) && titleActOk(tidyTitleAct(rawText))) listedActs.push(t);
    };
    const venueName = venueId ? reg.venues.get(venueId)?.name ?? '' : locName ?? '';
    const named = otherAct ? [otherAct] : f.performers?.length ? f.performers : defaults.venueId && focus === 'music' ? [actName(f.title)].filter((x): x is string => Boolean(x)) : [];
    for (const raw of named) {
      const name = tidyName(raw);
      if (!displayActOk(name) || compactName(name) === compactName(venueName) || compactName(name) === compactName(f.locationName ?? '')) continue;
      // "Decadia & DJ Mike Savage": when a part is a band we know, link it and keep the rest in the title.
      const parts = name.split(/\s+(?:&|and|\+|w\/|with)\s+/i).map((x) => x.trim()).filter((x) => x.length >= 2);
      const knownParts = parts.length > 1 ? parts.map((x) => findPerformer(reg, x)) : [];
      if (knownParts.some(Boolean)) {
        parts.forEach((x, i) => {
          const pid = knownParts[i];
          if (pid) {
            if (!performerIds.includes(pid)) performerIds.push(pid);
          } else if (displayActOk(x)) addTitleAct(x);
        });
        continue;
      }
      const id = ensurePerformer(reg, raw, src.name); // raw: the abbreviation check needs "FDNY", not "Fdny"
      if (id) {
        if (!performerIds.includes(id)) performerIds.push(id);
      } else addTitleAct(name, raw);
    }
    for (const id of reg.matchPerformers(`${f.title} ${(f.performers ?? []).join(' ')}`)) if (!performerIds.includes(id)) performerIds.push(id);
    const titleOnlyActs = distinctActs(
      performerIds.map((id) => reg.performers.get(id)?.name ?? id),
      listedActs,
    );
    if (titleOnlyActs.length) notes.push(`Band or DJ not researched yet: ${titleOnlyActs.join(', ')}.`);
    const organizerId =
      (defaults.organizerId && reg.organizers.has(defaults.organizerId) ? defaults.organizerId : undefined) ??
      reg.matchOrganizer(text) ??
      (() => {
        const homes = [...reg.organizers].filter(([, o]) => venueId && o.homeVenueId === venueId && !o.optOut);
        return homes.length === 1 ? homes[0]![0] : undefined;
      })();
    const djs = performerIds.filter((id) => reg.performers.get(id)?.type === 'dj');
    const liveActs = performerIds.filter((id) => reg.performers.get(id)?.type !== 'dj');
    let danceStyles = reg.matchStyles(text, { abbreviations: focus === 'dance' });
    if (!danceStyles.length && defaults.danceStyles?.length) danceStyles = defaults.danceStyles.filter((s) => reg.styles.has(s));
    if (!danceStyles.length && organizerId && focus === 'dance') danceStyles = reg.organizers.get(organizerId)?.danceStyles ?? [];
    if (danceStyles.length || performerIds.length) confidence += 0.05;

    // What and when
    const category = categoryOf(text, focus, liveActs.length + titleOnlyActs.length, djs.length, defaults.category);
    const parsed = parseTimes(`${f.title}. ${f.description ?? ''}`);
    const start = timeOf(f.start) ?? parsed.start;
    let end = timeOf(f.end) ?? (timeOf(f.start) ? undefined : parsed.end);
    if (end && f.end && f.end.slice(0, 10) > addDays(date, 1)) end = undefined;
    if (start) confidence += 0.1;
    else {
      confidence -= 0.1;
      notes.push('No start time found.');
    }
    // A dance or show starting between 1 and 9 in the morning is almost always a typo on the source
    // ("6:30 AM" for 6:30 PM), so a person checks it before it is shown.
    if (start && minutesOf(start) >= 60 && minutesOf(start) < 540) {
      notes.push(`Start time looks wrong (${Number(start.slice(0, 2))}:${start.slice(3, 5)} in the morning). Check the source.`);
      confidence = Math.min(confidence, 0.4);
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
      liveActs: [...liveActs.map((id) => name(id, reg.performers)), ...titleOnlyActs],
      instructors: [],
      lessonTime: parsed.lessonTime,
      schedule: [],
      skillLevel,
      facts: text.toLowerCase(),
      focus,
    };
    const plain = { ...describe, theme: undefined };
    const venueKey = venueId ?? slugify(place.name);
    // The same listing often appears twice on a page (a list and a calendar grid).
    const dupKey = [date, start ?? '', venueKey, [...performerIds, ...titleOnlyActs.map(compactName)].sort().join('+'), category].join('|');
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
        act: [...[...liveActs, ...djs].map((id) => name(id, reg.performers)), ...titleOnlyActs].join(' ') || f.title,
        venue: (venueId ? reg.venues.get(venueId)?.name : f.locationName) ?? '',
        text,
        time: start ? `${Number(start.slice(0, 2)) % 12 || 12}:${start.slice(3, 5)}${Number(start.slice(0, 2)) < 12 ? 'am' : 'pm'}` : undefined,
      }),
      confidence: Math.max(0, Math.min(1, confidence)),
      reviewNotes: notes,
      seriesKey: [src.id, venueKey, organizerId ?? '', weekdayOf(date), start ?? 'tba', category, [...performerIds, ...titleOnlyActs.map(compactName)].sort().join('+'), [...danceStyles].sort().join('+')].join('|'),
      oneOff: Boolean(theme),
    });
  }
  if (unresearched.size) ctx.log(`${src.id}: venues to research: ${[...unresearched].sort().join('; ')}`);
  if (unresearchedActs.size) ctx.log(`${src.id}: bands/DJs to research: ${[...unresearchedActs].sort().join('; ')}`);
  // Calendar pages often mention the same evening more than once ("Next dance on Oct 24", "Doors
  // open at 6:30", a weather note). A listing without a start time is dropped when the same source
  // has a timed listing that day at the same place, of the same kind, with the same bands or more.
  const dances = new Set<EventCategory>(['social-dance', 'lesson-party']);
  const sameKind = (a: EventCategory, b: EventCategory) => a === b || (dances.has(a) && dances.has(b));
  const kept = candidates.filter(
    (c) =>
      c.start ||
      !candidates.some(
        (t) => t.start && t.date === c.date && (t.venueId ?? t.town) === (c.venueId ?? c.town) && sameKind(t.category, c.category) && c.performerIds.every((p) => t.performerIds.includes(p)),
      ),
  );
  for (const c of candidates) if (!kept.includes(c)) skipped.push({ reason: 'same evening listed again without a time', ref: c.sourceRef });
  return {
    candidates: kept,
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
  // Inline tags become a space so text from neighbouring elements does not run together.
  return decodeEntities(stripTags(body, ' '))
    .replace(/[<>]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean);
}

/** Plain text from an HTML fragment (tags removed completely, entities decoded). */
export function plainText(fragment: string): string {
  return decodeEntities(stripTags(fragment, ' ')).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
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
