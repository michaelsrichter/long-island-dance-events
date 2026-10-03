/**
 * Progressive enhancement for a static site: hide events that ended after the last build,
 * so an old event is never shown as "upcoming" even if the nightly rebuild has not run yet.
 */
import { track } from './analytics';

const now = Date.now();

document.querySelectorAll<HTMLElement>('[data-upcoming-list] [data-event]').forEach((el) => {
  const end = Number(el.dataset.end);
  if (end && end <= now) {
    el.hidden = true;
    el.setAttribute('data-expired', '');
  }
});

// Month headings with no remaining visible events.
document.querySelectorAll<HTMLElement>('[data-upcoming-list] [data-month-group], [data-upcoming-list] [data-host-section]').forEach((group) => {
  const visible = group.querySelectorAll('[data-event]:not([hidden])').length;
  if (visible === 0) group.hidden = true;
});

// Homepage featured "next dance": swap in the next candidate if the first has ended.
const candidates = [...document.querySelectorAll<HTMLElement>('[data-featured-candidate]')];
if (candidates.length) {
  const firstLive = candidates.find((c) => Number(c.dataset.end) > now);
  candidates.forEach((c) => {
    c.hidden = c !== firstLive;
  });
  const empty = document.querySelector<HTMLElement>('[data-featured-empty]');
  if (empty) empty.hidden = Boolean(firstLive);
  if (!firstLive) track('empty_state', { location: 'home_next' });
}

document.querySelectorAll<HTMLElement>('[data-upcoming-list]').forEach((list) => {
  const remaining = list.querySelectorAll('[data-event]:not([hidden])').length;
  const empty = list.parentElement?.querySelector<HTMLElement>('[data-upcoming-empty]');
  if (empty && remaining === 0) {
    empty.hidden = false;
    track('empty_state', { location: list.dataset.upcomingList || 'list' });
  }
});

// Event detail page that has ended since the build: show a notice.
const detail = document.querySelector<HTMLElement>('[data-event-detail]');
if (detail && Number(detail.dataset.end) <= now) {
  detail.querySelector<HTMLElement>('[data-ended-notice]')?.removeAttribute('hidden');
}
