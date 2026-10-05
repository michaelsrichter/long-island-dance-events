/**
 * Newsletter adapter: reads event newsletters that arrive in the project's newsletter inbox
 * (AgentMail) and turns the dated listings in them into events (decision P44).
 *
 * Which emails belong to which source: catalog/newsletters.json lists, for each newsletter source
 * (its "newsletterSourceId"), the sender addresses its issues come from.
 *
 * fetch():     list messages from those senders received in the last WINDOW_DAYS days through the
 *              AgentMail API and download them into a temporary folder for this run only (never the
 *              ingest cache, which GitHub Actions saves and restores, and never committed); the next
 *              run lists them again. Confirmation and welcome emails are skipped.
 *              The key and inbox come only from the AGENTMAIL_API_KEY and AGENTMAIL_INBOX environment
 *              variables. Without them the source is skipped (not a failure).
 * normalize(): read each email like a dated web page list (the htmllist reader), so every quality
 *              rule applies: a listing must name a dance or live music, the venue must be one we
 *              researched, deadlines and off-island listings are skipped, and a venue's or band's own
 *              calendar wins over a newsletter for the same evening. The "more info" link is the
 *              source's public web page, never the email or its tracking links.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays } from '../../src/lib/time';
import { ROOT } from '../lib/registry';
import { settingsOf, toCandidates, type FoundEvent } from '../lib/structured';
import type { Adapter, AdapterContext, FetchedDocument, NormalizeResult } from '../lib/types';
import { foundFromHtml } from './htmllist';

const API = 'https://api.agentmail.to/v0';
/** Emails older than this are not read again. */
export const WINDOW_DAYS = 45;
/** Sign-up housekeeping, not newsletters. */
export const NOT_AN_ISSUE = /\b(confirm\w*|verif\w*|activat\w*|opt[- ]?in|welcome|thanks? (?:you )?for (?:subscribing|signing up|joining)|you(?:'|’)re (?:subscribed|in)|subscription (?:confirmed|activated|updated)|unsubscribed|password|receipt|order)\b/i;

export interface NewsletterEntry {
  sourceId: string;
  newsletterSourceId?: string | undefined;
  senders?: string[] | undefined;
  status?: string | undefined;
}

export function newsletterEntries(file = process.env.LIDE_NEWSLETTERS_FILE ?? join(ROOT, 'catalog', 'newsletters.json')): NewsletterEntry[] {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { newsletters?: NewsletterEntry[] }).newsletters ?? [];
  } catch {
    return [];
  }
}

/** Sender addresses (or @domains) whose emails belong to this newsletter source. */
export function sendersFor(sourceId: string, entries = newsletterEntries()): string[] {
  const e = entries.find((n) => n.newsletterSourceId === sourceId);
  return (e?.senders ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** "Name <news@site.com>" -> "news@site.com". */
export const addressOf = (from: string) => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();

export function senderMatches(from: string, senders: string[]): boolean {
  const addr = addressOf(from);
  return senders.some((s) => (s.startsWith('@') ? addr.endsWith(s) : addr === s));
}

/** Plain-text email -> minimal HTML the list reader understands (one line per line). */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<html><body>${esc.split(/\r?\n/).map((l) => `<p>${l}</p>`).join('\n')}</body></html>`;
}

/** Drop the footer (unsubscribe, mailing address, "view in browser") so it is never read as a listing. */
export function stripEmailChrome(html: string): string {
  const footer = /unsubscribe|update (?:your )?(?:subscription )?preferences|you are receiving this|you received this|our mailing address is|all rights reserved/gi;
  let cut = html.length;
  for (const m of html.matchAll(footer)) {
    // A footer marker in the top part is a pre-header line, not the footer.
    if (m.index! > html.length * 0.4) {
      cut = m.index!;
      break;
    }
  }
  return html.slice(0, cut).replace(/<a[^>]*>\s*view (?:this email )?in (?:your )?browser\s*<\/a>/gi, '');
}

interface RunMessage {
  sent: string;
  file: string;
}

async function api<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`AgentMail ${res.status} for ${path.replace(/\/inboxes\/[^/]+/, '/inboxes/…')}`);
  return (await res.json()) as T;
}

/**
 * Emails live only for this run, in a temporary folder outside the ingest cache. GitHub Actions saves
 * and restores .cache/ingest (pull requests can restore it too), and an email's footer and
 * unsubscribe links would show the inbox address.
 */
let runFolder: string | undefined;
export function emailFolder(): string {
  if (!runFolder) {
    const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'lide-newsletters-'));
    runFolder = dir;
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
  return runFolder;
}

export const adapter: Adapter = {
  id: 'agentmail',
  quietWhenNoDocuments: true,
  async fetch(ctx: AdapterContext): Promise<FetchedDocument[]> {
    const src = settingsOf(ctx);
    const senders = sendersFor(ctx.source.id);
    if (!senders.length) throw new Error('No sender addresses for this newsletter in catalog/newsletters.json (newsletterSourceId).');
    // Earlier versions kept emails in the ingest cache; make sure none are left there.
    rmSync(join(ctx.fetcher.cacheDir, 'agentmail'), { recursive: true, force: true });
    const key = process.env.AGENTMAIL_API_KEY;
    const inbox = process.env.AGENTMAIL_INBOX;
    if (ctx.offline || !key || !inbox) {
      ctx.log(`${ctx.source.id}: ${ctx.offline ? 'offline' : 'AGENTMAIL_API_KEY / AGENTMAIL_INBOX not set'}; newsletters are read only online.`);
      return [];
    }
    // Every run lists the last WINDOW_DAYS days again; nothing about the emails is kept between runs.
    const since = addDays(ctx.today, -WINDOW_DAYS);
    const dir = emailFolder();
    const seen = new Set<string>();
    const messages: RunMessage[] = [];
    for (const sender of senders) {
      const q = new URLSearchParams({ limit: '30', after: `${since}T00:00:00Z`, from: sender });
      const list = await api<{ messages: { message_id: string; from: string; subject?: string; timestamp: string }[] }>(
        `/inboxes/${encodeURIComponent(inbox)}/messages?${q}`,
        key,
      );
      for (const m of list.messages ?? []) {
        if (!senderMatches(m.from, senders) || NOT_AN_ISSUE.test(m.subject ?? '')) continue;
        const id = createHash('sha1').update(m.message_id).digest('hex').slice(0, 20);
        if (seen.has(id)) continue;
        seen.add(id);
        const full = await api<{ html?: string; text?: string; extracted_html?: string; extracted_text?: string }>(
          `/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(m.message_id)}`,
          key,
        );
        const html = full.html ?? full.extracted_html ?? (full.text || full.extracted_text ? textToHtml(full.text ?? full.extracted_text ?? '') : '');
        if (!html) continue;
        const file = join(dir, `${ctx.source.id}-${id}.html`);
        writeFileSync(file, html);
        messages.push({ sent: m.timestamp, file });
      }
    }
    return messages
      .sort((a, b) => a.sent.localeCompare(b.sent))
      .map((m) => ({ url: src.url, file: m.file, contentType: 'text/html', meta: { issue: m.sent.slice(0, 10) } }));
  },
  async normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult> {
    const src = settingsOf(ctx);
    const mode = src.defaults?.venueId ? 'venue' : src.defaults?.performerIds?.length ? 'band' : 'list';
    const seen = new Set<string>();
    const found: FoundEvent[] = [];
    // Newest issue first, so its wording wins when two issues list the same evening.
    for (const d of [...docs].reverse()) {
      const html = stripEmailChrome(readFileSync(d.file, 'utf8'));
      for (const f of foundFromHtml(html, src.url, ctx.today, mode)) {
        const k = `${f.start}|${f.title.toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        found.push({ ...f, url: undefined, pageUrl: src.url, ref: `newsletter ${d.meta.issue ?? ''}`.trim() });
      }
    }
    return toCandidates(found, ctx, { structured: false, horizonDays: 120 });
  },
};
