#!/usr/bin/env node
// Keep a compact, machine-readable weekly collector history in one GitHub issue. The review center
// combines it with live workflow and pull-request facts, so a healthy collector is never mistaken
// for a published site update.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const HISTORY_TITLE = 'Automation log: event collection history';
export const HISTORY_LABEL = 'automation-log';
export const HISTORY_MARKER = 'ingest-history-data';
const MAX_WEEKS = 54;

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function dayInNewYork(iso) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function weekStart(iso) {
  const day = dayInNewYork(iso);
  const date = new Date(`${day}T12:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function parseHistory(text) {
  const raw = String(text || '').trim();
  const marker = new RegExp(`<!-- ${HISTORY_MARKER}\\n([\\s\\S]*?)\\n-->`).exec(raw);
  try {
    const parsed = JSON.parse(marker ? marker[1] : raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.weeks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function summarizeReport(report, env = process.env) {
  const sources = Array.isArray(report?.sources) ? report.sources : [];
  const status = ['success', 'failure', 'cancelled'].includes(env.JOB_STATUS) ? env.JOB_STATUS : 'failure';
  return {
    id: String(env.RUN_ID || ''),
    at: String(report?.startedAt || env.RUN_AT || new Date().toISOString()),
    url: String(env.RUN_URL || ''),
    status,
    found: sources.reduce((sum, source) => sum + number(source?.found), 0),
    added: status === 'success' ? sources.reduce((sum, source) => sum + number(source?.merge?.new), 0) : 0,
    changed: status === 'success' ? sources.reduce((sum, source) => sum + number(source?.merge?.updated), 0) : 0,
    hidden: status === 'success' ? sources.reduce((sum, source) => sum + (Array.isArray(source?.hidden) ? source.hidden.length : 0), 0) : 0,
  };
}

export function updateHistory(history, run) {
  const next = structuredClone(history || { version: 1, generatedAt: new Date().toISOString(), weeks: [] });
  if (!Array.isArray(next.weeks)) next.weeks = [];
  if (next.weeks.some((week) => Array.isArray(week.runIds) && week.runIds.map(String).includes(run.id))) return next;
  const key = weekStart(run.at);
  let week = next.weeks.find((item) => item.week === key);
  if (!week) {
    week = {
      week: key,
      found: 0,
      added: 0,
      changed: 0,
      hidden: 0,
      published: 0,
      collector: { success: 0, failure: 0, cancelled: 0 },
      latestAt: '',
      latestUrl: '',
      publicationIds: [],
      publicationUrls: [],
      runIds: [],
    };
    next.weeks.push(week);
  }
  week.found = number(week.found) + run.found;
  week.added = number(week.added) + run.added;
  week.changed = number(week.changed) + run.changed;
  week.hidden = number(week.hidden) + run.hidden;
  week.collector = { success: 0, failure: 0, cancelled: 0, ...(week.collector || {}) };
  week.collector[run.status] = number(week.collector[run.status]) + 1;
  week.runIds = [...new Set([...(week.runIds || []).map(String), run.id])];
  if (!week.latestAt || run.at > week.latestAt) {
    week.latestAt = run.at;
    week.latestUrl = run.url;
  }
  next.generatedAt = new Date().toISOString();
  next.weeks.sort((a, b) => String(b.week).localeCompare(String(a.week)));
  next.weeks = next.weeks.slice(0, MAX_WEEKS);
  return next;
}

export function issueBody(history) {
  const rows = history.weeks
    .slice(0, 12)
    .map((week) => `| ${week.week} | ${number(week.found)} | ${number(week.added)} | ${number(week.published)} | ${number(week.collector?.success)} | ${number(week.collector?.failure) + number(week.collector?.cancelled)} |`)
    .join('\n');
  return [
    '<!-- ingest-history -->',
    '# Automated event collection history',
    '',
    'This issue is maintained by the scheduled collector. The owner-facing view is **Review center → Event updates**.',
    '',
    '| Week starting | Source listings found | New events added to update | New events published | Successful runs | Failed or cancelled runs |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    rows || '| No runs yet | 0 | 0 | 0 | 0 | 0 |',
    '',
    'The machine-readable record below stores collector totals. The dashboard adds live publisher runs and merged pull-request file counts. Do not edit it by hand.',
    '',
    `<!-- ${HISTORY_MARKER}`,
    JSON.stringify(history),
    '-->',
    '',
  ].join('\n');
}

const gh = (args, options = {}) => execFileSync('gh', args, { encoding: 'utf8', ...options }).trim();

export function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    console.log('This script updates the automation log only inside GitHub Actions.');
    return;
  }
  const reportPath = process.argv[2] || '.cache/ingest/report.json';
  const seedPath = process.argv[3] || '.github/ingest-history-seed.json';
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  const run = summarizeReport(report);
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !run.id) throw new Error('GITHUB_REPOSITORY and RUN_ID are required.');

  gh(['label', 'create', HISTORY_LABEL, '--repo', repo, '--color', '5319e7', '--description', 'Machine-maintained site automation history', '--force']);

  const issues = JSON.parse(gh(['api', `repos/${repo}/issues?state=all&labels=${HISTORY_LABEL}&per_page=100`]) || '[]');
  const issue = issues.find((item) => String(item.body || '').includes('<!-- ingest-history -->')) || null;
  const seed = existsSync(seedPath) ? parseHistory(readFileSync(seedPath, 'utf8')) : null;
  const current = parseHistory(issue?.body) || seed || { version: 1, generatedAt: new Date().toISOString(), weeks: [] };
  const history = updateHistory(current, run);
  const bodyFile = '.cache/ingest/history-issue.md';
  mkdirSync('.cache/ingest', { recursive: true });
  writeFileSync(bodyFile, issueBody(history));

  if (issue) {
    gh(['api', '-X', 'PATCH', `repos/${repo}/issues/${issue.number}`, '-f', `title=${HISTORY_TITLE}`, '-F', `body=@${bodyFile}`, '-f', 'state=open']);
    console.log(`Updated event collection history issue #${issue.number}.`);
  } else {
    const created = JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/issues`, '-f', `title=${HISTORY_TITLE}`, '-F', `body=@${bodyFile}`, '-f', `labels[]=${HISTORY_LABEL}`]));
    console.log(`Created event collection history issue #${created.number}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
