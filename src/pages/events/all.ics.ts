import type { APIRoute } from 'astro';
import { calendarEventOf, getEventGroups, getSettings } from '../../lib/content';
import { buildIcs } from '../../lib/calendar';

/** Subscription feed with every upcoming listing. Calendar apps refresh it on their own. */
export const GET: APIRoute = async ({ site }) => {
  const [{ upcoming, now }, settings] = await Promise.all([getEventGroups(), getSettings()]);
  const body = buildIcs(upcoming.map((e) => calendarEventOf(e, site!)), { name: settings.siteName, now });
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
