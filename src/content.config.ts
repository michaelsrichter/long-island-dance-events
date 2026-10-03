import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  eventSchema,
  faqSchema,
  gallerySchema,
  instructorSchema,
  organizerSchema,
  pageSchema,
  performerSchema,
  settingsSchema,
  sourceSchema,
  styleSchema,
  venueSchema,
} from './lib/schemas';

const md = (dir: string) => glob({ pattern: '**/*.md', base: `./src/content/${dir}` });
const yml = (dir: string) => glob({ pattern: '**/*.{yml,yaml}', base: `./src/content/${dir}` });
/** Entities written by the ingest pipeline and the CMS are JSON (one file per record; id = file name). */
const json = (dir: string) => glob({ pattern: '**/*.json', base: `./src/content/${dir}` });

export const collections = {
  events: defineCollection({ loader: json('events'), schema: eventSchema }),
  venues: defineCollection({ loader: json('venues'), schema: venueSchema }),
  performers: defineCollection({ loader: json('performers'), schema: performerSchema }),
  instructors: defineCollection({ loader: json('instructors'), schema: instructorSchema }),
  organizers: defineCollection({ loader: json('organizers'), schema: organizerSchema }),
  sources: defineCollection({ loader: json('sources'), schema: sourceSchema }),
  styles: defineCollection({ loader: yml('styles'), schema: styleSchema }),
  pages: defineCollection({ loader: md('pages'), schema: ({ image }) => pageSchema(image) }),
  gallery: defineCollection({ loader: yml('gallery'), schema: ({ image }) => gallerySchema(image) }),
  faqs: defineCollection({ loader: yml('faqs'), schema: faqSchema }),
  settings: defineCollection({ loader: yml('settings'), schema: ({ image }) => settingsSchema(image) }),
};
