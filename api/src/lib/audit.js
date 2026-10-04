'use strict';
/** Append-only moderation and account log (ModLog table, one partition per month). */
const { table, TABLES, revTime, newId } = require('./store');

function month(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function audit({ actor, action, targetType = '', targetId = '', key = '', reason = '', scores = null, before = '', after = '' }) {
  await table(TABLES.log).create({
    partitionKey: month(),
    rowKey: `${revTime()}_${newId()}`,
    actor: String(actor).slice(0, 100),
    action,
    targetType,
    targetId,
    key,
    reason: String(reason).slice(0, 300),
    scores: scores ? JSON.stringify(scores) : '',
    before,
    after,
    at: new Date().toISOString(),
  });
}

module.exports = { audit, month };
