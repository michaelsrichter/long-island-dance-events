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
    '@type': 'NGO',
    '@id': abs('/#organization', site),
    name: s.legalName,
    alternateName: [s.shortName, s.siteName],
    url: abs('/', site),
    logo: abs('/icons/icon-512.png', site),
    description: s.mission,
    email: s.email,
    telephone: s.hotlinePhone,
    nonprofitStatus: undefined,
    areaServed: { '@type': 'Place', name: s.region },
    address: {
      '@type': 'PostalAddress',
      streetAddress: s.mailingAddress.line1,
      addressLocality: s.mailingAddress.city,
      addressRegion: s.mailingAddress.state,
      postalCode: s.mailingAddress.postalCode,
      addressCountry: 'US',
    },
    sameAs: [s.facebookUrl, s.instagramUrl, s.youtubeUrl].filter(Boolean),
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
  };
}

export function breadcrumbJsonLd(items: { name: string; href: string }[], site: URL | string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.href, site) })),
  };
}

const STATUS_MAP: Record<string, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  soldOut: 'https://schema.org/EventScheduled',
  completed: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
};

export function placeJsonLd(e: Pick<ResolvedEvent, 'location' | 'venueEntry'>, site: URL | string): Json | undefined {
  const l = e.location;
  if (!l.name && !l.address) return undefined;
  return clean({
    '@type': 'Place',
    '@id': e.venueEntry ? abs(`/venues/${e.venueEntry.id}/#place`, site) : undefined,
    name: l.name ?? l.address,
    telephone: e.venueEntry?.data.phone,
    address: clean({
      '@type': 'PostalAddress',
      streetAddress: l.address,
      addressLocality: l.city,
      addressRegion: l.state,
      postalCode: l.postalCode,
      addressCountry: 'US',
    }),
    geo:
      l.latitude !== undefined && l.longitude !== undefined
        ? { '@type': 'GeoCoordinates', latitude: l.latitude, longitude: l.longitude }
        : undefined,
  });
}

export function eventJsonLd(e: ResolvedEvent, s: Settings, site: URL | string, imageUrl?: string): Json {
  const url = abs(e.url, site);
  const offers: Json[] = [];
  const add = (price: number | undefined, category: string) => {
    if (price === undefined) return;
    offers.push(
      clean({
        '@type': 'Offer',
        name: category,
        price: price.toFixed(2),
        priceCurrency: 'USD',
        availability: e.status === 'soldOut' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        url: e.details.registrationUrl ?? url,
      }),
    );
  };
  add(e.admission.nonMember, e.host === 'community' ? 'Admission' : 'Non-member admission');
  add(e.admission.member, e.host === 'community' ? 'Member admission' : 'Member admission');
  add(e.admission.student, 'Student admission');
  const sameAs = (p: { links?: { url: string }[] }) => (p.links?.length ? p.links.map((l) => l.url) : undefined);
  const performers = [
    ...(e.band ? [{ '@type': 'MusicGroup', name: e.band.name, url: e.band.href ? abs(e.band.href, site) : undefined, sameAs: sameAs(e.band) }] : []),
    ...e.djs.map((p) => ({ '@type': 'Person', name: p.name, sameAs: sameAs(p) })),
    ...e.instructors.map((p) => ({ '@type': 'Person', name: p.name, url: p.href ? abs(p.href, site) : undefined, sameAs: sameAs(p) })),
  ].map((p) => clean(p as Json));
  return clean({
    '@context': 'https://schema.org',
    '@type': 'DanceEvent',
    '@id': `${url}#event`,
    name: e.title,
    description: e.details.summary ?? (e.description ? e.description.slice(0, 300) : undefined),
    url,
    startDate: e.timeTba ? e.date : isoLocal(e.start, e.timezone),
    endDate: e.timeTba ? undefined : isoLocal(e.end, e.timezone),
    eventStatus: STATUS_MAP[e.status] ?? 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: placeJsonLd(e, site),
    image: imageUrl ? [imageUrl] : undefined,
    offers,
    isAccessibleForFree: e.admission.free ? true : undefined,
    performer: performers,
    organizer:
      e.host === 'home'
        ? { '@type': 'Organization', '@id': abs('/#organization', site), name: s.legalName, url: abs('/', site) }
        : e.organizerEntry
          ? clean({
              '@type': 'Organization',
              name: e.organizerEntry.data.name,
              url: e.organizerEntry.data.website ?? e.infoUrl,
              telephone: e.organizerEntry.data.phone,
              email: e.organizerEntry.data.email,
            })
          : undefined,
    inLanguage: 'en-US',
  });
}

import { isoWithOffset } from './time';
function isoLocal(d: Date, tz: string) {
  return isoWithOffset(d, tz);
}

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
