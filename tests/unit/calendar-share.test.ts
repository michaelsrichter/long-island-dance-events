import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl, icsEscape, icsFold, outlookCalendarUrl, type CalendarEvent } from '../../src/lib/calendar';
import { blurbWithoutUrl, shareLinks } from '../../src/lib/share';

const base: CalendarEvent = {
  uid: '2026-10-06-thursday-night-swing@example.org',
  title: 'Thursday Night Swing',
  description: 'Lesson: 7:30 PM\nOpen dancing: 8:00 PM to 10:00 PM; beginners, welcome',
  location: 'Riverbend Community Hall, 631 Pulaski Road, Riverbend, NY 11740',
  url: 'https://example.org/events/2026-10-06-thursday-night-swing/',
  start: new Date('2026-10-06T23:30:00Z'),
  end: new Date('2026-10-07T02:00:00Z'),
  timezone: 'America/New_York',
  status: 'CONFIRMED',
  latitude: 40.8676878,
  longitude: -73.3536959,
};

describe('.ics calendar files', () => {
  const ics = buildIcs([base], { name: 'Riverbend', now: new Date('2026-10-01T00:00:00Z') });
  it('uses CRLF line endings and the required envelope', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
  it('writes UTC start and end times', () => {
    expect(ics).toContain('DTSTART:20261006T233000Z');
    expect(ics).toContain('DTEND:20261007T020000Z');
    expect(ics).toContain('DTSTAMP:20261001T000000Z');
  });
  it('escapes commas, semicolons and newlines', () => {
    expect(icsEscape('a,b;c\nd\\e')).toBe('a\\,b\\;c\\nd\\\\e');
    expect(ics).toContain('LOCATION:Riverbend Community Hall\\, 631 Pulaski Road\\, Riverbend\\, NY 11740');
  });
  it('folds long lines at 75 octets', () => {
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(icsFold('x'.repeat(160)).split('\r\n ').map((l) => l.length)).toEqual([75, 74, 11]);
  });
  it('marks cancelled events', () => {
    const c = buildIcs([{ ...base, status: 'CANCELLED' }], { name: 'Riverbend' });
    expect(c).toContain('STATUS:CANCELLED');
    expect(c).toContain('SUMMARY:CANCELLED: Thursday Night Swing');
  });
  it('writes all-day dates when the time is to be announced', () => {
    const c = buildIcs([{ ...base, allDayDate: '2026-12-31' }], { name: 'Riverbend' });
    expect(c).toContain('DTSTART;VALUE=DATE:20261231');
    expect(c).toContain('DTEND;VALUE=DATE:20270101');
  });
});

describe('calendar links', () => {
  it('builds a Google Calendar link with UTC dates and the New York timezone', () => {
    const u = new URL(googleCalendarUrl(base));
    expect(u.hostname).toBe('calendar.google.com');
    expect(u.searchParams.get('dates')).toBe('20261006T233000Z/20261007T020000Z');
    expect(u.searchParams.get('ctz')).toBe('America/New_York');
    expect(u.searchParams.get('details')).toContain(base.url);
  });
  it('builds Outlook links for personal and work accounts', () => {
    const p = new URL(outlookCalendarUrl(base, 'personal'));
    const w = new URL(outlookCalendarUrl(base, 'work'));
    expect(p.hostname).toBe('outlook.live.com');
    expect(w.hostname).toBe('outlook.office.com');
    expect(p.searchParams.get('startdt')).toBe('2026-10-06T23:30:00.000Z');
    expect(p.searchParams.get('subject')).toBe('Thursday Night Swing');
  });
});

describe('share links', () => {
  const input = {
    title: 'Thursday Night Swing',
    url: 'https://example.org/events/2026-10-06-thursday-night-swing/',
    blurb: 'Thursday Night Swing\n📅 Tuesday, October 6 · 7:30 PM\n📍 Riverbend Community Hall, Riverbend\nhttps://example.org/events/2026-10-06-thursday-night-swing/',
    short: 'Thursday Night Swing at Riverbend Community Hall, Riverbend, Tue, Oct 6 at 7:30 PM',
  };
  it('prefills WhatsApp, X, email and text messages with the full text and link', () => {
    const l = shareLinks(input);
    expect(l.facebook).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(input.url)}`);
    expect(decodeURIComponent(l.whatsapp.split('text=')[1]!)).toBe(input.blurb);
    expect(new URL(l.x).searchParams.get('text')).toBe(input.short);
    expect(new URL(l.x).searchParams.get('url')).toBe(input.url);
    expect(l.email).toMatch(/^mailto:\?subject=Thursday%20Night%20Swing&body=/);
    expect(decodeURIComponent(l.email)).toContain('📍 Riverbend Community Hall');
    expect(decodeURIComponent(l.sms)).toContain(input.url);
  });
  it('adds the link when the text does not end with it', () => {
    const l = shareLinks({ ...input, blurb: 'Swing tonight' });
    expect(decodeURIComponent(l.whatsapp)).toContain(`Swing tonight\n${input.url}`);
  });
  it('leaves the link out of the phone share text (the share menu adds it)', () => {
    expect(blurbWithoutUrl(input.blurb, input.url)).not.toContain('https://');
    expect(blurbWithoutUrl('no link here', input.url)).toBe('no link here');
  });
});