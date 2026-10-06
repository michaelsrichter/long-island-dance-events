/**
 * Live records for the server (decision P59). Only the live server's build includes this file
 * (server/astro-adapter/entry.mjs); the static build never does.
 *
 * The server reads every record's exact file text (`raw`) from PostgreSQL and hands it here. Each record is
 * read the way Astro reads src/content/** (JSON.parse, js-yaml, Markdown front matter), checked with the
 * same schemas (src/lib/collection-schemas.ts), and its stored picture paths are turned into the same
 * pictures the build made (Astro's own picture list, `astro:asset-imports`). The result goes to
 * globalThis.__liStore, which src/lib/collections.ts reads, and the data version to
 * globalThis.__liDataVersion, which makes every remembered list and page start again (src/lib/freshness.ts).
 *
 * One bad record never takes the site down: it keeps its last good version (or is left out), and events
 * that point at a missing venue, organizer, source or person are left out, with a message in the log.
 */
import { getEntry as buildEntry, render as contentRender } from 'astro:content';
import pictureImports from 'astro:asset-imports';
import { load as loadYaml } from 'js-yaml';
import { parseFrontmatter } from '@astrojs/internal-helpers/frontmatter';
import { z } from 'astro/zod';
import { COLLECTION_FILES, COLLECTION_SCHEMAS, type CollectionName } from './collection-schemas';
import type { LiveRecords } from './collections';

/** One database row: the record's id, repository path and exact file text. */
export interface LiveRow {
  id: string;
  path: string;
  raw: string;
}

interface LiveEntry {
  id: string;
  collection: CollectionName;
  data: Record<string, unknown>;
  body?: string;
  filePath: string;
}

export interface LoadResult {
  version: string;
  records: number;
  parsed: number;
  problems: string[];
  ms: number;
}

const NAMES = Object.keys(COLLECTION_FILES) as CollectionName[];

// ---------- pictures ----------

const normalizePath = (p: string) => {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
};
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);

let picturesByPath: Map<string, unknown> | undefined;
/** Project path of each picture the build knows ("src/assets/...") -> picture. */
function pictures(): Map<string, unknown> {
  if (picturesByPath) return picturesByPath;
  picturesByPath = new Map();
  for (const [key, picture] of pictureImports) {
    const q = key.indexOf('?');
    const src = q < 0 ? key : key.slice(0, q);
    const importer = new URLSearchParams(q < 0 ? '' : key.slice(q + 1)).get('importer') ?? '';
    if (picture && typeof picture === 'object' && !('__svgData' in picture)) picturesByPath.set(normalizePath(dirOf(importer) + src), picture);
  }
  return picturesByPath;
}

/** The file being read, so a picture path can be resolved next to it (records are read one at a time). */
let currentFile = '';
const pictureHelper = () =>
  z.string().transform((value, ctx) => {
    // Same rule as Astro: a bare file name means "next to the record".
    const src = /:\/\//.test(value) || value.startsWith('/') || value.startsWith('.') ? value : `./${value}`;
    const picture = pictures().get(normalizePath(dirOf(currentFile) + src));
    if (!picture) {
      ctx.addIssue({ code: 'custom', message: `Picture ${value} is not part of this version of the site yet.`, fatal: true });
      return z.NEVER;
    }
    return picture as never;
  });

const schemas = new Map<CollectionName, z.ZodType>();
function schemaOf(name: CollectionName): z.ZodType {
  let s = schemas.get(name);
  if (!s) {
    s = (COLLECTION_SCHEMAS[name] as (image: typeof pictureHelper) => z.ZodType)(pictureHelper);
    schemas.set(name, s);
  }
  return s;
}

// ---------- reading one record ----------

function readFile(name: CollectionName, raw: string): { data: unknown; body?: string } {
  const kind = COLLECTION_FILES[name];
  if (kind === 'json') return { data: raw === '' ? {} : JSON.parse(raw) };
  if (kind === 'yml') return { data: loadYaml(raw) };
  const parsed = parseFrontmatter(raw, { frontmatter: 'empty-with-spaces' });
  return { data: parsed.frontmatter, body: parsed.content.trim() };
}

async function readRecord(name: CollectionName, row: LiveRow): Promise<LiveEntry> {
  const { data, body } = readFile(name, row.raw);
  if (data == null || typeof data !== 'object' || Array.isArray(data)) throw new Error('the record is not a list of fields');
  currentFile = row.path;
  const result = await schemaOf(name).safeParseAsync(data);
  if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path.join('.') || '(record)'}: ${i.message}`).join('; '));
  return { id: row.id, collection: name, data: result.data as Record<string, unknown>, ...(body !== undefined ? { body } : {}), filePath: row.path };
}

// ---------- the store ----------

/** Parsed records by collection and id, with the file text they came from (reused while it is unchanged). */
const parsedCache = new Map<string, { path: string; raw: string; entry: LiveEntry }>();

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

class Store implements LiveRecords {
  readonly #lists = new Map<string, LiveEntry[]>();
  readonly #index = new Map<string, Map<string, LiveEntry>>();
  constructor(lists: Map<CollectionName, LiveEntry[]>) {
    for (const [name, list] of lists) {
      this.#lists.set(name, list);
      this.#index.set(name, new Map(list.map((e) => [e.id, e])));
    }
  }
  collection(name: string) {
    return this.#lists.get(name);
  }
  entry(name: string, id: string) {
    return this.#index.get(name)?.get(id);
  }
  /** Page texts (Markdown) were turned into HTML at build time; edited texts show after the next deploy. */
  render(entry: unknown) {
    const e = entry as LiveEntry;
    if (!e || e.collection !== 'pages' || !this.#index.get('pages')?.has(e.id)) return undefined;
    return (async () => {
      const built = await buildEntry('pages', e.id as never);
      if (!built) throw new Error(`The page "${e.id}" is new since the last deploy; its text shows after the next deploy.`);
      if ((built as { body?: string }).body !== e.body) console.warn(`[live] the text of page "${e.id}" changed; it shows after the next deploy`);
      return contentRender(built);
    })();
  }
}

/** Leave out events that point at records that don't exist (src/lib/content.ts would stop with an error). */
function dropBrokenEvents(lists: Map<CollectionName, LiveEntry[]>, problems: string[]) {
  const ids = (n: CollectionName) => new Set((lists.get(n) ?? []).map((e) => e.id));
  const venues = ids('venues');
  const organizers = ids('organizers');
  const sources = ids('sources');
  const performers = ids('performers');
  const instructors = ids('instructors');
  const styles = ids('styles');
  const kept = (lists.get('events') ?? []).filter((e) => {
    const d = e.data as { venueId?: string; organizerId?: string; sourceId?: string; performerIds?: string[]; instructorIds?: string[]; danceStyles?: string[] };
    const missing = [
      d.venueId && !venues.has(d.venueId) && `venue ${d.venueId}`,
      d.organizerId && !organizers.has(d.organizerId) && `organizer ${d.organizerId}`,
      d.sourceId && !sources.has(d.sourceId) && `source ${d.sourceId}`,
      ...(d.performerIds ?? []).filter((id) => !performers.has(id)).map((id) => `performer ${id}`),
      ...(d.instructorIds ?? []).filter((id) => !instructors.has(id)).map((id) => `teacher ${id}`),
      ...(d.danceStyles ?? []).filter((id) => !styles.has(id)).map((id) => `dance style ${id}`),
    ].filter(Boolean);
    if (missing.length) problems.push(`events/${e.id}: left out, it points at a missing ${missing.join(', ')}`);
    return missing.length === 0;
  });
  lists.set('events', kept);
}

let loading: Promise<LoadResult> | undefined;

/**
 * Read every record from the database rows and make them the site's records. Calls run one after another.
 * Returns what happened; problems are also written to the log.
 */
export function loadLiveRecords(rows: Partial<Record<string, LiveRow[]>>, version: string | number): Promise<LoadResult> {
  const run = (loading ?? Promise.resolve()).catch(() => undefined).then(() => load(rows, String(version)));
  loading = run;
  return run;
}

async function load(rows: Partial<Record<string, LiveRow[]>>, version: string): Promise<LoadResult> {
  const started = performance.now();
  const problems: string[] = [];
  const lists = new Map<CollectionName, LiveEntry[]>();
  let parsed = 0;
  let records = 0;
  const seen = new Set<string>();
  for (const name of NAMES) {
    const list: LiveEntry[] = [];
    for (const row of rows[name] ?? []) {
      const key = `${name}/${row.id}`;
      seen.add(key);
      const cached = parsedCache.get(key);
      if (cached && cached.raw === row.raw && cached.path === row.path) {
        list.push(cached.entry);
        continue;
      }
      try {
        const entry = await readRecord(name, row);
        parsedCache.set(key, { path: row.path, raw: row.raw, entry });
        list.push(entry);
        parsed++;
      } catch (err) {
        if (cached) {
          list.push(cached.entry);
          problems.push(`${key}: kept the last good version (${(err as Error).message})`);
        } else problems.push(`${key}: left out (${(err as Error).message})`);
      }
    }
    list.sort(byId);
    records += list.length;
    lists.set(name, list);
  }
  for (const key of [...parsedCache.keys()]) if (!seen.has(key)) parsedCache.delete(key);
  dropBrokenEvents(lists, problems);
  const g = globalThis as { __liStore?: LiveRecords; __liDataVersion?: string };
  g.__liStore = new Store(lists);
  g.__liDataVersion = version;
  for (const p of problems) console.warn(`[live] ${p}`);
  return { version, records, parsed, problems, ms: Math.round(performance.now() - started) };
}
