import type { APIRoute } from 'astro';
import { calendarEventOf, getEventGroups, getSettings } from '../../lib/content';
import { buildIcs } from '../../lib/calendar';

/** Subscribable feed of community events listed on the site: upcoming plus the last 30 days. */
export const GET: APIRoute = async ({ site }) => {
  const [{ all, now }, settings] = await Promise.all([getEventGroups(), getSettings()]);
  const cutoff = now.getTime() - 30 * 86400000;
  const events = all.filter((e) => e.host === 'community' && e.end.getTime() >= cutoff).map((e) => calendarEventOf(e, site!));
  return new Response(buildIcs(events, { name: `${settings.region} community dance events (listed by ${settings.shortName})`, now }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
