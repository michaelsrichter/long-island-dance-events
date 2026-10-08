import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { COLLECTION_FILES, COLLECTION_SCHEMAS, type CollectionName } from './lib/collection-schemas';

/** One file per record in src/content/<name>/; id = file name. The live server reads the same records from
 * PostgreSQL with the same schemas (src/lib/live-store.ts). */
const PATTERNS = { json: '**/*.json', yml: '**/*.{yml,yaml}', md: '**/*.md' } as const;
const loader = (name: CollectionName) => glob({ pattern: PATTERNS[COLLECTION_FILES[name]], base: `./src/content/${name}` });

const s = COLLECTION_SCHEMAS;
export const collections = {
  events: defineCollection({ loader: loader('events'), schema: s.events() }),
  venues: defineCollection({ loader: loader('venues'), schema: ({ image }) => s.venues(image) }),
  performers: defineCollection({ loader: loader('performers'), schema: ({ image }) => s.performers(image) }),
  instructors: defineCollection({ loader: loader('instructors'), schema: ({ image }) => s.instructors(image) }),
  organizers: defineCollection({ loader: loader('organizers'), schema: ({ image }) => s.organizers(image) }),
  sources: defineCollection({ loader: loader('sources'), schema: s.sources() }),
  styles: defineCollection({ loader: loader('styles'), schema: ({ image }) => s.styles(image) }),
  pages: defineCollection({ loader: loader('pages'), schema: ({ image }) => s.pages(image) }),
  gallery: defineCollection({ loader: loader('gallery'), schema: ({ image }) => s.gallery(image) }),
  faqs: defineCollection({ loader: loader('faqs'), schema: s.faqs() }),
  settings: defineCollection({ loader: loader('settings'), schema: ({ image }) => s.settings(image) }),
};