'use strict';
/**
 * POST /api/comments { key, kind: 'comment' | 'correction', text, date? }
 *   comment     -> public after the AI check (or after a human, if the AI is unsure)
 *   correction  -> private note to editors; always goes to the moderation queue and, when
 *                  GITHUB_ISSUES_TOKEN is set, opens a GitHub issue (no name or account id in it)
 */
require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, readJson, cleanText } = require('../lib/http');
const { table, TABLES, revTime, newId } = require('../lib/store');
const { requireMember } = require('../lib/users');
const { allow } = require('../lib/limits');
const { pageExists } = require('../lib/pages');
const moderate = require('../lib/moderate');
const { rebuild } = require('../lib/readmodel');
const { audit } = require('../lib/audit');
const { openCorrectionIssue } = require('../lib/github');

const MAX = { comment: 1000, correction: 2000 };

app.http('comments', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'comments',
  handler: async (request, context) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const r = await readJson(request, 8192);
    if (!r.ok) return r.response;
    const { key } = r.body;
    const kind = r.body.kind === 'correction' ? 'correction' : 'comment';
    if (!(await pageExists(request, key))) return error(400, 'bad_request', 'Unknown page.');
    const text = cleanText(r.body.text, MAX[kind]);
    if (text.length < 2) return error(400, 'empty', 'Please write something first.');
    const date = typeof r.body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.body.date) ? r.body.date : '';
    const m = await requireMember(request);
    if (m.response) return m.response;
    if (!(await allow(m.principal.userId, 'comment'))) return error(429, 'slow_down', 'Please wait a little before posting again.');

    const scores = await moderate.analyzeText(text);
    const hits = moderate.ruleHits(text);
    const verdict = moderate.decide({ kind, scores, hits });
    const status = verdict.decision === 'publish' ? 'published' : verdict.decision === 'queue' ? 'pending' : 'rejected';
    const rk = `${revTime()}_${newId()}`;
    const at = new Date().toISOString();
    await table(TABLES.comments).create({
      partitionKey: key,
      rowKey: rk,
      userId: m.principal.userId,
      displayName: m.user.displayName,
      kind,
      body: text,
      occurrenceDate: date,
      status,
      reason: verdict.reason,
      ai: scores ? JSON.stringify(scores) : '',
      flagCount: 0,
      createdAt: at,
    });
    await table(TABLES.userItems).upsert({ partitionKey: m.principal.userId, rowKey: `comment~${key}~${rk}`, at });
    if (status === 'pending') {
      await table(TABLES.queue).upsert({ partitionKey: 'pending', rowKey: `c~${key}~${rk}`, itemType: kind, key, itemKey: rk, reason: verdict.reason, ai: scores ? JSON.stringify(scores) : '', at });
    }
    if (status === 'published') await rebuild(key);
    await audit({ actor: 'ai', action: verdict.decision, targetType: kind, targetId: rk, key, reason: verdict.reason, scores, after: status });
    if (kind === 'correction' && status === 'pending') {
      try {
        const issue = await openCorrectionIssue({ key, text, date });
        if (issue) await table(TABLES.comments).merge({ partitionKey: key, rowKey: rk, githubIssue: issue });
      } catch (err) {
        context.warn(`correction issue: ${err && err.message}`);
      }
    }
    const message = kind === 'correction' && status === 'pending' ? 'Thanks! Our editors will check your correction.' : moderate.MESSAGES[verdict.decision];
    return json(status === 'rejected' ? 422 : 200, { status, message, ...(status === 'published' ? { id: rk } : {}) });
  },
});
