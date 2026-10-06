/**
 * Sitemaps split by kind of page, with real "last changed" dates and pictures.
 *
 * A page's last-changed date comes from a fingerprint of the facts it shows (not the build time).
 * Each build reads the live site's /sitemap-state.json: when a page's fingerprint is unchanged it
 * keeps its old date; when it changed (or is new) it gets today's date. The same file tells the
 * IndexNow step (scripts/indexnow.mjs) which pages to announce to Bing and others.
 */
import { createHash } from 'node:crypto';
import { getCollection } from 'astro:content';
import { buildNow, getAllEvents, type ResolvedEvent } from './content';
import { isUpcoming } from './event-core';
import { dateInZone } from './time';
import { eventShareImage, entityImagePath, PAGE_IMAGE_IDS, pageImage } from './entity-meta';
import { entityImageUrls } from './entity-images';
import { getTowns, townHref } from './towns';
import { remember } from './freshness';

export const SITEMAP_GROUPS = ['pages', 'events', 'venues', 'people', 'styles', 'towns'] as const;
export type SitemapGroup = (typeof SITEMAP_GROUPS)[number];

export interface SitemapEntry {
  loc: string;
  group: SitemapGroup;
  hash: string;
  images: string[];
  lastmod: string;
}

/** [fingerprint, last-changed date] for each address. */
export type SitemapState = Record<string, [string, string]>;

const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('base64url').slice(0, 16);

/** Event facts that show on the page (not "last seen", match keys or review notes). */
function eventFacts(e: ResolvedEvent) {
  const { lastSeen: _ls, confidence: _c, matchKey: _m, reviewNotes: _r, embedding: _e, ...data } = e.data as Record<string, unknown>;
  return [e.slug, e.status, data, e.venue?.data.name, e.venue?.data.address, e.organizer?.data.name, e.performers.map((p) => p.name), e.instructors.map((p) => p.name), e.dancing.outOf10];
}

const strip = (d: Record<string, unknown>) => {
  const { reviewNotes: _r, evidence: _e, ...rest } = d;
  return rest;
};
/** Each repeating listing once, with its next date (what directory pages show). */
const nextDates = (events: ResolvedEvent[]) => [...new Map(events.map((e) => [e.eventId, e.date])).entries()];

async function previousState(): Promise<SitemapState> {
  const site = process.env.SITE_URL;
  if (!site || process.env.SITEMAP_STATE === 'off') return {};
  try {
    if (new URL(site).hostname === 'example.org') return {};
    const res = await fetch(new URL('/sitemap-state.json', site), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const body = (await res.json()) as { urls?: SitemapState };
    return body.urls ?? {};
  } catch {
    return {};
  }
}

let site_: URL | string = '';
const entries = remember(() => build(site_));

export function sitemapEntries(site: URL | string): Promise<SitemapEntry[]> {
  site_ = site;
  return entries();
}

async function build(site: URL | string): Promise<SitemapEntry[]> {
  const now = buildNow();
  const today = dateInZone(now);
  const abs = (p: string) => new URL(p, site).toString();
  const [prev, all, venues, performers, instructors, organizers, styles, faqs, pages, towns] = await Promise.all([
    previousState(),
    getAllEvents(),
    getCollection('venues'),
    getCollection('performers'),
    getCollection('instructors'),
    getCollection('organizers'),
    getCollection('styles'),
    getCollection('faqs'),
    getCollection('pages'),
    getTowns(),
  ]);
  const upcoming = all.filter((e) => isUpcoming(e, now));
  const out: Omit<SitemapEntry, 'lastmod'>[] = [];
  const add = (group: SitemapGroup, path: string, facts: unknown, images: string[] = []) => out.push({ loc: abs(path), group, hash: fingerprint(facts), images: images.map(abs) });

  // List pages: they change when the upcoming events change.
  const allNext = nextDates(upcoming);
  const pageFacts: Record<string, unknown> = {
    '/': allNext.slice(0, 200),
    '/events/': allNext,
    '/events/calendar/': allNext,
    '/events/map/': allNext,
    '/venues/': venues.map((v) => [v.id, v.data.name]),
    '/performers/': performers.map((p) => [p.id, p.data.name]),
    '/instructors/': instructors.map((p) => [p.id, p.data.name]),
    '/organizers/': organizers.map((o) => [o.id, o.data.name]),
    '/styles/': styles.map((s) => [s.id, s.data.summary]),
    '/towns/': towns.map((t) => [t.slug, t.events.length]),
    '/faq/': faqs.map((f) => f.data),
    '/about/': pages.find((p) => p.id === 'about')?.data,
    '/sources/': (await getCollection('sources')).map((s) => [s.id, s.data.name, s.data.enabled]),
    '/privacy/': pages.find((p) => p.id === 'privacy')?.data,
    '/community-rules/': pages.find((p) => p.id === 'community-rules')?.data,
    '/events/past/': all.filter((e) => !isUpcoming(e, now)).length,
  };
  const pageImageOf = (path: string) => {
    const id = path === '/' ? 'home' : path.split('/').filter(Boolean).at(-1) ?? 'home';
    return (PAGE_IMAGE_IDS as readonly string[]).includes(id) ? [pageImage(id as never).src] : [];
  };
  for (const [path, facts] of Object.entries(pageFacts)) add('pages', path, facts, pageImageOf(path));
  for (const month of [...new Set(upcoming.map((e) => e.date.slice(0, 7)))]) add('pages', `/events/calendar/${month}/`, nextDates(upcoming.filter((e) => e.date.startsWith(month))));

  // Event dates: only upcoming ones (past dates ask search engines not to list them).
  for (const e of upcoming) add('events', e.url, eventFacts(e), [eventShareImage(e, now).src]);

  const photosOf = async (d: Parameters<typeof entityImageUrls>[0]) => {
    const u = await entityImageUrls(d, new URL(site));
    return [...u.images, ...(u.logo ? [u.logo] : [])];
  };
  for (const v of venues) add('venues', `/venues/${v.id}/`, [strip(v.data), nextDates(upcoming.filter((e) => e.venue?.id === v.id))], [entityImagePath('venues', v.id), ...(await photosOf(v.data))]);
  for (const p of performers) add('people', `/performers/${p.id}/`, [strip(p.data), nextDates(upcoming.filter((e) => e.performers.some((x) => x.id === p.id)))], [entityImagePath('performers', p.id), ...(await photosOf(p.data))]);
  for (const p of instructors) add('people', `/instructors/${p.id}/`, [strip(p.data), nextDates(upcoming.filter((e) => e.instructors.some((x) => x.id === p.id)))], [entityImagePath('instructors', p.id), ...(await photosOf(p.data))]);
  for (const o of organizers) add('people', `/organizers/${o.id}/`, [strip(o.data), nextDates(upcoming.filter((e) => e.organizer?.id === o.id))], [entityImagePath('organizers', o.id), ...(await photosOf(o.data))]);
  for (const s of styles) add('styles', `/styles/${s.id}/`, [s.data, nextDates(upcoming.filter((e) => e.styles.some((x) => x.id === s.id)))], [entityImagePath('styles', s.id), ...(await photosOf(s.data))]);
  // Towns with nothing coming up are not listed (their pages ask search engines not to index them).
  for (const t of towns) if (t.events.length) add('towns', townHref(t.name), [t.name, nextDates(t.events), t.venues.map((v) => v.id)], [entityImagePath('towns', t.slug)]);

  return out.map((e) => ({ ...e, lastmod: prev[e.loc]?.[0] === e.hash ? prev[e.loc]![1] : today }));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function urlsetXml(entries: SitemapEntry[]): string {
  const body = entries
    .map(
      (e) =>
        `<url><loc>${esc(e.loc)}</loc><lastmod>${e.lastmod}</lastmod>${e.images
          .slice(0, 10)
          .map((i) => `<image:image><image:loc>${esc(i)}</image:loc></image:image>`)
          .join('')}</url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;
}

export function indexXml(site: URL | string, groups: { group: SitemapGroup; lastmod: string }[]): string {
  const body = groups.map((g) => `<sitemap><loc>${esc(new URL(`/sitemap-${g.group}.xml`, site).toString())}</loc><lastmod>${g.lastmod}</lastmod></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}
