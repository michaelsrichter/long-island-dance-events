/**
 * Build the snapshot the nightly database sync sends to the live server (decision P56):
 * every content file (exact text + parsed record, each checked with the site's own schemas),
 * every date of every event for the next 120 days (the same rules the site uses), and the place list.
 *
 *   npx tsx scripts/db/build-payload.ts --out payload.json.gz
 *
 * Exits with an error, sending nothing, if any record is invalid.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { z } from 'astro/zod';
import {
  eventSchema,
  faqSchema,
  gallerySchema,
  instructorSchema,
  organizerSchema,
  pageSchema,
  performerSchema,
  settingsSchema,
  sourceSchema,
  styleSchema,
  venueSchema,
  type EventData,
} from '../../src/lib/schemas';
import { resolveOccurrences } from '../../src/lib/event-core';
import { KINDS, listContentFiles, parseContent, type Kind } from './content-files';

const storedImage = () => z.string().min(1);
const SCHEMAS: Record<Kind, z.ZodType> = {
  events: eventSchema,
  venues: venueSchema,
  performers: performerSchema,
  instructors: instructorSchema,
  organizers: organizerSchema,
  sources: sourceSchema,
  styles: styleSchema,
  faqs: faqSchema,
  pages: pageSchema(storedImage),
  gallery: gallerySchema(storedImage),
  settings: settingsSchema(storedImage),
};
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,159}$/;

export interface Snapshot {
  format: 1;
  commit: string;
  generatedAt: string;
  collections: Record<Kind, { id: string; path: string; raw: string; doc: Record<string, unknown> }[]>;
  eventDates: {
    event_id: string;
    day: string;
    slug: string;
    start_local: string;
    end_local: string;
    starts_at: string;
    ends_at: string;
    time_tba: boolean;
  }[];
  places: { name: string; county: string; aliases: string[] }[];
}

function commitOf(root: string): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function buildNow(): Date {
  const v = process.env.BUILD_NOW;
  const d = v ? new Date(v) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error(`BUILD_NOW is not a date: ${v}`);
  return d;
}

export function buildPayload(root: string, now: Date = buildNow()): { snapshot: Snapshot; errors: string[] } {
  const errors: string[] = [];
  const collections = Object.fromEntries(KINDS.map((k) => [k, []])) as unknown as Snapshot['collections'];
  const events: { id: string; data: EventData }[] = [];

  for (const f of listContentFiles(root)) {
    const where = f.path;
    if (!ID_RE.test(f.id)) {
      errors.push(`${where}: the file name must be lowercase letters, numbers and hyphens`);
      continue;
    }
    const raw = f.bytes.toString('utf8');
    if (!Buffer.from(raw, 'utf8').equals(f.bytes)) {
      errors.push(`${where}: not valid UTF-8 text`);
      continue;
    }
    let doc: Record<string, unknown>;
    try {
      doc = parseContent(f);
    } catch (err) {
      errors.push(`${where}: cannot be read (${(err as Error).message})`);
      continue;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      errors.push(`${where}: is not a record`);
      continue;
    }
    const parsed = SCHEMAS[f.kind].safeParse(doc);
    if (!parsed.success) {
      errors.push(`${where}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(record)'} ${i.message}`).join('; ')}`);
      continue;
    }
    collections[f.kind].push({ id: f.id, path: f.path, raw, doc });
    if (f.kind === 'events') events.push({ id: f.id, data: parsed.data as EventData });
  }

  let eventDates: Snapshot['eventDates'] = [];
  try {
    eventDates = resolveOccurrences(events, { now, includePending: true, horizonDays: 120 }).map((o) => ({
      event_id: o.eventId,
      day: o.date,
      slug: o.slug,
      start_local: o.startLocal,
      end_local: o.endLocal,
      starts_at: o.start.toISOString(),
      ends_at: o.end.toISOString(),
      time_tba: o.timeTba,
    }));
  } catch (err) {
    errors.push(`event dates: ${(err as Error).message}`);
  }

  const placesFile = JSON.parse(readFileSync(join(root, 'src', 'data', 'long-island-places.json'), 'utf8')) as {
    places: { name: string; county: string }[];
    aliases: Record<string, string>;
  };
  const aliasesOf = new Map<string, string[]>();
  for (const [alias, name] of Object.entries(placesFile.aliases ?? {})) aliasesOf.set(name, [...(aliasesOf.get(name) ?? []), alias]);
  const places = placesFile.places.map((p) => ({ name: p.name, county: p.county, aliases: (aliasesOf.get(p.name) ?? []).sort() }));

  return {
    snapshot: { format: 1, commit: commitOf(root), generatedAt: new Date().toISOString(), collections, eventDates, places },
    errors,
  };
}

function main() {
  const args = process.argv.slice(2);
  const out = args[args.indexOf('--out') + 1];
  if (!args.includes('--out') || !out) {
    console.error('Usage: tsx scripts/db/build-payload.ts --out payload.json[.gz]');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { snapshot, errors } = buildPayload(root);
  if (errors.length) {
    console.error(`[db] ${errors.length} record(s) are not valid; nothing was sent:\n- ${errors.slice(0, 50).join('\n- ')}`);
    process.exit(1);
  }
  const text = JSON.stringify(snapshot);
  writeFileSync(out, out.endsWith('.gz') ? gzipSync(text) : text);
  const counts = KINDS.map((k) => `${k} ${snapshot.collections[k].length}`).join(', ');
  console.log(`[db] snapshot of ${snapshot.commit.slice(0, 7)}: ${counts}; ${snapshot.eventDates.length} event dates; ${snapshot.places.length} places -> ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
