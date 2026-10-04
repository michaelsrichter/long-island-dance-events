/**
 * Like and Save buttons (components/Reactions.astro) on event cards and at the top of detail pages.
 * - Like counts come from small public files in Blob Storage (no Function call).
 * - Which pages you liked or saved is asked once per page, and only if this browser has signed in before.
 * - One like per person per page: the API keeps one row per person, so a second like changes nothing.
 * All text is set with textContent.
 */
import { COMMUNITY, readModelUrl } from '../lib/community';
import { cachedAccount, loginUrl, rememberAccount, whoAmI } from './account-state';
import { toast } from './toast';

const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-react]'));
const liked = new Set<string>();
const saved = new Set<string>();
const counts = new Map<string, number>();
const busy = new Set<string>();
/** Pages liked or unliked on this visit: their count came from the API, so a slower public count file must not overwrite it. */
const changed = new Set<string>();
let signedIn = false;

const here = () => location.pathname + location.search;
const groupsFor = (key: string) => groups.filter((g) => g.dataset.key === key);

function paint(key: string) {
  const n = counts.get(key) || 0;
  const isLiked = liked.has(key);
  const isSaved = saved.has(key);
  for (const g of groupsFor(key)) {
    const like = g.querySelector<HTMLButtonElement>('[data-like]');
    if (like) {
      like.setAttribute('aria-pressed', String(isLiked));
      like.classList.toggle('is-on', isLiked);
      like.querySelector('[data-like-label]')!.textContent = isLiked ? 'Liked' : 'Like';
      const count = like.querySelector<HTMLElement>('[data-like-count]')!;
      count.hidden = n === 0;
      const unit = document.createElement('span');
      unit.className = 'visually-hidden';
      unit.textContent = n === 1 ? ' like' : ' likes';
      count.replaceChildren(String(n), unit);
    }
    const save = g.querySelector<HTMLButtonElement>('[data-save]');
    if (save) {
      save.setAttribute('aria-pressed', String(isSaved));
      save.classList.toggle('is-on', isSaved);
      save.querySelector('[data-save-label]')!.textContent = isSaved ? 'Saved' : 'Save';
    }
  }
}

function paintAll() {
  for (const key of new Set(groups.map((g) => g.dataset.key!))) paint(key);
}

function setDisabled(key: string, disabled: boolean) {
  for (const g of groupsFor(key)) {
    for (const b of g.querySelectorAll<HTMLButtonElement>('button')) {
      b.disabled = disabled;
      if (disabled) b.setAttribute('aria-busy', 'true');
      else b.removeAttribute('aria-busy');
    }
  }
}

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; data: any }> {
  try {
    const res = await fetch(url, init);
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/** Public like counts: one small file per page type, plus the page's own file on detail pages (fresher). */
async function loadCounts() {
  const types = new Set(groups.map((g) => g.dataset.key!.split(':')[0]));
  await Promise.all(
    [...types].map(async (type) => {
      const r = await getJson(`${COMMUNITY.blobBase}/community/counts/${type}.json`, { credentials: 'omit' });
      const likes = r.status === 200 && r.data && typeof r.data.likes === 'object' ? r.data.likes : {};
      for (const g of groups) {
        const [t, id] = g.dataset.key!.split(':');
        if (t === type && !changed.has(g.dataset.key!)) counts.set(g.dataset.key!, Number(likes[id!]) || 0);
      }
    }),
  );
  await Promise.all(
    groups
      .filter((g) => g.hasAttribute('data-detail'))
      .map(async (g) => {
        const r = await getJson(readModelUrl(g.dataset.key!), { credentials: 'omit' });
        if (r.status === 200 && r.data && typeof r.data.likes === 'number' && !changed.has(g.dataset.key!)) counts.set(g.dataset.key!, r.data.likes);
      }),
  );
  paintAll();
}

/** What this person liked and saved (only when this browser has signed in before). */
async function loadMine() {
  if (!cachedAccount()) return;
  const me = await whoAmI();
  if (!me.signedIn) {
    rememberAccount(null);
    return;
  }
  signedIn = true;
  const wantSaves = groups.some((g) => g.querySelector('[data-save]'));
  const [likes, saves] = await Promise.all([
    getJson('/api/me/likes', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
    wantSaves ? getJson('/api/me/saves', { credentials: 'same-origin', headers: { Accept: 'application/json' } }) : Promise.resolve(null),
  ]);
  for (const k of Object.keys(likes.data?.liked || {})) liked.add(k);
  for (const s of saves?.data?.saved || []) if (s && typeof s.key === 'string') saved.add(s.key);
  paintAll();
}

function handleError(r: { status: number; data: any }) {
  if (r.status === 401) {
    rememberAccount(null);
    location.href = loginUrl(here());
  } else if (r.status === 428) {
    location.href = `/account/?next=${encodeURIComponent(here())}`;
  } else toast(r.data?.message || 'Something went wrong. Please try again.');
}

async function onClick(btn: HTMLButtonElement) {
  const group = btn.closest<HTMLElement>('[data-react]');
  if (!group) return;
  const key = group.dataset.key!;
  if (!signedIn) {
    location.href = loginUrl(here());
    return;
  }
  if (busy.has(key)) return;
  busy.add(key);
  setDisabled(key, true);
  try {
    if (btn.hasAttribute('data-like')) {
      const want = !liked.has(key);
      const r = await getJson('/api/likes', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ key, like: want }) });
      if (r.status === 200) {
        if (r.data.liked) liked.add(key);
        else liked.delete(key);
        counts.set(key, Number(r.data.count) || 0);
        changed.add(key);
        paint(key);
        toast(r.data.liked ? 'Liked! Thanks.' : 'Like removed.');
      } else handleError(r);
    } else if (btn.hasAttribute('data-save')) {
      const want = !saved.has(key);
      const date = group.dataset.date;
      const r = await getJson('/api/saves', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ key, save: want, ...(date ? { date } : {}) }) });
      if (r.status === 200) {
        if (r.data.saved) saved.add(key);
        else saved.delete(key);
        paint(key);
        toast(r.data.saved ? 'Saved! See it on your Saved events page.' : 'Removed from your saved events.');
      } else handleError(r);
    }
  } finally {
    busy.delete(key);
    setDisabled(key, false);
  }
}

if (groups.length) {
  paintAll();
  document.addEventListener('click', (ev) => {
    const btn = (ev.target as Element | null)?.closest<HTMLButtonElement>('[data-react] button');
    if (btn) {
      ev.preventDefault();
      void onClick(btn);
    }
  });
  void loadCounts();
  loadMine().finally(() => {
    for (const g of groups) for (const b of g.querySelectorAll<HTMLButtonElement>('button')) b.disabled = false;
  });
}
