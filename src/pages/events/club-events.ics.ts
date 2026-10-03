import type { APIRoute } from 'astro';
import { calendarEventOf, getEventGroups, getSettings } from '../../lib/content';
import { buildIcs } from '../../lib/calendar';

/** Subscribable feed of the home organization's dances: upcoming events plus the last 30 days. Community events have their own feed. */
export const GET: APIRoute = async ({ site }) => {
  const [{ all, now }, settings] = await Promise.all([getEventGroups(), getSettings()]);
  const cutoff = now.getTime() - 30 * 86400000;
  const events = all.filter((e) => e.host === 'home' && e.end.getTime() >= cutoff).map((e) => calendarEventOf(e, site!));
  return new Response(buildIcs(events, { name: settings.siteName, now }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
