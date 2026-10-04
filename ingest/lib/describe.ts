/**
 * Titles and summaries written in our own words from extracted facts (brief §5: never republish
 * the source's text). Every sentence is built from a template plus facts such as styles, times and
 * names, so the result is short, factual and easy to read.
 */
import type { EventCategory } from '../../src/lib/schemas';
import { formatTime } from '../../src/lib/time';
import type { ScheduleItem } from './times';
import { joinAnd } from './text';

/** Short, readable style names for titles. */
export const STYLE_SHORT: Record<string, string> = {
  'lindy-hop': 'Lindy Hop',
  'east-coast-swing': 'East Coast Swing',
  'west-coast-swing': 'West Coast Swing',
  hustle: 'Hustle',
  ballroom: 'Ballroom',
  'latin-ballroom': 'Latin',
  salsa: 'Salsa',
  bachata: 'Bachata',
  merengue: 'Merengue',
  kizomba: 'Kizomba',
  zouk: 'Zouk',
  'argentine-tango': 'Argentine Tango',
  'country-two-step': 'Country Two-Step',
  'line-dancing': 'Line Dancing',
  blues: 'Blues',
};

export const THEME_RE =
  /\b(halloween|hallowe'?en|hallloween|spooktacular|thanksgiving|friendsgiving|christmas|holiday|new year'?s(?: eve)?|valentine'?s|st\.? patrick'?s|easter|mardi gras|anniversary|gala|oktoberfest)\b/i;

export function themeOf(text: string): string | undefined {
  const m = THEME_RE.exec(text);
  if (!m) return undefined;
  const w = m[1]!.toLowerCase();
  if (/hallo|hallloween|spook/.test(w)) return 'Halloween';
  if (/friendsgiving|thanksgiving/.test(w)) return 'Thanksgiving';
  if (/new year/.test(w)) return "New Year's";
  if (/valentine/.test(w)) return "Valentine's";
  if (/patrick/.test(w)) return "St. Patrick's";
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function styleTitle(styles: string[]): string {
  const names = styles.map((s) => STYLE_SHORT[s] ?? s);
  if (names.length === 0) return '';
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} and more`;
  return joinAnd(names);
}

export interface DescribeInput {
  category: EventCategory;
  styles: string[];
  theme?: string | undefined;
  venueName?: string | undefined;
  /** Display names. */
  djs: string[];
  liveActs: string[];
  instructors: string[];
  /** Styles named right before the word "lesson" ("East Coast Swing Lesson at 7:30pm"). */
  lessonStyles?: string[] | undefined;
  lessonTime?: string | undefined;
  schedule: ScheduleItem[];
  ageGroup?: 'adults' | 'kids' | 'teens' | 'all-ages' | undefined;
  ages?: string | undefined;
  skillLevel: string;
  /** Lowercased source text, used only to detect facts (food, costumes, partner policy). */
  facts: string;
  cadence?: string | undefined;
  /** 'music' = a bar, venue or band calendar: say "live music", not "dance", and let the dancing score tell visitors. */
  focus?: 'dance' | 'music' | undefined;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const article = (word: string) => (/^[aeiou]/i.test(word.trim()) ? 'an' : 'a');

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bWCS\b/g, 'West Coast Swing'],
  [/\bECS\b/g, 'East Coast Swing'],
  [/\bInt\s*\/\s*Adv\b/gi, 'intermediate/advanced'],
  [/\bBeg\s*\/\s*Int\b/gi, 'beginner/intermediate'],
  [/\bInt\b\.?/g, 'intermediate'],
  [/\bAdv\b\.?/g, 'advanced'],
  [/\bBeg\b\.?/g, 'beginner'],
  [/\bw\//gi, 'with '],
];

/** Plain-language class label: "Int/ Adv WCS" -> "intermediate/advanced West Coast Swing". */
export function plainLabel(label: string): string {
  let out = label.replace(/\s*\/\s*/g, '/');
  for (const [re, to] of ABBREVIATIONS) out = out.replace(re, to);
  return out.replace(/\s+/g, ' ').trim();
}

const LEVEL_WORD: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

export function makeTitle(d: DescribeInput): string {
  const styles = styleTitle(d.styles);
  const lessonStyles = styleTitle(d.lessonStyles ?? []);
  const theme = d.theme ? `${d.theme} ` : '';
  let what: string;
  const music = d.focus === 'music';
  switch (d.category) {
    case 'live-music':
      // Bar, venue and band calendars do not promise dancing; the dancing score on the page does that.
      if (music) what = d.liveActs.length ? (d.theme ? `${d.theme} show with ${joinAnd(d.liveActs)}` : joinAnd(d.liveActs)) : `${theme}live music`;
      else what = `${theme}${styles ? `${styles} dance` : 'Dance'} with live music${d.liveActs.length ? ` by ${joinAnd(d.liveActs)}` : ''}`;
      break;
    case 'lesson-party':
      what = lessonStyles
        ? `${theme}${lessonStyles} lesson and social dance`
        : `${theme}${styles ? `${styles} social dance` : 'Social dance'} with a lesson`;
      break;
    case 'class-lesson': {
      const who = d.ageGroup === 'kids' ? 'Kids ' : d.ageGroup === 'teens' ? 'Teen ' : '';
      const level = !who && LEVEL_WORD[d.skillLevel] ? `${LEVEL_WORD[d.skillLevel]} ` : '';
      const plural = d.schedule.length > 1 || d.styles.length > 1 ? 'classes' : 'class';
      what = `${theme}${who}${level}${styles ? `${styles} ${plural}` : `dance ${plural}`}`;
      break;
    }
    case 'festival':
      what = `${theme}${styles ? `${styles} ` : music ? '' : 'Dance '}festival`;
      break;
    default:
      what = `${theme}${styles ? `${styles} social dance` : 'Social dance'}${d.djs.length === 1 ? ` with ${d.djs[0]}` : ''}`;
  }
  what = cap(what.replace(/\s+/g, ' ').trim());
  const withPlace = d.venueName ? `${what} at ${d.venueName}` : what;
  return withPlace.length <= 110 ? withPlace : what.slice(0, 110);
}

export function makeSummary(d: DescribeInput): string {
  const styles = styleTitle(d.styles);
  const lessonStyles = styleTitle(d.lessonStyles ?? []);
  const parts: string[] = [];
  const lessonAt = d.lessonTime ? ` at ${formatTime(d.lessonTime)}` : '';
  const teachers = d.instructors.length ? ` with ${joinAnd(d.instructors)}` : '';
  switch (d.category) {
    case 'live-music':
      if (d.focus === 'music') parts.push(`Live music${d.liveActs.length ? ` by ${joinAnd(d.liveActs)}` : ''}${d.venueName ? ` at ${d.venueName}` : ''}. The dancing score on this page says whether people usually dance.`);
      else parts.push(`Dance to live music${d.liveActs.length ? ` by ${joinAnd(d.liveActs)}` : ''}.`);
      if (styles) parts.push(`Dance styles: ${styles}.`);
      if (d.lessonTime) parts.push(`A group lesson starts${lessonAt}${teachers}.`);
      break;
    case 'lesson-party':
      parts.push(`${cap(article(lessonStyles || 'group'))}${lessonStyles ? ` ${lessonStyles}` : ''} group lesson${lessonAt}${teachers}, then open social dancing${d.djs.length ? ` to music by ${joinAnd(d.djs)}` : ''}.`);
      if (styles && styles !== lessonStyles) parts.push(`Dance styles: ${styles}.`);
      break;
    case 'class-lesson': {
      const items = d.schedule.slice(0, 5).map((i) => `${formatTime(i.start, true)} ${plainLabel(i.label)}`);
      const level = d.skillLevel === 'beginner' ? ' for beginners' : d.skillLevel === 'intermediate' ? ' for intermediate dancers' : d.skillLevel === 'advanced' ? ' for advanced dancers' : '';
      parts.push(`${d.schedule.length > 1 ? 'Group classes' : 'Group class'}${styles ? ` in ${styles}` : ''}${level}${teachers}.`);
      if (items.length > 1) parts.push(`Times: ${items.join('; ')}.`);
      if (d.ageGroup === 'kids') parts.push(d.ages ? `For children ages ${d.ages}.` : 'For children.');
      if (d.ageGroup === 'adults') parts.push('For adults.');
      break;
    }
    case 'festival':
      parts.push(d.focus === 'music' ? `A larger event with live music${d.venueName ? ` at ${d.venueName}` : ''}.` : `A larger dance event${styles ? ` for ${styles}` : ''}.`);
      break;
    default:
      parts.push(`An evening of${styles ? ` ${styles}` : ''} social dancing${d.djs.length ? ` with music by ${joinAnd(d.djs)}` : ''}.`);
  }
  if (d.theme === 'Halloween' && /costume/.test(d.facts)) parts.push('Costumes are welcome.');
  const food = /\b(buffet|dinner)\b/.test(d.facts) ? 'Food is included' : /\b(dessert|bagels|cake|snacks|pizza)\b/.test(d.facts) ? 'Snacks are included' : '';
  const bar = /cash bar/.test(d.facts) ? 'cash bar' : /open bar/.test(d.facts) ? 'open bar' : '';
  if (food && bar) parts.push(`${food}, and there is ${article(bar)} ${bar}.`);
  else if (food) parts.push(`${food}.`);
  else if (bar) parts.push(`There is ${article(bar)} ${bar}.`);
  if (/no[- ]partner (is )?(needed|required)|singles (and|&) couples|singles welcome/.test(d.facts)) parts.push('You do not need a partner.');
  if (/beginner friendly|beginners welcome|newcomer/.test(d.facts) && d.category !== 'class-lesson') parts.push('Beginners are welcome.');
  if (/inclement weather|bad weather|snow/.test(d.facts)) parts.push('In bad weather, call before you go.');
  else if (/call ahead|please call to confirm|to confirm/.test(d.facts)) parts.push('Call ahead to confirm.');
  let out = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (out.length > 320) out = `${out.slice(0, 316).replace(/\s+\S*$/, '')}…`;
  return out;
}
