#!/usr/bin/env node
// Commit the collected changes to the rolling branch (ingest/updates) and open or update its pull
// request. The weekly run also requests review from the owner and @mentions them, which sends the
// weekly email (decision P14). Daily and twice-weekly runs add commits quietly.
//
// Usage: node .github/scripts/ingest-pr.mjs .cache/ingest/report.md
// Env: GH_TOKEN, BRANCH (ingest/updates), REVIEWER, NOTIFY (true/false), RESET (true when the
//      branch was restarted from main), CADENCE, RUN_URL.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const reportFile = process.argv[2] ?? '.cache/ingest/report.md';
const BRANCH = process.env.BRANCH ?? 'ingest/updates';
const REVIEWER = process.env.REVIEWER ?? 'michaelsrichter';
const NOTIFY = process.env.NOTIFY === 'true';
const RESET = process.env.RESET === 'true';
const CADENCE = process.env.CADENCE ?? 'manual';
const RUN_URL = process.env.RUN_URL ?? '';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

if (process.env.GITHUB_ACTIONS !== 'true') {
  console.log('This script commits, pushes and opens pull requests, so it only runs inside GitHub Actions.');
  process.exit(0);
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
const report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : '_No report was written._';

const changes = sh('git', ['status', '--porcelain', '--', 'src/content']);
if (changes) {
  sh('git', ['add', '--', 'src/content']);
  sh('git', ['commit', '-m', `Collect events (${CADENCE}, ${today})`]);
}
const ahead = Number(sh('git', ['rev-list', '--count', 'origin/main..HEAD']));
if (!ahead) {
  console.log('Nothing new to propose.');
  process.exit(0);
}
sh('git', ['push', ...(RESET ? ['--force'] : []), 'origin', `HEAD:${BRANCH}`]);

const header = [
  'New and changed listings from the scheduled collection. **Merging this pull request publishes them.**',
  'It keeps updating on every run (daily, Monday and Thursday, Sunday) until it is merged.',
  '',
  '**How to review:** check the run report below, open a few changed event files, and fix anything wrong in the CMS or here. ' +
    'Items marked "needs review" stay hidden on the site until an editor approves them.',
  '',
  `Latest run: **${CADENCE}** on ${today}.${RUN_URL ? ` [Run log and report database](${RUN_URL}).` : ''}${RESET ? ' The branch was restarted from main because it could not be combined with recent changes.' : ''}`,
  '',
  '---',
  '',
].join('\n');
const body = (header + report).slice(0, 60000);
// A private folder of our own in the temp directory (not a predictable shared file name).
const bodyFile = join(mkdtempSync(join(tmpdir(), 'ingest-pr-')), 'body.md');
writeFileSync(bodyFile, body, { mode: 0o600 });

const open = JSON.parse(sh('gh', ['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number,url']));
let number;
if (open.length) {
  number = String(open[0].number);
  sh('gh', ['pr', 'edit', number, '--body-file', bodyFile]);
} else {
  const url = sh('gh', ['pr', 'create', '--base', 'main', '--head', BRANCH, '--title', 'Collected events: review and merge to publish', '--body-file', bodyFile]);
  number = url.split('/').pop();
}
if (NOTIFY) {
  try {
    sh('gh', ['pr', 'edit', number, '--add-reviewer', REVIEWER]);
  } catch (e) {
    console.log(`Could not request review: ${e.message.split('\n')[0]}`);
  }
  const totals = /Totals: ([^\n]+)/.exec(report)?.[1] ?? 'see the report';
  sh('gh', ['pr', 'comment', number, '--body', `@${REVIEWER} This week's collection is ready for review. ${totals}`]);
}
// A pull request opened or updated with the workflow's own token does not start other workflows (a
// GitHub rule), so CI would never run on it. Start CI on the branch directly: its checks then show
// on this pull request, with no "Approve workflows to run" step.
try {
  sh('gh', ['workflow', 'run', 'ci.yml', '--ref', BRANCH]);
  console.log(`Started CI on ${BRANCH}.`);
} catch (e) {
  console.log(`Could not start CI (the workflow needs "actions: write"): ${e.message.split('\n')[0]}`);
}
console.log(`Pull request #${number} is up to date.`);
