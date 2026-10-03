import type { APIRoute } from 'astro';
import { getEventGroups, getSettings } from '../lib/content';

/** Lightweight navigation aid for AI assistants. Facts only; no private or speculative content. */
export const GET: APIRoute = async ({ site }) => {
  const [s, { upcoming }] = await Promise.all([getSettings(), getEventGroups()]);
  const u = (p: string) => new URL(p, site).toString();
  const body = `# ${s.siteName}

> ${s.mission}

- Area: Nassau and Suffolk counties, Long Island, New York.
- ${upcoming.length} upcoming listings (social dances, classes, lesson + dance parties, live music), updated weekly from public calendars.
- Every event page names the organizer, links to the original listing, and asks visitors to confirm with the organizer.

## Find events
- [Upcoming events](${u('/events/')}): filter by day, dance style, town, county, price, level, venue, teacher, band or DJ. Filters are in the URL, e.g. ${u('/events/?when=weekend&style=west-coast-swing')}.
- [Month calendar](${u('/events/calendar/')})
- [Map](${u('/events/map/')})
- [Calendar feed (.ics)](${u('/events/all.ics')})
- [RSS feed](${u('/events/rss.xml')})

## Browse
- [Venues](${u('/venues/')})
- [Studios, clubs and organizers](${u('/organizers/')})
- [Teachers](${u('/instructors/')})
- [Bands and DJs](${u('/performers/')})
- [Dance styles explained](${u('/styles/')})

## About
- [About](${u('/about/')})
- [Where listings come from](${u('/sources/')})
- [Frequently Asked Questions](${u('/faq/')})
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
