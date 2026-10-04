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
  const names: Record<string, string> = {};
  for (const e of events) {
    urls[pageKey('event', e.id)] = eventUrl.get(e.id)?.url ?? '/events/';
    names[pageKey('event', e.id)] = e.data.title;
  }
  for (const v of venues) [urls[pageKey('venue', v.id)], names[pageKey('venue', v.id)]] = [`/venues/${v.id}/`, v.data.name];
  for (const o of organizers) [urls[pageKey('organizer', o.id)], names[pageKey('organizer', o.id)]] = [`/organizers/${o.id}/`, o.data.name];
  for (const i of instructors) [urls[pageKey('instructor', i.id)], names[pageKey('instructor', i.id)]] = [`/instructors/${i.id}/`, i.data.name];
  for (const p of performers) [urls[pageKey('performer', p.id)], names[pageKey('performer', p.id)]] = [`/performers/${p.id}/`, p.data.name];
  for (const s of styles) [urls[pageKey('style', s.id)], names[pageKey('style', s.id)]] = [`/styles/${s.id}/`, s.data.name];
  const keys = Object.keys(urls).sort();
  return new Response(JSON.stringify({ v: 1, keys, urls, names }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
