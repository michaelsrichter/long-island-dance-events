import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderSocialPng } from '../../src/lib/og';

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
});
