/**
 * Weekly ingest: run every enabled source adapter, combine dates into events, merge with the existing
 * files, mark ended events as past, validate everything, write the data files and a run report.
 *
 *   npx tsx ingest/run.ts                      # all enabled sources
 *   npx tsx ingest/run.ts --source thedancecalendar --dry-run
 *   npx tsx ingest/run.ts --cadence daily,twice-weekly   # only sources with these cadences
 *   npx tsx ingest/run.ts --offline            # reuse cached downloads only
 *   npx tsx ingest/run.ts --today 2026-10-03 --report .cache/ingest/report.md --json .cache/ingest/report.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventSchema, instructorSchema, organizerSchema, performerSchema, sourceSchema, venueSchema, type SourceData } from '../src/lib/schemas';
import { dateInZone } from '../src/lib/time';
import { collapse } from './lib/collapse';
import { PoliteFetcher } from './lib/fetch';
import { mergeDrafts, type MergeStats } from './lib/merge';
import { Registry, ROOT } from './lib/registry';
import { writeEntity } from './lib/store';
import type { Adapter, NormalizeResult } from './lib/types';

export interface SourceReport {
  id: string;
  name: string;
  status: SourceData['lastStatus'];
  message?: string | undefined;
  documents: string[];
  found: number;
  kept: number;
  outOfArea: { town: string; count: number }[];
  merge?: MergeStats | undefined;
  review: { id: string; reason: string }[];
  invalid: { id: string; error: string }[];
  /** New listings not added because another source already lists the same evening. */
  duplicates?: { id: string; of: string }[] | undefined;
}

export interface RunReport {
  startedAt: string;
  today: string;
  dryRun: boolean;
  sources: SourceReport[];
  created: { venues: string[]; performers: string[]; instructors: string[]; organizers: string[] };
  totals: { activeEvents: number; needsReview: number; changedFiles: number };
}

function args(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    out[a.slice(2)] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return out;
}

export function reportMarkdown(r: RunReport): string {
  const lines = [`# Weekly event update: ${r.today}`, '', r.dryRun ? '_Dry run: no files were written._\n' : ''];
  lines.push('| Source | Result | Listings found | Kept (Long Island) | New | Updated | Unchanged | Ended | Missing | Needs review |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of r.sources) {
    const m = s.merge;
    lines.push(`| ${s.name} | ${s.status === 'ok' ? 'OK' : `**${s.status.toUpperCase()}**`} | ${s.found} | ${s.kept} | ${m?.new ?? 0} | ${m?.updated ?? 0} | ${m?.unchanged ?? 0} | ${m?.expired ?? 0} | ${m?.missing ?? 0} | ${s.review.length} |`);
  }
  lines.push('', 'What the columns mean: **Listings found** = everything in the source. **Kept** = listings in Nassau or Suffolk. **New** = events we had not seen before. **Updated** = events whose details changed. **Ended** = events whose last date has passed. **Missing** = listings that disappeared from the source, so a person should check them. **Needs review** = hidden from the public site until someone checks them.', '');
  for (const s of r.sources) {
    if (s.message) lines.push(`- **${s.name}:** ${s.message}`);
    if (s.outOfArea.length) lines.push(`- ${s.name}: skipped ${s.outOfArea.reduce((n, o) => n + o.count, 0)} listings outside Long Island (${s.outOfArea.map((o) => `${o.town} ${o.count}`).join(', ')}).`);
    if (s.duplicates?.length) lines.push(`- ${s.name}: ${s.duplicates.length} listings were already on the site from another source, so they were not added twice (${s.duplicates.slice(0, 5).map((d) => `\`${d.of}\``).join(', ')}${s.duplicates.length > 5 ? ', …' : ''}).`);
    if (s.invalid.length) lines.push(`- ${s.name}: ${s.invalid.length} records failed validation and were not saved: ${s.invalid.map((i) => `\`${i.id}\` (${i.error})`).join('; ')}`);
  }
  const created = Object.entries(r.created).filter(([, v]) => v.length);
  if (created.length) {
    lines.push('', '## New records added automatically (please check)', '');
    for (const [k, v] of created) lines.push(`- ${k}: ${v.map((x) => `\`${x}\``).join(', ')}`);
  }
  const review = r.sources.flatMap((s) => s.review);
  if (review.length) {
    lines.push('', `## Waiting for review (${review.length})`, '');
    for (const x of review.slice(0, 40)) lines.push(`- \`${x.id}\`: ${x.reason}`);
    if (review.length > 40) lines.push(`- …and ${review.length - 40} more`);
  }
  lines.push('', `Totals: ${r.totals.activeEvents} listed events, ${r.totals.needsReview} waiting for review, ${r.totals.changedFiles} files changed.`);
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
}

export async function run(argv = process.argv.slice(2)): Promise<RunReport> {
  const a = args(argv);
  const today = typeof a.today === 'string' ? a.today : dateInZone(new Date());
  const dryRun = Boolean(a['dry-run']);
  const offline = Boolean(a.offline);
  const log = (m: string) => console.log(`[ingest] ${m}`);
  const registry = Registry.load();
  const fetcher = new PoliteFetcher(join(ROOT, '.cache', 'ingest'), { offline, log });
  const report: RunReport = { startedAt: new Date().toISOString(), today, dryRun, sources: [], created: { venues: [], performers: [], instructors: [], organizers: [] }, totals: { activeEvents: 0, needsReview: 0, changedFiles: 0 } };
  const changed = new Set<string>();
  const only = typeof a.source === 'string' ? a.source : undefined;
  const cadences = typeof a.cadence === 'string' ? new Set(a.cadence.split(',').map((c) => c.trim()).filter(Boolean)) : undefined;

  // A venue's, club's or band's own calendar goes before calendars that list everything, so when two
  // sources name the same evening the record comes from the people running it.
  const allInOne = (s: SourceData) => !(s.defaults?.venueId || s.defaults?.organizerId || s.defaults?.performerIds?.length);
  const ordered = [...registry.sources].sort(([, a], [, b]) => Number(allInOne(a)) - Number(allInOne(b)));
  for (const [id, source] of ordered) {
    if (only && id !== only) continue;
    if (cadences && !only && !cadences.has(source.cadence)) continue;
    const sr: SourceReport = { id, name: source.name, status: 'skipped', documents: [], found: 0, kept: 0, outOfArea: [], review: [], invalid: [] };
    report.sources.push(sr);
    if (!source.enabled && !only) {
      sr.message = 'Turned off in the source settings.';
      continue;
    }
    try {
      const mod = (await import(pathToFileURL(join(ROOT, 'ingest', 'adapters', `${source.adapter}.ts`)).href)) as { adapter: Adapter };
      const ctx = { source: { ...source, id }, registry, fetcher, today, offline, log };
      const docs = await mod.adapter.fetch(ctx);
      sr.documents = docs.map((d) => `${d.url}${d.meta.issue ? ` (${d.meta.issue})` : ''}`);
      if (docs.length === 0 && mod.adapter.quietWhenNoDocuments) {
        sr.message = 'Nothing new to read this time (for example, no newsletter issue lately).';
        continue;
      }
      const result: NormalizeResult = await mod.adapter.normalize(docs, ctx);
      sr.found = result.found;
      sr.kept = result.candidates.length;
      sr.outOfArea = result.outOfArea;
      if (result.candidates.length === 0) {
        sr.status = 'empty';
        sr.message = `The adapter found ${result.found} listings but none could be used. The source layout may have changed.`;
        continue;
      }
      const drafts = collapse(result.candidates, new Set(registry.events.keys()));
      const merged = mergeDrafts(registry.events, drafts, {
        sourceId: id,
        today,
        coverage: result.coverage,
        allInOne: allInOne(source),
        isOwnCalendar: (sid) => {
          const s = registry.sources.get(sid);
          return Boolean(s && !allInOne(s));
        },
      });
      for (const cid of merged.changed) {
        try {
          const parsed = eventSchema.parse(merged.events.get(cid));
          registry.events.set(cid, parsed);
          changed.add(cid);
        } catch (e) {
          sr.invalid.push({ id: cid, error: (e as Error).message.slice(0, 300) });
        }
      }
      sr.merge = merged.stats;
      sr.review = merged.review;
      sr.duplicates = merged.duplicates;
      sr.status = sr.invalid.length > Math.max(3, drafts.length / 10) ? 'invalid' : 'ok';
      if (sr.status === 'invalid') sr.message = `${sr.invalid.length} of ${drafts.length} records failed validation.`;
    } catch (e) {
      sr.status = 'error';
      sr.message = (e as Error).message.slice(0, 480);
      log(`ERROR ${id}: ${sr.message}`);
    } finally {
      if (sr.status !== 'skipped') {
        registry.sources.set(id, sourceSchema.parse({
          ...source,
          lastScraped: new Date().toISOString(),
          lastStatus: sr.status,
          lastMessage: sr.message,
          lastCounts: { found: sr.found, kept: sr.kept, outOfArea: sr.outOfArea.reduce((n, o) => n + o.count, 0), needsReview: sr.review.length },
        }));
      }
    }
  }

  for (const [kind, ids] of Object.entries(registry.created) as [keyof RunReport['created'], Set<string>][]) report.created[kind] = [...ids].sort();
  report.totals.activeEvents = [...registry.events.values()].filter((e) => e.status === 'active').length;
  report.totals.needsReview = [...registry.events.values()].filter((e) => e.status === 'pending-review').length;

  if (!dryRun) {
    let n = 0;
    for (const id of changed) if (writeEntity('events', id, registry.events.get(id) as Record<string, unknown>)) n++;
    const schemas = { venues: venueSchema, performers: performerSchema, instructors: instructorSchema, organizers: organizerSchema } as const;
    for (const kind of Object.keys(schemas) as (keyof typeof schemas)[]) {
      for (const id of registry.created[kind]) {
        const data = schemas[kind].parse((registry[kind] as Map<string, unknown>).get(id));
        if (writeEntity(kind, id, data as Record<string, unknown>)) n++;
      }
    }
    for (const s of report.sources) if (s.status !== 'skipped' && writeEntity('sources', s.id, registry.sources.get(s.id) as Record<string, unknown>)) n++;
    report.totals.changedFiles = n;
  } else report.totals.changedFiles = changed.size;

  const md = reportMarkdown(report);
  for (const [key, text] of [['report', md], ['json', JSON.stringify(report, null, 2)]] as const) {
    const file = typeof a[key] === 'string' ? (a[key] as string) : join(ROOT, '.cache', 'ingest', key === 'report' ? 'report.md' : 'report.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  console.log(md);
  if (a.strict && report.sources.some((s) => s.status === 'error' || s.status === 'empty' || s.status === 'invalid')) process.exitCode = 1;
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
