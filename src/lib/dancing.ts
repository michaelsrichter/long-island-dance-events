/**
 * "Can you dance here?" — a score from 0 to 1 and the kinds of dancing for each event, with reasons a
 * visitor can read. It combines what the listing says, what research found about the venue (dance
 * floor, room to dance, seated theater) and about the band or DJ (dance band, party band, listening act).
 *
 * The score is a guide, not a promise. Editors can override it per event (event.dancing).
 */
import { DANCE_TYPES, type DanceType, type DancingCue, type EventCategory } from './schemas';

export type DancingLevel = 'dance-event' | 'likely' | 'some' | 'unlikely';

export interface DancingEvidence {
  url: string;
  note: string;
}

export interface DancingInput {
  category: EventCategory;
  /** dance = listed in a dance calendar; music = listed in a live-music list. */
  sourceFocus: 'dance' | 'music';
  sourceName?: string | undefined;
  /** Dance styles of the event, with each style's kind of dancing. */
  styles: { id: string; name: string; danceType: DanceType }[];
  cues: DancingCue[];
  venue?: {
    name: string;
    kind?: string | undefined;
    dancing?: {
      floor: 'dance-floor' | 'open-space' | 'small' | 'seated' | 'unknown';
      policy: 'encouraged' | 'allowed' | 'discouraged' | 'unknown';
      kinds: DanceType[];
      notes?: string | undefined;
      evidence: DancingEvidence[];
      confidence: 'high' | 'medium' | 'low';
    } | undefined;
  } | undefined;
  performers: {
    name: string;
    type: 'band' | 'dj' | 'solo';
    dancing?: {
      rating: 'dance-band' | 'party' | 'mixed' | 'listening' | 'unknown';
      kinds: DanceType[];
      notes?: string | undefined;
      evidence: DancingEvidence[];
      confidence: 'high' | 'medium' | 'low';
    } | undefined;
  }[];
  override?: { likelihood: number; kinds: DanceType[]; notes?: string | undefined } | undefined;
}

export interface DancingAssessment {
  /** 0 to 1: how likely it is that people dance at this event. */
  score: number;
  /** Score out of 10, for display ("Dancing score: 8 out of 10"). */
  outOf10: number;
  level: DancingLevel;
  /** Kinds of dancing, most likely first. Empty when dancing is unlikely. */
  kinds: DanceType[];
  /** Short label for cards, e.g. "Partner dancing", "Party dancing likely", "Mostly listening". */
  label: string;
  /** One-line answer for the event page. */
  headline: string;
  /** Plain-language reasons, most important first. */
  reasons: string[];
  evidence: DancingEvidence[];
  basis: 'listing' | 'research' | 'editor';
}

export const LEVEL_LABELS: Record<DancingLevel, string> = {
  'dance-event': 'Dance event',
  likely: 'Dancing likely',
  some: 'Some dancing',
  unlikely: 'Mostly listening',
};

const FLOOR_SCORE = { 'dance-floor': 0.9, 'open-space': 0.7, small: 0.45, seated: 0.1, unknown: 0.5 } as const;
const BAND_SCORE = { 'dance-band': 0.92, party: 0.75, mixed: 0.45, listening: 0.12, unknown: 0.5 } as const;
const KIND_WORD: Record<DanceType, string> = { partner: 'partner dancing', line: 'line dancing', freestyle: 'party dancing' };

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

function levelOf(score: number): DancingLevel {
  if (score >= 0.7) return 'likely';
  if (score >= 0.4) return 'some';
  return 'unlikely';
}

function orderKinds(kinds: Iterable<DanceType>): DanceType[] {
  const set = new Set(kinds);
  return DANCE_TYPES.filter((k) => set.has(k));
}

function labelFor(level: DancingLevel, kinds: DanceType[]): string {
  const k = kinds[0];
  if (level === 'unlikely') return LEVEL_LABELS.unlikely;
  if (level === 'dance-event') return k === 'line' ? 'Line dancing' : k === 'freestyle' ? 'Party dancing' : 'Partner dancing';
  if (!k) return LEVEL_LABELS[level];
  const word = k === 'partner' ? 'Partner dancing' : k === 'line' ? 'Line dancing' : 'Party dancing';
  return level === 'likely' ? `${word} likely` : `Some ${word.toLowerCase()}`;
}

function headlineFor(level: DancingLevel, kinds: DanceType[], category: EventCategory): string {
  const words = kinds.map((k) => KIND_WORD[k]);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? 'dancing';
  if (level === 'dance-event') return category === 'class-lesson' ? `Yes. This is a dance class (${list}).` : `Yes. This is a dance event (${list}).`;
  if (level === 'likely') return `Probably. People usually dance at this kind of show (${list}).`;
  if (level === 'some') return `Maybe. Some people dance, but it is not a dance event${words.length ? ` (${list})` : ''}.`;
  return 'Probably not. This is mostly a show to listen to.';
}

function finish(score: number, level: DancingLevel, kinds: DanceType[], input: DancingInput, reasons: string[], evidence: DancingEvidence[], basis: DancingAssessment['basis']): DancingAssessment {
  const s = round2(clamp(score));
  const k = level === 'unlikely' ? [] : kinds;
  return {
    score: s,
    // Rounded down so the number matches the level: 0-3 mostly listening, 4-6 some, 7-10 likely.
    outOf10: Math.floor(s * 10 + 1e-9),
    level,
    kinds: k,
    label: labelFor(level, k),
    headline: headlineFor(level, k, input.category),
    reasons: [...new Set(reasons.filter(Boolean))],
    evidence: [...new Map(evidence.map((e) => [e.url, e])).values()].slice(0, 6),
    basis,
  };
}

export function assessDancing(input: DancingInput): DancingAssessment {
  const styleKinds = orderKinds(input.styles.map((s) => s.danceType));

  // 1. An editor's answer always wins.
  if (input.override) {
    const o = input.override;
    const kinds = orderKinds(o.kinds.length ? o.kinds : styleKinds);
    return finish(o.likelihood, levelOf(o.likelihood), kinds, input, [o.notes ?? 'An editor checked this event.'], [], 'editor');
  }

  // 2. Classes and anything in a dance calendar are dance events.
  if (input.category === 'class-lesson' || (input.sourceFocus === 'dance' && input.category !== 'live-music')) {
    const kinds = styleKinds.length ? styleKinds : (['partner'] as DanceType[]);
    const why = input.category === 'class-lesson' ? 'It is a dance class.' : `It is listed in ${input.sourceName ?? 'a dance calendar'}, which lists dances for dancers.`;
    return finish(1, 'dance-event', kinds, input, [why], [], 'listing');
  }
  if (input.sourceFocus === 'dance') {
    // Live music in a dance calendar: a band playing for a dance (ballroom orchestra, swing band).
    const kinds = styleKinds.length ? styleKinds : (['partner'] as DanceType[]);
    return finish(0.95, 'dance-event', kinds, input, [`It is a live-music dance listed in ${input.sourceName ?? 'a dance calendar'}.`], [], 'listing');
  }

  // 3. Live music or DJ nights from a music list: weigh the venue and the band.
  const reasons: string[] = [];
  const evidence: DancingEvidence[] = [];
  const kinds = new Set<DanceType>(styleKinds);
  const vd = input.venue?.dancing;
  let venueScore = 0.5;
  let venueKnown = false;
  if (vd && vd.floor !== 'unknown') {
    venueKnown = true;
    venueScore = FLOOR_SCORE[vd.floor];
    if (vd.policy === 'encouraged') venueScore += 0.08;
    if (vd.policy === 'discouraged') venueScore -= 0.25;
    for (const k of vd.kinds) kinds.add(k);
  } else if (vd && vd.kinds.length) {
    venueKnown = true;
    venueScore = 0.6;
    for (const k of vd.kinds) kinds.add(k);
  }
  if (vd?.notes) reasons.push(vd.notes);
  if (vd) evidence.push(...vd.evidence);

  const rated = input.performers.filter((p) => p.dancing && p.dancing.rating !== 'unknown');
  let bandScore = 0.5;
  let bandKnown = false;
  if (rated.length) {
    bandKnown = true;
    bandScore = Math.max(...rated.map((p) => BAND_SCORE[p.dancing!.rating]));
    for (const p of rated) {
      for (const k of p.dancing!.kinds) kinds.add(k);
      if (p.dancing!.notes) reasons.push(p.dancing!.notes);
      evidence.push(...p.dancing!.evidence);
    }
  } else if (input.performers.some((p) => p.type === 'dj') || input.cues.includes('dj')) {
    bandScore = 0.7;
    reasons.push('A DJ is playing, and DJ nights usually have dancing.');
  }

  // Research that is missing on one side counts less.
  const wVenue = venueKnown ? (bandKnown ? 0.5 : 0.75) : bandKnown ? 0.25 : 0.5;
  let score = venueScore * wVenue + bandScore * (1 - wVenue);
  // A seated theater or a listening act caps the score even if the other side looks danceable.
  if (vd?.floor === 'seated') score = Math.min(score, 0.3);
  if (bandKnown && rated.every((p) => p.dancing!.rating === 'listening')) score = Math.min(score, 0.3);

  const cues = new Set(input.cues);
  if (cues.has('dance-party')) {
    score = Math.max(score, 0.85);
    reasons.unshift('It is billed as a dance party.');
  }
  if (cues.has('theater') && !(vd && vd.floor !== 'unknown' && vd.floor !== 'seated')) {
    score = Math.min(score, 0.25);
    reasons.push('It is a concert in a theater with seats.');
  }
  if (cues.has('library')) {
    score = Math.min(score, 0.3);
    reasons.push('It is a concert at a library.');
  }
  if (cues.has('brunch')) score -= 0.15;
  if (cues.has('acoustic')) {
    score -= 0.2;
    reasons.push('It is an acoustic show, which is usually for listening.');
  }
  if (cues.has('jam')) score -= 0.1;
  if (cues.has('festival') && !venueKnown) reasons.push('It is part of an outdoor festival; some people may dance near the stage.');
  if (!venueKnown && !bandKnown && !cues.has('dance-party')) reasons.push('We have not checked this venue or band yet, so this is a rough guess.');

  score = clamp(score);
  const level = levelOf(score);
  if (level !== 'unlikely' && !kinds.size) kinds.add('freestyle');
  return finish(score, level, orderKinds(kinds), input, reasons, evidence, venueKnown || bandKnown ? 'research' : 'listing');
}

/** Show this event in "Dances & live music" lists (classes and listening shows are listed separately). */
export const isDanceLevel = (level: DancingLevel): boolean => level !== 'unlikely';
