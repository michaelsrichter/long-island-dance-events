'use strict';
/**
 * POST /api/flags { key, itemType: 'comment' | 'photo', itemId, reason } — "Report" button.
 * One report per person per item. Three reports from different people, or one from a moderator,
 * hide the item until a moderator decides.
 */
const { serverEvent } = require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, readJson, cleanText, isPageKey } = require('../lib/http');
const { table, TABLES } = require('../lib/store');
const { requireMember } = require('../lib/users');
const { allow } = require('../lib/limits');
const { rebuild } = require('../lib/readmodel');
const { unpublishPhoto } = require('../lib/photo-files');
const { audit } = require('../lib/audit');
const { alertAdmins } = require('../lib/notify');

const HIDE_AFTER = 3;
const REASONS = new Set(['rude', 'spam', 'private', 'not-mine', 'shows-me', 'child', 'other']);

app.http('flags', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'flags',
  handler: async (request, context) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const r = await readJson(request, 2048);
    if (!r.ok) return r.response;
    const { key, itemType, itemId } = r.body;
    const reason = REASONS.has(r.body.reason) ? r.body.reason : 'other';
    const note = cleanText(r.body.note, 300);
    if (!isPageKey(key) || !['comment', 'photo'].includes(itemType) || typeof itemId !== 'string' || !/^\d{16}_[A-Za-z0-9_-]{6,20}$/.test(itemId)) return error(400, 'bad_request', 'Unknown item.');
    const m = await requireMember(request);
    if (m.response) return m.response;
    if (!(await allow(m.principal.userId, 'flag'))) return error(429, 'slow_down', 'Please try again later.');

    const items = table(itemType === 'photo' ? TABLES.photos : TABLES.comments);
    const item = await items.get(key, itemId);
    if (!item || item.status !== 'published') return json(200, { ok: true });
    const flagId = `${itemType}~${key}~${itemId}`;
    const created = await table(TABLES.flags).create({ partitionKey: flagId, rowKey: m.principal.userId, reason, note, at: new Date().toISOString() });
    if (!created) return json(200, { ok: true, message: 'You already reported this. Thanks!' });
    // Listed under the reporter too, so "download my data" includes it and "delete my account" removes it.
    await table(TABLES.userItems).upsert({ partitionKey: m.principal.userId, rowKey: `flag~${flagId}`, itemType, key, itemId, at: new Date().toISOString() });

    const count = (Number(item.flagCount) || 0) + 1;
    const isAdmin = m.principal.roles.includes('admin');
    // Safety reasons hide at once; others after three different people report it.
    const hide = isAdmin || reason === 'child' || reason === 'shows-me' || count >= HIDE_AFTER;
    await items.merge({ partitionKey: key, rowKey: itemId, flagCount: count, ...(hide ? { status: 'hidden' } : {}) });
    // A hidden photo must stop being served, not just drop off the page.
    if (hide && itemType === 'photo') await unpublishPhoto(key, item.photoId);
    const prefix = itemType === 'photo' ? 'p' : 'c';
    await table(TABLES.queue).upsert({ partitionKey: 'pending', rowKey: `${prefix}~${key}~${itemId}`, itemType, key, itemKey: itemId, reason: `reports:${reason}`, ai: item.ai || '', at: new Date().toISOString() });
    if (hide) await rebuild(key);
    await audit({ actor: isAdmin ? `admin:${m.principal.details}` : 'visitor', action: hide ? 'hidden_by_reports' : 'reported', targetType: itemType, targetId: itemId, key, reason, before: 'published', after: hide ? 'hidden' : 'published' });
    // A moderator who hides something themselves does not need an email about it.
    if (hide && !isAdmin) await alertAdmins(reason === 'shows-me' ? 'shows-me' : 'hidden', { log: context?.warn?.bind(context) });
    await serverEvent('community_flag', { type: itemType, value: hide ? 'hidden' : 'reported', reason });
    return json(200, { ok: true, message: hide ? 'Thanks. We hid it while a volunteer takes a look.' : 'Thanks. A volunteer will take a look.' });
  },
});
