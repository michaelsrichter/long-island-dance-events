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

/** Event JSON-LD with only the facts we have. Every listing names its organizer and links to its source. */
export function eventJsonLd(e: ResolvedEvent, _s: Settings, site: URL | string, imageUrl?: string): Json {
  const url = abs(e.url, site);
  const offers =
    e.price.known && !e.price.free && e.data.price !== undefined
      ? [clean({ '@type': 'Offer', price: e.data.price.toFixed(2), priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: e.data.ticketUrl ?? url })]
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
