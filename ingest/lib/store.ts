/** Read and write entity files with a stable key order so weekly diffs stay small and readable. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR } from './registry';

const EVENT_ORDER = [
  'title', 'summary', 'category', 'danceStyles', 'start', 'end', 'timezone', 'recurrence', 'cadence', 'lessonTime',
  'venueId', 'town', 'organizerId', 'performerIds', 'instructorIds', 'price', 'priceMax', 'isFree', 'priceNotes',
  'skillLevel', 'ageGroup', 'ticketUrl', 'infoUrl', 'contactPhone', 'contactEmail', 'status', 'cancelledNote',
  'sourceId', 'sourceUrl', 'sourceName', 'sourceRef', 'firstSeen', 'lastSeen', 'confidence', 'matchKey', 'mergedFrom',
  'lockedFields', 'reviewNotes', 'seoTitle', 'seoDescription',
];

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Drop empty values and order keys: known keys first in `order`, the rest alphabetically. */
export function tidy(obj: Record<string, unknown>, order: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = [...order.filter((k) => k in obj), ...Object.keys(obj).filter((k) => !order.includes(k)).sort()];
  for (const k of keys) {
    let v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      v = tidy(v as Record<string, unknown>, ['rrule', 'rdates', 'exdates']);
      if (Object.keys(v as object).length === 0) continue;
    }
    if (!isEmpty(v)) out[k] = v;
  }
  return out;
}

export function serialize(obj: Record<string, unknown>, order: string[] = []): string {
  return `${JSON.stringify(tidy(obj, order), null, 2)}\n`;
}

export function writeEntity(collection: string, id: string, data: Record<string, unknown>, contentDir = CONTENT_DIR): boolean {
  const dir = join(contentDir, collection);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  const text = serialize(data, collection === 'events' ? EVENT_ORDER : ['name', 'type', 'aliases']);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (before === text) return false;
  writeFileSync(file, text, 'utf8');
  return true;
}

export { EVENT_ORDER };
