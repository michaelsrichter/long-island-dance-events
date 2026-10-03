/** Mobile navigation disclosure + closing disclosure menus on outside click / Escape. */
const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const panel = document.querySelector<HTMLElement>('[data-nav-panel]');

function setOpen(open: boolean) {
  if (!toggle || !panel) return;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) panel.setAttribute('data-open', '');
  else panel.removeAttribute('data-open');
}

toggle?.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (toggle?.getAttribute('aria-expanded') === 'true') {
    setOpen(false);
    toggle.focus();
  }
  document.querySelectorAll<HTMLDetailsElement>('details[data-menu][open]').forEach((d) => {
    d.open = false;
    d.querySelector<HTMLElement>('summary')?.focus();
  });
});

document.addEventListener('click', (e) => {
  const target = e.target as Node;
  document.querySelectorAll<HTMLDetailsElement>('details[data-menu][open]').forEach((d) => {
    if (!d.contains(target)) d.open = false;
  });
  if (toggle && panel && toggle.getAttribute('aria-expanded') === 'true' && !panel.contains(target) && !toggle.contains(target)) {
    setOpen(false);
  }
});

// Close the mobile menu if the viewport grows past the breakpoint.
window.matchMedia('(min-width: 78rem)').addEventListener('change', (m) => {
  if (m.matches) setOpen(false);
});
