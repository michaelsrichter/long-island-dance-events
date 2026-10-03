import type { ResolvedEvent } from './content';
import { dateInZone } from './time';

/** All "YYYY-MM" keys from the first to the last event month, plus the current month. */
export function monthRange(events: ResolvedEvent[], now: Date): string[] {
  const current = dateInZone(now).slice(0, 7);
  const keys = events.map((e) => e.date.slice(0, 7));
  const min = [current, ...keys].sort()[0]!;
  const max = [current, ...keys].sort().at(-1)!;
  const out: string[] = [];
  let [y, m] = min.split('-').map(Number) as [number, number];
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k >= max) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
