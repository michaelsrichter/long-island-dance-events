import { describe, expect, it } from 'vitest';
import {
  changedFileProblems,
  openPullRequestProblems,
  pullRequestProblems,
  workflowRunProblems,
} from '../../.github/scripts/auto-merge-ingest.mjs';
import { PULL_REQUEST_TITLE, pullRequestBody } from '../../.github/scripts/ingest-pr.mjs';

const repository = 'michaelsrichter/long-island-dance-events';
const sha = 'a'.repeat(40);
const run = {
  name: 'CI',
  event: 'workflow_dispatch',
  conclusion: 'success',
  head_branch: 'ingest/updates',
  head_sha: sha,
  head_repository: { full_name: repository },
};
const pr = {
  state: 'open',
  draft: false,
  base: { ref: 'main' },
  head: { ref: 'ingest/updates', sha, repo: { full_name: repository } },
  mergeable: true,
  mergeable_state: 'clean',
};

describe('collected-event auto-merge guards', () => {
  it('accepts only the trusted manual CI run for the repository-owned rolling branch', () => {
    expect(workflowRunProblems(run, repository)).toEqual([]);
    for (const [change, problem] of [
      [{ name: 'Other' }, 'workflow must be CI'],
      [{ event: 'pull_request' }, 'workflow_dispatch'],
      [{ conclusion: 'failure' }, 'conclusion must be success'],
      [{ head_branch: 'feature' }, 'head branch must be ingest/updates'],
      [{ head_repository: { full_name: 'someone/fork' } }, 'head repository'],
      [{ head_sha: 'short' }, 'full commit SHA'],
    ] satisfies [Record<string, unknown>, string][]) {
      expect(workflowRunProblems({ ...run, ...change }, repository).join(' ')).toContain(problem);
    }
  });

  it('rejects stale, draft, forked, conflicting, or wrongly based pull requests', () => {
    expect(pullRequestProblems(run, pr, repository)).toEqual([]);
    for (const [change, problem] of [
      [{ state: 'closed' }, 'must be open'],
      [{ draft: true }, 'must not be a draft'],
      [{ base: { ref: 'develop' } }, 'base must be main'],
      [{ head: { ...pr.head, ref: 'feature' } }, 'head must be ingest/updates'],
      [{ head: { ...pr.head, repo: { full_name: 'someone/fork' } } }, 'head repository'],
      [{ head: { ...pr.head, sha: 'b'.repeat(40) } }, 'no longer matches'],
      [{ mergeable: false }, 'not currently mergeable'],
      [{ mergeable_state: 'behind' }, 'must be clean'],
    ] satisfies [Record<string, unknown>, string][]) {
      expect(pullRequestProblems(run, { ...pr, ...change }, repository).join(' ')).toContain(problem);
    }
  });

  it('requires exactly one open rolling pull request', () => {
    expect(openPullRequestProblems([{ number: 56 }])).toEqual([]);
    expect(openPullRequestProblems([]).join(' ')).toContain('found 0');
    expect(openPullRequestProblems([{ number: 56 }, { number: 57 }]).join(' ')).toContain('found 2');
  });

  it('allows only a complete, non-empty src/content file list', () => {
    const files = [{ filename: 'src/content/events/a.json' }, { filename: 'src/content/venues/b.json' }];
    expect(changedFileProblems(files, 2)).toEqual([]);
    expect(changedFileProblems(files, 3).join(' ')).toContain('returned 2 changed files');
    expect(changedFileProblems([], 0).join(' ')).toContain('at least one file');
    expect(changedFileProblems([...files, { filename: '.github/workflows/ci.yml' }], 3).join(' ')).toContain('.github/workflows/ci.yml');
    expect(changedFileProblems([{ filename: 'src/content/events/ci.yml', previous_filename: '.github/workflows/ci.yml' }], 1).join(' ')).toContain('.github/workflows/ci.yml');
  });
});

describe('rolling collection pull request copy', () => {
  it('promises automatic publishing without asking for review or mentioning the owner', () => {
    const body = pullRequestBody({
      report: 'Totals: 10 listed events, 2 hidden automatically, 3 files changed.\n',
      cadence: 'weekly,monthly',
      today: '2026-10-28',
    });
    expect(PULL_REQUEST_TITLE).toBe('Collected events: publish automatically after checks');
    expect(body).toContain('publishes automatically');
    expect(body).toContain('No routine owner review is required');
    expect(body).toContain('Uncertain, missing, or superseded listings stay hidden automatically');
    expect(body).not.toMatch(/@michaelsrichter|request review|Publish now/i);
  });
});
