// Sign-in and the community /api code on the live server (decision P60), with an in-memory store instead of
// Azure Storage (api/test/fake-store.js) and a stand-in site folder for the old host's rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createFakeStore } = require('../../api/test/fake-store.js');
const apiStore = require('../../api/src/lib/store.js');

const dir = mkdtempSync(join(tmpdir(), 'li-identity-'));
mkdirSync(join(dir, 'server'), { recursive: true });
mkdirSync(join(dir, 'client'), { recursive: true });
writeFileSync(
  join(dir, 'server', 'site-rules.json'),
  JSON.stringify({
    routes: [
      { route: '/api/moderation/*', allowedRoles: ['admin'] },
      { route: '/api/review/*', allowedRoles: ['admin'] },
      { route: '/moderate/*', allowedRoles: ['admin'] },
    ],
  }),
);
writeFileSync(join(dir, 'server', 'entry.mjs'), 'export async function handle() { return null; }\nexport async function notFound() { return new Response("nf", { status: 404, headers: { "content-type": "text/html" } }); }\n');
process.env.SITE_DIR = dir;
process.env.ADMIN_EMAILS = 'owner@example.org';
delete process.env.COMMUNITY_STORAGE;

const { route } = await import('../src/app.js');
const { getIdentity } = await import('../src/api-adapter.js');
const { signedInClaims } = await import('../src/identity.js');

const BASE = 'https://new.longisland.dance';
let fake;
const links = new Map();
const fakeLinks = {
  get: async (id) => links.get(id) ?? null,
  findUser: async (ids) => {
    const users = [...fake.tables.get('Users')?.entries() ?? []].map(([pk, rows]) => ({ pk, ...rows.get('profile') }));
    return users.find((u) => ids.includes(u.idpUserId))?.pk ?? null;
  },
  create: async (id, userId) => (links.has(id) ? false : (links.set(id, userId), true)),
};

/** App Service's X-MS-CLIENT-PRINCIPAL for an External ID sign-in (claim names as App Service maps them). */
function appServicePrincipal({ oid, email, name = 'Ann Example' }) {
  const claims = [
    { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: oid },
    { typ: 'sub', val: `pairwise-${oid}` },
    { typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', val: email },
    { typ: 'name', val: name },
  ];
  return Buffer.from(JSON.stringify({ auth_typ: 'extid', claims, name_typ: 'name', role_typ: 'roles' })).toString('base64');
}
/** What Static Web Apps sends to /api (a browser must never be able to fake it here). */
const swaPrincipal = (userId, roles) => Buffer.from(JSON.stringify({ identityProvider: 'extid', userId, userDetails: 'x', userRoles: ['anonymous', 'authenticated', ...roles] })).toString('base64');

function call(path, { method = 'GET', headers = {}, body } = {}) {
  return route(new Request(BASE + path, { method, headers: { origin: BASE, ...headers }, body }));
}

before(() => {
  fake = createFakeStore();
  apiStore.setBackend(fake);
  getIdentity({ links: fakeLinks });
});
after(() => {
  apiStore.setBackend(null);
  delete process.env.WEBSITE_AUTH_ENABLED;
  rmSync(dir, { recursive: true, force: true });
});

test('the sign-in header counts only while App Service built-in sign-in is on', async () => {
  const header = appServicePrincipal({ oid: 'oid-1', email: 'ann@example.org' });
  const req = new Request(BASE, { headers: { 'x-ms-client-principal': header } });
  delete process.env.WEBSITE_AUTH_ENABLED;
  assert.equal(signedInClaims(req), null);
  process.env.WEBSITE_AUTH_ENABLED = 'True';
  assert.equal(signedInClaims(req).claims.length, 4);
});

test('a browser cannot pretend to be signed in or a moderator', async () => {
  process.env.WEBSITE_AUTH_ENABLED = 'True';
  // Static Web Apps' format sent by a browser: not App Service's, so nobody is signed in.
  const session = await (await call('/api/session', { headers: { 'x-ms-client-principal': swaPrincipal('fakeuser01', ['admin']) } })).json();
  assert.deepEqual(session, { signedIn: false, admin: false, name: '' });
  assert.equal((await call('/api/review/status', { headers: { 'x-ms-client-principal': swaPrincipal('fakeuser01', ['admin']) } })).status, 401);
  assert.equal((await (await call('/api/me', { headers: { 'x-ms-client-principal': swaPrincipal('fakeuser01', ['member']) } })).json()).signedIn, false);
  delete process.env.WEBSITE_AUTH_ENABLED;
  const off = await (await call('/api/session', { headers: { 'x-ms-client-principal': appServicePrincipal({ oid: 'oid-2', email: 'owner@example.org' }) } })).json();
  assert.equal(off.signedIn, false, 'without built-in sign-in the header is ignored');
});

test('people keep their Static Web Apps user id (likes, notes, photos)', async () => {
  process.env.WEBSITE_AUTH_ENABLED = 'True';
  await fake.table('Users').upsert({ partitionKey: 'swaUser000000001', rowKey: 'profile', status: 'active', displayName: 'Ann', idpUserId: 'oid-ann', age13: true, rulesAcceptedAt: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' });
  const headers = { 'x-ms-client-principal': appServicePrincipal({ oid: 'oid-ann', email: 'ann@example.org' }) };
  const me = await call('/api/me', { headers });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.signedIn, true);
  assert.equal(body.user.displayName, 'Ann');
  assert.equal(links.get('oid-ann'), 'swaUser000000001', 'the link is saved for next time');
  const session = await (await call('/api/session', { headers })).json();
  assert.deepEqual(session, { signedIn: true, admin: false, name: 'Ann Example' });
});

test('someone new gets a new user id, the same every time', async () => {
  process.env.WEBSITE_AUTH_ENABLED = 'True';
  const headers = { 'x-ms-client-principal': appServicePrincipal({ oid: 'oid-new', email: 'new@example.org', name: 'Bo' }) };
  await call('/api/session', { headers });
  const id = links.get('oid-new');
  assert.match(id, /^[0-9a-f]{32}$/);
  getIdentity({ links: fakeLinks }); // forget what was remembered in memory
  await call('/api/session', { headers });
  assert.equal(links.get('oid-new'), id);
  const profile = (await fake.table('Users').get(id, 'profile'));
  assert.equal(profile.idpUserId, 'oid-new');
});

test('moderator addresses: signed out 401, signed in 403, moderators get through', async () => {
  process.env.WEBSITE_AUTH_ENABLED = 'True';
  assert.equal((await call('/api/moderation/queue')).status, 401);
  const member = { 'x-ms-client-principal': appServicePrincipal({ oid: 'oid-member', email: 'member@example.org' }) };
  assert.equal((await call('/api/moderation/queue', { headers: member })).status, 403);
  const owner = { 'x-ms-client-principal': appServicePrincipal({ oid: 'oid-owner', email: 'owner@example.org', name: 'Mike' }) };
  const queue = await call('/api/moderation/queue', { headers: owner });
  assert.notEqual(queue.status, 401);
  assert.notEqual(queue.status, 403);
  assert.deepEqual(await (await call('/api/session', { headers: owner })).json(), { signedIn: true, admin: true, name: 'Mike' });
});

test('/api/roles (a Static Web Apps step) is not reachable here; unknown addresses are 404', async () => {
  assert.equal((await call('/api/roles', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 404);
  assert.equal((await call('/api/nothing')).status, 404);
  assert.equal((await call('/api/likes')).status, 405);
});
