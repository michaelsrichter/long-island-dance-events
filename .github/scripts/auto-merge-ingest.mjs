#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CI_WORKFLOW = 'CI';
export const INGEST_BRANCH = 'ingest/updates';
export const MAIN_BRANCH = 'main';
export const CONTENT_PREFIX = 'src/content/';

export function workflowRunProblems(run, repository) {
  const problems = [];
  if (run?.name !== CI_WORKFLOW) problems.push(`workflow must be ${CI_WORKFLOW}`);
  if (run?.event !== 'workflow_dispatch') problems.push('CI must have been started with workflow_dispatch');
  if (run?.conclusion !== 'success') problems.push('CI conclusion must be success');
  if (run?.head_branch !== INGEST_BRANCH) problems.push(`CI head branch must be ${INGEST_BRANCH}`);
  if (run?.head_repository?.full_name !== repository) problems.push(`CI head repository must be ${repository}`);
  if (!/^[0-9a-f]{40}$/.test(String(run?.head_sha ?? ''))) problems.push('CI head SHA must be a full commit SHA');
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
  if (pr?.mergeable_state !== 'clean') problems.push(`pull request mergeable state must be clean, not ${pr?.mergeable_state ?? 'unknown'}`);
  return problems;
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
  const eventPath = process.env.GITHUB_EVENT_PATH ?? '';
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');
  if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/name');
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');

  const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  const run = payload.workflow_run;
  requireNoProblems('Workflow-run guard', workflowRunProblems(run, repository));

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
