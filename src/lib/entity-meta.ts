/**
 * Descriptions, link-preview pictures and share text for directory pages (venues, bands and DJs,
 * teachers, organizers, dance styles) and list pages. Used by the pages and by the picture endpoints,
 * so a page and its picture always say the same thing.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import type { EntityImageData } from './directory';
import { entityCard, type SocialCard } from './og';
import { entityLabels, eventShareBlurb, eventShortText, formatNext, instructorDescription, listNames, organizerDescription, performerDescription, styleDescription, townDescription, venueDescription, type MetaLabel } from './page-meta';
import { getTowns, type Town } from './towns';
import { BAND_RATING_LABELS, DANCE_TYPE_LABELS, ORGANIZER_TYPE_LABELS, PERFORMER_TYPE_LABELS, VENUE_FLOOR_LABELS } from './schemas';
import { buildNow, getAllEvents, hasShareImage, type ResolvedEvent } from './content';
import { isUpcoming } from './event-core';

export type EntityKind = 'venues' | 'performers' | 'instructors' | 'organizers' | 'styles' | 'towns';

export interface ShareImage {
  src: string;
  type: 'image/png' | 'image/jpeg';
  alt: string;
  width: number;
  height: number;
}

/** What a page tells link previews and the share menu. */
export interface PageShare {
  title: string;
  /** Absolute page address. */
  url: string;
  /** Multi-line text for Copy text, WhatsApp, email and text messages (ends with the address). */
  blurb: string;
  /** One line for X and other short posts (no address). */
  short: string;
  image: ShareImage;
  /** "venue:the-paramount" (for analytics). */
  key: string;
  /** A square picture to download for Instagram (event dates in the next three weeks). */
  download?: { href: string; filename: string };
}

export interface EntityMeta {
  description: string;
  labels: MetaLabel[];
  card: SocialCard;
  image: ShareImage;
  share: PageShare;
  photo?: EntityImageData | undefined;
  logo?: EntityImageData | undefined;
}

export const entityImagePath = (kind: EntityKind, id: string) => `/og/${kind}/${id}.jpg`;

const jpeg = (kind: EntityKind, id: string, alt: string): ShareImage => ({ src: entityImagePath(kind, id), type: 'image/jpeg', alt, width: 1200, height: 630 });

function entityBlurb(o: { title: string; place?: string | undefined; about?: string | undefined; events: ResolvedEvent[]; url: string }): string {
  const next = formatNext(o.events);
  return [
    o.title,
    o.about && `ℹ️ ${o.about}`,
    o.place && `📍 ${o.place}`,
    `📅 ${o.events.length ? `${o.events.length} ${o.events.length === 1 ? 'event' : 'events'} coming up` : 'No events listed right now'}${next ? `. Next: ${next}` : ''}`,
    o.url,
  ]
    .filter(Boolean)
    .join('\n');
}

function build(kind: EntityKind, id: string, o: { name: string; description: string; kicker: string; extra?: string | undefined; footer: string; place?: string | undefined; about?: string | undefined; events: ResolvedEvent[]; extraLabel?: MetaLabel; photo?: EntityImageData | undefined; logo?: EntityImageData | undefined }, site: URL | string): EntityMeta {
  const url = new URL(`/${kind}/${id}/`, site).toString();
  const alt = `${o.name}: ${o.kicker}. ${o.events.length ? `${o.events.length} events coming up` : 'No events listed right now'}.`;
  const image = jpeg(kind, id, alt);
  return {
    description: o.description,
    labels: entityLabels(o.events, o.extraLabel),
    card: entityCard({ kicker: o.kicker, title: o.name, events: o.events, extra: o.extra, footer: o.footer }),
    image,
    share: {
      title: o.name,
      url,
      blurb: entityBlurb({ title: o.name, place: o.place, about: o.about, events: o.events, url }),
      short: `${o.name} (${o.kicker}) on Long Island Dance Events`,
      image,
      key: `${kind.replace(/s$/, '')}:${id}`,
    },
    photo: o.photo,
    logo: o.logo,
  };
}

const styleNames = async (ids: string[]) => {
  const styles = new Map((await getCollection('styles')).map((s) => [s.id, s.data.name]));
  return ids.map((id) => styles.get(id)).filter((x): x is string => Boolean(x));
};
const eventStyles = (events: ResolvedEvent[]) => [...new Set(events.flatMap((e) => e.styles.map((s) => s.name)))];

export function venueMeta(venue: CollectionEntry<'venues'>, events: ResolvedEvent[], site: URL | string): EntityMeta {
  const v = venue.data;
  const floor = v.dancing && v.dancing.floor !== 'unknown' ? VENUE_FLOOR_LABELS[v.dancing.floor] : undefined;
  return build(
    'venues',
    venue.id,
    {
      name: v.name,
      description: v.seoDescription ?? venueDescription({ name: v.name, town: v.town, floorNote: floor }, events),
      kicker: `Venue · ${v.town}`,
      extra: floor,
      footer: 'Address, parking and directions',
      place: `${v.address}, ${v.town}`,
      events,
      extraLabel: { label: 'Town', data: v.town },
      photo: v.photos?.[0],
      logo: v.logo,
    },
    site,
  );
}

export function performerMeta(person: CollectionEntry<'performers'>, events: ResolvedEvent[], site: URL | string): EntityMeta {
  const p = person.data;
  const typeLabel = PERFORMER_TYPE_LABELS[p.type];
  const rating = p.dancing && p.dancing.rating !== 'unknown' ? BAND_RATING_LABELS[p.dancing.rating] : undefined;
  return build(
    'performers',
    person.id,
    {
      name: p.name,
      description: p.seoDescription ?? performerDescription({ name: p.name, typeLabel, genres: p.genres, town: p.town, dancingNote: rating }, events),
      kicker: `${typeLabel}${p.town ? ` · ${p.town}` : ''}`,
      extra: p.genres.length ? listNames(p.genres, 3) : rating,
      footer: rating ?? 'Where to see them next',
      about: [typeLabel, p.genres.length ? listNames(p.genres, 3) : ''].filter(Boolean).join(' · '),
      events,
      extraLabel: { label: 'Music', data: p.genres.length ? listNames(p.genres, 3) : typeLabel },
      photo: p.photos?.[0],
      logo: p.logo,
    },
    site,
  );
}

export async function instructorMeta(person: CollectionEntry<'instructors'>, events: ResolvedEvent[], site: URL | string): Promise<EntityMeta> {
  const p = person.data;
  const styles = await styleNames(p.styles);
  return build(
    'instructors',
    person.id,
    {
      name: p.name,
      description: p.seoDescription ?? instructorDescription({ name: p.name, styles, town: p.town }, events),
      kicker: `Dance teacher${p.town ? ` · ${p.town}` : ''}`,
      extra: styles.length ? listNames(styles, 3) : undefined,
      footer: 'Classes, lessons and contact details',
      about: styles.length ? `Teaches ${listNames(styles, 3)}` : undefined,
      events,
      extraLabel: styles.length ? { label: 'Teaches', data: listNames(styles, 3) } : undefined,
      photo: p.photos?.[0],
      logo: p.logo,
    },
    site,
  );
}

export async function organizerMeta(org: CollectionEntry<'organizers'>, events: ResolvedEvent[], site: URL | string): Promise<EntityMeta> {
  const o = org.data;
  const typeLabel = ORGANIZER_TYPE_LABELS[o.type];
  const styles = o.danceStyles.length ? await styleNames(o.danceStyles) : eventStyles(events);
  return build(
    'organizers',
    org.id,
    {
      name: o.name,
      description: o.seoDescription ?? organizerDescription({ name: o.name, typeLabel, town: o.town, styles }, events),
      kicker: `${typeLabel}${o.town ? ` · ${o.town}` : ''}`,
      extra: styles.length ? listNames(styles, 3) : undefined,
      footer: 'Dances, classes and contact details',
      about: [typeLabel, styles.length ? listNames(styles, 3) : ''].filter(Boolean).join(' · '),
      events,
      extraLabel: styles.length ? { label: 'Styles', data: listNames(styles, 3) } : undefined,
      photo: o.photos?.[0],
      logo: o.logo,
    },
    site,
  );
}

export function styleMeta(style: CollectionEntry<'styles'>, events: ResolvedEvent[], site: URL | string): EntityMeta {
  const s = style.data;
  return build(
    'styles',
    style.id,
    {
      name: s.name,
      description: styleDescription({ name: s.name, summary: s.summary }, events),
      kicker: `Dance style · ${DANCE_TYPE_LABELS[s.danceType]}`,
      extra: s.music ? `Music: ${s.music}` : undefined,
      footer: 'Where to dance it on Long Island',
      about: s.summary,
      events,
      extraLabel: { label: 'Kind', data: DANCE_TYPE_LABELS[s.danceType] },
      photo: s.photos?.[0],
    },
    site,
  );
}

export function townMeta(t: Town, site: URL | string): EntityMeta {
  const withPhoto = t.venues.find((v) => v.data.photos?.length);
  return build(
    'towns',
    t.slug,
    {
      name: `Dancing in ${t.name}`,
      description: townDescription({ name: t.name, county: t.county, venues: t.venues.length }, t.events),
      kicker: `Town${t.county ? ` · ${t.county} County` : ''}`,
      extra: t.venues.length ? `${t.venues.length} ${t.venues.length === 1 ? 'place' : 'places'} to dance` : undefined,
      footer: 'Dances, classes and live music',
      place: `${t.name}, NY`,
      events: t.events,
      extraLabel: t.county ? { label: 'County', data: t.county } : undefined,
      photo: withPhoto?.data.photos?.[0],
    },
    site,
  );
}

/** Every directory page with its upcoming events, for the picture endpoints. */
export async function allEntityMeta(site: URL | string): Promise<{ kind: EntityKind; id: string; meta: EntityMeta }[]> {
  const now = buildNow();
  const upcoming = (await getAllEvents()).filter((e) => isUpcoming(e, now));
  const [venues, performers, instructors, organizers, styles] = await Promise.all([
    getCollection('venues'),
    getCollection('performers'),
    getCollection('instructors'),
    getCollection('organizers'),
    getCollection('styles'),
  ]);
  const out: { kind: EntityKind; id: string; meta: EntityMeta }[] = [];
  for (const v of venues) out.push({ kind: 'venues', id: v.id, meta: venueMeta(v, upcoming.filter((e) => e.venue?.id === v.id), site) });
  for (const p of performers) out.push({ kind: 'performers', id: p.id, meta: performerMeta(p, upcoming.filter((e) => e.performers.some((x) => x.id === p.id)), site) });
  for (const p of instructors) out.push({ kind: 'instructors', id: p.id, meta: await instructorMeta(p, upcoming.filter((e) => e.instructors.some((x) => x.id === p.id)), site) });
  for (const o of organizers) out.push({ kind: 'organizers', id: o.id, meta: await organizerMeta(o, upcoming.filter((e) => e.organizer?.id === o.id), site) });
  for (const s of styles) out.push({ kind: 'styles', id: s.id, meta: styleMeta(s, upcoming.filter((e) => e.styles.some((x) => x.id === s.id)), site) });
  for (const t of await getTowns()) out.push({ kind: 'towns', id: t.slug, meta: townMeta(t, site) });
  return out;
}

/* ---------------- events ---------------- */

/** The picture for one event date: its own picture in the next three weeks, else the series picture. */
export function eventShareImage(e: ResolvedEvent, now: Date): ShareImage {
  const when = [e.dateLabel, e.timeLabel].filter(Boolean).join(', ');
  const where = [e.location.name, e.location.town].filter(Boolean).join(', ');
  if (hasShareImage(e, now)) return { src: `${e.url}social.png`, type: 'image/png', alt: `${e.title}. ${when}. ${where}.`, width: 1200, height: 630 };
  if (isUpcoming(e, now)) return { src: seriesImagePath(e.eventId), type: 'image/png', alt: `${e.title}. ${e.recurring && e.cadence ? e.cadence : when}. ${where}.`, width: 1200, height: 630 };
  return pageImage('events');
}

export const seriesImagePath = (eventId: string) => `/og/series/${eventId}.png`;

/** The first date of each event series that is past the three-week window (one series picture each). */
export function seriesNeedingImages(all: ResolvedEvent[], now: Date): ResolvedEvent[] {
  const seen = new Set<string>();
  const out: ResolvedEvent[] = [];
  for (const e of all) {
    if (!isUpcoming(e, now) || hasShareImage(e, now) || seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    out.push(e);
  }
  return out;
}

/* ---------------- list pages ---------------- */

export const PAGE_IMAGE_IDS = ['home', 'events', 'calendar', 'map', 'venues', 'performers', 'instructors', 'organizers', 'styles', 'faq', 'about', 'sources', 'past', 'towns'] as const;
export type PageImageId = (typeof PAGE_IMAGE_IDS)[number];

export function pageImage(id: PageImageId, alt?: string): ShareImage {
  return { src: `/og/page/${id}.png`, type: 'image/png', alt: alt ?? `Long Island Dance Events: ${PAGE_TITLES[id]}`, width: 1200, height: 630 };
}

export const PAGE_TITLES: Record<PageImageId, string> = {
  home: 'Find a place to dance on Long Island',
  events: 'Dance events on Long Island',
  calendar: 'Long Island dance calendar',
  map: 'Dance map of Long Island',
  venues: 'Places to dance on Long Island',
  performers: 'Bands and DJs for dancing',
  instructors: 'Dance teachers on Long Island',
  organizers: 'Dance studios, clubs and organizers',
  styles: 'Dance styles explained',
  faq: 'Questions and answers',
  about: 'About Long Island Dance Events',
  sources: 'Where our listings come from',
  past: 'Past dance events',
  towns: 'Dancing town by town',
};

/** Share text for a list page. */
export function pageShare(id: PageImageId, o: { title: string; description: string; path: string }, site: URL | string): PageShare {
  const url = new URL(o.path, site).toString();
  return { title: o.title, url, blurb: `${o.title}\n${o.description}\n${url}`, short: o.title, image: pageImage(id), key: `page:${id}` };
}

/** Share text and picture for one event date. */
export function eventShare(e: ResolvedEvent, site: URL | string, now: Date): PageShare {
  const url = new URL(e.url, site).toString();
  return {
    title: e.title,
    url,
    blurb: eventShareBlurb(e, url),
    short: eventShortText(e),
    image: eventShareImage(e, now),
    key: `event:${e.eventId}`,
    ...(hasShareImage(e, now) ? { download: { href: `${e.url}social-square.png`, filename: `${e.slug}.png` } } : {}),
  };
}
