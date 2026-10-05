/**
 * The data-* attributes the event filters read (scripts/event-match.ts). List cards, month-calendar entries and
 * map items all use these, so one set of filters works in every view.
 */
import type { ResolvedEvent } from './content';
import { eventFeatures } from './event-features';

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
