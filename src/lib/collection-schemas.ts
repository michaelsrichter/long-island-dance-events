/**
 * The schema of each content collection, in one place for both readers (decision P59):
 * - src/content.config.ts: Astro reads src/content/** at build time;
 * - src/lib/live-store.ts: the live server reads the same records from PostgreSQL.
 * `image` is the helper that turns a stored picture path into a picture (Astro's, or the live server's).
 */
import type { z } from 'astro/zod';
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
  type ImageHelper,
} from './schemas';

export const COLLECTION_SCHEMAS = {
  events: () => eventSchema,
  venues: <I extends z.ZodType>(image: ImageHelper<I>) => venueSchemaWith(image),
  performers: <I extends z.ZodType>(image: ImageHelper<I>) => performerSchemaWith(image),
  instructors: <I extends z.ZodType>(image: ImageHelper<I>) => instructorSchemaWith(image),
  organizers: <I extends z.ZodType>(image: ImageHelper<I>) => organizerSchemaWith(image),
  sources: () => sourceSchema,
  styles: <I extends z.ZodType>(image: ImageHelper<I>) => styleSchemaWith(image),
  pages: <I extends z.ZodType>(image: ImageHelper<I>) => pageSchema(image),
  gallery: <I extends z.ZodType>(image: ImageHelper<I>) => gallerySchema(image),
  faqs: () => faqSchema,
  settings: <I extends z.ZodType>(image: ImageHelper<I>) => settingsSchema(image),
} as const;

export type CollectionName = keyof typeof COLLECTION_SCHEMAS;

/** Folder and file types of each collection (src/content/<name>/), as in src/content.config.ts. */
export const COLLECTION_FILES: Record<CollectionName, 'json' | 'yml' | 'md'> = {
  events: 'json',
  venues: 'json',
  performers: 'json',
  instructors: 'json',
  organizers: 'json',
  sources: 'json',
  styles: 'yml',
  pages: 'md',
  gallery: 'yml',
  faqs: 'yml',
  settings: 'yml',
};
