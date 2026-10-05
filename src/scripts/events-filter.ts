/** Event filters for /events/. The full list works without JavaScript; filters sync to the URL so views can be shared. */
import { track } from './analytics';
import { FILTER_DEFAULTS, FILTER_FIELDS, fillFilterForm, filterParams, matchesEvent, ranges, readFilterForm, syncFilterLinks } from './event-match';

export { ranges };

const form = document.querySelector<HTMLFormElement>('[data-event-filters][data-view="list"]');
const list = document.querySelector<HTMLElement>('[data-upcoming-list]');

if (form && list) {
  form.hidden = false;
  const count = form.querySelector<HTMLElement>('[data-result-count]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const cards = [...list.querySelectorAll<HTMLElement>('[data-event]')].filter((c) => !c.hasAttribute('data-expired'));
  const groups = [...list.querySelectorAll<HTMLElement>('[data-month-group]')];
  const r = ranges();
  /** Filters kept behind "More filters"; the panel opens when one of them is set. */
  const MORE = ['county', 'town', 'day', 'price', 'level', 'venue', 'person'];

  function apply(source: 'load' | 'change') {
    const v = readFilterForm(form!);
    let shown = 0;
    for (const c of cards) {
      const ok = matchesEvent(c.dataset, c.textContent ?? '', v, r);
      c.hidden = !ok;
      if (ok) shown++;
    }
    for (const g of groups) g.hidden = !g.querySelector('[data-event]:not([hidden])');
    document.dispatchEvent(new CustomEvent('site:lists-changed'));
    if (count) count.textContent = `${shown} ${shown === 1 ? 'event' : 'events'} shown`;
    if (empty) empty.hidden = shown !== 0;
    syncFilterLinks(filterParams(v));
    if (source === 'change') {
      const active = FILTER_FIELDS.filter((f) => v[f] && v[f] !== FILTER_DEFAULTS[f]);
      track('filter_events', { filter: active.join(',') || 'none', value: active.map((f) => v[f]).join(',').slice(0, 100), results: shown });
    }
  }

  // Restore state from the URL so filtered views can be shared.
  const params = new URLSearchParams(location.search);
  if (MORE.some((k) => params.get(k))) {
    const more = form.querySelector<HTMLDetailsElement>('.filters__more');
    if (more) more.open = true;
  }
  fillFilterForm(form, params);

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
