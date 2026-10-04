/** Clues about dancing found in a listing (shared by every adapter; used by src/lib/dancing.ts). */
import type { DancingCue } from '../../src/lib/schemas';
import { parseTimes } from './times';

export interface CueInput {
  /** Band, DJ or event name as listed. */
  act: string;
  /** Venue name as listed. */
  venue: string;
  /** Whole listing text (kept for future cues). */
  text?: string | undefined;
  /** Time as written, e.g. "7pm" or "1-5pm". */
  time?: string | undefined;
}

export function cuesFor(row: CueInput): DancingCue[] {
  const t = `${row.act} ${row.venue}`;
  const cues = new Set<DancingCue>();
  if (/(^|\W)dj\b/i.test(row.act)) cues.add('dj');
  if (/\b(dance party|dance night|disco|club night|silent disco)\b|club \d\d\+/i.test(t)) cues.add('dance-party');
  if (/\b(theat(er|re)|playhouse|performing arts|showplace|center for the arts|cmpac|boulton|paramount|flagstar|bandshell|amphitheat(er|re))\b/i.test(t)) cues.add('theater');
  if (/\blibrary\b/i.test(t)) cues.add('library');
  if (/\bbrunch\b/i.test(t)) cues.add('brunch');
  if (/\b(fest(ival)?|oktoberfest|octoberfest|fair|car show|block party|street fair)\b/i.test(t)) cues.add('festival');
  if (/\b(beach|park|pk\b|marina|boardwalk|bandshell|lawn)\b/i.test(t)) cues.add('outdoor');
  if (/\btribute\b|\bthe music of\b|\bexperience\b|\b(almost|alter|spirit of)\b/i.test(t)) cues.add('tribute');
  if (/\b(acoustic|unplugged|duo|solo)\b/i.test(row.act)) cues.add('acoustic');
  if (/\bjam\b/i.test(row.act)) cues.add('jam');
  const start = row.time ? parseTimes(row.time).start : undefined;
  if (start && Number(start.slice(0, 2)) < 17) cues.add('afternoon');
  return [...cues].sort();
}
