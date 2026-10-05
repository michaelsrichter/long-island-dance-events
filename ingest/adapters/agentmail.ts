/**
 * Newsletter adapter: reads event newsletters that arrive in the project's newsletter inbox
 * (AgentMail) and turns the dated listings in them into events (decision P44).
 *
 * Which emails belong to which source: catalog/newsletters.json lists, for each newsletter source
 * (its "newsletterSourceId"), the sender addresses its issues come from.
 *
 * fetch():     list messages from those senders received in the last WINDOW_DAYS days through the
 *              AgentMail API, download each new one once, and keep it in the ingest cache
 *              (.cache/ingest/agentmail, never committed). Confirmation and welcome emails are skipped.
 *              The key and inbox come only from the AGENTMAIL_API_KEY and AGENTMAIL_INBOX environment
 *              variables. Without them the source is skipped (not a failure).
 * normalize(): read each email like a dated web page list (the htmllist reader), so every quality
 *              rule applies: a listing must name a dance or live music, the venue must be one we
 *              researched, deadlines and off-island listings are skipped, and a venue's or band's own
 *              calendar wins over a newsletter for the same evening. The "more info" link is the
 *              source's public web page, never the email or its tracking links.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

interface CachedMessage {
  messageId: string;
  sourceId: string;
  sent: string;
  file: string;
}

async function api<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`AgentMail ${res.status} for ${path.replace(/\/inboxes\/[^/]+/, '/inboxes/…')}`);
  return (await res.json()) as T;
}

function cacheDir(ctx: AdapterContext) {
  const dir = join(ctx.fetcher.cacheDir, 'agentmail');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cachedFor(dir: string, sourceId: string, since: string): CachedMessage[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as CachedMessage)
    .filter((m) => m.sourceId === sourceId && m.sent.slice(0, 10) >= since);
}

export const adapter: Adapter = {
  id: 'agentmail',
  quietWhenNoDocuments: true,
  async fetch(ctx: AdapterContext): Promise<FetchedDocument[]> {
    const src = settingsOf(ctx);
    const senders = sendersFor(ctx.source.id);
    if (!senders.length) throw new Error('No sender addresses for this newsletter in catalog/newsletters.json (newsletterSourceId).');
    const dir = cacheDir(ctx);
    const since = addDays(ctx.today, -WINDOW_DAYS);
    const key = process.env.AGENTMAIL_API_KEY;
    const inbox = process.env.AGENTMAIL_INBOX;
    if (!ctx.offline && key && inbox) {
      const known = new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
      for (const sender of senders) {
        const q = new URLSearchParams({ limit: '30', after: `${since}T00:00:00Z`, from: sender });
        const list = await api<{ messages: { message_id: string; from: string; subject?: string; timestamp: string }[] }>(
          `/inboxes/${encodeURIComponent(inbox)}/messages?${q}`,
          key,
        );
        for (const m of list.messages ?? []) {
          if (!senderMatches(m.from, senders) || NOT_AN_ISSUE.test(m.subject ?? '')) continue;
          const id = createHash('sha1').update(m.message_id).digest('hex').slice(0, 20);
          if (known.has(id)) continue;
          const full = await api<{ html?: string; text?: string; extracted_html?: string; extracted_text?: string }>(
            `/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(m.message_id)}`,
            key,
          );
          const html = full.html ?? full.extracted_html ?? (full.text || full.extracted_text ? textToHtml(full.text ?? full.extracted_text ?? '') : '');
          if (!html) continue;
          const file = join(dir, `${id}.html`);
          writeFileSync(file, html);
          writeFileSync(join(dir, `${id}.json`), JSON.stringify({ messageId: id, sourceId: ctx.source.id, sent: m.timestamp, file } satisfies CachedMessage));
          known.add(id);
        }
      }
    } else if (!ctx.offline) {
      ctx.log(`${ctx.source.id}: AGENTMAIL_API_KEY / AGENTMAIL_INBOX not set; reading only emails already in the cache.`);
    }
    return cachedFor(dir, ctx.source.id, since)
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
