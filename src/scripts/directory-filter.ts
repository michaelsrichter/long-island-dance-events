/**
 * Directory search and filters (components/DirectoryFilters.astro). Hides cards that do not match,
 * hides groups (e.g. a county) with no cards left, updates the count, and keeps the choices in the
 * address bar so a filtered list can be shared or reloaded.
 */
const form = document.querySelector<HTMLFormElement>('[data-dir-filters]');

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

if (form) {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-dir-item]'));
  const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-dir-group]'));
  const count = form.querySelector<HTMLElement>('[data-dir-count]');
  const empty = document.querySelector<HTMLElement>('[data-dir-empty]');
  const noun = form.dataset.noun ?? 'items';
  const one = form.dataset.one ?? 'item';
  const label = (n: number) => `${n} ${n === 1 ? one : noun}`;

  const read = () => {
    const fd = new FormData(form);
    return {
      q: String(fd.get('q') ?? ''),
      town: String(fd.get('town') ?? ''),
      kind: String(fd.get('kind') ?? ''),
      upcoming: fd.get('upcoming') === '1',
    };
  };

  const apply = (updateUrl: boolean) => {
    const f = read();
    const terms = norm(f.q).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const el of items) {
      const text = el.dataset.search ?? '';
      const ok =
        terms.every((t) => text.includes(t)) &&
        (!f.town || el.dataset.fTown === f.town) &&
        (!f.kind || el.dataset.fKind === f.kind) &&
        (!f.upcoming || el.dataset.upcoming === '1');
      el.hidden = !ok;
      if (ok) shown++;
    }
    for (const g of groups) g.hidden = !g.querySelector('[data-dir-item]:not([hidden])');
    if (count) count.textContent = shown === items.length ? label(shown) : `Showing ${shown} of ${label(items.length)}`;
    if (empty) empty.hidden = shown > 0;
    if (updateUrl) {
      const p = new URLSearchParams();
      if (f.q.trim()) p.set('q', f.q.trim());
      if (f.town) p.set('town', f.town);
      if (f.kind) p.set('kind', f.kind);
      if (f.upcoming) p.set('upcoming', '1');
      const qs = p.toString();
      history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
    }
  };

  // Start from the address bar (?town=Patchogue&upcoming=1&kind=dj&q=...).
  const params = new URLSearchParams(location.search);
  const q = form.elements.namedItem('q') as HTMLInputElement | null;
  if (q && params.get('q')) q.value = params.get('q')!;
  const town = form.elements.namedItem('town') as HTMLSelectElement | null;
  if (town && params.get('town') && Array.from(town.options).some((o) => o.value === params.get('town'))) town.value = params.get('town')!;
  const kind = params.get('kind');
  if (kind) {
    const radio = form.querySelector<HTMLInputElement>(`input[name="kind"][value="${CSS.escape(kind)}"]`);
    if (radio) radio.checked = true;
  }
  const up = form.elements.namedItem('upcoming') as HTMLInputElement | null;
  if (up && params.get('upcoming') === '1') up.checked = true;
  if (params.toString()) apply(false);

  form.addEventListener('input', () => apply(true));
  form.addEventListener('change', () => apply(true));
  form.addEventListener('submit', (e) => e.preventDefault());
  document.querySelector('[data-dir-reset]')?.addEventListener('click', () => {
    form.reset();
    apply(true);
    q?.focus();
  });
}
