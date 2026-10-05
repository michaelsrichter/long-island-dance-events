'use strict';
/**
 * Emails to website owners from the review center, sent through AgentMail (decision P53): permission
 * requests, one follow-up, and notes to organizers about a listing. The owner always reviews the text
 * and confirms before anything is sent.
 *
 * - Key and inbox: the AGENTMAIL_API_KEY and AGENTMAIL_INBOX app settings (production only). Never logged.
 * - Only the production address (OUTREACH_HOST, default longisland.dance) sends. Pull-request previews
 *   and local runs answer with a dry run ("would send") even if they have the key.
 * - Every message we send carries the labels "outreach" and "source-<id>" (or "issue-<n>"), so the
 *   review center finds the conversation, and the newsletter reader (ingest/adapters/agentmail.ts)
 *   skips every thread that has them (replies from website owners are never read as newsletters).
 */
const API = 'https://api.agentmail.to/v0';
const LABEL = 'outreach';
const SITE = 'https://longisland.dance';
const SIGNATURE = ['Mike Richter', 'Long Island Dance Events', `${SITE}/sources/`];
const NEW_REQUEST_DAYS = 30;
const FOLLOWUP_AFTER_DAYS = 14;
const dayCount = (n) => `${n} day${n === 1 ? '' : 's'}`;

class OutreachError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function config(host) {
  const key = process.env.AGENTMAIL_API_KEY || '';
  const inbox = process.env.AGENTMAIL_INBOX || '';
  const production = (process.env.OUTREACH_HOST || 'longisland.dance').toLowerCase();
  const configured = Boolean(key && inbox);
  const live = configured && String(host || '').toLowerCase() === production;
  return { key, inbox, configured, live, reason: !configured ? 'not-configured' : live ? '' : 'preview' };
}

async function am(cfg, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new OutreachError(res.status === 429 ? 429 : 502, (data && (data.message || data.name)) || `AgentMail answered ${res.status}`);
  return data;
}

const inboxPath = (cfg) => `/inboxes/${encodeURIComponent(cfg.inbox)}`;
const EMAIL = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL.test(s);
const domainOf = (email) => String(email).split('@')[1] || '';

/** Labels name the conversation: "source-<id>" or "issue-<n>". */
function keyLabel(key) {
  const m = /^(source|issue|test):([a-z0-9-]{1,100}|\d{1,9})$/.exec(String(key || ''));
  return m ? `${m[1]}-${m[2]}` : null;
}
function keyOf(labels) {
  for (const l of labels || []) {
    const m = /^(source|issue|test)-(.+)$/.exec(l);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return '';
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Simple HTML from the plain text: paragraphs, line breaks, lists ("- " lines) and links. */
function toHtml(text) {
  const linked = (s) => escapeHtml(s).replace(/https?:\/\/[^\s<]+[^\s<.,)]/g, (u) => `<a href="${u}">${u}</a>`);
  const out = [];
  for (const block of String(text).trim().split(/\n{2,}/)) {
    let para = [];
    let items = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(linked).join('<br>')}</p>`);
      if (items.length) out.push(`<ul>${items.map((l) => `<li>${linked(l)}</li>`).join('')}</ul>`);
      para = [];
      items = [];
    };
    for (const line of block.split('\n')) {
      if (/^- /.test(line)) {
        if (para.length) flush();
        items.push(line.slice(2));
      } else {
        if (items.length) flush();
        para.push(line);
      }
    }
    flush();
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${out.join('\n')}</div>`;
}

/* ---------- drafts (the owner edits them before sending) ---------- */

function permissionDraft(source) {
  return {
    subject: 'Can we list your events on Long Island Dance Events?',
    text: [
      'Hello,',
      '',
      `I'm Mike Richter. I run Long Island Dance Events (${SITE}). It's a free website that helps people find dances, dance classes and live music in Nassau and Suffolk counties.`,
      '',
      'May we list the public events from your page?',
      source.url,
      '',
      "Here's what that would mean:",
      '- We use only the basic facts: dates, times, places and prices.',
      '- We write our own short summary, link back to your page, and credit you on our Sources page.',
      '- Our program checks your page slowly, only a few times a week.',
      '- It follows your robots.txt file (your website\'s rules for programs like ours). It uses the name "LongIslandDanceEventsBot".',
      '',
      'If you have a calendar link (an .ics feed) or an email newsletter, we can use that too.',
      '',
      "If you'd rather not be listed, just reply \"no\" and we won't list you. You can also ask us to stop at any time.",
      '',
      'Thank you!',
      '',
      ...SIGNATURE,
    ].join('\n'),
  };
}

function followupDraft(source, sentAt) {
  const when = sentAt ? new Date(sentAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' }) : 'a couple of weeks ago';
  return {
    subject: 'Re: Can we list your events on Long Island Dance Events?',
    text: [
      'Hello again,',
      '',
      `I'm checking in about my note from ${when}. We'd like to list the public events from ${source.url} on Long Island Dance Events (${SITE}). Is that OK with you?`,
      '',
      'We use only dates, times, places and prices. We write our own short summary and link back to you.',
      '',
      "If you'd rather not be listed, just reply \"no\" and we won't ask again.",
      '',
      'Thank you!',
      '',
      ...SIGNATURE,
    ].join('\n'),
  };
}

function correctionDraft(issue) {
  return {
    subject: 'A possible fix for one of your event listings',
    text: [
      'Hello,',
      '',
      `I run Long Island Dance Events (${SITE}). It's a free website that lists dances and live music on Long Island, with links back to the organizers.`,
      '',
      `A visitor told us that something in one of your listings may be out of date${issue && issue.page ? `: ${issue.page}` : '.'}`,
      '',
      'What may be wrong: [Write it here.]',
      '',
      'Could you please check it on your own calendar? We already fixed our copy. Fixing yours too helps everyone who reads your calendar.',
      '',
      "If you'd rather we didn't list your events, just reply and let us know.",
      '',
      'Thank you!',
      '',
      ...SIGNATURE,
    ].join('\n'),
  };
}

/* ---------- reading conversations ---------- */

function threadSummary(t, inbox) {
  const labels = t.labels || [];
  return {
    threadId: t.thread_id,
    key: keyOf(labels),
    subject: t.subject || '',
    updatedAt: t.timestamp || t.updated_at || '',
    hasReply: labels.includes('received') || (t.senders || []).some((s) => !String(s).includes(inbox)),
    unread: labels.includes('received') && labels.includes('unread'),
    messages: t.message_count || 0,
  };
}

async function listThreads(cfg) {
  if (!cfg.configured) return [];
  // AgentMail's thread list leaves out threads with no received email unless the filter names "sent",
  // so a custom label alone misses every request still waiting for an answer. Each outreach thread
  // starts with our sent email, so asking for both labels finds all of them.
  const d = await am(cfg, 'GET', `${inboxPath(cfg)}/threads?labels=${LABEL}&labels=sent&limit=100`);
  return (d.threads || []).map((t) => threadSummary(t, cfg.inbox));
}

async function getThread(cfg, threadId) {
  if (!/^[A-Za-z0-9._@<>:+-]{1,200}$/.test(threadId)) throw new OutreachError(400, 'Unknown conversation.');
  const t = await am(cfg, 'GET', `${inboxPath(cfg)}/threads/${encodeURIComponent(threadId)}`);
  if (!(t.labels || []).includes(LABEL)) throw new OutreachError(404, 'That is not an outreach conversation.');
  return {
    threadId: t.thread_id,
    key: keyOf(t.labels),
    subject: t.subject || '',
    messages: (t.messages || []).map((m) => {
      const sent = (m.labels || []).includes('sent') || String(m.from || '').includes(cfg.inbox);
      return {
        messageId: m.message_id,
        direction: sent ? 'sent' : 'received',
        from: m.from || '',
        to: Array.isArray(m.to) ? m.to.join(', ') : String(m.to || ''),
        at: m.timestamp || m.created_at || '',
        subject: m.subject || '',
        text: String(m.extracted_text || m.text || m.preview || '').slice(0, 4000),
        unread: (m.labels || []).includes('unread'),
      };
    }),
  };
}

async function markRead(cfg, thread) {
  for (const m of thread.messages) {
    if (m.direction === 'received' && m.unread) {
      await am(cfg, 'PATCH', `${inboxPath(cfg)}/messages/${encodeURIComponent(m.messageId)}`, { remove_labels: ['unread'], add_labels: ['read'] });
    }
  }
}

/* ---------- sending ---------- */

/**
 * Rules: at most one new request per conversation key every 30 days, one follow-up at least 14 days
 * after the last message we sent (only if nobody answered), unless the owner overrides.
 * `state` is the ReviewState row for the key (or null).
 */
function sendRule(kind, state, now = Date.now(), override = false) {
  const last = state && Date.parse(state.lastSentAt);
  const days = last ? (now - last) / 86400000 : Infinity;
  if (kind === 'followup') {
    if (!state || !state.messageId) return { ok: false, reason: 'Send the first email before a follow-up.' };
    if (override) return { ok: true };
    if (Number(state.followups || 0) >= 1) return { ok: false, reason: 'You already sent one follow-up. To send another, check "Send anyway" below.' };
    if (days < FOLLOWUP_AFTER_DAYS) return { ok: false, reason: `A follow-up can go out ${FOLLOWUP_AFTER_DAYS} days after the last email. That is ${dayCount(Math.ceil(FOLLOWUP_AFTER_DAYS - days))} from now. To send it now, check "Send anyway" below.` };
    return { ok: true };
  }
  if (!override && days < NEW_REQUEST_DAYS) {
    return { ok: false, reason: `You emailed them ${Math.floor(days) < 1 ? 'today' : `${dayCount(Math.floor(days))} ago`}. You can send a new email after ${NEW_REQUEST_DAYS} days. To send it now, check "Send anyway" below.` };
  }
  return { ok: true };
}

async function send(cfg, { kind, key, to, subject, text, replyToMessageId }) {
  const label = keyLabel(key);
  if (!label) throw new OutreachError(400, 'Unknown conversation.');
  const labels = [LABEL, label, `kind-${kind}`];
  const html = toHtml(text);
  if (!cfg.live) return { dryRun: true, reason: cfg.reason, wouldSend: { from: cfg.inbox || '(the site inbox)', to, subject, text, labels } };
  const r = replyToMessageId
    ? await am(cfg, 'POST', `${inboxPath(cfg)}/messages/${encodeURIComponent(replyToMessageId)}/reply`, { text, html, labels })
    : await am(cfg, 'POST', `${inboxPath(cfg)}/messages/send`, { to: [to], subject, text, html, labels });
  return { sent: true, messageId: r.message_id, threadId: r.thread_id };
}

module.exports = {
  LABEL, NEW_REQUEST_DAYS, FOLLOWUP_AFTER_DAYS, OutreachError,
  config, isEmail, domainOf, keyLabel, keyOf, toHtml, permissionDraft, followupDraft, correctionDraft,
  listThreads, getThread, markRead, sendRule, send, threadSummary,
};
