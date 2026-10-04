import type { APIRoute } from 'astro';
import { buildNow, getAllEvents } from '../lib/content';
import { buildSavedIndex } from '../lib/saved-index';

/** Upcoming dates for every event series (read by the Saved events page). */
export const GET: APIRoute = async () => {
  const index = buildSavedIndex(await getAllEvents(), buildNow());
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
