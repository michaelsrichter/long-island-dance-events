import type { APIRoute, GetStaticPaths } from 'astro';
import { pageProps } from '../../../lib/page-props';
import { getCollection } from 'astro:content';
import { getEventGroups, getSettings } from '../../../lib/content';
import { PAGE_IMAGE_IDS, PAGE_TITLES, type PageImageId } from '../../../lib/entity-meta';
import { renderSocialPng, siteHost, type SocialCard } from '../../../lib/og';

/** Share pictures for the home page and list pages, with live counts. */
export const getStaticPaths: GetStaticPaths = () => PAGE_IMAGE_IDS.map((id) => ({ params: { id } }));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const GET: APIRoute = async (ctx) => {
  if (!(await pageProps(ctx, getStaticPaths))) return new Response('Not found', { status: 404 });
  const { params } = ctx;
  const id = params.id as PageImageId;
  const [s, g, venues, performers, instructors, organizers, styles, sources] = await Promise.all([
    getSettings(),
    getEventGroups(),
    getCollection('venues'),
    getCollection('performers'),
    getCollection('instructors'),
    getCollection('organizers'),
    getCollection('styles'),
    getCollection('sources'),
  ]);
  const n = g.upcoming.length;
  const places = new Set(g.upcoming.map((e) => e.venue?.id).filter(Boolean)).size;
  const towns = new Set(g.upcoming.map((e) => e.location.town).filter(Boolean)).size;
  const liveSources = sources.filter((x) => x.data.enabled !== false).length;
  const lines: Record<PageImageId, string[]> = {
    home: [plural(n, 'event', 'events') + ' coming up in Nassau and Suffolk', 'Social dances, classes and live music', 'Updated every day'],
    events: [plural(n, 'event', 'events') + ' coming up', 'Filter by day, dance style, town and price'],
    calendar: [plural(n, 'event', 'events') + ' in the next four months', 'See every dance, month by month'],
    map: [plural(places, 'place', 'places') + ' with events coming up', 'Find a dance near you'],
    venues: [plural(venues.length, 'place', 'places') + ' in Nassau and Suffolk', "Addresses, parking and what's on"],
    performers: [plural(performers.length, 'band, singer or DJ', 'bands, singers and DJs'), 'Where to see them next'],
    instructors: [plural(instructors.length, 'dance teacher', 'dance teachers'), 'Classes and lessons near you'],
    organizers: [plural(organizers.length, 'group', 'groups') + ' that run dances and classes', 'Studios, clubs and promoters'],
    styles: [styles.sort((a, b) => a.data.order - b.data.order).slice(0, 6).map((x) => x.data.name).join(' · '), 'What each dance is and where to find it'],
    faq: ['Do I need a partner? What should I wear?', 'What does it cost? Plain answers.'],
    about: ['A free list of dances, classes and live music', 'in Nassau and Suffolk counties'],
    sources: [plural(liveSources, 'public calendar', 'public calendars') + ', each one credited', 'How to fix, add or remove a listing'],
    past: ['Recent dances, classes and live music', 'on Long Island'],
    towns: [plural(towns, 'town', 'towns') + ' with dances or live music coming up', 'Find dancing near you'],
  };
  const card: SocialCard = {
    title: PAGE_TITLES[id],
    lines: lines[id],
    footer: id === 'home' ? 'Swing · Ballroom · Latin · Hustle · Tango · Country' : 'Social dances, classes and live music',
    brand: s.siteName,
    host: siteHost(),
  };
  const png = await renderSocialPng(card, 'og');
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
