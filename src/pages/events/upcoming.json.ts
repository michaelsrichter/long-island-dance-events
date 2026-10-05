import type { APIRoute } from 'astro';
import { buildNow, getEventGroups, getSettings } from '../../lib/content';
import { isoWithOffset } from '../../lib/time';

/** Every upcoming event as JSON, for apps and AI assistants (linked from /llms.txt). */
export const GET: APIRoute = async ({ site }) => {
  const [s, { upcoming }] = await Promise.all([getSettings(), getEventGroups()]);
  const u = (p: string) => new URL(p, site).toString();
  const events = upcoming.map((e) => ({
    url: u(e.url),
    title: e.title,
    summary: e.data.summary,
    status: e.status,
    category: e.category,
    start: e.timeTba ? e.date : isoWithOffset(e.start, e.timezone),
    end: e.timeTba || !e.data.end ? null : isoWithOffset(e.end, e.timezone),
    timeListed: !e.timeTba,
    repeats: e.cadence ?? null,
    styles: e.styles.map((x) => x.name),
    place: {
      name: e.location.name ?? null,
      address: e.location.address ?? null,
      town: e.location.town ?? null,
      county: e.location.county ?? null,
      latitude: e.location.latitude ?? null,
      longitude: e.location.longitude ?? null,
      url: e.venue ? u(`/venues/${e.venue.id}/`) : null,
    },
    price: e.price.known ? { free: e.price.free, label: e.price.label ?? null } : null,
    performers: e.performers.map((p) => ({ name: p.name, kind: p.kind, url: u(p.href) })),
    teachers: e.instructors.map((p) => ({ name: p.name, url: u(p.href) })),
    organizer: e.organizer ? { name: e.organizer.data.name, url: u(`/organizers/${e.organizer.id}/`) } : null,
    dancingScore: e.category === 'class-lesson' ? null : e.dancing.outOf10,
    dancing: e.category === 'class-lesson' ? null : e.dancing.label,
    source: e.data.sourceName ?? e.source?.data.name ?? null,
  }));
  const body = {
    name: `${s.siteName}: upcoming events`,
    description: 'Social dances, classes and live music in Nassau and Suffolk counties, Long Island, New York. Facts from public calendars; always check with the organizer before you go.',
    homePage: u('/'),
    updated: buildNow().toISOString(),
    timeZone: 'America/New_York',
    count: events.length,
    events,
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};