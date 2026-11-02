/** Event filters for /events/. The full list works without JavaScript; filters sync to the URL so views can be shared. */
import { eventDateRanges, matchesEventDate } from '../lib/event-date-windows';
import { track } from './analytics';

const form = document.querySelector<HTMLFormElement>('[data-event-filters]');
const list = document.querySelector<HTMLElement>('[data-upcoming-list]');

export const ranges = eventDateRanges;

if (form && list) {
  form.hidden = false;
  const count = document.querySelector<HTMLElement>('[data-result-count]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const cards = [...list.querySelectorAll<HTMLElement>('[data-event]')].filter((c) => !c.hasAttribute('data-expired'));
  const groups = [...list.querySelectorAll<HTMLElement>('[data-month-group]')];
  const r = ranges();

  const fields = ['when', 'category', 'dance', 'style', 'q', 'county', 'town', 'day', 'price', 'level', 'venue', 'person'] as const;
  type Field = (typeof fields)[number];
  const MORE: Field[] = ['county', 'town', 'day', 'price', 'level', 'venue', 'person'];
  /** Values that are left out of the address: all dates, and dances + live music (the default view). */
  const DEFAULTS: Partial<Record<Field, string>> = { when: 'all', category: 'dances' };

  function values(): Record<Field, string> {
    const fd = new FormData(form!);
    return Object.fromEntries(fields.map((f) => [f, String(fd.get(f) ?? '').trim()])) as Record<Field, string>;
  }

  const has = (list: string | undefined, v: string) => (list ?? '').split(' ').includes(v);

  function matches(c: HTMLElement, v: Record<Field, string>): boolean {
    const date = c.dataset.date ?? '';
    if (!matchesEventDate(date, v.when, r)) return false;
    // The default view: dances and live music people dance to (no classes, no listening-only concerts).
    if (v.category === 'dances' && (c.dataset.category === 'class-lesson' || c.dataset.dancing === 'unlikely')) return false;
    if (v.dance && !has(c.dataset.danceKinds, v.dance)) return false;
    if (v.category && v.category !== 'dances' && v.category !== 'all' && c.dataset.category !== v.category) return false;
    if (v.style && !has(c.dataset.styles, v.style)) return false;
    if (v.county && c.dataset.county !== v.county) return false;
    if (v.town && c.dataset.town !== v.town) return false;
    if (v.day && c.dataset.weekday !== v.day) return false;
    if (v.price && c.dataset.price !== v.price) return false;
    if (v.level && c.dataset.level !== v.level && c.dataset.level !== 'all-levels' && c.dataset.level !== 'mixed') return false;
    if (v.venue && c.dataset.venue !== v.venue) return false;
    if (v.person && !has(c.dataset.people, v.person)) return false;
    if (v.q && !(c.textContent ?? '').toLowerCase().includes(v.q.toLowerCase())) return false;
    return true;
  }

  function apply(source: 'load' | 'change') {
    const v = values();
    let shown = 0;
    for (const c of cards) {
      const ok = matches(c, v);
      c.hidden = !ok;
      if (ok) shown++;
    }
    for (const g of groups) g.hidden = !g.querySelector('[data-event]:not([hidden])');
    document.dispatchEvent(new CustomEvent('site:lists-changed'));
    if (count) count.textContent = `${shown} ${shown === 1 ? 'event' : 'events'} shown`;
    if (empty) empty.hidden = shown !== 0;
    const params = new URLSearchParams();
    for (const f of fields) if (v[f] && v[f] !== DEFAULTS[f]) params.set(f, v[f]);
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    if (source === 'change') {
      const active = fields.filter((f) => v[f] && v[f] !== DEFAULTS[f]);
      track('filter_events', { filter: active.join(',') || 'none', value: active.map((f) => v[f]).join(',').slice(0, 100), results: shown });
    }
  }

  // Restore state from the URL so filtered views can be shared.
  const params = new URLSearchParams(location.search);
  if (MORE.some((k) => params.get(k))) {
    const more = form.querySelector<HTMLDetailsElement>('.filters__more');
    if (more) more.open = true;
  }
  for (const f of fields) {
    const val = params.get(f);
    if (!val) continue;
    const el = form.elements.namedItem(f);
    if (el instanceof RadioNodeList) el.value = val;
    else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = val;
  }

  let debounce: number | undefined;
  form.addEventListener('input', (e) => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => apply('change'), (e.target as HTMLElement).matches('input[type=search]') ? 250 : 0);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    apply('change');
  });
  form.addEventListener('reset', () => setTimeout(() => apply('change'), 0));
  apply('load');
}
