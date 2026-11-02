/** Shared helpers for the review center. All text from the API is inserted with textContent. */
import { toast } from '../toast';

export type ApiResult<T = any> = { status: number; data: T };

export async function api<T = any>(path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      // A signed-out request may be redirected to the sign-in page; treat that as "please sign in".
      redirect: 'manual',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.type === 'opaqueredirect') return { status: 401, data: { message: 'Your sign-in ended. Refresh the page to sign in again.' } as unknown as T };
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { message: 'Could not reach the website. Check your internet connection and try again.' } as unknown as T };
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string | null, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** A link. Outside links open in a new tab and say so to screen readers. */
export function link(href: string, text: string, opts: { external?: boolean; cls?: string } = {}): HTMLAnchorElement {
  const a = el('a', text, opts.cls);
  a.href = href;
  const external = opts.external ?? /^https?:\/\//.test(href);
  if (external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(el('span', ' (opens in a new tab)', 'visually-hidden'));
  }
  return a;
}

export function button(label: string, cls: string, onClick: (b: HTMLButtonElement) => void | Promise<void>): HTMLButtonElement {
  const b = el('button', label, `btn btn--small ${cls}`);
  b.type = 'button';
  b.addEventListener('click', async () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    b.setAttribute('aria-disabled', 'true');
    try {
      await onClick(b);
    } finally {
      b.removeAttribute('aria-disabled');
    }
  });
  return b;
}

export function list(items: (Node | string | null | false | undefined)[], cls: string): HTMLUListElement {
  const ul = el('ul', null, cls);
  for (const it of items) {
    if (!it) continue;
    const li = el('li');
    li.append(it);
    ul.append(li);
  }
  return ul;
}

export function details(summary: string, cls = 'review-details'): { box: HTMLDetailsElement; body: HTMLElement } {
  const box = el('details', null, cls);
  box.append(el('summary', summary));
  const body = el('div', null, 'review-sub');
  box.append(body);
  return { box, body };
}

let fieldCount = 0;
export function field(labelText: string, input: HTMLElement, hint?: string): HTMLDivElement {
  const id = `review-f${++fieldCount}`;
  input.id = id;
  const wrap = el('div', null, 'field');
  const lab = el('label', labelText);
  lab.htmlFor = id;
  wrap.append(lab, input);
  if (hint) {
    const h = el('p', hint, 'review-hint');
    h.id = `${id}-hint`;
    input.setAttribute('aria-describedby', h.id);
    wrap.append(h);
  }
  return wrap;
}

let statusEl: HTMLElement | null = null;
export function setStatusElement(e: HTMLElement) {
  statusEl = e;
}
/** Say something in the page's live region (and as a toast). */
export function say(text: string) {
  if (statusEl) statusEl.textContent = text;
  toast(text);
}
export function errorText(r: ApiResult, fallback = 'That did not work. Please try again.'): string {
  return (r.data && typeof r.data.message === 'string' && r.data.message) || fallback;
}

/* ---------- dates and times in plain words (New York time) ---------- */

const TZ = 'America/New_York';
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function timeLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
/** "Sat, Oct 10, 8:00 PM" or "Sat, Oct 10 (no time listed)". */
export function whenLabel(start: string): string {
  const date = start.slice(0, 10);
  const time = start.length > 10 ? start.slice(11, 16) : '';
  return time ? `${dayLabel(date)}, ${timeLabel(time)}` : `${dayLabel(date)} (no time listed)`;
}
export function ago(iso: string): string {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
export function dateTimeLabel(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ });
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------- names and addresses of pages on the site (built with the site) ---------- */

export type Pages = { urls: Record<string, string>; names: Record<string, string> };
let pages: Promise<Pages> | null = null;
export function sitePages(): Promise<Pages> {
  pages ??= fetch('/community-pages.json')
    .then((r) => (r.ok ? r.json() : { urls: {}, names: {} }))
    .then((j) => ({ urls: j.urls || {}, names: j.names || {} }))
    .catch(() => ({ urls: {}, names: {} }));
  return pages;
}

export const cmsUrl = (collection: string, id?: string) => (id ? `/admin/#/collections/${collection}/entries/${id}` : `/admin/#/collections/${collection}/new`);
export const REPO_URL = 'https://github.com/michaelsrichter/long-island-dance-events';

/** "Ask Copilot": makes a GitHub issue with the context, labeled copilot-task. Returns its address. Copilot does not start it by itself. */
export async function askCopilot(title: string, body: string): Promise<string | null> {
  const r = await api('/api/review/copilot', { title, body });
  if (r.status === 200) {
    say('Saved as a task for Copilot. Copilot does not start by itself: start a Copilot session and give it the link.');
    return r.data.issue.url as string;
  }
  say(errorText(r));
  return null;
}

/** A small "Ask Copilot" button that turns into a link to the new task. */
export function copilotButton(label: string, title: () => string, body: () => string): HTMLButtonElement {
  const b = button(label, 'btn--secondary', async () => {
    const url = await askCopilot(title(), body());
    if (url) b.replaceWith(link(url, 'Copilot task saved: open it'));
  });
  b.title = 'Saves a task note on GitHub. A Copilot session does the work when you start one and give it the link.';
  return b;
}

/** Replace a card's buttons with a short "done" line (and keep a link or two). */
export function settle(card: HTMLElement, message: string, extra: Node[] = []) {
  card.classList.add('review-card--done');
  card.querySelectorAll('.review-actions, .review-form, .review-card__head > input[type="checkbox"]').forEach((n) => n.remove());
  const p = el('p', message, 'review-state review-state--ok');
  card.append(p, ...extra);
}

export function emptyState(text: string): HTMLElement {
  const box = el('div', null, 'review-card review-card--ok review-done');
  box.append(el('p', text));
  return box;
}

export const LIVE = 'Live on the website in a few minutes.';
