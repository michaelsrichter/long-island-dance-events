'use strict';
/** Per-person rate limits kept in the Limits table (one row per action per hour). */
const { table, TABLES } = require('./store');

const LIMITS = {
  comment: { hour: 10, day: 30 },
  photo: { hour: 5, day: 10 },
  like: { hour: 120, day: 300 },
  flag: { hour: 20, day: 50 },
  profile: { hour: 10, day: 20 },
};

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  return { day, hour: `${day}${p(now.getUTCHours())}` };
}

/** Counts one use of `action`. Returns false (and does not count) when the person is over the limit. */
async function allow(userId, action, now = new Date()) {
  const lim = LIMITS[action];
  if (!lim) throw new Error(`unknown action ${action}`);
  const t = table(TABLES.limits);
  const { day, hour } = stamp(now);
  const rows = await t.list(userId, { from: `${action}~${day}00`, to: `${action}~${day}99` });
  const dayCount = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const hourRow = rows.find((r) => r.rowKey === `${action}~${hour}`);
  const hourCount = hourRow ? Number(hourRow.count) || 0 : 0;
  if (hourCount >= lim.hour || dayCount >= lim.day) return false;
  await t.upsert({ partitionKey: userId, rowKey: `${action}~${hour}`, count: hourCount + 1 });
  return true;
}

module.exports = { allow, LIMITS, stamp };
