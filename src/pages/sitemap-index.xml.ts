import type { APIRoute } from 'astro';
import { indexXml, sitemapEntries, SITEMAP_GROUPS } from '../lib/sitemap';

/** Sitemap index: one sitemap per kind of page (decision P48). */
export const GET: APIRoute = async ({ site }) => {
  const entries = await sitemapEntries(site!);
  const groups = SITEMAP_GROUPS.map((group) => ({ group, lastmod: entries.filter((e) => e.group === group).reduce((m, e) => (e.lastmod > m ? e.lastmod : m), '') }))
    .filter((g) => g.lastmod);
  return new Response(indexXml(site!, groups), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};