// Seeding of empty public community files, used by scripts/community-maintenance.mjs.
// A page's file can be written by the API at any moment (a like or a note), so seeding only ever
// creates missing files: the upload fails instead of overwriting when the file appeared meanwhile.

/**
 * @typedef {{ uploadData(data: Buffer, options: object): Promise<unknown> }} BlobClient
 * @typedef {{ getBlockBlobClient(path: string): BlobClient }} ContainerClient
 */

const TYPES = ['event', 'venue', 'organizer', 'instructor', 'performer', 'style'];

/**
 * Create an empty JSON file for every page key (and every per-type counts file) that has none yet.
 * @param {ContainerClient} community the public "community" container
 * @param {{ keys: string[], existing: Set<string>, now: number, dryRun?: boolean }} options
 * @returns {Promise<number>} page files created (or that would be created in a dry run)
 */
export async function seedEmptyFiles(community, { keys, existing, now, dryRun = false }) {
  const at = new Date(now).toISOString();
  /** @type {{ path: string, doc: object, cache: string, page: boolean }[]} */
  const files = [];
  for (const key of keys) {
    const [type, id] = key.split(':');
    files.push({ path: `${type}/${id}.json`, doc: { v: 1, key, likes: 0, comments: [], photos: [], updatedAt: at }, cache: 'public, max-age=60', page: true });
  }
  for (const type of TYPES) files.push({ path: `counts/${type}.json`, doc: { v: 1, type, likes: {}, updatedAt: at }, cache: 'public, max-age=300', page: false });

  let seeded = 0;
  for (const f of files) {
    if (existing.has(f.path)) continue;
    if (dryRun) {
      if (f.page) seeded++;
      continue;
    }
    try {
      await community.getBlockBlobClient(f.path).uploadData(Buffer.from(JSON.stringify(f.doc)), {
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8', blobCacheControl: f.cache },
      });
      if (f.page) seeded++;
    } catch (e) {
      // 409/412: the API wrote the file after we listed the container; keep its data.
      const status = /** @type {{ statusCode?: number }} */ (e)?.statusCode;
      if (status !== 409 && status !== 412) throw e;
    }
  }
  return seeded;
}
