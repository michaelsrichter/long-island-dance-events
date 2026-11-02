import type { APIRoute } from 'astro';

/**
 * Everyone may read the public pages. Search engines and AI assistants are named on purpose: the
 * owner wants the listings to be easy to find in Google, Bing, ChatGPT, Copilot, Perplexity, Claude,
 * Apple and others (decision P48). Each named group repeats the private paths, because a crawler that
 * finds its own group ignores the "*" group.
 */
const SEARCH_AND_AI_BOTS = [
  'Googlebot',
  'Bingbot',
  'Applebot',
  'DuckDuckBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'GPTBot',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'Google-Extended',
  'Applebot-Extended',
  'Meta-ExternalAgent',
  'Amazonbot',
  'CCBot',
];
const PRIVATE = ['/admin/', '/api/', '/.auth/'];

export const GET: APIRoute = ({ site }) => {
  const allow = process.env.ALLOW_INDEXING === 'true';
  const rules = ['Allow: /', ...PRIVATE.map((p) => `Disallow: ${p}`)];
  const lines = allow
    ? [
        '# Long Island Dance Events: social dances, classes and live music on Long Island.',
        '# Search engines and AI assistants are welcome to read, quote and link to our public pages.',
        '# Summaries for AI assistants: /llms.txt and /llms-full.txt. Data: /events/upcoming.json',
        '',
        'User-agent: *',
        ...rules,
        '',
        ...SEARCH_AND_AI_BOTS.map((b) => `User-agent: ${b}`),
        ...rules,
        '',
        `Sitemap: ${new URL('/sitemap-index.xml', site).toString()}`,
      ]
    : ['# Pre-launch environment: indexing is disabled until DNS cutover.', 'User-agent: *', 'Disallow: /'];
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
