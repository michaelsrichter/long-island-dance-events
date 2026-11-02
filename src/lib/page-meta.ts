/**
 * Plain-language page descriptions, link-preview labels and share text, built only from facts we have.
 * Pure functions (no Astro imports) so they can be unit tested.
 */
import type { EventCategory } from './schemas';
import { formatDateLong, formatDateShort, formatTime } from './time';

/** The event facts these helpers need (a subset of ResolvedEvent). */
export interface MetaEvent {
  title: string;
  url: string;
  date: string;
  status: string;
  timeTba: boolean;
  startLocal: string;
  endLocal: string;
  category: EventCategory;
  cadence?: string | undefined;
  location: { name?: string | undefined; town?: string | undefined; address?: string | undefined };
  liveActs: { name: string }[];
  djs: { name: string }[];
  instructors: { name: string }[];
  styles: { name: string }[];
  price: { known: boolean; free: boolean; label?: string | undefined };
  lessonLabel?: string | undefined;
  skillLabel?: string | undefined;
  organizer?: { data: { name: string } } | undefined;
  dancing: { level: string; outOf10: number; label: string };
  data: { end?: string | undefined; summary?: string | undefined };
}

/** Twitter/Slack/Discord "label: value" pairs shown under a link preview. */
export interface MetaLabel {
  label: string;
  data: string;
}

/** Longest description we write. Search engines show about 155 characters; chat apps show more. */
export const DESCRIPTION_MAX = 200;

const sentence = (s: string) => {
  const t = s.trim();
  return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`;
};

/** Joins names as "A", "A and B" or "A, B and C" (at most `max`, then "and more"). */
export function listNames(names: string[], max = 3): string {
  const n = [...new Set(names.filter(Boolean))];
  if (n.length === 0) return '';
  if (n.length > max) return `${n.slice(0, max).join(', ')} and more`;
  return n.length === 1 ? n[0]! : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

/**
 * Joins sentences in priority order, leaving out the least important ones until the text fits.
 * The first sentence is always kept (shortened at a word if it alone is too long).
 */
export function fitSentences(parts: (string | undefined | false)[], max = DESCRIPTION_MAX): string {
  const list = parts.filter((p): p is string => Boolean(p && p.trim())).map(sentence);
  if (list.length === 0) return '';
  let out = list[0]!;
  if (out.length > max) return clipWords(out, max);
  for (const p of list.slice(1)) if (out.length + 1 + p.length <= max) out = `${out} ${p}`;
  return out;
}

/** Shortens text at a word boundary and adds an ellipsis. */
export function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** "7:30 PM", "12 PM to 8 PM"; undefined when the time is not listed. */
export function shortTime(e: Pick<MetaEvent, 'timeTba' | 'startLocal' | 'endLocal' | 'data'>): string | undefined {
  if (e.timeTba) return undefined;
  const start = formatTime(e.startLocal.slice(11), true);
  return e.data.end ? `${start} to ${formatTime(e.endLocal.slice(11), true)}` : start;
}

export function whereOf(e: Pick<MetaEvent, 'location'>): string {
  return [e.location.name, e.location.town].filter(Boolean).join(', ');
}

/** "Live music by The Hoodoo Loungers", "West Coast Swing class with Carol Fraser", "Hustle dance with DJ Joe". */
export function whatOf(e: MetaEvent): string {
  const styles = listNames(e.styles.map((s) => s.name), 3);
  const acts = listNames(e.liveActs.map((a) => a.name), 3);
  const djs = listNames(e.djs.map((a) => a.name), 2);
  const teachers = listNames(e.instructors.map((a) => a.name), 2);
  switch (e.category) {
    case 'live-music':
      return acts ? `Live music by ${acts}` : 'Live music';
    case 'class-lesson':
      return `${styles ? `${styles} class` : 'Dance class'}${teachers ? ` with ${teachers}` : ''}${e.skillLabel ? ` (${lowerFirst(e.skillLabel)})` : ''}`;
    case 'lesson-party':
      return `${styles ? `${styles} lesson` : 'Group lesson'}${e.lessonLabel ? ` at ${e.lessonLabel}` : ''}, then a dance party${djs ? ` with DJ ${djs}` : acts ? ` with live music by ${acts}` : ''}`;
    case 'festival':
      return `${styles ? `${styles} festival` : 'Dance festival'}${acts ? ` with ${acts}` : ''}`;
    default:
      return `${styles ? `${styles} social dance` : 'Social dance'}${acts ? ` with live music by ${acts}` : djs ? ` with DJ ${djs}` : ''}${e.lessonLabel ? `. Lesson at ${e.lessonLabel}` : ''}`;
  }
}

/** "Dancing score 5 of 10: some party dancing" for music listings; nothing for dances and classes. */
export function dancingLine(e: Pick<MetaEvent, 'category' | 'dancing'>): string | undefined {
  if (e.category === 'class-lesson' || e.dancing.level === 'dance-event') return undefined;
  return `Dancing score ${e.dancing.outOf10} of 10: ${lowerFirst(e.dancing.label)}`;
}

export function priceWord(e: Pick<MetaEvent, 'price'>): string | undefined {
  if (!e.price.known) return undefined;
  return e.price.free ? 'Free' : e.price.label;
}

const organizerLine = (e: MetaEvent) => {
  const org = e.organizer?.data.name;
  return org && org !== e.location.name ? `Run by ${org}` : undefined;
};

/** Meta description for one event date. */
export function eventDescription(e: MetaEvent): string {
  const time = shortTime(e);
  const where = whereOf(e);
  const lead = `${e.status === 'cancelled' ? 'CANCELLED: ' : ''}${formatDateShort(e.date)}${time ? `, ${time}` : ''}${where ? ` at ${where}` : ''}`;
  const price = priceWord(e);
  return fitSentences([lead, whatOf(e), price, dancingLine(e), organizerLine(e)]);
}

/** "When" and "Where" for link previews. */
export function eventLabels(e: MetaEvent): MetaLabel[] {
  const time = shortTime(e);
  const where = whereOf(e);
  return [
    { label: 'When', data: `${formatDateShort(e.date)}${time ? ` · ${time}` : ''}` },
    ...(where ? [{ label: 'Where', data: where }] : priceWord(e) ? [{ label: 'Price', data: priceWord(e)! }] : []),
  ];
}

/** Multi-line text for "Copy text", WhatsApp, email, text messages and the phone share menu. */
export function eventShareBlurb(e: MetaEvent, url: string): string {
  const time = shortTime(e);
  const where = [e.location.name, e.location.town].filter(Boolean).join(', ');
  const styles = listNames(e.styles.map((s) => s.name), 3);
  const acts = listNames(e.liveActs.map((a) => a.name), 3);
  const djs = listNames(e.djs.map((a) => a.name), 2);
  const teachers = listNames(e.instructors.map((a) => a.name), 2);
  const who = acts ? `Live music: ${acts}` : djs ? `DJ: ${djs}` : teachers ? `Teacher: ${teachers}` : '';
  const dance = [styles, e.lessonLabel && e.category !== 'class-lesson' ? `lesson at ${e.lessonLabel}` : '', dancingLine(e) ?? ''].filter(Boolean).join(' · ');
  const price = priceWord(e);
  return [
    `${e.status === 'cancelled' ? 'CANCELLED: ' : ''}${e.title}`,
    `📅 ${formatDateLong(e.date).replace(/, \d{4}$/, '')}${time ? ` · ${time}` : ''}`,
    where && `📍 ${where}`,
    who && `🎵 ${who}`,
    dance && `💃 ${dance.charAt(0).toUpperCase()}${dance.slice(1)}`,
    price && `🎟️ ${price}`,
    url,
  ]
    .filter(Boolean)
    .join('\n');
}

/** One line for X (Twitter) and other short posts; the link is added separately. */
export function eventShortText(e: MetaEvent): string {
  const time = shortTime(e);
  const venueInTitle = Boolean(e.location.name && e.title.includes(e.location.name));
  const where = e.location.name && !venueInTitle ? ` at ${whereOf(e)}` : e.location.town ? ` in ${e.location.town}` : '';
  const when = `${formatDateShort(e.date)}${time ? (time.includes(' to ') ? `, ${time}` : ` at ${time}`) : ''}`;
  return `${e.status === 'cancelled' ? 'CANCELLED: ' : ''}${e.title}${where}, ${when}`;
}

/* ---------------- directory pages ---------------- */

export interface MetaUpcoming {
  title: string;
  date: string;
  category: EventCategory;
  location: { name?: string | undefined; town?: string | undefined };
}

const CATEGORY_PLURAL: Record<EventCategory, string> = {
  'social-dance': 'dances',
  'class-lesson': 'classes',
  'lesson-party': 'lesson + dance parties',
  'live-music': 'live music nights',
  festival: 'festivals',
};

/** "14 events coming up: live music nights and dances" */
export function upcomingSummary(events: MetaUpcoming[]): string {
  if (events.length === 0) return 'Nothing is listed right now';
  const counts = new Map<EventCategory, number>();
  for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const kinds = [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => CATEGORY_PLURAL[c]);
  return `${events.length} ${events.length === 1 ? 'event' : 'events'} coming up: ${listNames(kinds, 3)}`;
}

/** "Sat, Oct 10, Rock Night at The Paramount" */
export function formatNext(events: MetaUpcoming[]): string | undefined {
  const n = events[0];
  return n ? `${formatDateShort(n.date)}, ${n.title}` : undefined;
}

/** "Next: Sat, Oct 10, Rock Night at The Paramount, Huntington" */
export function nextLine(events: MetaUpcoming[], opts: { withPlace?: boolean } = {}): string | undefined {
  const n = events[0];
  if (!n) return undefined;
  const place = opts.withPlace ? [n.location.name, n.location.town].filter(Boolean).join(', ') : '';
  const title = place && n.title.includes(n.location.name ?? '\u0000') ? n.title : `${n.title}${place ? ` at ${place}` : ''}`;
  return `Next: ${formatDateShort(n.date)}, ${title}`;
}

export function entityLabels(events: MetaUpcoming[], extra?: MetaLabel): MetaLabel[] {
  const n = events[0];
  return [
    { label: 'Coming up', data: events.length ? `${events.length} ${events.length === 1 ? 'event' : 'events'}` : 'Nothing listed now' },
    n ? { label: 'Next', data: `${formatDateShort(n.date)}${n.location.town ? ` · ${n.location.town}` : ''}` } : extra,
  ].filter((x): x is MetaLabel => Boolean(x));
}

export function venueDescription(v: { name: string; town: string; kindLabel?: string | undefined; floorNote?: string | undefined }, events: MetaUpcoming[]): string {
  return fitSentences([
    `${v.name} in ${v.town}, NY${v.kindLabel ? ` (${lowerFirst(v.kindLabel)})` : ''}`,
    upcomingSummary(events),
    nextLine(events),
    v.floorNote,
    'Address, parking and directions',
  ]);
}

export function performerDescription(p: { name: string; typeLabel: string; genres: string[]; town?: string | undefined; dancingNote?: string | undefined }, events: MetaUpcoming[]): string {
  const kind = lowerFirst(p.typeLabel);
  return fitSentences([
    `${p.name}: ${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}${p.genres.length ? ` playing ${listNames(p.genres, 3)}` : ''}${p.town ? ` from ${p.town}` : ''}`,
    events.length ? `${events.length} upcoming Long Island ${events.length === 1 ? 'date' : 'dates'}` : 'No Long Island dates are listed right now',
    nextLine(events, { withPlace: true }),
    p.dancingNote,
  ]);
}

export function instructorDescription(p: { name: string; styles: string[]; town?: string | undefined }, events: MetaUpcoming[]): string {
  return fitSentences([
    `${p.name} teaches ${p.styles.length ? listNames(p.styles, 3) : 'dance'} on Long Island${p.town ? `, based in ${p.town}` : ''}`,
    upcomingSummary(events),
    nextLine(events, { withPlace: true }),
  ]);
}

export function organizerDescription(o: { name: string; typeLabel: string; town?: string | undefined; styles: string[] }, events: MetaUpcoming[]): string {
  return fitSentences([
    `${o.name}: ${lowerFirst(o.typeLabel)}${o.town ? ` in ${o.town}` : ''}${o.styles.length ? ` (${listNames(o.styles, 3)})` : ''}`,
    upcomingSummary(events),
    nextLine(events, { withPlace: true }),
    'Contact details and links',
  ]);
}

export function styleDescription(s: { name: string; summary: string }, events: MetaUpcoming[]): string {
  const classes = events.filter((e) => e.category === 'class-lesson').length;
  const dances = events.length - classes;
  return fitSentences([
    s.summary,
    events.length ? `${dances} ${dances === 1 ? 'dance' : 'dances'} and ${classes} ${classes === 1 ? 'class' : 'classes'} coming up in Nassau and Suffolk` : `No ${s.name} events are listed right now`,
    nextLine(events, { withPlace: true }),
  ]);
}

/** Meta description for a town page. */
export function townDescription(t: { name: string; county?: string | undefined; venues: number }, events: MetaUpcoming[]): string {
  return fitSentences([
    events.length ? `${upcomingSummary(events).replace(/^(\d+ events?) coming up/, `$1 coming up in ${t.name}, Long Island`)}` : `Nothing is listed in ${t.name}, Long Island right now`,
    nextLine(events, { withPlace: true }),
    t.venues ? `${t.venues} ${t.venues === 1 ? 'place' : 'places'} to dance${t.county ? ` in ${t.county} County` : ''}` : undefined,
    'Times, prices and directions',
  ]);
}

/** The first sentence of a town page: answers "where can I dance in X?" right away. */
export function townIntro(t: { name: string; county?: string | undefined }, events: MetaUpcoming[], series: number): string {
  if (!events.length) return `Nothing is listed in ${t.name} right now. Try the nearby towns below, or check back soon: we update the listings every day.`;
  const n = events[0]!;
  const where = n.location.name && !n.title.includes(n.location.name) ? ` at ${n.location.name}` : '';
  const kinds = upcomingSummary(events).replace(/^.*coming up: /, '');
  return `${events.length} ${events.length === 1 ? 'event is' : 'events are'} coming up in ${t.name}${t.county ? ` (${t.county} County)` : ''}, from ${series} ${series === 1 ? 'listing' : 'different listings'}: ${kinds}. The next one is ${n.title}${where} on ${formatDateLong(n.date).replace(/, \d{4}$/, '')}.`;
}