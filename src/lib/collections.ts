/**
 * The site's records (decision P59). Pages import getCollection, getEntry and render from here instead of
 * 'astro:content':
 * - static build: exactly Astro's own functions, reading src/content/**;
 * - live server: the records the server loaded from PostgreSQL (src/lib/live-store.ts), so a change in the
 *   database shows on the next page without a rebuild. Until the first load (or if the database is
 *   unreachable at start), the server uses the records it was built with.
 */
import {
  getCollection as contentCollection,
  getEntry as contentEntry,
  render as contentRender,
  type CollectionEntry,
  type CollectionKey,
} from 'astro:content';

export type { CollectionEntry, CollectionKey };

/** What the live server puts on globalThis.__liStore (see src/lib/live-store.ts). */
export interface LiveRecords {
  collection(name: string): readonly unknown[] | undefined;
  entry(name: string, id: string): unknown;
  render?(entry: unknown): Promise<unknown> | undefined;
}

const live = (): LiveRecords | undefined => (globalThis as { __liStore?: LiveRecords }).__liStore;

export async function getCollection<C extends CollectionKey, E extends CollectionEntry<C>>(
  collection: C,
  filter: (entry: CollectionEntry<C>) => entry is E,
): Promise<E[]>;
export async function getCollection<C extends CollectionKey>(collection: C, filter?: (entry: CollectionEntry<C>) => unknown): Promise<CollectionEntry<C>[]>;
export async function getCollection<C extends CollectionKey>(collection: C, filter?: (entry: CollectionEntry<C>) => unknown): Promise<CollectionEntry<C>[]> {
  const entries = live()?.collection(collection) as CollectionEntry<C>[] | undefined;
  if (!entries) return filter ? contentCollection(collection, filter) : contentCollection(collection);
  return filter ? entries.filter((e) => filter(e)) : entries.slice();
}

export async function getEntry<C extends CollectionKey>(collection: C, id: string): Promise<CollectionEntry<C> | undefined> {
  const store = live();
  if (!store?.collection(collection)) return (await contentEntry(collection, id as never)) as CollectionEntry<C> | undefined;
  return store.entry(collection, id) as CollectionEntry<C> | undefined;
}

export async function render<C extends CollectionKey>(entry: CollectionEntry<C>): ReturnType<typeof contentRender> {
  const rendered = live()?.render?.(entry);
  return (rendered ?? contentRender(entry)) as ReturnType<typeof contentRender>;
}
