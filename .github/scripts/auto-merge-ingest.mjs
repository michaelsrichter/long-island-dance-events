#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export const CI_WORKFLOW = 'CI';
export const CI_WORKFLOW_FILE = 'ci.yml';
export const INGEST_BRANCH = 'ingest/updates';
export const MAIN_BRANCH = 'main';
export const CONTENT_PREFIX = 'src/content/';

export function workflowRunProblems(run, repository, expectedSha = run?.head_sha) {
  const problems = [];
  if (run?.name !== CI_WORKFLOW) problems.push(`workflow must be ${CI_WORKFLOW}`);
  if (run?.event !== 'workflow_dispatch') problems.push('CI must have been started with workflow_dispatch');
  if (run?.conclusion !== 'success') problems.push('CI conclusion must be success');
  if (run?.head_branch !== INGEST_BRANCH) problems.push(`CI head branch must be ${INGEST_BRANCH}`);
  if (run?.head_repository?.full_name !== repository) problems.push(`CI head repository must be ${repository}`);
  if (!/^[0-9a-f]{40}$/.test(String(expectedSha ?? ''))) problems.push('expected head SHA must be a full commit SHA');
  if (!/^[0-9a-f]{40}$/.test(String(run?.head_sha ?? ''))) problems.push('CI head SHA must be a full commit SHA');
  else if (run.head_sha !== expectedSha) problems.push('CI head SHA must match the dispatched ingest SHA');
  return problems;
}

export function pullRequestProblems(run, pr, repository) {
  const problems = [];
  if (pr?.state !== 'open') problems.push('pull request must be open');
  if (pr?.draft) problems.push('pull request must not be a draft');
  if (pr?.base?.ref !== MAIN_BRANCH) problems.push(`pull request base must be ${MAIN_BRANCH}`);
  if (pr?.head?.ref !== INGEST_BRANCH) problems.push(`pull request head must be ${INGEST_BRANCH}`);
  if (pr?.head?.repo?.full_name !== repository) problems.push(`pull request head repository must be ${repository}`);
  if (pr?.head?.sha !== run?.head_sha) problems.push('successful CI SHA no longer matches the pull request head SHA');
  if (pr?.mergeable !== true) problems.push('pull request is not currently mergeable');
  const exactTrustedCi = workflowRunProblems(run, repository, pr?.head?.sha).length === 0;
  if (pr?.mergeable_state !== 'clean' && !(pr?.mergeable_state === 'unstable' && exactTrustedCi)) {
    problems.push(`pull request mergeable state must be clean or independently checked unstable, not ${pr?.mergeable_state ?? 'unknown'}`);
  }
  return problems;
}

export function successfulWorkflowRun(runs, expectedSha, repository) {
  if (!Array.isArray(runs)) return null;
  return runs.find((run) => workflowRunProblems(run, repository, expectedSha).length === 0) ?? null;
}

export function openPullRequestProblems(pulls) {
  return Array.isArray(pulls) && pulls.length === 1
    ? []
    : [`expected exactly one open ${INGEST_BRANCH} pull request, found ${Array.isArray(pulls) ? pulls.length : 'an invalid response'}`];
}

export function changedFileProblems(files, expectedCount) {
  const problems = [];
  if (!Number.isInteger(expectedCount) || expectedCount < 1) problems.push('pull request must change at least one file');
  if (files.length !== expectedCount) problems.push(`GitHub returned ${files.length} changed files but the pull request reports ${expectedCount}`);
  const outside = files
    .flatMap((file) => [file?.filename, file?.previous_filename])
    .filter((filename) => filename !== undefined)
    .map(String)
    .filter((filename) => !filename.startsWith(CONTENT_PREFIX));
  if (outside.length) problems.push(`all changed files must be under ${CONTENT_PREFIX}; found ${outside.slice(0, 10).join(', ')}`);
  return problems;
}

class GitHubApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireNoProblems(label, problems) {
  if (problems.length) throw new Error(`${label} refused: ${problems.join('; ')}`);
}

async function githubApi(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message ? `: ${data.message}` : '';
    throw new GitHubApiError(response.status, `GitHub API ${method} ${path} failed (${response.status})${message}`);
  }
  return data;
}

async function changedFiles(repository, number) {
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await githubApi(`/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) return files;
  }
  throw new Error('Changed-file guard refused: GitHub pull request file listing exceeded 3,000 files');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSuccessfulCi(repository, expectedSha) {
  const timeout = Number(process.env.CI_POLL_TIMEOUT_MS) || 12 * 60_000;
  const interval = Number(process.env.CI_POLL_INTERVAL_MS) || 15_000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const data = await githubApi(
      `/repos/${repository}/actions/workflows/${CI_WORKFLOW_FILE}/runs?event=workflow_dispatch&branch=${encodeURIComponent(INGEST_BRANCH)}&per_page=100`,
    );
    const run = successfulWorkflowRun(data?.workflow_runs, expectedSha, repository);
    if (run) return run;
    console.log(`Waiting for successful ${CI_WORKFLOW} workflow_dispatch at ${expectedSha}...`);
    await delay(interval);
  }
  throw new Error(`CI guard refused: no successful workflow_dispatch ${CI_WORKFLOW} run found for ${expectedSha} before timeout`);
}

async function ensureRollingBranch(repository, sha) {
  const refPath = `/repos/${repository}/git/ref/heads/${INGEST_BRANCH}`;
  try {
    await githubApi(refPath);
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) throw error;
    await githubApi(`/repos/${repository}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${INGEST_BRANCH}`, sha },
    });
    console.log(`Restored ${INGEST_BRANCH} at ${sha}; the rolling branch is intentionally kept after merge.`);
  }
}

export async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const expectedSha = process.env.EXPECTED_HEAD_SHA ?? '';
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');
  if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/name');
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error('EXPECTED_HEAD_SHA must be a full commit SHA');

  const run = await waitForSuccessfulCi(repository, expectedSha);
  requireNoProblems('Workflow-run guard', workflowRunProblems(run, repository, expectedSha));

  const owner = repository.split('/')[0];
  const pulls = await githubApi(
    `/repos/${repository}/pulls?state=open&base=${MAIN_BRANCH}&head=${encodeURIComponent(`${owner}:${INGEST_BRANCH}`)}&per_page=10`,
  );
  requireNoProblems('Pull-request guard', openPullRequestProblems(pulls));

  const number = pulls[0].number;
  let pr = await githubApi(`/repos/${repository}/pulls/${number}`);
  requireNoProblems('Pull-request guard', pullRequestProblems(run, pr, repository));

  const files = await changedFiles(repository, number);
  requireNoProblems('Changed-file guard', changedFileProblems(files, pr.changed_files));

  // Re-read immediately before merging so a new collection commit, base change, draft change, or
  // conflict cannot slip through after the file check. The merge API also receives the exact SHA.
  pr = await githubApi(`/repos/${repository}/pulls/${number}`);
  requireNoProblems('Final pull-request guard', pullRequestProblems(run, pr, repository));

  const merged = await githubApi(`/repos/${repository}/pulls/${number}/merge`, {
    method: 'PUT',
    body: {
      sha: run.head_sha,
      merge_method: 'merge',
      commit_title: `Merge collected events (#${number})`,
    },
  });
  if (!merged?.merged || !merged?.sha) throw new Error(`Merge refused by GitHub: ${merged?.message ?? 'no merge commit was created'}`);

  // A repository may be configured to delete merged branches. Restore this one if necessary because
  // the next scheduled collection continues from the same rolling branch.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await ensureRollingBranch(repository, run.head_sha);
  console.log(`Merged pull request #${number} as ${merged.sha}; ${INGEST_BRANCH} was kept.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
