import { describe, expect, it } from 'vitest';
import { seedEmptyFiles } from '../../scripts/community-seed.mjs';

/** In-memory "community" container that honors the ifNoneMatch: '*' condition like Blob Storage does. */
function fakeContainer(present: string[] = []) {
  const files = new Map<string, string>(present.map((p) => [p, 'written by the API']));
  const uploads: { path: string; options: any }[] = [];
  return {
    files,
    uploads,
    getBlockBlobClient(path: string) {
      return {
        async uploadData(data: Buffer, options: any) {
          uploads.push({ path, options });
          if (options?.conditions?.ifNoneMatch === '*' && files.has(path)) throw Object.assign(new Error('BlobAlreadyExists'), { statusCode: 409 });
          files.set(path, data.toString('utf8'));
        },
      };
    },
  };
}

describe('community maintenance: seeding empty page files', () => {
  it('never overwrites a page file the API wrote after the container was listed', async () => {
    // The listing saw no files, but a like wrote venue/a.json before seeding reached it.
    const c = fakeContainer(['venue/a.json']);
    const seeded = await seedEmptyFiles(c, { keys: ['venue:a', 'venue:b'], existing: new Set(), now: Date.UTC(2026, 9, 4) });
    expect(c.files.get('venue/a.json')).toBe('written by the API');
    expect(JSON.parse(c.files.get('venue/b.json')!)).toMatchObject({ key: 'venue:b', likes: 0, comments: [], photos: [] });
    expect(seeded).toBe(1);
    expect(c.uploads.every((u) => u.options.conditions?.ifNoneMatch === '*')).toBe(true);
    expect(c.files.has('counts/venue.json')).toBe(true);
  });

  it('skips listed files, writes nothing in a dry run, and passes other storage errors on', async () => {
    const listed = fakeContainer();
    expect(await seedEmptyFiles(listed, { keys: ['style:salsa'], existing: new Set(['style/salsa.json']), now: 0 })).toBe(0);
    expect(listed.uploads.some((u) => u.path === 'style/salsa.json')).toBe(false);

    const dry = fakeContainer();
    expect(await seedEmptyFiles(dry, { keys: ['style:salsa'], existing: new Set(), now: 0, dryRun: true })).toBe(1);
    expect(dry.uploads).toHaveLength(0);

    const broken = { getBlockBlobClient: () => ({ uploadData: async () => Promise.reject(Object.assign(new Error('Forbidden'), { statusCode: 403 })) }) };
    await expect(seedEmptyFiles(broken, { keys: ['style:salsa'], existing: new Set(), now: 0 })).rejects.toThrow('Forbidden');
  });
});
