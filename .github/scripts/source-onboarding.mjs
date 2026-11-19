#!/usr/bin/env node
// Turn safely verified monthly-search results into source files, then validate each proposed source
// with the repository's real adapter before leaving it on the rolling ingest branch.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_DIR = join('src', 'content', 'sources');

const clean = (value, max) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const slug = (value) =>
  clean(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

function pageOf(candidate) {
  return candidate.verification?.pages?.find((page) => page?.status === 200 && !page?.blocked) ?? candidate.verification?.pages?.[0];
}

function absoluteLink(value, base) {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function candidateProblem(candidate) {
  const verification = candidate?.verification;
  const page = pageOf(candidate);
  if (!verification?.safe || verification?.unsafeReason) return `unsafe URL: ${verification?.unsafeReason ?? 'not public'}`;
  if (!['allowed', 'none'].includes(verification.robots)) return `robots.txt is ${verification.robots ?? 'unknown'}`;
  if (!page || page.status !== 200) return `the page did not open successfully (HTTP ${page?.status ?? 0})`;
  if (page.blocked) return 'the page returned a bot challenge';
  if (!(verification.liPlaces?.length > 0)) return 'no clear Nassau or Suffolk place was found';
  if (page.jsonldFuture >= 2) return '';
  if ((page.googleCalendarIds?.length || page.icalLinks?.length) && page.next90Days >= 2) return '';
  if (page.next90Days >= 3) return '';
  return 'no supported event list with several upcoming dates was found';
}

export function candidateToSource(candidate, today, usedIds = new Set()) {
  const problem = candidateProblem(candidate);
  if (problem) return { problem };
  const page = pageOf(candidate);
  const baseUrl = page.finalUrl || candidate.url;
  const googleId = page.googleCalendarIds?.[0];
  const ical = googleId
    ? `https://calendar.google.com/calendar/ical/${encodeURIComponent(googleId)}/public/basic.ics`
    : absoluteLink(page.icalLinks?.[0], baseUrl);
  const adapter = page.jsonldFuture >= 2 ? 'jsonld' : ical ? 'ical' : 'htmllist';
  const domain = new URL(baseUrl).hostname.replace(/^www\./, '');
  const baseId = slug(domain.replace(/\.[a-z]{2,}$/i, '')) || 'discovered-source';
  let id = baseId;
  for (let n = 2; usedIds.has(id); n++) id = `${baseId}-${n}`;
  usedIds.add(id);
  const title = clean(candidate.title, 100);
  const name = title && !/^https?:/i.test(title) ? title : domain;
  const queryText = `${candidate.queries?.join(' ') ?? ''} ${title}`.toLowerCase();
  const focus = /\b(dance|dancing|salsa|swing|ballroom|tango|hustle|contra)\b/.test(queryText) ? 'dance' : 'music';
  const kinds = adapter === 'jsonld' ? `${page.jsonldFuture} upcoming structured events` : adapter === 'ical' ? 'a public calendar feed' : `${page.next90Days} upcoming dated listings`;
  const source = {
    name: `${name} - events`,
    type: adapter === 'htmllist' ? 'html' : adapter,
    adapter,
    attribution: `Some listings come from ${name}. We write our own short summaries and link back to the original page.`,
    cadence: 'weekly',
    catalogStatus: 'verified',
    description: `Automatically found public Long Island event source with ${kinds}.`,
    enabled: true,
    ...(ical ? { feedUrl: ical } : {}),
    focus,
    rateLimitSeconds: 5,
    reviewNotes: `Automatically discovered, safety-checked and validated with the ${adapter} reader on ${today}.`,
    url: baseUrl,
  };
  return { id, source };
}

function existingIdsAndUrls(sourceDir = SOURCE_DIR) {
  const ids = new Set();
  const urls = new Set();
  if (!existsSync(sourceDir)) return { ids, urls };
  for (const name of readdirSync(sourceDir).filter((file) => file.endsWith('.json'))) {
    ids.add(basename(name, '.json'));
    try {
      const source = JSON.parse(readFileSync(join(sourceDir, name), 'utf8'));
      for (const value of [source.url, source.feedUrl, ...(source.pageUrls ?? [])]) {
        if (value) urls.add(new URL(value).hostname.replace(/^www\./, ''));
      }
    } catch {
      // The repository's normal schema check reports malformed existing files.
    }
  }
  return { ids, urls };
}

function validate(id, today) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(command, ['tsx', 'ingest/run.ts', '--source', id, '--dry-run', '--strict', '--today', today], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 4 * 60 * 1000,
  });
}

export function onboardCandidates(data, { sourceDir = SOURCE_DIR, validateSource = validate } = {}) {
  const today = data.today ?? new Date().toISOString().slice(0, 10);
  const { ids, urls } = existingIdsAndUrls(sourceDir);
  const accepted = [];
  const rejected = [];
  for (const candidate of data.candidates ?? []) {
    let host = '';
    try {
      host = new URL(candidate.url).hostname.replace(/^www\./, '');
    } catch {
      rejected.push({ domain: candidate.domain || 'invalid address', reason: 'invalid URL' });
      continue;
    }
    if (urls.has(host)) continue;
    const planned = candidateToSource(candidate, today, ids);
    if (planned.problem) {
      rejected.push({ domain: candidate.domain || host, reason: planned.problem });
      continue;
    }
    const file = join(sourceDir, `${planned.id}.json`);
    writeFileSync(file, `${JSON.stringify(planned.source, null, 2)}\n`);
    try {
      validateSource(planned.id, today);
      accepted.push({ id: planned.id, domain: candidate.domain || host, adapter: planned.source.adapter });
      urls.add(host);
    } catch (error) {
      unlinkSync(file);
      const message = clean(error?.stderr || error?.stdout || error?.message, 300);
      rejected.push({ domain: candidate.domain || host, reason: `the ${planned.source.adapter} reader could not validate usable events${message ? `: ${message}` : ''}` });
    }
  }
  return { accepted, rejected };
}

export function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  const reportFile = argv[1];
  if (!input || !reportFile) throw new Error('Usage: source-onboarding.mjs <discovery.json> <report.md>');
  const data = JSON.parse(readFileSync(input, 'utf8'));
  const today = data.today ?? new Date().toISOString().slice(0, 10);
  const { accepted, rejected } = onboardCandidates(data);

  const lines = ['# Automatic source discovery', '', `Checked ${data.candidates?.length ?? 0} newly found websites on ${today}.`, ''];
  lines.push(`## Added automatically (${accepted.length})`, '');
  if (accepted.length) for (const item of accepted) lines.push(`- \`${item.id}\` (${item.domain}): validated with the ${item.adapter} reader.`);
  else lines.push('- None this month.');
  lines.push('', `## Not added (${rejected.length})`, '', 'Unsafe, blocked, out-of-area, or unsupported results fail closed and do not create owner tasks.', '');
  if (rejected.length) for (const item of rejected) lines.push(`- ${item.domain}: ${item.reason}.`);
  else lines.push('- None.');
  lines.push('');
  writeFileSync(reportFile, lines.join('\n'));
  console.log(`${accepted.length} source(s) added automatically; ${rejected.length} rejected without onboarding.`);
  return { accepted, rejected };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
