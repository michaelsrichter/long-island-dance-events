/**
 * The data-* attributes the event filters read (scripts/event-match.ts). List cards, month-calendar entries and
 * map items all use these, so one set of filters works in every view.
 */
import type { ResolvedEvent } from './content';
import { eventFeatures } from './event-features';
import { FILTER_DEFAULTS, matchesEvent, ranges } from '../scripts/event-match';

export function eventFilterData(e: ResolvedEvent): Record<string, string> {
  const people = [...e.performers, ...e.instructors];
  return {
    'data-date': e.date,
    'data-end': String(e.end.getTime()),
    'data-start-min': e.timeTba ? '' : e.startLocal.slice(11),
    'data-status': e.status,
    'data-category': e.category,
    'data-styles': e.styles.map((s) => s.id).join(' '),
    'data-venue': e.venue?.id ?? '',
    'data-town': e.location.town ?? '',
    'data-county': e.location.county ?? '',
    'data-weekday': e.weekday,
    'data-level': e.data.skillLevel,
    'data-price': e.price.free ? 'free' : e.price.known ? 'paid' : 'unknown',
    'data-people': people.map((p) => p.id).join(' '),
    'data-organizer': e.organizer?.id ?? '',
    'data-dancing': e.dancing.level,
    'data-dance-kinds': e.dancing.kinds.join(' '),
    'data-features': eventFeatures(e).join(' '),
  };
}

/** The attributes as the browser's `element.dataset` sees them ('data-dance-kinds' becomes danceKinds). */
export function filterDataset(e: ResolvedEvent): Record<string, string> {
  return Object.fromEntries(Object.entries(eventFilterData(e)).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
}

/**
 * Shown when no filters are chosen (dances and live music; the calendar ignores dates). Uses the browser's own
 * matcher, so a page can start in its filtered state and nothing moves when the script runs.
 */
export function shownByDefault(e: ResolvedEvent): boolean {
  return matchesEvent(filterDataset(e), '', { ...FILTER_DEFAULTS, when: '' }, ranges());
}
