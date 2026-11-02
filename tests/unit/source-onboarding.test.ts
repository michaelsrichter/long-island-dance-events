import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidateProblem, candidateToSource, onboardCandidates } from '../../.github/scripts/source-onboarding.mjs';

const valid = {
  domain: 'dances.example',
  url: 'https://dances.example/events',
  title: 'Friday dances',
  queries: ['Long Island swing dance calendar'],
  verification: {
    safe: true,
    robots: 'allowed',
    liPlaces: ['Huntington'],
    pages: [{ status: 200, finalUrl: 'https://dances.example/events', blocked: false, jsonldFuture: 5, next90Days: 5, icalLinks: [], googleCalendarIds: [] }],
  },
};

describe('automatic source onboarding', () => {
  it('accepts a validated public Long Island source using an existing reader', () => {
    const result = candidateToSource(valid, '2026-11-01');
    expect(result.problem).toBeUndefined();
    expect(result.id).toBe('dances');
    expect(result.source).toMatchObject({
      adapter: 'jsonld',
      type: 'jsonld',
      enabled: true,
      catalogStatus: 'verified',
      focus: 'dance',
      url: 'https://dances.example/events',
    });
  });

  it('writes a validated source automatically without an approval step', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'lide-onboard-'));
    try {
      const result = onboardCandidates({ today: '2026-11-01', candidates: [valid] }, { sourceDir, validateSource: () => undefined });
      expect(result.accepted).toEqual([{ id: 'dances', domain: 'dances.example', adapter: 'jsonld' }]);
      expect(JSON.parse(readFileSync(join(sourceDir, 'dances.json'), 'utf8'))).toMatchObject({ enabled: true, adapter: 'jsonld' });
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe or private candidates without creating a source', () => {
    const unsafe = { ...valid, url: 'http://127.0.0.1/events', verification: { safe: false, unsafeReason: 'private address', pages: [] } };
    expect(candidateProblem(unsafe)).toMatch(/unsafe URL/);
    expect(candidateToSource(unsafe, '2026-11-01')).toEqual({ problem: 'unsafe URL: private address' });
  });

  it('removes a proposed source when the real collector cannot validate it', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'lide-onboard-'));
    try {
      const result = onboardCandidates(
        { today: '2026-11-01', candidates: [valid] },
        {
          sourceDir,
          validateSource: () => {
            throw new Error('no usable events');
          },
        },
      );
      expect(result.accepted).toEqual([]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]).toMatchObject({ domain: 'dances.example' });
      expect(result.rejected[0]?.reason).toContain('could not validate usable events');
      expect(existsSync(join(sourceDir, 'dances.json'))).toBe(false);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('the discovery verifier refuses private addresses before fetching', () => {
    const root = join(import.meta.dirname, '..', '..');
    const script = [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(join(root, 'catalog', 'scripts'))})`,
      'from verify_sources import public_url_problem',
      "assert public_url_problem('http://127.0.0.1/events')",
      "assert public_url_problem('http://169.254.169.254/latest/meta-data')",
    ].join('\n');
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const result = spawnSync(python, ['-c', script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });

  it('the discovery verifier checks redirect destination robots before fetching it', () => {
    const root = join(import.meta.dirname, '..', '..');
    const script = [
      'import sys,tempfile,urllib.error',
      `sys.path.insert(0, ${JSON.stringify(join(root, 'catalog', 'scripts'))})`,
      'import verify_sources as v',
      'v.HOST_DELAY=0',
      'v.require_public_url=lambda url: None',
      "seen=[]",
      "v.robots_check=lambda url, cache: seen.append(url) or {'robots':'disallowed'}",
      "class O:\n def open(self,req,timeout=0):\n  raise urllib.error.HTTPError(req.full_url,302,'redirect',{'location':'https://other.example/events'},None)",
      'v.urllib.request.build_opener=lambda *args: O()',
      "r=v._polite_get('https://public.example/start',tempfile.mkdtemp(),obey_redirect_robots=True)",
      "assert r.get('robotsBlocked') is True",
      "assert seen == ['https://other.example/events']",
    ].join('\n');
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const result = spawnSync(python, ['-c', script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });
});
