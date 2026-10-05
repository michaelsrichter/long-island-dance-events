import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Saved pictures go to a fresh folder for this test file (never the project's .cache/og).
process.env.OG_CACHE_DIR = mkdtempSync(join(tmpdir(), 'og-cache-'));
const { ogCacheStats, photoPanel, renderSocialJpeg, renderSocialPng } = await import('../../src/lib/og');

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