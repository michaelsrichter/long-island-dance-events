import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX,
  clipWords,
  eventDescription,
  eventLabels,
  eventShareBlurb,
  eventShortText,
  fitSentences,
  listNames,
  performerDescription,
  styleDescription,
  upcomingSummary,
  venueDescription,
  type MetaEvent,
} from '../../src/lib/page-meta';

const music: MetaEvent = {
  title: 'Live music at Riverhead Ciderhouse',
  url: '/events/2026-10-05-riverhead-ciderhouse-calverton-live-music/',
  date: '2026-10-05',
  status: 'active',
  timeTba: false,
  startLocal: '2026-10-05T12:00',
  endLocal: '2026-10-05T20:00',
  category: 'live-music',
  location: { name: 'Riverhead Ciderhouse', town: 'Calverton' },
  liveActs: [{ name: 'Spotlight Band' }],
  djs: [],
  instructors: [],
  styles: [],
  price: { known: true, free: true, label: 'Free' },
  organizer: { data: { name: 'Riverhead Ciderhouse' } },
  dancing: { level: 'some', outOf10: 5, label: 'Some party dancing' },
  data: { end: '2026-10-05T20:00' },
};

const swing: MetaEvent = {
  ...music,
  title: 'East Coast Swing lesson and social dance',
  url: '/events/2026-10-06-swing/',
  date: '2026-10-06',
  startLocal: '2026-10-06T19:30',
  endLocal: '2026-10-06T22:00',
  category: 'lesson-party',
  location: { name: 'Huntington Moose Lodge', town: 'Greenlawn' },
  liveActs: [],
  djs: [{ name: 'Carol' }],
  styles: [{ name: 'East Coast Swing' }, { name: 'Lindy Hop' }],
  price: { known: true, free: false, label: '$15' },
  lessonLabel: '7:30 PM',
  organizer: { data: { name: 'Swing Dance Long Island' } },
  dancing: { level: 'dance-event', outOf10: 10, label: 'Partner dancing' },
  data: { end: '2026-10-06T22:00' },
};

describe('event descriptions', () => {
  it('states the facts: day, time, place, who, price and the dancing score', () => {
    const d = eventDescription(music);
    expect(d).toBe('Mon, Oct 5, 12 PM to 8 PM at Riverhead Ciderhouse, Calverton. Live music by Spotlight Band. Free. Dancing score 5 of 10: some party dancing.');
    expect(d).not.toMatch(/Run by Riverhead Ciderhouse/);
  });
  it('describes lesson + dance parties with styles, lesson time, price and organizer', () => {
    const d = eventDescription(swing);
    expect(d).toContain('Tue, Oct 6, 7:30 PM to 10 PM at Huntington Moose Lodge, Greenlawn.');
    expect(d).toContain('East Coast Swing and Lindy Hop lesson at 7:30 PM, then a dance party with DJ Carol.');
    expect(d).toContain('$15.');
    expect(d).toContain('Run by Swing Dance Long Island.');
    expect(d).not.toContain('Dancing score');
  });
  it('never goes over the length limit and keeps the most important facts', () => {
    const long = { ...music, liveActs: [{ name: 'A'.repeat(60) }, { name: 'B'.repeat(60) }, { name: 'C'.repeat(60) }] };
    const d = eventDescription(long);
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d.startsWith('Mon, Oct 5')).toBe(true);
  });
  it('marks cancellations first', () => {
    expect(eventDescription({ ...music, status: 'cancelled' })).toMatch(/^CANCELLED: Mon, Oct 5/);
  });
  it('gives When and Where labels for link previews', () => {
    expect(eventLabels(music)).toEqual([
      { label: 'When', data: 'Mon, Oct 5 · 12 PM to 8 PM' },
      { label: 'Where', data: 'Riverhead Ciderhouse, Calverton' },
    ]);
  });
});

describe('share text', () => {
  it('has the title, day and time, place, who, dancing, price and link on separate lines', () => {
    const t = eventShareBlurb(music, 'https://example.org/e/');
    expect(t.split('\n')).toEqual([
      'Live music at Riverhead Ciderhouse',
      '📅 Monday, October 5 · 12 PM to 8 PM',
      '📍 Riverhead Ciderhouse, Calverton',
      '🎵 Live music: Spotlight Band',
      '💃 Dancing score 5 of 10: some party dancing',
      '🎟️ Free',
      'https://example.org/e/',
    ]);
  });
  it('lists styles and the lesson for dances', () => {
    expect(eventShareBlurb(swing, 'https://example.org/s/')).toContain('💃 East Coast Swing and Lindy Hop · lesson at 7:30 PM');
  });
  it('writes one short line without repeating the venue', () => {
    expect(eventShortText(music)).toBe('Live music at Riverhead Ciderhouse in Calverton, Mon, Oct 5, 12 PM to 8 PM');
    expect(eventShortText({ ...swing, data: { end: undefined } })).toBe('East Coast Swing lesson and social dance at Huntington Moose Lodge, Greenlawn, Tue, Oct 6 at 7:30 PM');
  });
});

describe('directory descriptions', () => {
  const events = [
    { title: 'Rock Night', date: '2026-10-10', category: 'live-music' as const, location: { name: 'The Paramount', town: 'Huntington' } },
    { title: 'Swing class', date: '2026-10-12', category: 'class-lesson' as const, location: { name: 'The Paramount', town: 'Huntington' } },
    { title: 'Blues Night', date: '2026-10-17', category: 'live-music' as const, location: { name: 'The Paramount', town: 'Huntington' } },
  ];
  it('summarizes what is coming up', () => {
    expect(upcomingSummary(events)).toBe('3 events coming up: live music nights and classes');
    expect(upcomingSummary([])).toBe('Nothing is listed right now');
  });
  it('describes a venue with its next event', () => {
    const d = venueDescription({ name: 'The Paramount', town: 'Huntington', floorNote: 'Has a dance floor' }, events);
    expect(d).toBe('The Paramount in Huntington, NY. 3 events coming up: live music nights and classes. Next: Sat, Oct 10, Rock Night. Has a dance floor. Address, parking and directions.');
  });
  it('describes a band', () => {
    const d = performerDescription({ name: 'Spotlight', typeLabel: 'Band', genres: ['Rock', 'Motown'], town: 'Babylon' }, events.slice(0, 1));
    expect(d).toBe('Spotlight: a band playing Rock and Motown from Babylon. 1 upcoming Long Island date. Next: Sat, Oct 10, Rock Night at The Paramount, Huntington.');
  });
  it('describes a dance style', () => {
    expect(styleDescription({ name: 'Swing', summary: 'A bouncy partner dance.' }, events)).toContain('2 dances and 1 class coming up in Nassau and Suffolk.');
  });
});

describe('text helpers', () => {
  it('lists names in plain English', () => {
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B'])).toBe('A and B');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(listNames(['A', 'B', 'C', 'D'])).toBe('A, B, C and more');
  });
  it('drops less important sentences instead of cutting words', () => {
    expect(fitSentences(['First one', 'Second one is long', 'Third'], 22)).toBe('First one. Third.');
    expect(clipWords('one two three four five', 14)).toBe('one two three…');
  });
});
