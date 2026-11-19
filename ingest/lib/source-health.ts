import type { SourceData } from '../../src/lib/schemas';

export const SOURCE_FAILURE_GRACE_DAYS = 30;

export interface SourceHealthResult {
  source: SourceData;
  outcome: 'healthy' | 'reset' | 'retrying' | 'disabled';
  daysFailing: number;
}

interface CheckResult {
  status: SourceData['lastStatus'];
  found: number;
  message?: string | undefined;
}

/** An empty result is a source failure only when the adapter found no listings at all. */
export function isSourceFailure(check: CheckResult): boolean {
  return check.status === 'error' || check.status === 'invalid' || (check.status === 'empty' && check.found === 0);
}

function daysBetween(first: string, today: string): number {
  return Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000));
}

function reasonFor(check: CheckResult): string {
  const kind = check.status === 'empty' ? 'No listings were found.' : check.status === 'invalid' ? 'The source returned invalid event data.' : 'The source could not be read.';
  return `${kind}${check.message ? ` ${check.message}` : ''}`.slice(0, 500);
}

function appendNote(notes: string | undefined, note: string): string {
  const prior = notes?.trim();
  return prior ? `${prior} ${note}` : note;
}

/** Apply the continuous-failure policy after one source check. */
export function applySourceHealth(source: SourceData, check: CheckResult, today: string): SourceHealthResult {
  if (!isSourceFailure(check)) {
    if (!source.failure) return { source, outcome: 'healthy', daysFailing: 0 };
    const { failure: _failure, ...healthy } = source;
    return { source: healthy as SourceData, outcome: 'reset', daysFailing: 0 };
  }

  const previous = source.failure?.disabledAt ? undefined : source.failure;
  const firstFailedAt = previous?.firstFailedAt ?? today;
  const daysFailing = daysBetween(firstFailedAt, today);
  const disabled = daysFailing >= SOURCE_FAILURE_GRACE_DAYS;
  const disabledReason = disabled ? reasonFor(check) : undefined;
  const failure = {
    firstFailedAt,
    lastFailedAt: today,
    consecutiveFailedChecks: (previous?.consecutiveFailedChecks ?? 0) + 1,
    disabledAt: disabled ? today : undefined,
    disabledReason,
  };
  const note = disabled
    ? `Automatically switched off on ${today} after ${daysFailing} continuous days without a successful check. ${disabledReason}`
    : undefined;

  return {
    source: {
      ...source,
      enabled: disabled ? false : source.enabled,
      failure,
      reviewNotes: note ? appendNote(source.reviewNotes, note) : source.reviewNotes,
    },
    outcome: disabled ? 'disabled' : 'retrying',
    daysFailing,
  };
}
