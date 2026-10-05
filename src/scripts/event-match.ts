/**
 * Event filters shared by the list (/events/), the month calendar and the map: one set of names in the address
 * bar, one matching rule, so a filtered view stays filtered when you switch views. Items carry the data-*
 * attributes from lib/event-filter-data.ts. No DOM side effects on import.
 */

export const FILTER_FIELDS = ['when', 'category', 'has', 'dance', 'style', 'q', 'county', 'town', 'day', 'price', 'level', 'venue', 'person'] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];
export type FilterValues = Record<FilterField, string>;

/** Values left out of the address: all dates, and dances + live music (the default view everywhere). */
export const FILTER_DEFAULTS: Partial<FilterValues> = { when: 'all', category: 'dances' };

const nyDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};

/** Today's date and the coming weekend (Friday to Sunday; from today when already in it), in New York time. */
export function ranges(now = new Date()) {
  const today = nyDate(now);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const friday = addDays(today, dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow);
  const weekendFrom = dow === 0 || dow === 6 ? today : friday;
  return { today, weekEnd: addDays(today, 6), month: today.slice(0, 7), weekendFrom, weekendTo: addDays(friday, 2) };
}
export type Ranges = ReturnType<typeof ranges>;

const has = (list: string | undefined, v: string) => (list ?? '').split(' ').includes(v);

/** Does an item (a card, calendar entry or map row) match the filters? `text` is used for the search box. */
export function matchesEvent(ds: DOMStringMap, text: string, v: Partial<FilterValues>, r: Ranges): boolean {
  const date = ds.date ?? '';
  if (v.when === 'today' && date !== r.today) return false;
  if (v.when === 'weekend' && (date < r.weekendFrom || date > r.weekendTo)) return false;
  if (v.when === 'week' && (date < r.today || date > r.weekEnd)) return false;
  if (v.when === 'month' && !date.startsWith(r.month)) return false;
  // The default view: dances and live music people dance to (no classes, no listening-only concerts).
  const category = v.category || 'dances';
  if (category === 'dances' && (ds.category === 'class-lesson' || ds.dancing === 'unlikely')) return false;
  if (category !== 'dances' && category !== 'all' && ds.category !== category) return false;
  for (const f of (v.has ?? '').split(',').filter(Boolean)) if (!has(ds.features, f)) return false;
  if (v.dance && !has(ds.danceKinds, v.dance)) return false;
  if (v.style && !has(ds.styles, v.style)) return false;
  if (v.county && ds.county !== v.county) return false;
  if (v.town && ds.town !== v.town) return false;
  if (v.day && ds.weekday !== v.day) return false;
  if (v.price && ds.price !== v.price) return false;
  if (v.level && ds.level !== v.level && ds.level !== 'all-levels' && ds.level !== 'mixed') return false;
  if (v.venue && ds.venue !== v.venue) return false;
  if (v.person && !has(ds.people, v.person)) return false;
  if (v.q && !text.toLowerCase().includes(v.q.toLowerCase())) return false;
  return true;
}

/** Read a filter form. Checkboxes named "has" become one comma list ("dj,free"). Fields the form lacks are empty. */
export function readFilterForm(form: HTMLFormElement): FilterValues {
  const fd = new FormData(form);
  const out = {} as FilterValues;
  for (const f of FILTER_FIELDS) out[f] = f === 'has' ? fd.getAll('has').map(String).filter(Boolean).join(',') : String(fd.get(f) ?? '').trim();
  return out;
}

/** Put values from the address bar into a filter form (radios, checkboxes, selects and text boxes). */
export function fillFilterForm(form: HTMLFormElement, params: URLSearchParams) {
  for (const f of FILTER_FIELDS) {
    const val = params.get(f);
    if (!val) continue;
    if (f === 'has') {
      const wanted = new Set(val.split(','));
      for (const box of form.querySelectorAll<HTMLInputElement>('input[name="has"]')) box.checked = wanted.has(box.value);
      continue;
    }
    const el = form.elements.namedItem(f);
    if (el instanceof RadioNodeList) {
      if ([...el].some((r) => (r as HTMLInputElement).value === val)) el.value = val;
    } else if (el instanceof HTMLSelectElement) {
      if ([...el.options].some((o) => o.value === val)) el.value = val;
    } else if (el instanceof HTMLInputElement) el.value = val;
  }
}

/** The address-bar part for these values (defaults and empty values left out). */
export function filterParams(v: Partial<FilterValues>): URLSearchParams {
  const params = new URLSearchParams();
  for (const f of FILTER_FIELDS) {
    const val = v[f];
    if (val && val !== FILTER_DEFAULTS[f]) params.set(f, val);
  }
  return params;
}

/** Update the address bar, and the List / Month calendar / Map links (and month arrows), so filters follow you. */
export function syncFilterLinks(params: URLSearchParams) {
  const qs = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-carry-filters]')) {
    const url = new URL(a.href, location.href);
    url.search = qs;
    a.href = url.pathname + url.search + url.hash;
  }
}

/** How many filters are set (dates, type, each "What's there" chip...), for the "Filters · 2 on" button. */
export function activeFilterCount(v: Partial<FilterValues>): number {
  return FILTER_FIELDS.reduce((n, f) => {
    const val = v[f];
    if (!val || val === FILTER_DEFAULTS[f]) return n;
    return n + (f === 'has' ? val.split(',').filter(Boolean).length : 1);
  }, 0);
}

/**
 * Calendar and map: the filters sit in a "Filters" panel that is folded on phones (so the calendar or map
 * comes first) and open on wider screens. The form is moved into the panel here; without JavaScript neither shows.
 */
export function setupFilterPanel(form: HTMLFormElement): (v: Partial<FilterValues>) => void {
  const panel = form.previousElementSibling instanceof HTMLDetailsElement && form.previousElementSibling.matches('[data-filters-panel]') ? form.previousElementSibling : null;
  if (!panel) return () => {};
  panel.append(form);
  if (window.matchMedia('(min-width: 48rem)').matches) panel.open = true;
  const badge = panel.querySelector<HTMLElement>('[data-filter-count]');
  return (v) => {
    const n = activeFilterCount(v);
    if (badge) badge.textContent = n ? ` · ${n} on` : '';
  };
}
