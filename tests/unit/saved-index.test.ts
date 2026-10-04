import { describe, expect, it } from 'vitest';
import type { ResolvedEvent } from '../../src/lib/content';
import { buildSavedIndex } from '../../src/lib/saved-index';

const occ = (eventId: string, date: string, opts: Partial<{ hour: number; status: string; timeLabel: string; cadence: string }> = {}) =>
  ({
    eventId,
    title: `Title ${eventId}`,
    date,
    url: `/events/${date}-${eventId}/`,
    start: new Date(`${date}T${String(opts.hour ?? 19).padStart(2, '0')}:00:00-04:00`),
    end: new Date(`${date}T23:00:00-04:00`),
    timeLabel: opts.timeLabel ?? '7:00 PM to 11:00 PM',
    location: { name: 'Example Hall', town: 'Huntington' },
    categoryLabel: 'Social dance',
    cadence: opts.cadence,
    status: opts.status ?? 'active',
  }) as unknown as ResolvedEvent;

describe('saved events index', () => {
  const now = new Date('2026-10-05T12:00:00-04:00');

  it('keeps only dates that have not ended, in date order, with place, kind and repeat note', () => {
    const idx = buildSavedIndex([occ('swing', '2026-10-12', { cadence: 'Every Monday' }), occ('swing', '2026-10-04'), occ('swing', '2026-10-05')], now);
    const e = idx.events.swing!;
    expect(e.o.map((d) => d.d)).toEqual(['2026-10-05', '2026-10-12']);
    expect(e).toMatchObject({ t: 'Title swing', p: 'Example Hall, Huntington', c: 'Social dance', r: 'Every Monday' });
    expect(e.o[0]).toMatchObject({ u: '/events/2026-10-05-swing/', l: '7:00 PM to 11:00 PM' });
    expect(e.o[0]!.e).toBeGreaterThan(now.getTime());
  });

  it('leaves out series that have ended, marks cancelled dates and caps the number of dates', () => {
    const many = Array.from({ length: 12 }, (_, i) => occ('weekly', `2026-11-${String(i + 1).padStart(2, '0')}`));
    const idx = buildSavedIndex([occ('gone', '2026-09-01'), occ('off', '2026-10-20', { status: 'cancelled' }), ...many], now, 8);
    expect(idx.events.gone).toBeUndefined();
    expect(idx.events.off!.o[0]!.x).toBe(1);
    expect(idx.events.weekly!.o).toHaveLength(8);
  });
});
