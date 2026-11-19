import { describe, expect, it } from 'vitest';
import { issueBody, parseHistory, summarizeReport, updateHistory, weekStart } from '../../.github/scripts/ingest-history.mjs';

describe('weekly ingest history', () => {
  it('uses Monday in New York as the week boundary', () => {
    expect(weekStart('2026-11-16T04:30:00Z')).toBe('2026-11-09');
    expect(weekStart('2026-11-16T05:30:00Z')).toBe('2026-11-16');
  });

  it('counts source listings and only records additions from a successful run', () => {
    const report = {
      startedAt: '2026-11-18T18:49:36Z',
      sources: [
        { found: 30, merge: { new: 4, updated: 2 }, hidden: [{}, {}] },
        { found: 20, merge: { new: 3, updated: 1 }, hidden: [] },
      ],
    };
    expect(summarizeReport(report, { RUN_ID: '44', RUN_URL: 'https://example.test/44', JOB_STATUS: 'success' } as NodeJS.ProcessEnv)).toMatchObject({
      id: '44',
      found: 50,
      added: 7,
      changed: 3,
      hidden: 2,
      status: 'success',
    });
    expect(summarizeReport(report, { RUN_ID: '45', JOB_STATUS: 'failure' } as NodeJS.ProcessEnv)).toMatchObject({
      found: 50,
      added: 0,
      changed: 0,
      hidden: 0,
      status: 'failure',
    });
  });

  it('updates one weekly row once per run and round-trips through the issue marker', () => {
    const start = { version: 1, generatedAt: '', weeks: [] };
    const run = { id: '44', at: '2026-11-18T18:49:36Z', url: 'https://example.test/44', status: 'success', found: 50, added: 7, changed: 3, hidden: 2 };
    const once = updateHistory(start, run);
    const twice = updateHistory(once, run);
    expect(twice.weeks).toHaveLength(1);
    expect(twice.weeks[0]).toMatchObject({ week: '2026-11-16', found: 50, added: 7, changed: 3, hidden: 2, collector: { success: 1 } });
    expect(parseHistory(issueBody(twice))).toEqual(twice);
  });
});
