#!/usr/bin/env node
// File or update one GitHub issue per source that failed in the last collection run.
//
// A source "fails" when ingest/run.ts reports status error, empty (0 events) or invalid. The issue
// gets a snapshot of what was downloaded: address, size, content type, SHA-256 hash, page title
// and how much event data it held. It never includes the page text (we do not republish other
// people's pages). The raw files stay in the private Actions cache.
//
// Third failure in a row: the source is paused (enabled: false) in the collection pull request.
// When a source works again, its open issue is closed with a note.
//
// Usage: node .github/scripts/ingest-issues.mjs .cache/ingest/report.json   (acts only in GitHub Actions with GH_TOKEN; otherwise a dry run)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const reportFile = process.argv[2] ?? '.cache/ingest/report.json';
let report;
try {
  report = JSON.parse(readFileSync(reportFile, 'utf8'));
} catch {
  console.log(`No report at ${reportFile}; nothing to do.`);
  process.exit(0);
}
const CACHE = '.cache/ingest';
const LABEL = 'ingest-failure';
const RUN_URL = process.env.RUN_URL ?? '';
const today = report.today ?? new Date().toISOString().slice(0, 10);
// Only act for real inside GitHub Actions; anywhere else, print what would happen.
const dry = process.env.GITHUB_ACTIONS !== 'true' || !process.env.GH_TOKEN;

const gh = (...args) => {
  if (dry) {
    console.log(`[dry run] gh ${args.slice(0, 3).join(' ')} ...`);
    return '[]';
  }
  return execFileSync('gh', args, { encoding: 'utf8' });
};

/** Facts about one downloaded document, without its text. */
function snapshot(url) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 20);
  const file = join(CACHE, key);
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return `- ${url}: not downloaded (blocked, unreachable or not allowed by robots.txt)`;
  }
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
  } catch {
    // No saved headers for this download.
  }
  const text = buf.toString('utf8');
  const title = (/<title[^>]*>([^<]{0,200})<\/title>/i.exec(text)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const facts = [
    `${buf.length.toLocaleString('en-US')} bytes`,
    meta.contentType ? `type ${meta.contentType.split(';')[0]}` : '',
    `sha256 ${createHash('sha256').update(buf).digest('hex').slice(0, 16)}…`,
    meta.fetchedAt ? `downloaded ${meta.fetchedAt.slice(0, 16)}Z` : '',
    `JSON-LD blocks: ${(text.match(/application\/ld\+json/gi) ?? []).length}`,
    `calendar events (VEVENT): ${(text.match(/BEGIN:VEVENT/g) ?? []).length}`,
    title ? `page title "${title}"` : '',
  ].filter(Boolean);
  return `- ${url}: ${facts.join(', ')}`;
}

function issueBody(s) {
  const docs = (s.documents ?? []).map((d) => d.replace(/ \([^)]*\)$/, ''));
  const robots = /robots\.txt does not allow/i.test(s.message ?? '');
  const what = s.status === 'empty' ? 'no usable events' : s.status === 'invalid' ? 'broken data' : 'an error';
  return [
    `<!-- ingest-failure ${s.id} -->`,
    `**${s.name}** (\`${s.id}\`) returned **${what}** on ${today}.`,
    '',
    `- Message: ${s.message ?? 'none'}`,
    `- Listings found: ${s.found ?? 0}, kept: ${s.kept ?? 0}, failed validation: ${(s.invalid ?? []).length}`,
    ...(RUN_URL ? [`- Run log: ${RUN_URL}`] : []),
    '',
    '**Snapshot of what was downloaded** (facts only; the page text is not copied here):',
    '',
    ...(docs.length ? docs.map(snapshot) : ['- Nothing was downloaded.']),
    '',
    robots
      ? '**robots.txt now blocks our collector.** Do not work around it. Ask the organizer for permission or a calendar feed, and record it in `permission` in the source file.'
      : `What to check: did the page move or change its layout? Open it in a browser, then fix \`url\`, \`feedUrl\` or \`pageUrls\` in \`src/content/sources/${s.id}.json\`, or switch the source off.`,
    '',
    'After 3 failed runs in a row the source is paused (`enabled: false`) in the collection pull request.',
  ].join('\n');
}

function pauseSource(id, issueNumber) {
  const file = join('src', 'content', 'sources', `${id}.json`);
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false; // no such source file
  }
  if (data.enabled === false) return false;
  data.enabled = false;
  data.reviewNotes = `${data.reviewNotes ? `${data.reviewNotes} ` : ''}Paused on ${today} after 3 failed runs in a row (issue #${issueNumber}).`;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

try {
  gh('label', 'create', LABEL, '--color', 'B60205', '--description', 'A source returned no events or broken data');
} catch {
  // The label already exists.
}
const open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '200', '--json', 'number,title,body,comments'));
let filed = 0;
for (const s of report.sources ?? []) {
  if (s.status === 'skipped') continue;
  const marker = `<!-- ingest-failure ${s.id} -->`;
  const existing = open.find((i) => (i.body ?? '').includes(marker));
  // "Empty" only counts as a problem when the adapter found nothing at all (the layout probably
  // changed). Finding listings that are all past or outside Long Island is normal.
  const broken = s.status === 'error' || s.status === 'invalid' || (s.status === 'empty' && !(s.found > 0));
  if (broken) {
    const body = issueBody(s);
    if (existing) {
      // The issue itself is failure 1; each earlier failure comment adds one; this run adds one.
      const failures = 2 + (existing.comments ?? []).filter((c) => (c.body ?? '').includes(marker)).length;
      const paused = failures >= 3 && pauseSource(s.id, existing.number);
      gh('issue', 'comment', String(existing.number), '--body', `${body}${paused ? `\n\n**Paused:** failure ${failures} in a row, so the collection pull request switches this source off.` : ''}`);
    } else {
      gh('issue', 'create', '--title', `Source problem: ${s.name}`.slice(0, 200), '--label', LABEL, '--body', body);
    }
    filed++;
  } else if (existing) {
    gh('issue', 'comment', String(existing.number), '--body', `Working again on ${today}: ${s.kept ?? 0} events kept.${RUN_URL ? ` ${RUN_URL}` : ''}`);
    gh('issue', 'close', String(existing.number));
  }
}
console.log(`${filed} source problem(s) filed or updated.`);
