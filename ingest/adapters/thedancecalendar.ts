/**
 * The Dance Calendar (thedancecalendar.com): a monthly Long Island dance newsletter published as a PDF.
 *
 * fetch():     read the "Dance Calendar" page, collect its PDF links, download them politely (cached),
 *              and keep the issues for this month and later (read from each PDF's cover).
 * normalize(): extract dated listings with ingest/pdf/extract_calendar.py, keep Nassau/Suffolk towns,
 *              match venues/organizers/people/styles, parse times and prices, and write our own title
 *              and summary for each listing.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { EventCategory, SkillLevel } from '../../src/lib/schemas';
import { weekdayOf, daysInMonth } from '../../src/lib/time';
import { makeSummary, makeTitle, themeOf, type DescribeInput } from '../lib/describe';
import { parsePrices } from '../lib/prices';
import { lookupPlace, normalizeAddress, ROOT, type Registry } from '../lib/registry';
import { cleanListingText, domainOf, extractEmails, extractPhones, extractUrls, digits, normalizeText, slugify } from '../lib/text';
import { parseSchedule, parseTimes } from '../lib/times';
import type { Adapter, AdapterContext, Candidate, FetchedDocument, NormalizeResult } from '../lib/types';

export interface CalendarRow {
  date: string;
  section: string;
  town: string;
  text: string;
  page: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const issueLabel = (issue: string) => `${MONTHS[Number(issue.slice(5, 7)) - 1]} ${issue.slice(0, 4)}`;

const PY_SCRIPT = join(ROOT, 'ingest', 'pdf', 'extract_calendar.py');
export const python = () => process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function runPython(args: string[]): string {
  const r = spawnSync(python(), [PY_SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`PDF extractor failed (${r.status}): ${r.stderr || r.error?.message}`);
  return r.stdout;
}

export function extractRows(pdfFile: string, issue: string): CalendarRow[] {
  return (JSON.parse(runPython(['--pdf', pdfFile, '--issue', issue])) as { rows: CalendarRow[] }).rows;
}

const ORDINAL_WORDS: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, last: -1 };
const ORD_LABEL: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'last' };

/** "Held on the first and third Friday of every month" -> { text: "1st and 3rd Fridays of the month", ordinals: [1, 3] }. */
export function statedCadence(text: string): { cadence?: string; ordinals?: number[]; note?: string } {
  const m = /\b(first|second|third|fourth|last|1st|2nd|3rd|4th)(?:\s*(?:and|&|,)\s*(first|second|third|fourth|last|1st|2nd|3rd|4th))?\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+of\s+(?:every|each|the)\s+month/i.exec(text);
  if (m) {
    const ords = [m[1], m[2]].filter(Boolean).map((w) => ORDINAL_WORDS[w!.toLowerCase()]!);
    const day = m[3]!.charAt(0).toUpperCase() + m[3]!.slice(1).toLowerCase();
    return { cadence: `${ords.map((o) => ORD_LABEL[o]).join(' and ')} ${day}${ords.length > 1 ? 's' : ''} of the month`, ordinals: ords };
  }
  const alt = /\b(?:held )?(?:alternating|every other)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?/i.exec(text);
  if (alt) return { note: `The listing says "every other ${alt[1]!.toLowerCase()}", so check the date with the organizer.` };
  const nth = /\bevery\s+(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.exec(text);
  if (nth) {
    const o = ORDINAL_WORDS[nth[1]!.toLowerCase()]!;
    return { cadence: `${ORD_LABEL[o]} ${nth[2]!.charAt(0).toUpperCase()}${nth[2]!.slice(1).toLowerCase()} of the month`, ordinals: [o] };
  }
  return {};
}

const STREET = String.raw`(?:Ave(?:nue)?|R(?:oa)?d|St(?:reet)?|Blvd|Boulevard|T(?:urn)?pke|Turnpike|H(?:igh)?wy|Highway|P(?:ark)?wy|Parkway|Dr(?:ive)?|L(?:a)?n(?:e)?|Pl(?:ace)?|Expy|Exwy|Way|Ct|Court)`;
const ADDRESS_RE = new RegExp(String.raw`\b(\d{1,5}(?:-\d{1,3})?\s+(?:[NSEW]\.?\s+)?(?:[A-Z0-9][\w'.]*\s+){0,3}${STREET})\b\.?`);

/** For listings at a venue we do not know yet: a name and street address, if the text has them. */
export function guessVenue(text: string): { name: string; address: string } | undefined {
  const m = ADDRESS_RE.exec(text);
  if (!m) return undefined;
  const address = m[1]!.replace(/\.$/, '');
  const before = text.slice(0, m.index).split(/[.!?]\s|,\s(?=[A-Z])/).filter((s) => s.trim()).at(-1) ?? '';
  const name = before
    .replace(/^.*\b(?:at|located at|held at)\s+(?:the\s+)?/i, '')
    .replace(/[,.\s]+$/, '')
    .trim();
  return { name: name.length >= 3 && name.length <= 60 && /^[A-Z0-9]/.test(name) ? name : `Venue at ${address}`, address };
}

const DJ_STOP = new Set(['music', 'only', 'night', 'dance', 'dancing', 'party', 'mix', 'and', 'social', 'set']);

/** "DJ Ray", "DJ Gene & Joanne", "DJ Neil Wrangler": DJs named in the text. */
export function findDjNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bDJ\s+([A-Z][a-zA-Z'’.]*(?:\s+(?:&|and)\s+[A-Z][a-zA-Z'’]+|\s+[A-Z][a-zA-Z'’.]*){0,2})/g)) {
    const words = m[1]!.replace(/['’]s\b.*$/, '').split(/\s+/);
    const kept: string[] = [];
    for (const w of words) {
      if (DJ_STOP.has(w.toLowerCase().replace(/\W/g, ''))) break;
      kept.push(w);
    }
    while (kept.length && /^(&|and)$/i.test(kept.at(-1)!)) kept.pop();
    if (kept.length) out.push(`DJ ${kept.join(' ').replace(/[.!,]+$/, '')}`);
  }
  return [...new Set(out)];
}

function skillOf(text: string, category: EventCategory): SkillLevel {
  const t = text.toLowerCase();
  if (/open to all|all levels|all-levels/.test(t) && category !== 'class-lesson') return 'all-levels';
  const levels = new Set<string>();
  if (/\b(beginners?|newcomers?|novice|foundations|basic)\b/.test(t)) levels.add('beginner');
  if (/\b(intermediate|int)\b/.test(t)) levels.add('intermediate');
  if (/\b(advanced?|adv)\b/.test(t)) levels.add('advanced');
  if (category !== 'class-lesson') return 'all-levels';
  if (levels.size === 0) return /open to all|all levels/.test(t) ? 'all-levels' : 'all-levels';
  return levels.size === 1 ? ([...levels][0] as SkillLevel) : 'mixed';
}

function ageOf(text: string): { ageGroup?: Candidate['ageGroup']; ages?: string } {
  const ages = /(\d{1,2})\s*-\s*(\d{1,2})\s*(?:y\.?\s?o\.?|years?)/i.exec(text);
  if (/\b(kids?|children|pre-?teens?)\b/i.test(text) || ages) return { ageGroup: 'kids', ages: ages ? `${ages[1]} to ${ages[2]}` : undefined };
  if (/\bteens?\b/i.test(text)) return { ageGroup: 'teens' };
  if (/\badults?\b/i.test(text)) return { ageGroup: 'adults' };
  return {};
}

export interface NormalizeOptions {
  sourceId: string;
  sourceUrl: string;
  issue: string;
  registry: Registry;
}

/** Turn extracted rows into dated candidates. Pure apart from adding new venues/DJs to the registry. */
export function normalizeRows(rows: CalendarRow[], opts: NormalizeOptions): NormalizeResult {
  const { registry: reg } = opts;
  const candidates: Candidate[] = [];
  const outOfArea = new Map<string, number>();
  const skipped: NormalizeResult['skipped'] = [];
  const sourceName = `The Dance Calendar, ${issueLabel(opts.issue)}`;
  for (const row of rows) {
    const ref = `page ${row.page}`;
    const text = cleanListingText(row.text);
    const place = lookupPlace(row.town);
    if (!place) {
      outOfArea.set(row.town, (outOfArea.get(row.town) ?? 0) + 1);
      continue;
    }
    const optedOut = reg.isOptedOut(text);
    if (optedOut) {
      skipped.push({ reason: `organizer ${optedOut} opted out`, ref: `${row.date} ${ref}` });
      continue;
    }
    const notes: string[] = [];
    let confidence = 0.5;
    const lower = text.toLowerCase();

    // Venue
    let venueId = reg.matchVenue(text, place.name);
    if (venueId) confidence += 0.2;
    else {
      const g = guessVenue(text);
      if (g) {
        const id = slugify(`${g.name.startsWith('Venue at') ? g.address : g.name} ${place.name}`, 60);
        if (!reg.venues.has(id)) {
          reg.venues.set(id, { name: g.name, aliases: [], address: g.address, town: place.name, county: place.county, state: 'NY', reviewNotes: `Added automatically from ${sourceName} (${ref}). Check the name and address, then geocode.` });
          reg.created.venues.add(id);
        }
        venueId = id;
        notes.push('New venue was added automatically. Check it.');
      } else notes.push('Venue not found in the listing.');
    }

    // Organizer, people, styles
    const organizerId = reg.matchOrganizer(text) ?? (() => {
      const homes = [...reg.organizers].filter(([, o]) => venueId && o.homeVenueId === venueId && !o.optOut);
      return homes.length === 1 ? homes[0]![0] : undefined;
    })();
    if (organizerId) confidence += 0.1;
    const performerIds = reg.matchPerformers(text);
    for (const name of findDjNames(text)) {
      const known = [...reg.performers].find(([, p]) => [p.name, ...p.aliases].some((a) => normalizeText(a) === normalizeText(name)));
      if (known) {
        if (!performerIds.includes(known[0])) performerIds.push(known[0]);
        continue;
      }
      const id = slugify(name);
      if (!reg.performers.has(id)) {
        reg.performers.set(id, { name, type: 'dj', aliases: [], genres: [], reviewNotes: `Added automatically from ${sourceName}. Find their website or social page.` });
        reg.created.performers.add(id);
      }
      performerIds.push(id);
    }
    const djs = performerIds.filter((id) => reg.performers.get(id)?.type === 'dj');
    const liveActs = performerIds.filter((id) => reg.performers.get(id)?.type !== 'dj');
    let danceStyles = reg.matchStyles(text);
    // Organizer styles fill in socials ("Social Dance Mix") but never classes: a class's style must be stated.
    const sectionIsClass = ['CLASSES', 'WORKSHOP'].includes(row.section.toUpperCase());
    if (!danceStyles.length && organizerId && !sectionIsClass) {
      danceStyles = reg.organizers.get(organizerId)?.danceStyles ?? [];
      if (danceStyles.length) notes.push('Dance styles come from the organizer, not this listing.');
    }
    if (danceStyles.length) confidence += 0.05;

    // Category
    const section = row.section.toUpperCase();
    let category: EventCategory;
    if (/\b(festival|dance weekend|congress|dance camp|marathon)\b/i.test(text)) category = 'festival';
    else if (section === 'CLASSES' || section === 'WORKSHOP') category = /practice (social|party)/i.test(text) && !/\bclass(es)?\b/i.test(text) ? 'social-dance' : 'class-lesson';
    else if (liveActs.length || /\b(live (band|music|entertainment)|band night|band performs|orchestra)\b/i.test(text)) category = 'live-music';
    else if (/\b(lessons?|learn|group class)\b/i.test(text.replace(/private lessons?/gi, ''))) category = 'lesson-party';
    else category = 'social-dance';

    const times = parseTimes(text);
    if (times.start) confidence += 0.1;
    else {
      confidence -= 0.25;
      notes.push('No start time found.');
    }
    const schedule = category === 'class-lesson' ? parseSchedule(text, times.tokens) : [];
    let instructorIds = reg.matchInstructors(text);
    const org = organizerId ? reg.organizers.get(organizerId) : undefined;
    if (org?.type === 'instructor' && (category === 'class-lesson' || category === 'lesson-party')) {
      for (const [id, i] of reg.instructors) if (i.affiliatedOrganizerIds.includes(organizerId!) && !instructorIds.includes(id)) instructorIds.push(id);
    }
    if ((category === 'social-dance' || category === 'live-music') && !/\b(lesson|teach|taught|class|with|w\/)/i.test(text)) instructorIds = [];

    const price = parsePrices(text);
    if (price.price !== undefined || price.isFree) confidence += 0.05;
    const { ageGroup, ages } = ageOf(text);
    const skillLevel = skillOf(text, category);
    const cad = statedCadence(text);
    if (cad.note) notes.push(cad.note);
    const theme = themeOf(text);

    // Contact details only when the organizer record does not already have them.
    const phones = extractPhones(text).filter((p) => !org?.phone || digits(p) !== digits(org.phone));
    const emails = extractEmails(text).filter((e) => e !== org?.email);
    const urls = extractUrls(text).filter((u) => !/thedancecalendar\.com/i.test(u));
    const infoUrl = urls.find((u) => org?.website && domainOf(u) === domainOf(org.website)) ?? urls[0];

    const name = (id: string, m: Map<string, { name: string }>) => m.get(id)?.name ?? id;
    const lessonWord = /\b(lessons?|group class)\b/i.exec(text.replace(/private lessons?/gi, (x) => '#'.repeat(x.length)));
    const lessonStyles = lessonWord
      ? reg.matchStyles(text.slice(Math.max(0, lessonWord.index - 40), lessonWord.index + lessonWord[0].length).split(/[.!?]\s/).at(-1)!)
      : [];
    const describe: DescribeInput = {
      category,
      styles: danceStyles,
      lessonStyles,
      theme,
      venueName: venueId ? reg.venues.get(venueId)?.name : undefined,
      djs: djs.map((id) => name(id, reg.performers)),
      liveActs: liveActs.map((id) => name(id, reg.performers)),
      instructors: instructorIds.map((id) => name(id, reg.instructors)),
      lessonTime: times.lessonTime,
      schedule,
      ageGroup,
      ages,
      skillLevel,
      facts: lower,
      cadence: cad.cadence,
    };
    const plain = { ...describe, theme: undefined };
    const venueKey = venueId ?? slugify(place.name);
    candidates.push({
      sourceId: opts.sourceId,
      sourceUrl: opts.sourceUrl,
      sourceName,
      sourceRef: ref,
      date: row.date,
      start: times.start,
      end: times.end,
      lessonTime: times.lessonTime,
      category,
      danceStyles,
      venueId,
      town: place.name,
      organizerId,
      performerIds,
      instructorIds,
      price: price.price,
      priceMax: price.priceMax,
      isFree: price.isFree,
      priceNotes: price.notes.length ? price.notes.join('. ') : undefined,
      skillLevel,
      ageGroup,
      title: makeTitle(describe),
      summary: makeSummary(describe),
      seriesTitle: makeTitle(plain),
      seriesSummary: makeSummary(plain),
      theme,
      infoUrl,
      contactPhone: org?.phone ? undefined : phones[0],
      contactEmail: org?.email ? undefined : emails[0],
      cadence: cad.cadence,
      cadenceOrdinals: cad.ordinals,
      confidence: Math.max(0, Math.min(1, confidence)),
      reviewNotes: notes,
      seriesKey: [opts.sourceId, venueKey, organizerId ?? '', weekdayOf(row.date), times.start ?? 'tba', category, [...performerIds].sort().join('+'), [...danceStyles].sort().join('+'), ageGroup ?? ''].join('|'),
      oneOff: Boolean(theme),
    });
  }
  const [y, m] = opts.issue.split('-').map(Number) as [number, number];
  return {
    candidates,
    found: rows.length,
    outOfArea: [...outOfArea].map(([town, count]) => ({ town, count })).sort((a, b) => b.count - a.count),
    skipped,
    coverage: { from: `${opts.issue}-01`, to: `${opts.issue}-${String(daysInMonth(y, m)).padStart(2, '0')}` },
  };
}

const PDF_RE = /(?:https?:\/\/www\.thedancecalendar\.com)?\/_files\/ugd\/[a-z0-9_]+\.pdf/gi;

export const adapter: Adapter = {
  id: 'thedancecalendar',
  async fetch(ctx: AdapterContext): Promise<FetchedDocument[]> {
    const html = await ctx.fetcher.text(ctx.source.url, ctx.source.rateLimitSeconds);
    const links = [...new Set([...html.matchAll(PDF_RE)].map((m) => new URL(m[0], 'https://www.thedancecalendar.com').toString()))];
    if (!links.length) throw new Error('No PDF links found on the calendar page. The page layout may have changed.');
    const docs: FetchedDocument[] = [];
    for (const url of links) {
      const r = await ctx.fetcher.get(url, ctx.source.rateLimitSeconds);
      const issue = runPython(['--pdf', r.file, '--detect-issue']).trim();
      ctx.log(`${url} -> issue ${issue || 'unknown'}`);
      if (/^\d{4}-\d{2}$/.test(issue)) docs.push({ url, file: r.file, contentType: r.contentType, meta: { issue } });
    }
    const month = ctx.today.slice(0, 7);
    const current = docs.filter((d) => d.meta.issue! >= month);
    const keep = current.length ? current : docs.sort((a, b) => b.meta.issue!.localeCompare(a.meta.issue!)).slice(0, 1);
    return [...new Map(keep.map((d) => [d.meta.issue, d])).values()].sort((a, b) => a.meta.issue!.localeCompare(b.meta.issue!));
  },
  async normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult> {
    const all: NormalizeResult = { candidates: [], found: 0, outOfArea: [], skipped: [] };
    for (const doc of docs) {
      const rows = extractRows(doc.file, doc.meta.issue!);
      ctx.log(`${issueLabel(doc.meta.issue!)}: ${rows.length} listings in the PDF`);
      const r = normalizeRows(rows, { sourceId: ctx.source.id, sourceUrl: doc.url, issue: doc.meta.issue!, registry: ctx.registry });
      all.candidates.push(...r.candidates);
      all.found += r.found;
      all.skipped.push(...r.skipped);
      for (const o of r.outOfArea) {
        const ex = all.outOfArea.find((x) => x.town === o.town);
        if (ex) ex.count += o.count;
        else all.outOfArea.push({ ...o });
      }
      all.coverage = { from: all.coverage?.from ?? r.coverage!.from, to: r.coverage!.to };
    }
    return all;
  },
};

export { normalizeAddress };
