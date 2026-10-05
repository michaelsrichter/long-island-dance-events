import type { APIRoute, GetStaticPaths } from 'astro';
import { sitemapEntries, SITEMAP_GROUPS, urlsetXml, type SitemapGroup } from '../lib/sitemap';

export const getStaticPaths: GetStaticPaths = () => SITEMAP_GROUPS.map((group) => ({ params: { group } }));

export const GET: APIRoute = async ({ params, site }) => {
  const group = params.group as SitemapGroup;
  const entries = (await sitemapEntries(site!)).filter((e) => e.group === group);
  return new Response(urlsetXml(entries), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
