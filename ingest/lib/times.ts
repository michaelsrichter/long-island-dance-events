/** Time parsing for free-text listings ("7-11pm", "7 PM to 11 PM", "Lesson at 7:30pm", "8pm-12am"). */

export interface TimeToken {
  start: string;
  end?: string | undefined;
  index: number;
  length: number;
}

export interface ScheduleItem {
  start: string;
  end?: string | undefined;
  label: string;
}

export interface ParsedTimes {
  /** Earliest time the event starts (a lesson that comes first counts). */
  start?: string | undefined;
  end?: string | undefined;
  lessonTime?: string | undefined;
  tokens: TimeToken[];
}

const MER = String.raw`(a\.?\s?m\.?|p\.?\s?m\.?)`;
const T = String.raw`(\d{1,2})(?::([0-5]\d))?`;
const RANGE_RE = new RegExp(String.raw`\b${T}\s*${MER}?\s*(?:-|–|—|to|until|till)\s*${T}\s*${MER}(?![a-z])`, 'gi');
const SINGLE_RE = new RegExp(String.raw`\b${T}\s*${MER}(?![a-z])`, 'gi');
const NOON_RE = /\b(noon|midnight)\b/gi;
/** Words after "Noon" that make it a time ("Noon To 4 PM", "Noon Til Close", "Noon Sharp"). */
const TIME_CONNECTOR = /^(?:to|til|till|until|thru|through|and|or|am|pm|a\.m\.|p\.m\.|sharp|start|starts|on|onward|onwards|daily|close)$/i;

const pad = (n: number) => String(n).padStart(2, '0');
const isPm = (m: string | undefined) => Boolean(m && /^p/i.test(m));

/** 24-hour "HH:mm" from 12-hour parts. */
export function to24(h: number, m: number, mer: 'am' | 'pm'): string | null {
  if (h < 1 || h > 12 || m > 59) return null;
  const hh = mer === 'pm' ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
  return `${pad(hh)}:${pad(m)}`;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function findTimes(text: string): TimeToken[] {
  const tokens: TimeToken[] = [];
  const taken: [number, number][] = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const [sh, sm, smer, eh, em, emer] = [Number(m[1]), Number(m[2] ?? 0), m[3], Number(m[4]), Number(m[5] ?? 0), m[6]!];
    const endMer = isPm(emer) ? 'pm' : 'am';
    const end = to24(eh, em, endMer);
    let start = to24(sh, sm, smer ? (isPm(smer) ? 'pm' : 'am') : endMer);
    if (!end || !start) continue;
    // "11-2pm" means 11 AM to 2 PM; "8pm-12am" runs past midnight (handled by the event's end date).
    if (!smer && endMer === 'pm' && minutes(start) > minutes(end)) start = to24(sh, sm, 'am');
    if (!start) continue;
    tokens.push({ start, end, index: m.index!, length: m[0].length });
    taken.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of text.matchAll(SINGLE_RE)) {
    const i = m.index!;
    if (taken.some(([a, b]) => i >= a && i < b)) continue;
    const t = to24(Number(m[1]), Number(m[2] ?? 0), isPm(m[3]) ? 'pm' : 'am');
    if (t) tokens.push({ start: t, index: i, length: m[0].length });
  }
  for (const m of text.matchAll(NOON_RE)) {
    // "Midnight Roma" or "High Noon Saloon": a title-case word followed by another name word is a name,
    // not a time. "Noon To 4 PM" and "NOON TO 4PM" are times.
    const next = /^\s+([A-Za-z.]+)/.exec(text.slice(m.index! + m[0].length, m.index! + m[0].length + 12))?.[1] ?? '';
    if (/^[A-Z][a-z]+$/.test(m[1]!) && /^[A-Z]/.test(next) && !TIME_CONNECTOR.test(next)) continue;
    tokens.push({ start: m[1]!.toLowerCase() === 'noon' ? '12:00' : '00:00', index: m.index!, length: m[0].length });
  }
  return tokens.sort((a, b) => a.index - b.index);
}

/** Times that are not when the event starts (doors, coffee, food, deadlines, ticket sales closing). */
function isSideTime(text: string, t: TimeToken): boolean {
  const before = text.slice(Math.max(0, t.index - 28), t.index).toLowerCase();
  return /(doors? open|coffee|dessert|buffet|dinner served|available|served|until|till|rsvp by|reserve by|deadline|reserv|sales? close|closes?|ends?)\W*(at|from)?\W*$/.test(before) || DEADLINE_BY.test(text.slice(Math.max(0, t.index - 70), t.index).toLowerCase()) || SIDE_ACTIVITY.test(text.slice(Math.max(0, t.index - 60), t.index).toLowerCase());
}

/** "a mug holding contest in the bar at 8 p.m.", "raffle drawing at 9": part of the night, not its start. */
const SIDE_ACTIVITY = /\b(?:contest|raffle|drawing|giveaways?|prizes?|costume parade|keg tapping|toast)\b(?:\s+(?:in|on|at)\s+the\s+[\w-]+)?\s+(?:at|from|begins at|starts at)\W*$/;

/** "A decision will be made by 3 PM", "register by 5pm": a deadline, not when the event starts ("followed by 8 PM" is fine). */
const DEADLINE_BY = /\b(?:decision|decided|announce\w*|notif\w*|cancel\w*|purchase\w*|register\w*|registration|order\w*|reserv\w*|reply|respond|rsvp|sign up|tickets?)\b[^.!?]{0,40}\bby\W*$/;

export function findLessonTime(text: string, tokens: TimeToken[] = findTimes(text)): string | undefined {
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/\b(lessons?|group class|class)\b/g)) {
    const at = m.index!;
    if (/private lessons?/.test(lower.slice(Math.max(0, at - 9), at + m[0].length))) continue;
    // A time right before the word ("7:30 PM to 8 PM group class") wins when nothing separates them...
    const before = [...tokens].reverse().find((t) => t.index < at && at - (t.index + t.length) <= 25 && !/[.!]/.test(text.slice(t.index, at)));
    if (before && at - (before.index + before.length) <= 3) return before.start;
    // ...otherwise a time right after it ("Lesson at 7:30pm", "lesson with Carol at 7:30pm", "lesson 7:15pm-8pm").
    const after = tokens.find((t) => t.index > at && t.index - at <= 45 && !/[.!]/.test(text.slice(at, t.index)));
    if (after) return after.start;
    if (before) return before.start;
  }
  return undefined;
}

export function parseTimes(text: string): ParsedTimes {
  const tokens = findTimes(text);
  const lessonTime = findLessonTime(text, tokens);
  const main = tokens.filter((t) => !isSideTime(text, t));
  const ranges = main.filter((t) => t.end);
  const pool = ranges.length ? ranges : main;
  const starts = pool.map((t) => t.start);
  if (lessonTime) starts.push(lessonTime);
  // Ignore stray after-midnight singles ("coffee at 12am") when picking the start.
  const daytime = starts.filter((s) => minutes(s) >= 6 * 60);
  const start = (daytime.length ? daytime : starts).sort((a, b) => minutes(a) - minutes(b))[0];
  let end: string | undefined;
  if (start && ranges.length) {
    // The latest end, counting ends after midnight as later than 11 PM.
    const rel = (t: string) => (minutes(t) <= minutes(start) ? minutes(t) + 1440 : minutes(t));
    end = ranges.map((r) => r.end!).sort((a, b) => rel(b) - rel(a))[0];
  }
  return { start, end, lessonTime, tokens };
}

/** Class timetables: "4:45pm Int/Adv WCS, 5:45pm Adv WCS" -> [{start: "16:45", label: "Int/Adv WCS"}, ...]. */
export function parseSchedule(text: string, tokens: TimeToken[] = findTimes(text)): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const from = t.index + t.length;
    const to = i + 1 < tokens.length ? tokens[i + 1]!.index : text.length;
    let label = text
      .slice(from, to)
      .replace(/^\s*[:\-–]?\s*/, '')
      .replace(/^\([^)]*\)\s*/, '')
      .split(/[.;]|:\s|,(?!\s*\d)|\s\|\s/)[0]!
      .replace(/\b(and|&)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^(info|call|for|register|to register|www|\(|\$)/i.test(label)) label = '';
    if (label.length > 60) label = label.slice(0, 60).replace(/\s+\S*$/, '');
    if (label.length >= 3) items.push({ start: t.start, end: t.end, label });
  }
  return items;
}
