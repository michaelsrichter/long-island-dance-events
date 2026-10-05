/**
 * Month calendar filters (components/MonthCalendar.astro): the same choices as the event list and map. Hides
 * entries in the month grid and in the phone agenda. A crowded day shows its first 3 matching events and a
 * "+N more" button. Without JavaScript every event shows.
 */
import { fillFilterForm, filterParams, matchesEvent, ranges, readFilterForm, setupFilterPanel, syncFilterLinks } from './event-match';
import { track } from './analytics';

const form = document.querySelector<HTMLFormElement>('[data-event-filters][data-view="calendar"]');
/** Events shown in one calendar square before "+N more". */
export const CAL_MAX = 3;

if (form) {
  const showActive = setupFilterPanel(form);
  const entries = [...document.querySelectorAll<HTMLElement>('[data-cal-event]')];
  const cards = [...document.querySelectorAll<HTMLElement>('.cal-agenda [data-event]')];
  const cells = [...document.querySelectorAll<HTMLElement>('td[data-cal-day]')];
  const count = form.querySelector<HTMLElement>('[data-result-count]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const monthLabel = document.getElementById('cal-title')?.textContent?.trim() ?? 'this month';
  const r = ranges();
  const params = new URLSearchParams(location.search);
  // The calendar shows a whole month, so "when" (today, this weekend...) is kept for the other views but not used here.
  const carriedWhen = params.get('when') ?? '';
  const MORE = ['dance', 'county', 'town', 'day', 'price', 'level', 'venue', 'person'];
  if (MORE.some((k) => params.get(k))) {
    const more = form.querySelector<HTMLDetailsElement>('.filters__more');
    if (more) more.open = true;
  }
  fillFilterForm(form, params);

  const matched = new Set<HTMLElement>();

  function layoutCell(td: HTMLElement) {
    const items = [...td.querySelectorAll<HTMLElement>('[data-cal-event]')].filter((e) => matched.has(e));
    const open = td.hasAttribute('data-cal-open');
    items.forEach((e, i) => (e.hidden = !open && i >= CAL_MAX));
    let more = td.querySelector<HTMLButtonElement>('[data-cal-more]');
    const extra = items.length - CAL_MAX;
    if (extra <= 0) {
      more?.remove();
      td.removeAttribute('data-cal-open');
      return;
    }
    if (!more) {
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'cal__more';
      more.setAttribute('data-cal-more', '');
      more.addEventListener('click', () => {
        td.toggleAttribute('data-cal-open');
        layoutCell(td);
        if (td.hasAttribute('data-cal-open')) track('filter_events', { location: 'calendar', filter: 'more_in_day', value: td.dataset.calDay ?? '' });
      });
      td.append(more);
    }
    const day = new Date(`${td.dataset.calDay}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? 'Show fewer' : `+${extra} more`;
    more.setAttribute('aria-label', open ? `Show fewer events on ${day}` : `Show ${extra} more ${extra === 1 ? 'event' : 'events'} on ${day}`);
  }

  function apply(source: 'load' | 'change') {
    const v = { ...readFilterForm(form!), when: '' };
    matched.clear();
    for (const e of entries) {
      const ok = matchesEvent(e.dataset, e.textContent ?? '', v, r);
      if (ok) matched.add(e);
      e.hidden = !ok;
    }
    let cardsShown = 0;
    for (const c of cards) {
      const ok = matchesEvent(c.dataset, c.textContent ?? '', v, r);
      c.hidden = !ok;
      if (ok) cardsShown++;
    }
    for (const td of cells) layoutCell(td);
    const shown = entries.length ? matched.size : cardsShown;
    if (count) count.textContent = `${shown} ${shown === 1 ? 'event' : 'events'} shown in ${monthLabel}`;
    if (empty) empty.hidden = shown !== 0;
    syncFilterLinks(filterParams({ ...v, when: carriedWhen }));
    showActive(v);
    if (source === 'change') track('filter_events', { location: 'calendar', filter: filterParams(v).toString().slice(0, 100) || 'none', results: shown });
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
