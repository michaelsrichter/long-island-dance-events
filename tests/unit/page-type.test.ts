import { describe, expect, it } from 'vitest';
import { pageTypeOf } from '../../src/lib/page-type';

describe('page types for "where did they come from on this site"', () => {
  it('names list, calendar, map and detail pages', () => {
    expect(pageTypeOf('/')).toBe('home');
    expect(pageTypeOf('/events/')).toBe('events');
    expect(pageTypeOf('/events/calendar/2026-11/')).toBe('calendar');
    expect(pageTypeOf('/events/map/')).toBe('map');
    expect(pageTypeOf('/events/2026-10-06-swing/')).toBe('event');
    expect(pageTypeOf('/venues/')).toBe('venues');
    expect(pageTypeOf('/venues/the-paramount/')).toBe('venue');
    expect(pageTypeOf('/performers/dj-ray/')).toBe('person');
    expect(pageTypeOf('/towns/huntington/')).toBe('town');
    expect(pageTypeOf('/faq/')).toBe('faq');
  });
});
