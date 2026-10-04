import { describe, expect, it } from 'vitest';
import { focusBox } from '../../src/lib/focus-image-service.mjs';
import { groupByPlace } from '../../src/lib/map-places';
import { CENSUS_SOURCE, distanceKm, oneLineAddress, parseCensus, parseNominatim } from '../../scripts/geocode-venues.mjs';
import { FOCUS_RE } from '../../src/lib/schemas';

describe('focus-point crops', () => {
  it('keeps the focus point in the middle when there is room', () => {
    // A 1920x500 banner cropped to 2:1 keeps the full height and centers 30% across.
    expect(focusBox(1920, 500, 2, 0.3, 0.5)).toEqual({ left: 76, top: 0, width: 1000, height: 500 });
  });
  it('never crops outside the photo', () => {
    expect(focusBox(1000, 1000, 1, 0.95, 0.05)).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
    expect(focusBox(1200, 1600, 1, 0.5, 1)).toEqual({ left: 0, top: 400, width: 1200, height: 1200 });
  });
  it('accepts only "x% y%" focus values', () => {
    expect(FOCUS_RE.test('50% 30%')).toBe(true);
    expect(FOCUS_RE.test('center')).toBe(false);
    expect(FOCUS_RE.test('50%,30%')).toBe(false);
  });
});

describe('events map grouping', () => {
  const ev = (slug: string, date: string, venueId?: string, lat?: number) => ({
    slug,
    start: new Date(`${date}T19:30:00-04:00`),
    venueId,
    location: { name: venueId ?? 'Somewhere', latitude: lat, longitude: lat === undefined ? undefined : -73.3 },
  });
  const { places, unplaced } = groupByPlace([
    ev('c1', '2026-10-03', 'grange', 40.77),
    ev('s2', '2026-10-13', 'hall', 40.87),
    ev('s1', '2026-10-06', 'hall', 40.87),
    ev('c2', '2026-10-02', 'mirelles', 40.75),
    ev('x', '2026-10-09'),
  ]);
  it('makes one place per venue, with its events in date order', () => {
    expect(places[2]!.events.map((e) => e.slug)).toEqual(['s1', 's2']);
  });
  it('orders places by their next event', () => {
    expect(places.map((p) => p.id)).toEqual(['mirelles', 'grange', 'hall']);
  });
  it('lists events without coordinates separately', () => {
    expect(unplaced.map((e) => e.slug)).toEqual(['x']);
  });
});
describe('venue geocoding', () => {
  it('drops suite numbers from addresses', () => {
    expect(oneLineAddress({ address: '290 Broadhollow Road, Suite LL150E', town: 'Melville', postalCode: '11747' })).toBe('290 Broadhollow Road, Melville, NY 11747');
    // A word that merely contains "ste" is not a suite number.
    expect(oneLineAddress({ address: '18 Hempstead Tpke', town: 'Farmingdale' })).toBe('18 Hempstead Tpke, Farmingdale, NY');
  });
  it('reads Census and OpenStreetMap answers', () => {
    expect(parseCensus({ result: { addressMatches: [{ coordinates: { x: -73.33, y: 40.77 }, matchedAddress: '2075 DEER PARK AVE' }] } })).toEqual({
      lat: 40.77,
      lng: -73.33,
      matched: '2075 DEER PARK AVE',
      source: CENSUS_SOURCE,
    });
    expect(parseCensus({ result: { addressMatches: [] } })).toBeUndefined();
    expect(parseNominatim([{ lat: '40.78', lon: '-73.41', display_name: '290 Broadhollow Road' }])?.lat).toBe(40.78);
    expect(parseNominatim([])).toBeUndefined();
  });
  it('measures distance, so far-away mismatches can be rejected', () => {
    expect(Math.round(distanceKm({ lat: 40.8677, lng: -73.3537 }, { lat: 40.7713, lng: -73.3331 }))).toBe(11);
  });
  it('every current venue has coordinates for the map', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '..', '..', 'src', 'content', 'venues');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const v = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      // A venue the collector just added may wait for an editor when no geocoder knows its address
      // (the collection run lists it under "Could not place on the map"). Researched venues may not.
      if (v.latitude === undefined && /^Added automatically/.test(v.reviewNotes ?? '')) continue;
      expect(v.latitude, f).toBeGreaterThan(40.5);
      expect(v.latitude, f).toBeLessThan(41.2);
      expect(v.longitude, f).toBeGreaterThan(-74.1);
      expect(v.longitude, f).toBeLessThan(-71.8);
    }
  });
});

