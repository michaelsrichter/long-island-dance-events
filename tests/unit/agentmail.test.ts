/**
 * Tests for the newsletter adapter (ingest/adapters/agentmail.ts). The email fixture and the
 * AgentMail API responses are fictional; no network is used. Update the golden file after an
 * intended change with: UPDATE_GOLDEN=1 npx vitest run tests/unit/agentmail.test.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventSchema } from '../../src/lib/schemas';
import { addressOf, adapter, NOT_AN_ISSUE, senderMatches, sendersFor, stripEmailChrome, textToHtml } from '../../ingest/adapters/agentmail';
import { collapse } from '../../ingest/lib/collapse';
import { Registry, ROOT } from '../../ingest/lib/registry';
import type { AdapterContext } from '../../ingest/lib/types';

const TODAY = '2026-10-03';
const FIX = join(ROOT, 'ingest', 'fixtures');
const real = Registry.load();

function registry() {
  return new Registry(
    new Map([['sample-pub', { name: 'Sample Pub', aliases: [], address: '5 Pretend Lane', town: 'Babylon', county: 'Suffolk' as const, state: 'NY' }]]),
    new Map([['dj-sample', { name: 'DJ Sample', type: 'dj' as const, aliases: [], genres: [] }]]),
    new Map(),
    new Map(),
    real.styles,
    new Map(),
    new Map(),
  );
}

function context(cacheDir: string, offline = true): AdapterContext {
  return {
    source: {
      id: 'sample-pub-newsletter',
      name: 'Sample Pub - newsletter',
      url: 'https://sample-pub.example/',
      type: 'api',
      adapter: 'agentmail',
      cadence: 'weekly',
      focus: 'music',
      enabled: true,
      defaults: { venueId: 'sample-pub', town: 'Babylon' },
      attribution: 'Test',
      rateLimitSeconds: 3,
      lastStatus: 'never',
    } as unknown as AdapterContext['source'],
    registry: registry(),
    fetcher: { cacheDir } as unknown as AdapterContext['fetcher'],
    today: TODAY,
    offline,
    log: () => {},
  };
}

const tmp: string[] = [];
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'lide-agentmail-'));
  tmp.push(d);
  return d;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('newsletter helpers', () => {
  it('matches senders by full address or by @domain', () => {
    expect(addressOf('Sample Pub <News@Sample-Pub.example>')).toBe('news@sample-pub.example');
    expect(senderMatches('Sample Pub <news@sample-pub.example>', ['@sample-pub.example'])).toBe(true);
    expect(senderMatches('news@sample-pub.example', ['news@sample-pub.example'])).toBe(true);
    expect(senderMatches('news@other.example', ['@sample-pub.example'])).toBe(false);
    expect(senderMatches('news@evil-sample-pub.example', ['news@sample-pub.example'])).toBe(false);
  });
  it('skips sign-up housekeeping emails', () => {
    for (const s of ['Please confirm your subscription', 'Welcome to the Sample Pub list!', 'Thanks for subscribing', 'Verify your email', 'SDLI Announcements: Subscription Confirmed'])
      expect(NOT_AN_ISSUE.test(s), s).toBe(true);
    for (const s of ['This month at Sample Pub', 'Live music this weekend', 'October dance calendar']) expect(NOT_AN_ISSUE.test(s), s).toBe(false);
  });
  it('drops the footer but keeps the body, even when the pre-header says "unsubscribe"', () => {
    const html = readFileSync(join(FIX, 'agentmail-newsletter.html'), 'utf8');
    const body = stripEmailChrome(html);
    expect(body).toContain('The Fictionals');
    expect(body).not.toContain('Our mailing address is');
    expect(body).not.toMatch(/View this email in your browser/);
  });
  it('turns a plain-text email into lines', () => {
    expect(textToHtml('Fri, Oct 16\nThe Fictionals <live>')).toBe('<html><body><p>Fri, Oct 16</p>\n<p>The Fictionals &lt;live&gt;</p></body></html>');
  });
  it('reads sender lists from the newsletters file', () => {
    const dir = tempDir();
    const file = join(dir, 'newsletters.json');
    writeFileSync(file, JSON.stringify({ newsletters: [{ sourceId: 'sample-pub', newsletterSourceId: 'sample-pub-newsletter', senders: ['News@Sample-Pub.example'] }] }));
    vi.stubEnv('LIDE_NEWSLETTERS_FILE', file);
    expect(sendersFor('sample-pub-newsletter')).toEqual(['news@sample-pub.example']);
    expect(sendersFor('other')).toEqual([]);
  });
});

describe('agentmail adapter', () => {
  it('turns a newsletter into neutral, dated events and skips trivia, food, deadlines and the footer (golden)', async () => {
    const ctx = context(tempDir());
    const doc = { url: 'https://sample-pub.example/', file: join(FIX, 'agentmail-newsletter.html'), contentType: 'text/html', meta: { issue: '2026-10-01' } };
    const result = await adapter.normalize([doc], ctx);
    const drafts = collapse(result.candidates);
    const golden = join(FIX, 'agentmail-newsletter.events.json');
    const actual = JSON.stringify({ outOfArea: result.outOfArea, skipped: result.skipped, drafts }, null, 2) + '\n';
    if (process.env.UPDATE_GOLDEN || !existsSync(golden)) writeFileSync(golden, actual);
    expect(actual).toBe(readFileSync(golden, 'utf8'));
    for (const d of drafts) expect(() => eventSchema.parse({ ...d.data, firstSeen: TODAY, lastSeen: TODAY })).not.toThrow();
    const dates = result.candidates.map((c) => c.date).sort();
    expect(dates).toEqual(['2026-10-16', '2026-10-17', '2026-10-24']);
    expect(result.candidates.every((c) => c.venueId === 'sample-pub')).toBe(true);
    // Links point to the source's public page, never to the email or its tracking links.
    expect(result.candidates.every((c) => !/example-list\.test/.test(`${c.infoUrl ?? ''} ${c.sourceUrl}`))).toBe(true);
  });

  it('reads issues from the inbox each run, skips confirmation emails, and never keeps emails in the ingest cache', async () => {
    const dir = tempDir();
    const file = join(dir, 'newsletters.json');
    writeFileSync(file, JSON.stringify({ newsletters: [{ sourceId: 'sample-pub', newsletterSourceId: 'sample-pub-newsletter', senders: ['@sample-pub.example'] }] }));
    vi.stubEnv('LIDE_NEWSLETTERS_FILE', file);
    vi.stubEnv('AGENTMAIL_API_KEY', 'test-key');
    vi.stubEnv('AGENTMAIL_INBOX', 'inbox@example.test');
    const cache = join(dir, 'ingest-cache');
    // A cache left by an older version is removed.
    mkdirSync(join(cache, 'agentmail'), { recursive: true });
    writeFileSync(join(cache, 'agentmail', 'old.html'), 'sent to inbox@example.test');
    const html = readFileSync(join(FIX, 'agentmail-newsletter.html'), 'utf8');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(url);
      expect(init.headers.authorization).toBe('Bearer test-key');
      if (/\/messages\?/.test(url))
        return Response.json({
          count: 3,
          messages: [
            { message_id: '<m1@sample>', from: 'Sample Pub <news@sample-pub.example>', subject: 'This month at Sample Pub', timestamp: '2026-10-01T14:00:00Z' },
            { message_id: '<m0@sample>', from: 'Sample Pub <news@sample-pub.example>', subject: 'Please confirm your subscription', timestamp: '2026-09-30T14:00:00Z' },
            { message_id: '<x@other>', from: 'someone@other.example', subject: 'Hello', timestamp: '2026-10-01T15:00:00Z' },
          ],
        });
      return Response.json({ html: `${html}<p>This email was sent to inbox@example.test</p>` });
    });
    const docs = await adapter.fetch(context(cache, false));
    expect(docs).toHaveLength(1);
    expect(docs[0]!.meta.issue).toBe('2026-10-01');
    expect(docs[0]!.url).toBe('https://sample-pub.example/');
    expect(calls.filter((c) => /\/messages\/[^?]+$/.test(c))).toHaveLength(1);
    // The API key and inbox are never part of what the run report shows.
    expect(JSON.stringify(docs)).not.toMatch(/test-key|inbox@example/);
    // The email is in a temporary folder for this run, not in the cache that GitHub Actions saves.
    const inCache = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String) : []);
    expect(inCache(cache)).toEqual([]);
    expect(docs[0]!.file.startsWith(cache)).toBe(false);
    expect((await adapter.normalize(docs, context(cache, false))).candidates.length).toBeGreaterThan(0);
    // The next run lists the inbox again; offline there is nothing to read.
    await adapter.fetch(context(cache, false));
    expect(calls.filter((c) => /\/messages\/[^?]+$/.test(c))).toHaveLength(2);
    expect(await adapter.fetch(context(cache, true))).toEqual([]);
    expect(inCache(cache)).toEqual([]);
  });

  it('is quiet (not a failure) when there is no issue to read', async () => {
    const dir = tempDir();
    const file = join(dir, 'newsletters.json');
    writeFileSync(file, JSON.stringify({ newsletters: [{ sourceId: 'sample-pub', newsletterSourceId: 'sample-pub-newsletter', senders: ['@sample-pub.example'] }] }));
    vi.stubEnv('LIDE_NEWSLETTERS_FILE', file);
    vi.stubEnv('AGENTMAIL_API_KEY', '');
    vi.stubEnv('AGENTMAIL_INBOX', '');
    expect(await adapter.fetch(context(dir, false))).toEqual([]);
    expect(adapter.quietWhenNoDocuments).toBe(true);
  });

  it('fails clearly when a newsletter source has no senders on file', async () => {
    const dir = tempDir();
    const file = join(dir, 'newsletters.json');
    writeFileSync(file, JSON.stringify({ newsletters: [] }));
    vi.stubEnv('LIDE_NEWSLETTERS_FILE', file);
    await expect(adapter.fetch(context(dir))).rejects.toThrow(/No sender addresses/);
  });
});
