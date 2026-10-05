#!/usr/bin/env node
// Newsletter inbox helper (decision P44). Works with catalog/newsletters.json and the project's
// AgentMail inbox. The key and inbox address come ONLY from the AGENTMAIL_API_KEY and AGENTMAIL_INBOX
// environment variables; they are never printed or written to a file.
//
//   npx tsx scripts/newsletter-inbox.mjs list [--days 14]
//       Date, sender, subject and the source each email belongs to. No email bodies.
//   npx tsx scripts/newsletter-inbox.mjs confirm [--open]
//       For sign-ups that are waiting for a confirmation email, find the confirmation link. A link
//       is used only when it comes from that site or its mail service, sits in an email from that
//       sender, and robots.txt lets our bot open it. Without --open the links are only counted.
//       Nothing else in any email is ever followed.
//   npx tsx scripts/newsletter-inbox.mjs senders [--write]
//       Match newsletter issues to sign-ups by sender, and record sender addresses and the first
//       issue date in catalog/newsletters.json (--write).
import { readFileSync, writeFileSync } from 'node:fs';
import { isAllowed, parseRobots } from '../ingest/lib/fetch.ts';
import { confirmHostOk, hostOf, onDomain, openChecked, serviceForSender, siteDomain } from './lib/mail-hosts.ts';

const API = 'https://api.agentmail.to/v0';
const FILE = 'catalog/newsletters.json';
const UA = 'LongIslandDanceEventsBot/1.0 (+https://github.com/michaelsrichter/long-island-dance-events; newsletter confirmation)';
const CONFIRM_SUBJECT = /\b(confirm|verify|verification|activate|opt[- ]?in|complete your (?:subscription|sign ?up)|one more step|please (?:confirm|verify))\b/i;
const CONFIRM_LINK = /\b(confirm|verify|activate|opt[- ]?in|subscribe|yes,? (?:subscribe|sign me up)|complete)\b/i;

const cmd = process.argv[2];
const flag = (n) => process.argv.includes(`--${n}`);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const key = process.env.AGENTMAIL_API_KEY;
const inbox = process.env.AGENTMAIL_INBOX;
if (!key || !inbox) {
  console.error('Set AGENTMAIL_API_KEY and AGENTMAIL_INBOX in the environment for this command only.');
  process.exit(2);
}

const host = (u) => hostOf(u).replace(/^www\./, '');
const addressOf = (from) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
const redact = (s) => String(s ?? '').split(inbox).join('[inbox]');

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`AgentMail ${res.status}`);
  return res.json();
}
async function listMessages(days) {
  const after = new Date(Date.now() - days * 864e5).toISOString();
  const out = [];
  let token;
  do {
    const q = new URLSearchParams({ limit: '100', after });
    if (token) q.set('page_token', token);
    const r = await api(`/inboxes/${encodeURIComponent(inbox)}/messages?${q}`);
    out.push(...(r.messages ?? []));
    token = r.next_page_token;
  } while (token && out.length < 1000);
  return out;
}
const getMessage = (id) => api(`/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(id)}`);

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const entries = data.newsletters;

/** Which sign-up does this email belong to? By sender domain (site's own), or by service + site name in the body. */
function matchEntry(msg, body = '') {
  const addr = addressOf(msg.from);
  const dom = addr.split('@')[1] ?? '';
  for (const e of entries) {
    if ((e.senders ?? []).some((s) => (s.startsWith('@') ? addr.endsWith(s.toLowerCase()) : addr === s.toLowerCase()))) return e;
  }
  for (const e of entries) {
    const site = host(e.site);
    if (site && dom && onDomain(dom, siteDomain(site))) return e;
  }
  const svc = serviceForSender(dom);
  if (svc) {
    const text = `${msg.from} ${msg.subject ?? ''} ${body}`.toLowerCase();
    const hits = entries.filter((e) => {
      const site = host(e.site);
      const name = (e.name ?? '').toLowerCase();
      return (site && text.includes(site)) || (name.length > 4 && text.includes(name));
    });
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

function linksOf(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ href: m[1].replace(/&amp;/g, '&'), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

async function robotsAllows(url) {
  const u = new URL(url);
  try {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) return true;
    return isAllowed(parseRobots(await res.text()), u.pathname + u.search);
  } catch {
    return true;
  }
}

if (cmd === 'list') {
  const msgs = await listMessages(Number(arg('days', '14')));
  for (const m of msgs) {
    const e = matchEntry(m, m.preview ?? '');
    console.log(`${m.timestamp.slice(0, 16)}  ${addressOf(m.from).padEnd(42)}  ${redact(m.subject ?? '').slice(0, 70).padEnd(70)}  ${e ? e.sourceId : '?'}`);
  }
  console.log(`\n${msgs.length} messages.`);
} else if (cmd === 'confirm') {
  const waiting = new Set(entries.filter((e) => ['pending-confirmation', 'submitted'].includes(e.status)).map((e) => e.sourceId));
  const msgs = (await listMessages(30)).filter((m) => CONFIRM_SUBJECT.test(m.subject ?? ''));
  let opened = 0;
  for (const m of msgs) {
    const full = await getMessage(m.message_id);
    const body = full.html ?? full.text ?? '';
    const e = matchEntry(m, body);
    if (!e || !waiting.has(e.sourceId)) {
      console.log(`skip   ${addressOf(m.from)}: not a sign-up we are waiting on`);
      continue;
    }
    const dom = addressOf(m.from).split('@')[1] ?? '';
    const svc = serviceForSender(dom);
    // The site itself, or the mail service that sent the email (or that the sign-up form used), by whole host name.
    const hostOk = (h) => confirmHostOk(h, { site: host(e.site), service: svc, platform: e.platform });
    const link = linksOf(body).find((l) => {
      return hostOk(hostOf(l.href)) && (CONFIRM_LINK.test(l.text) || /confirm|verify|optin|opt-in|activate/i.test(l.href)) && !/unsubscribe|preferences|profile|privacy/i.test(l.href + ' ' + l.text);
    });
    if (!link) {
      console.log(`none   ${e.sourceId}: no confirmation link from the site or its mail service`);
      continue;
    }
    if (!flag('open')) {
      console.log(`found  ${e.sourceId}: confirmation link on ${host(link.href)}`);
      continue;
    }
    // Redirects are not followed blindly: every address on the way must pass the same checks.
    const result = await openChecked(link.href, { hostOk, robotsOk: robotsAllows, headers: { 'user-agent': UA } });
    if (!result.ok && result.reason === 'robots') {
      console.log(`robots ${e.sourceId}: ${host(result.url)} does not let our bot in; confirm by hand`);
      e.status = 'owner-by-hand';
      e.notes = `Confirmation link on ${host(result.url)} is closed to bots by robots.txt; the owner confirms by hand.`;
      continue;
    }
    if (!result.ok) {
      console.log(`skip   ${e.sourceId}: the link ${result.reason === 'host' ? `goes on to ${host(result.url)}, which is not the site or its mail service` : 'redirects too many times'}; confirm by hand`);
      continue;
    }
    const res = result.res;
    const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const ok = res.ok && /confirm|subscribed|thank|success|you(?:'|’)re (?:in|all set)/i.test(text);
    console.log(`${ok ? 'opened' : 'check '} ${e.sourceId}: HTTP ${res.status} on ${host(result.url)}${ok ? '' : ' (no clear confirmation; check by hand)'}`);
    if (ok) {
      e.status = 'confirmed';
      e.confirmedAt = new Date().toISOString().slice(0, 10);
      opened++;
    }
  }
  if (flag('open')) {
    writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
    console.log(`\n${opened} confirmed. Updated ${FILE}.`);
  }
} else if (cmd === 'senders') {
  const msgs = (await listMessages(Number(arg('days', '60')))).filter((m) => !CONFIRM_SUBJECT.test(m.subject ?? ''));
  const changes = [];
  for (const m of msgs) {
    const e = matchEntry(m, m.preview ?? '');
    if (!e) continue;
    const addr = addressOf(m.from);
    e.senders ??= [];
    if (!e.senders.includes(addr)) {
      e.senders.push(addr);
      changes.push(`${e.sourceId}: + ${addr}`);
    }
    const day = m.timestamp.slice(0, 10);
    if (!/welcome|thank|confirm|verif|subscri/i.test(m.subject ?? '') && (!e.firstIssueAt || day < e.firstIssueAt)) e.firstIssueAt = day;
    if (e.status !== 'confirmed') {
      if (!['pending-confirmation', 'submitted'].includes(e.status)) e.notes = 'Signed up by hand; issues arrive in the inbox.';
      e.status = 'confirmed';
      e.confirmedAt ??= day;
    }
  }
  console.log(changes.join('\n') || 'No new senders.');
  if (flag('write')) {
    writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
    console.log(`Updated ${FILE}.`);
  }
} else {
  console.error('Usage: npx tsx scripts/newsletter-inbox.mjs list|confirm|senders [options]');
  process.exit(2);
}
