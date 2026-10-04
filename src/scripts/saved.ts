/**
 * Saved events page (/saved/): the signed-in person's private list, with each event's next date.
 * Reads /api/me/saves (who saved what), /saved-events.json (next dates, built with the site) and,
 * for events with no upcoming date, /community-pages.json (name and link). Text is set with textContent.
 */
import { relativeLabel } from '../lib/relative';
import type { SavedIndex, SavedIndexDate } from '../lib/saved-index';
import { loginUrl, whoAmI } from './account-state';
import { toast } from './toast';

type Saved = { key: string; at: string; date?: string };

const root = document.querySelector<HTMLElement>('[data-saved]');
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayOf = (d: string, fmt = dayFmt) => fmt.format(new Date(`${d}T12:00:00Z`));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  try {
    const res = await fetch(url, init);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

if (root) {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const loading = q('[data-loading]');
  const signedOut = q('[data-signed-out]');
  const empty = q('[data-empty]');
  const upSection = q('[data-upcoming]');
  const upList = q<HTMLUListElement>('[data-upcoming-list]');
  const endSection = q('[data-ended]');
  const endList = q<HTMLUListElement>('[data-ended-list]');
  q<HTMLAnchorElement>('[data-signin]').href = loginUrl('/saved/');

  const refresh = () => {
    upSection.hidden = upList.children.length === 0;
    endSection.hidden = endList.children.length === 0;
    empty.hidden = upList.children.length + endList.children.length > 0;
  };

  function removeButton(key: string, name: string, li: HTMLLIElement) {
    const b = el('button', 'btn btn--secondary btn--small saved-item__remove');
    b.type = 'button';
    b.append('Remove', el('span', 'visually-hidden', ` ${name} from saved events`));
    b.addEventListener('click', async () => {
      b.disabled = true;
      const res = await fetch('/api/saves', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ key, save: false }) }).catch(() => null);
      if (res && res.ok) {
        li.remove();
        refresh();
        toast(`Removed ${name} from your saved events.`);
      } else {
        b.disabled = false;
        toast('Something went wrong. Please try again.');
      }
    });
    return b;
  }

  function upcomingItem(key: string, title: string, place: string, kind: string, repeats: string | undefined, dates: SavedIndexDate[], now: number) {
    const next = dates[0]!;
    const li = el('li', 'panel saved-item');
    const when = relativeLabel(next.s, next.e, now, { allDay: !next.l });
    const top = el('p', 'saved-item__top');
    top.append(el('span', 'cat-badge', kind));
    if (when.text) {
      const pill = el('span', 'when', when.text);
      pill.dataset.tone = when.tone;
      top.append(pill);
    }
    if (next.x) top.append(el('span', 'status status--cancelled', 'Cancelled'));
    const h = el('h3', 'saved-item__title');
    const a = el('a', undefined, title);
    a.href = next.u;
    h.append(a);
    const meta = el('p', 'saved-item__meta', `${dayOf(next.d)}${next.l ? ` · ${next.l}` : ''}${place ? ` · ${place}` : ''}`);
    li.append(top, h, meta);
    if (repeats) li.append(el('p', 'muted saved-item__repeats', repeats));
    const more = dates.slice(1, 4);
    if (more.length) {
      const p = el('p', 'muted saved-item__more', 'Also: ');
      more.forEach((d, i) => {
        if (i) p.append(', ');
        const link = el('a', undefined, dayOf(d.d, shortFmt));
        link.href = d.u;
        p.append(link);
      });
      li.append(p);
    }
    li.append(removeButton(key, title, li));
    return li;
  }

  function endedItem(key: string, name: string, url: string | undefined) {
    const li = el('li', 'panel saved-item');
    const h = el('h3', 'saved-item__title');
    if (url) {
      const a = el('a', undefined, name);
      a.href = url;
      h.append(a);
    } else h.textContent = name;
    li.append(h, removeButton(key, name, li));
    return li;
  }

  (async () => {
    const me = await whoAmI();
    loading.hidden = true;
    if (!me.signedIn) {
      signedOut.hidden = false;
      return;
    }
    for (const n of root.querySelectorAll<HTMLElement>('[data-signed-in]')) n.hidden = false;
    loading.hidden = false;
    const [mine, index] = await Promise.all([
      getJson('/api/me/saves', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' }),
      getJson('/saved-events.json') as Promise<SavedIndex | null>,
    ]);
    const saved: Saved[] = Array.isArray(mine?.saved) ? mine.saved : [];
    const now = Date.now();
    const upcoming: { key: string; first: number; li: HTMLLIElement }[] = [];
    const ended: Saved[] = [];
    for (const s of saved) {
      const id = s.key.startsWith('event:') ? s.key.slice(6) : '';
      const entry = index?.events?.[id];
      const dates = (entry?.o ?? []).filter((d) => d.e > now);
      if (entry && dates.length) upcoming.push({ key: s.key, first: dates[0]!.s, li: upcomingItem(s.key, entry.t, entry.p, entry.c, entry.r, dates, now) });
      else ended.push(s);
    }
    upcoming.sort((a, b) => a.first - b.first).forEach((u) => upList.append(u.li));
    if (ended.length) {
      const pages = await getJson('/community-pages.json');
      for (const s of ended) endList.append(endedItem(s.key, pages?.names?.[s.key] ?? 'An event that is no longer listed', pages?.urls?.[s.key]));
    }
    loading.hidden = true;
    if (!mine) toast('Could not load your saved events. Please try again.');
    refresh();
  })();
}
