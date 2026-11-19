import { describe, expect, it } from 'vitest';
import { applySourceHealth } from '../../ingest/lib/source-health';
import type { SourceData } from '../../src/lib/schemas';

const source = (extra: Partial<SourceData> = {}): SourceData =>
  ({
    name: 'Example source',
    url: 'https://events.example/',
    type: 'jsonld',
    adapter: 'jsonld',
    cadence: 'weekly',
    focus: 'dance',
    enabled: true,
    attribution: 'Listings from Example.',
    rateLimitSeconds: 5,
    lastStatus: 'never',
    ...extra,
  }) as SourceData;

describe('continuous source failure policy', () => {
  it('keeps retrying for less than 30 days without creating owner work', () => {
    const result = applySourceHealth(
      source({ failure: { firstFailedAt: '2026-10-01', lastFailedAt: '2026-10-20', consecutiveFailedChecks: 3 } }),
      { status: 'error', found: 0, message: 'HTTP 500' },
      '2026-10-30',
    );
    expect(result.outcome).toBe('retrying');
    expect(result.daysFailing).toBe(29);
    expect(result.source.enabled).toBe(true);
    expect(result.source.failure).toMatchObject({ firstFailedAt: '2026-10-01', lastFailedAt: '2026-10-30', consecutiveFailedChecks: 4 });
    expect(result.source.reviewNotes).toBeUndefined();
  });

  it('clears the failure streak after any successful check', () => {
    const result = applySourceHealth(
      source({ failure: { firstFailedAt: '2026-10-01', lastFailedAt: '2026-10-20', consecutiveFailedChecks: 3 } }),
      { status: 'ok', found: 4 },
      '2026-10-21',
    );
    expect(result.outcome).toBe('reset');
    expect(result.source.enabled).toBe(true);
    expect(result.source.failure).toBeUndefined();
  });

  it('switches off after 30 continuous days and records an auditable reason', () => {
    const result = applySourceHealth(
      source({ failure: { firstFailedAt: '2026-10-01', lastFailedAt: '2026-10-29', consecutiveFailedChecks: 5 } }),
      { status: 'empty', found: 0, message: 'No event data on the page.' },
      '2026-10-31',
    );
    expect(result.outcome).toBe('disabled');
    expect(result.source.enabled).toBe(false);
    expect(result.source.failure).toMatchObject({
      firstFailedAt: '2026-10-01',
      disabledAt: '2026-10-31',
      disabledReason: expect.stringContaining('No listings were found.'),
    });
    expect(result.source.reviewNotes).toContain('Automatically switched off on 2026-10-31 after 30 continuous days');
  });

  it('does not treat an empty Long Island result as a fetch failure when listings were found', () => {
    const result = applySourceHealth(
      source({ failure: { firstFailedAt: '2026-10-01', lastFailedAt: '2026-10-08', consecutiveFailedChecks: 2 } }),
      { status: 'empty', found: 7 },
      '2026-10-09',
    );
    expect(result.outcome).toBe('reset');
    expect(result.source.failure).toBeUndefined();
  });
});
