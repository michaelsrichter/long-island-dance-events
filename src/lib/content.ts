/** Astro-side content access: loads collections and resolves events with their related records. */
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import {
  admissionOf,
  admissionText,
  hostOf,
  nextConfirmed,
  homeFirst,
  partition,
  resolveOccurrences,
  type Occurrence,
  type RawEvent,
  type RawSeries,
} from './event-core';
import type { CalendarEvent } from './calendar';
import { EVENT_TYPE_LABELS, EXPERIENCE_LABELS, type EventHost } from './schemas';
import { formatDateLong, formatTime, formatTimeRange } from './time';
import type { ShareInput } from './share';
import { linksOf, type ExternalLink } from './links';

export type Venue = CollectionEntry<'venues'>;
export type Person = CollectionEntry<'instructors'> | CollectionEntry<'performers'>;
export type Style = CollectionEntry<'styles'>;
export type Settings = CollectionEntry<'settings'>['data'];
export type Organizer = CollectionEntry<'organizers'>;

export function buildNow(): Date {
  const fixed = process.env.BUILD_NOW;
  return fixed ? new Date(fixed) : new Date();
}

export interface PersonRef {
  name: string;
  href?: string | undefined;
  kind?: 'instructor' | 'dj' | 'band' | undefined;
  /** Their own website and social pages, website first. */
  links: ExternalLink[];
}

export interface ContactInfo {
  name?: string | undefined;
  phone?: string | undefined;
  phoneAlt?: string | undefined;
  email?: string | undefined;
  website?: string | undefined;
  facebookUrl?: string | undefined;
  instagramUrl?: string | undefined;
  /** Organizer website and social pages, website first. */
  links: ExternalLink[];
}

export interface ResolvedEvent extends Occurrence {
  url: string;
  host: EventHost;
  organizerEntry?: Organizer | undefined;
  /** Who to contact about this event (event fields first, then the organizer). */
  contact: ContactInfo;
  infoUrl?: string | undefined;
  /** Where a community listing came from (attribution), e.g. Sample Community Calendar. */
  listing?: { name: string; url?: string | undefined } | undefined;
  venueEntry?: Venue | undefined;
  location: {
    name?: string | undefined;
    address?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    directionsUrl?: string | undefined;
    appleMapsUrl?: string | undefined;
    full: string;
  };
  instructors: PersonRef[];
  djs: PersonRef[];
  band?: PersonRef | undefined;
  styles: { id: string; name: string }[];
  typeLabels: string[];
  experienceLabel: string;
  partnerRequired: boolean;
  /** Only true when known: always for Riverbend events, and for community events whose listing says so. */
  noPartnerNeeded: boolean;
  beginnerFriendly: boolean;
  hasLesson: boolean;
  admission: ReturnType<typeof admissionOf>;
  admissionLine: string;
  dateLabel: string;
  timeLabel?: string | undefined;
  image?: ImageMetadata | undefined;
  imageAlt?: string | undefined;
  imageFrom?: 'event' | 'performer' | 'series' | undefined;
  /** Point to keep in view when the image is cropped ("x% y%"). */
  imageFocus?: string | undefined;
  /** Name of the teacher or band when the image is their profile photo. */
  imagePerson?: string | undefined;
  description: string;
}

let cache: Promise<ResolvedEvent[]> | undefined;

function directions(q: string) {
  const enc = encodeURIComponent(q);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${enc}`,
    apple: `https://maps.apple.com/?daddr=${enc}`,
  };
}

export async function getSettings(): Promise<Settings> {
  const entry = await getEntry('settings', 'site');
  if (!entry) throw new Error('Missing src/content/settings/site.yml');
  return entry.data;
}

async function lookup() {
  const [venues, instructors, performers, styles, organizers] = await Promise.all([
    getCollection('venues'),
    getCollection('instructors'),
    getCollection('performers'),
    getCollection('styles'),
    getCollection('organizers'),
  ]);
  return {
    organizers: new Map(organizers.map((o) => [o.id, o])),
    venues: new Map(venues.map((v) => [v.id, v])),
    people: new Map<string, Person>([...instructors.map((p) => [p.id, p] as const), ...performers.map((p) => [p.id, p] as const)]),
    styles: new Map(styles.map((s) => [s.id, s])),
  };
}

function personRef(people: Map<string, Person>, nameOrId: string): PersonRef {
  const p = people.get(nameOrId);
  if (p) return { name: p.data.name, href: `/performers/${p.id}/`, kind: p.data.kind, links: linksOf(p.data) };
  return { name: nameOrId, links: [] };
}

export async function getAllEvents(): Promise<ResolvedEvent[]> {
  cache ??= (async () => {
    const [events, series, refs] = await Promise.all([getCollection('events'), getCollection('series'), lookup()]);
    const now = buildNow();
    const rawEvents: RawEvent[] = events.map((e) => ({ id: e.id, data: e.data }));
    const rawSeries: RawSeries[] = series.map((s) => ({ id: s.id, data: s.data }));
    const seriesById = new Map(series.map((s) => [s.id, s]));
    const eventById = new Map(events.map((e) => [e.id, e]));
    const occurrences = resolveOccurrences(rawEvents, rawSeries, { now });

    return occurrences.map((o): ResolvedEvent => {
      const d = o.details;
      for (const id of d.danceStyles ?? []) {
        if (!refs.styles.has(id)) throw new Error(`Event "${o.slug}" uses unknown dance style "${id}".`);
      }
      const organizerEntry = d.organizer ? refs.organizers.get(d.organizer) : undefined;
      if (d.organizer && !organizerEntry) throw new Error(`Event "${o.slug}" refers to unknown organizer "${d.organizer}".`);
      const host = hostOf(o);
      const od = organizerEntry?.data;
      const contact: ContactInfo = {
        name: d.contactName ?? od?.name,
        phone: d.contactPhone ?? od?.phone,
        phoneAlt: d.contactPhone ? undefined : od?.phoneAlt,
        email: d.contactEmail ?? od?.email,
        website: od?.website,
        facebookUrl: d.facebookEventUrl ?? od?.facebookUrl,
        instagramUrl: od?.instagramUrl,
        links: linksOf({ website: od?.website, facebookUrl: d.facebookEventUrl ?? od?.facebookUrl, instagramUrl: od?.instagramUrl, moreLinks: od?.moreLinks }),
      };
      const venue = d.venue ? refs.venues.get(d.venue) : undefined;
      if (d.venue && !venue) throw new Error(`Event "${o.slug}" refers to unknown venue "${d.venue}".`);
      const loc = {
        name: venue?.data.name ?? (d.address ? undefined : undefined),
        address: d.address ?? venue?.data.address,
        city: d.city ?? venue?.data.city,
        state: d.state ?? venue?.data.state,
        postalCode: d.postalCode ?? venue?.data.postalCode,
        latitude: d.latitude ?? venue?.data.latitude,
        longitude: d.longitude ?? venue?.data.longitude,
      };
      const full = [loc.name, loc.address, [loc.city, [loc.state, loc.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join(', ');
      const dir = full ? directions(full) : undefined;
      const admission = admissionOf(d);
      const lesson = d.lessonStartTime;
      const timeLabel = o.timeTba ? undefined : formatTime(o.startLocal.slice(11));
      const source = o.source.eventId ? eventById.get(o.source.eventId) : undefined;
      const seriesEntry = o.source.seriesId ? seriesById.get(o.source.seriesId) : undefined;
      const description = (source?.body?.trim() || seriesEntry?.body?.trim() || '').trim();
      const bandEntry = d.bandName ? refs.people.get(d.bandName) : undefined;
      const instructorEntry = (d.instructorNames ?? []).map((n) => refs.people.get(n)).find((p) => p?.data.image);
      const ownImage = source?.data.featuredImage as ImageMetadata | undefined;
      const image =
        ownImage && source?.data.featuredImageAlt
          ? { src: ownImage, alt: source.data.featuredImageAlt, from: 'event' as const, focus: source.data.featuredImageFocus }
          : bandEntry?.data.image && bandEntry.data.imageAlt
            ? { src: bandEntry.data.image as ImageMetadata, alt: bandEntry.data.imageAlt, from: 'performer' as const, focus: bandEntry.data.imageFocus, credit: bandEntry.data.name }
            : instructorEntry?.data.image && instructorEntry.data.imageAlt
              ? { src: instructorEntry.data.image as ImageMetadata, alt: instructorEntry.data.imageAlt, from: 'performer' as const, focus: instructorEntry.data.imageFocus, credit: instructorEntry.data.name }
              : d.featuredImage && d.featuredImageAlt
                ? { src: d.featuredImage as ImageMetadata, alt: d.featuredImageAlt, from: 'series' as const, focus: d.featuredImageFocus }
                : undefined;
      return {
        ...o,
        url: `/events/${o.slug}/`,
        host,
        organizerEntry,
        contact,
        infoUrl: d.infoUrl,
        listing: d.sourceName ? { name: d.sourceName, url: d.sourceUrl } : undefined,
        venueEntry: venue,
        location: {
          ...loc,
          directionsUrl: d.directionsUrl ?? venue?.data.directionsUrl ?? dir?.google,
          appleMapsUrl: dir?.apple,
          full,
        },
        instructors: (d.instructorNames ?? []).map((n) => personRef(refs.people, n)),
        djs: (d.djNames ?? []).map((n) => personRef(refs.people, n)),
        band: d.bandName ? personRef(refs.people, d.bandName) : undefined,
        styles: (d.danceStyles ?? []).map((id) => ({ id, name: refs.styles.get(id)!.data.name })),
        typeLabels: (d.eventTypes ?? []).map((t) => EVENT_TYPE_LABELS[t]),
        experienceLabel: EXPERIENCE_LABELS[d.experienceLevel ?? 'all-levels'],
        partnerRequired: d.partnerRequired ?? false,
        noPartnerNeeded: host === 'home' ? !(d.partnerRequired ?? false) : d.partnerRequired === false,
        beginnerFriendly: d.beginnerFriendly ?? host === 'home',
        hasLesson: Boolean(lesson),
        admission,
        admissionLine: admissionText(admission),
        dateLabel: formatDateLong(o.date),
        timeLabel,
        image: image?.src,
        imageAlt: image?.alt,
        imageFrom: image?.from,
        imageFocus: image?.focus,
        imagePerson: image && 'credit' in image ? image.credit : undefined,
        description,
      };
    });
  })();
  return cache;
}

export async function getEventGroups() {
  const all = await getAllEvents();
  const now = buildNow();
  const { upcoming, past } = partition(all, now) as { upcoming: ResolvedEvent[]; past: ResolvedEvent[] };
  /** Next confirmed home-organization dance: always the first thing visitors see. */
  const next = nextConfirmed(all, now, 'home') as ResolvedEvent | undefined;
  const upcomingHome = upcoming.filter((e) => e.host === 'home');
  const upcomingCommunity = upcoming.filter((e) => e.host === 'community');
  return { all, upcoming, upcomingOrdered: homeFirst(upcoming), upcomingHome, upcomingCommunity, past, next, now };
}

export function scheduleLines(e: ResolvedEvent): { label: string; value: string }[] {
  const d = e.details;
  const lines: { label: string; value: string }[] = [];
  if (e.timeTba) return [{ label: 'Time', value: 'To be announced' }];
  if (d.doorsTime) lines.push({ label: 'Doors open', value: formatTime(d.doorsTime) });
  if (d.lessonStartTime) lines.push({ label: 'Lesson', value: formatTime(d.lessonStartTime) });
  if (d.danceStartTime) lines.push({ label: 'Open dancing', value: formatTimeRange(d.danceStartTime, d.danceEndTime) });
  if (lines.length === 0) lines.push({ label: 'Time', value: formatTimeRange(e.startLocal.slice(11), e.endLocal.slice(11)) });
  return lines;
}

export function calendarEventOf(e: ResolvedEvent, site: URL | string): CalendarEvent {
  const url = new URL(e.url, site).toString();
  const lines = scheduleLines(e).map((l) => `${l.label}: ${l.value}`);
  const parts = [
    e.status === 'cancelled' ? `This event is cancelled. ${e.cancelledMessage ?? ''}`.trim() : '',
    e.details.summary ?? '',
    lines.join('\n'),
    `Admission: ${e.admissionLine}`,
    [e.beginnerFriendly && 'Beginners welcome.', e.noPartnerNeeded && 'No partner needed.'].filter(Boolean).join(' '),
    e.host === 'home'
      ? 'Home organization event. See the website for current contact details.'
      : [e.contact.name && `Organizer: ${e.contact.name}`, e.contact.phone, e.contact.website ?? e.infoUrl, 'Community event listed by this site. Please confirm details with the organizer.']
          .filter(Boolean)
          .join('\n'),
  ].filter(Boolean);
  return {
    uid: `${e.slug}@example.org`,
    title: e.title,
    description: parts.join('\n'),
    location: e.location.full,
    url,
    start: e.start,
    end: e.end,
    allDayDate: e.timeTba ? e.date : undefined,
    timezone: e.timezone,
    status: e.status === 'cancelled' ? 'CANCELLED' : e.status === 'postponed' ? 'TENTATIVE' : 'CONFIRMED',
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
    town: e.location.city,
    url: new URL(e.url, site).toString(),
    status: e.status,
  };
}
