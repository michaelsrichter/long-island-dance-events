import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect, noHorizontalScroll } from './fixtures';

/** The review center with a mocked /api/review/* (the real API is tested in api/test/review.test.js). */

const LISTINGS = {
  sha: 'a'.repeat(40),
  today: '2026-10-03',
  venueIds: ['huntington-moose-lodge', 'stereo-garden-patchogue'],
  performerIds: ['dj-ray'],
  listings: [
    {
      id: '2026-10-16-despyre-live-music', title: 'Despyre at Stereo Garden', summary: 'Live music.', category: 'live-music', start: '2026-10-16T06:30', end: '', recurring: false, rule: '', cadence: '',
      venueId: 'stereo-garden-patchogue', town: '', performerIds: [], sourceId: 'stereo-garden-patchogue', sourceName: 'Stereo Garden', sourceUrl: 'https://example.org/stereo', infoUrl: '', ticketUrl: '',
      notes: 'Start time looks wrong (6:30 in the morning). Check the source.', firstSeen: '2026-10-01', reasons: [{ code: 'odd-time', said: '6:30 in the morning', suggest: '18:30' }], suggest: 'fix-time', ended: false, snoozedUntil: '',
    },
    {
      id: '2026-10-10-waterfalls-copy', title: 'Ballroom social at The Waterfalls', summary: 'A dance.', category: 'social-dance', start: '2026-10-10T19:00', end: '', recurring: false, rule: '', cadence: '',
      venueId: 'huntington-moose-lodge', town: '', performerIds: ['dj-ray'], sourceId: 'thedancecalendar', sourceName: 'The Dance Calendar', sourceUrl: 'https://example.org/tdc', infoUrl: '', ticketUrl: '',
      notes: "The organizer's or band's own calendar now lists this (waterfalls-saturdays).", firstSeen: '2026-10-02', reasons: [{ code: 'copy', of: 'waterfalls-saturdays' }], suggest: 'hide', ended: false, snoozedUntil: '',
    },
    {
      id: '2026-11-13-syosset-social', title: 'East Coast Swing social dance', summary: 'A dance.', category: 'social-dance', start: '2026-11-13T20:00', end: '', recurring: false, rule: '', cadence: '',
      venueId: '', town: 'Syosset', performerIds: [], sourceId: 'dancemanhattan', sourceName: 'Dance Manhattan', sourceUrl: 'https://example.org/dm', infoUrl: '', ticketUrl: '',
      notes: 'Venue not found in the listing.', firstSeen: '2026-10-03', reasons: [{ code: 'no-venue' }], suggest: 'fix-venue', ended: false, snoozedUntil: '',
    },
    {
      id: '2026-09-01-old', title: 'Old listing', summary: 'Old.', category: 'social-dance', start: '2026-09-01', end: '', recurring: false, rule: '', cadence: '',
      venueId: 'huntington-moose-lodge', town: '', performerIds: [], sourceId: 'x', sourceName: 'X', sourceUrl: 'https://example.org/x', infoUrl: '', ticketUrl: '',
      notes: 'No start time found.', firstSeen: '2026-08-20', reasons: [{ code: 'no-time' }], suggest: 'fix-time', ended: true, snoozedUntil: '',
    },
  ],
};
const COLLECTED = {
  open: {
    number: 41, url: 'https://github.com/x/y/pull/41', title: 'Collected events', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z', headSha: 'b'.repeat(40),
    mergeable: true, mergeableState: 'clean', commits: 3, changedFiles: 40, checks: 'passed', checkRuns: [{ name: 'CI', status: 'completed', conclusion: 'success', url: 'https://github.com/x' }],
    report: { latest: 'weekly,monthly on 2026-10-03', totals: '650 listed events, 4 waiting for review, 40 files changed.', sources: [{ name: "Ira's List", result: 'OK', found: 100, kept: 90, new: 12, updated: 3, unchanged: 75, ended: 0, missing: 1, review: 2 }], created: [{ kind: 'venues', id: 'new-bar-babylon' }], waiting: 2, notes: [] },
    filesUrl: 'https://github.com/x/y/pull/41/files', branchUrl: 'https://github.com/x/y/tree/ingest/updates',
  },
  last: null,
};
const SOURCES = {
  today: '2026-10-03',
  failures: [],
  runs: [{ id: 1, title: 'Collect events', event: 'schedule', status: 'completed', conclusion: 'success', createdAt: '2026-10-03T10:15:00Z', url: 'https://github.com/x/actions/runs/1' }],
  discovery: [{ number: 70, title: 'Monthly source check: November 2026', url: 'https://github.com/x/issues/70', createdAt: '2026-10-01T11:00:00Z', data: { newSites: [{ domain: 'mike.example', url: 'https://mike.example/', title: 'Swing nights', queries: ['swing'] }], robotsChanged: [], broken: [], noDates: [] } }],
  sources: [
    { id: 'broken-bar', name: 'Broken Bar', url: 'https://broken.example/', feedUrl: '', enabled: true, cadence: 'weekly', adapter: 'htmllist', catalogStatus: '', permission: null, lastScraped: '2026-10-03T09:00:00Z', lastStatus: 'error', lastMessage: 'HTTP 500', lastCounts: null, notes: '', group: 'broken', snoozedUntil: '' },
    { id: 'club-x', name: 'Club X', url: 'https://clubx.example/', feedUrl: '', enabled: false, cadence: 'weekly', adapter: 'htmllist', catalogStatus: 'needs-permission', permission: { status: 'needed', note: 'robots.txt says no' }, lastScraped: '', lastStatus: 'never', lastMessage: '', lastCounts: null, notes: 'Blocked by robots.txt.', group: 'permission', snoozedUntil: '' },
    { id: 'ok-one', name: 'Working One', url: 'https://ok.example/', feedUrl: '', enabled: true, cadence: 'daily', adapter: 'ical', catalogStatus: 'live', permission: null, lastScraped: '2026-10-03T09:00:00Z', lastStatus: 'ok', lastMessage: '', lastCounts: { found: 10, kept: 8, outOfArea: 0, needsReview: 0 }, notes: '', group: 'on', snoozedUntil: '' },
  ],
};
const MESSAGES = {
  messages: [
    { number: 5, title: 'Remove: my band', kind: 'remove-listing', labels: ['remove-listing'], author: 'band', createdAt: '2026-10-01T08:00:00Z', ageDays: 2, dueInDays: 5, comments: 0, url: 'https://github.com/x/issues/5', body: '', sections: { 'Page address': 'https://longisland.dance/performers/dj-ray/', 'What would you like us to do?': 'Stop listing all my events (opt out)' }, page: 'https://longisland.dance/performers/dj-ray/', snoozedUntil: '' },
  ],
  copilotTasks: [],
};

const OUTREACH_NONE = { canSend: true, reason: '', inbox: 'site@agentmail.to', problem: '', rules: { newRequestDays: 30, followupAfterDays: 14 }, threads: [], sent: [] };

async function mockApi(page: Page, { status = 200, github = { connected: true, installed: true, canSetUp: true }, outreachSummary = OUTREACH_NONE as unknown } = {}) {
  const posts: { url: string; body: any }[] = [];
  await page.route('**/api/review/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push({ url: url.pathname, body });
      if (url.pathname === '/api/review/listings') return route.fulfill({ json: { ok: true, commit: { sha: 'c'.repeat(40), url: 'https://github.com/x/commit/c' }, done: body.decisions.map((d: any) => ({ id: d.id, action: d.action, status: 'active' })), skipped: [], liveInMinutes: 10 } });
      if (url.pathname === '/api/review/outreach/send') return route.fulfill({ json: { sent: true, threadId: 't9', messageId: 'm9', recorded: true } });
      if (url.pathname === '/api/review/github/start') return route.fulfill({ json: { state: 's'.repeat(32), action: 'https://github.com/settings/apps/new?state=' + 's'.repeat(32), manifest: { name: 'Long Island Dance review center', redirect_url: 'https://longisland.dance/api/github-setup' } } });
      return route.fulfill({ json: { ok: true, issue: { number: 901, url: 'https://github.com/x/issues/901' } } });
    }
    if (status !== 200) return route.fulfill({ status, json: { error: 'x', message: 'nope' } });
    const data: Record<string, unknown> = {
      '/api/review/status': { github, posts: { count: 2, oldest: '2026-10-02T12:00:00Z' }, today: '2026-10-03', you: 'owner' },
      '/api/review/listings': LISTINGS,
      '/api/review/collected': COLLECTED,
      '/api/review/sources': SOURCES,
      '/api/review/messages': MESSAGES,
      '/api/review/outreach': outreachSummary,
      '/api/review/outreach/draft': { key: 'source:club-x', kind: 'permission', to: '', toFrom: '', subject: 'Can we list your events on Long Island Dance Events?', text: 'Hello,\n\nMay we list your public events?\n\n- dates\n- times\n\nThank you!\n\nMike Richter', rule: { ok: true }, canSend: true, reason: '', inbox: 'site@agentmail.to', lastSentAt: '' },
      '/api/review/outreach/thread': { threadId: 't1', key: 'source:broken-bar', subject: 'Can we list your events?', messages: [{ messageId: 'a', direction: 'sent', from: 'site@agentmail.to', to: 'info@broken.example', at: '2026-09-01T12:00:00Z', text: 'May we list your events?' }, { messageId: 'b', direction: 'received', from: 'Broken Bar <info@broken.example>', to: 'site@agentmail.to', at: '2026-09-02T12:00:00Z', text: 'Yes, go ahead!' }] },
      '/api/review/log': { entries: [{ at: '2026-10-03T12:00:00Z', actor: 'admin:owner@example.com', action: 'listing.publish', targetType: 'event', targetId: 'x', reason: 'publish' }] },
    };
    return route.fulfill({ json: data[url.pathname] ?? {} });
  });
  const post = (n: number) => ({ queueId: `c~venue:huntington-moose-lodge~000000000000000${n}_abcdefgh`, itemType: 'comment', key: 'venue:huntington-moose-lodge', itemId: `000000000000000${n}_abcdefgh`, reason: 'ai_gray', ai: null, at: '2026-10-02T12:00:00Z', status: 'pending', text: 'Great floor, see you there!', date: '', user: { id: 'user00001', name: 'Ann B', status: 'active', approved: 1, rejected: 0 }, flags: [] });
  await page.route('**/api/moderation/queue', (r) => r.fulfill({ json: { items: [post(1), post(2)] } }));
  return posts;
}

test.describe('review center', () => {
  test('signed-out visitors are asked to sign in; non-editors are told it is for editors', async ({ pinned: page }) => {
    await mockApi(page, { status: 401 });
    await page.goto('/moderate/');
    await expect(page.getByText('This page is for the site owner and editors.')).toBeVisible();
    await expect(page.locator('[data-review-app]')).toBeHidden();
    await page.unrouteAll();
    await mockApi(page, { status: 403 });
    await page.goto('/moderate/');
    await expect(page.getByText("isn't on the editor list")).toBeVisible();
    await expect(page.locator('[data-review-app]')).toBeHidden();
  });

  test('To do shows what waits, with counts on the tabs', async ({ pinned: page }) => {
    await mockApi(page);
    await page.goto('/moderate/');
    const todo = page.locator('[data-todo]');
    await expect(todo.getByRole('heading', { name: 'New events to publish' })).toBeVisible();
    await expect(todo.getByRole('heading', { name: 'Held listings' })).toBeVisible();
    await expect(todo.getByRole('heading', { name: 'Messages from visitors' })).toBeVisible();
    await expect(todo.getByRole('heading', { name: 'Community posts' })).toBeVisible();
    await expect(page.locator('[data-count="listings"]')).toHaveText('3', { timeout: 10_000 });
    await expect(page.locator('[data-count="messages"]')).toHaveText('1');
    await expect(page.getByText('1 request to remove a listing: 5 days left.')).toBeVisible();
  });

  test('held listings: plain reasons, the suggested fix in one click, Undo, and bulk hide', async ({ pinned: page }) => {
    const posts = await mockApi(page);
    await page.goto('/moderate/#listings');
    const panel = page.locator('#listings');
    await expect(panel.getByRole('heading', { name: 'Despyre at Stereo Garden' })).toBeVisible();
    await expect(panel.getByText('The start time looks wrong (6:30 in the morning)')).toBeVisible();
    await expect(panel.getByText('Already over (1): nothing to do')).toBeVisible();
    await panel.getByRole('button', { name: 'Change to 6:30 PM and publish' }).click();
    await expect(panel.getByText('Fixed and published. Live on the website in about 10 minutes.')).toBeVisible();
    expect(posts.at(-1)).toEqual({ url: '/api/review/listings', body: { decisions: [{ id: '2026-10-16-despyre-live-music', action: 'fix', fields: { time: '18:30' } }] } });
    await expect(page.locator('[data-count="listings"]')).toHaveText('2');
    await panel.getByRole('button', { name: 'Undo' }).click();
    expect(posts.at(-1)!.body.decisions[0]).toMatchObject({ id: '2026-10-16-despyre-live-music', action: 'undo', commit: 'c'.repeat(40) });

    page.on('dialog', (d) => d.accept());
    await panel.getByRole('checkbox', { name: 'Choose: Ballroom social at The Waterfalls' }).check();
    await panel.getByRole('checkbox', { name: 'Choose: East Coast Swing social dance' }).check();
    await page.getByRole('region', { name: 'Chosen listings' }).getByRole('button', { name: 'Hide chosen' }).click();
    await expect.poll(() => posts.at(-1)?.body.decisions?.map((d: any) => d.action)).toEqual(['hide', 'hide']);
  });

  test('fix form: pick the venue for a listing that has none', async ({ pinned: page }) => {
    const posts = await mockApi(page);
    await page.goto('/moderate/#listings');
    const card = page.locator('#listings li.review-card', { has: page.getByRole('heading', { name: 'East Coast Swing social dance' }) });
    await card.getByRole('button', { name: 'Pick the venue…' }).click();
    await card.getByLabel('Venue', { exact: true }).selectOption('huntington-moose-lodge');
    await card.getByRole('button', { name: 'Save and publish' }).click();
    await expect.poll(() => posts.at(-1)?.body).toEqual({ decisions: [{ id: '2026-11-13-syosset-social', action: 'fix', fields: { venueId: 'huntington-moose-lodge' }, note: '' }] });
  });

  test('new events: Publish now sends the exact update the owner saw', async ({ pinned: page }) => {
    const posts = await mockApi(page);
    await page.goto('/moderate/#publish');
    const panel = page.locator('#publish');
    await expect(panel.getByText('Checks passed.')).toBeVisible();
    await expect(panel.getByText('12 new events, 3 changed events, 0 events ended')).toBeVisible();
    page.on('dialog', (d) => d.accept());
    await panel.getByRole('button', { name: 'Publish now' }).click();
    await expect(panel.getByText('Published. Live on the website in about 10 minutes.')).toBeVisible();
    expect(posts.find((p) => p.url === '/api/review/collected')!.body).toEqual({ number: 41, headSha: 'b'.repeat(40) });
  });

  test('sources and messages: record "I asked", say "Not useful", reply and close', async ({ pinned: page }) => {
    const posts = await mockApi(page);
    await page.goto('/moderate/#sources');
    const sources = page.locator('#sources');
    await expect(sources.getByRole('heading', { name: 'Stopped working (1)' })).toBeVisible();
    await expect(sources.getByRole('heading', { name: 'New websites found (1)' })).toBeVisible();
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Emailed the club' : undefined));
    await sources.getByText('Ask for permission (1)').click();
    await sources.getByRole('button', { name: 'I asked' }).click();
    await expect.poll(() => posts.at(-1)?.body).toEqual({ decisions: [{ id: 'club-x', action: 'permission', status: 'requested', note: 'Emailed the club' }] });
    await sources.getByRole('button', { name: 'Not useful' }).click();
    await expect.poll(() => posts.at(-1)?.url).toBe('/api/review/candidate');

    await page.getByRole('link', { name: /^Messages/ }).click();
    const messages = page.locator('#messages');
    await expect(messages.getByText('Remove a listing (answer within 7 days)')).toBeVisible();
    await expect(messages.getByText('5 days left to answer')).toBeVisible();
    await messages.getByRole('button', { name: 'Send reply and close' }).click();
    await expect.poll(() => posts.at(-1)?.body).toMatchObject({ number: 5, action: 'close', reason: 'completed' });
  });

  test('permission email: review, change, confirm, then send through the site inbox', async ({ pinned: page }) => {
    const posts = await mockApi(page);
    await page.goto('/moderate/#sources');
    const sources = page.locator('#sources');
    await sources.getByText('Ask for permission (1)').click();
    await sources.getByRole('button', { name: 'Review and send the email…' }).click();
    const form = sources.locator('form.review-form');
    await expect(form.getByLabel('Subject')).toHaveValue('Can we list your events on Long Island Dance Events?');
    await form.getByLabel('To', { exact: true }).fill('events@clubx.example');
    await form.getByText('See how it will look').click();
    await expect(form.locator('.review-email-preview li')).toHaveCount(2);
    page.on('dialog', (d) => {
      expect(d.message()).toBe('Send this email to events@clubx.example?');
      return d.accept();
    });
    await form.getByRole('button', { name: 'Send…' }).click();
    await expect(sources.getByText('Sent to events@clubx.example. Their answer will show here.', { exact: false })).toBeVisible();
    expect(posts.at(-1)).toMatchObject({ url: '/api/review/outreach/send', body: { key: 'source:club-x', kind: 'permission', to: 'events@clubx.example', override: false, saveContact: false } });
  });

  test('answers to permission emails show under the source, with one-click outcomes', async ({ pinned: page }) => {
    const summary = { ...OUTREACH_NONE, threads: [{ threadId: 't1', key: 'source:club-x', subject: 'Can we list your events?', updatedAt: '2026-10-02T12:00:00Z', hasReply: true, unread: true, messages: 2 }], sent: [{ key: 'source:club-x', lastSentAt: '2026-09-01T12:00:00Z', firstSentAt: '2026-09-01T12:00:00Z', followups: 0, count: 1, threadId: 't1' }] };
    const posts = await mockApi(page, { outreachSummary: summary });
    await page.goto('/moderate/#sources');
    const sources = page.locator('#sources');
    await expect(sources.getByRole('heading', { name: 'Waiting for an answer (1)' })).toBeVisible();
    await sources.getByText('Emails (1): new answer!').click();
    await expect(sources.getByText('Yes, go ahead!')).toBeVisible();
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'They said yes by email' : undefined));
    await sources.getByRole('button', { name: 'They said yes: switch it on' }).click();
    await expect.poll(() => posts.at(-1)?.body).toEqual({ decisions: [{ id: 'club-x', action: 'permission', status: 'granted', note: 'They said yes by email' }, { id: 'club-x', action: 'enable', note: 'Permission granted' }] });
  });

  test('one-time setup posts the app manifest to GitHub', async ({ pinned: page }) => {
    await mockApi(page, { github: { connected: false, installed: false, canSetUp: true } });
    let manifest = '';
    await page.route('https://github.com/settings/apps/new**', (r) => {
      manifest = new URLSearchParams(r.request().postData() || '').get('manifest') || '';
      return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>GitHub</title><h1>Create GitHub App</h1>' });
    });
    await page.goto('/moderate/');
    await expect(page.getByRole('heading', { name: 'One-time setup: connect to GitHub' })).toBeVisible();
    await page.getByRole('button', { name: 'Connect to GitHub' }).click();
    await expect(page.getByRole('heading', { name: 'Create GitHub App' })).toBeVisible();
    expect(JSON.parse(manifest)).toMatchObject({ name: 'Long Island Dance review center', redirect_url: 'https://longisland.dance/api/github-setup' });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious accessibility problems on any tab (${scheme})`, async ({ pinned: page }) => {
      await mockApi(page);
      await page.emulateMedia({ colorScheme: scheme });
      for (const tab of ['todo', 'listings', 'publish', 'sources', 'messages', 'posts', 'log']) {
        await page.goto(`/moderate/#${tab}`);
        await expect(page.locator(`#${tab}`)).toBeVisible();
        await expect(page.locator(`#${tab} .spinner:visible`)).toHaveCount(0, { timeout: 10_000 });
        const results = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${tab}: ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`)).toEqual([]);
      }
    });
  }

  test('fits a 320-pixel phone without sideways scrolling', async ({ pinned: page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 320, height: 720 });
    for (const tab of ['todo', 'listings', 'publish', 'sources', 'messages']) {
      await page.goto(`/moderate/#${tab}`);
      await expect(page.locator(`#${tab} .spinner:visible`)).toHaveCount(0, { timeout: 10_000 });
      await noHorizontalScroll(page);
    }
  });
});

test('the editors-only page explains what to do', async ({ pinned: page }) => {
  await page.goto('/not-allowed/');
  await expect(page.getByRole('heading', { level: 1, name: 'Editors only' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});
