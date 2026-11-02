/**
 * What an event has (DJ, live band, lesson, free...), worked out once from the listing so the badges on cards,
 * calendar and map, and the "What's there" filters, always agree. Pure functions: no Astro imports.
 */
import type { DancingCue, EventCategory, SkillLevel } from './schemas';

export const FEATURES = ['dj', 'live', 'lesson', 'free', 'beginner', 'daytime', 'outdoor'] as const;
export type Feature = (typeof FEATURES)[number];

/** Label on badges and filter chips, icon (components/Icon.astro) and a plain-language meaning (legends, tooltips). */
export const FEATURE_INFO: Record<Feature, { label: string; chip: string; icon: 'music' | 'star' | 'people' | 'ticket' | 'shoe' | 'sun' | 'pin'; help: string }> = {
  dj: { label: 'DJ', chip: 'DJ', icon: 'music', help: 'A DJ plays recorded music.' },
  live: { label: 'Live band', chip: 'Live band', icon: 'star', help: 'A band or singer plays live.' },
  lesson: { label: 'Lesson', chip: 'Lesson', icon: 'people', help: 'Includes a lesson or class.' },
  free: { label: 'Free', chip: 'Free', icon: 'ticket', help: 'Free to get in.' },
  beginner: { label: 'Beginners welcome', chip: 'Beginners welcome', icon: 'shoe', help: 'Good for new dancers.' },
  daytime: { label: 'Daytime', chip: 'Daytime', icon: 'sun', help: 'Starts before 5 PM.' },
  outdoor: { label: 'Outdoors', chip: 'Outdoors', icon: 'pin', help: 'Outside, for example in a park or on a beach.' },
};

/** The facts about one occurrence that the features are worked out from (a ResolvedEvent has all of them). */
export interface FeatureInput {
  title: string;
  category: EventCategory;
  timeTba: boolean;
  startLocal: string;
  djs: { kind: string }[];
  liveActs: { kind: string }[];
  price: { free: boolean };
  venue?: { data: { kind?: string | undefined } } | undefined;
  data: { summary: string; lessonTime?: string | undefined; skillLevel: SkillLevel; dancingCues: DancingCue[] };
}

const BEGINNER_RE = /\bbeginners?\b|\bno (?:dance )?experience\b|\bno partner (?:is )?(?:needed|necessary|required)\b|\bfirst[- ]timers?\b/i;
const OUTDOOR_RE = /\boutdoors?\b|\bunder the stars\b|\bon the (?:lawn|beach|boardwalk)\b|\bbandshell\b|\bband shell\b/i;
const OUTDOOR_VENUES = new Set(['park', 'beach']);

/** Everything this occurrence has, in a fixed order. */
export function eventFeatures(e: FeatureInput): Feature[] {
  const text = `${e.title} ${e.data.summary}`;
  const out: Feature[] = [];
  if (e.djs.length > 0 || e.data.dancingCues.includes('dj')) out.push('dj');
  if (e.liveActs.length > 0 || e.category === 'live-music') out.push('live');
  if (e.category === 'class-lesson' || e.category === 'lesson-party' || e.data.lessonTime) out.push('lesson');
  if (e.price.free) out.push('free');
  if (e.data.skillLevel === 'beginner' || BEGINNER_RE.test(text)) out.push('beginner');
  if (!e.timeTba && Number(e.startLocal.slice(11, 13)) < 17) out.push('daytime');
  if (e.data.dancingCues.includes('outdoor') || OUTDOOR_VENUES.has(e.venue?.data.kind ?? '') || OUTDOOR_RE.test(text)) out.push('outdoor');
  return out;
}

/**
 * Badges to show next to the category badge: features that add something the category does not already say
 * ("Lesson" on a class would repeat it). On a live-music listing "Live band" / "Live singer" only shows when an act
 * is listed (it then tells a band from a solo singer). A listing whose only act is a singer says "Live singer".
 */
export function featureBadges(e: FeatureInput, features = eventFeatures(e)): { id: Feature; label: string }[] {
  return features
    .filter((f) => !(f === 'live' && e.category === 'live-music' && e.liveActs.length === 0) && !(f === 'lesson' && (e.category === 'class-lesson' || e.category === 'lesson-party')))
    .map((f) => ({ id: f, label: f === 'live' && e.liveActs.length > 0 && e.liveActs.every((p) => p.kind === 'solo') ? 'Live singer' : FEATURE_INFO[f].label }));
}

/** The few features worth a tiny icon in a crowded month-calendar square. */
export const CALENDAR_FEATURES: Feature[] = ['dj', 'live', 'lesson', 'free'];
