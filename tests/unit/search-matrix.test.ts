/**
 * The town-by-town search (catalog/search-matrix.json) must cover every Long Island place in
 * src/data/long-island-places.json, and the committed matrix must match its generator.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const places = JSON.parse(readFileSync('src/data/long-island-places.json', 'utf8')) as { places: { name: string; county: string }[]; aliases: Record<string, string> };
const config = JSON.parse(readFileSync('catalog/search-places.json', 'utf8')) as { groups: Record<string, string[]>; small: string[] };
const matrix = JSON.parse(readFileSync('catalog/search-matrix.json', 'utf8')) as { places: Record<string, { members: string[] }>; groups: Record<string, string[]> };

describe('Long Island places', () => {
  it('lists each place once, in Nassau or Suffolk, and every alias points to a real place', () => {
    const names = places.places.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of places.places) expect(['Nassau', 'Suffolk']).toContain(p.county);
    for (const target of Object.values(places.aliases)) expect(names).toContain(target);
  });
});

describe('town-by-town search matrix', () => {
  it('searches every place, on its own or with its group', () => {
    const covered = new Set(Object.entries(matrix.places).flatMap(([name, p]) => [name, ...p.members]));
    for (const p of places.places) expect(covered.has(p.name), p.name).toBe(true);
  });
  it('gives every search place at least the core terms, in "<place> NY <term>" form', () => {
    for (const [place, queries] of Object.entries(matrix.groups)) {
      expect(queries.length, place).toBeGreaterThanOrEqual(8);
      for (const q of queries) expect(q.startsWith(`${place} NY `), q).toBe(true);
    }
  });
  it('is up to date with catalog/search-places.json', () => {
    expect(() => execFileSync('node', ['catalog/scripts/build-search-matrix.mjs', '--check'], { stdio: 'pipe' })).not.toThrow();
  });
  it('keeps small places and group members apart', () => {
    const members = new Set(Object.values(config.groups).flat());
    for (const s of config.small) expect(members.has(s), s).toBe(false);
  });
});
