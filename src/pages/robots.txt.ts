import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const allow = process.env.ALLOW_INDEXING === 'true';
  const lines = allow
    ? ['User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /api/', '', `Sitemap: ${new URL('/sitemap-index.xml', site).toString()}`]
    : ['# Pre-launch environment: indexing is disabled until DNS cutover.', 'User-agent: *', 'Disallow: /'];
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
