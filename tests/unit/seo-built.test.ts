import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedUrls } from '../../scripts/indexnow.mjs';
import { townIntro } from '../../src/lib/page-meta';
import { townSlug, distanceKm } from '../../src/lib/places';

const dist = join(__dirname, '..', '..', 'dist');
const read = (p: string) => readFileSync(join(dist, p), 'utf8');
const pathOf = (u: string) => new URL(u).pathname;
const fileFor = (u: string) => {
  const p = pathOf(u);
  return join(dist, p.endsWith('/') ? `${p}index.html` : p);
};

describe('IndexNow', () => {
  it('announces only new or changed pages on our own host', () => {
    const before = { 'https://x.test/a/': ['h1', '2026-10-01'], 'https://x.test/b/': ['h2', '2026-10-01'] } as Record<string, [string, string]>;
    const after = { 'https://x.test/a/': ['h1', '2026-10-01'], 'https://x.test/b/': ['h3', '2026-10-05'], 'https://x.test/c/': ['h4', '2026-10-05'], 'https://other.test/d/': ['h5', '2026-10-05'] } as Record<string, [string, string]>;
    expect(changedUrls(before, after, 'x.test')).toEqual(['https://x.test/b/', 'https://x.test/c/']);
  });
});

describe('town helpers', () => {
  it('makes readable town addresses', () => {
    expect(townSlug('Port Jefferson Station')).toBe('port-jefferson-station');
    expect(townSlug('St. James')).toBe('st-james');
  });
  it('measures distance in km', () => {
    expect(Math.round(distanceKm({ lat: 40.87, lng: -73.43 }, { lat: 40.77, lng: -73.02 }))).toBe(36);
  });
  it('answers "where can I dance in X?" in the first sentence', () => {
    const events = [{ title: 'Swing Night', date: '2026-10-06', category: 'social-dance' as const, location: { name: 'Moose Lodge', town: 'Greenlawn' } }];
    expect(townIntro({ name: 'Greenlawn', county: 'Suffolk' }, events, 1)).toBe('1 event is coming up in Greenlawn (Suffolk County), from 1 listing: dances. The next one is Swing Night at Moose Lodge on Tuesday, October 6.');
    expect(townIntro({ name: 'Greenlawn' }, [], 0)).toMatch(/^Nothing is listed in Greenlawn right now/);
  });
});

describe.skipIf(!existsSync(join(dist, 'sitemap-index.xml')))('built site: search engines and AI assistants', () => {
  it('welcomes search engines and AI assistants but keeps private paths out', () => {
    const robots = read('robots.txt');
    for (const bot of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'GPTBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended']) expect(robots).toContain(`User-agent: ${bot}`);
    const groups = robots.split(/\n\s*\n/).filter((g) => g.includes('User-agent'));
    for (const g of groups) if (!g.includes('Disallow: /\n')) expect(g).toContain('Disallow: /admin/');
    expect(robots).toMatch(/^Sitemap: https?:\/\/.+\/sitemap-index\.xml$/m);
  });

  const sitemaps = () => [...read('sitemap-index.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1]!));
  const urls = (file: string) => [...read(file).matchAll(/<url><loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)].map((m) => ({ loc: m[1]!, lastmod: m[2]! }));

  it('splits sitemaps by kind of page, each with last-changed dates', () => {
    const maps = sitemaps();
    expect(maps).toEqual(expect.arrayContaining(['/sitemap-pages.xml', '/sitemap-events.xml', '/sitemap-venues.xml', '/sitemap-people.xml', '/sitemap-styles.xml', '/sitemap-towns.xml']));
    for (const m of maps) expect(urls(m.slice(1)).length, m).toBeGreaterThan(0);
  });
  it('lists only pages that exist and that search engines may index', () => {
    for (const m of sitemaps()) {
      for (const { loc } of urls(m.slice(1))) {
        const file = fileFor(loc);
        expect(existsSync(file), loc).toBe(true);
        const html = readFileSync(file, 'utf8');
        expect(html, loc).not.toMatch(/<meta name="robots" content="noindex/);
      }
    }
  });
  it('gives every event a picture, and lists the same events as the JSON feed', () => {
    const xml = read('sitemap-events.xml');
    const n = urls('sitemap-events.xml').length;
    expect((xml.match(/<image:loc>/g) ?? []).length).toBe(n);
    const feed = JSON.parse(read('events/upcoming.json'));
    expect(feed.events.length).toBe(n);
    expect(feed.events[0]).toMatchObject({ url: expect.stringMatching(/^https?:\/\//), title: expect.any(String), start: expect.any(String) });
  });
  it('has plain-text guides for AI assistants', () => {
    expect(read('llms.txt')).toMatch(/## Dance styles[\s\S]+## Towns with the most going on/);
    const full = read('llms-full.txt');
    expect(full.split('\n').filter((l) => l.startsWith('- ')).length).toBe(urls('sitemap-events.xml').length);
  });
  it('records a fingerprint for every listed page (for the next build and IndexNow)', () => {
    const state = JSON.parse(read('sitemap-state.json'));
    expect(Object.keys(state.urls).length).toBe(sitemaps().reduce((a, m) => a + urls(m.slice(1)).length, 0));
  });
});
