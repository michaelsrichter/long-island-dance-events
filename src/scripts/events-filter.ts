/** Lightweight event filtering for /events/. The full list works without JavaScript. */
import { track } from './analytics';

const form = document.querySelector<HTMLFormElement>('[data-event-filters]');
const list = document.querySelector<HTMLElement>('[data-upcoming-list]');

if (form && list) {
  form.hidden = false;
  const count = document.querySelector<HTMLElement>('[data-result-count]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const cards = [...list.querySelectorAll<HTMLElement>('[data-event]')].filter((c) => !c.hasAttribute('data-expired'));
  const groups = [...list.querySelectorAll<HTMLElement>('[data-month-group]')];
  const hostSections = [...list.querySelectorAll<HTMLElement>('[data-host-section]')];

  const nyDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = nyDate(new Date());
  const weekEnd = nyDate(new Date(Date.now() + 6 * 86400000));
  const month = today.slice(0, 7);

  const fields = ['when', 'host', 'type', 'style', 'venue', 'lesson', 'level', 'q'] as const;
  type Field = (typeof fields)[number];

  function values(): Record<Field, string> {
    const fd = new FormData(form!);
    return Object.fromEntries(fields.map((f) => [f, String(fd.get(f) ?? '').trim()])) as Record<Field, string>;
  }

  function matches(c: HTMLElement, v: Record<Field, string>): boolean {
    const date = c.dataset.date ?? '';
    if (v.when === 'today' && date !== today) return false;
    if (v.when === 'week' && (date < today || date > weekEnd)) return false;
    if (v.when === 'month' && !date.startsWith(month)) return false;
    if (v.when === 'band' && c.dataset.band !== 'yes') return false;
    if (v.host && c.dataset.host !== v.host) return false;
    if (v.type && !(c.dataset.types ?? '').split(' ').includes(v.type)) return false;
    if (v.style && !(c.dataset.styles ?? '').split(' ').includes(v.style)) return false;
    if (v.venue && c.dataset.venue !== v.venue) return false;
    if (v.lesson === 'yes' && c.dataset.lesson !== 'yes') return false;
    if (v.level && c.dataset.level !== v.level && c.dataset.level !== 'all-levels') return false;
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
    for (const s of hostSections) s.hidden = !s.querySelector('[data-event]:not([hidden])');
    // While filters are on, show every match; the "Show more" collapse returns when filters are cleared.
    const filtering = fields.some((f) => v[f] && !(f === 'when' && v[f] === 'all'));
    list!.querySelectorAll<HTMLElement>('[data-collapse]').forEach((c) => c.toggleAttribute('data-collapse-filtered', filtering));
    document.dispatchEvent(new CustomEvent('site:lists-changed'));
    if (count) count.textContent = `${shown} ${shown === 1 ? 'event' : 'events'} shown`;
    if (empty) empty.hidden = shown !== 0;
    const params = new URLSearchParams();
    for (const f of fields) if (v[f] && !(f === 'when' && v[f] === 'all')) params.set(f, v[f]);
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    if (source === 'change') {
      const active = fields.filter((f) => v[f] && v[f] !== 'all');
      track('filter_events', { filter: active.join(',') || 'none', value: active.map((f) => v[f]).join(',').slice(0, 100), results: shown });
    }
  }

  // Restore state from the URL so filtered views can be shared.
  const params = new URLSearchParams(location.search);
  if (['type', 'style', 'venue', 'lesson', 'level', 'q'].some((k) => params.get(k))) {
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
