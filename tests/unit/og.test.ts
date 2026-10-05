import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { photoPanel, renderSocialJpeg, renderSocialPng } from '../../src/lib/og';

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