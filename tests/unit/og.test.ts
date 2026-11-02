import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Saved pictures go to a fresh folder for this test file (never the project's .cache/og).
process.env.OG_CACHE_DIR = mkdtempSync(join(tmpdir(), 'og-cache-'));
const { ogCacheStats, originalFile, photoPanel, renderSocialJpeg, renderSocialPng } = await import('../../src/lib/og');

describe('social images', () => {
  it('renders real glyphs (fonts decode correctly)', async () => {
    // If fonts fail to load, every character becomes the same "missing glyph" box,
    // so two different titles of equal length would produce identical images.
    const a = await renderSocialPng({ title: 'Swing Night', lines: ['Lesson 7:30 PM'] }, 'og');
    const b = await renderSocialPng({ title: 'Lindy Hoppy', lines: ['Lesson 7:30 PM'] }, 'og');
    expect(a.equals(b)).toBe(false);
  }, 30_000);

  it('produces the expected Open Graph and square sizes', async () => {
    const og = await sharp(await renderSocialPng({ title: 'Band Night', month: 'Oct', day: '6', weekday: 'Tue', lines: ['Lesson 7:30 PM'] }, 'og')).metadata();
    const sq = await sharp(await renderSocialPng({ title: 'Band Night', month: 'Oct', day: '6', weekday: 'Tue', lines: ['Lesson 7:30 PM'] }, 'square')).metadata();
    expect([og.width, og.height]).toEqual([1200, 630]);
    expect([sq.width, sq.height]).toEqual([1080, 1080]);
  }, 30_000);

  it('stays small enough for thousands of events (under 75 KB each)', async () => {
    const card = { title: 'Faces for Radio at The Nutty Irishman', month: 'Oct', day: '3', weekday: 'Sat', lines: ['The Nutty Irishman, Farmingdale', 'Live music · Line dancing likely'], footer: "Listed on Ira's List" };
    const og = await renderSocialPng(card, 'og');
    const sq = await renderSocialPng(card, 'square');
    expect(og.length).toBeLessThan(75 * 1024);
    expect(sq.length).toBeLessThan(75 * 1024);
    expect((await sharp(og).metadata()).format).toBe('png');
  }, 30_000);

  it('puts a photo on directory cards, as a JPEG under 120 KB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'og-'));
    const big = join(dir, 'big.jpg');
    const small = join(dir, 'small.jpg');
    writeFileSync(big, await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#3a6ea5' } }).jpeg().toBuffer());
    writeFileSync(small, await sharp({ create: { width: 200, height: 150, channels: 3, background: '#3a6ea5' } }).jpeg().toBuffer());
    const photo = await photoPanel(big, '30% 50%');
    expect(photo).toMatch(/^data:image\/jpeg;base64,/);
    expect(await photoPanel(small)).toBeUndefined(); // never stretch a small photo
    const jpg = await renderSocialJpeg({ title: 'The Paramount', kicker: 'Venue · Huntington', lines: ['12 events coming up', 'Next: Sat, Oct 10'], footer: 'Address, parking and directions', photo });
    const meta = await sharp(jpg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630]);
    expect(jpg.length).toBeLessThan(120 * 1024);
  }, 30_000);
});

describe('saved share pictures (faster builds)', () => {
  const card = { title: 'Swing at the Lodge', month: 'Nov', day: '7', weekday: 'Sat', lines: ['8 PM · $20', 'Brumidi Lodge, Deer Park'], footer: 'Partner dancing' };

  it('reuses the saved picture when nothing on the card changed', async () => {
    const before = ogCacheStats();
    const first = await renderSocialPng(card, 'og');
    const second = await renderSocialPng({ ...card }, 'og');
    const after = ogCacheStats();
    expect(after.enabled).toBe(true);
    expect(after.drawn - before.drawn).toBe(1);
    expect(after.hits - before.hits).toBe(1);
    expect(second.equals(first)).toBe(true);
    expect(readdirSync(after.dir!).length).toBeGreaterThan(0);
  }, 30_000);

  it('draws a new picture when any fact or the size changes', async () => {
    const base = await renderSocialPng(card, 'og');
    const before = ogCacheStats();
    const moved = await renderSocialPng({ ...card, lines: ['9 PM · $20', 'Brumidi Lodge, Deer Park'] }, 'og');
    const cancelled = await renderSocialPng({ ...card, status: 'Cancelled' }, 'og');
    const square = await renderSocialPng(card, 'square');
    expect(ogCacheStats().drawn - before.drawn).toBe(3);
    expect(moved.equals(base)).toBe(false);
    expect(cancelled.equals(base)).toBe(false);
    expect((await sharp(square).metadata()).width).toBe(1080);
  }, 30_000);

  it('notices a new photo saved under the same file name', async () => {
    sharp.cache(false); // Windows: sharp's file cache keeps the old file open, so it could not be replaced
    const dir = mkdtempSync(join(tmpdir(), 'og-photo-'));
    const file = join(dir, 'venue.jpg');
    writeFileSync(file, await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#3a6ea5' } }).jpeg().toBuffer());
    const blue = await photoPanel(file);
    expect(await photoPanel(file)).toBe(blue);
    writeFileSync(file, await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#a53a3a' } }).jpeg().toBuffer());
    const red = await photoPanel(file);
    expect(red).toMatch(/^data:image\/jpeg;base64,/);
    expect(red).not.toBe(blue);
  }, 30_000);

  it('can be turned off with OG_CACHE_DIR=off', async () => {
    vi.resetModules();
    const saved = process.env.OG_CACHE_DIR;
    process.env.OG_CACHE_DIR = 'off';
    try {
      const og = await import('../../src/lib/og');
      await og.renderSocialPng({ title: 'Not saved', lines: ['Nothing written'] }, 'og');
      expect(og.ogCacheStats()).toEqual({ enabled: false, hits: 0, drawn: 0 });
    } finally {
      process.env.OG_CACHE_DIR = saved;
    }
  }, 30_000);
});

describe('share pictures on the live server (P64)', () => {
  it("uses the package's pictures (OG_SEED_DIR) before drawing, and never writes into them", async () => {
    const seed = mkdtempSync(join(tmpdir(), 'og-seed-'));
    const store = mkdtempSync(join(tmpdir(), 'og-store-'));
    const card = { title: 'Seeded Swing', lines: ['From the static build'] };
    // The static build draws and saves it...
    const first = mkdtempSync(join(tmpdir(), 'og-build-'));
    vi.resetModules();
    process.env.OG_CACHE_DIR = first;
    const build = await import('../../src/lib/og');
    const drawn = await build.renderSocialPng(card, 'og');
    for (const sub of readdirSync(first)) {
      mkdirSync(join(seed, sub), { recursive: true });
      for (const f of readdirSync(join(first, sub))) copyFileSync(join(first, sub, f), join(seed, sub, f));
    }
    // ...and the server finds it in its package instead of drawing it again.
    vi.resetModules();
    process.env.OG_CACHE_DIR = store;
    process.env.OG_SEED_DIR = seed;
    try {
      const server = await import('../../src/lib/og');
      const again = await server.renderSocialPng(card, 'og');
      expect(again.equals(drawn)).toBe(true);
      expect(server.ogCacheStats()).toMatchObject({ hits: 1, drawn: 0 });
      expect(readdirSync(store)).toEqual([]);
      await server.renderSocialPng({ ...card, title: 'Changed on the live site' }, 'og');
      expect(server.ogCacheStats().drawn).toBe(1);
      expect(readdirSync(store).length).toBe(1);
    } finally {
      delete process.env.OG_SEED_DIR;
    }
  }, 60_000);

  it('the static build lists the saved pictures it used (last-build.txt), for the server package', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'og-used-'));
    const script = `process.env.OG_CACHE_DIR = ${JSON.stringify(dir)};
      const og = await import(${JSON.stringify(new URL('../../src/lib/og.ts', import.meta.url).href)});
      await og.renderSocialPng({ title: 'Listed', lines: ['once'] }, 'og');`;
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: 'pipe' });
    const list = readFileSync(join(dir, 'last-build.txt'), 'utf8').trim().split('\n');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    expect(existsSync(join(dir, list[0] ?? ''))).toBe(true);
  }, 60_000);

  it('on the live server, draws one picture at a time and a picture asked for twice at once only once', async () => {
    vi.resetModules();
    process.env.OG_CACHE_DIR = mkdtempSync(join(tmpdir(), 'og-live-'));
    const g = globalThis as { __liLive?: boolean };
    g.__liLive = true;
    try {
      const server = await import('../../src/lib/og');
      const card = { title: 'Asked for twice', lines: ['at the same moment'] };
      const [a, b] = await Promise.all([server.renderSocialPng(card, 'og'), server.renderSocialPng({ ...card }, 'og')]);
      expect(a.equals(b)).toBe(true);
      expect(server.ogCacheStats()).toMatchObject({ drawn: 1, hits: 1 });
    } finally {
      delete g.__liLive;
    }
  }, 60_000);

  it("finds an original photo in the client folder when the build's path is not on this computer", () => {
    const client = mkdtempSync(join(tmpdir(), 'og-client-'));
    mkdirSync(join(client, '_astro'));
    writeFileSync(join(client, '_astro', 'venue.AbC123.jpg'), 'jpg');
    const g = globalThis as { __liClientDir?: string };
    g.__liClientDir = client;
    try {
      const here = join(client, '_astro', 'venue.AbC123.jpg');
      expect(originalFile({ fsPath: here, src: '/_astro/other.jpg' })).toBe(here);
      expect(originalFile({ fsPath: '/home/runner/work/site/src/assets/venue.jpg', src: '/_astro/venue.AbC123.jpg' })).toBe(here);
      expect(originalFile({ fsPath: '/gone/venue.jpg', src: '/_astro/../../secret.jpg' })).toBe('/gone/venue.jpg');
      expect(originalFile(undefined)).toBeUndefined();
    } finally {
      delete g.__liClientDir;
    }
  });
});
