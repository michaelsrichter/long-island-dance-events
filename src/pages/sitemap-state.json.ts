import type { APIRoute } from 'astro';
import { buildNow } from '../lib/content';
import { sitemapEntries } from '../lib/sitemap';

/** Fingerprint and last-changed date of every page in the sitemaps (read by the next build and by IndexNow). */
export const GET: APIRoute = async ({ site }) => {
  const entries = await sitemapEntries(site!);
  const urls = Object.fromEntries(entries.map((e) => [e.loc, [e.hash, e.lastmod]]));
  return new Response(JSON.stringify({ v: 1, generated: buildNow().toISOString(), urls }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};