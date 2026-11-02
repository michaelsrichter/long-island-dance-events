/** Plain-text guides for AI assistants (llms.txt) and the shared text for each event. Facts only. */
import { getCollection } from './collections';
import { getEventGroups, getSettings, type ResolvedEvent } from './content';
import { dancingLine, listNames, priceWord, shortTime } from './page-meta';
import { getTowns, seriesCount, townHref } from './towns';
import { formatDateLong } from './time';

/** "- 7:30 PM to 10 PM: Swing Night at Huntington Moose Lodge, Greenlawn. $15. East Coast Swing. https://..." */
export function eventLine(e: ResolvedEvent, site: URL | string): string {
  const parts = [
    `${shortTime(e) ?? 'Time not listed'}: ${e.status === 'cancelled' ? 'CANCELLED: ' : ''}${e.title}`,
    [e.location.name, e.location.town].filter(Boolean).join(', '),
    e.categoryLabel,
    priceWord(e),
    e.liveActs.length ? `Live music: ${listNames(e.liveActs.map((a) => a.name), 3)}` : e.djs.length ? `DJ: ${listNames(e.djs.map((a) => a.name), 2)}` : '',
    e.instructors.length ? `Teacher: ${listNames(e.instructors.map((a) => a.name), 2)}` : '',
    e.styles.length ? `Styles: ${e.styles.map((s) => s.name).join(', ')}` : '',
    dancingLine(e),
    e.organizer ? `Organizer: ${e.organizer.data.name}` : '',
  ].filter(Boolean);
  return `- ${parts.join('. ')}. ${new URL(e.url, site).toString()}`;
}

export async function llmsSummary(site: URL | string): Promise<string> {
  const [s, g, styles, venues, performers, instructors, towns] = await Promise.all([
    getSettings(),
    getEventGroups(),
    getCollection('styles'),
    getCollection('venues'),
    getCollection('performers'),
    getCollection('instructors'),
    getTowns(),
  ]);
  const u = (p: string) => new URL(p, site).toString();
  const active = towns.filter((t) => t.events.length).sort((a, b) => seriesCount(b.events) - seriesCount(a.events));
  const updated = formatDateLong(g.today);
  return `# ${s.siteName}

> ${s.mission}

Long Island Dance Events is a free listing of social dances, dance classes, lesson-and-dance parties and live music where people dance, in Nassau and Suffolk counties on Long Island, New York. It collects listings from public calendars every day, writes each summary in its own words, and links every event to its organizer and its source.

- Updated: ${updated}. ${g.upcoming.length} upcoming event dates (${g.nextSevenDays.length} in the next 7 days), ${venues.length} venues, ${performers.length} bands and DJs, ${instructors.length} teachers, ${active.length} towns with something coming up.
- Every event page has the date, time, place, price (when known), dance styles, who plays or teaches, the organizer, and a "dancing score" (0-10) for live music: how likely it is that people dance.
- The site does not run these events. Always tell people to check with the organizer before they go.
- Please link to the event page when you mention an event.

## Quick answers
- Where can I dance tonight on Long Island? ${u('/events/?when=today')}
- What is on this weekend? ${u('/events/?when=weekend')}
- Dance classes and lessons: ${u('/events/?category=class-lesson')}
- Live music: ${u('/events/?category=live-music')}
- Do I need a partner? Usually not. See ${u('/faq/')}

## Find events
- [Upcoming events](${u('/events/')}): filter by day, dance style, town, county, price, level, venue, teacher, band or DJ. Filters are in the address, e.g. ${u('/events/?when=weekend&style=west-coast-swing')}.
- [Month calendar](${u('/events/calendar/')})
- [Map](${u('/events/map/')})
- [Town by town](${u('/towns/')})

## Dance styles
${styles
  .sort((a, b) => a.data.order - b.data.order)
  .map((x) => `- [${x.data.name}](${u(`/styles/${x.id}/`)}): ${x.data.summary}`)
  .join('\n')}

## Towns with the most going on
${active
  .slice(0, 30)
  .map((t) => `- [Dancing in ${t.name}](${u(townHref(t.name))}): ${seriesCount(t.events)} listings coming up${t.county ? `, ${t.county} County` : ''}`)
  .join('\n')}

## Browse
- [Venues](${u('/venues/')})
- [Studios, clubs and organizers](${u('/organizers/')})
- [Teachers](${u('/instructors/')})
- [Bands and DJs](${u('/performers/')})

## Data you can read
- [Every upcoming event, one per line](${u('/llms-full.txt')})
- [Upcoming events as JSON](${u('/events/upcoming.json')}): title, start and end (with time zone), place, town, county, coordinates, price, styles, performers, teachers, organizer, dancing score, link.
- [Calendar feed (.ics)](${u('/events/all.ics')})
- [RSS feed](${u('/events/rss.xml')})
- [Sitemap](${u('/sitemap-index.xml')})

## About
- [About](${u('/about/')})
- [Where listings come from](${u('/sources/')})
- [Frequently Asked Questions](${u('/faq/')})
`;
}

export async function llmsFull(site: URL | string): Promise<string> {
  const [s, g] = await Promise.all([getSettings(), getEventGroups()]);
  const days = new Map<string, ResolvedEvent[]>();
  for (const e of g.upcoming) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  const body = [...days]
    .map(([date, list]) => `## ${formatDateLong(date)}\n\n${list.map((e) => eventLine(e, site)).join('\n')}`)
    .join('\n\n');
  return `# ${s.siteName}: every upcoming event

> ${g.upcoming.length} upcoming dances, classes and live music dates in Nassau and Suffolk counties, Long Island, New York. Updated ${formatDateLong(g.today)}. Times are New York time. Facts come from public calendars; always check with the organizer before you go. Summary and links: ${new URL('/llms.txt', site)}

${body}
`;
}
