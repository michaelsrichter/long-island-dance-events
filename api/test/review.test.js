'use strict';
/** Review center API: access rules, the one-time GitHub setup, and every kind of owner decision. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { createFakeStore } = require('./fake-store');
const { createFakeGitHub } = require('./fake-github');

process.env.ALLOWED_HOSTS = 'longisland.dance,preview-37.azurestaticapps.net';
process.env.REVIEW_SECRET_KEY = 'x'.repeat(48);
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;

const REPO = 'michaelsrichter/long-island-dance-events';
const files = require('../src/lib/content-files');
const ev = (o) => files.serialize({ summary: 'A short summary of the listing.', category: 'live-music', timezone: 'America/New_York', sourceId: 's1', sourceUrl: 'https://example.org/cal', firstSeen: '2026-10-01', lastSeen: '2026-10-04', confidence: 0.55, matchKey: `k-${o.title}`, ...o }, files.EVENT_ORDER);
const FILES = {
  'src/content/events/2099-10-10-no-time.json': ev({ title: 'Band at Venue One', start: '2099-10-10', venueId: 'v1', status: 'pending-review', reviewNotes: 'Band or DJ not researched yet: The Max. No start time found.' }),
  'src/content/events/2099-10-16-odd.json': ev({ title: 'Despyre at Venue One', start: '2099-10-16T06:30', venueId: 'v1', performerIds: ['p1'], status: 'pending-review', confidence: 0.4, reviewNotes: 'Start time looks wrong (6:30 in the morning). Check the source.' }),
  'src/content/events/2099-10-11-copy.json': ev({ title: 'Copy of a dance', start: '2099-10-11T19:00', venueId: 'v1', status: 'pending-review', confidence: 1, reviewNotes: "The organizer's or band's own calendar now lists this (own-series), so that listing is shown instead of this copy." }),
  'src/content/events/2099-10-12-no-venue.json': ev({ title: 'Social dance', start: '2099-10-12T20:00', town: 'Syosset', status: 'pending-review', reviewNotes: 'Venue not found in the listing.' }),
  'src/content/events/2026-09-01-old.json': ev({ title: 'Old held one', start: '2026-09-01T20:00', venueId: 'v1', status: 'pending-review', reviewNotes: 'No start time found.' }),
  'src/content/events/2099-10-20-listed.json': ev({ title: 'Listed already', start: '2099-10-20T20:00', venueId: 'v1', status: 'active', confidence: 1 }),
  'src/content/sources/s1.json': `${JSON.stringify({ name: 'Source One', url: 'https://one.example/', type: 'html', adapter: 'htmllist', cadence: 'weekly', enabled: true, attribution: 'One', lastStatus: 'error', lastMessage: 'HTTP 500' }, null, 2)}\n`,
  'src/content/sources/s2.json': `${JSON.stringify({ name: 'Source Two', url: 'https://two.example/', type: 'html', adapter: 'htmllist', enabled: false, attribution: 'Two', catalogStatus: 'needs-permission', permission: { status: 'needed', note: 'robots.txt says no' }, reviewNotes: 'Blocked.' }, null, 2)}\n`,
  'src/content/sources/s3.json': `${JSON.stringify({ name: 'Club Three', url: 'https://clubthree.example/events', type: 'html', adapter: 'htmllist', enabled: false, attribution: 'Three', catalogStatus: 'needs-permission', permission: { status: 'needed' }, defaults: { organizerId: 'org3' } }, null, 2)}\n`,
  'src/content/organizers/org3.json': '{\n  "name": "Club Three",\n  "email": "hello@clubthree.example"\n}\n',
  'src/content/venues/v1.json': '{\n  "name": "Venue One"\n}\n',
  'src/content/venues/v2.json': '{\n  "name": "Venue Two"\n}\n',
  'src/content/performers/p1.json': '{\n  "name": "Despyre"\n}\n',
  'catalog/search-triage.json': [
    '{',
    '  "about": "x",',
    '  "decisions": {"platform": "big platform"},',
    '  "domains": {',
    '    "alpha.example": {"decision": "platform"},',
    '    "zulu.example": {"decision": "platform"}',
    '  }',
    '}',
    '',
  ].join('\n'),
};

const gh = createFakeGitHub(REPO, FILES);
const { createFakeAgentMail } = require('./fake-agentmail');
const mail = createFakeAgentMail('site@agentmail.to');
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.agentmail.to/')) return mail.fetch(u, init);
  if (u.startsWith('https://raw.githubusercontent.com/')) {
    const path = decodeURIComponent(u.replace(`https://raw.githubusercontent.com/${REPO}/main/`, ''));
    const text = gh.file(path);
    return text === undefined ? new Response('404', { status: 404 }) : new Response(text, { status: 200 });
  }
  return gh.fetch(url, init);
};

const store = require('../src/lib/store');
const fake = createFakeStore();
store.setBackend(fake);

const functions = require('@azure/functions');
const handlers = {};
const routes = {};
functions.app.http = (name, opts) => {
  handlers[name] = opts.handler;
  routes[name] = opts;
};
require('../src/functions/review');
const { triageWithNo } = require('../src/functions/review');
const github = require('../src/lib/github');

const BASE = 'https://longisland.dance';
const ctx = { warn() {}, log() {} };
const principal = (roles, userId = 'owner0001', details = 'owner@example.com') =>
  Buffer.from(JSON.stringify({ identityProvider: 'extid', userId, userDetails: details, userRoles: ['anonymous', 'authenticated', ...roles] })).toString('base64');
const ADMIN = principal(['member', 'admin']);
const MEMBER = principal(['member'], 'member0001', 'ann@example.com');

function req(path, { method = 'GET', user, body, origin = BASE } = {}) {
  const headers = { origin };
  if (user) headers['x-ms-client-principal'] = user;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(name, path, opts) {
  const res = await handlers[name](req(path, opts), ctx);
  return { status: res.status, body: res.body ? JSON.parse(res.body) : null, headers: res.headers || {} };
}

const ROUTES = [
  ['reviewStatus', 'GET', '/api/review/status'],
  ['reviewListings', 'GET', '/api/review/listings'],
  ['reviewListingsDecide', 'POST', '/api/review/listings', { decisions: [{ id: '2099-10-11-copy', action: 'hide' }] }],
  ['reviewSnooze', 'POST', '/api/review/snooze', { kind: 'listing', id: '2099-10-11-copy', days: 7 }],
  ['reviewCollected', 'GET', '/api/review/collected'],
  ['reviewCollectedPublish', 'POST', '/api/review/collected', { number: 1, headSha: 'a'.repeat(40) }],
  ['reviewSources', 'GET', '/api/review/sources'],
  ['reviewSourcesDecide', 'POST', '/api/review/sources', { decisions: [{ id: 's1', action: 'disable' }] }],
  ['reviewRun', 'POST', '/api/review/run', { cadence: 'daily' }],
  ['reviewCandidate', 'POST', '/api/review/candidate', { domain: 'new.example', action: 'reject' }],
  ['reviewMessages', 'GET', '/api/review/messages'],
  ['reviewMessagesAct', 'POST', '/api/review/messages', { number: 5, action: 'close' }],
  ['reviewCopilot', 'POST', '/api/review/copilot', { title: 'Research a band', body: 'Please research The Max.' }],
  ['reviewLog', 'GET', '/api/review/log'],
  ['reviewGithubStart', 'POST', '/api/review/github/start', {}],
  ['reviewOutreach', 'GET', '/api/review/outreach'],
  ['reviewOutreachDraft', 'GET', '/api/review/outreach/draft?key=source:s3&kind=permission'],
  ['reviewOutreachSend', 'POST', '/api/review/outreach/send', { key: 'source:s3', kind: 'permission', to: 'info@clubthree.example', subject: 'Hello there', text: 'A message that is long enough to send.' }],
  ['reviewOutreachThread', 'GET', '/api/review/outreach/thread?id=t1'],
];

test('every review route is under /api/review/ and needs the admin role (except GitHub\'s return address)', () => {
  for (const [name, opts] of Object.entries(routes)) {
    if (name === 'githubSetup') assert.equal(opts.route, 'github-setup');
    else assert.match(opts.route, /^review\//, name);
  }
  assert.equal(Object.keys(routes).length, ROUTES.length + 1, 'the access test below covers every route');
  const config = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'public', 'staticwebapp.config.json'), 'utf8'));
  const rule = (r) => config.routes.find((x) => x.route === r);
  assert.deepEqual(rule('/api/review/*').allowedRoles, ['admin']);
  assert.deepEqual(rule('/moderate/*').allowedRoles, ['admin']);
});

test('signed-out visitors get 401, members get 403, and nothing is changed', async () => {
  const before = gh.calls.length;
  for (const [name, method, path, body] of ROUTES) {
    const out = await call(name, path, { method, body });
    assert.equal(out.status, 401, `${name} signed out`);
    const member = await call(name, path, { method, body, user: MEMBER });
    assert.equal(member.status, 403, `${name} as a member`);
  }
  assert.equal(gh.calls.length, before, 'no GitHub calls for refused requests');
});

test('writes from another site are refused even for the owner', async () => {
  for (const [name, method, path, body] of ROUTES.filter((r) => r[1] === 'POST')) {
    const r = await call(name, path, { method, body, user: ADMIN, origin: 'https://evil.example' });
    assert.equal(r.status, 403, name);
  }
  const plain = await handlers.reviewListingsDecide(new Request(`${BASE}/api/review/listings`, { method: 'POST', headers: { origin: BASE, 'x-ms-client-principal': ADMIN, 'content-type': 'text/plain' }, body: '{"decisions":[]}' }), ctx);
  assert.equal(plain.status, 415, 'a form post (no JSON content type) is refused');
});

test('before setup: listings say "connect GitHub"; public reads still work', async () => {
  const r = await call('reviewListings', '/api/review/listings', { user: ADMIN });
  assert.equal(r.status, 428);
  assert.equal(r.body.error, 'github_setup');
  const s = await call('reviewStatus', '/api/review/status', { user: ADMIN });
  assert.equal(s.status, 200);
  assert.equal(s.body.github.connected, false);
  assert.equal(s.body.github.canSetUp, true);
  const w = await call('reviewListingsDecide', '/api/review/listings', { method: 'POST', user: ADMIN, body: { decisions: [{ id: '2099-10-11-copy', action: 'hide' }] } });
  assert.equal(w.status, 428, 'writes need the app');
  const c = await call('reviewCollected', '/api/review/collected', { user: ADMIN });
  assert.equal(c.status, 200, 'the public pull request list can be read without the app');
  assert.ok(gh.calls.filter((x) => x.path.includes('/pulls')).every((x) => !x.auth), 'anonymous read');
});

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

test('one-time setup: a single-use state, the key stored encrypted, then the install page', async () => {
  const start = await call('reviewGithubStart', '/api/review/github/start', { method: 'POST', user: ADMIN, body: {} });
  assert.equal(start.status, 200);
  assert.match(start.body.action, /^https:\/\/github\.com\/settings\/apps\/new\?state=/);
  assert.equal(start.body.manifest.redirect_url, 'https://longisland.dance/api/github-setup');
  assert.equal(start.body.manifest.public, false);
  assert.equal(start.body.manifest.hook_attributes.active, false);
  assert.deepEqual(Object.keys(start.body.manifest.default_permissions).sort(), ['actions', 'checks', 'contents', 'issues', 'metadata', 'pull_requests', 'statuses']);

  const setup = (q) => handlers.githubSetup(new Request(`${BASE}/api/github-setup?${q}`), ctx);
  let r = await setup(`code=abcdef1234567890&state=${'x'.repeat(32)}`);
  assert.match(r.headers.Location, /\/moderate\/\?github=failed&reason=expired$/, 'unknown state');

  gh.manifestCodes.set('wrongowner123456', { id: 1, slug: 'evil', pem: privateKey, owner: { login: 'someone-else' } });
  const s2 = await call('reviewGithubStart', '/api/review/github/start', { method: 'POST', user: ADMIN, body: {} });
  r = await setup(`code=wrongowner123456&state=${s2.body.state}`);
  assert.match(r.headers.Location, /reason=wrong_owner/, 'an app made under another account is refused');

  gh.manifestCodes.set('goodcode12345678', { id: 4242, slug: 'long-island-dance-review-center', pem: privateKey, owner: { login: 'michaelsrichter' } });
  r = await setup(`code=goodcode12345678&state=${start.body.state}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, 'https://github.com/apps/long-island-dance-review-center/installations/new');
  const row = fake.rows('ReviewState', 'github')[0];
  assert.equal(row.appId, '4242');
  assert.ok(row.keyCipher && !row.keyCipher.includes('PRIVATE KEY'), 'the key is not stored in plain text');
  assert.ok(!JSON.stringify(fake.rows('ReviewState', 'github')).includes(privateKey.slice(40, 80)));
  assert.equal(github.decrypt(row.keyCipher), privateKey);

  r = await setup(`code=goodcode12345678&state=${start.body.state}`);
  assert.match(r.headers.Location, /reason=expired/, 'a state works once');

  const s = await call('reviewStatus', '/api/review/status', { user: ADMIN });
  assert.equal(s.body.github.connected, true);
  assert.equal(s.body.github.installed, true);
  const tokenCall = gh.calls.find((c) => c.path === '/app/installations/77/access_tokens');
  assert.match(tokenCall.auth, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, 'the app signs a JWT for its token');
  assert.deepEqual(tokenCall.body, { repositories: ['long-island-dance-events'] }, 'the token only reaches this repository');
});

test('held listings: reasons in plain codes, suggested step, ended ones flagged', async () => {
  const r = await call('reviewListings', '/api/review/listings', { user: ADMIN });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.listings.map((l) => [l.id, l]));
  assert.deepEqual(Object.keys(by).sort(), ['2026-09-01-old', '2099-10-10-no-time', '2099-10-11-copy', '2099-10-12-no-venue', '2099-10-16-odd']);
  assert.deepEqual(by['2099-10-10-no-time'].reasons.map((x) => x.code), ['no-time', 'new-act']);
  assert.equal(by['2099-10-10-no-time'].reasons[1].name, 'The Max');
  assert.deepEqual(by['2099-10-16-odd'].reasons[0], { code: 'odd-time', said: '6:30 in the morning', suggest: '18:30' });
  assert.equal(by['2099-10-11-copy'].suggest, 'hide');
  assert.equal(by['2099-10-12-no-venue'].suggest, 'fix-venue');
  assert.equal(by['2026-09-01-old'].ended, true);
  assert.equal(by['2099-10-10-no-time'].ended, false);
  assert.equal(by['2099-10-11-copy'].sourceName, 'Source One');
  assert.deepEqual(r.body.venueIds, ['v1', 'v2']);
});

test('decisions: publish, fix and hide in one commit; locked fields; nothing deleted', async () => {
  const commitsBefore = gh.commitCount();
  const r = await call('reviewListingsDecide', '/api/review/listings', {
    method: 'POST',
    user: ADMIN,
    body: {
      decisions: [
        { id: '2099-10-10-no-time', action: 'fix', fields: { time: '20:00' }, note: 'Checked the venue page' },
        { id: '2099-10-16-odd', action: 'fix', fields: { time: '18:30' } },
        { id: '2099-10-11-copy', action: 'hide', note: 'A copy' },
        { id: '2099-10-12-no-venue', action: 'fix', fields: { venueId: 'v2' } },
        { id: '2099-10-20-listed', action: 'publish' },
      ],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(gh.commitCount(), commitsBefore + 1, 'one commit for the whole batch');
  assert.deepEqual(r.body.skipped, [{ id: '2099-10-20-listed', why: 'already active' }]);
  assert.equal(r.body.liveInMinutes, 10);
  const read = (id) => JSON.parse(gh.file(`src/content/events/${id}.json`));
  const a = read('2099-10-10-no-time');
  assert.equal(a.status, 'active');
  assert.equal(a.start, '2099-10-10T20:00');
  assert.deepEqual(a.lockedFields, ['status', 'start']);
  assert.match(a.reviewNotes, /Published in the review center on \d{4}-\d{2}-\d{2} after fixing start: Checked the venue page$/);
  assert.equal(read('2099-10-16-odd').start, '2099-10-16T18:30');
  const h = read('2099-10-11-copy');
  assert.equal(h.status, 'hidden');
  assert.deepEqual(h.lockedFields, ['status']);
  const v = read('2099-10-12-no-venue');
  assert.equal(v.venueId, 'v2');
  assert.deepEqual(v.lockedFields, ['status', 'venueId']);
  // Same layout as the weekly run writes (ingest/lib/store.ts), so diffs stay small.
  const text = gh.file('src/content/events/2099-10-10-no-time.json');
  assert.equal(text, files.serialize(JSON.parse(text), files.EVENT_ORDER));
  assert.ok(text.indexOf('"status"') < text.indexOf('"sourceId"') && text.indexOf('"lockedFields"') < text.indexOf('"reviewNotes"'));
  const commit = gh.commits.get(gh.head);
  assert.match(commit.message, /^Review center: 4 listing decisions/);
  assert.ok(!/owner@example\.com/.test(commit.message), 'no email address in the public history');
  const log = fake.rows('ModLog', Object.keys(Object.fromEntries(fake.tables.get('ModLog')))[0]);
  assert.equal(log.filter((e) => e.action.startsWith('listing.')).length, 4);
  assert.ok(log.every((e) => e.actor === 'admin:owner@example.com'));
});

test('undo puts a listing back exactly as it was, unless it changed since', async () => {
  const decided = gh.head;
  const original = gh.file('src/content/events/2099-10-12-no-venue.json', gh.commits.get(decided).parents[0]);
  const r = await call('reviewListingsDecide', '/api/review/listings', { method: 'POST', user: ADMIN, body: { decisions: [{ id: '2099-10-12-no-venue', action: 'undo', commit: decided }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(gh.file('src/content/events/2099-10-12-no-venue.json'), original);
  assert.equal(JSON.parse(original).status, 'pending-review');
  const again = await call('reviewListingsDecide', '/api/review/listings', { method: 'POST', user: ADMIN, body: { decisions: [{ id: '2099-10-12-no-venue', action: 'undo', commit: decided }] } });
  assert.equal(again.status, 400, 'it changed after that decision (it was undone)');
});

test('a bad fix is refused with a plain message and nothing is committed', async () => {
  const before = gh.commitCount();
  const r = await call('reviewListingsDecide', '/api/review/listings', { method: 'POST', user: ADMIN, body: { decisions: [{ id: '2026-09-01-old', action: 'fix', fields: { venueId: 'nowhere' } }] } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /^Old held one: Pick a venue from the list\.$/);
  const t = await call('reviewListingsDecide', '/api/review/listings', { method: 'POST', user: ADMIN, body: { decisions: [{ id: '2026-09-01-old', action: 'fix', fields: { time: '7pm' } }] } });
  assert.equal(t.status, 400);
  assert.equal(gh.commitCount(), before);
});

test('if main moves while saving, the decision is applied again on top (never overwrites)', async () => {
  gh.failNextRefUpdate = true;
  const r = await call('reviewListingsDecide', '/api/review/listings', { method: 'POST', user: ADMIN, body: { decisions: [{ id: '2026-09-01-old', action: 'cancel', note: 'Did not happen' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(gh.file('README.md'), 'changed by someone else', 'the other change is kept');
  const e = JSON.parse(gh.file('src/content/events/2026-09-01-old.json'));
  assert.equal(e.status, 'cancelled');
  assert.equal(e.cancelledNote, 'Did not happen');
});

test('snooze hides a card for a while and can be undone', async () => {
  let r = await call('reviewSnooze', '/api/review/snooze', { method: 'POST', user: ADMIN, body: { kind: 'source', id: 's2', days: 7 } });
  assert.equal(r.status, 200);
  const sources = await call('reviewSources', '/api/review/sources', { user: ADMIN });
  assert.ok(sources.body.sources.find((s) => s.id === 's2').snoozedUntil);
  r = await call('reviewSnooze', '/api/review/snooze', { method: 'POST', user: ADMIN, body: { kind: 'source', id: 's2', undo: true } });
  assert.equal(r.status, 200);
  assert.equal((await call('reviewSnooze', '/api/review/snooze', { method: 'POST', user: ADMIN, body: { kind: 'nope', id: 'x' } })).status, 400);
});

test('collected events: report summary, and Publish now only when checks passed and nothing changed', async () => {
  const head = 'b'.repeat(40);
  gh.pulls.push({
    number: 41,
    state: 'open',
    title: 'Collected events: review and merge to publish',
    html_url: `https://github.com/${REPO}/pull/41`,
    head: { ref: 'ingest/updates', sha: head },
    mergeable: true,
    mergeable_state: 'clean',
    commits: 3,
    changed_files: 52,
    created_at: '2026-10-04T10:00:00Z',
    updated_at: '2026-10-05T10:00:00Z',
    body: [
      'Latest run: **weekly,monthly** on 2026-10-05.',
      '| Source | Result | Listings found | Kept (Long Island) | New | Updated | Unchanged | Ended | Missing | Needs review |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      '| Ira\'s List | OK | 120 | 100 | 12 | 3 | 85 | 0 | 1 | 2 |',
      '| Broken Bar | **ERROR** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |',
      '',
      '- **Broken Bar:** HTTP 500',
      '',
      '## New records added automatically (please check)',
      '',
      '- venues: `new-bar-babylon`',
      '- performers: `the-max`, `dead-monday`',
      '',
      '## Waiting for review (2)',
      '',
      '- `x`: No start time found.',
      '',
      'Totals: 650 listed events, 45 waiting for review, 52 files changed.',
    ].join('\n'),
  });
  gh.checkRuns[head] = [{ name: 'Type check, tests, build, links', status: 'in_progress', conclusion: null }];
  let r = await call('reviewCollected', '/api/review/collected', { user: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.body.open.checks, 'running');
  const rep = r.body.open.report;
  assert.equal(rep.latest, 'weekly,monthly on 2026-10-05');
  assert.deepEqual(rep.sources.map((s) => [s.name, s.result, s.new]), [["Ira's List", 'OK', 12], ['Broken Bar', 'ERROR', 0]]);
  assert.deepEqual(rep.created, [{ kind: 'venues', id: 'new-bar-babylon' }, { kind: 'performers', id: 'the-max' }, { kind: 'performers', id: 'dead-monday' }]);
  assert.equal(rep.waiting, 2);
  assert.match(rep.totals, /^650 listed events/);
  assert.deepEqual(rep.notes, [{ source: 'Broken Bar', message: 'HTTP 500' }]);

  r = await call('reviewCollectedPublish', '/api/review/collected', { method: 'POST', user: ADMIN, body: { number: 41, headSha: head } });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /still running/);
  gh.checkRuns[head] = [{ name: 'Type check, tests, build, links', status: 'completed', conclusion: 'success' }];
  r = await call('reviewCollectedPublish', '/api/review/collected', { method: 'POST', user: ADMIN, body: { number: 41, headSha: 'c'.repeat(40) } });
  assert.equal(r.status, 409, 'a newer run added changes since the owner looked');
  r = await call('reviewCollectedPublish', '/api/review/collected', { method: 'POST', user: ADMIN, body: { number: 41, headSha: head } });
  assert.equal(r.status, 200);
  assert.deepEqual(gh.merged.map((m) => [m.number, m.method]), [[41, 'merge']]);
  assert.equal(gh.merged[0].auth, 'Bearer ghs_test', 'merged as the app, so the deploy starts');
  r = await call('reviewCollected', '/api/review/collected', { user: ADMIN });
  assert.equal(r.body.open, null);
  assert.equal(r.body.last.number, 41);
});

test('sources: grouped by next step; permission answers and switching on are commits; runs start the workflow', async () => {
  let r = await call('reviewSources', '/api/review/sources', { user: ADMIN });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.sources.map((s) => [s.id, s]));
  assert.equal(by.s1.group, 'broken');
  assert.equal(by.s2.group, 'permission');
  r = await call('reviewSourcesDecide', '/api/review/sources', { method: 'POST', user: ADMIN, body: { decisions: [{ id: 's2', action: 'permission', status: 'requested', note: 'Emailed the club' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s2 = JSON.parse(gh.file('src/content/sources/s2.json'));
  assert.equal(s2.permission.status, 'requested');
  assert.match(s2.permission.requestedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(s2.permission.note, /^Emailed the club \(/);
  assert.deepEqual(Object.keys(s2).slice(0, 3), ['name', 'url', 'type'], 'the file keeps its own key order');
  r = await call('reviewSourcesDecide', '/api/review/sources', { method: 'POST', user: ADMIN, body: { decisions: [{ id: 's2', action: 'enable' }] } });
  assert.equal(JSON.parse(gh.file('src/content/sources/s2.json')).enabled, true);
  r = await call('reviewSourcesDecide', '/api/review/sources', { method: 'POST', user: ADMIN, body: { decisions: [{ id: 's2', action: 'enable' }] } });
  assert.equal(r.status, 400, 'already on');

  r = await call('reviewRun', '/api/review/run', { method: 'POST', user: ADMIN, body: { source: 's1' } });
  assert.equal(r.status, 200);
  r = await call('reviewRun', '/api/review/run', { method: 'POST', user: ADMIN, body: { cadence: 'weekly' } });
  assert.deepEqual(gh.dispatches, [
    { ref: 'main', inputs: { cadence: 'weekly,monthly', source: 's1' } },
    { ref: 'main', inputs: { cadence: 'weekly,monthly', source: '' } },
  ]);
  assert.equal((await call('reviewRun', '/api/review/run', { method: 'POST', user: ADMIN, body: { source: 'nope' } })).status, 404);
  assert.equal((await call('reviewRun', '/api/review/run', { method: 'POST', user: ADMIN, body: { cadence: 'hourly' } })).status, 400);
});

test('monthly source check: "not useful" is remembered in search-triage.json; "worth adding" asks Copilot', async () => {
  gh.issues.push({
    number: 70,
    state: 'open',
    title: 'Monthly source check: November 2026',
    labels: [{ name: 'source-discovery' }],
    html_url: `https://github.com/${REPO}/issues/70`,
    created_at: '2026-11-01T11:00:00Z',
    body: '# Monthly source check\n\n<!-- review-data {"newSites":[{"domain":"mike.example","url":"https://mike.example/events","title":"Events","queries":["q"]},{"domain":"bad.example","url":"https://bad.example/","title":"x","queries":["q"]}],"robotsChanged":[],"broken":[],"noDates":[]} -->',
  });
  let r = await call('reviewSources', '/api/review/sources', { user: ADMIN });
  assert.deepEqual(r.body.discovery[0].data.newSites.map((s) => s.domain), ['mike.example', 'bad.example']);
  r = await call('reviewCandidate', '/api/review/candidate', { method: 'POST', user: ADMIN, body: { issue: 70, domain: 'bad.example', action: 'reject', note: 'Not on Long Island' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const triage = gh.file('catalog/search-triage.json');
  const doc = JSON.parse(triage);
  assert.equal(doc.domains['bad.example'].decision, 'owner-no');
  assert.match(triage, /\n {4}"alpha\.example": \{"decision": "platform"\},\n {4}"bad\.example": \{"decision":"owner-no","note":"Not on Long Island \(review center, \d{4}-\d{2}-\d{2}\)"\},\n {4}"zulu\.example"/);
  assert.ok(doc.decisions['owner-no']);
  r = await call('reviewCandidate', '/api/review/candidate', { method: 'POST', user: ADMIN, body: { issue: 70, domain: 'mike.example', action: 'copilot', url: 'https://mike.example/events' } });
  assert.equal(r.status, 200);
  const task = gh.issues.find((i) => i.title === 'Check a possible new source: mike.example');
  assert.deepEqual(task.labels.map((l) => l.name), ['copilot-task']);
  assert.match(task.body, /Assign to Copilot/);
  r = await call('reviewSources', '/api/review/sources', { user: ADMIN });
  assert.deepEqual(r.body.discovery[0].data.newSites, [], 'decided websites are not shown again');
});

test('triageWithNo adds the last domain, keeps one per line, and never adds twice', () => {
  const text = FILES['catalog/search-triage.json'];
  const out = triageWithNo(text, 'zz-last.example', '', '2026-10-05');
  assert.match(out, /"zulu\.example": \{"decision": "platform"\},\n {4}"zz-last\.example": \{"decision":"owner-no","note":"\(review center, 2026-10-05\)"\}\n {2}\}/);
  assert.equal(triageWithNo(out, 'zz-last.example', '', '2026-10-05'), null);
});

test('visitor messages: only real messages, with a 7-day countdown for takedowns; reply and close', async () => {
  const now = Date.now();
  gh.issues.push(
    { number: 5, state: 'open', title: 'Remove: my band', labels: [{ name: 'remove-listing' }], html_url: `https://github.com/${REPO}/issues/5`, created_at: new Date(now - 2 * 86400000).toISOString(), user: { login: 'band' }, body: '### Page address\n\nhttps://longisland.dance/performers/the-max/\n\n### What would you like us to do?\n\nStop listing all my events (opt out)' },
    { number: 6, state: 'open', title: 'Source problem: X', labels: [{ name: 'ingest-failure' }], html_url: '', created_at: new Date().toISOString(), body: '<!-- ingest-failure s1 -->' },
    { number: 7, state: 'open', title: 'PR', labels: [], pull_request: {}, created_at: new Date().toISOString() },
  );
  let r = await call('reviewMessages', '/api/review/messages', { user: ADMIN });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.messages.map((m) => m.number), [5]);
  const m = r.body.messages[0];
  assert.equal(m.kind, 'remove-listing');
  assert.equal(m.dueInDays, 5);
  assert.equal(m.page, 'https://longisland.dance/performers/the-max/');
  assert.equal(m.sections['What would you like us to do?'], 'Stop listing all my events (opt out)');
  assert.ok(r.body.copilotTasks.some((t) => t.title === 'Check a possible new source: mike.example'));
  r = await call('reviewMessagesAct', '/api/review/messages', { method: 'POST', user: ADMIN, body: { number: 6, action: 'close' } });
  assert.equal(r.status, 404, 'automation issues are not closed from here');
  r = await call('reviewMessagesAct', '/api/review/messages', { method: 'POST', user: ADMIN, body: { number: 5, action: 'reply' } });
  assert.equal(r.status, 400, 'a reply needs text');
  r = await call('reviewMessagesAct', '/api/review/messages', { method: 'POST', user: ADMIN, body: { number: 5, action: 'close', body: 'Done. We removed it.' } });
  assert.equal(r.status, 200);
  assert.deepEqual(gh.comments.at(-1), { number: 5, body: 'Done. We removed it.' });
  assert.equal(gh.issues.find((i) => i.number === 5).state, 'closed');
});

test('Ask Copilot makes a labeled issue; the log lists every decision', async () => {
  const r = await call('reviewCopilot', '/api/review/copilot', { method: 'POST', user: ADMIN, body: { title: 'Research the band The Max', body: 'It plays at 89 North on Oct 23. Add a performer file with dancing research.' } });
  assert.equal(r.status, 200);
  assert.match(r.body.issue.url, /\/issues\/\d+$/);
  const log = await call('reviewLog', '/api/review/log', { user: ADMIN });
  const actions = log.body.entries.map((e) => e.action);
  for (const a of ['listing.fix', 'listing.hide', 'listing.cancel', 'collected.publish', 'source.permission', 'source.enable', 'run', 'candidate.reject', 'candidate.copilot', 'message.close', 'copilot.ask', 'github.connect']) assert.ok(actions.includes(a), a);
});

test('a new app stored by another instance ("Start over") is picked up when the old one is not installed', async () => {
  github.forget();
  gh.installed = false;
  let s = await github.status();
  assert.equal(s.installed, false);
  assert.equal(s.slug, 'long-island-dance-review-center');
  await fake.table('ReviewState').merge({ partitionKey: 'github', rowKey: 'app', appId: '5151', slug: 'long-island-dance-review-center-2' });
  s = await github.status();
  assert.equal(s.slug, 'long-island-dance-review-center-2', 'the stored app is read again after the failed lookup');
  gh.installed = true;
});

/* ---------------- emails to website owners (AgentMail) ---------------- */

const PREVIEW = 'https://preview-37.azurestaticapps.net';
async function callAt(base, name, path, { method = 'GET', body } = {}) {
  const headers = { origin: base, 'x-ms-client-principal': ADMIN, 'x-ms-original-url': base + path };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await handlers[name](new Request(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
  return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
}
const ask = { key: 'source:s3', kind: 'permission', to: 'hello@clubthree.example', subject: 'Can we list your events on Long Island Dance Events?', text: 'Hello,\n\nMay we list your public events?\n\nThank you!\n\nMike Richter' };

test('outreach: drafts use a published contact address and plain words', async () => {
  const r = await call('reviewOutreachDraft', '/api/review/outreach/draft?key=source:s3&kind=permission', { user: ADMIN });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.to, 'hello@clubthree.example', "the organizer's published email");
  assert.equal(r.body.toFrom, 'the organizer');
  assert.match(r.body.text, /https:\/\/clubthree\.example\/events/);
  for (const must of [/dates, times, places and prices/, /our own short summary/, /robots\.txt/, /reply "no"/, /Mike Richter/, /https:\/\/longisland\.dance\/sources\//]) assert.match(r.body.text, must);
  assert.equal((await call('reviewOutreachDraft', '/api/review/outreach/draft?key=source:nope&kind=permission', { user: ADMIN })).status, 404);
  assert.equal((await call('reviewOutreachDraft', '/api/review/outreach/draft?key=test:s3&kind=permission', { user: ADMIN })).status, 400);
});

test('outreach: nothing is sent without the key, or from a preview (dry run)', async () => {
  delete process.env.AGENTMAIL_API_KEY;
  delete process.env.AGENTMAIL_INBOX;
  let r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: ask });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.dryRun, r.body.reason], [true, 'not-configured']);
  process.env.AGENTMAIL_API_KEY = 'am_test_key';
  process.env.AGENTMAIL_INBOX = 'site@agentmail.to';
  r = await callAt(PREVIEW, 'reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', body: ask });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.dryRun, r.body.reason, r.body.wouldSend.to], [true, 'preview', 'hello@clubthree.example']);
  assert.deepEqual(mail.sends, [], 'a preview never sends');
  assert.equal(fake.rows('ReviewState', 'outreach').length, 0, 'a dry run is not counted as a request');
});

test('outreach: sends from production with labels, records the request without the address, and limits repeats', async () => {
  const before = gh.commitCount();
  let r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: ask });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, true);
  assert.equal(r.body.recorded, true);
  const sent = mail.sends.at(-1);
  assert.deepEqual(sent.to, ['hello@clubthree.example']);
  assert.deepEqual(sent.labels, ['outreach', 'source-s3', 'kind-permission']);
  assert.match(sent.html, /<p>Hello,<\/p>/);
  assert.ok(mail.calls.every((c) => c.auth === 'Bearer am_test_key'));
  assert.equal(gh.commitCount(), before + 1);
  const s3 = JSON.parse(gh.file('src/content/sources/s3.json'));
  assert.equal(s3.permission.status, 'requested');
  assert.match(s3.permission.note, /^Asked by email \(an address at clubthree\.example\) on \d{4}-\d{2}-\d{2} from the review center\.$/);
  assert.ok(!gh.file('src/content/sources/s3.json').includes('hello@clubthree.example'), 'the address stays out of the public repository unless the owner says it is published');
  assert.ok(!gh.commits.get(gh.head).message.includes('hello@'));
  r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: ask });
  assert.equal(r.status, 409, 'one request per source per 30 days');
  assert.match(r.body.message, /after 30 days/);
  r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { ...ask, kind: 'followup' } });
  assert.equal(r.status, 409, 'a follow-up waits 14 days');
  const row = fake.rows('ReviewState', 'outreach').find((x) => x.rowKey === 'source~s3');
  await fake.table('ReviewState').merge({ partitionKey: 'outreach', rowKey: 'source~s3', lastSentAt: new Date(Date.now() - 15 * 86400000).toISOString() });
  r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { ...ask, kind: 'followup', subject: 'Re: hello', text: 'Hello again, just checking in about my note.' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mail.sends.at(-1).kind, 'reply', 'the follow-up answers the first email, in the same conversation');
  assert.equal(r.body.threadId, row.threadId);
  r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { ...ask, kind: 'followup', text: 'Hello again, one more time please.' } });
  assert.equal(r.status, 409, 'one follow-up only');
  r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { ...ask, kind: 'followup', text: 'Hello again, one more time please.', override: true } });
  assert.equal(r.status, 200, 'unless the owner says "Send anyway"');
  assert.equal((await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { ...ask, to: 'not an email' } })).status, 400);
});

test('outreach: answers show in the review center and are marked read when opened', async () => {
  const row = fake.rows('ReviewState', 'outreach').find((x) => x.rowKey === 'source~s3');
  let r = await call('reviewOutreach', '/api/review/outreach', { user: ADMIN });
  const waiting = r.body.threads.find((x) => x.key === 'source:s3');
  assert.ok(waiting, 'a request with no answer yet is listed too');
  assert.deepEqual([waiting.hasReply, waiting.unread], [false, false]);
  mail.receive(row.threadId, 'Club Three <hello@clubthree.example>', 'Yes, go ahead! Our calendar feed is https://clubthree.example/cal.ics');
  r = await call('reviewOutreach', '/api/review/outreach', { user: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.body.canSend, true);
  const t = r.body.threads.find((x) => x.key === 'source:s3');
  assert.deepEqual([t.hasReply, t.unread], [true, true]);
  assert.equal(r.body.sent.find((x) => x.key === 'source:s3').followups, 2);
  r = await call('reviewOutreachThread', `/api/review/outreach/thread?id=${encodeURIComponent(t.threadId)}`, { user: ADMIN });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.messages.map((x) => x.direction), ['sent', 'sent', 'sent', 'received']);
  assert.match(r.body.messages.at(-1).text, /cal\.ics/);
  r = await call('reviewOutreach', '/api/review/outreach', { user: ADMIN });
  assert.equal(r.body.threads.find((x) => x.key === 'source:s3').unread, false, 'opened, so no longer new');
  // "They said yes" and "Switch on" in one go: both decisions land in the file.
  r = await call('reviewSourcesDecide', '/api/review/sources', { method: 'POST', user: ADMIN, body: { decisions: [{ id: 's3', action: 'permission', status: 'granted', note: 'They said yes', feedUrl: 'https://clubthree.example/cal.ics' }, { id: 's3', action: 'enable' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s3 = JSON.parse(gh.file('src/content/sources/s3.json'));
  assert.deepEqual([s3.permission.status, s3.permission.feedUrl, s3.enabled], ['granted', 'https://clubthree.example/cal.ics', true]);
  r = await call('reviewSourcesDecide', '/api/review/sources', { method: 'POST', user: ADMIN, body: { decisions: [{ id: 's1', action: 'permission', status: 'no-reply', note: 'No answer after a month' }] } });
  assert.equal(JSON.parse(gh.file('src/content/sources/s1.json')).permission.status, 'no-reply');
});

test('outreach: a test email goes only to the site inbox; corrections can go to an organizer', async () => {
  let r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { ...ask, kind: 'test', to: 'someone@else.example' } });
  assert.equal(r.status, 400);
  r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { ...ask, kind: 'test', to: 'site@agentmail.to' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(mail.sends.at(-1).labels, ['outreach', 'test-s3', 'kind-test']);
  gh.issues.push({ number: 12, state: 'open', title: 'Fix listing: wrong time', labels: [{ name: 'listing-correction' }], html_url: `https://github.com/${REPO}/issues/12`, created_at: new Date().toISOString(), user: { login: 'dancer' }, body: '### Page address\n\nhttps://longisland.dance/events/2099-10-10-no-time/\n\n### What is wrong?\n\nStarts at 8' });
  r = await call('reviewOutreachDraft', '/api/review/outreach/draft?key=issue:12&kind=correction', { user: ADMIN });
  assert.equal(r.status, 200);
  assert.match(r.body.text, /2099-10-10-no-time/);
  r = await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { key: 'issue:12', kind: 'correction', to: 'info@org.example', subject: r.body.subject, text: r.body.text } });
  assert.equal(r.status, 200);
  assert.deepEqual(mail.sends.at(-1).labels, ['outreach', 'issue-12', 'kind-correction']);
  assert.equal((await call('reviewOutreachSend', '/api/review/outreach/send', { method: 'POST', user: ADMIN, body: { key: 'issue:12', kind: 'permission', to: 'info@org.example', subject: 'x y z', text: 'A message that is long enough.' } })).status, 400);
  const log = await call('reviewLog', '/api/review/log', { user: ADMIN });
  const actions = log.body.entries.map((e) => e.action);
  for (const a of ['outreach.dryrun', 'outreach.permission', 'outreach.followup', 'outreach.test', 'outreach.correction']) assert.ok(actions.includes(a), a);
  assert.ok(!JSON.stringify(log.body.entries).includes('hello@clubthree.example'), 'the log names only the domain');
});

test('outreach: the HTML copy keeps lists inside a paragraph block and links the addresses', () => {
  const { toHtml } = require('../src/lib/outreach');
  const html = toHtml("Here's what that means:\n- We use dates.\n- We link back: https://longisland.dance/sources/\nThanks <b>!</b>");
  assert.match(html, /<p>Here&#39;s what that means:<\/p>|<p>Here's what that means:<\/p>/);
  assert.match(html, /<ul><li>We use dates\.<\/li><li>We link back: <a href="https:\/\/longisland\.dance\/sources\/">https:\/\/longisland\.dance\/sources\/<\/a><\/li><\/ul>/);
  assert.match(html, /<p>Thanks &lt;b&gt;!&lt;\/b&gt;<\/p>/, 'text is escaped');
});
