/** Town pages ("Dancing in Huntington"): every Long Island place with a venue or an upcoming event. */
import { getCollection, type CollectionEntry } from 'astro:content';
import placesData from '../data/long-island-places.json';
import { buildNow, getAllEvents, type ResolvedEvent } from './content';
import { isUpcoming } from './event-core';
import { distanceKm, townSlug } from './places';
import { remember } from './freshness';

export { distanceKm, townHref, townSlug } from './places';

export interface Town {
  slug: string;
  name: string;
  county?: 'Nassau' | 'Suffolk' | undefined;
  /** Upcoming event dates in this town, soonest first. */
  events: ResolvedEvent[];
  venues: CollectionEntry<'venues'>[];
  lat?: number | undefined;
  lng?: number | undefined;
}

const COUNTY = new Map((placesData.places as { name: string; county: 'Nassau' | 'Suffolk' }[]).map((p) => [p.name.toLowerCase(), p.county]));

export function getTowns(): Promise<Town[]> {
  return towns();
}

const towns = remember(async () => {
  const now = buildNow();
  const [venues, all] = await Promise.all([getCollection('venues'), getAllEvents()]);
  const upcoming = all.filter((e) => isUpcoming(e, now));
  const towns = new Map<string, Town>();
  const get = (name: string) => {
    const slug = townSlug(name);
    let t = towns.get(slug);
    if (!t) {
      t = { slug, name, county: COUNTY.get(name.toLowerCase()), events: [], venues: [] };
      towns.set(slug, t);
    }
    return t;
  };
  for (const v of venues) {
    const t = get(v.data.town);
    t.venues.push(v);
    t.county ??= v.data.county;
  }
  for (const e of all) if (e.location.town) get(e.location.town);
  for (const e of upcoming) if (e.location.town) get(e.location.town).events.push(e);
  for (const t of towns.values()) {
    const pts = t.venues.filter((v) => v.data.latitude !== undefined && v.data.longitude !== undefined);
    if (pts.length) {
      t.lat = pts.reduce((a, v) => a + v.data.latitude!, 0) / pts.length;
      t.lng = pts.reduce((a, v) => a + v.data.longitude!, 0) / pts.length;
    }
    t.venues.sort((a, b) => a.data.name.localeCompare(b.data.name));
  }
  return [...towns.values()].sort((a, b) => a.name.localeCompare(b.name));
});

/** The closest towns that have something coming up. */
export function nearbyTowns(town: Town, all: Town[], n = 6): (Town & { km: number })[] {
  if (town.lat === undefined || town.lng === undefined) return [];
  const here = { lat: town.lat, lng: town.lng };
  return all
    .filter((t) => t.slug !== town.slug && t.events.length > 0 && t.lat !== undefined && t.lng !== undefined)
    .map((t) => ({ ...t, km: distanceKm(here, { lat: t.lat!, lng: t.lng! }) }))
    .filter((t) => t.km <= 25)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/** Number of different event series (a weekly class counts once). */
export const seriesCount = (events: { eventId: string }[]) => new Set(events.map((e) => e.eventId)).size;
