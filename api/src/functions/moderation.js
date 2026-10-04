'use strict';
/**
 * Moderator API (route rule in staticwebapp.config.json also requires the "admin" role):
 *   GET  /api/moderation/queue                     items waiting for a person, oldest first
 *   GET  /api/moderation/photo?key=&id=&size=s|m|l preview of a pending (private) photo
 *   POST /api/moderation/decide { key, itemType, itemId, decision, reason }
 *   POST /api/moderation/ban    { userId, days, reason, removeContent }
 *   POST /api/moderation/unban  { userId }
 *   GET  /api/moderation/log?month=YYYY-MM         audit log
 */
require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, readJson, cleanText, isPageKey, NO_STORE } = require('../lib/http');
const { table, container, TABLES, CONTAINERS } = require('../lib/store');
const { requireAdmin, getUser, PROFILE } = require('../lib/users');
const { rebuild, photoPaths } = require('../lib/readmodel');
const { audit, month } = require('../lib/audit');

const ITEM_ID = /^\d{16}_[A-Za-z0-9_-]{6,20}$/;
const actorOf = (principal) => `admin:${principal.details || principal.userId.slice(0, 8)}`;
const safeJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

app.http('adminQueue', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'moderation/queue',
  handler: async (request) => {
    const a = requireAdmin(request);
    if (a.response) return a.response;
    const rows = (await table(TABLES.queue).list('pending', { limit: 200 })).sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const users = new Map();
    const out = [];
    for (const q of rows) {
      const isPhoto = q.itemType === 'photo';
      const item = await table(isPhoto ? TABLES.photos : TABLES.comments).get(q.key, q.itemKey);
      if (!item) {
        await table(TABLES.queue).remove('pending', q.rowKey);
        continue;
      }
      if (!users.has(item.userId)) users.set(item.userId, await getUser(item.userId));
      const u = users.get(item.userId);
      const flags = await table(TABLES.flags).list(`${isPhoto ? 'photo' : 'comment'}~${q.key}~${q.itemKey}`, { limit: 20 });
      out.push({
        queueId: q.rowKey,
        itemType: q.itemType,
        key: q.key,
        itemId: q.itemKey,
        reason: q.reason,
        ai: safeJson(q.ai),
        at: q.at,
        status: item.status,
        ...(isPhoto
          ? { caption: item.caption, alt: item.alt, width: item.width, height: item.height, preview: `/api/moderation/photo?key=${encodeURIComponent(q.key)}&id=${encodeURIComponent(q.itemKey)}&size=m` }
          : { text: item.body, githubIssue: item.githubIssue || '' }),
        date: item.occurrenceDate || '',
        user: { id: item.userId, name: item.displayName || '', status: (u && u.status) || 'unknown', approved: Number(u && u.approvedCount) || 0, rejected: Number(u && u.rejectedCount) || 0 },
        flags: flags.map((f) => ({ reason: f.reason, note: f.note || '' })),
      });
    }
    return json(200, { items: out });
  },
});

app.http('adminPhoto', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'moderation/photo',
  handler: async (request) => {
    const a = requireAdmin(request);
    if (a.response) return a.response;
    const params = new URL(request.url).searchParams;
    const key = params.get('key') || '';
    const id = params.get('id') || '';
    const size = ['s', 'm', 'l'].includes(params.get('size')) ? params.get('size') : 'm';
    if (!isPageKey(key) || !ITEM_ID.test(id)) return error(400, 'bad_request', 'Unknown photo.');
    const p = await table(TABLES.photos).get(key, id);
    if (!p) return error(404, 'not_found', 'Not found.');
    const path = photoPaths(key, p.photoId)[size];
    const data = (await container(CONTAINERS.pending).download(path)) || (await container(CONTAINERS.photos).download(path));
    if (!data) return error(404, 'not_found', 'Not found.');
    return { status: 200, headers: { 'Content-Type': 'image/webp', ...NO_STORE, 'X-Content-Type-Options': 'nosniff' }, body: data };
  },
});

async function bumpUser(userId, field) {
  const u = await getUser(userId);
  if (u) await table(TABLES.users).merge({ partitionKey: userId, rowKey: PROFILE, [field]: (Number(u[field]) || 0) + 1 });
}

async function movePhoto(key, photoId, toPublic) {
  const paths = Object.values(photoPaths(key, photoId));
  for (const path of paths) {
    if (toPublic) {
      const data = await container(CONTAINERS.pending).download(path);
      if (data) await container(CONTAINERS.photos).upload(path, data, 'image/webp', 'public, max-age=31536000, immutable');
    } else {
      await container(CONTAINERS.photos).remove(path);
    }
    await container(CONTAINERS.pending).remove(path);
  }
}

app.http('adminDecide', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'moderation/decide',
  handler: async (request) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const a = requireAdmin(request);
    if (a.response) return a.response;
    const r = await readJson(request, 2048);
    if (!r.ok) return r.response;
    const { key, itemType, itemId, decision } = r.body;
    const reason = cleanText(r.body.reason, 200);
    if (!isPageKey(key) || !['comment', 'correction', 'photo'].includes(itemType) || !ITEM_ID.test(itemId || '') || !['approve', 'reject', 'hide', 'resolve'].includes(decision)) {
      return error(400, 'bad_request', 'Bad request.');
    }
    const isPhoto = itemType === 'photo';
    const items = table(isPhoto ? TABLES.photos : TABLES.comments);
    const item = await items.get(key, itemId);
    if (!item) return error(404, 'not_found', 'That item no longer exists.');

    let status;
    if (item.kind === 'correction') status = 'resolved';
    else if (decision === 'approve') status = 'published';
    else if (decision === 'hide') status = 'hidden';
    else status = 'rejected';

    if (isPhoto) await movePhoto(key, item.photoId, status === 'published');
    await items.merge({ partitionKey: key, rowKey: itemId, status, decidedBy: actorOf(a.principal), decidedAt: new Date().toISOString(), decisionReason: reason });
    await table(TABLES.queue).remove('pending', `${isPhoto ? 'p' : 'c'}~${key}~${itemId}`);
    if (status === 'published') await bumpUser(item.userId, 'approvedCount');
    if (status === 'rejected') await bumpUser(item.userId, 'rejectedCount');
    await rebuild(key);
    await audit({ actor: actorOf(a.principal), action: decision, targetType: itemType, targetId: itemId, key, reason, before: item.status, after: status });
    return json(200, { ok: true, status });
  },
});

app.http('adminBan', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'moderation/ban',
  handler: async (request) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const a = requireAdmin(request);
    if (a.response) return a.response;
    const r = await readJson(request, 1024);
    if (!r.ok) return r.response;
    const userId = String(r.body.userId || '');
    const days = Math.max(0, Math.min(3650, Number(r.body.days) || 0));
    const reason = cleanText(r.body.reason, 200) || 'Broke the community rules';
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(userId)) return error(400, 'bad_request', 'Unknown user.');
    const user = await getUser(userId);
    if (!user) return error(404, 'not_found', 'Unknown user.');
    const until = days ? new Date(Date.now() + days * 86400000).toISOString() : '';
    await table(TABLES.users).merge({ partitionKey: userId, rowKey: PROFILE, status: 'banned', bannedUntil: until, banReason: reason });
    let hidden = 0;
    if (r.body.removeContent === true) {
      const touched = new Set();
      for (const it of await table(TABLES.userItems).list(userId)) {
        const [kind, key, rk] = it.rowKey.split('~');
        if (kind !== 'comment' && kind !== 'photo') continue;
        const t = table(kind === 'photo' ? TABLES.photos : TABLES.comments);
        const row = await t.get(key, rk);
        if (row && (row.status === 'published' || row.status === 'pending')) {
          if (kind === 'photo') await movePhoto(key, row.photoId, false);
          await t.merge({ partitionKey: key, rowKey: rk, status: 'hidden' });
          await table(TABLES.queue).remove('pending', `${kind === 'photo' ? 'p' : 'c'}~${key}~${rk}`);
          touched.add(key);
          hidden++;
        }
      }
      for (const key of touched) await rebuild(key);
    }
    await audit({ actor: actorOf(a.principal), action: 'ban', targetType: 'user', targetId: userId, reason: `${reason}${until ? ` (until ${until})` : ''}; hidden ${hidden}` });
    return json(200, { ok: true, hidden, until });
  },
});

app.http('adminUnban', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'moderation/unban',
  handler: async (request) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const a = requireAdmin(request);
    if (a.response) return a.response;
    const r = await readJson(request, 512);
    if (!r.ok) return r.response;
    const userId = String(r.body.userId || '');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(userId) || !(await getUser(userId))) return error(404, 'not_found', 'Unknown user.');
    await table(TABLES.users).merge({ partitionKey: userId, rowKey: PROFILE, status: 'active', bannedUntil: '', banReason: '' });
    await audit({ actor: actorOf(a.principal), action: 'unban', targetType: 'user', targetId: userId });
    return json(200, { ok: true });
  },
});

app.http('adminLog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'moderation/log',
  handler: async (request) => {
    const a = requireAdmin(request);
    if (a.response) return a.response;
    const m = new URL(request.url).searchParams.get('month');
    const rows = await table(TABLES.log).list(/^\d{4}-\d{2}$/.test(m || '') ? m : month(), { limit: 200 });
    return json(200, { entries: rows.map((e) => ({ at: e.at, actor: e.actor, action: e.action, targetType: e.targetType, targetId: e.targetId, key: e.key, reason: e.reason, before: e.before, after: e.after })) });
  },
});
