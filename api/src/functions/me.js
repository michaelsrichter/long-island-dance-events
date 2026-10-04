'use strict';
/**
 * The signed-in visitor's own account:
 *   GET  /api/me                 profile + status
 *   POST /api/me/profile         display name, age check (only "13+"/"18+" is kept), accept rules
 *   GET  /api/me/likes?keys=...  which of these pages I liked (no keys: every page I liked)
 *   GET  /api/me/saves           the events I saved (private bookmarks)
 *   GET  /api/me/export          download everything we keep about me (JSON)
 *   POST /api/me/delete          delete my profile, likes, saved events, comments, photos and reports
 */
require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, readJson, cleanText, isPageKey } = require('../lib/http');
const { readPrincipal } = require('../lib/principal');
const { table, container, TABLES, CONTAINERS } = require('../lib/store');
const { getUser, isBanned, ageFrom, publicProfile, PROFILE } = require('../lib/users');
const { allow } = require('../lib/limits');
const moderate = require('../lib/moderate');
const { rebuild, rebuildCounts, photoPaths } = require('../lib/readmodel');
const { audit } = require('../lib/audit');

const signIn = () => error(401, 'sign_in', 'Please sign in first.');

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: async (request) => {
    const principal = readPrincipal(request);
    if (!principal) return json(200, { signedIn: false });
    const user = await getUser(principal.userId);
    return json(200, { signedIn: true, user: publicProfile(user, principal), suggestedName: (user && !user.displayName && user.suggestedName) || '' });
  },
});

async function saveProfile(principal, body) {
  if (!(await allow(principal.userId, 'profile'))) return error(429, 'slow_down', 'Please wait a little before trying again.');
  let user = await getUser(principal.userId);
  if (user && user.status === 'under13') return error(403, 'age', 'Sorry, you must be 13 or older to take part.');
  const patch = { partitionKey: principal.userId, rowKey: PROFILE };
  if (!user) {
    user = { partitionKey: principal.userId, rowKey: PROFILE, status: 'active', createdAt: new Date().toISOString() };
    await table(TABLES.users).upsert(user);
  }

  if (!user.age13) {
    const age = ageFrom(body.birthYear, body.birthMonth);
    if (age === null) return error(400, 'birth', 'Please choose the month and year you were born.');
    if (age < 13) {
      await table(TABLES.users).merge({ ...patch, status: 'under13', displayName: '', suggestedName: '' });
      await audit({ actor: 'system', action: 'under13', targetType: 'user', targetId: principal.userId });
      return error(403, 'age', 'Sorry, you must be 13 or older to take part.');
    }
    patch.age13 = true;
    patch.age18 = age >= 18;
  }

  const name = cleanText(body.displayName, 40);
  if (name.length < 2) return error(400, 'name', 'Please enter a name of at least 2 characters.');
  if (name !== user.displayName) {
    const scores = await moderate.analyzeText(name);
    const verdict = moderate.decide({ kind: 'name', scores, hits: moderate.ruleHits(name) });
    if (verdict.decision !== 'publish') return error(400, 'name_rejected', 'Please choose a different name. Names cannot include links, phone numbers, emails or rude words.');
    patch.displayName = name;
  }
  if (!user.rulesAcceptedAt) {
    if (body.acceptRules !== true) return error(400, 'rules', 'Please agree to the community rules.');
    patch.rulesAcceptedAt = new Date().toISOString();
  }
  const adult = patch.age18 ?? user.age18;
  if (body.photoTerms === true && adult && !user.photoTermsAt) patch.photoTermsAt = new Date().toISOString();
  await table(TABLES.users).merge(patch);
  return json(200, { user: publicProfile({ ...user, ...patch }, principal) });
}

app.http('meProfile', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'me/profile',
  handler: async (request) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const principal = readPrincipal(request);
    if (!principal) return signIn();
    const r = await readJson(request, 2048);
    if (!r.ok) return r.response;
    return saveProfile(principal, r.body);
  },
});

app.http('meLikes', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me/likes',
  handler: async (request) => {
    const principal = readPrincipal(request);
    if (!principal) return json(200, { liked: {} });
    const liked = {};
    const asked = new URL(request.url).searchParams.get('keys');
    if (asked === null) {
      // No list: every page this person liked (one read), for list pages with many like buttons.
      // Page keys never contain '~' and use only characters that sort before it, so 'like~~' ends the range.
      const rows = await table(TABLES.userItems).list(principal.userId, { from: 'like~', to: 'like~~', limit: 2000 });
      for (const row of rows) {
        const k = row.rowKey.slice('like~'.length);
        if (isPageKey(k)) liked[k] = true;
      }
      return json(200, { liked });
    }
    const keys = asked.split(',').filter(isPageKey).slice(0, 20);
    const likes = table(TABLES.likes);
    await Promise.all(keys.map(async (k) => { if (await likes.get(k, principal.userId)) liked[k] = true; }));
    return json(200, { liked });
  },
});

app.http('meSaves', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me/saves',
  handler: async (request) => {
    const principal = readPrincipal(request);
    if (!principal) return json(200, { signedIn: false, saved: [] });
    const rows = await table(TABLES.userItems).list(principal.userId, { from: 'save~', to: 'save~~', limit: 2000 });
    const saved = rows
      .map((row) => ({ key: row.rowKey.slice('save~'.length), at: row.at || '', ...(row.date ? { date: row.date } : {}) }))
      .filter((s) => isPageKey(s.key));
    return { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ signedIn: true, saved }) };
  },
});

async function myItems(userId) {
  return table(TABLES.userItems).list(userId);
}

app.http('meExport', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me/export',
  handler: async (request) => {
    const principal = readPrincipal(request);
    if (!principal) return signIn();
    const user = await getUser(principal.userId);
    const items = await myItems(principal.userId);
    const out = { exportedAt: new Date().toISOString(), profile: null, likes: [], saved: [], comments: [], photos: [], reports: [] };
    if (user) out.profile = { displayName: user.displayName || '', status: user.status, over13: Boolean(user.age13), over18: Boolean(user.age18), rulesAcceptedAt: user.rulesAcceptedAt || '', photoTermsAt: user.photoTermsAt || '', createdAt: user.createdAt || '' };
    for (const it of items) {
      const [kind, key, rk] = it.rowKey.split('~');
      if (kind === 'flag') {
        const f = await table(TABLES.flags).get(`${it.itemType}~${it.key}~${it.itemId}`, principal.userId);
        if (f) out.reports.push({ page: it.key, itemType: it.itemType, reason: f.reason, note: f.note || '', at: f.at });
      } else if (kind === 'like') out.likes.push({ page: key, at: it.at });
      else if (kind === 'save') out.saved.push({ page: key, ...(it.date ? { date: it.date } : {}), at: it.at });
      else if (kind === 'comment') {
        const c = await table(TABLES.comments).get(key, rk);
        if (c) out.comments.push({ page: key, kind: c.kind, text: c.body, status: c.status, at: c.createdAt });
      } else if (kind === 'photo') {
        const p = await table(TABLES.photos).get(key, rk);
        if (p) out.photos.push({ page: key, caption: p.caption, alt: p.alt, status: p.status, at: p.createdAt, ...(p.status === 'published' ? { url: container(CONTAINERS.photos).url(photoPaths(key, p.photoId).l) } : {}) });
      }
    }
    return { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="my-long-island-dance-data.json"', 'Cache-Control': 'no-store' }, body: JSON.stringify(out, null, 2) };
  },
});

/** Delete everything a person posted, liked or reported. Used by "delete my account" and by moderators. */
async function deleteUserData(userId) {
  const items = await myItems(userId);
  const touched = new Set();
  const likeChanged = new Set();
  for (const it of items) {
    const [kind, key, rk] = it.rowKey.split('~');
    if (kind === 'flag' || kind === 'save') {
      // A report: the report itself goes; the item's report count and any queue entry stay for moderators.
      // A saved event: private to this person, so only the row goes (no public page changes).
      if (kind === 'flag') await table(TABLES.flags).remove(`${it.itemType}~${it.key}~${it.itemId}`, userId);
      await table(TABLES.userItems).remove(userId, it.rowKey);
      continue;
    }
    if (kind === 'like') {
      await table(TABLES.likes).remove(key, userId);
      likeChanged.add(key);
    } else if (kind === 'comment') {
      await table(TABLES.comments).remove(key, rk);
      await table(TABLES.queue).remove('pending', `c~${key}~${rk}`);
    } else if (kind === 'photo') {
      const p = await table(TABLES.photos).get(key, rk);
      if (p) {
        const paths = photoPaths(key, p.photoId);
        for (const path of Object.values(paths)) {
          await container(CONTAINERS.photos).remove(path);
          await container(CONTAINERS.pending).remove(path);
        }
      }
      await table(TABLES.photos).remove(key, rk);
      await table(TABLES.queue).remove('pending', `p~${key}~${rk}`);
    }
    touched.add(key);
    await table(TABLES.userItems).remove(userId, it.rowKey);
  }
  for (const key of touched) {
    const doc = await rebuild(key);
    if (likeChanged.has(key)) await rebuildCounts(key, doc.likes);
  }
  return touched.size;
}

app.http('meDelete', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'me/delete',
  handler: async (request) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const principal = readPrincipal(request);
    if (!principal) return signIn();
    const r = await readJson(request, 512);
    if (!r.ok) return r.response;
    if (r.body.confirm !== 'DELETE') return error(400, 'confirm', 'Type DELETE to confirm.');
    const user = await getUser(principal.userId);
    const pages = await deleteUserData(principal.userId);
    if (user && (isBanned(user) || user.status === 'under13')) {
      // Keep only the status (no name or other personal data), so deleting the account cannot undo a ban or the age block.
      await table(TABLES.users).upsert({ partitionKey: principal.userId, rowKey: PROFILE, status: user.status, bannedUntil: user.bannedUntil || '', deletedAt: new Date().toISOString() });
    } else await table(TABLES.users).remove(principal.userId, PROFILE);
    await audit({ actor: 'self', action: 'account_deleted', targetType: 'user', targetId: principal.userId, reason: `pages=${pages}; sign-in account ${user && user.idpUserId ? user.idpUserId : 'unknown'} to remove from External ID` });
    return json(200, { ok: true, message: 'Your data was deleted. You will now be signed out.' });
  },
});

module.exports = { saveProfile, deleteUserData, cleanText };
