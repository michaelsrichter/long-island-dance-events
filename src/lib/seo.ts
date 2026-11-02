/** JSON-LD builders. Only facts present in content are emitted. */
import type { ResolvedEvent, Settings } from './content';

type Json = Record<string, unknown>;
const clean = <T extends Json>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)),
  ) as T;

export function abs(path: string, site: URL | string): string {
  return new URL(path, site).toString();
}

export function organizationJsonLd(s: Settings, site: URL | string): Json {
  return clean({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': abs('/#organization', site),
    name: s.siteName,
    alternateName: s.shortName,
    url: abs('/', site),
    logo: abs('/icons/icon-512.png', site),
    description: s.mission,
    email: s.email,
    areaServed: [{ '@type': 'AdministrativeArea', name: 'Nassau County, New York' }, { '@type': 'AdministrativeArea', name: 'Suffolk County, New York' }],
    sameAs: [s.facebookUrl, s.repoUrl].filter(Boolean),
  });
}

export function websiteJsonLd(s: Settings, site: URL | string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': abs('/#website', site),
    name: s.siteName,
    url: abs('/', site),
    inLanguage: 'en-US',
    publisher: { '@id': abs('/#organization', site) },
    potentialAction: { '@type': 'SearchAction', target: `${abs('/events/', site)}?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
  };
}

export function breadcrumbJsonLd(items: { name: string; href: string }[], site: URL | string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.href, site) })),
  };
}

/** A list of pages on this site (events at a venue, towns, ...), at most `max` items. */
export function itemListJsonLd(name: string, hrefs: string[], site: URL | string, max = 30): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: Math.min(hrefs.length, max),
    itemListElement: hrefs.slice(0, max).map((href, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(href, site) })),
  };
}

export function placeJsonLd(e: Pick<ResolvedEvent, 'location' | 'venue'>, site: URL | string): Json | undefined {
  const l = e.location;
  if (!l.name && !l.address && !l.town) return undefined;
  return clean({
    '@type': 'Place',
    '@id': e.venue ? abs(`/venues/${e.venue.id}/#place`, site) : undefined,
    name: l.name ?? l.town,
    telephone: e.venue?.data.phone,
    url: e.venue ? abs(`/venues/${e.venue.id}/`, site) : undefined,
    address: clean({ '@type': 'PostalAddress', streetAddress: l.address, addressLocality: l.town, addressRegion: l.state, postalCode: l.postalCode, addressCountry: 'US' }),
    geo: l.latitude !== undefined && l.longitude !== undefined ? { '@type': 'GeoCoordinates', latitude: l.latitude, longitude: l.longitude } : undefined,
  });
}

/** Directory pages: logo, photos and links that JSON-LD can describe. Images are absolute URLs. */
export interface EntityLdExtras {
  logo?: string | undefined;
  images?: string[];
  links?: { url: string }[];
}

const postalAddress = (a: { street?: string | undefined; town?: string | undefined; state?: string | undefined; postalCode?: string | undefined }) =>
  a.street || a.town ? clean({ '@type': 'PostalAddress', streetAddress: a.street, addressLocality: a.town, addressRegion: a.state ?? 'NY', postalCode: a.postalCode, addressCountry: 'US' }) : undefined;
const sameAsOf = (links: { url: string }[] | undefined) => (links?.length ? [...new Set(links.map((l) => l.url))] : undefined);

/** schema.org type for a kind of venue (falls back to Place). */
const VENUE_LD_TYPES: Record<string, string> = {
  bar: 'BarOrPub',
  restaurant: 'Restaurant',
  nightclub: 'NightClub',
  brewery: 'Brewery',
  winery: 'Winery',
  distillery: 'Distillery',
  theater: 'PerformingArtsTheater',
  'concert-hall': 'MusicVenue',
  park: 'Park',
  beach: 'Beach',
  library: 'Library',
  'lodge-hall': 'EventVenue',
  'dance-studio': 'LocalBusiness',
  school: 'School',
  'marina-club': 'LocalBusiness',
};
const ORG_LIKE = new Set(['BarOrPub', 'Restaurant', 'NightClub', 'Brewery', 'Winery', 'Distillery', 'Library', 'LocalBusiness', 'School']);

export function venueJsonLd(
  id: string,
  v: {
    name: string;
    address: string;
    town: string;
    state?: string | undefined;
    postalCode?: string | undefined;
    phone?: string | undefined;
    email?: string | undefined;
    hours?: string | undefined;
    website?: string | undefined;
    kind?: string | undefined;
    description?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    googleMapsUrl?: string | undefined;
  },
  site: URL | string,
  x: EntityLdExtras = {},
): Json {
  const type = (v.kind && VENUE_LD_TYPES[v.kind]) || 'Place';
  return clean({
    '@context': 'https://schema.org',
    '@type': type,
    '@id': abs(`/venues/${id}/#place`, site),
    name: v.name,
    description: v.description,
    url: abs(`/venues/${id}/`, site),
    telephone: v.phone,
    // Only businesses and schools (Organization types) can have an email in schema.org.
    email: ORG_LIKE.has(type) ? v.email : undefined,
    address: postalAddress({ street: v.address, town: v.town, state: v.state, postalCode: v.postalCode }),
    geo: v.latitude !== undefined && v.longitude !== undefined ? { '@type': 'GeoCoordinates', latitude: v.latitude, longitude: v.longitude } : undefined,
    hasMap: v.googleMapsUrl,
    logo: x.logo,
    image: x.images?.length ? x.images : x.logo ? [x.logo] : undefined,
    sameAs: sameAsOf(x.links),
  });
}

export function performerJsonLd(
  id: string,
  p: { name: string; type: string; genres?: string[]; description?: string | undefined; email?: string | undefined; phone?: string | undefined; town?: string | undefined },
  site: URL | string,
  x: EntityLdExtras = {},
): Json {
  const group = p.type === 'band';
  return clean({
    '@context': 'https://schema.org',
    '@type': group ? 'MusicGroup' : 'Person',
    '@id': abs(`/performers/${id}/#${group ? 'group' : 'person'}`, site),
    name: p.name,
    url: abs(`/performers/${id}/`, site),
    description: p.description,
    genre: group ? p.genres : undefined,
    jobTitle: group ? undefined : p.type === 'dj' ? 'DJ' : 'Musician',
    telephone: p.phone,
    email: p.email,
    homeLocation: !group && p.town ? { '@type': 'Place', name: `${p.town}, NY` } : undefined,
    foundingLocation: group && p.town ? { '@type': 'Place', name: `${p.town}, NY` } : undefined,
    logo: group ? x.logo : undefined,
    image: x.images?.length ? x.images : x.logo ? [x.logo] : undefined,
    sameAs: sameAsOf(x.links),
  });
}

export function instructorJsonLd(
  id: string,
  p: { name: string; description?: string | undefined; email?: string | undefined; phone?: string | undefined },
  site: URL | string,
  x: EntityLdExtras & { styles?: string[]; organizations?: { name: string; url: string }[] } = {},
): Json {
  return clean({
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': abs(`/instructors/${id}/#person`, site),
    name: p.name,
    url: abs(`/instructors/${id}/`, site),
    jobTitle: 'Dance teacher',
    description: p.description,
    knowsAbout: x.styles,
    worksFor: x.organizations?.map((o) => ({ '@type': 'Organization', name: o.name, url: o.url })),
    telephone: p.phone,
    email: p.email,
    image: x.images,
    sameAs: sameAsOf(x.links),
  });
}

export function organizerJsonLd(
  id: string,
  o: {
    name: string;
    website?: string | undefined;
    description?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
    address?: string | undefined;
    town?: string | undefined;
    postalCode?: string | undefined;
  },
  site: URL | string,
  x: EntityLdExtras = {},
): Json {
  return clean({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': abs(`/organizers/${id}/#organization`, site),
    name: o.name,
    url: o.website ?? abs(`/organizers/${id}/`, site),
    description: o.description,
    telephone: o.phone,
    email: o.email,
    address: o.address ? postalAddress({ street: o.address, town: o.town, postalCode: o.postalCode }) : undefined,
    logo: x.logo,
    image: x.images?.length ? x.images : undefined,
    sameAs: sameAsOf(x.links),
  });
}

/** Event JSON-LD with only the facts we have. Every listing names its organizer and links to its source. */
export function eventJsonLd(e: ResolvedEvent, _s: Settings, site: URL | string, imageUrl?: string): Json {
  const url = abs(e.url, site);
  const offers =
    e.price.known && !e.price.free && e.data.price !== undefined
      ? [clean({ '@type': 'Offer', price: e.data.price.toFixed(2), priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: e.data.ticketUrl ?? url })]
      : e.price.free
        ? [{ '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url }]
        : [];
  const sameAs = (p: { links?: { url: string }[] }) => (p.links?.length ? p.links.map((l) => l.url) : undefined);
  const performers = [
    ...e.liveActs.map((p) => ({ '@type': p.kind === 'band' ? 'MusicGroup' : 'Person', name: p.name, url: abs(p.href, site), sameAs: sameAs(p) })),
    ...e.djs.map((p) => ({ '@type': 'Person', name: p.name, url: abs(p.href, site), sameAs: sameAs(p) })),
    ...e.instructors.map((p) => ({ '@type': 'Person', name: p.name, url: abs(p.href, site), sameAs: sameAs(p) })),
  ].map((p) => clean(p as Json));
  return clean({
    '@context': 'https://schema.org',
    '@type': e.category === 'class-lesson' ? 'EducationEvent' : 'DanceEvent',
    '@id': `${url}#event`,
    name: e.title,
    description: e.data.summary,
    url,
    startDate: e.timeTba ? e.date : isoWithOffset(e.start, e.timezone),
    endDate: e.timeTba || !e.data.end ? undefined : isoWithOffset(e.end, e.timezone),
    eventStatus: e.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: placeJsonLd(e, site),
    image: imageUrl ? [imageUrl] : undefined,
    offers,
    isAccessibleForFree: e.price.free ? true : undefined,
    performer: performers,
    organizer: e.organizer
      ? clean({ '@type': 'Organization', name: e.organizer.data.name, url: e.organizer.data.website ?? abs(`/organizers/${e.organizer.id}/`, site), telephone: e.organizer.data.phone, email: e.organizer.data.email })
      : undefined,
    inLanguage: 'en-US',
  });
}

import { isoWithOffset } from './time';
export function faqJsonLd(faqs: { question: string; answer: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: stripMarkdown(f.answer) },
    })),
  };
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Safely serialise JSON-LD for embedding in a <script type="application/ld+json"> element. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
