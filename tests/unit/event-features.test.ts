import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventFeatures, featureBadges, FEATURE_INFO, FEATURES, type FeatureInput } from '../../src/lib/event-features';
import { calMoreLabel, filterParams, matchesEvent, ranges } from '../../src/scripts/event-match';
import { filterDataset, shownByDefault } from '../../src/lib/event-filter-data';
import type { ResolvedEvent } from '../../src/lib/content';

const base: FeatureInput = {
  title: 'Swing dance at Example Hall',
  category: 'social-dance',
  timeTba: false,
  startLocal: '2026-10-09T20:00',
  djs: [],
  liveActs: [],
  price: { free: false },
  venue: { data: { kind: 'lodge-hall' } },
  data: { summary: 'A social dance with a mix of swing music.', skillLevel: 'all-levels', dancingCues: [] },
};
const ev = (over: Omit<Partial<FeatureInput>, 'data'> & { data?: Partial<FeatureInput['data']> } = {}): FeatureInput => ({ ...base, ...over, data: { ...base.data, ...(over.data ?? {}) } });

describe('event features (badges and "What\'s there" filters)', () => {
  it('finds DJs, live acts, lessons and free entry', () => {
    expect(eventFeatures(ev({ djs: [{ kind: 'dj' }], data: { lessonTime: '19:30' } }))).toEqual(['dj', 'lesson']);
    expect(eventFeatures(ev({ data: { dancingCues: ['dj'] } }))).toContain('dj');
    expect(eventFeatures(ev({ category: 'live-music' }))).toContain('live');
    expect(eventFeatures(ev({ liveActs: [{ kind: 'band' }] }))).toContain('live');
    expect(eventFeatures(ev({ category: 'class-lesson' }))).toContain('lesson');
    expect(eventFeatures(ev({ category: 'lesson-party' }))).toContain('lesson');
    expect(eventFeatures(ev({ price: { free: true } }))).toContain('free');
    expect(eventFeatures(ev())).toEqual([]);
  });
  it('spots beginner-friendly, daytime and outdoor events', () => {
    expect(eventFeatures(ev({ data: { skillLevel: 'beginner' } }))).toContain('beginner');
    expect(eventFeatures(ev({ data: { summary: 'No partner needed and no experience required.' } }))).toContain('beginner');
    expect(eventFeatures(ev({ data: { summary: 'Good for beginners and pros.' } }))).toContain('beginner');
    expect(eventFeatures(ev({ startLocal: '2026-10-11T14:00' }))).toContain('daytime');
    expect(eventFeatures(ev({ startLocal: '2026-10-11T17:00' }))).not.toContain('daytime');
    expect(eventFeatures(ev({ timeTba: true, startLocal: '2026-10-11' }))).not.toContain('daytime');
    expect(eventFeatures(ev({ venue: { data: { kind: 'park' } } }))).toContain('outdoor');
    expect(eventFeatures(ev({ data: { dancingCues: ['outdoor'] } }))).toContain('outdoor');
    expect(eventFeatures(ev({ data: { summary: 'Dancing under the stars at the bandshell.' } }))).toContain('outdoor');
    expect(eventFeatures(ev({ title: 'Outside the box: a tribute show' }))).not.toContain('outdoor');
  });
  it('badges never repeat what the category badge already says', () => {
    expect(featureBadges(ev({ category: 'live-music', liveActs: [{ kind: 'band' }], djs: [{ kind: 'dj' }] })).map((b) => b.label)).toEqual(['DJ', 'Live band']);
    expect(featureBadges(ev({ category: 'live-music', liveActs: [{ kind: 'solo' }] })).map((b) => b.label)).toEqual(['Live singer']);
    expect(featureBadges(ev({ category: 'live-music' })).map((b) => b.id)).toEqual([]);
    expect(featureBadges(ev({ category: 'class-lesson', price: { free: true } })).map((b) => b.id)).toEqual(['free']);
    expect(featureBadges(ev({ category: 'lesson-party' })).map((b) => b.id)).toEqual([]);
    expect(featureBadges(ev({ liveActs: [{ kind: 'band' }], data: { lessonTime: '19:00' } })).map((b) => b.label)).toEqual(['Live band', 'Lesson']);
    expect(featureBadges(ev({ category: 'festival', liveActs: [{ kind: 'solo' }] }))[0]?.label).toBe('Live singer');
  });
  it('every feature has a short label, a chip label, an icon and a plain-language meaning', () => {
    for (const f of FEATURES) {
      const info = FEATURE_INFO[f];
      expect(info.label.length, f).toBeLessThanOrEqual(18);
      expect(info.chip.length, f).toBeGreaterThan(1);
      expect(info.icon, f).toBeTruthy();
      expect(info.help, f).toMatch(/\.$/);
    }
  });
});

describe('shared list / calendar / map filters', () => {
  const r = ranges(new Date('2026-10-07T12:00:00-04:00')); // a Wednesday
  const item = (over: Record<string, string> = {}) => ({ date: '2026-10-09', category: 'social-dance', dancing: 'dance-event', features: 'dj free', styles: 'east-coast-swing', county: 'Suffolk', town: 'Patchogue', weekday: 'friday', price: 'free', level: 'all-levels', venue: 'example-hall', people: 'dj-ray', danceKinds: 'partner', ...over }) as unknown as DOMStringMap;
  it('"What\'s there" needs every chosen feature', () => {
    expect(matchesEvent(item(), '', { has: 'dj' }, r)).toBe(true);
    expect(matchesEvent(item(), '', { has: 'dj,free' }, r)).toBe(true);
    expect(matchesEvent(item(), '', { has: 'dj,live' }, r)).toBe(false);
    expect(matchesEvent(item({ features: '' }), '', { has: 'free' }, r)).toBe(false);
  });
  it('shows dances and live music by default, and classes only when asked', () => {
    expect(matchesEvent(item({ category: 'class-lesson' }), '', {}, r)).toBe(false);
    expect(matchesEvent(item({ category: 'class-lesson' }), '', { category: 'class-lesson' }, r)).toBe(true);
    expect(matchesEvent(item({ category: 'live-music', dancing: 'unlikely' }), '', {}, r)).toBe(false);
    expect(matchesEvent(item({ category: 'live-music', dancing: 'unlikely' }), '', { category: 'all' }, r)).toBe(true);
  });
  it('handles dates, places and search', () => {
    expect(matchesEvent(item(), '', { when: 'weekend' }, r)).toBe(true);
    expect(matchesEvent(item(), '', { when: 'today' }, r)).toBe(false);
    expect(matchesEvent(item(), '', { county: 'Nassau' }, r)).toBe(false);
    expect(matchesEvent(item(), 'Swing night at Example Hall', { q: 'example hall' }, r)).toBe(true);
    expect(matchesEvent(item(), '', { style: 'salsa' }, r)).toBe(false);
  });
  it('keeps defaults and empty choices out of the address bar', () => {
    expect(filterParams({ when: 'all', category: 'dances', has: '', style: '' }).toString()).toBe('');
    expect(filterParams({ category: 'all', has: 'dj,free', town: 'Patchogue' }).toString()).toBe('category=all&has=dj%2Cfree&town=Patchogue');
  });
});

describe('feature icons (CSS masks)', () => {
  const css = readFileSync('src/styles/global.css', 'utf8');
  const icons = readFileSync('src/components/Icon.astro', 'utf8');
  it.each([...new Set(FEATURES.map((f) => FEATURE_INFO[f].icon))])('.fi--%s draws the same shape as Icon.astro', (name) => {
    const rule = css.match(new RegExp('\\.fi--' + name + ' \\{ --fi: url\\("data:image/svg\\+xml,([^"]+)"\\)'));
    expect(rule, `missing .fi--${name} in global.css`).toBeTruthy();
    const svg = decodeURIComponent(rule?.[1] ?? '');
    const paths = icons.match(new RegExp('\\n\\s*' + name + ": '([^']+)'"))?.[1]?.replace(/"/g, "'");
    expect(paths, `no ${name} icon in Icon.astro`).toBeTruthy();
    expect(svg).toContain(paths);
    expect(svg).toContain("stroke-width='1.8'");
  });
});

describe('calendar default state (rendered by the server, kept by the script)', () => {
  const resolved = (over: Record<string, unknown> = {}) =>
    ({
      ...ev(), date: '2026-10-09', end: new Date('2026-10-10T02:00:00Z'), status: 'scheduled', styles: [], performers: [], instructors: [],
      location: { town: 'Huntington', county: 'Suffolk' }, weekday: 'friday', price: { free: false, known: true }, organizer: null,
      dancing: { level: 'likely', kinds: ['partner'] }, ...over,
    }) as unknown as ResolvedEvent;
  it('hides classes and listening-only concerts by default, like the browser', () => {
    expect(shownByDefault(resolved())).toBe(true);
    expect(shownByDefault(resolved({ category: 'live-music' }))).toBe(true);
    expect(shownByDefault(resolved({ category: 'class-lesson' }))).toBe(false);
    expect(shownByDefault(resolved({ category: 'live-music', dancing: { level: 'unlikely', kinds: [] } }))).toBe(false);
  });
  it('gives the script the same names element.dataset uses', () => {
    expect(filterDataset(resolved())).toMatchObject({ date: '2026-10-09', category: 'social-dance', danceKinds: 'partner', startMin: '20:00', dancing: 'likely' });
  });
  it('labels "+N more" in words', () => {
    expect(calMoreLabel('2026-10-09', 1, false)).toBe('Show 1 more event on Friday, October 9');
    expect(calMoreLabel('2026-10-09', 4, false)).toBe('Show 4 more events on Friday, October 9');
    expect(calMoreLabel('2026-10-09', 4, true)).toBe('Show fewer events on Friday, October 9');
  });
});
