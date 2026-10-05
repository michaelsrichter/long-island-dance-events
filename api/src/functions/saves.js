'use strict';
/**
 * POST /api/saves { key: 'event:<id>', save: true|false, date?: 'YYYY-MM-DD' }
 * A private bookmark: only the person who saved an event can see it (GET /api/me/saves).
 * Stored as a UserItems row "save~<key>", so "download my data" includes it and
 * "delete my account" removes it. Nothing about saves is ever public.
 */
const { serverEvent } = require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, readJson } = require('../lib/http');
const { table, TABLES } = require('../lib/store');
const { requireMember } = require('../lib/users');
const { allow } = require('../lib/limits');
const { pageExists } = require('../lib/pages');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

app.http('saves', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'saves',
  handler: async (request) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const r = await readJson(request, 512);
    if (!r.ok) return r.response;
    const { key, save, date } = r.body;
    if (typeof save !== 'boolean' || typeof key !== 'string' || !key.startsWith('event:') || (date !== undefined && !(typeof date === 'string' && DATE.test(date)))) {
      return error(400, 'bad_request', 'Only events can be saved.');
    }
    if (!(await pageExists(request, key))) return error(400, 'bad_request', 'Unknown event.');
    const m = await requireMember(request);
    if (m.response) return m.response;
    if (!(await allow(m.principal.userId, 'save'))) return error(429, 'slow_down', 'That is a lot of saving! Please try again later.');

    const items = table(TABLES.userItems);
    const rowKey = `save~${key}`;
    if (save) await items.upsert({ partitionKey: m.principal.userId, rowKey, key, ...(date ? { date } : {}), at: new Date().toISOString() });
    else await items.remove(m.principal.userId, rowKey);
    await serverEvent('community_save', { type: 'event', value: save ? 'save' : 'unsave' });
    return json(200, { key, saved: save });
  },
});
