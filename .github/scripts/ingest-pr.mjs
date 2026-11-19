#!/usr/bin/env node
// Commit the collected changes to the rolling branch (ingest/updates) and open or update its pull
// request. The trusted default-branch workflow merges the exact branch SHA automatically after CI.
//
// Usage: node .github/scripts/ingest-pr.mjs .cache/ingest/report.md
// Env: GH_TOKEN, BRANCH (ingest/updates), RESET (true when the branch was restarted from main),
//      CADENCE, RUN_URL.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PULL_REQUEST_TITLE = 'Collected events: publish automatically after checks';
export const CI_WORKFLOW_FILE = 'ci.yml';
export const PUBLISH_WORKFLOW_FILE = 'ingest-auto-merge.yml';

export function pullRequestBody({ report, cadence, today, runUrl = '', reset = false }) {
  const header = [
    'New and changed listings from the scheduled collection. **This publishes automatically after the trusted CI workflow passes for this exact commit.**',
    'It keeps updating on every run (daily, Monday and Thursday, Sunday) until the checks pass and it is merged.',
    '',
    'Uncertain, missing, or superseded listings stay hidden automatically with an explanation in their event history. ' +
      'No routine owner review is required. The review center still shows this log and supports exceptional manual corrections.',
    '',
    `Latest run: **${cadence}** on ${today}.${runUrl ? ` [Run log and report database](${runUrl}).` : ''}${reset ? ' The branch was restarted from main because it could not be combined with recent changes.' : ''}`,
    '',
    '---',
    '',
  ].join('\n');
  return (header + report).slice(0, 60000);
}

export function workflowDispatchCommands(branch, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('The publisher needs the exact 40-character ingest commit SHA.');
  return [
    ['workflow', 'run', CI_WORKFLOW_FILE, '--ref', branch],
    ['workflow', 'run', PUBLISH_WORKFLOW_FILE, '--ref', 'main', '-f', `head_sha=${sha}`],
  ];
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();

export function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    console.log('This script commits, pushes and opens pull requests, so it only runs inside GitHub Actions.');
    return;
  }

  const reportFile = process.argv[2] ?? '.cache/ingest/report.md';
  const branch = process.env.BRANCH ?? 'ingest/updates';
  const reset = process.env.RESET === 'true';
  const cadence = process.env.CADENCE ?? 'manual';
  const runUrl = process.env.RUN_URL ?? '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : '_No report was written._';

  const changes = sh('git', ['status', '--porcelain', '--', 'src/content']);
  if (changes) {
    sh('git', ['add', '--', 'src/content']);
    sh('git', ['commit', '-m', `Collect events (${cadence}, ${today})`]);
  }
  const ahead = Number(sh('git', ['rev-list', '--count', 'origin/main..HEAD']));
  if (!ahead) {
    console.log('Nothing new to propose.');
    return;
  }
  sh('git', ['push', ...(reset ? ['--force'] : []), 'origin', `HEAD:${branch}`]);

  const body = pullRequestBody({ report, cadence, today, runUrl, reset });
  // A private folder of our own in the temp directory (not a predictable shared file name).
  const bodyFile = join(mkdtempSync(join(tmpdir(), 'ingest-pr-')), 'body.md');
  writeFileSync(bodyFile, body, { mode: 0o600 });

  const open = JSON.parse(sh('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url']));
  let number;
  if (open.length) {
    number = String(open[0].number);
    sh('gh', ['pr', 'edit', number, '--title', PULL_REQUEST_TITLE, '--body-file', bodyFile]);
  } else {
    const url = sh('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', PULL_REQUEST_TITLE, '--body-file', bodyFile]);
    number = url.split('/').pop();
  }
  // A pull request opened or updated with the workflow's own token does not start other workflows.
  // Start CI, then start the trusted main-branch publisher with this exact commit. The publisher
  // waits for CI and refuses a stale SHA, fork, draft, conflict or non-content change.
  const sha = sh('git', ['rev-parse', 'HEAD']);
  for (const args of workflowDispatchCommands(branch, sha)) sh('gh', args);
  console.log(`Started CI on ${branch} and publisher verification for ${sha}.`);
  console.log(`Pull request #${number} is up to date and will publish automatically after CI.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
