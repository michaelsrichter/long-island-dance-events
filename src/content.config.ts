import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  eventSchema,
  faqSchema,
  gallerySchema,
  instructorSchemaWith,
  organizerSchemaWith,
  pageSchema,
  performerSchemaWith,
  settingsSchema,
  sourceSchema,
  styleSchemaWith,
  venueSchemaWith,
} from './lib/schemas';

const md = (dir: string) => glob({ pattern: '**/*.md', base: `./src/content/${dir}` });
const yml = (dir: string) => glob({ pattern: '**/*.{yml,yaml}', base: `./src/content/${dir}` });
/** Entities written by the ingest pipeline and the CMS are JSON (one file per record; id = file name). */
const json = (dir: string) => glob({ pattern: '**/*.json', base: `./src/content/${dir}` });

export const collections = {
  events: defineCollection({ loader: json('events'), schema: eventSchema }),
  venues: defineCollection({ loader: json('venues'), schema: ({ image }) => venueSchemaWith(image) }),
  performers: defineCollection({ loader: json('performers'), schema: ({ image }) => performerSchemaWith(image) }),
  instructors: defineCollection({ loader: json('instructors'), schema: ({ image }) => instructorSchemaWith(image) }),
  organizers: defineCollection({ loader: json('organizers'), schema: ({ image }) => organizerSchemaWith(image) }),
  sources: defineCollection({ loader: json('sources'), schema: sourceSchema }),
  styles: defineCollection({ loader: yml('styles'), schema: ({ image }) => styleSchemaWith(image) }),
  pages: defineCollection({ loader: md('pages'), schema: ({ image }) => pageSchema(image) }),
  gallery: defineCollection({ loader: yml('gallery'), schema: ({ image }) => gallerySchema(image) }),
  faqs: defineCollection({ loader: yml('faqs'), schema: faqSchema }),
  settings: defineCollection({ loader: yml('settings'), schema: ({ image }) => settingsSchema(image) }),
};
