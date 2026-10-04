import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { pageKey } from '../lib/community';
import { buildNow, getAllEvents } from '../lib/content';

/**
 * Every page that accepts likes, comments and photos, with its address.
 * The API refuses keys that are not listed; the moderation page uses the addresses for links.
 */
export const GET: APIRoute = async () => {
  const [events, venues, organizers, instructors, performers, styles, occurrences] = await Promise.all([
    getCollection('events'),
    getCollection('venues'),
    getCollection('organizers'),
    getCollection('instructors'),
    getCollection('performers'),
    getCollection('styles'),
    getAllEvents(),
  ]);
  const now = buildNow().getTime();
  // For each event series: its next date, or its latest date if it has ended.
  const eventUrl = new Map<string, { url: string; t: number; upcoming: boolean }>();
  for (const o of occurrences) {
    const t = o.start.getTime();
    const upcoming = t >= now;
    const best = eventUrl.get(o.eventId);
    const better = !best || (upcoming && (!best.upcoming || t < best.t)) || (!upcoming && !best.upcoming && t > best.t);
    if (better) eventUrl.set(o.eventId, { url: o.url, t, upcoming });
  }
  const urls: Record<string, string> = {};
  for (const e of events) urls[pageKey('event', e.id)] = eventUrl.get(e.id)?.url ?? '/events/';
  for (const v of venues) urls[pageKey('venue', v.id)] = `/venues/${v.id}/`;
  for (const o of organizers) urls[pageKey('organizer', o.id)] = `/organizers/${o.id}/`;
  for (const i of instructors) urls[pageKey('instructor', i.id)] = `/instructors/${i.id}/`;
  for (const p of performers) urls[pageKey('performer', p.id)] = `/performers/${p.id}/`;
  for (const s of styles) urls[pageKey('style', s.id)] = `/styles/${s.id}/`;
  const keys = Object.keys(urls).sort();
  return new Response(JSON.stringify({ v: 1, keys, urls }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
