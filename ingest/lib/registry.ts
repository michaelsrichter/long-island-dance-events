/**
 * Loads the current entities from src/content and matches listing text against them.
 * Matching is deliberately simple and explainable: aliases (whole words), street addresses,
 * web domains and phone numbers. Anything uncertain lowers the confidence score instead of guessing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  eventSchema,
  instructorSchema,
  organizerSchema,
  performerSchema,
  sourceSchema,
  styleSchema,
  venueSchema,
  type EventData,
  type InstructorData,
  type OrganizerData,
  type PerformerData,
  type SourceData,
  type StyleData,
  type VenueData,
  type County,
} from '../../src/lib/schemas';
import { containsPhrase, digits, domainOf, normalizeText } from './text';
import placesFile from '../../src/data/long-island-places.json' with { type: 'json' };

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const CONTENT_DIR = join(ROOT, 'src', 'content');

type Parser<T> = { parse: (v: unknown) => T };

function loadDir<T>(dir: string, schema: Parser<T>, ext: '.json' | '.yml'): Map<string, T> {
  const out = new Map<string, T>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(ext)).sort()) {
    const raw = readFileSync(join(dir, f), 'utf8');
    const value = ext === '.json' ? JSON.parse(raw) : YAML.parse(raw);
    try {
      out.set(f.slice(0, -ext.length), schema.parse(value));
    } catch (e) {
      throw new Error(`${dir}/${f} is not valid: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Street-address normalization so "2075 Deer Park Avenue" matches "2075 Deer Park Ave.". */
export function normalizeAddress(s: string): string {
  const map: Record<string, string> = {
    avenue: 'ave', road: 'rd', street: 'st', turnpike: 'tpke', tpk: 'tpke', boulevard: 'blvd', expressway: 'expy', exwy: 'expy', expwy: 'expy',
    drive: 'dr', place: 'pl', lane: 'ln', parkway: 'pkwy', highway: 'hwy', court: 'ct', west: 'w', east: 'e', north: 'n', south: 's', first: '1st',
    one: '1', two: '2', three: '3',
  };
  return normalizeText(s)
    .split(' ')
    .map((w) => map[w] ?? w)
    .join(' ');
}

export interface Place {
  name: string;
  county: County;
}

const places = new Map<string, Place>((placesFile.places as Place[]).map((p) => [normalizeText(p.name), p]));
const placeAliases = new Map<string, string>(Object.entries(placesFile.aliases as Record<string, string>).map(([k, v]) => [normalizeText(k), v]));

/** Town header -> Long Island place, or undefined when the town is outside Nassau and Suffolk. */
export function lookupPlace(town: string | undefined): Place | undefined {
  if (!town) return undefined;
  const key = normalizeText(town.replace(/,?\s*(NY|New York)\s*\d{0,5}$/i, ''));
  const alias = placeAliases.get(key);
  return places.get(alias ? normalizeText(alias) : key);
}

interface AliasHit {
  id: string;
  index: number;
  length: number;
}

function aliasHits<T extends { name: string; aliases: string[] }>(text: string, entities: Map<string, T>): AliasHit[] {
  const norm = normalizeText(text);
  const hits: AliasHit[] = [];
  for (const [id, e] of entities) {
    for (const a of [e.name, ...e.aliases]) {
      const p = normalizeText(a);
      if (p.length < 3) continue;
      if (containsPhrase(norm, p)) hits.push({ id, index: norm.indexOf(p), length: p.length });
    }
  }
  return hits;
}

export class Registry {
  readonly created = { venues: new Set<string>(), performers: new Set<string>(), instructors: new Set<string>(), organizers: new Set<string>() };

  constructor(
    readonly venues: Map<string, VenueData>,
    readonly performers: Map<string, PerformerData>,
    readonly instructors: Map<string, InstructorData>,
    readonly organizers: Map<string, OrganizerData>,
    readonly styles: Map<string, StyleData>,
    readonly sources: Map<string, SourceData>,
    readonly events: Map<string, EventData>,
  ) {}

  static load(contentDir = CONTENT_DIR): Registry {
    const d = (n: string) => join(contentDir, n);
    return new Registry(
      loadDir(d('venues'), venueSchema, '.json'),
      loadDir(d('performers'), performerSchema, '.json'),
      loadDir(d('instructors'), instructorSchema, '.json'),
      loadDir(d('organizers'), organizerSchema, '.json'),
      loadDir(d('styles'), styleSchema, '.yml'),
      loadDir(d('sources'), sourceSchema, '.json'),
      loadDir(d('events'), eventSchema, '.json'),
    );
  }

  /** Best venue: a street-address match wins, then the longest name/alias found in the text. */
  matchVenue(text: string, town?: string): string | undefined {
    const addr = normalizeAddress(text);
    const byAddress = [...this.venues].filter(([, v]) => {
      const a = normalizeAddress(v.address);
      return a.length >= 6 && (` ${addr} `).includes(` ${a} `);
    });
    if (byAddress.length === 1) return byAddress[0]![0];
    if (byAddress.length > 1 && town) {
      const same = byAddress.find(([, v]) => normalizeText(v.town) === normalizeText(town));
      if (same) return same[0];
    }
    const hits = aliasHits(text, this.venues).sort((a, b) => b.length - a.length || a.index - b.index);
    if (!hits.length) return byAddress[0]?.[0];
    // Prefer a venue in the same town when two venues share a name ("Moose Lodge").
    const sameTown = town ? hits.find((h) => normalizeText(this.venues.get(h.id)!.town) === normalizeText(town)) : undefined;
    return (sameTown ?? hits[0]!).id;
  }

  /** Organizer named first in the listing; falls back to its web address or phone number. */
  matchOrganizer(text: string): string | undefined {
    const live = new Map([...this.organizers].filter(([, o]) => !o.optOut));
    const hits = aliasHits(text, live).sort((a, b) => a.index - b.index || b.length - a.length);
    if (hits.length) return hits[0]!.id;
    const domains = new Set([...text.matchAll(/(?:www\.)?([a-z0-9-]+\.(?:com|org|net|us|edu))/gi)].map((m) => m[1]!.toLowerCase()));
    for (const [id, o] of live) if (o.website && domains.has(domainOf(o.website))) return id;
    const phones = new Set([...text.matchAll(/\d[\d\s().-]{8,16}\d/g)].map((m) => digits(m[0]).slice(-10)));
    for (const [id, o] of live) if (o.phone && phones.has(digits(o.phone).slice(-10))) return id;
    return undefined;
  }

  isOptedOut(text: string): string | undefined {
    const out = new Map([...this.organizers].filter(([, o]) => o.optOut));
    return aliasHits(text, out)[0]?.id;
  }

  matchPerformers(text: string): string[] {
    return unique(aliasHits(text, this.performers).sort((a, b) => a.index - b.index).map((h) => h.id));
  }

  matchInstructors(text: string): string[] {
    return unique(aliasHits(text, this.instructors).sort((a, b) => a.index - b.index).map((h) => h.id));
  }

  /** Dance styles named in the text. Longer aliases win ("West Coast Swing" is not also "Swing"). */
  matchStyles(text: string): string[] {
    let norm = ` ${normalizeText(text)} `;
    const aliases: { id: string; p: string }[] = [];
    for (const [id, s] of this.styles) for (const a of [s.name, ...s.aliases]) aliases.push({ id, p: normalizeText(a) });
    aliases.sort((a, b) => b.p.length - a.p.length);
    const found: { id: string; index: number }[] = [];
    for (const { id, p } of aliases) {
      if (!p) continue;
      let i = norm.indexOf(` ${p} `);
      while (i >= 0) {
        found.push({ id, index: i });
        norm = `${norm.slice(0, i + 1)}${'#'.repeat(p.length)}${norm.slice(i + 1 + p.length)}`;
        i = norm.indexOf(` ${p} `);
      }
    }
    const ids = unique(found.sort((a, b) => a.index - b.index).map((f) => f.id));
    // A bare "tango" is ballroom tango in a ballroom list, otherwise Argentine tango.
    if (/ tango /.test(norm) && !ids.includes('argentine-tango')) {
      const ballroomish = ids.some((id) => this.styles.get(id)?.family === 'ballroom');
      const pick = ballroomish ? 'ballroom' : 'argentine-tango';
      if (this.styles.has(pick) && !ids.includes(pick)) ids.push(pick);
    }
    return ids;
  }
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
