'use strict';
/**
 * POST /api/likes { key, like: true|false } — one like per signed-in person per page.
 * Likes table: PartitionKey = page key, RowKey = user id (so a second like is a no-op).
 */
require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, readJson } = require('../lib/http');
const { table, TABLES } = require('../lib/store');
const { requireMember } = require('../lib/users');
const { allow } = require('../lib/limits');
const { pageExists } = require('../lib/pages');
const { rebuild, rebuildCounts } = require('../lib/readmodel');

app.http('likes', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'likes',
  handler: async (request) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const r = await readJson(request, 512);
    if (!r.ok) return r.response;
    const { key, like } = r.body;
    if (typeof like !== 'boolean' || !(await pageExists(request, key))) return error(400, 'bad_request', 'Unknown page.');
    const m = await requireMember(request);
    if (m.response) return m.response;
    if (!(await allow(m.principal.userId, 'like'))) return error(429, 'slow_down', 'That is a lot of likes! Please try again later.');

    const likes = table(TABLES.likes);
    const items = table(TABLES.userItems);
    const userId = m.principal.userId;
    const existing = await likes.get(key, userId);
    if (like && !existing) {
      const at = new Date().toISOString();
      await likes.create({ partitionKey: key, rowKey: userId, at });
      await items.upsert({ partitionKey: userId, rowKey: `like~${key}`, at });
    } else if (!like && existing) {
      await likes.remove(key, userId);
      await items.remove(userId, `like~${key}`);
    }
    const doc = await rebuild(key);
    if (Boolean(existing) !== like) await rebuildCounts(key, doc.likes);
    return json(200, { key, liked: like, count: doc.likes });
  },
});
