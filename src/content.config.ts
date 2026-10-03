import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  announcementSchema,
  eventSchema,
  faqSchema,
  gallerySchema,
  organizerSchema,
  pageSchema,
  personSchema,
  seriesSchema,
  settingsSchema,
  styleSchema,
  venueSchema,
} from './lib/schemas';

const md = (dir: string) => glob({ pattern: '**/*.md', base: `./src/content/${dir}` });
const yml = (dir: string) => glob({ pattern: '**/*.{yml,yaml}', base: `./src/content/${dir}` });

export const collections = {
  events: defineCollection({ loader: md('events'), schema: ({ image }) => eventSchema(image) }),
  series: defineCollection({ loader: md('series'), schema: ({ image }) => seriesSchema(image) }),
  venues: defineCollection({ loader: md('venues'), schema: ({ image }) => venueSchema(image) }),
  instructors: defineCollection({ loader: md('instructors'), schema: ({ image }) => personSchema(image) }),
  performers: defineCollection({ loader: md('performers'), schema: ({ image }) => personSchema(image) }),
  styles: defineCollection({ loader: yml('styles'), schema: styleSchema }),
  organizers: defineCollection({ loader: md('organizers'), schema: organizerSchema }),
  pages: defineCollection({ loader: md('pages'), schema: ({ image }) => pageSchema(image) }),
  announcements: defineCollection({ loader: yml('announcements'), schema: announcementSchema }),
  gallery: defineCollection({ loader: yml('gallery'), schema: ({ image }) => gallerySchema(image) }),
  faqs: defineCollection({ loader: yml('faqs'), schema: faqSchema }),
  settings: defineCollection({ loader: yml('settings'), schema: ({ image }) => settingsSchema(image) }),
};
