/**
 * Build data/li-dance.sqlite from the files in git (src/content/**, src/data/long-island-places.json
 * and catalog/sources.json), then run the sample reports in catalog/queries.sql.
 *
 * The JSON/YAML files stay the source of truth. This database is a read-only copy for reports and
 * questions; it is rebuilt from scratch every time (a few seconds, a few MB) and never committed.
 *
 *   npx tsx catalog/scripts/build-sqlite.ts                       # data/li-dance.sqlite + data/li-dance-report.md
 *   npx tsx catalog/scripts/build-sqlite.ts --out x.sqlite --report x.md --horizon-days 365 --today 2026-10-03
 *
 * Needs Node 22.13+ (built-in node:sqlite). No database server, no new dependencies.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { occurrenceDates } from '../../src/lib/rrule';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT = join(ROOT, 'src', 'content');

type Json = Record<string, any>;
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const OUT = resolve(arg('out', join(ROOT, 'data', 'li-dance.sqlite')));
const REPORT = resolve(arg('report', join(ROOT, 'data', 'li-dance-report.md')));
const TODAY = arg('today', new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
const HORIZON_DAYS = Number(arg('horizon-days', '365'));

const warnings: string[] = [];
const warn = (m: string) => warnings.push(m);

function readDir(kind: string, ext: '.json' | '.yml'): [string, Json][] {
  const dir = join(CONTENT, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => {
      const raw = readFileSync(join(dir, f), 'utf8');
      return [f.slice(0, -ext.length), ext === '.json' ? JSON.parse(raw) : YAML.parse(raw)] as [string, Json];
    });
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const bool = (v: unknown) => (v === undefined || v === null ? null : v ? 1 : 0);
const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);

// ---------------------------------------------------------------------------------------------
mkdirSync(dirname(OUT), { recursive: true });
if (existsSync(OUT)) rmSync(OUT);
const db = new DatabaseSync(OUT);
db.exec(readFileSync(join(ROOT, 'catalog', 'schema.sql'), 'utf8'));
db.exec('BEGIN');

const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as any[]));

// Places --------------------------------------------------------------------------------------
const placesFile = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'long-island-places.json'), 'utf8')) as {
  places: { name: string; county: string }[];
  aliases: Record<string, string>;
};
for (const p of placesFile.places) run('INSERT OR IGNORE INTO places (name, county) VALUES (?, ?)', p.name, p.county);
const placeNames = new Set(placesFile.places.map((p) => p.name));
for (const [alias, name] of Object.entries(placesFile.aliases)) {
  if (placeNames.has(name) && !placeNames.has(alias)) run('INSERT OR IGNORE INTO place_aliases (alias, place_name) VALUES (?, ?)', alias, name);
}

// Dance styles --------------------------------------------------------------------------------
const FAMILIES = ['swing', 'ballroom', 'latin', 'tango', 'country', 'folk', 'club', 'other'] as const;
const KINDS = ['partner', 'line', 'freestyle'] as const;
const styleIds = new Set<string>();
for (const [id, s] of readDir('styles', '.yml')) {
  const kind = pick(s.danceType, KINDS) ?? (id.includes('line') ? 'line' : 'partner');
  run(
    'INSERT INTO dance_styles (id, name, family, dance_kind, sort_order, summary, music) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, s.name, pick(s.family, FAMILIES) ?? 'other', kind, num(s.order), str(s.summary), str(s.music),
  );
  for (const a of s.aliases ?? []) run('INSERT OR IGNORE INTO style_aliases (alias, style_id) VALUES (?, ?)', String(a), id);
  styleIds.add(id);
}

// Venues --------------------------------------------------------------------------------------
const VENUE_TYPES = ['bar', 'restaurant', 'lodge-hall', 'studio', 'ballroom', 'church-temple', 'library', 'park-beach', 'theater', 'brewery-winery', 'hotel', 'school', 'community-center', 'other'] as const;
const ROOM = ['dance-floor', 'some-room', 'seated', 'outdoor-lawn', 'unknown'] as const;
const venueIds = new Set<string>();
for (const [id, v] of readDir('venues', '.json')) {
  // `kind` and `dancing` are being added to the venue schema; read them when present.
  const dancing = v.dancing && typeof v.dancing === 'object' ? v.dancing : undefined;
  run(
    `INSERT INTO venues (id, name, venue_type, address, town, county, state, postal_code, latitude, longitude, coordinates_source,
      website, phone, google_maps_url, facebook_url, parking_notes, accessibility_notes, room_to_dance, dance_floor_notes,
      facts_checked_at, description, review_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, v.name, pick(v.kind, VENUE_TYPES), str(v.address), str(v.town), pick(v.county, ['Nassau', 'Suffolk'] as const), v.state ?? 'NY',
    str(v.postalCode), num(v.latitude), num(v.longitude), str(v.coordinatesSource), str(v.website), str(v.phone), str(v.googleMapsUrl),
    str(v.facebookUrl), str(v.parkingNotes), str(v.accessibilityNotes),
    pick(dancing?.room ?? dancing?.space ?? v.roomToDance, ROOM) ?? 'unknown',
    dancing ? JSON.stringify(dancing) : null, str(v.factsSource), str(v.description), str(v.reviewNotes),
  );
  for (const a of v.aliases ?? []) run('INSERT OR IGNORE INTO venue_aliases (alias, venue_id) VALUES (?, ?)', String(a), id);
  venueIds.add(id);
}

// Organizers, performers, instructors ------------------------------------------------------------
const ORG_TYPES = ['studio', 'club', 'nonprofit', 'promoter', 'venue', 'school', 'dj', 'instructor', 'other'] as const;
const organizerIds = new Set<string>();
const organizers = readDir('organizers', '.json');
for (const [id, o] of organizers) {
  run(
    `INSERT INTO organizers (id, name, type, town, home_venue_id, website, phone, email, opt_out, description, review_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.name, pick(o.type, ORG_TYPES), str(o.town), venueIds.has(o.homeVenueId) ? o.homeVenueId : null, str(o.website), str(o.phone),
    str(o.email), o.optOut ? 1 : 0, str(o.description), str(o.reviewNotes),
  );
  for (const a of o.aliases ?? []) run('INSERT OR IGNORE INTO organizer_aliases (alias, organizer_id) VALUES (?, ?)', String(a), id);
  organizerIds.add(id);
}
for (const [id, o] of organizers) for (const s of o.danceStyles ?? []) if (styleIds.has(s)) run('INSERT OR IGNORE INTO organizer_styles VALUES (?, ?)', id, s);

const DANCEABILITY = ['dance-band', 'party-cover-band', 'dj', 'mixed', 'listening-act', 'unknown'] as const;
const performerIds = new Set<string>();
for (const [id, p] of readDir('performers', '.json')) {
  const dancing = p.dancing && typeof p.dancing === 'object' ? p.dancing : { rating: p.dancing };
  run(
    `INSERT INTO performers (id, name, type, danceability, danceability_notes, website, facebook_url, instagram_url, youtube_url, description, review_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, p.name, pick(p.type, ['band', 'dj', 'solo'] as const) ?? 'band',
    pick(dancing.rating ?? dancing.kind, DANCEABILITY) ?? (p.type === 'dj' ? 'dj' : 'unknown'),
    p.dancing ? JSON.stringify(p.dancing) : null, str(p.website), str(p.facebookUrl), str(p.instagramUrl), str(p.youtubeUrl),
    str(p.description), str(p.reviewNotes),
  );
  for (const a of p.aliases ?? []) run('INSERT OR IGNORE INTO performer_aliases (alias, performer_id) VALUES (?, ?)', String(a), id);
  for (const g of p.genres ?? []) run('INSERT OR IGNORE INTO performer_genres (performer_id, genre) VALUES (?, ?)', id, String(g));
  performerIds.add(id);
}

const instructorIds = new Set<string>();
for (const [id, t] of readDir('instructors', '.json')) {
  run('INSERT INTO instructors (id, name, website, description, review_notes) VALUES (?, ?, ?, ?, ?)', id, t.name, str(t.website), str(t.description), str(t.reviewNotes));
  for (const s of t.styles ?? []) if (styleIds.has(s)) run('INSERT OR IGNORE INTO instructor_styles VALUES (?, ?)', id, s);
  for (const o of t.affiliatedOrganizerIds ?? []) if (organizerIds.has(o)) run('INSERT OR IGNORE INTO instructor_organizers VALUES (?, ?)', id, o);
  instructorIds.add(id);
}

// Sources: the research catalog plus the ingest registry (registry wins for run settings) ---------
const SOURCE_STATUS = ['live', 'in-progress', 'verified', 'needs-permission', 'manual-intake', 'recheck-from-ci', 'seasonal-recheck', 'set-aside', 'paused', 'opted-out'] as const;
const PUBLISHERS = ['venue', 'organizer-club', 'studio', 'band-dj', 'instructor', 'aggregator-calendar', 'municipal-library', 'media-newsletter', 'religious-civic'] as const;
const FORMATS = ['jsonld', 'ical', 'google-calendar', 'api-json', 'html', 'pdf', 'js-widget', 'image-flyer', 'social-only', 'none'] as const;
const CADENCE = ['daily', 'twice-weekly', 'weekly', 'monthly', 'seasonal', 'manual'] as const;
const CONTENT_TYPES = ['partner-dancing', 'line-dancing', 'freestyle-club', 'live-music'] as const;
const catalogPath = join(ROOT, 'catalog', 'sources.json');
const catalog: Json[] = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : [];
const registrySources = new Map(readDir('sources', '.json'));
const sourceIds = new Set<string>();
const upsertSource = (id: string, c: Json | undefined, r: Json | undefined) => {
  const status = r?.enabled ? (c?.status === 'in-progress' || c?.status === 'live' || !c ? 'live' : c.status === 'verified' ? 'live' : c.status) : (c?.status ?? 'paused');
  run(
    `INSERT INTO sources (id, name, url, feed_url, status, publisher_type, format, adapter, priority, effort, check_cadence, rate_limit_seconds,
      robots_result, robots_note, robots_checked_at, terms_note, counties, events_per_month, attribution, enabled, approved_by_owner, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, r?.name ?? c?.name, r?.url ?? c?.url, str(r?.feedUrl ?? c?.feedUrl), pick(status, SOURCE_STATUS) ?? 'paused',
    pick(c?.category?.publisher, PUBLISHERS), pick(c?.category?.format ?? r?.type, FORMATS), str(r?.adapter),
    pick(c?.priority, ['High', 'Medium', 'Low', 'None'] as const), pick(c?.effort, ['S', 'M', 'L'] as const),
    pick(r?.cadence ?? c?.checkCadence, CADENCE), num(r?.rateLimitSeconds) ?? 5,
    pick(c?.robotsResult, ['allowed', 'disallowed', 'none', 'unverified'] as const), str(c?.robots), str(c?.checkedAt), str(c?.terms),
    str(c?.county), num(c?.eventsPerMonth), str(r?.attribution), r?.enabled ? 1 : 0,
    r || (c && c.status !== 'set-aside') ? 1 : 0, str(c?.reason ?? r?.description),
  );
  for (const t of c?.category?.content ?? []) if (pick(t, CONTENT_TYPES)) run('INSERT OR IGNORE INTO source_content_types VALUES (?, ?)', id, t);
  if (r?.lastScraped) {
    const st = r.lastStatus === 'never' ? null : pick(r.lastStatus, ['ok', 'unchanged', 'empty', 'invalid', 'error', 'blocked', 'skipped'] as const);
    if (st) {
      run(
        `INSERT INTO source_runs (source_id, started_at, finished_at, status, found, kept, out_of_area, needs_review, message, runner)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'registry')`,
        id, r.lastScraped, r.lastScraped, st, r.lastCounts?.found ?? 0, r.lastCounts?.kept ?? 0, r.lastCounts?.outOfArea ?? 0,
        r.lastCounts?.needsReview ?? 0, str(r.lastMessage),
      );
    }
  }
  sourceIds.add(id);
};
const catalogById = new Map(catalog.map((c) => [c.id as string, c]));
for (const id of new Set([...catalogById.keys(), ...registrySources.keys()])) upsertSource(id, catalogById.get(id), registrySources.get(id));

// Events and their dates -------------------------------------------------------------------------
const horizon = addDays(TODAY, HORIZON_DAYS);
const CATS = ['social-dance', 'class-lesson', 'lesson-party', 'live-music', 'festival'] as const;
let occurrences = 0;
const events = readDir('events', '.json');
for (const [id, e] of events) {
  let venueId: string | null = e.venueId ?? null;
  if (venueId && !venueIds.has(venueId)) {
    warn(`event ${id}: unknown venue "${venueId}" (kept the town only)`);
    venueId = null;
  }
  const town = str(e.town) ?? (venueId ? null : 'Unknown');
  if (e.sourceId && !sourceIds.has(e.sourceId)) {
    warn(`event ${id}: unknown source "${e.sourceId}" (added a placeholder source row)`);
    upsertSource(e.sourceId, undefined, { name: e.sourceName ?? e.sourceId, url: e.sourceUrl, enabled: false });
  }
  const dancing = e.dancing;
  const likelihood = typeof dancing === 'number' ? dancing : num(dancing?.likelihood ?? dancing?.score);
  run(
    `INSERT INTO events (id, title, summary, description, category, start_local, end_local, timezone, rrule, cadence_text, lesson_time,
      venue_id, town, organizer_id, price_min, price_max, is_free, price_notes, skill_level, age_group, ticket_url, info_url, status,
      cancelled_note, dancing_likelihood, dancing_basis, confidence, match_key, primary_source_id, source_url, source_ref, first_seen,
      last_seen, locked_fields, review_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, e.title, e.summary, str(e.description), pick(e.category, CATS) ?? 'social-dance', e.start, str(e.end), e.timezone ?? 'America/New_York',
    str(e.recurrence?.rrule), str(e.cadence), str(e.lessonTime), venueId, town, organizerIds.has(e.organizerId) ? e.organizerId : null,
    num(e.price), num(e.priceMax), bool(e.isFree), str(e.priceNotes), pick(e.skillLevel, ['all-levels', 'beginner', 'intermediate', 'advanced', 'mixed'] as const),
    pick(e.ageGroup, ['adults', 'kids', 'teens', 'all-ages'] as const), str(e.ticketUrl), str(e.infoUrl),
    pick(e.status, ['active', 'past', 'cancelled', 'pending-review', 'hidden'] as const) ?? 'active', str(e.cancelledNote),
    likelihood !== null && likelihood >= 0 && likelihood <= 1 ? likelihood : null,
    dancing && typeof dancing === 'object' ? JSON.stringify(dancing) : e.dancingCues ? JSON.stringify({ cues: e.dancingCues }) : null,
    num(e.confidence), str(e.matchKey), str(e.sourceId), str(e.sourceUrl), str(e.sourceRef), e.firstSeen, e.lastSeen,
    e.lockedFields?.length ? JSON.stringify(e.lockedFields) : null, str(e.reviewNotes),
  );
  if (e.sourceId) {
    run('INSERT OR IGNORE INTO event_sources (event_id, source_id, source_url, source_ref, first_seen, last_seen, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1)',
      id, e.sourceId, str(e.sourceUrl), str(e.sourceRef), e.firstSeen, e.lastSeen);
  }
  for (const s of e.danceStyles ?? []) {
    if (styleIds.has(s)) run('INSERT OR IGNORE INTO event_styles VALUES (?, ?)', id, s);
    else warn(`event ${id}: unknown style "${s}"`);
  }
  for (const k of Array.isArray(e.danceTypes) ? e.danceTypes : []) if (pick(k, KINDS)) run('INSERT OR IGNORE INTO event_dance_kinds VALUES (?, ?)', id, k);
  (e.performerIds ?? []).forEach((p: string, i: number) => {
    if (performerIds.has(p)) run('INSERT OR IGNORE INTO event_performers VALUES (?, ?, ?)', id, p, i + 1);
    else warn(`event ${id}: unknown performer "${p}"`);
  });
  for (const t of e.instructorIds ?? []) {
    if (instructorIds.has(t)) run('INSERT OR IGNORE INTO event_instructors VALUES (?, ?)', id, t);
    else warn(`event ${id}: unknown instructor "${t}"`);
  }
  for (const d of e.recurrence?.exdates ?? []) run('INSERT OR IGNORE INTO event_exdates VALUES (?, ?)', id, d);

  // One row per date (rule + extra dates - skipped dates), up to the horizon.
  const startDate = String(e.start).slice(0, 10);
  const startTime = String(e.start).length > 10 ? String(e.start).slice(10) : '';
  const endOffset = e.end ? daysBetween(startDate, String(e.end).slice(0, 10)) : 0;
  const endTime = e.end && String(e.end).length > 10 ? String(e.end).slice(10) : '';
  const origin = e.recurrence?.rrule ? 'rrule' : e.recurrence?.rdates?.length ? 'rdate' : 'single';
  for (const d of occurrenceDates(startDate, e.recurrence, horizon)) {
    const end = e.end ? `${addDays(d, endOffset)}${endTime}` : null;
    const cancelled = e.status === 'cancelled';
    run('INSERT OR IGNORE INTO event_occurrences (event_id, start_local, end_local, status, origin) VALUES (?, ?, ?, ?, ?)',
      id, `${d}${startTime}`, end, cancelled ? 'cancelled' : 'scheduled', d === startDate ? (origin === 'rrule' ? 'rrule' : 'single') : origin);
    occurrences++;
  }
  if ((e.status ?? 'active') === 'pending-review') {
    run("INSERT INTO review_queue (subject_type, subject_id, reason, detail) VALUES ('event', ?, 'low-confidence', ?)", id, str(e.reviewNotes));
  }
}
db.exec('COMMIT');

const fk = db.prepare('PRAGMA foreign_key_check').all();
if (fk.length) warn(`${fk.length} foreign-key problems: ${JSON.stringify(fk.slice(0, 3))}`);
const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;

// Reports ----------------------------------------------------------------------------------------
const counts = Object.fromEntries(
  ['sources', 'venues', 'organizers', 'performers', 'instructors', 'dance_styles', 'events', 'event_occurrences', 'places'].map((t) => [
    t,
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
  ]),
);
const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\|/g, '/').replace(/\n/g, ' '));
const md: string[] = [
  '# Long Island Dance Events - database report',
  '',
  `Built ${new Date().toISOString()} from the files in git. Today = ${TODAY}; dates expanded to ${horizon}.`,
  '',
  '| Table | Rows |',
  '| --- | ---: |',
  ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`),
  '',
  `Integrity check: ${integrity}. Warnings: ${warnings.length}.`,
  '',
];
const sqlText = readFileSync(join(ROOT, 'catalog', 'queries.sql'), 'utf8');
for (const block of sqlText.split(/^-- name: /m).slice(1)) {
  const [header, ...rest] = block.split('\n');
  const [name, question] = header!.split('|').map((s) => s.trim());
  const sql = rest.filter((l) => !l.trim().startsWith('--')).join('\n').trim().replace(/;\s*$/, '');
  md.push(`## ${question} (\`${name}\`)`, '');
  try {
    const rows = db.prepare(sql).all() as Json[];
    if (!rows.length) {
      md.push('_No rows yet._', '');
      continue;
    }
    const cols = Object.keys(rows[0]!);
    md.push(`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`);
    for (const r of rows) md.push(`| ${cols.map((c) => cell(r[c])).join(' | ')} |`);
    md.push('');
  } catch (e) {
    md.push(`Query failed: ${(e as Error).message}`, '');
    warn(`query ${name} failed: ${(e as Error).message}`);
  }
}
if (warnings.length) md.push('## Warnings', '', ...warnings.slice(0, 100).map((w) => `- ${w}`), '');
db.close();
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, md.join('\n'));
console.log(`Built ${OUT} (${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}); ${occurrences} dates; ${warnings.length} warnings; report ${REPORT}`);
if (integrity !== 'ok' || fk.length) process.exitCode = 1;
