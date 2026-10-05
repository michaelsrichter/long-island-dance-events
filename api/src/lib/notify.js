'use strict';
/**
 * Email alerts to the site owner when something waits for a person in the moderation queue.
 * The API posts { subject, html } to a Logic App (infra/notify.bicep) whose secret trigger address
 * is the ADMIN_NOTIFY_URL app setting; the Logic App sends the email from Outlook.com.
 *
 * - At most one alert in each 15-minute block of the clock (for example 2:00-2:15). The first event in a
 *   block claims it by inserting a row that only one caller can create, so a burst sends one email.
 * - The email holds counts and a link to the queue only: never the post text, names or email addresses.
 * - Never blocks or fails a visitor's post: errors are swallowed and the call waits at most 2.5 seconds.
 * - remindAdmins() (daily maintenance job) sends one reminder a day if something has waited for hours,
 *   so an item that arrived inside an already-used block is not forgotten.
 */
const { table, TABLES } = require('./store');

const PARTITION = '_alerts'; // Limits table; user ids are 8+ characters, so this can never clash
const WINDOW_MINUTES = 15;
const TIMEOUT_MS = 2500;

const EVENTS = {
  correction: 'Someone sent a private correction for a listing.',
  comment: 'A note is waiting for a person to check it.',
  photo: 'A new photo is waiting for a person to check it.',
  hidden: 'A post was reported and is now hidden until you decide.',
  'shows-me': 'Someone asked to remove a post that shows them. It is hidden until you decide.',
  reminder: 'Reminder: some posts have been waiting for more than a few hours.',
};

const clock = { now: () => Date.now() };

const pad = (n) => String(n).padStart(2, '0');
function stamp(ms, minutes = true) {
  const d = new Date(ms);
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  if (!minutes) return day;
  return `${day}${pad(d.getUTCHours())}${pad(Math.floor(d.getUTCMinutes() / WINDOW_MINUTES) * WINDOW_MINUTES)}`;
}

/** Counts of what waits in the queue, by kind. Reported items count once, as reports. */
function countQueue(rows) {
  const c = { notes: 0, photos: 0, corrections: 0, reports: 0 };
  for (const q of rows) {
    if (String(q.reason || '').startsWith('reports:')) c.reports++;
    else if (q.itemType === 'correction') c.corrections++;
    else if (q.itemType === 'photo') c.photos++;
    else c.notes++;
  }
  return { ...c, total: c.notes + c.photos + c.corrections + c.reports };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function siteUrl() {
  const s = String(process.env.SITE_URL || '').trim();
  return /^https:\/\/[^\s/]+/.test(s) ? s.replace(/\/+$/, '') : 'https://longisland.dance';
}

/** The email. Only fixed sentences, numbers and our own link go in. */
function buildMessage(event, counts, site = siteUrl()) {
  const lines = [
    [counts.corrections, 'private correction', 'private corrections'],
    [counts.notes, 'note', 'notes'],
    [counts.photos, 'photo', 'photos'],
    [counts.reports, 'reported post', 'reported posts'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `<li>${esc(plural(n, one, many))}</li>`);
  const queue = `${site}/moderate/`;
  const total = counts.total || 1;
  const subject = `Long Island Dance: ${plural(total, 'item waits', 'items wait')} for review`;
  const html = [
    `<p>${esc(EVENTS[event] || EVENTS.comment)}</p>`,
    lines.length ? `<p>Waiting in the moderation queue right now:</p><ul>${lines.join('')}</ul>` : '',
    `<p><a href="${esc(queue)}">Open the moderation queue</a> (sign in as a moderator).</p>`,
    `<p>You get at most one of these emails every ${WINDOW_MINUTES} minutes, plus one reminder a day if something is still waiting. This email has no names or post text on purpose.</p>`,
  ].join('\n');
  return { subject, html };
}

async function post(url, message) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok;
}

function notifyUrl() {
  const url = String(process.env.ADMIN_NOTIFY_URL || '').trim();
  return /^https:\/\//.test(url) ? url : '';
}

async function claimAndSend(rowKey, event, now) {
  const url = notifyUrl();
  if (!url) return { sent: false, reason: 'off' };
  const t = table(TABLES.limits);
  let claimed = false;
  try {
    claimed = await t.create({ partitionKey: PARTITION, rowKey, event, at: new Date(now).toISOString() });
    if (!claimed) return { sent: false, reason: 'throttled' };
    const counts = countQueue(await table(TABLES.queue).list('pending', { limit: 500 }));
    if (await post(url, buildMessage(event, counts))) return { sent: true, total: counts.total };
    throw new Error('notify endpoint refused');
  } catch (e) {
    // Free the slot so the next event can try again.
    if (claimed) await t.remove(PARTITION, rowKey).catch(() => {});
    return { sent: false, reason: 'error', error: e && e.name === 'TimeoutError' ? 'timeout' : (e && e.message) || 'error' };
  }
}

/** Call after something new waits in the queue. Resolves to a small result object; never throws. */
async function alertAdmins(event, { log } = {}) {
  const now = clock.now();
  const r = await claimAndSend(`alert~${stamp(now)}`, event, now);
  if (r.reason === 'error' && typeof log === 'function') log(`admin alert failed: ${r.error}`);
  return r;
}

/** Daily: one reminder if any queue item has waited longer than `olderThanHours`. */
async function remindAdmins({ olderThanHours = 6 } = {}) {
  const now = clock.now();
  const rows = await table(TABLES.queue).list('pending', { limit: 500 });
  const cutoff = now - olderThanHours * 3600_000;
  if (!rows.some((q) => Date.parse(q.at) < cutoff)) return { sent: false, reason: 'nothing old' };
  return claimAndSend(`reminder~${stamp(now, false)}`, 'reminder', now);
}

module.exports = { alertAdmins, remindAdmins, buildMessage, countQueue, stamp, clock, WINDOW_MINUTES, PARTITION };
