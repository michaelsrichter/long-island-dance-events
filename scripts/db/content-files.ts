/**
 * The content files that the live database mirrors (decision P56): src/content/<kind>/<id>.<ext>.
 * Same folders and file types as src/content.config.ts; server/src/lib/kinds.js has the same list of kinds.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import YAML from 'yaml';

export const KINDS = ['events', 'venues', 'performers', 'instructors', 'organizers', 'sources', 'styles', 'faqs', 'pages', 'gallery', 'settings'] as const;
export type Kind = (typeof KINDS)[number];

export const EXTENSIONS: Record<Kind, string[]> = {
  events: ['.json'],
  venues: ['.json'],
  performers: ['.json'],
  instructors: ['.json'],
  organizers: ['.json'],
  sources: ['.json'],
  styles: ['.yml', '.yaml'],
  faqs: ['.yml', '.yaml'],
  gallery: ['.yml', '.yaml'],
  settings: ['.yml', '.yaml'],
  pages: ['.md'],
};

export interface ContentFile {
  kind: Kind;
  id: string;
  /** Repository path with forward slashes, e.g. "src/content/venues/club-brumidi.json". */
  path: string;
  /** Exact file contents. */
  bytes: Buffer;
}

/** Every content file, sorted by path. */
export function listContentFiles(root: string): ContentFile[] {
  const out: ContentFile[] = [];
  for (const kind of KINDS) {
    const dir = join(root, 'src', 'content', kind);
    let names: string[] = [];
    try {
      names = readdirSync(dir, { recursive: true }) as string[];
    } catch {
      continue;
    }
    for (const name of names) {
      const ext = EXTENSIONS[kind].find((e) => name.endsWith(e));
      if (!ext) continue;
      const full = join(dir, name);
      const path = relative(root, full).split(sep).join('/');
      const id = relative(dir, full).split(sep).join('/').slice(0, -ext.length);
      out.push({ kind, id, path, bytes: readFileSync(full) });
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Markdown with YAML front matter: the front matter fields plus the text as `body`. */
export function parseMarkdown(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { body: text };
  return { ...(YAML.parse(m[1]!) ?? {}), body: m[2] };
}

/** The record as data, as Astro reads it (before schema defaults). */
export function parseContent(f: Pick<ContentFile, 'path' | 'bytes'>): Record<string, unknown> {
  const text = f.bytes.toString('utf8');
  if (f.path.endsWith('.json')) return JSON.parse(text);
  if (f.path.endsWith('.md')) return parseMarkdown(text);
  return YAML.parse(text) ?? {};
}
