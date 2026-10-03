/**
 * "Show more" for long Riverbend event lists. A container with data-collapse="3" shows only its first
 * three visible events; a button (data-collapse-toggle="<container id>") reveals the rest.
 *
 * The page is rendered already collapsed (items carry data-collapsed, hidden by CSS only when
 * JavaScript runs), so there is no layout shift and everything shows without JavaScript.
 * This script keeps the count right when events end after the build, and turns collapsing off
 * while event filters are active (filters add data-collapse-filtered to the container).
 */
import { track } from './analytics';

function update(container: HTMLElement) {
  const limit = Number(container.dataset.collapse) || 3;
  const expanded = container.dataset.collapseState === 'expanded';
  const off = container.hasAttribute('data-collapse-filtered');
  const items = [...container.querySelectorAll<HTMLElement>('[data-event]')];
  const visible = items.filter((i) => !i.hidden);
  visible.forEach((item, i) => item.toggleAttribute('data-collapsed', !expanded && !off && i >= limit));
  for (const item of items) if (item.hidden) item.removeAttribute('data-collapsed');

  const extra = Math.max(0, visible.length - limit);
  const button = document.querySelector<HTMLButtonElement>(`[data-collapse-toggle="${container.id}"]`);
  if (!button) return;
  const label = button.dataset.collapseLabel ?? 'events';
  button.closest<HTMLElement>('[data-collapse-more]')!.hidden = off || extra === 0;
  button.setAttribute('aria-expanded', String(expanded));
  button.textContent = expanded ? `Show fewer ${label}` : `Show ${extra} more ${label}`;
}

function refreshAll() {
  document.querySelectorAll<HTMLElement>('[data-collapse]').forEach(update);
}

document.querySelectorAll<HTMLButtonElement>('[data-collapse-toggle]').forEach((button) => {
  const container = document.getElementById(button.dataset.collapseToggle ?? '');
  if (!container) return;
  button.addEventListener('click', () => {
    const expanding = container.dataset.collapseState !== 'expanded';
    container.dataset.collapseState = expanding ? 'expanded' : 'collapsed';
    update(container);
    const limit = Number(container.dataset.collapse) || 3;
    const shown = [...container.querySelectorAll<HTMLElement>('[data-event]')].filter((i) => !i.hidden);
    track('show_more', {
      method: expanding ? 'expand' : 'collapse',
      location: container.closest<HTMLElement>('[data-upcoming-list]')?.dataset.upcomingList ?? 'list',
      results: Math.max(0, shown.length - limit),
    });
    if (expanding) {
      // Move focus to the first newly shown event so keyboard and screen-reader users land on it.
      shown[limit]?.querySelector<HTMLAnchorElement>('a')?.focus();
    } else {
      container.scrollIntoView({ block: 'nearest' });
    }
  });
});

// Filters and other scripts announce list changes with this event.
document.addEventListener('site:lists-changed', refreshAll);
refreshAll();
