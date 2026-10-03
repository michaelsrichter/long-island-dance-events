/** Astro-side content access: loads collections and resolves event occurrences with their linked entities. */
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { cadenceOf, isUpcoming, partition, priceOf, priceText, resolveOccurrences, type Occurrence, type PriceInfo } from './event-core';
import type { CalendarEvent } from './calendar';
import { CATEGORY_LABELS, SKILL_LABELS, type County, type EventCategory } from './schemas';
import { addDays, dateInZone, formatDateLong, formatTime, weekdayOf, DEFAULT_TZ } from './time';
import type { ShareInput } from './share';
import { linksOf, type ExternalLink } from './links';

export type Venue = CollectionEntry<'venues'>;
export type Performer = CollectionEntry<'performers'>;
export type Instructor = CollectionEntry<'instructors'>;
export type Organizer = CollectionEntry<'organizers'>;
export type Style = CollectionEntry<'styles'>;
export type Source = CollectionEntry<'sources'>;
export type Settings = CollectionEntry<'settings'>['data'];

/** BUILD_NOW pins "now" for repeatable tests and screenshots. */
export function buildNow(): Date {
  const fixed = process.env.BUILD_NOW;
  return fixed ? new Date(fixed) : new Date();
}

export interface PersonRef {
  id: string;
  name: string;
  href: string;
  kind: 'instructor' | 'band' | 'dj' | 'solo';
  /** Their own website and social pages, website first. */
  links: ExternalLink[];
}

export interface ResolvedEvent extends Occurrence {
  url: string;
  category: EventCategory;
  categoryLabel: string;
  venue?: Venue | undefined;
  organizer?: Organizer | undefined;
  source?: Source | undefined;
  location: {
    name?: string | undefined;
    address?: string | undefined;
    town?: string | undefined;
    county?: County | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    directionsUrl?: string | undefined;
    appleMapsUrl?: string | undefined;
    full: string;
  };
  performers: PersonRef[];
  djs: PersonRef[];
  liveActs: PersonRef[];
  instructors: PersonRef[];
  styles: { id: string; name: string }[];
  price: PriceInfo;
  priceLine: string;
  skillLabel: string;
  /** Lowercase weekday, e.g. "tuesday" (for filters). */
  weekday: string;
  dateLabel: string;
  /** "7:30 PM" or "7:30 PM to 11 PM"; undefined when the time is not listed. */
  timeLabel?: string | undefined;
  lessonLabel?: string | undefined;
  /** Who to contact: the event's own details first, then the organizer's. */
  contact: { name?: string | undefined; phone?: string | undefined; email?: string | undefined; website?: string | undefined; links: ExternalLink[] };
  /** Organizer page, ticket page or more-info link, in that order. */
  moreInfoUrl?: string | undefined;
}

let cache: Promise<ResolvedEvent[]> | undefined;

export function directions(q: string) {
  const enc = encodeURIComponent(q);
  return { google: `https://www.google.com/maps/dir/?api=1&destination=${enc}`, apple: `https://maps.apple.com/?daddr=${enc}` };
}

export async function getSettings(): Promise<Settings> {
  const entry = await getEntry('settings', 'site');
  if (!entry) throw new Error('Missing src/content/settings/site.yml');
  return entry.data;
}

export async function lookup() {
  const [venues, performers, instructors, organizers, styles, sources] = await Promise.all([
    getCollection('venues'),
    getCollection('performers'),
    getCollection('instructors'),
    getCollection('organizers'),
    getCollection('styles'),
    getCollection('sources'),
  ]);
  return {
    venues: new Map(venues.map((v) => [v.id, v])),
    performers: new Map(performers.map((p) => [p.id, p])),
    instructors: new Map(instructors.map((p) => [p.id, p])),
    organizers: new Map(organizers.map((o) => [o.id, o])),
    styles: new Map(styles.map((s) => [s.id, s])),
    sources: new Map(sources.map((s) => [s.id, s])),
  };
}

export const performerRef = (p: Performer): PersonRef => ({ id: p.id, name: p.data.name, href: `/performers/${p.id}/`, kind: p.data.type, links: linksOf(p.data) });
export const instructorRef = (p: Instructor): PersonRef => ({ id: p.id, name: p.data.name, href: `/instructors/${p.id}/`, kind: 'instructor', links: linksOf(p.data) });

function timeLabelOf(o: Occurrence): string | undefined {
  if (o.timeTba) return undefined;
  const start = formatTime(o.startLocal.slice(11));
  return o.data.end ? `${start} to ${formatTime(o.endLocal.slice(11))}` : start;
}

export async function getAllEvents(): Promise<ResolvedEvent[]> {
  cache ??= (async () => {
    const [events, refs] = await Promise.all([getCollection('events'), lookup()]);
    const occurrences = resolveOccurrences(
      events.map((e) => ({ id: e.id, data: e.data })),
      { now: buildNow() },
    );
    return occurrences.map((o): ResolvedEvent => {
      const d = o.data;
      const where = `Event "${o.eventId}"`;
      const venue = d.venueId ? refs.venues.get(d.venueId) : undefined;
      if (d.venueId && !venue) throw new Error(`${where} refers to unknown venue "${d.venueId}".`);
      const organizer = d.organizerId ? refs.organizers.get(d.organizerId) : undefined;
      if (d.organizerId && !organizer) throw new Error(`${where} refers to unknown organizer "${d.organizerId}".`);
      const source = refs.sources.get(d.sourceId);
      if (!source) throw new Error(`${where} refers to unknown source "${d.sourceId}".`);
      const performers = d.performerIds.map((id) => {
        const p = refs.performers.get(id);
        if (!p) throw new Error(`${where} refers to unknown performer "${id}".`);
        return performerRef(p);
      });
      const instructors = d.instructorIds.map((id) => {
        const p = refs.instructors.get(id);
        if (!p) throw new Error(`${where} refers to unknown instructor "${id}".`);
        return instructorRef(p);
      });
      const styles = d.danceStyles.map((id) => {
        const s = refs.styles.get(id);
        if (!s) throw new Error(`${where} uses unknown dance style "${id}".`);
        return { id, name: s.data.name, order: s.data.order };
      });
      const v = venue?.data;
      const loc = {
        name: v?.name,
        address: v?.address,
        town: v?.town ?? d.town,
        county: v?.county,
        state: v?.state ?? 'NY',
        postalCode: v?.postalCode,
        latitude: v?.latitude,
        longitude: v?.longitude,
      };
      const full = [loc.name, loc.address, [loc.town, [loc.state, loc.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
      const dir = loc.address ? directions(full) : undefined;
      const price = priceOf(d);
      const od = organizer?.data;
      return {
        ...o,
        url: `/events/${o.slug}/`,
        category: d.category,
        categoryLabel: CATEGORY_LABELS[d.category],
        venue,
        organizer,
        source,
        location: { ...loc, directionsUrl: dir?.google, appleMapsUrl: dir?.apple, full },
        performers,
        djs: performers.filter((p) => p.kind === 'dj'),
        liveActs: performers.filter((p) => p.kind !== 'dj'),
        instructors,
        styles: styles.sort((a, b) => a.order - b.order).map(({ id, name }) => ({ id, name })),
        price,
        priceLine: priceText(price),
        skillLabel: SKILL_LABELS[d.skillLevel],
        weekday: weekdayOf(o.date),
        dateLabel: formatDateLong(o.date),
        timeLabel: timeLabelOf(o),
        lessonLabel: d.lessonTime ? formatTime(d.lessonTime) : undefined,
        contact: {
          name: od?.name,
          phone: d.contactPhone ?? od?.phone,
          email: d.contactEmail ?? od?.email,
          website: od?.website,
          links: od ? linksOf(od) : [],
        },
        moreInfoUrl: d.ticketUrl ?? d.infoUrl ?? od?.website,
        cadence: o.cadence ?? cadenceOf(d),
      };
    });
  })();
  return cache;
}

export interface DayGroup {
  date: string;
  label: string;
  events: ResolvedEvent[];
}

export function byDay(list: ResolvedEvent[]): DayGroup[] {
  const groups = new Map<string, ResolvedEvent[]>();
  for (const e of list) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  return [...groups].map(([date, events]) => ({ date, label: formatDateLong(date), events }));
}

/** Social dances, lesson + dance parties, live music and festivals: everything except classes. The site leads with these. */
export const isDance = (e: { category: string }): boolean => e.category !== 'class-lesson';

/** Saturday and Sunday of the coming weekend (Friday evening counts too), as YYYY-MM-DD. */
export function weekendRange(now: Date, tz = DEFAULT_TZ): { from: string; to: string } {
  const today = dateInZone(now, tz);
  const dow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekdayOf(today));
  const friday = addDays(today, dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow);
  return { from: dow === 0 || dow === 6 ? today : friday, to: addDays(friday, 2) };
}

export async function getEventGroups() {
  const all = await getAllEvents();
  const now = buildNow();
  const { upcoming, past } = partition(all, now);
  const today = dateInZone(now, DEFAULT_TZ);
  const weekend = weekendRange(now);
  return {
    all,
    upcoming,
    past,
    now,
    today,
    tonight: upcoming.filter((e) => e.date === today),
    weekend: upcoming.filter((e) => e.date >= weekend.from && e.date <= weekend.to),
    weekendRange: weekend,
    nextSevenDays: upcoming.filter((e) => e.date <= addDays(today, 6)),
  };
}

/** Upcoming events linked to an entity, e.g. every event at a venue. */
export async function upcomingFor(test: (e: ResolvedEvent) => boolean): Promise<ResolvedEvent[]> {
  const now = buildNow();
  return (await getAllEvents()).filter((e) => isUpcoming(e, now) && test(e));
}

export function calendarEventOf(e: ResolvedEvent, site: URL | string): CalendarEvent {
  const url = new URL(e.url, site).toString();
  const parts = [
    e.status === 'cancelled' ? `This event is cancelled. ${e.data.cancelledNote ?? ''}`.trim() : '',
    e.data.summary,
    e.lessonLabel ? `Lesson: ${e.lessonLabel}` : '',
    `Price: ${e.priceLine}`,
    [e.contact.name && `Organizer: ${e.contact.name}`, e.contact.phone, e.moreInfoUrl].filter(Boolean).join('\n'),
    'Listed by Long Island Dance Events. Please check with the organizer before you go.',
  ].filter(Boolean);
  return {
    uid: `${e.slug}@long-island-dance-events`,
    title: e.title,
    description: parts.join('\n'),
    location: e.location.full,
    url,
    start: e.start,
    end: e.end,
    allDayDate: e.timeTba ? e.date : undefined,
    timezone: e.timezone,
    status: e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    latitude: e.location.latitude,
    longitude: e.location.longitude,
  };
}

export function shareInputOf(e: ResolvedEvent, site: URL | string): ShareInput {
  return {
    title: e.title,
    dateLabel: e.dateLabel,
    timeLabel: e.timeLabel,
    venueName: e.location.name,
    town: e.location.town,
    url: new URL(e.url, site).toString(),
    status: e.status,
  };
}
