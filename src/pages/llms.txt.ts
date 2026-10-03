import type { APIRoute } from 'astro';
import { getEventGroups, getSettings } from '../lib/content';

/** Lightweight navigation aid for AI assistants. Facts only; no private or speculative content. */
export const GET: APIRoute = async ({ site }) => {
  const [s, { next }] = await Promise.all([getSettings(), getEventGroups()]);
  const u = (p: string) => new URL(p, site).toString();
  const prices = s.standardPrices.map((p) => `${p.label}: $${p.nonMember} non-members, $${p.member} members, $${p.student} students`).join('; ');
  const body = `# ${s.siteName} (${s.shortName})

> ${s.mission} Weekly swing dances every Tuesday at the Riverbend Community Hall, 631 Pulaski Road, Riverbend, NY: swing lesson at 7:30 PM, social dancing 8 to 10 PM. Beginners welcome; no partner needed.

Key facts:
- Standard admission: ${prices}.
- Membership: $${s.membershipFee} per person per year (${s.membershipYear}); join at the door of any Riverbend dance.
- ${s.hotlineLabel}: ${s.hotlinePhone}. Email: ${s.email}.
- Mailing address: ${s.legalName}, ${s.mailingAddress.line1}, ${s.mailingAddress.city}, ${s.mailingAddress.state} ${s.mailingAddress.postalCode}.
${next ? `- Next scheduled Riverbend dance: ${next.title}, ${next.dateLabel}${next.timeLabel ? ` at ${next.timeLabel}` : ''} (${u(next.url)}).\n` : ''}
## Events
- [Upcoming events](${u('/events/')}): every upcoming Riverbend dance with date, lesson time, price and venue, followed by community events run by other Riverbend Valley groups (clearly labeled "Community event").
- [Dance map](${u('/events/map/')}): every venue with upcoming dances, with addresses and directions.
- [Riverbend calendar feed (.ics)](${u('/events/club-events.ics')})
- [Community events calendar feed (.ics)](${u('/events/community-events.ics')})
- [RSS feed](${u('/events/rss.xml')}) (Riverbend dances only)
- [Past events](${u('/events/past/')})

## For new dancers
- [New to swing?](${u('/new-to-swing/')})
- [Lessons](${u('/lessons/')})
- [Frequently Asked Questions](${u('/faq/')})

## Riverbend Valley dance community
- [Dance groups and teachers](${u('/community/')}): other swing, blues, ballroom and Latin groups on Riverbend Valley, with contacts and classes. These are not run by Riverbend.
${s.facebookUrl ? `- [${s.facebookLabel ?? 'Riverbend Facebook group'}](${s.facebookUrl})\n` : ''}
## Organization
- [About Riverbend](${u('/about/')})
- [Membership](${u('/membership/')})
- [Venues](${u('/venues/')})
- [Bands, DJs and teachers](${u('/performers/')})
- [Contact](${u('/contact/')})
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
