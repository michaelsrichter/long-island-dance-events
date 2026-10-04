'use strict';
/** Community features: moderation rules, profiles, likes, comments, reports, photos, admin, deletion. */
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createFakeStore } = require('./fake-store');

process.env.ALLOWED_HOSTS = 'longisland.dance';
process.env.CONTENT_SAFETY_ENDPOINT = 'https://cs.example.cognitiveservices.azure.com/';
process.env.CONTENT_SAFETY_KEY = 'test-key';
process.env.ADMIN_EMAILS = 'boss@example.com';
process.env.MODERATION_DENY_WORDS = 'forbiddenword';

const PAGES = ['venue:huntington-moose-lodge', 'event:tuesday-hustle', 'style:west-coast-swing'];
const csCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith('/community-pages.json')) return new Response(JSON.stringify({ keys: PAGES }), { status: 200 });
  if (u.includes('/contentsafety/')) {
    const body = JSON.parse(init.body);
    csCalls.push(u.includes('image:') ? 'image' : 'text');
    const text = body.text || '';
    const sev = (c) => (c === 'Hate' && /NASTY/.test(text) ? 6 : c === 'Violence' && /\bmeh\b/.test(text) ? 2 : 0);
    return new Response(JSON.stringify({ categoriesAnalysis: ['Hate', 'Sexual', 'SelfHarm', 'Violence'].map((category) => ({ category, severity: sev(category) })) }), { status: 200 });
  }
  throw new Error(`unexpected fetch ${u}`);
};

const store = require('../src/lib/store');
const fake = createFakeStore();
store.setBackend(fake);

const functions = require('@azure/functions');
const handlers = {};
functions.app.http = (name, opts) => {
  handlers[name] = opts.handler;
};
for (const f of ['roles', 'me', 'likes', 'comments', 'photos', 'flags', 'admin']) require(`../src/functions/${f}`);

const moderate = require('../src/lib/moderate');
const { ageFrom } = require('../src/lib/users');
const { cleanText, isPageKey } = require('../src/lib/http');
const { readPrincipal, claim } = require('../src/lib/principal');
const { processPhoto, sniff } = require('../src/lib/images');

const ctx = { warn() {}, log() {} };
const BASE = 'https://longisland.dance';
function principal(userId, roles = ['member'], details = 'Ann') {
  return Buffer.from(JSON.stringify({ identityProvider: 'extid', userId, userDetails: details, userRoles: ['anonymous', 'authenticated', ...roles] })).toString('base64');
}
function req(path, { method = 'GET', user, body, json = true, origin = BASE } = {}) {
  const headers = { origin };
  if (user) headers['x-ms-client-principal'] = user;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    if (json) headers['content-type'] = 'application/json';
  }
  return new Request(BASE + path, { method, headers, body: payload });
}
const parse = (res) => (res.jsonBody !== undefined ? res.jsonBody : res.body ? JSON.parse(res.body) : null);
async function call(name, path, opts) {
  const res = await handlers[name](req(path, opts), ctx);
  return { status: res.status, body: parse(res), raw: res };
}
async function signIn(userId, email = 'ann@example.com', name = 'Ann') {
  const res = await handlers.roles(new Request(`${BASE}/api/roles`, { method: 'POST', body: JSON.stringify({ identityProvider: 'extid', userId, claims: [{ typ: 'email', val: email }, { typ: 'name', val: name }, { typ: 'oid', val: `oid-${userId}` }] }) }), ctx);
  return res.jsonBody.roles;
}
async function finishProfile(userId, { year = 1990, month = 5, name = 'Ann B', photoTerms = true } = {}) {
  return call('meProfile', '/api/me/profile', { method: 'POST', user: principal(userId), body: { displayName: name, birthYear: year, birthMonth: month, acceptRules: true, photoTerms } });
}

/* ---------------- pure helpers ---------------- */

test('decide: clean text publishes, unsure goes to people, severe or deny-listed is rejected', () => {
  const zero = { Hate: 0, Sexual: 0, SelfHarm: 0, Violence: 0 };
  assert.equal(moderate.decide({ kind: 'comment', scores: zero }).decision, 'publish');
  assert.equal(moderate.decide({ kind: 'comment', scores: { ...zero, Violence: 2 } }).decision, 'queue');
  assert.equal(moderate.decide({ kind: 'comment', scores: { ...zero, Hate: 4 } }).decision, 'reject');
  assert.equal(moderate.decide({ kind: 'comment', scores: zero, hits: ['link'] }).reason, 'rule_link');
  assert.equal(moderate.decide({ kind: 'comment', scores: null }).reason, 'ai_unavailable');
  assert.equal(moderate.decide({ kind: 'comment', scores: zero, hits: ['deny_word'] }).decision, 'reject');
  assert.equal(moderate.decide({ kind: 'photo', scores: zero }).decision, 'queue', 'every photo waits for a person');
  assert.equal(moderate.decide({ kind: 'correction', scores: zero }).decision, 'queue');
  assert.equal(moderate.decide({ kind: 'name', scores: zero, hits: ['email'] }).decision, 'reject');
  assert.equal(moderate.decide({ kind: 'name', scores: null }).decision, 'publish');
});

test('ruleHits finds links, emails, phone numbers, shouting and deny-listed words', () => {
  assert.deepEqual(moderate.ruleHits('Great band, fun night!'), []);
  assert.ok(moderate.ruleHits('see www.example.com').includes('link'));
  assert.ok(moderate.ruleHits('mail me a@b.co').includes('email'));
  assert.ok(moderate.ruleHits('call 631-555-1234').includes('phone'));
  assert.ok(moderate.ruleHits('THIS IS THE BEST DANCE EVER EVER').includes('shouting'));
  assert.ok(moderate.ruleHits('what a ForbiddenWord night').includes('deny_word'));
  assert.deepEqual(moderate.ruleHits('lesson at 7:30, dance 8-11, $15'), []);
});

test('ageFrom never over-counts and rejects impossible dates', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  assert.equal(ageFrom(2013, 10, now), 12, 'birthday month counts as not yet passed');
  assert.equal(ageFrom(2013, 9, now), 13);
  assert.equal(ageFrom(2008, 1, now), 18);
  assert.equal(ageFrom(2030, 1, now), null);
  assert.equal(ageFrom(1990, 13, now), null);
});

test('cleanText strips control and direction-override characters; page keys are strict', () => {
  assert.equal(cleanText('  hi\u202Ethere \u0007 you  \n\n\n\nok ', 100), 'hithere you\n\nok');
  assert.equal(cleanText('x'.repeat(50), 10), 'x'.repeat(10));
  assert.ok(isPageKey('venue:huntington-moose-lodge'));
  assert.ok(!isPageKey('venue:../etc'));
  assert.ok(!isPageKey('admin:x'));
});

test('readPrincipal requires a signed-in SWA principal; claims are found by short or long names', () => {
  assert.equal(readPrincipal(new Request(BASE)), null);
  const anon = Buffer.from(JSON.stringify({ userId: 'abcdefgh123', userRoles: ['anonymous'] })).toString('base64');
  assert.equal(readPrincipal(new Request(BASE, { headers: { 'x-ms-client-principal': anon } })), null);
  const p = readPrincipal(new Request(BASE, { headers: { 'x-ms-client-principal': principal('user0001aa', ['member', 'admin']) } }));
  assert.equal(p.userId, 'user0001aa');
  assert.ok(p.roles.includes('admin'));
  assert.equal(claim([{ typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', val: 'X@Y.Z' }], 'email'), 'X@Y.Z');
});

test('photos: real type is sniffed and all EXIF/GPS metadata is removed', async () => {
  const original = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#a3111f' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'Camera Owner', Artist: 'Someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 45/1 0/1' } })
    .toBuffer();
  assert.ok((await sharp(original).metadata()).exif, 'test image starts with EXIF');
  assert.equal(sniff(original), 'jpeg');
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  const out = await processPhoto(original);
  assert.equal(out.ok, true);
  assert.deepEqual(out.variants.map((v) => v.px), [480, 1024, 2048]);
  for (const v of out.variants) {
    const meta = await sharp(v.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.exif, undefined, 'no EXIF in output');
    assert.ok(v.width <= v.px && v.width <= 900, 'never upscaled');
  }
  assert.equal((await processPhoto(Buffer.from('not an image at all'))).code, 'bad_type');
});

/* ---------------- flows ---------------- */

test('sign-in roles: members by default, admins by email, banned and under-13 get none', async () => {
  assert.deepEqual(await signIn('user0001aa'), ['member']);
  assert.deepEqual(await signIn('admin001aa', 'Boss@Example.com', 'Boss'), ['member', 'admin']);
  const row = fake.rows('Users', 'user0001aa')[0];
  assert.equal(row.suggestedName, 'Ann');
  assert.equal(row.email, undefined, 'email is not stored');
  await fake.table('Users').merge({ partitionKey: 'user0001aa', rowKey: 'profile', status: 'banned', bannedUntil: '' });
  assert.deepEqual(await signIn('user0001aa'), []);
  await fake.table('Users').merge({ partitionKey: 'user0001aa', rowKey: 'profile', status: 'active' });
});

test('profile: neutral age question, under-13 is refused and nothing else kept', async () => {
  await signIn('kid00001aa', 'kid@example.com', 'Kid');
  const r = await finishProfile('kid00001aa', { year: new Date().getUTCFullYear() - 10 });
  assert.equal(r.status, 403);
  const row = fake.rows('Users', 'kid00001aa')[0];
  assert.equal(row.status, 'under13');
  assert.equal(row.displayName, '');
  assert.equal(row.birthYear, undefined, 'birth date is never stored');
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: principal('kid00001aa'), body: { key: PAGES[0], like: true } })).status, 403);
});

test('profile: posting needs a finished profile; names with contact details are refused', async () => {
  await signIn('user0002aa');
  const before = await call('likes', '/api/likes', { method: 'POST', user: principal('user0002aa'), body: { key: PAGES[0], like: true } });
  assert.equal(before.status, 428);
  assert.equal((await finishProfile('user0002aa', { name: 'ann@example.com' })).status, 400);
  const ok = await finishProfile('user0002aa', { name: 'Ann B' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.needsProfile, false);
  assert.equal(ok.body.user.canPostPhotos, true);
  const me = await call('me', '/api/me', { user: principal('user0002aa') });
  assert.equal(me.body.user.displayName, 'Ann B');
  assert.equal((await call('me', '/api/me', {})).body.signedIn, false);
});

test('likes: one per person, unlike works, counts land in the public JSON', async () => {
  await signIn('user0003aa');
  await finishProfile('user0003aa', { name: 'Cal' });
  const u2 = principal('user0002aa');
  const u3 = principal('user0003aa');
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: u2, body: { key: PAGES[0], like: true } })).body.count, 1);
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: u2, body: { key: PAGES[0], like: true } })).body.count, 1, 'liking twice does not double count');
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: u3, body: { key: PAGES[0], like: true } })).body.count, 2);
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: u3, body: { key: PAGES[0], like: false } })).body.count, 1);
  const doc = fake.json('community/venue/huntington-moose-lodge.json');
  assert.equal(doc.likes, 1);
  assert.equal(fake.blobs.get('community/venue/huntington-moose-lodge.json').cacheControl, 'public, max-age=60');
  assert.deepEqual(fake.json('community/counts/venue.json').likes, { 'huntington-moose-lodge': 1 });
  const mine = await call('meLikes', `/api/me/likes?keys=${PAGES[0]},${PAGES[1]}`, { user: u2 });
  assert.deepEqual(mine.body.liked, { [PAGES[0]]: true });
});

test('likes: unknown pages, cross-site requests and signed-out visitors are refused', async () => {
  const u2 = principal('user0002aa');
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: u2, body: { key: 'venue:not-a-real-place', like: true } })).status, 400);
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: u2, body: { key: PAGES[0], like: true }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('likes', '/api/likes', { method: 'POST', body: { key: PAGES[0], like: true } })).status, 401);
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: u2, body: { key: PAGES[0], like: true }, json: false })).status, 415);
});

test('comments: clean ones publish, unsure ones queue, severe ones are refused', async () => {
  const u2 = principal('user0002aa');
  const ok = await call('comments', '/api/comments', { method: 'POST', user: u2, body: { key: PAGES[1], text: 'Great teachers and a friendly crowd!', date: '2026-10-06' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'published');
  const unsure = await call('comments', '/api/comments', { method: 'POST', user: u2, body: { key: PAGES[1], text: 'The floor was meh tonight' } });
  assert.equal(unsure.body.status, 'pending');
  const link = await call('comments', '/api/comments', { method: 'POST', user: u2, body: { key: PAGES[1], text: 'Tickets at www.example.com' } });
  assert.equal(link.body.status, 'pending');
  const bad = await call('comments', '/api/comments', { method: 'POST', user: u2, body: { key: PAGES[1], text: 'NASTY words here' } });
  assert.equal(bad.status, 422);
  const doc = fake.json('community/event/tuesday-hustle.json');
  assert.equal(doc.comments.length, 1);
  assert.equal(doc.comments[0].name, 'Ann B');
  assert.equal(doc.comments[0].date, '2026-10-06');
  assert.equal(doc.comments[0].userId, undefined, 'public JSON has no account ids');
  assert.equal(fake.rows('ModQueue', 'pending').length, 2);
  assert.equal(fake.rows('ModLog', require('../src/lib/audit').month()).length >= 4, true);
});

test('corrections are private: never published, always queued', async () => {
  const r = await call('comments', '/api/comments', { method: 'POST', user: principal('user0003aa'), body: { key: PAGES[0], kind: 'correction', text: 'Parking is behind the building now.' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending');
  assert.equal(fake.json('community/venue/huntington-moose-lodge.json').comments.length, 0);
});

test('reports: three different people hide a comment until a moderator decides', async () => {
  const doc = fake.json('community/event/tuesday-hustle.json');
  const itemId = doc.comments[0].id;
  const report = (id) => call('flags', '/api/flags', { method: 'POST', user: principal(id), body: { key: PAGES[1], itemType: 'comment', itemId, reason: 'rude' } });
  for (const [i, id] of ['user0003aa', 'user0004aa', 'user0005aa'].entries()) {
    await signIn(id);
    await finishProfile(id, { name: `Person ${i}` });
  }
  assert.equal((await report('user0003aa')).status, 200);
  assert.match((await report('user0003aa')).body.message, /already/, 'one report per person');
  await report('user0004aa');
  assert.equal(fake.json('community/event/tuesday-hustle.json').comments.length, 1, 'two reports keep it visible');
  await report('user0005aa');
  assert.equal(fake.json('community/event/tuesday-hustle.json').comments.length, 0, 'hidden after 3 reports');
  assert.ok(fake.rows('ModQueue', 'pending').some((q) => q.itemKey === itemId && q.reason === 'reports:rude'));
});

test('photos: 18+ only, consent required, always queued, approved photos become public', async () => {
  const img = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#223344' } }).jpeg().toBuffer();
  const form = (extra = {}) => {
    const f = new FormData();
    f.set('key', PAGES[0]);
    f.set('caption', 'Saturday social');
    f.set('alt', 'Couples dancing under string lights');
    f.set('own', 'yes');
    f.set('people', 'yes');
    f.set('noKids', 'yes');
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    f.set('file', new Blob([img], { type: 'image/jpeg' }), 'photo.jpg');
    return f;
  };
  await signIn('teen0001aa');
  await finishProfile('teen0001aa', { year: new Date().getUTCFullYear() - 15, name: 'Teen' });
  assert.equal((await call('photos', '/api/photos', { method: 'POST', user: principal('teen0001aa'), body: form() })).status, 403);
  assert.equal((await call('photos', '/api/photos', { method: 'POST', user: principal('user0002aa'), body: form({ noKids: 'no' }) })).status, 400);
  const up = await call('photos', '/api/photos', { method: 'POST', user: principal('user0002aa'), body: form() });
  assert.equal(up.status, 200);
  assert.equal(up.body.status, 'pending');
  assert.ok(csCalls.includes('image'));
  const row = fake.rows('Photos', PAGES[0])[0];
  assert.ok(fake.blobs.has(`pending/venue/huntington-moose-lodge/${row.photoId}-1024.webp`));
  assert.ok(![...fake.blobs.keys()].some((k) => k.startsWith('photos/')), 'nothing public before review');

  // Moderator approves it.
  const admin = principal('admin001aa', ['member', 'admin'], 'Boss');
  const queue = await call('adminQueue', '/api/admin/queue', { user: admin });
  const item = queue.body.items.find((i) => i.itemType === 'photo');
  assert.ok(item.preview.startsWith('/api/admin/photo?'));
  const preview = await handlers.adminPhoto(req(item.preview, { user: admin }), ctx);
  assert.equal(preview.headers['Content-Type'], 'image/webp');
  const d = await call('adminDecide', '/api/admin/decide', { method: 'POST', user: admin, body: { key: item.key, itemType: 'photo', itemId: item.itemId, decision: 'approve' } });
  assert.equal(d.body.status, 'published');
  assert.ok(fake.blobs.has(`photos/venue/huntington-moose-lodge/${row.photoId}-480.webp`));
  assert.equal(fake.blobs.get(`photos/venue/huntington-moose-lodge/${row.photoId}-480.webp`).cacheControl, 'public, max-age=31536000, immutable');
  assert.ok(!fake.blobs.has(`pending/venue/huntington-moose-lodge/${row.photoId}-480.webp`));
  const doc = fake.json('community/venue/huntington-moose-lodge.json');
  assert.equal(doc.photos.length, 1);
  assert.match(doc.photos[0].src.s, /\/photos\/venue\/huntington-moose-lodge\/.+-480\.webp$/);
});

test('admin: only moderators; bans stop posting and can hide content; log records it', async () => {
  const member = principal('user0002aa');
  assert.equal((await call('adminQueue', '/api/admin/queue', { user: member })).status, 403);
  const admin = principal('admin001aa', ['member', 'admin'], 'Boss');
  const ban = await call('adminBan', '/api/admin/ban', { method: 'POST', user: admin, body: { userId: 'user0002aa', days: 7, reason: 'spam', removeContent: true } });
  assert.equal(ban.status, 200);
  assert.ok(ban.body.hidden >= 1);
  assert.equal(fake.json('community/venue/huntington-moose-lodge.json').photos.length, 0, 'banned user content hidden');
  assert.equal((await call('likes', '/api/likes', { method: 'POST', user: member, body: { key: PAGES[2], like: true } })).status, 403);
  assert.equal((await call('adminUnban', '/api/admin/unban', { method: 'POST', user: admin, body: { userId: 'user0002aa' } })).status, 200);
  const log = await call('adminLog', '/api/admin/log', { user: admin });
  assert.ok(log.body.entries.some((e) => e.action === 'ban'));
});

test('account: export lists my data; delete removes it and updates public pages', async () => {
  const me = principal('user0003aa');
  await call('likes', '/api/likes', { method: 'POST', user: me, body: { key: PAGES[2], like: true } });
  const exp = await handlers.meExport(req('/api/me/export', { user: me }), ctx);
  assert.match(exp.headers['Content-Disposition'], /attachment/);
  const data = JSON.parse(exp.body);
  assert.ok(data.likes.some((l) => l.page === PAGES[2]));
  assert.ok(data.comments.some((c) => c.kind === 'correction'));
  assert.equal((await call('meDelete', '/api/me/delete', { method: 'POST', user: me, body: { confirm: 'nope' } })).status, 400);
  const del = await call('meDelete', '/api/me/delete', { method: 'POST', user: me, body: { confirm: 'DELETE' } });
  assert.equal(del.status, 200);
  assert.equal(fake.rows('Users', 'user0003aa').length, 0);
  assert.equal(fake.rows('UserItems', 'user0003aa').length, 0);
  assert.equal(fake.json('community/style/west-coast-swing.json').likes, 0);
});

test('rate limits stop floods', async () => {
  await signIn('user0009aa');
  await finishProfile('user0009aa', { name: 'Fast' });
  const u = principal('user0009aa');
  let last;
  for (let i = 0; i < 11; i++) last = await call('comments', '/api/comments', { method: 'POST', user: u, body: { key: PAGES[2], text: `Lovely class number ${i}` } });
  assert.equal(last.status, 429);
});
